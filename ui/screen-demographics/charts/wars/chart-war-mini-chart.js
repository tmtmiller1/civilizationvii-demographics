// chart-war-mini-chart.js
//
// Reusable mini-chart rendering primitives for war/crisis graph cells.

import { svgEl } from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";
import { t, turnPlain } from "/demographics/ui/core/demographics-i18n.js";

import { formatCompact, seriesBounds } from "/demographics/ui/screen-demographics/charts/wars/chart-war-series.js";

export const MINI_W = 340;
export const MINI_H = 200;
export const PAD_L = 24;
export const PAD_R = 8;
export const PAD_T = 8;
export const PAD_B = 28;

/**
 * Build the polyline `points` string for one series under the given bounds.
 * @param {{ points: { x: number, y: number }[] }} series
 * @param {{ xMin: number, xMax: number, yMin: number, yMax: number }} bounds
 * @returns {string} The SVG `points` attribute.
 */
function polyPoints(series, bounds) {
  const innerW = MINI_W - PAD_L - PAD_R;
  const innerH = MINI_H - PAD_T - PAD_B;
  const xSpan = bounds.xMax - bounds.xMin || 1;
  const ySpan = bounds.yMax - bounds.yMin || 1;
  return series.points
    .map((pt) => {
      const px = PAD_L + ((pt.x - bounds.xMin) / xSpan) * innerW;
      const py = PAD_T + innerH - ((pt.y - bounds.yMin) / ySpan) * innerH;
      return px.toFixed(1) + "," + py.toFixed(1);
    })
    .join(" ");
}

/**
 * Draw vertical crisis-stage marker lines (dashed, stage-colored) at each
 * marker's chart-X, mirroring the war-timeline overlay. Markers outside the
 * bounds are skipped.
 * @param {SVGElement} svg
 * @param {{ x: number, color: string }[]} markers
 * @param {{ xMin: number, xMax: number }} bounds
 */
function drawGraphMarkers(svg, markers, bounds) {
  const innerW = MINI_W - PAD_L - PAD_R;
  const xSpan = bounds.xMax - bounds.xMin || 1;
  for (const marker of markers) {
    if (marker.x < bounds.xMin || marker.x > bounds.xMax) continue;
    const px = (PAD_L + ((marker.x - bounds.xMin) / xSpan) * innerW).toFixed(1);
    svg.appendChild(
      svgEl("line", {
        class: "demographics-war-graph-crisis-marker",
        x1: px,
        x2: px,
        y1: PAD_T,
        y2: MINI_H - PAD_B,
        stroke: marker.color,
        "stroke-width": "1.4",
        // No stroke-dasharray: Coherent ignores it. Marker color is the differentiator.
        "stroke-opacity": "0.85"
      })
    );
  }
}

/**
 * Build the mini line-chart SVG for one metric.
 * @param {{ color: string, points: { x: number, y: number }[] }[]} seriesList Per-civ series.
 * @param {{ xMin: number, xMax: number, yMin: number, yMax: number }} bounds
 * @param {{ x: number, color: string }[]} [markers] Crisis-stage markers.
 * @returns {SVGElement}
 */
export function buildMiniSvg(seriesList, bounds, markers) {
  const svg = svgEl("svg", {
    class: "demographics-war-graph-svg",
    viewBox: "0 0 " + MINI_W + " " + MINI_H,
    preserveAspectRatio: "none"
  });
  svg.appendChild(
    svgEl("line", {
      class: "demographics-war-graph-axis",
      x1: PAD_L,
      y1: MINI_H - PAD_B,
      x2: MINI_W - PAD_R,
      y2: MINI_H - PAD_B
    })
  );
  if (markers && markers.length) drawGraphMarkers(svg, markers, bounds);
  for (const series of seriesList) {
    if (!series.points.length) continue;
    svg.appendChild(
      svgEl("polyline", {
        class: "demographics-war-graph-line",
        points: polyPoints(series, bounds),
        stroke: series.color
      })
    );
  }
  // Axis tick labels + titles are not drawn in the SVG, which is stretched non-uniformly
  // (preserveAspectRatio="none") and would distort text; buildPlot() renders them as HTML overlays.
  return svg;
}

