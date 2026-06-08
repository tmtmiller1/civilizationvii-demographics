// chart-war-mini-chart.js
//
// Reusable mini-chart rendering primitives for war/crisis graph cells.

import { svgEl } from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";
import { t } from "/demographics/ui/core/demographics-i18n.js";

import { fmt, seriesBounds } from "/demographics/ui/screen-demographics/charts/wars/chart-war-series.js";

export const MINI_W = 340;
export const MINI_H = 200;
export const PAD_L = 24;
export const PAD_R = 8;
export const PAD_T = 8;
export const PAD_B = 28;

/**
 * Build the polyline `points` string for one series under the given bounds.
 * @param {{ points: { x: number, y: number }[] }} s The series.
 * @param {{ xMin: number, xMax: number, yMin: number, yMax: number }} b The bounds.
 * @returns {string} The SVG points attribute.
 */
function polyPoints(s, b) {
  const innerW = MINI_W - PAD_L - PAD_R;
  const innerH = MINI_H - PAD_T - PAD_B;
  const xSpan = b.xMax - b.xMin || 1;
  const ySpan = b.yMax - b.yMin || 1;
  return s.points
    .map((pt) => {
      const px = PAD_L + ((pt.x - b.xMin) / xSpan) * innerW;
      const py = PAD_T + innerH - ((pt.y - b.yMin) / ySpan) * innerH;
      return px.toFixed(1) + "," + py.toFixed(1);
    })
    .join(" ");
}

/**
 * Draw vertical crisis-stage marker lines (dashed, stage-colored) at each
 * marker's chart-X, mirroring the war-timeline overlay. Markers outside the
 * bounds are skipped.
 * @param {SVGElement} svg The chart SVG.
 * @param {{ x: number, color: string }[]} markers The crisis markers.
 * @param {{ xMin: number, xMax: number }} b The bounds.
 */
function drawGraphMarkers(svg, markers, b) {
  const innerW = MINI_W - PAD_L - PAD_R;
  const xSpan = b.xMax - b.xMin || 1;
  for (const m of markers) {
    if (m.x < b.xMin || m.x > b.xMax) continue;
    const px = (PAD_L + ((m.x - b.xMin) / xSpan) * innerW).toFixed(1);
    svg.appendChild(
      svgEl("line", {
        class: "demographics-war-graph-crisis-marker",
        x1: px,
        x2: px,
        y1: PAD_T,
        y2: MINI_H - PAD_B,
        stroke: m.color,
        "stroke-width": "1.4",
        "stroke-dasharray": "4 3",
        "stroke-opacity": "0.85"
      })
    );
  }
}

/**
 * Build the mini line-chart SVG for one metric.
 * @param {{ color: string, points: { x: number, y: number }[] }[]} seriesList Per-civ series.
 * @param {{ xMin: number, xMax: number, yMin: number, yMax: number }} b The bounds.
 * @param {{ x: number, color: string }[]} [markers] Optional crisis-stage markers.
 * @returns {SVGElement} The chart SVG.
 */
export function buildMiniSvg(seriesList, b, markers) {
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
  if (markers && markers.length) drawGraphMarkers(svg, markers, b);
  for (const s of seriesList) {
    if (!s.points.length) continue;
    svg.appendChild(
      svgEl("polyline", {
        class: "demographics-war-graph-line",
        points: polyPoints(s, b),
        stroke: s.color
      })
    );
  }
  // Axis tick labels + titles are NOT drawn in the SVG: this SVG is stretched
  // non-uniformly (preserveAspectRatio="none") to fill the cell, which would
  // distort any text. They're rendered as crisp HTML overlays in buildPlot()
  // instead, matching the historical charts' typography exactly.
  return svg;
}

/**
 * One absolutely-positioned HTML axis-text overlay (a corner tick or the X
 * title), skipped when empty. Rendered as HTML - not SVG text - so it isn't
 * distorted by the plot SVG's non-uniform stretch and can carry the exact same
 * font/size/color as the historical Chart.js axes.
 * @param {HTMLElement} plot The positioned plot container.
 * @param {string} text The label text ("" skips it).
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
 * @param {string} text The Y-axis title ("" skips it).
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
 * @param {SVGElement} svg The chart SVG.
 * @param {{ yLabel: string, xLabel: string, yTop: string, yBottom: string,
 *   xLeft: string, xRight: string }} labels The axis text.
 * @returns {HTMLElement} The plot container.
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
 * the +m / −m corner ticks, and no X axis (the bars aren't a time series).
 * @param {string} yLabel The Y-axis title.
 * @param {number} m The symmetric y-extent.
 * @returns {{ yLabel: string, xLabel: string, yTop: string, yBottom: string,
 *   xLeft: string, xRight: string }} The overlay text.
 */
