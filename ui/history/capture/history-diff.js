// history-diff.js
//
// Pure: compare two HnrWorldStates and return the chronicle events that explain the change;
// engine-derived names come in through a Namer. The first state is a baseline and produces no
// events, and across an age change only the age, civilization changes and eliminations are
// reported, since the engine ends every war and rebuilds Triumph lists at the transition.

/**
 * Engine-name resolvers injected by the caller.
 * @typedef {Object} Namer
 * @property {(type:string) => string} wonder LOC tag for a wonder type.
 * @property {(type:string) => string} triumph LOC tag for a Legacy (Triumph) type.
 * @property {(type:string) => string} civ LOC tag for a civilization type.
 * @property {(type:string) => string} age LOC tag for an age type.
 * @property {(type:string) => string} victory LOC tag for a victory type.
 * @property {(team:number) => number} teamPlayer First major player on a team, or -1.
 */

/**
 * @param {HnrWorldState} s A state.
 * @returns {string[]} Player id keys.
 */
const ids = (s) => Object.keys(s.players);

/**
 * Build an event stamped with the new state's turn, age index and date.
 * @param {HnrWorldState} next The newer state.
 * @param {number} ageIdx Index of the current age.
 * @param {Omit<HnrEvent, "t"|"a"|"d">} fields The event body.
 * @returns {HnrEvent} The event.
 */
function stamp(next, ageIdx, fields) {
  /** @type {HnrEvent} */
  const e = { t: next.turn, a: ageIdx, ...fields };
  if (next.date) e.d = next.date;
  return e;
}

/**
 * Settlement ownership across all players: "x,y" -> { owner, name }.
 * @param {HnrWorldState} s The state.
 * @returns {Map<string, {owner:number, name:string}>} Ownership map.
 */
export function ownership(s) {
  const map = new Map();
  for (const pid of ids(s)) {
    for (const [loc, name] of Object.entries(s.players[pid].cities || {})) {
      map.set(loc, { owner: Number(pid), name });
    }
  }
  return map;
}

/**
 * Founding, capture and razing events.
 * @param {HnrWorldState} prev Older state.
 * @param {HnrWorldState} next Newer state.
 * @param {number} ageIdx Age index.
 * @returns {HnrEvent[]} Events.
 */
export function diffCities(prev, next, ageIdx) {
  const before = ownership(prev);
  const after = ownership(next);
  /** @type {HnrEvent[]} */
  const out = [];
  for (const [loc, cur] of after) {
    const old = before.get(loc);
    if (!old) out.push(stamp(next, ageIdx, { k: "found", p: cur.owner, n: cur.name }));
    else if (old.owner !== cur.owner) out.push(stamp(next, ageIdx, { k: "capture", p: cur.owner, q: old.owner, n: cur.name }));
  }
  for (const [loc, old] of before) {
    if (!after.has(loc)) out.push(stamp(next, ageIdx, { k: "razed", p: -1, q: old.owner, n: old.name }));
  }
  return out;
}

/**
 * First-completion wonder events.
 * @param {HnrWorldState} prev Older state.
 * @param {HnrWorldState} next Newer state.
 * @param {number} ageIdx Age index.
 * @param {Namer} names Name resolvers.
 * @returns {HnrEvent[]} Events.
 */
export function diffWonders(prev, next, ageIdx, names) {
  const seen = new Set(ids(prev).flatMap((pid) => prev.players[pid].wonders || []));
  /** @type {HnrEvent[]} */
  const out = [];
  for (const pid of ids(next)) {
    for (const w of next.players[pid].wonders || []) {
      if (seen.has(w)) continue;
      seen.add(w);
      out.push(stamp(next, ageIdx, { k: "wonder", p: Number(pid), x: w, n: names.wonder(w) }));
    }
  }
  return out;
}

/**
 * Newly earned Triumphs.
 * @param {HnrWorldState} prev Older state.
 * @param {HnrWorldState} next Newer state.
 * @param {number} ageIdx Age index.
 * @param {Namer} names Name resolvers.
 * @returns {HnrEvent[]} Events.
 */
export function diffTriumphs(prev, next, ageIdx, names) {
  /** @type {HnrEvent[]} */
  const out = [];
  for (const pid of ids(next)) {
    const had = new Set(prev.players[pid]?.triumphs || []);
    for (const x of next.players[pid].triumphs || []) {
      if (!had.has(x)) out.push(stamp(next, ageIdx, { k: "triumph", p: Number(pid), x, n: names.triumph(x) }));
    }
  }
  return out;
}

/**
 * Religions founded.
 * @param {HnrWorldState} prev Older state.
 * @param {HnrWorldState} next Newer state.
 * @param {number} ageIdx Age index.
 * @returns {HnrEvent[]} Events.
 */
export function diffReligions(prev, next, ageIdx) {
  return ids(next)
    .filter((pid) => next.players[pid].religion && !prev.players[pid]?.religion)
    .map((pid) => stamp(next, ageIdx, { k: "religion", p: Number(pid), n: next.players[pid].religion, x: next.players[pid].religionType || "" }));
}