/**
 * One absolutely-positioned HTML axis-text overlay (a corner tick or the X title), skipped when
 * empty. HTML rather than SVG text so the plot SVG's non-uniform stretch doesn't distort it.
 * @param {HTMLElement} plot The positioned plot container.
 * @param {string} text "" skips it.
 * @param {string} suffix The position-class suffix (e.g. "ytop", "xtitle").
 */
function appendOverlay(plot, text, suffix) {
  if (!text) return;
  const el = document.createElement("div");
  el.className = "demographics-war-graph-ovl demographics-war-graph-ovl-" + suffix;
  el.textContent = text;
  plot.appendChild(el);
}

/**
 * The rotated Y-axis title overlay: a thin full-height flex column at the left
 * that vertically centers a -90deg-rotated label (reliable in Gameface, unlike
 * absolute-positioned rotation).
 * @param {HTMLElement} plot The positioned plot container.
 * @param {string} text The Y-axis title; "" skips it.
 */
function appendYTitle(plot, text) {
  if (!text) return;
  const col = document.createElement("div");
  col.className = "demographics-war-graph-ovl demographics-war-graph-ovl-ytitle";
  const span = document.createElement("span");
  span.textContent = text;
  col.appendChild(span);
  plot.appendChild(col);
}

/**
 * Wrap a chart SVG in a positioned plot container and overlay the HTML axis
 * text (corner ticks, X title, rotated Y title) around it.
 * @param {SVGElement} svg
 * @param {{ yLabel: string, xLabel: string, yTop: string, yBottom: string,
 *   xLeft: string, xRight: string }} labels
 * @returns {HTMLElement}
 */
export function buildPlot(svg, labels) {
  const plot = document.createElement("div");
  plot.className = "demographics-war-graph-plot";
  plot.appendChild(svg);
  appendOverlay(plot, labels.yTop, "ytop");
  appendOverlay(plot, labels.yBottom, "ybottom");
  appendOverlay(plot, labels.xLeft, "xleft");
  appendOverlay(plot, labels.xRight, "xright");
  appendOverlay(plot, labels.xLabel, "xtitle");
  appendYTitle(plot, labels.yLabel);
  return plot;
}

/**
 * Axis-text overlay values for a zero-centered bar chart: the rotated Y title,
 * the +extent / −extent corner ticks, and no X axis (the bars aren't a time series).
 * @param {string} yLabel
 * @param {number} extent The symmetric y-extent.
 * @returns {{ yLabel: string, xLabel: string, yTop: string, yBottom: string,
 *   xLeft: string, xRight: string }}
 */
export function barLabels(yLabel, extent) {
  return {
    yLabel,
    xLabel: "",
    yTop: "+" + formatCompact(extent),
    yBottom: "−" + formatCompact(extent),
    xLeft: "",
    xRight: ""
  };
}

/**
 * Axis-text overlay values for a line chart: the rotated Y title, the y max/min
 * corner ticks, the "Time (turns)" X title, and the T-min / T-max end ticks.
 * @param {string} yLabel
 * @param {{ xMin: number, xMax: number, yMin: number, yMax: number }} bounds
 * @returns {{ yLabel: string, xLabel: string, yTop: string, yBottom: string,
 *   xLeft: string, xRight: string }}
 */
export function lineLabels(yLabel, bounds) {
  return {
    yLabel,
    xLabel: t("LOC_DEMOGRAPHICS_WAR_GRAPHS_X_TURN"),
    yTop: formatCompact(bounds.yMax),
    yBottom: formatCompact(bounds.yMin),
    xLeft: turnPlain(bounds.xMin),
    xRight: turnPlain(bounds.xMax)
  };
}

