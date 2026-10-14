// history-campaign.js
//
// Pure operations on the per-save CampaignDoc: create, normalize a loaded blob, track ages and the
// player roster (with each player's civilization per age), append chronicle events and trend
// samples under fixed caps, and record the outcome. history-capture.js feeds it; the views read it.

export const CAMPAIGN_VERSION = 1;
/** Maximum chronicle events kept per campaign. */
export const EVENTS_CAP = 2000;
/** Maximum trend samples kept per campaign. */
export const SERIES_CAP = 360;

/**
 * Event kinds from least to most important. When the chronicle is over its cap, the oldest events
 * of the least important kind still present are dropped first.
 * @type {HistoryEventKind[]}
 */
export const DROP_ORDER = ["met", "found", "peace", "war", "razed", "capture", "religion", "triumph", "wonder"];

/**
 * A fresh document.
 * @param {{id:string, seed:number, now:number, setup:HistorySetup, local:number}} init
 * @returns {CampaignDoc}
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
 * @param {*} doc Parsed JSON.
 * @returns {boolean}
 */
export function isCampaign(doc) {
  return !!(
    doc &&
    typeof doc === "object" &&
    doc.v === CAMPAIGN_VERSION &&
    typeof doc.id === "string" &&
    doc.players &&
    typeof doc.players === "object" &&
    Array.isArray(doc.ages) &&
    Array.isArray(doc.events) &&
    doc.series &&
    Array.isArray(doc.series.turns)
  );
}

/**
 * Index of the age in the document, appending it when new.
 * @param {CampaignDoc} doc
 * @param {string} age
 * @param {number} turn
 * @returns {number}
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
 * @param {CampaignDoc} doc
 * @param {number} pid
 * @param {Identity} id
 * @param {{age:string, turn:number}} at Where in the game this was read.
 */
export function upsertPlayer(doc, pid, id, at) {
  const key = String(pid);
  let player = doc.players[key];
  if (!player) {
    player = { leader: id.leader, leaderName: id.leaderName, civs: [], human: id.human, color: id.color, elim: 0 };
    doc.players[key] = player;
  }
  if (id.color) player.color = id.color;
  if (id.color2) player.color2 = id.color2;
  const last = player.civs[player.civs.length - 1];
  if (id.civ && (!last || last.civ !== id.civ || last.age !== at.age)) {
    player.civs.push({ age: at.age, civ: id.civ, name: id.civName, from: at.turn });
  }
}

/**
 * Remove events until the chronicle fits EVENTS_CAP, oldest of the least important kind first.
 * @param {HistoryEvent[]} events Mutated.
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
 * @param {CampaignDoc} doc
 * @param {HistoryEvent[]} events
 */
export function appendEvents(doc, events) {
  for (const event of events) {
    doc.events.push(event);
    if (event.k === "elim" && doc.players[String(event.p)]) doc.players[String(event.p)].elim = event.t;
  }
  trimEvents(doc.events);
}

/**
 * Triumphs earned so far by each player, counted from the chronicle.
 * @param {CampaignDoc} doc
 * @returns {Record<string, number>} Player id -> count.
 */
export function triumphCounts(doc) {
  /** @type {Record<string, number>} */
  const fromEvents = {};
  for (const event of doc.events) {
    if (event.k === "triumph") fromEvents[String(event.p)] = (fromEvents[String(event.p)] || 0) + 1;
  }
  /** @type {Record<string, number>} */
  const held = {};
  for (const byPid of Object.values(doc.tri || {})) {
    for (const [pid, count] of Object.entries(byPid)) held[pid] = (held[pid] || 0) + count;
  }
  const out = { ...fromEvents };
  for (const [pid, count] of Object.entries(held)) out[pid] = Math.max(count, fromEvents[pid] || 0);
  return out;
}

/**
 * Remember how many Triumphs each player holds in the current age. The engine's list is the
 * truth (it includes Triumphs earned before this mod was installed); it only ever grows within
 * an age and is rebuilt at the next age, so the per-age maximum is kept.
 * @param {CampaignDoc} doc Mutated.
 * @param {number} ageIdx
 * @param {HistoryWorldState} world
 */
