// sampler-chart-turn.js
//
// Chart-turn progression helpers for demographics-sampler.

import DemographicsStorage from "/demographics/ui/storage/demographics-storage.js";

/** @param {*} v */
function finiteOrNull(v) {
  return typeof v === "number" && isFinite(v) ? v : null;
}

/** @param {*} localTurn */
function positiveLocalTurn(localTurn) {
  const n = finiteOrNull(localTurn);
  return n !== null && n > 0 ? n : 1;
}

/**
 * @param {*[]} samps Non-empty sample stream.
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
 * @param {string|null} lastAge
 * @param {string|undefined} ageType
 * @param {number|null} lastLocal
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
