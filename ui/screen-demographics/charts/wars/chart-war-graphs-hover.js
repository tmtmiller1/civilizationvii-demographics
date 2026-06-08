// chart-war-graphs-hover.js
//
// Hover and empty-state helpers for the War Graphs view.

import {
  collectTurns,
  nearestTurn,
  tipVal
} from "/demographics/ui/screen-demographics/charts/wars/chart-war-series.js";
import { svgEl } from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";
import { t } from "/demographics/ui/core/demographics-i18n.js";
import {
  MINI_H,
  MINI_W,
  PAD_B,
  PAD_L,
  PAD_R,
  PAD_T
} from "/demographics/ui/screen-demographics/charts/wars/chart-war-mini-chart.js";

/**
 * Format a settlement net for the bar tooltip ("+2" / "−1" / "0").
 * @param {number} n The net value.
 * @returns {string} The signed display.
 */
function barVal(n) {
  if (n > 0) return "+" + n;
  if (n < 0) return "−" + Math.abs(n);
  return "0";
}

/**
 * Populate the bar tooltip with every civ's net settlements.
 * @param {HTMLElement} tip The tooltip element.
 * @param {{ name: string, color: string, net: number }[]} civs Per-civ nets.
 * @param {string} label The header text.
 */
function fillBarTip(tip, civs, label) {
  const head = document.createElement("div");
  head.className = "demographics-war-graph-hovertip-head";
  head.textContent = label;
  tip.appendChild(head);
  for (const c of civs) {
    const row = document.createElement("div");
    row.className = "demographics-war-graph-hovertip-row";
    const dot = document.createElement("span");
    dot.className = "demographics-war-graph-hovertip-dot";
    dot.style.backgroundColor = c.color;
    row.appendChild(dot);
    row.appendChild(document.createTextNode(c.name || ""));
    const val = document.createElement("span");
    val.className = "demographics-war-graph-hovertip-val";
    val.textContent = barVal(c.net);
    row.appendChild(val);
    tip.appendChild(row);
  }
}

/**
 * Build the hover tooltip header.
 * @param {number} turn Hovered turn.
 * @param {string} yLabel Y-axis metric label.
 * @returns {HTMLElement} Header element.
 */
function buildHoverTipHeader(turn, yLabel) {
  const head = document.createElement("div");
  head.className = "demographics-war-graph-hovertip-head";
  head.textContent = "Turn " + turn + (yLabel ? " · " + yLabel : "");
  return head;
}

/**
 * Build one series/value row for the hover tooltip.
 * @param {{ name?: string, color: string }} series One series descriptor.
 * @param {number} value The series value at the hovered turn.
 * @returns {HTMLElement} Row element.
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
 * Append one row per series that has a point at the hovered turn.
 * @param {HTMLElement} tip The tooltip element.
 * @param {number} turn Hovered turn.
 * @param {{ name?: string, color: string, points: { x: number,
 *   y: number }[] }[]} series The series.
 */
function appendSeriesHoverRows(tip, turn, series) {
  for (const s of series) {
    const pt = s.points.find((p) => p.x === turn);
    if (!pt) continue;
    tip.appendChild(buildSeriesHoverRow(s, pt.y));
  }
}

/**
 * Add a crisis-stage row to the hover tooltip when the hovered turn lands on a
 * crisis-stage onset.
 * @param {HTMLElement} tip The tooltip element.
 * @param {number} turn The hovered turn.
 * @param {{ x: number, color: string, label?: string }[]|undefined} markers The crisis markers.
 */
function appendCrisisHoverRow(tip, turn, markers) {
  if (!markers || !markers.length) return;
  const mk = markers.find((m) => m.x === turn && m.label);
  if (!mk) return;
  const row = document.createElement("div");
  row.className = "demographics-war-graph-hovertip-row";
  const dot = document.createElement("span");
  dot.className = "demographics-war-graph-hovertip-dot";
  dot.style.backgroundColor = mk.color;
  row.appendChild(dot);
  const txt = document.createElement("span");
  txt.style.color = mk.color;
  txt.textContent = mk.label || "";
  row.appendChild(txt);
  tip.appendChild(row);
}

