// chart-line-axis.js
//
// Age/time math and X/Y axis tick formatters for the per-civ line chart. The
// sample → chart-X conversion (`sampleX`) is exposed so sibling plugin modules
// can take it as an explicit dependency.

import {
  addLiveTurnYear,
  getXAxisMode,
  nearestByTurn
} from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";
import { localYear, turnLabel } from "/demographics/ui/core/demographics-i18n.js";
import { makeLogger } from "/demographics/ui/core/demographics-log.js";

// Axis-formatter callbacks log their own failures so a bug there still reaches UI.log.
const log = makeLogger("chart-line-axis");

// A sample's "global" X-axis position is computed deterministically from
// (age, localTurn): each age's samples land right after the previous age's.
// Age order and per-age spans are derived from the samples on every render, so
// any number of ages plot correctly with no hardcoded age list.

/**
 * Infer a sample's age type. Trusts explicit `sample.age`; legacy samples without
 * it predate age-tagging and are treated as Antiquity.
 * @param {Snapshot|*} sample
 * @param {AgeBoundary[]} [_ageBoundaries] Unused (kept for call-site parity).
 * @returns {string}
 */
function inferSampleAge(sample, _ageBoundaries) {
  if (sample && typeof sample.age === "string") return sample.age;
  // Samples without `age` can only be antiquity; bucketing them via the
  // ageBoundaries table would collapse them into the latest age.
  return "AGE_ANTIQUITY";
}

/**
 * Infer a sample's age-local turn. Uses explicit `localTurn`, else the stored
 * `turn` (age-local for legacy samples), else `null`.
 * @param {Snapshot|*} sample
 * @param {string} [_age] Unused (kept for call-site parity).
 * @param {AgeBoundary[]} [_ageBoundaries] Unused (kept for call-site parity).
 * @returns {number|null}
 */
function inferLocalTurn(sample, _age, _ageBoundaries) {
  // Explicit localTurn when present, else the stored turn (age-local for
  // legacy samples). Age-local turns are 1-based positive integers.
  if (!sample) return null;
  const { localTurn, turn } = sample;
  if (typeof localTurn === "number" && isFinite(localTurn) && localTurn > 0) return localTurn;
  if (typeof turn === "number" && isFinite(turn) && turn > 0) return turn;
  return null;
}

/**
 * Fold one sample into age-local max-turn tracking, recording each age's
 * first-appearance order so {@link computeAgeOffsets} can lay ages out
 * chronologically without a hardcoded age list. Any age type is accepted.
 * @param {Map<string, number>} maxLocalByAge Per-age max local-turn map.
 * @param {string[]} order Ages in first-appearance order (appended in place).
 * @param {*} sample
 * @param {AgeBoundary[]} ageBoundaries
 */
function foldAgeLocalMax(maxLocalByAge, order, sample, ageBoundaries) {
  if (!sample || typeof sample !== "object") return;
  const age = inferSampleAge(sample, ageBoundaries);
  const localTurn = inferLocalTurn(sample, age, ageBoundaries);
  if (localTurn === null) return;
  if (!maxLocalByAge.has(age)) {
    maxLocalByAge.set(age, 0);
    order.push(age);
  }
  const prev = maxLocalByAge.get(age) || 0;
  if (localTurn > prev) maxLocalByAge.set(age, localTurn);
}

/**
 * Compute cumulative per-age X-axis offsets from the samples' max age-local
 * turns, so each age's first turn lands right after the prior age ends.
 * @param {Snapshot[]} samples
 * @param {AgeBoundary[]} ageBoundaries
 * @returns {{ offsets: Map<string, number>, maxLocalByAge: Map<string, number> }}
 *   The per-age cumulative offset map and the per-age max-local-turn map.
 */
export function computeAgeOffsets(samples, ageBoundaries) {
  /** @type {Map<string, number>} */
  const maxLocalByAge = new Map();
  /** @type {string[]} */
  const order = [];
  for (const sample of samples) {
    foldAgeLocalMax(maxLocalByAge, order, sample, ageBoundaries);
  }
  // `offsets` is built in first-appearance order, so its key iteration order is
  // chronological; downstream consumers such as ageTurnFromX rely on that.
  /** @type {Map<string, number>} */
  const offsets = new Map();
  let cumulative = 0;
  for (const age of order) {
    offsets.set(age, cumulative);
    cumulative += maxLocalByAge.get(age) || 0;
  }
  return { offsets, maxLocalByAge };
}

/**
 * Compute a sample's deterministic chart-X position from its age offset plus
 * age-local turn, falling back to the raw stored `turn`.
 * @param {Snapshot|*} sample
 * @param {Map<string, number>} offsets Per-age cumulative offsets.
 * @param {AgeBoundary[]} ageBoundaries
 * @returns {number|undefined}
 */
