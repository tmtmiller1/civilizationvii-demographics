// chart-resources.js
//
// The resources stacked-area chart (one civ, resource-class bands stacked
// over time): collectResourceCivOptions + renderResourcesStack and their
// private layout / domain / drawing helpers. The bands / yAxisLabel options
// let it stack any band set.

import {
  log,
  SVG_NS,
  svgEl,
  historySamples,
  appendEmptyNotice,
  resolveLocalPid,
  resolveTurnRange,
  getXAxisMode,
  nearestByTurn,
  civOptionLabel,
  civDroppedByPolicy
} from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";
import {
  buildStackGridConfig,
  drawStackGrid,
  drawStackXTicks,
  mountStackAxisTitles,
  mountStackXTicks
} from "/demographics/ui/screen-demographics/charts/shared/chart-stack-grid.js";
import { t } from "/demographics/ui/core/demographics-i18n.js";

/**
 * @typedef {import(
 *   "/demographics/ui/screen-demographics/charts/line/chart-line.js"
 * ).ChartOptions} ChartOptions
 */

// Resources stacked-area chart: for each turn, stack the 5 resource-class
// counts (bonus, empire, city, factory, treasure). Compares categories, not civs.
const RESOURCE_BANDS = [
  { id: "resources_bonus", label: t("LOC_DEMOGRAPHICS_RESOURCE_BONUS"), color: "#7fb3e6" },
  { id: "resources_empire", label: t("LOC_DEMOGRAPHICS_RESOURCE_EMPIRE"), color: "#e6a23c" },
  { id: "resources_city", label: t("LOC_DEMOGRAPHICS_RESOURCE_CITY"), color: "#9ad17a" },
  { id: "resources_factory", label: t("LOC_DEMOGRAPHICS_RESOURCE_FACTORY"), color: "#c9a2dc" },
  { id: "resources_treasure", label: t("LOC_DEMOGRAPHICS_RESOURCE_TREASURE"), color: "#f3c34c" }
];

/**
 * Whether a metrics object carries any numeric resource-class value.
 * @param {Record<string, *>} metrics One civ's metrics.
 * @returns {boolean}
 */
function hasResourceMetric(metrics) {
  return (
    typeof metrics.resources_total === "number" ||
    typeof metrics.resources_bonus === "number" ||
    typeof metrics.resources_empire === "number" ||
    typeof metrics.resources_city === "number"
  );
}

/**
 * List every civ that has at least one sample with a resource value, for the
 * resources-stack viewer dropdown.
 * @param {DemoHistory|*} history
 * @returns {{ pid: string, label: string }[]}
 */
export function collectResourceCivOptions(history) {
  const samples = history && Array.isArray(history.samples) ? history.samples : [];
  /** @type {Map<string, { pid: string, label: string }>} */
  const seen = new Map();
  for (const sample of samples) {
    if (!sample?.players) continue;
    for (const pid of Object.keys(sample.players)) {
      // Governance: don't offer policy-hidden civs as a pickable target.
      if (civDroppedByPolicy(samples, pid)) continue;
      foldResourceCivOption(seen, sample.players[pid], pid);
    }
  }
  return Array.from(seen.values());
}

/**
 * Record a civ as a resource-stack option when it has a resource metric.
 * @param {Map<string, { pid: string, label: string }>} seen Mutated.
 * @param {CivSample|*} player One civ's sample.
 * @param {string} pid
 */
function foldResourceCivOption(seen, player, pid) {
  const metrics = player?.metrics;
  if (!metrics || !hasResourceMetric(metrics) || seen.has(pid)) return;
  seen.set(pid, { pid, label: civOptionLabel(player, pid) });
}

/**
 * A stacked-area band definition.
 * @typedef {Object} StackBand
 * @property {string} id Metric id.
 * @property {string} label Display label.
 * @property {string} color Band fill color.
 */

/**
 * One per-turn stack row.
 * @typedef {Object} StackPoint
 * @property {number|*} turn The turn.
 * @property {Record<string, number>} values Per-band values.
 */

