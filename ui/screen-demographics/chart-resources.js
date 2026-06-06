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
  buildStackTurnYears,
  civOptionLabel,
  hideUnmetEnabled,
  isCivUnmet
} from "/demographics/ui/screen-demographics/chart-shared.js";
import { t } from "/demographics/ui/demographics-i18n.js";

/**
 * @typedef {import("/demographics/ui/screen-demographics/chart-line.js").ChartOptions} ChartOptions
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
  const gate = hideUnmetEnabled();
  /** @type {Map<string, { pid: string, label: string }>} */
  const seen = new Map();
  for (const s of samps) {
    if (!s?.players) continue;
    for (const pid of Object.keys(s.players)) {
      // Spoiler guard: don't offer unmet civs as a pickable stack target.
      if (gate && isCivUnmet(samps, pid)) continue;
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
    const row = buildStackRow(s.turn, ps.metrics, bands);
    if (row) points.push(row);
  }
  return points;
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
    padR = 200,
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
 * Draw the stack plot background + Y gridlines and labels.
 * @param {SVGElement} svg The chart SVG.
 * @param {StackLayout} L The layout.
 * @param {number} yMax The y-domain maximum.
 */
function drawStackGrid(svg, L, yMax) {
  svg.appendChild(
    svgEl("rect", {
      x: L.padL,
      y: L.padT,
      width: L.innerW,
      height: L.innerH,
      fill: "rgba(20, 16, 10, 0.55)",
      stroke: "#c9a24c",
      "stroke-width": "1"
    })
  );
  // Y gridlines (4 divisions) + labels.
  for (let i = 0; i <= 4; i++) {
    const v = (yMax * i) / 4;
    const y = L.yOf(v);
    svg.appendChild(
      svgEl("line", {
        x1: L.padL,
        y1: y,
        x2: L.padL + L.innerW,
        y2: y,
        stroke: "rgba(201, 162, 76, 0.18)",
        "stroke-width": "1"
      })
    );
    const lbl = svgEl("text", {
      x: L.padL - 6,
      y: y + 4,
      fill: "rgba(243, 231, 196, 0.85)",
      "font-size": "12",
      "text-anchor": "end"
    });
    lbl.textContent = String(Math.round(v));
    svg.appendChild(lbl);
  }
}

/**
 * Draw the stack X-axis tick marks and return their HTML-overlay positions.
 * @param {SVGElement} svg The chart SVG.
 * @param {StackLayout} L The layout.
 * @param {{ xMin: number, xMax: number }} dom The x-domain.
 * @param {Map<number, string>} stackTurnYears chart-turn → year map.
 * @returns {{ t: number, x: number, year: string|null, labelY: number }[]}
 *   The tick positions.
 */
function drawStackXTicks(svg, L, dom, stackTurnYears) {
  const xTicks = 6;
  const stackTickPositions = [];
  for (let i = 0; i <= xTicks; i++) {
    const t = Math.round(dom.xMin + ((dom.xMax - dom.xMin) * i) / xTicks);
    const x = L.xOf(t);
    svg.appendChild(
      svgEl("line", {
        x1: x,
        x2: x,
        y1: L.padT + L.innerH,
        y2: L.padT + L.innerH + 4,
        stroke: "#f3e7c4",
        "stroke-width": "1"
      })
    );
    stackTickPositions.push({
      t,
      x,
      year: nearestByTurn(stackTurnYears, t),
      labelY: L.padT + L.innerH + 8
    });
  }
  return stackTickPositions;
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
 * Mount the stack chart's axis-title overlays.
 * @param {HTMLElement} wrap The chart wrap.
 * @param {StackLayout} L The layout.
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 * @param {string} yAxisLabel The y-axis title text.
 */
function mountStackAxisTitles(wrap, L, W, H, yAxisLabel) {
  const xTitle = document.createElement("div");
  xTitle.className =
    "demographics-chart-axis-title demographics-chart-axis-x demographics-resources-axis-title demographics-resources-axis-x";
  // Per-axis geometry stays inline.
  xTitle.style.left = ((L.padL + L.innerW / 2) / W) * 100 + "%";
  xTitle.style.top = ((H - 4) / H) * 100 + "%";
  xTitle.textContent = t("LOC_DEMOGRAPHICS_AXIS_TIME");
  wrap.appendChild(xTitle);
  const yTitle = document.createElement("div");
  yTitle.className =
    "demographics-chart-axis-title demographics-chart-axis-y demographics-resources-axis-title demographics-resources-axis-y";
  // Per-axis geometry stays inline.
  yTitle.style.left = (12 / W) * 100 + "%";
  yTitle.style.top = ((L.padT + L.innerH / 2) / H) * 100 + "%";
  yTitle.textContent = yAxisLabel;
  wrap.appendChild(yTitle);
}

/**
 * Mount the stack chart's X-tick HTML labels (turn and/or year per axis mode).
 * @param {HTMLElement} wrap The chart wrap.
 * @param {{ t: number, x: number, year: string|null, labelY: number }[]} ticks
 *   The tick positions.
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 */
function mountStackXTickLabels(wrap, ticks, W, H) {
  ticks.forEach((tick) => {
    const div = document.createElement("div");
    div.className = "demographics-chart-x-tick demographics-resources-x-tick";
    // Per-tick geometry stays inline.
    div.style.left = (tick.x / W) * 100 + "%";
    div.style.top = (tick.labelY / H) * 100 + "%";
    if (getXAxisMode() !== "year") {
      appendTickTurn(div, tick.t);
    }
    if (getXAxisMode() !== "turn" && tick.year) {
      const yr = document.createElement("div");
      yr.className = "demographics-chart-x-tick-year";
      yr.textContent = tick.year;
      div.appendChild(yr);
    } else if (getXAxisMode() === "year" && !tick.year) {
      appendTickTurn(div, tick.t);
    }
    wrap.appendChild(div);
  });
}

/**
 * Append a "T-N" turn sub-label to a tick container.
 * @param {HTMLElement} div The tick container.
 * @param {number} t The turn.
 */
function appendTickTurn(div, t) {
  const tn = document.createElement("div");
  tn.className = "demographics-chart-x-tick-turn";
  tn.textContent = "T-" + t;
  div.appendChild(tn);
}

/**
 * Mount the stack chart's right-margin band legend (label + latest value).
 * @param {HTMLElement} wrap The chart wrap.
 * @param {StackBand[]} bands The band set.
 * @param {StackPoint[]} points The stack rows.
 * @param {StackLayout} L The layout.
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 */
function mountStackLegend(wrap, bands, points, L, W, H) {
  let gy = L.padT + 8;
  const gx = L.padL + L.innerW + 16;
  bands.forEach((band) => {
    const div = document.createElement("div");
    div.className = "demographics-chart-line-label demographics-resources-legend-label";
    // Per-band geometry stays inline.
    div.style.left = (gx / W) * 100 + "%";
    div.style.top = (gy / H) * 100 + "%";

    const dot = document.createElement("span");
    dot.className = "demographics-chart-line-label-dot";
    dot.style.backgroundColor = band.color;
    div.appendChild(dot);

    const txt = document.createElement("span");
    txt.className = "demographics-chart-line-label-text";
    // Latest value of this band.
    const latest = points[points.length - 1]?.values?.[band.id] || 0;
    txt.textContent = band.label + " — " + latest;
    div.appendChild(txt);

    wrap.appendChild(div);
    gy += 26;
  });
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
  if (!host) return null;
  while (host.firstChild) host.removeChild(host.firstChild);
  const opts = options || {};
  // `opts.bands` lets a caller reuse this entire SVG path by passing a
  // different band set while keeping all the layout, axes, tooltips, and
  // per-civ dropdown logic.
  const BANDS = resolveStackBands(opts);
  const W = opts.width || 1400;
  const H = opts.height || 600;
  const samples = historySamples(opts.history);
  if (samples.length === 0) {
    appendEmptyNotice(host, t("LOC_DEMOGRAPHICS_EMPTY_NO_SAMPLES"));
    return null;
  }
  // viewerPid (option) lets the caller pick which civ's stacked resources to
  // chart; defaults to the local player so the panel "just works" on first open.
  const points = buildStackPoints(samples, resolveStackTargetPid(opts), BANDS);
  clampStackPoints(points, opts);
  if (points.length === 0) {
    appendEmptyNotice(host, t("LOC_DEMOGRAPHICS_EMPTY_NO_RESOURCE_SAMPLES"));
    return null;
  }

  const dom = computeStackDomain(points, BANDS);
  const L = buildStackLayout(W, H, dom);
  const { svg, tickPositions } = buildStackSvg(samples, points, BANDS, L, dom, W, H);
  const wrap = mountStackWrap(svg, opts, BANDS, points, tickPositions, L, W, H);

  host.appendChild(wrap);
  dlog("resources stacked area mounted; turns=", points.length, "yMax=", dom.yMax);
  return { svg };
}

/**
 * Build the chart wrap and mount the SVG + axis titles + x-tick labels +
 * band legend overlays.
 * @param {SVGElement} svg The chart SVG.
 * @param {StackOptions} opts The render options (for yAxisLabel).
 * @param {StackBand[]} bands The band set.
 * @param {StackPoint[]} points The stack rows.
 * @param {{ t: number, x: number, year: string|null, labelY: number }[]} tickPositions
 *   The x-tick positions.
 * @param {StackLayout} L The layout.
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 * @returns {HTMLElement} The chart wrap.
 */
function mountStackWrap(svg, opts, bands, points, tickPositions, L, W, H) {
  // Legend at right margin (HTML overlay, clickable later if we add toggles).
  const wrap = document.createElement("div");
  wrap.className = "demographics-chart-wrap";
  wrap.appendChild(svg);
  // Callers can override the y-axis title via opts.yAxisLabel (e.g. a band-set
  // reuse that stacks something other than resources).
  const yAxisLabel =
    typeof opts.yAxisLabel === "string" && opts.yAxisLabel
      ? opts.yAxisLabel
      : t("LOC_DEMOGRAPHICS_AXIS_RESOURCES_ASSIGNED");
  mountStackAxisTitles(wrap, L, W, H, yAxisLabel);
  mountStackXTickLabels(wrap, tickPositions, W, H);
  mountStackLegend(wrap, bands, points, L, W, H);
  return wrap;
}

/**
 * Build the stack chart SVG (background grid, X-ticks, band polygons).
 * @param {Snapshot[]} samples The sample stream.
 * @param {StackPoint[]} points The stack rows.
 * @param {StackBand[]} bands The band set.
 * @param {StackLayout} L The layout.
 * @param {{ xMin: number, xMax: number, yMax: number }} dom The domain.
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 * @returns {{ svg: SVGElement, tickPositions: { t: number, x: number, year: string|null, labelY: number }[] }}
 *   The SVG and the x-tick positions for HTML overlays.
 */
function buildStackSvg(samples, points, bands, L, dom, W, H) {
  const svg = svgEl("svg", {
    xmlns: SVG_NS,
    viewBox: `0 0 ${W} ${H}`,
    width: String(W),
    height: String(H),
    preserveAspectRatio: "none",
    class: "demographics-chart-svg",
    "aria-label": "Resources by category over time"
  });
  drawStackGrid(svg, L, dom.yMax);
  const stackTurnYears = buildStackTurnYears(samples);
  const tickPositions = drawStackXTicks(svg, L, dom, stackTurnYears);
  drawStackBands(svg, points, bands, L);
  return { svg, tickPositions };
}
