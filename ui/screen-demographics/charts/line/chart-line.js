// chart-line.js
//
// The main per-civ time-series line chart (Chart.js): renderChart and its
// orchestration (prepareChartData / buildChartPluginSet), the Chart.js
// lifecycle (engine defaults, canvas teardown/mount), and the render-size math.
// The history->series pipeline lives in chart-line-series.js and the
// series->dataset shaping in chart-line-datasets.js; wonder/crisis/age markers,
// plugins, axis, config, and the HTML tooltip are their own chart-line-*
// siblings.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { getGameSeed } from "/demographics/ui/screen-demographics/charts/crises/crisis-names.js";
import {
  buildTurnMaps,
  computeAgeOffsets,
  makeAxisFormatters,
  sampleX
} from "/demographics/ui/screen-demographics/charts/line/chart-line-axis.js";
import { buildLineChartConfig } from "/demographics/ui/screen-demographics/charts/line/chart-line-config.js";
import {
  collectAgeMarkers,
  collectCrisisMarkers,
  makeAgeMarkerPlugin,
  makeCrisisMarkerPlugin,
  maxCrisisPillWidth
} from "/demographics/ui/screen-demographics/charts/line/chart-line-event-markers.js";
import {
  makeCapLimitLinePlugin,
  makeFocusGlowPlugin,
  makeHoverCrosshairPlugin
} from "/demographics/ui/screen-demographics/charts/line/chart-line-plugins.js";
import {
  collectWonderDestructions,
  collectWonderEvents,
  makeWonderMarkersPlugin,
  mergeWonderEvents,
  resolveWonderEvents,
  shouldShowWonders
} from "/demographics/ui/screen-demographics/charts/line/chart-line-wonder-markers.js";
import { buildSeriesFromHistory } from "/demographics/ui/screen-demographics/charts/line/chart-line-series.js";
import {
  applyShowEliminated,
  applySmoothChart,
  applyUnmetNames,
  buildChartDatasets,
  collapseGlobalMetric,
  resolveMetricMeta
} from "/demographics/ui/screen-demographics/charts/line/chart-line-datasets.js";
import {
  dlog,
  coerceKeySet,
  resolveTurnRange
} from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";
import { buildLineLegend } from "/demographics/ui/screen-demographics/charts/line/chart-line-legend.js";

/**
 * @typedef {import("/demographics/ui/screen-demographics/charts/line/chart-line-series.js").
 *   ChartSeries} ChartSeries
 */

/**
 * Metrics whose Y-axis tick labels are wide (currency, large counts, percent),
 * so the overlaid legend is pushed further right to clear the axis labels.
 * @type {Set<string>}
 */
const WIDE_Y_LEGEND = new Set([
  "gdp",
  "gold",
  "gpt",
  "production",
  "crops",
  "population",
  "settlement_cap_pct",
  "land",
  "science_yield",
  "culture_yield",
  "influence",
  "hpt",
  "approval"
]);

/**
 * Metrics with EXTRA-wide Y-axis tick labels (signed, spelled-out people counts like
 * "+240 million" / "-12 thousand"), which need the overlaid legend nudged further right than the
 * regular wide tier. Externally registered by the Emigration mod.
 * @type {Set<string>}
 */
const EXTRA_WIDE_Y_LEGEND = new Set([
  "emig_net_migration",
  "emig_out",
  "emig_in",
  "emig_refugees"
]);

// Line chart - Chart.js implementation.
// Replaces the prior custom SVG renderer. Chart.js is loaded into Civ7's
// runtime by the engine (used by <fxs-hof-chart>), so we can instantiate
// directly. We get pixel-identical fonts, gridlines, axis labels, and
// tooltips to the in-game graphs by reusing Chart.defaults the engine sets.
//
// Features preserved from the SVG version:
//   - Per-civ lines with the civ's primary color
//   - Muted civs (dimmed, not removed from the chart)
//   - Focused civs (non-focused get lower alpha)
//   - Time-range filter (filtered at data-build time)
//   - Year-aware X axis ticks ("T-52 / 2725 BCE")
//   - Y axis formatted per-metric (e.g. "$1.2B" for GDP, "Stage 1" for crisis)
//   - Click legend entry → toggle civ; click line → toggle focus
//   - Eliminated civs shown strikethrough in legend
//   - Global metrics (crisis_stage / age_progress) collapse to one line

/**
 * Destroy any prior Chart instance cached on the host before re-mounting.
 * @param {HTMLElement|*} host The chart host element.
 */
