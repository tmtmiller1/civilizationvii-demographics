// crisis-stage-data.js
//
// Shared crisis-stage primitives: the per-stage severity colors + name LOC tags
// (matching the historical line charts' crisis markers) and onset/segment
// detection from the sampled `crisis_stage` step. Pure data/logic with no
// chart-module dependencies, so the Crises page and the war-timeline overlay
// can both import it without an import cycle.

// Severity color per stage (1..4), matching chart-line-event-markers.js so the
// gantt overlay + Crises page read the same as the historical charts.
export const CRISIS_STAGE_COLORS = ["#e69a3c", "#e57c1a", "#d54a2b", "#9a2a2a"];

// Stage name LOC tags by stage index (the same labels the historical markers use).
export const CRISIS_STAGE_LABELS = [
  "LOC_DEMOGRAPHICS_CRISIS_STAGE_BEGINS",
  "LOC_DEMOGRAPHICS_CRISIS_STAGE_INTENSIFIES",
  "LOC_DEMOGRAPHICS_CRISIS_STAGE_CULMINATES",
  "LOC_DEMOGRAPHICS_CRISIS_STAGE_ENDS"
];

/**
 * Read the global crisis_stage display value (0..4) off any one player in a
 * sample (the sampler stamps it on every player's metrics).
 * @param {Snapshot|*} sample
 * @returns {number|undefined} The display stage, or undefined when no player carries one.
 */
function readSampleCrisisStage(sample) {
  const players = sample?.players;
  if (!players) return undefined;
  let best = undefined;
  for (const pid of Object.keys(players)) {
    best = maxStage(best, players[pid]?.metrics?.crisis_stage);
  }
  return best;
}

/**
 * @param {number|undefined} best
 * @param {*} candidate
 * @returns {number|undefined}
 */
function maxStage(best, candidate) {
  if (typeof candidate !== "number" || !isFinite(candidate)) return best;
  if (best === undefined || candidate > best) return candidate;
  return best;
}

/**
 * Walk the samples and record each crisis-stage onset: the turn the stage value
 * first rises to a new higher level (pre-crisis counts as 0).
 * @param {Snapshot[]} samples
 * @returns {{ stage: number, turn: number, sample: Snapshot }[]}
 */
export function crisisStageOnsets(samples) {
  /** @type {{ stage: number, turn: number, sample: Snapshot }[]} */
  const onsets = [];
  // Each age has its own crisis, and the stage doesn't reliably drop to 0 between
  // ages, so an age transition resets the running max and disarms detection until
  // this age reports a pre-crisis (<=0) reading; a lingering value is then never
  // mistaken for a fresh onset. The very first age starts armed.
  const state = { last: 0, age: /** @type {*} */ (undefined), armed: true };
  for (const sample of samples || []) onsetStep(sample, state, onsets);
  return onsets;
}

/**
 * @param {Snapshot|*} sample
 * @param {{ last: number, age: *, armed: boolean }} state
 * @param {{ stage: number, turn: number, sample: Snapshot }[]} onsets
 */
function onsetStep(sample, state, onsets) {
  if (!sample) return;
  handleAgeChange(sample, state);
  const raw = readSampleCrisisStage(sample);
  if (raw === undefined) return;
  if (raw <= 0) state.armed = true; // confirmed pre-crisis baseline for this age
  if (isNewOnset(state, raw, sample)) {
    onsets.push({ stage: raw, turn: sample.turn, sample });
  }
  if (raw >= 0) state.last = raw;
}

/**
 * Reset the running max at an age change and disarm detection across real
 * age-to-age transitions (the first age has nothing to linger from).
 * @param {Snapshot|*} sample
 * @param {{ last: number, age: *, armed: boolean }} state Detection state (mutated).
 */
function handleAgeChange(sample, state) {
  if (sample.age === state.age) return;
  if (state.age !== undefined) state.armed = false;
  state.age = sample.age;
  state.last = 0;
}

/**
 * @param {{ last: number, armed: boolean }} state
 * @param {number} raw
 * @param {Snapshot|*} sample
 */
function isNewOnset(state, raw, sample) {
  return state.armed && raw > state.last && raw >= 1 && typeof sample.turn === "number";
}

/**
 * Normalize a sample's age to a stable key, treating untagged samples (no `age`)
 * as Antiquity.
 * @param {Snapshot|*} sample
 * @returns {string}
 */
export function sampleAgeKey(sample) {
  return sample && typeof sample.age === "string" ? sample.age : "AGE_ANTIQUITY";
}

/**
 * Map each age to the last (max) turn sampled in it, used to cap a finished
 * age's crisis stages at that age's end (a later age's turns live in a reset
 * age-local turn space that would invert the [start, end] window).
 * @param {Snapshot[]} samples
 * @returns {Map<string, number>} Age key -> last sampled turn.
 */
export function ageLastTurns(samples) {
  /** @type {Map<string, number>} */
  const map = new Map();
  for (const sample of samples || []) {
    if (!sample || typeof sample.turn !== "number") continue;
    const age = sampleAgeKey(sample);
    const prev = map.get(age);
    if (prev === undefined || sample.turn > prev) map.set(age, sample.turn);
  }
  return map;
}

/**
 * The end turn for onset `i`: the next same-age onset's turn, else this age's
 * last sampled turn (so a finished crisis stays bounded within its own age and
 * its window never inverts once a later age, with reset turns, begins).
 * @param {{ stage:number, turn:number, sample:Snapshot }[]} onsets
 * @param {number} i
 * @param {number} latestTurn Fallback latest turn.
 * @param {Map<string, number>} [ageLastTurn] Per-age last turn (see ageLastTurns).
 * @returns {number}
 */
function segmentEnd(onsets, i, latestTurn, ageLastTurn) {
  const age = sampleAgeKey(onsets[i].sample);
  const next = onsets[i + 1];
  if (next && sampleAgeKey(next.sample) === age) return next.turn;
  const ageEnd = ageLastTurn && ageLastTurn.get(age);
  return typeof ageEnd === "number" ? ageEnd : latestTurn;
}

/**
 * Turn onsets into [start, end] stage segments. A stage runs until the next
 * onset in the same age; the last stage ends at that age's last sampled turn
 * (via {@link ageLastTurns}), keeping each crisis bounded within its age.
 * @param {{ stage: number, turn: number, sample: Snapshot }[]} onsets
 * @param {number} latestTurn The latest sampled turn (fallback).
 * @param {Map<string, number>} [ageLastTurn] Per-age last turn (see ageLastTurns).
 * @returns {{ stage: number, start: number, end: number, sample: Snapshot }[]}
 */
export function crisisStageSegments(onsets, latestTurn, ageLastTurn) {
  return onsets.map((onset, i) => ({
    stage: onset.stage,
    start: onset.turn,
    end: segmentEnd(onsets, i, latestTurn, ageLastTurn),
    sample: onset.sample
  }));
}
