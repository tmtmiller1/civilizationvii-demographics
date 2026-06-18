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
 * @property {Edge} e The edge.
 * @property {{x: number, y: number}} pa Source position (viewBox coords).
 * @property {{x: number, y: number}} pb Target position (viewBox coords).
 */

const SVG_NS = "http://www.w3.org/2000/svg";

// Line weight (viewBox units). Thinner than the old 0.6 so the ring reads as fine
// connectors rather than crayon strokes.
const STROKE_W = "0.4";

// Endpoint trim: lines stop at the node's CIRCLE (radius + small gap) instead of
// plunging into the leader icon at the center, which de-clutters the hubs.
const ENDPOINT_GAP = 0.7; // viewBox units beyond the node radius
const DEFAULT_NODE_R = 5; // fallback radius when a node's radius is unknown

// Separating the lines of a pair. The PRIMARY separator is a PERPENDICULAR OFFSET
// that slides each line sideways off the chord , this keeps the lines apart along
// their ENTIRE length (a curve-only fan converges back together at the endpoints,
// which is why two ties could still sit on top of each other near the nodes). A
// gentle curve, varied in direction, is layered on top for readability + the
// "bend both ways" look. Both quantities spread EVENLY across a bounded range so
// any number of coexisting lines (2 or 13) stay distinct without blowing up.
const PAIR_OFFSET = 4.4; // total perpendicular spread (viewBox units) across a pair
const FAN_SPREAD = 0.16; // half-range of the (secondary) curve fan
const LONE_CURVE = 0.12; // lone line: gentle bow magnitude

let _dashLogged = false;

/**
 * FNV-1a string hash → unsigned 32-bit int (deterministic across repaints).
 * @param {string} s Input string.
 * @returns {number} Hash value.
 */
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Sorted undirected pair key for an edge ("min|max").
 * @param {Edge} e The edge.
 * @returns {string} The pair key.
 */
function pairKey(e) {
  return Number(e.a) < Number(e.b) ? e.a + "|" + e.b : e.b + "|" + e.a;
}

/**
 * Even spread of slot `i` of `n` across [-half, +half]; 0 when alone.
 * @param {number} i Index within the group.
 * @param {number} n Group size.
 * @param {number} half Half-range.
 * @returns {number} The spread value.
 */
function evenSpread(i, n, half) {
  return n > 1 ? (i / (n - 1) - 0.5) * 2 * half : 0;
}

/**
 * Signed curve fraction (chord-length fraction). Grouped edges fan evenly; a lone
 * edge bows gently to a hash-chosen side so different pairs vary.
 * @param {Edge} e The edge.
 * @param {number} i Index within the group.
 * @param {number} n Group size.
 * @returns {number} Signed bow as a fraction of chord length.
 */
