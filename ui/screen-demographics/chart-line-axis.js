// chart-line-axis.js
//
// Age/time math and X/Y axis tick formatters for the per-civ line chart.
// Extracted from chart-line.js (remediation #26). The age offset model lives
// here so chart-line.js stays focused on series-building and render
// orchestration; sample → chart-X conversion is exposed so sibling plugin
// modules (wonder-markers, event-markers) can be passed `sampleX` as an
// explicit dependency without re-importing the age helpers.

import {
  addLiveTurnYear,
  getXAxisMode,
  nearestByTurn
} from "/demographics/ui/screen-demographics/chart-shared.js";

/**
 * Local error logger so axis-formatter callbacks surface bugs in UI.log
 * without taking a dependency on chart-line.js's own `derr`.
 * @param {...*} a Values to log.
 */
function derr(...a) {
  console.error("[Demographics.chart-line-axis]", ...a);
}

// Compute a sample's "global" X-axis position deterministically from
// (age, localTurn) - no stored offset, no statefulness. Antiquity samples
// land at X = localTurn, exploration at X = antiquityMax + localTurn,
// modern at X = antiquityMax + explorationMax + localTurn. The offsets are
// recomputed on every render from the samples themselves so no historical bug
// can permanently corrupt the X axis.
const AGE_ORDER = ["AGE_ANTIQUITY", "AGE_EXPLORATION", "AGE_MODERN"];
const KNOWN_AGES = new Set(AGE_ORDER);

/**
 * Infer a sample's age type. Trusts explicit `s.age`; legacy samples without
 * it predate age-tagging and are treated as Antiquity.
 * @param {Snapshot|*} s One sample.
 * @param {AgeBoundary[]} [_ageBoundaries] Unused (kept for call-site parity).
 * @returns {string} The age type string.
 */
function inferSampleAge(s, _ageBoundaries) {
  // Trust explicit `s.age` whenever present.
  if (s && typeof s.age === "string") return s.age;
  // Legacy samples without `age` predate the age-tagging code, which
  // means they MUST be antiquity (it was the only age that existed when
  // those samples were written). Earlier we tried to bucket them via the
  // ageBoundaries table, but boundary `.turn` is now stored as age-local
  // (=1) which collapses every legacy sample into the latest age - the
  // opposite of what we want. Just return antiquity unconditionally.
  return "AGE_ANTIQUITY";
}

/**
 * Infer a sample's age-local turn. Uses explicit `localTurn`, else the stored
 * `turn` (age-local for legacy samples), else `null`.
 * @param {Snapshot|*} s One sample.
 * @param {string} [_age] Unused (kept for call-site parity).
 * @param {AgeBoundary[]} [_ageBoundaries] Unused (kept for call-site parity).
 * @returns {number|null} The age-local turn, or `null`.
 */
function inferLocalTurn(s, _age, _ageBoundaries) {
  // Use explicit localTurn when present, otherwise fall back to the
  // stored turn (which IS age-local for legacy samples, since they were
  // never offset).
  // Age-local turns are expected to be 1-based positive integers.
  if (s && typeof s.localTurn === "number" && isFinite(s.localTurn) && s.localTurn > 0) {
    return s.localTurn;
  }
  if (s && typeof s.turn === "number" && isFinite(s.turn) && s.turn > 0) return s.turn;
  return null;
}

/**
 * Compute cumulative per-age X-axis offsets from the samples' max age-local
 * turns, so each age's first turn lands right after the prior age ends.
 * @param {Snapshot[]} samples The sample stream.
 * @param {AgeBoundary[]} ageBoundaries Age boundary table.
 * @returns {{ offsets: Map<string, number>, maxLocalByAge: Map<string, number> }}
 *   The per-age cumulative offset map and the per-age max-local-turn map.
 */
