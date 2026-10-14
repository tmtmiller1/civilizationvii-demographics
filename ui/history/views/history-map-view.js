// history-map-view.js
//
// Paints the territory map (model/history-map.js) as a pointy-top hex field on a canvas, laid out as
// the game's own minimap is. The timeline drives it: show(at) paints the frame at a timeline
// position. Every color is checked before it reaches the canvas, since a malformed color string can
// take down the renderer, which JS cannot catch.

import { el, clear } from "/demographics/ui/history/core/history-dom.js";
import { log } from "/demographics/ui/history/core/history-log.js";
import { t } from "/demographics/ui/history/core/history-text.js";
import { unrle, frameAt } from "/demographics/ui/history/model/history-map.js";
import { civIcon } from "/demographics/ui/history/views/history-widgets.js";

/** Canvas width of one hex column, in pixels. */
const HEX_W = 18;
/** Terrain colors by class (capture/history-mapgrid.js TERRAIN), close to the game's minimap. */
const TERRAIN_COLORS = [
  "#1b3a5e",
  "#5f6f42",
  "#77726a",
  "#3d7aa6",
  "#6f8c3e",
  "#a8995a",
  "#cfb77c",
  "#8e9a8c",
  "#4f7d3b"
];
const UNEXPLORED_COLOR = "#0d1016";
const OTHER_COLOR = "#8d8a82";
const OTHER_OWNER = -2;
const UNEXPLORED = -3;
/** How strongly a holder's color tints the terrain under it. */
const TINT = 0.62;
/** Height of the map on screen, in rem, and the widest it may be (a very wide world is shown shorter). */
const MAP_REM = 21;
const MAP_MAX_W_REM = 40;

/**
 * @typedef {import("../model/history-map.js").MapView} MapView
 * @typedef {import("../model/history-narrate.js").Cast} Cast
 * @typedef {MapView["frames"][number]} MapFrame
 * @typedef {{side:number, rowHeight:number, canvasWidth:number, canvasHeight:number}} HexLayout
 *   Hex side and row height, and the canvas size, in canvas pixels.
 */

/**
 * A color the canvas accepts for sure, or null.
 * @param {string} color
 * @returns {string|null}
 */
export function safeColor(color) {
  if (typeof color !== "string") return null;
  if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?([0-9a-fA-F]{2})?$/.test(color)) return color;
  if (/^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\)$/i.test(color)) return color;
  return null;
}

/**
 * Hex geometry for a grid.
 * @param {{w:number, h:number}} grid
 * @returns {HexLayout}
 */
export function hexLayout(grid) {
  const side = HEX_W / Math.sqrt(3);
  const rowHeight = 1.5 * side;
  return {
    side,
    rowHeight,
    canvasWidth: Math.ceil((grid.w + 0.5) * HEX_W),
    canvasHeight: Math.ceil(2 * side + (grid.h - 1) * rowHeight)
  };
}

/**
 * On-screen size of the map: MAP_REM tall, or MAP_MAX_W_REM wide when the world is wider than that.
 * @param {HexLayout} layout
 * @returns {{width:number, height:number}} Size in rem.
 */
export function displaySize(layout) {
  const aspect = layout.canvasWidth / Math.max(1, layout.canvasHeight);
  const width = Math.min(MAP_MAX_W_REM, MAP_REM * aspect);
  return { width, height: width / aspect };
}

/**
 * Center of a cell on the canvas. Map rows count from the south edge, so the last row is drawn at
 * the top; odd rows are shifted half a hex, as on the game's minimap.
 * @param {HexLayout} layout
 * @param {{w:number, h:number}} grid
 * @param {number} cell Cell index.
 * @returns {{x:number, y:number}}
 */
export function cellCenter(layout, grid, cell) {
  const col = cell % grid.w;
  const row = Math.floor(cell / grid.w);
  return {
    x: (col + (row % 2) * 0.5 + 0.5) * HEX_W,
    y: layout.side + (grid.h - 1 - row) * layout.rowHeight
  };
}

/**
 * @param {CanvasRenderingContext2D} context
 * @param {number} x
 * @param {number} y
 * @param {number} side
 */