function signedCurveFor(e, i, n) {
  if (n > 1) return evenSpread(i, n, FAN_SPREAD);
  return (hashStr(pairKey(e)) & 1 ? 1 : -1) * LONE_CURVE;
}

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
    // Key by GEOMETRIC endpoints, not pids. Two ties between the same two nodes
    // resolve to the same two points, so they ALWAYS land in one group (and thus
    // get separate lanes). Keying by pid let a string-vs-number pid , or any other
    // representation mismatch between engine queries , split one visual pair into
    // two single-edge groups, which then drew on the identical lone curve.
    const key = geoPairKey(pa, pb);
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
 * Order-independent geometric key for an endpoint pair (rounded so float jitter
 * can't split a pair).
 * @param {{x: number, y: number}} pa First endpoint.
 * @param {{x: number, y: number}} pb Second endpoint.
 * @returns {string} The pair key.
 */
function geoPairKey(pa, pb) {
  const r = (/** @type {number} */ v) => Math.round(v * 100) / 100;
  const A = r(pa.x) + "," + r(pa.y);
  const B = r(pb.x) + "," + r(pb.y);
  return A < B ? A + "|" + B : B + "|" + A;
}

// Edges render as bowed quadratic-bezier ARCS (chord-diagram style) so overlapping
// lines between crowded nodes separate and the diagram reads cleaner.
/**
 * Build the quadratic-bezier control geometry for an edge between two points,
 * bowed by a signed fraction of the chord length (sign = which side it bows).
 * @param {{x: number, y: number}} p0 Start point.
 * @param {{x: number, y: number}} p1 End point.
 * @param {number} frac Signed bow as a fraction of chord length.
 * @returns {{p0: *, c: *, p1: *, len: number}} Curve descriptor.
 */
function curveOf(p0, p1, frac) {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  const k = frac * len;
  const c = { x: (p0.x + p1.x) / 2 + px * k, y: (p0.y + p1.y) / 2 + py * k };
  return { p0, c, p1, len };
}

/**
 * Pull a chord's endpoints inward to each node's circle edge (radius + gap) so a
 * line terminates at the ring around a leader, not at the icon center. Trim is
 * clamped to keep a visible middle on short (crowded) chords.
 * @param {{x: number, y: number}} pa Source center.
 * @param {{x: number, y: number}} pb Target center.
 * @param {number} ra Source node radius.
 * @param {number} rb Target node radius.
 * @returns {{a: {x: number, y: number}, b: {x: number, y: number}}} Trimmed endpoints.
 */
function trimChord(pa, pb, ra, rb) {
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const cap = len * 0.42;
  const ta = Math.min(ra + ENDPOINT_GAP, cap);
  const tb = Math.min(rb + ENDPOINT_GAP, cap);
  return {
    a: { x: pa.x + ux * ta, y: pa.y + uy * ta },
    b: { x: pb.x - ux * tb, y: pb.y - uy * tb }
  };
}

/**
 * Point on the quadratic bezier at parameter s∈[0,1].
 * @param {{p0: *, c: *, p1: *}} q Curve descriptor.
 * @param {number} s Parameter.
 * @returns {{x: number, y: number}} The point.
 */
function quadPoint(q, s) {
  const u = 1 - s;
  return {
    x: u * u * q.p0.x + 2 * u * s * q.c.x + s * s * q.p1.x,
    y: u * u * q.p0.y + 2 * u * s * q.c.y + s * s * q.p1.y
  };
}

/**
 * Tangent (derivative) of the quadratic bezier at parameter s (points toward p1).
 * @param {{p0: *, c: *, p1: *}} q Curve descriptor.
 * @param {number} s Parameter.
 * @returns {{x: number, y: number}} The tangent vector.
 */
function quadTangent(q, s) {
  return {
    x: 2 * (1 - s) * (q.c.x - q.p0.x) + 2 * s * (q.p1.x - q.c.x),
    y: 2 * (1 - s) * (q.c.y - q.p0.y) + 2 * s * (q.p1.y - q.c.y)
  };
}

/**
 * Append one straight solid sub-segment as a `<line>` (used for dash runs and
 * chevron wings). `extra` optionally adds an animation class + per-element delay
 * (for the flowing-chevron effect on directed edges).
 * @param {Element} svg The SVG root.
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
 * Append one small filled dot (`<circle>`) , the unit of a dotted line.
 * @param {Element} svg The SVG root.
 * @param {string} color Fill color.
 * @param {{x: number, y: number}} p Center.
 * @param {number} opacity Fill opacity.
 */
function appendDot(svg, color, p, opacity) {
  const c = document.createElementNS(SVG_NS, "circle");
  c.setAttribute("cx", String(p.x));
  c.setAttribute("cy", String(p.y));
  c.setAttribute("r", "0.34");
  c.setAttribute("fill", color);
  c.setAttribute("fill-opacity", String(opacity));
  c.setAttribute("class", "demographics-relations-line");
  svg.appendChild(c);
}

/**
 * Log the dashed-edge-synthesis note once per session (Coherent ignores
 * stroke-dasharray, so we hand-synthesize dashes along the curve).
 * @param {Edge} e The edge.
 * @param {string} dash The dash pattern string.
 */
function logDashOnce(e, dash) {
  if (_dashLogged) return;
  dlog("dashed edge synth: filterKey=" + (e.filterKey || "(none)") + " pattern='" + dash + "'");
  _dashLogged = true;
}

/**
 * Append a solid curved edge as a single quadratic `<path>`.
 * @param {Element} svg The SVG root.
 * @param {Edge} e The edge.
 * @param {{p0: *, c: *, p1: *}} q Curve descriptor.
 * @param {number} opacity Stroke opacity.
 */
function appendSolidCurve(svg, e, q, opacity) {
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute(
    "d",
    "M " + q.p0.x + " " + q.p0.y + " Q " + q.c.x + " " + q.c.y + " " + q.p1.x + " " + q.p1.y
  );
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", e.color || "#bfbfbf");
  path.setAttribute("stroke-width", STROKE_W);
  path.setAttribute("stroke-opacity", String(opacity));
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("class", "demographics-relations-line");
  svg.appendChild(path);
}

// Canonical dash + dot metrics (viewBox units). One clean dash pattern and one
// clean dot spacing , the whole point of (2) is a tiny, reliable vocabulary.
const DASH_ON = 2.0;
const DASH_OFF = 1.8;
const DOT_SPACING = 2.3;

/**
 * Render a DASHED curved edge: sample the bezier finely and emit a `<line>` for
 * each step whose midpoint falls in an "on" run of the fixed dash cycle.
 * @param {Element} svg The SVG root.
 * @param {Edge} e The edge.
 * @param {{p0: *, c: *, p1: *, len: number}} q Curve descriptor.
 * @param {number} opacity Stroke opacity.
 */
function appendDashedCurve(svg, e, q, opacity) {
  logDashOnce(e, "dashed");
  const color = e.color || "#bfbfbf";
  const cycle = DASH_ON + DASH_OFF;
  const steps = Math.max(32, Math.min(200, Math.round(q.len / 0.35)));
  let prev = quadPoint(q, 0);
  let acc = 0;
  for (let i = 1; i <= steps; i++) {
    const pt = quadPoint(q, i / steps);
    const segLen = Math.sqrt((pt.x - prev.x) ** 2 + (pt.y - prev.y) ** 2);
    if ((acc + segLen / 2) % cycle < DASH_ON) {
      appendDashSeg(svg, color, { x1: prev.x, y1: prev.y, x2: pt.x, y2: pt.y, opacity });
    }
    acc += segLen;
    prev = pt;
  }
}

/**
 * Render a DOTTED curved edge: walk the bezier by arc length and drop a small
 * `<circle>` at every DOT_SPACING (crisp, evenly-spaced dots , far more reliable
 * than trying to coax round dots out of the dash synthesizer).
 * @param {Element} svg The SVG root.
 * @param {Edge} e The edge.
 * @param {{p0: *, c: *, p1: *, len: number}} q Curve descriptor.
 * @param {number} opacity Fill opacity.
 */
function appendDottedCurve(svg, e, q, opacity) {
  const color = e.color || "#bfbfbf";
  const steps = Math.max(48, Math.min(300, Math.round(q.len / 0.25)));
  let prev = quadPoint(q, 0);
  let acc = 0;
  let next = DOT_SPACING / 2;
  for (let i = 1; i <= steps; i++) {
    const pt = quadPoint(q, i / steps);
    acc += Math.sqrt((pt.x - prev.x) ** 2 + (pt.y - prev.y) ** 2);
    if (acc >= next) {
      appendDot(svg, color, pt, opacity);
      next += DOT_SPACING;
    }
    prev = pt;
  }
}

/**
 * Dispatch a non-directed edge to the right renderer for its style token.
 * @param {Element} svg The SVG root.
 * @param {Edge} e The edge.
 * @param {{p0: *, c: *, p1: *, len: number}} q Curve descriptor.
 * @param {string} style Style token ("" solid / "dashed" / "dotted").
 * @param {number} opacity Stroke/fill opacity.
 */
function appendStyledCurve(svg, e, q, style, opacity) {
  if (style === "dashed") appendDashedCurve(svg, e, q, opacity);
  else if (style === "dotted") appendDottedCurve(svg, e, q, opacity);
  else appendSolidCurve(svg, e, q, opacity);
}

// Chevron geometry: a ">" mark whose wings sweep back from the curve point,
// opening away from the target so it reads as an arrow pointing at b.
const CHEVRON_SIZE = 1.1; // viewBox units (slimmed to match the thinner lines)
const CHEVRON_ANGLE = 0.62; // radians, wing half-spread
const CHEVRON_S = [0.42, 0.62]; // parameters along the curve to place chevrons at

/**
 * Append one direction chevron at parameter s, pointing along the tangent (→ b).
 * @param {Element} svg The SVG root.
 * @param {string} color Stroke color.
 * @param {{p0: *, c: *, p1: *}} q Curve descriptor.
 * @param {number} s Parameter along the curve.
 * @param {number} opacity Stroke opacity.
 */
function appendOneChevron(svg, color, q, s, opacity) {
  const p = quadPoint(q, s);
  const tan = quadTangent(q, s);
  const tl = Math.sqrt(tan.x * tan.x + tan.y * tan.y) || 1;
  const bx = -tan.x / tl;
  const by = -tan.y / tl; // back-along-tangent unit (wings open backward)
  const cos = Math.cos(CHEVRON_ANGLE);
  const sin = Math.sin(CHEVRON_ANGLE);
  const sz = CHEVRON_SIZE;
  const w1 = { x: p.x + (bx * cos - by * sin) * sz, y: p.y + (bx * sin + by * cos) * sz };
  const w2 = { x: p.x + (bx * cos + by * sin) * sz, y: p.y + (-bx * sin + by * cos) * sz };
  appendDashSeg(svg, color, { x1: w1.x, y1: w1.y, x2: p.x, y2: p.y, opacity });
  appendDashSeg(svg, color, { x1: w2.x, y1: w2.y, x2: p.x, y2: p.y, opacity });
}

/**
 * Append static direction chevrons along a directed edge's curve (a → b).
 * @param {Element} svg The SVG root.
 * @param {Edge} e The edge.
 * @param {{p0: *, c: *, p1: *}} q Curve descriptor.
 * @param {number} opacity Stroke opacity.
 */
function appendChevrons(svg, e, q, opacity) {
  const color = e.color || "#bfbfbf";
  for (const s of CHEVRON_S) appendOneChevron(svg, color, q, s, opacity);
}

/**
 * Canonical orientation sign for an endpoint pair: +1 when a→b runs in the pair's
 * sorted (min→max) direction, −1 otherwise. Used so a pair's lane offset + curve
 * bow are computed on a CONSISTENT perpendicular regardless of each edge's own a→b
 * order. Without this, two ties built with opposite a/b order (e.g. an attitude
 * edge vs an event-scan edge) flip the perpendicular and their symmetric offsets
 * cancel , landing both lines in the same lane.
 * @param {{x: number, y: number}} a Endpoint a.
 * @param {{x: number, y: number}} b Endpoint b.
 * @returns {number} +1 or −1.
 */
function canonicalSign(a, b) {
  if (a.x !== b.x) return a.x < b.x ? 1 : -1;
  return a.y <= b.y ? 1 : -1;
}

/**
 * Slide a chord sideways (perpendicular) by `off` viewBox units , the primary way
 * a pair's lines are kept apart along their whole length.
 * @param {{x: number, y: number}} a Endpoint a.
 * @param {{x: number, y: number}} b Endpoint b.
 * @param {number} off Perpendicular offset.
 * @returns {{a: {x: number, y: number}, b: {x: number, y: number}}} Shifted endpoints.
 */
function offsetChord(a, b, off) {
  if (!off) return { a, b };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ox = (-dy / len) * off;
  const oy = (dx / len) * off;
  return { a: { x: a.x + ox, y: a.y + oy }, b: { x: b.x + ox, y: b.y + oy } };
}

/**
 * Render one edge of a pair-group: trim it to the two node circles, slide it
 * sideways by its perpendicular offset (so it never sits on top of a sibling),
 * bow it by its curve fraction, then draw it. Directed edges draw SOLID with
 * arrow chevrons; others draw solid / dashed / dotted per their style.
 * @param {Element} svg The SVG root.
 * @param {EdgeGeo} entry The grouped edge.
 * @param {{ frac: number, perpOff: number, opacity: number, radii: ?Map<number, number>,
 *   records: ?EdgeRecord[] }} cfg Per-edge config (curve, lane offset, opacity, radii, records).
 */
function renderGroupEdge(svg, entry, cfg) {
  const { e, pa, pb } = entry;
  const ra = (cfg.radii && cfg.radii.get(e.a)) || DEFAULT_NODE_R;
  const rb = (cfg.radii && cfg.radii.get(e.b)) || DEFAULT_NODE_R;
  const trimmed = trimChord(pa, pb, ra, rb);
  // Offset + bow on the pair's canonical perpendicular (see canonicalSign), so two
  // ties between the same nodes always land in DIFFERENT lanes regardless of which
  // way each edge's a→b happens to point.
  const orient = canonicalSign(trimmed.a, trimmed.b);
  const { a, b } = offsetChord(trimmed.a, trimmed.b, cfg.perpOff * orient);
  const q = curveOf(a, b, cfg.frac * orient);

  // Each edge is its own <g> so the hover hit-test can highlight ALL of its pieces
  // at once (a dashed/dotted line is many sub-elements) by toggling .is-hovered.
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "demographics-relations-edge");
  if (e.directed) {
    appendSolidCurve(g, e, q, cfg.opacity);
    appendChevrons(g, e, q, cfg.opacity);
  } else {
    appendStyledCurve(g, e, q, dasharrayFor(e), cfg.opacity);
  }
  svg.appendChild(g);
  // Record sampled geometry + label so the HTML-level hover (in relations-ring-svg
  // .js) can find/highlight this edge. SVG elements don't receive mouse events in
  // Coherent, so hover is driven from the HTML wrap via a nearest-edge hit test.
  if (cfg.records) {
    cfg.records.push({ g, label: e._typeLabel || prettyKey(e.filterKey), pts: sampleCurve(q) });
  }
}

