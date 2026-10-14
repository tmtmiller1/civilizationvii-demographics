// chart-line-config.js
//
// Chart.js config-object builders for the per-civ line chart: the top-level
// config (data + plugins + options), the `options.plugins` block (legend /
// tooltip / title), the `options.scales` block, and the legend `onClick`
// handler. Pure shape-builders: they only assemble objects, never mount Chart.js.
// Font-family resolution is deferred to call time and guarded.

import { makeTooltipExternal } from "/demographics/ui/screen-demographics/charts/line/chart-line-tooltip.js";
import { t } from "/demographics/ui/core/demographics-i18n.js";
import {
  AXIS_BORDER_COLOR,
  AXIS_COLOR,
  axisTitle,
  chartFontFamily,
  GRID_COLOR
} from "/demographics/ui/screen-demographics/charts/shared/chart-style.js";

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
  // Base-game LOC tags (not in our ModText.xml; see BASE_GAME_LOC_KEYS in
  // demographics-i18n.js) so labels match the in-game vocabulary.
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
  works: "LOC_DEMOGRAPHICS_UNIT_WORKS",
  towns: "LOC_DEMOGRAPHICS_UNIT_TOWNS",
  cap: "LOC_DEMOGRAPHICS_UNIT_CAP",
  settlements: "LOC_DEMOGRAPHICS_UNIT_SETTLEMENTS",
  tourism: "LOC_DEMOGRAPHICS_UNIT_TOURISM",
  kills: "LOC_DEMOGRAPHICS_UNIT_KILLS",
  losses: "LOC_DEMOGRAPHICS_UNIT_LOSSES",
  faith: "LOC_DEMOGRAPHICS_UNIT_FAITH",
  battles: "LOC_DEMOGRAPHICS_UNIT_BATTLES",
  wars: "LOC_DEMOGRAPHICS_UNIT_WARS",
  // Resource-class units reuse the base game's canonical class names
  // (base-game LOC tags; see BASE_GAME_LOC_KEYS in demographics-i18n.js).
  bonus: "LOC_RESOURCECLASS_BONUS_NAME",
  city: "LOC_RESOURCECLASS_CITY_NAME",
  empire: "LOC_RESOURCECLASS_EMPIRE_NAME",
  factory: "LOC_RESOURCECLASS_FACTORY_NAME",
  treasure: "LOC_RESOURCECLASS_TREASURE_NAME"
};

/**
 * Word-units resolve through {@link UNIT_LOC}; symbols and any unmapped value pass through
 * unchanged (t() returns the key on a miss, so a missing translation still falls back to the
 * English literal).
 * @param {string|undefined} unit The registry unit string.
 */
function localizedUnit(unit) {
  if (!unit) return "";
  const key = UNIT_LOC[unit];
  if (!key) return unit;
  const localized = t(key);
  return localized && localized !== key ? localized : unit;
}

/** @param {*} metricMeta */
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
 * @typedef {import("/demographics/ui/screen-demographics/charts/line/chart-line-axis.js").
 *   AxisFormatters} AxisFormatters
 */

/**
 * Build the full Chart.js line-chart config (data + plugins + options).
 * @param {Object} parts
 * @param {Record<string, *>[]} parts.datasets
 * @param {Record<string, *>[]} parts.plugins
 * @param {*} parts.metricMeta
 * @param {AxisFormatters} parts.formatters
 * @returns {Record<string, *>} The Chart.js config.
 */
