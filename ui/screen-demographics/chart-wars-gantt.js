// chart-wars-gantt.js
//
// The conflicts Gantt timeline (one bar per major-vs-major war):
// collectWarCivOptions + renderWarsGantt and their private filtering,
// layout, bar-drawing, war-naming, tooltip, and hover helpers (romanize,
// parseYear, casualty estimate, etc). Migrated verbatim from
// demographics-chart.js.

import { getSemantic } from "/demographics/ui/demographics-palette.js";
import { t } from "/demographics/ui/demographics-i18n.js";
import {
  dlog,
  SVG_NS,
  svgEl,
  historySamples,
  appendEmptyNotice,
  resolveTurnRange,
  getXAxisMode,
  nearestByTurn,
  buildStackTurnYears,
  escapeHtml
} from "/demographics/ui/screen-demographics/chart-shared.js";

// Wars Gantt — one horizontal bar per war, stacked vertically by start turn.
// X-axis = turn (with year ticks). Bars colored by the attacker's primary
// color; named with the ordinal-style label the sampler generates.

/**
 * Filter a roster to its major (non-city-state) civs.
 * @param {*[]} roster A war side's roster.
 * @returns {*[]} The major civs.
 */
function majorsOnSide(roster) {
  return (roster || []).filter((r) => r && !r.isCS);
}

// CIV_ADJECTIVE — civ display-name → grammatical adjective form. Covers every
// base + DLC civ across all three ages; unknown civs fall back to a heuristic.
/** @type {Record<string, string>} */
const CIV_ADJECTIVE = {
  // Antiquity
  Aksum: "Aksumite",
  Carthage: "Carthaginian",
  Egypt: "Egyptian",
  Greece: "Greek",
  Han: "Han",
  Khmer: "Khmer",
  Maurya: "Mauryan",
  Maya: "Mayan",
  Mississippian: "Mississippian",
  Persia: "Persian",
  Rome: "Roman",
  // Exploration
  Abbasid: "Abbasid",
  Chola: "Chola",
  Hawaii: "Hawaiian",
  Inca: "Incan",
  Majapahit: "Majapahit",
  Ming: "Ming",
  Mongolia: "Mongol",
  Mongol: "Mongol",
  Norman: "Norman",
  Normans: "Norman",
  Shawnee: "Shawnee",
  Songhai: "Songhai",
  Spain: "Spanish",
  // Modern
  America: "American",
  "United States": "American",
  Buganda: "Bugandan",
  France: "French",
  Japan: "Japanese",
  Korea: "Korean",
  Meiji: "Meiji",
  Mexico: "Mexican",
  Mughal: "Mughal",
  Prussia: "Prussian",
  Qing: "Qing",
  Russia: "Russian",
  Siam: "Siamese",
  Thailand: "Thai",
  // Common DLC / wishlist
  Aztec: "Aztec",
  Babylonia: "Babylonian",
  Britain: "British",
  Byzantium: "Byzantine",
  England: "English",
  Ethiopia: "Ethiopian",
  Germany: "German",
  India: "Indian",
  Israel: "Israeli",
  Italy: "Italian",
  Khazar: "Khazar",
  Macedon: "Macedonian",
  Maori: "Maori",
  Netherlands: "Dutch",
  Phoenicia: "Phoenician",
  Poland: "Polish",
  Portugal: "Portuguese",
  Sumeria: "Sumerian",
  Sweden: "Swedish",
  Turkey: "Turkish",
  Vietnam: "Vietnamese",
  Zulu: "Zulu"
};

/**
 * Resolve a civ's adjective from the engine's `LOC_CIVILIZATION_*_ADJECTIVE`
 * string, or `null` when unavailable. Cite: CivilizationText.xml.
 * @param {*} civType The engine CivilizationType string.
 * @returns {string|null} The composed adjective, or `null`.
 */
function adjectiveFromCivType(civType) {
  if (typeof civType !== "string" || !civType) return null;
  const stem = civType.replace(/^CIVILIZATION_/, "");
  if (!stem) return null;
  const tag = "LOC_CIVILIZATION_" + stem + "_ADJECTIVE";
  try {
    if (typeof Locale?.compose === "function") {
      const v = Locale.compose(tag);
      if (typeof v === "string" && v.length > 0 && !v.startsWith("LOC_")) return v;
    }
  } catch (_) {
    // Locale.compose may throw on a malformed adjective tag; fall back to null.
  }
  return null;
}

/**
 * Resolve a civ's adjective from the bundled map, then a heuristic English
 * suffix derivation. Used when the engine adjective isn't available.
 * @param {*} name The civ display name.
 * @returns {string} The adjective.
 */
function civAdjectiveFromName(name) {
  if (typeof name !== "string" || !name.length) return "Unknown";
  if (CIV_ADJECTIVE[name]) return CIV_ADJECTIVE[name];
  const cleaned = name.replace(/^the\s+/i, "").trim();
  if (CIV_ADJECTIVE[cleaned]) return CIV_ADJECTIVE[cleaned];
  if (/ia$/i.test(cleaned)) return cleaned.replace(/ia$/i, "ian");
  if (/y$/i.test(cleaned)) return cleaned.replace(/y$/i, "ian");
  if (/a$/i.test(cleaned)) return cleaned + "n";
  if (/e$/i.test(cleaned)) return cleaned.replace(/e$/i, "ean");
  if (/o$/i.test(cleaned)) return cleaned + "an";
  return cleaned + "an";
}

/**
 * Resolve a roster entry's (or raw string's) civ adjective, preferring the
 * engine LOC lookup.
 * @param {*} rosterEntry A roster object ({civ, civTypeString}) or a string.
 * @returns {string} The adjective.
 */
function civAdjective(rosterEntry) {
  if (rosterEntry && typeof rosterEntry === "object") {
    const fromEngine = adjectiveFromCivType(rosterEntry.civTypeString);
    if (fromEngine) return fromEngine;
    return civAdjectiveFromName(rosterEntry.civ);
  }
  return civAdjectiveFromName(rosterEntry);
}

/**
 * Format an integer with its English ordinal suffix ("1st", "2nd", ...).
 * @param {number} n The integer.
 * @returns {string} The ordinal string.
 */
