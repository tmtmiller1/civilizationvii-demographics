// chart-wars-gantt.js
//
// The conflicts Gantt timeline (one bar per major-vs-major war):
// collectWarCivOptions + renderWarsGantt and their private filtering,
// layout, bar-drawing, war-naming, tooltip, and hover helpers (romanize,
// parseYear, casualty estimate, etc). Migrated verbatim from
// demographics-chart.js.
/* eslint-disable max-params, max-statements, max-len */

import { t } from "/demographics/ui/core/demographics-i18n.js";
import {
  dlog,
  SVG_NS,
  svgEl,
  historySamples,
  appendEmptyNotice,
  resolveTurnRange,
  getXAxisMode,
  nearestByTurn,
  buildStackTurnYears
} from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";
import {
  buildStackGridConfig,
  drawStackGrid,
  drawStackXTicks,
  mountStackAxisTitles,
  mountStackXTicks
} from "/demographics/ui/screen-demographics/charts/shared/chart-stack-grid.js";
import { mergeWars } from "/demographics/ui/screen-demographics/charts/wars/chart-wars-merge.js";
import {
  buildGanttLayout,
  computeGanttDomain,
  computeGanttWidth,
  filterGanttWars
} from "/demographics/ui/screen-demographics/charts/wars/chart-wars-gantt-domain.js";
import { drawWarBars } from "/demographics/ui/screen-demographics/charts/wars/chart-wars-gantt-bars.js";
import {
  createGanttTooltip,
  wireGanttHover
} from "/demographics/ui/screen-demographics/charts/wars/chart-wars-gantt-interactions.js";
import {
  buildContinentMap,
  buildWarNameOverrides,
  warLabelText
} from "/demographics/ui/screen-demographics/charts/wars/chart-wars-naming.js";
import {
  CRISIS_STAGE_COLORS,
  CRISIS_STAGE_LABELS,
  crisisStageOnsets
} from "/demographics/ui/screen-demographics/charts/crises/crisis-stage-data.js";
import { flavorCrisisName, getGameSeed } from "/demographics/ui/screen-demographics/charts/crises/crisis-names.js";

// Wars Gantt - one horizontal bar per war, stacked vertically by start turn.
// X-axis = turn (with year ticks). Bars colored by the attacker's primary
// color; named with the ordinal-style label the sampler generates.



// Collect every civ pid that's appeared in any war (with display labels) so
// the conflicts page filter dropdown can list them.
/**
 * Build display label for one war roster participant.
 * @param {*} roster Roster entry.
 * @returns {string} Display label.
 */
function warCivLabel(roster) {
  return roster.leader ? roster.leader + ", " + roster.civ : roster.civ;
}

/**
 * Stable sort for war-civ option entries.
 * @param {{ isCS: boolean, label: string }} a Entry A.
 * @param {{ isCS: boolean, label: string }} b Entry B.
 * @returns {number} Sort order.
 */
function compareWarCivOptions(a, b) {
  if (a.isCS !== b.isCS) return a.isCS ? 1 : -1;
  return a.label.localeCompare(b.label);
}

/**
 * List every civ that has appeared in any war, sorted majors-first then by
 * label, for the conflicts-page filter dropdown.
 * @param {DemoHistory|*} history The history blob.
 * @returns {{ pid: *, isCS: boolean, label: string }[]} The civ options.
 */
export function collectWarCivOptions(history) {
  const wars = history && Array.isArray(history.wars) ? history.wars : [];
  const seen = new Map();
  for (const w of wars) {
    const allRosters = /** @type {any[]} */ ([]).concat(w.sideACivs || [], w.sideBCivs || []);
    for (const r of allRosters) {
      if (!r || seen.has(r.pid)) continue;
      seen.set(r.pid, {
        pid: r.pid,
        isCS: !!r.isCS,
        label: warCivLabel(r)
      });
    }
  }
  return Array.from(seen.values()).sort(compareWarCivOptions);
}