function teardownExistingChart(host) {
  if (!host) return;
  const cur = host._demographicsChart;
  if (cur && typeof cur.destroy === "function") {
    try {
      cur.destroy();
    } catch (_) {
      // Chart#destroy may throw on an already-disposed instance; ignore.
    }
  }
  host._demographicsChart = null;
}

// Apply the same Chart.defaults that the engine's fxs-hof-chart sets at
// module load (see core/ui/components/fxs-hof-chart.js). The defaults
// stick after first application, so duplicates are harmless; but if our
// chart instantiates before hof-chart has ever loaded, the stock Chart.js
// defaults (Arial, #666 text, etc.) leak through and our graphs look NOTHING
// like the in-game ones. Setting them ourselves guarantees parity.
let _engineDefaultsApplied = false;
/**
 * Apply the engine's `fxs-hof-chart` Chart.defaults (font, color) once, so our
 * charts match the in-game graphs even if hof-chart hasn't loaded yet.
 */
function applyEngineChartDefaults() {
  if (_engineDefaultsApplied) return;
  if (typeof Chart === "undefined") return;
  try {
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.color = "#E5E5E5";
    // Layout.textSizeToScreenPixels("lg") in-game resolves to ~17-18px
    // at typical UI scales. Hardcoding 16 is close enough and avoids a
    // dependency on Layout being in scope.
    if (Chart.defaults.font) {
      Chart.defaults.font.size = 16;
      // BodyFont is Civ7's actual UI font; fall back through TitilliumWeb
      // and sans-serif so we don't render in Times if BodyFont isn't
      // resolvable in our scope.
      Chart.defaults.font.family =
        "BodyFont, BodyFont-SC, BodyFont-TC, BodyFont-JP, BodyFont-KR, TitilliumWeb, sans-serif";
      Chart.defaults.font.weight = "normal";
      Chart.defaults.font.style = "normal";
    }
    _engineDefaultsApplied = true;
  } catch (_) {
    // Chart.defaults may be frozen/absent before hof-chart loads; leave stock defaults.
  }
}

/**
 * Resolve viewport dimensions with safe defaults.
 * @returns {{ vw: number, vh: number }} Viewport width and height.
 */
function viewportSize() {
  const vw = typeof window !== "undefined" && window.innerWidth ? window.innerWidth : 1920;
  const vh = typeof window !== "undefined" && window.innerHeight ? window.innerHeight : 1080;
  return { vw, vh };
}

/**
 * Clamp one render dimension to caller hints when the hint is meaningful.
 * @param {number} render Current computed render size.
 * @param {*} hint Caller size hint.
 * @returns {number} Clamped render size.
 */
function clampRenderByHint(render, hint) {
  if (typeof hint !== "number") return render;
  if (hint <= render * 0.6) return render;
  return Math.min(render, hint);
}

/**
 * Compute the viewport-relative canvas render size, clamping to the caller's
 * width/height hints when they're meaningfully large.
 * @param {ChartOptions} opts The render options.
 * @param {number} W Caller width floor.
 * @param {number} H Caller height floor.
 * @returns {{ renderW: number, renderH: number }} The render dimensions.
 */
function computeRenderSize(opts, W, H) {
  let renderW, renderH;
  try {
    const { vw, vh } = viewportSize();
    renderW = Math.max(960, Math.round(vw * 0.92));
    renderH = Math.max(420, Math.round(vh * 0.62));
    // Honor the caller's W/H as an upper bound (caller measured chartHost
    // - on a tall/wide layout it's the most accurate value we have).
    renderW = clampRenderByHint(renderW, opts.width);
    renderH = clampRenderByHint(renderH, opts.height);
  } catch (_) {
    renderW = Math.max(960, W);
    renderH = Math.max(420, H);
  }
  return { renderW, renderH };
}

/**
 * Fold one point's x value into current min/max bounds.
 * @param {{ min: number, max: number }} bounds Mutable bounds.
 * @param {*} point Chart point candidate.
 */
function foldXBounds(bounds, point) {
  if (typeof point?.x !== "number") return;
  if (point.x < bounds.min) bounds.min = point.x;
  if (point.x > bounds.max) bounds.max = point.x;
}

// Wonder-marker detection, tooltip, and Chart.js plugin extracted to
// chart-line-wonder-markers.js.

