// chart-line-plugins.js
//
// Small, self-contained Chart.js plugin factories used by chart-line.js:
// focus-glow (focused line halo), hover-crosshair (gold dashed vertical at
// tooltip x), cap-limit-line (red 100% rule on settlement_cap_pct), and
// pointer-scale (maps the cursor into the chart's own pixels under the
// frame's transform scale). None of these own any shared state; each call
// returns a fresh plugin object.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { chartFontFamily } from "/demographics/ui/screen-demographics/charts/shared/chart-style.js";
import { appliedVisualScale } from "/demographics/ui/core/demographics-font-ladder.js";

/**
 * Build the focus-glow Chart.js plugin: redraws each focused line wider and
 * translucent behind the real strokes.
 * @returns {Record<string, *>} The Chart.js plugin.
 */
export function makeFocusGlowPlugin() {
  return {
    id: "demographicsFocusGlow",
    /**
     * @param {*} chart
     */
    beforeDatasetsDraw(chart) {
      const ctx2 = chart.ctx;
      const datasets = chart.data && chart.data.datasets;
      if (!datasets) return;
      for (let i = 0; i < datasets.length; i++) {
        const elems = focusedGlowElems(chart, datasets[i], i);
        if (elems) strokeGlowPath(ctx2, datasets[i], elems);
      }
    }
  };
}

/**
 * @param {*} chart
 * @param {Record<string, *>} dataset
 * @param {number} i
 */
function focusedGlowElems(chart, dataset, i) {
  if (!dataset || !dataset._focused || dataset.hidden) return null;
  const datasetMeta = chart.getDatasetMeta(i);
  if (!datasetMeta || datasetMeta.hidden) return null;
  const elems = datasetMeta.data;
  if (!elems || elems.length < 2) return null;
  return elems;
}

/**
 * @param {*} ctx2
 * @param {Record<string, *>} dataset
 * @param {{ x: number, y: number, skip?: boolean }[]} elems
 */
function strokeGlowPath(ctx2, dataset, elems) {
  ctx2.save();
  ctx2.strokeStyle = dataset.borderColor;
  ctx2.globalAlpha = 0.35;
  ctx2.lineWidth = (dataset.borderWidth || 3) + 4;
  ctx2.lineJoin = "round";
  ctx2.lineCap = "round";
  ctx2.beginPath();
  let started = false;
  for (const point of elems) {
    if (!point || point.skip || typeof point.x !== "number" || typeof point.y !== "number") {
      started = false;
      continue;
    }
    if (!started) {
      ctx2.moveTo(point.x, point.y);
      started = true;
    } else {
      ctx2.lineTo(point.x, point.y);
    }
  }
  if (started) ctx2.stroke();
  ctx2.restore();
}

/**
 * Build the pointer-scale Chart.js plugin. GameFace's MouseEvent has no offsetX, so Chart.js takes
 * `clientX - rect.left`, which is in visual px under the frame's `transform: scale(s)`, and divides
 * it by the chart's local width. The hover then lands at s * x: it trails the cursor more the
 * further right it goes and never reaches the last s-fraction of the plot (at s=0.8 the right edge
 * mapped to 2119 of 2650 px, and All Time topped out at turn 199 of 226).
 * Rescale the event before Chart.js hit-tests it. `inChartArea` was computed from the unscaled
 * point, so recompute it. Chart.js replays its last event on update; the marker keeps a replayed
 * event from being divided twice.
 * @returns {Record<string, *>} The Chart.js plugin.
 */
export function makePointerScalePlugin() {
  return {
    id: "demographicsPointerScale",
    /**
     * @param {*} chart
     * @param {*} args The beforeEvent args ({ event, replay, inChartArea }).
     */
    beforeEvent(chart, args) {
      const e = args && args.event;
      if (!e || e._demographicsScaled) return;
      e._demographicsScaled = true;
      const scale = appliedVisualScale();
      if (!(scale > 0) || scale === 1) return;
      if (typeof e.x === "number") e.x /= scale;
      if (typeof e.y === "number") e.y /= scale;
      if (typeof chart.isPointInArea === "function") args.inChartArea = chart.isPointInArea(e);
    }
  };
}

/**
 * Build the hover-crosshair Chart.js plugin: a gold dashed vertical line at
 * the tooltip's nearest-x.
 * @returns {Record<string, *>} The Chart.js plugin.
 */
