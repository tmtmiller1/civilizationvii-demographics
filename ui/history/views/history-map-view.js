// history-map-view.js
//
// Paints the territory map (model/history-map.js) as a pointy-top hex field on a canvas, laid out as
// the game's own minimap is (north at the top, odd rows shifted half a hex): terrain by biome, each
// civilization's land tinted in its color over it, independent land in grey, unexplored cells
// blank, settlements as ringed dots. The timeline drives it: show(at) paints the frame at a timeline position, so
// playback replays the expansion. Every color is checked before it reaches the canvas (a malformed
// color string can take down the renderer, which JS cannot catch).

import { el, clear } from "/demographics/ui/history/core/history-dom.js";
import { derr } from "/demographics/ui/history/core/history-log.js";
import { t } from "/demographics/ui/history/core/history-text.js";
import { unrle, frameAt } from "/demographics/ui/history/model/history-map.js";
import { civIcon } from "/demographics/ui/history/views/history-widgets.js";

/** Canvas width of one hex column, in pixels. */
const HEX_W = 18;
/** Terrain colors by class (capture/history-mapgrid.js TERRAIN), close to the game's minimap. */
const TERRAIN_COLORS = ["#1b3a5e", "#5f6f42", "#77726a", "#3d7aa6", "#6f8c3e", "#a8995a", "#cfb77c", "#8e9a8c", "#4f7d3b"];
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
 */

/**
 * A color the canvas accepts for sure, or null.
 * @param {string} c Candidate.
 * @returns {string|null} Color.
 */
export function safeColor(c) {
  if (typeof c !== "string") return null;
  if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?([0-9a-fA-F]{2})?$/.test(c)) return c;
  if (/^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\)$/i.test(c)) return c;
  return null;
}

/**
 * Hex geometry for a grid.
 * @param {{w:number, h:number}} m Grid size.
 * @returns {{s:number, rowH:number, cw:number, ch:number}} Side, row height, canvas size.
 */
export function hexLayout(m) {
  const s = HEX_W / Math.sqrt(3);
  const rowH = 1.5 * s;
  return { s, rowH, cw: Math.ceil((m.w + 0.5) * HEX_W), ch: Math.ceil(2 * s + (m.h - 1) * rowH) };
}

/**
 * On-screen size of the map: MAP_REM tall, or MAP_MAX_W_REM wide when the world is wider than that.
 * @param {{cw:number, ch:number}} L Layout.
 * @returns {{w:number, h:number}} Size in rem.
 */
export function displaySize(L) {
  const ar = L.cw / Math.max(1, L.ch);
  const w = Math.min(MAP_MAX_W_REM, MAP_REM * ar);
  return { w, h: w / ar };
}

/**
 * Center of a cell on the canvas. Map rows count from the south edge, so the last row is drawn at
 * the top; odd rows are shifted half a hex, as on the game's minimap.
 * @param {{s:number, rowH:number}} L Layout.
 * @param {{w:number, h:number}} m Grid size.
 * @param {number} i Cell index.
 * @returns {{x:number, y:number}} Center.
 */
export function cellCenter(L, m, i) {
  const col = i % m.w;
  const row = Math.floor(i / m.w);
  return { x: (col + (row % 2) * 0.5 + 0.5) * HEX_W, y: L.s + (m.h - 1 - row) * L.rowH };
}

/**
 * Trace a hex.
 * @param {CanvasRenderingContext2D} g Context.
 * @param {number} x Center x.
 * @param {number} y Center y.
 * @param {number} s Side.
 */
function hex(g, x, y, s) {
  g.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 180) * (60 * k - 90);
    if (k === 0) g.moveTo(x + s * Math.cos(a), y + s * Math.sin(a));
    else g.lineTo(x + s * Math.cos(a), y + s * Math.sin(a));
  }
  g.closePath();
}

/**
 * Paint one frame.
 * @param {HTMLCanvasElement} cv Canvas.
 * @param {MapView} mv Map.
 * @param {MapView["frames"][number]} f Frame.
 * @param {(pid:number) => string} colorOf Civilization color ("" for one not to show).
 */
function paint(cv, mv, f, colorOf) {
  const g = cv.getContext("2d");
  if (!g) return;
  const L = hexLayout(mv);
  g.clearRect(0, 0, cv.width, cv.height);
  paintCells(g, L, mv, f, colorOf);
  paintSettlements(g, L, mv, f, colorOf);
}

/**
 * The layers of one cell: its terrain (blank when unexplored), and the tint of whoever holds it.
 * @param {number} owner Owner value.
 * @param {number} terrain Terrain class.
 * @param {(pid:number) => string} colorOf Civilization color ("" for one not to show).
 * @returns {{base:string, tint:string|null}} Colors.
 */
export function cellLayers(owner, terrain, colorOf) {
  if (owner === UNEXPLORED) return { base: UNEXPLORED_COLOR, tint: null };
  const base = TERRAIN_COLORS[terrain] || TERRAIN_COLORS[1];
  if (owner === OTHER_OWNER) return { base, tint: OTHER_COLOR };
  return { base, tint: owner >= 0 ? safeColor(colorOf(owner)) : null };
}

