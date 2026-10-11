// history-diff.js
//
// Pure: compare two HistoryWorldStates and return the chronicle events that explain the change;
// engine-derived names come in through a Namer. The first state is a baseline and produces no
// events, and across an age change only the age, civilization changes and eliminations are
// reported, since the engine ends every war and rebuilds Triumph lists at the transition.
//
// Chronicle event records (HistoryEvent) keep one-letter keys because every event is stored in the
// save, and long keys would grow it for nothing. The keys:
//   t turn · a age index into CampaignDoc.ages · k kind · p acting player · q other player
//   n display name (LOC tag or literal text) · x engine type string · d date label at the time

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
 * @param {HistoryWorldState} state
 * @returns {string[]} Player id keys.
 */
const ids = (state) => Object.keys(state.players);

/**
 * An event stamped with the new state's turn, age index and date.
 * @param {HistoryWorldState} next
 * @param {number} ageIdx
 * @param {Omit<HistoryEvent, "t"|"a"|"d">} fields The event body.
 * @returns {HistoryEvent}
 */
function stamp(next, ageIdx, fields) {
  /** @type {HistoryEvent} */
  const event = { t: next.turn, a: ageIdx, ...fields };
  if (next.date) event.d = next.date;
  return event;
}

/**
 * Settlement ownership across all players: "x,y" -> { owner, name }.
 * @param {HistoryWorldState} state
 * @returns {Map<string, {owner:number, name:string}>}
 */
export function ownership(state) {
  const map = new Map();
  for (const pid of ids(state)) {
    for (const [loc, name] of Object.entries(state.players[pid].cities || {})) {
      map.set(loc, { owner: Number(pid), name });
    }
  }
  return map;
}

/**
 * Founding, capture and razing events.
 * @param {HistoryWorldState} prev
 * @param {HistoryWorldState} next
 * @param {number} ageIdx
 * @returns {HistoryEvent[]}
 */
export function diffCities(prev, next, ageIdx) {
  const before = ownership(prev);
  const after = ownership(next);
  /** @type {HistoryEvent[]} */
  const out = [];
  for (const [loc, cur] of after) {
    const old = before.get(loc);
    if (!old) out.push(stamp(next, ageIdx, { k: "found", p: cur.owner, n: cur.name }));
    else if (old.owner !== cur.owner) {
      out.push(stamp(next, ageIdx, { k: "capture", p: cur.owner, q: old.owner, n: cur.name }));
    }
  }
  for (const [loc, old] of before) {
    if (!after.has(loc)) out.push(stamp(next, ageIdx, { k: "razed", p: -1, q: old.owner, n: old.name }));
  }
  return out;
}

/**
 * First-completion wonder events.
 * @param {HistoryWorldState} prev
 * @param {HistoryWorldState} next
 * @param {number} ageIdx
 * @param {Namer} names
 * @returns {HistoryEvent[]}
 */
export function diffWonders(prev, next, ageIdx, names) {
  const seen = new Set(ids(prev).flatMap((pid) => prev.players[pid].wonders || []));
  /** @type {HistoryEvent[]} */
  const out = [];
  for (const pid of ids(next)) {
    for (const wonder of next.players[pid].wonders || []) {
      if (seen.has(wonder)) continue;
      seen.add(wonder);
      out.push(stamp(next, ageIdx, { k: "wonder", p: Number(pid), x: wonder, n: names.wonder(wonder) }));
    }
  }
  return out;
}

/**
 * Newly earned Triumphs.
 * @param {HistoryWorldState} prev
 * @param {HistoryWorldState} next
 * @param {number} ageIdx
 * @param {Namer} names
 * @returns {HistoryEvent[]}
 */
export function diffTriumphs(prev, next, ageIdx, names) {
  /** @type {HistoryEvent[]} */
  const out = [];
  for (const pid of ids(next)) {
    const had = new Set(prev.players[pid]?.triumphs || []);
    for (const triumph of next.players[pid].triumphs || []) {
      if (had.has(triumph)) continue;
      out.push(stamp(next, ageIdx, { k: "triumph", p: Number(pid), x: triumph, n: names.triumph(triumph) }));
    }
  }
  return out;
}

