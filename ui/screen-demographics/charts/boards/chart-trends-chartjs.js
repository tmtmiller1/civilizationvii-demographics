// chart-trends-chartjs.js
//
// Chart.js versions of two trend charts, sharing the exact styling of the main
// line chart (engine fonts, gridline/axis colors, the clickable civ legend, and
// the HTML tooltip):
//   • Power Race — a bump chart of each civ's RANK by Score over time, drawn on
//     a reversed y-axis (1st at the top) so lead changes read as line crossings.
//   • Population Share — a 100%-stacked area of each civ's share of world
//     population, so snowballing reads as one band swallowing the rest.
// Both reuse buildSeriesFromHistory for per-civ identity + deconflicted color,
// then transform the sampled values into ranks / shares. Defensive throughout.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { safeTextColor } from "/demographics/ui/core/civ-color-utils.js";
import { coerceKeySet } from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";
import {
  applyEngineChartDefaults,
  buildChartCanvas,
  computeRenderSize,
  teardownExistingChart,
  tryCreateChart
} from "/demographics/ui/screen-demographics/charts/line/chart-line.js";
import { buildSeriesFromHistory } from "/demographics/ui/screen-demographics/charts/line/chart-line-series.js";
import { buildLineLegend } from "/demographics/ui/screen-demographics/charts/line/chart-line-legend.js";
import { makeTooltipExternal } from "/demographics/ui/screen-demographics/charts/line/chart-line-tooltip.js";

// Styling tokens copied from chart-line-config.js so both chart families read
// identically (Chart.js canvas needs literals, not CSS vars).
const AXIS_COLOR = "#e5d2ac";
const GRID = "rgba(133, 135, 140, 0.25)";
const AXIS_BORDER = "#85878C";

/** @returns {string} The engine chart font family, with a safe fallback chain. */
function fontFamily() {
  return (typeof Chart !== "undefined" && Chart.defaults?.font?.family) || "BodyFont, sans-serif";
}

/** @param {number} size @returns {Record<string, *>} A Chart.js font block. */
function tickFont(size) {
  return { family: fontFamily(), size };
}

/** @param {string} text @returns {Record<string, *>} Axis-title opts matching the line chart. */
function axisTitle(text) {
  return {
    display: !!text, text, color: AXIS_COLOR,
    font: { family: fontFamily(), size: 18, weight: "600" }
  };
}

/** @param {HTMLElement} host @param {string} msg Append a centered empty-state. */
function emptyState(host, msg) {
  const el = document.createElement("div");
  el.className = "demographics-empty font-body text-base";
  el.textContent = msg;
  host.appendChild(el);
}

/** @param {*} color @param {number} a Alpha 0-1. @returns {string} An rgba() string. */
function withAlpha(color, a) {
  if (typeof color !== "string") return "rgba(255,255,255," + a + ")";
  const rgb = color.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (rgb) return "rgba(" + rgb[1] + "," + rgb[2] + "," + rgb[3] + "," + a + ")";
  const hex = color.replace("#", "");
  if (hex.length !== 6) return "rgba(255,255,255," + a + ")";
  const n = parseInt(hex, 16);
  return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
}

/** The x-axis (time) block, identical to the line chart's. @returns {Record<string, *>} */
function xAxis() {
  return {
    type: "linear",
    title: axisTitle(t("LOC_DEMOGRAPHICS_AXIS_TIME")),
    ticks: {
      color: AXIS_COLOR, font: tickFont(17), maxRotation: 0, autoSkipPadding: 30,
      callback: (/** @type {number} */ v) => String(Math.round(v))
    },
    grid: { color: GRID },
    border: { color: AXIS_BORDER }
  };
}

/**
 * A y-axis block matching the line chart, with per-chart bounds/behaviour.
 * @param {string} title The axis title.
 * @param {(v:number)=>string} tickCb The tick label formatter.
 * @param {Record<string, *>} bounds reverse/min/max/stacked/stepSize flags.
 * @returns {Record<string, *>} The y-axis options.
 */
function yAxis(title, tickCb, bounds) {
  const b = bounds || {};
  const ticks = { color: AXIS_COLOR, font: tickFont(17), callback: tickCb };
  if (b.stepSize) Object.assign(ticks, { stepSize: b.stepSize, precision: 0 });
  const axis = { type: "linear", title: axisTitle(title), ticks, grid: { color: GRID }, border: { color: AXIS_BORDER } };
  if (b.reverse) Object.assign(axis, { reverse: true });
  if (typeof b.min === "number") Object.assign(axis, { min: b.min });
  if (typeof b.max === "number") Object.assign(axis, { max: b.max });
  if (b.stacked) Object.assign(axis, { stacked: true });
  return axis;
}

