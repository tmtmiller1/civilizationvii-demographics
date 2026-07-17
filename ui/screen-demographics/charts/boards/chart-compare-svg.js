// chart-compare-svg.js
//
// SVG "compare the civs at a glance" charts, all with a shared click-to-hide
// civ-filter legend (driven by the screen's hiddenCivs / onToggleCiv):
//   • Fingerprint scatters — each civ a dot on two yield axes (Science×Military,
//     Gold×Culture, Influence×Happiness), so the cloud shape reveals archetypes.
//   • Archetype radar — six dimensions per civ, normalized to the field max.
// Identity/color come from buildSeriesFromHistory (latest sample), so keys match
// every other chart and the shared hidden-civ filter applies. Text in ink.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { safeTextColor } from "/demographics/ui/core/civ-color-utils.js";
import { safePlaySound } from "/demographics/ui/core/demographics-audio.js";
import { coerceKeySet } from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";
import { buildSeriesFromHistory } from "/demographics/ui/screen-demographics/charts/line/chart-line-series.js";
import { buildLeaderIconGroup } from "/demographics/ui/screen-demographics/charts/line/chart-line-tooltip.js";
import {
  applyEngineChartDefaults,
  buildChartCanvas,
  computeRenderSize,
  teardownExistingChart,
  tryCreateChart
} from "/demographics/ui/screen-demographics/charts/line/chart-line.js";
import { buildLineLegend } from "/demographics/ui/screen-demographics/charts/line/chart-line-legend.js";
import * as U from "/demographics/ui/screen-demographics/charts/boards/board-ui.js";

const VW = 1000;
const VH = 560;

// ── Shared compare data + filtering legend ───────────────────────────────────

/**
 * A civ's compare record.
 * @typedef {Object} CompareCiv
 * @property {string} key Series key (leaderType hash or `pid:<id>`).
 * @property {string} label Civ label. @property {string|null} leaderTypeString Icon type.
 * @property {string} color Readable civ color. @property {Record<string, number>} values Latest metric values.
 */

/**
 * Load per-civ compare data (identity + deconflicted color + the latest sampled
 * value of each requested metric) from history via buildSeriesFromHistory, so
 * keys/colors match every other chart and the shared hidden-civ filter applies.
 * @param {*} history The persisted history blob.
 * @param {string[]} metricIds The metrics whose latest values to read.
 * @returns {Map<string, CompareCiv>} key → civ.
 */
function loadCompareCivs(history, metricIds) {
  /** @type {Map<string, CompareCiv>} */
  const civs = new Map();
  metricIds.forEach((metric) => {
    const series = /** @type {*[]} */ (buildSeriesFromHistory(history, metric).series);
    for (const s of series) {
      let civ = civs.get(s.leaderType);
      if (!civ) {
        // s.name is the composed "Leader (Civ)" display name — it already honors
        // the global Civ/Leader order toggle (via displayName → orderedNames).
        civ = {
          key: s.leaderType, label: s.name, leaderTypeString: s.leaderTypeString,
          color: safeTextColor(s.color) || s.color, values: {}
        };
        civs.set(s.leaderType, civ);
      }
      const last = s.points.length ? s.points[s.points.length - 1].v : undefined;
      if (typeof last === "number" && isFinite(last)) civ.values[metric] = last;
    }
  });
  return civs;
}

/**
 * Build one clickable legend row (portrait + colored dot + name), `is-hidden`
 * when the civ is filtered off. Matches the line / Legacy Path radar legend.
 * @param {CompareCiv} civ @param {boolean} isHidden @param {((k:string)=>void)|null} onToggle
 * @returns {HTMLElement} The legend row.
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
 * @param {HTMLElement} wrap @param {{forEach:(cb:(c:CompareCiv)=>void)=>void}} civs Map or array of civs.
 * @param {Set<string>} hidden @param {((k:string)=>void)|null} onToggle
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

// ── Scatter (Chart.js) ───────────────────────────────────────────────────────
//
// Rendered with Chart.js (type "scatter"), NOT hand-drawn SVG, so the axes,
// fonts, gridlines, overlaid legend, and HTML tooltip are pixel-identical to the
// "Yields per turn" line chart — same engine, same per-pixel sizing (SVG scaled a
// 1000-wide viewBox up to the plot, magnifying every font; Chart.js renders at the
// real canvas size like the line charts). Each civ is one single-point dataset so
// the shared civ-filter legend + hidden-toggle apply exactly as on the line chart.

// Styling tokens copied from chart-line-config.js so the canvas reads identically
// to the line charts (Chart.js needs literals, not CSS vars).
const AXIS_COLOR = "#e5d2ac";
const GRID = "rgba(133, 135, 140, 0.25)";
const AXIS_BORDER = "#85878C";

/** @returns {string} The engine chart font family, with a safe fallback chain. */
function fontFamily() {
  return (typeof Chart !== "undefined" && Chart.defaults?.font?.family) || "BodyFont, sans-serif";
}