/**
 * Religions founded.
 * @param {HistoryWorldState} prev
 * @param {HistoryWorldState} next
 * @param {number} ageIdx
 * @returns {HistoryEvent[]}
 */
export function diffReligions(prev, next, ageIdx) {
  return ids(next)
    .filter((pid) => next.players[pid].religion && !prev.players[pid]?.religion)
    .map((pid) => {
      const player = next.players[pid];
      return stamp(next, ageIdx, { k: "religion", p: Number(pid), n: player.religion, x: player.religionType || "" });
    });
}

/**
 * Unordered war pairs "a:b" (a < b) in a state.
 * @param {HistoryWorldState} state
 * @returns {Set<string>}
 */
export function warPairs(state) {
  const out = new Set();
  for (const pid of ids(state)) {
    for (const enemy of state.players[pid].wars || []) {
      const low = Math.min(Number(pid), enemy);
      const high = Math.max(Number(pid), enemy);
      out.add(low + ":" + high);
    }
  }
  return out;
}

/**
 * Wars that broke out and wars that ended in peace (not by elimination).
 * @param {HistoryWorldState} prev
 * @param {HistoryWorldState} next
 * @param {number} ageIdx
 * @returns {HistoryEvent[]}
 */
export function diffWars(prev, next, ageIdx) {
  const before = warPairs(prev);
  const after = warPairs(next);
  /** @type {HistoryEvent[]} */
  const out = [];
  const alive = (/** @type {number} */ id) => !!next.players[String(id)]?.alive;
  for (const pair of after) {
    if (before.has(pair)) continue;
    const [first, second] = pair.split(":").map(Number);
    out.push(stamp(next, ageIdx, { k: "war", p: first, q: second }));
  }
  for (const pair of before) {
    if (after.has(pair)) continue;
    const [first, second] = pair.split(":").map(Number);
    if (alive(first) && alive(second)) out.push(stamp(next, ageIdx, { k: "peace", p: first, q: second }));
  }
  return out;
}

/**
 * Eliminations and first contacts with the local player.
 * @param {HistoryWorldState} prev
 * @param {HistoryWorldState} next
 * @param {number} ageIdx
 * @param {number} local
 * @returns {HistoryEvent[]}
 */
export function diffPeople(prev, next, ageIdx, local) {
  /** @type {HistoryEvent[]} */
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
 * @param {HistoryWorldState} prev
 * @param {HistoryWorldState} next
 * @param {number} ageIdx
 * @param {Namer} names
 * @returns {HistoryEvent[]}
 */
export function diffVictories(prev, next, ageIdx, names) {
  const had = new Set(prev.victories || []);
  return (next.victories || [])
    .filter((v) => !had.has(v))
    .map((claim) => {
      const [team, type] = claim.split(":");
      const winner = names.teamPlayer(Number(team));
      return stamp(next, ageIdx, { k: "victory", p: winner, x: type, n: names.victory(type) });
    });
}

/**
 * Age change: the new age plus every living civilization's new identity.
 * @param {HistoryWorldState} prev
 * @param {HistoryWorldState} next
 * @param {number} ageIdx Index of the new age.
 * @param {Namer} names
 * @returns {HistoryEvent[]}
 */
export function diffAge(prev, next, ageIdx, names) {
  /** @type {HistoryEvent[]} */
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
 * @param {HistoryWorldState|null} prev Older state, or null for the first sample.
 * @param {HistoryWorldState} next
 * @param {{ageIdx:number, local:number, names:Namer}} ctx
 * @returns {HistoryEvent[]} Events, in a stable order.
 */
export function diffWorld(prev, next, ctx) {
  if (!prev) return [];
  const { ageIdx, local, names } = ctx;
  if (prev.age !== next.age) {
    const eliminations = diffPeople(prev, next, ageIdx, local).filter((event) => event.k === "elim");
    return [...diffAge(prev, next, ageIdx, names), ...eliminations];
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
