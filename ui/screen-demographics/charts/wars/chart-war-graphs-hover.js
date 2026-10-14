// chart-war-graphs-hover.js
//
// Hover and empty-state helpers for the War Graphs view.

import {
  collectTurns,
  nearestTurn,
  tipVal
} from "/demographics/ui/screen-demographics/charts/wars/chart-war-series.js";
import { toLocalPx } from "/demographics/ui/core/demographics-font-ladder.js";
import { svgEl } from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";
import { t } from "/demographics/ui/core/demographics-i18n.js";
import { buildCostIcon } from "/demographics/ui/screen-demographics/charts/conflicts/chart-conflicts-cost.js";
import {
  MINI_H,
  MINI_W,
  PAD_B,
  PAD_L,
  PAD_R,
  PAD_T
} from "/demographics/ui/screen-demographics/charts/wars/chart-war-mini-chart.js";

/** @param {number} net */
function formatBarNet(net) {
  if (net > 0) return "+" + net;
  if (net < 0) return "−" + Math.abs(net);
  return "0";
}

/**
 * @param {HTMLElement} tip
 * @param {{ name: string, color: string, net: number }[]} civs
 * @param {string} label
 * @param {string} [blp] The metric's guide cost-icon BLP.
 */
function fillBarTip(tip, civs, label, blp) {
  const head = document.createElement("div");
  head.className = "demographics-war-graph-hovertip-head";
  if (blp) head.appendChild(buildCostIcon(blp));
  head.appendChild(document.createTextNode(label));
  tip.appendChild(head);
  for (const civ of civs) {
    const row = document.createElement("div");
    row.className = "demographics-war-graph-hovertip-row";
    const dot = document.createElement("span");
    dot.className = "demographics-war-graph-hovertip-dot";
    dot.style.backgroundColor = civ.color;
    row.appendChild(dot);
    row.appendChild(document.createTextNode(civ.name || ""));
    const val = document.createElement("span");
    val.className = "demographics-war-graph-hovertip-val";
    val.textContent = formatBarNet(civ.net);
    row.appendChild(val);
    tip.appendChild(row);
  }
}

/**
 * @param {number} turn
 * @param {{ yLabel?: string, blp?: string }} head
 */
function buildHoverTipHeader(turn, head) {
  const el = document.createElement("div");
  el.className = "demographics-war-graph-hovertip-head";
  if (head && head.blp) el.appendChild(buildCostIcon(head.blp));
  const yLabel = head ? head.yLabel : "";
  const text = t("LOC_DEMOGRAPHICS_WONDER_TURN", turn) + (yLabel ? " · " + yLabel : "");
  el.appendChild(document.createTextNode(text));
  return el;
}

/**
 * @param {{ name?: string, color: string }} series
 * @param {number} value
 */
function buildSeriesHoverRow(series, value) {
  const row = document.createElement("div");
  row.className = "demographics-war-graph-hovertip-row";
  const dot = document.createElement("span");
  dot.className = "demographics-war-graph-hovertip-dot";
  dot.style.backgroundColor = series.color;
  row.appendChild(dot);
  row.appendChild(document.createTextNode(series.name || ""));
  const val = document.createElement("span");
  val.className = "demographics-war-graph-hovertip-val";
  val.textContent = tipVal(value);
  row.appendChild(val);
  return row;
}

/**
 * @param {HTMLElement} tip
 * @param {number} turn
 * @param {{ name?: string, color: string, points: { x: number,
 *   y: number }[] }[]} series
 */
function appendSeriesHoverRows(tip, turn, series) {
  for (const line of series) {
    const pt = line.points.find((p) => p.x === turn);
    if (!pt) continue;
    tip.appendChild(buildSeriesHoverRow(line, pt.y));
  }
}

/**
 * @param {HTMLElement} tip
 * @param {number} turn
 * @param {{ x: number, color: string, label?: string }[]|undefined} markers
 */
function appendCrisisHoverRow(tip, turn, markers) {
  if (!markers || !markers.length) return;
  const marker = markers.find((m) => m.x === turn && m.label);
  if (!marker) return;
  const row = document.createElement("div");
  row.className = "demographics-war-graph-hovertip-row";
  const dot = document.createElement("span");
  dot.className = "demographics-war-graph-hovertip-dot";
  dot.style.backgroundColor = marker.color;
  row.appendChild(dot);
  const txt = document.createElement("span");
  txt.style.color = marker.color;
  txt.textContent = marker.label || "";
  row.appendChild(txt);
  tip.appendChild(row);
}

/**
 * @param {HTMLElement} tip
 * @param {number} turn
 * @param {{ name?: string, color: string, points: { x: number,
 *   y: number }[] }[]} series
 * @param {{ yLabel?: string, blp?: string }} head
 * @param {{ x: number, color: string, label?: string }[]} [markers]
 */
function fillHoverTip(tip, turn, series, head, markers) {
  while (tip.firstChild) tip.removeChild(tip.firstChild);
  tip.appendChild(buildHoverTipHeader(turn, head));
  appendCrisisHoverRow(tip, turn, markers);
  appendSeriesHoverRows(tip, turn, series);
}

/**
 * @param {HTMLElement} tip Already filled, so its width is meaningful.
 * @param {*} ev
 * @param {DOMRect} cellRect The cell's bounding rect (the positioned container the tip lives in).
 */