/** @param {number} v @returns {string} A number with grouped thousands (e.g. "1,234"). */
function groupThousands(v) {
  if (typeof v !== "number" || !isFinite(v)) return "";
  const n = Math.round(v * 100) / 100;
  const parts = String(n).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}

/** @param {string} text @returns {Record<string, *>} Axis-title opts matching the line chart. */
function axisTitle(text) {
  return {
    display: !!text, text, color: AXIS_COLOR,
    font: { family: fontFamily(), size: 18, weight: "600" }
  };
}

/**
 * A linear metric axis (x or y) styled like the line chart: gold ticks + title,
 * faint gridlines, gray border, starting at 0, grouped-thousand tick labels.
 * @param {string} title The axis title.
 * @returns {Record<string, *>} The Chart.js axis options.
 */
function metricAxis(title) {
  return {
    type: "linear",
    beginAtZero: true,
    title: axisTitle(title),
    ticks: {
      color: AXIS_COLOR, font: { family: fontFamily(), size: 17 },
      callback: (/** @type {number} */ v) => groupThousands(v)
    },
    grid: { color: GRID },
    border: { color: AXIS_BORDER }
  };
}

/**
 * The civs that have a finite value for BOTH axes (the plottable set).
 * @param {Map<string, CompareCiv>} civs @param {string} xMetric @param {string} yMetric
 * @returns {CompareCiv[]} The plottable civs.
 */
function scatterPlottable(civs, xMetric, yMetric) {
  return [...civs.values()].filter(
    (c) => typeof c.values[xMetric] === "number" && typeof c.values[yMetric] === "number"
  );
}

/**
 * Build one civ's single-point scatter dataset. Identity/color carried through so
 * the shared legend, hidden-toggle, and tooltip work exactly like the line chart.
 * @param {CompareCiv} civ @param {string} xMetric @param {string} yMetric @param {Set<string>} hidden
 * @returns {Record<string, *>} The Chart.js dataset.
 */
function scatterDataset(civ, xMetric, yMetric, hidden) {
  const color = safeTextColor(civ.color) || civ.color;
  return {
    label: civ.label, leaderType: civ.key, leaderTypeString: civ.leaderTypeString,
    data: [{ x: civ.values[xMetric], y: civ.values[yMetric] }],
    backgroundColor: color, borderColor: color, pointBorderColor: color,
    pointRadius: 9, pointHoverRadius: 11, showLine: false,
    hidden: hidden.has(civ.key)
  };
}

/** @param {*} opts @returns {Record<string, *>} Legend callbacks bound to the render ctx. */
function scatterLegendOpts(opts) {
  return {
    hiddenCivs: opts.hiddenCivs,
    onToggleVisibility: (/** @type {string} */ k) => opts.onToggleCiv && opts.onToggleCiv(k),
    onSetAllHidden: (/** @type {boolean} */ h, /** @type {string[]} */ keys) =>
      opts.onSetAllHidden && opts.onSetAllHidden(h, keys)
  };
}

/**
 * Append one labeled value line ("<axis title> …… <value>") to the tooltip, the
 * value in the civ color — mirrors the line-chart tooltip's per-row value cell.
 * @param {HTMLElement} tip @param {string} title @param {number} value @param {string} color
 */
function appendScatterTipVal(tip, title, value, color) {
  const row = document.createElement("div");
  row.className = "demographics-line-tip-row";
  const label = document.createElement("span");
  label.className = "demographics-line-tip-name";
  label.textContent = title;
  row.appendChild(label);
  const val = document.createElement("span");
  val.className = "demographics-line-tip-val";
  val.style.color = color;
  val.textContent = groupThousands(value);
  row.appendChild(val);
  tip.appendChild(row);
}

/**
 * Fill the tooltip for the hovered civ: the standard leader portrait + color dot +
 * name row, then the two axis value lines.
 * @param {HTMLElement} tip The tooltip element. @param {*} dp The Chart.js data point.
 * @param {string} xTitle @param {string} yTitle
 */
function fillScatterTip(tip, dp, xTitle, yTitle) {
  const ds = dp.dataset;
  const color = safeTextColor(typeof ds.borderColor === "string" ? ds.borderColor : "#e5d2ac");
  while (tip.firstChild) tip.removeChild(tip.firstChild);
  const head = document.createElement("div");
  head.className = "demographics-line-tip-row";
  head.appendChild(buildLeaderIconGroup(ds, color));
  const name = document.createElement("span");
  name.className = "demographics-line-tip-name";
  name.textContent = ds.label || "";
  head.appendChild(name);
  tip.appendChild(head);
  appendScatterTipVal(tip, xTitle, dp.parsed.x, color);
  appendScatterTipVal(tip, yTitle, dp.parsed.y, color);
}

