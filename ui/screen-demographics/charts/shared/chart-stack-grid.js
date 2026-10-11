// chart-stack-grid.js
// Shared grid, x-tick, and axis-title helpers for stack-style SVG charts.

import { localYear, turnLabel } from "/demographics/ui/core/demographics-i18n.js";

/**
 * @param {Partial<StackGridConfig>} [overrides]
 * @returns {StackGridConfig} The defaults merged with `overrides`.
 */
export function buildStackGridConfig(overrides = {}) {
  return {
    plotFill: "rgba(20, 16, 10, 0.55)",
    plotStroke: "#c9a24c",
    plotStrokeWidth: "1",
    yGridStroke: "rgba(201, 162, 76, 0.18)",
    yGridStrokeWidth: "1",
    yLabelFill: "rgba(243, 231, 196, 0.85)",
    yLabelFontSize: "12",
    xTickStroke: "#f3e7c4",
    xTickStrokeWidth: "1",
    xTickBottomLen: 4,
    xTicks: 6,
    yTicks: 4,
    drawYGrid: true,
    drawYLabels: true,
    drawXVerticalGrid: false,
    xVerticalGridStroke: "rgba(133, 135, 140, 0.35)",
    xVerticalGridStrokeWidth: "1",
    tickLabelYOffset: 8,
    ...overrides
  };
}

/**
 * Draw the plot background and optional y-grid lines + labels.
 * @param {SVGElement} svg
 * @param {{ padL:number, padT:number, innerW:number, innerH:number,
 *   yOf:(v:number)=>number }} layout
 * @param {number} yMax
 * @param {StackGridConfig} cfg
 * @param {(tag:string, attrs:Record<string, string|number>) => SVGElement}
 *   svgEl
 */
export function drawStackGrid(svg, layout, yMax, cfg, svgEl) {
  svg.appendChild(
    svgEl("rect", {
      x: layout.padL,
      y: layout.padT,
      width: layout.innerW,
      height: layout.innerH,
      fill: cfg.plotFill,
      stroke: cfg.plotStroke,
      "stroke-width": cfg.plotStrokeWidth
    })
  );

  if (!cfg.drawYGrid) return;
  const yTicks = Math.max(0, cfg.yTicks);
  for (let i = 0; i <= yTicks; i++) {
    const value = yTicks === 0 ? 0 : (yMax * i) / yTicks;
    const y = layout.yOf(value);
    svg.appendChild(
      svgEl("line", {
        x1: layout.padL,
        y1: y,
        x2: layout.padL + layout.innerW,
        y2: y,
        stroke: cfg.yGridStroke,
        "stroke-width": cfg.yGridStrokeWidth
      })
    );
    if (!cfg.drawYLabels) continue;
    const label = svgEl("text", {
      x: layout.padL - 6,
      y: y + 4,
      fill: cfg.yLabelFill,
      "font-size": cfg.yLabelFontSize,
      "text-anchor": "end"
    });
    label.textContent = String(Math.round(value));
    svg.appendChild(label);
  }
}

/**
 * Draw x-axis ticks and return HTML-overlay positions.
 * @param {SVGElement} svg
 * @param {{ L: { padT:number, innerH:number, xOf:(t:number)=>number },
 *   dom: { xMin:number, xMax:number }, turnYearMap: Map<number, string> }} axis
 *   Chart layout, x-domain, and turn-to-year map.
 * @param {{ cfg: StackGridConfig,
 *   nearestByTurn: (turnMap:Map<number, string>, t:number)=>string|null,
 *   svgEl: (tag:string, attrs:Record<string, string|number>) => SVGElement }} deps
 *   Grid config + injected helper functions.
 * @returns {{ t:number, x:number, year:string|null, labelY:number }[]} Tick positions.
 */
