// crisis-cost-model.js
//
// DOM-free crisis cost-model computation shared by the Crises page render
// (chart-crisis-stages.js) and the age-boundary snapshot (sampler-age-boundary.js).
//
// Why a snapshot exists: the per-civ "losses" figures (population / crop / production lost) are
// sums of per-turn declines (sumDeclines in chart-conflicts-cost.js), so they need DENSE
// turn-by-turn samples. As a game grows, old samples are decimated to cap the save — and once a
// finished age's samples are thinned, those loss columns collapse to "—" while one-sample figures
// (e.g. current Military Power) survive. Computing the totals at the age boundary, while the
// finished age's samples are still dense, and persisting them lets the Crises page render a
// finished age's cumulative impact from the snapshot instead of recomputing from thinned samples.

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

// Cost metrics shown per crisis: every war-cost figure EXCEPT production directed to war and
// settlements razed (both war-specific). Shared so the render and the snapshot agree.
export const CRISIS_METRICS = COST_METRICS.filter((m) => m.id !== "warProdCum" && m.id !== "razedCum");

// m.key -> reduction mode, for summing each cost metric across crises/ages.
/** @type {Record<string, string>} */
export const COST_KEY_MODE = {};
for (const m of CRISIS_METRICS) COST_KEY_MODE[m.key] = m.mode;

/**
 * Every major civ present in the samples within [start, end] (one cost column each), first-seen
 * order. Iterating `s.players` yields majors only (city-states live in `s.minors`).
 * @param {Snapshot[]} samples The sample stream.
 * @param {number} start The window start turn.
 * @param {number} end The window end turn.
 * @returns {{ pid: number }[]} The participant column entries.
 */
export function crisisParticipants(samples, start, end) {
  const seen = new Set();
  const out = [];
  for (const s of samples) {
    if (typeof s?.turn !== "number" || s.turn < start || s.turn > end) continue;
    for (const pid in s.players || {}) {
      const n = Number(pid);
      if (!seen.has(n)) {
        seen.add(n);
        out.push({ pid: n });
      }
    }
  }
  return out;
}

/**
 * Split flat stage segments into per-crisis runs. A new crisis begins at each stage-1 onset or
 * whenever the age changes, so each age's crisis gets its own group.
 * @param {{ stage:number, start:number, end:number, sample:Snapshot }[]} segments The segments.
 * @returns {*[]} The crisis groups ({ segments, start, end, sample, age }).
 */
export function groupCrises(segments) {
  /** @type {{ segments:any[], start:number, end:number, sample:Snapshot, age:* }[]} */
  const groups = [];
  /** @type {{ segments:any[], start:number, end:number, sample:Snapshot, age:* }|null} */
  let cur = null;
  for (const seg of segments) {
    const age = seg.sample && seg.sample.age;
    if (!cur || seg.stage === 1 || age !== cur.age) {
      cur = { segments: [], start: seg.start, end: seg.end, sample: seg.sample, age };
      groups.push(cur);
    }
    cur.segments.push(seg);
    cur.end = seg.end;
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
  for (const key of Object.keys(add)) {
    const v = add[key];
    if (typeof v !== "number" || !isFinite(v)) continue;
    if (COST_KEY_MODE[key] === "level") acc[key] = v;
    else acc[key] = (typeof acc[key] === "number" ? acc[key] : 0) + v;
  }
}

/**
 * Resolve a participant's leader-type + primary color from the latest sample carrying the pid, so a
 * snapshot column can render its portrait/dot without the (later-decimated) live samples.
 * @param {Pid|string|number} pid The participant pid.
 * @param {Snapshot[]} samples The sample stream.
 * @returns {{ leaderType: (string|undefined), color: (string|undefined) }} Identity bits.
 */
export function participantIdentity(pid, samples) {
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i];
    const ps = s && s.players ? s.players[pid] : null;
    if (ps) {
      return {
        leaderType: typeof ps.leaderTypeString === "string" ? ps.leaderTypeString : undefined,
        color: typeof ps.primaryColor === "string" ? ps.primaryColor : undefined
      };
    }
  }
  return { leaderType: undefined, color: undefined };
}

/**
 * The crisis groups within one age's samples (start/end windows).
 * @param {Snapshot[]} ageSamples Samples already filtered to one age.
 * @returns {{ start:number, end:number, sample:Snapshot }[]} The crisis groups.
 */
function ageCrisisGroups(ageSamples) {
  const onsets = crisisStageOnsets(ageSamples);
  if (!onsets.length) return [];
  const last = ageSamples[ageSamples.length - 1];
  const latest = last && typeof last.turn === "number" ? last.turn : 0;
  return groupCrises(crisisStageSegments(onsets, latest, ageLastTurns(ageSamples)));
}

/**
 * Build the per-civ CUMULATIVE crisis cost columns for one age (every stage summed), each column
 * carrying the civ's identity so it renders from a snapshot without live samples. Empty when the
 * age had no crisis.
 * @param {Snapshot[]} ageSamples Samples filtered to one age (must be dense for accurate losses).
 * @returns {CrisisCol[]} The cumulative cost columns.
 */
export function buildAgeCrisisCols(ageSamples) {
  /** @type {Map<number, { pid:number, cost:Record<string, number> }>} */
  const byPid = new Map();
  for (const group of ageCrisisGroups(ageSamples)) {
    for (const p of crisisParticipants(ageSamples, group.start, group.end)) {
      let col = byPid.get(p.pid);
      if (!col) {
        col = { pid: p.pid, cost: {} };
        byPid.set(p.pid, col);
      }
      mergeCost(col.cost, participantCost(ageSamples, p, group.start, group.end));
    }
  }
  return Array.from(byPid.values()).map((c) => ({
    ...c,
    ...participantIdentity(c.pid, ageSamples)
  }));
}

/**
 * Convert stored/computed cost columns into the shape buildCostTable consumes.
 * @param {CrisisCol[]} cols The cumulative cost columns.
 * @returns {TableCol[]} The buildCostTable columns.
 */
export function toTableCols(cols) {
  return (cols || []).map((c) => ({
    entry: { pid: c.pid, leaderType: c.leaderType, color: c.color },
    cs: null,
    cost: c.cost
  }));
}

/**
 * Merge per-age cumulative columns (snapshot or live) into one cross-age overall column set,
 * summed by pid.
 * @param {CrisisCol[][]} colSets One cumulative-column array per age.
 * @returns {TableCol[]} The overall buildCostTable columns.
 */
export function mergeAgeCols(colSets) {
  /** @type {Map<number, *>} */
  const byPid = new Map();
  for (const cols of colSets || []) {
    for (const c of cols || []) {
      let acc = byPid.get(c.pid);
      if (!acc) {
        acc = { pid: c.pid, leaderType: c.leaderType, color: c.color, cost: {} };
        byPid.set(c.pid, acc);
      }
      mergeCost(acc.cost, c.cost);
    }
  }
  return toTableCols(Array.from(byPid.values()));
}
