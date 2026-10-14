// relations-ring-svg.js
//
// SVG ring renderer for the Global Relations view: ring geometry, the deferred pixel-space
// portrait-overlay placement and the edge hover. Edges and nodes are drawn by
// relations-ring-svg-edges.js and relations-ring-svg-nodes.js.
//
// Layout: civs sit at equal angles around an ellipse, the first at the top and the rest clockwise,
// with each related pair joined by a curve between their nodes.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { toLocalPx } from "/demographics/ui/core/demographics-font-ladder.js";
import {
  log,
  setRingPxPerUnit
} from "/demographics/ui/screen-demographics/views/relations/relations-shared.js";
import {
  appendEdgeGroup,
  groupEdgesByPair
} from "/demographics/ui/screen-demographics/views/relations/relations-ring-svg-edges.js";
import {
  appendRingBackdrop
} from "/demographics/ui/screen-demographics/views/relations/relations-ring-svg-backdrop.js";
import {
  appendRingNode,
  nodeRadius
} from "/demographics/ui/screen-demographics/views/relations/relations-ring-svg-nodes.js";
import { measureRect, setClass } from "/demographics/ui/screen-demographics/screen/dom-helpers.js";

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

// ring layout

/**
 * Seat `ids` at equal angles around an ellipse centered at `(cx, cy)`. The first id sits at the
 * top and the rest follow clockwise (SVG y grows downward). A lone node sits at the right-hand
 * end of the x-axis instead, level with the center.
 * @param {number[]} ids Node ids in seating order.
 * @param {number} rx Ellipse x-radius.
 * @param {number} ry Ellipse y-radius.
 * @param {number} cx Center x.
 * @param {number} cy Center y.
 * @returns {Map<number, {x: number, y: number}>} Node id → position.
 */