export function buildLineChartConfig(parts) {
  const { datasets, plugins, metricMeta, formatters } = parts;
  // A metric may opt into a bar chart (`chartType:"bar"` on its spec), Chart.js bars share the same
  // datasets/scales and natively handle negative values (bars below the zero baseline) and grouping
  // (one clustered bar per civ at each turn). Datasets already set backgroundColor = civ color.
  const type = metricMeta && metricMeta.chartType === "bar" ? "bar" : "line";
  // A signed metric charted as bars gets a symmetric, zero-centered y-axis (half-range
  // floored at 1) so Chart.js does not auto-range to a degenerate [0, max] axis.
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
      // metricMeta.tooltipMode) so hovering a turn lists every civ, which tells apart overlapping lines.
      // On 1.5.0, with `axis: "x"` and `intersect: false`, "nearest" already returns every dataset
      // at the hovered turn (they are equidistant in x), so it is not the cause of a tooltip that
      // fails to update. Don't "fix" that by switching the default to "index": chart-line-series.js
      // `fromContactOnly` drops pre-contact points, so datasets have different-length x arrays, and
      // "index" aligns by array position rather than turn. It would pair one civ's turn 21 with
      // another's turn 60 in the same tooltip.
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

/** @param {*} point */
function pointAbsY(point) {
  return point && typeof point.y === "number" && isFinite(point.y) ? Math.abs(point.y) : 0;
}

/**
 * The symmetric y-axis half-range for a diverging bar chart: the largest absolute data value across
 * every dataset, floored at 1 (so an empty/all-zero chart still shows a -1 / 0 / +1 axis).
 * @param {Record<string, *>[]} datasets
 * @returns {number}
 */
function symmetricYBound(datasets) {
  let maxAbs = 0;
  for (const dataset of datasets || []) {
    for (const point of (dataset && dataset.data) || []) {
      const y = pointAbsY(point);
      if (y > maxAbs) maxAbs = y;
    }
  }
  return maxAbs > 0 ? maxAbs : 1;
}

/**
 * @param {AxisFormatters} formatters
 * @param {*} [metricMeta]
 */
function buildChartPluginsOpts(formatters, metricMeta) {
  const { fmtX, fmtY } = formatters;
  return {
    // The civ legend is rendered as a custom HTML list beside the chart
    // (chart-line-legend.js) so each entry can carry a live <fxs-icon> leader
    // portrait; the canvas-drawn Chart.js legend can't host one.
    legend: { display: false },
    tooltip: {
      // Disable Chart.js's canvas-painted tooltip and use an HTML overlay styled
      // with the engine's `img-tooltip-border` + `img-tooltip-bg` classes, with a
      // small leader icon next to each civ label.
      enabled: false,
      external: makeTooltipExternal(fmtX, fmtY, metricMeta)
    },
    // The chart already has an HTML title above it (buildChartTitle); the
    // Chart.js canvas title would be a redundant second title, so it's off.
    title: { display: false }
  };
}

/**
 * @param {*} metricMeta
 * @param {AxisFormatters} formatters
 * @param {number|null} [symBound] Symmetric y half-range for a diverging bar chart (null = auto).
 */
function buildChartScalesOpts(metricMeta, formatters, symBound) {
  const { fmtX, fmtY } = formatters;
  // A diverging bar chart pins the y-axis to [-symBound, +symBound] (0 centered); everything else
  // auto-ranges from zero.
  const diverging = typeof symBound === "number";
  const yBounds = diverging ? { min: -symBound, max: symBound } : { beginAtZero: true };
  return {
    x: {
      type: "linear",
      title: axisTitle(t("LOC_DEMOGRAPHICS_AXIS_TIME")),
      ticks: {
        color: AXIS_COLOR,
        font: { family: chartFontFamily(), size: 17 },
        maxRotation: 0,
        autoSkipPadding: 30,
        callback: (/** @type {number} */ value) => fmtX(value)
      },
      grid: { color: GRID_COLOR },
      border: { color: AXIS_BORDER_COLOR }
    },
    y: {
      type: "linear",
      ...yBounds,
      title: axisTitle(yAxisTitle(metricMeta)),
      ticks: {
        color: AXIS_COLOR,
        font: { family: chartFontFamily(), size: 17 },
        // Blank fractional tick labels for `integerOnly` metrics and diverging bar charts so a
        // near-zero axis shows clean -1 / 0 / +1. Chart.js still draws the gridlines.
        callback: (/** @type {number} */ value) => {
          if (metricMeta && metricMeta.integerOnly && Math.round(value) !== value) return "";
          if (diverging && Math.round(value) !== value) return "";
          return fmtY(value);
        },
        // Force integer step + zero decimals for integer-only metrics. Safe for the
        // small-range Crisis Stage ordinal; a large-range metric would need a range gate.
        ...(metricMeta && metricMeta.integerOnly ? { stepSize: 1, precision: 0 } : {})
      },
      grid: { color: GRID_COLOR },
      border: { color: AXIS_BORDER_COLOR }
    }
  };
}
