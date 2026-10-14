// chart-conflicts-timeline.js
//
// The conflicts Gantt timeline (one bar per major-vs-major war):
// collectWarCivOptions + renderConflictsTimeline and their private filtering,
// layout, bar-drawing, war-naming, tooltip, and hover helpers (romanize,
// parseYear, casualty estimate, etc).

import { t } from "/demographics/ui/core/demographics-i18n.js";
import {
  log,
  SVG_NS,
  svgEl,
  historySamples,
  appendEmptyNotice,
  resolveTurnRange,
  nearestByTurn,
  buildYearToChartTurn
} from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";
import {
  buildStackGridConfig,
  drawStackGrid,
  drawStackXTicks
} from "/demographics/ui/screen-demographics/charts/shared/chart-stack-grid.js";
import { mergeWars, policyVisibleWars } from "/demographics/ui/screen-demographics/charts/wars/chart-wars-merge.js";
import {
  buildGanttLayout,
  crisisBandHeight,
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
  mountGanttOverlays
} from "/demographics/ui/screen-demographics/charts/conflicts/chart-conflicts-timeline-overlays.js";
import {
  CRISIS_STAGE_COLORS,
  crisisStageOnsets
} from "/demographics/ui/screen-demographics/charts/crises/crisis-stage-data.js";
import { getGameSeed } from "/demographics/ui/screen-demographics/screen/guarded-reads.js";

// Wars Gantt: one horizontal bar per war, stacked vertically by start turn.
// X-axis = turn (with year ticks). Bars colored by the attacker's primary
// color; named with the ordinal-style label the sampler generates.

/** @param {*} roster */
function warCivLabel(roster) {
  return roster.leader ? roster.leader + ", " + roster.civ : roster.civ;
}

/**
 * @param {{ isCS: boolean, label: string }} a
 * @param {{ isCS: boolean, label: string }} b
 */
function compareWarCivOptions(a, b) {
  if (a.isCS !== b.isCS) return a.isCS ? 1 : -1;
  return a.label.localeCompare(b.label);
}

/**
 * List every civ that has appeared in any war, sorted majors-first then by
 * label, for the conflicts-page filter dropdown.
 * @param {DemoHistory|*} history The history blob.
 * @returns {{ pid: *, isCS: boolean, label: string }[]}
 */
