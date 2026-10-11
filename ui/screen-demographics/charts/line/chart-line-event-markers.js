// chart-line-event-markers.js
//
// Crisis stage onset + age-boundary marker data builders and Chart.js plugins
// used by chart-line.js. Both marker families render as vertical lines + label
// pills over the plot area and share the same clipping and age offset table.

import { localYear, t } from "/demographics/ui/core/demographics-i18n.js";
import { chartFontFamily } from "/demographics/ui/screen-demographics/charts/shared/chart-style.js";
import { DemographicsSettings } from "/demographics/ui/core/demographics-settings.js";
import { flavorCrisisName } from "/demographics/ui/screen-demographics/charts/crises/crisis-names.js";
import {
  CRISIS_STAGE_COLORS,
  CRISIS_STAGE_LABELS
} from "/demographics/ui/screen-demographics/charts/crises/crisis-stage-data.js";
import { mergeWars, policyVisibleWars } from "/demographics/ui/screen-demographics/charts/wars/chart-wars-merge.js";
import { nameMergedWars } from "/demographics/ui/screen-demographics/charts/wars/chart-wars-naming.js";
import { buildYearToChartTurn } from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";

/**
 * A crisis stage-transition marker.
 * @typedef {Object} CrisisMarker
 * @property {number|*} turn Chart-X position.
 * @property {number} stage Display stage (1-4).
 * @property {string} label Stage label.
 * @property {string} color Stage color.
 * @property {string} year Game-year string.
 * @property {string} crisisName Flavor crisis name.
 * @property {number} [stackIndex] Same-turn label stack slot.
 */

/**
 * An age-boundary marker.
 * @typedef {Object} AgeMarker
 * @property {number} turn Chart-X position (age offset + 1).
 * @property {string} label Marker label.
 * @property {string} color Marker color.
 */

// CRISIS_STAGE_LABELS (LOC tags) + CRISIS_STAGE_COLORS come from
// crisis-stage-data.js, shared with the Crises page and the war timeline.
// Labels are translated at render (makeCrisisMarker), not at module load.

/**
 * Shared crisis-marker context: age offsets/boundaries, the game seed, and the
 * sample→chart-X resolver (provided by chart-line.js).
 * @typedef {Object} CrisisCtx
 * @property {Map<string, number>} ageOffsets Per-age cumulative offsets.
 * @property {AgeBoundary[]} boundaries Age boundary table.
 * @property {string} gameSeedStr The game seed string (for flavor names).
 * @property {(sample: Snapshot, offsets: Map<string, number>, boundaries: AgeBoundary[]) => number|undefined}
 *   sampleX
 *   Sample → chart-X position resolver.
 */

/**
 * Walk the history for game-wide crisis stage onsets and build markers.
 * Suppressed on the crisis_stage chart itself.
 * @param {string} metricId
 * @param {DemoHistory|*} history
 * @param {CrisisCtx} crisisCtx Age offsets/boundaries + seed + sampleX resolver.
 * @returns {CrisisMarker[]}
 */
export function collectCrisisMarkers(metricId, history, crisisCtx) {
  /** @type {CrisisMarker[]} */
  const crisisMarkers = [];
  if (shouldSkipCrisisMarkers(metricId, history)) {
    return crisisMarkers;
  }
  // `prev` carried across samples by reference via a 1-element holder so the
  // onset-detection logic lives in one small helper. Label de-overlap is done at
  // draw time (pixel-aware lanes), so collection just gathers markers in order.
  const prevHolder = { prev: -2 }; // sentinel != -1 so first sample is "init"
  for (const sample of history.samples) {
    const markers = detectCrisisOnset(sample, prevHolder, crisisCtx);
    for (const marker of markers) crisisMarkers.push(marker);
  }
  return crisisMarkers;
}

/**
 * The Emigration refugees metrics (scaled people + raw Civ points). These show their own
 * cause-driven markers (war / disaster onsets) instead of the game-wide crisis-stage markers, so
 * crisis collection is suppressed for them.
 * @type {Set<string>}
 */
