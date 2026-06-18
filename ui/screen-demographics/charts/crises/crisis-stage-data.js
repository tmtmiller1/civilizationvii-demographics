// crisis-stage-data.js
//
// Shared crisis-stage primitives: the per-stage severity colors + name LOC tags
// (matching the historical line charts' crisis markers) and onset/segment
// detection from the sampled `crisis_stage` step. Pure data/logic with no
// chart-module dependencies, so both the Crises page (chart-crisis-stages.js)
// and the war-timeline overlay (chart-conflicts-timeline.js) can import it freely
// without creating an import cycle.

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
 * Read the global crisis_stage DISPLAY value (0..4) off any one player in a
 * sample (the sampler stamps it on every player's metrics).
 * @param {Snapshot|*} s One sample.
 * @returns {number|undefined} The display stage, or undefined.
 */
function readSampleCrisisStage(s) {
  const players = s?.players;
  if (!players) return undefined;
  let best = undefined;
  for (const k of Object.keys(players)) {
    best = maxStage(best, players[k]?.metrics?.crisis_stage);
  }
  return best;
}

/**
 * Return the higher valid crisis stage between the running max and candidate.
 * @param {number|undefined} best Running max stage.
 * @param {*} candidate Candidate stage value.
 * @returns {number|undefined} Updated max stage.
 */
function maxStage(best, candidate) {
  if (typeof candidate !== "number" || !isFinite(candidate)) return best;
  if (best === undefined || candidate > best) return candidate;
  return best;
}

/**
 * Walk the samples and record each crisis-stage onset: the turn the stage value
 * first rises to a new higher level (pre-crisis counts as 0).
 * @param {Snapshot[]} samples The sample stream.
 * @returns {{ stage: number, turn: number, sample: Snapshot }[]} The onsets.
 */
export function crisisStageOnsets(samples) {
  /** @type {{ stage: number, turn: number, sample: Snapshot }[]} */
  const onsets = [];
  // Each age has its OWN crisis. The stage doesn't reliably drop to 0 between ages
  // in the sampled stream (it can linger high, or go undefined) - so on an age
  // transition we both reset the running max AND DISARM detection until this age
  // reports a pre-crisis (<=0) reading. That stops a value lingering from the
  // previous age's crisis into the new age's first samples from being mistaken
  // for a fresh onset (which would spawn a phantom crisis group). The very first
  // age starts armed - it has no previous age to linger from.
  const state = { last: 0, age: /** @type {*} */ (undefined), armed: true };
  for (const s of samples || []) onsetStep(s, state, onsets);
  return onsets;
}

/**
 * Fold one sample into the onset accumulator: reset the running max at age
 * changes, disarm across real age transitions until a pre-crisis reading
 * confirms this age's baseline, then record each genuine new-high onset.
 * @param {Snapshot|*} s One sample.
 * @param {{ last: number, age: *, armed: boolean }} state Detection state (mutated).
 * @param {{ stage: number, turn: number, sample: Snapshot }[]} onsets Accumulator.
 */
function onsetStep(s, state, onsets) {
  if (!s) return;
  handleAgeChange(s, state);
  const raw = readSampleCrisisStage(s);
  if (raw === undefined) return;
  if (raw <= 0) state.armed = true; // confirmed pre-crisis baseline for this age
  if (isNewOnset(state, raw, s)) {
    onsets.push({ stage: raw, turn: s.turn, sample: s });
  }
  if (raw >= 0) state.last = raw;
}

/**
 * Reset the running max at an age change and disarm detection across real
 * age-to-age transitions (the first age has nothing to linger from).
 * @param {Snapshot|*} s One sample.
 * @param {{ last: number, age: *, armed: boolean }} state Detection state (mutated).
 */
function handleAgeChange(s, state) {
  if (s.age === state.age) return;
  if (state.age !== undefined) state.armed = false;
  state.age = s.age;
  state.last = 0;
}

/**
 * Whether this sample is a genuine new-high crisis onset: armed, strictly above
 * the running max, at least stage 1, and turn-stamped.
 * @param {{ last: number, armed: boolean }} state Detection state.
 * @param {number} raw The sample's crisis stage.
 * @param {Snapshot|*} s One sample.
 * @returns {boolean} True when a new onset should be recorded.
 */
function isNewOnset(state, raw, s) {
  return state.armed && raw > state.last && raw >= 1 && typeof s.turn === "number";
}

/**
 * Normalize a sample's age to a stable key, treating untagged legacy samples
 * (no `age`) as Antiquity , the only age that existed before age-tagging.
 * @param {Snapshot|*} sample One sample.
 * @returns {string} The age key.
 */
export function sampleAgeKey(sample) {
  return sample && typeof sample.age === "string" ? sample.age : "AGE_ANTIQUITY";
}

/**
 * Map each age to the last (max) turn sampled in it. Used to cap a finished
 * age's crisis stages at that age's end instead of letting the final stage run
 * to the global latest turn , which, once a later age begins, lives in a RESET
 * age-local turn space and would invert the [start, end] window.
 * @param {Snapshot[]} samples The sample stream.
 * @returns {Map<string, number>} Age key -> last sampled turn.
 */
export function ageLastTurns(samples) {
  /** @type {Map<string, number>} */
  const map = new Map();
  for (const s of samples || []) {
    if (!s || typeof s.turn !== "number") continue;
    const a = sampleAgeKey(s);
    const prev = map.get(a);
    if (prev === undefined || s.turn > prev) map.set(a, s.turn);
  }
  return map;
}

/**
 * The end turn for onset `i`: the next SAME-AGE onset's turn, else this age's
 * last sampled turn (so a finished crisis stays bounded within its own age and
 * its window never inverts once a later age - with reset turns - begins).
 * @param {{ stage:number, turn:number, sample:Snapshot }[]} onsets The onsets.
 * @param {number} i The onset index.
 * @param {number} latestTurn Fallback latest turn.
 * @param {Map<string, number>} [ageLastTurn] Per-age last turn (see ageLastTurns).
 * @returns {number} The segment end turn.
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
 * onset in the SAME age; the last stage of an age's crisis ends at that age's
 * last sampled turn (via {@link ageLastTurns}), keeping each crisis bounded
 * within its age so its turn window survives later age transitions.
 * @param {{ stage: number, turn: number, sample: Snapshot }[]} onsets The onsets.
 * @param {number} latestTurn The latest sampled turn (fallback).
 * @param {Map<string, number>} [ageLastTurn] Per-age last turn (see ageLastTurns).
 * @returns {{ stage: number, start: number, end: number, sample: Snapshot }[]} The segments.
 */
export function crisisStageSegments(onsets, latestTurn, ageLastTurn) {
  return onsets.map((o, i) => ({
    stage: o.stage,
    start: o.turn,
    end: segmentEnd(onsets, i, latestTurn, ageLastTurn),
    sample: o.sample
  }));
}