/**
 * @typedef {import(
 *   "/demographics/ui/screen-demographics/charts/line/chart-line-wonder-markers.js"
 * ).
 *   WonderEvent} WonderEvent
 * @typedef {import(
 *   "/demographics/ui/screen-demographics/charts/line/chart-line-wonder-markers.js"
 * ).
 *   WonderTipState} WonderTipState
 */

/**
 * Mount the Chart.js instance into `host`, logging on success and rendering a
 * fallback message on failure.
 * @param {Object} parts Mount inputs.
 * @param {*} parts.host The chart host (carries the engine `_demographicsChart`).
 * @param {*} parts.canvas The canvas element.
 * @param {Record<string, *>} parts.config The Chart.js config.
 * @param {Record<string, *>[]} parts.datasets The datasets (for logging).
 * @param {string} parts.metricId The metric id (for logging).
 * @param {number} parts.sampleCount The sample count (for logging).
 * @param {number} parts.W Final width (for logging).
 * @param {number} parts.H Final height (for logging).
 * @returns {*} The Chart instance, or `null` on failure.
 */
function mountLineChart(parts) {
  const { host, canvas, config, datasets, metricId, sampleCount, W, H } = parts;
  // Chart.js is a base-game-provided global (core/ui/external/chart-js); guard
  // for its absence the way Firaxis's own fxs-hof-chart.js does.
  if (typeof Chart === "undefined") {
    appendChartEmptyMessage(host, "LOC_DEMOGRAPHICS_EMPTY_CHARTJS_MISSING");
    return null;
  }
  const chart = tryCreateChart(canvas, config, host);
  if (!chart) return null;
  logChartMounted({ chart, datasets, metricId, sampleCount, W, H });
  return chart;
}

/**
 * Append a standard empty-state message to the chart host.
 * @param {*} host The chart host.
 * @param {string} locKey Localization key.
 */
function appendChartEmptyMessage(host, locKey) {
  const msg = document.createElement("div");
  msg.className = "demographics-empty font-body text-base";
  msg.textContent = t(locKey);
  host.appendChild(msg);
}

/**
 * Instantiate a Chart.js chart, wiring the host handle on success.
 * @param {*} canvas The chart canvas.
 * @param {Record<string, *>} config Chart.js config.
 * @param {*} host The chart host.
 * @returns {*|null} Chart instance, or null on failure.
 */
function tryCreateChart(canvas, config, host) {
  try {
    const ctx2d = canvas.getContext("2d");
    const chart = new Chart(ctx2d, config);
    host._demographicsChart = chart;
    return chart;
  } catch (e) {
    const err = /** @type {*} */ (e);
    console.error(
      "[Demographics.chart] Chart.js new Chart threw:",
      err && err.message,
      err && err.stack
    );
    appendChartEmptyMessage(host, "LOC_DEMOGRAPHICS_EMPTY_CHART_RENDER_FAILED");
    return null;
  }
}

/**
 * Emit the standard chart-mounted debug line.
 * @param {{
 *   chart: *,
 *   datasets: Record<string, *>[],
 *   metricId: string,
 *   sampleCount: number,
 *   W: number,
 *   H: number,
 * }} args Logging inputs.
 */
function logChartMounted(args) {
  const { chart, datasets, metricId, sampleCount, W, H } = args;
  const visibleCount = datasets.filter((/** @type {*} */ d) => !d._muted).length;
  dlog(
    "Chart.js mounted; visible=",
    visibleCount,
    "of",
    datasets.length,
    "metric=",
    metricId,
    "samples=",
    sampleCount,
    "size=",
    W + "x" + H,
    "chart.width=",
    chart.width,
    "chart.height=",
    chart.height
  );
}

/**
 * Muted/focused/series options accepted by {@link renderChart}.
 * @typedef {Object} ChartOptions
 * @property {DemoHistory|*} [history] The persisted history blob.
 * @property {string} [metric] Metric id to chart (default `"score"`).
 * @property {Set<string>|string[]} [hiddenCivs] Muted series keys.
 * @property {Set<string>|string[]} [focusedCivs] Focused series keys.
 * @property {number} [width] Caller width hint.
 * @property {number} [height] Caller height hint.
 * @property {{ min: number, max: number }} [turnRange] Time-range filter.
 * @property {(leaderType: string) => void} [onToggleCiv] Legend toggle callback.
 */