export function collectWarCivOptions(history) {
  const wars = policyVisibleWars(history && history.wars, historySamples(history));
  const seen = new Map();
  for (const war of wars) {
    if (!war) continue;
    const allRosters = /** @type {any[]} */ ([]).concat(war.sideACivs || [], war.sideBCivs || []);
    for (const entry of allRosters) {
      if (!entry || seen.has(entry.pid)) continue;
      seen.set(entry.pid, {
        pid: entry.pid,
        isCS: !!entry.isCS,
        label: warCivLabel(entry)
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
 * @param {SVGElement} svg
 * @param {GanttLayout} L
 * @param {{ xMin: number, xMax: number }} dom
 * @param {Map<number, string>} turnYearMap
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
 * @param {SVGElement} svg
 * @param {GanttLayout} L
 * @param {{ xMin: number, xMax: number }} dom
 * @param {number} latestTurn
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
      stroke: "#ffdf3b",
      "stroke-width": "2"
      // No stroke-dasharray: Coherent ignores it. Overlay markers are solid and
      // distinguished by color (current-turn yellow, crisis stage-colored, age purple).
    })
  );
}

/**
 * Draw the crisis stage-onset overlay lines: a solid vertical line at each
 * onset turn, colored by stage, the same markers the historical line charts
 * draw. (Labels are mounted as HTML overlays; see mountCrisisLabels.)
 * @param {SVGElement} svg
 * @param {GanttLayout} L
 * @param {{ xMin: number, xMax: number }} dom
 * @param {{ stage: number, turn: number, sample: Snapshot }[]} onsets
 */
function drawCrisisMarkers(svg, L, dom, onsets) {
  for (const onset of onsets || []) {
    if (onset.turn < dom.xMin || onset.turn > dom.xMax) continue;
    const x = L.xOf(onset.turn);
    const color = CRISIS_STAGE_COLORS[Math.max(0, Math.min(3, onset.stage - 1))];
    svg.appendChild(
      svgEl("line", {
        x1: x,
        x2: x,
        y1: L.padT,
        y2: L.padT + L.innerH,
        stroke: color,
        "stroke-width": "1.4",
        // No stroke-dasharray: Coherent ignores it. Stage color is the
        // differentiator; kept solid to match the other chart markers.
        "stroke-opacity": "0.85"
      })
    );
  }
}

/**
 * Options accepted by {@link renderConflictsTimeline}.
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
 * @param {GanttOptions} [options]
 * @returns {{ svg: SVGElement }|null} The mounted SVG handle, or null when nothing was drawn.
 */
export function renderConflictsTimeline(host, options) {
  if (!host) return null;
  while (host.firstChild) host.removeChild(host.firstChild);
  const opts = options || {};
  const viewportW = opts.width || 1400;
  const prep = prepareConflictsTimelineData(host, opts);
  if (!prep) return null;
  const { wars, merged, filtered, latestTurn, samples, filterPid, showActiveOnly } = prep;

  const turnRange = resolveTurnRange(opts);
  const dom = computeGanttDomain(filtered, turnRange, latestTurn, samples);
  // Natural pixel width from the turn span (>= viewport); the chart scrolls
  // horizontally when the timeline is longer than the viewport.
  const W = computeGanttWidth(viewportW, dom);
  const L = buildGanttLayout(W, opts.height || 600, filtered, dom, ganttCrisisBand(samples, dom));
  const H = L.H;
  const env = buildGanttOverlayEnv(samples, latestTurn, W, H, dom);

  const { svg, barRects, tickPositions } = buildGanttSvg(filtered, L, dom, turnRange, env);
  const wrap = mountGanttWrap(svg, { merged, barRects, tickPositions, L, ...env });

  host.appendChild(wrap);
  log.debug(
    "wars gantt mounted; wars=",
    wars.length,
    "filtered=" + filtered.length,
    "filterPid=" + filterPid,
    "activeOnly=" + showActiveOnly
  );
  return { svg };
}

/**
 * Room to reserve at the top of the plot for the crisis labels. The onsets have to be counted
 * before the layout the band widens, and only the ones inside the window take room.
 * @param {Snapshot[]} samples
 * @param {{ xMin: number, xMax: number }} dom
 * @returns {number} Band height in chart pixels.
 */
function ganttCrisisBand(samples, dom) {
  const inWindow = ganttCrisisOnsets(samples).filter(
    (onset) => onset.turn >= dom.xMin && onset.turn <= dom.xMax
  );
  return crisisBandHeight(inWindow.length);
}

/**
 * The crisis stage onsets on the continuous chart turn (matching the line charts). Read twice per
 * render (once to size the crisis band, once by the overlay environment), so it lives here.
 * @param {Snapshot[]} samples
 * @returns {{ stage: number, turn: number, sample: Snapshot }[]}
 */
function ganttCrisisOnsets(samples) {
  return crisisStageOnsets(samples).map((onset) => ({
    ...onset,
    turn: typeof onset.sample?.chartTurn === "number" ? onset.sample.chartTurn : onset.turn
  }));
}

/**
 * @param {Snapshot[]} samples
 * @param {number} latestTurn The latest sampled (continuous) turn.
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 * @param {{ xMin: number, xMax: number }} dom
 */
function buildGanttOverlayEnv(samples, latestTurn, W, H, dom) {
  const turnYearMap = ganttTurnYearMap(samples);
  const crisisOnsets = ganttCrisisOnsets(samples);
  const ageMarkers = collectGanttAgeMarkers(samples);
  const crisisSeed = getGameSeed();
  return {
    turnYearMap,
    latestTurn,
    samples,
    W,
    H,
    dom,
    crisisOnsets,
    ageMarkers,
    crisisSeed
  };
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
 * Latest continuous (cross-age) chart turn from the samples.
 * @param {Snapshot[]} samples
 * @returns {number}
 */
function latestChartTurn(samples) {
  if (!samples.length) return 0;
  const last = samples[samples.length - 1] || {};
  return typeof last.chartTurn === "number" ? last.chartTurn : (last.turn ?? 0);
}

/**
 * @param {number|undefined} chartVal Recorded chart turn (if any).
 * @param {string|null|undefined} year The endpoint's game-year label.
 * @param {number|null|undefined} localVal The age-local turn fallback.
 * @param {Map<string, number>} yearToChart game-year → chartTurn.
 */
function pickGlobalTurn(chartVal, year, localVal, yearToChart) {
  if (typeof chartVal === "number") return chartVal;
  if (year && yearToChart.has(year)) return /** @type {number} */ (yearToChart.get(year));
  return typeof localVal === "number" ? localVal : null;
}

/**
 * Return a copy of a war with its start/end turns remapped to the continuous
 * (cross-age) chart turn, so the whole Gantt pipeline plots on one timeline.
 * @param {*} war
 * @param {Map<string, number>} yearToChart game-year → chartTurn.
 * @returns {*}
 */
function toGlobalTurns(war, yearToChart) {
  const start = pickGlobalTurn(war.startChartTurn, war.startYear, war.startTurn, yearToChart);
  const ended = typeof war.endTurn === "number";
  const end = ended ? pickGlobalTurn(war.endChartTurn, war.endYear, war.endTurn, yearToChart) : null;
  return { ...war, startTurn: start, endTurn: end };
}

/**
 * chart-turn → game-year map for the Gantt x-ticks (the shared buildStackTurnYears
 * keys by the age-local turn, which doesn't match the Gantt's continuous x).
 * @param {Snapshot[]} samples
 * @returns {Map<number, string>} chartTurn → game-year.
 */
function ganttTurnYearMap(samples) {
  /** @type {Map<number, string>} */
  const map = new Map();
  for (const sample of samples) {
    if (
      sample &&
      typeof sample.chartTurn === "number" &&
      typeof sample.gameYear === "string" &&
      sample.gameYear
    ) {
      map.set(sample.chartTurn, sample.gameYear);
    }
  }
  return map;
}

/** @param {Snapshot[]} samples */
function collectGanttAgeMarkers(samples) {
  /** @type {Record<string, string>} */
  const names = {
    AGE_ANTIQUITY: t("LOC_DEMOGRAPHICS_AGE_ANTIQUITY_BEGINS"),
    AGE_EXPLORATION: t("LOC_DEMOGRAPHICS_AGE_EXPLORATION_BEGINS"),
    AGE_MODERN: t("LOC_DEMOGRAPHICS_AGE_MODERN_BEGINS")
  };
  /** @type {{ turn: number, label: string }[]} */
  const markers = [];
  let prevAge = null;
  for (const sample of samples) {
    const age = sample && typeof sample.age === "string" ? sample.age : null;
    if (prevAge !== null && age !== null && age !== prevAge && typeof sample.chartTurn === "number") {
      markers.push({
        turn: sample.chartTurn,
        label: names[age] || t("LOC_DEMOGRAPHICS_AGE_GENERIC_BEGINS", age.replace(/^AGE_/, ""))
      });
    }
    if (age !== null) prevAge = age;
  }
  return markers;
}

/**
 * @param {SVGElement} svg
 * @param {GanttLayout} L
 * @param {{ xMin: number, xMax: number }} dom
 * @param {{ turn: number, label: string }[]} markers
 */
function drawGanttAgeMarkers(svg, L, dom, markers) {
  for (const marker of markers || []) {
    if (marker.turn < dom.xMin || marker.turn > dom.xMax) continue;
    const x = L.xOf(marker.turn);
    svg.appendChild(
      svgEl("line", {
        x1: x,
        x2: x,
        y1: L.padT,
        y2: L.padT + L.innerH,
        stroke: "#b78cff",
        "stroke-width": "2",
        // No stroke-dasharray: Coherent ignores it. Age markers read by their
        // purple color; solid to match the other chart markers.
        "stroke-opacity": "0.95"
      })
    );
  }
}

/**
 * @param {HTMLElement} host The view host (for empty-state notices).
 * @param {*} opts
 */
function prepareConflictsTimelineData(host, opts) {
  // Persisted arrays: drop null elements (a null war / sample) before anything dereferences them.
  /** @type {any[]} */
  const samples = historySamples(opts.history).filter(Boolean);
  // Spoiler guard first: a hidden civ must not reach the bars, the tooltips or the naming.
  const rawWars = policyVisibleWars(opts.history && opts.history.wars, samples);
  if (rawWars.length === 0) {
    appendEmptyNotice(host, t("LOC_DEMOGRAPHICS_EMPTY_NO_WARS"));
    return null;
  }
  // Plot on the continuous chart turn so ages don't overlap; remap each war's
  // age-local start/end onto it before anything else sees them.
  const latestTurn = latestChartTurn(samples);
  const yearToChart = buildYearToChartTurn(samples);
  const wars = rawWars.map((w) => toGlobalTurns(w, yearToChart));
  // Collapse concurrent, overlapping wars that share a belligerent into single
  // multi-front wars before anything else, so the whole view (bars, tooltip,
  // naming) sees one war per front-group.
  const merged = mergeWars(wars, latestTurn);
  merged.sort((a, b) => (a.startTurn || 0) - (b.startTurn || 0));
  // Filter pipeline: city states are dropped, since this is a major-civ engagement
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
 * @param {*[]} filtered
 * @param {GanttLayout} L
 * @param {{ xMin: number, xMax: number }} dom
 * @param {{ min: number, max: number }|null} turnRange
 * @param {*} env Shared environment (turnYearMap, latestTurn, samples, W, H).
 */
function buildGanttSvg(filtered, L, dom, turnRange, env) {
  const { turnYearMap, latestTurn, samples, W, H } = env;
  const svg = svgEl("svg", {
    xmlns: SVG_NS,
    viewBox: `0 0 ${W} ${H}`,
    width: String(W),
    height: String(H),
    preserveAspectRatio: "none",
    class: "demographics-chart-svg",
    "aria-label": t("LOC_DEMOGRAPHICS_ARIA_CONFLICTS_TIMELINE")
  });
  const tickPositions = drawGanttGrid(svg, L, dom, turnYearMap);
  const barRects = drawWarBars(svg, filtered, { L, dom, tr: turnRange, latestTurn, samples });
  drawCrisisMarkers(svg, L, dom, env.crisisOnsets);
  drawGanttAgeMarkers(svg, L, dom, env.ageMarkers);
  drawCurrentTurnLine(svg, L, dom, latestTurn);
  return { svg, barRects, tickPositions };
}

/**
 * @param {SVGElement} svg
 * @param {Object} env Shared environment.
 * @param {*[]} env.merged The full merged war set (for naming).
 * @param {BarRect[]} env.barRects
 * @param {{ t: number, x: number, year: string|null }[]} env.tickPositions
 * @param {GanttLayout} env.L
 * @param {Map<number, string>} env.turnYearMap chart-turn → year map.
 * @param {number} env.latestTurn The latest sampled turn.
 * @param {Snapshot[]} env.samples
 * @param {number} env.W Canvas width.
 * @param {number} env.H Canvas height.
 * @param {{ xMin: number, xMax: number }} env.dom
 * @param {{ stage: number, turn: number, sample: Snapshot }[]} env.crisisOnsets
 * @param {{ turn: number, label: string }[]} env.ageMarkers Age-transition markers.
 * @param {string} env.crisisSeed The game seed (for crisis names).
 */
function mountGanttWrap(svg, env) {
  const { barRects, turnYearMap, latestTurn, samples, W, H } = env;
  const wrap = document.createElement("div");
  wrap.className = "demographics-chart-wrap demographics-wars-wrap";
  // Inner canvas: fills the viewport but is forced to at least the chart's natural
  // pixel extent via min-width/min-height, so it stretches when the timeline is
  // small and scrolls when large; the SVG and %-positioned overlays scale with it.
  const canvas = document.createElement("div");
  canvas.className = "demographics-wars-canvas";
  canvas.style.minWidth = W + "px";
  canvas.style.minHeight = H + "px";
  canvas.appendChild(svg);
  wrap.appendChild(canvas);

  const nameOverride = mountGanttOverlays(canvas, env);

  // Hover tooltip: a custom callout replacing the unreliable `title` attribute.
  const tooltip = createGanttTooltip();
  // Starts in the canvas; the first hover moves it onto the screen frame so it can outgrow the
  // scrolling wrap (see ensureTooltipHost in chart-wars-gantt-interactions.js).
  canvas.appendChild(tooltip);
  const ctx = { nameOverride, turnYearMap, latestTurn, samples };
  wireGanttHover({ wrap, svg, tooltip, barRects, ctx, W, H });
  return wrap;
}