/**
 * Stack-chart layout constants + plot rect.
 * @typedef {Object} StackLayout
 * @property {number} padL Left pad.
 * @property {number} padR Right pad.
 * @property {number} padT Top pad.
 * @property {number} padB Bottom pad.
 * @property {number} innerW Plot width.
 * @property {number} innerH Plot height.
 * @property {(t: number) => number} xOf Turn → pixel x.
 * @property {(v: number) => number} yOf Value → pixel y.
 */

/**
 * Resolve the band set: `opts.bands` when non-empty, else the resource bands.
 * @param {StackOptions|*} opts
 * @returns {StackBand[]}
 */
function resolveStackBands(opts) {
  return Array.isArray(opts.bands) && opts.bands.length > 0 ? opts.bands : RESOURCE_BANDS;
}

/**
 * Resolve the target pid whose resources to chart: explicit `viewerPid`, else
 * the local player, else `null` (first civ per sample).
 * @param {ChartOptions|*} opts
 * @returns {string|null} The target pid key, or `null`.
 */
function resolveStackTargetPid(opts) {
  if (opts.viewerPid !== undefined && opts.viewerPid !== null) return String(opts.viewerPid);
  const localPid = resolveLocalPid();
  return localPid !== undefined ? String(localPid) : null;
}

/**
 * Build the per-turn stack rows for the target civ across the bands. Rows with
 * no positive band value are skipped.
 * @param {Snapshot[]} samples
 * @param {string|null} targetPid The target pid (or null → first civ per row).
 * @param {StackBand[]} bands
 * @returns {StackPoint[]}
 */
function buildStackPoints(samples, targetPid, bands) {
  /** @type {StackPoint[]} */
  const points = [];
  for (const sample of samples) {
    if (!sample?.players) continue;
    const pid = targetPid ? targetPid : Object.keys(sample.players)[0];
    const player = sample.players[pid];
    if (!player?.metrics) continue;
    const row = buildStackRow(stackTurnOf(sample), player.metrics, bands);
    if (row) points.push(row);
  }
  return points;
}

/**
 * The continuous (cross-age) x value for a sample: the global `chartTurn` when
 * present, else the raw turn. `snapshot.turn` is age-local (resets each age), so
 * using it would overlap ages on one axis; chartTurn keeps the timeline linear.
 * @param {Snapshot|*} sample
 * @returns {number} The continuous turn value.
 */
function stackTurnOf(sample) {
  return typeof sample?.chartTurn === "number" ? sample.chartTurn : sample.turn;
}

/**
 * Build one stack row from a metrics object, or `null` when no band is
 * positive.
 * @param {number|*} turn
 * @param {Record<string, *>} metrics One civ's metrics.
 * @param {StackBand[]} bands
 * @returns {StackPoint|null}
 */
function buildStackRow(turn, metrics, bands) {
  /** @type {StackPoint} */
  const row = { turn, values: {} };
  let anyPositive = false;
  for (const band of bands) {
    const value = typeof metrics[band.id] === "number" && isFinite(metrics[band.id]) ? metrics[band.id] : 0;
    if (value > 0) anyPositive = true;
    row.values[band.id] = value;
  }
  return anyPositive ? row : null;
}

/**
 * Clamp the stack rows to a time range in place, when one is set.
 * @param {StackPoint[]} points The stack rows (mutated).
 * @param {ChartOptions|*} opts
 */
function clampStackPoints(points, opts) {
  const range = resolveTurnRange(opts);
  if (!range) return;
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].turn < range.min || points[i].turn > range.max) {
      points.splice(i, 1);
    }
  }
}

/**
 * Compute the stack chart's x/y domain from the rows.
 * @param {StackPoint[]} points
 * @param {StackBand[]} bands
 * @returns {{ xMin: number, xMax: number, yMax: number }}
 */
function computeStackDomain(points, bands) {
  let xMin = Infinity,
    xMax = -Infinity,
    yMax = 0;
  for (const point of points) {
    if (point.turn < xMin) xMin = point.turn;
    if (point.turn > xMax) xMax = point.turn;
    const stack = sumBands(point.values, bands);
    if (stack > yMax) yMax = stack;
  }
  if (!isFinite(xMin)) xMin = 0;
  if (!isFinite(xMax)) xMax = 1;
  if (xMin === xMax) xMax = xMin + 1;
  if (yMax <= 0) yMax = 1;
  return { xMin, xMax, yMax };
}

