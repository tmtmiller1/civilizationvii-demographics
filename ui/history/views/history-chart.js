// history-chart.js
//
// Dependency-free line charts. The plot is an SVG stretched to its box (preserveAspectRatio="none");
// all text is HTML laid over it by percentage so nothing is distorted. Works at the main menu,
// where Chart.js is not loaded.

import { el } from "/demographics/ui/history/core/history-dom.js";
import { num } from "/demographics/ui/history/core/history-text.js";
import { civChip } from "/demographics/ui/history/views/history-widgets.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const W = 1000;
const H = 400;

/**
 * @typedef {Object} Series
 * @property {string} label Localized legend label.
 * @property {string} color CSS color.
 * @property {number[]} ys Values, one per x position.
 * @property {boolean} [mine] Draw heavier (the local player).
 */

/**
 * @typedef {Object} ChartSpec
 * @property {Series[]} series Lines.
 * @property {number} count Number of x positions.
 * @property {{i:number, label:string}[]} [markers] Vertical markers (age starts) at x positions.
 * @property {string} [cls] Extra class for the wrapper.
 */

/**
 * Create an SVG element.
 * @param {string} tag Tag.
 * @param {Record<string, string>} attrs Attributes.
 * @returns {Element} The element.
 */
function svg(tag, attrs) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/**
 * A "nice" upper bound for the y axis (1, 2, 5 x 10^n).
 * @param {number} max Largest value.
 * @returns {number} Axis maximum.
 */
export function niceMax(max) {
  if (!(max > 0)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  for (const step of [1, 2, 5, 10]) if (step * mag >= max) return step * mag;
  return 10 * mag;
}

/**
 * Polyline points for one series.
 * @param {number[]} ys Values.
 * @param {number} count X positions.
 * @param {number} yMax Axis maximum.
 * @returns {string} "x,y x,y ..." in viewBox units.
 */
export function points(ys, count, yMax) {
  const span = Math.max(1, count - 1);
  return ys.map((y, i) => ((i / span) * W).toFixed(1) + "," + (H - (Math.max(0, y) / yMax) * H).toFixed(1)).join(" ");
}

/**
 * The plot SVG: grid, markers, lines.
 * @param {ChartSpec} spec Spec.
 * @param {number} yMax Axis maximum.
 * @returns {Element} The SVG.
 */
function plotSvg(spec, yMax) {
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", class: "dgh-chart-svg" });
  for (let g = 1; g <= 4; g++) {
    const y = String(H - (g / 4) * H);
    root.appendChild(svg("line", { x1: "0", x2: String(W), y1: y, y2: y, class: "dgh-chart-grid" }));
  }
  const span = Math.max(1, spec.count - 1);
  for (const m of spec.markers || []) {
    const x = String((m.i / span) * W);
    root.appendChild(svg("line", { x1: x, x2: x, y1: "0", y2: String(H), class: "dgh-chart-marker" }));
  }
  const ordered = spec.series.slice().sort((a, b) => Number(!!a.mine) - Number(!!b.mine));
  for (const s of ordered) {
    root.appendChild(svg("polyline", {
      points: points(s.ys, spec.count, yMax),
      fill: "none",
      stroke: s.color || "#c2c4cc",
      "stroke-width": s.mine ? "4" : "2.2",
      class: "dgh-chart-line"
    }));
  }
  return root;
}

/**
 * HTML overlays: y ticks and age marker labels.
 * @param {ChartSpec} spec Spec.
 * @param {number} yMax Axis maximum.
 * @returns {HTMLElement[]} Overlay elements.
 */
function overlays(spec, yMax) {
  const out = [];
  for (let g = 0; g <= 4; g++) {
    out.push(el("div", { cls: "dgh-chart-ytick", text: num((yMax * g) / 4), style: { bottom: g * 25 + "%" } }));
  }
  const span = Math.max(1, spec.count - 1);
  for (const m of spec.markers || []) {
    out.push(el("div", { cls: "dgh-chart-mlabel", text: m.label, style: { left: (m.i / span) * 100 + "%" } }));
  }
  return out;
}

/**
 * A multi-series line chart with legend.
 * @param {ChartSpec} spec Spec.
 * @returns {HTMLElement} The chart.
 */
export function lineChart(spec) {
  const max = Math.max(0, ...spec.series.flatMap((s) => s.ys));
  // Counts are whole numbers: a whole-number step, four steps to the top.
  const yMax = 4 * Math.max(1, niceMax(max / 4));
  const plot = el("div", { cls: "dgh-chart-plot" });
  plot.appendChild(/** @type {any} */ (plotSvg(spec, yMax)));
  for (const o of overlays(spec, yMax)) plot.appendChild(o);
  const legend = el("div", { cls: "dgh-chart-legend" }, spec.series.map((s) => civChip(s.label, s.color)));
  return el("div", { cls: "dgh-chart " + (spec.cls || "") }, [plot, legend]);
}

/**
 * A small inline trend line.
 * @param {number[]} ys Values.
 * @param {string} color CSS color.
 * @returns {HTMLElement} The sparkline.
 */
export function sparkline(ys, color) {
  const box = el("div", { cls: "dgh-spark" });
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", class: "dgh-spark-svg" });
  if (ys.length > 1) {
    root.appendChild(svg("polyline", {
      points: points(ys, ys.length, niceMax(Math.max(...ys))),
      fill: "none",
      stroke: color || "#f3c34c",
      "stroke-width": "40",
      class: "dgh-chart-line"
    }));
  }
  box.appendChild(/** @type {any} */ (root));
  return box;
}
