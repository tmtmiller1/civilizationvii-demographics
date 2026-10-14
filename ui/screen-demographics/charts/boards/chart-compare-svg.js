// chart-compare-svg.js
//
// "Compare the civs at a glance" charts (Fingerprint scatters on two yield axes;
// Archetype radar normalized to the field max), all with a shared click-to-hide
// civ-filter legend. Identity/color come from buildSeriesFromHistory so keys
// match every other chart.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { safeTextColor } from "/demographics/ui/core/civ-color-utils.js";
import { safePlaySound } from "/demographics/ui/core/demographics-audio.js";
import { coerceKeySet } from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";
import {
  AXIS_BORDER_COLOR,
  AXIS_COLOR,
  axisTitle,
  chartFontFamily,
  civLegendOpts,
  GRID_COLOR
} from "/demographics/ui/screen-demographics/charts/shared/chart-style.js";
import { buildSeriesFromHistory } from "/demographics/ui/screen-demographics/charts/line/chart-line-series.js";
import {
  buildLeaderIconGroup,
  positionChartTooltip
} from "/demographics/ui/screen-demographics/charts/line/chart-line-tooltip.js";
import {
  applyEngineChartDefaults,
  buildChartCanvas,
  computeRenderSize,
  reclaimOrphanedCharts,
  teardownExistingChart,
  tryCreateChart
} from "/demographics/ui/screen-demographics/charts/line/chart-line.js";
import { buildLineLegend } from "/demographics/ui/screen-demographics/charts/line/chart-line-legend.js";
import * as board from "/demographics/ui/screen-demographics/charts/boards/board-ui.js";

const VW = 1000;
const VH = 560;

// Shared compare data + filtering legend

/**
 * A civ's compare record.
 * @typedef {Object} CompareCiv
 * @property {string} key Series key (leaderType hash or `pid:<id>`).
 * @property {string} label Civ label.
 * @property {string|null} leaderTypeString Icon type.
 * @property {string} color Readable civ color.
 * @property {Record<string, number>} values Latest metric values.
 */

/**
 * Load per-civ compare data (identity + deconflicted color + the latest sampled
 * value of each requested metric) from history via buildSeriesFromHistory, so
 * keys/colors match every other chart and the shared hidden-civ filter applies.
 * @param {*} history The persisted history blob.
 * @param {string[]} metricIds The metrics whose latest values to read.
 * @returns {Map<string, CompareCiv>}
 */
function loadCompareCivs(history, metricIds) {
  /** @type {Map<string, CompareCiv>} */
  const civs = new Map();
  metricIds.forEach((metric) => {
    const series = /** @type {*[]} */ (buildSeriesFromHistory(history, metric).series);
    for (const line of series) {
      let civ = civs.get(line.leaderType);
      if (!civ) {
        // line.name is the composed "Leader (Civ)" display name; it already honors
        // the global Civ/Leader order toggle (via displayName → orderedNames).
        civ = {
          key: line.leaderType,
          label: line.name,
          leaderTypeString: line.leaderTypeString,
          color: safeTextColor(line.color) || line.color,
          values: {}
        };
        civs.set(line.leaderType, civ);
      }
      const last = line.points.length ? line.points[line.points.length - 1].v : undefined;
      if (typeof last === "number" && isFinite(last)) civ.values[metric] = last;
    }
  });
  return civs;
}

/**
 * Build one clickable legend row (portrait + colored dot + name), `is-hidden`
 * when the civ is filtered off. Matches the line / Legacy Path radar legend.
 * @param {CompareCiv} civ
 * @param {boolean} isHidden
 * @param {((k:string)=>void)|null} onToggle
 * @returns {HTMLElement}
 */
function compareLegendRow(civ, isHidden, onToggle) {
  const row = document.createElement("div");
  row.className = "demographics-line-legend-row";
  if (isHidden) row.classList.add("is-hidden");
  row.appendChild(buildLeaderIconGroup(
    { leaderType: civ.key, leaderTypeString: civ.leaderTypeString }, civ.color
  ));
  const name = document.createElement("span");
  name.className = "demographics-line-legend-name";
  name.textContent = civ.label;
  row.appendChild(name);
  if (onToggle) {
    row.addEventListener("click", (ev) => {
      ev.stopPropagation();
      safePlaySound("data-audio-select-press", "audio-screen-unlocks");
      onToggle(civ.key);
    });
  }
  return row;
}

/**
 * Mount the filtering legend overlay (title + one clickable row per civ).
 * @param {HTMLElement} wrap
 * @param {{forEach:(cb:(c:CompareCiv)=>void)=>void}} civs Map or array of civs.
 * @param {Set<string>} hidden
 * @param {((k:string)=>void)|null} onToggle
 */