/**
 * Paint every cell: terrain, then the holder's color over it.
 * @param {CanvasRenderingContext2D} g Context.
 * @param {{s:number, rowH:number}} L Layout.
 * @param {MapView} mv Map.
 * @param {MapView["frames"][number]} f Frame.
 * @param {(pid:number) => string} colorOf Civilization color.
 */
function paintCells(g, L, mv, f, colorOf) {
  const n = mv.w * mv.h;
  const terrain = unrle(mv.terrain, n, 1);
  const owners = unrle(f.o, n, -1);
  for (let i = 0; i < n; i++) {
    const p = cellCenter(L, mv, i);
    const layer = cellLayers(owners[i], terrain[i], colorOf);
    hex(g, p.x, p.y, L.s + 0.35);
    g.fillStyle = layer.base;
    g.fill();
    if (layer.tint) {
      g.globalAlpha = TINT;
      g.fillStyle = layer.tint;
      g.fill();
      g.globalAlpha = 1;
    }
  }
}

/**
 * Paint the settlements of shown civilizations as ringed dots.
 * @param {CanvasRenderingContext2D} g Context.
 * @param {{s:number, rowH:number}} L Layout.
 * @param {MapView} mv Map.
 * @param {MapView["frames"][number]} f Frame.
 * @param {(pid:number) => string} colorOf Civilization color.
 */
function paintSettlements(g, L, mv, f, colorOf) {
  const n = mv.w * mv.h;
  const r = Math.max(2.5, L.s * 0.45);
  g.lineWidth = 1.5;
  g.strokeStyle = "#1a140c";
  g.fillStyle = "#fff8e6";
  for (const c of f.c) {
    const i = Number(c[0]);
    if (!(i >= 0 && i < n) || !colorOf(Number(c[1]))) continue;
    const p = cellCenter(L, mv, i);
    g.beginPath();
    g.arc(p.x, p.y, r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
}

/**
 * Who holds land in a frame, most land first.
 * @param {MapView} mv Map.
 * @param {MapView["frames"][number]} f Frame.
 * @returns {{pid:number, cells:number, towns:number}[]} Holders.
 */
export function holders(mv, f) {
  /** @type {Map<number, {pid:number, cells:number, towns:number}>} */
  const by = new Map();
  for (const o of unrle(f.o, mv.w * mv.h, -1)) {
    if (o < 0) continue;
    const h = by.get(o) || { pid: o, cells: 0, towns: 0 };
    h.cells++;
    by.set(o, h);
  }
  for (const c of f.c) {
    const h = by.get(Number(c[1]));
    if (h) h.towns++;
  }
  return [...by.values()].sort((a, b) => b.cells - a.cells);
}

/**
 * The map panel.
 * @param {MapView} mv Map.
 * @param {Cast} cast Cast.
 * @param {(at:number) => string} ageAt Age type at a timeline position.
 * @param {(at:number) => string} [whenAt] Label of a timeline position ("Modern, T157").
 * @returns {{el: HTMLElement, show: (at:number) => void}} Panel and its painter.
 */
export function mapPanel(mv, cast, ageAt, whenAt = () => "") {
  const L = hexLayout(mv);
  const cv = /** @type {HTMLCanvasElement} */ (document.createElement("canvas"));
  cv.width = L.cw;
  cv.height = L.ch;
  cv.className = "dgh-map-canvas";
  const size = displaySize(L);
  cv.style.width = size.w.toFixed(2) + "rem";
  cv.style.height = size.h.toFixed(2) + "rem";
  const legend = el("div", { cls: "dgh-map-legend" });
  let shown = /** @type {MapView["frames"][number]|null} */ (null);
  const show = (/** @type {number} */ at) => {
    const f = frameAt(mv, at);
    if (!f || f === shown) return;
    shown = f;
    try {
      paint(cv, mv, f, (pid) => (cast.known(pid) ? cast.color(pid) : ""));
    } catch (e) {
      derr("map paint failed", e);
    }
    clear(legend);
    legend.appendChild(el("div", { cls: "dgh-map-title", text: t("LOC_DEMOGRAPHICS_HIST_MAP_TITLE") }));
    legend.appendChild(el("div", { cls: "dgh-map-when", text: whenAt(f.at) }));
    const age = ageAt(f.at);
    for (const h of holders(mv, f).filter((x) => cast.known(x.pid) && cast.color(x.pid)).slice(0, 10)) {
      const civ = cast.civType(h.pid, age);
      const chip = el("div", { cls: "dgh-map-legend-item" + (h.pid === cast.local ? " is-mine" : "") }, [
        el("div", { cls: "dgh-civ-dot", style: { backgroundColor: safeColor(cast.color(h.pid)) || "#85878c" } }),
        civ ? civIcon(civ, "dgh-civ-icon dgh-map-legend-icon") : null,
        el("div", { cls: "dgh-map-legend-name", text: cast.civName(h.pid, age) || cast.leaderName(h.pid) }),
        h.towns ? el("div", { cls: "dgh-map-legend-towns" }, [
          el("div", { cls: "dgh-map-house" }, [el("div", { cls: "dgh-tl-found-roof" })]),
          el("div", { text: String(h.towns) })
        ]) : null
      ]);
      legend.appendChild(chip);
    }
  };
  const box = el("div", { cls: "dgh-map" }, [el("div", { cls: "dgh-map-frame" }, [cv]), legend]);
  show(mv.frames[mv.frames.length - 1].at);
  return { el: box, show };
}