/**
 * Prepared chart data: series, metric metadata, datasets, axis formatters,
 * and the age-offset context needed for markers.
 * @typedef {Object} ChartPrep
 * @property {ChartSeries[]} allSeries The (transformed) series list.
 * @property {number} sampleCount The sample count.
 * @property {*} metricMeta The metric metadata.
 * @property {Record<string, *>[]} datasets The Chart.js datasets.
 * @property {import("/demographics/ui/screen-demographics/charts/line/chart-line-axis.js").
 *   AxisFormatters} formatters The axis tick formatters.
 * @property {Map<string, number>} ageOffsets Per-age cumulative offsets.
 * @property {AgeBoundary[]} boundaries Age boundary table.
 */

/**
 * Build all per-render chart data: series (with settings applied), datasets,
 * axis formatters, and the age-offset context for markers.
 * @param {ChartOptions} opts The render options.
 * @param {string} metricId The metric id.
 * @returns {ChartPrep} The prepared chart data.
 */
function prepareChartData(opts, metricId) {
  const muted = coerceKeySet(opts.hiddenCivs);
  const focused = coerceKeySet(opts.focusedCivs);

  const result = buildSeriesFromHistory(opts.history, metricId);
  let allSeries = result.series;
  const sampleCount = result.sampleCount;

  // showEliminatedCivs (default true) and smoothChart (default false).
  allSeries = applyShowEliminated(allSeries);
  allSeries = applySmoothChart(allSeries);

  const metricMeta = resolveMetricMeta(metricId);
  allSeries = collapseGlobalMetric(allSeries, metricMeta, metricId);

  // showUnmetNames masking.
  allSeries = applyUnmetNames(allSeries);

  const tr = resolveTurnRange(opts);

  // Year + age aware x-axis labels.
  const samps = opts.history && Array.isArray(opts.history.samples) ? opts.history.samples : [];
  const boundaries =
    opts.history && Array.isArray(opts.history.ageBoundaries) ? opts.history.ageBoundaries : [];
  const { offsets: ageOffsets, maxLocalByAge } = computeAgeOffsets(samps, boundaries);
  const turnMaps = buildTurnMaps(samps, ageOffsets, boundaries);
  const formatters = makeAxisFormatters(turnMaps, metricMeta, ageOffsets, maxLocalByAge);

  const datasets = buildChartDatasets(allSeries, muted, focused, tr);

  return { allSeries, sampleCount, metricMeta, datasets, formatters, ageOffsets, boundaries };
}

/**
 * Build the ordered Chart.js plugin set (focus glow, wonder markers, hover
 * crosshair, crisis markers, age markers, cap-limit line) for one render.
 * @param {ChartOptions} opts The render options.
 * @param {string} metricId The metric id.
 * @param {ChartPrep} prep The prepared chart data.
 * @returns {{ plugins: Record<string, *>[], crisisMarkers: Record<string, *>[] }}
 *   The ordered plugin instances plus the collected crisis markers.
 */
function buildChartPluginSet(opts, metricId, prep) {
  const { allSeries, ageOffsets, boundaries } = prep;
  // Wonder-built event markers - detect, resolve icons/names, then mount as an
  // HTML overlay plugin (differential updates avoid hover flicker).
  const wonderSamples =
    opts.history && Array.isArray(opts.history.samples) ? opts.history.samples : [];
  const wonderEventsByPid = shouldShowWonders(metricId)
    ? collectWonderEvents(wonderSamples, ageOffsets, boundaries, sampleX)
    : new Map();
  // Wonder DESTRUCTIONS (a wonder permanently gone from every civ's list, i.e.
  // its city was razed) are detected by the inverse diff and merged in as
  // "destroyed"-kind events on the last holder's line.
  if (shouldShowWonders(metricId)) {
    mergeWonderEvents(
      wonderEventsByPid,
      collectWonderDestructions(wonderSamples, ageOffsets, boundaries, sampleX)
    );
  }
  resolveWonderEvents(wonderEventsByPid);
  dlog(
    "wonder events detected:",
    wonderEventsByPid.size,
    "civs;",
    Array.from(wonderEventsByPid.values()).reduce((n, arr) => n + arr.length, 0),
    "total wonder events"
  );
  const wonderMarkerEls = new Map(); // key: "pid:turn" -> div element
  // Singleton custom hover tooltip - Coherent ignores native `title`.
  /** @type {WonderTipState} */
  const wonderTipState = { wonderTip: null };
  const wonderMarkersPlugin = makeWonderMarkersPlugin(
    allSeries,
    wonderEventsByPid,
    wonderMarkerEls,
    wonderTipState
  );

  // Crisis stage transition + age-boundary markers.
  const crisisMarkers = collectCrisisMarkers(metricId, opts.history, {
    ageOffsets,
    boundaries,
    gameSeedStr: getGameSeed(),
    sampleX
  });
  const ageMarkers = collectAgeMarkers(opts.history, ageOffsets);

  const plugins = [
    makeFocusGlowPlugin(),
    wonderMarkersPlugin,
    makeHoverCrosshairPlugin(),
    makeAgeMarkerPlugin(ageMarkers),
    makeCrisisMarkerPlugin(crisisMarkers),
    makeCapLimitLinePlugin(metricId)
  ];
  return { plugins, crisisMarkers };
}