function placeTip(tip, ev, cellRect) {
  const GAP = 14;
  tip.style.display = "block"; // ensure it's laid out before measuring its size
  const tipW = tip.offsetWidth || 0;
  const tipH = tip.offsetHeight || 0;
  const viewW = (typeof window !== "undefined" && window.innerWidth) || cellRect.right;
  const viewH = (typeof window !== "undefined" && window.innerHeight) || cellRect.bottom;
  // Work in the cell's local px throughout: clientX/Y and the rect are visual, while the tip's
  // offsetWidth/Height and the style we write are local (the frame may be transform-scaled).
  const localX = toLocalPx(ev.clientX - cellRect.left);
  const localY = toLocalPx(ev.clientY - cellRect.top);
  const roomRight = toLocalPx(viewW - cellRect.left);
  const roomDown = toLocalPx(viewH - cellRect.top);
  // Default to the right of / below the cursor; flip when that would run past
  // the viewport edge so right-side and lower-row graphs stay on-screen.
  const flipLeft = localX + GAP + tipW > roomRight;
  const flipUp = localY + GAP + tipH > roomDown;
  const left = flipLeft ? localX - GAP - tipW : localX + GAP;
  const top = flipUp ? localY - GAP - tipH : localY + GAP;
  // Clamp the lower edge: near a cell's left/top corner (a small left-column cell
  // with a wide/tall tip), the flip subtracts past 0 and the tip clips off the
  // cell edge. A min margin keeps it on-cell (mirrors the Gantt tooltip's clamp).
  tip.style.left = Math.max(4, left) + "px";
  tip.style.top = Math.max(4, top) + "px";
}

/**
 * @param {*} ev
 * @param {*} ctx The hover context (svg, cross, cell, tip, turns, series, bounds, head, markers).
 */
function onHoverMove(ev, ctx) {
  const svgRect = ctx.svg.getBoundingClientRect();
  if (!svgRect.width) return;
  const innerW = MINI_W - PAD_L - PAD_R;
  const xSpan = ctx.bounds.xMax - ctx.bounds.xMin || 1;
  const viewBoxX = ((ev.clientX - svgRect.left) / svgRect.width) * MINI_W;
  const frac = Math.min(1, Math.max(0, (viewBoxX - PAD_L) / innerW));
  const turn = nearestTurn(ctx.turns, ctx.bounds.xMin + frac * xSpan);
  const xPx = (PAD_L + ((turn - ctx.bounds.xMin) / xSpan) * innerW).toFixed(1);
  ctx.cross.setAttribute("x1", xPx);
  ctx.cross.setAttribute("x2", xPx);
  ctx.cross.setAttribute("visibility", "visible");
  fillHoverTip(ctx.tip, turn, ctx.series, ctx.head, ctx.markers);
  placeTip(ctx.tip, ev, ctx.cell.getBoundingClientRect());
}

/**
 * Wire a hover tooltip onto the settlements bar chart listing each civ's net
 * settlements won/lost.
 * @param {HTMLElement} cell The chart cell (positioned container).
 * @param {{ name: string, color: string, net: number }[]} civs Per-civ nets.
 * @param {string} label The tooltip header (metric name).
 * @param {string} [blp] The metric's guide cost-icon BLP.
 */
export function attachBarHover(cell, civs, label, blp) {
  cell.style.position = "relative";
  const tip = document.createElement("div");
  tip.className = "demographics-war-graph-hovertip";
  fillBarTip(tip, civs, label, blp);
  cell.appendChild(tip);
  cell.addEventListener("mousemove", (ev) => placeTip(tip, ev, cell.getBoundingClientRect()));
  cell.addEventListener("mouseleave", () => {
    tip.style.display = "none";
  });
}

/**
 * Wire the crosshair + per-civ hover tooltip onto a time-series chart cell.
 * @param {HTMLElement} cell The chart cell (positioned container).
 * @param {SVGElement} svg The chart SVG (gets the crosshair line).
 * @param {{ series: *[], bounds: *, yLabel: string, blp?: string, markers?: * }} hover
 */
export function attachHover(cell, svg, hover) {
  const turns = collectTurns(hover.series);
  if (!turns.length) return;
  cell.style.position = "relative";
  const tip = document.createElement("div");
  tip.className = "demographics-war-graph-hovertip";
  cell.appendChild(tip);
  const cross = svgEl("line", {
    class: "demographics-war-graph-crosshair",
    x1: 0,
    y1: PAD_T,
    x2: 0,
    y2: MINI_H - PAD_B,
    visibility: "hidden"
  });
  svg.appendChild(cross);
  const ctx = {
    svg,
    cross,
    cell,
    tip,
    turns,
    series: hover.series,
    bounds: hover.bounds,
    head: { yLabel: hover.yLabel, blp: hover.blp },
    markers: hover.markers
  };
  cell.addEventListener("mousemove", (ev) => onHoverMove(ev, ctx));
  cell.addEventListener("mouseleave", () => {
    cross.setAttribute("visibility", "hidden");
    tip.style.display = "none";
  });
}

/**
 * Build the "no data recorded" placeholder for a graph cell.
 * @returns {HTMLElement}
 */
export function buildNoData() {
  const none = document.createElement("div");
  none.className = "demographics-war-graph-nodata";
  none.textContent = t("LOC_DEMOGRAPHICS_WAR_GRAPHS_NODATA");
  return none;
}

/**
 * Append a centered empty-state message to a war or crisis graphs host.
 * @param {HTMLElement} host
 * @param {string} msg
 */
export function appendGraphsEmpty(host, msg) {
  const el = document.createElement("div");
  el.className = "demographics-war-graphs-empty";
  el.textContent = msg;
  host.appendChild(el);
}