/**
 * Unordered war pairs "a:b" (a < b) in a state.
 * @param {HnrWorldState} s The state.
 * @returns {Set<string>} Pairs.
 */
export function warPairs(s) {
  const out = new Set();
  for (const pid of ids(s)) {
    for (const q of s.players[pid].wars || []) {
      const a = Math.min(Number(pid), q);
      const b = Math.max(Number(pid), q);
      out.add(a + ":" + b);
    }
  }
  return out;
}

/**
 * Wars that broke out and wars that ended in peace (not by elimination).
 * @param {HnrWorldState} prev Older state.
 * @param {HnrWorldState} next Newer state.
 * @param {number} ageIdx Age index.
 * @returns {HnrEvent[]} Events.
 */
export function diffWars(prev, next, ageIdx) {
  const before = warPairs(prev);
  const after = warPairs(next);
  /** @type {HnrEvent[]} */
  const out = [];
  const alive = (/** @type {number} */ id) => !!next.players[String(id)]?.alive;
  for (const pair of after) {
    if (before.has(pair)) continue;
    const [p, q] = pair.split(":").map(Number);
    out.push(stamp(next, ageIdx, { k: "war", p, q }));
  }
  for (const pair of before) {
    if (after.has(pair)) continue;
    const [p, q] = pair.split(":").map(Number);
    if (alive(p) && alive(q)) out.push(stamp(next, ageIdx, { k: "peace", p, q }));
  }
  return out;
}

/**
 * Eliminations and first contacts with the local player.
 * @param {HnrWorldState} prev Older state.
 * @param {HnrWorldState} next Newer state.
 * @param {number} ageIdx Age index.
 * @param {number} local Local player id.
 * @returns {HnrEvent[]} Events.
 */
export function diffPeople(prev, next, ageIdx, local) {
  /** @type {HnrEvent[]} */
  const out = [];
  for (const pid of ids(next)) {
    const was = prev.players[pid];
    const now = next.players[pid];
    if (was?.alive && !now.alive) out.push(stamp(next, ageIdx, { k: "elim", p: Number(pid) }));
    if (Number(pid) !== local && was && !was.met && now.met) {
      out.push(stamp(next, ageIdx, { k: "met", p: Number(pid), q: local }));
    }
  }
  return out;
}

/**
 * Newly claimed victories.
 * @param {HnrWorldState} prev Older state.
 * @param {HnrWorldState} next Newer state.
 * @param {number} ageIdx Age index.
 * @param {Namer} names Name resolvers.
 * @returns {HnrEvent[]} Events.
 */
export function diffVictories(prev, next, ageIdx, names) {
  const had = new Set(prev.victories || []);
  return (next.victories || [])
    .filter((v) => !had.has(v))
    .map((v) => {
      const [team, type] = v.split(":");
      return stamp(next, ageIdx, { k: "victory", p: names.teamPlayer(Number(team)), x: type, n: names.victory(type) });
    });
}

/**
 * Age change: the new age plus every living civilization's new identity.
 * @param {HnrWorldState} prev Older state.
 * @param {HnrWorldState} next Newer state.
 * @param {number} ageIdx Index of the new age.
 * @param {Namer} names Name resolvers.
 * @returns {HnrEvent[]} Events.
 */
export function diffAge(prev, next, ageIdx, names) {
  /** @type {HnrEvent[]} */
  const out = [stamp(next, ageIdx, { k: "age", p: -1, x: next.age, n: names.age(next.age) })];
  for (const pid of ids(next)) {
    const now = next.players[pid];
    const was = prev.players[pid];
    if (now.alive && now.civ && was && was.civ !== now.civ) {
      out.push(stamp(next, ageIdx, { k: "civ", p: Number(pid), x: now.civ, n: names.civ(now.civ) }));
    }
  }
  return out;
}

/**
 * Every event between two states.
 * @param {HnrWorldState|null} prev Older state, or null for the first sample.
 * @param {HnrWorldState} next Newer state.
 * @param {{ageIdx:number, local:number, names:Namer}} ctx Context.
 * @returns {HnrEvent[]} Events, in a stable order.
 */
export function diffWorld(prev, next, ctx) {
  if (!prev) return [];
  const { ageIdx, local, names } = ctx;
  if (prev.age !== next.age) {
    return [...diffAge(prev, next, ageIdx, names), ...diffPeople(prev, next, ageIdx, local).filter((e) => e.k === "elim")];
  }
  return [
    ...diffCities(prev, next, ageIdx),
    ...diffWonders(prev, next, ageIdx, names),
    ...diffReligions(prev, next, ageIdx),
    ...diffTriumphs(prev, next, ageIdx, names),
    ...diffWars(prev, next, ageIdx),
    ...diffPeople(prev, next, ageIdx, local),
    ...diffVictories(prev, next, ageIdx, names)
  ];
}