function hex(context, x, y, side) {
  context.beginPath();
  for (let k = 0; k < 6; k++) {
    const angle = (Math.PI / 180) * (60 * k - 90);
    if (k === 0) context.moveTo(x + side * Math.cos(angle), y + side * Math.sin(angle));
    else context.lineTo(x + side * Math.cos(angle), y + side * Math.sin(angle));
  }
  context.closePath();
}

/**
 * Paint one frame.
 * @param {HTMLCanvasElement} canvas
 * @param {MapView} mapView
 * @param {MapFrame} frame
 * @param {(pid:number) => string} colorOf Civilization color ("" for one not to show).
 */
function paint(canvas, mapView, frame, colorOf) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const layout = hexLayout(mapView);
  context.clearRect(0, 0, canvas.width, canvas.height);
  paintCells(context, layout, mapView, frame, colorOf);
  paintSettlements(context, layout, mapView, frame, colorOf);
}

/**
 * The layers of one cell: its terrain (blank when unexplored), and the tint of whoever holds it.
 * @param {number} owner
 * @param {number} terrain
 * @param {(pid:number) => string} colorOf Civilization color ("" for one not to show).
 * @returns {{base:string, tint:string|null}}
 */
export function cellLayers(owner, terrain, colorOf) {
  if (owner === UNEXPLORED) return { base: UNEXPLORED_COLOR, tint: null };
  const base = TERRAIN_COLORS[terrain] || TERRAIN_COLORS[1];
  if (owner === OTHER_OWNER) return { base, tint: OTHER_COLOR };
  return { base, tint: owner >= 0 ? safeColor(colorOf(owner)) : null };
}

/**
 * Paint every cell: terrain, then the holder's color over it.
 * @param {CanvasRenderingContext2D} context
 * @param {HexLayout} layout
 * @param {MapView} mapView
 * @param {MapFrame} frame
 * @param {(pid:number) => string} colorOf
 */
function paintCells(context, layout, mapView, frame, colorOf) {
  const cells = mapView.w * mapView.h;
  const terrain = unrle(mapView.terrain, cells, 1);
  const owners = unrle(frame.o, cells, -1);
  for (let i = 0; i < cells; i++) {
    const center = cellCenter(layout, mapView, i);
    const layer = cellLayers(owners[i], terrain[i], colorOf);
    hex(context, center.x, center.y, layout.side + 0.35);
    context.fillStyle = layer.base;
    context.fill();
    if (layer.tint) {
      context.globalAlpha = TINT;
      context.fillStyle = layer.tint;
      context.fill();
      context.globalAlpha = 1;
    }
  }
}

/**
 * Paint the settlements of shown civilizations as ringed dots.
 * @param {CanvasRenderingContext2D} context
 * @param {HexLayout} layout
 * @param {MapView} mapView
 * @param {MapFrame} frame
 * @param {(pid:number) => string} colorOf
 */
