// chart-wars-gantt-interactions.js
//
// Wars Gantt hover tooltip creation, hit-testing, and pointer interaction flow.

import { renderWarTooltip } from "/demographics/ui/screen-demographics/charts/wars/chart-wars-tooltip.js";
import { toLocalPx } from "/demographics/ui/core/demographics-font-ladder.js";

// Visual scale applied to the tooltip in CSS (.demographics-wars-tooltip); used
// here so the edge flips account for the enlarged box. Keep in sync.
const TOOLTIP_SCALE = 1.12;
// When even the frame is too short for the tooltip (six-column wars on a small viewport), it is
// scaled down to fit, but no further than this: below it the table stops being readable and the
// player is better served by a cropped-but-legible tooltip.
const MIN_TOOLTIP_SCALE = 0.8;
// Breathing room between the tooltip and the edge of its host, in local px.
const EDGE_PAD = 8;

/**
 * Create the shared Gantt hover-tooltip element (hidden, absolute).
 * @returns {HTMLElement} The tooltip element.
 */
export function createGanttTooltip() {
  const tooltip = document.createElement("div");
  tooltip.className = "demographics-chart-hover-tooltip demographics-wars-tooltip";
  // Hidden until a bar is hovered.
  tooltip.style.display = "none";
  return tooltip;
}

/**
 * Move the tooltip onto the screen frame the first time a hover needs it. The Gantt wrap scrolls
 * (`overflow: auto`), so a tooltip mounted in it can never extend past the wrap's visible box: at
 * 1280x720 a six-civ war tooltip is taller than the whole chart area and its lower rows were cut
 * off no matter how it was flipped (watched 2026-09-23). The frame gives it the full frame height.
 * This runs at hover time, not mount time: mountGanttWrap builds the wrap detached, so `closest`
 * finds no frame until the wrap is in the document (the first attempt did exactly that and every
 * tooltip silently stayed in the canvas). The canvas remains the host outside the screen (tests).
 * Any tooltip left on the frame by a previous Gantt mount is removed first.
 * @param {{ wrap: HTMLElement, tooltip: HTMLElement, host: HTMLElement|null }} state Hover state.
 */
function ensureTooltipHost(state) {
  if (state.host) return;
  const frame = /** @type {HTMLElement|null} */ (
    typeof state.wrap.closest === "function" ? state.wrap.closest(".demographics-frame") : null);
  if (!frame) return;
  for (const stale of Array.from(frame.children || [])) {
    if (stale !== state.tooltip && stale.classList && stale.classList.contains("demographics-wars-tooltip")) {
      frame.removeChild(stale);
    }
  }
  frame.appendChild(state.tooltip);
  state.host = frame;
}

/**
 * Hit-test a point (in SVG coords) against the war bar rects.
 * @param {*} barRects The bar rects.
 * @param {number} svgX The SVG-space x.
 * @param {number} svgY The SVG-space y.
 * @returns {*} The war under the point, or null.
 */
function hitTestBars(barRects, svgX, svgY) {
  for (const rect of barRects) {
    const width = rect.hitW ?? rect.w;
    if (
      svgX >= rect.x &&
      svgX <= rect.x + width &&
      svgY >= rect.y &&
      svgY <= rect.y + rect.h
    ) {
      return rect.war;
    }
  }
  return null;
}

/**
 * Hide the Gantt tooltip and clear hover state.
 * @param {{ tooltip: HTMLElement, shownWar: * }} state Hover state.
 */
function hideGanttTooltip(state) {
  state.tooltip.style.display = "none";
  state.shownWar = null;
}

/**
 * The box the tooltip must stay inside and the client-rect origin its `left`/`top` are measured
 * from, both in the host's LOCAL px. On the frame there is no scrolling; in the canvas fallback
 * the wrap scrolls both ways, so the visible box follows scrollLeft/scrollTop.
 * @param {{ wrap: HTMLElement, host: HTMLElement|null }} state Hover state.
 * @param {*} svgRect SVG client rect (the canvas-fallback origin).
 * @returns {{ origin: {left: number, top: number}, minX: number, maxX: number, minY: number, maxY: number }}
 */
function tooltipBounds(state, svgRect) {
  if (state.host) {
    const hr = state.host.getBoundingClientRect();
    return { origin: { left: hr.left, top: hr.top },
      minX: EDGE_PAD, maxX: state.host.clientWidth - EDGE_PAD,
      minY: EDGE_PAD, maxY: state.host.clientHeight - EDGE_PAD };
  }
  const { scrollLeft, scrollTop, clientWidth, clientHeight } = state.wrap;
  return { origin: { left: svgRect.left, top: svgRect.top },
    minX: scrollLeft + EDGE_PAD, maxX: scrollLeft + clientWidth - EDGE_PAD,
    minY: scrollTop + EDGE_PAD, maxY: scrollTop + clientHeight - EDGE_PAD };
}

/**
 * Pick the tooltip's visual scale: the CSS enlargement, reduced (to a floor) when the tooltip's
 * natural box would not fit the host in either direction. Written inline so the CSS default is
 * overridden only while it has to be.
 * @param {HTMLElement} tooltip The tooltip element.
 * @param {{ minX: number, maxX: number, minY: number, maxY: number }} b The bounds.
 * @returns {number} The scale applied.
 */
