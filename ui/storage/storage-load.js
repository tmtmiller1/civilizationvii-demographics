// storage-load.js
//
// Load-path helper functions for demographics history persistence.

import { serializePayload } from "/demographics/ui/storage/storage-retention.js";

/**
 * Read raw payload text from a store.
 * @param {{ read: (key: string) => string | null }} store Active store.
 * @param {string} payloadKey Store payload key.
 * @param {(...a: any[]) => void} derr Error logger.
 * @returns {string | null} Raw payload or null.
 */
export function readRaw(store, payloadKey, derr) {
  try {
    return store.read(payloadKey);
  } catch (e) {
    derr("store.read threw:", e);
    return null;
  }
}

/**
 * Extract the history payload from either an envelope ({v,data}) or a legacy raw
 * history blob, keeping backward compatibility for existing saves.
 * @param {*} parsed Parsed JSON value.
 * @returns {*} Candidate history payload.
 */
function payloadFromBlob(parsed) {
  if (!parsed || typeof parsed !== "object") return parsed;
  if (typeof parsed.v === "number" && parsed.data && typeof parsed.data === "object") {
    return parsed.data;
  }
  return parsed;
}

/** Suffix of the sibling key that parks a stored payload the running code could not use. */
export const REJECTED_KEY_SUFFIX = "__rejected";

/**
 * Sibling key under which an unusable stored payload is parked (same store, same
 * namespace) so a later mod version can recover it instead of the next save
 * overwriting it. One slot per schema version (`<key>__rejected_v<N>`), so a
 * downgrade followed by a re-upgrade parks each build's payload without either
 * overwriting the other; text with no readable version (JSON garbage) shares the
 * unversioned `<key>__rejected` slot.
 * @param {string} payloadKey Store payload key.
 * @param {number | undefined} [version] Schema version stamped on the parked payload.
 * @returns {string} The rejected-payload key.
 */
export function rejectedKey(payloadKey, version) {
  const slot = typeof version === "number" && isFinite(version) ? "_v" + version : "";
  return payloadKey + REJECTED_KEY_SUFFIX + slot;
}

/**
 * Whether a store can take part in parking/restoring: it needs both accessors
 * and a payload key to derive the sibling key from.
 * @param {{ read?: Function, write?: Function }} store Active store.
 * @param {string | undefined} payloadKey Store payload key.
 * @returns {boolean} True when parking and restoring are possible.
 */
function canPark(store, payloadKey) {
  return (
    typeof payloadKey === "string" &&
    payloadKey.length > 0 &&
    typeof store.read === "function" &&
    typeof store.write === "function"
  );
}

/**
 * Why a stored payload cannot be used by the running code.
 * @typedef {object} Rejection
 * @property {string} reason Human-readable reason (logged).
 * @property {number | undefined} storedVersion Schema version read off the payload, if any.
 */

/**
 * Park an unusable stored payload under its version's rejected slot. Never
 * throws; skipped for an empty value so a clean first run parks nothing.
 * @param {{ read?: Function, write?: Function }} store Active store.
 * @param {string | undefined} payloadKey Store payload key.
 * @param {string} raw The unusable payload text.
 * @param {Rejection} rejection Why the payload was rejected.
 * @param {(...a: any[]) => void} derr Error logger.
 */
function parkRejected(store, payloadKey, raw, rejection, derr) {
  if (!raw || !canPark(store, payloadKey)) return;
  const key = rejectedKey(/** @type {string} */ (payloadKey), rejection.storedVersion);
  derr("load: " + rejection.reason + "; parking the stored payload under " + key + " (bytes=" + raw.length + ")");
  try {
    /** @type {(key: string, value: string) => void} */ (store.write)(key, raw);
  } catch (e) {
    derr("load: park store.write threw:", e);
  }
}

/**
 * Options shared by the rejected-payload helpers. `store` is the active
 * persistence store; parking/restoring is skipped when it lacks `read`/`write`.
 * @typedef {object} RejectedOptions
 * @property {{ pid: number, read?: Function, write?: Function }} store Active store.
 * @property {string} [payloadKey] Store payload key the rejected key derives from.
 * @property {string | number} seed Current game seed.
 * @property {number} version Current schema version.
 * @property {(value: any, version: number) => boolean} [isValid] Schema validator.
 * @property {(value: any) => any} [normalize] Optional-field normalizer.
 * @property {(...a: any[]) => void} derr Error logger.
 */

/**
 * Read the CURRENT version's parked slot when the running code can parse and
 * validate it and it belongs to this game. Never throws; does not write.
 * @param {RejectedOptions} options Rejected-payload options.
 * @returns {any | null} The restorable history, or null.
 */