/**
 * @param {Record<string, number>} values Per-band values.
 * @param {StackBand[]} bands
 * @returns {number} The stacked total.
 */
function sumBands(values, bands) {
  let stack = 0;
  for (const band of bands) stack += values[band.id] || 0;
  return stack;
}

/**
 * Build the stack-chart layout (pads, plot size, x/y mappers).
 * @param {number} width Canvas width.
 * @param {number} height Canvas height.
 * @param {{ xMin: number, xMax: number, yMax: number }} domain
 * @returns {StackLayout}
 */
function buildStackLayout(width, height, domain) {
  const padL = 70,
    // The legend sits in a row above the chart, so the right margin only has to keep the last
    // x-tick label from clipping.
    padR = 40,
    padT = 30,
    padB = 64;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  return {
    padL,
    padR,
    padT,
    padB,
    innerW,
    innerH,
    xOf: (turn) => padL + ((turn - domain.xMin) / (domain.xMax - domain.xMin || 1)) * innerW,
    yOf: (value) => padT + innerH - (value / domain.yMax) * innerH
  };
}

/**
 * Draw the stacked-area band polygons bottom-up.
 * @param {SVGElement} svg
 * @param {StackPoint[]} points
 * @param {StackBand[]} bands
 * @param {StackLayout} layout
 */
function drawStackBands(svg, points, bands, layout) {
  // Each band is a polygon bounded above by (cum + band) and below by (cum);
  // then cum moves up.
  const cum = new Array(points.length).fill(0);
  for (const band of bands) {
    const upper = [];
    const lower = [];
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      const value = point.values[band.id] || 0;
      lower.push({ x: layout.xOf(point.turn), y: layout.yOf(cum[i]) });
      cum[i] += value;
      upper.push({ x: layout.xOf(point.turn), y: layout.yOf(cum[i]) });
    }
    // upper edge left→right, then lower edge right→left
    const outline =
      upper.map((corner) => corner.x + "," + corner.y).join(" ") +
      " " +
      lower
        .slice()
        .reverse()
        .map((corner) => corner.x + "," + corner.y)
        .join(" ");
    svg.appendChild(
      svgEl("polygon", {
        points: outline,
        fill: band.color,
        "fill-opacity": "0.7",
        stroke: band.color,
        "stroke-width": "1",
        "stroke-opacity": "0.9"
      })
    );
  }
}

/**
 * Build the stack chart's band legend as a horizontal row shown on top of the chart (matching the
 * other graphs). Each item is a color dot + the band label and its latest value.
 * @param {StackBand[]} bands
 * @param {StackPoint[]} points
 * @returns {HTMLElement}
 */
function buildStackLegendTop(bands, points) {
  const row = document.createElement("div");
  row.className = "demographics-resources-legend-top";
  row.style.cssText =
    "display:flex;flex-wrap:wrap;justify-content:center;align-items:center;" +
    "gap:0.25rem 1.2rem;width:100%;margin:0.2rem 0 0.4rem;";
  bands.forEach((band) => {
    const item = document.createElement("div");
    item.className = "demographics-chart-line-label demographics-resources-legend-label";
    item.style.cssText = "display:inline-flex;align-items:center;gap:0.35rem;position:static;";

    const dot = document.createElement("span");
    dot.className = "demographics-chart-line-label-dot";
    dot.style.backgroundColor = band.color;
    item.appendChild(dot);

    const label = document.createElement("span");
    label.className = "demographics-chart-line-label-text";
    const latest = points[points.length - 1]?.values?.[band.id] || 0;
    label.textContent = band.label + " , " + latest;
    item.appendChild(label);

    row.appendChild(item);
  });
  return row;
}

/**
 * Options accepted by {@link renderResourcesStack}.
 * @typedef {Object} StackOptions
 * @property {DemoHistory|*} [history] The history blob.
 * @property {StackBand[]} [bands] Override band set.
 * @property {number} [width] Canvas width.
 * @property {number} [height] Canvas height.
 * @property {number|string} [viewerPid] Which civ to chart.
 * @property {{ min: number, max: number }} [turnRange] Time-range filter.
 * @property {string} [yAxisLabel] Y-axis title override.
 */