export function computeAgeOffsets(samples, ageBoundaries) {
  /** @type {Map<string, number>} */
  const maxLocalByAge = new Map();
  for (const s of samples) {
    if (!s || typeof s !== "object") continue;
    const age = inferSampleAge(s, ageBoundaries);
    if (!KNOWN_AGES.has(age)) continue;
    const lt = inferLocalTurn(s, age, ageBoundaries);
    if (lt === null) continue;
    const prev = maxLocalByAge.get(age) || 0;
    if (lt > prev) maxLocalByAge.set(age, lt);
  }
  /** @type {Map<string, number>} */
  const offsets = new Map();
  let cum = 0;
  for (const age of AGE_ORDER) {
    offsets.set(age, cum);
    cum += maxLocalByAge.get(age) || 0;
  }
  return { offsets, maxLocalByAge };
}

/**
 * Compute a sample's deterministic chart-X position from its age offset plus
 * age-local turn, falling back to the raw stored `turn`.
 * @param {Snapshot|*} sample One sample.
 * @param {Map<string, number>} offsets Per-age cumulative offsets.
 * @param {AgeBoundary[]} ageBoundaries Age boundary table.
 * @returns {number|undefined} The chart-X position, or `undefined`.
 */
export function sampleX(sample, offsets, ageBoundaries) {
  if (!sample) return undefined;
  if (typeof sample.chartTurn === "number" && isFinite(sample.chartTurn)) {
    return sample.chartTurn;
  }
  const age = inferSampleAge(sample, ageBoundaries);
  const lt = inferLocalTurn(sample, age, ageBoundaries);
  const off = offsets.get(age);
  if (typeof lt === "number" && off !== undefined) {
    return off + lt;
  }
  // Unknown ages and malformed local turns fall back to stored turn so the
  // sample is still plottable, even if age-aware continuity is unavailable.
  if (typeof sample.turn === "number") return sample.turn;
  return undefined;
}

/**
 * Age info attached to a chart-X position.
 * @typedef {Object} TurnAgeInfo
 * @property {string} age Age type string.
 * @property {number} localTurn Age-local turn.
 */

/**
 * Year/age lookup maps keyed by chart-X position.
 * @typedef {Object} TurnMaps
 * @property {Map<number, string>} turnYearMap chart-X → game-year string.
 * @property {Map<number, TurnAgeInfo>} turnAgeMap chart-X → age info.
 */

/**
 * Build the chart-X → year and chart-X → age maps from the sample stream,
 * plus a live entry for the current engine turn.
 * @param {Snapshot[]} samps The sample stream.
 * @param {Map<string, number>} ageOffsets Per-age cumulative offsets.
 * @param {AgeBoundary[]} boundaries Age boundary table.
 * @returns {TurnMaps} The year and age maps.
 */
export function buildTurnMaps(samps, ageOffsets, boundaries) {
  /** @type {Map<number, string>} */
  const turnYearMap = new Map();
  /** @type {Map<number, TurnAgeInfo>} */
  const turnAgeMap = new Map();
  for (const s of samps) {
    if (!s) continue;
    const x = sampleX(s, ageOffsets, boundaries);
    if (typeof x !== "number") continue;
    if (typeof s.gameYear === "string" && s.gameYear.length > 0) {
      turnYearMap.set(x, s.gameYear);
    }
    const inferredAge = inferSampleAge(s, boundaries);
    const inferredLT = inferLocalTurn(s, inferredAge, boundaries);
    if (typeof inferredLT === "number") {
      turnAgeMap.set(x, { age: inferredAge, localTurn: inferredLT });
    }
  }
  // The live entry is keyed by chart-X like the samples, so offset Game.turn
  // (which is age-local) by the CURRENT age's offset - otherwise, in a
  // multi-age set, the current-turn year lands back in the Antiquity X-region.
  addLiveTurnYear(turnYearMap, currentAgeXOffset(samps, ageOffsets, boundaries));
  return { turnYearMap, turnAgeMap };
}