function ordinalInt(n) {
  const v = n % 100,
    s = ["th", "st", "nd", "rd"];
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * Convert an integer to a Roman numeral (>=1; "I" minimum).
 * @param {number} n The integer.
 * @returns {string} The Roman numeral.
 */
function romanize(n) {
  /** @type {[string, number][]} */
  const numerals = [
    ["M", 1000],
    ["CM", 900],
    ["D", 500],
    ["CD", 400],
    ["C", 100],
    ["XC", 90],
    ["L", 50],
    ["XL", 40],
    ["X", 10],
    ["IX", 9],
    ["V", 5],
    ["IV", 4],
    ["I", 1]
  ];
  let r = "",
    v = n;
  for (const [s, d] of numerals) {
    while (v >= d) {
      r += s;
      v -= d;
    }
  }
  return r || "I";
}

/**
 * Parse a Civ7 gameYear ("2725 BCE", "100 CE", "1842") into a signed integer
 * (BCE → negative). Numbers pass through.
 * @param {*} s The year string or number.
 * @returns {number|null} The signed year, or `null`.
 */
function parseYear(s) {
  if (typeof s !== "number") {
    if (typeof s !== "string") return null;
    const m = s.match(/(-?\d+)\s*(BCE|BC|CE|AD)?/i);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    if (!isFinite(n)) return null;
    const era = (m[2] || "").toUpperCase();
    return era === "BCE" || era === "BC" ? -n : n;
  }
  return s;
}

/**
 * Format a positive magnitude with a K/M/B suffix.
 * @param {number} n The value.
 * @returns {string} The formatted value ("—" for non-finite/non-positive).
 */
function formatMagnitude(n) {
  if (!isFinite(n) || n <= 0) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
}

// Collect every civ pid that's appeared in any war (with display labels) so
// the conflicts page filter dropdown can list them.
/**
 * List every civ that has appeared in any war, sorted majors-first then by
 * label, for the conflicts-page filter dropdown.
 * @param {DemoHistory|*} history The history blob.
 * @returns {{ pid: *, isCS: boolean, label: string }[]} The civ options.
 */
export function collectWarCivOptions(history) {
  const wars = history && Array.isArray(history.wars) ? history.wars : [];
  const seen = new Map();
  for (const w of wars) {
    const allRosters = /** @type {any[]} */ ([]).concat(w.sideACivs || [], w.sideBCivs || []);
    for (const r of allRosters) {
      if (!r || seen.has(r.pid)) continue;
      seen.set(r.pid, {
        pid: r.pid,
        isCS: !!r.isCS,
        label: r.leader ? r.leader + ", " + r.civ : r.civ
      });
    }
  }
  return Array.from(seen.values()).sort((a, b) => {
    if (a.isCS !== b.isCS) return a.isCS ? 1 : -1;
    return a.label.localeCompare(b.label);
  });
}

/**
 * Whether a war pits at least one major civ on each side.
 * @param {*} w The war record.
 * @returns {boolean} True for a major-vs-major war.
 */
function isMajorVsMajor(w) {
  return majorsOnSide(w.sideACivs).length > 0 && majorsOnSide(w.sideBCivs).length > 0;
}

/**
 * The major-civ pids participating in a war.
 * @param {*} w The war record.
 * @returns {*[]} The major pids.
 */
function majorPidsForWar(w) {
  return /** @type {any[]} */ ([])
    .concat(majorsOnSide(w.sideACivs), majorsOnSide(w.sideBCivs))
    .map((r) => r.pid);
}

/**
 * Filter wars to the major-vs-major engagements matching the active filters.
 * @param {*[]} wars The (sorted) war list.
 * @param {boolean} showActiveOnly Hide concluded wars when true.
 * @param {number|null} filterPid Limit to a specific civ, or null.
 * @returns {*[]} The filtered wars.
 */
function filterGanttWars(wars, showActiveOnly, filterPid) {
  return wars.filter((w) => {
    if (showActiveOnly && typeof w.endTurn === "number") return false;
    // Drop any war that doesn't pit at least one major on each side.
    if (!isMajorVsMajor(w)) return false;
    if (filterPid !== null) {
      if (!majorPidsForWar(w).map(Number).includes(Number(filterPid))) return false;
    }
    return true;
  });
}

/**
 * Compute the Gantt x-domain [xMin, xMax] from the filtered wars, honoring an
 * explicit time-range override.
 * @param {*[]} filtered The filtered wars.
 * @param {{ min: number, max: number }|null} tr Time-range filter, or null.
 * @param {number} latestTurn The latest sampled turn.
 * @param {Snapshot[]} samples The sample stream (for fallback).
 * @returns {{ xMin: number, xMax: number }} The x-domain.
 */
function computeGanttDomain(filtered, tr, latestTurn, samples) {
  const span = ganttWarSpan(filtered, tr, latestTurn);
  let xMin = span.xMin;
  let xMax = span.xMax;
  if (!isFinite(xMin)) xMin = samples[0]?.turn ?? 0;
  if (!isFinite(xMax)) xMax = latestTurn || xMin + 1;
  if (tr) {
    xMin = tr.min;
    xMax = tr.max;
  }
  if (xMin === xMax) xMax = xMin + 1;
  return { xMin, xMax };
}

/**
 * Compute the min start / max end turn across the in-range wars.
 * @param {*[]} filtered The filtered wars.
 * @param {{ min: number, max: number }|null} tr Time-range filter, or null.
 * @param {number} latestTurn The latest sampled turn.
 * @returns {{ xMin: number, xMax: number }} The raw span (may be infinite).
 */
function ganttWarSpan(filtered, tr, latestTurn) {
  let xMin = Infinity,
    xMax = -Infinity;
  for (const w of filtered) {
    const s = w.startTurn;
    const e = typeof w.endTurn === "number" ? w.endTurn : latestTurn;
    if (tr && (e < tr.min || s > tr.max)) continue;
    if (s < xMin) xMin = s;
    if (e > xMax) xMax = e;
  }
  return { xMin, xMax };
}

/**
 * Gantt layout + plot mappers.
 * @typedef {Object} GanttLayout
 * @property {number} padL Left pad.
 * @property {number} padT Top pad.
 * @property {number} innerW Plot width.
 * @property {number} innerH Plot height.
 * @property {number} H Final canvas height.
 * @property {number[]} rowTops Per-war row top offsets.
 * @property {number} barH Bar height.
 * @property {(t: number) => number} xOf Turn → pixel x.
 */

const GANTT_BAR_H = 24; // bar height (label fits comfortably inside)
const GANTT_ROW_GAP = 10; // gap between wars

/**
 * Build the Gantt layout: row offsets, final height, plot rect, x-mapper.
 * @param {number} W Canvas width.
 * @param {number} H0 Caller height floor.
 * @param {number} warCount The filtered war count.
 * @param {{ xMin: number, xMax: number }} dom The x-domain.
 * @returns {GanttLayout} The layout.
 */
function buildGanttLayout(W, H0, warCount, dom) {
  const padL = 60,
    padR = 60,
    padT = 30,
    padB = 64;
  // Pre-compute Y offsets so we can size H upfront — uniform row height.
  const rowTops = [];
  let accumY = padT + 6;
  for (let i = 0; i < warCount; i++) {
    rowTops.push(accumY);
    accumY += GANTT_BAR_H + GANTT_ROW_GAP;
  }
  const minInnerH = Math.max(120, accumY - padT - 6 + 16);
  const H = Math.max(H0, padT + minInnerH + padB);
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  return {
    padL,
    padT,
    innerW,
    innerH,
    H,
    rowTops,
    barH: GANTT_BAR_H,
    xOf: (t) => padL + ((t - dom.xMin) / (dom.xMax - dom.xMin || 1)) * innerW
  };
}

/**
 * Look up the latest sampled primary color for a pid, with a neutral fallback.
 * @param {Snapshot[]} samples The sample stream.
 * @param {*} pid Player id key.
 * @returns {string} The hex/css color.
 */
function currentPrimaryColor(samples, pid) {
  for (let i = samples.length - 1; i >= 0; i--) {
    const ps = samples[i]?.players?.[pid];
    if (ps && typeof ps.primaryColor === "string" && ps.primaryColor.length > 0) {
      return ps.primaryColor;
    }
  }
  return "#9aa8c8";
}

/**
 * Draw the Gantt background, year grid + ticks. Returns the tick positions for
 * HTML overlays.
 * @param {SVGElement} svg The chart SVG.
 * @param {GanttLayout} L The layout.
 * @param {{ xMin: number, xMax: number }} dom The x-domain.
 * @param {Map<number, string>} turnYearMap chart-turn → year map.
 * @returns {{ t: number, x: number, year: string|null }[]} The tick positions.
 */
function drawGanttGrid(svg, L, dom, turnYearMap) {
  svg.appendChild(
    svgEl("rect", {
      x: L.padL,
      y: L.padT,
      width: L.innerW,
      height: L.innerH,
      fill: "rgba(18, 20, 24, 0.85)",
      stroke: "#c9a24c",
      "stroke-width": "1"
    })
  );
  const xTicks = 6;
  const tickPositions = [];
  for (let i = 0; i <= xTicks; i++) {
    const t = Math.round(dom.xMin + ((dom.xMax - dom.xMin) * i) / xTicks);
    const x = L.xOf(t);
    svg.appendChild(
      svgEl("line", {
        x1: x,
        x2: x,
        y1: L.padT + L.innerH,
        y2: L.padT + L.innerH + 4,
        stroke: "#E5E5E5",
        "stroke-width": "1"
      })
    );
    // Vertical grid line — Chart.js neutral grid color.
    svg.appendChild(
      svgEl("line", {
        x1: x,
        x2: x,
        y1: L.padT,
        y2: L.padT + L.innerH,
        stroke: "rgba(133, 135, 140, 0.35)",
        "stroke-width": "1"
      })
    );
    tickPositions.push({ t, x, year: nearestByTurn(turnYearMap, t) });
  }
  return tickPositions;
}

/**
 * One war bar's hit-test rectangle.
 * @typedef {Object} BarRect
 * @property {*} war The war record.
 * @property {number} x Bar left.
 * @property {number} y Bar top.
 * @property {number} w Bar width.
 * @property {number} h Bar height.
 * @property {number} x2 Bar right.
 * @property {boolean} isClosed Whether the war concluded.
 */

/**
 * Draw one war bar (per-civ stripes, hairlines, outline, end marker) and
 * return its hit-test rect.
 * @param {SVGElement} svg The chart SVG.
 * @param {*} w The war record.
 * @param {GanttLayout} L The layout.
 * @param {{ xMin: number, xMax: number }} dom The x-domain.
 * @param {number} baseY The bar's top offset.
 * @param {number} latestTurn The latest sampled turn.
 * @param {Snapshot[]} samples The sample stream (for colors).
 * @returns {BarRect} The bar hit-test rect.
 */
function drawWarBar(svg, w, L, dom, baseY, latestTurn, samples) {
  const sTurn = w.startTurn;
  const eTurn = typeof w.endTurn === "number" ? w.endTurn : latestTurn;
  const x1 = L.xOf(Math.max(sTurn, dom.xMin));
  const x2 = L.xOf(Math.min(eTurn, dom.xMax));
  const isClosed = typeof w.endTurn === "number";
  const sem = getSemantic();
  // Build the full participant list (sideA first, then sideB) so the bar is
  // striped one band per civ. Side ordering preserved so allies sit together.
  const participants = /** @type {any[]} */ ([]).concat(
    majorsOnSide(w.sideACivs),
    majorsOnSide(w.sideBCivs)
  );
  const stripes =
    participants.length > 0
      ? participants
      : [
          { pid: null, color: sem.sideA_fallback },
          { pid: null, color: sem.sideB_fallback }
        ];
  const barW = Math.max(2, x2 - x1);
  drawWarBarStripes(svg, { stripes, samples, sem, x1, baseY, barW, barH: L.barH, isClosed });
  // Single outline around the combined bar.
  svg.appendChild(
    svgEl("rect", {
      x: x1,
      y: baseY,
      width: barW,
      height: L.barH,
      fill: "none",
      stroke: "#1c1408",
      "stroke-width": "1"
    })
  );
  drawWarBarEndMarker(svg, isClosed, x2, baseY, L.barH, sem);
  return { war: w, x: x1, y: baseY, w: barW, h: L.barH, x2, isClosed };
}

/**
 * Draw a war bar's per-civ color stripes plus the hairlines between them.
 * @param {SVGElement} svg The chart SVG.
 * @param {Object} args Stripe-drawing inputs.
 * @param {*[]} args.stripes The participant stripes.
 * @param {Snapshot[]} args.samples The sample stream (for colors).
 * @param {*} args.sem The semantic palette.
 * @param {number} args.x1 Bar left x.
 * @param {number} args.baseY Bar top y.
 * @param {number} args.barW Bar width.
 * @param {number} args.barH Bar height.
 * @param {boolean} args.isClosed Whether the war concluded.
 * @returns {void}
 */
function drawWarBarStripes(svg, args) {
  const { stripes, samples, sem, x1, baseY, barW, barH, isClosed } = args;
  const stripeH = barH / stripes.length;
  // One colored stripe per participating civ — height = BAR_H / N.
  stripes.forEach((c, idx) => {
    const fill =
      (typeof c.pid === "number" && currentPrimaryColor(samples, c.pid)) ||
      c.color ||
      (idx % 2 === 0 ? sem.sideA_fallback : sem.sideB_fallback);
    svg.appendChild(
      svgEl("rect", {
        x: x1,
        y: baseY + idx * stripeH,
        width: barW,
        height: stripeH,
        fill,
        "fill-opacity": isClosed ? "0.85" : "1"
      })
    );
  });
  // Thin hairlines between adjacent stripes so 3+ civ wars don't blur.
  for (let s = 1; s < stripes.length; s++) {
    svg.appendChild(
      svgEl("line", {
        x1: x1,
        x2: x1 + barW,
        y1: baseY + s * stripeH,
        y2: baseY + s * stripeH,
        stroke: "rgba(28, 20, 8, 0.55)",
        "stroke-width": "0.7"
      })
    );
  }
}

/**
 * Draw a war bar's right-edge marker: a hatch (concluded) or a circle (ongoing).
 * @param {SVGElement} svg The chart SVG.
 * @param {boolean} isClosed Whether the war concluded.
 * @param {number} x2 Bar right x.
 * @param {number} baseY Bar top.
 * @param {number} barH Bar height.
 * @param {*} sem The semantic palette.
 * @returns {void}
 */
function drawWarBarEndMarker(svg, isClosed, x2, baseY, barH, sem) {
  if (isClosed) {
    svg.appendChild(
      svgEl("line", {
        x1: x2,
        x2: x2,
        y1: baseY,
        y2: baseY + barH,
        stroke: "#1c1408",
        "stroke-width": "2"
      })
    );
  } else {
    svg.appendChild(
      svgEl("circle", {
        cx: x2,
        cy: baseY + barH / 2,
        r: 5,
        fill: sem.ongoing_marker,
        stroke: "#1c1408",
        "stroke-width": "0.5"
      })
    );
  }
}

/**
 * Draw every filtered war's bar, returning the hit-test rects.
 * @param {SVGElement} svg The chart SVG.
 * @param {*[]} filtered The filtered wars.
 * @param {GanttLayout} L The layout.
 * @param {{ xMin: number, xMax: number }} dom The x-domain.
 * @param {{ min: number, max: number }|null} tr Time-range filter, or null.
 * @param {number} latestTurn The latest sampled turn.
 * @param {Snapshot[]} samples The sample stream.
 * @returns {BarRect[]} The bar hit-test rects.
 */
function drawWarBars(svg, filtered, L, dom, tr, latestTurn, samples) {
  /** @type {BarRect[]} */
  const barRects = [];
  for (let i = 0; i < filtered.length; i++) {
    const w = filtered[i];
    const eTurn = typeof w.endTurn === "number" ? w.endTurn : latestTurn;
    if (tr && (eTurn < tr.min || w.startTurn > tr.max)) continue;
    barRects.push(drawWarBar(svg, w, L, dom, L.rowTops[i], latestTurn, samples));
  }
  return barRects;
}

/**
 * Compute a war's duration in years from its year strings, falling back to the
 * turn count.
 * @param {*} war The war record.
 * @param {Map<number, string>} turnYearMap chart-turn → year map.
 * @param {number} latestTurn The latest sampled turn.
 * @returns {number} The duration in years (>=1).
 */
function warDurationYears(war, turnYearMap, latestTurn) {
  const sY = parseYear(war.startYear);
  const eY =
    typeof war.endTurn === "number"
      ? parseYear(war.endYear)
      : parseYear(turnYearMap.get(latestTurn));
  if (sY !== null && eY !== null) {
    const d = Math.abs(eY - sY);
    return d > 0 ? d : 1;
  }
  // Fallback: turn-count when years aren't available.
  const t = (typeof war.endTurn === "number" ? war.endTurn : latestTurn) - war.startTurn;
  return Math.max(1, t);
}

/**
 * Build the per-war display-name override map: ordinal-numbered recurring
 * matchups, tripartite/great-war/world-war labels, and duration flair.
 * @param {*[]} filtered The filtered wars.
 * @param {Map<number, string>} turnYearMap chart-turn → year map.
 * @param {number} latestTurn The latest sampled turn.
 * @returns {Map<*, string>} war → display label.
 */
function buildWarNameOverrides(filtered, turnYearMap, latestTurn) {
  /** @type {Map<*, string>} */
  const nameOverride = new Map();
  // Count prior wars with the EXACT same participant set so we can
  // ordinal-number recurring matchups ("Second Roman-Carthaginian War").
  /** @type {Map<string, number>} */
  const pairCounts = new Map();
  /** @type {*[]} */
  const worldWars = []; // chronological order (for "World War N")
  const sorted = filtered.slice().sort((a, b) => (a.startTurn || 0) - (b.startTurn || 0));
  for (const w of sorted) {
    const yrs = warDurationYears(w, turnYearMap, latestTurn);
    const n = majorsOnSide(w.sideACivs).length + majorsOnSide(w.sideBCivs).length;
    let label = composeWarLabel(w, pairCounts, worldWars);
    // Duration flair — long protracted conflicts get a flavor prefix.
    if (yrs >= 100 && n < 6) {
      label = label.replace(/ War$/, "") + " (Hundred Years' War)";
    } else if (yrs >= 50 && n < 6) {
      label = label.replace(/ War$/, "") + " (Long War)";
    }
    nameOverride.set(w, label);
  }
  return nameOverride;
}

/**
 * Compose a war's base name by participant count (world / great / tripartite /
 * bilateral / fallback), advancing the pair-count and world-war state.
 * @param {*} w The war record.
 * @param {Map<string, number>} pairCounts Recurring-matchup counts (mutated).
 * @param {*[]} worldWars World-war list (mutated, for numbering).
 * @returns {string} The base label.
 */
function composeWarLabel(w, pairCounts, worldWars) {
  const a = majorsOnSide(w.sideACivs);
  const b = majorsOnSide(w.sideBCivs);
  const n = a.length + b.length;
  // Pass the FULL roster object so civAdjective can use civTypeString.
  const adjA = a.map((r) => civAdjective(r));
  const adjB = b.map((r) => civAdjective(r));
  if (n >= 6) {
    worldWars.push(w);
    return "World War " + romanize(worldWars.length);
  }
  if (n >= 4) {
    return "Great War: " + adjA[0] + " vs " + adjB[0] + " (+" + (n - 2) + " civs)";
  }
  if (n === 3) {
    return "Tripartite " + /** @type {any[]} */ ([]).concat(adjA, adjB).sort().join("–") + " War";
  }
  if (n === 2) {
    // Standard bilateral. Build a stable adjective key (alpha order) so reruns
    // of the same matchup get ordinal suffixes ("Second Roman-Egyptian War").
    const pair = [adjA[0] || "Unknown", adjB[0] || "Unknown"].sort();
    const key = pair.join("|");
    const count = (pairCounts.get(key) || 0) + 1;
    pairCounts.set(key, count);
    return ordinalInt(count) + " " + pair[0] + "–" + pair[1] + " War";
  }
  return w.name; // single-party / odd fallback
}

/**
 * Mount the per-bar war-name labels (inside each bar) into the wrap.
 * @param {HTMLElement} wrap The chart wrap.
 * @param {BarRect[]} barRects The bar rects.
 * @param {Map<*, string>} nameOverride war → display label.
 * @param {Map<number, string>} turnYearMap chart-turn → year map.
 * @param {number} latestTurn The latest sampled turn.
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 * @returns {void}
 */
function mountWarLabels(wrap, barRects, nameOverride, turnYearMap, latestTurn, W, H) {
  barRects.forEach(({ war, x, y, w, h }) => {
    const yrs = warDurationYears(war, turnYearMap, latestTurn);
    const displayName = nameOverride.get(war) || war.name;
    const yrLabel =
      yrs === 1
        ? t("LOC_DEMOGRAPHICS_WARS_DURATION_YR_ONE", yrs)
        : t("LOC_DEMOGRAPHICS_WARS_DURATION_YR", yrs);
    const label = displayName + "  ·  " + yrLabel;
    const div = document.createElement("div");
    div.className = "demographics-chart-war-label demographics-wars-label";
    // Per-bar geometry stays dynamic (pixel-derived percentages).
    div.style.left = (x / W) * 100 + "%";
    div.style.top = ((y + h / 2) / H) * 100 + "%";
    div.style.width = (w / W) * 100 + "%";
    div.textContent = label;
    wrap.appendChild(div);
  });
}

/**
 * Mount the Gantt X-tick HTML labels (year and/or turn per axis mode).
 * @param {HTMLElement} wrap The chart wrap.
 * @param {{ t: number, x: number, year: string|null }[]} tickPositions Ticks.
 * @param {GanttLayout} L The layout.
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 * @returns {void}
 */
function mountGanttXTicks(wrap, tickPositions, L, W, H) {
  tickPositions.forEach((tick) => {
    const div = document.createElement("div");
    div.className = "demographics-chart-x-tick demographics-wars-x-tick";
    // Per-tick position stays dynamic (pixel-derived percentages).
    div.style.left = (tick.x / W) * 100 + "%";
    div.style.top = ((L.padT + L.innerH + 8) / H) * 100 + "%";
    if (getXAxisMode() !== "turn" && tick.year) {
      const yr = document.createElement("div");
      yr.className = "demographics-chart-x-tick-year";
      yr.textContent = tick.year;
      div.appendChild(yr);
    }
    if (getXAxisMode() !== "year" || !tick.year) {
      const tn = document.createElement("div");
      tn.className = "demographics-chart-x-tick-turn";
      tn.textContent =
        getXAxisMode() === "both" && tick.year ? "(T-" + tick.t + ")" : "T-" + tick.t;
      div.appendChild(tn);
    }
    wrap.appendChild(div);
  });
}

/**
 * Mount the Gantt axis titles.
 * @param {HTMLElement} wrap The chart wrap.
 * @param {GanttLayout} L The layout.
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 * @returns {void}
 */
function mountGanttAxisTitles(wrap, L, W, H) {
  const xTitle = document.createElement("div");
  xTitle.className =
    "demographics-chart-axis-title demographics-chart-axis-x demographics-wars-axis-title demographics-wars-axis-x";
  // Per-axis position stays dynamic (pixel-derived percentages).
  xTitle.style.left = ((L.padL + L.innerW / 2) / W) * 100 + "%";
  xTitle.style.top = ((H - 4) / H) * 100 + "%";
  xTitle.textContent = t("LOC_DEMOGRAPHICS_AXIS_TIME");
  wrap.appendChild(xTitle);
  const yTitle = document.createElement("div");
  yTitle.className =
    "demographics-chart-axis-title demographics-chart-axis-y demographics-wars-axis-title demographics-wars-axis-y";
  yTitle.style.left = (12 / W) * 100 + "%";
  yTitle.style.top = ((L.padT + L.innerH / 2) / H) * 100 + "%";
  yTitle.textContent = t("LOC_DEMOGRAPHICS_AXIS_CONFLICTS");
  wrap.appendChild(yTitle);
}

/**
 * Build one participant's metric series across the samples in a window.
 * @param {Snapshot[]} windowSamples Samples inside the participant's active window.
 * @param {Pid | string} pid The participant pid.
 * @param {string} metricId Metric key (e.g. "milpower").
 * @returns {number[]} The participant's values (samples lacking the value skipped).
 */
function participantMetricSeries(windowSamples, pid, metricId) {
  const series = [];
  for (const s of windowSamples) {
    const v = s?.players?.[pid]?.metrics?.[metricId];
    if (typeof v === "number" && isFinite(v)) series.push(v);
  }
  return series;
}

/**
 * Maximum drawdown of a series: the largest drop from a running peak. Returns 0
 * when the series only ever rises, so "losses" are never fabricated from growth.
 * @param {number[]} values The series.
 * @returns {number} The largest peak→trough decline.
 */
function maxDrawdown(values) {
  let peak = -Infinity;
  let maxDD = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    if (peak - v > maxDD) maxDD = peak - v;
  }
  return maxDD;
}