function fitTooltipScale(tooltip, b) {
  const w = tooltip.offsetWidth || 1;
  const h = tooltip.offsetHeight || 1;
  const fit = Math.min(TOOLTIP_SCALE, (b.maxX - b.minX) / w, (b.maxY - b.minY) / h);
  const k = Math.max(MIN_TOOLTIP_SCALE, Math.round(fit * 100) / 100);
  tooltip.style.transform = "scale(" + k + ")";
  return k;
}

/**
 * Place one axis: prefer the cursor's far side, flip to the near side when that overflows, and
 * finally clamp to the bounds so a tooltip larger than the host still shows its top-left.
 * @param {number} cursor Cursor position in host-local px.
 * @param {number} size Tooltip extent on this axis (scaled).
 * @param {number} min Lowest allowed position.
 * @param {number} max Highest allowed far edge.
 * @returns {number} The position.
 */
function placeAxis(cursor, size, min, max) {
  let pos = cursor + 14;
  if (pos + size > max) pos = cursor - 14 - size;
  return Math.max(min, Math.min(pos, max - size));
}

/**
 * Position the Gantt tooltip near the cursor with right-edge AND bottom-edge flip, clamped to its
 * host and scaled down when it would not fit at all.
 * @param {{ wrap: HTMLElement, host: HTMLElement|null, tooltip: HTMLElement }} state Hover state.
 * @param {*} ev Mouse event.
 * @param {*} rect SVG client rect.
 */
function positionGanttTooltip(state, ev, rect) {
  // clientX/Y and the rects are VISUAL px; `left`/`top`, clientWidth/Height and offsetWidth/Height
  // are the host's LOCAL px. Under the frame's transform:scale the two differ, and writing the
  // visual delta as local px put the tooltip 1/s too far and past the frame (watched 2026-09-23).
  const b = tooltipBounds(state, rect);
  const k = fitTooltipScale(state.tooltip, b);
  const localX = toLocalPx(ev.clientX - b.origin.left);
  const localY = toLocalPx(ev.clientY - b.origin.top);
  const left = placeAxis(localX, state.tooltip.offsetWidth * k, b.minX, b.maxX);
  const top = placeAxis(localY, state.tooltip.offsetHeight * k, b.minY, b.maxY);
  state.tooltip.style.left = left + "px";
  state.tooltip.style.top = top + "px";
}

/**
 * Handle one Gantt hover move event.
 * @param {*} ev Mouse event.
 * @param {{
 *   wrap: HTMLElement,
 *   host: HTMLElement|null,
 *   svg: SVGElement,
 *   tooltip: HTMLElement,
 *   barRects: any[],
 *   ctx: Object,
 *   W: number,
 *   H: number,
 *   shownWar: *,
 * }} state Hover state.
 */
function onGanttHoverMove(ev, state) {
  try {
    ganttHoverMoveBody(ev, state);
  } catch (_) {
    // A hover handler runs outside any render guard; on a throw hide the tooltip and stay quiet.
    hideGanttTooltip(state);
  }
}

/**
 * The hover-move body: hit-test the bars under the cursor and show/position the tooltip.
 * @param {*} ev Mouse event.
 * @param {*} state Hover state (see onGanttHoverMove).
 */
function ganttHoverMoveBody(ev, state) {
  const rect = state.svg.getBoundingClientRect();
  if (!rect || rect.width === 0) {
    hideGanttTooltip(state);
    return;
  }
  const svgX = ((ev.clientX - rect.left) / rect.width) * state.W;
  const svgY = ((ev.clientY - rect.top) / rect.height) * state.H;
  const war = hitTestBars(state.barRects, svgX, svgY);
  if (!war) {
    hideGanttTooltip(state);
    return;
  }
  ensureTooltipHost(state);
  if (war !== state.shownWar) {
    state.tooltip.style.display = "block";
    renderWarTooltip(state.tooltip, war, state.ctx);
    state.shownWar = war;
  }
  positionGanttTooltip(state, ev, rect);
  // The flip-left check reads offsetWidth, which is stale in the same tick the content was rendered
  // (GameFace lays out a frame later): a wide six-civ tooltip stayed on the cursor's right and ran
  // off the frame until the next mouse move (watched 2026-09-23). Re-place once layout has settled.
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => { if (state.shownWar) positionGanttTooltip(state, ev, rect); });
}

/**
 * Wire the Gantt's mousemove/leave hover tooltip behavior.
 * @param {Object} args Wiring inputs.
 * @param {HTMLElement} args.wrap The chart wrap.
 * @param {SVGElement} args.svg The chart SVG.
 * @param {HTMLElement} args.tooltip The tooltip element.
 * @param {*} args.barRects The bar rects.
 * @param {Object} args.ctx Shared Gantt context (for tooltip rendering).
 * @param {number} args.W Canvas width.
 * @param {number} args.H Canvas height.
 */
export function wireGanttHover(args) {
  const { wrap, svg, tooltip, barRects, ctx, W, H } = args;
  // `host` is resolved on the first hover (see ensureTooltipHost).
  const state = { wrap, host: null, svg, tooltip, barRects, ctx, W, H, shownWar: null };
  wrap.addEventListener("mousemove", (ev) => onGanttHoverMove(ev, state));
  wrap.addEventListener("mouseleave", () => {
    tooltip.style.display = "none";
    state.shownWar = null;
  });
}
