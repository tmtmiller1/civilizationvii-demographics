// sampler-chart-turn.js
//
// Chart-turn progression helpers for demographics-sampler.

import DemographicsStorage from "/demographics/ui/storage/demographics-storage.js";

/**
 * Coerce a value to a finite number, or null.
 * @param {*} v Candidate value.
 * @returns {number|null} Finite number or null.
 */
function finiteOrNull(v) {
  return typeof v === "number" && isFinite(v) ? v : null;
}

/**
 * Resolve a positive, finite age-local turn, defaulting to 1.
 * @param {*} localTurn Candidate local turn.
 * @returns {number} Positive finite turn.
 */
function positiveLocalTurn(localTurn) {
  const n = finiteOrNull(localTurn);
  return n !== null && n > 0 ? n : 1;
}

/**
 * Extract the latest sample chart-turn / age / local-turn state.
 * @param {*[]} samps Non-empty sample stream.
 * @returns {{ chartTurn: number, age: (string|null), localTurn: (number|null) }}
 *   Latest chart state.
 */
function lastSampleChartState(samps) {
  const last = samps[samps.length - 1] || {};
  const turn = finiteOrNull(last.turn);
  const chartTurn = finiteOrNull(last.chartTurn) ?? turn ?? 0;
  const localTurn = finiteOrNull(last.localTurn) ?? turn;
  const age = typeof last.age === "string" ? last.age : null;
  return { chartTurn, age, localTurn };
}

/**
 * Whether the current sample continues the same age as the previous sample.
 * @param {string|null} lastAge Last sample age.
 * @param {string|undefined} ageType Current age type.
 * @param {number|null} lastLocal Last sample local turn.
 * @returns {boolean} True for same-age continuation.
 */
function isSameAgeContinuation(lastAge, ageType, lastLocal) {
  return !!(lastAge && ageType && lastAge === ageType && typeof lastLocal === "number");
}

/**
 * Compute a monotonic chart turn for the next sample.
 *
 * Within the same age, spacing follows local-turn deltas; across age
 * boundaries it advances by at least one turn.
 * @param {string | undefined} ageType Current age type.
 * @param {number} localTurn Current age-local turn.
 * @returns {number} Monotonic chart turn.
 */
export function computeChartTurn(ageType, localTurn) {
  const lt = positiveLocalTurn(localTurn);
  /** @type {*} */
  let h = null;
  try {
    h = DemographicsStorage.load();
  } catch (_) {
    return lt;
  }
  const samps = h && Array.isArray(h.samples) ? h.samples : [];
  if (samps.length === 0) return lt;
  const { chartTurn, age, localTurn: lastLocal } = lastSampleChartState(samps);
  if (isSameAgeContinuation(age, ageType, lastLocal)) {
    const delta = lt - (lastLocal ?? 0);
    return chartTurn + (delta >= 0 ? delta : 1);
  }
  return chartTurn + Math.max(1, lt);
}
