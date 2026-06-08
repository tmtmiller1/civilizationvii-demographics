// chart-line-event-markers.js
//
// Crisis stage onset + age-boundary marker data builders and Chart.js plugins
// used by chart-line.js. Extracted from chart-line.js.
// Both marker families render as vertical lines + label pills over the plot
// area, share the same x-scale clipping pattern, and consume the same age
// offset table, so they ride together.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { flavorCrisisName } from "/demographics/ui/screen-demographics/charts/crises/crisis-names.js";
import {
  CRISIS_STAGE_COLORS,
  CRISIS_STAGE_LABELS
} from "/demographics/ui/screen-demographics/charts/crises/crisis-stage-data.js";

/**
 * Resolve the chart font family with a safe fallback chain.
 * @param {*} chart The Chart instance.
 * @returns {string} The preferred font family.
 */
function resolveChartFontFamily(chart) {
  return (
    chart?.options?.font?.family ||
    (typeof Chart !== "undefined" && Chart.defaults?.font?.family) ||
    "BodyFont, sans-serif"
  );
}

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
// crisis-stage-data.js so the line-chart markers, the Crises page, and the war
// timeline share one source of truth. Labels are LOC tags translated at render
// (in makeCrisisMarker), not baked at module load.

/**
 * Shared crisis-marker context: age offsets/boundaries, the game seed, and the
 * sample→chart-X resolver (provided by chart-line.js).
 * @typedef {Object} CrisisCtx
 * @property {Map<string, number>} ageOffsets Per-age cumulative offsets.
 * @property {AgeBoundary[]} boundaries Age boundary table.
 * @property {string} gameSeedStr The game seed string (for flavor names).
 * @property {(s: Snapshot, off: Map<string, number>, b: AgeBoundary[]) => number|undefined} sampleX
 *   Sample → chart-X position resolver.
 */

/**
 * Walk the history for game-wide crisis stage onsets and build markers.
 * Suppressed on the crisis_stage chart itself.
 * @param {string} metricId Active metric id.
 * @param {DemoHistory|*} history The history blob.
 * @param {CrisisCtx} crisisCtx Age offsets/boundaries + seed + sampleX resolver.
 * @returns {CrisisMarker[]} The crisis markers.
 */
export function collectCrisisMarkers(metricId, history, crisisCtx) {
  /** @type {CrisisMarker[]} */
  const crisisMarkers = [];
  if (shouldSkipCrisisMarkers(metricId, history)) {
    return crisisMarkers;
  }
  // `prev` carried across samples by reference via a 1-element holder so the
  // onset-detection logic lives in one small helper. Label de-overlap is done at
  // DRAW time (pixel-aware lanes), so collection just gathers markers in order.
  const prevHolder = { prev: -2 }; // sentinel != -1 so first sample is "init"
  for (const s of history.samples) {
    const markers = detectCrisisOnset(s, prevHolder, crisisCtx);
    for (const mk of markers) crisisMarkers.push(mk);
  }
  return crisisMarkers;
}

/**
 * Decide whether crisis-marker collection should no-op.
 * @param {string} metricId Active metric id.
 * @param {DemoHistory|*} history The history blob.
 * @returns {boolean} True when collection should be skipped.
 */
function shouldSkipCrisisMarkers(metricId, history) {
  if (metricId === "crisis_stage") return true;
  if (!history || !Array.isArray(history.samples)) return true;
  return history.samples.length === 0;
}

/**
 * Detect a crisis stage onset on one sample, advancing the running `prev`
 * stage. Returns a marker on onset, else `null`.
 * @param {Snapshot|*} s One sample.
 * @param {{ prev: number }} prevHolder Running previous-stage holder (mutated).
 * @param {CrisisCtx} ctx Age offsets/boundaries + seed + sampleX resolver.
 * @returns {CrisisMarker[]} The onset marker(s).
 */
