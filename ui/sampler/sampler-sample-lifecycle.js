// sampler-sample-lifecycle.js
//
// Lifecycle helpers for one demographics sample pass: timing, aux-history
// recording, persistence, and finalize bookkeeping.

/**
 * High-resolution timestamp in ms (0 when unavailable).
 * @returns {number} The current time in ms.
 */
export function perfNow() {
  try {
    return typeof performance !== "undefined" && performance.now
      ? performance.now()
      : 0;
  } catch (_) {
    return 0;
  }
}

/**
 * Log one sample's wall-clock cost and key sizes.
 * @param {( ...a: any[] ) => void} ilog Informational logger.
 * @param {{ start: number, work: number, write: number, end: number }} t Phase timestamps.
 * @param {{ players: number, minors: number, samples: number }} counts Size counts.
 */
export function logSampleTiming(ilog, t, counts) {
  ilog(
    "perf doSample total=" + (t.end - t.start).toFixed(1) + "ms",
    "(majors+minors=" + (t.work - t.start).toFixed(1) +
      " write=" + (t.write - t.work).toFixed(1) +
      " warTracker=" + (t.end - t.write).toFixed(1) + ")",
    "players=" + counts.players,
    "minors=" + counts.minors,
    "storedSamples=" + counts.samples
  );
}

/**
 * Record auxiliary settlement/town history for one sample pass. The two
 * recorders only COMPUTE their updated blobs; this collects both and persists
 * them in a single batched settings write, so the shared `modSettings` store is
 * parsed + stringified once per turn instead of once per recorder.
 * @param {(label: string, fn: () => any) => any} safeCall Defensive call wrapper.
 * @param {{
 *   recordLocalTownsNow: (chartTurn: number) => ({key: string, value: *}|null),
 *   recordSettlementsNow: (chartTurn: number, gameYear: string|undefined) =>
 *     ({key: string, value: *}|null),
 *   setSettings: (entries: Record<string, *>) => void
 * }} aux Aux recorders + batched persistence.
 * @param {number} chartTurn Monotonic chart turn.
 * @param {string|undefined} gameYear Game-year label.
 */
export function recordAuxHistory(safeCall, aux, chartTurn, gameYear) {
  /** @type {Record<string, *>} */
  const entries = {};
  const towns = safeCall("recordLocalTownsNow", () => aux.recordLocalTownsNow(chartTurn));
  if (towns && towns.key) entries[towns.key] = towns.value;
  const settle = safeCall(
    "recordSettlementsNow",
    () => aux.recordSettlementsNow(chartTurn, gameYear)
  );
  if (settle && settle.key) entries[settle.key] = settle.value;
  if (Object.keys(entries).length) {
    safeCall("persistAuxHistory", () => aux.setSettings(entries));
  }
}

/**
 * Append one snapshot WITHOUT persisting and return the in-progress history, so
 * the caller can batch war tracking into a single per-turn save (see
 * {@link commitSample}). Returns null on append failure.
 * @param {{ appendSample: (snapshot: any, opts?: any) => any }} storage History storage API.
 * @param {(label: string, e: any) => void} tripIfTooMany Error counter/kill-switch hook.
 * @param {*} snapshot Snapshot to append.
 * @returns {*} The updated history, or null on failure.
 */
export function persistSnapshot(storage, tripIfTooMany, snapshot) {
  try {
    return storage.appendSample(snapshot, { persist: false });
  } catch (e) {
    tripIfTooMany("DemographicsStorage.appendSample", e);
    return null;
  }
}

/**
 * Commit the in-progress history with a single save (the one write per turn,
 * after the sample append and war tracking have both mutated it).
 * @param {{ save: (history: any) => any }} storage History storage API.
 * @param {(label: string, e: any) => void} tripIfTooMany Error counter/kill-switch hook.
 * @param {*} history The history to persist (null is a no-op).
 * @returns {number} Stored sample count after save (0 on failure/null).
 */
export function commitSample(storage, tripIfTooMany, history) {
  if (!history) return 0;
  try {
    storage.save(history);
    return Array.isArray(history.samples) ? history.samples.length : 0;
  } catch (e) {
    tripIfTooMany("DemographicsStorage.save", e);
    return 0;
  }
}

/**
 * Finalize one sample pass: write, war tracking, and perf log.
 * @param {*} snapshot Built snapshot.
 * @param {number} turn Sample turn.
 * @param {number} tStart Sample start timestamp.
 * @param {number} minorCount Number of sampled minors.
 * @param {{
 *   perfNow: () => number,
 *   persistSnapshot: (snapshot: any) => any,
 *   runWarTracker: (snapshot: any, turn: number, history: any) => void,
 *   commitSample: (history: any) => number,
 *   logSampleTiming: (
 *     t: {start:number,work:number,write:number,end:number},
 *     counts: {players:number,minors:number,samples:number}
 *   ) => void
 * }} deps Finalization dependencies.
 */
export function finalizeSampleLifecycle(snapshot, turn, tStart, minorCount, deps) {
  const tWork = deps.perfNow();
  // One parse + one save per turn: append (no write) → war tracking mutates the
  // same blob → a single commit persists both.
  const history = deps.persistSnapshot(snapshot);
  const tWrite = deps.perfNow();
  deps.runWarTracker(snapshot, turn, history);
  const storedSamples = deps.commitSample(history);
  const counts = {
    players: Object.keys(snapshot.players || {}).length,
    minors: minorCount,
    samples: storedSamples
  };
  deps.logSampleTiming(
    { start: tStart, work: tWork, write: tWrite, end: deps.perfNow() },
    counts
  );
}
