// city-camera-controller.js
//
// The single owner of the Top Cities map-camera flow. Three modes, one flow:
//   - instant     (Stage 3): snap the camera to the city (Camera.lookAtPlot).
//   - cinematic   (Stage 4): one smooth keyframe approach (calculateCameraFocusAndZoom
//                  → addKeyframe), opt-in via topCities.cinematicEnabled.
//   - flyby       (Stage 5): a short multi-keyframe sequence, opt-in via
//                  topCities.flybyEnabled; falls back to cinematic on failure.
//
// Whatever the mode, the flow is the same: capture the camera, pop the Demographics
// screen so the map is visible, frame the city, mount a slim overlay, then on exit
// (Back / ESC / interrupt / relaunch / watchdog timeout) run ONE idempotent teardown
// that restores the camera and reopens the screen at the Top Cities sub-view.
//
// A single active token guards every async continuation: each scheduled callback
// re-checks token equality before touching the UI or camera, so a relaunch or an
// interrupt mid-animation can never be clobbered by a stale continuation.
//
// Camera APIs mirror the base game's city-zoomer.js (saveCameraZoom /
// calculateCameraFocusAndZoom / addKeyframe / restoreCameraZoom / clearAnimation).

import { safePlaySound } from "/demographics/ui/demographics-audio.js";
import { DemographicsSettings } from "/demographics/ui/demographics-settings.js";
import {
  captionText,
  mountOverlay,
  removeOverlay,
  updateFlybyProgress
} from "/demographics/ui/screen-demographics/cinematic-overlay.js";
import {
  animateFlyby,
  animateSingle,
  hideClutterLayers,
  popShotCamera,
  readFoV,
  removeFireworks,
  resolveSpecialDistricts,
  restoreClutterLayers,
  setFoV
} from "/demographics/ui/screen-demographics/cinematic-tour.js";

const SCREEN_TAG = "screen-demographics";
const REGION = { min: { x: 0.275, y: 0.025 }, max: { x: 0.975, y: 0.975 } };
const INSTANT_ZOOM = 0.4;
const INSTANT_TILT = 32;
const ARM_DELAY_MS = 350; // ignore engine interrupts fired by our own screen-pop
const DBG = false;

// The one in-flight camera flow, or null. `token` increments per launch so any
// stale async continuation can detect it has been superseded.
/** @type {*} */
let state = null;
let tokenCounter = 0;

// In-memory smoke-test counters (Stage 4 telemetry hook); read via
// getCameraDebugCounters() from the console while testing.
const debugCounters = { cinematicLaunchCount: 0, cinematicAbortCount: 0, cinematicRestoreFailures: 0 };

/**
 * Snapshot of the in-memory camera smoke-test counters.
 * @returns {{cinematicLaunchCount: number, cinematicAbortCount: number, cinematicRestoreFailures: number}}
 */
export function getCameraDebugCounters() {
  return { ...debugCounters };
}

/**
 * Debug logger, no-op unless {@link DBG}.
 * @param {...*} a Values to log.
 */
function clog(...a) {
  if (DBG) console.warn("[Demographics.camera]", ...a);
}

/**
 * Clamp a number into [lo, hi]; returns `lo` for a non-finite input.
 * @param {number} v The value.
 * @param {number} lo Lower bound.
 * @param {number} hi Upper bound.
 * @returns {number} The clamped value.
 */