/**
 * Position the HTML tooltip next to the cursor (Chart.js caret), clamped inside
 * the wrap — the same placement the line chart's external tooltip uses.
 * @param {HTMLElement} tip @param {*} chart @param {*} tooltip @param {HTMLElement} wrap
 */
function positionScatterTip(tip, chart, tooltip, wrap) {
  const offsetLeft = chart.canvas.offsetLeft;
  const offsetTop = chart.canvas.offsetTop;
  let left = offsetLeft + tooltip.caretX + 14;
  let top = offsetTop + tooltip.caretY - 8;
  tip.style.opacity = "1";
  const wrapW = wrap.clientWidth, wrapH = wrap.clientHeight;
  const tipW = tip.offsetWidth, tipH = tip.offsetHeight;
  if (left + tipW > wrapW) left = offsetLeft + tooltip.caretX - tipW - 14;
  if (top + tipH > wrapH) top = wrapH - tipH - 4;
  if (top < 0) top = 4;
  tip.style.left = left + "px";
  tip.style.top = top + "px";
}

/**
 * Build the Chart.js `tooltip.external` handler: the same dark chrome the line
 * chart uses, showing the hovered civ + both axis values.
 * @param {string} xTitle @param {string} yTitle
 * @returns {(context:*) => void} The external tooltip handler.
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
    const dp = tooltip.opacity === 0 ? null : tooltip.dataPoints && tooltip.dataPoints[0];
    if (!dp) {
      tip.style.opacity = "0";
      return;
    }
    fillScatterTip(tip, dp, xTitle, yTitle);
    positionScatterTip(tip, chart, tooltip, wrap);
  };
}

/**
 * Resolve the scatter's axis metrics and (localized) titles from options, applying the
 * Science-vs-Military "Fingerprint" defaults.
 * @param {*} o Options (xMetric/yMetric/xTitle/yTitle).
 * @returns {{ xMetric: string, yMetric: string, xTitle: string, yTitle: string }}
 */
function scatterAxisSpec(o) {
  return {
    xMetric: o.xMetric || "science_yield",
    yMetric: o.yMetric || "milpower",
    xTitle: t(o.xTitle || "LOC_DEMOGRAPHICS_SCATTER_AXIS_SCIENCE_PT"),
    yTitle: t(o.yTitle || "LOC_DEMOGRAPHICS_SCATTER_AXIS_MILITARY_POWER")
  };
}

/**
 * Render a two-axis civ scatter (Chart.js) with the shared click-to-hide filter
 * legend: each civ a dot on (xMetric, yMetric), so the cloud shape reveals
 * strategic archetypes. Defaults to the Science-vs-Military "Fingerprint"; a spec
 * on `opts` (xMetric/yMetric/xTitle/yTitle) selects any pair.
 * @param {HTMLElement} host The chart host.
 * @param {*} opts Options (history, xMetric/yMetric/xTitle/yTitle, width/height,
 *   hiddenCivs, onToggleCiv, onSetAllHidden).
 * @returns {void}
 */
export function renderCivScatter(host, opts) {
  const o = opts || {};
  const { xMetric, yMetric, xTitle, yTitle } = scatterAxisSpec(o);

  teardownExistingChart(host);
  while (host.firstChild) host.removeChild(host.firstChild);
  if (typeof Chart === "undefined") {
    return U.emptyState(host, t("LOC_DEMOGRAPHICS_EMPTY_CHARTJS_MISSING"));
  }
  applyEngineChartDefaults();

  const pts = scatterPlottable(loadCompareCivs(o.history, [xMetric, yMetric]), xMetric, yMetric);
  if (!pts.length) return U.emptyState(host, t("LOC_DEMOGRAPHICS_BOARD_NO_COMPARABLE"));

  const hidden = coerceKeySet(o.hiddenCivs);
  const datasets = pts.map((c) => scatterDataset(c, xMetric, yMetric, hidden));
  const options = {
    responsive: false, maintainAspectRatio: false, animation: false,
    interaction: { mode: "nearest", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false, external: makeScatterTooltipExternal(xTitle, yTitle) },
      title: { display: false }
    },
    scales: { x: metricAxis(xTitle), y: metricAxis(yTitle) }
  };
  const { renderW, renderH } = computeRenderSize(o, o.width || 1400, o.height || 600);
  const legend = buildLineLegend(datasets, scatterLegendOpts(o));
  const { wrap, canvas } = buildChartCanvas(renderW, renderH, legend);
  host.appendChild(wrap);
  // type "line" (not "scatter") with per-dataset showLine:false — the LineController
  // is the one the line/trend charts already use, so we don't depend on the engine's
  // Chart.js build having ScatterController registered. Renders points only.
  tryCreateChart(canvas, { type: "line", data: { datasets }, options }, host);
}

