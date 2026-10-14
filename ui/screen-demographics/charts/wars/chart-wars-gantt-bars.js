// chart-wars-gantt-bars.js
//
// War bar rendering helpers for the wars Gantt chart.

import { getSemantic } from "/demographics/ui/core/demographics-palette.js";
import { svgEl } from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";
import { majorsOnSide } from "/demographics/ui/screen-demographics/charts/wars/chart-wars-naming.js";

/**
 * @param {*[]} samples
 * @param {*} pid
 */
function currentPrimaryColor(samples, pid) {
  for (let i = samples.length - 1; i >= 0; i--) {
    const samplePlayer = samples[i]?.players?.[pid];
    if (samplePlayer && typeof samplePlayer.primaryColor === "string" && samplePlayer.primaryColor.length > 0) {
      return samplePlayer.primaryColor;
    }
  }
  return "#9aa8c8";
}

/**
 * @param {*} stripe
 * @param {number} idx
 * @param {*[]} samples
 * @param {*} palette Semantic palette (getSemantic).
 */
function resolveStripeFill(stripe, idx, samples, palette) {
  return (
    (typeof stripe.pid === "number" && currentPrimaryColor(samples, stripe.pid)) ||
    stripe.color ||
    (idx % 2 === 0 ? palette.sideA_fallback : palette.sideB_fallback)
  );
}

/**
 * @param {*} war
 * @param {*} palette Semantic palette (getSemantic).
 */
function resolveWarStripes(war, palette) {
  const participants = /** @type {any[]} */ ([]).concat(
    majorsOnSide(war.sideACivs),
    majorsOnSide(war.sideBCivs)
  );
  if (participants.length > 0) return participants;
  return [
    { pid: null, color: palette.sideA_fallback },
    { pid: null, color: palette.sideB_fallback }
  ];
}

/**
 * @param {SVGElement} svg
 * @param {Object} args
 * @param {*[]} args.stripes
 * @param {*[]} args.samples
 * @param {*} args.palette Semantic palette (getSemantic).
 * @param {number} args.x1 Left x.
 * @param {number} args.baseY Top y.
 * @param {number} args.barW
 * @param {number} args.barH
 * @param {boolean} args.isClosed
 */
function drawWarBarStripes(svg, args) {
  const { stripes, samples, palette, x1, baseY, barW, barH, isClosed } = args;
  const stripeH = barH / stripes.length;

  stripes.forEach((stripe, idx) => {
    const fill = resolveStripeFill(stripe, idx, samples, palette);
    svg.appendChild(
      svgEl("rect", {
        x: x1,
        y: baseY + idx * stripeH,
        width: barW,
        height: stripeH,
        fill,
        "fill-opacity": isClosed ? "0.85" : "1"
      })
    );
  });

  for (let i = 1; i < stripes.length; i++) {
    svg.appendChild(
      svgEl("line", {
        x1: x1,
        x2: x1 + barW,
        y1: baseY + i * stripeH,
        y2: baseY + i * stripeH,
        stroke: "rgba(28, 20, 8, 0.55)",
        "stroke-width": "0.7"
      })
    );
  }
}

/**
 * @param {SVGElement} svg
 * @param {{ isClosed:boolean, x2:number, baseY:number, barH:number, palette:* }} marker
 */
function drawWarBarEndMarker(svg, marker) {
  const { isClosed, x2, baseY, barH, palette } = marker;
  if (isClosed) {
    svg.appendChild(
      svgEl("line", {
        x1: x2,
        x2: x2,
        y1: baseY,
        y2: baseY + barH,
        stroke: "#1c1408",
        "stroke-width": "2"
      })
    );
    return;
  }

  svg.appendChild(
    svgEl("circle", {
      cx: x2,
      cy: baseY + barH / 2,
      r: 5,
      fill: palette.ongoing_marker,
      stroke: "#1c1408",
      "stroke-width": "0.5"
    })
  );
}

/**
 * @param {SVGElement} svg
 * @param {string} id
 * @param {string} color
 */
function appendTailGradient(svg, id, color) {
  const grad = svgEl("linearGradient", { id, x1: "0", y1: "0", x2: "1", y2: "0" });
  grad.appendChild(svgEl("stop", { offset: "0", "stop-color": color, "stop-opacity": "0.92" }));
  grad.appendChild(svgEl("stop", { offset: "1", "stop-color": color, "stop-opacity": "0" }));
  svg.appendChild(grad);
}

/**
 * @param {SVGElement} svg
 * @param {{
 *   stripes:*[], samples:*[], palette:*, xStart:number, xEnd:number, baseY:number, barH:number
 * }} args
 */