/**
 * One side's observed cost over a war window. Fields are null when the samples
 * don't cover the window (fewer than two data points).
 * @typedef {Object} SideWarCost
 * @property {number | null} milLost Military-strength drawdown.
 * @property {number | null} settlementsLost Settlement-count drawdown.
 * @property {number | null} popLost Population drawdown.
 * @property {number | null} prodChange Net production change (signed: +gain / -loss).
 */

/**
 * The metrics that make up a side's war cost, each mapped to the result field
 * it feeds and how its series reduces to a figure: `"drawdown"` (peak→trough
 * loss) or `"net"` (signed end−start change).
 * @type {{ id: string, key: string, mode: "drawdown" | "net" }[]}
 */
const COST_METRICS = [
  { id: "milpower", key: "milLost", mode: "drawdown" },
  { id: "settlements", key: "settlementsLost", mode: "drawdown" },
  { id: "population", key: "popLost", mode: "drawdown" },
  { id: "production", key: "prodChange", mode: "net" }
];

/**
 * Reduce a participant's metric series to its cost contribution.
 * @param {number[]} series The metric series over the participation window.
 * @param {"drawdown" | "net"} mode Drawdown (loss) or signed net change.
 * @returns {number | null} The contribution, or null when fewer than two points.
 */
function reduceCostSeries(series, mode) {
  if (series.length < 2) return null;
  return mode === "net" ? series[series.length - 1] - series[0] : maxDrawdown(series);
}

