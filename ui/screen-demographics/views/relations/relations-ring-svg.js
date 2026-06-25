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

import { t } from "/demographics/ui/core/demographics-i18n.js";
import {
  dlog,
  setRingPxPerUnit
} from "/demographics/ui/screen-demographics/views/relations/relations-shared.js";
import {
  appendEdgeGroup,
  groupEdgesByPair
} from "/demographics/ui/screen-demographics/views/relations/relations-ring-svg-edges.js";
import {
  appendRingBackdrop
} from "/demographics/ui/screen-demographics/views/relations/relations-ring-svg-backdrop.js";
// (radar/bezel/emblem removed , see relations-ring-svg-backdrop.js, now a quiet
//  single orbit ring matching the game's restrained art.)
import {
  appendRingNode,
  nodeRadius
} from "/demographics/ui/screen-demographics/views/relations/relations-ring-svg-nodes.js";

/**
 * @typedef {import("./relations-ring-svg-nodes.js").NodeInfo} NodeInfo
 * @typedef {import("./relations-ring-svg-nodes.js").PortraitPlacement} PortraitPlacement
 * @typedef {import("./relations-ring-svg-nodes.js").RingRenderCtx} RingRenderCtx
 * @typedef {import("./relations-ring-svg-nodes.js").RingNode} RingNode
 * @typedef {import("./relations-ring-svg-edges.js").Edge} Edge
 */

const SVG_NS = "http://www.w3.org/2000/svg";

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

// ---- ring layout ----------------------------------------------------------
// ADAPTED from sloth/global-relations-panel.js.

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
  // Lift the ring slightly ABOVE the viewBox midpoint for the major-civ tab
  // (N <= 12) so the diagram reads as centered on the window rather than sitting
  // low in the body region below the tab/header chrome. Oval/CS rings (N > 12)
  // already fill the canvas, so they stay centered. Negative = up.
  const cyBias = N <= 12 ? -4 : 0;
  const cy = viewBoxH / 2 + cyBias;

  // Ring radius scales with node count so a few civs sit close to center
  // (more space for labels) while many civs spread out to use the canvas.
  // Keep sparse major-civ rings a bit flatter vertically so the top node
  // clears the relations header/tab chrome.
  const ry = N <= 2 ? 18 : N <= 6 ? 32 : N <= 12 ? 40 : 38;
  // rx grows past ry when ovalT > 0 - the wider viewBox is what gives
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
 * Append one queued portrait/icon overlay div, positioned in pixel coords.
 * @param {HTMLElement} wrap The ring wrap (overlay parent).
 * @param {PortraitPlacement} p The queued placement.
 * @param {{contentLeft: number, contentTop: number, scale: number}} layout
 *   Letterboxed content offset + viewBox→pixel scale.
 * @param {(pid: number) => void} [onNodeToggle] Optional click handler.
 */
function appendPortraitDiv(wrap, p, layout, onNodeToggle) {
  if (p.kind === "label") {
    appendNodeLabelDiv(wrap, p, layout);
    return;
  }
  const px = layout.contentLeft + p.vbX * layout.scale;
  const py = layout.contentTop + p.vbY * layout.scale;
  const diameter = p.vbR * 2 * layout.scale;
  const div = document.createElement("div");
  div.className = "demographics-relations-portrait";
  // The leader portrait covers the node's SVG circle (whose stroke turns gold
  // when selected), so the focus state must live on the portrait frame itself.
  if (p.selected) div.classList.add("is-selected");
  if (p.dimmed) div.classList.add("is-dimmed");
  // Pixel-coord placement + size are dynamic (computed from the letterboxed
  // viewBox); position:absolute and pointer-events live in the class.
  div.style.left = px - diameter / 2 + "px";
  div.style.top = py - diameter / 2 + "px";
  div.style.width = diameter + "px";
  div.style.height = diameter + "px";
  wirePortraitClick(div, p, onNodeToggle);
  fillPortraitContent(div, p);
  wrap.appendChild(div);
}

/**
 * Append a node name label as plain HTML text (no box), centered under the node.
 * Uses the same UI font/weight/color as the historical-data chart labels via CSS.
 * @param {HTMLElement} wrap The ring wrap (overlay parent).
 * @param {PortraitPlacement} p The label placement (carries text + position).
 * @param {{contentLeft: number, contentTop: number, scale: number}} layout
 *   Letterboxed content offset + viewBox→pixel scale.
 */
