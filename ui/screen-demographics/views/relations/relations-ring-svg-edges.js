// relations-ring-svg-edges.js
//
// Edge-grouping and edge-rendering helpers for the Global Relations ring SVG.

import {
  dasharrayFor,
  log
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
 * @property {boolean} [dashed] Dashed-line flag, set directly by suzerain edges.
 * @property {boolean} [directed] When set, render a→b direction chevrons.
 * @property {number} [width] Per-edge stroke width (currently ignored).
 * @property {number} [opacity] Per-edge stroke opacity (currently ignored).
 * @property {string|null} [_dashOverride] Per-tab dash-pattern override.
 * @property {string} [_typeLabel] Human-readable relationship type (hover tooltip).
 */

/**
 * Per-edge hover record: the edge's group element, its tooltip label, and points
 * sampled along its curve (viewBox coords) for the HTML-level nearest-edge test.
 * @typedef {Object} EdgeRecord
 * @property {SVGGElement} g The edge's `<g>` element (gets `.is-hovered`).
 * @property {string} label The relationship-type label for the tooltip.
 * @property {{x: number, y: number}[]} pts Sampled curve points.
 */

/**
 * A grouped edge entry: the edge plus the resolved endpoint positions.
 * @typedef {Object} EdgeGeo
 * @property {Edge} e
 * @property {{x: number, y: number}} pa Source position (viewBox coords).
 * @property {{x: number, y: number}} pb Target position (viewBox coords).
 */

const SVG_NS = "http://www.w3.org/2000/svg";

// Line weight (viewBox units): thin so the ring reads as fine connectors.
const STROKE_W = "0.4";

// Endpoint trim: lines stop at the node's circle (radius + small gap) instead of
// plunging into the leader icon at the center, which de-clutters the hubs.
const ENDPOINT_GAP = 0.7; // viewBox units beyond the node radius
const DEFAULT_NODE_R = 5; // fallback radius when a node's radius is unknown

// Separating the lines of a pair: a perpendicular offset keeps them apart along
// their entire length (a curve-only fan converges at the endpoints), and a gentle
// curve varied in direction is layered on top. Both spread evenly across a
// bounded range so any number of coexisting lines stay distinct.
const PAIR_OFFSET = 4.4; // total perpendicular spread (viewBox units) across a pair
const FAN_SPREAD = 0.16; // half-range of the (secondary) curve fan
const LONE_CURVE = 0.12; // lone line: gentle bow magnitude

let _dashLogged = false;

/**
 * FNV-1a string hash → unsigned 32-bit int (deterministic across repaints).
 * @param {string} text
 * @returns {number}
 */
function hashStr(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Sorted undirected pair key for an edge ("min|max").
 * @param {Edge} edge
 * @returns {string}
 */
function pairKey(edge) {
  return Number(edge.a) < Number(edge.b) ? edge.a + "|" + edge.b : edge.b + "|" + edge.a;
}

/**
 * Even spread of slot `i` of `groupSize` across [-half, +half]; 0 when alone.
 * @param {number} i Index within the group.
 * @param {number} groupSize
 * @param {number} half
 * @returns {number}
 */
function evenSpread(i, groupSize, half) {
  return groupSize > 1 ? (i / (groupSize - 1) - 0.5) * 2 * half : 0;
}

/**
 * Signed curve fraction (chord-length fraction). Grouped edges fan evenly; a lone
 * edge bows gently to a hash-chosen side so different pairs vary.
 * @param {Edge} edge
 * @param {number} i Index within the group.
 * @param {number} groupSize
 * @returns {number} Signed bow as a fraction of chord length.
 */
function signedCurveFor(edge, i, groupSize) {
  if (groupSize > 1) return evenSpread(i, groupSize, FAN_SPREAD);
  return (hashStr(pairKey(edge)) & 1 ? 1 : -1) * LONE_CURVE;
}

/**
 * Group edges by undirected pair so a pair carrying multiple relationships can
 * be drawn as parallel offset lines. Drops edges whose endpoints aren't both
 * positioned.
 * @param {Edge[]} edges
 * @param {Map<number, {x: number, y: number}>} positions
 * @returns {Map<string, EdgeGeo[]>} Edge groups keyed by sorted pair.
 */
export function groupEdgesByPair(edges, positions) {
  /** @type {Map<string, EdgeGeo[]>} */
  const edgeGroups = new Map();
  for (const edge of edges) {
    const fromPos = positions.get(edge.a);
    const toPos = positions.get(edge.b);
    if (!fromPos || !toPos) continue;
    // Key by geometric endpoints, not pids: two ties between the same two nodes
    // always land in one group (a string-vs-number pid mismatch would otherwise
    // split them into two lone curves drawn on top of each other).
    const key = geoPairKey(fromPos, toPos);
    let group = edgeGroups.get(key);
    if (!group) {
      group = [];
      edgeGroups.set(key, group);
    }
    group.push({ e: edge, pa: fromPos, pb: toPos });
  }
  return edgeGroups;
}

/**
 * Order-independent geometric key for an endpoint pair (rounded so float jitter
 * can't split a pair).
 * @param {{x: number, y: number}} fromPos
 * @param {{x: number, y: number}} toPos
 * @returns {string}
 */
function geoPairKey(fromPos, toPos) {
  const round2 = (/** @type {number} */ value) => Math.round(value * 100) / 100;
  const fromKey = round2(fromPos.x) + "," + round2(fromPos.y);
  const toKey = round2(toPos.x) + "," + round2(toPos.y);
  return fromKey < toKey ? fromKey + "|" + toKey : toKey + "|" + fromKey;
}

// Edges render as bowed quadratic-bezier ARCS (chord-diagram style) so overlapping
// lines between crowded nodes separate and the diagram reads cleaner.
/**
 * Build the quadratic-bezier control geometry for an edge between two points,
 * bowed by a signed fraction of the chord length (sign = which side it bows).
 * @param {{x: number, y: number}} p0
 * @param {{x: number, y: number}} p1
 * @param {number} frac Signed bow as a fraction of chord length.
 * @returns {{p0: *, c: *, p1: *, len: number}}
 */
function curveOf(p0, p1, frac) {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const perpX = -dy / len;
  const perpY = dx / len;
  const bow = frac * len;
  const control = { x: (p0.x + p1.x) / 2 + perpX * bow, y: (p0.y + p1.y) / 2 + perpY * bow };
  return { p0, c: control, p1, len };
}

/**
 * Pull a chord's endpoints inward to each node's circle edge (radius + gap) so a
 * line terminates at the ring around a leader, not at the icon center. Trim is
 * clamped to keep a visible middle on short (crowded) chords.
 * @param {{x: number, y: number}} fromPos
 * @param {{x: number, y: number}} toPos
 * @param {number} fromRadius
 * @param {number} toRadius
 * @returns {{a: {x: number, y: number}, b: {x: number, y: number}}} Trimmed endpoints.
 */
function trimChord(fromPos, toPos, fromRadius, toRadius) {
  const dx = toPos.x - fromPos.x;
  const dy = toPos.y - fromPos.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const cap = len * 0.42;
  const fromTrim = Math.min(fromRadius + ENDPOINT_GAP, cap);
  const toTrim = Math.min(toRadius + ENDPOINT_GAP, cap);
  return {
    a: { x: fromPos.x + ux * fromTrim, y: fromPos.y + uy * fromTrim },
    b: { x: toPos.x - ux * toTrim, y: toPos.y - uy * toTrim }
  };
}

/**
 * Point on the quadratic bezier at parameter s∈[0,1].
 * @param {{p0: *, c: *, p1: *}} curve
 * @param {number} s
 * @returns {{x: number, y: number}}
 */
function quadPoint(curve, s) {
  const u = 1 - s;
  return {
    x: u * u * curve.p0.x + 2 * u * s * curve.c.x + s * s * curve.p1.x,
    y: u * u * curve.p0.y + 2 * u * s * curve.c.y + s * s * curve.p1.y
  };
}

/**
 * Tangent (derivative) of the quadratic bezier at parameter s (points toward p1).
 * @param {{p0: *, c: *, p1: *}} curve
 * @param {number} s
 * @returns {{x: number, y: number}}
 */
function quadTangent(curve, s) {
  return {
    x: 2 * (1 - s) * (curve.c.x - curve.p0.x) + 2 * s * (curve.p1.x - curve.c.x),
    y: 2 * (1 - s) * (curve.c.y - curve.p0.y) + 2 * s * (curve.p1.y - curve.c.y)
  };
}

/**
 * Append one straight solid sub-segment as a `<line>` (used for dash runs and
 * chevron wings). `extra` optionally adds an animation class + per-element delay
 * (for the flowing-chevron effect on directed edges).
 * @param {Element} svg
 * @param {string} color Stroke color.
 * @param {{x1: number, y1: number, x2: number, y2: number, opacity?: number}} pts
 *   Segment endpoints and (optional) stroke opacity.
 */
function appendDashSeg(svg, color, pts) {
  const seg = document.createElementNS(SVG_NS, "line");
  seg.setAttribute("x1", String(pts.x1));
  seg.setAttribute("y1", String(pts.y1));
  seg.setAttribute("x2", String(pts.x2));
  seg.setAttribute("y2", String(pts.y2));
  seg.setAttribute("stroke", color);
  seg.setAttribute("stroke-width", STROKE_W);
  seg.setAttribute("stroke-opacity", String(typeof pts.opacity === "number" ? pts.opacity : 0.9));
  seg.setAttribute("stroke-linecap", "round");
  seg.setAttribute("class", "demographics-relations-line");
  svg.appendChild(seg);
}

/**
 * Append one small filled dot (`<circle>`), the unit of a dotted line.
 * @param {Element} svg
 * @param {string} color
 * @param {{x: number, y: number}} point
 * @param {number} opacity
 */
function appendDot(svg, color, point, opacity) {
  const dot = document.createElementNS(SVG_NS, "circle");
  dot.setAttribute("cx", String(point.x));
  dot.setAttribute("cy", String(point.y));
  dot.setAttribute("r", "0.34");
  dot.setAttribute("fill", color);
  dot.setAttribute("fill-opacity", String(opacity));
  dot.setAttribute("class", "demographics-relations-line");
  svg.appendChild(dot);
}

/**
 * Log the dashed-edge-synthesis note once per session (Coherent ignores
 * stroke-dasharray, so we hand-synthesize dashes along the curve).
 * @param {Edge} e
 * @param {string} dash The dash pattern string.
 */
function logDashOnce(e, dash) {
  if (_dashLogged) return;
  log.debug("dashed edge synth: filterKey=" + (e.filterKey || "(none)") + " pattern='" + dash + "'");
  _dashLogged = true;
}

/**
 * Append a solid curved edge as a single quadratic `<path>`.
 * @param {Element} svg
 * @param {Edge} edge
 * @param {{p0: *, c: *, p1: *}} curve
 * @param {number} opacity
 */
function appendSolidCurve(svg, edge, curve, opacity) {
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute(
    "d",
    "M " + curve.p0.x + " " + curve.p0.y +
      " Q " + curve.c.x + " " + curve.c.y + " " + curve.p1.x + " " + curve.p1.y
  );
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", edge.color || "#bfbfbf");
  path.setAttribute("stroke-width", STROKE_W);
  path.setAttribute("stroke-opacity", String(opacity));
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("class", "demographics-relations-line");
  svg.appendChild(path);
}

// Canonical dash + dot metrics (viewBox units): one clean dash pattern and one
// clean dot spacing, a tiny reliable vocabulary.
const DASH_ON = 2.0;
const DASH_OFF = 1.8;
const DOT_SPACING = 2.3;

/**
 * Render a dashed curved edge: sample the bezier finely and emit a `<line>` for
 * each step whose midpoint falls in an "on" run of the fixed dash cycle.
 * @param {Element} svg
 * @param {Edge} edge
 * @param {{p0: *, c: *, p1: *, len: number}} curve
 * @param {number} opacity
 */
function appendDashedCurve(svg, edge, curve, opacity) {
  logDashOnce(edge, "dashed");
  const color = edge.color || "#bfbfbf";
  const cycle = DASH_ON + DASH_OFF;
  const steps = Math.max(32, Math.min(200, Math.round(curve.len / 0.35)));
  let prev = quadPoint(curve, 0);
  let travelled = 0;
  for (let i = 1; i <= steps; i++) {
    const pt = quadPoint(curve, i / steps);
    const segLen = Math.sqrt((pt.x - prev.x) ** 2 + (pt.y - prev.y) ** 2);
    if ((travelled + segLen / 2) % cycle < DASH_ON) {
      appendDashSeg(svg, color, { x1: prev.x, y1: prev.y, x2: pt.x, y2: pt.y, opacity });
    }
    travelled += segLen;
    prev = pt;
  }
}

/**
 * Render a dotted curved edge: walk the bezier by arc length and drop a small
 * `<circle>` at every DOT_SPACING (crisp, evenly-spaced dots; far more reliable
 * than trying to coax round dots out of the dash synthesizer).
 * @param {Element} svg
 * @param {Edge} edge
 * @param {{p0: *, c: *, p1: *, len: number}} curve
 * @param {number} opacity
 */
function appendDottedCurve(svg, edge, curve, opacity) {
  const color = edge.color || "#bfbfbf";
  const steps = Math.max(48, Math.min(300, Math.round(curve.len / 0.25)));
  let prev = quadPoint(curve, 0);
  let travelled = 0;
  let nextDotAt = DOT_SPACING / 2;
  for (let i = 1; i <= steps; i++) {
    const pt = quadPoint(curve, i / steps);
    travelled += Math.sqrt((pt.x - prev.x) ** 2 + (pt.y - prev.y) ** 2);
    if (travelled >= nextDotAt) {
      appendDot(svg, color, pt, opacity);
      nextDotAt += DOT_SPACING;
    }
    prev = pt;
  }
}

/**
 * Dispatch a non-directed edge to the right renderer for its style token.
 * @param {Element} svg
 * @param {Edge} edge
 * @param {{p0: *, c: *, p1: *, len: number}} curve
 * @param {string} style Style token ("" solid / "dashed" / "dotted").
 * @param {number} opacity
 */
function appendStyledCurve(svg, edge, curve, style, opacity) {
  if (style === "dashed") appendDashedCurve(svg, edge, curve, opacity);
  else if (style === "dotted") appendDottedCurve(svg, edge, curve, opacity);
  else appendSolidCurve(svg, edge, curve, opacity);
}

// Chevron geometry: a ">" mark whose wings sweep back from the curve point,
// opening away from the target so it reads as an arrow pointing at b.
const CHEVRON_SIZE = 1.1; // viewBox units
const CHEVRON_ANGLE = 0.62; // radians, wing half-spread
const CHEVRON_PARAMS = [0.42, 0.62]; // parameters along the curve to place chevrons at

/**
 * Append one direction chevron at parameter s, pointing along the tangent (→ b).
 * @param {Element} svg
 * @param {string} color Stroke color.
 * @param {{p0: *, c: *, p1: *}} curve
 * @param {number} s
 * @param {number} opacity
 */
function appendOneChevron(svg, color, curve, s, opacity) {
  const tip = quadPoint(curve, s);
  const tan = quadTangent(curve, s);
  const tanLen = Math.sqrt(tan.x * tan.x + tan.y * tan.y) || 1;
  const backX = -tan.x / tanLen;
  const backY = -tan.y / tanLen; // back-along-tangent unit (wings open backward)
  const cos = Math.cos(CHEVRON_ANGLE);
  const sin = Math.sin(CHEVRON_ANGLE);
  const size = CHEVRON_SIZE;
  const wing1 = {
    x: tip.x + (backX * cos - backY * sin) * size,
    y: tip.y + (backX * sin + backY * cos) * size
  };
  const wing2 = {
    x: tip.x + (backX * cos + backY * sin) * size,
    y: tip.y + (-backX * sin + backY * cos) * size
  };
  appendDashSeg(svg, color, { x1: wing1.x, y1: wing1.y, x2: tip.x, y2: tip.y, opacity });
  appendDashSeg(svg, color, { x1: wing2.x, y1: wing2.y, x2: tip.x, y2: tip.y, opacity });
}

/**
 * Append static direction chevrons along a directed edge's curve (a → b).
 * @param {Element} svg
 * @param {Edge} edge
 * @param {{p0: *, c: *, p1: *}} curve
 * @param {number} opacity
 */
function appendChevrons(svg, edge, curve, opacity) {
  const color = edge.color || "#bfbfbf";
  for (const param of CHEVRON_PARAMS) appendOneChevron(svg, color, curve, param, opacity);
}

/**
 * Canonical orientation sign for an endpoint pair: +1 when a→b runs in the pair's
 * sorted (min→max) direction, −1 otherwise, so a pair's lane offset + curve bow
 * use a consistent perpendicular regardless of each edge's own a→b order.
 * @param {{x: number, y: number}} fromPt Endpoint a.
 * @param {{x: number, y: number}} toPt Endpoint b.
 * @returns {number} +1 or −1.
 */
function canonicalSign(fromPt, toPt) {
  if (fromPt.x !== toPt.x) return fromPt.x < toPt.x ? 1 : -1;
  return fromPt.y <= toPt.y ? 1 : -1;
}

/**
 * Slide a chord sideways (perpendicular) by `offset` viewBox units: the primary way
 * a pair's lines are kept apart along their whole length.
 * @param {{x: number, y: number}} fromPt Endpoint a.
 * @param {{x: number, y: number}} toPt Endpoint b.
 * @param {number} offset
 * @returns {{a: {x: number, y: number}, b: {x: number, y: number}}} Shifted endpoints.
 */
function offsetChord(fromPt, toPt, offset) {
  if (!offset) return { a: fromPt, b: toPt };
  const dx = toPt.x - fromPt.x;
  const dy = toPt.y - fromPt.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const offsetX = (-dy / len) * offset;
  const offsetY = (dx / len) * offset;
  return {
    a: { x: fromPt.x + offsetX, y: fromPt.y + offsetY },
    b: { x: toPt.x + offsetX, y: toPt.y + offsetY }
  };
}

/**
 * Render one edge of a pair-group: trim it to the two node circles, slide it
 * sideways by its perpendicular offset, bow it by its curve fraction, then draw
 * it (directed edges solid with chevrons; others per their style).
 * @param {Element} svg
 * @param {EdgeGeo} entry
 * @param {{ frac: number, perpOff: number, opacity: number, radii: ?Map<number, number>,
 *   records: ?EdgeRecord[] }} cfg Per-edge config (curve, lane offset, opacity, radii, records).
 */
function renderGroupEdge(svg, entry, cfg) {
  const { e: edge, pa: fromPos, pb: toPos } = entry;
  const fromRadius = (cfg.radii && cfg.radii.get(edge.a)) || DEFAULT_NODE_R;
  const toRadius = (cfg.radii && cfg.radii.get(edge.b)) || DEFAULT_NODE_R;
  const trimmed = trimChord(fromPos, toPos, fromRadius, toRadius);
  // Offset + bow on the pair's canonical perpendicular (see canonicalSign), so two
  // ties between the same nodes always land in different lanes regardless of which
  // way each edge's a→b happens to point.
  const orient = canonicalSign(trimmed.a, trimmed.b);
  const lane = offsetChord(trimmed.a, trimmed.b, cfg.perpOff * orient);
  const curve = curveOf(lane.a, lane.b, cfg.frac * orient);

  // Each edge is its own <g> so the hover hit-test can highlight all of its pieces
  // at once (a dashed/dotted line is many sub-elements) by toggling .is-hovered.
  const edgeGroup = document.createElementNS(SVG_NS, "g");
  edgeGroup.setAttribute("class", "demographics-relations-edge");
  if (edge.directed) {
    appendSolidCurve(edgeGroup, edge, curve, cfg.opacity);
    appendChevrons(edgeGroup, edge, curve, cfg.opacity);
  } else {
    appendStyledCurve(edgeGroup, edge, curve, dasharrayFor(edge), cfg.opacity);
  }
  svg.appendChild(edgeGroup);
  // Record sampled geometry + label so the HTML-level hover (in relations-ring-svg
  // .js) can find/highlight this edge. SVG elements don't receive mouse events in
  // Coherent, so hover is driven from the HTML wrap via a nearest-edge hit test.
  if (cfg.records) {
    cfg.records.push({
      g: edgeGroup,
      label: edge._typeLabel || prettyKey(edge.filterKey),
      pts: sampleCurve(curve)
    });
  }
}

/**
 * Sample a curve into points (viewBox coords) for the hover distance test.
 * @param {{p0: *, c: *, p1: *}} curve
 * @returns {{x: number, y: number}[]}
 */
function sampleCurve(curve) {
  /** @type {{x: number, y: number}[]} */
  const pts = [];
  const segments = 14;
  for (let i = 0; i <= segments; i++) pts.push(quadPoint(curve, i / segments));
  return pts;
}

/**
 * Prettify a filter key into a fallback label ("open_borders" → "Open Borders").
 * @param {string} [key]
 * @returns {string}
 */
function prettyKey(key) {
  if (!key) return "";
  return key.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * Render one pair's group of edges so they never overlap: each line is slid to its
 * own perpendicular lane (even spread across the pair) and given a varied curve, so
 * the lines stay distinct along their whole length and bend in both directions.
 * @param {Element} svg
 * @param {EdgeGeo[]} entries The grouped edges for this pair.
 * @param {Set<number>|null} [selectedSet] Active selection; edges that touch no
 *   selected node are dimmed (click-to-focus). Null/absent = all full strength.
 * @param {Map<number, number>|null} [radii] Node radii (viewBox units) for trimming.
 * @param {EdgeRecord[]|null} [records] Collector for per-edge hover geometry.
 */
export function appendEdgeGroup(svg, entries, selectedSet, radii, records) {
  const groupSize = entries.length;
  entries.forEach((entry, i) => {
    const edge = entry.e;
    const frac = signedCurveFor(edge, i, groupSize);
    const perpOff = evenSpread(i, groupSize, PAIR_OFFSET / 2);
    const dimmed = !!(selectedSet && !(selectedSet.has(edge.a) || selectedSet.has(edge.b)));
    const opacity = dimmed ? 0.1 : 0.82;
    const cfg = { frac, perpOff, opacity, radii: radii || null, records: records || null };
    renderGroupEdge(svg, entry, cfg);
  });
}

/**
 * Draw a single straight sample edge into an SVG with the same style code and
 * viewBox units the ring uses, so a legend swatch is a miniature of the line it labels.
 * @param {Element} svg Target SVG (its viewBox units must match the line units).
 * @param {{ color: string, dash?: string, directed?: boolean }} sample The style
 *   (`dash` is a style token: "" solid / "dashed" / "dotted").
 * @param {{ x: number, y: number }} p0 Start point (viewBox units).
 * @param {{ x: number, y: number }} p1 End point (viewBox units).
 */
export function appendSampleEdge(svg, sample, p0, p1) {
  const edge = /** @type {*} */ ({ color: sample.color || "#bfbfbf", directed: !!sample.directed });
  const len = Math.sqrt((p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2) || 1;
  const curve = { p0, c: { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }, p1, len };
  if (edge.directed) {
    appendSolidCurve(svg, edge, curve, 0.95);
    appendChevrons(svg, edge, curve, 0.95);
    return;
  }
  appendStyledCurve(svg, edge, curve, sample.dash || "", 0.95);

}