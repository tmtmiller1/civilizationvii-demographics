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

import { t } from "/demographics/ui/demographics-i18n.js";
import { safePlaySound } from "/demographics/ui/demographics-audio.js";
import { DemographicsSettings } from "/demographics/ui/demographics-settings.js";

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

// ── Small DOM helpers (kept local; the controller owns its overlay) ───────────

/**
 * Create a div with a class and optional text.
 * @param {string} cls The class name(s).
 * @param {string} [text] Optional text content.
 * @returns {HTMLElement} The element.
 */
function div(cls, text) {
  const el = document.createElement("div");
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

/**
 * Build a BLP background-image icon chip.
 * @param {string} iconPath The blp: icon path.
 * @param {string} cls The class name.
 * @returns {HTMLElement} The icon element.
 */
function iconEl(iconPath, cls) {
  const ic = div(cls);
  ic.style.backgroundImage = "url('" + iconPath + "')";
  return ic;
}

/**
 * Format a (large, scaled) population estimate compactly (B/M/K).
 * @param {number} v The value.
 * @returns {string} The display string.
 */
function fmtPop(v) {
  if (typeof v !== "number" || !isFinite(v) || v <= 0) return "—";
  if (v >= 1e9) return (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(0) + "K";
  return String(Math.round(v));
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

// The gold/silver/bronze laurel crests for the top-3 ranks — the same icons the
// Top 25 Settlements board uses, so the cinematic popup matches it.
/** @type {Record<number, string>} */
const OVERLAY_LAUREL = {
  1: "blp:popup_gold_laurels",
  2: "blp:popup_silver_laurels",
  3: "blp:popup_bronze_laurels"
};

/**
 * Build a laurel medal crest (place number inside the wreath) for a top-3 rank,
 * reusing the rankings board's medal classes for an identical look.
 * @param {number} place The 1-based rank (1/2/3).
 * @returns {HTMLElement} The medal element.
 */
function buildOverlayMedal(place) {
  const medal = div("demographics-settle-medal demographics-settle-medal-" + place + " demographics-map-overlay-medal");
  medal.style.backgroundImage = "url('" + OVERLAY_LAUREL[place] + "')";
  medal.appendChild(div("demographics-settle-medal-num", String(place)));
  return medal;
}

/**
 * Build the overlay's identity header (rank crest/number + name + owner).
 * @param {*} s The settlement record.
 * @returns {HTMLElement} The header element.
 */
function buildOverlayHeader(s) {
  const head = div("demographics-map-overlay-head");
  const rank = s.ranks ? s.ranks.composite : 0;
  if (rank >= 1 && rank <= 3) head.appendChild(buildOverlayMedal(rank));
  else head.appendChild(div("demographics-map-overlay-rank", "#" + (rank || "—")));
  const text = div("demographics-map-overlay-text");
  text.appendChild(div("demographics-map-overlay-name", s.name || "—"));
  const owner = s.owner ? s.owner.leaderName || s.owner.civName || "" : "";
  if (owner) text.appendChild(div("demographics-map-overlay-owner", owner));
  head.appendChild(text);
  return head;
}

/**
 * Build the overlay's meta line (population estimate + wonder icons).
 * @param {*} s The settlement record.
 * @returns {HTMLElement} The meta element.
 */
function buildOverlayMeta(s) {
  const meta = div("demographics-map-overlay-meta");
  const pop = div("demographics-map-overlay-pop");
  pop.appendChild(iconEl("blp:Yield_Population", "demographics-settle-yield-icon"));
  pop.appendChild(div("demographics-map-overlay-pop-val", fmtPop(s.populationEstimate)));
  meta.appendChild(pop);
  const wonders = Array.isArray(s.wonders) ? s.wonders : [];
  if (wonders.length) {
    const row = div("demographics-settle-wonders");
    for (const w of wonders) {
      if (!w || !w.icon) continue;
      const ic = iconEl(w.icon, "demographics-settle-wonder-icon");
      if (w.nameKey) ic.setAttribute("data-tooltip-content", w.nameKey);
      row.appendChild(ic);
    }
    if (row.firstChild) meta.appendChild(row);
  }
  return meta;
}

/**
 * Build the transient flyby progress badge ("Flyby" + shot counter). Stored on
 * state so the running sequence can update the counter.
 * @returns {HTMLElement} The progress element.
 */
function buildFlybyProgress() {
  const wrap = div("demographics-map-overlay-flyby");
  wrap.appendChild(div("demographics-map-overlay-flyby-label", t("LOC_DEMOGRAPHICS_SETTLEMENTS_FLYBY_LABEL")));
  const dots = div("demographics-map-overlay-flyby-dots", "");
  wrap.appendChild(dots);
  if (state) state.dots = dots;
  return wrap;
}

/**
 * Update the flyby shot counter ("1/2", "2/2", …).
 * @param {number} i Current shot (1-based).
 * @param {number} n Total shots.
 */
function updateFlybyProgress(i, n) {
  if (state && state.dots) state.dots.textContent = i + "/" + n;
}

/**
 * The on-screen caption text for a wonder shot: its name + "Built {year}".
 * @param {*} caption The {nameKey, year} caption.
 * @returns {string} The caption text.
 */
function captionText(caption) {
  if (!caption) return "";
  if (caption.text) return caption.text;
  if (caption.textKey) return t(caption.textKey);
  if (!caption.nameKey) return "";
  const name = t(caption.nameKey);
  return caption.year ? name + " · " + t("LOC_DEMOGRAPHICS_SETTLEMENTS_WONDER_BUILT", caption.year) : name;
}

/**
 * Update the "now showing" caption (wonder name + build year), shown while the
 * tour lingers on a wonder and cleared on city shots.
 * @param {*} caption The {nameKey, year} caption, or null to clear.
 */
function updateNowShowing(caption) {
  if (!state || !state.caption) return;
  state.caption.textContent = captionText(caption);
}

// English ordinal words for the "Recognized as the {ordinal} greatest settlement" lead
// (rank 1 reads "the single greatest …"). Other locales use the numeral instead.
const ORDINAL_WORDS = [
  "", "single", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth",
  "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth",
  "eighteenth", "nineteenth", "twentieth", "twenty-first", "twenty-second", "twenty-third",
  "twenty-fourth", "twenty-fifth"
];

/**
 * An English ordinal word for a rank ("single"/"second"/…), or "#N" past the list.
 * @param {number} n The rank.
 * @returns {string} The ordinal word.
 */
function ordinalWord(n) {
  return n >= 1 && n < ORDINAL_WORDS.length ? ORDINAL_WORDS[n] : "#" + n;
}

/**
 * The display names of a settlement's headline features: its wonders, then its
 * special districts (unique quarters).
 * @param {*} s The settlement record.
 * @returns {string[]} The names.
 */
function highlightNames(s) {
  const out = [];
  for (const w of Array.isArray(s.wonders) ? s.wonders : []) if (w && w.nameKey) out.push(t(w.nameKey));
  // Special districts (unique quarters) are common nouns — there can be more than
  // one of a kind — so give them an article ("the Acropolis", not "Acropolis").
  for (const d of Array.isArray(s.districts) ? s.districts : []) if (d && d.name) out.push(districtPhrase(d));
  return out;
}

// The definite-article prefix (with trailing space, or apostrophe for elision)
// for each of the game's 15 Unique Quarters, per locale — evaluated individually
// from the base game's authoritative gender / number / vowel metadata. Each
// district instance is singular, so singular articles are used (Five Hundred
// Lords is the one plural). Locales WITHOUT articles (ru, ja, ko, zh) are omitted
// — their bare quarter name is already correct. German uses the accusative
// (object of "houses": den/die/das); Italian mirrors the game's own shipped
// definite forms (l'Acropoli, il Foro, …).
/** @type {Record<string, Record<string, string>>} */
const QUARTER_ARTICLE = {
  en: {
    QUARTER_ACROPOLIS: "the ", QUARTER_FORUM: "the ", QUARTER_MATHA: "the ", QUARTER_NECROPOLIS: "the ",
    QUARTER_UWAYBIL_KUH: "the ", QUARTER_INDUSTRIAL_PARK: "the ", QUARTER_AVENUE: "the ", QUARTER_ZAIBATSU: "the ",
    QUARTER_ZOCALO: "the ", QUARTER_HUIGUAN: "the ", QUARTER_DONJON: "the ", QUARTER_ULEMA: "the ",
    QUARTER_PLAZA: "the ", QUARTER_PURA: "the ", QUARTER_FIVE_HUNDRED_LORDS: "the "
  },
  de: {
    QUARTER_ACROPOLIS: "die ", QUARTER_FORUM: "das ", QUARTER_MATHA: "die ", QUARTER_NECROPOLIS: "die ",
    QUARTER_UWAYBIL_KUH: "den ", QUARTER_INDUSTRIAL_PARK: "das ", QUARTER_AVENUE: "die ", QUARTER_ZAIBATSU: "den ",
    QUARTER_ZOCALO: "den ", QUARTER_HUIGUAN: "die ", QUARTER_DONJON: "den ", QUARTER_ULEMA: "den ",
    QUARTER_PLAZA: "den ", QUARTER_PURA: "die ", QUARTER_FIVE_HUNDRED_LORDS: "die "
  },
  es: {
    QUARTER_ACROPOLIS: "la ", QUARTER_FORUM: "el ", QUARTER_MATHA: "el ", QUARTER_NECROPOLIS: "la ",
    QUARTER_UWAYBIL_KUH: "el ", QUARTER_INDUSTRIAL_PARK: "el ", QUARTER_AVENUE: "la ", QUARTER_ZAIBATSU: "el ",
    QUARTER_ZOCALO: "el ", QUARTER_HUIGUAN: "el ", QUARTER_DONJON: "la ", QUARTER_ULEMA: "el ",
    QUARTER_PLAZA: "la ", QUARTER_PURA: "el ", QUARTER_FIVE_HUNDRED_LORDS: "los "
  },
  fr: {
    QUARTER_ACROPOLIS: "l'", QUARTER_FORUM: "le ", QUARTER_MATHA: "le ", QUARTER_NECROPOLIS: "la ",
    QUARTER_UWAYBIL_KUH: "l'", QUARTER_INDUSTRIAL_PARK: "le ", QUARTER_AVENUE: "l'", QUARTER_ZAIBATSU: "le ",
    QUARTER_ZOCALO: "le ", QUARTER_HUIGUAN: "le ", QUARTER_DONJON: "le ", QUARTER_ULEMA: "l'",
    QUARTER_PLAZA: "la ", QUARTER_PURA: "le ", QUARTER_FIVE_HUNDRED_LORDS: "les "
  },
  it: {
    QUARTER_ACROPOLIS: "l'", QUARTER_FORUM: "il ", QUARTER_MATHA: "il ", QUARTER_NECROPOLIS: "la ",
    QUARTER_UWAYBIL_KUH: "l'", QUARTER_INDUSTRIAL_PARK: "il ", QUARTER_AVENUE: "l'", QUARTER_ZAIBATSU: "la ",
    QUARTER_ZOCALO: "la ", QUARTER_HUIGUAN: "la ", QUARTER_DONJON: "il ", QUARTER_ULEMA: "l'",
    QUARTER_PLAZA: "la ", QUARTER_PURA: "la ", QUARTER_FIVE_HUNDRED_LORDS: "i "
  },
  pt: {
    QUARTER_ACROPOLIS: "a ", QUARTER_FORUM: "o ", QUARTER_MATHA: "o ", QUARTER_NECROPOLIS: "a ",
    QUARTER_UWAYBIL_KUH: "o ", QUARTER_INDUSTRIAL_PARK: "o ", QUARTER_AVENUE: "a ", QUARTER_ZAIBATSU: "o ",
    QUARTER_ZOCALO: "o ", QUARTER_HUIGUAN: "o ", QUARTER_DONJON: "o ", QUARTER_ULEMA: "o ",
    QUARTER_PLAZA: "a ", QUARTER_PURA: "o ", QUARTER_FIVE_HUNDRED_LORDS: "os "
  }
};

/**
 * The two-letter language code of the active locale (e.g. "en", "de", "zh").
 * @returns {string} The lowercase language code (defaults to "en").
 */
function localeCode() {
  try {
    const l = typeof Locale !== "undefined" && Locale.getCurrentLocale ? Locale.getCurrentLocale() : "en";
    return String(l || "en").slice(0, 2).toLowerCase();
  } catch (_) {
    return "en";
  }
}

/**
 * A special district's name with its correct article for the active locale
 * ("Acropolis" → "the Acropolis" / "l'Acropoli" / "die Akropolis"), chosen per
 * quarter type. Article-less locales (ru/ja/ko/zh) and names that already begin
 * with an article are returned unchanged.
 * @param {{name: string, quarterType?: string}} d The district record.
 * @returns {string} The articled name.
 */
function districtPhrase(d) {
  if (!d || !d.name) return "";
  const table = QUARTER_ARTICLE[localeCode()];
  if (!table) return d.name; // ru/ja/ko/zh — articles not used
  const qt = d.quarterType || "";
  if (Object.prototype.hasOwnProperty.call(table, qt)) return table[qt] + d.name;
  return d.name;
}

/**
 * Join names into a list ("A", "A and B", "A, B, and C").
 * @param {string[]} names The names.
 * @returns {string} The joined list.
 */
function joinNames(names) {
  const and = t("LOC_DEMOGRAPHICS_SETTLEMENTS_CONGRATS_AND");
  if (names.length <= 1) return names[0] || "";
  if (names.length === 2) return names[0] + " " + and + " " + names[1];
  return names.slice(0, -1).join(", ") + ", " + and + " " + names[names.length - 1];
}

/**
 * The flowing headline: "Recognized as the {ordinal} greatest settlement in the world,
 * {City} houses {wonders + districts}." (or without the "houses" clause when the
 * city has no notable wonders/districts).
 * @param {*} s The settlement record.
 * @returns {string} The sentence.
 */
function recognizedSentence(s) {
  const rank = s.ranks && typeof s.ranks.composite === "number" ? s.ranks.composite : 0;
  // English gets ordinal words ("fourth"); other locales the numeral.
  const ord = isEnglishLocale() ? ordinalWord(rank) : String(rank);
  // Built from SINGLE-param composes only (multi-param compose was returning
  // empty in this context), each with a hard JS fallback so the text always
  // renders even if the LOC lookup fails.
  const lead = composeOr(
    t("LOC_DEMOGRAPHICS_SETTLEMENTS_CONGRATS_PLAIN", ord),
    "Recognized as the " + ord + " greatest settlement in the world."
  );
  const names = highlightNames(s);
  if (!names.length) return lead;
  const list = joinNames(names);
  const housed = composeOr(
    t("LOC_DEMOGRAPHICS_SETTLEMENTS_CONGRATS_HOUSES_LIST", list),
    "It houses " + list + "."
  );
  return lead + " " + housed;
}

/**
 * Return a composed string if it resolved, else a plain-JS fallback (guards
 * against an empty / unresolved LOC tag).
 * @param {string} result The Locale.compose result.
 * @param {string} fallback The fallback text.
 * @returns {string} The text to display.
 */
function composeOr(result, fallback) {
  return result && result.indexOf("LOC_") !== 0 ? result : fallback;
}

/**
 * Whether the active locale is English (ordinal words vs. numerals).
 * @returns {boolean} True for English (default on failure).
 */
function isEnglishLocale() {
  try {
    const l = typeof Locale !== "undefined" && Locale.getCurrentLocale ? Locale.getCurrentLocale() : "en";
    return typeof l === "string" && l.toLowerCase().indexOf("en") === 0;
  } catch (_) {
    return true;
  }
}

/**
 * Build the congratulatory block: the flowing "Recognized as …, City houses …"
 * headline, plus the "Founded in {year}, and flourishing still" line.
 * @param {*} s The settlement record.
 * @returns {HTMLElement} The congratulations element.
 */
function buildCongrats(s) {
  const wrap = div("demographics-map-overlay-congrats");
  wrap.appendChild(div("demographics-map-overlay-acclaim", recognizedSentence(s)));
  if (s.founded && s.founded.year) {
    wrap.appendChild(div("demographics-map-overlay-congrats-line", t("LOC_DEMOGRAPHICS_SETTLEMENTS_CONGRATS_FOUNDED", s.founded.year)));
  }
  return wrap;
}

/**
 * Build the overlay card (identity + acclaim + meta + optional flyby badge + Back).
 * @param {*} s The settlement record.
 * @param {string} mode The flow mode.
 * @returns {HTMLElement} The card element.
 */
function buildOverlayCard(s, mode) {
  const card = div("demographics-map-overlay-card");
  const accent = s.owner && (s.owner.readable || s.owner.primary);
  if (accent) card.style.borderColor = accent;
  card.appendChild(buildOverlayHeader(s));
  card.appendChild(buildCongrats(s));
  card.appendChild(buildOverlayMeta(s));
  if (mode === "flyby") {
    card.appendChild(buildFlybyProgress());
    const caption = div("demographics-map-overlay-caption", "");
    if (state) state.caption = caption;
    card.appendChild(caption);
  }
  const back = div("demographics-map-overlay-back demographics-settle-clickable");
  back.textContent = t("LOC_DEMOGRAPHICS_SETTLEMENTS_BACK");
  back.addEventListener("click", () => {
    safePlaySound("data-audio-activate");
    teardownActiveCinematic("back");
  });
  card.appendChild(back);
  return card;
}

/**
 * Mount the slim overlay on document.body (it outlives the popped screen).
 * @param {*} s The settlement record.
 * @param {string} mode The flow mode.
 */
function mountOverlay(s, mode) {
  const overlay = div("demographics-map-overlay");
  overlay.appendChild(buildOverlayCard(s, mode));
  // Mark when the overlay (card / Back button) is clicked, so the engine-input
  // handler doesn't treat that same click as a "map click → replay" and hijack
  // the Back button.
  try {
    overlay.addEventListener("mousedown", () => {
      if (state) state.uiClickAt = nowMs();
    }, true);
  } catch (_) {
    // addEventListener may be absent in headless hosts.
  }
  document.body.appendChild(overlay);
  if (state) state.overlay = overlay;
}

/**
 * Remove the overlay from the document.
 * @param {*} s The flow state.
 */
function removeOverlay(s) {
  try {
    if (s.overlay && s.overlay.parentNode) s.overlay.parentNode.removeChild(s.overlay);
  } catch (_) {
    // node may already be detached; ignore.
  }
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
  mountOverlay(s.target, s.mode);
  bindInterrupts(s.token);
  safePlaySound("data-audio-activate");
  animateFlyby(s.target, null, s.token);
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
  if (s.fovTouched) setFoV(s.savedFoV || DEFAULT_FOV);
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
 * After `ms`, transition a still-current flow from animating → inspecting.
 * @param {number} ms Delay in milliseconds.
 * @param {number} token The flow token.
 */
function scheduleInspect(ms, token) {
  setTimeout(() => {
    if (isToken(token) && state.phase === "animating") {
      state.phase = "inspecting";
      clearTimers(state);
    }
  }, ms);
}

/**
 * Stage 4 — animate a single smooth approach keyframe, then settle to
 * inspecting.
 * @param {{focus: {x: number, y: number}, zoom: number}} frame The resolved frame.
 * @param {number} token The flow token.
 */
function animateSingle(frame, token) {
  state.phase = "animating";
  const durMs = clamp(cfg("topCities.cinematicDurationMs", 1200), 600, 2200);
  const tilt = clamp(cfg("topCities.cinematicTilt", 32), 24, 40);
  // Bias closer than the raw plot-fit (smaller = nearer) so it reads as a real
  // approach, not a distant pan (addresses "doesn't zoom enough").
  const zoom = clamp(Math.min(frame.zoom, 0.55), 0.3, 0.6);
  addKf({ duration: durMs / 1000, focus: frame.focus, zoom, tilt, end: true });
  scheduleInspect(durMs + 150, token);
}

// ── Stage 5: the cinematic "grand tour" (engine push-cameras + fireworks) ─────
// Uses the engine's own cinematic cameras (Camera.pushDynamicCamera /
// pushFlyoverCamera / popCamera — the same surface endgame-cinematics.js drives).
// pushDynamicCamera ORBITS a plot (real rotation + arc), pushFlyoverCamera sweeps
// in close. The tour pulls back + orbits, swoops in, optionally visits wonders,
// settles, and (for a top-3 city) adds a grand finale orbit with fireworks.

// Real firework VFX — the engine's wonder-celebration assets, fired via
// WorldUI.triggerVFXAtPlot (the technique the "sib-celebratory-celebrations"
// workshop mod uses). The earlier model-group / "Cinematic_*" assets were
// scene-bound and never rendered mid-game.
const FIREWORK_VFX = [
  "VFX_WON_Firework_01", "VFX_WON_Firework_02", "VFX_WON_Firework_03", "VFX_WON_Firework_04",
  "VFX_WON_Firework_05", "VFX_WON_Firework_06", "VFX_WON_Firework_07", "VFX_WON_Confetti"
];

// Telephoto / "extra zoom" via vertical field-of-view (Camera.setVerticalFoV).
// The cinematic restores this field-of-view on teardown.
const DEFAULT_FOV = 45;

/**
 * Set the camera vertical FoV (defensive; the API may be absent).
 * @param {number} fov The field of view in degrees.
 */
function setFoV(fov) {
  try {
    if (typeof Camera !== "undefined" && typeof Camera.setVerticalFoV === "function") {
      Camera.setVerticalFoV(fov);
    }
  } catch (_) {
    // setVerticalFoV may be unavailable; the shot just keeps the default lens.
  }
}

/**
 * Read the current vertical FoV (to restore on teardown), defaulting to 45°.
 * @returns {number} The current FoV.
 */
function readFoV() {
  try {
    const s = typeof Camera !== "undefined" && Camera.getState ? Camera.getState() : null;
    const f = s && (s.verticalFoV || s.fov);
    return typeof f === "number" && f > 0 ? f : DEFAULT_FOV;
  } catch (_) {
    return DEFAULT_FOV;
  }
}

/**
 * Whether the engine's cinematic push-cameras are available (for the grand tour).
 * @returns {boolean} True when push/pop dynamic+flyover cameras exist.
 */
function cameraSupportsTour() {
  return typeof Camera !== "undefined" &&
    typeof Camera.pushDynamicCamera === "function" &&
    typeof Camera.pushFlyoverCamera === "function" &&
    typeof Camera.popCamera === "function";
}

/**
 * Push an orbiting dynamic camera over a plot (rotation + arc).
 * @param {{x: number, y: number}} plot The plot.
 * @param {*} params The dynamic-camera params.
 */
function pushOrbit(plot, params) {
  try {
    Camera.pushDynamicCamera({ x: plot.x, y: plot.y }, params);
  } catch (_) {
    // pushDynamicCamera can throw mid-transition; the watchdog/teardown recovers.
  }
}

/**
 * Push a sweeping flyover camera toward a plot.
 * @param {{x: number, y: number}} plot The plot.
 * @param {*} params The flyover-camera params.
 */
function pushFlyover(plot, params) {
  try {
    Camera.pushFlyoverCamera({ x: plot.x, y: plot.y }, params);
  } catch (_) {
    // pushFlyoverCamera can throw mid-transition; the watchdog/teardown recovers.
  }
}

/**
 * Pop the currently-pushed shot camera on `holder`, if any.
 * @param {*} holder The flow state holding `pushedCamera`.
 */
function popShotCamera(holder) {
  try {
    if (holder && holder.pushedCamera && typeof Camera !== "undefined" && Camera.popCamera) {
      Camera.popCamera();
      holder.pushedCamera = false;
    }
  } catch (_) {
    // popCamera can throw if the stack is unexpected; restore still runs.
  }
}

// LensManager is a /core singleton (default export), NOT a global — so it must be
// imported. We load it once (cached) the same way the mod loads other engine
// /core modules (dynamic import avoids load-order issues); by the time a user
// clicks a city it's resolved. While null, layer-hiding is simply skipped.
/** @type {*} */
let lensMgr = null;
import("/core/ui/lenses/lens-manager.js")
  .then((m) => {
    const mod = /** @type {*} */ (m);
    lensMgr = (mod && (mod.default || mod.LensManager || mod)) || null;
  })
  .catch(() => {
    // lens-manager unavailable in this context; overlays just won't be hidden.
  });

// Map overlay layers (yields/resources/grid/borders/etc.) to hide so they don't
// clutter the cinematic. Restored to whatever was on before, on teardown.
const CLUTTER_LAYERS = [
  "fxs-yields-layer", "fxs-worker-yields-layer", "fxs-resource-layer", "fxs-hexgrid-layer",
  "fxs-city-borders-layer", "fxs-culture-borders-layer", "fxs-appeal-layer",
  "fxs-general-appeal-layer", "fxs-trade-layer", "fxs-continent-layer",
  "fxs-settlement-recommendations-layer", "fxs-discovery-layer", "fxs-random-events-layer"
];

/**
 * Read whether a layer is currently on (defensively).
 * @param {string} name The layer name.
 * @returns {boolean} True when enabled.
 */
function layerOn(name) {
  try {
    return typeof lensMgr.isLayerEnabled === "function" && !!lensMgr.isLayerEnabled(name);
  } catch (_) {
    return false;
  }
}

/**
 * Hide the clutter map layers (yields, resources, grid, borders, …) for a clean
 * shot. Records which were on (to restore), then disables them all regardless.
 * @returns {string[]} The layers that were enabled before hiding.
 */
function hideClutterLayers() {
  /** @type {string[]} */
  const hidden = [];
  if (!lensMgr || typeof lensMgr.disableLayer !== "function") return hidden;
  for (const name of CLUTTER_LAYERS) {
    if (layerOn(name)) hidden.push(name);
    try {
      lensMgr.disableLayer(name);
    } catch (_) {
      // a single unknown layer shouldn't abort the rest.
    }
  }
  return hidden;
}

/**
 * Re-enable the previously-hidden clutter layers.
 * @param {string[]} names The layers to restore.
 */
function restoreClutterLayers(names) {
  if (!lensMgr || typeof lensMgr.enableLayer !== "function") return;
  for (const name of names || []) {
    try {
      lensMgr.enableLayer(name);
    } catch (_) {
      // ignore a single failed restore.
    }
  }
}

/**
 * Wrap dynamic-camera base params with the shared orbit defaults + a rotation arc.
 * @param {*} base Role-specific params (heights/radius/duration/arcHeight).
 * @param {number} arc The orbit arc in degrees (bigger = sweeps further around).
 * @returns {*} The full dynamic-camera params.
 */
function orbitParams(base, arc) {
  return Object.assign({ easeInFactor: 2, easeOutFactor: 2, maxArcAngle: arc, leadInRange: 0 }, base);
}

/**
 * Wrap flyover base params with the shared flyover defaults.
 * @param {*} base Role-specific params (heights/duration/primaryAngle).
 * @returns {*} The full flyover-camera params.
 */
function flyoverParams(base) {
  return Object.assign({
    focusRange: 48, targetDistance: 120, endpointRange: 48, curvature: 0.5,
    panStrength: 0.35, maxMovement: 130, easeInFactor: 2.5, easeOutFactor: 2
  }, base);
}

/**
 * Build a shot descriptor.
 * @param {string} kind "orbit" | "flyover".
 * @param {{x: number, y: number}} plot The plot.
 * @param {*} params The camera params (with a `duration`).
 * @param {*} [caption] Optional {nameKey, year} shown on-screen during the shot.
 * @param {number|null} [fov] Optional telephoto FoV override for this shot.
 * @returns {{kind: string, plot: *, params: *, duration: number, caption: *, fov: number|null}} The shot.
 */
function shot(kind, plot, params, caption, fov) {
  return { kind, plot, params, duration: params.duration, caption: caption || null, fov: fov || null };
}

/**
 * Whether a settlement ranks in the top 3 overall.
 * @param {*} target The settlement record.
 * @returns {boolean} True for ranks 1–3.
 */
function isTop3(target) {
  const r = target.ranks && target.ranks.composite;
  return typeof r === "number" && r <= 3;
}

/**
 * A wide, slow establishing orbit centred on the city — the opening and closing
 * beats (city as the centre of attention). Only the WIDE shots orbit; we never
 * do a full rotation zoomed in.
 * @param {{x: number, y: number}} city The city plot.
 * @param {boolean} rotate Whether to widen the orbit arc.
 * @param {string} role "open" | "finale".
 * @returns {*} The shot.
 */
function establishShot(city, rotate, role) {
  const base = role === "finale"
    ? { focusHeight: 12, cameraHeight: 90, orbitRadius: 132, duration: 5.5, arcHeight: 10 }
    : { focusHeight: 10, cameraHeight: 100, orbitRadius: 152, duration: 5.5, arcHeight: 12 };
  const arc = rotate ? (role === "finale" ? 95 : 80) : 38;
  return shot("orbit", city, orbitParams(base, arc));
}

/**
 * A low, oblique flyover sweep toward a plot (movement + variety, not a centred
 * spin). `angle` varies the approach heading for a different look each time.
 * @param {{x: number, y: number}} plot The plot to sweep toward.
 * @param {number} angle The primary approach angle (degrees).
 * @param {number} dur The duration (seconds).
 * @param {*} [caption] Optional caption.
 * @returns {*} The shot.
 */
function obliqueShot(plot, angle, dur, caption) {
  return shot("flyover", plot, flyoverParams({ cameraHeight: 38, focusHeight: 7, duration: dur, primaryAngle: angle }), caption);
}

/**
 * A point-of-interest vignette: an oblique approach, then a gentle SMALL-ARC hold
 * (never a full close spin). The first POI gets the telephoto "extra zoom" beauty
 * shot. POIs are the city's amazing things — wonders, natural wonders, and its
 * richest district.
 * @param {{loc: {x: number, y: number}, cap: *}} poi The point of interest.
 * @param {number} idx The POI index.
 * @returns {Array<*>} The vignette shots.
 */
function poiVignette(poi, idx) {
  // Two beats per highlight: a slow oblique reveal, then a single graceful orbit
  // at a moderate distance. The old super-close pass (cameraHeight 36 / radius 48)
  // clipped buildings and glitched, so it's gone — heights stay well above
  // terrain, and there's no separate pull-back (keeps it to 1–2 shots per POI).
  const approach = obliqueShot(poi.loc, 150 + idx * 55, 3.0, poi.cap);
  const orbitP = orbitParams({ focusHeight: 8, cameraHeight: 64, orbitRadius: 92, duration: 4.5, arcHeight: 7 }, 60);
  const orbit = shot("orbit", poi.loc, orbitP, poi.cap);
  return [approach, orbit];
}

/**
 * Resolve a live city's purchased plots as { idx, x, y } (handles go stale, so
 * we re-resolve from the ComponentID each launch).
 * @param {*} componentId The city ComponentID.
 * @returns {Array<{idx: number, x: number, y: number}>} The plots.
 */
function livePurchased(componentId) {
  /** @type {Array<{idx: number, x: number, y: number}>} */
  const out = [];
  for (const idx of cityPurchasedIndices(componentId)) {
    const loc = indexToLoc(idx);
    if (loc) out.push({ idx, x: loc.x, y: loc.y });
  }
  return out;
}

/**
 * The raw purchased-plot indices of a live city (defensive).
 * @param {*} componentId The city ComponentID.
 * @returns {number[]} The plot indices.
 */
function cityPurchasedIndices(componentId) {
  try {
    const city = componentId && typeof Cities !== "undefined" && Cities.get ? Cities.get(componentId) : null;
    const plots = city && typeof city.getPurchasedPlots === "function" ? city.getPurchasedPlots() : null;
    return Array.isArray(plots) ? plots : [];
  } catch (_) {
    return [];
  }
}

/**
 * Convert a plot index to a {x, y} location (defensive).
 * @param {number} idx The plot index.
 * @returns {{x: number, y: number}|null} The location, or null.
 */
function indexToLoc(idx) {
  try {
    const loc = typeof GameplayMap !== "undefined" && GameplayMap.getLocationFromIndex
      ? GameplayMap.getLocationFromIndex(idx) : null;
    return loc && typeof loc.x === "number" ? loc : null;
  } catch (_) {
    return null;
  }
}

/**
 * Whether a plot holds a natural wonder.
 * @param {number} x Plot x.
 * @param {number} y Plot y.
 * @returns {boolean} True for a natural wonder.
 */
function isNatWonder(x, y) {
  try {
    return typeof GameplayMap !== "undefined" && typeof GameplayMap.isNaturalWonder === "function"
      && !!GameplayMap.isNaturalWonder(x, y);
  } catch (_) {
    return false;
  }
}

/**
 * Total yield on a plot for an owner (used to find the richest district/tile).
 * @param {number} idx The plot index.
 * @param {number} pid The owner id.
 * @returns {number} The summed yield.
 */
function plotYieldSum(idx, pid) {
  try {
    const ys = typeof GameplayMap !== "undefined" && GameplayMap.getYields ? GameplayMap.getYields(idx, pid) : null;
    if (!ys) return 0;
    let total = 0;
    for (const e of ys) {
      const a = Array.isArray(e) ? e[1] : e;
      if (typeof a === "number" && isFinite(a)) total += a;
    }
    return total;
  } catch (_) {
    return 0;
  }
}

/**
 * The single highest-yield plot among `plots` (the city's richest quarter).
 * @param {Array<{idx: number, x: number, y: number}>} plots The plots.
 * @param {number} pid The owner id.
 * @returns {{x: number, y: number}|null} The richest plot, or null.
 */
function topYieldPlot(plots, pid) {
  let best = null;
  let bestSum = 0;
  for (const p of plots) {
    const s = plotYieldSum(p.idx, pid);
    if (s > bestSum) {
      bestSum = s;
      best = p;
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}

/**
 * The city's "amazing things" to highlight, in headline order: its wonders
 * (named + dated), one natural wonder in its lands, and its richest district.
 * @param {*} target The settlement record.
 * @returns {Array<{loc: {x: number, y: number}, cap: *}>} The points of interest.
 */
function cityHighlights(target) {
  const pois = [];
  for (const w of visitableWonders(target)) pois.push({ loc: w.location, cap: { nameKey: w.nameKey, year: w.year } });
  for (const d of Array.isArray(target.districts) ? target.districts : []) {
    if (d && d.location) pois.push({ loc: d.location, cap: { text: d.name } });
  }
  const plots = livePurchased(target.componentId);
  for (const p of plots) {
    if (isNatWonder(p.x, p.y)) {
      pois.push({ loc: { x: p.x, y: p.y }, cap: { textKey: "LOC_DEMOGRAPHICS_SETTLEMENTS_POI_NATURAL" } });
      break;
    }
  }
  const rich = topYieldPlot(plots, target.owner && target.owner.pid);
  if (rich) pois.push({ loc: rich, cap: { textKey: "LOC_DEMOGRAPHICS_SETTLEMENTS_POI_DISTRICT" } });
  return pois;
}

/**
 * The district at a plot (defensive).
 * @param {{x: number, y: number}} p The plot.
 * @returns {*} The district, or null.
 */
function districtAtPlot(p) {
  try {
    return typeof Districts !== "undefined" && typeof Districts.getAtLocation === "function"
      ? Districts.getAtLocation({ x: p.x, y: p.y }) : null;
  } catch (_) {
    return null;
  }
}

/**
 * The localized name and type string of a unique-quarter type, or null.
 * @param {*} qType The unique-quarter type.
 * @returns {{name: string, type: string}|null} The name and type, or null.
 */
function uniqueQuarterInfo(qType) {
  try {
    const row = typeof GameInfo !== "undefined" && GameInfo.UniqueQuarters ? GameInfo.UniqueQuarters.lookup(qType) : null;
    if (row && row.Name && typeof Locale !== "undefined" && Locale.compose) {
      return { name: Locale.compose(row.Name), type: row.UniqueQuarterType };
    }
  } catch (_) {
    // lookup/compose can throw; treat as unnamed.
  }
  return null;
}

/**
 * The city's special districts (unique quarters) as { name, location, quarterType },
 * deduped.
 * @param {*} target The settlement record.
 * @returns {Array<{name: string, location: {x: number, y: number}, quarterType: string}>} The quarters.
 */
function resolveSpecialDistricts(target) {
  const out = [];
  /** @type {Record<string, boolean>} */
  const seen = {};
  for (const p of livePurchased(target.componentId)) {
    const d = districtAtPlot(p);
    const q = d ? d.uniqueQuarterType : null;
    if (q == null) continue;
    if (typeof UniqueQuarterTypes !== "undefined" && q === UniqueQuarterTypes.NO_QUARTER) continue;
    if (seen[String(q)]) continue;
    seen[String(q)] = true;
    const info = uniqueQuarterInfo(q);
    if (info && info.name) out.push({ name: info.name, location: { x: p.x, y: p.y }, quarterType: info.type });
  }
  return out;
}

/**
 * Valid wonder records (with a plot location) for a settlement.
 * @param {*} target The settlement record.
 * @returns {Array<*>} The wonder records that can be visited.
 */
function visitableWonders(target) {
  const out = [];
  for (const w of Array.isArray(target.wonders) ? target.wonders : []) {
    if (w && w.location && typeof w.location.x === "number") out.push(w);
  }
  return out;
}

/**
 * Build the directorial camera tour: OPEN on the city centre (wide establishing
 * orbit), sweep obliquely, (medium) visit up to two wonders with oblique
 * approaches + gentle holds (telephoto on the first), then RETURN and CLOSE on
 * the city centre. The city is the centre of attention at the start and end;
 * the middle is movement and wonders. No full rotations zoomed in.
 * @param {*} target The settlement record.
 * @returns {Array<*>} The shots.
 */
function buildTour(target) {
  const rotate = cfg("topCities.flybyAllowRotate", true) === true;
  const medium = cfg("topCities.flybyPreset", "short") === "medium";
  const city = target.location;
  const pois = cityHighlights(target);
  // Visit EVERY highlight — one section per wonder and special district (plus the
  // natural-wonder / richest-district extras). Capped at 10 only as a runaway
  // guard for pathological cities.
  const maxPois = Math.min(pois.length, 10);
  const shots = [establishShot(city, rotate, "open")];
  if (pois.length) {
    pois.slice(0, maxPois).forEach((poi, i) => {
      for (const s of poiVignette(poi, i)) shots.push(s);
    });
  } else {
    shots.push(obliqueShot(city, 210, 5.0));
  }
  if (medium && !pois.length) shots.push(obliqueShot(city, 330, 4.5)); // extra beat only when no POIs
  shots.push(establishShot(city, rotate, "finale"));
  return shots;
}

/**
 * Run the tour shot-by-shot: pop the prior shot camera, push the next, update the
 * on-screen caption, and wait its duration. Exits early once superseded.
 * @param {Array<*>} shots The shot list.
 * @param {number} token The flow token.
 * @returns {Promise<"done"|"aborted">} The outcome.
 */
async function runTour(shots, token) {
  for (let i = 0; i < shots.length; i++) {
    if (!isToken(token)) return "aborted";
    popShotCamera(state);
    // Only ever touch the FoV when a shot explicitly asks for one (none do by
    // default) — forcing it every shot caused black-frame glitches.
    if (shots[i].fov) {
      setFoV(shots[i].fov);
      state.fovTouched = true;
    }
    if (shots[i].kind === "orbit") pushOrbit(shots[i].plot, shots[i].params);
    else pushFlyover(shots[i].plot, shots[i].params);
    state.pushedCamera = true;
    updateFlybyProgress(i + 1, shots.length);
    updateNowShowing(shots[i].caption);
    await delay(Math.round(shots[i].duration * 1000));
  }
  return isToken(token) ? "done" : "aborted";
}

/**
 * Watchdog: force teardown if the tour is still animating past its total (+3s).
 * @param {Array<*>} shots The shot list.
 * @param {number} token The flow token.
 */
function startTourWatchdog(shots, token) {
  let total = 3000;
  for (const s of shots) total += Math.round((s.duration || 2) * 1000);
  state.watchdog = setTimeout(() => {
    if (isToken(token) && state.phase === "animating") teardownActiveCinematic("ERR_TIMEOUT");
  }, total);
}

/**
 * The plots to burst fireworks over: the city + its wonders (capped at 6).
 * @param {*} target The settlement record.
 * @returns {Array<{x: number, y: number}>} The firework plots.
 */
function fireworkPlots(target) {
  const plots = target.location ? [target.location] : [];
  for (const w of visitableWonders(target)) plots.push(w.location);
  return plots.slice(0, 6);
}

/**
 * Fire one random firework (transient, self-expiring) over a plot, with a small
 * random jitter + angle — exactly the sib-celebratory-celebrations technique.
 * @param {{x: number, y: number}} plot The plot to burst over.
 */
function fireOneFirework(plot) {
  try {
    if (typeof WorldUI === "undefined" || typeof WorldUI.triggerVFXAtPlot !== "function") return;
    const asset = FIREWORK_VFX[Math.floor(Math.random() * FIREWORK_VFX.length)];
    const offset = { x: (Math.random() - 0.5) * 1.2, y: (Math.random() - 0.5) * 1.2, z: 4 + Math.random() * 8 };
    WorldUI.triggerVFXAtPlot(asset, { x: plot.x, y: plot.y }, offset, { angle: Math.random() * 360, scale: 1 });
  } catch (_) {
    // a single failed burst shouldn't break the show.
  }
}

/**
 * Start celebratory fireworks (top-3): an immediate burst at every plot, then a
 * staggered stream of bursts across `durationMs`. Returns the timer ids so
 * teardown can cancel any pending bursts (the VFX themselves self-expire).
 * @param {Array<{x: number, y: number}>} plots The plots to burst over.
 * @param {number} durationMs How long to keep firing.
 * @returns {number[]} The pending burst timer ids.
 */
function startFireworks(plots, durationMs) {
  /** @type {number[]} */
  const timers = [];
  if (!plots.length) return timers;
  for (const p of plots) fireOneFirework(p);
  const count = Math.max(1, Math.floor(durationMs / 550));
  for (let i = 1; i <= count; i++) {
    timers.push(setTimeout(() => fireOneFirework(plots[i % plots.length]), i * 550));
  }
  return timers;
}

/**
 * Cancel any pending firework bursts on `holder` (active VFX self-expire).
 * @param {*} holder The flow state holding `fireworkTimers`.
 */
function removeFireworks(holder) {
  try {
    for (const tmr of (holder && holder.fireworkTimers) || []) clearTimeout(tmr);
  } catch (_) {
    // clearTimeout rarely throws; ignore.
  }
  if (holder) holder.fireworkTimers = [];
}

/**
 * Stage 5 — run the grand cinematic tour. Degrades to the single approach
 * (Stage 4), then lookAtID/instant, when the tour cameras aren't available.
 * @param {*} target The settlement record.
 * @param {{focus: {x: number, y: number}, zoom: number}|null} frame The keyframe-fallback frame.
 * @param {number} token The flow token.
 */
function animateFlyby(target, frame, token) {
  state.phase = "animating";
  if (cameraSupportsTour() && target.location) {
    const shots = buildTour(target);
    if (isTop3(target)) {
      let total = 0;
      for (const s of shots) total += Math.round((s.duration || 2) * 1000);
      state.fireworkTimers = startFireworks(fireworkPlots(target), total);
    }
    startTourWatchdog(shots, token);
    runTour(shots, token).then((outcome) => {
      if (outcome === "done" && isToken(token)) {
        state.phase = "inspecting";
        clearTimers(state);
      }
    });
    return;
  }
  if (frame) {
    animateSingle(frame, token);
    return;
  }
  if (lookAtComponent(target.componentId) || (target.location && lookAtInstantReturn(target.location))) {
    state.phase = "inspecting";
    return;
  }
  teardownActiveCinematic("ERR_NO_FRAME");
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
  mountOverlay(target, mode);
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
    animateSingle(frame, state.token);
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
  animateFlyby(target, frame || null, state.token);
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