function mountCompareLegend(wrap, civs, hidden, onToggle) {
  const legend = document.createElement("div");
  legend.className = "demographics-line-legend demographics-line-legend-overlay";
  const title = document.createElement("div");
  title.className = "demographics-line-legend-title";
  title.textContent = t("LOC_DEMOGRAPHICS_LEGEND_TITLE");
  legend.appendChild(title);
  civs.forEach((civ) => legend.appendChild(compareLegendRow(civ, hidden.has(civ.key), onToggle)));
  wrap.appendChild(legend);
}

// Scatter (Chart.js)
//
// Rendered with Chart.js, not hand-drawn SVG, so axes, fonts, legend and
// tooltip are pixel-identical to the line chart. Each civ is one single-point
// dataset so the shared civ-filter legend + hidden-toggle apply as on the line chart.

/**
 * @param {number} value
 * @returns {string} A number with grouped thousands (e.g. "1,234").
 */
function groupThousands(value) {
  if (typeof value !== "number" || !isFinite(value)) return "";
  const rounded = Math.round(value * 100) / 100;
  const parts = String(rounded).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}

/**
 * A linear metric axis (x or y) styled like the line chart: gold ticks + title,
 * faint gridlines, gray border, starting at 0, grouped-thousand tick labels.
 * @param {string} title
 * @returns {Record<string, *>} The Chart.js axis options.
 */
function metricAxis(title) {
  return {
    type: "linear",
    beginAtZero: true,
    title: axisTitle(title),
    ticks: {
      color: AXIS_COLOR,
      font: { family: chartFontFamily(), size: 17 },
      callback: (/** @type {number} */ value) => groupThousands(value)
    },
    grid: { color: GRID_COLOR },
    border: { color: AXIS_BORDER_COLOR }
  };
}

/**
 * The civs that have a finite value on both axes (the plottable set).
 * @param {Map<string, CompareCiv>} civs
 * @param {string} xMetric
 * @param {string} yMetric
 * @returns {CompareCiv[]}
 */
function scatterPlottable(civs, xMetric, yMetric) {
  return [...civs.values()].filter(
    (civ) => typeof civ.values[xMetric] === "number" && typeof civ.values[yMetric] === "number"
  );
}

/**
 * Build one civ's single-point scatter dataset. Identity/color carried through so
 * the shared legend, hidden-toggle, and tooltip work exactly like the line chart.
 * @param {CompareCiv} civ
 * @param {string} xMetric
 * @param {string} yMetric
 * @param {Set<string>} hidden
 * @returns {Record<string, *>} The Chart.js dataset.
 */
function scatterDataset(civ, xMetric, yMetric, hidden) {
  const color = safeTextColor(civ.color) || civ.color;
  return {
    label: civ.label,
    leaderType: civ.key,
    leaderTypeString: civ.leaderTypeString,
    data: [{ x: civ.values[xMetric], y: civ.values[yMetric] }],
    backgroundColor: color,
    borderColor: color,
    pointBorderColor: color,
    pointRadius: 9,
    pointHoverRadius: 11,
    showLine: false,
    hidden: hidden.has(civ.key)
  };
}

/**
 * Append one labeled value line ("<axis title> …… <value>") to the tooltip, the
 * value in the civ color, mirroring the line-chart tooltip's per-row value cell.
 * @param {HTMLElement} tip
 * @param {string} title
 * @param {number} value
 * @param {string} color
 */
function appendScatterTipVal(tip, title, value, color) {
  const row = document.createElement("div");
  row.className = "demographics-line-tip-row";
  const label = document.createElement("span");
  label.className = "demographics-line-tip-name";
  label.textContent = title;
  row.appendChild(label);
  const valueCell = document.createElement("span");
  valueCell.className = "demographics-line-tip-val";
  valueCell.style.color = color;
  valueCell.textContent = groupThousands(value);
  row.appendChild(valueCell);
  tip.appendChild(row);
}

/**
 * Fill the tooltip for the hovered civ: the standard leader portrait + color dot +
 * name row, then the two axis value lines.
 * @param {HTMLElement} tip
 * @param {*} dataPoint The Chart.js data point.
 * @param {string} xTitle
 * @param {string} yTitle
 */
function fillScatterTip(tip, dataPoint, xTitle, yTitle) {
  const dataset = dataPoint.dataset;
  const color = safeTextColor(typeof dataset.borderColor === "string" ? dataset.borderColor : "#e5d2ac");
  while (tip.firstChild) tip.removeChild(tip.firstChild);
  const head = document.createElement("div");
  head.className = "demographics-line-tip-row";
  head.appendChild(buildLeaderIconGroup(dataset, color));
  const name = document.createElement("span");
  name.className = "demographics-line-tip-name";
  name.textContent = dataset.label || "";
  head.appendChild(name);
  tip.appendChild(head);
  appendScatterTipVal(tip, xTitle, dataPoint.parsed.x, color);
  appendScatterTipVal(tip, yTitle, dataPoint.parsed.y, color);
}