function drawWarBarTail(svg, args) {
  const { stripes, samples, palette, xStart, xEnd, baseY, barH } = args;
  const tailW = xEnd - xStart;
  if (tailW <= 1) return;

  svg.appendChild(
    svgEl("rect", {
      x: xStart,
      y: baseY,
      width: tailW,
      height: barH,
      fill: "#3a3d44",
      "fill-opacity": "0.5"
    })
  );

  const stripeH = barH / stripes.length;
  stripes.forEach((stripe, idx) => {
    const fill = resolveStripeFill(stripe, idx, samples, palette);
    const gradId = "demo-wartail-" + Math.round(baseY) + "-" + idx;
    appendTailGradient(svg, gradId, fill);
    svg.appendChild(
      svgEl("rect", {
        x: xStart,
        y: baseY + idx * stripeH,
        width: tailW,
        height: stripeH,
        fill: "url(#" + gradId + ")"
      })
    );
  });
}

/**
 * @param {SVGElement} svg
 * @param {{
 *   isClosed:boolean,
 *   L: any,
 *   dom:{xMin:number,xMax:number},
 *   stripes:*[],
 *   samples:*[],
 *   palette:*,
 *   x1:number,
 *   x2:number,
 *   baseY:number,
 *   barH:number,
 *   barW:number
 * }} args
 * @returns {number} Hover hit width.
 */
function drawWarTailOrEnd(svg, args) {
  const { isClosed, L, dom, stripes, samples, palette, x1, x2, baseY, barH, barW } = args;
  if (isClosed) {
    drawWarBarEndMarker(svg, { isClosed, x2, baseY, barH, palette });
    return barW;
  }

  const xTail = L.xOf(dom.xMax);
  drawWarBarTail(svg, { stripes, samples, palette, xStart: x2, xEnd: xTail, baseY, barH });
  return Math.max(barW, xTail - x1);
}

/**
 * @param {SVGElement} svg
 * @param {*} war
 * @param {{ baseY:number, barH:number }} row
 * @param {{ L:any, dom:{xMin:number,xMax:number}, latestTurn:number, samples:*[] }}
 *   ctx
 */
function drawWarBar(svg, war, row, ctx) {
  const { baseY, barH } = row;
  const { L, dom, latestTurn, samples } = ctx;
  const startTurn = war.startTurn;
  const isClosed = typeof war.endTurn === "number";
  const endTurn = isClosed ? war.endTurn : latestTurn;
  const x1 = L.xOf(Math.max(startTurn, dom.xMin));
  const x2 = L.xOf(Math.min(endTurn, dom.xMax));
  const palette = getSemantic();
  const stripes = resolveWarStripes(war, palette);
  const barW = Math.max(2, x2 - x1);

  drawWarBarStripes(svg, {
    stripes,
    samples,
    palette,
    x1,
    baseY,
    barW,
    barH,
    isClosed
  });

  svg.appendChild(
    svgEl("rect", {
      x: x1,
      y: baseY,
      width: barW,
      height: barH,
      fill: "none",
      stroke: "#1c1408",
      "stroke-width": "1"
    })
  );

  const hitW = drawWarTailOrEnd(svg, {
    isClosed,
    L,
    dom,
    stripes,
    samples,
    palette,
    x1,
    x2,
    baseY,
    barH,
    barW
  });
  return { war, x: x1, y: baseY, w: barW, h: barH, x2, isClosed, hitW };
}

/**
 * Draw every war bar and return the hover hit rectangles.
 * @param {SVGElement} svg
 * @param {*[]} filtered
 * @param {{
 *   L:any,
 *   dom:{xMin:number,xMax:number},
 *   tr:{min:number,max:number}|null,
 *   latestTurn:number,
 *   samples:*[]
 * }} ctx
 * @returns {*[]} Bar rects.
 */
export function drawWarBars(svg, filtered, ctx) {
  const { L, dom, tr: turnRange, latestTurn, samples } = ctx;
  /** @type {*[]} */
  const barRects = [];
  const barCtx = { L, dom, latestTurn, samples };
  for (let i = 0; i < filtered.length; i++) {
    const war = filtered[i];
    const endTurn = typeof war.endTurn === "number" ? war.endTurn : latestTurn;
    if (turnRange && (endTurn < turnRange.min || war.startTurn > turnRange.max)) continue;
    barRects.push(
      drawWarBar(
        svg,
        war,
        { baseY: L.rowTops[i], barH: L.rowHeights[i] },
        barCtx
      )
    );
  }
  return barRects;
}