function seatsOnEllipse(ids, rx, ry, cx, cy) {
  const seats = new Map();
  const count = ids.length;
  const firstAngle = count === 1 ? 0 : -Math.PI / 2;
  const fullTurn = 2 * Math.PI;
  ids.forEach((id, i) => {
    const angle = firstAngle + (fullTurn * i) / count;
    seats.set(id, { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
  });
  return seats;
}

/**
 * Compute the ring's geometry (viewBox, center, radii, density, positions)
 * from the node count. Past 12 nodes the ring stretches into a horizontal oval,
 * fully stretched at 24, so each node keeps legible arc-length.
 * @param {number[]} ringIds
 * @returns {RingGeometry}
 */
function computeRingGeometry(ringIds) {
  // ovalT smoothly interpolates 0..1 across the 12..24 node range; the
  // viewBox widens to match so the SVG uses the surrounding wider canvas.
  const nodeCount = ringIds.length;
  const ovalT = Math.max(0, Math.min(1, (nodeCount - 12) / 12));
  const viewBoxW = 100 + ovalT * 80; // 100..180
  // Grow the viewBox HEIGHT with oval mode too, so radially-placed labels
  // have headroom both above the top node AND below the bottom node.
  const viewBoxH = 100 + ovalT * 24; // 100..124
  const cx = viewBoxW / 2;
  // Lift small rings (12 nodes or fewer) slightly above the viewBox midpoint so the
  // diagram reads as centered under the tab/header chrome. Negative = up.
  const cyBias = nodeCount <= 12 ? -4 : 0;
  const cy = viewBoxH / 2 + cyBias;

  // Ring radius scales with node count (few civs sit close to center, many
  // spread out); sparse rings stay a bit flatter so the top node clears the
  // header/tab chrome.
  const ry = nodeCount <= 2 ? 18 : nodeCount <= 6 ? 32 : nodeCount <= 12 ? 40 : 38;
  // rx grows past ry when ovalT > 0 - the wider viewBox is what gives
  // us room for a longer X axis.
  const rx = ry + ovalT * 38; // 42..80 at max oval
  const positions = seatsOnEllipse(ringIds, rx, ry, cx, cy);

  // Density factor: 1.0 when arc-spacing per node is comfortable (≥ 22
  // SVG units), shrinking smoothly down to 0.32 when very crowded. The perimeter
  // uses Ramanujan's approximation (ellipseH is its h term).
  const ellipseH = Math.pow((rx - ry) / (rx + ry), 2);
  const ellipsePerim = Math.PI * (rx + ry) * (1 + (3 * ellipseH) / (10 + Math.sqrt(4 - 3 * ellipseH)));
  const arcSpacing = nodeCount > 0 ? ellipsePerim / nodeCount : 100;
  const density = Math.max(0.32, Math.min(1.0, arcSpacing / 22));

  return { viewBoxW, viewBoxH, cx, cy, rx, ry, density, positions };
}

/**
 * @param {HTMLElement} wrap The ring wrap (overlay parent).
 * @param {PortraitPlacement} placement
 * @param {{contentLeft: number, contentTop: number, scale: number}} layout
 *   Letterboxed content offset + viewBox→pixel scale.
 * @param {(pid: number) => void} [onNodeToggle]
 * @param {Map<string, HTMLElement>} [cache] Overlay reuse cache (see {@link portraitKey}).
 * @returns {HTMLElement}
 */
function appendPortraitDiv(wrap, placement, layout, onNodeToggle, cache) {
  const key = portraitKey(placement);
  let div = cache ? cache.get(key) : null;
  if (!div) {
    div = placement.kind === "label" ? createNodeLabelDiv(placement) : createPortraitDiv(placement, onNodeToggle);
    if (cache) cache.set(key, div);
  }
  if (placement.kind === "label") positionNodeLabel(div, placement, layout);
  else positionPortrait(div, placement, layout);
  // Only touch the tree when the overlay is not already parented here: a repaint of the same ring
  // then moves nothing at all.
  if (div.parentNode !== wrap) wrap.appendChild(div);
  return div;
}

/**
 * The stable identity of an overlay: the same node showing the same art. Position, size and the
 * selected/dimmed state are not part of it; those are pushed onto a reused element rather than
 * justifying a new one.
 * @param {PortraitPlacement} placement
 * @returns {string}
 */
function portraitKey(placement) {
  return [
    placement.kind,
    placement.pid,
    placement.leaderType || "",
    placement.iconUrl || "",
    placement.color || "",
    placement.text || ""
  ].join("|");
}

/**
 * Create one portrait/icon overlay element (art and click wiring only, no geometry).
 * @param {PortraitPlacement} placement
 * @param {(pid: number) => void} [onNodeToggle]
 * @returns {HTMLElement}
 */
function createPortraitDiv(placement, onNodeToggle) {
  const div = document.createElement("div");
  div.className = "demographics-relations-portrait";
  // The handler is wired once and survives reuse: it reads the selection off the live render
  // state at click time, and the cache shares that state's lifetime, so it can never go stale.
  wirePortraitClick(div, placement, onNodeToggle);
  fillPortraitContent(div, placement);
  return div;
}

/**
 * @param {HTMLElement} div
 * @param {PortraitPlacement} placement
 * @param {{contentLeft: number, contentTop: number, scale: number}} layout
 *   Letterboxed content offset + viewBox→pixel scale.
 */
function positionPortrait(div, placement, layout) {
  const centerX = layout.contentLeft + placement.vbX * layout.scale;
  const centerY = layout.contentTop + placement.vbY * layout.scale;
  const diameter = placement.vbR * 2 * layout.scale;
  // The leader portrait covers the node's SVG circle (whose stroke turns gold
  // when selected), so the focus state must live on the portrait frame itself.
  setClass(div, "is-selected", !!placement.selected);
  setClass(div, "is-dimmed", !!placement.dimmed);
  // Pixel-coord placement + size are dynamic (computed from the letterboxed
  // viewBox); position:absolute and pointer-events live in the class.
  div.style.left = centerX - diameter / 2 + "px";
  div.style.top = centerY - diameter / 2 + "px";
  div.style.width = diameter + "px";
  div.style.height = diameter + "px";
}

/**
 * Create a node name label as plain HTML text (no box), centered under the node.
 * Uses the same UI font/weight/color as the historical-data chart labels via CSS.
 * @param {PortraitPlacement} placement The label placement (carries text).
 * @returns {HTMLElement}
 */
function createNodeLabelDiv(placement) {
  const div = document.createElement("div");
  div.className = "demographics-relations-node-label";
  div.textContent = placement.text || "";
  return div;
}

/**
 * @param {HTMLElement} div
 * @param {PortraitPlacement} placement
 * @param {{contentLeft: number, contentTop: number, scale: number}} layout
 *   Letterboxed content offset + viewBox→pixel scale.
 */
function positionNodeLabel(div, placement, layout) {
  setClass(div, "is-dimmed", !!placement.dimmed);
  div.style.left = layout.contentLeft + placement.vbX * layout.scale + "px";
  div.style.top = layout.contentTop + placement.vbY * layout.scale + "px";
}

/**
 * @param {HTMLElement} div
 * @param {PortraitPlacement} placement
 * @param {(pid: number) => void} [onNodeToggle]
 */
function wirePortraitClick(div, placement, onNodeToggle) {
  if (typeof onNodeToggle !== "function" || typeof placement.pid !== "number") return;
  const pid = placement.pid;
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
 * @param {PortraitPlacement} placement
 */
function fillPortraitContent(div, placement) {
  if (placement.kind === "cs-icon") {
    div.classList.add("demographics-relations-portrait-cs");
    div.style.backgroundImage = "url('" + placement.iconUrl + "')";
    return;
  }
  // Leader = a gold-rimmed hexagon token tinted by the civ's color (pure-CSS
  // clip-path hexes), layered back-to-front: glow, rim, fill, portrait.
  div.classList.add("demographics-relations-portrait-hex");
  div.appendChild(hexLayer("demographics-relations-hex-glow"));
  div.appendChild(hexLayer("demographics-relations-hex-rim"));
  const fill = hexLayer("demographics-relations-hex-fill");
  if (placement.color) fill.style.backgroundColor = placement.color;
  div.appendChild(fill);
  const icon = document.createElement("fxs-icon");
  icon.setAttribute("data-icon-id", /** @type {string} */ (placement.leaderType));
  icon.setAttribute("data-icon-context", "LEADER");
  icon.classList.add("demographics-relations-portrait-icon");
  div.appendChild(icon);
}

/** @param {string} className */
function hexLayer(className) {
  const el = document.createElement("div");
  el.className = className;
  return el;
}

/**
 * Wrap a deferred (rAF / setTimeout) callback in a logged boundary so a throw
 * inside it is reported instead of escaping into the engine's frame dispatcher.
 * @param {string} label
 * @param {() => void} fn
 * @returns {() => void}
 */
function guardedFrame(label, fn) {
  return () => {
    try {
      fn();
    } catch (e) {
      log.error(label + ":", e);
    }
  };
}

/**
 * Remove the portrait/label overlays this paint did not place, so repaints don't pile up while
 * the reused ones stay untouched in the tree. (GameFace's NodeList / Element may lack `forEach` /
 * `remove`, so iterate via Array.prototype and detach through the parent.)
 * @param {HTMLElement} wrap The ring wrap.
 * @param {Set<HTMLElement>} keep The overlays that belong to this paint.
 */
function stripStaleOverlays(wrap, keep) {
  const overlays = wrap.querySelectorAll(
    ".demographics-relations-portrait, .demographics-relations-node-label"
  );
  if (!overlays) return;
  Array.prototype.forEach.call(overlays, (/** @type {*} */ el) => {
    if (el && el.parentNode && !keep.has(el)) el.parentNode.removeChild(el);
  });
}

/**
 * Find the nearest ancestor carrying `cls` by walking up `parentElement`.
 * (GameFace's `Element.closest` is unreliable; an explicit walk is portable.)
 * @param {Element|null} el Starting element (inclusive).
 * @param {string} cls
 * @returns {Element|null}
 */
function ancestorByClass(el, cls) {
  let node = el;
  while (node) {
    if (node.classList && node.classList.contains(cls)) return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * The on-screen bottom edge (px, viewport coords) the diagram must stay above:
 * the demographics frame's bottom, falling back to the viewport height.
 * @param {Element} wrap The ring wrap.
 * @returns {number} The bottom limit in px, or 0 if it can't be determined.
 */
function ringBottomLimit(wrap) {
  const frame = ancestorByClass(wrap.parentElement, "demographics-frame");
  const frameRect = measureRect(frame);
  if (frameRect && frameRect.height > 0) return frameRect.bottom;
  if (typeof window !== "undefined" && window.innerHeight) return window.innerHeight;
  return 0;
}

/**
 * Height (px) to keep free below the diagram for the caption row that sits under
 * it (the focus hint). Measured off the live element so it scales with Interface
 * Size, plus a hairline gap so the lowest node label never touches the frame edge.
 * @param {Element} wrap The ring wrap.
 * @returns {number} Reserve height in px.
 */
function ringBottomReserve(wrap) {
  const relWrap = ancestorByClass(wrap, "demographics-relations-wrap");
  const captionEl =
    relWrap && typeof relWrap.querySelector === "function"
      ? relWrap.querySelector(".demographics-relations-caption")
      : null;
  const captionRect = measureRect(captionEl);
  return (captionRect && captionRect.height > 0 ? captionRect.height : 0) + 4;
}

/**
 * Cap the diagram region's height to the space visible on-screen so the ring's
 * bottom node never hangs below the frame. GameFace can resolve the relations
 * flex height chain taller than the frame, so this measures the body's top and
 * the frame's bottom and sets an explicit max-height on the body (the wrap's
 * flex parent, which also pulls the caption row back on-screen).
 * @param {HTMLElement} wrap The ring wrap (its flex parent is the relations body).
 */
function constrainRingHeight(wrap) {
  const body = /** @type {HTMLElement} */ (
    ancestorByClass(wrap.parentElement, "demographics-relations-body") || wrap
  );
  // Clear any prior cap first so we read the body's natural top (fixed by the
  // tab/toolbar chrome above it) and never compound caps across resize re-runs.
  body.style.maxHeight = "";
  const rect = measureRect(body);
  if (!rect || rect.width === 0 || rect.height === 0) return;
  const bottom = ringBottomLimit(wrap);
  if (!(bottom > 0)) return;
  // Everything measured here is visual px; maxHeight is local px (frame may be transform-scaled).
  const maxHeight = toLocalPx(bottom - rect.top - ringBottomReserve(wrap));
  // Only cap when there's a sane positive budget that actually shrinks the box;
  // never set a tiny/negative height that would collapse the ring to nothing.
  if (maxHeight > 0 && maxHeight < toLocalPx(rect.height)) body.style.maxHeight = maxHeight + "px";
}

/**
 * Build the deferred-placement routine for portrait/icon overlays. The SVG's
 * viewBox is letterboxed via `xMidYMid meet`, so the tighter axis sets `scale`
 * and the other is centered; re-defers a frame if layout isn't ready yet.
 * @param {HTMLElement} wrap The ring wrap (overlay parent).
 * @param {Element} svg
 * @param {PortraitPlacement[]} portraitsToPlace
 * @param {{w: number, h: number}} viewBox
 * @param {{ onNodeToggle?: (pid: number) => void, cache?: Map<string, HTMLElement> }} opts
 *   Optional click handler, plus the overlay reuse cache shared across repaints so the leader
 *   portraits (the ring's only engine-art elements) are never re-created by a filter change; a
 *   fresh `fxs-icon` paints blank for a frame or more and visibly blinks.
 * @returns {() => void}
 */
function makePlacePortraits(wrap, svg, portraitsToPlace, viewBox, opts) {
  const onNodeToggle = opts?.onNodeToggle;
  const cache = opts?.cache;
  // Bound the layout-wait re-defer: repaintRing rebuilds the ring on every node
  // click, so an old ring's deferred placement can fire against a detached node
  // whose rect stays 0x0 forever. The retry cap is the hard backstop; the
  // isConnected check short-circuits sooner when the engine supports it.
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
  /**
   * Measure the (post-cap) SVG box and paint every queued overlay into it. Must
   * run after constrainRingHeight has reflowed, or the overlays letterbox into a
   * stale box and the outer portraits fling off their nodes.
   */
  function paintOverlaysNow() {
    if (wrap && wrap.isConnected === false) return;
    const rect = measureRect(svg);
    if (!rect || rect.width === 0 || rect.height === 0) return;
    retries = 0;
    // The SVG rect is VISUAL px; portraits are positioned in the wrap's LOCAL px.
    const boxW = toLocalPx(rect.width);
    const boxH = toLocalPx(rect.height);
    const scale = Math.min(boxW / viewBox.w, boxH / viewBox.h);
    // Publish the ring's px-per-viewBox-unit so the legend can draw its sample
    // lines at the exact same scale (matched dash lengths + stroke width).
    setRingPxPerUnit(scale);
    const contentLeft = (boxW - viewBox.w * scale) / 2;
    const contentTop = (boxH - viewBox.h * scale) / 2;
    /** @type {Set<HTMLElement>} */
    const placed = new Set();
    for (const placement of portraitsToPlace) {
      placed.add(appendPortraitDiv(wrap, placement, { contentLeft, contentTop, scale }, onNodeToggle, cache));
    }
    stripStaleOverlays(wrap, placed);
    // Drop cache entries this ring no longer uses, so switching top tabs can't grow it forever.
    if (cache) {
      for (const [key, el] of cache) {
        if (!placed.has(el)) cache.delete(key);
      }
    }
    log.debug("placed " + portraitsToPlace.length + " portraits @scale=" + scale.toFixed(2));
  }
  const paintOverlays = guardedFrame("paintOverlays", paintOverlaysNow);
  function placePortraitsNow() {
    if (portraitsToPlace.length === 0) return;
    // Liveness guard: a newer repaint detached this wrap → stop (don't paint into
    // or spin on an orphan). Only bails when isConnected is explicitly false, so
    // an engine without isConnected (undefined) falls through to the retry cap.
    if (wrap && wrap.isConnected === false) return;
    const rect = measureRect(svg);
    if (!rect || rect.width === 0 || rect.height === 0) {
      scheduleRetry();
      return;
    }
    // Cap the diagram to the on-screen budget, then paint on the NEXT frame: a
    // same-tick getBoundingClientRect can still return the pre-cap (taller) size
    // in Gameface and push the outer portraits off their nodes.
    if (wrap) constrainRingHeight(wrap);
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(paintOverlays);
    else paintOverlays();
  }
  const placePortraits = guardedFrame("placePortraits", placePortraitsNow);
  return placePortraits;
}

/**
 * @param {number} viewBoxW
 * @param {number} viewBoxH
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
 * the civ whose perspective the ring is drawn from; it is styled like the local
 * player so it stays the prominent node.
 * @param {number[]} ringIds
 * @param {Record<string, NodeInfo>} names
 * @param {Edge[]} edges
 * @param {number} localPid
 * @param {{ viewerPid?: number, selectedNodeIds?: Set<number>,
 *   onNodeToggle?: (pid: number) => void,
 *   portraitCache?: Map<string, HTMLElement> }} [options]
 *   Viewer (defaults to `localPid`) + node-focus interaction config, plus an optional overlay
 *   reuse cache shared across repaints (see {@link makePlacePortraits}).
 * @returns {HTMLElement}
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
    { onNodeToggle, cache: options?.portraitCache }
  );
  // Expose the placement so the caller can run it after mounting the wrap (the
  // overlays need the laid-out wrap to measure). Running it synchronously
  // post-mount paints them in the same frame as the SVG, so no flicker on
  // re-render. placePortraits self-defers a frame only if layout isn't ready.
  /** @type {*} */ (wrap).__placePortraits = placePortraits;

  return wrap;
}

/**
 * Populate the ring (edges + nodes), collecting per-edge hover geometry, then wire
 * the HTML-wrap hover (Coherent doesn't deliver mouse events to SVG lines).
 * @param {Element} svg
 * @param {RingGeometry} geo
 * @param {Record<string, NodeInfo>} names
 * @param {Edge[]} edges
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

/** @param {HTMLElement} wrap */
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
 * @returns {{ show: (text: string, x: number, y: number) => void, hide: () => void }}
 */
function createEdgeTooltip(wrap) {
  const tip = document.createElement("div");
  tip.className = "demographics-relations-edge-tip font-body text-xs";
  tip.style.display = "none";
  wrap.appendChild(tip);
  return {
    show(text, clientX, clientY) {
      const wrapRect = measureRect(wrap);
      if (!wrapRect) return;
      tip.textContent = text;
      tip.style.display = "block";
      // Cursor position within the wrap, in the wrap's LOCAL px (clientX and the rect are visual).
      const x = toLocalPx(clientX - wrapRect.left);
      const y = toLocalPx(clientY - wrapRect.top);
      // Default offset down-right of the cursor, but FLIP to up-left near the
      // wrap's right / bottom edge so the tip never clips off-panel.
      const GAP_X = 14;
      const GAP_Y = 8;
      const tipW = tip.offsetWidth || 0;
      const tipH = tip.offsetHeight || 0;
      const wrapW = wrap.clientWidth || wrapRect.width;
      const wrapH = wrap.clientHeight || wrapRect.height;
      let left = x + GAP_X;
      let top = y + GAP_Y;
      if (left + tipW > wrapW) left = Math.max(0, x - GAP_X - tipW);
      if (top + tipH > wrapH) top = Math.max(0, y - GAP_Y - tipH);
      tip.style.left = left + "px";
      tip.style.top = top + "px";
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
 * @param {RingGeometry} geo Supplies the viewBox dims.
 * @param {number} clientX
 * @param {number} clientY
 * @returns {{x: number, y: number}|null}
 */
function clientToViewBox(svg, geo, clientX, clientY) {
  const rect = measureRect(svg);
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  const scale = Math.min(rect.width / geo.viewBoxW, rect.height / geo.viewBoxH);
  if (!(scale > 0)) return null;
  const offX = rect.left + (rect.width - geo.viewBoxW * scale) / 2;
  const offY = rect.top + (rect.height - geo.viewBoxH * scale) / 2;
  return { x: (clientX - offX) / scale, y: (clientY - offY) / scale };
}

/**
 * Minimum distance from a point to a set of sampled curve points (viewBox units).
 * @param {{x: number, y: number}[]} pts Sampled points.
 * @param {{x: number, y: number}} pt The query point.
 * @returns {number}
 */
function distToPts(pts, pt) {
  let min = Infinity;
  for (const sample of pts) {
    const dx = sample.x - pt.x;
    const dy = sample.y - pt.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < min) min = distSq;
  }
  return Math.sqrt(min);
}

/**
 * @param {*[]} records
 * @param {{x: number, y: number}} pt The query point (viewBox coords).
 */
function nearestEdge(records, pt) {
  let best = null;
  let bestDist = HOVER_DIST;
  for (const rec of records) {
    const dist = distToPts(rec.pts, pt);
    if (dist < bestDist) {
      bestDist = dist;
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
 * @param {RingGeometry} geo
 * @param {*[]} records
 * @param {{ show: (text: string, x: number, y: number) => void, hide: () => void }} tooltip
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
  // Both handlers run from the engine's input dispatcher, so a detached wrap (a
  // repaint replaced it while the cursor was still over it) must return early
  // rather than measure / restyle an orphan, and nothing below may throw.
  wrap.addEventListener("mousemove", (/** @type {*} */ ev) => {
    if (wrap.isConnected === false || !ev) return;
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
  wrap.addEventListener("mouseleave", () => {
    if (wrap.isConnected === false) return;
    clear();
  });
}

/**
 * @param {Element} svg
 * @param {RingGeometry} geo
 * @param {Record<string, NodeInfo>} names
 * @param {Edge[]} edges
 * @param {RingRenderCtx} ringCtx
 */
function populateRing(svg, geo, names, edges, ringCtx) {
  // Backdrop first so the orbit ring sits behind everything.
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
 * @param {Record<string, NodeInfo>} names
 * @param {RingRenderCtx} ringCtx Per-ring render context (supplies viewerPid).
 * @returns {Map<number, number>}
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
 * @param {Edge[]} edges
 * @param {Set<number>|undefined} selectedNodeIds
 */
function computeFocus(edges, selectedNodeIds) {
  const selected = selectedNodeIds && selectedNodeIds.size ? selectedNodeIds : null;
  if (!selected) return { selected: null, nodes: null };
  const nodes = new Set(selected);
  for (const edge of edges) {
    if (selected.has(edge.a)) nodes.add(edge.b);
    else if (selected.has(edge.b)) nodes.add(edge.a);
  }
  return { selected, nodes };
}
