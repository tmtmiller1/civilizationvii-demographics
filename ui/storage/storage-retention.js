// storage-retention.js
//
// History-save preparation and sample-retention mutations.

/**
 * Validate, normalize, and cap a history before persistence.
 * @param {*} history History object (mutated when valid).
 * @param {{
 *   version: number,
 *   isValid: (history: any, version: number) => boolean,
 *   normalize: (history: any) => any,
 *   resolveEffectiveCap: () => { cap: number, source: string },
 *   derr: (...a: any[]) => void
 * }} options Validation and cap dependencies.
 * @returns {boolean} True when history is valid and ready to write.
 */
export function prepareHistoryForSave(history, options) {
  const { version, isValid, normalize, resolveEffectiveCap, derr } = options;
  if (!isValid(history, version)) {
    derr("save: refusing to persist invalid history");
    return false;
  }
  normalize(history);
  const eff = resolveEffectiveCap();
  if (isFinite(eff.cap) && history.samples.length > eff.cap) {
    history.samples = history.samples.slice(-eff.cap);
  }
  return true;
}

/**
 * Serialize and write a history payload to a store.
 * @param {{ write: (key: string, value: string) => void }} store Persist store.
 * @param {string} payloadKey Store payload key.
 * @param {object} history History object.
 * @param {(...a: any[]) => void} derr Error logger.
 * @returns {boolean} True on successful write.
 */
export function writeStorePayload(store, payloadKey, history, derr) {
  let serialized;
  try {
    serialized = JSON.stringify(history);
  } catch (e) {
    derr("save: stringify threw:", e);
    return false;
  }
  try {
    store.write(payloadKey, serialized);
    return true;
  } catch (e) {
    derr("save: store.write threw:", e);
    return false;
  }
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
