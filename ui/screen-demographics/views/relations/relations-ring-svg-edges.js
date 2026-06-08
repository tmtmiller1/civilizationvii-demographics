// relations-ring-svg-edges.js
//
// Edge-grouping and edge-rendering helpers for the Global Relations ring SVG.

import {
  dasharrayFor,
  dlog
} from "/demographics/ui/screen-demographics/views/relations/relations-shared.js";

/**
 * One relationship edge between two ring nodes. `a`/`b` are player ids; the
 * remaining fields are visual hints consumed by the ring renderer.
 * @typedef {Object} Edge
 * @property {number} a Source player id.
 * @property {number} b Target player id.
 * @property {string} [color] Stroke color (hex or rgba).
 * @property {string} [label] Optional human-readable edge label.
 * @property {string} [filterKey] Filter category this edge belongs to.
 * @property {boolean} [dashed] Legacy dashed-line flag (suzerain edges).
 * @property {number} [width] Per-edge stroke width (currently ignored).
 * @property {number} [opacity] Per-edge stroke opacity (currently ignored).
 * @property {string|null} [_dashOverride] Per-tab dash-pattern override.
 */

/**
 * A grouped edge entry: the edge plus the resolved endpoint positions.
 * @typedef {Object} EdgeGeo
 * @property {Edge} e The edge.
 * @property {{x: number, y: number}} pa Source position (viewBox coords).
 * @property {{x: number, y: number}} pb Target position (viewBox coords).
 */

const SVG_NS = "http://www.w3.org/2000/svg";

// Perpendicular offset per parallel-line slot. ~1.6 SVG units gives
// clear visual separation without making the lines look unrelated.
const PARALLEL_SPACING = 1.6;

let _dashLogged = false;

/**
 * Group edges by undirected pair so a pair carrying multiple relationships can
 * be drawn as parallel offset lines. Drops edges whose endpoints aren't both
 * positioned.
 * @param {Edge[]} edges The edges to group.
 * @param {Map<number, {x: number, y: number}>} positions Node positions.
 * @returns {Map<string, EdgeGeo[]>} Edge groups keyed by sorted pair.
 */
export function groupEdgesByPair(edges, positions) {
  /** @type {Map<string, EdgeGeo[]>} */
  const edgeGroups = new Map();
  for (const e of edges) {
    const pa = positions.get(e.a);
    const pb = positions.get(e.b);
    if (!pa || !pb) continue;
    const key = e.a < e.b ? e.a + "|" + e.b : e.b + "|" + e.a;
    let group = edgeGroups.get(key);
    if (!group) {
      group = [];
      edgeGroups.set(key, group);
    }
    group.push({ e, pa, pb });
  }
  return edgeGroups;
}

/**
 * Append a single solid `<line>` for an edge slot.
 * @param {Element} svg The SVG root.
 * @param {Edge} e The edge.
 * @param {{pa: {x: number, y: number}, pb: {x: number, y: number}, ox: number, oy: number}} slot
 *   Source/target positions and the slot's perpendicular offset.
 */
function appendSolidEdge(svg, e, slot) {
  const { pa, pb, ox, oy } = slot;
  const line = document.createElementNS(SVG_NS, "line");
  line.setAttribute("x1", String(pa.x + ox));
  line.setAttribute("y1", String(pa.y + oy));
  line.setAttribute("x2", String(pb.x + ox));
  line.setAttribute("y2", String(pb.y + oy));
  line.setAttribute("stroke", e.color || "#bfbfbf");
  // Uniform thickness + opacity across every edge on both rings. Per-edge
  // overrides (e.width / e.opacity) are intentionally ignored - they made
  // edge color the only signal a reader has to discriminate filter types.
  line.setAttribute("stroke-width", "0.6");
  line.setAttribute("stroke-opacity", "0.9");
  line.setAttribute("class", "demographics-relations-line");
  line.setAttribute("stroke-linecap", "round");
  svg.appendChild(line);
}

/**
 * Append one dash sub-segment as a real solid `<line>`.
 * @param {Element} svg The SVG root.
 * @param {string} color Stroke color.
 * @param {{x1: number, y1: number, x2: number, y2: number}} pts Segment endpoints.
 */
