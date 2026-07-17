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
  // concepts so the labels always match the in-game vocabulary. These are
  // engine-owned base-game LOC tags, NOT defined in our ModText.xml — see
  // BASE_GAME_LOC_KEYS in demographics-i18n.js.
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
  // Resource-class units reuse the base game's canonical class names
  // (base-game LOC tags; see BASE_GAME_LOC_KEYS in demographics-i18n.js).
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
  // A metric may opt into a bar chart (`chartType:"bar"` on its spec), Chart.js bars share the same
  // datasets/scales and natively handle negative values (bars below the zero baseline) and grouping
  // (one clustered bar per civ at each turn). Datasets already set backgroundColor = civ colour.
  const type = metricMeta && metricMeta.chartType === "bar" ? "bar" : "line";
  // A signed metric charted as bars (e.g. Net Migration) gets a SYMMETRIC, zero-centred y-axis so
  // positive and negative read evenly above/below the baseline. Without it, Chart.js auto-ranges to
  // [0, max], which on a near-zero / empty chart collapses to a degenerate "+0/+1" axis with no
  // negative side. The half-range floors at 1 so even an empty chart shows -1 / 0 / +1.
  const symBound = type === "bar" ? symmetricYBound(datasets) : null;
  return {
    type,
    data: { datasets },
    plugins,
    options: {
      responsive: false,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      normalized: true,
      // Default "nearest" shows the single closest line; a metric can opt into "index" (via
      // metricMeta.tooltipMode) so hovering a turn lists EVERY civ at that turn, the readable way
      // to tell apart overlapping lines (e.g. Net Migration, where civ lines cluster near the
      // baseline).
      interaction: {
        mode: (metricMeta && metricMeta.tooltipMode) || "nearest",
        intersect: false,
        axis: "x"
      },
      plugins: buildChartPluginsOpts(formatters, metricMeta),
      scales: buildChartScalesOpts(metricMeta, formatters, symBound)
    }
  };
}

/**
 * The absolute y-value of a chart data point, or 0 when missing/non-finite.
 * @param {*} pt A {x, y} data point.
 * @returns {number} |y|, or 0.
 */
function ptAbsY(pt) {
  return pt && typeof pt.y === "number" && isFinite(pt.y) ? Math.abs(pt.y) : 0;
}

/**
 * The symmetric y-axis half-range for a diverging bar chart: the largest absolute data value across
 * every dataset, floored at 1 (so an empty/all-zero chart still shows a -1 / 0 / +1 axis).
 * @param {Record<string, *>[]} datasets The chart datasets.
 * @returns {number} A positive half-range bound.
 */
function symmetricYBound(datasets) {
  let m = 0;
  for (const ds of datasets || []) {
    for (const pt of (ds && ds.data) || []) {
      const y = ptAbsY(pt);
      if (y > m) m = y;
    }
  }
  return m > 0 ? m : 1;
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
 * @param {number|null} [symBound] Symmetric y half-range for a diverging bar chart (null = auto).
 * @returns {Record<string, *>} The scales options block.
 */
function buildChartScalesOpts(metricMeta, formatters, symBound) {
  const { fmtX, fmtY } = formatters;
  // A diverging bar chart pins the y-axis to [-symBound, +symBound] (0 centred); everything else
  // auto-ranges from zero.
  const diverging = typeof symBound === "number";
  const yBounds = diverging ? { min: -symBound, max: symBound } : { beginAtZero: true };
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
      ...yBounds,
      title: axisTitleOpts(yAxisTitle(metricMeta)),
      ticks: {
        color: AXIS_COLOR,
        font: { family: resolveChartFontFamily(), size: 17 },
        // Blank fractional tick labels for `integerOnly` metrics (e.g. Crisis Stage) AND for
        // diverging bar charts, so a near-zero Net Migration axis shows clean -1 / 0 / +1 instead
        // of repeating "+0/+1" at every fractional gridline. Chart.js still draws the gridlines;
        // only labels hide.
        callback: (/** @type {number} */ v) => {
          if (metricMeta && metricMeta.integerOnly && Math.round(v) !== v) return "";
          if (diverging && Math.round(v) !== v) return "";
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