function clamp(v, lo, hi) {
  if (typeof v !== "number" || !isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Read a topCities.* setting with a call-site default (the authoritative default).
 * @param {string} key The setting key.
 * @param {*} dflt The fallback.
 * @returns {*} The stored value or the default.
 */
function cfg(key, dflt) {
  try {
    return DemographicsSettings.getSetting(key, dflt);
  } catch (_) {
    return dflt;
  }
}

/**
 * Promise that resolves after `ms` (token-checked by callers).
 * @param {number} ms Delay in milliseconds.
 * @returns {Promise<void>} The delay promise.
 */
function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Whether `token` is still the active flow's token.
 * @param {number} token The token to check.
 * @returns {boolean} True when current.
 */
function isToken(token) {
  return !!state && state.token === token;
}

/**
 * Whether a target is off-limits to the camera: no target, a masked record, or a
 * settlement owned by a civ the local player has not met (never fly to unmet —
 * independent of the name-masking option).
 * @param {*} target The settlement record.
 * @returns {boolean} True when the camera must not engage.
 */
function blockedTarget(target) {
  return !target || target.masked || !!(target.owner && target.owner.met === false);
}

// ── Camera primitives (all defensive; the engine surface can be absent) ───────

/**
 * Resolve a camera enum member (InterpolationFunc / KeyframeFlag), or undefined.
 * @param {string} ns The enum global name.
 * @param {string} member The member name.
 * @returns {*} The enum value, or undefined.
 */
function enumVal(ns, member) {
  try {
    const g = ns === "InterpolationFunc"
      ? (typeof InterpolationFunc !== "undefined" ? InterpolationFunc : null)
      : (typeof KeyframeFlag !== "undefined" ? KeyframeFlag : null);
    return g ? g[member] : undefined;
  } catch (_) {
    return undefined;
  }
}

/**
 * Save the current camera zoom (records `didSaveZoom` for guarded restore).
 */
function saveCamera() {
  try {
    if (typeof Camera !== "undefined" && typeof Camera.saveCameraZoom === "function") {
      Camera.saveCameraZoom();
      if (state) state.didSaveZoom = true;
    }
  } catch (_) {
    // Camera.saveCameraZoom can be absent/throw; restore simply becomes a no-op.
  }
}

/**
 * Snap the camera to a plot (Stage 3 instant mode).
 * @param {{x: number, y: number}} loc The plot location.
 */
function lookAtInstant(loc) {
  try {
    if (typeof Camera !== "undefined" && typeof Camera.lookAtPlot === "function") {
      Camera.lookAtPlot({ x: loc.x, y: loc.y }, { zoom: INSTANT_ZOOM, tilt: INSTANT_TILT });
    }
  } catch (_) {
    // Camera.lookAtPlot can be absent/throw; the overlay still shows.
  }
}

/**
 * Submit one camera keyframe, filling func/writeMask defensively.
 * @param {*} frame The keyframe (focus/zoom/tilt/duration/end).
 */
function addKf(frame) {
  try {
    if (typeof Camera === "undefined" || typeof Camera.addKeyframe !== "function") return;
    const ease = enumVal("InterpolationFunc", "EaseOutSin");
    const flagAll = enumVal("KeyframeFlag", "FLAG_ALL");
    const kf = Object.assign({}, frame);
    if (kf.func === undefined && ease !== undefined) kf.func = ease;
    if (flagAll !== undefined) kf.writeMask = flagAll;
    Camera.addKeyframe(kf);
  } catch (_) {
    // Camera.addKeyframe can throw; the watchdog/teardown still recovers the camera.
  }
}

/**
 * Target the camera by ComponentID (engine wraps lookAtPlot + selection). Used
 * as the last-resort framing fallback.
 * @param {*} componentId The city ComponentID.
 * @returns {boolean} True when the call was made.
 */
function lookAtComponent(componentId) {
  try {
    if (componentId && typeof UI !== "undefined" && UI.Player && typeof UI.Player.lookAtID === "function") {
      UI.Player.lookAtID(componentId, 0);
      return true;
    }
  } catch (_) {
    // UI.Player.lookAtID can throw; fall through.
  }
  return false;
}

/**
 * Restore the camera to its pre-flow state. Returns false on failure so the
 * caller can run the emergency keyframe.
 * @param {boolean} didSaveZoom Whether the zoom was saved.
 * @returns {boolean} True when restore succeeded.
 */
function safeRestoreCamera(didSaveZoom) {
  try {
    if (typeof Camera === "undefined") return true;
    if (typeof Camera.clearAnimation === "function") Camera.clearAnimation();
    if (didSaveZoom && typeof Camera.restoreCameraZoom === "function") Camera.restoreCameraZoom();
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Emergency recovery when restore fails: a moderate neutral zoom-out keyframe
 * that returns control to the player.
 */
function emergencyKeyframe() {
  addKf({ duration: 0.8, zoom: 0.9, tilt: 30, end: true });
  clog("emergency keyframe issued (restore failed)");
}

/**
 * Compute the city framing via the engine's plot-fit, or null.
 * @param {*[]} plots The city's purchased plots.
 * @returns {{x: number, y: number, z: number}|null} The fit, or null.
 */
function calcFocus(plots) {
  try {
    if (typeof Camera !== "undefined" && typeof Camera.calculateCameraFocusAndZoom === "function") {
      const f = Camera.calculateCameraFocusAndZoom(plots, 30, { region: REGION });
      if (f && typeof f.x === "number" && typeof f.y === "number") return f;
    }
  } catch (_) {
    // calculateCameraFocusAndZoom can throw for a degenerate plot set; fall through.
  }
  return null;
}

// ── Screen open/close (dynamic import, as the dock decorator does) ─────────────

/**
 * Resolve the engine context manager and invoke `fn` with it.
 * @param {(cm: *) => void} fn Callback receiving the ContextManager.
 */
function withContextManager(fn) {
  import("/core/ui/context-manager/context-manager.js")
    .then((m) => fn(/** @type {*} */ (m.default || m.ContextManager || m)))
    .catch(() => {
      // context-manager import can fail in headless contexts; the camera move still happened.
    });
}

/**
 * Pop the Demographics screen so the map is visible.
 */
function popScreen() {
  withContextManager((cm) => {
    try {
      if (typeof cm.pop === "function") cm.pop(SCREEN_TAG);
    } catch (_) {
      // pop can warn/throw if the screen is no longer top-of-stack; ignore.
    }
  });
}

/**
 * Reopen the Demographics screen at the Top Cities sub-view (force the persisted
 * view/sub-tab so teardown always lands back on the showcase).
 */
function reopenScreen() {
  try {
    DemographicsSettings.setSetting("activeView", "rankings");
    DemographicsSettings.setSetting("settlementsSubTab", "showcase");
  } catch (_) {
    // setSetting can throw if storage is wiped; the panel still reopens on its last view.
  }
  withContextManager((cm) => {
    try {
      if (typeof cm.push === "function") cm.push(SCREEN_TAG, { singleton: true, createMouseGuard: true });
    } catch (_) {
      // push can throw mid-transition; ignore.
    }
  });
}

// ── Framing ────────────────────────────────────────────────────────────────────

/**
 * Re-resolve a live city's purchased plots from its ComponentID (handles go
 * stale across renders, so we never retain them).
 * @param {*} componentId The city ComponentID.
 * @returns {*[]} The purchased plots (empty when unavailable).
 */
function livePlots(componentId) {
  try {
    const city = componentId && typeof Cities !== "undefined" && Cities.get ? Cities.get(componentId) : null;
    const plots = city && typeof city.getPurchasedPlots === "function" ? city.getPurchasedPlots() : null;
    return Array.isArray(plots) ? plots : [];
  } catch (_) {
    // Cities.get / getPurchasedPlots can throw for a stale id; treat as none.
    return [];
  }
}

/**
 * Resolve a smooth-camera frame for a settlement: prefer the engine plot-fit,
 * else fall back to the focus plot at a fixed zoom. Returns null when neither a
 * plot-fit nor a focus plot is available (caller then tries lookAtID).
 * @param {*} target The settlement record.
 * @returns {{focus: {x: number, y: number}, zoom: number, usedFallback: boolean}|null}
 */
function resolveCityFrame(target) {
  const fit = calcFocus(livePlots(target.componentId));
  if (fit) return { focus: { x: fit.x, y: fit.y }, zoom: clamp(fit.z, 0.3, 1.0), usedFallback: false };
  const loc = target.location;
  if (loc && typeof loc.x === "number" && typeof loc.y === "number") {
    return { focus: { x: loc.x, y: loc.y }, zoom: 0.55, usedFallback: true };
  }
  return null;
}

// ── Overlay ───────────────────────────────────────────────────────────────────

/**
 * Update the "now showing" caption (wonder name + build year), shown while the
 * tour lingers on a wonder and cleared on city shots.
 * @param {*} caption The {nameKey, year} caption, or null to clear.
 */
function updateNowShowing(caption) {
  if (!state || !state.caption) return;
  state.caption.textContent = captionText(caption);
}

/**
 * Replay the cinematic for the same city in place (the map-click affordance).
 * Reuses the saved camera/FoV/layers/world-input baseline — only the tour and
 * its overlay restart, with no screen flicker. Exit is via the Back button / ESC.
 */
function replayCinematic() {
  if (!state) return;
  const s = state;
  clearTimers(s);
  removeFireworks(s);
  popShotCamera(s);
  unbindInterrupts(s);
  removeOverlay(s);
  s.token = ++tokenCounter;
  s.phase = "preparing";
  s.pushedCamera = false;
  mountCurrentOverlay(s.target, s.mode);
  bindInterrupts(s.token);
  safePlaySound("data-audio-activate");
  runFlyby(s.target, null, s.token);
}

// ── World input + interrupts ──────────────────────────────────────────────────

/**
 * Disable engine world input (selection/diplomacy) during the cinematic via the
 * engine's own switch, so map clicks never select a city. Restored on teardown.
 */
function disableWorldInput() {
  try {
    window.dispatchEvent(new CustomEvent("ui-disable-world-input"));
  } catch (_) {
    // CustomEvent/window may be unavailable in headless hosts.
  }
}

/**
 * Re-enable engine world input.
 */
function enableWorldInput() {
  try {
    window.dispatchEvent(new CustomEvent("ui-enable-world-input"));
  } catch (_) {
    // ignore.
  }
}

/**
 * Dispatch a bare window CustomEvent (defensive).
 * @param {string} name The event name.
 */
function fireWindowEvent(name) {
  try {
    window.dispatchEvent(new CustomEvent(name));
  } catch (_) {
    // CustomEvent/window may be unavailable in headless hosts.
  }
}

/**
 * Hide the in-game city banners during the cinematic for a clean shot (the
 * engine's own ui-hide-city-banners switch). Restored on teardown.
 */
function hideCityBanners() {
  fireWindowEvent("ui-hide-city-banners");
}

/**
 * Re-show the in-game city banners.
 */
function showCityBanners() {
  fireWindowEvent("ui-show-city-banners");
}

/**
 * Hide the floating unit flags/icons during the cinematic. Restored on teardown.
 */
function hideUnitFlags() {
  fireWindowEvent("ui-hide-unit-flags");
}

/**
 * Re-show the unit flags/icons.
 */
function showUnitFlags() {
  fireWindowEvent("ui-show-unit-flags");
}

/**
 * A monotonic-ish timestamp for debouncing (Date.now is available in the game
 * runtime; this is mod UI, not a workflow script).
 * @returns {number} Milliseconds, or 0 when unavailable.
 */
function nowMs() {
  try {
    return Date.now();
  } catch (_) {
    return 0;
  }
}

/**
 * Whether an event is an Escape keypress.
 * @param {*} e The keyboard event.
 * @returns {boolean} True for Escape.
 */
function isEscape(e) {
  return !!e && (e.key === "Escape" || e.keyCode === 27);
}

/**
 * Classify an engine-input event: "exit" (cancel/escape/right-click), "replay"
 * (left-click/tap/accept), or "" (ignore).
 * @param {*} d The engine-input detail.
 * @returns {string} "exit" | "replay" | "".
 */
function classifyInput(d) {
  if (!d || !d.name) return "";
  if (d.name === "cancel" || d.name === "keyboard-escape" || d.name === "mousebutton-right") return "exit";
  if (d.name === "mousebutton-left" || d.name === "touch-tap" || d.name === "accept") return "replay";
  return "";
}

/**
 * Bind interrupt sources for the active flow: ESC (immediate) and the engine's
 * interface-mode change (armed after a delay, so our own screen-pop doesn't
 * self-trigger). The Back button and relaunch are wired elsewhere.
 * @param {number} token The flow token.
 */
function bindInterrupts(token) {
  const s = state;
  s.onKey = (/** @type {*} */ e) => {
    if (isEscape(e)) teardownActiveCinematic("escape");
  };
  s.onMode = () => {
    if (s.armed && isToken(token)) teardownActiveCinematic("interrupt");
  };
  // Engine world-input: a map click REPLAYS the cinematic; cancel/ESC exits.
  // World selection is already disabled, so this never selects a city.
  s.onInput = (/** @type {*} */ e) => handleCinematicInput(s, token, e);
  try {
    window.addEventListener("keydown", s.onKey, true);
    window.addEventListener("engine-input", s.onInput, true);
  } catch (_) {
    // addEventListener can be absent in headless hosts; Back still works.
  }
  try {
    if (typeof engine !== "undefined" && typeof engine.on === "function") {
      engine.on("InterfaceModeChanged", s.onMode);
    }
  } catch (_) {
    // engine.on may be unavailable; the interface-mode interrupt is best-effort.
  }
  setTimeout(() => {
    if (isToken(token)) s.armed = true;
  }, ARM_DELAY_MS);
}

/**
 * Handle an engine-input event during the cinematic: debounced, armed-gated; a
 * click replays, cancel exits. Consumes the event so nothing else reacts.
 * @param {*} s The flow state.
 * @param {number} token The flow token.
 * @param {*} e The engine-input event.
 */
function handleCinematicInput(s, token, e) {
  if (!s.armed || !isToken(token)) return;
  const kind = classifyInput(e && e.detail);
  if (!kind) return;
  // A click on the overlay UI (Back button / card) just fired a DOM mousedown;
  // don't also treat it as a map click → replay. Let the button's handler run.
  if (kind === "replay" && s.uiClickAt && nowMs() - s.uiClickAt < 400) return;
  consumeEvent(e);
  if (inputDebounced(s)) return; // a single physical click fires START + FINISH
  if (kind === "exit") teardownActiveCinematic("cancel");
  else replayCinematic();
}

/**
 * Consume an engine-input event so nothing else reacts.
 * @param {*} e The event.
 */
function consumeEvent(e) {
  try {
    e.preventDefault();
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
  } catch (_) {
    // ignore.
  }
}

/**
 * Whether this input should be debounced (within 500ms of the last acted-on
 * input), recording the timestamp when it isn't.
 * @param {*} s The flow state.
 * @returns {boolean} True to ignore (debounced).
 */
function inputDebounced(s) {
  const now = nowMs();
  if (s.lastInputAt && now - s.lastInputAt < 500) return true;
  s.lastInputAt = now;
  return false;
}

/**
 * Detach the active flow's interrupt listeners.
 * @param {*} s The flow state.
 */
function unbindInterrupts(s) {
  try {
    if (s.onKey) window.removeEventListener("keydown", s.onKey, true);
    if (s.onInput) window.removeEventListener("engine-input", s.onInput, true);
  } catch (_) {
    // ignore detach errors.
  }
  try {
    if (s.onMode && typeof engine !== "undefined" && typeof engine.off === "function") {
      engine.off("InterfaceModeChanged", s.onMode);
    }
  } catch (_) {
    // ignore detach errors.
  }
}

// ── Teardown (single, idempotent) ──────────────────────────────────────────────

/**
 * Clear any pending timers on the flow state.
 * @param {*} s The flow state.
 */
function clearTimers(s) {
  try {
    if (s.watchdog) clearTimeout(s.watchdog);
  } catch (_) {
    // clearTimeout rarely throws; ignore.
  }
  s.watchdog = null;
}

/**
 * Tear down the active camera flow exactly once: clear timers, detach
 * interrupts, remove the overlay, restore the camera (emergency keyframe on
 * failure), and reopen the Demographics screen. Safe to call any number of
 * times and from any exit path.
 * @param {string} reason The teardown reason (debug only).
 */
export function teardownActiveCinematic(reason) {
  if (!state) return;
  const s = state;
  state = null; // claim ownership so re-entrant calls and stale continuations no-op
  s.phase = "restoring";
  clog("teardown:", reason);
  if (typeof reason === "string" && (reason.indexOf("ERR_") === 0 || reason === "interrupt")) {
    debugCounters.cinematicAbortCount++;
  }
  clearTimers(s);
  unbindInterrupts(s);
  removeOverlay(s);
  popShotCamera(s);
  removeFireworks(s);
  restoreClutterLayers(s.hiddenLayers);
  if (s.fovTouched) setFoV(s.savedFoV);
  enableWorldInput();
  showCityBanners();
  showUnitFlags();
  if (!safeRestoreCamera(s.didSaveZoom)) {
    debugCounters.cinematicRestoreFailures++;
    emergencyKeyframe();
  }
  reopenScreen();
}

/**
 * Whether a camera flow is currently active.
 * @returns {boolean} True while a flow is live (not torn down).
 */
export function isCinematicActive() {
  return !!state && state.phase !== "restoring";
}

// ── Animation ───────────────────────────────────────────────────────────────────

/**
 * Stage 4 wrapper: run the single-shot cinematic approach through
 * `cinematic-tour.js` using controller-owned state and utilities.
 * @param {{focus: {x: number, y: number}, zoom: number}} frame The resolved frame.
 * @param {number} token The flow token.
 */
function runPseudoCinematic(frame, token) {
  if (!state) return;
  animateSingle(frame, token, state, {
    cfg,
    clamp,
    addKf,
    isToken,
    clearTimers
  });
}

/**
 * Stage 5 wrapper: run the flyby/tour through `cinematic-tour.js`.
 * @param {*} target The settlement record.
 * @param {{focus: {x: number, y: number}, zoom: number}|null} frame The fallback frame.
 * @param {number} token The flow token.
 */
function runFlyby(target, frame, token) {
  if (!state) return;
  animateFlyby(target, frame, token, {
    flowState: state,
    cfg,
    clamp,
    addKf,
    isToken,
    clearTimers,
    delay,
    updateFlybyProgress,
    updateNowShowing,
    teardownActiveCinematic,
    lookAtComponent,
    lookAtInstantReturn
  });
}

/**
 * Mount the cinematic overlay for the active flow.
 * @param {*} target The settlement record.
 * @param {string} mode The active mode.
 */
function mountCurrentOverlay(target, mode) {
  if (!state) return;
  mountOverlay(state, target, mode, {
    onBack: () => {
      teardownActiveCinematic("back");
    },
    nowMs
  });
}

// ── Launch ──────────────────────────────────────────────────────────────────────

/**
 * Begin a flow: validate, capture the camera, pop the screen, mount the overlay,
 * and bind interrupts. Returns the resolved frame, or null when the target has
 * no usable location (caller handles the lookAtID fallback / abort).
 * @param {*} target The settlement record.
 * @param {string} mode The flow mode ("instant" | "cinematic" | "flyby").
 * @returns {{focus: {x: number, y: number}, zoom: number}|null|undefined}
 *   The frame for animated modes, null to signal "no frame", or undefined when
 *   the launch was rejected outright.
 */
function beginFlow(target, mode) {
  if (blockedTarget(target)) return undefined; // unmet/masked gate (button is also disabled)
  if (isCinematicActive()) teardownActiveCinematic("relaunch");
  const token = ++tokenCounter;
  state = { token, target, phase: "preparing", mode, didSaveZoom: false, armed: false, overlay: null, watchdog: null };
  debugCounters.cinematicLaunchCount++;
  saveCamera();
  state.savedFoV = readFoV();
  state.hiddenLayers = hideClutterLayers();
  disableWorldInput();
  hideCityBanners();
  hideUnitFlags();
  target.districts = resolveSpecialDistricts(target);
  popScreen();
  mountCurrentOverlay(target, mode);
  bindInterrupts(token);
  safePlaySound("data-audio-activate");
  return mode === "instant" ? undefined : resolveCityFrame(target);
}

/**
 * "View on map" — simply close the Demographics screen and fly the camera to the
 * city, leaving the player on the map with full control. No overlay, no return
 * window, no camera save/restore (the player just stays where they were flown).
 * @param {*} target The settlement record.
 * @returns {boolean} True when launched.
 */
export function startInstant(target) {
  if (blockedTarget(target) || !target.location) return false;
  if (isCinematicActive()) teardownActiveCinematic("relaunch");
  popScreen();
  lookAtInstant(target.location);
  safePlaySound("data-audio-activate");
  return true;
}

/**
 * Stage 4 — animate a smooth single-shot approach. Falls back to lookAtID, then
 * to instant, when no keyframe frame can be resolved.
 * @param {*} target The settlement record.
 * @returns {boolean} True when launched.
 */
export function startPseudoCinematic(target) {
  const frame = beginFlow(target, "cinematic");
  if (frame === undefined && !state) return false; // rejected (masked / no target)
  if (!state) return false;
  if (frame) {
    runPseudoCinematic(frame, state.token);
    return true;
  }
  // Fallback B: select+focus by id; else degrade to instant.
  if (lookAtComponent(target.componentId)) {
    state.phase = "inspecting";
    return true;
  }
  if (target.location) {
    lookAtInstant(target.location);
    state.phase = "inspecting";
    return true;
  }
  teardownActiveCinematic("ERR_NO_FRAME");
  return false;
}

/**
 * Stage 5 — run the cinematic grand tour. `animateFlyby` runs the push-camera
 * tour when available and otherwise degrades (single approach → lookAtID →
 * instant → abort) on its own.
 * @param {*} target The settlement record.
 * @returns {boolean} True when launched.
 */
export function startFlyby(target) {
  const frame = beginFlow(target, "flyby");
  if (!state) return false;
  runFlyby(target, frame || null, state.token);
  return true;
}

/**
 * lookAtInstant variant that reports success (for fallback chaining).
 * @param {{x: number, y: number}} loc The plot location.
 * @returns {boolean} Always true once the call is attempted.
 */
function lookAtInstantReturn(loc) {
  lookAtInstant(loc);
  return true;
}

/**
 * The dedicated "Cinematic" action: run the grand flyby tour (default), or the
 * simpler pseudo-cinematic single approach when the flyby is disabled. This is
 * the second button next to "View on map"; both default on.
 * @param {*} target The settlement record.
 * @returns {boolean} True when a flow launched.
 */
export function launchCinematic(target) {
  if (blockedTarget(target)) return false;
  if (cfg("topCities.flybyEnabled", true) === true) return startFlyby(target);
  return startPseudoCinematic(target);
}