/**
 * Gantt layout + plot mappers.
 * @typedef {Object} GanttLayout
 * @property {number} padL Left pad.
 * @property {number} padT Top pad.
 * @property {number} innerW Plot width.
 * @property {number} innerH Plot height.
 * @property {number} H Final canvas height.
 * @property {number[]} rowTops Per-war row top offsets.
 * @property {number[]} rowHeights Per-war bar heights (scale with belligerents).
 * @property {number} barH Base bar height.
 * @property {(t: number) => number} xOf Turn → pixel x.
 */

/**
 * Draw the Gantt background, year grid + ticks. Returns the tick positions for
 * HTML overlays.
 * @param {SVGElement} svg The chart SVG.
 * @param {GanttLayout} L The layout.
 * @param {{ xMin: number, xMax: number }} dom The x-domain.
 * @param {Map<number, string>} turnYearMap chart-turn → year map.
 * @returns {{ t: number, x: number, year: string|null }[]} The tick positions.
 */
function drawGanttGrid(svg, L, dom, turnYearMap) {
  // Scale tick count to the (possibly very wide, scrollable) plot so a long
  // timeline keeps a readable year cadence instead of just 6 sparse ticks.
  const cfg = buildStackGridConfig({
    plotFill: "rgba(18, 20, 24, 0.85)",
    xTickStroke: "#E5E5E5",
    xTicks: Math.max(6, Math.min(40, Math.round(L.innerW / 160))),
    drawYGrid: false,
    drawYLabels: false,
    drawXVerticalGrid: true,
    xVerticalGridStroke: "rgba(133, 135, 140, 0.35)"
  });
  drawStackGrid(svg, { ...L, yOf: () => 0 }, 1, cfg, svgEl);
  return drawStackXTicks(
    svg,
    { L, dom, turnYearMap },
    { cfg, nearestByTurn, svgEl }
  );
}

/**
 * One war bar's hit-test rectangle.
 * @typedef {Object} BarRect
 * @property {*} war The war record.
 * @property {number} x Bar left.
 * @property {number} y Bar top.
 * @property {number} w Bar width.
 * @property {number} h Bar height.
 * @property {number} x2 Bar right.
 * @property {boolean} isClosed Whether the war concluded.
 * @property {number} [hitW] Hit-test width (includes an ongoing war's future tail).
 */

/**
 * Draw the vertical "current turn" marker: a dashed red line across the plot at
 * the latest sampled turn (where the solid bars end and the future tails begin).
 * @param {SVGElement} svg The chart SVG.
 * @param {GanttLayout} L The layout.
 * @param {{ xMin: number, xMax: number }} dom The x-domain.
 * @param {number} latestTurn The latest sampled turn.
 */
function drawCurrentTurnLine(svg, L, dom, latestTurn) {
  if (!isFinite(latestTurn) || latestTurn < dom.xMin || latestTurn > dom.xMax) return;
  const x = L.xOf(latestTurn);
  svg.appendChild(
    svgEl("line", {
      x1: x,
      x2: x,
      y1: L.padT,
      y2: L.padT + L.innerH,
      stroke: "#e8453c",
      "stroke-width": "2",
      "stroke-dasharray": "5 3"
    })
  );
}

/**
 * Draw the crisis stage-onset overlay lines: a dashed vertical line at each
 * onset turn, colored by stage - the same markers the historical line charts
 * draw. (Labels are mounted as HTML overlays; see mountCrisisLabels.)
 * @param {SVGElement} svg The chart SVG.
 * @param {GanttLayout} L The layout.
 * @param {{ xMin: number, xMax: number }} dom The x-domain.
 * @param {{ stage: number, turn: number, sample: Snapshot }[]} onsets The crisis onsets.
 */
function drawCrisisMarkers(svg, L, dom, onsets) {
  for (const o of onsets || []) {
    if (o.turn < dom.xMin || o.turn > dom.xMax) continue;
    const x = L.xOf(o.turn);
    const color = CRISIS_STAGE_COLORS[Math.max(0, Math.min(3, o.stage - 1))];
    svg.appendChild(
      svgEl("line", {
        x1: x,
        x2: x,
        y1: L.padT,
        y2: L.padT + L.innerH,
        stroke: color,
        "stroke-width": "1.4",
        "stroke-dasharray": "4 3",
        "stroke-opacity": "0.85"
      })
    );
  }
}

