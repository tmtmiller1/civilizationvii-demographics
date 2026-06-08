// city-camera-controller-utils.js
//
// Generic helpers for the Top Cities camera controller.

import { featureAvailable } from "/demographics/ui/core/demographics-contracts.js";
import { DemographicsSettings } from "/demographics/ui/core/demographics-settings.js";

/**
 * Clamp a number into [lo, hi]; returns `lo` for a non-finite input.
 * @param {number} v The value.
 * @param {number} lo Lower bound.
 * @param {number} hi Upper bound.
 * @returns {number} The clamped value.
 */
export function clamp(v, lo, hi) {
  if (typeof v !== "number" || !isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Read a topCities.* setting with a call-site default (the authoritative default).
 * @param {string} key The setting key.
 * @param {*} dflt The fallback.
 * @returns {*} The stored value or the default.
 */
export function cfg(key, dflt) {
  try {
    return DemographicsSettings.getSetting(key, dflt);
  } catch (_) {
    return dflt;
  }
}

/**
 * Promise that resolves after `ms`.
 * @param {number} ms Delay in milliseconds.
 * @returns {Promise<void>} The delay promise.
 */
export function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Whether a target is off-limits to the camera.
 * @param {*} target The settlement record.
 * @returns {boolean} True when the camera must not engage.
 */
export function blockedTarget(target) {
  return !target || target.masked || !!(target.owner && target.owner.met === false);
}

/**
 * Whether the camera contract is satisfied.
 * @returns {boolean} True when camera flows are safe to run.
 */
export function cameraReady() {
  try {
    return featureAvailable("camera");
  } catch (_) {
    return true;
  }
}

/**
 * Resolve a camera enum member (InterpolationFunc / KeyframeFlag), or undefined.
 * @param {string} ns The enum global name.
 * @param {string} member The member name.
 * @returns {*} The enum value, or undefined.
 */
export function enumVal(ns, member) {
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
 * Milliseconds since epoch, guarded for hosts without Date.
 * @returns {number} Milliseconds, or 0 when unavailable.
 */
export function nowMs() {
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
export function isEscape(e) {
  return !!e && (e.key === "Escape" || e.keyCode === 27);
}

/**
 * Classify an engine-input event.
 * @param {*} d The engine-input detail.
 * @returns {string} "exit" | "replay" | "".
 */
export function classifyInput(d) {
  if (!d || !d.name) return "";
  if (d.name === "cancel" || d.name === "keyboard-escape" || d.name === "mousebutton-right") return "exit";
  if (d.name === "mousebutton-left" || d.name === "touch-tap" || d.name === "accept") return "replay";
  return "";
}

/**
 * Consume an engine-input event so nothing else reacts.
 * @param {*} e The event.
 */
export function consumeEvent(e) {
  try {
    e.preventDefault();
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
  } catch (_) {
    // ignore.
  }
}

/**
 * Whether this input should be debounced.
 * @param {*} s The flow state.
 * @returns {boolean} True to ignore (debounced).
 */
export function inputDebounced(s) {
  const now = nowMs();
  if (s.lastInputAt && now - s.lastInputAt < 500) return true;
  s.lastInputAt = now;
  return false;
}