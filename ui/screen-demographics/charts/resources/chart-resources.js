// chart-resources.js
//
// The resources stacked-area chart (one civ, resource-class bands stacked
// over time): collectResourceCivOptions + renderResourcesStack and their
// private layout / domain / drawing helpers. Reused by the triumph stack via
// the bands / yAxisLabel options. Migrated verbatim from demographics-chart.js.

import {
  dlog,
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

// Resources stacked-area chart - LOCAL player only. For each turn, stack
// the 5 resource-class counts (bonus, empire, city, factory, treasure) so
// the user can see how their resource allocation strategy evolved over the
// course of the game. Compares CATEGORIES, not civs.
const RESOURCE_BANDS = [
  { id: "resources_bonus", label: t("LOC_DEMOGRAPHICS_RESOURCE_BONUS"), color: "#7fb3e6" },
  { id: "resources_empire", label: t("LOC_DEMOGRAPHICS_RESOURCE_EMPIRE"), color: "#e6a23c" },
  { id: "resources_city", label: t("LOC_DEMOGRAPHICS_RESOURCE_CITY"), color: "#9ad17a" },
  { id: "resources_factory", label: t("LOC_DEMOGRAPHICS_RESOURCE_FACTORY"), color: "#c9a2dc" },
  { id: "resources_treasure", label: t("LOC_DEMOGRAPHICS_RESOURCE_TREASURE"), color: "#f3c34c" }
];

/**
 * Whether a metrics object carries any resource-class value.
 * @param {Record<string, *>} m One civ's metrics.
 * @returns {boolean} True when any resource metric is numeric.
 */
function hasResourceMetric(m) {
  return (
    typeof m.resources_total === "number" ||
    typeof m.resources_bonus === "number" ||
    typeof m.resources_empire === "number" ||
    typeof m.resources_city === "number"
  );
}

// Collect all civs that have at least one sample with any resource value,
// so the resources stack viewer dropdown can list them by leader name.
/**
 * List every civ that has at least one sample with a resource value, for the
 * resources-stack viewer dropdown.
 * @param {DemoHistory|*} history The history blob.
 * @returns {{ pid: string, label: string }[]} The civ options.
 */
export function collectResourceCivOptions(history) {
  const samps = history && Array.isArray(history.samples) ? history.samples : [];
  /** @type {Map<string, { pid: string, label: string }>} */
  const seen = new Map();
  for (const s of samps) {
    if (!s?.players) continue;
    for (const pid of Object.keys(s.players)) {
      // Governance (P0.1): don't offer policy-hidden civs as a pickable target.
      if (civDroppedByPolicy(samps, pid)) continue;
      foldResourceCivOption(seen, s.players[pid], pid);
    }
  }
  return Array.from(seen.values());
}

/**
 * Record a civ as a resource-stack option when it has a resource metric.
 * @param {Map<string, { pid: string, label: string }>} seen Options map (mutated).
 * @param {CivSample|*} ps One civ's sample.
 * @param {string} pid Player id key.
 */
function foldResourceCivOption(seen, ps, pid) {
  const m = ps?.metrics;
  if (!m || !hasResourceMetric(m) || seen.has(pid)) return;
  seen.set(pid, { pid, label: civOptionLabel(ps, pid) });
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
 * @param {StackOptions|*} opts The render options.
 * @returns {StackBand[]} The band set.
 */
function resolveStackBands(opts) {
  return Array.isArray(opts.bands) && opts.bands.length > 0 ? opts.bands : RESOURCE_BANDS;
}

/**
 * Resolve the target pid whose resources to chart: explicit `viewerPid`, else
 * the local player, else `null` (first civ per sample).
 * @param {ChartOptions|*} opts The render options.
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
 * @param {Snapshot[]} samples The sample stream.
 * @param {string|null} targetPid The target pid (or null → first civ per row).
 * @param {StackBand[]} bands The band set.
 * @returns {StackPoint[]} The stack rows.
 */
function buildStackPoints(samples, targetPid, bands) {
  /** @type {StackPoint[]} */
  const points = [];
  for (const s of samples) {
    if (!s?.players) continue;
    const pid = targetPid ? targetPid : Object.keys(s.players)[0];
    const ps = s.players[pid];
    if (!ps?.metrics) continue;
    const row = buildStackRow(stackTurnOf(s), ps.metrics, bands);
    if (row) points.push(row);
  }
  return points;
}

/**
 * The continuous (cross-age) x value for a sample: the global `chartTurn` when
 * present, else the raw turn. `snapshot.turn` is AGE-LOCAL (resets each age), so
 * using it would overlap ages on one axis - chartTurn keeps the timeline linear.
 * @param {Snapshot|*} s One sample.
 * @returns {number} The continuous turn value.
 */
function stackTurnOf(s) {
  return typeof s?.chartTurn === "number" ? s.chartTurn : s.turn;
}

/**
 * Build one stack row from a metrics object, or `null` when no band is
 * positive.
 * @param {number|*} turn The turn.
 * @param {Record<string, *>} m One civ's metrics.
 * @param {StackBand[]} bands The band set.
 * @returns {StackPoint|null} The row, or `null`.
 */
function buildStackRow(turn, m, bands) {
  /** @type {StackPoint} */
  const row = { turn, values: {} };
  let any = false;
  for (const band of bands) {
    const v = typeof m[band.id] === "number" && isFinite(m[band.id]) ? m[band.id] : 0;
    if (v > 0) any = true;
    row.values[band.id] = v;
  }
  return any ? row : null;
}

/**
 * Clamp the stack rows to a time range in place, when one is set.
 * @param {StackPoint[]} points The stack rows (mutated).
 * @param {ChartOptions|*} opts The render options.
 */
function clampStackPoints(points, opts) {
  const stackTr = resolveTurnRange(opts);
  if (!stackTr) return;
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].turn < stackTr.min || points[i].turn > stackTr.max) {
      points.splice(i, 1);
    }
  }
}

