// chart-line-config.js
//
// Chart.js config-object builders for the per-civ line chart: the top-level
// config (data + plugins + options), the `options.plugins` block (legend /
// tooltip / title), the `options.scales` block, and the legend `onClick`
// handler. Extracted from chart-line.js (remediation #26). These are pure
// shape-builders - they only assemble objects, never mount or invoke Chart.js.
//
// Font-family resolution is deferred to call time and guarded so this module
// remains safe if Chart.js global wiring changes.

import { makeTooltipExternal } from "/demographics/ui/screen-demographics/chart-line-tooltip.js";
import { t } from "/demographics/ui/demographics-i18n.js";

// Axis labels/titles use the same color as the chart's HTML title
// (--ia-text-secondary) so they match it (Chart.js canvas needs a literal).
const AXIS_COLOR = "#e5d2ac";

/**
 * Resolve the chart font family with a safe fallback chain.
 * @returns {string} The preferred font family.
 */
function resolveChartFontFamily() {
  return (
    (typeof Chart !== "undefined" && Chart.defaults?.font?.family) ||
    "BodyFont, sans-serif"
  );
}

/**
 * The Y-axis title for a metric: its name plus the unit in parentheses
 * (e.g. "Military Power (strength)", "Crop Yield (food / turn)").
 * @param {*} metricMeta The metric metadata.
 * @returns {string} The Y-axis title.
 */
function yAxisTitle(metricMeta) {
  if (!metricMeta) return "";
  const name = metricMeta.label || metricMeta.title || "";
  return metricMeta.unit ? name + " (" + metricMeta.unit + ")" : name;
}

/**
 * A Chart.js scale `title` block matching the chart title's color.
 * @param {string} text The title text.
 * @returns {Record<string, *>} The title options.
 */
function axisTitleOpts(text) {
  return {
    display: !!text,
    text,
    color: AXIS_COLOR,
    font: { family: resolveChartFontFamily(), size: 18, weight: "600" }
  };
}

/**
 * @typedef {import("/demographics/ui/screen-demographics/chart-line-axis.js").AxisFormatters} AxisFormatters
 */

/**
 * Build the full Chart.js line-chart config (data + plugins + options).
 * @param {Object} parts Config inputs.
 * @param {Record<string, *>[]} parts.datasets The datasets.
 * @param {Record<string, *>[]} parts.plugins The plugin instances.
 * @param {*} parts.metricMeta The metric metadata.
 * @param {AxisFormatters} parts.formatters The axis tick formatters.
 * @returns {Record<string, *>} The Chart.js config object.
 */
export function buildLineChartConfig(parts) {
  const { datasets, plugins, metricMeta, formatters } = parts;
  return {
    type: "line",
    data: { datasets },
    plugins,
    options: {
      responsive: false,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      normalized: true,
      interaction: { mode: "nearest", intersect: false, axis: "x" },
      plugins: buildChartPluginsOpts(formatters),
      scales: buildChartScalesOpts(metricMeta, formatters)
    }
  };
}

/**
 * Build the Chart.js `options.plugins` block (legend / tooltip / title).
 * @param {AxisFormatters} formatters The axis tick formatters.
 * @returns {Record<string, *>} The plugins options block.
 */
function buildChartPluginsOpts(formatters) {
  const { fmtX, fmtY } = formatters;
  return {
    // The civ legend is rendered as a custom HTML list beside the chart
    // (chart-line-legend.js) so each entry can carry a live <fxs-icon> leader
    // portrait - the canvas-drawn Chart.js legend can't host one.
    legend: { display: false },
    tooltip: {
      // Disable Chart.js's canvas-painted tooltip and use an HTML overlay
      // styled with the engine's own `img-tooltip-border` + `img-tooltip-bg`
      // classes - border-image from blp:base_tooltip-bg, the same dark
      // gradient native tooltips use. Each row gets a small leader icon next
      // to the civ label.
      enabled: false,
      external: makeTooltipExternal(fmtX, fmtY)
    },
    // The chart already has an HTML title above it (buildChartTitle); the
    // Chart.js canvas title would be a redundant second title, so it's off.
    title: { display: false }
  };
}

/**
 * Build the Chart.js `options.scales` block (linear x + y axes).
 * @param {*} metricMeta The metric metadata.
 * @param {AxisFormatters} formatters The axis tick formatters.
 * @returns {Record<string, *>} The scales options block.
 */
function buildChartScalesOpts(metricMeta, formatters) {
  const { fmtX, fmtY } = formatters;
  return {
    x: {
      type: "linear",
      title: axisTitleOpts(t("LOC_DEMOGRAPHICS_AXIS_TIME")),
      ticks: {
        color: AXIS_COLOR,
        font: { family: resolveChartFontFamily(), size: 17 },
        maxRotation: 0,
        autoSkipPadding: 30,
        callback: (/** @type {number} */ v) => fmtX(v)
      },
      grid: { color: "rgba(133, 135, 140, 0.25)" },
      border: { color: "#85878C" }
    },
    y: {
      type: "linear",
      beginAtZero: true,
      title: axisTitleOpts(yAxisTitle(metricMeta)),
      ticks: {
        color: AXIS_COLOR,
        font: { family: resolveChartFontFamily(), size: 17 },
        // For metrics flagged `integerOnly`, blank out fractional tick labels
        // so e.g. Crisis Stage doesn't repeat "Stage 1 (Begins)" at 1, 1.5,
        // and 2 all rounding to the same integer. Chart.js still draws
        // gridlines at fractional positions; only the labels are suppressed.
        callback: (/** @type {number} */ v) => {
          if (metricMeta && metricMeta.integerOnly && Math.round(v) !== v) return "";
          return fmtY(v);
        },
        // Force integer step + zero decimals for integer-only metrics. The only
        // one today is the small-range Crisis Stage ordinal (-1..4), so a flat
        // stepSize is safe; if a large-range metric is ever flagged integerOnly,
        // gate this on an expected-range check so it doesn't request a tick at
        // every integer.
        ...(metricMeta && metricMeta.integerOnly ? { stepSize: 1, precision: 0 } : {})
      },
      grid: { color: "rgba(133, 135, 140, 0.25)" },
      border: { color: "#85878C" }
    }
  };
}
