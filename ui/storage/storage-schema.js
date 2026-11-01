// storage-schema.js
//
// History schema helpers and retention-bucket splitting.

/**
 * Build an empty history object seeded for the current game.
 * @param {string | number} seed Game seed.
 * @param {number} version Persisted schema version.
 * @returns {{
 *   version: number,
 *   seed: string | number,
 *   samples: any[],
 *   ageBoundaries: any[],
 *   eliminated: Record<string, any>
 * }} Empty history object.
 */
export function emptyHistory(seed, version) {
  return {
    version,
    seed,
    samples: [],
    ageBoundaries: [],
    eliminated: {}
  };
}

/** The one older history schema the current code still reads: the unpacked shape of 2.10.0 and before. */
const OLDEST_READABLE_VERSION = 1;

/**
 * Check whether a parsed value matches the expected history schema shape. The current version and
 * schema 1 are accepted; a schema 1 history is already the in-memory shape, and the first save
 * restamps it (`prepareHistoryForSave`).
 * @param {*} history Candidate value.
 * @param {number} version Expected schema version.
 * @returns {boolean}
 */
export function isValid(history, version) {
  return !!(
    history &&
    typeof history === "object" &&
    (history.version === version || history.version === OLDEST_READABLE_VERSION) &&
    Array.isArray(history.samples)
  );
}

/**
 * Normalize optional history fields in place. Never touches `version`: the load path needs the
 * stored version intact to tell an older save from the current one.
 * @param {any} history
 * @returns {any} The same history object.
 */
export function normalize(history) {
  if (!history) return history;
  if (!Array.isArray(history.ageBoundaries)) history.ageBoundaries = [];
  if (!history.eliminated || typeof history.eliminated !== "object") {
    history.eliminated = {};
  }
  return history;
}

/**
 * @param {any} sample Snapshot sample.
 * @param {string | null} latestAge Latest age label.
 * @param {number} latestBoundary Legacy turn cutoff.
 */
function isAfterDecimationCut(sample, latestAge, latestBoundary) {
  if (latestAge && sample && sample.age === latestAge) return true;
  return /** @type {number} */ (sample.turn) >= latestBoundary;
}

/**
 * Split samples into decimation candidates and preserved tail buckets.
 * @param {any[]} samples Full sample list.
 * @param {any[]} bounds Age boundary list.
 * @returns {{ before: any[], after: any[], boundaryTurns: Set<number | undefined> }}
 */
export function splitDecimationBuckets(samples, bounds) {
  const latestBoundary = bounds.length > 0 ? bounds[bounds.length - 1].turn : Infinity;
  const last = samples[samples.length - 1];
  const latestAge = last && typeof last.age === "string" ? last.age : null;
  /** @type {Set<number | undefined>} */
  const boundaryTurns = new Set(bounds.map((boundary) => boundary.turn));
  /** @type {any[]} */
  const before = [];
  /** @type {any[]} */
  const after = [];
  for (const sample of samples) {
    if (isAfterDecimationCut(sample, latestAge, latestBoundary)) after.push(sample);
    else before.push(sample);
  }
  return { before, after, boundaryTurns };
}