export function barLabels(yLabel, m) {
  return {
    yLabel,
    xLabel: "",
    yTop: "+" + fmt(m),
    yBottom: "−" + fmt(m),
    xLeft: "",
    xRight: ""
  };
}

/**
 * Axis-text overlay values for a line chart: the rotated Y title, the y max/min
 * corner ticks, the "Time (turns)" X title, and the T-min / T-max end ticks.
 * @param {string} yLabel The Y-axis title.
 * @param {{ xMin: number, xMax: number, yMin: number, yMax: number }} b The bounds.
 * @returns {{ yLabel: string, xLabel: string, yTop: string, yBottom: string,
 *   xLeft: string, xRight: string }} The overlay text.
 */
export function lineLabels(yLabel, b) {
  return {
    yLabel,
    xLabel: t("LOC_DEMOGRAPHICS_WAR_GRAPHS_X_TURN"),
    yTop: fmt(b.yMax),
    yBottom: fmt(b.yMin),
    xLeft: "T" + b.xMin,
    xRight: "T" + b.xMax
  };
}

/**
 * Widen the x-bounds so any marker sitting at (or past) an edge gets a little
 * breathing room - e.g. a crisis that begins right at the chart's start renders
 * a few turns in from the left edge instead of being clipped on the axis.
 * @param {{ xMin: number, xMax: number }} b The bounds (mutated).
 * @param {{ x: number }[]} markers The crisis markers.
 */
function expandBoundsForMarkers(b, markers) {
  const pad = 3;
  for (const m of markers) {
    if (m.x < b.xMin + pad) b.xMin = m.x - pad;
    if (m.x > b.xMax - pad) b.xMax = m.x + pad;
  }
}

/**
 * Build a line-chart handle (svg + hover + axis labels) from a prepared series
 * list. Returns null when empty.
 * @param {{ name: string, color: string, points: { x: number,
 *   y: number }[] }[]} seriesList The series.
 * @param {string} yLabelLoc The Y-axis title LOC tag.
 * @param {{ x: number, color: string, label?: string }[]} [markers] Optional crisis-stage markers.
 * @param {{ xMin: number, xMax: number }} [xDomain] A shared x-domain to use for the X axis
 *   (so a set of charts share one time scale); the Y axis still comes from the series.
 * @returns {{ svg: SVGElement, hover: *, labels: * } | null} The chart, or null.
 */
export function buildLineChartFromSeries(seriesList, yLabelLoc, markers, xDomain) {
  const sb = seriesBounds(seriesList);
  if (!sb) return null;
  const b = xDomain
    ? { xMin: xDomain.xMin, xMax: xDomain.xMax, yMin: sb.yMin, yMax: sb.yMax }
    : sb;
  if (markers && markers.length) expandBoundsForMarkers(b, markers);
  const yLabel = t(yLabelLoc || "");
  return {
    svg: buildMiniSvg(seriesList, b, markers),
    hover: { series: seriesList, bounds: b, yLabel, markers },
    labels: lineLabels(yLabel, b)
  };
}

/**
 * Build a zero-centered bar chart with one bar per civ (gains above the line,
 * losses below), scaled symmetrically to ±m so zero sits in the centre.
 * @param {{ color: string, net: number }[]} civs Per-civ net values.
 * @param {number} m The symmetric y-extent (>= 1).
 * @returns {SVGElement} The chart SVG.
 */
export function buildCivBarSvg(civs, m) {
  const innerW = MINI_W - PAD_L - PAD_R;
  const innerH = MINI_H - PAD_T - PAD_B;
  const yPx = (/** @type {number} */ v) => PAD_T + innerH - ((v + m) / (2 * m)) * innerH;
  const zeroY = yPx(0);
  const svg = svgEl("svg", {
    class: "demographics-war-graph-svg",
    viewBox: "0 0 " + MINI_W + " " + MINI_H,
    preserveAspectRatio: "none"
  });
  const slotW = innerW / civs.length;
  const barW = Math.max(2, slotW * 0.55);
  for (let i = 0; i < civs.length; i++) {
    const yv = yPx(civs[i].net);
    if (civs[i].net !== 0) {
      svg.appendChild(
        svgEl("rect", {
          class: "demographics-war-graph-bar",
          x: (PAD_L + i * slotW + (slotW - barW) / 2).toFixed(1),
          y: Math.min(zeroY, yv).toFixed(1),
          width: barW.toFixed(1),
          height: Math.max(0.5, Math.abs(yv - zeroY)).toFixed(1),
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
  // non-uniformly stretched SVG - see the note in buildMiniSvg.
  return svg;
}
