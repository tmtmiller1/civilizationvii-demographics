// relations-shared.js
//
// Shared primitives for the Global Relations view modules: debug logging, the
// defensive `safeCall` wrapper, color coercion helpers, and the per-filter
// line-dash table consumed by both the ring renderer and the filter pills.

import { debugLoggingOn, makeLogger } from "/demographics/ui/core/demographics-log.js";

/**
 * One relationship edge between two ring nodes. `a`/`b` are player ids; the
 * remaining fields are visual hints consumed by the ring renderer.
 * @typedef {Object} Edge
 * @property {number} a Source player id.
 * @property {number} b Target player id.
 * @property {string} [color] Stroke color (hex or rgba).
 * @property {string} [label] Optional human-readable edge label.
 * @property {string} [filterKey] Filter category this edge belongs to.
 * @property {boolean} [dashed] Dashed-line flag, set directly by suzerain edges.
 * @property {boolean} [directed] When set, render a→b direction chevrons.
 * @property {number} [width] Per-edge stroke width (currently ignored).
 * @property {number} [opacity] Per-edge stroke opacity (currently ignored).
 * @property {string|null} [_dashOverride] Per-tab dash-pattern override.
 */

export const log = makeLogger("view-relations");

// The ring SVG's measured pixels-per-viewBox-unit, published by the ring renderer
// after it measures its laid-out size and read by the legend so a swatch draws
// its sample line at the exact same scale as the ring lines.
let _ringPxPerUnit = 0;
/**
 * Publish the ring's measured pixels-per-viewBox-unit.
 * @param {number} pxPerUnit
 */
export function setRingPxPerUnit(pxPerUnit) {
  if (typeof pxPerUnit === "number" && isFinite(pxPerUnit) && pxPerUnit > 0) _ringPxPerUnit = pxPerUnit;
}
/**
 * Read the ring's measured pixels-per-viewBox-unit (0 until first measured).
 * @returns {number}
 */
export function getRingPxPerUnit() {
  return _ringPxPerUnit;
}

/**
 * Convert a `#RRGGBB` (or `0xRRGGBB`/`RRGGBB`/8-char) color string to `rgba()`
 * with the given alpha. Accepts 6- or 8-char hex (taking the last 6 digits as
 * RGB) to dodge the "white circle" bug where 8-char `#RRGGBBAA` fell through.
 * @param {*} hex
 * @param {number} alpha
 * @returns {string} An `rgba(...)` string (a safe dark fallback if unparseable).
 */