function detectCrisisOnset(s, prevHolder, ctx) {
  const raw = readSampleCrisisStage(s);
  if (raw === undefined) return [];
  const prev = prevHolder.prev;
  // raw is the DISPLAY value (engine+1 from the accessor): 0..4. A transition
  // from a prior non-negative stage up to ≥1 is a stage onset. The `prev >= 0`
  // guard intentionally does NOT mark a crisis already in progress at the FIRST
  // recorded sample - we only mark onsets we actually observed in-history
  // (normal play samples from turn 1, so real onsets are always captured).
  /** @type {CrisisMarker[]} */
  const markers = [];
  if (raw > prev && raw >= 1 && prev >= 0) {
    // If samples skip across stages (e.g., 1 -> 3 between turns), emit each
    // intermediate onset so labels remain complete in historical views.
    const startStage = Math.max(1, prev + 1);
    for (let stage = startStage; stage <= raw; stage++) {
      markers.push(makeCrisisMarker(s, stage, ctx));
    }
  }
  if (raw >= 0) prevHolder.prev = raw;
  else if (prev === -2) prevHolder.prev = raw; // first sample seed
  return markers;
}

/**
 * Read one player's crisis stage value from a sample.
 * @param {*} players Sample players map.
 * @param {string} pid Player id key.
 * @returns {number|undefined} Numeric crisis stage, when present.
 */
function playerCrisisStage(players, pid) {
  const value = players[pid]?.metrics?.crisis_stage;
  if (typeof value !== "number" || !isFinite(value)) return undefined;
  return value;
}

/**
 * Read the global crisis_stage display value off any one player's metrics in a
 * sample.
 * @param {Snapshot|*} s One sample.
 * @returns {number|undefined} The display stage, or `undefined`.
 */
function readSampleCrisisStage(s) {
  // crisis_stage is a global value stamped on EVERY player's metrics, but scan
  // every row and pick the highest numeric stage so a single stale lower value
  // does not suppress an observed onset marker.
  const players = s?.players;
  if (!players) return undefined;
  let best = undefined;
  for (const pid of Object.keys(players)) {
    const v = playerCrisisStage(players, pid);
    if (v === undefined) continue;
    if (best === undefined || v > best) best = v;
  }
  return best;
}

/**
 * Build one {@link CrisisMarker} for a stage onset.
 * @param {Snapshot} s The onset sample.
 * @param {number} raw The display stage value.
 * @param {CrisisCtx} ctx Age offsets/boundaries + seed + sampleX resolver.
 * @returns {CrisisMarker} The marker.
 */
function makeCrisisMarker(s, raw, ctx) {
  const { ageOffsets, boundaries, gameSeedStr, sampleX } = ctx;
  // Clamp to a valid stage index even if `raw` is unexpectedly 0/negative
  // (callers only pass raw >= 1 today, but keep the helper self-defensive).
  const stageIdx = Math.max(0, Math.min(CRISIS_STAGE_LABELS.length - 1, raw - 1));
  const cx = sampleX(s, ageOffsets, boundaries);
  return {
    turn: typeof cx === "number" ? cx : s.turn,
    stage: raw,
    label: t(CRISIS_STAGE_LABELS[stageIdx]),
    color: CRISIS_STAGE_COLORS[stageIdx],
    year: s.gameYear || "",
    crisisName: flavorCrisisName(s, raw, gameSeedStr)
  };
}

/**
 * Build age-boundary markers from `history.ageBoundaries`.
 * @param {DemoHistory|*} history The history blob.
 * @param {Map<string, number>} ageOffsets Per-age cumulative offsets.
 * @returns {AgeMarker[]} The age markers.
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
  for (const b of history.ageBoundaries) {
    if (!b || typeof b.age !== "string") continue;
    // The boundary marker should sit at the LEFTMOST X of the new age. From
    // the deterministic offset table that's simply the age's offset + 1 (the
    // new age's first localTurn is 1).
    const baseOffset = ageOffsets.get(b.age);
    if (typeof baseOffset !== "number") continue;
    ageMarkers.push({
      turn: baseOffset + 1,
      label: AGE_NAMES[b.age] || b.age.replace(/^AGE_/, "") + " Begins",
      color: "#b78cff" // soft purple
    });
  }
  return ageMarkers;
}

/**
 * Measure a crisis marker's label pill (text lines + box size).
 * @param {*} ctx2 The 2D canvas context.
 * @param {CrisisMarker} mk The marker.
 * @param {string} family Font family for label text.
 * @returns {{ stageText: string, nameText: string, pillW: number,
 *   pillH: number }} The pill metrics.
 */
function measureCrisisPill(ctx2, mk, family) {
  const stageText = mk.label + (mk.year ? " · " + mk.year : "");
  const nameText = mk.crisisName || "";
  ctx2.font = "17px " + family;
  const stageW = ctx2.measureText(stageText).width;
  ctx2.font = "14px " + family;
  const nameW = nameText ? ctx2.measureText(nameText).width : 0;
  return { stageText, nameText, pillW: Math.max(stageW, nameW) + 10, pillH: nameText ? 38 : 24 };
}