/**
 * Compute the stack chart's x/y domain from the rows.
 * @param {StackPoint[]} points The stack rows.
 * @param {StackBand[]} bands The band set.
 * @returns {{ xMin: number, xMax: number, yMax: number }} The domain.
 */
function computeStackDomain(points, bands) {
  let xMin = Infinity,
    xMax = -Infinity,
    yMax = 0;
  for (const p of points) {
    if (p.turn < xMin) xMin = p.turn;
    if (p.turn > xMax) xMax = p.turn;
    const stack = sumBands(p.values, bands);
    if (stack > yMax) yMax = stack;
  }
  if (!isFinite(xMin)) xMin = 0;
  if (!isFinite(xMax)) xMax = 1;
  if (xMin === xMax) xMax = xMin + 1;
  if (yMax <= 0) yMax = 1;
  return { xMin, xMax, yMax };
}

/**
 * Sum a row's band values.
 * @param {Record<string, number>} values Per-band values.
 * @param {StackBand[]} bands The band set.
 * @returns {number} The stacked total.
 */
function sumBands(values, bands) {
  let stack = 0;
  for (const band of bands) stack += values[band.id] || 0;
  return stack;
}

/**
 * Build the stack-chart layout (pads, plot size, x/y mappers).
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 * @param {{ xMin: number, xMax: number, yMax: number }} dom The domain.
 * @returns {StackLayout} The layout.
 */
function buildStackLayout(W, H, dom) {
  const padL = 70,
    // Legend moved to a row on top of the chart (like the other graphs), so the right margin no
    // longer reserves space for it — just enough to keep the last x-tick label from clipping.
    padR = 40,
    padT = 30,
    padB = 64;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  return {
    padL,
    padR,
    padT,
    padB,
    innerW,
    innerH,
    xOf: (t) => padL + ((t - dom.xMin) / (dom.xMax - dom.xMin || 1)) * innerW,
    yOf: (v) => padT + innerH - (v / dom.yMax) * innerH
  };
}

/**
 * Draw the stacked-area band polygons bottom-up.
 * @param {SVGElement} svg The chart SVG.
 * @param {StackPoint[]} points The stack rows.
 * @param {StackBand[]} bands The band set.
 * @param {StackLayout} L The layout.
 */