const REFUGEE_METRIC_IDS = new Set([
  "emig_refugees", "emig_refugees_pts",        // Refugees (Left)
  "emig_refugees_in", "emig_refugees_in_pts"   // Refugees (Arrived), same war/disaster onset markers
]);

/**
 * Whether crisis-marker collection should no-op.
 * @param {string} metricId
 * @param {DemoHistory|*} history
 * @returns {boolean}
 */
function shouldSkipCrisisMarkers(metricId, history) {
  if (metricId === "crisis_stage") return true;
  if (REFUGEE_METRIC_IDS.has(metricId)) return true;
  if (!history || !Array.isArray(history.samples)) return true;
  return history.samples.length === 0;
}

/**
 * Detect a crisis stage onset on one sample, advancing the running `prev`
 * stage. Returns a marker on onset, else `null`.
 * @param {Snapshot|*} sample
 * @param {{ prev: number }} prevHolder Running previous-stage holder (mutated).
 * @param {CrisisCtx} ctx Age offsets/boundaries + seed + sampleX resolver.
 * @returns {CrisisMarker[]}
 */
function detectCrisisOnset(sample, prevHolder, ctx) {
  const raw = readSampleCrisisStage(sample);
  if (raw === undefined) return [];
  const prev = prevHolder.prev;
  // raw is the display value (engine+1): 0..4. A rise from a prior non-negative
  // stage to >= 1 is an onset; the `prev >= 0` guard skips a crisis already in
  // progress at the first recorded sample, so only observed onsets are marked.
  /** @type {CrisisMarker[]} */
  const markers = [];
  if (raw > prev && raw >= 1 && prev >= 0) {
    // If samples skip across stages (e.g., 1 -> 3 between turns), emit each
    // intermediate onset so labels remain complete in historical views.
    const startStage = Math.max(1, prev + 1);
    for (let stage = startStage; stage <= raw; stage++) {
      markers.push(makeCrisisMarker(sample, stage, ctx));
    }
  }
  if (raw >= 0) prevHolder.prev = raw;
  else if (prev === -2) prevHolder.prev = raw; // first sample seed
  return markers;
}

/**
 * @param {*} players Sample players map.
 * @param {string} pid
 * @returns {number|undefined} The player's crisis stage, when present.
 */
function playerCrisisStage(players, pid) {
  const value = players[pid]?.metrics?.crisis_stage;
  if (typeof value !== "number" || !isFinite(value)) return undefined;
  return value;
}

/**
 * Read the global crisis_stage display value off any one player's metrics in a
 * sample.
 * @param {Snapshot|*} sample
 * @returns {number|undefined} The display stage.
 */
function readSampleCrisisStage(sample) {
  // crisis_stage is a global value stamped on every player's metrics, but scan
  // every row and pick the highest numeric stage so a single stale lower value
  // does not suppress an observed onset marker.
  const players = sample?.players;
  if (!players) return undefined;
  let best = undefined;
  for (const pid of Object.keys(players)) {
    const stage = playerCrisisStage(players, pid);
    if (stage === undefined) continue;
    if (best === undefined || stage > best) best = stage;
  }
  return best;
}

/**
 * Build one {@link CrisisMarker} for a stage onset.
 * @param {Snapshot} sample The onset sample.
 * @param {number} raw The display stage value.
 * @param {CrisisCtx} ctx Age offsets/boundaries + seed + sampleX resolver.
 * @returns {CrisisMarker}
 */
function makeCrisisMarker(sample, raw, ctx) {
  const { ageOffsets, boundaries, gameSeedStr, sampleX } = ctx;
  // `raw` is a 1-based stage; clamp into the label/color array.
  const stageIdx = Math.max(0, Math.min(CRISIS_STAGE_LABELS.length - 1, raw - 1));
  const chartX = sampleX(sample, ageOffsets, boundaries);
  return {
    turn: typeof chartX === "number" ? chartX : sample.turn,
    stage: raw,
    label: t(CRISIS_STAGE_LABELS[stageIdx]),
    color: CRISIS_STAGE_COLORS[stageIdx],
    year: sample.gameYear || "",
    crisisName: flavorCrisisName(sample, raw, gameSeedStr)
  };
}

