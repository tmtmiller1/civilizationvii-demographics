// history-campaign.js
//
// Pure operations on the per-save CampaignDoc: create, normalize a loaded blob, track ages and the
// player roster (with each player's civilization per age), append chronicle events and trend
// samples under fixed caps, and record the outcome. dgh-capture.js feeds it; the views read it.

export const CAMPAIGN_VERSION = 1;
/** Maximum chronicle events kept per campaign. */
export const EVENTS_CAP = 2000;
/** Maximum trend samples kept per campaign. */
export const SERIES_CAP = 360;

/**
 * Event kinds from least to most important. When the chronicle is over its cap, the oldest events
 * of the least important kind still present are dropped first.
 * @type {HnrEventKind[]}
 */
export const DROP_ORDER = ["met", "found", "peace", "war", "razed", "capture", "religion", "triumph", "wonder"];

/**
 * A fresh document.
 * @param {{id:string, seed:number, now:number, setup:HnrSetup, local:number}} init Identity.
 * @returns {CampaignDoc} The document.
 */
export function newCampaign(init) {
  return {
    v: CAMPAIGN_VERSION,
    id: init.id,
    seed: init.seed,
    created: init.now,
    updated: init.now,
    setup: init.setup,
    local: init.local,
    players: {},
    ages: [],
    events: [],
    series: { turns: [], by: {} },
    last: null,
    outcome: { status: "in_progress", victory: "", name: "", winner: -1, turn: 0 }
  };
}

/**
 * Whether a parsed blob is a usable CampaignDoc.
 * @param {*} d Parsed JSON.
 * @returns {boolean} True when the required fields are present with the right types.
 */
export function isCampaign(d) {
  return !!(
    d &&
    typeof d === "object" &&
    d.v === CAMPAIGN_VERSION &&
    typeof d.id === "string" &&
    d.players &&
    typeof d.players === "object" &&
    Array.isArray(d.ages) &&
    Array.isArray(d.events) &&
    d.series &&
    Array.isArray(d.series.turns)
  );
}

/**
 * Index of the age in the document, appending it when new.
 * @param {CampaignDoc} doc The document.
 * @param {string} age Age type.
 * @param {number} turn Current turn.
 * @returns {number} The age index.
 */
export function ensureAge(doc, age, turn) {
  let idx = doc.ages.findIndex((a) => a.age === age);
  if (idx === -1) {
    doc.ages.push({ age, start: turn, end: turn });
    idx = doc.ages.length - 1;
  }
  doc.ages[idx].end = Math.max(doc.ages[idx].end, turn);
  return idx;
}

/**
 * Identity of one player as read from the engine.
 * @typedef {{leader:string, leaderName:string, civ:string, civName:string, color:string, color2?:string,
 *   human:boolean}} Identity
 */

/**
 * Record or update a player, appending a civilization span for each new age or civilization.
 * @param {CampaignDoc} doc The document.
 * @param {number} pid Player id.
 * @param {Identity} id Identity.
 * @param {{age:string, turn:number}} at Where in the game this was read.
 */
export function upsertPlayer(doc, pid, id, at) {
  const key = String(pid);
  let p = doc.players[key];
  if (!p) {
    p = { leader: id.leader, leaderName: id.leaderName, civs: [], human: id.human, color: id.color, elim: 0 };
    doc.players[key] = p;
  }
  if (id.color) p.color = id.color;
  if (id.color2) p.color2 = id.color2;
  const last = p.civs[p.civs.length - 1];
  if (id.civ && (!last || last.civ !== id.civ || last.age !== at.age)) {
    p.civs.push({ age: at.age, civ: id.civ, name: id.civName, from: at.turn });
  }
}

/**
 * Remove events until the chronicle fits EVENTS_CAP, oldest of the least important kind first.
 * @param {HnrEvent[]} events The chronicle (mutated).
 */