/**
 * The Chart.js `plugins` block: no canvas legend/title (HTML ones sit beside),
 * the same HTML external tooltip the line chart uses.
 * @param {(v:number)=>string} fmtY The value formatter.
 * @param {Record<string, *>} metricMeta Minimal metric meta for the tooltip.
 * @returns {Record<string, *>} The plugins options.
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
 * Options object shared shape for both charts.
 * @param {Record<string, *>} plugins @param {Record<string, *>} scales
 * @returns {Record<string, *>} The Chart.js `options`.
 */
function baseOptions(plugins, scales) {
  return {
    responsive: false, maintainAspectRatio: false, animation: false, normalized: true,
    interaction: { mode: "index", intersect: false, axis: "x" },
    plugins, scales
  };
}

/** @param {*} opts @returns {Record<string, *>} Legend callbacks bound to the render ctx. */
function legendOpts(opts) {
  return {
    hiddenCivs: opts.hiddenCivs,
    onToggleVisibility: (/** @type {string} */ k) => opts.onToggleCiv && opts.onToggleCiv(k),
    onSetAllHidden: (/** @type {boolean} */ h, /** @type {string[]} */ keys) =>
      opts.onSetAllHidden && opts.onSetAllHidden(h, keys)
  };
}

/**
 * Shared render prologue: teardown, clear, Chart guard, defaults, options read.
 * @param {HTMLElement} host The chart host.
 * @param {*} options The render options.
 * @param {string} metricId The source metric id to build series from.
 * @returns {{opts:*, W:number, H:number, hidden:Set<string>, series:*[]}|null} Prepared, or null.
 */
function prepare(host, options, metricId) {
  teardownExistingChart(host);
  while (host.firstChild) host.removeChild(host.firstChild);
  if (typeof Chart === "undefined") {
    emptyState(host, t("LOC_DEMOGRAPHICS_EMPTY_CHARTJS_MISSING"));
    return null;
  }
  applyEngineChartDefaults();
  const opts = options || {};
  const built = buildSeriesFromHistory(opts.history, metricId);
  return {
    opts, W: opts.width || 1400, H: opts.height || 600,
    hidden: coerceKeySet(opts.hiddenCivs), series: built.series
  };
}

/**
 * Mount a prepared Chart.js config with the shared legend + canvas wrap.
 * @param {HTMLElement} host @param {*} prep @param {Record<string, *>[]} datasets @param {Record<string, *>} config
 */
function mount(host, prep, datasets, config) {
  const { renderW, renderH } = computeRenderSize(prep.opts, prep.W, prep.H);
  const legend = buildLineLegend(datasets, legendOpts(prep.opts));
  const { wrap, canvas } = buildChartCanvas(renderW, renderH, legend);
  host.appendChild(wrap);
  tryCreateChart(canvas, config, host);
}

/** @param {*} s @param {{x:number,y:number}[]} data @param {Set<string>} hidden @param {Record<string,*>} extra */
function baseDataset(s, data, hidden, extra) {
  const color = safeTextColor(s.color) || s.color;
  return {
    label: s.name, leaderType: s.leaderType, leaderTypeString: s.leaderTypeString,
    data, borderColor: color, backgroundColor: color, tension: 0, spanGaps: true,
    hidden: hidden.has(s.leaderType), ...extra
  };
}

// ── Power Race (rank bump chart) ─────────────────────────────────────────────

/**
 * Build per-turn ranks (1 = highest value) for every civ.
 * @param {*[]} series The per-civ series from buildSeriesFromHistory.
 * @returns {{ranks: Map<string, {x:number,y:number}[]>, maxRank:number}} Rank data.
 */
function buildRanks(series) {
  /** @type {Map<number, {key:string, v:number}[]>} */
  const byTurn = new Map();
  for (const s of series) {
    for (const p of s.points) {
      if (typeof p.v !== "number" || !isFinite(p.v)) continue;
      let arr = byTurn.get(p.t);
      if (!arr) byTurn.set(p.t, (arr = []));
      arr.push({ key: s.leaderType, v: p.v });
    }
  }
  const ranks = new Map();
  let maxRank = 1;
  for (const [turn, arr] of byTurn) {
    arr.sort((a, b) => b.v - a.v);
    arr.forEach((e, i) => {
      if (i + 1 > maxRank) maxRank = i + 1;
      let pts = ranks.get(e.key);
      if (!pts) ranks.set(e.key, (pts = []));
      pts.push({ x: turn, y: i + 1 });
    });
  }
  return { ranks, maxRank };
}

/**
 * Render the Power Race bump chart (rank by Score over time).
 * @param {HTMLElement} host The chart host. @param {*} options Render options.
 * @returns {void}
 */
