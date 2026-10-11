// chart-trends-chartjs.js
//
// Chart.js trend charts sharing the main line chart's styling: Power Race (a bump chart of each
// civ's rank by Score on a reversed y-axis) and the 100%-stacked share areas. Both reuse
// buildSeriesFromHistory, then transform the sampled values into ranks / shares.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { safeTextColor } from "/demographics/ui/core/civ-color-utils.js";
import { coerceKeySet } from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";
import {
  AXIS_BORDER_COLOR,
  AXIS_COLOR,
  axisTitle,
  chartFontFamily,
  civLegendOpts,
  GRID_COLOR
} from "/demographics/ui/screen-demographics/charts/shared/chart-style.js";
import {
  applyEngineChartDefaults,
  buildChartCanvas,
  computeRenderSize,
  reclaimOrphanedCharts,
  teardownExistingChart,
  tryCreateChart
} from "/demographics/ui/screen-demographics/charts/line/chart-line.js";
import { buildSeriesFromHistory } from "/demographics/ui/screen-demographics/charts/line/chart-line-series.js";
import { buildLineLegend } from "/demographics/ui/screen-demographics/charts/line/chart-line-legend.js";
import { makeTooltipExternal } from "/demographics/ui/screen-demographics/charts/line/chart-line-tooltip.js";

/**
 * @param {number} size
 * @returns {Record<string, *>} A Chart.js font block.
 */
function tickFont(size) {
  return { family: chartFontFamily(), size };
}

/**
 * Append a centered empty-state.
 * @param {HTMLElement} host
 * @param {string} msg
 */
function emptyState(host, msg) {
  const el = document.createElement("div");
  el.className = "demographics-empty font-body text-base";
  el.textContent = msg;
  host.appendChild(el);
}

/**
 * @param {*} color
 * @param {number} alpha 0-1.
 * @returns {string} An rgba() string.
 */
function withAlpha(color, alpha) {
  if (typeof color !== "string") return "rgba(255,255,255," + alpha + ")";
  const rgb = color.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (rgb) return "rgba(" + rgb[1] + "," + rgb[2] + "," + rgb[3] + "," + alpha + ")";
  const hex = color.replace("#", "");
  if (hex.length !== 6) return "rgba(255,255,255," + alpha + ")";
  const packed = parseInt(hex, 16);
  return "rgba(" + ((packed >> 16) & 255) + "," + ((packed >> 8) & 255) + "," + (packed & 255) + "," + alpha + ")";
}

/**
 * The x-axis (time) block, identical to the line chart's.
 * @returns {Record<string, *>}
 */
function xAxis() {
  return {
    type: "linear",
    title: axisTitle(t("LOC_DEMOGRAPHICS_AXIS_TIME")),
    ticks: {
      color: AXIS_COLOR,
      font: tickFont(17),
      maxRotation: 0,
      autoSkipPadding: 30,
      callback: (/** @type {number} */ turn) => String(Math.round(turn))
    },
    grid: { color: GRID_COLOR },
    border: { color: AXIS_BORDER_COLOR }
  };
}

/**
 * A y-axis block matching the line chart, with per-chart bounds/behaviour.
 * @param {string} title
 * @param {(v:number)=>string} tickCb The tick label formatter.
 * @param {Record<string, *>} bounds reverse/min/max/stacked/stepSize flags.
 * @returns {Record<string, *>}
 */
function yAxis(title, tickCb, bounds) {
  const flags = bounds || {};
  const ticks = { color: AXIS_COLOR, font: tickFont(17), callback: tickCb };
  if (flags.stepSize) Object.assign(ticks, { stepSize: flags.stepSize, precision: 0 });
  const axis = {
    type: "linear",
    title: axisTitle(title),
    ticks,
    grid: { color: GRID_COLOR },
    border: { color: AXIS_BORDER_COLOR }
  };
  if (flags.reverse) Object.assign(axis, { reverse: true });
  if (typeof flags.min === "number") Object.assign(axis, { min: flags.min });
  if (typeof flags.max === "number") Object.assign(axis, { max: flags.max });
  if (flags.stacked) Object.assign(axis, { stacked: true });
  return axis;
}

/**
 * The Chart.js `plugins` block: no canvas legend/title (HTML ones sit beside),
 * the same HTML external tooltip the line chart uses.
 * @param {(v:number)=>string} fmtY The value formatter.
 * @param {Record<string, *>} metricMeta Minimal metric meta for the tooltip.
 * @returns {Record<string, *>}
 */
function pluginsOpts(fmtY, metricMeta) {
  return {
    legend: { display: false },
    tooltip: {
      enabled: false,
      external: makeTooltipExternal((/** @type {number} */ v) => String(Math.round(v)), fmtY, metricMeta)
    },
    title: { display: false }
  };
}