function drawStackBands(svg, points, bands, L) {
  // For each band, build a polygon bounded above by (cum + band) and below by
  // (cum), then bump cum.
  const cum = new Array(points.length).fill(0);
  for (const band of bands) {
    const upper = [];
    const lower = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const v = p.values[band.id] || 0;
      lower.push({ x: L.xOf(p.turn), y: L.yOf(cum[i]) });
      cum[i] += v;
      upper.push({ x: L.xOf(p.turn), y: L.yOf(cum[i]) });
    }
    // Build polygon: upper left→right, then lower right→left.
    const pts =
      upper.map((p) => p.x + "," + p.y).join(" ") +
      " " +
      lower
        .slice()
        .reverse()
        .map((p) => p.x + "," + p.y)
        .join(" ");
    svg.appendChild(
      svgEl("polygon", {
        points: pts,
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
 * Build the stack chart's band legend as a horizontal row shown ON TOP of the chart (matching the
 * other graphs), instead of a vertical list in the right margin. Each item is a colour dot + the
 * band label and its latest value.
 * @param {StackBand[]} bands The band set.
 * @param {StackPoint[]} points The stack rows.
 * @returns {HTMLElement} The legend row.
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

    const txt = document.createElement("span");
    txt.className = "demographics-chart-line-label-text";
    const latest = points[points.length - 1]?.values?.[band.id] || 0;
    txt.textContent = band.label + " , " + latest;
    item.appendChild(txt);

    row.appendChild(item);
  });
  return row;
}

/**
 * Options accepted by {@link renderResourcesStack}.
 * @typedef {Object} StackOptions
 * @property {DemoHistory|*} [history] The history blob.
 * @property {StackBand[]} [bands] Override band set (used by triumph stack).
 * @property {number} [width] Canvas width.
 * @property {number} [height] Canvas height.
 * @property {number|string} [viewerPid] Which civ to chart.
 * @property {{ min: number, max: number }} [turnRange] Time-range filter.
 * @property {string} [yAxisLabel] Y-axis title override.
 */

/**
 * Render the resources stacked-area chart (one civ, bands stacked over time)
 * into `host`. The `bands` / `yAxisLabel` options generalize it for arbitrary
 * stacked band sets (used by the now-removed triumph stack; kept generic).
 * @param {HTMLElement} host The view host element (cleared and repopulated).
 * @param {StackOptions} [options] Render options.
 * @returns {{ svg: SVGElement }|null} The mounted SVG handle, or `null`.
 */
export function renderResourcesStack(host, options) {
  const setup = prepareResourcesStackRender(host, options);
  if (!setup) return null;
  const { hostEl, opts, BANDS, W, H, samples } = setup;
  if (!guardSamplesPresent(hostEl, samples)) return null;
  // viewerPid (option) lets the caller pick which civ's stacked resources to
  // chart; defaults to the local player so the panel "just works" on first open.
  const points = buildStackPoints(samples, resolveStackTargetPid(opts), BANDS);
  clampStackPoints(points, opts);
  if (!guardPointsPresent(hostEl, points)) return null;

  const dom = computeStackDomain(points, BANDS);
  const L = buildStackLayout(W, H, dom);
  const { svg, tickPositions } = buildStackSvg(samples, points, BANDS, { L, dom, W, H });
  const wrap = mountStackWrap(svg, opts, { tickPositions }, { L, W, H });

  // Band legend on top of the chart (like the other graphs), then the chart wrap below it.
  hostEl.appendChild(buildStackLegendTop(BANDS, points));
  hostEl.appendChild(wrap);
  dlog("resources stacked area mounted; turns=", points.length, "yMax=", dom.yMax);
  return { svg };
}

/**
 * Prepare host/options/band setup for a stack render pass.
 * @param {HTMLElement} host The chart host.
 * @param {StackOptions|undefined} options Render options.
 * @returns {{
 *   hostEl: HTMLElement,
 *   opts: StackOptions,
 *   BANDS: StackBand[],
 *   W: number,
 *   H: number,
 *   samples: Snapshot[],
 * }|null} Prepared setup.
 */
function prepareResourcesStackRender(host, options) {
  if (!host) return null;
  while (host.firstChild) host.removeChild(host.firstChild);
  const opts = options || {};
  const BANDS = resolveStackBands(opts);
  const W = opts.width || 1400;
  const H = opts.height || 600;
  const samples = historySamples(opts.history);
  return { hostEl: host, opts, BANDS, W, H, samples };
}