export function makeHoverCrosshairPlugin() {
  return {
    id: "demographicsHoverCrosshair",
    /**
     * @param {*} chart
     */
    afterDatasetsDraw(chart) {
      const tooltip = chart.tooltip;
      if (!tooltip || !tooltip.opacity || !tooltip.dataPoints || tooltip.dataPoints.length === 0) return;
      if (!chart.scales.x || !chart.chartArea) return;
      const hoverX = tooltip.dataPoints[0].element?.x;
      if (typeof hoverX !== "number") return;
      const ctx2 = chart.ctx;
      const { top, bottom } = chart.chartArea;
      ctx2.save();
      ctx2.strokeStyle = "#f3c34c"; // accent gold
      ctx2.lineWidth = 1.2;
      ctx2.setLineDash([4, 3]);
      ctx2.globalAlpha = 0.9;
      ctx2.beginPath();
      ctx2.moveTo(hoverX, top);
      ctx2.lineTo(hoverX, bottom);
      ctx2.stroke();
      ctx2.restore();
    }
  };
}

/**
 * Sign zones for bar charts: a faint green wash above the zero line and a faint red wash below it,
 * plus a bold zero baseline, so positive vs. negative bars read at a glance without recolouring the
 * per-civ bars. Self-gates on bar charts (no-op for line charts).
 * @returns {Record<string, *>} A Chart.js plugin.
 */
export function makeSignZonesPlugin() {
  const GREEN = "rgba(74, 168, 96, 0.12)";
  const RED = "rgba(206, 76, 64, 0.13)";
  const ZERO = "rgba(229, 210, 172, 0.6)";
  return {
    id: "demographicsSignZones",
    /** @param {*} chart */
    beforeDraw(chart) {
      if (!chart.config || chart.config.type !== "bar") return;
      const yScale = chart.scales && chart.scales.y;
      const area = chart.chartArea;
      if (!yScale || !area) return;
      const zeroY = Math.max(area.top, Math.min(area.bottom, yScale.getPixelForValue(0)));
      const ctx2 = chart.ctx;
      ctx2.save();
      ctx2.fillStyle = GREEN;
      ctx2.fillRect(area.left, area.top, area.right - area.left, zeroY - area.top);
      ctx2.fillStyle = RED;
      ctx2.fillRect(area.left, zeroY, area.right - area.left, area.bottom - zeroY);
      ctx2.restore();
    },
    /** @param {*} chart */
    afterDatasetsDraw(chart) {
      if (!chart.config || chart.config.type !== "bar") return;
      const yScale = chart.scales && chart.scales.y;
      const area = chart.chartArea;
      if (!yScale || !area) return;
      const zeroY = yScale.getPixelForValue(0);
      if (zeroY < area.top || zeroY > area.bottom) return;
      const ctx2 = chart.ctx;
      ctx2.save();
      ctx2.strokeStyle = ZERO;
      ctx2.lineWidth = 1.6;
      ctx2.beginPath();
      ctx2.moveTo(area.left, zeroY);
      ctx2.lineTo(area.right, zeroY);
      ctx2.stroke();
      ctx2.restore();
    }
  };
}

/**
 * Build the cap-limit-line Chart.js plugin: a red rule at y=100 on the
 * Settlement Cap Utilization chart. No-op on other metrics.
 * @param {string} metricId
 * @returns {Record<string, *>} The Chart.js plugin.
 */
export function makeCapLimitLinePlugin(metricId) {
  return {
    id: "demographicsCapLimitLine",
    /**
     * @param {*} chart
     */
    afterDatasetsDraw(chart) {
      if (metricId !== "settlement_cap_pct") return;
      const yScale = chart.scales.y;
      if (!yScale) return;
      if (100 < yScale.min || 100 > yScale.max) return;
      if (!chart.chartArea) return;
      const y = yScale.getPixelForValue(100);
      const { left, right } = chart.chartArea;
      const ctx2 = chart.ctx;
      ctx2.save();
      ctx2.strokeStyle = "#e02020";
      ctx2.lineWidth = 2;
      ctx2.globalAlpha = 0.95;
      ctx2.beginPath();
      ctx2.moveTo(left, y);
      ctx2.lineTo(right, y);
      ctx2.stroke();
      drawCapLimitLabel(chart, ctx2, { left, right, y });
      ctx2.restore();
    }
  };
}

/**
 * @param {*} chart
 * @param {*} ctx2
 * @param {{ left: number, right: number, y: number }} pos
 */
function drawCapLimitLabel(chart, ctx2, pos) {
  ctx2.font = "11px " + chartFontFamily(chart);
  const text = t("LOC_DEMOGRAPHICS_LINE_CAP_LIMIT");
  const textW = ctx2.measureText(text).width;
  const labelX = Math.max(pos.left + 2, pos.right - textW - 8);
  const labelY = Math.max(chart.chartArea.top + 2, pos.y - 14);
  ctx2.fillStyle = "rgba(20, 16, 10, 0.85)";
  ctx2.fillRect(labelX, labelY, textW + 8, 14);
  ctx2.fillStyle = "#e02020";
  ctx2.fillText(text, labelX + 4, labelY + 11);
}
