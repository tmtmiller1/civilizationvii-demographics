// chart-wars-gantt-bars.js
//
// War bar rendering helpers for wars Gantt chart.

import { getSemantic } from "/demographics/ui/core/demographics-palette.js";
import { svgEl } from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";
import { majorsOnSide } from "/demographics/ui/screen-demographics/charts/wars/chart-wars-naming.js";

/**
 * Look up latest sampled primary color for one player id.
 * @param {*[]} samples Sample stream.
 * @param {*} pid Player id.
 * @returns {string} Resolved color.
 */
function currentPrimaryColor(samples, pid) {
  for (let i = samples.length - 1; i >= 0; i--) {
    const ps = samples[i]?.players?.[pid];
    if (ps && typeof ps.primaryColor === "string" && ps.primaryColor.length > 0) {
      return ps.primaryColor;
    }
  }
  return "#9aa8c8";
}

/**
 * Resolve fill color for one stripe.
 * @param {*} stripe Stripe entry.
 * @param {number} idx Stripe index.
 * @param {*[]} samples Sample stream.
 * @param {*} sem Semantic palette.
 * @returns {string} Stripe color.
 */
function resolveStripeFill(stripe, idx, samples, sem) {
  return (
    (typeof stripe.pid === "number" && currentPrimaryColor(samples, stripe.pid)) ||
    stripe.color ||
    (idx % 2 === 0 ? sem.sideA_fallback : sem.sideB_fallback)
  );
}

/**
 * Resolve participant stripes for one war.
 * @param {*} war War record.
 * @param {*} sem Semantic palette.
 * @returns {*[]} Stripe list.
 */
function resolveWarStripes(war, sem) {
  const participants = /** @type {any[]} */ ([]).concat(
    majorsOnSide(war.sideACivs),
    majorsOnSide(war.sideBCivs)
  );
  if (participants.length > 0) return participants;
  return [
    { pid: null, color: sem.sideA_fallback },
    { pid: null, color: sem.sideB_fallback }
  ];
}

/**
 * Draw one bar's participant stripes.
 * @param {SVGElement} svg Chart svg.
 * @param {Object} args Stripe drawing args.
 * @param {*[]} args.stripes Stripe entries.
 * @param {*[]} args.samples Sample stream.
 * @param {*} args.sem Semantic palette.
 * @param {number} args.x1 Left x.
 * @param {number} args.baseY Top y.
 * @param {number} args.barW Bar width.
 * @param {number} args.barH Bar height.
 * @param {boolean} args.isClosed Closed-war flag.
 */
function drawWarBarStripes(svg, args) {
  const { stripes, samples, sem, x1, baseY, barW, barH, isClosed } = args;
  const stripeH = barH / stripes.length;

  stripes.forEach((stripe, idx) => {
    const fill = resolveStripeFill(stripe, idx, samples, sem);
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

  for (let s = 1; s < stripes.length; s++) {
    svg.appendChild(
      svgEl("line", {
        x1: x1,
        x2: x1 + barW,
        y1: baseY + s * stripeH,
        y2: baseY + s * stripeH,
        stroke: "rgba(28, 20, 8, 0.55)",
        "stroke-width": "0.7"
      })
    );
  }
}

/**
 * Draw right-edge marker for one bar.
 * @param {SVGElement} svg Chart svg.
 * @param {{ isClosed:boolean, x2:number, baseY:number, barH:number, sem:* }} m Marker args.
 */
function drawWarBarEndMarker(svg, m) {
  const { isClosed, x2, baseY, barH, sem } = m;
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
      fill: sem.ongoing_marker,
      stroke: "#1c1408",
      "stroke-width": "0.5"
    })
  );
}

/**
 * Append one tail gradient definition.
 * @param {SVGElement} svg Chart svg.
 * @param {string} id Gradient id.
 * @param {string} color Stripe color.
 */