export function trimEvents(events) {
  for (const kind of DROP_ORDER) {
    if (events.length <= EVENTS_CAP) return;
    let excess = events.length - EVENTS_CAP;
    for (let i = 0; i < events.length && excess > 0; ) {
      if (events[i].k === kind) {
        events.splice(i, 1);
        excess--;
      } else i++;
    }
  }
  if (events.length > EVENTS_CAP) events.splice(0, events.length - EVENTS_CAP);
}

/**
 * Append events, mark eliminations on the roster, then enforce the cap.
 * @param {CampaignDoc} doc The document.
 * @param {HnrEvent[]} events New events.
 */
export function appendEvents(doc, events) {
  for (const e of events) {
    doc.events.push(e);
    if (e.k === "elim" && doc.players[String(e.p)]) doc.players[String(e.p)].elim = e.t;
  }
  trimEvents(doc.events);
}

/**
 * Triumphs earned so far by each player, counted from the chronicle.
 * @param {CampaignDoc} doc The document.
 * @returns {Record<string, number>} Player id -> count.
 */
export function triumphCounts(doc) {
  /** @type {Record<string, number>} */
  const fromEvents = {};
  for (const e of doc.events) if (e.k === "triumph") fromEvents[String(e.p)] = (fromEvents[String(e.p)] || 0) + 1;
  /** @type {Record<string, number>} */
  const held = {};
  for (const byPid of Object.values(doc.tri || {})) {
    for (const [pid, n] of Object.entries(byPid)) held[pid] = (held[pid] || 0) + n;
  }
  const out = { ...fromEvents };
  for (const [pid, n] of Object.entries(held)) out[pid] = Math.max(n, fromEvents[pid] || 0);
  return out;
}

/**
 * Remember how many Triumphs each player holds in the current age. The engine's list is the
 * truth (it includes Triumphs earned before this mod was installed); it only ever grows within
 * an age and is rebuilt at the next age, so the per-age maximum is kept.
 * @param {CampaignDoc} doc The document (mutated).
 * @param {number} ageIdx Current age index.
 * @param {HnrWorldState} world The current state.
 */
export function noteTriumphs(doc, ageIdx, world) {
  /** @type {Record<string, Record<string, number>>} */
  const tri = (doc.tri = doc.tri || {});
  /** @type {Record<string, number>} */
  const age = (tri[String(ageIdx)] = tri[String(ageIdx)] || {});
  for (const [pid, st] of Object.entries(world.players)) {
    const n = (st.triumphs || []).length;
    if (n > (age[pid] || 0)) age[pid] = n;
  }
}

/**
 * Keep every other sample, but always the newest one and the first sample of each age.
 * @param {HnrSeries} s The series (mutated).
 * @param {number[]} keepTurns Turns that must survive (age starts).
 */
export function decimateSeries(s, keepTurns) {
  const keep = new Set(keepTurns);
  const last = s.turns.length - 1;
  const idx = s.turns.map((turn, i) => i).filter((i) => i % 2 === 0 || i === last || keep.has(s.turns[i]));
  s.turns = idx.map((i) => s.turns[i]);
  for (const ps of Object.values(s.by)) {
    ps.set = idx.map((i) => ps.set[i] ?? 0);
    ps.pop = idx.map((i) => ps.pop[i] ?? 0);
    ps.tri = idx.map((i) => ps.tri[i] ?? 0);
    ps.pops = idx.map((i) => ps.pops?.[i] ?? 0);
    if (ps.mi) ps.mi = keepCumulative(ps.mi, idx);
    if (ps.mo) ps.mo = keepCumulative(ps.mo, idx);
  }
}

/**
 * Append one trend sample (settlements, population, cumulative Triumphs) for living players.
 * A sample for a turn already recorded replaces it.
 * @param {CampaignDoc} doc The document.
 * @param {HnrWorldState} world The current state.
 */