/**
 * Build age-boundary markers from `history.ageBoundaries`.
 * @param {DemoHistory|*} history
 * @param {Map<string, number>} ageOffsets Per-age cumulative offsets.
 * @returns {AgeMarker[]}
 */
export function collectAgeMarkers(history, ageOffsets) {
  /** @type {AgeMarker[]} */
  const ageMarkers = [];
  if (!history || !Array.isArray(history.ageBoundaries)) return ageMarkers;
  /** @type {Record<string, string>} */
  const AGE_NAMES = {
    AGE_ANTIQUITY: t("LOC_DEMOGRAPHICS_AGE_ANTIQUITY_BEGINS"),
    AGE_EXPLORATION: t("LOC_DEMOGRAPHICS_AGE_EXPLORATION_BEGINS"),
    AGE_MODERN: t("LOC_DEMOGRAPHICS_AGE_MODERN_BEGINS")
  };
  for (const boundary of history.ageBoundaries) {
    if (!boundary || typeof boundary.age !== "string") continue;
    // The boundary marker sits at the leftmost X of the new age. From the
    // deterministic offset table that's the age's offset + 1 (the new age's
    // first localTurn is 1).
    const baseOffset = ageOffsets.get(boundary.age);
    if (typeof baseOffset !== "number") continue;
    ageMarkers.push({
      turn: baseOffset + 1,
      label:
        AGE_NAMES[boundary.age] ||
        t("LOC_DEMOGRAPHICS_AGE_GENERIC_BEGINS", boundary.age.replace(/^AGE_/, "")),
      color: "#b78cff" // soft purple
    });
  }
  return ageMarkers;
}

/**
 * Measure a crisis marker's label pill (text lines + box size).
 * @param {*} ctx2
 * @param {CrisisMarker} marker
 * @param {string} family
 * @returns {{ stageText: string, nameText: string, pillW: number,
 *   pillH: number }}
 */
function measureCrisisPill(ctx2, marker, family) {
  const stageText = marker.label + (marker.year ? " · " + localYear(marker.year) : "");
  const nameText = marker.crisisName || "";
  ctx2.font = "17px " + family;
  const stageW = ctx2.measureText(stageText).width;
  ctx2.font = "14px " + family;
  const nameW = nameText ? ctx2.measureText(nameText).width : 0;
  return {
    stageText,
    nameText,
    pillW: Math.max(stageW, nameW) + 10,
    pillH: nameText ? 38 : 24
  };
}

/**
 * The widest crisis-marker label pill (in px) across all markers, measured with
 * the chart's own context + font, so the renderer can pad the right edge enough
 * for the label to draw right of its line.
 * @param {*} chart The Chart instance (provides ctx + font family).
 * @param {*[]} markers
 * @returns {number} The widest pill width in px (0 when there are none).
 */
export function maxCrisisPillWidth(chart, markers) {
  if (!chart || !chart.ctx || !markers || markers.length === 0) return 0;
  const ctx2 = chart.ctx;
  const family = chartFontFamily(chart);
  let max = 0;
  for (const marker of markers) {
    const { pillW } = measureCrisisPill(ctx2, marker, family);
    if (pillW > max) max = pillW;
  }
  return max;
}

/**
 * Build per-marker draw layouts: for each in-range marker resolve its pixel x,
 * pill size, left/right-flipped label box, and a vertical lane so labels whose
 * pills would overlap horizontally stack instead of hiding one another.
 * @param {*} ctx2
 * @param {CrisisMarker[]} markers
 * @param {*} xScale The Chart.js x scale.
 * @param {number} right Plot-area right edge.
 * @param {string} family
 * @returns {{ marker: CrisisMarker, x: number, dx: number, lane: number,
 *   pillW: number, pillH: number, stageText: string, nameText: string }[]}
 */
