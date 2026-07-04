// chart-conflicts-timeline.js
//
// The conflicts Gantt timeline (one bar per major-vs-major war):
// collectWarCivOptions + renderConflictsTimeline and their private filtering,
// layout, bar-drawing, war-naming, tooltip, and hover helpers (romanize,
// parseYear, casualty estimate, etc). Migrated verbatim from
// demographics-chart.js.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import {
  dlog,
  SVG_NS,
  svgEl,
  historySamples,
  appendEmptyNotice,
  resolveTurnRange,
  nearestByTurn
} from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";
import {
  buildStackGridConfig,
  drawStackGrid,
  drawStackXTicks
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
import { mountGanttOverlays } from "/demographics/ui/screen-demographics/charts/conflicts/chart-conflicts-timeline-overlays.js";
import {
  CRISIS_STAGE_COLORS,
  crisisStageOnsets
} from "/demographics/ui/screen-demographics/charts/crises/crisis-stage-data.js";
import { getGameSeed } from "/demographics/ui/screen-demographics/charts/crises/crisis-names.js";

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
 * Draw the vertical "current turn" marker: a dashed yellow line across the plot
 * at the latest sampled turn (where the solid bars end and the future tails begin).
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
      stroke: "#ffdf3b",
      "stroke-width": "2"
      // NOTE (audited 2.0.5): no stroke-dasharray — Coherent ignores it (see
      // chart-resources.js drawStackAgeLines). Overlay markers are intentionally
      // SOLID and distinguished by COLOR: current-turn yellow #ffdf3b here,
      // crisis stage-colored, age purple #b78cff. Don't re-add dasharray.
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
        // No stroke-dasharray: Coherent ignores it (audited 2.0.5). Stage COLOR
        // is the differentiator; kept solid to match the other chart markers.
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
 * @param {GanttOptions} [options] Render options.
 * @returns {{ svg: SVGElement }|null} The mounted SVG handle, or `null`.
 */
export function renderConflictsTimeline(host, options) {
  if (!host) return null;
  while (host.firstChild) host.removeChild(host.firstChild);
  const opts = options || {};
  const viewportW = opts.width || 1400;
  const prep = prepareConflictsTimelineData(host, opts);
  if (!prep) return null;
  const { wars, merged, filtered, latestTurn, samples, filterPid, showActiveOnly } = prep;

  const tr = resolveTurnRange(opts);
  const dom = computeGanttDomain(filtered, tr, latestTurn, samples);
  // Natural pixel width from the turn span (>= viewport); the chart scrolls
  // horizontally when the timeline is longer than the viewport.
  const W = computeGanttWidth(viewportW, dom);
  const L = buildGanttLayout(W, opts.height || 600, filtered, dom);
  const H = L.H;
  const env = buildGanttOverlayEnv(samples, latestTurn, W, H, dom);

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
 * Assemble the shared overlay environment: the year map plus the crisis-onset
 * and age markers (mapped onto the continuous chart turn), the game seed, and
 * the canvas geometry - the bundle every overlay mounter and the SVG builder read.
 * @param {Snapshot[]} samples The sample stream.
 * @param {number} latestTurn The latest sampled (continuous) turn.
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 * @param {{ xMin: number, xMax: number }} dom The x-domain.
 * @returns {*} The shared overlay environment.
 */
function buildGanttOverlayEnv(samples, latestTurn, W, H, dom) {
  const turnYearMap = ganttTurnYearMap(samples);
  // Crisis + age overlays on the continuous chart turn (matching the line charts).
  const crisisOnsets = crisisStageOnsets(samples).map((o) => ({
    ...o,
    turn: typeof o.sample?.chartTurn === "number" ? o.sample.chartTurn : o.turn
  }));
  const ageMarkers = collectGanttAgeMarkers(samples);
  const crisisSeed = getGameSeed();
  return {
    turnYearMap, latestTurn, samples, W, H, dom, crisisOnsets, ageMarkers, crisisSeed
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
 * Read + sort + filter the wars; render the appropriate empty notice and
 * return `null` when there's nothing to draw.
 * @param {HTMLElement} host The view host (for empty notices).
 * @param {GanttOptions} opts The render options.
 * @returns {GanttPrep|null} The prepared data, or `null`.
 */
/**
 * Latest continuous (cross-age) chart turn from the samples.
 * @param {Snapshot[]} samples The sample stream.
 * @returns {number} The latest chart turn.
 */
function latestChartTurn(samples) {
  if (!samples.length) return 0;
  const last = samples[samples.length - 1] || {};
  return typeof last.chartTurn === "number" ? last.chartTurn : (last.turn ?? 0);
}

/**
 * game-year → chart-turn map (fallback for mapping legacy wars, recorded before
 * we stamped chartTurn, onto the continuous timeline via their year labels).
 * @param {Snapshot[]} samples The sample stream.
 * @returns {Map<string, number>} game-year → chartTurn.
 */
function buildYearToChartMap(samples) {
  /** @type {Map<string, number>} */
  const m = new Map();
  for (const s of samples) {
    if (s && typeof s.gameYear === "string" && typeof s.chartTurn === "number" && !m.has(s.gameYear)) {
      m.set(s.gameYear, s.chartTurn);
    }
  }
  return m;
}

/**
 * Resolve a war endpoint on the continuous timeline: the recorded chart turn,
 * else the year-mapped chart turn, else the raw age-local value.
 * @param {number|undefined} chartVal Recorded chart turn (if any).
 * @param {string|null|undefined} year The endpoint's game-year label.
 * @param {number|null|undefined} localVal The age-local turn fallback.
 * @param {Map<string, number>} yearToChart game-year → chartTurn.
 * @returns {number|null} The global turn, or null.
 */
function pickGlobalTurn(chartVal, year, localVal, yearToChart) {
  if (typeof chartVal === "number") return chartVal;
  if (year && yearToChart.has(year)) return /** @type {number} */ (yearToChart.get(year));
  return typeof localVal === "number" ? localVal : null;
}

/**
 * Return a copy of a war with its start/end turns remapped to the continuous
 * (cross-age) chart turn, so the whole Gantt pipeline plots on one timeline.
 * @param {*} w The war record.
 * @param {Map<string, number>} yearToChart game-year → chartTurn.
 * @returns {*} The remapped war copy.
 */
function toGlobalTurns(w, yearToChart) {
  const start = pickGlobalTurn(w.startChartTurn, w.startYear, w.startTurn, yearToChart);
  const ended = typeof w.endTurn === "number";
  const end = ended ? pickGlobalTurn(w.endChartTurn, w.endYear, w.endTurn, yearToChart) : null;
  return { ...w, startTurn: start, endTurn: end };
}

/**
 * chart-turn → game-year map for the Gantt x-ticks (the shared buildStackTurnYears
 * keys by the age-local turn, which doesn't match the Gantt's continuous x).
 * @param {Snapshot[]} samples The sample stream.
 * @returns {Map<number, string>} chartTurn → game-year.
 */
function ganttTurnYearMap(samples) {
  /** @type {Map<number, string>} */
  const map = new Map();
  for (const s of samples) {
    if (s && typeof s.chartTurn === "number" && typeof s.gameYear === "string" && s.gameYear) {
      map.set(s.chartTurn, s.gameYear);
    }
  }
  return map;
}

/**
 * Detect age-transition markers on the continuous chart turn (where a sample's
 * age differs from the previous one).
 * @param {Snapshot[]} samples The sample stream.
 * @returns {{ turn: number, label: string }[]} Age markers.
 */
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
  for (const s of samples) {
    const age = s && typeof s.age === "string" ? s.age : null;
    if (prevAge !== null && age !== null && age !== prevAge && typeof s.chartTurn === "number") {
      markers.push({ turn: s.chartTurn, label: names[age] || age.replace(/^AGE_/, "") + " Begins" });
    }
    if (age !== null) prevAge = age;
  }
  return markers;
}

/**
 * Draw the age-transition vertical lines (purple long-dash, like the line charts).
 * @param {SVGElement} svg The chart SVG.
 * @param {GanttLayout} L The layout.
 * @param {{ xMin: number, xMax: number }} dom The x-domain.
 * @param {{ turn: number, label: string }[]} markers Age markers.
 */
function drawGanttAgeMarkers(svg, L, dom, markers) {
  for (const m of markers || []) {
    if (m.turn < dom.xMin || m.turn > dom.xMax) continue;
    const x = L.xOf(m.turn);
    svg.appendChild(
      svgEl("line", {
        x1: x,
        x2: x,
        y1: L.padT,
        y2: L.padT + L.innerH,
        stroke: "#b78cff",
        "stroke-width": "2",
        // No stroke-dasharray: Coherent ignores it (audited 2.0.5). Age markers
        // read by their purple COLOR; solid to match the other chart markers.
        "stroke-opacity": "0.95"
      })
    );
  }
}

/**
 * Load, remap-to-global-chartTurn, merge, sort, and filter the war set.
 * @param {HTMLElement} host The view host (for empty-state notices).
 * @param {*} opts Render options.
 * @returns {{ wars: any[], merged: any[], filtered: any[], latestTurn: number,
 *   samples: Snapshot[], filterPid: number|null, showActiveOnly: boolean }|null}
 *   The prepared data, or null when there is nothing to draw.
 */
function prepareConflictsTimelineData(host, opts) {
  /** @type {any[]} */
  const rawWars = opts.history && Array.isArray(opts.history.wars) ? opts.history.wars : [];
  const samples = historySamples(opts.history);
  if (rawWars.length === 0) {
    appendEmptyNotice(host, t("LOC_DEMOGRAPHICS_EMPTY_NO_WARS"));
    return null;
  }
  // Plot on the continuous chart turn so ages don't overlap; remap each war's
  // age-local start/end onto it before anything else sees them.
  const latestTurn = latestChartTurn(samples);
  const yearToChart = buildYearToChartMap(samples);
  const wars = rawWars.map((w) => toGlobalTurns(w, yearToChart));
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
 * @returns {{ svg: SVGElement, barRects: BarRect[],
 *   tickPositions: { t: number, x: number, year: string|null }[] }}
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
    "aria-label": t("LOC_DEMOGRAPHICS_ARIA_CONFLICTS_TIMELINE")
  });
  const tickPositions = drawGanttGrid(svg, L, dom, turnYearMap);
  const barRects = drawWarBars(svg, filtered, { L, dom, tr, latestTurn, samples });
  drawCrisisMarkers(svg, L, dom, env.crisisOnsets);
  drawGanttAgeMarkers(svg, L, dom, env.ageMarkers);
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
 * @param {{ turn: number, label: string }[]} env.ageMarkers Age-transition markers.
 * @param {string} env.crisisSeed The game seed (for crisis names).
 * @returns {HTMLElement} The chart wrap.
 */
function mountGanttWrap(svg, env) {
  const { barRects, turnYearMap, latestTurn, samples, W, H } = env;
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

  const nameOverride = mountGanttOverlays(canvas, env);

  // Hover tooltip - custom callout replacing the unreliable `title` attribute.
  const tooltip = createGanttTooltip();
  canvas.appendChild(tooltip);
  const ctx = { nameOverride, turnYearMap, latestTurn, samples };
  wireGanttHover({ wrap, svg, tooltip, barRects, ctx, W, H });
  return wrap;
}
