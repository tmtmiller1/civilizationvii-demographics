// sampler-age-boundary.js
//
// Age-transition boundary recording extracted from demographics-sampler.js.

import { buildAgeCrisisCols } from "/demographics/ui/screen-demographics/charts/crises/crisis-cost-model.js";
import { sampleAgeKey } from "/demographics/ui/screen-demographics/charts/crises/crisis-stage-data.js";

/**
 * The persisted history blob as consumed by age-boundary recording.
 * @typedef {import("/demographics/ui/sampler/sampler-wars.js").WarHistory} WarHistory
 */

/**
 * Dependencies required to re-read age state.
 * @typedef {object} AgeReadDeps
 * @property {() => void} resetAgeCaches Clears cached age/tree state.
 * @property {() => (string | undefined)} getCurrentAgeType Reads current age.
 */

/**
 * Dependencies required for age-boundary persistence + transition handling.
 * @typedef {AgeReadDeps & {
 *   loadHistory: () => WarHistory,
 *   saveHistory: (history: WarHistory) => void,
 *   ilog: (...args: any[]) => void,
 *   tripIfTooMany: (label: string, err: unknown) => void,
 *   doSample: () => unknown,
 *   getCurrentTurn: () => (number | undefined),
 *   isDisabled: () => boolean,
 * }} AgeBoundaryDeps
 */

/**
 * Clear the age + trees caches and re-read the current age type.
 * @param {AgeReadDeps} deps Transition helper dependencies.
 * @returns {string | undefined} The new (re-read) age type.
 */
export function _readNewAgeType(deps) {
  // Clear cache first so getCurrentAgeType re-reads Game.age.
  deps.resetAgeCaches();
  return deps.getCurrentAgeType();
}

/**
 * Whether an age boundary for `age` at age-local `turn` is already recorded
 * (the transition event fires once per pid; we dedupe on age + localTurn).
 * @param {*} history The persisted history blob.
 * @param {string} age The new age type.
 * @param {number} turn The age-local Game.turn at transition.
 * @returns {boolean} True if already recorded.
 */
export function _ageBoundaryAlreadyRecorded(history, age, turn) {
  const arr = history && history.ageBoundaries;
  if (!Array.isArray(arr)) return false;
  // Same age + same age-local turn = same transition event (multiple pids
  // report it). We check `b.localTurn` (the age-local Game.turn) because
  // `b.turn` was switched to a GLOBAL value for chart alignment - checking
  // against that would always miss and we'd append a fresh boundary for every
  // per-pid transition event.
  return arr.some((b) => {
    if (!b || b.age !== age) return false;
    if (typeof b.localTurn === "number") return b.localTurn === turn;
    // Back-compat with old boundary entries that only had `.turn`.
    return b.turn === turn;
  });
}

/**
 * Identify the age that just FINISHED, given the new age starting at `turn`.
 * The boundary fires when `newAge` BEGINS; the finished age is the one just
 * before this turn in the (sorted) boundary list.
 * @param {*} h The persisted history blob.
 * @param {string} newAge The new age type.
 * @param {number} turn The age-local turn at transition.
 * @returns {string} The finished age type.
 */
export function _resolveFinishedAge(h, newAge, turn) {
  const sorted = h.ageBoundaries
    .slice()
    .sort((/** @type {*} */ a, /** @type {*} */ b) => (a.turn || 0) - (b.turn || 0));
  const idx = sorted.findIndex((/** @type {*} */ b) => b.age === newAge && b.turn === turn);
  if (idx > 0) return sorted[idx - 1].age;
  return "AGE_ANTIQUITY"; // first transition - finishing antiquity
}

/**
 * Build a single age-end triumph record from a snapshot player entry.
 * @param {*} ps A snapshot player record.
 * @returns {object | undefined} The triumph record, or undefined if no metrics.
 */
export function _legacyRecordForPlayer(ps) {
  const m = ps.metrics;
  if (!m) return undefined;
  return {
    triumphs_cultural: m.triumphs_cultural || 0,
    triumphs_diplomatic: m.triumphs_diplomatic || 0,
    triumphs_economic: m.triumphs_economic || 0,
    triumphs_scientific: m.triumphs_scientific || 0,
    triumphs_militaristic: m.triumphs_militaristic || 0,
    triumphs_expansionist: m.triumphs_expansionist || 0,
    leaderName: ps.leaderName,
    civName: ps.civName,
    leaderType: ps.leaderType,
    // Stored so the legacy radar colors a civ the SAME in the frozen per-age
    // view as in the live current-age view (radar falls back to a palette when
    // an older snapshot lacks this).
    primaryColor: ps.primaryColor
  };
}

/**
 * Snapshot per-civ TRIUMPH counts from the most recent sample for each civ
 * (the age-end totals), keyed by pid.
 * @param {*} h The persisted history blob.
 * @returns {Record<string, object>} The pid → triumph-snapshot map.
 */