function layoutCrisisMarkers(ctx2, markers, xScale, right, family) {
  const items = [];
  for (const marker of markers) {
    if (marker.turn < xScale.min || marker.turn > xScale.max) continue;
    const x = xScale.getPixelForValue(marker.turn);
    const pill = measureCrisisPill(ctx2, marker, family);
    // Flip the pill left of the line when it would overflow the right edge.
    const dx = x + 4 + pill.pillW > right ? -(pill.pillW + 4) : 4;
    items.push({ marker, x, dx, lane: 0, ...pill });
  }
  items.sort((a, b) => a.x - b.x);
  assignCrisisLanes(items);
  return items;
}

/**
 * Assign each layout a vertical lane (greedy interval partitioning by the pill's
 * horizontal box) so overlapping labels stack down instead of colliding.
 * @param {{ x: number, dx: number, pillW: number, lane: number }[]}
 *   items Layouts (sorted by x; mutated).
 */
function assignCrisisLanes(items) {
  /** @type {number[]} */
  const laneRight = []; // right pixel each lane is occupied to
  for (const item of items) {
    const left = item.x + item.dx;
    let lane = 0;
    while (lane < laneRight.length && laneRight[lane] > left) lane++;
    item.lane = lane;
    laneRight[lane] = left + item.pillW + 2; // +2px gap
  }
}

/**
 * Draw one crisis marker layout: its vertical line + the two-line label pill at
 * its assigned lane.
 * @param {*} ctx2
 * @param {*} layout The marker layout (from {@link layoutCrisisMarkers}).
 * @param {number} top Plot-area top.
 * @param {number} bottom Plot-area bottom.
 * @param {string} family
 */
function drawCrisisMarkerLayout(ctx2, layout, top, bottom, family) {
  ctx2.save();
  ctx2.strokeStyle = layout.marker.color;
  ctx2.lineWidth = 1.4;
  ctx2.setLineDash([4, 3]);
  ctx2.globalAlpha = 0.85;
  ctx2.beginPath();
  ctx2.moveTo(layout.x, top);
  ctx2.lineTo(layout.x, bottom);
  ctx2.stroke();
  ctx2.setLineDash([]);
  // Stage line on top (marker color), formal crisis name below (cream), in a
  // background pill, dropped to this marker's lane so it never hides a neighbor.
  const stackY = top + 6 + layout.lane * (layout.pillH + 4);
  drawCrisisLabel(ctx2, layout, stackY, family);
  ctx2.restore();
}

/**
 * Draw a crisis marker's label pill: a dark background, the stage text in the
 * marker color, and (when present) the formal crisis name in cream below.
 * @param {*} ctx2 The 2D canvas context (already saved/translated by caller).
 * @param {*} layout The per-marker layout (x/dx/lane/pill size/text/color).
 * @param {number} stackY The lane-stacked y offset.
 * @param {string} family
 */
function drawCrisisLabel(ctx2, layout, stackY, family) {
  ctx2.translate(layout.x + layout.dx, stackY);
  ctx2.fillStyle = "rgba(20, 16, 10, 0.85)";
  ctx2.fillRect(0, 0, layout.pillW, layout.pillH);
  ctx2.font = "17px " + family;
  ctx2.fillStyle = layout.marker.color;
  ctx2.fillText(layout.stageText, 5, 18);
  if (layout.nameText) {
    ctx2.font = "14px " + family;
    ctx2.fillStyle = "#e5d2ac";
    ctx2.fillText(layout.nameText, 5, 34);
  }
}

/**
 * Build the crisis-marker Chart.js plugin: vertical lines + labels at each
 * crisis stage onset, respecting the active x-scale range.
 * @param {CrisisMarker[]} crisisMarkers
 * @returns {Record<string, *>} The Chart.js plugin.
 */
