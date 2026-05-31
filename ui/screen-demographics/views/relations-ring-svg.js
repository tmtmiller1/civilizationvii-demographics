// relations-ring-svg.js
//
// SVG ring renderer for the Global Relations view: ring geometry, the edge
// drawing (solid + hand-synthesized dashed lines, since Coherent ignores
// `stroke-dasharray`), the node circles / CS discs / leader portraits, and the
// deferred pixel-space portrait-overlay placement. Split out of
// view-relations.js.
//
// Ring layout (evenly-spaced civs on a circle with an SVG <line>
// between each pair) is adapted from Sloth's Global Relations Panel
// (corpus mod 3506996826). See ui/global-relations-panel/
// global-relations-panel.js, around line 496 for the angle math and
// around line 123 for the per-pair line rendering.

import {
  dlog,
  dasharrayFor,
  hexToRgba,
  normalizeCivColor
} from "/demographics/ui/screen-demographics/views/relations-shared.js";

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
 * Per-node display info resolved from history + engine lookups. Loose at the
 * engine boundary; the renderer reads these fields off `names[pid]`.
 * @typedef {Object} NodeInfo
 * @property {string} [leaderName] Leader display name.
 * @property {string} [civName] Civilization display name.
 * @property {string} [leaderTypeString] Engine LeaderType string.
 * @property {string} [primaryColor] Civ primary color (hex/css).
 * @property {boolean} [isCityState] Whether this node is a city-state.
 * @property {string} [csName] City-state display name.
 * @property {boolean} [csMet] Whether the viewer has met this city-state.
 * @property {string|null} [csTypeKey] Resolved CS type string.
 * @property {string|null} [csTypeLabel] CS type display label.
 * @property {string|null} [csTypeColor] CS type fill/stroke color.
 * @property {string|null} [csTypeIcon] CS type icon BLP path.
 */

/**
 * A grouped edge entry: the edge plus the resolved endpoint positions.
 * @typedef {Object} EdgeGeo
 * @property {Edge} e The edge.
 * @property {{x: number, y: number}} pa Source position (viewBox coords).
 * @property {{x: number, y: number}} pb Target position (viewBox coords).
 */

/**
 * A queued portrait/icon overlay to be positioned in pixel coords once the
 * SVG has laid out.
 * @typedef {Object} PortraitPlacement
 * @property {string} kind Either "leader" or "cs-icon".
 * @property {string} [leaderType] Engine LeaderType (leader portraits).
 * @property {string} [iconUrl] BLP icon url (cs-icon overlays).
 * @property {number} vbX X position in viewBox coords.
 * @property {number} vbY Y position in viewBox coords.
 * @property {number} vbR Node radius in viewBox coords.
 */

/**
 * Computed ring geometry shared by edge + node layout.
 * @typedef {Object} RingGeometry
 * @property {number} viewBoxW ViewBox width.
 * @property {number} viewBoxH ViewBox height.
 * @property {number} cx Ring center x.
 * @property {number} cy Ring center y.
 * @property {number} rx Ellipse x-radius.
 * @property {number} ry Ellipse y-radius.
 * @property {number} density Node-density factor (0.32..1).
 * @property {Map<number, {x: number, y: number}>} positions Node positions.
 */

let _dashLogged = false;

// ---- ring layout ----------------------------------------------------------
// ADAPTED from sloth/global-relations-panel.js:496-510.

/**
 * Lay out `ids` evenly on an ellipse centered at `(cx, cy)`. Backwards-
 * compatible: `ringPositions(ids, radius)` lays out a circle on a 100×100
 * viewBox; newer callers pass `rx, ry, cx, cy`.
 * @param {number[]} ids Node ids to position.
 * @param {number} rx Ellipse x-radius.
 * @param {number} [ry] Ellipse y-radius (defaults to `rx`).
 * @param {number} [cx] Center x (defaults to 50).
 * @param {number} [cy] Center y (defaults to 50).
 * @returns {Map<number, {x: number, y: number}>} Node positions.
 */