/**
 * Render the resources stacked-area chart (one civ, bands stacked over time)
 * into `host`. The `bands` / `yAxisLabel` options generalize it for arbitrary
 * stacked band sets.
 * @param {HTMLElement} host The view host element (cleared and repopulated).
 * @param {StackOptions} [options]
 * @returns {{ svg: SVGElement }|null} The mounted SVG handle, or `null`.
 */
export function renderResourcesStack(host, options) {
  const setup = prepareResourcesStackRender(host, options);
  if (!setup) return null;
  const { hostEl, opts, bands, width, height, samples } = setup;
  if (!guardSamplesPresent(hostEl, samples)) return null;
  // viewerPid (option) lets the caller pick which civ's stacked resources to
  // chart; defaults to the local player so the panel "just works" on first open.
  const points = buildStackPoints(samples, resolveStackTargetPid(opts), bands);
  clampStackPoints(points, opts);
  if (!guardPointsPresent(hostEl, points)) return null;

  const domain = computeStackDomain(points, bands);
  const layout = buildStackLayout(width, height, domain);
  const dims = { L: layout, dom: domain, W: width, H: height };
  const { svg, tickPositions } = buildStackSvg(samples, points, bands, dims);
  const wrap = mountStackWrap(svg, opts, { tickPositions }, { L: layout, W: width, H: height });

  // Band legend on top of the chart (like the other graphs), then the chart wrap below it.
  hostEl.appendChild(buildStackLegendTop(bands, points));
  hostEl.appendChild(wrap);
  log.debug("resources stacked area mounted; turns=", points.length, "yMax=", domain.yMax);
  return { svg };
}

/**
 * Prepare host/options/band setup for a stack render pass.
 * @param {HTMLElement} host
 * @param {StackOptions|undefined} options
 * @returns {{
 *   hostEl: HTMLElement,
 *   opts: StackOptions,
 *   bands: StackBand[],
 *   width: number,
 *   height: number,
 *   samples: Snapshot[],
 * }|null} Prepared setup.
 */
function prepareResourcesStackRender(host, options) {
  if (!host) return null;
  while (host.firstChild) host.removeChild(host.firstChild);
  const opts = options || {};
  const bands = resolveStackBands(opts);
  const width = opts.width || 1400;
  const height = opts.height || 600;
  const samples = historySamples(opts.history);
  return { hostEl: host, opts, bands, width, height, samples };
}

/**
 * Renders the empty notice when there are no samples.
 * @param {HTMLElement} host
 * @param {Snapshot[]} samples
 * @returns {boolean} True when rendering can continue.
 */
function guardSamplesPresent(host, samples) {
  if (samples.length > 0) return true;
  appendEmptyNotice(host, t("LOC_DEMOGRAPHICS_EMPTY_NO_SAMPLES"));
  return false;
}

/**
 * Renders the empty notice when filtering left no stack points.
 * @param {HTMLElement} host
 * @param {StackPoint[]} points
 * @returns {boolean} True when rendering can continue.
 */
function guardPointsPresent(host, points) {
  if (points.length > 0) return true;
  appendEmptyNotice(host, t("LOC_DEMOGRAPHICS_EMPTY_NO_RESOURCE_SAMPLES"));
  return false;
}

/**
 * Build the chart wrap and mount the SVG + axis titles + x-tick labels +
 * band legend overlays.
 * @param {SVGElement} svg
 * @param {StackOptions} opts For yAxisLabel.
 * @param {{ tickPositions: { t: number, x: number, year: string|null, labelY: number }[] }} data
 *   The x-tick positions (the band legend mounts on top of the chart, outside this wrap).
 * @param {{ L: StackLayout, W: number, H: number }} dims Layout + canvas size.
 * @returns {HTMLElement}
 */
