// city-camera-controller-utils.js
//
// Generic helpers for the Top Cities camera controller.

import { featureAvailable } from "/demographics/ui/core/demographics-contracts.js";
import { DemographicsSettings } from "/demographics/ui/core/demographics-settings.js";

/**
 * Clamp a number into [lo, hi]; returns `lo` for a non-finite input.
 * @param {number} value
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
export function clamp(value, lo, hi) {
  if (typeof value !== "number" || !isFinite(value)) return lo;
  return Math.max(lo, Math.min(hi, value));
}

/**
 * Read a topCities.* setting with a call-site default (the authoritative default).
 * @param {string} key
 * @param {*} fallback
 * @returns {*} The stored value or the default.
 */
export function cfg(key, fallback) {
  try {
    return DemographicsSettings.getSetting(key, fallback);
  } catch (_) {
    return fallback;
  }
}

/**
 * Promise that resolves after `ms`.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Whether a target is off-limits to the camera.
 * @param {*} target
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
 * @param {string} enumName The enum's global name.
 * @param {string} member
 * @returns {*} The enum value, or undefined.
 */
export function enumVal(enumName, member) {
  try {
    const enumObject = enumName === "InterpolationFunc"
      ? (typeof InterpolationFunc !== "undefined" ? InterpolationFunc : null)
      : (typeof KeyframeFlag !== "undefined" ? KeyframeFlag : null);
    return enumObject ? enumObject[member] : undefined;
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
 * @param {*} e
 * @returns {boolean}
 */
export function isEscape(e) {
  return !!e && (e.key === "Escape" || e.keyCode === 27);
}

/**
 * Classify an engine-input event.
 * @param {*} detail The event detail.
 * @returns {string} "exit" | "replay" | "".
 */
export function classifyInput(detail) {
  if (!detail || !detail.name) return "";
  const name = detail.name;
  if (name === "cancel" || name === "keyboard-escape" || name === "mousebutton-right") return "exit";
  if (name === "mousebutton-left" || name === "touch-tap" || name === "accept") return "replay";
  return "";
}

/**
 * Consume an engine-input event so nothing else reacts.
 * @param {*} e
 */
export function consumeEvent(e) {
  try {
    e.preventDefault();
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
  } catch (_) {
    // ignore
  }
}

/**
 * Whether this input should be debounced.
 * @param {*} flow The active flow state (stamped with `lastInputAt`).
 * @returns {boolean} True to ignore (debounced).
 */
export function inputDebounced(flow) {
  const now = nowMs();
  if (flow.lastInputAt && now - flow.lastInputAt < 500) return true;
  flow.lastInputAt = now;
  return false;
}