export function noteTriumphs(doc, ageIdx, world) {
  /** @type {Record<string, Record<string, number>>} */
  const tri = (doc.tri = doc.tri || {});
  /** @type {Record<string, number>} */
  const age = (tri[String(ageIdx)] = tri[String(ageIdx)] || {});
  for (const [pid, st] of Object.entries(world.players)) {
    const count = (st.triumphs || []).length;
    if (count > (age[pid] || 0)) age[pid] = count;
  }
}

/**
 * Keep every other sample, but always the newest one and the first sample of each age.
 * @param {HistorySeries} series Mutated.
 * @param {number[]} keepTurns Turns that must survive (age starts).
 */
export function decimateSeries(series, keepTurns) {
  const keep = new Set(keepTurns);
  const last = series.turns.length - 1;
  const idx = series.turns.map((turn, i) => i).filter((i) => i % 2 === 0 || i === last || keep.has(series.turns[i]));
  series.turns = idx.map((i) => series.turns[i]);
  for (const ps of Object.values(series.by)) {
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
 * @param {CampaignDoc} doc
 * @param {HistoryWorldState} world
 */
export function appendSample(doc, world) {
  const series = doc.series;
  const tri = triumphCounts(doc);
  if (series.turns[series.turns.length - 1] === world.turn) dropLastSample(series);
  const at = series.turns.length;
  series.turns.push(world.turn);
  for (const [pid, st] of Object.entries(world.players)) {
    const ps = paddedSeries(series, pid, at);
    ps.set.push(Object.keys(st.cities || {}).length);
    ps.pop.push(st.population || 0);
    /** @type {number[]} */ (ps.pops).push(st.popScaled || 0);
    ps.tri.push(tri[pid] || 0);
    if (st.mig) pushMigration(ps, st.mig);
  }
  if (series.turns.length > SERIES_CAP) decimateSeries(series, doc.ages.map((a) => a.start));
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
 * @param {HistoryPlayerSeries} ps Mutated.
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
 * @param {HistorySeries} series Mutated.
 * @param {string} pid
 * @param {number} at Samples every array must hold before the new one.
 * @returns {HistoryPlayerSeries}
 */
function paddedSeries(series, pid, at) {
  const ps = (series.by[pid] = series.by[pid] || { set: [], pop: [], tri: [], pops: [] });
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

/** @param {HistorySeries} series Mutated. */
function dropLastSample(series) {
  series.turns.pop();
  for (const ps of Object.values(series.by)) {
    if (ps.set.length > series.turns.length) {
      ps.set.pop();
      ps.pop.pop();
      ps.tri.pop();
      ps.pops?.pop();
    }
    if (ps.mi && ps.mi.length > series.turns.length) {
      ps.mi.pop();
      ps.mo?.pop();
    }
  }
}

/**
 * Record how the game ended for the local player when a victory or defeat is seen.
 * @param {CampaignDoc} doc
 * @param {HistoryEvent[]} events Events just appended.
 * @param {(pid:number) => number} teamOf Team of a player.
 */
export function applyOutcome(doc, events, teamOf) {
  for (const event of events) {
    if (event.k === "victory" && doc.outcome.status !== "victory") {
      const won = event.p >= 0 && teamOf(event.p) === teamOf(doc.local);
      doc.outcome = {
        status: won ? "victory" : "defeat",
        victory: event.x || "",
        name: event.n || "",
        winner: event.p,
        turn: event.t
      };
    } else if (isLocalDefeat(doc, event)) {
      doc.outcome = { status: "defeat", victory: "", name: "", winner: -1, turn: event.t };
    }
  }
}

/**
 * @param {CampaignDoc} doc
 * @param {HistoryEvent} event
 */
function isLocalDefeat(doc, event) {
  return event.k === "elim" && event.p === doc.local && doc.outcome.status === "in_progress";
}