function appendDashSeg(svg, color, pts) {
  const seg = document.createElementNS(SVG_NS, "line");
  seg.setAttribute("x1", String(pts.x1));
  seg.setAttribute("y1", String(pts.y1));
  seg.setAttribute("x2", String(pts.x2));
  seg.setAttribute("y2", String(pts.y2));
  seg.setAttribute("stroke", color);
  seg.setAttribute("stroke-width", "0.6");
  seg.setAttribute("stroke-opacity", "0.9");
  seg.setAttribute("stroke-linecap", "round");
  seg.setAttribute("class", "demographics-relations-line");
  svg.appendChild(seg);
}

/**
 * Log the dashed-edge-synthesis note once per session (Coherent ignores
 * stroke-dasharray on <line>, so we hand-synthesize dashes).
 * @param {Edge} e The edge.
 * @param {string} dash The dash pattern string.
 */
function logDashOnce(e, dash) {
  if (_dashLogged) return;
  dlog(
    "dashed edge synth: filterKey=" +
      (e.filterKey || "(none)") +
      " pattern='" +
      dash +
      "' color=" +
      (e.color || "?")
  );
  _dashLogged = true;
}

/**
 * Walk a line, emitting solid sub-segments for the "dash" runs of the pattern.
 * @param {Element} svg The SVG root.
 * @param {string} color Stroke color.
 * @param {{ pa: {x: number, y: number}, totalLen: number, parts: number[],
 *   ux: number, uy: number }} run Start point, length, dash pattern, unit vector.
 */
function walkDashSegments(svg, color, run) {
  const { pa, totalLen, parts, ux, uy } = run;
  let t = 0;
  let segIdx = 0; // even idx = dash (draw), odd = gap (skip)
  while (t < totalLen) {
    const segLen = parts[segIdx % parts.length];
    const end = Math.min(t + segLen, totalLen);
    if (segIdx % 2 === 0 && end > t) {
      appendDashSeg(svg, color, {
        x1: pa.x + ux * t,
        y1: pa.y + uy * t,
        x2: pa.x + ux * end,
        y2: pa.y + uy * end
      });
    }
    t = end;
    segIdx++;
  }
}

/**
 * Render a dashed edge by synthesizing solid sub-line segments by hand -
 * Coherent's renderer ignores `stroke-dasharray` on `<line>`. Falls back to
 * a single solid line for bad / zero-length patterns.
 * @param {Element} svg The SVG root.
 * @param {Edge} e The edge.
 * @param {{x: number, y: number}} pa Source position (slot-offset applied).
 * @param {{x: number, y: number}} pb Target position (slot-offset applied).
 * @param {string} dash The dash pattern string.
 */
function appendDashedEdge(svg, e, pa, pb, dash) {
  logDashOnce(e, dash);
  const parts = dash
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((n) => !isNaN(n) && n > 0);
  const color = e.color || "#bfbfbf";
  if (parts.length < 2) {
    // Bad pattern - fall back to solid.
    appendSolidEdge(svg, e, { pa, pb, ox: 0, oy: 0 });
    return;
  }
  const totalLen = Math.sqrt((pb.x - pa.x) ** 2 + (pb.y - pa.y) ** 2);
  if (totalLen <= 0) {
    appendSolidEdge(svg, e, { pa, pb, ox: 0, oy: 0 });
    return;
  }
  const ux = (pb.x - pa.x) / totalLen;
  const uy = (pb.y - pa.y) / totalLen;
  walkDashSegments(svg, color, { pa, totalLen, parts, ux, uy });
}

/**
 * Render one undirected pair's group of edges as parallel offset lines,
 * centered around the pair axis. Solid edges draw directly; dashed edges are
 * synthesized as solid sub-segments at the slot's offset endpoints.
 * @param {Element} svg The SVG root.
 * @param {EdgeGeo[]} entries The grouped edges for this pair.
 */
export function appendEdgeGroup(svg, entries) {
  const n = entries.length;
  const first = entries[0];
  const dx = first.pb.x - first.pa.x;
  const dy = first.pb.y - first.pa.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  entries.forEach(({ e, pa, pb }, i) => {
    const slot = i - (n - 1) / 2;
    const ox = px * slot * PARALLEL_SPACING;
    const oy = py * slot * PARALLEL_SPACING;
    const dash = dasharrayFor(e);
    if (!dash) {
      appendSolidEdge(svg, e, { pa, pb, ox, oy });
    } else {
      appendDashedEdge(
        svg,
        e,
        { x: first.pa.x + ox, y: first.pa.y + oy },
        { x: first.pb.x + ox, y: first.pb.y + oy },
        dash
      );
    }
  });
}