export function renderPowerRace(host, options) {
  const prep = prepare(host, options, "score");
  if (!prep) return;
  if (prep.series.length < 2) return emptyState(host, t("LOC_DEMOGRAPHICS_EMPTY_NO_SAMPLES"));
  const { ranks, maxRank } = buildRanks(prep.series);
  const datasets = prep.series.map((s) => baseDataset(
    s, (ranks.get(s.leaderType) || []).sort((a, b) => a.x - b.x), prep.hidden,
    { borderWidth: 2.6, pointRadius: 3, pointHoverRadius: 5 }
  ));
  const scales = {
    x: xAxis(),
    y: yAxis(t("LOC_DEMOGRAPHICS_AXIS_RANK"), (v) => (Number.isInteger(v) ? "#" + v : ""),
      { reverse: true, min: 1, max: maxRank, stepSize: 1 })
  };
  const plugins = pluginsOpts((v) => "#" + Math.round(v), { id: "power_race" });
  mount(host, prep, datasets, { type: "line", data: { datasets }, options: { ...baseOptions(plugins, scales), parsing: false } });
}

// ── Population Share (100%-stacked area) ─────────────────────────────────────

/** @param {*[]} series @returns {number[]} The sorted union of sampled turns. */
function sortedTurns(series) {
  const set = new Set();
  for (const s of series) for (const p of s.points) {
    if (typeof p.v === "number" && isFinite(p.v)) set.add(p.t);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * Per-turn world totals (sum of positive values across civs).
 * @param {*[]} series The per-civ series. @returns {Map<number, number>} turn → total.
 */
function turnTotals(series) {
  const totals = new Map();
  for (const s of series) for (const p of s.points) {
    if (typeof p.v === "number" && isFinite(p.v) && p.v > 0) totals.set(p.t, (totals.get(p.t) || 0) + p.v);
  }
  return totals;
}

/**
 * Build one civ's share band, aligned to the shared turn axis (0 where absent).
 * @param {*} s The civ series. @param {number[]} turns Shared turn axis.
 * @param {Map<number, number>} totals turn → world total. @param {Set<string>} hidden Hidden keys.
 * @returns {Record<string, *>} The Chart.js dataset.
 */
function shareDataset(s, turns, totals, hidden) {
  const vByTurn = new Map();
  for (const p of s.points) if (typeof p.v === "number" && isFinite(p.v)) vByTurn.set(p.t, p.v);
  const data = turns.map((turn) => {
    const tot = totals.get(turn) || 0;
    const v = vByTurn.get(turn) || 0;
    return { x: turn, y: tot > 0 ? (v / tot) * 100 : 0 };
  });
  const color = safeTextColor(s.color) || s.color;
  return {
    ...baseDataset(s, data, hidden, { borderWidth: 1.4, pointRadius: 0, pointHoverRadius: 4, fill: true }),
    backgroundColor: withAlpha(color, 0.8)
  };
}

/**
 * Render the Population Share 100%-stacked area.
 * @param {HTMLElement} host The chart host. @param {*} options Render options.
 * @returns {void}
 */
export function renderPopShareArea(host, options) {
  const prep = prepare(host, options, "population");
  if (!prep) return;
  const turns = sortedTurns(prep.series);
  if (turns.length < 2 || !prep.series.length) return emptyState(host, t("LOC_DEMOGRAPHICS_EMPTY_NO_SAMPLES"));
  const totals = turnTotals(prep.series);
  const datasets = prep.series.map((s) => shareDataset(s, turns, totals, prep.hidden));
  const scales = {
    x: xAxis(),
    y: yAxis(t("LOC_DEMOGRAPHICS_AXIS_WORLD_SHARE"), (v) => Math.round(v) + "%", { min: 0, max: 100, stacked: true })
  };
  const plugins = pluginsOpts((v) => Math.round(v) + "%", { id: "pop_share_area" });
  mount(host, prep, datasets, { type: "line", data: { datasets }, options: baseOptions(plugins, scales) });
}

/**
 * Render the Land Area Share 100%-stacked area (each civ's share of world owned
 * territory over time). Identical shape to the Population Share chart, sourced from
 * the `land` metric instead.
 * @param {HTMLElement} host The chart host. @param {*} options Render options.
 * @returns {void}
 */
export function renderLandShareArea(host, options) {
  const prep = prepare(host, options, "land");
  if (!prep) return;
  const turns = sortedTurns(prep.series);
  if (turns.length < 2 || !prep.series.length) return emptyState(host, t("LOC_DEMOGRAPHICS_EMPTY_NO_SAMPLES"));
  const totals = turnTotals(prep.series);
  const datasets = prep.series.map((s) => shareDataset(s, turns, totals, prep.hidden));
  const scales = {
    x: xAxis(),
    y: yAxis(t("LOC_DEMOGRAPHICS_AXIS_WORLD_SHARE"), (v) => Math.round(v) + "%", { min: 0, max: 100, stacked: true })
  };
  const plugins = pluginsOpts((v) => Math.round(v) + "%", { id: "land_share_area" });
  mount(host, prep, datasets, { type: "line", data: { datasets }, options: baseOptions(plugins, scales) });
}
