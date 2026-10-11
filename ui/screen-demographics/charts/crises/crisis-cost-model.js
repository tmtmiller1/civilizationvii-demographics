// crisis-cost-model.js
//
// DOM-free crisis cost-model computation shared by the Crises page render
// (chart-crisis-stages.js) and the age-boundary snapshot (sampler-age-boundary.js).
//
// The per-civ "losses" figures are sums of per-turn declines, so they need dense samples; old
// samples are decimated to cap the save, so the totals are computed at the age boundary while the
// finished age's samples are still dense and persisted for the Crises page to render.

import {
  COST_METRICS,
  participantCost
} from "/demographics/ui/screen-demographics/charts/conflicts/chart-conflicts-cost.js";
import {
  ageLastTurns,
  crisisStageOnsets,
  crisisStageSegments
} from "/demographics/ui/screen-demographics/charts/crises/crisis-stage-data.js";

/** A raw cumulative cost column: { pid, leaderType?, color?, cost }. @typedef {*} CrisisCol */
/** A buildCostTable column: { entry, cs:null, cost }. @typedef {*} TableCol */

// Cost metrics shown per crisis: every war-cost figure except production directed to war and
// settlements razed (both war-specific). Shared so the render and the snapshot agree.
export const CRISIS_METRICS = COST_METRICS.filter(
  (metric) => metric.id !== "warProdCum" && metric.id !== "razedCum"
);

// Cost key -> reduction mode, for summing each cost metric across crises/ages.
/** @type {Record<string, string>} */
export const COST_KEY_MODE = {};
for (const metric of CRISIS_METRICS) COST_KEY_MODE[metric.key] = metric.mode;

/**
 * Every major civ present in the samples within [start, end] (one cost column each), first-seen
 * order. Iterating `s.players` yields majors only (city-states live in `s.minors`).
 * @param {Snapshot[]} samples
 * @param {number} start
 * @param {number} end
 * @returns {{ pid: number }[]}
 */
export function crisisParticipants(samples, start, end) {
  const seen = new Set();
  const out = [];
  for (const sample of samples) {
    if (typeof sample?.turn !== "number" || sample.turn < start || sample.turn > end) continue;
    for (const pid in sample.players || {}) {
      const numericPid = Number(pid);
      if (!seen.has(numericPid)) {
        seen.add(numericPid);
        out.push({ pid: numericPid });
      }
    }
  }
  return out;
}

/**
 * Split flat stage segments into per-crisis runs. A new crisis begins at each stage-1 onset or
 * whenever the age changes, so each age's crisis gets its own group.
 * @param {{ stage:number, start:number, end:number, sample:Snapshot }[]} segments
 * @returns {*[]} The crisis groups ({ segments, start, end, sample, age }).
 */
export function groupCrises(segments) {
  /** @type {{ segments:any[], start:number, end:number, sample:Snapshot, age:* }[]} */
  const groups = [];
  /** @type {{ segments:any[], start:number, end:number, sample:Snapshot, age:* }|null} */
  let current = null;
  for (const segment of segments) {
    const age = segment.sample && segment.sample.age;
    if (!current || segment.stage === 1 || age !== current.age) {
      current = { segments: [], start: segment.start, end: segment.end, sample: segment.sample, age };
      groups.push(current);
    }
    current.segments.push(segment);
    current.end = segment.end;
  }
  return groups;
}

/**
 * Merge one crisis's per-metric cost figures into an accumulator: summable modes (losses / net /
 * accrued / spent) add up; a "level" metric (standing Military Power) is a snapshot, so the latest
 * value wins.
 * @param {Record<string, number>} acc The running per-metric accumulator (mutated).
 * @param {Record<string, number|null>} add One crisis's per-metric cost.
 */
export function mergeCost(acc, add) {
  // A persisted snapshot column can carry a null/non-object cost; nothing to merge.
  if (!add || typeof add !== "object") return;
  for (const key of Object.keys(add)) {
    const value = add[key];
    if (typeof value !== "number" || !isFinite(value)) continue;
    if (COST_KEY_MODE[key] === "level") acc[key] = value;
    else acc[key] = (typeof acc[key] === "number" ? acc[key] : 0) + value;
  }
}

