// city-camera-controller.js
//
// The single owner of the Top Cities map-camera flow: instant (snap), cinematic (one keyframe
// approach) or flyby (multi-keyframe tour, falls back to cinematic). Every mode captures the
// camera, pops the Demographics screen, frames the city, mounts an overlay, and on exit runs one
// idempotent teardown. A single active token guards every async continuation so a stale one
// never clobbers a relaunch or interrupt.

import { safePlaySound } from "/demographics/ui/core/demographics-audio.js";
import { DemographicsSettings } from "/demographics/ui/core/demographics-settings.js";
import {
  captionText,
  flavorText,
  mountOverlay,
  removeOverlay,
  updateFlybyProgress
} from "/demographics/ui/screen-demographics/camera/cinematic-overlay.js";
import {
  animateFlyby,
  animateSingle,
  hideClutterLayers,
  popShotCamera,
  readFoV,
  removeFireworks,
  restoreClutterLayers,
  setFoV
} from "/demographics/ui/screen-demographics/camera/cinematic-tour.js";
import {
  cityPurchasedIndices,
  resolveSpecialDistricts
} from "/demographics/ui/screen-demographics/camera/cinematic-tour-highlights.js";
import {
  blockedTarget,
  cfg,
  cameraReady,
  clamp,
  classifyInput,
  consumeEvent,
  delay,
  enumVal,
  inputDebounced,
  isEscape,
  nowMs
} from "/demographics/ui/screen-demographics/camera/city-camera-controller-utils.js";
import { makeLogger } from "/demographics/ui/core/demographics-log.js";

const SCREEN_TAG = "screen-demographics";
const REGION = { min: { x: 0.275, y: 0.025 }, max: { x: 0.975, y: 0.975 } };
const INSTANT_ZOOM = 0.4;
const INSTANT_TILT = 32;
const ARM_DELAY_MS = 350; // ignore engine interrupts fired by our own screen-pop
const log = makeLogger("camera");

// The one in-flight camera flow, or null. `token` increments per launch so any
// stale async continuation can detect it has been superseded.
/** @type {*} */
let state = null;
let tokenCounter = 0;

/** @param {number} token */
function isToken(token) {
  return !!state && state.token === token;
}

// Camera primitives. All of them guard, because the engine surface can be absent.

function saveCamera() {
  try {
    if (typeof Camera !== "undefined" && typeof Camera.saveCameraZoom === "function") {
      Camera.saveCameraZoom();
      if (state) state.didSaveZoom = true;
    }
  } catch (_) {
    // Camera.saveCameraZoom can be absent/throw; restore then becomes a no-op.
  }
}

/** @param {{x: number, y: number}} loc */
function lookAtInstant(loc) {
  try {
    if (typeof Camera !== "undefined" && typeof Camera.lookAtPlot === "function") {
      Camera.lookAtPlot({ x: loc.x, y: loc.y }, { zoom: INSTANT_ZOOM, tilt: INSTANT_TILT });
    }
  } catch (_) {
    // Camera.lookAtPlot can be absent/throw; the overlay still shows.
  }
}