export function drawStackXTicks(svg, axis, deps) {
  const { L: layout, dom: domain, turnYearMap } = axis;
  const { cfg, nearestByTurn, svgEl } = deps;
  const xTicks = Math.max(1, cfg.xTicks);
  /** @type {{ t:number, x:number, year:string|null, labelY:number }[]} */
  const ticks = [];
  for (let i = 0; i <= xTicks; i++) {
    const turn = Math.round(domain.xMin + ((domain.xMax - domain.xMin) * i) / xTicks);
    const x = layout.xOf(turn);
    svg.appendChild(
      svgEl("line", {
        x1: x,
        x2: x,
        y1: layout.padT + layout.innerH,
        y2: layout.padT + layout.innerH + cfg.xTickBottomLen,
        stroke: cfg.xTickStroke,
        "stroke-width": cfg.xTickStrokeWidth
      })
    );
    if (cfg.drawXVerticalGrid) {
      svg.appendChild(
        svgEl("line", {
          x1: x,
          x2: x,
          y1: layout.padT,
          y2: layout.padT + layout.innerH,
          stroke: cfg.xVerticalGridStroke,
          "stroke-width": cfg.xVerticalGridStrokeWidth
        })
      );
    }
    ticks.push({
      t: turn,
      x,
      year: nearestByTurn(turnYearMap, turn),
      labelY: layout.padT + layout.innerH + cfg.tickLabelYOffset
    });
  }
  return ticks;
}

/**
 * Mount x-axis tick labels as HTML overlays.
 * @param {HTMLElement} wrap
 * @param {{ t:number, x:number, year:string|null, labelY:number }[]} ticks
 * @param {{ W:number, H:number, mode:"turn"|"year"|"both",
 *   className:string, turnParenWhenBoth?:boolean }} opts
 */
export function mountStackXTicks(wrap, ticks, opts) {
  for (const tick of ticks) {
    const div = document.createElement("div");
    div.className = opts.className;
    div.style.left = (tick.x / opts.W) * 100 + "%";
    div.style.top = (tick.labelY / opts.H) * 100 + "%";

    if (opts.mode !== "turn" && tick.year) {
      const yearEl = document.createElement("div");
      yearEl.className = "demographics-chart-x-tick-year";
      yearEl.textContent = localYear(tick.year);
      div.appendChild(yearEl);
    }

    if (opts.mode !== "year" || !tick.year) {
      appendTickTurn(div, tick.t, !!(opts.turnParenWhenBoth && opts.mode === "both" && tick.year));
    }

    wrap.appendChild(div);
  }
}

/**
 * Mount chart axis-title overlays.
 * @param {HTMLElement} wrap
 * @param {{ L:{padL:number,innerW:number,padT:number,innerH:number},
 *   W:number, H:number, xClassName:string, yClassName:string,
 *   xText:string, yText:string }} opts
 */
export function mountStackAxisTitles(wrap, opts) {
  const layout = opts.L;
  const xTitle = document.createElement("div");
  xTitle.className = opts.xClassName;
  xTitle.style.left = ((layout.padL + layout.innerW / 2) / opts.W) * 100 + "%";
  xTitle.style.top = ((opts.H - 4) / opts.H) * 100 + "%";
  xTitle.textContent = opts.xText;
  wrap.appendChild(xTitle);

  const yTitle = document.createElement("div");
  yTitle.className = opts.yClassName;
  yTitle.style.left = (12 / opts.W) * 100 + "%";
  yTitle.style.top = ((layout.padT + layout.innerH / 2) / opts.H) * 100 + "%";
  yTitle.textContent = opts.yText;
  wrap.appendChild(yTitle);
}

/**
 * @typedef {Object} StackGridConfig
 * @property {string} plotFill
 * @property {string} plotStroke
 * @property {string|number} plotStrokeWidth
 * @property {string} yGridStroke
 * @property {string|number} yGridStrokeWidth
 * @property {string} yLabelFill
 * @property {string|number} yLabelFontSize
 * @property {string} xTickStroke
 * @property {string|number} xTickStrokeWidth
 * @property {number} xTickBottomLen
 * @property {number} xTicks
 * @property {number} yTicks
 * @property {boolean} drawYGrid
 * @property {boolean} drawYLabels
 * @property {boolean} drawXVerticalGrid
 * @property {string} xVerticalGridStroke
 * @property {string|number} xVerticalGridStrokeWidth
 * @property {number} tickLabelYOffset
 */

/**
 * Append a turn sub-label to an x-tick container.
 * @param {HTMLElement} div
 * @param {number} turn
 * @param {boolean} parenthesize Whether to use `(T-n)` format.
 */
function appendTickTurn(div, turn, parenthesize) {
  const turnEl = document.createElement("div");
  turnEl.className = "demographics-chart-x-tick-turn";
  turnEl.textContent = parenthesize ? "(" + turnLabel(turn) + ")" : turnLabel(turn);
  div.appendChild(turnEl);
}