/**
 * Mount the crisis stage-onset HTML labels atop each overlay line: a two-line
 * pill (stage label in the stage color, crisis name below), staggered down so
 * adjacent onsets don't collide. Mirrors the historical charts' marker labels.
 * @param {HTMLElement} wrap The chart canvas.
 * @param {GanttLayout} L The layout.
 * @param {{ xMin: number, xMax: number }} dom The x-domain.
 * @param {{ stage: number, turn: number, sample: Snapshot }[]} onsets The crisis onsets.
 * @param {string} seed The game seed (for the flavor crisis name).
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 */
function mountCrisisLabels(wrap, L, dom, onsets, seed, W, H) {
  (onsets || []).forEach((o, i) => {
    if (o.turn < dom.xMin || o.turn > dom.xMax) return;
    const idx = Math.max(0, Math.min(3, o.stage - 1));
    const x = L.xOf(o.turn);
    const div = document.createElement("div");
    div.className = "demographics-wars-crisis-label";
    // Per-marker geometry stays dynamic; stagger each label down to reduce overlap.
    div.style.left = (x / W) * 100 + "%";
    div.style.top = ((L.padT + 2 + (i % 3) * 30) / H) * 100 + "%";
    const stage = document.createElement("div");
    stage.className = "demographics-wars-crisis-label-stage";
    stage.style.color = CRISIS_STAGE_COLORS[idx];
    stage.textContent = t(CRISIS_STAGE_LABELS[idx]);
    div.appendChild(stage);
    const name = document.createElement("div");
    name.className = "demographics-wars-crisis-label-name";
    name.textContent = flavorCrisisName(o.sample, o.stage, seed);
    div.appendChild(name);
    wrap.appendChild(div);
  });
}

/**
 * Mount one war-name label: the FULL name in a neutral box (never truncated),
 * anchored at the bar's left edge - or, for a bar in the right third of the
 * chart, with its right edge at the bar end so a long name grows left and isn't
 * clipped by the canvas edge.
 * @param {HTMLElement} wrap The chart canvas.
 * @param {BarRect} rect The bar hit-test rect.
 * @param {{ nameOverride: Map<*, string>, turnYearMap: Map<number, string>, latestTurn: number, W: number, H: number }} env Shared inputs.
 */
function mountOneWarLabel(wrap, rect, env) {
  const { nameOverride, turnYearMap, latestTurn, W, H } = env;
  const { war, x, y, h } = rect;
  const xRight = x + (rect.hitW ?? rect.w);
  const label = warLabelText(war, nameOverride, turnYearMap, latestTurn);
  const div = document.createElement("div");
  div.className = "demographics-chart-war-label demographics-wars-label";
  // Per-bar geometry stays dynamic (pixel-derived percentages).
  div.style.top = ((y + h / 2) / H) * 100 + "%";
  if (x <= W * 0.66) {
    div.style.left = (x / W) * 100 + "%";
  } else {
    div.classList.add("demographics-wars-label-anchor-right");
    div.style.left = (xRight / W) * 100 + "%";
  }
  // The name sits in a neutral box so it stays readable over any banner color.
  const box = document.createElement("span");
  box.className = "demographics-wars-label-box";
  box.textContent = label;
  div.appendChild(box);
  wrap.appendChild(div);
}

/**
 * Mount the per-bar war-name labels into the canvas.
 * @param {HTMLElement} wrap The chart canvas.
 * @param {BarRect[]} barRects The bar rects.
 * @param {Map<*, string>} nameOverride war → display label.
 * @param {Map<number, string>} turnYearMap chart-turn → year map.
 * @param {number} latestTurn The latest sampled turn.
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 */
function mountWarLabels(wrap, barRects, nameOverride, turnYearMap, latestTurn, W, H) {
  const env = { nameOverride, turnYearMap, latestTurn, W, H };
  for (const rect of barRects) mountOneWarLabel(wrap, rect, env);
}