/**
 * The widest crisis-marker label pill (in px) across all markers, measured with
 * the chart's own context + font. Used by the renderer to size exact right-edge
 * future padding so the label always has pixel room to draw right of its line,
 * regardless of how wide the y-axis labels (and thus the plot area) are.
 * @param {*} chart The Chart instance (provides ctx + font family).
 * @param {*[]} markers The crisis markers.
 * @returns {number} The widest pill width in px (0 when there are none).
 */
export function maxCrisisPillWidth(chart, markers) {
  if (!chart || !chart.ctx || !markers || markers.length === 0) return 0;
  const ctx2 = chart.ctx;
  const family = resolveChartFontFamily(chart);
  let max = 0;
  for (const mk of markers) {
    const { pillW } = measureCrisisPill(ctx2, mk, family);
    if (pillW > max) max = pillW;
  }
  return max;
}

/**
 * Build per-marker draw layouts: for each in-range marker resolve its pixel x,
 * pill size, left/right-flipped label box, and a vertical LANE so labels whose
 * pills would overlap horizontally stack instead of hiding one another.
 * @param {*} ctx2 The 2D canvas context.
 * @param {CrisisMarker[]} markers The markers.
 * @param {*} xScale The Chart.js x scale.
 * @param {number} right Plot-area right edge.
 * @param {string} family Font family.
 * @returns {{ mk: CrisisMarker, x: number, dx: number, lane: number,
 *   pillW: number, pillH: number, stageText: string, nameText: string }[]}
 *   The layouts.
 */