export function sampleX(sample, offsets, ageBoundaries) {
  if (!sample) return undefined;
  if (typeof sample.chartTurn === "number" && isFinite(sample.chartTurn)) {
    return sample.chartTurn;
  }
  const age = inferSampleAge(sample, ageBoundaries);
  const localTurn = inferLocalTurn(sample, age, ageBoundaries);
  const offset = offsets.get(age);
  if (typeof localTurn === "number" && offset !== undefined) {
    return offset + localTurn;
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
 * @param {Snapshot[]} samples
 * @param {Map<string, number>} ageOffsets Per-age cumulative offsets.
 * @param {AgeBoundary[]} boundaries
 * @returns {TurnMaps}
 */
export function buildTurnMaps(samples, ageOffsets, boundaries) {
  /** @type {Map<number, string>} */
  const turnYearMap = new Map();
  /** @type {Map<number, TurnAgeInfo>} */
  const turnAgeMap = new Map();
  for (const sample of samples) {
    if (!sample) continue;
    const x = sampleX(sample, ageOffsets, boundaries);
    if (typeof x !== "number") continue;
    if (typeof sample.gameYear === "string" && sample.gameYear.length > 0) {
      turnYearMap.set(x, sample.gameYear);
    }
    const inferredAge = inferSampleAge(sample, boundaries);
    const inferredLocalTurn = inferLocalTurn(sample, inferredAge, boundaries);
    if (typeof inferredLocalTurn === "number") {
      turnAgeMap.set(x, { age: inferredAge, localTurn: inferredLocalTurn });
    }
  }
  // The live entry is keyed by chart-X like the samples, so offset Game.turn
  // (which is age-local) by the current age's offset. Otherwise, in a
  // multi-age set, the current-turn year lands back in the Antiquity X-region.
  addLiveTurnYear(turnYearMap, currentAgeXOffset(samples, ageOffsets, boundaries));
  return { turnYearMap, turnAgeMap };
}

/**
 * The chart-X offset of the current age (the latest sample's age), for placing
 * the live current-turn entry; 0 when there are no samples.
 * @param {Snapshot[]} samples
 * @param {Map<string, number>} ageOffsets Per-age cumulative offsets.
 * @param {AgeBoundary[]} boundaries
 * @returns {number}
 */
function currentAgeXOffset(samples, ageOffsets, boundaries) {
  for (let i = samples.length - 1; i >= 0; i--) {
    if (samples[i]) return ageOffsets.get(inferSampleAge(samples[i], boundaries)) || 0;
  }
  return 0;
}

/**
 * X-axis tick / Y-axis tick formatter pair.
 * @typedef {Object} AxisFormatters
 * @property {(value: number) => string} fmtX
 * @property {(value: number) => string} fmtY
 */

/**
 * Build the X / Y axis tick formatters bound to the supplied turn maps and
 * metric metadata. Honors the shared {@link getXAxisMode} setting.
 * @param {TurnMaps} maps
 * @param {*} metricMeta The metric metadata (for Y formatting).
 * @param {Map<string, number>} [ageOffsets] Per-age cumulative offsets.
 * @param {Map<string, number>} [maxLocalByAge] Per-age max local turn spans.
 * @returns {AxisFormatters}
 */
export function makeAxisFormatters(maps, metricMeta, ageOffsets, maxLocalByAge) {
  const { turnYearMap, turnAgeMap } = maps;

  /**
   * Resolve a deterministic age/local-turn pair from chart-X using known
   * age-offset spans. Returns null when X falls outside known spans.
   * @param {number} x Chart-X value.
   * @returns {TurnAgeInfo|null}
   */
  const ageTurnFromX = (x) => {
    if (!ageOffsets) return null;
    for (const age of ageOffsets.keys()) {
      const offset = ageOffsets.get(age);
      if (typeof offset !== "number") continue;
      const max = maxLocalByAge && (maxLocalByAge.get(age) || 0);
      if (!max) continue;
      const start = offset + 1;
      const end = offset + max;
      if (x >= start && x <= end) {
        return { age, localTurn: x - offset };
      }
    }
    return null;
  };
  /**
   * Format a chart-X as an age-relative turn label ("A12", "E1", "T-N").
   * @param {number} chartX
   * @returns {string}
   */
  const ageTurnLabel = (chartX) => {
    const info = ageTurnFromX(chartX) || nearestByTurn(turnAgeMap, chartX);
    return info ? turnLabel(info.localTurn, info.age) : turnLabel(chartX);
  };
  /**
   * Format a chart-X tick per the active axis mode.
   * @param {number} value The chart-X value.
   * @returns {string}
   */
  const fmtX = (value) => {
    const turn = Math.round(value);
    const year = localYear(nearestByTurn(turnYearMap, turn));
    const ageLabel = ageTurnLabel(turn);
    const mode = getXAxisMode();
    if (mode === "turn") return ageLabel;
    if (mode === "year") return year || ageLabel;
    return year ? ageLabel + " / " + year : ageLabel;
  };
  /**
   * Format a Y tick using the metric's formatter when available.
   * @param {number} value
   * @returns {string}
   */
  const fmtY = (value) => {
    if (metricMeta && typeof metricMeta.format === "function") {
      try {
        const formatted = metricMeta.format(value);
        if (typeof formatted === "string") return formatted;
      } catch (e) {
        log.error("fmtY: metric.format threw:", e);
      }
    }
    if (typeof value === "number" && isFinite(value)) {
      return Number.isInteger(value) ? String(value) : value.toFixed(1);
    }
    return String(value);
  };
  return { fmtX, fmtY };
}