/**
 * Mount the Gantt X-tick HTML labels (year and/or turn per axis mode).
 * @param {HTMLElement} wrap The chart wrap.
 * @param {{ t: number, x: number, year: string|null }[]} tickPositions Ticks.
 * @param {GanttLayout} L The layout.
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 */
function mountGanttXTicks(wrap, tickPositions, L, W, H) {
  mountStackXTicks(wrap, tickPositions.map((tick) => ({
    t: tick.t,
    x: tick.x,
    year: tick.year,
    labelY: L.padT + L.innerH + 8
  })), {
    W,
    H,
    mode: /** @type {"turn"|"year"|"both"} */ (getXAxisMode()),
    className: "demographics-chart-x-tick demographics-wars-x-tick",
    turnParenWhenBoth: true
  });
}

/**
 * Mount the Gantt axis titles.
 * @param {HTMLElement} wrap The chart wrap.
 * @param {GanttLayout} L The layout.
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 */
function mountGanttAxisTitles(wrap, L, W, H) {
  mountStackAxisTitles(wrap, {
    L,
    W,
    H,
    xClassName:
      "demographics-chart-axis-title demographics-chart-axis-x demographics-wars-axis-title demographics-wars-axis-x",
    yClassName:
      "demographics-chart-axis-title demographics-chart-axis-y demographics-wars-axis-title demographics-wars-axis-y",
    xText: t("LOC_DEMOGRAPHICS_AXIS_TIME"),
    yText: t("LOC_DEMOGRAPHICS_AXIS_CONFLICTS")
  });
}

/**
 * Mount the "Now" label atop the current-turn (red) line, when that turn is in
 * range.
 * @param {HTMLElement} wrap The chart canvas.
 * @param {GanttLayout} L The layout.
 * @param {number} latestTurn The latest sampled turn.
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 */
function mountCurrentTurnLabel(wrap, L, latestTurn, W, H) {
  if (!isFinite(latestTurn)) return;
  const x = L.xOf(latestTurn);
  if (x < L.padL || x > L.padL + L.innerW) return;
  const div = document.createElement("div");
  div.className = "demographics-wars-now-label";
  // Per-marker position stays dynamic (pixel-derived percentages).
  div.style.left = (x / W) * 100 + "%";
  div.style.top = (L.padT / H) * 100 + "%";
  div.textContent = t("LOC_DEMOGRAPHICS_WARS_NOW", latestTurn);
  wrap.appendChild(div);
}







/**
 * Options accepted by {@link renderWarsGantt}.
 * @typedef {Object} GanttOptions
 * @property {DemoHistory|*} [history] The history blob (wars + samples).
 * @property {number} [width] Canvas width.
 * @property {number} [height] Canvas height floor.
 * @property {number} [filterPid] Limit to a specific civ.
 * @property {boolean} [activeOnly] Hide concluded wars.
 * @property {{ min: number, max: number }} [turnRange] Time-range filter.
 */

/**
 * Render the conflicts Gantt timeline (one bar per major-vs-major war) into
 * `host`, with per-civ stripes, in-bar labels, and a hover tooltip.
 * @param {HTMLElement} host The view host element (cleared and repopulated).
 * @param {GanttOptions} [options] Render options.
 * @returns {{ svg: SVGElement }|null} The mounted SVG handle, or `null`.
 */
