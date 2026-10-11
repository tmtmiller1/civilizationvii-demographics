// sampler-shared.js
//
// Leaf utilities shared by the sampler and every per-civ collector: the runtime debug
// flag and loggers, the defensive call wrapper, and the player-handle accessors.
// This module imports nothing from the sampler, so it can never take part in an
// import cycle (which can turn fatal when a UIScript changes evaluation order).
// The kill switch stays in demographics-sampler.js and is installed here via
// setSamplerErrorHandler().

import { makeLogger } from "/demographics/ui/core/demographics-log.js";
import { safeNum } from "/demographics/ui/metrics/demographics-metrics-helpers.js";

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

/** The sampler's logger. Its debug output follows the runtime switch above, not the mod-wide one. */
export const log = makeLogger("sampler", isSamplerDebug);

/** The collectors' logger. Its debug output follows the mod-wide switch, independent of the sampler's. */
export const collectorLog = makeLogger("sampler");

/** @type {((label: string, e: *) => void) | null} */
let errorHandler = null;

/**
 * Install the sampler's error-budget handler (its kill switch). Called once by
 * demographics-sampler.js at module load; until then a thrown accessor is
 * swallowed and logged but not counted.
 * @param {(label: string, e: *) => void} fn
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
 * @param {() => T} fn
 * @returns {T | undefined} The result of `fn`, or undefined on error.
 */
export function safeCall(label, fn) {
  try {
    if (debugEnabled) log.debug("about to call", label);
    const v = fn();
    if (debugEnabled)
      log.debug(label, "returned", typeof v, Array.isArray(v) ? "[len=" + v.length + "]" : "");
    return v;
  } catch (e) {
    if (errorHandler) errorHandler(label, e);
    else log.error("error in", label, "(before kill switch installed):", e);
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
    log.error("getLocalPlayerID threw:", e);
  }
  return undefined;
}

/**
 * Get a player library handle defensively.
 * @param {Pid} id
 * @returns {*} The player handle, or undefined.
 */
export function getPlayer(id) {
  return safeCall("Players.get(" + id + ")", () => {
    if (typeof Players === "undefined" || typeof Players.get !== "function") return undefined;
    return Players.get(id);
  });
}

// The collectors import safeNum from here with the other sampler helpers.
export { safeNum };

// collector utilities

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
 * @param {string} key
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
 * @param {string} prop
 * @returns {number|undefined} The finite number, or undefined.
 */
export function readFiniteProp(obj, prop) {
  try {
    const v = obj[prop];
    if (typeof v === "number" && isFinite(v)) return v;
  } catch (_e) {
    // Reading obj[prop] off an engine Stats handle can throw.
  }
  return undefined;
}