export function makeCrisisMarkerPlugin(crisisMarkers) {
  return {
    id: "demographicsCrisisMarkers",
    /**
     * @param {*} chart
     */
    afterDatasetsDraw(chart) {
      if (!crisisMarkers || crisisMarkers.length === 0) return;
      const xScale = chart.scales.x;
      if (!xScale || !chart.chartArea) return;
      const ctx2 = chart.ctx;
      const { top, bottom, right } = chart.chartArea;
      const family = chartFontFamily(chart);
      const layouts = layoutCrisisMarkers(ctx2, crisisMarkers, xScale, right, family);
      for (const layout of layouts) drawCrisisMarkerLayout(ctx2, layout, top, bottom, family);
    }
  };
}

/**
 * Build the age-boundary-marker Chart.js plugin: purple long-dash lines +
 * labels at each age transition.
 * @param {AgeMarker[]} ageMarkers
 * @returns {Record<string, *>} The Chart.js plugin.
 */
export function makeAgeMarkerPlugin(ageMarkers) {
  return {
    id: "demographicsAgeMarkers",
    /**
     * @param {*} chart
     */
    afterDatasetsDraw(chart) {
      if (!ageMarkers || ageMarkers.length === 0) return;
      const xScale = chart.scales.x;
      if (!xScale || !chart.chartArea) return;
      const ctx2 = chart.ctx;
      const { top, bottom, right } = chart.chartArea;
      const family = chartFontFamily(chart);
      for (const marker of ageMarkers) {
        if (marker.turn < xScale.min || marker.turn > xScale.max) continue;
        const x = xScale.getPixelForValue(marker.turn);
        ctx2.save();
        strokeAgeLine(ctx2, marker, x, top, bottom);
        drawAgeLabel(ctx2, marker, x, { top, bottom, right, family });
        ctx2.restore();
      }
    }
  };
}

/**
 * Stroke an age boundary's vertical long-dash line (caller has saved the ctx).
 * @param {*} ctx2
 * @param {AgeMarker} marker
 * @param {number} x The marker pixel x.
 * @param {number} top Chart-area top.
 * @param {number} bottom Chart-area bottom.
 */
function strokeAgeLine(ctx2, marker, x, top, bottom) {
  ctx2.strokeStyle = marker.color;
  ctx2.lineWidth = 2.8;
  // Long-dash pattern (different from crisis [4,3]) so the two marker types are
  // distinguishable beyond color alone.
  ctx2.setLineDash([8, 4]);
  ctx2.globalAlpha = 1;
  // Soft glow so the age boundary reads as a major, highlighted divider.
  ctx2.shadowColor = marker.color;
  ctx2.shadowBlur = 7;
  ctx2.beginPath();
  ctx2.moveTo(x, top);
  ctx2.lineTo(x, bottom);
  ctx2.stroke();
  ctx2.shadowBlur = 0;
  ctx2.setLineDash([]);
}

/**
 * Draw an age boundary's label pill (purple chrome), flipping left near the
 * right edge. Anchored to the bottom of the plot so it never collides with the
 * crisis labels, which stack from the top.
 * @param {*} ctx2
 * @param {AgeMarker} marker
 * @param {number} x The marker pixel x.
 * @param {{ top: number, bottom: number, right: number, family: string }} area
 *   Chart-area top/bottom/right + font.
 */
function drawAgeLabel(ctx2, marker, x, area) {
  ctx2.font = "17px " + area.family;
  const pillW = ctx2.measureText(marker.label).width + 16;
  const pillH = 24;
  const dx = x + 4 + pillW > area.right ? -(pillW + 4) : 4;
  ctx2.translate(x + dx, area.bottom - pillH - 6);
  // Dark pill with a colored left accent bar so the age label reads as a
  // prominent, highlighted chip (matching the crisis-label treatment).
  ctx2.fillStyle = "rgba(20, 16, 10, 0.9)";
  ctx2.fillRect(0, 0, pillW, pillH);
  ctx2.fillStyle = marker.color;
  ctx2.fillRect(0, 0, 3, pillH);
  // Cream label text (matching the crisis-name pill) so the age divider reads as
  // a clear category chip rather than low-contrast purple-on-dark.
  ctx2.fillStyle = "#e5d2ac";
  ctx2.fillText(marker.label, 9, 17);
}