/**
 * Build the Chart.js `tooltip.external` handler: the same dark chrome the line
 * chart uses, showing the hovered civ + both axis values.
 * @param {string} xTitle
 * @param {string} yTitle
 * @returns {(context:*) => void}
 */
function makeScatterTooltipExternal(xTitle, yTitle) {
  return function (context) {
    const { chart, tooltip } = context;
    const wrap = chart.canvas.parentNode;
    let tip = /** @type {HTMLElement|null} */ (wrap.querySelector(".demographics-chart-tooltip"));
    if (!tip) {
      tip = document.createElement("div");
      tip.className =
        "demographics-chart-tooltip demographics-line-chart-tooltip demographics-tip-chrome";
      wrap.appendChild(tip);
    }
    const dataPoint = tooltip.opacity === 0 ? null : tooltip.dataPoints && tooltip.dataPoints[0];
    if (!dataPoint) {
      tip.style.opacity = "0";
      return;
    }
    fillScatterTip(tip, dataPoint, xTitle, yTitle);
    positionChartTooltip(tip, chart, tooltip, wrap);
  };
}

/**
 * Resolve the scatter's axis metrics and (localized) titles from options, applying the
 * Science-vs-Military "Fingerprint" defaults.
 * @param {*} opts Options (xMetric/yMetric/xTitle/yTitle).
 * @returns {{ xMetric: string, yMetric: string, xTitle: string, yTitle: string }}
 */
function scatterAxisSpec(opts) {
  return {
    xMetric: opts.xMetric || "science_yield",
    yMetric: opts.yMetric || "milpower",
    xTitle: t(opts.xTitle || "LOC_DEMOGRAPHICS_SCATTER_AXIS_SCIENCE_PT"),
    yTitle: t(opts.yTitle || "LOC_DEMOGRAPHICS_SCATTER_AXIS_MILITARY_POWER")
  };
}

/**
 * Render a two-axis civ scatter (Chart.js) with the shared click-to-hide filter
 * legend: each civ a dot on (xMetric, yMetric). Defaults to the
 * Science-vs-Military "Fingerprint"; `opts` selects any pair.
 * @param {HTMLElement} host
 * @param {*} opts Options (history, xMetric/yMetric/xTitle/yTitle, width/height,
 *   hiddenCivs, onToggleCiv, onSetAllHidden).
 * @returns {void}
 */
export function renderCivScatter(host, opts) {
  const settings = opts || {};
  const { xMetric, yMetric, xTitle, yTitle } = scatterAxisSpec(settings);

  teardownExistingChart(host);
  // Reclaim instances a previous view/page swap orphaned (see reclaimOrphanedCharts).
  reclaimOrphanedCharts();
  while (host.firstChild) host.removeChild(host.firstChild);
  if (typeof Chart === "undefined") {
    return board.emptyState(host, t("LOC_DEMOGRAPHICS_EMPTY_CHARTJS_MISSING"));
  }
  applyEngineChartDefaults();

  const plottable = scatterPlottable(loadCompareCivs(settings.history, [xMetric, yMetric]), xMetric, yMetric);
  if (!plottable.length) return board.emptyState(host, t("LOC_DEMOGRAPHICS_BOARD_NO_COMPARABLE"));

  const hidden = coerceKeySet(settings.hiddenCivs);
  const datasets = plottable.map((civ) => scatterDataset(civ, xMetric, yMetric, hidden));
  const options = {
    responsive: false,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: "nearest", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false, external: makeScatterTooltipExternal(xTitle, yTitle) },
      title: { display: false }
    },
    scales: { x: metricAxis(xTitle), y: metricAxis(yTitle) }
  };
  const { renderW, renderH } = computeRenderSize(settings, settings.width || 1400, settings.height || 600);
  const legend = buildLineLegend(datasets, civLegendOpts(settings));
  const { wrap, canvas } = buildChartCanvas(renderW, renderH, legend);
  host.appendChild(wrap);
  // type "line" (not "scatter") with per-dataset showLine:false: the LineController
  // is the one the line/trend charts already use, so we don't depend on the engine's
  // Chart.js build having ScatterController registered. Renders points only.
  tryCreateChart(canvas, { type: "line", data: { datasets }, options }, host);
}

// Radar (Archetype)