/**
 * Compute the min/max chart-X across all dataset points (the points are
 * `{x, y}` with parsing disabled), or `null` when there are none.
 * @param {Record<string, *>[]} datasets The chart datasets.
 * @returns {{ min: number, max: number }|null} The x bounds, or `null`.
 */
function dataXBounds(datasets) {
  const bounds = { min: Infinity, max: -Infinity };
  for (const ds of datasets || []) {
    for (const p of (ds && ds.data) || []) {
      foldXBounds(bounds, p);
    }
  }
  return bounds.min <= bounds.max ? bounds : null;
}

/**
 * Extend the x-axis max so the rightmost data column has exactly enough PIXEL
 * room on its right for the widest crisis-marker label to draw to the right of
 * its line. Run AFTER first layout (so the real plot width is known), then the
 * chart is updated once. A pixel-exact pad is necessary because metrics with
 * wide y-axis labels (e.g. GDP, Population) get a narrower plot area, so a fixed
 * fraction of the data span would not give those labels enough room.
 * @param {*} chart The mounted Chart instance.
 * @param {Record<string, *>[]} crisisMarkers The crisis markers.
 * @param {Record<string, *>[]} datasets The chart datasets.
 */
function applyCrisisRightPadding(chart, crisisMarkers, datasets) {
  if (!crisisMarkers.length || !chart.chartArea || !chart.options.scales) return;
  const label = maxCrisisPillWidth(chart, crisisMarkers) + 8; // +8px breathing gap
  const plotW = chart.chartArea.right - chart.chartArea.left;
  const b = dataXBounds(datasets);
  if (!b || b.max <= b.min || plotW <= label) return;
  // Closed form: pad max so plotW * (max - dataMax) / (max - dataMin) == label.
  chart.options.scales.x.max = (plotW * b.max - label * b.min) / (plotW - label);
  chart.update("none");
}

/**
 * Render the main per-civ line chart (Chart.js) into `host`. Tears down any
 * prior chart, builds series from history, applies the showEliminatedCivs /
 * smoothChart / showUnmetNames / time-range options, then mounts the canvas
 * with marker, glow, crosshair, and tooltip plugins.
 * @param {HTMLElement} host The chart host element (cleared and repopulated).
 * @param {ChartOptions} [options] Render options.
 * @returns {{ canvas: HTMLElement, chart: *, series: ChartSeries[] }|null}
 *   Handles to the canvas/chart/series, or `null` on failure.
 */
export function renderChart(host, options) {
  const setup = prepareLineChartRender(host, options);
  if (!setup) return null;
  const { hostEl, opts, W, H, metricId } = setup;

  const prep = prepareChartData(opts, metricId);
  const { allSeries, sampleCount, metricMeta, datasets, formatters } = prep;
  const { renderW, renderH } = computeRenderSize(opts, W, H);

  const mounted = mountPreparedLineChart({
    host: hostEl,
    opts,
    metricId,
    prep,
    datasets,
    metricMeta,
    formatters,
    sampleCount,
    renderW,
    renderH
  });
  if (!mounted) return null;
  return { canvas: mounted.canvas, chart: mounted.chart, series: allSeries };
}

/**
 * Prepare host/options and apply shared pre-render chart setup.
 * @param {HTMLElement} host The chart host.
 * @param {ChartOptions|undefined} options Render options.
 * @returns {{ hostEl: HTMLElement, opts: ChartOptions, W: number, H: number,
 *   metricId: string }|null} Prepared setup.
 */
function prepareLineChartRender(host, options) {
  if (!host) {
    console.error("[Demographics.chart] renderChart: host is required");
    return null;
  }
  teardownExistingChart(host);
  while (host.firstChild) host.removeChild(host.firstChild);

  const opts = options || {};
  const W = opts.width || 1400;
  const H = opts.height || 600;
  const metricId = opts.metric || "score";

  if (typeof Chart === "undefined") {
    console.error("[Demographics.chart] Chart.js global missing — cannot render");
    return null;
  }
  applyEngineChartDefaults();

  return { hostEl: host, opts, W, H, metricId };
}