function appendNodeLabelDiv(wrap, p, layout) {
  const px = layout.contentLeft + p.vbX * layout.scale;
  const py = layout.contentTop + p.vbY * layout.scale;
  const div = document.createElement("div");
  div.className = "demographics-relations-node-label";
  if (p.dimmed) div.classList.add("is-dimmed");
  div.style.left = px + "px";
  div.style.top = py + "px";
  div.textContent = p.text || "";
  wrap.appendChild(div);
}

/**
 * Wire a portrait overlay's click-to-toggle-focus (no-op without a handler/pid).
 * @param {HTMLElement} div The portrait div.
 * @param {PortraitPlacement} p The placement (carries pid).
 * @param {(pid: number) => void} [onNodeToggle] Optional click handler.
 */
function wirePortraitClick(div, p, onNodeToggle) {
  if (typeof onNodeToggle !== "function" || typeof p.pid !== "number") return;
  const pid = p.pid;
  div.style.pointerEvents = "auto";
  div.style.cursor = "pointer";
  div.addEventListener("click", () => {
    onNodeToggle(pid);
  });
}

/**
 * Fill a portrait overlay's content: a CS type-icon background, or a leader
 * fxs-icon. (A background-image div resolves `blp:` paths the way every other
 * Civ7 UI surface does; the SVG `<image>` path was unreliable in Coherent.)
 * @param {HTMLElement} div The portrait div.
 * @param {PortraitPlacement} p The placement.
 */
function fillPortraitContent(div, p) {
  if (p.kind === "cs-icon") {
    div.classList.add("demographics-relations-portrait-cs");
    div.style.backgroundImage = "url('" + p.iconUrl + "')";
    return;
  }
  // Leader = a gold-rimmed hexagon token tinted by the civ's color, echoing the
  // diplomacy-ribbon hex leaders. Pure-CSS hexes (clip-path) so there's no
  // texture/tint dependency; layered back→front: select glow, gold rim, color
  // fill, then the leader portrait.
  div.classList.add("demographics-relations-portrait-hex");
  div.appendChild(hexLayer("demographics-relations-hex-glow"));
  div.appendChild(hexLayer("demographics-relations-hex-rim"));
  const fill = hexLayer("demographics-relations-hex-fill");
  if (p.color) fill.style.backgroundColor = p.color;
  div.appendChild(fill);
  const icon = document.createElement("fxs-icon");
  icon.setAttribute("data-icon-id", /** @type {string} */ (p.leaderType));
  icon.setAttribute("data-icon-context", "LEADER");
  icon.classList.add("demographics-relations-portrait-icon");
  div.appendChild(icon);
}

/**
 * Build one absolutely-positioned hex-token layer div.
 * @param {string} className The layer class.
 * @returns {HTMLElement} The layer element.
 */
function hexLayer(className) {
  const el = document.createElement("div");
  el.className = className;
  return el;
}

/**
 * Remove previously-placed portrait/label overlays so repaints don't pile up.
 * @param {HTMLElement} wrap The ring wrap.
 */
function stripOldOverlays(wrap) {
  const old = wrap.querySelectorAll(
    ".demographics-relations-portrait, .demographics-relations-node-label"
  );
  old.forEach((el) => el.remove());
}

/**
 * Build the deferred-placement routine for portrait/icon overlays. The SVG's
 * viewBox is letterboxed via `xMidYMid meet`; whichever axis is tighter sets
 * `scale` and the other axis is centered. Re-defers a frame if layout isn't
 * ready yet.
 * @param {HTMLElement} wrap The ring wrap (overlay parent).
 * @param {Element} svg The SVG root.
 * @param {PortraitPlacement[]} portraitsToPlace Overlay queue.
 * @param {{w: number, h: number}} viewBox ViewBox width/height.
 * @param {(pid: number) => void} [onNodeToggle] Optional click handler.
 * @returns {() => void} The placement routine.
 */