/** @param {*} frame The keyframe (focus/zoom/tilt/duration/end). */
function addKf(frame) {
  try {
    if (typeof Camera === "undefined" || typeof Camera.addKeyframe !== "function") return;
    const ease = enumVal("InterpolationFunc", "EaseOutSin");
    const flagAll = enumVal("KeyframeFlag", "FLAG_ALL");
    const keyframe = Object.assign({}, frame);
    if (keyframe.func === undefined && ease !== undefined) keyframe.func = ease;
    if (flagAll !== undefined) keyframe.writeMask = flagAll;
    Camera.addKeyframe(keyframe);
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
  log.debug("emergency keyframe issued (restore failed)");
}

/**
 * @param {*[]} plots
 * @returns {{x: number, y: number, z: number}|null}
 */
function calcFocus(plots) {
  try {
    if (typeof Camera !== "undefined" && typeof Camera.calculateCameraFocusAndZoom === "function") {
      const fit = Camera.calculateCameraFocusAndZoom(plots, 30, { region: REGION });
      if (fit && typeof fit.x === "number" && typeof fit.y === "number") return fit;
    }
  } catch (_) {
    // calculateCameraFocusAndZoom can throw for a degenerate plot set; fall through.
  }
  return null;
}

// Screen open/close (dynamic import, as the dock decorator does)

/** @param {(contextManager: *) => void} fn */
function withContextManager(fn) {
  import("/core/ui/context-manager/context-manager.js")
    .then((imported) => fn(/** @type {*} */ (imported.default || imported.ContextManager || imported)))
    .catch(() => {
      // context-manager import can fail in headless contexts; the camera move still happened.
    });
}

/**
 * Resolve the engine display-queue manager (the popup/notification sequencer the
 * base game's own cinematics defer through) and invoke `fn` with it.
 * @param {(displayQueue: *) => void} fn Callback receiving the DisplayQueueManager.
 */
function withDisplayQueue(fn) {
  import("/core/ui/context-manager/display-queue-manager.js")
    .then((imported) => fn(/** @type {*} */ (imported.DisplayQueueManager || imported.default || imported)))
    .catch(() => {
      // display-queue-manager import can fail in headless contexts; popups just won't defer.
    });
}

/**
 * Suspend the engine popup/notification queue while a cinematic owns the screen, so popups
 * don't appear over the flyby; they re-surface on teardown. Only claimed when not already
 * suspended, so teardown never resumes a suspension we didn't own.
 * @param {*} flowState The active flow state (flagged so teardown resumes once).
 */
function suspendPopups(flowState) {
  withDisplayQueue((displayQueue) => {
    try {
      const canSuspend = typeof displayQueue.suspend === "function" && typeof displayQueue.isSuspended === "function";
      if (canSuspend && !displayQueue.isSuspended()) {
        displayQueue.suspend();
        if (flowState) flowState.popupsSuspended = true;
      }
    } catch (_) {
      // suspend can throw mid-transition; non-fatal (popups just aren't deferred).
    }
  });
}

/**
 * Resume the popup/notification queue suspended by {@link suspendPopups}, letting
 * any popups that arrived during the cinematic surface now.
 * @param {*} flowState The flow state flagged by suspendPopups.
 */
function resumePopups(flowState) {
  if (!flowState || !flowState.popupsSuspended) return;
  flowState.popupsSuspended = false;
  withDisplayQueue((displayQueue) => {
    try {
      const canResume = typeof displayQueue.resume === "function" && typeof displayQueue.isSuspended === "function";
      if (canResume && displayQueue.isSuspended()) {
        displayQueue.resume();
      }
    } catch (_) {
      // resume can throw if the queue state changed; non-fatal.
    }
  });
}

/** Pop the Demographics screen so the map is visible. */
function popScreen() {
  withContextManager((contextManager) => {
    try {
      if (typeof contextManager.pop === "function") contextManager.pop(SCREEN_TAG);
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
    // One-shot override honored (and cleared) by screen-demographics._restoreState,
    // which otherwise always opens on Global Statistics. Plain "activeView" is
    // ignored on restore, so a dedicated pending key is needed to land on rankings.
    DemographicsSettings.setSetting("pendingReturnView", "rankings");
    DemographicsSettings.setSetting("settlementsSubTab", "showcase");
  } catch (_) {
    // setSetting can throw if storage is wiped; the panel still reopens on its last view.
  }
  withContextManager((contextManager) => {
    try {
      if (typeof contextManager.push === "function") {
        contextManager.push(SCREEN_TAG, { singleton: true, createMouseGuard: true });
      }
    } catch (_) {
      // push can throw mid-transition; ignore.
    }
  });
}

// Framing

/**
 * Resolve a smooth-camera frame for a settlement: prefer the engine plot-fit,
 * else fall back to the focus plot at a fixed zoom. Returns null when neither a
 * plot-fit nor a focus plot is available (caller then tries lookAtID).
 * @param {*} target
 * @returns {{focus: {x: number, y: number}, zoom: number, usedFallback: boolean}|null}
 */
function resolveCityFrame(target) {
  const fit = calcFocus(cityPurchasedIndices(target.componentId));
  if (fit) {
    return {
      focus: { x: fit.x, y: fit.y },
      zoom: clamp(fit.z, 0.3, 1.0),
      usedFallback: false
    };
  }
  const loc = target.location;
  if (loc && typeof loc.x === "number" && typeof loc.y === "number") {
    return { focus: { x: loc.x, y: loc.y }, zoom: 0.55, usedFallback: true };
  }
  return null;
}

// Overlay

/**
 * Update the "now showing" caption (wonder name + build year), shown while the
 * tour lingers on a wonder and cleared on city shots.
 * @param {*} caption The {nameKey, year} caption, or null to clear.
 */
function updateNowShowing(caption) {
  if (!state) return;
  if (state.caption) state.caption.textContent = captionText(caption);
  if (state.flavor) state.flavor.textContent = flavorText(caption);
}

/**
 * Replay the cinematic for the same city in place (the map-click affordance).
 * Reuses the saved camera/FoV/layers/world-input baseline; only the tour and
 * its overlay restart, with no screen flicker. Exit is via the Back button / ESC.
 */
function replayCinematic() {
  if (!state) return;
  const flow = state;
  clearTimers(flow);
  removeFireworks(flow);
  popShotCamera(flow);
  unbindInterrupts(flow);
  removeOverlay(flow);
  flow.token = ++tokenCounter;
  flow.phase = "preparing";
  flow.pushedCamera = false;
  mountCurrentOverlay(flow.target, flow.mode);
  bindInterrupts(flow.token);
  safePlaySound("data-audio-activate");
  runFlyby(flow.target, null, flow.token);
}

// World input and interrupts

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

function enableWorldInput() {
  try {
    window.dispatchEvent(new CustomEvent("ui-enable-world-input"));
  } catch (_) {
    // ignore
  }
}

/** @param {string} name */
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

function showCityBanners() {
  fireWindowEvent("ui-show-city-banners");
}

function hideUnitFlags() {
  fireWindowEvent("ui-hide-unit-flags");
}

function showUnitFlags() {
  fireWindowEvent("ui-show-unit-flags");
}

/**
 * Bind interrupt sources for the active flow: ESC (immediate) and the engine's
 * interface-mode change (armed after a delay, so our own screen-pop doesn't
 * self-trigger). The Back button and relaunch are wired elsewhere.
 * @param {number} token
 */
function bindInterrupts(token) {
  const flow = state;
  flow.onKey = (/** @type {*} */ e) => {
    if (isEscape(e)) teardownActiveCinematic("escape");
  };
  flow.onMode = () => {
    try {
      if (flow.armed && isToken(token)) teardownActiveCinematic("interrupt");
    } catch (e) {
      // An engine event handler must never throw into the engine's dispatch; log and carry on.
      log.debug("onMode threw:", /** @type {*} */ (e)?.message);
    }
  };
  // Engine world-input: a map click replays the cinematic; cancel/ESC exits.
  // World selection is already disabled, so this never selects a city.
  flow.onInput = (/** @type {*} */ e) => handleCinematicInput(flow, token, e);
  try {
    window.addEventListener("keydown", flow.onKey, true);
    window.addEventListener("engine-input", flow.onInput, true);
  } catch (_) {
    // addEventListener can be absent in headless hosts; Back still works.
  }
  try {
    if (typeof engine !== "undefined" && typeof engine.on === "function") {
      engine.on("InterfaceModeChanged", flow.onMode);
    }
  } catch (_) {
    // engine.on may be unavailable; the interface-mode interrupt is best-effort.
  }
  setTimeout(() => {
    if (isToken(token)) flow.armed = true;
  }, ARM_DELAY_MS);
}

/**
 * @param {*} flow
 * @param {number} token
 * @param {*} e
 */
function handleCinematicInput(flow, token, e) {
  if (!flow.armed || !isToken(token)) return;
  const kind = classifyInput(e && e.detail);
  if (!kind) return;
  // A click on the overlay UI (Back button / card) just fired a DOM mousedown;
  // don't also treat it as a map click → replay. Let the button's handler run.
  if (ignoreUiReplay(flow, kind)) return;
  consumeEvent(e);
  if (inputDebounced(flow)) return; // a single physical click fires START + FINISH
  if (kind === "exit") teardownActiveCinematic("cancel");
  else replayCinematic();
}

/**
 * Whether replay input should be ignored because it likely came from overlay UI.
 * @param {*} flow
 * @param {string} kind
 */
function ignoreUiReplay(flow, kind) {
  if (kind !== "replay") return false;
  if (!flow.uiClickAt) return false;
  return nowMs() - flow.uiClickAt < 400;
}

/** @param {*} flow */
function unbindInterrupts(flow) {
  try {
    if (flow.onKey) window.removeEventListener("keydown", flow.onKey, true);
    if (flow.onInput) window.removeEventListener("engine-input", flow.onInput, true);
  } catch (_) {
    // ignore detach errors
  }
  try {
    if (flow.onMode && typeof engine !== "undefined" && typeof engine.off === "function") {
      engine.off("InterfaceModeChanged", flow.onMode);
    }
  } catch (_) {
    // ignore detach errors
  }
}

// Teardown (single, idempotent)

/** @param {*} flow */
function clearTimers(flow) {
  try {
    if (flow.watchdog) clearTimeout(flow.watchdog);
  } catch (_) {
    // clearTimeout rarely throws; ignore
  }
  flow.watchdog = null;
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
  const flow = state;
  state = null; // claim ownership so re-entrant calls and stale continuations no-op
  flow.phase = "restoring";
  log.debug("teardown:", reason);
  restoreFromCinematic(flow, reason);
}

/**
 * @param {*} flow
 * @param {string} reason
 */
function restoreFromCinematic(flow, reason) {
  clearTimers(flow);
  unbindInterrupts(flow);
  removeOverlay(flow);
  popShotCamera(flow);
  removeFireworks(flow);
  restoreClutterLayers(flow.hiddenLayers);
  if (flow.fovTouched) setFoV(flow.savedFoV);
  enableWorldInput();
  showCityBanners();
  showUnitFlags();
  resumePopups(flow);
  if (!safeRestoreCamera(flow.didSaveZoom)) {
    emergencyKeyframe();
  }
  // "interrupt" means the interface mode changed under us (End Turn, a diplomacy screen, a unit
  // selected); pushing the screen back on top would fight that action, so only the camera is
  // restored. Every other reason reopens the screen.
  if (reason !== "interrupt") reopenScreen();
}

/**
 * Whether a camera flow is currently active.
 * @returns {boolean} True while a flow is live (not torn down).
 */
export function isCinematicActive() {
  return !!state && state.phase !== "restoring";
}

// Animation

/**
 * @param {{focus: {x: number, y: number}, zoom: number}} frame
 * @param {number} token
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
 * @param {*} target
 * @param {{focus: {x: number, y: number}, zoom: number}|null} frame
 * @param {number} token
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
 * @param {*} target
 * @param {string} mode
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

// Launch

/**
 * Begin a flow: validate, capture the camera, pop the screen, mount the overlay,
 * and bind interrupts. Returns the resolved frame, or null when the target has
 * no usable location (caller handles the lookAtID fallback / abort).
 * @param {*} target
 * @param {string} mode The flow mode ("instant" | "cinematic" | "flyby").
 * @returns {{focus: {x: number, y: number}, zoom: number}|null|undefined}
 *   The frame for animated modes, null to signal "no frame", or undefined when
 *   the launch was rejected outright.
 */
function beginFlow(target, mode) {
  if (blockedTarget(target)) return undefined; // unmet/masked gate (button is also disabled)
  if (isCinematicActive()) teardownActiveCinematic("relaunch");
  const token = ++tokenCounter;
  state = {
    token,
    target,
    phase: "preparing",
    mode,
    didSaveZoom: false,
    armed: false,
    overlay: null,
    watchdog: null
  };
  saveCamera();
  state.savedFoV = readFoV();
  state.hiddenLayers = hideClutterLayers();
  disableWorldInput();
  hideCityBanners();
  hideUnitFlags();
  suspendPopups(state);
  target.districts = resolveSpecialDistricts(target);
  popScreen();
  mountCurrentOverlay(target, mode);
  bindInterrupts(token);
  safePlaySound("data-audio-activate");
  return mode === "instant" ? undefined : resolveCityFrame(target);
}

/**
 * "View on map": close the Demographics screen and fly the camera to the city,
 * leaving the player on the map with full control. No overlay, no return
 * window, no camera save/restore (the player just stays where they were flown).
 * @param {*} target
 * @returns {boolean} True when launched.
 */
export function startInstant(target) {
  if (!cameraReady()) {
    log.debug("camera contract unsatisfied; skipping View-on-map");
    return false;
  }
  if (blockedTarget(target) || !target.location) return false;
  if (isCinematicActive()) teardownActiveCinematic("relaunch");
  popScreen();
  lookAtInstant(target.location);
  safePlaySound("data-audio-activate");
  return true;
}

/**
 * Cinematic: animate a smooth single-shot approach. Falls back to lookAtID, then
 * to instant, when no keyframe frame can be resolved.
 * @param {*} target
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
 * Flyby: run the cinematic grand tour. `animateFlyby` runs the push-camera
 * tour when available and otherwise degrades (single approach → lookAtID →
 * instant → abort) on its own.
 * @param {*} target
 * @returns {boolean} True when launched.
 */
export function startFlyby(target) {
  const frame = beginFlow(target, "flyby");
  if (!state) return false;
  runFlyby(target, frame || null, state.token);
  return true;
}

/** @param {{x: number, y: number}} loc */
function lookAtInstantReturn(loc) {
  lookAtInstant(loc);
  return true;
}

/**
 * The dedicated "Cinematic" action: run the grand flyby tour (default), or the
 * simpler pseudo-cinematic single approach when the flyby is disabled. This is
 * the second button next to "View on map"; both default on.
 * @param {*} target
 * @returns {boolean} True when a flow launched.
 */
export function launchCinematic(target) {
  if (!cameraReady()) {
    log.debug("camera contract unsatisfied; skipping Cinematic");
    return false;
  }
  if (blockedTarget(target)) return false;
  if (cfg("topCities.flybyEnabled", true) === true) return startFlyby(target);
  return startPseudoCinematic(target);
}
