// ui-helpers.js
// Shared lightweight DOM/format helpers used across Demographics views.

import { formatCount } from "/demographics/ui/metrics/metrics-format.js";

/**
 * @param {string} cls
 * @param {string} [text]
 * @returns {HTMLElement}
 */
export function div(cls, text) {
  const el = document.createElement("div");
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

/**
 * An element with a BLP background image.
 * @param {string} iconPath The `blp:` icon path.
 * @param {string} cls
 * @returns {HTMLElement}
 */
export function iconEl(iconPath, cls) {
  const ic = div(cls);
  ic.style.backgroundImage = `url('${iconPath}')`;
  return ic;
}

/**
 * Rounded integer text.
 * @param {number} v
 * @returns {string} An em dash for non-finite input.
 */
export function fmt(v) {
  return typeof v === "number" && isFinite(v) ? String(Math.round(v)) : "—";
}

/**
 * A population estimate as an exact rounded integer with separators.
 * @param {number} v
 * @returns {string}
 */
export function fmtPop(v) {
  if (typeof v !== "number" || !isFinite(v) || v <= 0) return "—";
  // Locale-aware grouping (Locale.toNumber via metrics-format) instead of JS toLocaleString,
  // which in Gameface always renders English grouping regardless of the player's language.
  return formatCount(v);
}
