// history-log.js
//
// Logging and defensive-call helpers shared by every module. console.warn / console.error reach
// Logs/UI.log; console.log does not. DBG stays false in shipped code.

const DBG = false;
const TAG = "[Demographics.history]";

/**
 * @param {...*} a
 */
export function dlog(...a) {
  if (DBG) console.warn(TAG, ...a);
}

/**
 * @param {...*} a
 */
export function derr(...a) {
  console.error(TAG, ...a);
}

/**
 * Run an engine touch and return its value, or the fallback when it throws or returns undefined.
 * @template T
 * @param {() => T} fn
 * @param {T} fallback
 * @returns {T}
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