/**
 * A side's observed cost as a FULL accounting across every civ that ever fought
 * on it — each measured only over the turns it was actually in the war
 * ([joinTurn, leaveTurn || war end]), so a civ that withdrew still counts for
 * the stretch it participated. Per-metric figures are null when no participant
 * has enough data.
 * @param {Snapshot[]} samples The full sample stream.
 * @param {import("/demographics/ui/sampler-wars.js").WarParticipant[]} participants
 *   The side's cumulative roster.
 * @param {number} warStart The war's start turn.
 * @param {number} warEnd The war's end turn (or latest sampled turn if ongoing).
 * @returns {SideWarCost} Summed per-metric figures.
 */
function sideCostFull(samples, participants, warStart, warEnd) {
  /** @type {Record<string, number | null>} */
  const acc = { milLost: null, settlementsLost: null, popLost: null, prodChange: null };
  for (const p of participants || []) {
    const jt = typeof p?.joinTurn === "number" ? p.joinTurn : warStart;
    const lt = typeof p?.leaveTurn === "number" ? p.leaveTurn : warEnd;
    const win = samples.filter((s) => typeof s?.turn === "number" && s.turn >= jt && s.turn <= lt);
    for (const m of COST_METRICS) {
      const v = reduceCostSeries(participantMetricSeries(win, p.pid, m.id), m.mode);
      if (v !== null) {
        const cur = acc[m.key];
        acc[m.key] = (cur === null ? 0 : cur) + v;
      }
    }
  }
  return {
    milLost: acc.milLost,
    settlementsLost: acc.settlementsLost,
    popLost: acc.popLost,
    prodChange: acc.prodChange
  };
}

