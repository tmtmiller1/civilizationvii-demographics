// chart-line-datasets.js
//
// Series -> Chart.js datasets for the line chart: apply the user settings that
// transform the series list (showEliminatedCivs, smoothChart, global-metric
// collapse, showUnmetNames masking), then build the styled dataset array
// (muted / dimmed / focused + time-range filter). Extracted from chart-line.js
// (remediation #26).

import { DemographicsSettings } from "/demographics/ui/demographics-settings.js";
import { getMetric } from "/demographics/ui/demographics-metrics.js";
import { t } from "/demographics/ui/demographics-i18n.js";
import { safeTextColor } from "/demographics/ui/civ-color-utils.js";
import { resolveLocalPid } from "/demographics/ui/screen-demographics/chart-shared.js";

/**
 * @typedef {import("/demographics/ui/screen-demographics/chart-line-series.js").ChartSeries} ChartSeries
 */

// Color helper used to apply dimmed alpha for muted/backgrounded civ lines.
/**
 * Return `hex` with alpha `a` applied as an `rgba()` string.
 *
 * Supported inputs:
 * - #rgb
 * - #rrggbb
 * - rgb(r,g,b)
 * - rgba(r,g,b,a)
 *
 * Unparseable inputs fall back to translucent white.
 * @param {*} hex Source color.
 * @param {number} a Alpha (0-1).
 * @returns {string} An `rgba()` color string.
 */
function colorWithAlpha(hex, a) {
  if (typeof hex !== "string") return "rgba(255,255,255," + a + ")";
  const s = hex.trim();
  const rgba = s.match(
    /^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*[\d.]+\s*\)$/i
  );
  if (rgba) {
    return "rgba(" + rgba[1] + "," + rgba[2] + "," + rgba[3] + "," + a + ")";
  }
  const rgb = s.match(/^rgb\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i);
  if (rgb) {
    return "rgba(" + rgb[1] + "," + rgb[2] + "," + rgb[3] + "," + a + ")";
  }
  const shortHex = s.match(/^#?([0-9a-fA-F]{3})$/);
  if (shortHex) {
    const h = shortHex[1];
    const n = parseInt(h[0] + h[0] + h[1] + h[1] + h[2] + h[2], 16);
    return (
      "rgba(" +
      ((n >> 16) & 0xff) +
      "," +
      ((n >> 8) & 0xff) +
      "," +
      (n & 0xff) +
      "," +
      a +
      ")"
    );
  }
  const m = s.match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return "rgba(255,255,255," + a + ")";
  const n = parseInt(m[1], 16);
  return "rgba(" + ((n >> 16) & 0xff) + "," + ((n >> 8) & 0xff) + "," + (n & 0xff) + "," + a + ")";
}

/**
 * Apply the `showEliminatedCivs` setting (default true): strip eliminated
 * series when the user disabled it.
 * @param {ChartSeries[]} allSeries The series list.
 * @returns {ChartSeries[]} The (possibly filtered) series list.
 */
function applyShowEliminated(allSeries) {
  try {
    const showElim = !!DemographicsSettings.getSetting("showEliminatedCivs", true);
    if (!showElim) {
      return allSeries.filter((s) => !s.eliminated);
    }
  } catch (_) {
    // DemographicsSettings.getSetting may throw; fall back to showing all series.
  }
  return allSeries;
}

/**
 * Apply the `smoothChart` setting: 3-turn centered moving average.
 * First/last points keep raw values; series with <3 points are untouched.
 * @param {ChartSeries[]} allSeries The series list.
 * @returns {ChartSeries[]} The transformed series list.
 */
function applySmoothChart(allSeries) {
  let smooth = false;
  try {
    smooth = !!DemographicsSettings.getSetting("smoothChart", false);
  } catch (_) {
    /* setting unreadable - leave smoothing off */
  }
  if (!smooth) return allSeries;
  // Own-logic smoothing math runs OUTSIDE the engine guard so a real bug here
  // surfaces (propagating to the logged top-level render guard) rather than
  // being swallowed.
  return allSeries.map((s) => {
    if (!Array.isArray(s.points) || s.points.length < 3) return s;
    const src = s.points;
    const out = new Array(src.length);
    out[0] = src[0];
    out[src.length - 1] = src[src.length - 1];
    for (let i = 1; i < src.length - 1; i++) {
      const a = src[i - 1].v;
      const b = src[i].v;
      const c = src[i + 1].v;
      if (typeof a === "number" && typeof b === "number" && typeof c === "number") {
        out[i] = { ...src[i], v: (a + b + c) / 3 };
      } else {
        out[i] = src[i];
      }
    }
    return { ...s, points: out };
  });
}

