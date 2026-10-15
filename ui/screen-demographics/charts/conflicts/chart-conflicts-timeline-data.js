// chart-conflicts-timeline-data.js
//
// The Conflicts timeline's data step: spoiler guard, remap to the continuous chart turn, merge
// concurrent wars, filter, then mix in the Partisans risings by start turn. Split out of
// chart-conflicts-timeline.js, which draws what this returns.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import {
  historySamples,
  appendEmptyNotice,
  buildYearToChartTurn
} from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";
import { mergeWars, policyVisibleWars } from "/demographics/ui/screen-demographics/charts/wars/chart-wars-merge.js";
import { filterGanttWars } from "/demographics/ui/screen-demographics/charts/wars/chart-wars-gantt-domain.js";
import {
  buildRisingRows,
  interleaveTimelineRows,
  policyVisibleRisings
} from "/demographics/ui/screen-demographics/charts/conflicts/chart-risings-data.js";

/**
 * Prepared Gantt data: the sorted wars, the filtered rows, and filter flags.
 * @typedef {Object} GanttPrep
 * @property {*[]} wars The sorted war list.
 * @property {*[]} merged The full merged war set (for naming).
 * @property {*[]} filtered The rows to draw: filtered wars and rising rows, by start turn.
 * @property {number} latestTurn The latest sampled turn.
 * @property {Snapshot[]} samples The sample stream.
 * @property {number|null} filterPid Active civ filter, or null.
 * @property {boolean} showActiveOnly Whether concluded wars are hidden.
 */

/**
 * Latest continuous (cross-age) chart turn from the samples.
 * @param {Snapshot[]} samples
 * @returns {number}
 */
export function latestChartTurn(samples) {
  if (!samples.length) return 0;
  const last = samples[samples.length - 1] || {};
  return typeof last.chartTurn === "number" ? last.chartTurn : (last.turn ?? 0);
}

/**
 * @param {number|undefined} chartVal Recorded chart turn (if any).
 * @param {string|null|undefined} year The endpoint's game-year label.
 * @param {number|null|undefined} localVal The age-local turn fallback.
 * @param {Map<string, number>} yearToChart game-year → chartTurn.
 */
function pickGlobalTurn(chartVal, year, localVal, yearToChart) {
  if (typeof chartVal === "number") return chartVal;
  if (year && yearToChart.has(year)) return /** @type {number} */ (yearToChart.get(year));
  return typeof localVal === "number" ? localVal : null;
}

/**
 * Return a copy of a war with its start/end turns remapped to the continuous
 * (cross-age) chart turn, so the whole Gantt pipeline plots on one timeline.
 * @param {*} war
 * @param {Map<string, number>} yearToChart game-year → chartTurn.
 * @returns {*}
 */
export function toGlobalTurns(war, yearToChart) {
  const start = pickGlobalTurn(war.startChartTurn, war.startYear, war.startTurn, yearToChart);
  const ended = typeof war.endTurn === "number";
  const end = ended ? pickGlobalTurn(war.endChartTurn, war.endYear, war.endTurn, yearToChart) : null;
  return { ...war, startTurn: start, endTurn: end };
}

/**
 * @param {*[]} rawWars Spoiler-guarded wars.
 * @param {Map<string, number>} yearToChart
 * @param {number} latestTurn
 */
function mergedWarsOnChartTurns(rawWars, yearToChart, latestTurn) {
  // Plot on the continuous chart turn so ages don't overlap; remap each war's
  // age-local start/end onto it before anything else sees them.
  const wars = rawWars.map((w) => toGlobalTurns(w, yearToChart));
  // Collapse concurrent, overlapping wars that share a belligerent into single
  // multi-front wars before anything else, so the whole view (bars, tooltip,
  // naming) sees one war per front-group.
  const merged = mergeWars(wars, latestTurn);
  merged.sort((a, b) => (a.startTurn || 0) - (b.startTurn || 0));
  return { wars, merged };
}

/**
 * @param {HTMLElement} host The view host (for empty-state notices).
 * @param {*} opts
 * @returns {GanttPrep|null} Null (with a notice in the host) when there is nothing to draw.
 */
export function prepareConflictsTimelineData(host, opts) {
  // Persisted arrays: drop null elements (a null war / sample) before anything dereferences them.
  /** @type {any[]} */
  const samples = historySamples(opts.history).filter(Boolean);
  // Spoiler guard first: a hidden civ must not reach the bars, the tooltips or the naming.
  const rawWars = policyVisibleWars(opts.history && opts.history.wars, samples);
  if (rawWars.length === 0 && policyVisibleRisings(opts.history && opts.history.risings, samples).length === 0) {
    appendEmptyNotice(host, t("LOC_DEMOGRAPHICS_EMPTY_NO_WARS"));
    return null;
  }
  const latestTurn = latestChartTurn(samples);
  const yearToChart = buildYearToChartTurn(samples);
  const { wars, merged } = mergedWarsOnChartTurns(rawWars, yearToChart, latestTurn);
  // Filter pipeline: city states are dropped, since this is a major-civ engagement
  // timeline. Coalition wars between two majors still show, but only major
  // civs are rendered as bars. Risings get the same civ and active-only filters.
  const filterPid = typeof opts.filterPid === "number" ? opts.filterPid : null;
  const showActiveOnly = !!opts.activeOnly;
  const risingOpts = { samples, yearToChart, latestTurn, filterPid, activeOnly: showActiveOnly };
  const risings = buildRisingRows(opts.history, risingOpts);
  const filtered = interleaveTimelineRows(filterGanttWars(merged, showActiveOnly, filterPid), risings);
  if (filtered.length === 0) {
    appendEmptyNotice(host, t("LOC_DEMOGRAPHICS_EMPTY_NO_WARS_MATCH"));
    return null;
  }
  return { wars, merged, filtered, latestTurn, samples, filterPid, showActiveOnly };
}