function makePlacePortraits(wrap, svg, portraitsToPlace, viewBox, onNodeToggle) {
  // Bound the layout-wait re-defer. repaintRing wipes + rebuilds the ring on
  // every node click, so an OLD ring's deferred placement can fire a frame later
  // against a now-detached node whose rect stays 0×0 forever — previously that
  // re-deferred UNBOUNDED, leaking one runaway rAF loop per orphaned ring. The
  // retry cap is the hard backstop; the isConnected check below short-circuits
  // sooner when the engine supports it (Coherent may not, hence both).
  let retries = 0;
  const MAX_LAYOUT_RETRIES = 120; // ~2s at 60fps; a ring unlaid by then is dead
  // Re-run next frame while layout isn't ready, up to the retry cap. The cap is
  // the hard backstop against an unbounded rAF loop when an OLD ring (detached by
  // a newer repaint) never lays out and its rect stays 0×0 forever.
  function scheduleRetry() {
    if (++retries > MAX_LAYOUT_RETRIES) return;
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(placePortraits);
    else setTimeout(placePortraits, 16);
  }
  // getBoundingClientRect can throw on a detached node; treat that as not-ready.
  function measuredRect() {
    try {
      return svg.getBoundingClientRect();
    } catch (_) {
      return null;
    }
  }
  /**
   * Position every queued overlay, deferring a frame if layout isn't ready.
   */
  function placePortraits() {
    if (portraitsToPlace.length === 0) return;
    // Liveness guard: a newer repaint detached this wrap → stop (don't paint into
    // or spin on an orphan). Only bails when isConnected is explicitly false, so
    // an engine without isConnected (undefined) falls through to the retry cap.
    if (wrap && wrap.isConnected === false) return;
    const rect = measuredRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      scheduleRetry();
      return;
    }
    retries = 0;
    stripOldOverlays(wrap);
    const scale = Math.min(rect.width / viewBox.w, rect.height / viewBox.h);
    // Publish the ring's px-per-viewBox-unit so the legend can draw its sample
    // lines at the exact same scale (matched dash lengths + stroke width).
    setRingPxPerUnit(scale);
    const contentLeft = (rect.width - viewBox.w * scale) / 2;
    const contentTop = (rect.height - viewBox.h * scale) / 2;

    for (const p of portraitsToPlace) {
      appendPortraitDiv(wrap, p, { contentLeft, contentTop, scale }, onNodeToggle);
    }
    dlog("placed " + portraitsToPlace.length + " portraits " + "@scale=" + scale.toFixed(2));
  }
  return placePortraits;
}

/**
 * Create the ring's root <svg>: a viewBox sized to the geometry with
 * 'xMidYMid meet' (uniform scale + letterbox, so shapes stay proportional
 * regardless of the element's pixel size). Extracted to keep `buildRingSvg`
 * under the line cap.
 * @param {number} viewBoxW ViewBox width.
 * @param {number} viewBoxH ViewBox height.
 * @returns {SVGElement} The configured SVG root (not yet mounted).
 */