function mountStackWrap(svg, opts, data, dims) {
  const { tickPositions } = data;
  const { L, W, H } = dims;
  const wrap = document.createElement("div");
  wrap.className = "demographics-chart-wrap";
  wrap.appendChild(svg);
  // Callers can override the y-axis title via opts.yAxisLabel (e.g. a band-set
  // reuse that stacks something other than resources).
  const yAxisLabel =
    typeof opts.yAxisLabel === "string" && opts.yAxisLabel
      ? opts.yAxisLabel
      : t("LOC_DEMOGRAPHICS_AXIS_RESOURCES_ASSIGNED");
  mountStackAxisTitles(wrap, {
    L,
    W,
    H,
    xClassName:
      "demographics-chart-axis-title demographics-chart-axis-x " +
      "demographics-resources-axis-title demographics-resources-axis-x",
    yClassName:
      "demographics-chart-axis-title demographics-chart-axis-y " +
      "demographics-resources-axis-title demographics-resources-axis-y",
    xText: t("LOC_DEMOGRAPHICS_AXIS_TIME"),
    yText: yAxisLabel
  });
  mountStackXTicks(wrap, tickPositions, {
    W,
    H,
    mode: /** @type {"turn"|"year"|"both"} */ (getXAxisMode()),
    className: "demographics-chart-x-tick demographics-resources-x-tick"
  });
  return wrap;
}

/**
 * Build the stack chart SVG (background grid, X-ticks, band polygons).
 * @param {Snapshot[]} samples
 * @param {StackPoint[]} points
 * @param {StackBand[]} bands
 * @param {{ L: StackLayout, dom: { xMin: number, xMax: number, yMax: number },
 *   W: number, H: number }} dims Layout, domain, and canvas size.
 * @returns {{ svg: SVGElement, tickPositions: { t: number, x: number,
 *   year: string|null, labelY: number }[] }}
 *   The SVG and the x-tick positions for HTML overlays.
 */
function buildStackSvg(samples, points, bands, dims) {
  const { L: layout, dom: domain, W: width, H: height } = dims;
  const svg = svgEl("svg", {
    xmlns: SVG_NS,
    viewBox: `0 0 ${width} ${height}`,
    width: String(width),
    height: String(height),
    preserveAspectRatio: "none",
    class: "demographics-chart-svg",
    "aria-label": t("LOC_DEMOGRAPHICS_ARIA_RESOURCES_TIMELINE")
  });
  const gridCfg = buildStackGridConfig();
  drawStackGrid(svg, layout, domain.yMax, gridCfg, svgEl);
  const stackTurnYears = buildStackTurnYearMap(samples);
  const tickPositions = drawStackXTicks(
    svg,
    { L: layout, dom: domain, turnYearMap: stackTurnYears },
    { cfg: gridCfg, nearestByTurn, svgEl }
  );
  drawStackBands(svg, points, bands, layout);
  drawStackAgeLines(svg, samples, layout, domain);
  return { svg, tickPositions };
}

/**
 * A chartTurn-keyed turn → game-year map (the shared buildStackTurnYears keys by
 * the age-local turn, which doesn't match this chart's continuous x).
 * @param {Snapshot[]} samples
 * @returns {Map<number, string>} chartTurn → game-year.
 */
function buildStackTurnYearMap(samples) {
  /** @type {Map<number, string>} */
  const map = new Map();
  for (const sample of samples) {
    if (sample && typeof sample.gameYear === "string" && sample.gameYear.length > 0) {
      map.set(stackTurnOf(sample), sample.gameYear);
    }
  }
  return map;
}

/**
 * Draw a purple vertical divider at each age transition (where a sample's age
 * differs from the previous one), matching the historical line charts' age
 * markers. (Coherent ignores SVG stroke-dasharray, so the line is solid.)
 * @param {SVGElement} svg
 * @param {Snapshot[]} samples
 * @param {StackLayout} layout
 * @param {{ xMin: number, xMax: number, yMax: number }} domain
 */
function drawStackAgeLines(svg, samples, layout, domain) {
  let prevAge = null;
  for (const sample of samples) {
    const age = sample && typeof sample.age === "string" ? sample.age : null;
    if (prevAge !== null && age !== null && age !== prevAge) {
      const turn = stackTurnOf(sample);
      if (turn >= domain.xMin && turn <= domain.xMax) {
        svg.appendChild(
          svgEl("line", {
            x1: layout.xOf(turn),
            y1: layout.padT,
            x2: layout.xOf(turn),
            y2: layout.padT + layout.innerH,
            stroke: "#b78cff",
            "stroke-width": "1.8",
            "stroke-opacity": "0.9"
          })
        );
      }
    }
    if (age !== null) prevAge = age;
  }
}
