// demographics-log.js
//
// The mod's console loggers. Every line starts with `[Demographics.<area>]` so UI.log can be filtered by
// area. console.warn and console.error reach Logs/UI.log; console.log does not, so debug output goes
// through console.warn.
//
// DBG is the one switch for debug output across the mod. release.sh rewrites a leading
// `const DBG = true;` to false in the shipped copy, so a build packaged with it left on still ships quiet.

const DBG = false;

/**
 * @typedef {Object} Logger
 * @property {(...a: any[]) => void} debug Writes with console.warn, only while debug logging is on.
 * @property {(...a: any[]) => void} error Always writes, with console.error.
 */

/**
 * Whether the mod-wide debug switch is on.
 * @returns {boolean}
 */
export function debugLoggingOn() {
  return DBG;
}

/**
 * Loggers for one area of the mod.
 * @param {string} area Appears in the line prefix, e.g. "storage" gives `[Demographics.storage]`.
 * @param {() => boolean} [isDebugOn] Replaces the mod-wide switch; the sampler passes its runtime toggle.
 * @returns {Logger}
 */
export function makeLogger(area, isDebugOn = debugLoggingOn) {
  const tag = "[Demographics." + area + "]";
  return {
    debug(...a) {
      if (isDebugOn()) console.warn(tag, ...a);
    },
    error(...a) {
      console.error(tag, ...a);
    }
  };
}