export function renderWarsGantt(host, options) {
  if (!host) return null;
  while (host.firstChild) host.removeChild(host.firstChild);
  const opts = options || {};
  const viewportW = opts.width || 1400;
  const prep = prepareGanttData(host, opts);
  if (!prep) return null;
  const { wars, merged, filtered, latestTurn, samples, filterPid, showActiveOnly } = prep;

  const tr = resolveTurnRange(opts);
  const dom = computeGanttDomain(filtered, tr, latestTurn, samples);
  // Natural pixel width from the turn span (>= viewport); the chart scrolls
  // horizontally when the timeline is longer than the viewport.
  const W = computeGanttWidth(viewportW, dom);
  const L = buildGanttLayout(W, opts.height || 600, filtered, dom);
  const H = L.H;
  const turnYearMap = buildStackTurnYears(samples);
  // Crisis stage-onset overlay (same markers the historical line charts draw).
  const crisisOnsets = crisisStageOnsets(samples);
  const crisisSeed = getGameSeed();
  const env = { turnYearMap, latestTurn, samples, W, H, dom, crisisOnsets, crisisSeed };

  const { svg, barRects, tickPositions } = buildGanttSvg(filtered, L, dom, tr, env);
  const wrap = mountGanttWrap(svg, { merged, barRects, tickPositions, L, ...env });

  host.appendChild(wrap);
  dlog(
    "wars gantt mounted; wars=",
    wars.length,
    "filtered=" + filtered.length,
    "filterPid=" + filterPid,
    "activeOnly=" + showActiveOnly
  );
  return { svg };
}


/**
 * Prepared Gantt data: the sorted wars, the filtered subset, and filter flags.
 * @typedef {Object} GanttPrep
 * @property {*[]} wars The sorted war list.
 * @property {*[]} merged The full merged war set (for naming).
 * @property {*[]} filtered The filtered subset.
 * @property {number} latestTurn The latest sampled turn.
 * @property {Snapshot[]} samples The sample stream.
 * @property {number|null} filterPid Active civ filter, or null.
 * @property {boolean} showActiveOnly Whether concluded wars are hidden.
 */

/**
 * Read + sort + filter the wars; render the appropriate empty notice and
 * return `null` when there's nothing to draw.
 * @param {HTMLElement} host The view host (for empty notices).
 * @param {GanttOptions} opts The render options.
 * @returns {GanttPrep|null} The prepared data, or `null`.
 */
function prepareGanttData(host, opts) {
  /** @type {any[]} */
  const wars = opts.history && Array.isArray(opts.history.wars) ? opts.history.wars.slice() : [];
  const samples = historySamples(opts.history);
  if (wars.length === 0) {
    appendEmptyNotice(host, t("LOC_DEMOGRAPHICS_EMPTY_NO_WARS"));
    return null;
  }
  const latestTurn = samples.length > 0 ? (samples[samples.length - 1].turn ?? 0) : 0;
  // Collapse concurrent, overlapping wars that share a belligerent into single
  // multi-front wars before anything else, so the whole view (bars, tooltip,
  // naming) sees one war per front-group.
  const merged = mergeWars(wars, latestTurn);
  merged.sort((a, b) => (a.startTurn || 0) - (b.startTurn || 0));
  // Filter pipeline: city states are dropped - this is a major-civ engagement
  // timeline. Coalition wars between two majors still show, but only major
  // civs are rendered as bars.
  const filterPid = typeof opts.filterPid === "number" ? opts.filterPid : null;
  const showActiveOnly = !!opts.activeOnly;
  const filtered = filterGanttWars(merged, showActiveOnly, filterPid);
  if (filtered.length === 0) {
    appendEmptyNotice(host, t("LOC_DEMOGRAPHICS_EMPTY_NO_WARS_MATCH"));
    return null;
  }
  return { wars, merged, filtered, latestTurn, samples, filterPid, showActiveOnly };
}

/**
 * Build the Gantt SVG (background grid + ticks + war bars).
 * @param {*[]} filtered The filtered wars.
 * @param {GanttLayout} L The layout.
 * @param {{ xMin: number, xMax: number }} dom The x-domain.
 * @param {{ min: number, max: number }|null} tr Time-range filter, or null.
 * @param {*} env Shared environment (turnYearMap, latestTurn, samples, W, H).
 * @returns {{ svg: SVGElement, barRects: BarRect[], tickPositions: { t: number, x: number, year: string|null }[] }}
 *   The SVG, bar rects, and x-tick positions.
 */