/**
 * Resolve a participant's leader-type + primary color from the latest sample carrying the pid, so a
 * snapshot column can render its portrait/dot without the (later-decimated) live samples.
 * @param {Pid|string|number} pid
 * @param {Snapshot[]} samples
 * @returns {{ leaderType: (string|undefined), color: (string|undefined) }}
 */
export function participantIdentity(pid, samples) {
  for (let i = samples.length - 1; i >= 0; i--) {
    const sample = samples[i];
    const samplePlayer = sample && sample.players ? sample.players[pid] : null;
    if (samplePlayer) {
      return {
        leaderType:
          typeof samplePlayer.leaderTypeString === "string" ? samplePlayer.leaderTypeString : undefined,
        color: typeof samplePlayer.primaryColor === "string" ? samplePlayer.primaryColor : undefined
      };
    }
  }
  return { leaderType: undefined, color: undefined };
}

/**
 * The crisis groups within one age's samples (start/end windows).
 * @param {Snapshot[]} ageSamples Samples already filtered to one age.
 * @returns {{ start:number, end:number, sample:Snapshot }[]}
 */
function ageCrisisGroups(ageSamples) {
  const onsets = crisisStageOnsets(ageSamples);
  if (!onsets.length) return [];
  const last = ageSamples[ageSamples.length - 1];
  const latest = last && typeof last.turn === "number" ? last.turn : 0;
  return groupCrises(crisisStageSegments(onsets, latest, ageLastTurns(ageSamples)));
}

/**
 * Build the per-civ cumulative crisis cost columns for one age (every stage summed), each column
 * carrying the civ's identity so it renders from a snapshot without live samples. Empty when the
 * age had no crisis.
 * @param {Snapshot[]} ageSamples Samples filtered to one age (must be dense for accurate losses).
 * @returns {CrisisCol[]}
 */
export function buildAgeCrisisCols(ageSamples) {
  /** @type {Map<number, { pid:number, cost:Record<string, number> }>} */
  const byPid = new Map();
  for (const group of ageCrisisGroups(ageSamples)) {
    for (const participant of crisisParticipants(ageSamples, group.start, group.end)) {
      let col = byPid.get(participant.pid);
      if (!col) {
        col = { pid: participant.pid, cost: {} };
        byPid.set(participant.pid, col);
      }
      mergeCost(col.cost, participantCost(ageSamples, participant, group.start, group.end));
    }
  }
  return Array.from(byPid.values()).map((column) => ({
    ...column,
    ...participantIdentity(column.pid, ageSamples)
  }));
}

/**
 * Whether a (possibly persisted) column is a usable object. Snapshot arrays come from storage, so
 * an element can be null or a scalar; those are dropped rather than dereferenced.
 * @param {*} column
 * @returns {boolean}
 */
function isCol(column) {
  return !!column && typeof column === "object";
}

/**
 * Convert stored/computed cost columns into the shape buildCostTable consumes.
 * @param {CrisisCol[]} cols
 * @returns {TableCol[]}
 */
export function toTableCols(cols) {
  return (Array.isArray(cols) ? cols : []).filter(isCol).map((column) => ({
    entry: { pid: column.pid, leaderType: column.leaderType, color: column.color },
    cs: null,
    cost: column.cost
  }));
}

/**
 * Merge per-age cumulative columns (snapshot or live) into one cross-age overall column set,
 * summed by pid.
 * @param {CrisisCol[][]} colSets One cumulative-column array per age.
 * @returns {TableCol[]}
 */
export function mergeAgeCols(colSets) {
  /** @type {Map<number, *>} */
  const byPid = new Map();
  for (const cols of colSets || []) {
    for (const column of (Array.isArray(cols) ? cols : []).filter(isCol)) {
      let acc = byPid.get(column.pid);
      if (!acc) {
        acc = { pid: column.pid, leaderType: column.leaderType, color: column.color, cost: {} };
        byPid.set(column.pid, acc);
      }
      mergeCost(acc.cost, column.cost);
    }
  }
  return toTableCols(Array.from(byPid.values()));
}