function readRestorable(options) {
  const { store, payloadKey, seed, version, isValid, normalize, derr } = options;
  if (typeof isValid !== "function" || !canPark(store, payloadKey)) return null;
  const slot = rejectedKey(/** @type {string} */ (payloadKey), version);
  const raw = readRaw(/** @type {any} */ (store), slot, derr);
  if (!raw) return null;
  let parsed = null;
  try {
    parsed = payloadFromBlob(JSON.parse(raw));
  } catch (_) {
    // Parked text this version cannot parse either; leave it for a later one.
    return null;
  }
  if (!isValid(parsed, version) || seedMismatch(parsed.seed, seed)) return null;
  return normalize ? normalize(parsed) : parsed;
}

/**
 * Write a restorable parked payload back to the primary key and clear its slot.
 * Never throws.
 * @param {RejectedOptions} options Rejected-payload options.
 * @param {any} restored The history read by {@link readRestorable}.
 */
function commitRestore(options, restored) {
  const { store, version, derr } = options;
  const payloadKey = /** @type {string} */ (options.payloadKey);
  const write = /** @type {(key: string, value: string) => void} */ (store.write);
  const slot = rejectedKey(payloadKey, version);
  derr("load: restoring the parked payload from " + slot + " (samples=" + restored.samples.length + ")");
  try {
    write(payloadKey, serializePayload(restored));
    write(slot, "");
  } catch (e) {
    derr("load: restore store.write threw:", e);
  }
}

/**
 * Restore a parked payload the current code can use: write it back to the
 * primary key and clear its slot. Never throws.
 * @param {RejectedOptions} options Rejected-payload options.
 * @returns {any | null} The restored history, or null when nothing usable is parked.
 */
export function restoreRejected(options) {
  const restored = readRestorable(options);
  if (restored) commitRestore(options, restored);
  return restored;
}

/**
 * Recover the in-memory mirror into an empty store, unless it is stamped for a different game,
 * so a prior game's mirror never seeds a new game's empty store.
 * @param {{
 *   mem: any,
 *   seed: string | number,
 *   store: { pid: number, write: (key: string, value: string) => void },
 *   payloadKey: string,
 *   dlog: (...a: any[]) => void,
 *   derr: (...a: any[]) => void
 * }} options Recovery options.
 * @returns {any | null} The recovered mirror, or null when there is nothing usable.
 */
function recoverMem(options) {
  const { mem, seed, store, payloadKey, dlog, derr } = options;
  if (!mem || !mem.samples || mem.samples.length === 0) return null;
  if (seedMismatch(mem.seed, seed)) {
    derr("load: persistent empty; _mem is for a different game (mem=" + mem.seed + " current=" + seed + "), not recovering");
    return null;
  }
  dlog(
    "load: persistent empty, recovering from _mem (samples=" +
      mem.samples.length +
      " pid=" +
      store.pid +
      ")"
  );
  try {
    store.write(payloadKey, serializePayload(mem));
  } catch (e) {
    derr("_loadEmpty: recovery store.write threw:", e);
  }
  return mem;
}

/**
 * Resolve the empty-persistence recovery path: the in-memory mirror (current game only), else a
 * parked payload the current code can use, else a fresh empty history.
 * @param {{
 *   mem: any,
 *   seed: string | number,
 *   version: number,
 *   store: { pid: number, read?: Function, write: (key: string, value: string) => void },
 *   payloadKey: string,
 *   emptyHistory: (seed: string | number, version: number) => any,
 *   isValid?: (value: any, version: number) => boolean,
 *   normalize?: (value: any) => any,
 *   dlog: (...a: any[]) => void,
 *   derr: (...a: any[]) => void
 * }} options Recovery options.
 * @returns {any} Recovered in-memory history, restored parked history, or new empty history.
 */
export function loadEmpty(options) {
  const { seed, version, store, emptyHistory, dlog } = options;
  const mem = recoverMem(options);
  if (mem) return mem;
  const restored = restoreRejected(options);
  if (restored) return restored;
  dlog("load: no existing history (pid=" + store.pid + ")");
  return emptyHistory(seed, version);
}

/**
 * Whether a stored seed is known and differs from the current game's seed. Skipped when either
 * side is the "unknown" sentinel, so unresolved seeds never trigger a reset of valid data.
 * @param {string | number | undefined | null} storedSeed Seed stamped on the payload.
 * @param {string | number} seed Current game seed.
 * @returns {boolean} True when the seeds are both known and differ.
 */
function seedMismatch(storedSeed, seed) {
  if (seed === "unknown" || storedSeed === undefined || storedSeed === null || storedSeed === "unknown") {
    return false;
  }
  return String(storedSeed) !== String(seed);
}

/**
 * Parse stored payload text and check it against the current schema.
 * @param {string} raw Raw payload text.
 * @param {(value: any, version: number) => boolean} isValid Schema validator.
 * @param {number} version Current schema version.
 * @returns {{ history: any, problem: string | null, storedVersion: number | undefined }}
 *   The candidate, why it is unusable (null when usable), and the version read off it.
 */
