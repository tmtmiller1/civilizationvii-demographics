// chart-risings-bars.js
//
// Draws a Partisans rising on the Conflicts timeline. A rising row is thinner than a war bar and
// hatched: a pale fill in the owner's color crossed by diagonal strokes in the full color, with a
// solid outline. Coherent ignores stroke-dasharray, and SVG patterns aren't something the other
// charts rely on, so the hatch is plain line elements cut to the bar's ends by hand.

import { svgEl } from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";
import { preferReadableColor } from "/demographics/ui/core/civ-color-utils.js";

/** Horizontal distance between hatch strokes, in chart pixels. */
const HATCH_STEP = 9;
const FALLBACK_COLOR = "#9aa8c8";

/**
 * The owner's banner color from the newest sample that has one, with a dark grey primary swapped
 * for the secondary the way the rest of the mod reads civ colors.
 * @param {Snapshot[]} samples
 * @param {number} pid
 * @returns {string}
 */
export function risingOwnerColor(samples, pid) {
  for (let i = samples.length - 1; i >= 0; i--) {
    const player = samples[i]?.players?.[pid];
    if (player && typeof player.primaryColor === "string" && player.primaryColor) {
      return preferReadableColor(player.primaryColor, player.secondaryColor) || player.primaryColor;
    }
  }
  return FALLBACK_COLOR;
}

/**
 * Hatch strokes for a bar: each runs bottom-left to top-right and is cut where it leaves the bar.
 * Pure, so the geometry is testable.
 * @param {number} x Bar left.
 * @param {number} y Bar top.
 * @param {number} w Bar width.
 * @param {number} h Bar height.
 * @returns {{ x1: number, y1: number, x2: number, y2: number }[]}
 */
export function hatchSegments(x, y, w, h) {
  const out = [];
  const right = x + w;
  for (let start = x - h; start < right; start += HATCH_STEP) {
    // The full stroke runs from (start, y + h) to (start + h, y); clip it to [x, right].
    const x1 = Math.max(start, x);
    const x2 = Math.min(start + h, right);
    if (x2 - x1 < 0.5) continue;
    out.push({ x1, y1: y + h - (x1 - start), x2, y2: y + h - (x2 - start) });
  }
  return out;
}

/**
 * @param {SVGElement} svg
 * @param {{ x: number, y: number, w: number, h: number, color: string, isClosed: boolean }} bar
 */
function drawHatchedBar(svg, bar) {
  const { x, y, w, h, color, isClosed } = bar;
  svg.appendChild(svgEl("rect", { x, y, width: w, height: h, fill: color, "fill-opacity": isClosed ? "0.22" : "0.32" }));
  for (const seg of hatchSegments(x, y, w, h)) {
    svg.appendChild(svgEl("line", { ...seg, stroke: color, "stroke-width": "1.6", "stroke-opacity": "0.9" }));
  }
  svg.appendChild(svgEl("rect", { x, y, width: w, height: h, fill: "none", stroke: color, "stroke-width": "1.2" }));
}

/**
 * @param {SVGElement} svg
 * @param {{ isClosed: boolean, x2: number, y: number, h: number, color: string }} end
 */
function drawRisingEnd(svg, end) {
  const { isClosed, x2, y, h, color } = end;
  if (isClosed) {
    svg.appendChild(svgEl("line", { x1: x2, x2, y1: y - 2, y2: y + h + 2, stroke: color, "stroke-width": "2" }));
    return;
  }
  svg.appendChild(
    svgEl("circle", { cx: x2, cy: y + h / 2, r: 4, fill: color, stroke: "#1c1408", "stroke-width": "0.5" })
  );
}

/**
 * Draw one rising row and return its hover rectangle (the same shape a war bar returns, with the
 * row under `war` so the shared hit test hands it back).
 * @param {SVGElement} svg
 * @param {*} row A rising row (chart-risings-data.js).
 * @param {{ baseY: number, barH: number }} slot
 * @param {{ L: any, dom: { xMin: number, xMax: number }, latestTurn: number, samples: Snapshot[] }} ctx
 */
export function drawRisingBar(svg, row, slot, ctx) {
  const { L, dom, latestTurn, samples } = ctx;
  const isClosed = typeof row.endTurn === "number";
  const endTurn = isClosed ? row.endTurn : latestTurn;
  const x = L.xOf(Math.max(row.startTurn, dom.xMin));
  const x2 = L.xOf(Math.min(endTurn, dom.xMax));
  const w = Math.max(3, x2 - x);
  const color = risingOwnerColor(samples, row.rising.owner);
  drawHatchedBar(svg, { x, y: slot.baseY, w, h: slot.barH, color, isClosed });
  drawRisingEnd(svg, { isClosed, x2: x + w, y: slot.baseY, h: slot.barH, color });
  // A running rising stays hoverable out to the right edge, like an ongoing war's tail.
  const hitW = isClosed ? w : Math.max(w, L.xOf(dom.xMax) - x);
  return { war: row, x, y: slot.baseY, w, h: slot.barH, x2: x + w, isClosed, hitW };
}
