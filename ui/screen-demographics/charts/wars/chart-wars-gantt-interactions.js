// chart-wars-gantt-interactions.js
//
// Wars Gantt hover tooltip creation, hit-testing, and pointer interaction flow.

import { renderWarTooltip } from "/demographics/ui/screen-demographics/charts/wars/chart-wars-tooltip.js";

// Visual scale applied to the tooltip in CSS (.demographics-wars-tooltip); used
// here so the right-edge flip accounts for the enlarged width. Keep in sync.
const TOOLTIP_SCALE = 1.12;

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
 * Position the Gantt tooltip near the cursor with right-edge AND bottom-edge
 * flip (the wrap scrolls both ways; without the vertical flip a hover on a war
 * bar low in a tall Gantt pushes the tooltip below the visible area).
 * @param {{ wrap: HTMLElement, tooltip: HTMLElement }} state Hover state.
 * @param {*} ev Mouse event.
 * @param {*} rect SVG client rect.
 */
function positionGanttTooltip(state, ev, rect) {
  const localX = ev.clientX - rect.left;
  let left = localX + 14;
  const tooltipWidth = state.tooltip.offsetWidth * TOOLTIP_SCALE;
  const visibleRight = state.wrap.scrollLeft + state.wrap.clientWidth - 8;
  if (left + tooltipWidth > visibleRight) {
    left = Math.max(state.wrap.scrollLeft + 8, localX - 14 - tooltipWidth);
  }
  const localY = ev.clientY - rect.top;
  let top = localY + 14;
  const tooltipHeight = state.tooltip.offsetHeight * TOOLTIP_SCALE;
  const visibleBottom = state.wrap.scrollTop + state.wrap.clientHeight - 8;
  if (top + tooltipHeight > visibleBottom) {
    top = Math.max(state.wrap.scrollTop + 8, localY - 14 - tooltipHeight);
  }
  state.tooltip.style.left = left + "px";
  state.tooltip.style.top = top + "px";
}

/**
 * Handle one Gantt hover move event.
 * @param {*} ev Mouse event.
 * @param {{
 *   wrap: HTMLElement,
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
  if (war !== state.shownWar) {
    state.tooltip.style.display = "block";
    renderWarTooltip(state.tooltip, war, state.ctx);
    state.shownWar = war;
  }
  positionGanttTooltip(state, ev, rect);
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
  const state = { wrap, svg, tooltip, barRects, ctx, W, H, shownWar: null };
  wrap.addEventListener("mousemove", (ev) => onGanttHoverMove(ev, state));
  wrap.addEventListener("mouseleave", () => {
    tooltip.style.display = "none";
    state.shownWar = null;
  });
}