function layoutCrisisMarkers(ctx2, markers, xScale, right, family) {
  const items = [];
  for (const mk of markers) {
    if (mk.turn < xScale.min || mk.turn > xScale.max) continue;
    const x = xScale.getPixelForValue(mk.turn);
    const m = measureCrisisPill(ctx2, mk, family);
    // Flip the pill left of the line when it would overflow the right edge.
    const dx = x + 4 + m.pillW > right ? -(m.pillW + 4) : 4;
    items.push({ mk, x, dx, lane: 0, ...m });
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
  for (const it of items) {
    const left = it.x + it.dx;
    let lane = 0;
    while (lane < laneRight.length && laneRight[lane] > left) lane++;
    it.lane = lane;
    laneRight[lane] = left + it.pillW + 2; // +2px gap
  }
}

/**
 * Draw one crisis marker layout: its vertical line + the two-line label pill at
 * its assigned lane.
 * @param {*} ctx2 The 2D canvas context.
 * @param {*} L The marker layout (from {@link layoutCrisisMarkers}).
 * @param {number} top Plot-area top.
 * @param {number} bottom Plot-area bottom.
 * @param {string} family Font family for label text.
 */
function drawCrisisMarkerLayout(ctx2, L, top, bottom, family) {
  ctx2.save();
  ctx2.strokeStyle = L.mk.color;
  ctx2.lineWidth = 1.4;
  ctx2.setLineDash([4, 3]);
  ctx2.globalAlpha = 0.85;
  ctx2.beginPath();
  ctx2.moveTo(L.x, top);
  ctx2.lineTo(L.x, bottom);
  ctx2.stroke();
  ctx2.setLineDash([]);
  // Stage line on top (marker color), formal crisis name below (cream), in a
  // background pill, dropped to this marker's lane so it never hides a neighbor.
  const stackY = top + 6 + L.lane * (L.pillH + 4);
  drawCrisisLabel(ctx2, L, stackY, family);
  ctx2.restore();
}

/**
 * Draw a crisis marker's label pill: a dark background, the stage text in the
 * marker color, and (when present) the formal crisis name in cream below.
 * @param {*} ctx2 The 2D canvas context (already saved/translated by caller).
 * @param {*} L The per-marker layout (x/dx/lane/pill size/text/color).
 * @param {number} stackY The lane-stacked y offset.
 * @param {string} family The font family.
 */
function drawCrisisLabel(ctx2, L, stackY, family) {
  ctx2.translate(L.x + L.dx, stackY);
  ctx2.fillStyle = "rgba(20, 16, 10, 0.85)";
  ctx2.fillRect(0, 0, L.pillW, L.pillH);
  ctx2.font = "17px " + family;
  ctx2.fillStyle = L.mk.color;
  ctx2.fillText(L.stageText, 5, 18);
  if (L.nameText) {
    ctx2.font = "14px " + family;
    ctx2.fillStyle = "#e5d2ac";
    ctx2.fillText(L.nameText, 5, 34);
  }
}

/**
 * Build the crisis-marker Chart.js plugin: vertical lines + labels at each
 * crisis stage onset, respecting the active x-scale range.
 * @param {CrisisMarker[]} crisisMarkers The markers to draw.
 * @returns {Record<string, *>} The Chart.js plugin object.
 */
export function makeCrisisMarkerPlugin(crisisMarkers) {
  return {
    id: "demographicsCrisisMarkers",
    /**
     * @param {*} c The Chart instance.
     */
    afterDatasetsDraw(c) {
      if (!crisisMarkers || crisisMarkers.length === 0) return;
      const xScale = c.scales.x;
      if (!xScale) return;
      const ctx2 = c.ctx;
      const { top, bottom, right } = c.chartArea;
      const family = resolveChartFontFamily(c);
      const layouts = layoutCrisisMarkers(ctx2, crisisMarkers, xScale, right, family);
      for (const L of layouts) drawCrisisMarkerLayout(ctx2, L, top, bottom, family);
    }
  };
}

/**
 * Build the age-boundary-marker Chart.js plugin: purple long-dash lines +
 * labels at each age transition.
 * @param {AgeMarker[]} ageMarkers The markers to draw.
 * @returns {Record<string, *>} The Chart.js plugin object.
 */
export function makeAgeMarkerPlugin(ageMarkers) {
  return {
    id: "demographicsAgeMarkers",
    /**
     * @param {*} c The Chart instance.
     */
    afterDatasetsDraw(c) {
      if (!ageMarkers || ageMarkers.length === 0) return;
      const xScale = c.scales.x;
      if (!xScale) return;
      const ctx2 = c.ctx;
      const { top, bottom, right } = c.chartArea;
      const family = resolveChartFontFamily(c);
      for (const mk of ageMarkers) {
        if (mk.turn < xScale.min || mk.turn > xScale.max) continue;
        const x = xScale.getPixelForValue(mk.turn);
        ctx2.save();
        strokeAgeLine(ctx2, mk, x, top, bottom);
        drawAgeLabel(ctx2, mk, x, { top, right, family });
        ctx2.restore();
      }
    }
  };
}

/**
 * Stroke an age boundary's vertical long-dash line (caller has saved the ctx).
 * @param {*} ctx2 The 2D canvas context.
 * @param {AgeMarker} mk The age marker.
 * @param {number} x The marker pixel x.
 * @param {number} top Chart-area top.
 * @param {number} bottom Chart-area bottom.
 */
function strokeAgeLine(ctx2, mk, x, top, bottom) {
  ctx2.strokeStyle = mk.color;
  ctx2.lineWidth = 2.8;
  // Long-dash pattern (different from crisis [4,3]) so the two marker types are
  // distinguishable beyond color alone.
  ctx2.setLineDash([8, 4]);
  ctx2.globalAlpha = 1;
  // Soft glow so the age boundary reads as a major, highlighted divider.
  ctx2.shadowColor = mk.color;
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
 * right edge. Sits below a two-line crisis pill so the two don't overlap.
 * @param {*} ctx2 The 2D canvas context.
 * @param {AgeMarker} mk The age marker.
 * @param {number} x The marker pixel x.
 * @param {{ top: number, right: number, family: string }} area Chart-area top/right + font.
 */
function drawAgeLabel(ctx2, mk, x, area) {
  ctx2.font = "17px " + area.family;
  const pillW = ctx2.measureText(mk.label).width + 16;
  const pillH = 24;
  const dx = x + 4 + pillW > area.right ? -(pillW + 4) : 4;
  ctx2.translate(x + dx, area.top + 48);
  // Dark pill with a colored left accent bar so the age label reads as a
  // prominent, highlighted chip (matching the crisis-label treatment).
  ctx2.fillStyle = "rgba(20, 16, 10, 0.9)";
  ctx2.fillRect(0, 0, pillW, pillH);
  ctx2.fillStyle = mk.color;
  ctx2.fillRect(0, 0, 3, pillH);
  ctx2.fillText(mk.label, 9, 17);
}