/**
 * Compute both sides' war cost as a full accounting over the war's whole life:
 * every civ that ever fought, each measured over its own participation window,
 * summed per side. Derived entirely from real samples (no invented formula);
 * an honest "observed change during the war" (correlation, not proven cause).
 * @param {*} war The war record (startTurn / endTurn / sideACivs / sideBCivs).
 * @param {Snapshot[]} samples The full sample stream.
 * @param {number} latestTurn The latest sampled turn (window end for ongoing wars).
 * @returns {{ a: SideWarCost, b: SideWarCost }} Per-side costs.
 */
function computeWarCost(war, samples, latestTurn) {
  const warStart = typeof war.startTurn === "number" ? war.startTurn : 0;
  const warEnd = typeof war.endTurn === "number" ? war.endTurn : latestTurn;
  return {
    a: sideCostFull(samples, war.sideACivs || [], warStart, warEnd),
    b: sideCostFull(samples, war.sideBCivs || [], warStart, warEnd)
  };
}

/**
 * The roster lines (per major civ) for a war side.
 * @param {*[]} roster A war side's roster.
 * @returns {string[]} The "Leader, Civ" lines (or a placeholder).
 */
function warRosterLines(roster) {
  const majors = majorsOnSide(roster);
  if (majors.length === 0) return [t("LOC_DEMOGRAPHICS_WARS_NO_MAJOR_CIVS")];
  return majors.map((r) => {
    const base = r.leader ? r.leader + ", " + r.civ : r.civ;
    // Departed civs stay in the roster (full participation history) but are
    // marked with the turn they withdrew.
    if (r.active === false && typeof r.leaveTurn === "number") {
      return base + " (" + t("LOC_DEMOGRAPHICS_WARS_WITHDREW", r.leaveTurn) + ")";
    }
    return base;
  });
}

