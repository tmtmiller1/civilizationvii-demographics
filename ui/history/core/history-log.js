// history-log.js
//
// The history modules' logger and defensive-call helper.

import { makeLogger } from "/demographics/ui/core/demographics-log.js";

export const log = makeLogger("history");

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
