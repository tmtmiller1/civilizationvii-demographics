// chart-line-config.js
//
// Chart.js config-object builders for the per-civ line chart: the top-level
// config (data + plugins + options), the `options.plugins` block (legend /
// tooltip / title), the `options.scales` block, and the legend `onClick`
// handler. Extracted from chart-line.js. These are pure
// shape-builders - they only assemble objects, never mount or invoke Chart.js.
//
// Font-family resolution is deferred to call time and guarded so this module
// remains safe if Chart.js global wiring changes.

import { makeTooltipExternal } from "/demographics/ui/screen-demographics/charts/line/chart-line-tooltip.js";
import { t } from "/demographics/ui/core/demographics-i18n.js";

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

// Maps each English `unit` string in the metric registry to its localized LOC
// key. Symbols that read the same in every language ($, %, km²) are absent and
// shown verbatim; any unmapped unit also falls back to its literal text.
/** @type {Record<string, string>} */
const UNIT_LOC = {
  points: "LOC_DEMOGRAPHICS_UNIT_POINTS",
  gold: "LOC_DEMOGRAPHICS_UNIT_GOLD",
  "gold / turn": "LOC_DEMOGRAPHICS_UNIT_GOLD_PER_TURN",
  cities: "LOC_DEMOGRAPHICS_UNIT_CITIES",
  techs: "LOC_DEMOGRAPHICS_UNIT_TECHS",
  // Reuse the base game's own (professionally localized) terms for game-specific
  // concepts so the labels always match the in-game vocabulary.
  civics: "LOC_PEDIA_PAGEGROUP_CIVICS_NAME",
  "food / turn": "LOC_DEMOGRAPHICS_UNIT_FOOD_PER_TURN",
  "production / turn": "LOC_DEMOGRAPHICS_UNIT_PRODUCTION_PER_TURN",
  "science / turn": "LOC_DEMOGRAPHICS_UNIT_SCIENCE_PER_TURN",
  "culture / turn": "LOC_DEMOGRAPHICS_UNIT_CULTURE_PER_TURN",
  "happiness / turn": "LOC_DEMOGRAPHICS_UNIT_HAPPINESS_PER_TURN",
  "influence / turn": "LOC_DEMOGRAPHICS_UNIT_INFLUENCE_PER_TURN",
  reputation: "LOC_DEMOGRAPHICS_UNIT_REPUTATION",
  people: "LOC_DEMOGRAPHICS_UNIT_PEOPLE",
  deals: "LOC_DEMOGRAPHICS_UNIT_DEALS",
  routes: "LOC_DEMOGRAPHICS_UNIT_ROUTES",
  strength: "LOC_DEMOGRAPHICS_UNIT_STRENGTH",
  wonders: "LOC_DEMOGRAPHICS_UNIT_WONDERS",
  resources: "LOC_DEMOGRAPHICS_UNIT_RESOURCES",
  stage: "LOC_DEMOGRAPHICS_UNIT_STAGE",
  // Resource-class units reuse the base game's canonical class names.
  bonus: "LOC_RESOURCECLASS_BONUS_NAME",
  city: "LOC_RESOURCECLASS_CITY_NAME",
  empire: "LOC_RESOURCECLASS_EMPIRE_NAME",
  factory: "LOC_RESOURCECLASS_FACTORY_NAME",
  treasure: "LOC_RESOURCECLASS_TREASURE_NAME"
};

/**
 * Localize a metric's unit string. Word-units resolve through {@link UNIT_LOC};
 * symbols and any unmapped value pass through unchanged (t() returns the key on
 * a miss, so a missing translation still falls back to the English literal).
 * @param {string|undefined} unit The registry unit string.
 * @returns {string} The localized (or literal) unit.
 */
function localizedUnit(unit) {
  if (!unit) return "";
  const key = UNIT_LOC[unit];
  if (!key) return unit;
  const v = t(key);
  return v && v !== key ? v : unit;
}

/**
 * The Y-axis title for a metric: its localized name plus the localized unit in
 * parentheses (e.g. "Military Power (strength)", "Crop Yield (food / turn)").
 * @param {*} metricMeta The metric metadata.
 * @returns {string} The Y-axis title.
 */
function yAxisTitle(metricMeta) {
  if (!metricMeta) return "";
  const key = metricMeta.id ? "LOC_DEMOGRAPHICS_METRIC_" + String(metricMeta.id).toUpperCase() : "";
  const localized = key ? t(key) : "";
  const name = (localized && localized !== key)
    ? localized
    : (metricMeta.label || metricMeta.title || "");
  const unit = localizedUnit(metricMeta.unit);
  return unit ? name + " (" + unit + ")" : name;
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
 * @typedef {import("/demographics/ui/screen-demographics/charts/line/chart-line-axis.js").
 *   AxisFormatters} AxisFormatters
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
      plugins: buildChartPluginsOpts(formatters, metricMeta),
      scales: buildChartScalesOpts(metricMeta, formatters)
    }
  };
}

/**
 * Build the Chart.js `options.plugins` block (legend / tooltip / title).
 * @param {AxisFormatters} formatters The axis tick formatters.
 * @param {*} [metricMeta] Optional metric metadata.
 * @returns {Record<string, *>} The plugins options block.
 */
function buildChartPluginsOpts(formatters, metricMeta) {
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
      external: makeTooltipExternal(fmtX, fmtY, metricMeta)
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