function paintSettlements(context, layout, mapView, frame, colorOf) {
  const cells = mapView.w * mapView.h;
  const radius = Math.max(2.5, layout.side * 0.45);
  context.lineWidth = 1.5;
  context.strokeStyle = "#1a140c";
  context.fillStyle = "#fff8e6";
  for (const settlement of frame.c || []) {
    const cell = Number(settlement[0]);
    if (!(cell >= 0 && cell < cells) || !colorOf(Number(settlement[1]))) continue;
    const center = cellCenter(layout, mapView, cell);
    context.beginPath();
    context.arc(center.x, center.y, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
}

/**
 * Who holds land in a frame, most land first.
 * @param {MapView} mapView
 * @param {MapFrame} frame
 * @returns {{pid:number, cells:number, towns:number}[]}
 */
export function holders(mapView, frame) {
  /** @type {Map<number, {pid:number, cells:number, towns:number}>} */
  const byPid = new Map();
  for (const owner of unrle(frame.o, mapView.w * mapView.h, -1)) {
    if (owner < 0) continue;
    const holder = byPid.get(owner) || { pid: owner, cells: 0, towns: 0 };
    holder.cells++;
    byPid.set(owner, holder);
  }
  for (const settlement of frame.c || []) {
    const holder = byPid.get(Number(settlement[1]));
    if (holder) holder.towns++;
  }
  return [...byPid.values()].sort((a, b) => b.cells - a.cells);
}

/**
 * Fill the legend for a frame: title, when, and who holds land (most first, ten at most).
 * @param {HTMLElement} legend Emptied first.
 * @param {MapView} mapView
 * @param {MapFrame} frame
 * @param {Cast} cast
 * @param {{ageAt: (at:number) => string, whenAt: (at:number) => string}} labels Age and position labels.
 */
function fillLegend(legend, mapView, frame, cast, labels) {
  clear(legend);
  legend.appendChild(el("div", { cls: "dgh-map-title", text: t("LOC_DEMOGRAPHICS_HIST_MAP_TITLE") }));
  legend.appendChild(el("div", { cls: "dgh-map-when", text: labels.whenAt(frame.at) }));
  const age = labels.ageAt(frame.at);
  const shown = holders(mapView, frame).filter((holder) => cast.known(holder.pid) && cast.color(holder.pid));
  for (const holder of shown.slice(0, 10)) legend.appendChild(legendItem(holder, cast, age));
}

/**
 * One holder's legend entry: color dot, emblem, name and settlement count.
 * @param {{pid:number, towns:number}} holder
 * @param {Cast} cast
 * @param {string} age
 * @returns {HTMLElement}
 */
function legendItem(holder, cast, age) {
  const civ = cast.civType(holder.pid, age);
  const towns = holder.towns
    ? el("div", { cls: "dgh-map-legend-towns" }, [
      el("div", { cls: "dgh-map-house" }, [el("div", { cls: "dgh-tl-found-roof" })]),
      el("div", { text: String(holder.towns) })
    ])
    : null;
  return el("div", { cls: "dgh-map-legend-item" + (holder.pid === cast.local ? " is-mine" : "") }, [
    el("div", { cls: "dgh-civ-dot", style: { backgroundColor: safeColor(cast.color(holder.pid)) || "#85878c" } }),
    civ ? civIcon(civ, "dgh-civ-icon dgh-map-legend-icon") : null,
    el("div", { cls: "dgh-map-legend-name", text: cast.civName(holder.pid, age) || cast.leaderName(holder.pid) }),
    towns
  ]);
}

/**
 * The map panel. show() is called from the timeline's playback timer and its click handlers, so it
 * never throws: a frame that cannot be painted or described is logged and the panel keeps its last
 * good state.
 * @param {MapView} mapView
 * @param {Cast} cast
 * @param {(at:number) => string} ageAt Age type at a timeline position.
 * @param {(at:number) => string} [whenAt] Label of a timeline position ("Modern, T157").
 * @returns {{el: HTMLElement, show: (at:number) => void}} Panel and its painter.
 */
export function mapPanel(mapView, cast, ageAt, whenAt = () => "") {
  const layout = hexLayout(mapView);
  const canvas = /** @type {HTMLCanvasElement} */ (document.createElement("canvas"));
  canvas.width = layout.canvasWidth;
  canvas.height = layout.canvasHeight;
  canvas.className = "dgh-map-canvas";
  const size = displaySize(layout);
  canvas.style.width = size.width.toFixed(2) + "rem";
  canvas.style.height = size.height.toFixed(2) + "rem";
  const legend = el("div", { cls: "dgh-map-legend" });
  let shown = /** @type {MapFrame|null} */ (null);
  const show = (/** @type {number} */ at) => {
    const frame = frameAt(mapView, at);
    if (!frame || frame === shown) return;
    shown = frame;
    try {
      paint(canvas, mapView, frame, (pid) => (cast.known(pid) ? cast.color(pid) : ""));
    } catch (e) {
      log.error("map paint failed", e);
    }
    try {
      fillLegend(legend, mapView, frame, cast, { ageAt, whenAt });
    } catch (e) {
      log.error("map legend failed", e);
    }
  };
  const box = el("div", { cls: "dgh-map" }, [el("div", { cls: "dgh-map-frame" }, [canvas]), legend]);
  show(mapView.frames[mapView.frames.length - 1].at);
  return { el: box, show };
}
