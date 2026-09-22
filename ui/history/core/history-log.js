// history-log.js
//
// Logging and defensive-call helpers shared by every module. console.warn / console.error reach
// Logs/UI.log; console.log does not. DBG stays false in shipped code.

const DBG = false;
const TAG = "[Demographics.history]";

/**
 * Debug logger, a no-op unless DBG is set.
 * @param {...*} a Values to log.
 */
export function dlog(...a) {
  if (DBG) console.warn(TAG, ...a);
}

/**
 * Error logger; always emits.
 * @param {...*} a Values to log.
 */
export function derr(...a) {
  console.error(TAG, ...a);
}

/**
 * Run an engine touch and return its value, or the fallback when it throws.
 * @template T
 * @param {() => T} fn The call.
 * @param {T} fallback Returned when the call throws or returns undefined.
 * @returns {T} The call's value or the fallback.
 */
export function safe(fn, fallback) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (_) {
    // Engine calls throw on stale handles and mid age-transition; the fallback covers it.
    return fallback;
  }
}
