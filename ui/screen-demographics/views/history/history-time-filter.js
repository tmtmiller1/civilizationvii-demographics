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
import { makeLogger } from "/demographics/ui/core/demographics-log.js";

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

const log = makeLogger("history-time-filter");

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
 * @param {*} text
 * @returns {number|undefined} Signed year, or undefined when unparseable.
 */
function parseGameYear(text) {
  if (typeof text !== "string") return undefined;
  const match = text.match(/(-?\d+)\s*(BCE|BC|AD|CE)?/i);
  if (!match) return undefined;
  const year = parseInt(match[1], 10);
  if (!isFinite(year)) return undefined;
  const era = (match[2] || "").toUpperCase();
  return era === "BCE" || era === "BC" ? -year : year;
}

/**
 * Build a turn → signed-year map from the history's samples.
 * @param {DemoHistory|undefined} history
 * @returns {Map<number, number>}
 */
function buildTurnYearMap(history) {
  /** @type {Map<number, number>} */
  const turnYear = new Map();
  const mapped = mapSamplesToChartX(history);
  for (const sample of mapped) {
    if (typeof sample.x === "number" && typeof sample.gameYear === "string") {
      const year = parseGameYear(sample.gameYear);
      if (typeof year === "number") turnYear.set(sample.x, year);
    }
  }
  return turnYear;
}

/**
 * @param {*} sample
 * @param {Map<string, number>} offsets
 * @param {AgeBoundary[]} boundaries
 * @returns {ChartSample|null}
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
 * @param {DemoHistory|undefined} history
 * @returns {ChartSample[]}
 */
function mapSamplesToChartX(history) {
  const samples = history && Array.isArray(history.samples) ? history.samples : [];
  const boundaries = history && Array.isArray(history.ageBoundaries) ? history.ageBoundaries : [];
  const { offsets } = computeAgeOffsets(samples, boundaries);
  /** @type {ChartSample[]} */
  const out = [];
  for (const sample of samples) {
    const mapped = mapOneSampleToChart(sample, offsets, boundaries);
    if (!mapped) continue;
    out.push(mapped);
  }
  out.sort((a, b) => a.x - b.x);
  return out;
}

/**
 * Resolve the start turn of the current age from the history's age boundaries,
 * or `firstTurn` when none are recorded.
 * @param {DemoHistory|undefined} history
 * @param {number} firstTurn First sampled turn (fallback).
 * @returns {number}
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
 * @param {DemoHistory|undefined} history
 * @param {Snapshot[]} chartSamples
 * @param {number} span
 * @param {number} firstTurn
 * @param {number} lastTurn
 * @returns {TurnRange|null} Null when no year data exists.
 */
function computeYearRelativeRange(history, chartSamples, span, firstTurn, lastTurn) {
  const turnYear = buildTurnYearMap(history);
  if (turnYear.size === 0) return null;
  const latestYear = turnYear.get(lastTurn) ?? Array.from(turnYear.values()).pop();
  const cutoff = /** @type {number} */ (latestYear) - span;
  // Find the earliest turn whose year >= cutoff.
  let minTurn = lastTurn;
  for (const sample of chartSamples) {
    const year = turnYear.get(/** @type {number} */ (sample.x));
    if (typeof year === "number" && year >= cutoff) {
      minTurn = /** @type {number} */ (sample.x);
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
 * @param {DemoHistory|undefined} history
 * @param {string} filterId
 * @param {number} firstTurn
 * @param {number} lastTurn
 * @returns {TurnRange|null} Null for an unknown filter.
 */
function computeAgeRange(history, filterId, firstTurn, lastTurn) {
  const mapped = mapSamplesToChartX(history);
  /** @type {{ age: string, start: number }[]} */
  const starts = [];
  /** @type {Set<string>} */
  const seen = new Set();
  for (const sample of mapped) {
    if (!seen.has(sample.age)) {
      seen.add(sample.age);
      starts.push({ age: sample.age, start: sample.x });
    }
  }
  /**
   * Resolve the [start, end] window for the age at boundary index `idx`.
   * @param {number} idx
   * @returns {TurnRange|null} Null when `idx` is out of range.
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
    // Current age: from the last recorded boundary turn → lastTurn.
    if (starts.length === 0) return { min: firstTurn, max: lastTurn };
    const last = starts[starts.length - 1];
    return { min: last.start, max: lastTurn };
  }
  return null;
}

/**
 * Resolve a filter id to an inclusive {min, max} turn range, or null for
 * "show everything".
 * @param {DemoHistory|undefined} history
 * @param {string} filterId
 * @returns {TurnRange|null} Null for the full domain.
 */
export function computeTurnRange(history, filterId) {
  if (!filterId || filterId === "all") return null;
  const chartSamples = mapSamplesToChartX(history);
  if (chartSamples.length === 0) return null;
  const lastTurn = /** @type {number} */ (chartSamples[chartSamples.length - 1].x);
  const firstTurn = /** @type {number} */ (chartSamples[0].x);
  // Year-relative filters (25/50/100/300/500/1000 years).
  if (/^\d+$/.test(filterId)) {
    const span = parseInt(filterId, 10);
    return computeYearRelativeRange(history, chartSamples, span, firstTurn, lastTurn);
  }
  return computeAgeRange(history, filterId, firstTurn, lastTurn);
}

/**
 * Build an enabled filter pill wired to `onSelect`, marked active when its id
 * matches `activeFilter`.
 * @param {TimeFilterDef} f
 * @param {string} activeFilter
 * @param {(id: string) => void} [onSelect]
 * @returns {HTMLElement}
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
    log.debug("time-filter click id=" + f.id);
    if (typeof onSelect === "function") onSelect(f.id);
  });
  return pill;
}

/**
 * Build the pill row of time-range filter buttons. Persists the active filter
 * via `onSelect`. Every filter in {@link TIME_FILTERS} is rendered; a def may
 * opt out by setting `disabled`.
 * @param {string} activeFilter
 * @param {(id: string) => void} onSelect
 * @returns {HTMLElement}
 */
export function buildTimeFilterRow(activeFilter, onSelect) {
  const row = document.createElement("div");
  row.className = "demographics-chart-time-filter-row font-body text-xs";
  for (const filterDef of TIME_FILTERS) {
    if (filterDef.disabled) continue;
    row.appendChild(buildEnabledFilterPill(filterDef, activeFilter, onSelect));
  }
  return row;
}
