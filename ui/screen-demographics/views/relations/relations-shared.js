// relations-shared.js
//
// Shared primitives for the Global Relations view modules: debug logging, the
// defensive `safeCall` wrapper, color coercion helpers, and the per-filter
// line-dash table consumed by both the ring renderer and the filter pills.
// Split out of view-relations.js so relations-ring-svg.js / relations-edges.js
// / relations-filters.js can import these without duplicating them.

const DEMOGRAPHICS_DEBUG = false;

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
 * @property {boolean} [directed] When set, render a→b direction chevrons.
 * @property {number} [width] Per-edge stroke width (currently ignored).
 * @property {number} [opacity] Per-edge stroke opacity (currently ignored).
 * @property {string|null} [_dashOverride] Per-tab dash-pattern override.
 */

export const DBG = DEMOGRAPHICS_DEBUG;

// The ring SVG's measured pixels-per-viewBox-unit, published by the ring renderer
// after it measures its laid-out size and read by the legend so a swatch draws
// its sample line at the EXACT same scale as the ring lines.
let _ringPxPerUnit = 0;
/**
 * Publish the ring's measured pixels-per-viewBox-unit.
 * @param {number} v Pixels per viewBox unit.
 */
export function setRingPxPerUnit(v) {
  if (typeof v === "number" && isFinite(v) && v > 0) _ringPxPerUnit = v;
}
/**
 * Read the ring's measured pixels-per-viewBox-unit (0 until first measured).
 * @returns {number} Pixels per viewBox unit, or 0.
 */
export function getRingPxPerUnit() {
  return _ringPxPerUnit;
}
/**
 * Debug logger, no-op unless {@link DBG} is set.
 * @param {...*} a Values to log.
 */
export function dlog(...a) {
  if (DBG) console.warn("[Demographics.view-relations]", ...a);
}
/**
 * Error logger (always emits).
 * @param {...*} a Values to log.
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
  // rendered as opaque white - that's the "white circle" bug. Accept 6 or
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

// In-game YIELD/CATEGORY color language: each agreement is colored by what it's
// ABOUT (food = green, science = blue, culture = purple, trade/gold = gold,
// production = orange, military = red, diplomacy/influence = teal, happiness =
// amber), using the game's recognizable yield palette. When several agreements
// share a category (same color), the DASH STYLE separates them , e.g. both food
// deals are green, but one is a long dash and the other a medium dash.
// (SABOTAGE_RESEARCH is intentionally NOT here ; it isn't an agreement.)
// In-game yield HUES, at full saturation. The earlier pale .text-yield-* pastels
// all sat at the same low chroma / high value, so the eight categories were nearly
// indistinguishable on the ring. These keep the game's recognizable yield-color
// language (gold/blue/teal/purple/amber/green/orange/red) but push saturation +
// contrast so each category reads as its own color; same-category agreements are
// then told apart by DASH, not hue.
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
// `dash` is now a STYLE TOKEN, confined to the line vocabulary the renderer
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
 * Cooperative agreement types specific to City-States (independents). Befriending
 * (GIVE_INFLUENCE_TOKEN , the influence-token project, confirmed by the base
 * befriend-independent screen) plus the suzerain benefit directives. Each is its
 * own filter + uniquely-styled line on the CS ring, mirroring AGREEMENT_TYPES for
 * majors. Trade is built separately (its own economic builder), as for majors.
 * @type {{ key: string, action: string, color: string, dash: string }[]}
 */
// All CS agreements are directed (major → CS), so they render as solid lines with
// animated arrow chevrons and are told apart by color; the `dash` token is unused
// for directed edges but kept solid for consistency.
export const CS_AGREEMENT_TYPES = [
  { key: "befriend", action: "DIPLOMACY_ACTION_GIVE_INFLUENCE_TOKEN", color: CAT.influence, dash: "" },
  { key: "cs_promote_growth", action: "DIPLOMACY_ACTION_CS_PROMOTE_GROWTH", color: CAT.food, dash: "" },
  { key: "cs_bolster_military", action: "DIPLOMACY_ACTION_CS_BOLSTER_MILITARY", color: CAT.military, dash: "" }
];

/**
 * Title-case a DIPLOMACY_ACTION_* enum name as a readable fallback label.
 * @param {string} actionName The enum name.
 * @returns {string} e.g. "Cultural Exchange".
 */
function titleCaseAction(actionName) {
  return String(actionName || "")
    .replace(/^DIPLOMACY_ACTION_/, "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Compose the engine's own localized name for a diplomacy action, or "" when
 * unavailable / unresolved.
 * @param {string} actionName The DIPLOMACY_ACTION_* enum name.
 * @returns {string} The composed name, or "".
 */
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
 * @returns {string} The display label.
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

// Per-filter line STYLE token. The renderer supports exactly four visual
// categories: solid (""), "dashed", "dotted", and , orthogonally , directed edges,
// which draw as a solid line with animated arrow chevrons (set via `e.directed`,
// not here). Coherent ignores SVG stroke-dasharray, so the renderer synthesizes
// dashes/dots; keeping the token set tiny is what makes them render cleanly.
/** @type {Record<string, string>} */
export const LINE_DASH = {
  //   SOLID  = a STANDING RELATIONSHIP (attitude / suzerainty). Color = its warmth.
  //   DASHED / DOTTED = an action/treaty tie laid over it; style separates same-
  //                     color deals. DIRECTED ties (trade, denounce, CS deals) draw
  //                     solid with flowing arrow chevrons instead (see e.directed).
  // ── Standing relationships - solid: ──
  war: "",
  alliance: "",
  helpful: "",
  friendly: "",
  unfriendly: "",
  hostile: "",
  // ── Overlays: ──
  openborders: "dashed",
  denounced: "dashed", // directed → solid + chevrons (token unused)
  trade: "dotted", // directed → solid + chevrons (token unused)
  suzerain: "" // CS suzerainty: a standing bond → solid
};
// Fold in each individual agreement type's dash (per-action lines).
for (const _a of AGREEMENT_TYPES) LINE_DASH[_a.key] = _a.dash;
// ...and each City-State agreement type's dash (befriend / suzerain directives).
for (const _c of CS_AGREEMENT_TYPES) LINE_DASH[_c.key] = _c.dash;

/**
 * Resolve an explicit per-edge dash override.
 * @param {Edge} edge Edge descriptor.
 * @returns {string|undefined} Override value, or undefined when absent.
 */
function dashOverride(edge) {
  if (!edge) return undefined;
  if (typeof edge._dashOverride === "string") return edge._dashOverride;
  if (edge._dashOverride === null || edge._dashOverride === "") return "";
  return undefined;
}

/**
 * Resolve a dash pattern from filter key mapping.
 * @param {Edge} edge Edge descriptor.
 * @returns {string|undefined} Pattern string, or undefined when unmapped.
 */
function dashByFilter(edge) {
  if (!edge || typeof edge.filterKey !== "string") return undefined;
  if (!Object.prototype.hasOwnProperty.call(LINE_DASH, edge.filterKey)) {
    return undefined;
  }
  return LINE_DASH[edge.filterKey];
}

/**
 * Resolve the line-STYLE token for an edge ("" solid / "dashed" / "dotted"),
 * honoring per-tab overrides, the legacy `dashed` flag, then `LINE_DASH`.
 * @param {Edge} edge The edge to texture.
 * @returns {string} The style token (`""` = solid line).
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
  // Legacy `e.dashed` flag (suzerain edges set it directly) - preserve.
  if (edge.dashed) return "dashed";
  return "";
}