/**
 * Guard that at least one history sample exists.
 * @param {HTMLElement} host The chart host.
 * @param {Snapshot[]} samples The sample stream.
 * @returns {boolean} True when rendering can continue.
 */
function guardSamplesPresent(host, samples) {
  if (samples.length > 0) return true;
  appendEmptyNotice(host, t("LOC_DEMOGRAPHICS_EMPTY_NO_SAMPLES"));
  return false;
}

/**
 * Guard that at least one stack point exists after filtering.
 * @param {HTMLElement} host The chart host.
 * @param {StackPoint[]} points The filtered stack points.
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
 * @param {SVGElement} svg The chart SVG.
 * @param {StackOptions} opts The render options (for yAxisLabel).
 * @param {{ tickPositions: { t: number, x: number, year: string|null, labelY: number }[] }} data
 *   The x-tick positions (the band legend now mounts on top of the chart, outside this wrap).
 * @param {{ L: StackLayout, W: number, H: number }} dims Layout + canvas size.
 * @returns {HTMLElement} The chart wrap.
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
      "demographics-chart-axis-title demographics-chart-axis-x demographics-resources-axis-title demographics-resources-axis-x",
    yClassName:
      "demographics-chart-axis-title demographics-chart-axis-y demographics-resources-axis-title demographics-resources-axis-y",
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
 * @param {Snapshot[]} samples The sample stream.
 * @param {StackPoint[]} points The stack rows.
 * @param {StackBand[]} bands The band set.
 * @param {{ L: StackLayout, dom: { xMin: number, xMax: number, yMax: number },
 *   W: number, H: number }} dims Layout, domain, and canvas size.
 * @returns {{ svg: SVGElement, tickPositions: { t: number, x: number,
 *   year: string|null, labelY: number }[] }}
 *   The SVG and the x-tick positions for HTML overlays.
 */
function buildStackSvg(samples, points, bands, dims) {
  const { L, dom, W, H } = dims;
  const svg = svgEl("svg", {
    xmlns: SVG_NS,
    viewBox: `0 0 ${W} ${H}`,
    width: String(W),
    height: String(H),
    preserveAspectRatio: "none",
    class: "demographics-chart-svg",
    "aria-label": "Resources by category over time"
  });
  const gridCfg = buildStackGridConfig();
  drawStackGrid(svg, L, dom.yMax, gridCfg, svgEl);
  const stackTurnYears = buildStackTurnYearMap(samples);
  const tickPositions = drawStackXTicks(
    svg,
    { L, dom, turnYearMap: stackTurnYears },
    { cfg: gridCfg, nearestByTurn, svgEl }
  );
  drawStackBands(svg, points, bands, L);
  drawStackAgeLines(svg, samples, L, dom);
  return { svg, tickPositions };
}

/**
 * A chartTurn-keyed turn → game-year map (the shared buildStackTurnYears keys by
 * the age-local turn, which doesn't match this chart's continuous x).
 * @param {Snapshot[]} samples The sample stream.
 * @returns {Map<number, string>} chartTurn → game-year.
 */
function buildStackTurnYearMap(samples) {
  /** @type {Map<number, string>} */
  const map = new Map();
  for (const s of samples) {
    if (s && typeof s.gameYear === "string" && s.gameYear.length > 0) {
      map.set(stackTurnOf(s), s.gameYear);
    }
  }
  return map;
}

/**
 * Draw a purple vertical divider at each age transition (where a sample's age
 * differs from the previous one), matching the historical line charts' age
 * markers. (Coherent ignores SVG stroke-dasharray, so the line is solid.)
 * @param {SVGElement} svg The chart SVG.
 * @param {Snapshot[]} samples The sample stream.
 * @param {StackLayout} L The layout.
 * @param {{ xMin: number, xMax: number, yMax: number }} dom The domain.
 */
function drawStackAgeLines(svg, samples, L, dom) {
  let prevAge = null;
  for (const s of samples) {
    const age = s && typeof s.age === "string" ? s.age : null;
    if (prevAge !== null && age !== null && age !== prevAge) {
      const tx = stackTurnOf(s);
      if (tx >= dom.xMin && tx <= dom.xMax) {
        svg.appendChild(
          svgEl("line", {
            x1: L.xOf(tx),
            y1: L.padT,
            x2: L.xOf(tx),
            y2: L.padT + L.innerH,
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