function ringPositions(ids, rx, ry, cx, cy) {
  // Backwards-compatible: ringPositions(ids, radius) → circle on a 100×100
  // viewBox. Newer callers pass rx, ry (different) plus cx, cy to lay
  // nodes out on an ellipse centered at (cx, cy).
  if (typeof ry !== "number") ry = rx;
  if (typeof cx !== "number") cx = 50;
  if (typeof cy !== "number") cy = 50;
  const positions = new Map();
  const N = ids.length;
  if (N === 0) return positions;
  for (let i = 0; i < N; i++) {
    const angle = N === 1 ? 0 : -Math.PI / 2 + (2 * Math.PI * i) / N;
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);
    positions.set(ids[i], { x, y });
  }
  return positions;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Compute the ring's geometry (viewBox, center, radii, density, positions)
 * from the node count. Small rings are a clean circle; large rings (the CS
 * tab can pack 20+ nodes) elongate into a horizontal oval so each node keeps
 * legible arc-length.
 * @param {number[]} ringIds Ring node ids.
 * @returns {RingGeometry} The computed geometry.
 */
function computeRingGeometry(ringIds) {
  // ovalT smoothly interpolates 0..1 across the N=12..N=24 range; the
  // viewBox widens to match so the SVG uses the surrounding wider canvas.
  const N = ringIds.length;
  const ovalT = Math.max(0, Math.min(1, (N - 12) / 12));
  const viewBoxW = 100 + ovalT * 80; // 100..180
  // Grow the viewBox HEIGHT with oval mode too, so radially-placed labels
  // have headroom both above the top node AND below the bottom node.
  const viewBoxH = 100 + ovalT * 24; // 100..124
  const cx = viewBoxW / 2;
  const cy = viewBoxH / 2;

  // Ring radius scales with node count so a few civs sit close to center
  // (more space for labels) while many civs spread out to use the canvas.
  const ry = N <= 2 ? 18 : N <= 6 ? 36 : N <= 12 ? 40 : 38;
  // rx grows past ry when ovalT > 0 — the wider viewBox is what gives
  // us room for a longer X axis.
  const rx = ry + ovalT * 38; // 42..80 at max oval
  const positions = ringPositions(ringIds, rx, ry, cx, cy);

  // Density factor: 1.0 when arc-spacing per node is comfortable (≥ 22
  // SVG units), shrinking smoothly down to 0.32 when very crowded.
  const _h = Math.pow((rx - ry) / (rx + ry), 2);
  const ellipsePerim = Math.PI * (rx + ry) * (1 + (3 * _h) / (10 + Math.sqrt(4 - 3 * _h)));
  const arcSpacing = N > 0 ? ellipsePerim / N : 100;
  const density = Math.max(0.32, Math.min(1.0, arcSpacing / 22));

  return { viewBoxW, viewBoxH, cx, cy, rx, ry, density, positions };
}

/**
 * Group edges by undirected pair so a pair carrying multiple relationships can
 * be drawn as parallel offset lines. Drops edges whose endpoints aren't both
 * positioned.
 * @param {Edge[]} edges The edges to group.
 * @param {Map<number, {x: number, y: number}>} positions Node positions.
 * @returns {Map<string, EdgeGeo[]>} Edge groups keyed by sorted pair.
 */