/**
 * The `options` shape both charts share.
 * @param {Record<string, *>} plugins
 * @param {Record<string, *>} scales
 * @returns {Record<string, *>} The Chart.js `options`.
 */
function baseOptions(plugins, scales) {
  return {
    responsive: false,
    maintainAspectRatio: false,
    animation: false,
    normalized: true,
    interaction: { mode: "index", intersect: false, axis: "x" },
    plugins,
    scales
  };
}

/**
 * Shared render prologue: teardown, clear, Chart guard, defaults, options read.
 * @param {HTMLElement} host
 * @param {*} options
 * @param {string} metricId The source metric id to build series from.
 * @returns {{opts:*, width:number, height:number, hidden:Set<string>, series:*[]}|null} Prepared, or null.
 */
function prepare(host, options, metricId) {
  teardownExistingChart(host);
  // Reclaim instances a previous view/page swap orphaned (see reclaimOrphanedCharts).
  reclaimOrphanedCharts();
  while (host.firstChild) host.removeChild(host.firstChild);
  if (typeof Chart === "undefined") {
    emptyState(host, t("LOC_DEMOGRAPHICS_EMPTY_CHARTJS_MISSING"));
    return null;
  }
  applyEngineChartDefaults();
  const opts = options || {};
  const built = buildSeriesFromHistory(opts.history, metricId);
  return {
    opts,
    width: opts.width || 1400,
    height: opts.height || 600,
    hidden: coerceKeySet(opts.hiddenCivs),
    series: built.series
  };
}

/**
 * Mount a prepared Chart.js config with the shared legend + canvas wrap.
 * @param {HTMLElement} host
 * @param {*} prep The result of prepare().
 * @param {Record<string, *>[]} datasets
 * @param {Record<string, *>} config
 */
function mount(host, prep, datasets, config) {
  const { renderW, renderH } = computeRenderSize(prep.opts, prep.width, prep.height);
  const legend = buildLineLegend(datasets, civLegendOpts(prep.opts));
  const { wrap, canvas } = buildChartCanvas(renderW, renderH, legend);
  host.appendChild(wrap);
  tryCreateChart(canvas, config, host);
}

/**
 * @param {*} civSeries One civ's series from buildSeriesFromHistory.
 * @param {{x:number,y:number}[]} data
 * @param {Set<string>} hidden
 * @param {Record<string,*>} extra
 */
function baseDataset(civSeries, data, hidden, extra) {
  const color = safeTextColor(civSeries.color) || civSeries.color;
  return {
    label: civSeries.name,
    leaderType: civSeries.leaderType,
    leaderTypeString: civSeries.leaderTypeString,
    data,
    borderColor: color,
    backgroundColor: color,
    tension: 0,
    spanGaps: true,
    hidden: hidden.has(civSeries.leaderType),
    ...extra
  };
}

// Power Race (rank bump chart)

/**
 * Build per-turn ranks (1 = highest value) for every civ.
 * @param {*[]} series The per-civ series from buildSeriesFromHistory.
 * @returns {{ranks: Map<string, {x:number,y:number}[]>, maxRank:number}}
 */
function buildRanks(series) {
  /** @type {Map<number, {key:string, v:number}[]>} */
  const byTurn = new Map();
  for (const civSeries of series) {
    for (const point of civSeries.points) {
      if (typeof point.v !== "number" || !isFinite(point.v)) continue;
      let entries = byTurn.get(point.t);
      if (!entries) byTurn.set(point.t, (entries = []));
      entries.push({ key: civSeries.leaderType, v: point.v });
    }
  }
  const ranks = new Map();
  let maxRank = 1;
  for (const [turn, entries] of byTurn) {
    entries.sort((a, b) => b.v - a.v);
    entries.forEach((entry, i) => {
      if (i + 1 > maxRank) maxRank = i + 1;
      let points = ranks.get(entry.key);
      if (!points) ranks.set(entry.key, (points = []));
      points.push({ x: turn, y: i + 1 });
    });
  }
  return { ranks, maxRank };
}

/**
 * Render the Power Race bump chart (rank by Score over time).
 * @param {HTMLElement} host
 * @param {*} options
 * @returns {void}
 */
export function renderPowerRace(host, options) {
  const prep = prepare(host, options, "score");
  if (!prep) return;
  if (prep.series.length < 2) return emptyState(host, t("LOC_DEMOGRAPHICS_EMPTY_NO_SAMPLES"));
  const { ranks, maxRank } = buildRanks(prep.series);
  const datasets = prep.series.map((civSeries) => baseDataset(
    civSeries,
    (ranks.get(civSeries.leaderType) || []).sort((a, b) => a.x - b.x),
    prep.hidden,
    { borderWidth: 2.6, pointRadius: 3, pointHoverRadius: 5 }
  ));
  const scales = {
    x: xAxis(),
    y: yAxis(t("LOC_DEMOGRAPHICS_AXIS_RANK"), (v) => (Number.isInteger(v) ? "#" + v : ""),
      { reverse: true, min: 1, max: maxRank, stepSize: 1 })
  };
  const plugins = pluginsOpts((v) => "#" + Math.round(v), { id: "power_race" });
  mount(host, prep, datasets, {
    type: "line",
    data: { datasets },
    options: { ...baseOptions(plugins, scales), parsing: false }
  });
}

