// sampler-shared.js
//
// Leaf utilities shared by the sampler and every per-civ collector: the debug
// flag and loggers, the defensive call wrapper, and the player-handle accessors.
//
// WHY THIS MODULE EXISTS. These helpers used to live in demographics-sampler.js.
// sampler-collectors-core.js imported them from there, while the sampler imported
// the collectors back — a mutual recursion the engine reported as "Circular import
// detected" on every boot, once per collector. Benign so far, but an import cycle
// that resolves today can become fatal when a new UIScript changes evaluation
// order, and when it does it takes the whole panel down with no useful error.
//
// This module imports NOTHING from the sampler, so it can never take part in a
// cycle. The kill switch stays in demographics-sampler.js (it owns the teardown
// and the error budget) and is installed here via setSamplerErrorHandler(), so
// safeCall's behaviour is unchanged.

let debugEnabled = false;

/**
 * Enable or disable verbose sampler logging.
 * @param {boolean} on Whether debug logging is on.
 * @returns {void}
 */
export function setSamplerDebug(on) {
  debugEnabled = !!on;
}

/**
 * Whether verbose sampler logging is enabled.
 * @returns {boolean} True when debug logging is on.
 */
export function isSamplerDebug() {
  return debugEnabled;
}

/**
 * Verbose debug logger; no-op unless sampler debug is enabled.
 * @param {...*} a Values to log.
 */
export function vlog(...a) {
  if (debugEnabled) console.warn("[Demographics.sampler]", ...a);
}

/**
 * Informational logger; no-op unless sampler debug is enabled.
 * @param {...*} a Values to log.
 */
export function ilog(...a) {
  if (debugEnabled) console.warn("[Demographics.sampler]", ...a);
}

/**
 * Error logger; always emits.
 * @param {...*} a Values to log.
 */
export function elog(...a) {
  console.error("[Demographics.sampler]", ...a);
}

/** @type {((label: string, e: *) => void) | null} */
let errorHandler = null;

/**
 * Install the sampler's error-budget handler (its kill switch). Called once by
 * demographics-sampler.js at module load. Until it is installed, a thrown
 * accessor is swallowed and logged but not counted — the same outcome the old
 * code produced for any throw before the sampler module finished evaluating.
 * @param {(label: string, e: *) => void} fn The handler.
 * @returns {void}
 */
export function setSamplerErrorHandler(fn) {
  errorHandler = typeof fn === "function" ? fn : null;
}

/**
 * Invoke `fn`, returning its result, or undefined if it throws (counting the
 * failure toward the kill switch). Never throws.
 * @template T
 * @param {string} label A label for logging/error attribution.
 * @param {() => T} fn Thunk to invoke.
 * @returns {T | undefined} The result of `fn`, or undefined on error.
 */
export function safeCall(label, fn) {
  try {
    if (debugEnabled) vlog("about to call", label);
    const v = fn();
    if (debugEnabled)
      vlog(label, "returned", typeof v, Array.isArray(v) ? "[len=" + v.length + "]" : "");
    return v;
  } catch (e) {
    if (errorHandler) errorHandler(label, e);
    else elog("error in", label, "(before kill switch installed):", e);
    return undefined;
  }
}

/**
 * Resolve the local player (or observer) id defensively.
 * @returns {number | undefined} The numeric id, or undefined if unavailable.
 */
export function getLocalPlayerID() {
  try {
    if (typeof GameContext !== "undefined" && GameContext != null) {
      const v = GameContext.localPlayerID;
      if (typeof v === "number") return v;
      const o = GameContext.localObserverID;
      if (typeof o === "number") return o;
    }
  } catch (e) {
    elog("getLocalPlayerID threw:", e);
  }
  return undefined;
}

/**
 * Get a player library handle defensively.
 * @param {Pid} id The player id.
 * @returns {*} The player handle, or undefined.
 */
export function getPlayer(id) {
  return safeCall("Players.get(" + id + ")", () => {
    if (typeof Players === "undefined" || typeof Players.get !== "function") return undefined;
    return Players.get(id);
  });
}

/**
 * Coerce to a finite number, or undefined.
 * @param {*} v Candidate value.
 * @returns {number | undefined} `v` if it is a finite number, else undefined.
 */
export function safeNum(v) {
  return typeof v === "number" && isFinite(v) ? v : undefined;
}

// ---- collector utilities -------------------------------------------------
//
// Moved here from sampler-collectors-core.js: the collectors needed them, and
// core imports the collectors, so leaving them there kept core and every
// collector mutually recursive.

/** Collector debug flag, independent of the sampler's verbose flag. */
const COLLECTOR_DBG = false;

/**
 * Collector debug logger, no-op unless {@link COLLECTOR_DBG} is set.
 * @param {...*} a Values to log.
 */
export function dlog(...a) {
  if (COLLECTOR_DBG) console.warn("[Demographics.sampler]", ...a);
}

/**
 * Resolve a `YieldTypes` enum member defensively.
 * @param {string} key The yield key (e.g. `"YIELD_GOLD"`).
 * @returns {number|string|undefined} The enum value, or undefined if unavailable.
 */
export function yieldEnum(key) {
  try {
    if (typeof YieldTypes !== "undefined" && YieldTypes != null) {
      const v = YieldTypes[key];
      if (typeof v === "number" || typeof v === "string") return v;
    }
  } catch (_e) {
    // YieldTypes[key] access can throw if the enum global is absent; treat the
    // yield as unavailable.
  }
  return undefined;
}

/**
 * Read a player's net yield for `key`, defensively.
 * @param {*} stats The player Stats handle.
 * @param {string} key The yield key.
 * @param {Pid} pid The player id (for error attribution).
 * @returns {number|undefined} The net yield, or undefined.
 */
export function netYield(stats, key, pid) {
  if (!stats || typeof stats.getNetYield !== "function") return undefined;
  const yt = yieldEnum(key);
  if (yt === undefined) return undefined;
  return safeCall("stats.getNetYield(" + key + ") (pid=" + pid + ")", () => {
    const v = stats.getNetYield(yt);
    return safeNum(v);
  });
}

/**
 * Read a finite numeric property off an engine handle, defensively.
 * @param {*} obj The handle.
 * @param {string} prop The property name.
 * @returns {number|undefined} The finite number, or undefined.
 */
export function _readFiniteProp(obj, prop) {
  try {
    const v = obj[prop];
    if (typeof v === "number" && isFinite(v)) return v;
  } catch (_e) {
    // Reading obj[prop] off an engine Stats handle can throw.
  }
  return undefined;
}
