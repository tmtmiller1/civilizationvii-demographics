// history-colors.js
//
// Readable civilization colors for the history views, from the same rules the rest of Demographics
// uses (core/civ-color-utils.js): a colorless dark primary gives way to the secondary banner color,
// dark colors are lifted to a readable lightness on the dark panels, and colors too close to one
// already taken in the same game are moved apart (the local player keeps theirs first).

import { safeTextColor, preferReadableColor, deconflictColors } from "/demographics/ui/core/civ-color-utils.js";

/**
 * One civilization's readable color, on its own.
 * @param {string} primary Primary banner color.
 * @param {string} [secondary] Secondary banner color.
 * @returns {string} CSS color.
 */
export function readableColor(primary, secondary) {
  const c = safeTextColor(preferReadableColor(primary || "", secondary || ""));
  return typeof c === "string" && c ? c : "#c2c4cc";
}

/**
 * Readable, mutually distinct colors for every civilization in one game.
 * @param {Array<{pid:number, primary:string, secondary?:string}>} entries In priority order (local first).
 * @returns {Map<number, string>} Player id -> CSS color.
 */
export function gameColors(entries) {
  const out = deconflictColors(entries.map((e) => readableColor(e.primary, e.secondary)));
  return new Map(entries.map((e, i) => [e.pid, out[i]]));
}

/**
 * A CSS color with an alpha channel ("rgb(1, 2, 3)" or "#rrggbb" in; "rgba(...)" out).
 * @param {string} color CSS color.
 * @param {number} alpha 0..1.
 * @returns {string} rgba() color (the input when it cannot be parsed).
 */
export function withAlpha(color, alpha) {
  const s = String(color || "");
  let m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})`;
  m = s.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (m) return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
  return s;
}