/**
 * Build plugins/canvas/config and mount a prepared line chart.
 * @param {{
 *   host: HTMLElement,
 *   opts: ChartOptions,
 *   metricId: string,
 *   prep: ChartPrep,
 *   datasets: Record<string, *>[],
 *   metricMeta: *,
 *   formatters: import(
 *     "/demographics/ui/screen-demographics/charts/line/chart-line-axis.js"
 *   ).AxisFormatters,
 *   sampleCount: number,
 *   renderW: number,
 *   renderH: number,
 * }} args Mount inputs.
 * @returns {{ canvas: HTMLElement, chart: * }|null} Mount outputs.
 */
function mountPreparedLineChart(args) {
  const {
    host,
    opts,
    metricId,
    prep,
    datasets,
    metricMeta,
    formatters,
    sampleCount,
    renderW,
    renderH
  } = args;
  const { plugins, crisisMarkers } = buildChartPluginSet(opts, metricId, prep);
  const legendEl = buildLegendForMetric(datasets, opts, metricId);
  const { wrap, canvas } = buildChartCanvas(renderW, renderH, legendEl);
  host.appendChild(wrap);

  const config = buildLineChartConfig({
    datasets,
    plugins,
    metricMeta,
    formatters
  });
  const chart = mountLineChart({
    host,
    canvas,
    config,
    datasets,
    metricId,
    sampleCount,
    W: renderW,
    H: renderH
  });
  if (!chart) return null;

  // Now that the chart has laid out (real plot width known), add right-edge
  // future padding sized to the widest crisis label so it draws right of its
  // line on every metric, including wide-y-axis ones.
  applyCrisisRightPadding(chart, crisisMarkers, datasets);
  return { canvas, chart };
}

/**
 * Build the per-civ legend for a metric, nudging it right (wide-Y variant) when
 * the metric's Y-axis labels are wide. Returns null when there are no datasets.
 * @param {*[]} datasets The chart datasets.
 * @param {*} opts The render options.
 * @param {string} metricId The active metric id.
 * @returns {HTMLElement|null} The legend element, or null.
 */
function buildLegendForMetric(datasets, opts, metricId) {
  if (!datasets.length) return null;
  const legendEl = buildLineLegend(datasets, opts);
  if (EXTRA_WIDE_Y_LEGEND.has(metricId)) {
    legendEl.classList.add("demographics-line-legend-overlay-extra-wide");
  } else if (WIDE_Y_LEGEND.has(metricId)) {
    legendEl.classList.add("demographics-line-legend-overlay-wide");
  }
  return legendEl;
}

/**
 * Build the relatively-positioned wrap + full-width canvas for the line chart.
 * The custom HTML legend (when provided) is OVERLAID in the plot's top-left
 * (where rising lines rarely reach) instead of taking a side column, so the
 * canvas fills the whole width. Marker/tooltip overlays anchor to the canvas at
 * the wrap's top-left.
 * @param {number} renderW The total render width (px).
 * @param {number} renderH The render height (px).
 * @param {HTMLElement|null} [legendEl] The custom HTML legend, or null.
 * @returns {{ wrap: HTMLElement, canvas: HTMLElement }} The wrap and canvas.
 */
function buildChartCanvas(renderW, renderH, legendEl) {
  const wrap = document.createElement("div");
  wrap.className = "demographics-chartjs-wrap demographics-line-chartjs-wrap";
  // Render dimensions are dynamic (computed per viewport) - keep inline.
  wrap.style.width = renderW + "px";
  wrap.style.height = renderH + "px";

  const canvas = document.createElement("canvas");
  canvas.className = "demographics-line-chartjs-canvas";
  canvas.width = renderW;
  canvas.height = renderH;
  // Canvas CSS size mirrors the dynamic render dimensions - keep inline.
  canvas.style.width = renderW + "px";
  canvas.style.height = renderH + "px";
  wrap.appendChild(canvas);

  if (legendEl) {
    // Overlay in the top-left corner; cap height so a long roster scrolls.
    legendEl.classList.add("demographics-line-legend-overlay");
    legendEl.style.maxHeight = Math.max(80, renderH - 64) + "px";
    wrap.appendChild(legendEl);
  }
  return { wrap, canvas };
}