/**
 * Resolve a metric's metadata, defensively.
 * @param {string} metricId Metric id.
 * @returns {*} The metric metadata, or `null`.
 */
function resolveMetricMeta(metricId) {
  try {
    return getMetric(metricId);
  } catch (_) {
    // getMetric may throw on an unknown metric id; fall back to null metadata.
    return null;
  }
}

/**
 * For a `global` metric, collapse all series into a single donor line.
 * @param {ChartSeries[]} allSeries The series list.
 * @param {*} metricMeta The metric metadata.
 * @param {string} metricId Metric id.
 * @returns {ChartSeries[]} The (possibly collapsed) series list.
 */
function collapseGlobalMetric(allSeries, metricMeta, metricId) {
  if (metricMeta && metricMeta.global && allSeries.length > 1) {
    const donor =
      allSeries.reduce(
        (best, s) => (s.points.length > best.points.length ? s : best),
        allSeries[0]
      ) || allSeries[0];
    return [
      {
        name: metricMeta.title || metricMeta.label || metricId,
        pid: donor?.pid,
        met: true,
        leaderType: "GLOBAL_" + metricId,
        color: "#f3c34c",
        points: donor ? donor.points.slice() : [],
        allCivNames: []
      }
    ];
  }
  return allSeries;
}

/**
 * Apply the `showUnmetNames` setting (default false): when disabled, mask each
 * non-local unmet civ's series name with a generic placeholder.
 * @param {ChartSeries[]} allSeries The series list.
 * @returns {ChartSeries[]} The transformed series list.
 */
function applyUnmetNames(allSeries) {
  let showUnmet = false;
  try {
    showUnmet = !!DemographicsSettings.getSetting("showUnmetNames", false);
  } catch (_) {
    // DemographicsSettings.getSetting may throw; leave showUnmet at its default (false).
  }
  if (showUnmet) return allSeries;
  const localPid = resolveLocalPid();
  return allSeries.map((s) => {
    const isLocal = localPid !== undefined && s.pid === localPid;
    if (isLocal || s.met !== false) return s;
    return { ...s, name: t("LOC_DEMOGRAPHICS_LINE_UNMET_CIV") };
  });
}

/**
 * Build the Chart.js dataset array from the series list, applying muted /
 * dimmed / focused styling and the time-range filter.
 * @param {ChartSeries[]} allSeries The series list.
 * @param {Set<string>} muted Muted series keys (legend-toggled off, dimmed).
 * @param {Set<string>} focused Focused series keys.
 * @param {{ min: number, max: number }|null} tr Time-range filter, or null.
 * @returns {Record<string, *>[]} The Chart.js datasets.
 */
function buildChartDatasets(allSeries, muted, focused, tr) {
  return allSeries.map((s) => {
    const isMuted = muted.has(s.leaderType);
    const anyFocused = focused.size > 0;
    const isFocused = !isMuted && anyFocused && focused.has(s.leaderType);
    // A civ reads "backgrounded" (dimmed) when the user toggled it off in the
    // legend (All/None or a row), OR when another civ is focused and this one
    // isn't. Backgrounded lines STAY on the chart, dimmed - they don't vanish.
    const isDimmed = isMuted || (anyFocused && !focused.has(s.leaderType));
    const dataPoints = s.points
      .filter((p) => !tr || (p.t >= tr.min && p.t <= tr.max))
      .map((p) => ({ x: p.t, y: p.v }));
    // Lift dim blue civ colors so the line / label / value reads on
    // the dark chart background (same lift used in the tooltip).
    const baseColor = safeTextColor(s.color) || s.color;
    const color = isDimmed ? colorWithAlpha(baseColor, 0.35) : baseColor;
    return {
      label: s.name,
      data: dataPoints,
      borderColor: color,
      backgroundColor: color,
      // Slightly thicker stroke for all lines (subtle):
      // Focused: 3 → 3.4, Dimmed: 1 → 1.2, Normal: 2 → 2.4
      borderWidth: isFocused ? 3.4 : isDimmed ? 1.2 : 2.4,
      _focused: isFocused,
      _muted: isMuted,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0,
      spanGaps: true,
      // Never fully remove a line - backgrounded civs are dimmed (above), so the
      // legend's "None" greys lines out rather than making them disappear.
      hidden: false,
      leaderType: s.leaderType,
      leaderTypeString: s.leaderTypeString,
      _eliminated: !!s.eliminated
    };
  });
}

export {
  applyShowEliminated,
  applySmoothChart,
  resolveMetricMeta,
  collapseGlobalMetric,
  applyUnmetNames,
  buildChartDatasets
};
