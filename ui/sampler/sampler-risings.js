// sampler-risings.js
//
// Copies the Partisans mod's risings into Demographics' own saved history (`history.risings`),
// keyed by the Partisans id, once per sample on the same pass as the war tracker. Keeping its own
// copy is what lets the Conflicts timeline still show past risings after Partisans is removed.
// Each record pins the chart turn and year of its start and end at ingest time, like a war does.

import {
  RISINGS_CAP,
  readPartisanRisings,
  validateRising
} from "/demographics/ui/core/demographics-risings-contract.js";
import {
  nearestAgeSample,
  nextAge,
  placeRisingTurn,
  previousAge
} from "/demographics/ui/sampler/sampler-risings-place.js";
import { pidInfo } from "/demographics/ui/sampler/sampler-wars-augment.js";
import { safeCall } from "/demographics/ui/sampler/sampler-shared.js";

/**
 * @typedef {import("/demographics/ui/core/demographics-risings-contract.js").RisingRow} RisingRow
 * @typedef {import("/demographics/ui/sampler/sampler-risings-place.js").RisingPlaceContext} RisingPlaceContext
 */

/**
 * A civ as it read when the rising was recorded (pinned to that age, like a war roster entry).
 * @typedef {{ civ: string, civTypeString?: string, leader?: string, leaderType?: string }} RisingCiv
 */

/**
 * One saved rising: the Partisans row plus where it sits on the timeline. The field names are
 * stored in saves and never change.
 * @typedef {RisingRow & {
 *   age: string,
 *   startChartTurn?: number,
 *   startYear?: string,
 *   lastChartTurn?: number,
 *   endChartTurn?: number,
 *   endYear?: string,
 *   ownerCiv?: RisingCiv,
 *   otherCiv?: RisingCiv,
 *   policyName?: string
 * }} RisingRecord
 */

/**
 * Everything a merge needs from the game, passed in so the merge stays pure.
 * @typedef {RisingPlaceContext & {
 *   resolveCiv: (pid: number) => RisingCiv|undefined,
 *   resolvePolicyName: (type: string) => string|undefined
 * }} RisingContext
 */

/** @param {*} rec */
function isStoredRising(rec) {
  return !!rec && typeof rec === "object" && Number.isInteger(rec.id) && Number.isInteger(rec.owner) &&
    typeof rec.cause === "string" && typeof rec.name === "string";
}

/**
 * The index of the newest row that ended with an earlier age. Rows are oldest first, so every row
 * at or before it belongs to an earlier age too. Partisans closes those rows on the new age's first
 * pass, so a row ended "with the age" always began in an earlier age, even when it ended this turn.
 * @param {(RisingRow|null)[]} rows
 * @returns {number} -1 when there is none.
 */
function lastEarlierAgeIndex(rows) {
  let found = -1;
  rows.forEach((row, i) => {
    if (row && row.outcome === "age") found = i;
  });
  return found;
}

/**
 * @param {RisingRecord} rec Mutated.
 * @param {RisingContext} ctx
 */
function placeEnd(rec, ctx) {
  // The age change ends a rising on the next age's first pass, so that end is a turn of the next age.
  const endAge = rec.outcome === "age" ? nextAge(rec.age, ctx) : rec.age;
  const placed = typeof rec.end === "number" && endAge ? placeRisingTurn(rec.end, endAge, ctx) : null;
  const fallback = typeof rec.lastChartTurn === "number" ? rec.lastChartTurn : rec.startChartTurn;
  const chartTurn = placed ? placed.chartTurn : fallback;
  if (typeof chartTurn === "number") {
    const floor = typeof rec.startChartTurn === "number" ? rec.startChartTurn : chartTurn;
    rec.endChartTurn = Math.max(floor, chartTurn);
  }
  if (placed && placed.year) rec.endYear = placed.year;
}

/**
 * @param {RisingRecord} rec Mutated.
 * @param {RisingRow} row
 * @param {RisingContext} ctx
 */
function applyEnd(rec, row, ctx) {
  if (typeof row.end !== "number") {
    for (const key of ["end", "outcome", "endChartTurn", "endYear"]) delete /** @type {*} */ (rec)[key];
    if (rec.age === ctx.age) rec.lastChartTurn = ctx.chartTurn;
    return;
  }
  const changed = rec.end !== row.end || rec.outcome !== row.outcome;
  rec.end = row.end;
  if (row.outcome) rec.outcome = row.outcome;
  else delete rec.outcome;
  if (changed || typeof rec.endChartTurn !== "number") placeEnd(rec, ctx);
}

