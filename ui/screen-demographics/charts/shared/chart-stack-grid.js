// chart-stack-grid.js
// Shared grid, x-tick, and axis-title helpers for stack-style SVG charts.

/**
 * Build a normalized stack-grid configuration object.
 * @param {Partial<StackGridConfig>} [overrides] Optional config overrides.
 * @returns {StackGridConfig} The merged grid config.
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
 * @param {SVGElement} svg Chart SVG element.
 * @param {{ padL:number, padT:number, innerW:number, innerH:number,
 *   yOf:(v:number)=>number }} L Chart layout.
 * @param {number} yMax Maximum y-domain value.
 * @param {StackGridConfig} cfg Grid configuration.
 * @param {(tag:string, attrs:Record<string, string|number>) => SVGElement}
 *   svgEl SVG builder helper.
 */
export function drawStackGrid(svg, L, yMax, cfg, svgEl) {
  svg.appendChild(
    svgEl("rect", {
      x: L.padL,
      y: L.padT,
      width: L.innerW,
      height: L.innerH,
      fill: cfg.plotFill,
      stroke: cfg.plotStroke,
      "stroke-width": cfg.plotStrokeWidth
    })
  );

  if (!cfg.drawYGrid) return;
  const yTicks = Math.max(0, cfg.yTicks);
  for (let i = 0; i <= yTicks; i++) {
    const v = yTicks === 0 ? 0 : (yMax * i) / yTicks;
    const y = L.yOf(v);
    svg.appendChild(
      svgEl("line", {
        x1: L.padL,
        y1: y,
        x2: L.padL + L.innerW,
        y2: y,
        stroke: cfg.yGridStroke,
        "stroke-width": cfg.yGridStrokeWidth
      })
    );
    if (!cfg.drawYLabels) continue;
    const lbl = svgEl("text", {
      x: L.padL - 6,
      y: y + 4,
      fill: cfg.yLabelFill,
      "font-size": cfg.yLabelFontSize,
      "text-anchor": "end"
    });
    lbl.textContent = String(Math.round(v));
    svg.appendChild(lbl);
  }
}

/**
 * Draw x-axis ticks and return HTML-overlay positions.
 * @param {SVGElement} svg Chart SVG element.
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
  const { L, dom, turnYearMap } = axis;
  const { cfg, nearestByTurn, svgEl } = deps;
  const xTicks = Math.max(1, cfg.xTicks);
  /** @type {{ t:number, x:number, year:string|null, labelY:number }[]} */
  const ticks = [];
  for (let i = 0; i <= xTicks; i++) {
    const t = Math.round(dom.xMin + ((dom.xMax - dom.xMin) * i) / xTicks);
    const x = L.xOf(t);
    svg.appendChild(
      svgEl("line", {
        x1: x,
        x2: x,
        y1: L.padT + L.innerH,
        y2: L.padT + L.innerH + cfg.xTickBottomLen,
        stroke: cfg.xTickStroke,
        "stroke-width": cfg.xTickStrokeWidth
      })
    );
    if (cfg.drawXVerticalGrid) {
      svg.appendChild(
        svgEl("line", {
          x1: x,
          x2: x,
          y1: L.padT,
          y2: L.padT + L.innerH,
          stroke: cfg.xVerticalGridStroke,
          "stroke-width": cfg.xVerticalGridStrokeWidth
        })
      );
    }
    ticks.push({
      t,
      x,
      year: nearestByTurn(turnYearMap, t),
      labelY: L.padT + L.innerH + cfg.tickLabelYOffset
    });
  }
  return ticks;
}

/**
 * Mount x-axis tick labels as HTML overlays.
 * @param {HTMLElement} wrap Chart wrap element.
 * @param {{ t:number, x:number, year:string|null, labelY:number }[]} ticks Tick positions.
 * @param {{ W:number, H:number, mode:"turn"|"year"|"both",
 *   className:string, turnParenWhenBoth?:boolean }} opts Render options.
 */
export function mountStackXTicks(wrap, ticks, opts) {
  for (const tick of ticks) {
    const div = document.createElement("div");
    div.className = opts.className;
    div.style.left = (tick.x / opts.W) * 100 + "%";
    div.style.top = (tick.labelY / opts.H) * 100 + "%";

    if (opts.mode !== "turn" && tick.year) {
      const yr = document.createElement("div");
      yr.className = "demographics-chart-x-tick-year";
      yr.textContent = tick.year;
      div.appendChild(yr);
    }

    if (opts.mode !== "year" || !tick.year) {
      appendTickTurn(div, tick.t, !!(opts.turnParenWhenBoth && opts.mode === "both" && tick.year));
    }

    wrap.appendChild(div);
  }
}

/**
 * Mount chart axis-title overlays.
 * @param {HTMLElement} wrap Chart wrap element.
 * @param {{ L:{padL:number,innerW:number,padT:number,innerH:number},
 *   W:number, H:number, xClassName:string, yClassName:string,
 *   xText:string, yText:string }} opts Axis render options.
 */
export function mountStackAxisTitles(wrap, opts) {
  const xTitle = document.createElement("div");
  xTitle.className = opts.xClassName;
  xTitle.style.left = ((opts.L.padL + opts.L.innerW / 2) / opts.W) * 100 + "%";
  xTitle.style.top = ((opts.H - 4) / opts.H) * 100 + "%";
  xTitle.textContent = opts.xText;
  wrap.appendChild(xTitle);

  const yTitle = document.createElement("div");
  yTitle.className = opts.yClassName;
  yTitle.style.left = (12 / opts.W) * 100 + "%";
  yTitle.style.top = ((opts.L.padT + opts.L.innerH / 2) / opts.H) * 100 + "%";
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
 * @param {HTMLElement} div Tick container.
 * @param {number} turn Turn number.
 * @param {boolean} parenthesize Whether to use `(T-n)` format.
 */
function appendTickTurn(div, turn, parenthesize) {
  const tn = document.createElement("div");
  tn.className = "demographics-chart-x-tick-turn";
  tn.textContent = parenthesize ? `(T-${turn})` : `T-${turn}`;
  div.appendChild(tn);
}