export function appendSample(doc, world) {
  const s = doc.series;
  const tri = triumphCounts(doc);
  if (s.turns[s.turns.length - 1] === world.turn) dropLastSample(s);
  const at = s.turns.length;
  s.turns.push(world.turn);
  for (const [pid, st] of Object.entries(world.players)) {
    const ps = paddedSeries(s, pid, at);
    ps.set.push(Object.keys(st.cities || {}).length);
    ps.pop.push(st.population || 0);
    /** @type {number[]} */ (ps.pops).push(st.popScaled || 0);
    ps.tri.push(tri[pid] || 0);
    if (st.mig) pushMigration(ps, st.mig);
  }
  if (s.turns.length > SERIES_CAP) decimateSeries(s, doc.ages.map((a) => a.start));
}

/**
 * The kept samples of a cumulative series that may end early (its companion mod is gone).
 * @param {number[]} arr Cumulative values.
 * @param {number[]} idx Kept sample indices.
 * @returns {number[]} Kept values (a series that ended early stays shorter, aligned from the start).
 */
function keepCumulative(arr, idx) {
  return idx.filter((i) => i < arr.length).map((i) => arr[i]);
}

/**
 * Append a migration reading, padding with the earliest known value when the Emigration mod arrived
 * after recording began (the tallies are cumulative, so padding with it shows no movement).
 * @param {HnrPlayerSeries} ps The player's series (mutated).
 * @param {{i:number, o:number}} mig Cumulative people in and out.
 */
function pushMigration(ps, mig) {
  const mi = (ps.mi = ps.mi || []);
  const mo = (ps.mo = ps.mo || []);
  while (mi.length < ps.set.length - 1) mi.push(mi[mi.length - 1] ?? mig.i);
  while (mo.length < ps.set.length - 1) mo.push(mo[mo.length - 1] ?? mig.o);
  mi.push(mig.i);
  mo.push(mig.o);
}

/**
 * A player's series, created when new and padded to `at` samples (a player first seen late, or a
 * document recorded before scaled population existed).
 * @param {HnrSeries} s The series (mutated).
 * @param {string} pid Player id.
 * @param {number} at Samples every array must hold before the new one.
 * @returns {HnrPlayerSeries} The player's series.
 */
function paddedSeries(s, pid, at) {
  const ps = (s.by[pid] = s.by[pid] || { set: [], pop: [], tri: [], pops: [] });
  const pops = (ps.pops = ps.pops || []);
  while (pops.length < ps.pop.length) pops.push(0);
  while (ps.set.length < at) {
    ps.set.push(0);
    ps.pop.push(0);
    pops.push(0);
    ps.tri.push(ps.tri[ps.tri.length - 1] || 0);
  }
  return ps;
}

/**
 * Remove the newest sample from every array.
 * @param {HnrSeries} s The series (mutated).
 */
function dropLastSample(s) {
  s.turns.pop();
  for (const ps of Object.values(s.by)) {
    if (ps.set.length > s.turns.length) { ps.set.pop(); ps.pop.pop(); ps.tri.pop(); ps.pops?.pop(); }
    if (ps.mi && ps.mi.length > s.turns.length) { ps.mi.pop(); ps.mo?.pop(); }
  }
}

/**
 * Record how the game ended for the local player when a victory or defeat is seen.
 * @param {CampaignDoc} doc The document.
 * @param {HnrEvent[]} events Events just appended.
 * @param {(pid:number) => number} teamOf Team of a player.
 */
export function applyOutcome(doc, events, teamOf) {
  for (const e of events) {
    if (e.k === "victory" && doc.outcome.status !== "victory") {
      const won = e.p >= 0 && teamOf(e.p) === teamOf(doc.local);
      doc.outcome = { status: won ? "victory" : "defeat", victory: e.x || "", name: e.n || "", winner: e.p, turn: e.t };
    } else if (isLocalDefeat(doc, e)) {
      doc.outcome = { status: "defeat", victory: "", name: "", winner: -1, turn: e.t };
    }
  }
}

/**
 * Whether an event is the local player's elimination in a game not yet decided.
 * @param {CampaignDoc} doc The document.
 * @param {HnrEvent} e Event.
 * @returns {boolean} True for a local defeat.
 */
function isLocalDefeat(doc, e) {
  return e.k === "elim" && e.p === doc.local && doc.outcome.status === "in_progress";
}