export function _buildLegacySnapshot(h) {
  /** @type {Record<string, object>} */
  const snap = {};
  const samps = h.samples || [];
  for (let i = samps.length - 1; i >= 0; i--) {
    const s = samps[i];
    if (!s?.players) continue;
    for (const pid of Object.keys(s.players)) {
      if (snap[pid]) continue;
      const rec = _legacyRecordForPlayer(s.players[pid]);
      if (rec) snap[pid] = rec;
    }
  }
  return snap;
}

/**
 * Snapshot the finished age's per-civ CUMULATIVE crisis cost while its samples are still dense.
 * The crisis "losses" figures (population/crop/production) are sums of per-turn declines, so they
 * need dense samples; once old samples are decimated to cap the save, recomputing them from the
 * thinned stream collapses those columns to "—". Capturing them here lets the Crises page render a
 * finished age's cumulative impact from the snapshot. No-op when the age had no crisis.
 * @param {*} h The persisted history blob (mutated).
 * @param {string} finishedAge The age that just ended.
 */
export function _snapshotCrisisCost(h, finishedAge) {
  if (!h.crisisSnapshots || typeof h.crisisSnapshots !== "object") h.crisisSnapshots = {};
  const ageSamples = (h.samples || []).filter(
    (/** @type {*} */ s) => sampleAgeKey(s) === finishedAge
  );
  const cols = buildAgeCrisisCols(ageSamples);
  if (cols.length) h.crisisSnapshots[finishedAge] = cols;
}

/**
 * Persist the age boundary (deduped across the per-pid stream) plus the
 * age-end triumph snapshot, bumping the cumulative turn-offset bookkeeping.
 * @param {string | undefined} newAge The new age type.
 * @param {number} turn The age-local Game.turn at transition.
 * @param {AgeBoundaryDeps} deps Age-boundary dependencies.
 */
export function recordAgeBoundary(newAge, turn, deps) {
  const h = deps.loadHistory();
  if (!newAge || _ageBoundaryAlreadyRecorded(h, newAge, turn)) return;
  // Clear obsolete stored offset (no longer used - chart computes X at render
  // time from age + localTurn). This also gets rid of garbage values like
  // offset=235 baked into earlier corrupt saves.
  delete h.cumulativeTurnOffset;
  h.ageBoundaries.push({
    turn, // age-local Game.turn at transition
    localTurn: turn,
    age: newAge
  });
  deps.ilog("ageBoundary: recorded", newAge, "at localTurn=", turn);
  // Snapshot per-civ TRIUMPH counts at this moment - values from the latest
  // sample for each civ are the age-end totals. Stored under
  // history.legacySnapshots[age] (the storage key is kept as `legacySnapshots`
  // for back-compat; the contained data is the new triumph-count shape).
  if (!h.legacySnapshots || typeof h.legacySnapshots !== "object") {
    h.legacySnapshots = {};
  }
  const finishedAge = _resolveFinishedAge(h, newAge, turn);
  const snap = _buildLegacySnapshot(h);
  h.legacySnapshots[finishedAge] = snap;
  _snapshotCrisisCost(h, finishedAge);
  deps.saveHistory(h);
  deps.ilog(
    "appended ageBoundary turn=",
    turn,
    "age=",
    newAge,
    "legacySnapshot=",
    finishedAge,
    "civs=",
    Object.keys(snap).length
  );
}

// Last "<age>|<turn>" age boundary handled, to debounce the per-civ event storm.
/** @type {string | null} */
let _lastHandledBoundary = null;

/**
 * PlayerAgeTransitionComplete handler: resets caches, records the age boundary
 * once, and re-samples immediately so the new civ name lands in history.
 * @param {*} data The event payload (carries `player`).
 * @param {AgeBoundaryDeps} deps Age-boundary dependencies.
 */
export function onPlayerAgeTransitionComplete(data, deps) {
  if (deps.isDisabled()) return;
  try {
    const newAge = _readNewAgeType(deps);
    const turn = deps.getCurrentTurn() ?? -1;
    // Debounce: PlayerAgeTransitionComplete fires once per major civ (~12×), but
    // the boundary record + re-sample only need to happen once per transition.
    // Without this, the GameConfiguration history blob would be re-serialized and
    // written a dozen times at the age boundary.
    const boundaryKey = String(newAge) + "|" + String(turn);
    if (boundaryKey === _lastHandledBoundary) return;
    _lastHandledBoundary = boundaryKey;
    deps.ilog(
      "PlayerAgeTransitionComplete pid=",
      data && data.player,
      "newAge=",
      newAge,
      "turn=",
      turn
    );

    // Persist the boundary (dedupe across the per-pid stream).
    try {
      recordAgeBoundary(newAge, turn, deps);
    } catch (e) {
      deps.tripIfTooMany("appendAgeBoundary", e);
    }

    // Deliberately do NOT re-sample here. At PlayerAgeTransitionComplete the new
    // age's economy has not spun up yet, so Stats.getNetYield(...) reads 0 - which
    // produced a false GDP/yield DROP-to-zero on the first point of the new age.
    // The normal PlayerTurnActivated sample for the new age's first turn captures
    // that same turn WITH real yields AND the new civ identity, so skipping the
    // premature re-sample loses nothing and removes the spurious spike/drop.
  } catch (e) {
    deps.tripIfTooMany("onPlayerAgeTransitionComplete", e);
  }
}