// chart-line-plugins.js
//
// Small, self-contained Chart.js plugin factories used by chart-line.js:
// focus-glow (focused line halo), hover-crosshair (gold dashed vertical at
// tooltip x), cap-limit-line (red 100% rule on settlement_cap_pct). Extracted
// from chart-line.js. None of these own any shared state -
// each call returns a fresh plugin object.

import { t } from "/demographics/ui/core/demographics-i18n.js";

/**
 * Resolve the chart font family with a safe fallback chain (mirrors the helper
 * in the sibling chart-line-* modules).
 * @param {*} chart The Chart instance.
 * @returns {string} The preferred font family.
 */
function resolveChartFontFamily(chart) {
  return (
    chart?.options?.font?.family ||
    (typeof Chart !== "undefined" && Chart.defaults?.font?.family) ||
    "BodyFont, sans-serif"
  );
}

/**
 * Build the focus-glow Chart.js plugin: redraws each focused line wider and
 * translucent behind the real strokes.
 * @returns {Record<string, *>} The Chart.js plugin object.
 */
export function makeFocusGlowPlugin() {
  return {
    id: "demographicsFocusGlow",
    /**
     * @param {*} c The Chart instance.
     */
    beforeDatasetsDraw(c) {
      const ctx2 = c.ctx;
      const datasets = c.data && c.data.datasets;
      if (!datasets) return;
      for (let i = 0; i < datasets.length; i++) {
        const elems = focusedGlowElems(c, datasets[i], i);
        if (elems) strokeGlowPath(ctx2, datasets[i], elems);
      }
    }
  };
}

/**
 * Return a focused, visible dataset's point elements (>=2), or `null` when the
 * dataset shouldn't glow.
 * @param {*} c The Chart instance.
 * @param {Record<string, *>} ds The dataset.
 * @param {number} i The dataset index.
 * @returns {{ x: number, y: number, skip?: boolean }[]|null} The point
 *   elements, or `null`.
 */
function focusedGlowElems(c, ds, i) {
  if (!ds || !ds._focused || ds.hidden) return null;
  const dsMeta = c.getDatasetMeta(i);
  if (!dsMeta || dsMeta.hidden) return null;
  const elems = dsMeta.data;
  if (!elems || elems.length < 2) return null;
  return elems;
}

/**
 * Stroke one focused line's translucent glow path.
 * @param {*} ctx2 The 2D canvas context.
 * @param {Record<string, *>} ds The Chart.js dataset.
 * @param {{ x: number, y: number, skip?: boolean }[]} elems The dataset's
 *   point elements.
 */
function strokeGlowPath(ctx2, ds, elems) {
  ctx2.save();
  ctx2.strokeStyle = ds.borderColor;
  ctx2.globalAlpha = 0.35;
  ctx2.lineWidth = (ds.borderWidth || 3) + 4;
  ctx2.lineJoin = "round";
  ctx2.lineCap = "round";
  ctx2.beginPath();
  let started = false;
  for (const pt of elems) {
    if (!pt || pt.skip || typeof pt.x !== "number" || typeof pt.y !== "number") {
      started = false;
      continue;
    }
    if (!started) {
      ctx2.moveTo(pt.x, pt.y);
      started = true;
    } else {
      ctx2.lineTo(pt.x, pt.y);
    }
  }
  if (started) ctx2.stroke();
  ctx2.restore();
}

/**
 * Build the hover-crosshair Chart.js plugin: a gold dashed vertical line at
 * the tooltip's nearest-x.
 * @returns {Record<string, *>} The Chart.js plugin object.
 */
export function makeHoverCrosshairPlugin() {
  return {
    id: "demographicsHoverCrosshair",
    /**
     * @param {*} c The Chart instance.
     */
    afterDatasetsDraw(c) {
      const tt = c.tooltip;
      if (!tt || !tt.opacity || !tt.dataPoints || tt.dataPoints.length === 0) return;
      if (!c.scales.x) return;
      const hoverX = tt.dataPoints[0].element?.x;
      if (typeof hoverX !== "number") return;
      const ctx2 = c.ctx;
      const { top, bottom } = c.chartArea;
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
 * Build the cap-limit-line Chart.js plugin: a red rule at y=100 on the
 * Settlement Cap Utilization chart. No-op on other metrics.
 * @param {string} metricId Active metric id.
 * @returns {Record<string, *>} The Chart.js plugin object.
 */
export function makeCapLimitLinePlugin(metricId) {
  return {
    id: "demographicsCapLimitLine",
    /**
     * @param {*} c The Chart instance.
     */
    afterDatasetsDraw(c) {
      if (metricId !== "settlement_cap_pct") return;
      const yScale = c.scales.y;
      if (!yScale) return;
      if (100 < yScale.min || 100 > yScale.max) return;
      const y = yScale.getPixelForValue(100);
      const { left, right } = c.chartArea;
      const ctx2 = c.ctx;
      ctx2.save();
      ctx2.strokeStyle = "#e02020";
      ctx2.lineWidth = 2;
      ctx2.globalAlpha = 0.95;
      ctx2.beginPath();
      ctx2.moveTo(left, y);
      ctx2.lineTo(right, y);
      ctx2.stroke();
      drawCapLimitLabel(c, ctx2, { left, right, y });
      ctx2.restore();
    }
  };
}

/**
 * Draw the y=100 cap-line label at the right edge.
 * @param {*} chart The Chart instance.
 * @param {*} ctx2 The 2D canvas context.
 * @param {{ left: number, right: number, y: number }} pos Line geometry.
 */
function drawCapLimitLabel(chart, ctx2, pos) {
  ctx2.font = "11px " + resolveChartFontFamily(chart);
  const text = t("LOC_DEMOGRAPHICS_LINE_CAP_LIMIT");
  const textW = ctx2.measureText(text).width;
  const labelX = Math.max(pos.left + 2, pos.right - textW - 8);
  const labelY = Math.max(chart.chartArea.top + 2, pos.y - 14);
  ctx2.fillStyle = "rgba(20, 16, 10, 0.85)";
  ctx2.fillRect(labelX, labelY, textW + 8, 14);
  ctx2.fillStyle = "#e02020";
  ctx2.fillText(text, labelX + 4, labelY + 11);
}