// Refugees-chart event markers: war + disaster onsets
// War onsets (from the war history) and disaster onsets (from a companion's event log) are
// placed on the timeline by recorded chart turn, else by matching their game-year label to a
// sampled year, so cross-mod turn clocks never have to agree.

const REFUGEE_WAR_COLOR = "#e06c5e"; // warm red, war onsets
const REFUGEE_DISASTER_COLOR = "#e0a458"; // amber, disaster onsets

/**
 * Read the `showWarMarkers` setting (default on): the Options toggle for the Refugees chart's war
 * onset markers, mirroring the wonder-markers filter.
 * @returns {boolean}
 */
export function shouldShowWarMarkers() {
  try {
    return !!DemographicsSettings.getSetting("showWarMarkers", true);
  } catch (_) {
    // DemographicsSettings.getSetting may throw; default to showing them.
    return true;
  }
}

/**
 * Read the `showDisasterMarkers` setting (default on): the Options toggle for the Refugees chart's
 * disaster onset markers (independent of the war-markers toggle).
 * @returns {boolean}
 */
export function shouldShowDisasterMarkers() {
  try {
    return !!DemographicsSettings.getSetting("showDisasterMarkers", true);
  } catch (_) {
    return true;
  }
}

/**
 * Resolve an event's chart-X: its recorded continuous chart turn, else its year-mapped chart turn,
 * else the raw age-local value (last resort, only when its year wasn't a sampled year).
 * @param {number|undefined} chartVal Recorded continuous chart turn, if any.
 * @param {string|null|undefined} year The event's game-year label.
 * @param {number|null|undefined} localVal Age-local turn fallback.
 * @param {Map<string, number>} yearToChart game-year → chartTurn.
 * @returns {number|null} The chart-X, or null.
 */
function resolveEventX(chartVal, year, localVal, yearToChart) {
  if (typeof chartVal === "number" && isFinite(chartVal)) return chartVal;
  if (year && yearToChart.has(year)) return /** @type {number} */ (yearToChart.get(year));
  return typeof localVal === "number" && isFinite(localVal) ? localVal : null;
}

/**
 * The global start chart turn of a war. A merged war carries none of its own, so it is read from
 * its first front: the front with the merged war's start turn and year whose civs it contains.
 * @param {*} war A war from mergeWars().
 * @param {*[]} fronts The wars mergeWars() was given.
 * @returns {number|undefined} The start chart turn, when recorded.
 */
function warStartChartTurn(war, fronts) {
  if (!war._merged) return war.startChartTurn;
  const members = new Set(war.participants || []);
  const roster = (/** @type {*} */ civs) => (Array.isArray(civs) ? civs : []);
  const first = fronts.find(
    (front) =>
      front.startTurn === war.startTurn &&
      front.startYear === war.startYear &&
      [...roster(front.sideACivs), ...roster(front.sideBCivs)].every((civ) => members.has(civ?.pid))
  );
  return first ? first.startChartTurn : undefined;
}

/**
 * The spoiler-guarded wars merged and named exactly as on the Wars page.
 * @param {DemoHistory|*} history
 * @param {*[]} samples
 * @returns {{ fronts: *[], wars: *[], names: Map<number, string> }} The unmerged fronts, the
 *   merged wars, and warUniqueID → localized name (empty when merging failed).
 */
function namedWars(history, samples) {
  const latest = samples.length ? samples[samples.length - 1]?.turn || 0 : 0;
  // A persisted war can name an unmet civ; the spoiler guard drops those wars before naming.
  const fronts = policyVisibleWars(history && history.wars, samples);
  try {
    const wars = mergeWars(fronts, latest);
    return { fronts, wars, names: nameMergedWars(wars, samples) };
  } catch (_) {
    // A malformed persisted roster makes mergeWars throw; keep the unmerged onsets, unnamed.
    return { fronts, wars: fronts, names: new Map() };
  }
}