function parseStored(raw, isValid, version) {
  let history = null;
  try {
    history = payloadFromBlob(JSON.parse(raw));
  } catch (e) {
    return { history, problem: "JSON parse failed (" + e + ")", storedVersion: undefined };
  }
  const stored = history && typeof history === "object" ? history.version : undefined;
  const storedVersion = typeof stored === "number" ? stored : undefined;
  if (isValid(history, version)) return { history, problem: null, storedVersion };
  const problem =
    stored === version ? "malformed history" : "history version " + stored + " is not " + version;
  return { history, problem, storedVersion };
}

/**
 * Options accepted by {@link loadParsed}.
 * @typedef {object} ParseOptions
 * @property {string} raw Raw payload text.
 * @property {any} mem In-memory mirror, or null.
 * @property {string | number} seed Current game seed.
 * @property {number} version Current schema version.
 * @property {{ pid: number, read?: Function, write?: Function }} store Store the payload came from.
 * @property {string} [payloadKey] Store payload key (enables parking/restoring).
 * @property {(seed: string | number, version: number) => any} emptyHistory Empty-history factory.
 * @property {(value: any, version: number) => boolean} isValid Schema validator.
 * @property {(value: any) => any} normalize Optional-field normalizer.
 * @property {(parsed: any, store: { pid: number }) => any} preferMemWhenNewer Mirror reconciler.
 * @property {(...a: any[]) => void} dlog Debug logger.
 * @property {(...a: any[]) => void} derr Error logger.
 */

/**
 * Handle stored payload text the running code cannot use (a newer schema version, or corrupt
 * text). The unusable text is parked FIRST, under its own version's slot, so a re-upgrade can
 * recover it; then, if the current version's slot holds a payload this code can use, that one
 * is restored over the primary key. Otherwise the primary key is left as it is (the next save
 * overwrites it) and the load falls back to the mirror or an empty history.
 * @param {ParseOptions} options Parse options.
 * @param {Rejection} rejection Why the stored payload is unusable.
 * @returns {any} The restored, mirrored, or empty history.
 */
function rejectStored(options, rejection) {
  const { raw, mem, seed, version, store, payloadKey, emptyHistory, preferMemWhenNewer, derr } = options;
  parkRejected(store, payloadKey, raw, rejection, derr);
  const restored = restoreRejected(options);
  if (restored) return preferMemWhenNewer(restored, store);
  return mem || emptyHistory(seed, version);
}

/**
 * A usable payload of an OLDER schema version (one isValid accepts below the current) was
 * written by an older mod copy after a newer copy's data was parked. When the current
 * version's slot holds a payload this code can use, park the older primary under its own
 * slot and restore the parked one; otherwise keep the older primary.
 * @param {ParseOptions} options Parse options.
 * @param {any} parsed The usable older-version history.
 * @returns {any} The restored history, or `parsed`.
 */
function supersedeOlder(options, parsed) {
  const { raw, version, store, payloadKey, derr } = options;
  if (!(parsed.version < version)) return parsed;
  const restored = readRestorable(options);
  if (!restored) return parsed;
  const reason = "history version " + parsed.version + " is superseded by parked version " + version;
  parkRejected(store, payloadKey, raw, { reason, storedVersion: parsed.version }, derr);
  commitRestore(options, restored);
  return restored;
}

/**
 * Parse and validate a raw payload.
 * @param {ParseOptions} options Parse options.
 * @returns {any} Parsed/reconciled history.
 */
export function loadParsed(options) {
  const { raw, mem, seed, version, store, emptyHistory, isValid, normalize, preferMemWhenNewer, dlog, derr } =
    options;

  const candidate = parseStored(raw, isValid, version);
  if (candidate.problem) {
    return rejectStored(options, { reason: candidate.problem, storedVersion: candidate.storedVersion });
  }
  const parsed = candidate.history;

  // New-game guard: a known stored seed that differs from the current game's means this payload
  // belongs to a different game. Prefer the current game's in-memory mirror, else start fresh.
  if (seedMismatch(parsed.seed, seed)) {
    derr("load: seed mismatch (stored=" + parsed.seed + " current=" + seed + "), resetting for new game");
    return mem && String(mem.seed) === String(seed) ? mem : emptyHistory(seed, version);
  }

  normalize(parsed);
  const reconciled = preferMemWhenNewer(supersedeOlder(options, parsed), store);
  dlog(
    "load: ok pid=" +
      store.pid +
      " samples=" +
      reconciled.samples.length +
      " ageBoundaries=" +
      reconciled.ageBoundaries.length +
      " bytes=" +
      raw.length
  );
  return reconciled;
}
