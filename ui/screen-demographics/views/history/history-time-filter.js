// history-time-filter.js
//
// Time-range filtering for the "Historical Data" view: resolving a filter id to
// an inclusive {min, max} turn window, plus the pill row that lets the player
// pick a window. All filters are selectable, including the cross-age Age I/II/III
// windows (history is retained across ages via the GameConfiguration backend).

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { makeClickable } from "/demographics/ui/core/demographics-a11y.js";
import { playActivate } from "/demographics/ui/core/demographics-audio.js";
import {
  computeAgeOffsets,
  sampleX
} from "/demographics/ui/screen-demographics/charts/line/chart-line-axis.js";

/**
 * A single time-range filter pill definition.
 * @typedef {Object} TimeFilterDef
 * @property {string} id Stable filter id ("25", "age", "all", ...).
 * @property {string} label Pill caption.
 * @property {boolean} [disabled] When true the pill is skipped (not rendered).
 */

/**
 * Inclusive turn window the chart clamps to, or null for the full domain.
 * @typedef {Object} TurnRange
 * @property {number} min First turn shown.
 * @property {number} max Last turn shown.
 */

const DBG = false;
/**
 * Debug logger, no-op unless {@link DBG} is set.
 * @param {...*} a Values to log.
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.history-time-filter]", ...a);
}

// ─── Time-range filter helpers ──────────────────────────────────────────────
// Each filter resolves to a {min, max} turn range that the chart clamps to.
// "all" returns null (chart uses its natural full domain).

/** @type {TimeFilterDef[]} */
export const TIME_FILTERS = [
  { id: "25", label: "LOC_DEMOGRAPHICS_FILTER_25Y" },
  { id: "50", label: "LOC_DEMOGRAPHICS_FILTER_50Y" },
  { id: "100", label: "LOC_DEMOGRAPHICS_FILTER_100Y" },
  { id: "300", label: "LOC_DEMOGRAPHICS_FILTER_300Y" },
  { id: "500", label: "LOC_DEMOGRAPHICS_FILTER_500Y" },
  { id: "1000", label: "LOC_DEMOGRAPHICS_FILTER_1000Y" },
  { id: "age", label: "LOC_DEMOGRAPHICS_FILTER_CURRENT_AGE" },
  { id: "age1", label: "LOC_DEMOGRAPHICS_FILTER_AGE1" },
  { id: "age2", label: "LOC_DEMOGRAPHICS_FILTER_AGE2" },
  { id: "age3", label: "LOC_DEMOGRAPHICS_FILTER_AGE3" },
  { id: "all", label: "LOC_DEMOGRAPHICS_FILTER_ALL_TIME" }
];

/**
 * Parse "2375 BCE" → -2375 ; "300 CE" → 300 ; "1450" (no era) → 1450.
 * @param {*} s The game-year string.
 * @returns {number|undefined} Signed year, or undefined when unparseable.
 */
function parseGameYear(s) {
  if (typeof s !== "string") return undefined;
  const m = s.match(/(-?\d+)\s*(BCE|BC|AD|CE)?/i);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  if (!isFinite(n)) return undefined;
  const era = (m[2] || "").toUpperCase();
  return era === "BCE" || era === "BC" ? -n : n;
}

/**
 * Build a turn → signed-year map from the history's samples.
 * @param {DemoHistory|undefined} history The persisted history blob.
 * @returns {Map<number, number>} Turn-to-year lookup.
 */
function buildTurnYearMap(history) {
  /** @type {Map<number, number>} */
  const m = new Map();
  const mapped = mapSamplesToChartX(history);
  for (const s of mapped) {
    if (typeof s.x === "number" && typeof s.gameYear === "string") {
      const y = parseGameYear(s.gameYear);
      if (typeof y === "number") m.set(s.x, y);
    }
  }
  return m;
}

/**
 * Convert one sample into a chart-space sample row.
 * @param {*} sample One history sample.
 * @param {Map<string, number>} offsets Per-age offsets.
 * @param {AgeBoundary[]} boundaries Age boundaries.
 * @returns {ChartSample|null} Chart sample row, or null.
 */