function buildGanttSvg(filtered, L, dom, tr, env) {
  const { turnYearMap, latestTurn, samples, W, H } = env;
  const svg = svgEl("svg", {
    xmlns: SVG_NS,
    viewBox: `0 0 ${W} ${H}`,
    width: String(W),
    height: String(H),
    preserveAspectRatio: "none",
    class: "demographics-chart-svg",
    "aria-label": "Conflicts timeline"
  });
  const tickPositions = drawGanttGrid(svg, L, dom, turnYearMap);
  const barRects = drawWarBars(svg, filtered, { L, dom, tr, latestTurn, samples });
  drawCrisisMarkers(svg, L, dom, env.crisisOnsets);
  drawCurrentTurnLine(svg, L, dom, latestTurn);
  return { svg, barRects, tickPositions };
}

/**
 * Build the Gantt wrap and mount all HTML overlays (x-ticks, axis titles,
 * war labels) plus the hover tooltip.
 * @param {SVGElement} svg The chart SVG.
 * @param {Object} env Shared environment.
 * @param {*[]} env.merged The full merged war set (for naming).
 * @param {BarRect[]} env.barRects The bar rects.
 * @param {{ t: number, x: number, year: string|null }[]} env.tickPositions Ticks.
 * @param {GanttLayout} env.L The layout.
 * @param {Map<number, string>} env.turnYearMap chart-turn → year map.
 * @param {number} env.latestTurn The latest sampled turn.
 * @param {Snapshot[]} env.samples The sample stream.
 * @param {number} env.W Canvas width.
 * @param {number} env.H Canvas height.
 * @param {{ xMin: number, xMax: number }} env.dom The x-domain.
 * @param {{ stage: number, turn: number, sample: Snapshot }[]} env.crisisOnsets Crisis onsets.
 * @param {string} env.crisisSeed The game seed (for crisis names).
 * @returns {HTMLElement} The chart wrap.
 */
function mountGanttWrap(svg, env) {
  const { merged, barRects, tickPositions, L, turnYearMap, latestTurn, samples, W, H } = env;
  const { dom, crisisOnsets, crisisSeed } = env;
  const wrap = document.createElement("div");
  wrap.className = "demographics-chart-wrap demographics-wars-wrap";
  // Inner canvas: fills the viewport (width/height 100% in CSS) but is forced to
  // at least the chart's NATURAL pixel extent via min-width/min-height, so it
  // stretches to fill when the timeline is small and scrolls when it's large.
  // The SVG (viewBox W x H, preserveAspectRatio none) and the %-positioned
  // overlays both scale with the canvas, so they stay aligned either way.
  const canvas = document.createElement("div");
  canvas.className = "demographics-wars-canvas";
  canvas.style.minWidth = W + "px";
  canvas.style.minHeight = H + "px";
  canvas.appendChild(svg);
  wrap.appendChild(canvas);

  mountGanttXTicks(canvas, tickPositions, L, W, H);
  mountGanttAxisTitles(canvas, L, W, H);
  mountCurrentTurnLabel(canvas, L, latestTurn, W, H);
  mountCrisisLabels(canvas, L, dom, crisisOnsets, crisisSeed, W, H);

  // Name over the FULL merged set (not just the filtered subset) so the names -
  // including recurrence ordinals + world-war numbering - match the War Graphs
  // picker and header, which name the same full set.
  const continentMap = buildContinentMap(samples);
  const nameOverride = buildWarNameOverrides(merged, turnYearMap, latestTurn, continentMap);
  mountWarLabels(canvas, barRects, nameOverride, turnYearMap, latestTurn, W, H);

  // Hover tooltip - custom callout replacing the unreliable `title` attribute.
  const tooltip = createGanttTooltip();
  canvas.appendChild(tooltip);
  const ctx = { nameOverride, turnYearMap, latestTurn, samples };
  wireGanttHover({ wrap, svg, tooltip, barRects, ctx, W, H });
  return wrap;
}
