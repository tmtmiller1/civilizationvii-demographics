// crisis-stage-data.js
//
// Shared crisis-stage primitives: the per-stage severity colors + name LOC tags
// (matching the historical line charts' crisis markers) and onset/segment
// detection from the sampled `crisis_stage` step. Pure data/logic with no
// chart-module dependencies, so both the Crises page (chart-crisis-stages.js)
// and the war-timeline overlay (chart-wars-gantt.js) can import it freely
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
  const onsets = [];
  let last = 0;
  for (const s of samples || []) {
    const raw = readSampleCrisisStage(s);
    if (raw === undefined) continue;
    if (raw > last && raw >= 1 && typeof s.turn === "number") {
      onsets.push({ stage: raw, turn: s.turn, sample: s });
    }
    if (raw >= 0) last = raw;
  }
  return onsets;
}

/**
 * Turn onsets into [start, end] stage segments (a stage runs until the next
 * onset, or the latest turn for the final, still-running stage).
 * @param {{ stage: number, turn: number, sample: Snapshot }[]} onsets The onsets.
 * @param {number} latestTurn The latest sampled turn.
 * @returns {{ stage: number, start: number, end: number, sample: Snapshot }[]} The segments.
 */
export function crisisStageSegments(onsets, latestTurn) {
  return onsets.map((o, i) => ({
    stage: o.stage,
    start: o.turn,
    end: i + 1 < onsets.length ? onsets[i + 1].turn : latestTurn,
    sample: o.sample
  }));
}