function mapOneSampleToChart(sample, offsets, boundaries) {
  if (!sample) return null;
  const x = sampleX(sample, offsets, boundaries);
  if (typeof x !== "number" || !isFinite(x)) return null;
  const age = typeof sample.age === "string" ? sample.age : "AGE_ANTIQUITY";
  return { x, age, gameYear: sample.gameYear };
}

/**
 * One sample mapped to chart-X.
 * @typedef {{ x: number, age: string, gameYear?: string }} ChartSample
 */

/**
 * Build chart-X mapped samples sorted by X position.
 * @param {DemoHistory|undefined} history The persisted history blob.
 * @returns {ChartSample[]} Chart-X mapped samples.
 */
function mapSamplesToChartX(history) {
  const samps = history && Array.isArray(history.samples) ? history.samples : [];
  const boundaries = history && Array.isArray(history.ageBoundaries) ? history.ageBoundaries : [];
  const { offsets } = computeAgeOffsets(samps, boundaries);
  /** @type {ChartSample[]} */
  const out = [];
  for (const s of samps) {
    const mapped = mapOneSampleToChart(s, offsets, boundaries);
    if (!mapped) continue;
    out.push(mapped);
  }
  out.sort((a, b) => a.x - b.x);
  return out;
}

/**
 * Resolve the start turn of the current age from the history's age boundaries,
 * or `firstTurn` when none are recorded.
 * @param {DemoHistory|undefined} history The persisted history blob.
 * @param {number} firstTurn First sampled turn (fallback).
 * @returns {number} Start turn of the current age.
 */
function currentAgeStartTurn(history, firstTurn) {
  const mapped = mapSamplesToChartX(history);
  if (mapped.length === 0) return firstTurn;
  const curAge = mapped[mapped.length - 1].age;
  const firstInAge = mapped.find((s) => s.age === curAge);
  return firstInAge ? firstInAge.x : firstTurn;
}

/**
 * Compute the turn window for a year-relative filter (25/50/100/...), clamped
 * so it never reaches back past the start of the current age.
 * @param {DemoHistory|undefined} history The persisted history blob.
 * @param {Snapshot[]} samps Sorted samples.
 * @param {number} span Year span requested.
 * @param {number} firstTurn First sampled turn.
 * @param {number} lastTurn Last sampled turn.
 * @returns {TurnRange|null} The window, or null when no year data exists.
 */
function computeYearRelativeRange(history, samps, span, firstTurn, lastTurn) {
  const turnYear = buildTurnYearMap(history);
  if (turnYear.size === 0) return null;
  const latestYear = turnYear.get(lastTurn) ?? Array.from(turnYear.values()).pop();
  const cutoff = /** @type {number} */ (latestYear) - span;
  // Find the earliest turn whose year >= cutoff.
  let minTurn = lastTurn;
  for (const s of samps) {
    const y = turnYear.get(/** @type {number} */ (s.x));
    if (typeof y === "number" && y >= cutoff) {
      minTurn = /** @type {number} */ (s.x);
      break;
    }
  }
  // Don't reach back further than the start of the current age. If
  // the requested span pre-dates the latest age boundary, clamp the
  // range to "Current Age" (start-of-age → now) so the chart doesn't
  // mix in stale pre-age data the user didn't ask for.
  const ageStart = currentAgeStartTurn(history, firstTurn);
  if (minTurn < ageStart) minTurn = ageStart;
  return { min: minTurn, max: lastTurn };
}

/**
 * Compute the turn window for a named age filter ("age", "age1"..."age3")
 * from the history's age boundaries.
 * @param {DemoHistory|undefined} history The persisted history blob.
 * @param {string} filterId The age filter id.
 * @param {number} firstTurn First sampled turn.
 * @param {number} lastTurn Last sampled turn.
 * @returns {TurnRange|null} The window, or null for an unknown filter.
 */