function groupEdgesByPair(edges, positions) {
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
 * @param {{x: number, y: number}} pa Source position.
 * @param {{x: number, y: number}} pb Target position.
 * @param {number} ox Perpendicular x-offset for this slot.
 * @param {number} oy Perpendicular y-offset for this slot.
 * @returns {void}
 */
function appendSolidEdge(svg, e, pa, pb, ox, oy) {
  const line = document.createElementNS(SVG_NS, "line");
  line.setAttribute("x1", String(pa.x + ox));
  line.setAttribute("y1", String(pa.y + oy));
  line.setAttribute("x2", String(pb.x + ox));
  line.setAttribute("y2", String(pb.y + oy));
  line.setAttribute("stroke", e.color || "#bfbfbf");
  // Uniform thickness + opacity across every edge on both rings. Per-edge
  // overrides (e.width / e.opacity) are intentionally ignored — they made
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
 * @param {number} x1 Segment start x.
 * @param {number} y1 Segment start y.
 * @param {number} x2 Segment end x.
 * @param {number} y2 Segment end y.
 * @returns {void}
 */
function appendDashSeg(svg, color, x1, y1, x2, y2) {
  const seg = document.createElementNS(SVG_NS, "line");
  seg.setAttribute("x1", String(x1));
  seg.setAttribute("y1", String(y1));
  seg.setAttribute("x2", String(x2));
  seg.setAttribute("y2", String(y2));
  seg.setAttribute("stroke", color);
  seg.setAttribute("stroke-width", "0.6");
  seg.setAttribute("stroke-opacity", "0.9");
  seg.setAttribute("stroke-linecap", "round");
  seg.setAttribute("class", "demographics-relations-line");
  svg.appendChild(seg);
}

/**
 * Render a dashed edge by synthesizing solid sub-line segments by hand —
 * Coherent's renderer ignores `stroke-dasharray` on `<line>`. Falls back to
 * a single solid line for bad / zero-length patterns.
 * @param {Element} svg The SVG root.
 * @param {Edge} e The edge.
 * @param {{x: number, y: number}} pa Source position (slot-offset applied).
 * @param {{x: number, y: number}} pb Target position (slot-offset applied).
 * @param {string} dash The dash pattern string.
 * @returns {void}
 */
function appendDashedEdge(svg, e, pa, pb, dash) {
  if (!_dashLogged) {
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
  const parts = dash
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((n) => !isNaN(n) && n > 0);
  const color = e.color || "#bfbfbf";
  if (parts.length < 2) {
    // Bad pattern — fall back to solid.
    appendSolidEdge(svg, e, pa, pb, 0, 0);
    return;
  }
  const x1 = pa.x,
    y1 = pa.y;
  const x2 = pb.x,
    y2 = pb.y;
  const totalLen = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  if (totalLen <= 0) {
    appendSolidEdge(svg, e, pa, pb, 0, 0);
    return;
  }
  const ux = (x2 - x1) / totalLen,
    uy = (y2 - y1) / totalLen;
  let t = 0;
  let segIdx = 0; // even idx = dash (draw), odd = gap (skip)
  while (t < totalLen) {
    const segLen = parts[segIdx % parts.length];
    const end = Math.min(t + segLen, totalLen);
    if (segIdx % 2 === 0 && end > t) {
      appendDashSeg(svg, color, x1 + ux * t, y1 + uy * t, x1 + ux * end, y1 + uy * end);
    }
    t = end;
    segIdx++;
  }
}

// Perpendicular offset per parallel-line slot. ~1.6 SVG units gives
// clear visual separation without making the lines look unrelated.
const PARALLEL_SPACING = 1.6;

/**
 * Render one undirected pair's group of edges as parallel offset lines,
 * centered around the pair axis. Solid edges draw directly; dashed edges are
 * synthesized as solid sub-segments at the slot's offset endpoints.
 * @param {Element} svg The SVG root.
 * @param {EdgeGeo[]} entries The grouped edges for this pair.
 * @returns {void}
 */
function appendEdgeGroup(svg, entries) {
  const n = entries.length;
  // Compute the perpendicular unit vector once per pair.
  const first = entries[0];
  const dx = first.pb.x - first.pa.x;
  const dy = first.pb.y - first.pa.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const px = -dy / len,
    py = dx / len; // perp to direction (a→b)
  entries.forEach(({ e, pa, pb }, i) => {
    // Center the slots around 0: for n=1 offset is 0; for n=3 offsets
    // are -1, 0, +1; for n=4 they are -1.5, -0.5, +0.5, +1.5.
    const slot = i - (n - 1) / 2;
    const ox = px * slot * PARALLEL_SPACING;
    const oy = py * slot * PARALLEL_SPACING;
    // Per-filter line texture so visually-similar colors stay
    // distinguishable. Solid = primary signals; dashed/dotted overlay.
    const dash = dasharrayFor(e);
    if (!dash) {
      appendSolidEdge(svg, e, pa, pb, ox, oy);
    } else {
      // Dashes are synthesized from the FIRST entry's offset endpoints
      // (matches the original behavior, which read first.pa/first.pb).
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

/**
 * Resolve a ring node's display name: "Leader, Civilization" for majors, the
 * CS name for city-states, falling back to "P<id>".
 * @param {NodeInfo} info The node's display info.
 * @param {number} id The node's player id.
 * @returns {string} The display name.
 */
function nodeDisplayName(info, id) {
  if (info.isCityState) return info.csName || "CS-" + id;
  if (info.leaderName && info.civName) return info.leaderName + ", " + info.civName;
  return info.leaderName || info.csName || "P" + id;
}

/**
 * Resolve a node's stroke + fill colors. For CSes the type color is preferred
 * over the (unreliable) CS primary; both are scrubbed (defense-in-depth).
 * @param {NodeInfo} info The node's display info.
 * @param {boolean} isCs Whether the node is a city-state.
 * @returns {{ stroke: string, fill: string }} The resolved colors.
 */
function resolveNodeColors(info, isCs) {
  const stroke = isCs
    ? normalizeCivColor(info.csTypeColor) || normalizeCivColor(info.primaryColor) || "#9aa8c8"
    : normalizeCivColor(info.primaryColor) || "#c9a24c";
  const fillSrc = isCs
    ? normalizeCivColor(info.csTypeColor) || normalizeCivColor(info.primaryColor)
    : normalizeCivColor(info.primaryColor);
  const fill = isCs && fillSrc ? hexToRgba(fillSrc, 0.3) : "rgba(20, 16, 10, 0.85)";
  return { stroke, fill };
}

/**
 * Append the CS type indicator: the in-game banner icon (queued as an HTML
 * overlay, since SVG `<image href="blp:...">` was unreliable in Coherent), or
 * a colored inner disc fallback. No-op for non-CS nodes.
 * @param {Element} svg The SVG root.
 * @param {{x: number, y: number}} pos Node position.
 * @param {NodeInfo} info The node's display info.
 * @param {boolean} isCs Whether the node is a city-state.
 * @param {number} r Node radius.
 * @param {PortraitPlacement[]} portraitsToPlace Overlay queue.
 * @returns {void}
 */
function appendCsIndicator(svg, pos, info, isCs, r, portraitsToPlace) {
  if (isCs && info.csTypeIcon) {
    portraitsToPlace.push({
      kind: "cs-icon",
      iconUrl: info.csTypeIcon,
      vbX: pos.x,
      vbY: pos.y,
      vbR: r * 0.7 // icon inscribed slightly inside the node
    });
  } else if (isCs && info.csTypeColor) {
    const inner = document.createElementNS(SVG_NS, "circle");
    inner.setAttribute("cx", String(pos.x));
    inner.setAttribute("cy", String(pos.y));
    inner.setAttribute("r", String(r * 0.55));
    inner.setAttribute("fill", info.csTypeColor);
    inner.setAttribute("fill-opacity", "0.65");
    svg.appendChild(inner);
  }
}

/**
 * Append the node circle (and, for city-states, the inner color disc) for one
 * ring node, returning the chosen radius.
 * @param {Element} svg The SVG root.
 * @param {{x: number, y: number}} pos Node position.
 * @param {NodeInfo} info The node's display info.
 * @param {boolean} isCs Whether the node is a city-state.
 * @param {boolean} isViewer Whether the node is the focus viewer.
 * @param {number} density The ring density factor.
 * @param {PortraitPlacement[]} portraitsToPlace Overlay queue to push CS icons.
 * @returns {number} The node radius `r`.
 */
function appendNodeCircle(svg, pos, info, isCs, isViewer, density, portraitsToPlace) {
  // Viewer gets the larger node size — keeps the focus civ prominent.
  const baseR = isViewer ? 6.0 : isCs ? 4.0 : 5.0;
  const r = baseR * (isViewer ? Math.max(density, 0.65) : density);

  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("cx", String(pos.x));
  circle.setAttribute("cy", String(pos.y));
  circle.setAttribute("r", String(r));
  // For CSes: outer-ring color = type color (CS primary is unreliable).
  // Fill = type color tinted at ~30%. Final scrub here is defense-in-depth.
  const { stroke, fill } = resolveNodeColors(info, isCs);
  circle.setAttribute("fill", fill);
  circle.setAttribute("stroke", isViewer ? "#f3c34c" : stroke);
  circle.setAttribute(
    "stroke-width",
    String((isViewer ? 0.9 : isCs ? 0.7 : 0.5) * Math.max(density, 0.6))
  );
  if (isCs) circle.setAttribute("stroke-dasharray", "0.8 0.5");
  svg.appendChild(circle);

  appendCsIndicator(svg, pos, info, isCs, r, portraitsToPlace);
  return r;
}

/**
 * Resolve a major civ's leader portrait. Queues an HTML overlay placement when
 * a `LEADER_*` type is available and returns whether one was queued. CS nodes
 * never reach this path.
 * @param {NodeInfo} info The node's display info.
 * @param {{x: number, y: number}} pos Node position.
 * @param {number} r Node radius.
 * @param {PortraitPlacement[]} portraitsToPlace Overlay queue.
 * @returns {boolean} True when a portrait overlay was queued.
 */
function queueLeaderPortrait(info, pos, r, portraitsToPlace) {
  const leaderType = info.leaderTypeString;
  try {
    if (
      leaderType &&
      /^LEADER_/.test(leaderType) &&
      typeof UI !== "undefined" &&
      typeof UI.getIconURL === "function"
    ) {
      // Same pattern as Icon.getLeaderPortraitIcon (vanilla
      // utilities-image.js:182): default size is the most reliable variant.
      (UI.getIconURL(leaderType, "LEADER") + ".png").toLowerCase();
    }
  } catch (_) {
    // UI.getIconURL(leaderType, "LEADER") can throw at the engine boundary;
    // ignore — the fxs-icon overlay below resolves the BLP itself.
  }
  if (leaderType) {
    // Defer placement — we position fxs-icon divs over the wrap in pixel
    // coords once the SVG has laid out, so icons scale uniformly.
    portraitsToPlace.push({ kind: "leader", leaderType, vbX: pos.x, vbY: pos.y, vbR: r });
    return true;
  }
  return false;
}

/**
 * Append the initial-letter fallback glyph for a major civ that has no leader
 * portrait. Never called for city-states (they always paint a disc).
 * @param {Element} svg The SVG root.
 * @param {{x: number, y: number}} pos Node position.
 * @param {boolean} isViewer Whether the node is the focus viewer.
 * @param {boolean} isCs Whether the node is a city-state.
 * @param {number} density The ring density factor.
 * @param {string} nm The node display name.
 * @returns {void}
 */
function appendInitialLetter(svg, pos, isViewer, isCs, density, nm) {
  const initFont = (isViewer ? 5 : isCs ? 3.2 : 4) * density;
  const text = document.createElementNS(SVG_NS, "text");
  text.setAttribute("x", String(pos.x));
  text.setAttribute("y", String(pos.y + initFont * 0.34));
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("font-size", String(initFont));
  text.setAttribute("fill", isCs ? "#1c1408" : "#f3c34c");
  text.setAttribute("font-weight", "700");
  text.textContent = (nm.trim().charAt(0) || "?").toUpperCase();
  svg.appendChild(text);
}

/**
 * Append a ring node's name label. Below the node when sparse, radially
 * outward when dense (so adjacent labels don't collide).
 * @param {Element} svg The SVG root.
 * @param {{x: number, y: number}} pos Node position.
 * @param {number} r Node radius.
 * @param {number} cx Ring center x.
 * @param {number} cy Ring center y.
 * @param {number} density The ring density factor.
 * @param {number} viewBoxH ViewBox height (label clamp).
 * @param {string} nm The node display name.
 * @returns {void}
 */
function appendNodeLabel(svg, pos, r, cx, cy, density, viewBoxH, nm) {
  // Single label line: just the CS / leader name. The CS type is already
  // conveyed visually by the icon or disc, so a text type label is redundant.
  const nameFont = 2.4 * density;
  const radiallyOut = density < 0.7;
  const dx = pos.x - cx,
    dy = pos.y - cy;
  const mag = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / mag,
    uy = dy / mag;
  const labelOffset = r + 1.6 * density + 0.8;
  const lx = radiallyOut ? pos.x + ux * labelOffset : pos.x;
  const ly = radiallyOut
    ? pos.y + uy * labelOffset + nameFont * 0.34
    : Math.min(viewBoxH - 1, pos.y + r + nameFont + 0.4);

  const label = document.createElementNS(SVG_NS, "text");
  label.setAttribute("x", String(lx));
  label.setAttribute("y", String(ly));
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("font-size", String(nameFont));
  label.setAttribute("fill", "#f3e7c4");
  label.textContent = nm;
  svg.appendChild(label);
}

/**
 * Render one ring node: circle (+ CS disc/icon), leader portrait OR initial
 * letter, and the name label.
 * @param {Element} svg The SVG root.
 * @param {number} id The node player id.
 * @param {RingGeometry} geo The ring geometry.
 * @param {Record<string, NodeInfo>} names Node display-info map.
 * @param {number} localPid Local player id.
 * @param {number} viewerPid Focus viewer id.
 * @param {PortraitPlacement[]} portraitsToPlace Overlay queue.
 * @returns {void}
 */
function appendRingNode(svg, id, geo, names, localPid, viewerPid, portraitsToPlace) {
  const pos = geo.positions.get(id);
  if (!pos) return;
  const isViewer = id === viewerPid;
  const info = names[id] || {};
  const isCs = !!info.isCityState;

  const r = appendNodeCircle(svg, pos, info, isCs, isViewer, geo.density, portraitsToPlace);
  const nm = nodeDisplayName(info, id);

  // For MAJOR civs: render the leader portrait inside the node (same BLP the
  // factbook uses). CS nodes keep the type-icon / colored-disc path above.
  let renderedPortrait = false;
  if (!isCs) {
    renderedPortrait = queueLeaderPortrait(info, pos, r, portraitsToPlace);
  }

  // Initial-letter fallback. Skipped when we drew a portrait, or it's a CS
  // (CSes always paint a colored disc so letters never appear on them).
  if (!renderedPortrait && !isCs) {
    appendInitialLetter(svg, pos, isViewer, isCs, geo.density, nm);
  }

  appendNodeLabel(svg, pos, r, geo.cx, geo.cy, geo.density, geo.viewBoxH, nm);
}

/**
 * Append one queued portrait/icon overlay div, positioned in pixel coords.
 * @param {HTMLElement} wrap The ring wrap (overlay parent).
 * @param {PortraitPlacement} p The queued placement.
 * @param {number} contentLeft Letterboxed content left edge, px.
 * @param {number} contentTop Letterboxed content top edge, px.
 * @param {number} scale ViewBox→pixel scale.
 * @returns {void}
 */
function appendPortraitDiv(wrap, p, contentLeft, contentTop, scale) {
  const px = contentLeft + p.vbX * scale;
  const py = contentTop + p.vbY * scale;
  const diameter = p.vbR * 2 * scale;
  const div = document.createElement("div");
  div.className = "demographics-relations-portrait";
  // Pixel-coord placement + size are dynamic (computed from the letterboxed
  // viewBox); position:absolute and pointer-events live in the class.
  div.style.left = px - diameter / 2 + "px";
  div.style.top = py - diameter / 2 + "px";
  div.style.width = diameter + "px";
  div.style.height = diameter + "px";
  if (p.kind === "cs-icon") {
    // CS type-icon: a background-image div resolves `blp:` paths the same
    // way every other Civ7 UI surface does (the SVG `<image>` path didn't).
    // The background image URL is dynamic; the static contain/center/no-repeat
    // chrome lives in the .demographics-relations-portrait-cs rule.
    div.classList.add("demographics-relations-portrait-cs");
    div.style.backgroundImage = "url('" + p.iconUrl + "')";
  } else {
    const icon = document.createElement("fxs-icon");
    icon.setAttribute("data-icon-id", /** @type {string} */ (p.leaderType));
    icon.setAttribute("data-icon-context", "LEADER");
    icon.classList.add("demographics-relations-portrait-icon");
    div.appendChild(icon);
  }
  wrap.appendChild(div);
}

/**
 * Build the deferred-placement routine for portrait/icon overlays. The SVG's
 * viewBox is letterboxed via `xMidYMid meet`; whichever axis is tighter sets
 * `scale` and the other axis is centered. Re-defers a frame if layout isn't
 * ready yet.
 * @param {HTMLElement} wrap The ring wrap (overlay parent).
 * @param {Element} svg The SVG root.
 * @param {PortraitPlacement[]} portraitsToPlace Overlay queue.
 * @param {number} viewBoxW ViewBox width.
 * @param {number} viewBoxH ViewBox height.
 * @returns {() => void} The placement routine.
 */
function makePlacePortraits(wrap, svg, portraitsToPlace, viewBoxW, viewBoxH) {
  /**
   * Position every queued overlay, deferring a frame if layout isn't ready.
   * @returns {void}
   */
  function placePortraits() {
    if (portraitsToPlace.length === 0) return;
    let rect;
    try {
      rect = svg.getBoundingClientRect();
    } catch (_) {
      // svg.getBoundingClientRect() can throw if the node is detached; treat
      // as not-yet-laid-out and re-defer a frame below.
      rect = null;
    }
    if (!rect || rect.width === 0 || rect.height === 0) {
      // Layout not ready yet — try again next frame.
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(placePortraits);
      } else {
        setTimeout(placePortraits, 16);
      }
      return;
    }
    // Strip any previously-placed portraits so repaints don't pile up.
    const old = wrap.querySelectorAll(".demographics-relations-portrait");
    old.forEach((el) => el.remove());

    const scale = Math.min(rect.width / viewBoxW, rect.height / viewBoxH);
    const contentW = viewBoxW * scale;
    const contentH = viewBoxH * scale;
    const contentLeft = (rect.width - contentW) / 2;
    const contentTop = (rect.height - contentH) / 2;

    for (const p of portraitsToPlace) {
      appendPortraitDiv(wrap, p, contentLeft, contentTop, scale);
    }
    dlog("placed " + portraitsToPlace.length + " portraits " + "@scale=" + scale.toFixed(2));
  }
  return placePortraits;
}

/**
 * Build the SVG ring with leader portraits and connector lines. `viewerPid` is
 * the civ whose perspective the ring is drawn FROM (the CS tab lets the user
 * pick a non-local major as the viewer); the viewer is styled like the local
 * player so it stays the prominent node.
 * @param {number[]} ringIds Node ids to lay out on the ring.
 * @param {Record<string, NodeInfo>} names Node display-info map.
 * @param {Edge[]} edges Edges to draw.
 * @param {number} localPid Local player id.
 * @param {number} [viewerPid] Focus viewer id (defaults to `localPid`).
 * @returns {HTMLElement} The ring wrap element.
 */
export function buildRingSvg(ringIds, names, edges, localPid, viewerPid) {
  if (typeof viewerPid !== "number") viewerPid = localPid;
  const wrap = document.createElement("div");
  // position:relative is the positioning context for the pixel-placed portrait
  // overlays; it lives in the .demographics-relations-ring-wrap rule.
  wrap.className = "demographics-relations-ring-wrap";

  // Collected as we walk the ring; positioned after the SVG mounts so we can
  // measure where the (proportionally-letterboxed) viewBox area actually
  // lives in pixel coords. This avoids the <foreignObject> path entirely.
  /** @type {PortraitPlacement[]} */
  const portraitsToPlace = [];

  const geo = computeRingGeometry(ringIds);
  const { viewBoxW, viewBoxH } = geo;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 " + viewBoxW + " " + viewBoxH);
  // 'xMidYMid meet' = uniform scale + letterbox. Shapes inside the viewBox
  // stay proportional regardless of the SVG element's pixel dimensions.
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.classList.add("demographics-relations-ring-svg");
  wrap.appendChild(svg);

  if (ringIds.length === 0) {
    const empty = document.createElement("div");
    empty.className = "demographics-empty font-body text-base";
    empty.textContent = "No civilizations to show.";
    wrap.appendChild(empty);
    return wrap;
  }

  // Group edges by undirected pair so a pair carrying multiple relationships
  // (Alliance + Open Borders + Trade) renders as parallel offset lines.
  const edgeGroups = groupEdgesByPair(edges, geo.positions);
  for (const entries of edgeGroups.values()) {
    appendEdgeGroup(svg, entries);
  }

  // Nodes.
  for (const id of ringIds) {
    appendRingNode(svg, id, geo, names, localPid, viewerPid, portraitsToPlace);
  }

  // Place leader portraits as HTML overlays in PIXEL coords over the wrap.
  const placePortraits = makePlacePortraits(wrap, svg, portraitsToPlace, viewBoxW, viewBoxH);
  // Defer until the wrap is in the DOM and laid out. The caller mounts the
  // wrap synchronously, so a single rAF is enough on first paint.
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(placePortraits);
  } else {
    setTimeout(placePortraits, 16);
  }

  return wrap;
}