function createRingSvgRoot(viewBoxW, viewBoxH) {
  const svg = /** @type {SVGElement} */ (document.createElementNS(SVG_NS, "svg"));
  svg.setAttribute("viewBox", "0 0 " + viewBoxW + " " + viewBoxH);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.classList.add("demographics-relations-ring-svg");
  return svg;
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
 * @param {{ viewerPid?: number, selectedNodeIds?: Set<number>,
 *   onNodeToggle?: (pid: number) => void }} [options]
 *   Viewer (defaults to `localPid`) + node-focus interaction config.
 * @returns {HTMLElement} The ring wrap element.
 */
export function buildRingSvg(ringIds, names, edges, localPid, options) {
  const viewerPid = typeof options?.viewerPid === "number" ? options.viewerPid : localPid;
  const selectedNodeIds = options?.selectedNodeIds;
  const onNodeToggle = options?.onNodeToggle;
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

  const svg = createRingSvgRoot(viewBoxW, viewBoxH);
  wrap.appendChild(svg);

  if (ringIds.length === 0) {
    appendEmptyRing(wrap);
    return wrap;
  }

  renderRingInteractive(svg, geo, names, edges, {
    viewerPid,
    selectedNodeIds,
    onNodeToggle,
    portraitsToPlace,
    wrap
  });

  // Place leader portraits as HTML overlays in PIXEL coords over the wrap,
  // deferred until the wrap is laid out (caller mounts it synchronously).
  const placePortraits = makePlacePortraits(
    wrap,
    svg,
    portraitsToPlace,
    { w: viewBoxW, h: viewBoxH },
    onNodeToggle
  );
  // Expose the placement so the caller can run it AFTER mounting the wrap (the
  // overlays need the laid-out wrap to measure). Running it synchronously
  // post-mount paints them in the same frame as the SVG - no flicker on
  // re-render. placePortraits self-defers a frame only if layout isn't ready.
  /** @type {*} */ (wrap).__placePortraits = placePortraits;

  return wrap;
}

/**
 * Populate the ring (edges + nodes), collecting per-edge hover geometry, then wire
 * the HTML-wrap hover (Coherent doesn't deliver mouse events to SVG lines).
 * @param {Element} svg The SVG root.
 * @param {RingGeometry} geo The ring geometry.
 * @param {Record<string, NodeInfo>} names Node display-info map.
 * @param {Edge[]} edges Edges to draw.
 * @param {*} opts Render fields: viewerPid, selectedNodeIds, onNodeToggle,
 *   portraitsToPlace, and `wrap` (the HTML ring wrap that receives mouse events).
 */
function renderRingInteractive(svg, geo, names, edges, opts) {
  /** @type {*[]} */
  const edgeRecords = [];
  populateRing(svg, geo, names, edges, {
    viewerPid: opts.viewerPid,
    selectedNodeIds: opts.selectedNodeIds,
    onNodeToggle: opts.onNodeToggle,
    portraitsToPlace: opts.portraitsToPlace,
    edgeRecords
  });
  setupEdgeHover(opts.wrap, svg, geo, edgeRecords, createEdgeTooltip(opts.wrap));
}

/**
 * Append the "no civilizations" empty-state notice to the ring wrap.
 * @param {HTMLElement} wrap The ring wrap.
 */
function appendEmptyRing(wrap) {
  const empty = document.createElement("div");
  empty.className = "demographics-empty font-body text-base";
  empty.textContent = t("LOC_DEMOGRAPHICS_EMPTY_NO_CIVS");
  wrap.appendChild(empty);
}

/**
 * Create the hover tooltip for edges: an absolutely-positioned DOM chip in the
 * ring wrap, shown/moved at the cursor while hovering a line. (A DOM tip is the
 * reliable route in Coherent; native SVG `<title>` tooltips are not honored.)
 * @param {HTMLElement} wrap The ring wrap (positioning context).
 * @returns {{ show: (text: string, x: number, y: number) => void, hide: () => void }} Controller.
 */
function createEdgeTooltip(wrap) {
  const tip = document.createElement("div");
  tip.className = "demographics-relations-edge-tip font-body text-xs";
  tip.style.display = "none";
  wrap.appendChild(tip);
  return {
    show(text, clientX, clientY) {
      tip.textContent = text;
      tip.style.display = "block";
      const r = wrap.getBoundingClientRect();
      // Anchor at the cursor; the gap that keeps the label out from under the
      // pointer is a CSS transform on the tip (so it hot-reloads on screen reopen
      // , this view's JS is lazy-loaded and only reloads on a full app restart).
      tip.style.left = clientX - r.left + "px";
      tip.style.top = clientY - r.top + "px";
    },
    hide() {
      tip.style.display = "none";
    }
  };
}

// How close (in viewBox units) the cursor must be to a line to highlight it.
const HOVER_DIST = 1.9;

/**
 * Convert client (px) coords to the SVG's viewBox coords, accounting for the
 * xMidYMid-meet letterboxing. Returns null when the SVG isn't laid out yet.
 * @param {Element} svg The ring SVG.
 * @param {RingGeometry} geo The ring geometry (viewBox dims).
 * @param {number} cx Client x.
 * @param {number} cy Client y.
 * @returns {{x: number, y: number}|null} ViewBox-space point, or null.
 */
function clientToViewBox(svg, geo, cx, cy) {
  const r = svg.getBoundingClientRect();
  if (!r || r.width <= 0 || r.height <= 0) return null;
  const scale = Math.min(r.width / geo.viewBoxW, r.height / geo.viewBoxH);
  if (!(scale > 0)) return null;
  const offX = r.left + (r.width - geo.viewBoxW * scale) / 2;
  const offY = r.top + (r.height - geo.viewBoxH * scale) / 2;
  return { x: (cx - offX) / scale, y: (cy - offY) / scale };
}

/**
 * Minimum distance from a point to a set of sampled curve points (viewBox units).
 * @param {{x: number, y: number}[]} pts Sampled points.
 * @param {{x: number, y: number}} pt The query point.
 * @returns {number} The nearest distance.
 */
function distToPts(pts, pt) {
  let min = Infinity;
  for (const p of pts) {
    const dx = p.x - pt.x;
    const dy = p.y - pt.y;
    const d = dx * dx + dy * dy;
    if (d < min) min = d;
  }
  return Math.sqrt(min);
}

/**
 * The edge record nearest a point, within HOVER_DIST; null when none qualify.
 * @param {*[]} records Edge hover records.
 * @param {{x: number, y: number}} pt The query point (viewBox coords).
 * @returns {*} The nearest record, or null.
 */
function nearestEdge(records, pt) {
  let best = null;
  let bestD = HOVER_DIST;
  for (const rec of records) {
    const d = distToPts(rec.pts, pt);
    if (d < bestD) {
      bestD = d;
      best = rec;
    }
  }
  return best;
}

/**
 * Drive edge hover from the HTML wrap: on mousemove, find the nearest line to the
 * cursor and toggle its `.is-hovered` highlight + show the tooltip. This replaces
 * SVG hover entirely (Coherent doesn't deliver mouse events to SVG line elements).
 * @param {HTMLElement} wrap The ring wrap (HTML; receives the mouse events).
 * @param {Element} svg The ring SVG (for the coordinate mapping).
 * @param {RingGeometry} geo The ring geometry.
 * @param {*[]} records Per-edge hover records.
 * @param {{ show: (t: string, x: number, y: number) => void, hide: () => void }} tooltip Tip ctrl.
 */
function setupEdgeHover(wrap, svg, geo, records, tooltip) {
  let current = /** @type {*} */ (null);
  const clear = () => {
    if (current) {
      current.g.classList.remove("is-hovered");
      current = null;
    }
    tooltip.hide();
  };
  wrap.addEventListener("mousemove", (/** @type {*} */ ev) => {
    const pt = clientToViewBox(svg, geo, ev.clientX, ev.clientY);
    const hit = pt ? nearestEdge(records, pt) : null;
    if (!hit) {
      clear();
      return;
    }
    if (hit !== current) {
      if (current) current.g.classList.remove("is-hovered");
      hit.g.classList.add("is-hovered");
      current = hit;
    }
    tooltip.show(hit.label, ev.clientX, ev.clientY);
  });
  wrap.addEventListener("mouseleave", clear);
}

/**
 * Draw the ring's edges (grouped by undirected pair into parallel offset lines)
 * then its nodes.
 * @param {Element} svg The SVG root.
 * @param {RingGeometry} geo The ring geometry.
 * @param {Record<string, NodeInfo>} names Node display-info map.
 * @param {Edge[]} edges Edges to draw.
 * @param {RingRenderCtx} ringCtx Per-ring render context.
 */
function populateRing(svg, geo, names, edges, ringCtx) {
  // Cinematic backdrop first so depth rings / radar sweep sit behind everything.
  appendRingBackdrop(svg, geo);
  const focus = computeFocus(edges, ringCtx.selectedNodeIds);
  ringCtx.focusNodes = focus.nodes;
  const radii = buildNodeRadii(geo, names, ringCtx);
  const records = ringCtx.edgeRecords || null;
  const edgeGroups = groupEdgesByPair(edges, geo.positions);
  for (const entries of edgeGroups.values()) {
    appendEdgeGroup(svg, entries, focus.selected, radii, records);
  }
  for (const id of geo.positions.keys()) appendRingNode(svg, id, geo, names, ringCtx);
}

/**
 * Build a pid → node-radius (viewBox units) map so edges can terminate at each
 * node's circle rather than its center. Mirrors the node renderer's own sizing.
 * @param {RingGeometry} geo The ring geometry (supplies density).
 * @param {Record<string, NodeInfo>} names Node display-info map.
 * @param {RingRenderCtx} ringCtx Per-ring render context (supplies viewerPid).
 * @returns {Map<number, number>} Node radii by pid.
 */
function buildNodeRadii(geo, names, ringCtx) {
  /** @type {Map<number, number>} */
  const radii = new Map();
  for (const id of geo.positions.keys()) {
    const info = names[id] || /** @type {*} */ ({});
    radii.set(id, nodeRadius(id === ringCtx.viewerPid, !!info.isCityState, geo.density));
  }
  return radii;
}

/**
 * Compute the focus sets that drive click-to-focus dimming. When one or more
 * nodes are selected, the selected nodes plus their direct edge neighbors stay
 * bright and everything else fades back.
 * @param {Edge[]} edges All ring edges.
 * @param {Set<number>|undefined} selectedNodeIds The selected node ids.
 * @returns {{ selected: Set<number>|null, nodes: Set<number>|null }} The active
 *   selection (null when none) and the bright set (selection + neighbors).
 */
function computeFocus(edges, selectedNodeIds) {
  const selected = selectedNodeIds && selectedNodeIds.size ? selectedNodeIds : null;
  if (!selected) return { selected: null, nodes: null };
  const nodes = new Set(selected);
  for (const e of edges) {
    if (selected.has(e.a)) nodes.add(e.b);
    else if (selected.has(e.b)) nodes.add(e.a);
  }
  return { selected, nodes };
}
