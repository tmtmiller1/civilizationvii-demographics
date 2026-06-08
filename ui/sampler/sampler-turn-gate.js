// sampler-turn-gate.js
//
// Polling cadence and turn-gate helpers for sampler event handling.

/**
 * Resolve configured sample cadence (turns between samples).
 * @param {(key: string, fallback: number) => *} getSetting Settings getter.
 * @returns {number} Finite integer >= 1.
 */
export function resolvePollEveryNTurns(getSetting) {
  try {
    const v = getSetting("sampleEveryNTurns", 1);
    const n = Math.round(Number(v));
    if (Number.isFinite(n) && n >= 1) return n;
  } catch (_) {
    // localStorage-backed settings can be unavailable in some sandboxes.
  }
  return 1;
}

/**
 * Decide whether current turn passes the configured sample gate.
 * @param {*} turn Current game turn.
 * @param {number} lastSampledTurn Last turn that produced a sample.
 * @param {number} pollEveryNTurns Turn cadence.
 * @returns {boolean} True when sampling should run.
 */
export function shouldSampleTurn(turn, lastSampledTurn, pollEveryNTurns) {
  if (typeof turn !== "number") return true;
  if (pollEveryNTurns <= 1) return true;
  if (turn === lastSampledTurn) return false;
  if (turn % pollEveryNTurns !== 0) return false;
  return true;
}
