// relations-shared.js
//
// Shared primitives for the Global Relations view modules: debug logging, the
// defensive `safeCall` wrapper, color coercion helpers, and the per-filter
// line-dash table consumed by both the ring renderer and the filter pills.
// Split out of view-relations.js so relations-ring-svg.js / relations-edges.js
// / relations-filters.js can import these without duplicating them.

const DEMOGRAPHICS_DEBUG = true;

/**
 * One relationship edge between two ring nodes. `a`/`b` are player ids; the
 * remaining fields are visual hints consumed by the ring renderer.
 * @typedef {Object} Edge
 * @property {number} a Source player id.
 * @property {number} b Target player id.
 * @property {string} [color] Stroke color (hex or rgba).
 * @property {string} [label] Optional human-readable edge label.
 * @property {string} [filterKey] Filter category this edge belongs to.
 * @property {boolean} [dashed] Legacy dashed-line flag (suzerain edges).
 * @property {number} [width] Per-edge stroke width (currently ignored).
 * @property {number} [opacity] Per-edge stroke opacity (currently ignored).
 * @property {string|null} [_dashOverride] Per-tab dash-pattern override.
 */

export const DBG = DEMOGRAPHICS_DEBUG;
/**
 * Debug logger, no-op unless {@link DBG} is set.
 * @param {...*} a Values to log.
 * @returns {void}
 */
export function dlog(...a) {
  if (DBG) console.warn("[Demographics.view-relations]", ...a);
}
/**
 * Error logger (always emits).
 * @param {...*} a Values to log.
 * @returns {void}
 */
export function derr(...a) {
  console.error("[Demographics.view-relations]", ...a);
}

/**
 * Convert a `#RRGGBB` (or `0xRRGGBB`/`RRGGBB`/8-char) color string to `rgba()`
 * with the given alpha. Accepts 6- or 8-char hex (taking the last 6 digits as
 * RGB) to dodge the "white circle" bug where 8-char `#RRGGBBAA` fell through.
 * @param {*} hex Candidate color string.
 * @param {number} alpha Alpha channel (0..1).
 * @returns {string} An `rgba(...)` string (a safe dark fallback if unparseable).
 */
export function hexToRgba(hex, alpha) {
  if (typeof hex !== "string") return "rgba(0,0,0," + alpha + ")";
  // Civ7's `UI.Player.getPrimaryColorValueAsString` can return 8-char hex
  // ("#AARRGGBB" or "#RRGGBBAA"). The previous regex only matched 6 chars
  // and FELL THROUGH returning the raw string, so SVG `fill="#FFFFFFFF"`
  // rendered as opaque white — that's the "white circle" bug. Accept 6 or
  // 8 char hex and always take the LAST 6 digits as RGB.
  const m = hex.match(/^#?([0-9a-fA-F]{6,8})$/);
  if (!m) return "rgba(20, 16, 10, " + alpha + ")";
  const rgbHex = m[1].slice(-6);
  const n = parseInt(rgbHex, 16);
  return `rgba(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}, ${alpha})`;
}

/**
 * Normalize any Civ7 color string to a safe 6-char `#RRGGBB` hex, or `null`
 * when the value is useless (near-white, near-black, or unparseable). Used to
 * scrub `UI.Player.getPrimaryColorValueAsString` output before storing it.
 * @param {*} s Candidate color string.
 * @returns {string|null} The normalized `#RRGGBB`, or `null` if unusable.
 */
export function normalizeCivColor(s) {
  if (typeof s !== "string") return null;
  const m = s.match(/^#?([0-9a-fA-F]{6,8})$/);
  if (!m) return null;
  const rgbHex = m[1].slice(-6);
  const n = parseInt(rgbHex, 16);
  const r = (n >> 16) & 0xff,
    g = (n >> 8) & 0xff,
    b = n & 0xff;
  if ((r + g + b) / 3 > 220) return null; // near-white = useless on parchment
  if ((r + g + b) / 3 < 12) return null; // near-black = also indistinguishable
  return "#" + rgbHex.toUpperCase();
}

/**
 * Invoke `fn` and return its result, logging and returning `fb` on throw.
 * @template T
 * @param {string} label Diagnostic label for the call site.
 * @param {() => T} fn Thunk to evaluate.
 * @param {T} [fb] Fallback returned on throw.
 * @returns {T} `fn()` result, or `fb`. (When `fb` is omitted, `T` includes
 *   `undefined` at the call site, matching the thunk's own return type.)
 */
export function safeCall(label, fn, fb) {
  try {
    return fn();
  } catch (e) {
    if (DBG) derr("safeCall(" + label + "):", e);
    return /** @type {T} */ (fb);
  }
}

// Per-filter line texture. Returns the SVG `stroke-dasharray` value to use
// for an edge of that filter key, or "" for a solid line. Pairing rationale:
//   research / endeavors share warm-cool space with trade and denounced —
//   give them distinct dash patterns so the eye can pick them apart even
//   when the same pair has multiple parallel edges.
// Stroke is 0.6 viewBox units. Dash patterns are sized large enough to
// remain obvious across the typical 20–50 viewBox-unit edge lengths in
// this ring. Earlier "1.6 1.2" / "0.6 1.4" patterns were imperceptible
// at typical rendered scales — bumped well above stroke width.
/** @type {Record<string, string>} */
export const LINE_DASH = {
  // Primary signals — solid:
  war: "",
  alliance: "",
  helpful: "",
  friendly: "",
  unfriendly: "",
  hostile: "",
  trade: "",
  // Overlay categories — patterned (units = SVG viewBox 0..100):
  openborders: "5 2", // long-dash
  denounced: "2.5 2", // medium-dash
  research: "0.6 2", // dots
  endeavors: "4 2 0.6 2", // dash-dot
  suzerain: "3 2" // CS suzerainty
};

/**
 * Resolve the dash-array pattern for an edge, honoring per-tab overrides, the
 * legacy `dashed` flag, then the per-filter `LINE_DASH` table.
 * @param {Edge} edge The edge to texture.
 * @returns {string} The dash pattern (`""` = solid line).
 */
export function dasharrayFor(edge) {
  if (!edge) return "";
  // Per-tab override applied at edge-build time (see CS_FILTER_OVERRIDES
  // injection in repaint). Wins over everything else so the CS tab can
  // recolor trade=yellow-dotted etc. without touching the base maps.
  if (typeof edge._dashOverride === "string") return edge._dashOverride;
  if (edge._dashOverride === null || edge._dashOverride === "") return "";
  // Legacy `e.dashed` flag (suzerain edges set it directly) — preserve.
  if (edge.dashed && !edge.filterKey) return "1.4 1.0";
  const k = edge.filterKey || "";
  if (Object.prototype.hasOwnProperty.call(LINE_DASH, k)) return LINE_DASH[k];
  return edge.dashed ? "1.4 1.0" : "";
}
