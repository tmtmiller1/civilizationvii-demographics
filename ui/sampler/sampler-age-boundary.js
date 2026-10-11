// sampler-age-boundary.js
//
// Age-transition boundary recording for the sampler.

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
 *   logDebug: (...args: any[]) => void,
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
export function readNewAgeType(deps) {
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
export function ageBoundaryAlreadyRecorded(history, age, turn) {
  const arr = history && history.ageBoundaries;
  if (!Array.isArray(arr)) return false;
  // Same age + same age-local turn = same transition event (multiple pids
  // report it). Compare `b.localTurn`, not `b.turn` (a global chart value),
  // or every per-pid transition event would append a fresh boundary.
  return arr.some((b) => {
    if (!b || b.age !== age) return false;
    if (typeof b.localTurn === "number") return b.localTurn === turn;
    // Back-compat with old boundary entries that only had `.turn`.
    return b.turn === turn;
  });
}

/**
 * Identify the age that just finished, given the new age starting at `turn`.
 * The boundary fires when `newAge` begins; the finished age is the one just
 * before this turn in the (sorted) boundary list.
 * @param {*} history The persisted history blob.
 * @param {string} newAge The new age type.
 * @param {number} turn The age-local turn at transition.
 * @returns {string} The finished age type.
 */
export function resolveFinishedAge(history, newAge, turn) {
  const sorted = history.ageBoundaries
    .slice()
    .sort((/** @type {*} */ a, /** @type {*} */ b) => (a.turn || 0) - (b.turn || 0));
  const idx = sorted.findIndex((/** @type {*} */ b) => b.age === newAge && b.turn === turn);
  if (idx > 0) return sorted[idx - 1].age;
  return "AGE_ANTIQUITY"; // first transition, so antiquity just finished
}

/**
 * Build a single age-end triumph record from a snapshot player entry.
 * @param {*} ps A snapshot player record.
 * @returns {object | undefined} The triumph record, or undefined if no metrics.
 */
export function legacyRecordForPlayer(ps) {
  const metrics = ps.metrics;
  if (!metrics) return undefined;
  return {
    triumphs_cultural: metrics.triumphs_cultural || 0,
    triumphs_diplomatic: metrics.triumphs_diplomatic || 0,
    triumphs_economic: metrics.triumphs_economic || 0,
    triumphs_scientific: metrics.triumphs_scientific || 0,
    triumphs_militaristic: metrics.triumphs_militaristic || 0,
    triumphs_expansionist: metrics.triumphs_expansionist || 0,
    leaderName: ps.leaderName,
    civName: ps.civName,
    leaderType: ps.leaderType,
    // Stored so the legacy radar colors a civ the same in the frozen per-age
    // view as in the live current-age view (radar falls back to a palette when
    // an older snapshot lacks this).
    primaryColor: ps.primaryColor
  };
}

/**
 * Snapshot per-civ triumph counts from the most recent sample for each civ
 * (the age-end totals), keyed by pid.
 * @param {*} h The persisted history blob.
 * @returns {Record<string, object>} The pid → triumph-snapshot map.
 */
export function buildLegacySnapshot(h) {
  /** @type {Record<string, object>} */
  const snap = {};
  const samps = h.samples || [];
  for (let i = samps.length - 1; i >= 0; i--) {
    const sample = samps[i];
    if (!sample?.players) continue;
    for (const pid of Object.keys(sample.players)) {
      if (snap[pid]) continue;
      const rec = legacyRecordForPlayer(sample.players[pid]);
      if (rec) snap[pid] = rec;
    }
  }
  return snap;
}

/**
 * Snapshot the finished age's per-civ cumulative crisis cost while its samples are still dense:
 * the "losses" figures are sums of per-turn declines, which collapse once old samples are
 * decimated to cap the save. No-op when the age had no crisis.
 * @param {*} h The persisted history blob (mutated).
 * @param {string} finishedAge The age that just ended.
 */
export function snapshotCrisisCost(h, finishedAge) {
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
  const history = deps.loadHistory();
  if (!newAge || ageBoundaryAlreadyRecorded(history, newAge, turn)) return;
  // Drop the obsolete stored offset: the chart computes X at render time from
  // age + localTurn.
  delete history.cumulativeTurnOffset;
  history.ageBoundaries.push({
    turn, // age-local Game.turn at transition
    localTurn: turn,
    age: newAge
  });
  deps.logDebug("ageBoundary: recorded", newAge, "at localTurn=", turn);
  // Snapshot per-civ triumph counts at this moment (the latest sample's values
  // are the age-end totals) under history.legacySnapshots[age].
  if (!history.legacySnapshots || typeof history.legacySnapshots !== "object") {
    history.legacySnapshots = {};
  }
  const finishedAge = resolveFinishedAge(history, newAge, turn);
  const snap = buildLegacySnapshot(history);
  history.legacySnapshots[finishedAge] = snap;
  snapshotCrisisCost(history, finishedAge);
  deps.saveHistory(history);
  deps.logDebug(
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

// Last "<seed>|<age>|<turn>" age boundary handled, to debounce the per-civ event
// storm. Module state outlives the game: the sampler's runtime reset clears it
// (see resetAgeBoundaryDebounce) so a second transition into the same age in one
// app session (a pre-transition autosave replayed, or a second game) still fires.
/** @type {string | null} */
let _lastHandledBoundary = null;

/**
 * Forget the last handled boundary. Called from the sampler's runtime reset on
 * every (re)start so a debounce key from a previous load never swallows the
 * next game's transition.
 */
export function resetAgeBoundaryDebounce() {
  _lastHandledBoundary = null;
}

/**
 * The current game's seed, so two games in one app session never share a
 * debounce key even when the reset is missed. "" when unreadable.
 * @returns {string} The seed, or "".
 */
function _readGameSeed() {
  try {
    if (typeof Configuration === "undefined" || typeof Configuration.getGame !== "function") return "";
    const game = Configuration.getGame();
    const seed = game && (game.startSeed ?? game.gameSeed ?? game.mapSeed);
    return seed === undefined || seed === null ? "" : String(seed);
  } catch (_) {
    // Configuration.getGame() can throw before the game is set up; fall back to no seed.
    return "";
  }
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
    const newAge = readNewAgeType(deps);
    const turn = deps.getCurrentTurn() ?? -1;
    // Debounce: PlayerAgeTransitionComplete fires once per major civ, but the
    // boundary record only needs to happen once per transition. Keyed on the
    // game seed too, so a different game's identical age|turn never collides.
    const boundaryKey = _readGameSeed() + "|" + String(newAge) + "|" + String(turn);
    if (boundaryKey === _lastHandledBoundary) return;
    _lastHandledBoundary = boundaryKey;
    deps.logDebug(
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

    // No re-sample here: at PlayerAgeTransitionComplete the new
    // age's economy has not spun up yet, so Stats.getNetYield(...) reads 0. The
    // normal PlayerTurnActivated sample for the new age's first turn captures
    // that turn with real yields and the new civ identity.
  } catch (e) {
    deps.tripIfTooMany("onPlayerAgeTransitionComplete", e);
  }
}