// ── Radar (Archetype) ────────────────────────────────────────────────────────

/** Radar dimensions: metric id → axis label. */
const RADAR_DIMS = [
  { metric: "science_yield", label: "LOC_DEMOGRAPHICS_RADAR_AXIS_SCIENCE" },
  { metric: "milpower", label: "LOC_DEMOGRAPHICS_RADAR_AXIS_MILITARY" },
  { metric: "gdp", label: "LOC_DEMOGRAPHICS_RADAR_AXIS_ECONOMY" },
  { metric: "culture_yield", label: "LOC_DEMOGRAPHICS_RADAR_AXIS_CULTURE" },
  { metric: "population", label: "LOC_DEMOGRAPHICS_RADAR_AXIS_PEOPLE" },
  { metric: "land", label: "LOC_DEMOGRAPHICS_RADAR_AXIS_LAND" }
];
const RCX = VW / 2;
const RCY = VH / 2 + 6;
const RR = 200;

/** @param {number} i @param {number} radius @returns {{x:number, y:number}} Radar vertex. */
function radarPoint(i, radius) {
  const ang = (-90 + (i * 360) / RADAR_DIMS.length) * (Math.PI / 180);
  return { x: RCX + radius * Math.cos(ang), y: RCY + radius * Math.sin(ang) };
}

/** @param {SVGElement} svg Draw the radar spokes, rings, and axis labels. */
function radarFrame(svg) {
  for (const ring of [0.25, 0.5, 0.75, 1]) {
    const pts = RADAR_DIMS.map((_, i) => {
      const p = radarPoint(i, RR * ring);
      return p.x.toFixed(1) + "," + p.y.toFixed(1);
    }).join(" ");
    svg.appendChild(U.svgEl("polygon", { points: pts, fill: "none", stroke: U.GRID }));
  }
  RADAR_DIMS.forEach((dim, i) => {
    const edge = radarPoint(i, RR);
    svg.appendChild(U.svgEl("line", { x1: RCX, y1: RCY, x2: edge.x, y2: edge.y, stroke: U.GRID }));
    const lp = radarPoint(i, RR + 24);
    svg.appendChild(U.svgText(lp.x, lp.y, t(dim.label), { anchor: "middle", fill: U.INK }));
  });
}

/**
 * Append one civ's normalized radar polygon.
 * @param {SVGElement} svg @param {CompareCiv} civ @param {number[]} maxes Per-dim maxima.
 */
function radarPolygon(svg, civ, maxes) {
  const pts = RADAR_DIMS.map((dim, i) => {
    const v = civ.values[dim.metric] || 0;
    const p = radarPoint(i, RR * (maxes[i] > 0 ? Math.max(0, v) / maxes[i] : 0));
    return p.x.toFixed(1) + "," + p.y.toFixed(1);
  }).join(" ");
  const poly = U.svgEl("polygon", {
    points: pts, fill: civ.color, "fill-opacity": 0.14, stroke: civ.color,
    "stroke-width": 2, "stroke-linejoin": "round"
  });
  poly.setAttribute("data-tooltip-content", civ.label);
  svg.appendChild(poly);
}

/** @param {Map<string, CompareCiv>} civs @returns {number[]} Per-dimension maxima (floored at 1). */
function radarMaxes(civs) {
  return RADAR_DIMS.map((d) => {
    let m = 1;
    civs.forEach((c) => {
      const v = c.values[d.metric] || 0;
      if (v > m) m = v;
    });
    return m;
  });
}

/**
 * Render the Archetype radar with a per-civ filtering legend (click a civ to
 * hide/show its polygon), matching the Legacy Path radar.
 * @param {HTMLElement} host The chart host. @param {*} options Render options.
 * @returns {void}
 */
export function renderPowerRadar(host, options) {
  host.innerHTML = "";
  const opts = options || {};
  const civs = loadCompareCivs(opts.history, RADAR_DIMS.map((d) => d.metric));
  if (!civs.size) return U.emptyState(host, t("LOC_DEMOGRAPHICS_BOARD_NO_COMPARABLE"));
  const hidden = coerceKeySet(opts.hiddenCivs);
  const maxes = radarMaxes(civs);
  const wrap = document.createElement("div");
  wrap.className = "demographics-chart-wrap";
  const svg = U.svgRoot(wrap, VW, VH);
  radarFrame(svg);
  civs.forEach((civ) => {
    if (!hidden.has(civ.key)) radarPolygon(svg, civ, maxes);
  });
  const onToggle = typeof opts.onToggleCiv === "function" ? opts.onToggleCiv : null;
  mountCompareLegend(wrap, civs, hidden, onToggle);
  host.appendChild(wrap);
}