function computeAgeRange(history, filterId, firstTurn, lastTurn) {
  const mapped = mapSamplesToChartX(history);
  /** @type {{ age: string, start: number }[]} */
  const starts = [];
  /** @type {Set<string>} */
  const seen = new Set();
  for (const s of mapped) {
    if (!seen.has(s.age)) {
      seen.add(s.age);
      starts.push({ age: s.age, start: s.x });
    }
  }
  /**
   * Resolve the [start, end] window for the age at boundary index `idx`.
   * @param {number} idx Zero-based age index.
   * @returns {TurnRange|null} The age's window, or null when `idx` < 0.
   */
  function ageRange(idx) {
    if (idx < 0) return null;
    if (idx >= starts.length) return null;
    const start = idx === 0 ? firstTurn : starts[idx].start;
    // If this is the last known age, max = lastTurn; else next boundary - 1.
    const next = starts[idx + 1];
    const end = next ? next.start - 1 : lastTurn;
    return { min: start, max: end };
  }
  if (filterId === "age1") return ageRange(0);
  if (filterId === "age2") return ageRange(1);
  if (filterId === "age3") return ageRange(2);
  if (filterId === "age") {
    // Current age: from the LAST recorded boundary turn → lastTurn.
    if (starts.length === 0) return { min: firstTurn, max: lastTurn };
    const last = starts[starts.length - 1];
    return { min: last.start, max: lastTurn };
  }
  return null;
}

/**
 * Resolve a filter id to an inclusive {min, max} turn range, or null for
 * "show everything".
 * @param {DemoHistory|undefined} history The persisted history blob.
 * @param {string} filterId The active filter id.
 * @returns {TurnRange|null} The clamped window, or null for the full domain.
 */
export function computeTurnRange(history, filterId) {
  if (!filterId || filterId === "all") return null;
  const samps = mapSamplesToChartX(history);
  if (samps.length === 0) return null;
  const lastTurn = /** @type {number} */ (samps[samps.length - 1].x);
  const firstTurn = /** @type {number} */ (samps[0].x);
  // Year-relative filters (25/50/100/300/500/1000 years).
  if (/^\d+$/.test(filterId)) {
    const span = parseInt(filterId, 10);
    return computeYearRelativeRange(history, samps, span, firstTurn, lastTurn);
  }
  return computeAgeRange(history, filterId, firstTurn, lastTurn);
}

/**
 * Build an enabled filter pill wired to `onSelect`, marked active when its id
 * matches `activeFilter`.
 * @param {TimeFilterDef} f The filter definition.
 * @param {string} activeFilter Currently active filter id.
 * @param {(id: string) => void} [onSelect] Selection callback.
 * @returns {HTMLElement} The pill element.
 */
function buildEnabledFilterPill(f, activeFilter, onSelect) {
  const pill = document.createElement("div");
  pill.className = "demographics-chart-time-filter-pill";
  if (f.id === activeFilter) pill.classList.add("is-active");
  const label = t(f.label);
  pill.textContent = label;
  pill.title = t("LOC_DEMOGRAPHICS_FILTER_PILL_TOOLTIP", label);
  makeClickable(pill, (ev) => {
    ev?.stopPropagation?.();
    playActivate();
    dlog("time-filter click id=" + f.id);
    if (typeof onSelect === "function") onSelect(f.id);
  });
  return pill;
}

/**
 * Build the pill row of time-range filter buttons. Same single-div pattern that
 * works in view-relations.js - class + textContent + click handler. Persists
 * the active filter via `onSelect` (round-trips through settings). Every filter
 * in {@link TIME_FILTERS} is rendered; a def may opt out by setting `disabled`
 * (none do by default).
 * @param {string} activeFilter Currently active filter id.
 * @param {(id: string) => void} onSelect Called with the chosen filter id.
 * @returns {HTMLElement} The filter-row element.
 */
export function buildTimeFilterRow(activeFilter, onSelect) {
  const row = document.createElement("div");
  row.className = "demographics-chart-time-filter-row font-body text-xs";
  for (const f of TIME_FILTERS) {
    if (f.disabled) continue;
    row.appendChild(buildEnabledFilterPill(f, activeFilter, onSelect));
  }
  return row;
}