/** Snapshot player fields copied onto a {@link RisingCiv}, beside the civ name. */
const SAMPLE_CIV_FIELDS = [["civTypeString", "civTypeString"], ["leaderName", "leader"], ["leaderTypeString", "leaderType"]];

/**
 * A civ as the stored sample shows it.
 * @param {Snapshot|null} sample
 * @param {number} pid
 * @returns {RisingCiv|undefined}
 */
function sampleCiv(sample, pid) {
  const ps = sample && sample.players ? /** @type {*} */ (sample.players)[pid] : null;
  if (!ps || typeof ps.civName !== "string" || !ps.civName) return undefined;
  /** @type {RisingCiv} */
  const civ = { civ: ps.civName };
  for (const [from, to] of SAMPLE_CIV_FIELDS) {
    if (typeof ps[from] === "string" && ps[from]) /** @type {*} */ (civ)[to] = ps[from];
  }
  return civ;
}

/**
 * A civ named as it was in the rising's own age. A rising from an earlier age is read from that age's samples, since
 * the live player has taken a new civ since; with no such sample the timeline uses a generic name.
 * @param {RisingRecord} rec
 * @param {number} pid
 * @param {RisingContext} ctx
 * @returns {RisingCiv|undefined}
 */
function civInOwnAge(rec, pid, ctx) {
  if (rec.age === ctx.age) return ctx.resolveCiv(pid);
  return rec.age ? sampleCiv(nearestAgeSample(ctx.samples, rec.age, rec.start), pid) : undefined;
}

/**
 * @param {RisingRecord} rec Mutated.
 * @param {RisingRow} row
 * @param {RisingContext} ctx
 */
function addNames(rec, row, ctx) {
  const ownerCiv = civInOwnAge(rec, row.owner, ctx);
  if (ownerCiv) rec.ownerCiv = ownerCiv;
  const other = typeof row.from === "number" ? row.from : row.homeland;
  const otherCiv = typeof other === "number" ? civInOwnAge(rec, other, ctx) : undefined;
  if (otherCiv) rec.otherCiv = otherCiv;
  const policyName = row.policy ? ctx.resolvePolicyName(row.policy) : undefined;
  if (policyName) rec.policyName = policyName;
}

/**
 * The age a new rising belongs to and where its start sits on the chart. Partisans names the age when it can;
 * otherwise rows before the last age change are the previous age's. An earlier age with no samples left to place it
 * against stays unplaced ("" age).
 * @param {RisingRow} row @param {RisingContext} ctx @param {boolean} isEarlierAge
 * @returns {{age: string, placed: ReturnType<typeof placeRisingTurn>}}
 */
function placeStart(row, ctx, isEarlierAge) {
  const named = typeof row.age === "string" ? row.age : "";
  const age = named || (isEarlierAge ? previousAge(ctx) || "" : ctx.age);
  const placed = age ? placeRisingTurn(row.start, age, ctx) : null;
  if (named && named !== ctx.age && !placed) return { age: "", placed: null };
  return { age, placed };
}

/**
 * A new record for a rising seen for the first time.
 * @param {RisingRow} row
 * @param {RisingContext} ctx
 * @param {boolean} isEarlierAge Whether the rising belongs to an earlier age.
 * @returns {RisingRecord}
 */
export function buildRisingRecord(row, ctx, isEarlierAge) {
  const { age, placed } = placeStart(row, ctx, isEarlierAge);
  /** @type {RisingRecord} */
  const rec = { ...row, age };
  delete rec.end;
  delete rec.outcome;
  if (placed) {
    rec.startChartTurn = placed.chartTurn;
    rec.lastChartTurn = age === ctx.age ? ctx.chartTurn : placed.chartTurn;
    if (placed.year) rec.startYear = placed.year;
  }
  addNames(rec, row, ctx);
  applyEnd(rec, row, ctx);
  return rec;
}

/**
 * @param {RisingRecord} rec Mutated.
 * @param {RisingRow} row
 * @param {RisingContext} ctx
 */
function updateRisingRecord(rec, row, ctx) {
  if (row.policy && !rec.policy) {
    rec.policy = row.policy;
    const policyName = ctx.resolvePolicyName(row.policy);
    if (policyName) rec.policyName = policyName;
  }
  applyEnd(rec, row, ctx);
}