/** Radar dimensions: metric id → axis label. */
const RADAR_DIMS = [
  { metric: "science_yield", label: "LOC_DEMOGRAPHICS_RADAR_AXIS_SCIENCE" },
  { metric: "milpower", label: "LOC_DEMOGRAPHICS_RADAR_AXIS_MILITARY" },
  { metric: "gdp", label: "LOC_DEMOGRAPHICS_RADAR_AXIS_ECONOMY" },
  { metric: "culture_yield", label: "LOC_DEMOGRAPHICS_RADAR_AXIS_CULTURE" },
  { metric: "population", label: "LOC_DEMOGRAPHICS_RADAR_AXIS_PEOPLE" },
  { metric: "land", label: "LOC_DEMOGRAPHICS_RADAR_AXIS_LAND" }
];
const RADAR_CX = VW / 2;
const RADAR_CY = VH / 2 + 6;
const RADAR_RADIUS = 200;

/**
 * @param {number} i
 * @param {number} radius
 * @returns {{x:number, y:number}}
 */
function radarPoint(i, radius) {
  const angle = (-90 + (i * 360) / RADAR_DIMS.length) * (Math.PI / 180);
  return { x: RADAR_CX + radius * Math.cos(angle), y: RADAR_CY + radius * Math.sin(angle) };
}

/** @param {SVGElement} svg Draw the radar spokes, rings, and axis labels. */
function radarFrame(svg) {
  for (const ring of [0.25, 0.5, 0.75, 1]) {
    const points = RADAR_DIMS.map((_, i) => {
      const point = radarPoint(i, RADAR_RADIUS * ring);
      return point.x.toFixed(1) + "," + point.y.toFixed(1);
    }).join(" ");
    svg.appendChild(board.svgEl("polygon", { points, fill: "none", stroke: board.GRID }));
  }
  RADAR_DIMS.forEach((dim, i) => {
    const edge = radarPoint(i, RADAR_RADIUS);
    svg.appendChild(board.svgEl("line", {
      x1: RADAR_CX,
      y1: RADAR_CY,
      x2: edge.x,
      y2: edge.y,
      stroke: board.GRID
    }));
    const labelPos = radarPoint(i, RADAR_RADIUS + 24);
    svg.appendChild(board.svgText(labelPos.x, labelPos.y, t(dim.label), { anchor: "middle", fill: board.INK }));
  });
}

/**
 * Append one civ's normalized radar polygon.
 * @param {SVGElement} svg
 * @param {CompareCiv} civ
 * @param {number[]} maxes Per-dim maxima.
 */
function radarPolygon(svg, civ, maxes) {
  const points = RADAR_DIMS.map((dim, i) => {
    const value = civ.values[dim.metric] || 0;
    const point = radarPoint(i, RADAR_RADIUS * (maxes[i] > 0 ? Math.max(0, value) / maxes[i] : 0));
    return point.x.toFixed(1) + "," + point.y.toFixed(1);
  }).join(" ");
  const poly = board.svgEl("polygon", {
    points,
    fill: civ.color,
    "fill-opacity": 0.14,
    stroke: civ.color,
    "stroke-width": 2,
    "stroke-linejoin": "round"
  });
  poly.setAttribute("data-tooltip-content", civ.label);
  svg.appendChild(poly);
}

/**
 * @param {Map<string, CompareCiv>} civs
 * @returns {number[]} Per-dimension maxima (floored at 1).
 */
function radarMaxes(civs) {
  return RADAR_DIMS.map((dim) => {
    let max = 1;
    civs.forEach((civ) => {
      const value = civ.values[dim.metric] || 0;
      if (value > max) max = value;
    });
    return max;
  });
}

/**
 * Render the Archetype radar with a per-civ filtering legend (click a civ to
 * hide/show its polygon), matching the Legacy Path radar.
 * @param {HTMLElement} host
 * @param {*} options
 * @returns {void}
 */
export function renderPowerRadar(host, options) {
  host.innerHTML = "";
  const opts = options || {};
  const civs = loadCompareCivs(opts.history, RADAR_DIMS.map((dim) => dim.metric));
  if (!civs.size) return board.emptyState(host, t("LOC_DEMOGRAPHICS_BOARD_NO_COMPARABLE"));
  const hidden = coerceKeySet(opts.hiddenCivs);
  const maxes = radarMaxes(civs);
  const wrap = document.createElement("div");
  wrap.className = "demographics-chart-wrap";
  const svg = board.svgRoot(wrap, VW, VH);
  radarFrame(svg);
  civs.forEach((civ) => {
    if (!hidden.has(civ.key)) radarPolygon(svg, civ, maxes);
  });
  const onToggle = typeof opts.onToggleCiv === "function" ? opts.onToggleCiv : null;
  mountCompareLegend(wrap, civs, hidden, onToggle);
  host.appendChild(wrap);
}