/**
 * Widen the x-bounds so any marker sitting at (or past) an edge gets a little
 * breathing room, so a crisis that begins right at the chart's start renders
 * a few turns in from the left edge instead of being clipped on the axis.
 * @param {{ xMin: number, xMax: number }} bounds Mutated.
 * @param {{ x: number }[]} markers
 */
function expandBoundsForMarkers(bounds, markers) {
  const pad = 3;
  for (const marker of markers) {
    if (marker.x < bounds.xMin + pad) bounds.xMin = marker.x - pad;
    if (marker.x > bounds.xMax - pad) bounds.xMax = marker.x + pad;
  }
}

/**
 * Build a line-chart handle (svg + hover + axis labels) from a prepared series
 * list. Returns null when empty.
 * @param {{ name: string, color: string, points: { x: number,
 *   y: number }[] }[]} seriesList
 * @param {string} yLabelLoc The Y-axis title LOC tag.
 * @param {{ x: number, color: string, label?: string }[]} [markers] Crisis-stage markers.
 * @param {{ xMin: number, xMax: number }} [xDomain] A shared x-domain to use for the X axis
 *   (so a set of charts share one time scale); the Y axis still comes from the series.
 * @returns {{ svg: SVGElement, hover: *, labels: * } | null}
 */
export function buildLineChartFromSeries(seriesList, yLabelLoc, markers, xDomain) {
  const dataBounds = seriesBounds(seriesList);
  if (!dataBounds) return null;
  const bounds = xDomain
    ? { xMin: xDomain.xMin, xMax: xDomain.xMax, yMin: dataBounds.yMin, yMax: dataBounds.yMax }
    : dataBounds;
  if (markers && markers.length) expandBoundsForMarkers(bounds, markers);
  const yLabel = t(yLabelLoc || "");
  return {
    svg: buildMiniSvg(seriesList, bounds, markers),
    hover: { series: seriesList, bounds, yLabel, markers },
    labels: lineLabels(yLabel, bounds)
  };
}

/**
 * Build a zero-centered bar chart with one bar per civ (gains above the line,
 * losses below), scaled symmetrically to ±extent so zero sits in the center.
 * @param {{ color: string, net: number }[]} civs Per-civ net values.
 * @param {number} extent The symmetric y-extent (>= 1).
 * @returns {SVGElement}
 */
export function buildCivBarSvg(civs, extent) {
  const innerW = MINI_W - PAD_L - PAD_R;
  const innerH = MINI_H - PAD_T - PAD_B;
  const yPx = (/** @type {number} */ value) =>
    PAD_T + innerH - ((value + extent) / (2 * extent)) * innerH;
  const zeroY = yPx(0);
  const svg = svgEl("svg", {
    class: "demographics-war-graph-svg",
    viewBox: "0 0 " + MINI_W + " " + MINI_H,
    preserveAspectRatio: "none"
  });
  const slotW = innerW / civs.length;
  const barW = Math.max(2, slotW * 0.55);
  for (let i = 0; i < civs.length; i++) {
    const barY = yPx(civs[i].net);
    if (civs[i].net !== 0) {
      svg.appendChild(
        svgEl("rect", {
          class: "demographics-war-graph-bar",
          x: (PAD_L + i * slotW + (slotW - barW) / 2).toFixed(1),
          y: Math.min(zeroY, barY).toFixed(1),
          width: barW.toFixed(1),
          height: Math.max(0.5, Math.abs(barY - zeroY)).toFixed(1),
          fill: civs[i].color
        })
      );
    }
  }
  svg.appendChild(
    svgEl("line", {
      class: "demographics-war-graph-axis",
      x1: PAD_L,
      y1: zeroY.toFixed(1),
      x2: MINI_W - PAD_R,
      y2: zeroY.toFixed(1)
    })
  );
  // Tick/axis text is rendered as HTML overlays (buildPlot), not in this
  // non-uniformly stretched SVG; see the note in buildMiniSvg.
  return svg;
}