/**
 * Keep the newest {@link RISINGS_CAP} risings, oldest first.
 * @param {RisingRecord[]} list
 * @returns {RisingRecord[]}
 */
function capRisings(list) {
  const sorted = list.slice().sort((a, b) => a.id - b.id);
  return sorted.length > RISINGS_CAP ? sorted.slice(-RISINGS_CAP) : sorted;
}

/**
 * Merge Partisans' rows into the saved risings: new ids are added, known ones get their end and
 * outcome updated. Invalid rows are skipped and invalid saved entries dropped.
 * @param {*} stored The saved `history.risings` (anything).
 * @param {*[]} incoming Raw rows from Partisans, oldest first.
 * @param {RisingContext} ctx
 * @returns {RisingRecord[]} The merged, capped list.
 */
export function mergeRisings(stored, incoming, ctx) {
  /** @type {RisingRecord[]} */
  const list = Array.isArray(stored) ? stored.filter(isStoredRising) : [];
  const byId = new Map(list.map((rec) => [rec.id, rec]));
  const rows = (Array.isArray(incoming) ? incoming : []).map(validateRising);
  const earlierUpTo = lastEarlierAgeIndex(rows);
  rows.forEach((row, i) => {
    if (!row) return;
    const known = byId.get(row.id);
    if (known) {
      updateRisingRecord(known, row, ctx);
      return;
    }
    const rec = buildRisingRecord(row, ctx, i <= earlierUpTo);
    list.push(rec);
    byId.set(rec.id, rec);
  });
  return capRisings(list);
}

/**
 * @param {Snapshot} snapshot
 * @param {number} pid
 * @returns {RisingCiv|undefined}
 */
function resolveRisingCiv(snapshot, pid) {
  try {
    const info = pidInfo(snapshot, pid);
    if (!info || !info.civ) return undefined;
    /** @type {RisingCiv} */
    const civ = { civ: info.civ };
    if (info.civTypeString) civ.civTypeString = info.civTypeString;
    if (info.leader) civ.leader = info.leader;
    if (info.leaderType) civ.leaderType = info.leaderType;
    return civ;
  } catch (_) {
    // A player handle can be stale mid age-transition; the timeline falls back to a generic name.
    return undefined;
  }
}

/**
 * @param {string} type A TraditionType.
 * @returns {string|undefined} The policy card's Name tag.
 */
function resolvePolicyName(type) {
  try {
    const row = typeof GameInfo !== "undefined" ? GameInfo.Traditions?.lookup(type) : null;
    const name = row && row.Name;
    return typeof name === "string" && name.startsWith("LOC_") ? name : undefined;
  } catch (_) {
    // GameInfo.Traditions holds only the current age's cards; an unknown type has no name.
    return undefined;
  }
}

/**
 * @param {Snapshot} snapshot
 * @param {number} turn
 * @param {*} history
 * @returns {RisingContext}
 */
function buildRisingContext(snapshot, turn, history) {
  return {
    chartTurn: typeof snapshot?.chartTurn === "number" ? snapshot.chartTurn : turn,
    localTurn: typeof snapshot?.localTurn === "number" ? snapshot.localTurn : turn,
    age: typeof snapshot?.age === "string" ? snapshot.age : "",
    gameYear: typeof snapshot?.gameYear === "string" ? snapshot.gameYear : undefined,
    samples: Array.isArray(history.samples) ? history.samples : [],
    resolveCiv: (pid) => resolveRisingCiv(snapshot, pid),
    resolvePolicyName
  };
}

/**
 * Fold this turn's Partisans risings into the history the sampler is about to save. Does nothing
 * (and adds no key to the save) while Partisans isn't loaded.
 * @param {Snapshot} snapshot The just-recorded snapshot.
 * @param {number} turn The age-local sample turn.
 * @param {*} history The in-progress history (mutated; the caller saves it).
 */
export function runRisingsTracker(snapshot, turn, history) {
  safeCall("risingsTracker", () => {
    if (!history || typeof history !== "object") return;
    const incoming = readPartisanRisings();
    if (!incoming) return;
    if (!incoming.length && !Array.isArray(history.risings)) return;
    history.risings = mergeRisings(history.risings, incoming, buildRisingContext(snapshot, turn, history));
  });
}
