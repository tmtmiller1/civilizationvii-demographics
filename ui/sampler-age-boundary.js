// sampler-age-boundary.js
//
// Age-transition boundary recording extracted from demographics-sampler.js.

/**
 * The persisted history blob as consumed by age-boundary recording.
 * @typedef {import("/demographics/ui/sampler-wars.js").WarHistory} WarHistory
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

    // Re-sample immediately so the new civ name lands in history right away.
    try {
      deps.doSample();
    } catch (e) {
      deps.tripIfTooMany("post-transition sample", e);
    }
  } catch (e) {
    deps.tripIfTooMany("onPlayerAgeTransitionComplete", e);
  }
}