// Population Share (100%-stacked area)

/**
 * @param {*[]} series
 * @returns {number[]} The sorted union of sampled turns.
 */
function sortedTurns(series) {
  const turns = new Set();
  for (const civSeries of series) {
    for (const point of civSeries.points) {
      if (typeof point.v === "number" && isFinite(point.v)) turns.add(point.t);
    }
  }
  return [...turns].sort((a, b) => a - b);
}

/**
 * Per-turn world totals (sum of positive values across civs).
 * @param {*[]} series The per-civ series.
 * @returns {Map<number, number>} turn → total.
 */
function turnTotals(series) {
  const totals = new Map();
  for (const civSeries of series) {
    for (const point of civSeries.points) {
      if (typeof point.v === "number" && isFinite(point.v) && point.v > 0) {
        totals.set(point.t, (totals.get(point.t) || 0) + point.v);
      }
    }
  }
  return totals;
}

/**
 * Build one civ's share band, aligned to the shared turn axis (0 where absent).
 * @param {*} civSeries
 * @param {number[]} turns Shared turn axis.
 * @param {Map<number, number>} totals turn → world total.
 * @param {Set<string>} hidden Hidden keys.
 * @returns {Record<string, *>} The Chart.js dataset.
 */
function shareDataset(civSeries, turns, totals, hidden) {
  const valueByTurn = new Map();
  for (const point of civSeries.points) {
    if (typeof point.v === "number" && isFinite(point.v)) valueByTurn.set(point.t, point.v);
  }
  const data = turns.map((turn) => {
    const total = totals.get(turn) || 0;
    const value = valueByTurn.get(turn) || 0;
    return { x: turn, y: total > 0 ? (value / total) * 100 : 0 };
  });
  const color = safeTextColor(civSeries.color) || civSeries.color;
  return {
    ...baseDataset(civSeries, data, hidden, { borderWidth: 1.4, pointRadius: 0, pointHoverRadius: 4, fill: true }),
    backgroundColor: withAlpha(color, 0.8)
  };
}

/**
 * Render the Population Share 100%-stacked area.
 * @param {HTMLElement} host
 * @param {*} options
 * @returns {void}
 */
export function renderPopShareArea(host, options) {
  const prep = prepare(host, options, "population");
  if (!prep) return;
  const turns = sortedTurns(prep.series);
  if (turns.length < 2 || !prep.series.length) return emptyState(host, t("LOC_DEMOGRAPHICS_EMPTY_NO_SAMPLES"));
  const totals = turnTotals(prep.series);
  const datasets = prep.series.map((civSeries) => shareDataset(civSeries, turns, totals, prep.hidden));
  const scales = {
    x: xAxis(),
    y: yAxis(t("LOC_DEMOGRAPHICS_AXIS_WORLD_SHARE"), (v) => Math.round(v) + "%", {
      min: 0,
      max: 100,
      stacked: true
    })
  };
  const plugins = pluginsOpts((v) => Math.round(v) + "%", { id: "pop_share_area" });
  mount(host, prep, datasets, { type: "line", data: { datasets }, options: baseOptions(plugins, scales) });
}

/**
 * Render the Land Area Share 100%-stacked area (each civ's share of world owned
 * territory over time). Identical shape to the Population Share chart, sourced from
 * the `land` metric instead.
 * @param {HTMLElement} host
 * @param {*} options
 * @returns {void}
 */
export function renderLandShareArea(host, options) {
  const prep = prepare(host, options, "land");
  if (!prep) return;
  const turns = sortedTurns(prep.series);
  if (turns.length < 2 || !prep.series.length) return emptyState(host, t("LOC_DEMOGRAPHICS_EMPTY_NO_SAMPLES"));
  const totals = turnTotals(prep.series);
  const datasets = prep.series.map((civSeries) => shareDataset(civSeries, turns, totals, prep.hidden));
  const scales = {
    x: xAxis(),
    y: yAxis(t("LOC_DEMOGRAPHICS_AXIS_WORLD_SHARE"), (v) => Math.round(v) + "%", {
      min: 0,
      max: 100,
      stacked: true
    })
  };
  const plugins = pluginsOpts((v) => Math.round(v) + "%", { id: "land_share_area" });
  mount(host, prep, datasets, { type: "line", data: { datasets }, options: baseOptions(plugins, scales) });
}