/**
 * Sample a curve into points (viewBox coords) for the hover distance test.
 * @param {{p0: *, c: *, p1: *}} q Curve descriptor.
 * @returns {{x: number, y: number}[]} Sampled points along the curve.
 */
function sampleCurve(q) {
  /** @type {{x: number, y: number}[]} */
  const pts = [];
  const N = 14;
  for (let i = 0; i <= N; i++) pts.push(quadPoint(q, i / N));
  return pts;
}

/**
 * Prettify a filter key into a fallback label ("open_borders" → "Open Borders").
 * @param {string} [key] The filter key.
 * @returns {string} A readable label.
 */
function prettyKey(key) {
  if (!key) return "";
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Render one pair's group of edges so they never overlap: each line is slid to its
 * own perpendicular lane (even spread across the pair) AND given a varied curve, so
 * the lines stay distinct along their whole length and bend in both directions.
 * @param {Element} svg The SVG root.
 * @param {EdgeGeo[]} entries The grouped edges for this pair.
 * @param {Set<number>|null} [selectedSet] Active selection; edges that touch no
 *   selected node are dimmed (click-to-focus). Null/absent = all full strength.
 * @param {Map<number, number>|null} [radii] Node radii (viewBox units) for trimming.
 * @param {EdgeRecord[]|null} [records] Collector for per-edge hover geometry.
 */
export function appendEdgeGroup(svg, entries, selectedSet, radii, records) {
  const n = entries.length;
  entries.forEach((entry, i) => {
    const e = entry.e;
    const frac = signedCurveFor(e, i, n);
    const perpOff = evenSpread(i, n, PAIR_OFFSET / 2);
    const dimmed = !!(selectedSet && !(selectedSet.has(e.a) || selectedSet.has(e.b)));
    const opacity = dimmed ? 0.1 : 0.82;
    const cfg = { frac, perpOff, opacity, radii: radii || null, records: records || null };
    renderGroupEdge(svg, entry, cfg);
  });
}

/**
 * Draw a single straight sample edge into an SVG, using the SAME color / style
 * synthesis / chevron code (and the same viewBox units) the ring uses , so a
 * legend swatch is literally a miniature of the line it labels. Straight (control
 * point at the midpoint) to stay readable in a short swatch.
 * @param {Element} svg Target SVG (its viewBox units must match the line units).
 * @param {{ color: string, dash?: string, directed?: boolean }} sample The style
 *   (`dash` is a style token: "" solid / "dashed" / "dotted").
 * @param {{ x: number, y: number }} p0 Start point (viewBox units).
 * @param {{ x: number, y: number }} p1 End point (viewBox units).
 */
export function appendSampleEdge(svg, sample, p0, p1) {
  const e = /** @type {*} */ ({ color: sample.color || "#bfbfbf", directed: !!sample.directed });
  const len = Math.sqrt((p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2) || 1;
  const q = { p0, c: { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }, p1, len };
  if (e.directed) {
    appendSolidCurve(svg, e, q, 0.95);
    appendChevrons(svg, e, q, 0.95);
    return;
  }
  appendStyledCurve(svg, e, q, sample.dash || "", 0.95);
}