export function hexToRgba(hex, alpha) {
  if (typeof hex !== "string") return "rgba(0,0,0," + alpha + ")";
  // Civ7's `UI.Player.getPrimaryColorValueAsString` can return 8-char hex
  // ("#AARRGGBB" or "#RRGGBBAA"); accept 6 or 8 chars and always take the
  // last 6 digits as RGB so an alpha-carrying value never renders opaque white.
  const match = hex.match(/^#?([0-9a-fA-F]{6,8})$/);
  if (!match) return "rgba(20, 16, 10, " + alpha + ")";
  const rgbHex = match[1].slice(-6);
  const rgb = parseInt(rgbHex, 16);
  return `rgba(${(rgb >> 16) & 0xff}, ${(rgb >> 8) & 0xff}, ${rgb & 0xff}, ${alpha})`;
}

/**
 * Normalize any Civ7 color string to a safe 6-char `#RRGGBB` hex, or `null`
 * when the value is useless (near-white, near-black, or unparseable). Used to
 * scrub `UI.Player.getPrimaryColorValueAsString` output before storing it.
 * @param {*} value
 * @returns {string|null} `#RRGGBB`, or `null` if unusable.
 */
export function normalizeCivColor(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^#?([0-9a-fA-F]{6,8})$/);
  if (!match) return null;
  const rgbHex = match[1].slice(-6);
  const rgb = parseInt(rgbHex, 16);
  const r = (rgb >> 16) & 0xff,
    g = (rgb >> 8) & 0xff,
    b = rgb & 0xff;
  if ((r + g + b) / 3 > 220) return null; // near-white = useless on parchment
  if ((r + g + b) / 3 < 12) return null; // near-black = also indistinguishable
  return "#" + rgbHex.toUpperCase();
}

/**
 * Invoke `fn` and return its result, logging and returning `fallback` on throw.
 * @template T
 * @param {string} label
 * @param {() => T} fn
 * @param {T} [fallback] Returned on throw.
 * @returns {T} `fn()` result, or `fallback`. (When `fallback` is omitted, `T` includes
 *   `undefined` at the call site, matching the thunk's own return type.)
 */
export function safeCall(label, fn, fallback) {
  try {
    return fn();
  } catch (e) {
    if (debugLoggingOn()) log.error("safeCall(" + label + "):", e);
    return /** @type {T} */ (fallback);
  }
}

// In-game yield/category hues at full saturation: each agreement is colored by
// what it's about (food green, science blue, culture purple, gold gold, production
// orange, military red, influence teal, happiness amber); same-category
// agreements are told apart by dash, not hue. SABOTAGE_RESEARCH isn't an agreement.
const CAT = {
  gold: "#f0c33c", // trade / gold (vivid gold)
  science: "#4ea6ec", // science (vivid blue)
  influence: "#2fc79a", // diplomacy / influence (vivid teal)
  culture: "#b25ce0", // culture (vivid purple)
  happiness: "#f2a13a", // happiness (vivid amber-orange)
  food: "#74c93f", // food (vivid leaf green)
  production: "#d97b2c", // production (vivid burnt orange)
  military: "#e8493c" // military (vivid red)
};
// `dash` is a STYLE TOKEN, confined to the line vocabulary the renderer
// supports: "" (solid), "dashed", "dotted". Within one color category, agreements
// are told apart by style; categories with a single agreement stay solid.
/** @type {{ key: string, action: string, color: string, dash: string }[]} */
export const AGREEMENT_TYPES = [
  // Science (blue): two deals → dashed + dotted
  { key: "research_collab", action: "DIPLOMACY_ACTION_RESEARCH_COLLABORATION", color: CAT.science, dash: "dashed" },
  { key: "share_innovations", action: "DIPLOMACY_ACTION_SHARE_INNOVATIONS", color: CAT.science, dash: "dotted" },
  // Diplomacy / influence (teal): three deals → solid + dashed + dotted
  { key: "delegation", action: "DIPLOMACY_ACTION_SEND_DELEGATION", color: CAT.influence, dash: "" },
  { key: "trade_map", action: "DIPLOMACY_ACTION_TRADE_MAP", color: CAT.influence, dash: "dashed" },
  { key: "friend_wa", action: "DIPLOMACY_ACTION_FRIEND_OF_WA", color: CAT.influence, dash: "dotted" },
  // Trade / gold (solid; directed trade-routes line is gold + chevrons)
  { key: "trade_relations", action: "DIPLOMACY_ACTION_IMPROVE_TRADE_RELATIONS", color: CAT.gold, dash: "" },
  // Food (green): two deals → solid + dashed (Farmers Market is solid)
  { key: "farmers_market", action: "DIPLOMACY_ACTION_FARMERS_MARKET", color: CAT.food, dash: "" },
  { key: "ginseng", action: "DIPLOMACY_ACTION_GINSING_AGREEMENT", color: CAT.food, dash: "dashed" },
  // Happiness (amber): solo → solid
  { key: "festivals", action: "DIPLOMACY_ACTION_LOCAL_FESTIVALS", color: CAT.happiness, dash: "" },
  // Production (orange): solo → solid
  { key: "pioneering", action: "DIPLOMACY_ACTION_PIONEERING", color: CAT.production, dash: "" },
  // Military (red): solo → solid
  { key: "military_aid", action: "DIPLOMACY_ACTION_MILITARY_AID", color: CAT.military, dash: "" },
  // Culture (purple): solo → solid
  { key: "cultural", action: "DIPLOMACY_ACTION_CULTURAL_EXCHANGE", color: CAT.culture, dash: "" }
];

/**
 * Cooperative agreement types specific to City-States: befriending
 * (GIVE_INFLUENCE_TOKEN) plus the suzerain benefit directives, each its own
 * filter + styled line, mirroring AGREEMENT_TYPES. Trade is built separately.
 * @type {{ key: string, action: string, color: string, dash: string }[]}
 */
// All CS agreements are directed (major → CS), so they render as solid lines with
// arrow chevrons and are told apart by color; the `dash` token is unused
// for directed edges but kept solid for consistency.
export const CS_AGREEMENT_TYPES = [
  { key: "befriend", action: "DIPLOMACY_ACTION_GIVE_INFLUENCE_TOKEN", color: CAT.influence, dash: "" },
  { key: "cs_promote_growth", action: "DIPLOMACY_ACTION_CS_PROMOTE_GROWTH", color: CAT.food, dash: "" },
  { key: "cs_bolster_military", action: "DIPLOMACY_ACTION_CS_BOLSTER_MILITARY", color: CAT.military, dash: "" }
];

/** @param {string} actionName */
function titleCaseAction(actionName) {
  return String(actionName || "")
    .replace(/^DIPLOMACY_ACTION_/, "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** @param {string} actionName */
function composeDiplomacyName(actionName) {
  const info =
    typeof GameInfo !== "undefined" && GameInfo.DiplomacyActions
      ? GameInfo.DiplomacyActions.lookup(actionName)
      : null;
  const name = info && info.Name;
  if (!name || typeof Locale === "undefined" || typeof Locale.compose !== "function") return "";
  const out = Locale.compose(name);
  return typeof out === "string" && out.length > 0 && out.indexOf("LOC_") !== 0 ? out : "";
}

/** @type {Record<string, string>} */
const DIPLOMACY_LABEL_TAGS = {
  DIPLOMACY_ACTION_SHARE_INNOVATIONS:
    "LOC_DEMOGRAPHICS_DIPLOMACY_ACTION_SHARE_INNOVATIONS",

  DIPLOMACY_ACTION_PIONEERING:
    "LOC_DEMOGRAPHICS_DIPLOMACY_ACTION_PIONEERING",

  DIPLOMACY_ACTION_GIVE_INFLUENCE_TOKEN:
    "LOC_DEMOGRAPHICS_DIPLOMACY_ACTION_GIVE_INFLUENCE_TOKEN",
};

/**
 * Resolve a localized display label for a diplomacy action, preferring the
 * engine's own name (GameInfo.DiplomacyActions → Locale.compose) so it matches
 * the game and localizes for free; falls back to a title-cased enum name.
 * @param {string} actionName The DIPLOMACY_ACTION_* enum name.
 * @returns {string}
 */
export function diplomacyActionLabel(actionName) {
  try {
    const fallbackTag = DIPLOMACY_LABEL_TAGS[actionName];
    if (
      fallbackTag &&
      typeof Locale !== "undefined" &&
      typeof Locale.compose === "function"
    ) {
      const localized = Locale.compose(fallbackTag);

      if (
        typeof localized === "string" &&
        localized.length > 0 &&
        localized.indexOf("LOC_") !== 0
      ) {
        return localized;
      }
    }

    const out = composeDiplomacyName(actionName);
    if (out) return out;
  } catch (_) {
    // GameInfo/Locale boundary can throw; fall back to the derived label.
  }

  return titleCaseAction(actionName);
}

// Per-filter line style token: solid (""), "dashed", "dotted"; directed edges
// (via `edge.directed`, not here) draw solid with animated arrow chevrons. Coherent
// ignores SVG stroke-dasharray, so the renderer synthesizes dashes/dots.
/** @type {Record<string, string>} */
export const LINE_DASH = {
  // Solid = a standing relationship (color = warmth); dashed/dotted = an
  // action/treaty tie laid over it, style separating same-color deals.
  // standing relationships, solid:
  war: "",
  alliance: "",
  helpful: "",
  friendly: "",
  unfriendly: "",
  hostile: "",
  // overlays:
  openborders: "dashed",
  denounced: "dashed", // directed → solid + chevrons (token unused)
  trade: "dotted", // directed → solid + chevrons (token unused)
  suzerain: "" // CS suzerainty: a standing bond → solid
};
// Fold in each individual agreement type's dash (per-action lines).
for (const agreement of AGREEMENT_TYPES) LINE_DASH[agreement.key] = agreement.dash;
// ...and each City-State agreement type's dash (befriend / suzerain directives).
for (const agreement of CS_AGREEMENT_TYPES) LINE_DASH[agreement.key] = agreement.dash;

/** @param {Edge} edge */
function dashOverride(edge) {
  if (!edge) return undefined;
  if (typeof edge._dashOverride === "string") return edge._dashOverride;
  if (edge._dashOverride === null || edge._dashOverride === "") return "";
  return undefined;
}

/** @param {Edge} edge */
function dashByFilter(edge) {
  if (!edge || typeof edge.filterKey !== "string") return undefined;
  if (!Object.prototype.hasOwnProperty.call(LINE_DASH, edge.filterKey)) {
    return undefined;
  }
  return LINE_DASH[edge.filterKey];
}

/**
 * Resolve the line-STYLE token for an edge ("" solid / "dashed" / "dotted"),
 * honoring per-tab overrides, the `dashed` flag, then `LINE_DASH`.
 * @param {Edge} edge
 * @returns {string} `""` for a solid line.
 */
export function dasharrayFor(edge) {
  if (!edge) return "";
  // Per-tab override applied at edge-build time (see CS_FILTER_OVERRIDES
  // injection in repaint). Wins over everything else so the CS tab can
  // restyle trade etc. without touching the base maps.
  const override = dashOverride(edge);
  if (override !== undefined) return override;
  const byFilter = dashByFilter(edge);
  if (byFilter !== undefined) return byFilter;
  // `edge.dashed` flag (suzerain edges set it directly).
  if (edge.dashed) return "dashed";
  return "";
}