/**
 * Populate the hover tooltip with each civ's value at the hovered turn.
 * @param {HTMLElement} tip The tooltip element.
 * @param {number} turn The hovered turn.
 * @param {{ name?: string, color: string, points: { x: number,
 *   y: number }[] }[]} series The series.
 * @param {string} yLabel The metric unit (shown in the header).
 * @param {{ x: number, color: string, label?: string }[]} [markers] Optional crisis markers.
 */
function fillHoverTip(tip, turn, series, yLabel, markers) {
  while (tip.firstChild) tip.removeChild(tip.firstChild);
  tip.appendChild(buildHoverTipHeader(turn, yLabel));
  appendCrisisHoverRow(tip, turn, markers);
  appendSeriesHoverRows(tip, turn, series);
}

/**
 * Move handler: snap to the nearest turn, position the crosshair, and fill the
 * tooltip with each civ's value there.
 * @param {*} ev The mouse event.
 * @param {*} ctx The hover context (svg, cross, cell, tip, turns, series, bounds, yLabel, markers).
 */
function onHoverMove(ev, ctx) {
  const sRect = ctx.svg.getBoundingClientRect();
  if (!sRect.width) return;
  const innerW = MINI_W - PAD_L - PAD_R;
  const xSpan = ctx.bounds.xMax - ctx.bounds.xMin || 1;
  const vx = ((ev.clientX - sRect.left) / sRect.width) * MINI_W;
  const frac = Math.min(1, Math.max(0, (vx - PAD_L) / innerW));
  const turn = nearestTurn(ctx.turns, ctx.bounds.xMin + frac * xSpan);
  const xPx = (PAD_L + ((turn - ctx.bounds.xMin) / xSpan) * innerW).toFixed(1);
  ctx.cross.setAttribute("x1", xPx);
  ctx.cross.setAttribute("x2", xPx);
  ctx.cross.setAttribute("visibility", "visible");
  fillHoverTip(ctx.tip, turn, ctx.series, ctx.yLabel, ctx.markers);
  const cRect = ctx.cell.getBoundingClientRect();
  ctx.tip.style.left = ev.clientX - cRect.left + 14 + "px";
  ctx.tip.style.top = ev.clientY - cRect.top + 14 + "px";
  ctx.tip.style.display = "block";
}

/**
 * Wire a hover tooltip onto the settlements bar chart listing each civ's net
 * settlements won/lost.
 * @param {HTMLElement} cell The chart cell (positioned container).
 * @param {{ name: string, color: string, net: number }[]} civs Per-civ nets.
 * @param {string} label The tooltip header (metric name).
 */
export function attachBarHover(cell, civs, label) {
  cell.style.position = "relative";
  const tip = document.createElement("div");
  tip.className = "demographics-war-graph-hovertip";
  fillBarTip(tip, civs, label);
  cell.appendChild(tip);
  cell.addEventListener("mousemove", (ev) => {
    const cRect = cell.getBoundingClientRect();
    tip.style.left = ev.clientX - cRect.left + 14 + "px";
    tip.style.top = ev.clientY - cRect.top + 14 + "px";
    tip.style.display = "block";
  });
  cell.addEventListener("mouseleave", () => {
    tip.style.display = "none";
  });
}

/**
 * Wire the crosshair + per-civ hover tooltip onto a time-series chart cell.
 * @param {HTMLElement} cell The chart cell (positioned container).
 * @param {SVGElement} svg The chart SVG (gets the crosshair line).
 * @param {{ series: *[], bounds: *, yLabel: string, markers?: * }} hover The hover data.
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
    yLabel: hover.yLabel,
    markers: hover.markers
  };
  cell.addEventListener("mousemove", (ev) => onHoverMove(ev, ctx));
  cell.addEventListener("mouseleave", () => {
    cross.setAttribute("visibility", "hidden");
    tip.style.display = "none";
  });
}

/**
 * The "no data recorded" placeholder element.
 * @returns {HTMLElement} The placeholder.
 */
export function buildNoData() {
  const none = document.createElement("div");
  none.className = "demographics-war-graph-nodata";
  none.textContent = t("LOC_DEMOGRAPHICS_WAR_GRAPHS_NODATA");
  return none;
}