function appendTailGradient(svg, id, color) {
  const grad = svgEl("linearGradient", { id, x1: "0", y1: "0", x2: "1", y2: "0" });
  grad.appendChild(svgEl("stop", { offset: "0", "stop-color": color, "stop-opacity": "0.92" }));
  grad.appendChild(svgEl("stop", { offset: "1", "stop-color": color, "stop-opacity": "0" }));
  svg.appendChild(grad);
}

/**
 * Draw ongoing-war tail.
 * @param {SVGElement} svg Chart svg.
 * @param {{
 *   stripes:*[], samples:*[], sem:*, xStart:number, xEnd:number, baseY:number, barH:number
 * }} args Tail args.
 */
function drawWarBarTail(svg, args) {
  const { stripes, samples, sem, xStart, xEnd, baseY, barH } = args;
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
    const fill = resolveStripeFill(stripe, idx, samples, sem);
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
 * Draw tail for ongoing wars or end marker for concluded wars.
 * @param {SVGElement} svg Chart svg.
 * @param {{
 *   isClosed:boolean,
 *   L: any,
 *   dom:{xMin:number,xMax:number},
 *   stripes:*[],
 *   samples:*[],
 *   sem:*,
 *   x1:number,
 *   x2:number,
 *   baseY:number,
 *   barH:number,
 *   barW:number
 * }} args Tail/end args.
 * @returns {number} Hover hit width.
 */
function drawWarTailOrEnd(svg, args) {
  const { isClosed, L, dom, stripes, samples, sem, x1, x2, baseY, barH, barW } = args;
  if (isClosed) {
    drawWarBarEndMarker(svg, { isClosed, x2, baseY, barH, sem });
    return barW;
  }

  const xTail = L.xOf(dom.xMax);
  drawWarBarTail(svg, { stripes, samples, sem, xStart: x2, xEnd: xTail, baseY, barH });
  return Math.max(barW, xTail - x1);
}

/**
 * Draw one war bar and return hover rect.
 * @param {SVGElement} svg Chart svg.
 * @param {*} war War record.
 * @param {{ baseY:number, barH:number }} row Row geometry.
 * @param {{ L:any, dom:{xMin:number,xMax:number}, latestTurn:number, samples:*[] }}
 *   ctx Shared context.
 * @returns {{
 *   war:*, x:number, y:number, w:number, h:number,
 *   x2:number, isClosed:boolean, hitW:number
 * }} Rect.
 */
function drawWarBar(svg, war, row, ctx) {
  const { baseY, barH } = row;
  const { L, dom, latestTurn, samples } = ctx;
  const sTurn = war.startTurn;
  const isClosed = typeof war.endTurn === "number";
  const eTurn = isClosed ? war.endTurn : latestTurn;
  const x1 = L.xOf(Math.max(sTurn, dom.xMin));
  const x2 = L.xOf(Math.min(eTurn, dom.xMax));
  const sem = getSemantic();
  const stripes = resolveWarStripes(war, sem);
  const barW = Math.max(2, x2 - x1);

  drawWarBarStripes(svg, {
    stripes,
    samples,
    sem,
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
    sem,
    x1,
    x2,
    baseY,
    barH,
    barW
  });
  return { war, x: x1, y: baseY, w: barW, h: barH, x2, isClosed, hitW };
}

/**
 * Draw all war bars and return hover hit rectangles.
 * @param {SVGElement} svg Chart svg.
 * @param {*[]} filtered Filtered wars.
 * @param {{
 *   L:any,
 *   dom:{xMin:number,xMax:number},
 *   tr:{min:number,max:number}|null,
 *   latestTurn:number,
 *   samples:*[]
 * }} ctx Render context.
 * @returns {*[]} Bar rects.
 */
export function drawWarBars(svg, filtered, ctx) {
  const { L, dom, tr, latestTurn, samples } = ctx;
  /** @type {*[]} */
  const barRects = [];
  const barCtx = { L, dom, latestTurn, samples };
  for (let i = 0; i < filtered.length; i++) {
    const war = filtered[i];
    const eTurn = typeof war.endTurn === "number" ? war.endTurn : latestTurn;
    if (tr && (eTurn < tr.min || war.startTurn > tr.max)) continue;
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
