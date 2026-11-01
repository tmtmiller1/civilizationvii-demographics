// storage-retention.js
//
// History-save preparation and sample-retention mutations.

import { packHistory } from "/demographics/ui/storage/storage-pack.js";

/**
 * Persisted payload-envelope version. Envelope 3 carries a packed history (schema 2, see
 * storage-pack.js); envelope 2 carried the history as it is in memory (schema 1).
 */
const PAYLOAD_ENVELOPE_VERSION = 3;

/**
 * Serialize a history object as an envelope payload. Every write goes through here, so every
 * write is packed; `parkRejected` in storage-load.js writes raw text and stays raw.
 * @param {object} history History object to serialize.
 * @returns {string} Serialized payload envelope.
 */
export function serializePayload(history) {
  return JSON.stringify({ v: PAYLOAD_ENVELOPE_VERSION, data: packHistory(history) });
}

/**
 * Validate, normalize, and cap a history before persistence.
 * @param {*} history History object (mutated when valid).
 * @param {{
 *   version: number,
 *   isValid: (history: any, version: number) => boolean,
 *   normalize: (history: any) => any,
 *   resolveEffectiveCap: () => { cap: number, source: string },
 *   logError: (...a: any[]) => void
 * }} options Validation and cap dependencies.
 * @returns {boolean} True when history is valid and ready to write.
 */
export function prepareHistoryForSave(history, options) {
  const { version, isValid, normalize, resolveEffectiveCap, logError } = options;
  if (!isValid(history, version)) {
    logError("save: refusing to persist invalid history");
    return false;
  }
  // A history read from an older save validates at its own version; from the first save on, the
  // mirror and the store both carry the current one.
  history.version = version;
  normalize(history);
  const eff = resolveEffectiveCap();
  if (isFinite(eff.cap) && history.samples.length > eff.cap) {
    history.samples = history.samples.slice(-eff.cap);
  }
  return true;
}

/**
 * Write an already-serialized payload to a store.
 * @param {{ write: (key: string, value: string) => void }} store Persist store.
 * @param {string} payloadKey Store payload key.
 * @param {string} serialized Serialized payload envelope.
 * @param {(...a: any[]) => void} logError
 * @returns {boolean} True on successful write.
 */
export function writeSerializedPayload(store, payloadKey, serialized, logError) {
  try {
    store.write(payloadKey, serialized);
    return true;
  } catch (e) {
    logError("save: store.write threw:", e);
    return false;
  }
}

/** Maximum cap-halving passes when a payload is over its soft byte budget. */
const MAX_SHRINK_ATTEMPTS = 3;

/**
 * Serialize a history, halving its sample cap and re-running `tighten` while the payload is over
 * the soft byte budget, at most MAX_SHRINK_ATTEMPTS times. `history.samples` is mutated; may throw
 * from JSON.stringify like serializePayload.
 * @param {{ samples: any[] }} history History object (mutated when shrunk).
 * @param {{
 *   cap: number,
 *   softBytes: number,
 *   tighten: (history: any, cap: number) => void
 * }} options Effective sample cap (Infinity when unlimited), byte budget, tightening step.
 * @returns {{ serialized: string, initialBytes: number, attempts: number }} Result.
 */
export function serializeWithinBudget(history, options) {
  const { cap, softBytes, tighten } = options;
  let serialized = serializePayload(history);
  const initialBytes = serialized.length;
  let effectiveCap = isFinite(cap) ? cap : history.samples.length;
  let attempts = 0;
  while (serialized.length > softBytes && attempts < MAX_SHRINK_ATTEMPTS) {
    effectiveCap = Math.max(1, Math.floor(Math.min(effectiveCap, history.samples.length) / 2));
    tighten(history, effectiveCap);
    serialized = serializePayload(history);
    attempts++;
  }
  return { serialized, initialBytes, attempts };
}

/**
 * Insert or replace a snapshot in-place.
 * @param {{ samples: any[] }} history Target history.
 * @param {*} snapshot Snapshot to insert.
 */
export function insertSnapshot(history, snapshot) {
  if (
    snapshot &&
    typeof snapshot.localTurn === "number" &&
    typeof snapshot.age === "string"
  ) {
    const index = history.samples.findIndex(
      (sample) =>
        sample &&
        sample.age === snapshot.age &&
        sample.localTurn === snapshot.localTurn
    );
    if (index >= 0) history.samples[index] = snapshot;
    else history.samples.push(snapshot);
    return;
  }

  if (snapshot && typeof snapshot.turn === "number") {
    const index = history.samples.findIndex(
      (sample) => sample && sample.turn === snapshot.turn && !sample.age
    );
    if (index >= 0) history.samples[index] = snapshot;
    else history.samples.push(snapshot);
    return;
  }

  history.samples.push(snapshot);
}

/**
 * Downsample older samples when cap-derived threshold is exceeded.
 * @param {{ samples: any[], ageBoundaries?: any[] }} history Target history.
 * @param {{ cap: number, source: string }} eff Effective cap.
 * @param {{
 *   decimationDisabled: () => boolean,
 *   splitDecimationBuckets: (samples: any[], bounds: any[]) => {
 *     before: any[],
 *     after: any[],
 *     boundaryTurns: Set<number | undefined>
 *   }
 * }} deps Decimation dependencies.
 * @returns {{
 *   decimated: boolean,
 *   keepEveryNth?: number,
 *   beforeCount?: number,
 *   afterCount?: number,
 *   keptCount?: number
 * }} Mutation summary.
 */
export function maybeDecimate(history, eff, deps) {
  const KEEP_EVERY_NTH = 3;
  if (deps.decimationDisabled() || !isFinite(eff.cap)) {
    return { decimated: false };
  }
  const threshold = Math.max(250, Math.floor(eff.cap * 0.25));
  if (history.samples.length <= threshold) {
    return { decimated: false };
  }
  const bounds = Array.isArray(history.ageBoundaries)
    ? history.ageBoundaries
    : [];
  const { before, after, boundaryTurns } = deps.splitDecimationBuckets(
    history.samples,
    bounds
  );
  const decimated = before.filter(
    (sample, index) => index % KEEP_EVERY_NTH === 0 || boundaryTurns.has(sample.turn)
  );
  history.samples = decimated.concat(after);
  return {
    decimated: true,
    keepEveryNth: KEEP_EVERY_NTH,
    beforeCount: before.length,
    afterCount: after.length,
    keptCount: decimated.length
  };
}