/**
 * Append a marker for each war's onset (its name + start year), positioned by its recorded start
 * chart turn, else its start-year label. The marker carries the Wars page's localized name; the
 * persisted `name` is English and is never shown.
 * @param {DemoHistory|*} history
 * @param {Map<string, number>} yearToChart game-year → chartTurn.
 * @param {{turn:number, label:string, year:string, color:string}[]} out Markers (appended).
 */
function collectWarOnsetMarkers(history, yearToChart, out) {
  const samples = history && Array.isArray(history.samples) ? history.samples : [];
  const { fronts, wars, names } = namedWars(history, samples);
  for (const war of wars) {
    const x = resolveEventX(warStartChartTurn(war, fronts), war.startYear, war.startTurn, yearToChart);
    if (x === null) continue;
    const label = names.get(war.warUniqueID) || t("LOC_DEMOGRAPHICS_MARKER_WAR");
    out.push({ turn: x, label, year: war.startYear || "", color: REFUGEE_WAR_COLOR });
  }
}

/**
 * Append a marker for each notable disaster onset (name + year) exposed by the Emigration mod. A
 * silent no-op when Emigration isn't installed / exposes no event log.
 * @param {Map<string, number>} yearToChart game-year → chartTurn.
 * @param {{turn:number, label:string, year:string, color:string}[]} out Markers (appended).
 */
function collectDisasterMarkers(yearToChart, out) {
  let events = [];
  try {
    const api = /** @type {*} */ (globalThis).EmigrationData;
    events = api && typeof api.disasterEvents === "function" ? api.disasterEvents() : [];
  } catch (_) {
    events = [];
  }
  for (const disaster of events || []) {
    if (!disaster) continue;
    const x = resolveEventX(undefined, disaster.year, disaster.turn, yearToChart);
    if (x === null) continue;
    out.push({
      turn: x,
      label: disaster.name || t("LOC_DEMOGRAPHICS_MARKER_DISASTER"),
      year: disaster.year || "",
      color: REFUGEE_DISASTER_COLOR
    });
  }
}

/**
 * Collect war + disaster onset markers for the Emigration refugees chart. Empty for any non-refugee
 * metric (so the markers only annotate the graph whose subject they explain).
 * @param {string} metricId
 * @param {DemoHistory|*} history
 * @returns {{turn:number, label:string, year:string, color:string}[]}
 */
export function collectRefugeeEventMarkers(metricId, history) {
  if (!REFUGEE_METRIC_IDS.has(metricId)) return [];
  const samples = history && Array.isArray(history.samples) ? history.samples : [];
  const yearToChart = buildYearToChartTurn(samples);
  /** @type {{turn:number, label:string, year:string, color:string}[]} */
  const markers = [];
  // War and disaster onsets are independent user toggles (both default on), mirroring wonder
  // markers.
  if (shouldShowWarMarkers()) collectWarOnsetMarkers(history, yearToChart, markers);
  if (shouldShowDisasterMarkers()) collectDisasterMarkers(yearToChart, markers);
  return markers;
}

/**
 * Build per-marker draw layouts: pixel x, single-line pill size, left/right-flipped label box, and
 * a vertical lane so labels whose pills would overlap stack instead of hiding one another.
 * @param {*} ctx2
 * @param {{turn:number,label:string,year:string,color:string}[]} markers
 * @param {*} xScale The Chart.js x scale.
 * @param {number} right Plot-area right edge.
 * @param {string} family
 * @returns {*[]}
 */
function layoutRefugeeMarkers(ctx2, markers, xScale, right, family) {
  const items = [];
  for (const marker of markers) {
    if (marker.turn < xScale.min || marker.turn > xScale.max) continue;
    const x = xScale.getPixelForValue(marker.turn);
    const text = marker.label + (marker.year ? " · " + localYear(marker.year) : "");
    ctx2.font = "15px " + family;
    const pillW = ctx2.measureText(text).width + 14;
    const dx = x + 4 + pillW > right ? -(pillW + 4) : 4;
    items.push({ marker, x, dx, lane: 0, pillW, pillH: 22, text });
  }
  items.sort((a, b) => a.x - b.x);
  assignRefugeeLanes(items);
  return items;
}