/**
 * Concise civ-name label for a war side, so the war-cost readout names who
 * suffered the loss (e.g. "Rome" or "Rome & Egypt") instead of "Attackers".
 * @param {*[]} roster A war side's roster.
 * @returns {string} The side's major-civ names joined, or a fallback.
 */
function sideCivLabel(roster) {
  const majors = majorsOnSide(roster);
  if (majors.length === 0) return t("LOC_DEMOGRAPHICS_WARS_NO_MAJOR_CIVS");
  return majors.map((r) => r.civ).join(" & ");
}

/**
 * Build the structured tooltip body for a war.
 * @param {*} w The war record.
 * @param {Object} ctx Shared Gantt context.
 * @param {Map<*, string>} ctx.nameOverride war → display label.
 * @param {Map<number, string>} ctx.turnYearMap chart-turn → year map.
 * @param {number} ctx.latestTurn The latest sampled turn.
 * @param {Snapshot[]} ctx.samples The sample stream.
 * @returns {Record<string, *>} The tooltip body fields.
 */
function buildWarTooltipBody(w, ctx) {
  const { nameOverride, turnYearMap, latestTurn, samples } = ctx;
  const sTurn = w.startTurn;
  const eTurn = typeof w.endTurn === "number" ? w.endTurn : latestTurn;
  const startYr = w.startYear || "T-" + sTurn;
  const endYr =
    typeof w.endTurn === "number" ? w.endYear || "T-" + eTurn : t("LOC_DEMOGRAPHICS_WARS_ONGOING");
  const yrs = warDurationYears(w, turnYearMap, latestTurn);
  const turns = eTurn - sTurn;
  const cost = computeWarCost(w, samples, latestTurn);
  const declared = warDeclaredBy(w);
  return {
    // Use the World War override when 4+ civs are involved; fall back to the
    // bilateral name otherwise.
    title: nameOverride.get(w) || w.name,
    status:
      typeof w.endTurn === "number"
        ? t("LOC_DEMOGRAPHICS_WARS_STATUS_CONCLUDED")
        : t("LOC_DEMOGRAPHICS_WARS_STATUS_ONGOING"),
    sideA: warRosterLines(w.sideACivs),
    sideB: warRosterLines(w.sideBCivs),
    declared,
    startYr,
    endYr,
    yrs,
    turns,
    cost,
    costLabels: { a: sideCivLabel(w.sideACivs), b: sideCivLabel(w.sideBCivs) }
  };
}

/**
 * The "declared by" line for a war (its major declarer, else "unknown").
 * @param {*} w The war record.
 * @returns {string} The declarer label.
 */
function warDeclaredBy(w) {
  if (!w.declaredBy || w.declaredBy.isCS) return t("LOC_DEMOGRAPHICS_WARS_DECLARED_UNKNOWN");
  return w.declaredBy.leader ? w.declaredBy.leader + ", " + w.declaredBy.civ : w.declaredBy.civ;
}

/**
 * Render the tooltip DOM for a war into the shared tooltip element.
 * @param {HTMLElement} tooltip The tooltip element (cleared and repopulated).
 * @param {*} w The war record.
 * @param {*} ctx Shared Gantt context (see {@link buildWarTooltipBody}).
 * @returns {void}
 */