/**
 * The chart-X offset of the current age (the latest sample's age), for placing
 * the live current-turn entry; 0 when there are no samples.
 * @param {Snapshot[]} samps The sample stream.
 * @param {Map<string, number>} ageOffsets Per-age cumulative offsets.
 * @param {AgeBoundary[]} boundaries Age boundary table.
 * @returns {number} The current age's chart-X offset.
 */
function currentAgeXOffset(samps, ageOffsets, boundaries) {
  for (let i = samps.length - 1; i >= 0; i--) {
    if (samps[i]) return ageOffsets.get(inferSampleAge(samps[i], boundaries)) || 0;
  }
  return 0;
}

/** @type {Record<string, string>} */
const AGE_PREFIX = {
  AGE_ANTIQUITY: "A",
  AGE_EXPLORATION: "E",
  AGE_MODERN: "M"
};

/**
 * X-axis tick / Y-axis tick formatter pair.
 * @typedef {Object} AxisFormatters
 * @property {(v: number) => string} fmtX X-axis tick formatter.
 * @property {(v: number) => string} fmtY Y-axis tick formatter.
 */

/**
 * Build the X / Y axis tick formatters bound to the supplied turn maps and
 * metric metadata. Honors the shared {@link getXAxisMode} setting.
 * @param {TurnMaps} maps The chart-X → year/age maps.
 * @param {*} metricMeta The metric metadata (for Y formatting).
 * @param {Map<string, number>} [ageOffsets] Per-age cumulative offsets.
 * @param {Map<string, number>} [maxLocalByAge] Per-age max local turn spans.
 * @returns {AxisFormatters} The formatter pair.
 */
export function makeAxisFormatters(maps, metricMeta, ageOffsets, maxLocalByAge) {
  const { turnYearMap, turnAgeMap } = maps;

  /**
   * Resolve a deterministic age/local-turn pair from chart-X using known
   * age-offset spans. Returns null when X falls outside known spans.
   * @param {number} x Chart-X value.
   * @returns {TurnAgeInfo|null} Exact age-turn info, or null.
   */
  const ageTurnFromX = (x) => {
    for (const age of AGE_ORDER) {
      const off = ageOffsets && ageOffsets.get(age);
      if (typeof off !== "number") continue;
      const max = maxLocalByAge && (maxLocalByAge.get(age) || 0);
      if (!max) continue;
      const start = off + 1;
      const end = off + max;
      if (x >= start && x <= end) {
        return { age, localTurn: x - off };
      }
    }
    return null;
  };
  /**
   * Format a chart-X as an age-relative turn label ("A12", "E1", "T-N").
   * @param {number} t The chart-X position.
   * @returns {string} The label.
   */
  const ageTurnLabel = (t) => {
    const info = ageTurnFromX(t) || nearestByTurn(turnAgeMap, t);
    if (!info) return "T-" + t;
    const pfx = AGE_PREFIX[info.age] || info.age.replace(/^AGE_/, "")[0] || "T";
    return pfx + info.localTurn;
  };
  /**
   * Format a chart-X tick per the active axis mode.
   * @param {number} v The chart-X value.
   * @returns {string} The tick label.
   */
  const fmtX = (v) => {
    const t = Math.round(v);
    const y = nearestByTurn(turnYearMap, t);
    const ageLbl = ageTurnLabel(t);
    const mode = getXAxisMode();
    if (mode === "turn") return ageLbl;
    if (mode === "year") return y || ageLbl;
    return y ? ageLbl + " / " + y : ageLbl;
  };
  /**
   * Format a Y tick using the metric's formatter when available.
   * @param {number} v The value.
   * @returns {string} The formatted value.
   */
  const fmtY = (v) => {
    if (metricMeta && typeof metricMeta.format === "function") {
      try {
        const s = metricMeta.format(v);
        if (typeof s === "string") return s;
      } catch (e) {
        derr("fmtY: metric.format threw:", e);
      }
    }
    if (typeof v === "number" && isFinite(v)) {
      return Number.isInteger(v) ? String(v) : v.toFixed(1);
    }
    return String(v);
  };
  return { fmtX, fmtY };
}