/**
 * Greedy vertical-lane assignment (by each pill's horizontal box) so overlapping labels stack down.
 * @param {*[]} items Layouts (sorted by x; mutated).
 */
function assignRefugeeLanes(items) {
  /** @type {number[]} */
  const laneRight = [];
  for (const item of items) {
    const left = item.x + item.dx;
    let lane = 0;
    while (lane < laneRight.length && laneRight[lane] > left) lane++;
    item.lane = lane;
    laneRight[lane] = left + item.pillW + 2; // +2px gap
  }
}

/**
 * Draw one refugee event marker: a dashed vertical line in its color + a single-line "name · year"
 * pill (dark background, colored left accent bar, cream text) at its assigned lane.
 * @param {*} ctx2
 * @param {*} layout The marker layout (from {@link layoutRefugeeMarkers}).
 * @param {number} top Plot-area top.
 * @param {number} bottom Plot-area bottom.
 * @param {string} family
 */
function drawRefugeeMarkerLayout(ctx2, layout, top, bottom, family) {
  ctx2.save();
  ctx2.strokeStyle = layout.marker.color;
  ctx2.lineWidth = 1.4;
  ctx2.setLineDash([4, 3]);
  ctx2.globalAlpha = 0.85;
  ctx2.beginPath();
  ctx2.moveTo(layout.x, top);
  ctx2.lineTo(layout.x, bottom);
  ctx2.stroke();
  ctx2.setLineDash([]);
  ctx2.globalAlpha = 1;
  drawRefugeeLabel(ctx2, layout, top + 6 + layout.lane * (layout.pillH + 4), family);
  ctx2.restore();
}

/**
 * Draw a refugee marker's label pill (dark background, colored left accent bar, cream "name ·
 * year").
 * @param {*} ctx2 The 2D canvas context (already saved by the caller).
 * @param {*} layout The per-marker layout (x/dx/pill size/text/color).
 * @param {number} stackY The lane-stacked y offset.
 * @param {string} family
 */
function drawRefugeeLabel(ctx2, layout, stackY, family) {
  ctx2.translate(layout.x + layout.dx, stackY);
  ctx2.fillStyle = "rgba(20, 16, 10, 0.85)";
  ctx2.fillRect(0, 0, layout.pillW, layout.pillH);
  ctx2.fillStyle = layout.marker.color;
  ctx2.fillRect(0, 0, 3, layout.pillH); // colored left accent bar
  ctx2.font = "15px " + family;
  ctx2.fillStyle = "#e5d2ac";
  ctx2.fillText(layout.text, 8, 16);
}

/**
 * Build the refugees-chart event-marker Chart.js plugin: dashed vertical lines + "name · year"
 * label pills at each war / disaster onset, lane-stacked from the top, clipped to the active
 * x-scale range.
 * @param {{turn:number, label:string, year:string, color:string}[]} markers
 * @returns {Record<string, *>} The Chart.js plugin.
 */
export function makeRefugeeEventMarkerPlugin(markers) {
  return {
    id: "demographicsRefugeeEventMarkers",
    /**
     * @param {*} chart
     */
    afterDatasetsDraw(chart) {
      if (!markers || markers.length === 0) return;
      const xScale = chart.scales.x;
      if (!xScale || !chart.chartArea) return;
      const ctx2 = chart.ctx;
      const { top, bottom, right } = chart.chartArea;
      const family = chartFontFamily(chart);
      const layouts = layoutRefugeeMarkers(ctx2, markers, xScale, right, family);
      for (const layout of layouts) drawRefugeeMarkerLayout(ctx2, layout, top, bottom, family);
    }
  };
}