function renderWarTooltip(tooltip, w, ctx) {
  const tip = buildWarTooltipBody(w, ctx);
  while (tooltip.firstChild) tooltip.removeChild(tooltip.firstChild);
  const head = document.createElement("div");
  head.className = "demographics-wars-tooltip-head";
  head.textContent = tip.title + "  [" + tip.status + "]";
  tooltip.appendChild(head);
  appendTooltipSection(tooltip, t("LOC_DEMOGRAPHICS_WARS_ATTACKERS"), tip.sideA);
  appendTooltipSection(tooltip, t("LOC_DEMOGRAPHICS_WARS_DEFENDERS"), tip.sideB);
  const meta = document.createElement("div");
  meta.className = "demographics-wars-tooltip-meta";
  meta.innerHTML =
    escapeHtml(t("LOC_DEMOGRAPHICS_WARS_DECLARED_BY", tip.declared)) +
    "<br>" +
    escapeHtml(t("LOC_DEMOGRAPHICS_WARS_DURATION", tip.yrs)) +
    " (" +
    escapeHtml(tip.startYr) +
    " → " +
    escapeHtml(tip.endYr) +
    ", " +
    escapeHtml(t("LOC_DEMOGRAPHICS_WARS_DURATION_TURNS", tip.turns)) +
    ")";
  tooltip.appendChild(meta);
  appendWarCost(tooltip, tip.cost, tip.costLabels);
}

/**
 * Format one side's war cost as a compact line. Losses render as "−N", net
 * production change is signed, and missing data renders as "—".
 * @param {SideWarCost} c The side cost.
 * @returns {string} The formatted line.
 */
function formatSideCost(c) {
  const lost = (/** @type {number | null} */ n) => {
    if (n === null) return "—";
    const r = Math.round(n);
    return r <= 0 ? "0" : "−" + formatMagnitude(r);
  };
  const signed = (/** @type {number | null} */ n) => {
    if (n === null) return "—";
    const r = Math.round(n);
    if (r === 0) return "0";
    return (r > 0 ? "+" : "−") + formatMagnitude(Math.abs(r));
  };
  return (
    t("LOC_DEMOGRAPHICS_WARS_COST_STRENGTH", lost(c.milLost)) +
    " · " +
    t("LOC_DEMOGRAPHICS_WARS_COST_SETTLEMENTS", lost(c.settlementsLost)) +
    " · " +
    t("LOC_DEMOGRAPHICS_WARS_COST_POP", lost(c.popLost)) +
    " · " +
    t("LOC_DEMOGRAPHICS_WARS_COST_PRODUCTION", signed(c.prodChange))
  );
}

/**
 * Append the per-side observed war-cost section to the tooltip, labeling each
 * side by its civ name(s) so it's clear who suffered the loss. All figures are
 * derived from the sampled time-series over the war window (no invented data).
 * @param {HTMLElement} tooltip The tooltip element.
 * @param {{ a: SideWarCost, b: SideWarCost }} cost Per-side costs.
 * @param {{ a: string, b: string }} labels Per-side civ-name labels.
 * @returns {void}
 */
function appendWarCost(tooltip, cost, labels) {
  const block = document.createElement("div");
  block.className = "demographics-wars-tooltip-cost";
  block.innerHTML =
    escapeHtml(t("LOC_DEMOGRAPHICS_WARS_COST_HEADER")) +
    ' <span style="opacity:0.65;">' +
    escapeHtml(t("LOC_DEMOGRAPHICS_WARS_COST_OBSERVED")) +
    "</span>:" +
    "<br>" +
    escapeHtml(labels.a) +
    " — " +
    formatSideCost(cost.a) +
    "<br>" +
    escapeHtml(labels.b) +
    " — " +
    formatSideCost(cost.b);
  tooltip.appendChild(block);
}

/**
 * Append a labeled bullet section to the war tooltip.
 * @param {HTMLElement} tooltip The tooltip element.
 * @param {string} label The section label.
 * @param {string[]} lines The bullet lines.
 * @returns {void}
 */
function appendTooltipSection(tooltip, label, lines) {
  const h = document.createElement("div");
  h.className = "demographics-wars-tooltip-section-label";
  h.textContent = label;
  tooltip.appendChild(h);
  lines.forEach((l) => {
    const r = document.createElement("div");
    r.className = "demographics-wars-tooltip-section-line";
    r.textContent = "• " + l;
    tooltip.appendChild(r);
  });
}

/**
 * Create the shared Gantt hover-tooltip element (hidden, absolute).
 * @returns {HTMLElement} The tooltip element.
 */
function createGanttTooltip() {
  const tooltip = document.createElement("div");
  tooltip.className = "demographics-chart-hover-tooltip demographics-wars-tooltip";
  // Hidden until a bar is hovered — visibility is toggled live by the hover
  // wiring, so it stays inline.
  tooltip.style.display = "none";
  return tooltip;
}

/**
 * Hit-test a point (in SVG coords) against the war bar rects.
 * @param {BarRect[]} barRects The bar rects.
 * @param {number} svgX The SVG-space x.
 * @param {number} svgY The SVG-space y.
 * @returns {*} The war under the point, or `null`.
 */
function hitTestBars(barRects, svgX, svgY) {
  for (const r of barRects) {
    if (svgX >= r.x && svgX <= r.x + r.w && svgY >= r.y && svgY <= r.y + r.h) return r.war;
  }
  return null;
}

/**
 * Wire the Gantt's mousemove/leave hover tooltip behavior.
 * @param {Object} args Wiring inputs.
 * @param {HTMLElement} args.wrap The chart wrap.
 * @param {SVGElement} args.svg The chart SVG.
 * @param {HTMLElement} args.tooltip The tooltip element.
 * @param {BarRect[]} args.barRects The bar rects.
 * @param {Object} args.ctx Shared Gantt context (for tooltip rendering).
 * @param {number} args.W Canvas width.
 * @param {number} args.H Canvas height.
 * @returns {void}
 */
function wireGanttHover(args) {
  const { wrap, svg, tooltip, barRects, ctx, W, H } = args;
  wrap.addEventListener("mousemove", (ev) => {
    const rect = svg.getBoundingClientRect();
    if (!rect || rect.width === 0) {
      tooltip.style.display = "none";
      return;
    }
    const sx = ((ev.clientX - rect.left) / rect.width) * W;
    const sy = ((ev.clientY - rect.top) / rect.height) * H;
    const w = hitTestBars(barRects, sx, sy);
    if (!w) {
      tooltip.style.display = "none";
      return;
    }
    renderWarTooltip(tooltip, w, ctx);
    const wrapRect = wrap.getBoundingClientRect();
    tooltip.style.left = ev.clientX - wrapRect.left + 14 + "px";
    tooltip.style.top = ev.clientY - wrapRect.top + 14 + "px";
    tooltip.style.display = "block";
  });
  wrap.addEventListener("mouseleave", () => {
    tooltip.style.display = "none";
  });
}

/**
 * Options accepted by {@link renderWarsGantt}.
 * @typedef {Object} GanttOptions
 * @property {DemoHistory|*} [history] The history blob (wars + samples).
 * @property {number} [width] Canvas width.
 * @property {number} [height] Canvas height floor.
 * @property {number} [filterPid] Limit to a specific civ.
 * @property {boolean} [activeOnly] Hide concluded wars.
 * @property {{ min: number, max: number }} [turnRange] Time-range filter.
 */

