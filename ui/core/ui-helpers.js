// ui-helpers.js
// Shared lightweight DOM/format helpers used across Demographics views.

/**
 * Create a div with a class and optional text content.
 * @param {string} cls Class name(s).
 * @param {string} [text] Optional text content.
 * @returns {HTMLElement} Created element.
 */
export function div(cls, text) {
  const el = document.createElement("div");
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

/**
 * Build an element with a BLP background image.
 * @param {string} iconPath The `blp:` icon path.
 * @param {string} cls Class name(s).
 * @returns {HTMLElement} Icon element.
 */
export function iconEl(iconPath, cls) {
  const ic = div(cls);
  ic.style.backgroundImage = `url('${iconPath}')`;
  return ic;
}

/**
 * Format a numeric value as rounded integer text.
 * @param {number} v Value to format.
 * @returns {string} Rounded value or em dash for non-finite input.
 */
export function fmt(v) {
  return typeof v === "number" && isFinite(v) ? String(Math.round(v)) : "—";
}

/**
 * Format a large population estimate compactly (B/M/K).
 * @param {number} v Value to format.
 * @returns {string} Compact population string.
 */
export function fmtPop(v) {
  if (typeof v !== "number" || !isFinite(v) || v <= 0) return "—";
  if (v >= 1e9) return (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(0) + "K";
  return String(Math.round(v));
}