/**
 * Render the conflicts Gantt timeline (one bar per major-vs-major war) into
 * `host`, with per-civ stripes, in-bar labels, and a hover tooltip.
 * @param {HTMLElement} host The view host element (cleared and repopulated).
 * @param {GanttOptions} [options] Render options.
 * @returns {{ svg: SVGElement }|null} The mounted SVG handle, or `null`.
 */
export function renderWarsGantt(host, options) {
  if (!host) return null;
  while (host.firstChild) host.removeChild(host.firstChild);
  const opts = options || {};
  const W = opts.width || 1400;
  const prep = prepareGanttData(host, opts);
  if (!prep) return null;
  const { wars, filtered, latestTurn, samples, filterPid, showActiveOnly } = prep;

  const tr = resolveTurnRange(opts);
  const dom = computeGanttDomain(filtered, tr, latestTurn, samples);
  const L = buildGanttLayout(W, opts.height || 600, filtered.length, dom);
  const H = L.H;
  const turnYearMap = buildStackTurnYears(samples);
  const env = { turnYearMap, latestTurn, samples, W, H };

  const { svg, barRects, tickPositions } = buildGanttSvg(filtered, L, dom, tr, env);
  const wrap = mountGanttWrap(svg, { filtered, barRects, tickPositions, L, ...env });

  host.appendChild(wrap);
  dlog(
    "wars gantt mounted; wars=",
    wars.length,
    "filtered=" + filtered.length,
    "filterPid=" + filterPid,
    "activeOnly=" + showActiveOnly
  );
  return { svg };
}

/**
 * Prepared Gantt data: the sorted wars, the filtered subset, and filter flags.
 * @typedef {Object} GanttPrep
 * @property {*[]} wars The sorted war list.
 * @property {*[]} filtered The filtered subset.
 * @property {number} latestTurn The latest sampled turn.
 * @property {Snapshot[]} samples The sample stream.
 * @property {number|null} filterPid Active civ filter, or null.
 * @property {boolean} showActiveOnly Whether concluded wars are hidden.
 */

/**
 * Read + sort + filter the wars; render the appropriate empty notice and
 * return `null` when there's nothing to draw.
 * @param {HTMLElement} host The view host (for empty notices).
 * @param {GanttOptions} opts The render options.
 * @returns {GanttPrep|null} The prepared data, or `null`.
 */
function prepareGanttData(host, opts) {
  /** @type {any[]} */
  const wars = opts.history && Array.isArray(opts.history.wars) ? opts.history.wars.slice() : [];
  const samples = historySamples(opts.history);
  if (wars.length === 0) {
    appendEmptyNotice(host, t("LOC_DEMOGRAPHICS_EMPTY_NO_WARS"));
    return null;
  }
  wars.sort((a, b) => (a.startTurn || 0) - (b.startTurn || 0));
  const latestTurn = samples.length > 0 ? (samples[samples.length - 1].turn ?? 0) : 0;
  // Filter pipeline: city states are dropped — this is a major-civ engagement
  // timeline. Coalition wars between two majors still show, but only major
  // civs are rendered as bars.
  const filterPid = typeof opts.filterPid === "number" ? opts.filterPid : null;
  const showActiveOnly = !!opts.activeOnly;
  const filtered = filterGanttWars(wars, showActiveOnly, filterPid);
  if (filtered.length === 0) {
    appendEmptyNotice(host, t("LOC_DEMOGRAPHICS_EMPTY_NO_WARS_MATCH"));
    return null;
  }
  return { wars, filtered, latestTurn, samples, filterPid, showActiveOnly };
}

/**
 * Build the Gantt SVG (background grid + ticks + war bars).
 * @param {*[]} filtered The filtered wars.
 * @param {GanttLayout} L The layout.
 * @param {{ xMin: number, xMax: number }} dom The x-domain.
 * @param {{ min: number, max: number }|null} tr Time-range filter, or null.
 * @param {*} env Shared environment (turnYearMap, latestTurn, samples, W, H).
 * @returns {{ svg: SVGElement, barRects: BarRect[], tickPositions: { t: number, x: number, year: string|null }[] }}
 *   The SVG, bar rects, and x-tick positions.
 */
function buildGanttSvg(filtered, L, dom, tr, env) {
  const { turnYearMap, latestTurn, samples, W, H } = env;
  const svg = svgEl("svg", {
    xmlns: SVG_NS,
    viewBox: `0 0 ${W} ${H}`,
    width: String(W),
    height: String(H),
    preserveAspectRatio: "none",
    class: "demographics-chart-svg",
    "aria-label": "Conflicts timeline"
  });
  const tickPositions = drawGanttGrid(svg, L, dom, turnYearMap);
  const barRects = drawWarBars(svg, filtered, L, dom, tr, latestTurn, samples);
  return { svg, barRects, tickPositions };
}

/**
 * Build the Gantt wrap and mount all HTML overlays (x-ticks, axis titles,
 * war labels) plus the hover tooltip.
 * @param {SVGElement} svg The chart SVG.
 * @param {Object} env Shared environment.
 * @param {*[]} env.filtered The filtered wars.
 * @param {BarRect[]} env.barRects The bar rects.
 * @param {{ t: number, x: number, year: string|null }[]} env.tickPositions Ticks.
 * @param {GanttLayout} env.L The layout.
 * @param {Map<number, string>} env.turnYearMap chart-turn → year map.
 * @param {number} env.latestTurn The latest sampled turn.
 * @param {Snapshot[]} env.samples The sample stream.
 * @param {number} env.W Canvas width.
 * @param {number} env.H Canvas height.
 * @returns {HTMLElement} The chart wrap.
 */
function mountGanttWrap(svg, env) {
  const { filtered, barRects, tickPositions, L, turnYearMap, latestTurn, samples, W, H } = env;
  const wrap = document.createElement("div");
  wrap.className = "demographics-chart-wrap demographics-wars-wrap";
  wrap.appendChild(svg);

  mountGanttXTicks(wrap, tickPositions, L, W, H);
  mountGanttAxisTitles(wrap, L, W, H);

  const nameOverride = buildWarNameOverrides(filtered, turnYearMap, latestTurn);
  mountWarLabels(wrap, barRects, nameOverride, turnYearMap, latestTurn, W, H);

  // Hover tooltip — custom callout replacing the unreliable `title` attribute.
  const tooltip = createGanttTooltip();
  wrap.appendChild(tooltip);
  const ctx = { nameOverride, turnYearMap, latestTurn, samples };
  wireGanttHover({ wrap, svg, tooltip, barRects, ctx, W, H });
  return wrap;
}
