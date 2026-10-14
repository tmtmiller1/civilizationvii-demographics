// history-timeline.js
//
// Pure: lay one campaign out on a single game-wide axis for the Timeline graphic. The game's turn
// counter restarts every age, so a position is the turns of every earlier age plus the turn within
// the current one. pack()/unpack() store it compactly with an archived game for the Hall of Fame.
//
// Events are HistoryEvent records with one-letter keys (legend in types/history.d.ts): t turn,
// a age index, k kind, p acting player, q other player, n name, x engine type, d date label.
// The Timeline's own fields reuse the same letters where they carry the same thing.

/** Scaled-population milestones, in people. */
export const POP_MILESTONES = [
  100e3, 250e3, 500e3, 1e6, 2.5e6, 5e6, 10e6, 25e6, 50e6, 100e6, 250e6, 500e6, 1e9
];
/** Most milestones kept; the least important kinds are dropped first. */
export const MARKS_CAP = 36;
/** Milestone kinds by importance (most first). */
const MARK_ORDER = ["victory", "wonder", "religion", "triumph", "capture", "lost", "elim"];

/**
 * @typedef {Object} Timeline
 * @property {number} total Length of the axis in turns.
 * @property {{from:number, len:number, age:string, n:string, d:string, t0:number}[]} ages Age bands
 *   (t0: the age's first game turn, for turn labels).
 * @property {{from:number, to:number, other:number, d:string, a?:number}[]} wars Wars of the local
 *   player (after focusTimeline, also wars between shown rivals, `a` being the first party).
 * @property {{from:number, to:number, stage:number, n:string}[]} crises Crisis stages.
 * @property {{at:number, k:string, p:number, q:number, n:string, x:string, d:string, i?:string}[]} marks
 *   Milestones (`i`: the wonder's or religion's own icon, when it was resolved in game).
 * @property {{at:number, v:number}[]} pops Population milestones reached.
 * @property {{at:number, v:number}[]} curve Scaled population across the game (for the growth curve).
 * @property {{at:number, n:string, x:string, p:number, d:string}[]} disasters Natural disasters on known
 *   lands.
 * @property {{at:number, n:string, d:string, p?:number}[]} founds Settlements the local player founded
 *   (after focusTimeline, also the shown rivals', with their owner `p`).
 * @property {{pid:number, pts:{at:number, v:number}[]}[]} [lines] After focusTimeline: shown rivals'
 *   population.
 * @property {RivalTracks} rivals What the other known civilizations did, for the timeline's civilization
 *   filter.
 * @property {{at:number, i:number, o:number}[]} mig People in from and out to other civilizations per
 *   stretch of the game (Emigration mod only; empty otherwise).
 */

/**
 * @typedef {Object} RivalTracks
 * @property {{at:number, k:string, p:number, q:number, n:string, d:string, i?:string}[]} marks Their
 *   wonders, Triumphs, religions and conquests.
 * @property {{at:number, n:string, d:string, p:number}[]} founds Settlements they founded.
 * @property {{from:number, to:number, a:number, b:number, d:string}[]} wars Wars between two of them.
 * @property {Record<string, {at:number, v:number}[]>} curves Their scaled population, by player id.
 */

/** @typedef {{from:number, len:number}} AgeSpan Start offset and length of an age on the axis. */

/** Crisis stages and wars between other civilizations kept on a timeline (the latest). */
export const CRISES_CAP = 24;
export const RIVAL_WARS_CAP = 60;

/** Per rival: milestones and foundings kept, and points in its population curve. */
export const RIVAL_MARKS_CAP = 12;
export const RIVAL_FOUNDS_CAP = 25;
export const RIVAL_CURVE_POINTS = 24;

/**
 * Resolves the icon of a wonder or religion from its engine type (history-icons.js engineIcon in
 * game; nothing in tests).
 * @typedef {(type:string, kind:string) => string} IconOf
 */

/** Points kept for the population growth curve. */
export const CURVE_POINTS = 60;

/**
 * Start offset and length of every age on the axis.
 * @param {HistoryAge[]} ages
 * @returns {AgeSpan[]}
 */
export function ageSpans(ages) {
  let from = 0;
  return ages.map((age) => {
    const len = Math.max(1, age.end - age.start + 1);
    const span = { from, len };
    from += len;
    return span;
  });
}

/**
 * The span of an age index, falling back to the last age (an event recorded past the ages the
 * document knows) or a unit span for a document without ages.
 * @param {AgeSpan[]} spans
 * @param {number} ageIndex
 * @returns {AgeSpan}
 */
function spanOf(spans, ageIndex) {
  return spans[ageIndex] || spans[spans.length - 1] || { from: 0, len: 1 };
}

/** @param {AgeSpan[]} spans @param {number} ageIndex */
function ageEndOf(spans, ageIndex) {
  const span = spanOf(spans, ageIndex);
  return span.from + span.len;
}

/**
 * Axis position of a turn in an age.
 * @param {AgeSpan[]} spans
 * @param {HistoryAge[]} ages
 * @param {number} ageIndex
 * @param {number} turn Restarts each age.
 * @returns {number}
 */
export function positionOf(spans, ages, ageIndex, turn) {
  const span = spanOf(spans, ageIndex);
  const start = ages[ageIndex]?.start ?? 0;
  return span.from + Math.max(0, Math.min(span.len - 1, turn - start));
}

/**
 * @param {HistoryAge[]} ages
 * @param {AgeSpan[]} spans
 * @param {HistoryEvent[]} events
 * @returns {Timeline["ages"]}
 */
function ageBands(ages, spans, events) {
  return ages.map((age, i) => {
    const open = events.find((event) => event.k === "age" && event.a === i);
    return { ...spans[i], age: age.age, n: open?.n || "", d: open?.d || "", t0: age.start };
  });
}

/**
 * @param {HistoryEvent} event
 * @param {number} local
 */
function otherParty(event, local) {
  if (event.p === local) return event.q ?? -1;
  return event.q === local ? event.p : -1;
}

/**
 * The local player's wars as intervals on the axis.
 * @param {HistoryEvent[]} events
 * @param {number} local
 * @param {(event: HistoryEvent) => number} pos
 * @param {AgeSpan[]} spans Age spans (a war ends with its age).
 * @returns {Timeline["wars"]}
 */
export function warIntervals(events, local, pos, spans) {
  /** @type {Map<number, {from:number, a:number, d:string}>} */
  const open = new Map();
  /** @type {Timeline["wars"]} */
  const out = [];
  const ageEnd = (/** @type {number} */ ageIndex) => ageEndOf(spans, ageIndex);
  const close = (/** @type {number} */ other, /** @type {number} */ to) => {
    const war = open.get(other);
    if (war) out.push({ from: war.from, to: Math.max(to, war.from + 1), other, d: war.d });
    open.delete(other);
  };
  for (const event of events) {
    for (const [other, war] of open) if (event.a !== war.a) close(other, ageEnd(war.a));
    warStep(event, otherParty(event, local), { open, close, pos });
  }
  for (const [other, war] of open) close(other, ageEnd(war.a));
  return out.sort((x, y) => x.from - y.from);
}

/**
 * @param {HistoryEvent} event
 * @param {number} other The other party when the local player is involved, else -1.
 * @param {{open: Map<number, {from:number, a:number, d:string}>, close: (other:number, to:number) => void,
 *   pos: (event: HistoryEvent) => number}} io Open wars and helpers.
 */
function warStep(event, other, io) {
  if (event.k === "war" && other >= 0 && !io.open.has(other)) {
    io.open.set(other, { from: io.pos(event), a: event.a, d: event.d || "" });
  } else if (event.k === "peace" && other >= 0) io.close(other, io.pos(event));
  else if (event.k === "elim" && io.open.has(event.p)) io.close(event.p, io.pos(event));
}

/**
 * Crisis stages as intervals: each stage lasts until the next one or the end of its age.
 * @param {HistoryEvent[]} events
 * @param {(event: HistoryEvent) => number} pos
 * @param {AgeSpan[]} spans
 * @returns {Timeline["crises"]}
 */
export function crisisIntervals(events, pos, spans) {
  // A real game has at most four stages an age; the cap only bounds odd or modded data.
  const list = events.filter((event) => event.k === "crisis").slice(-CRISES_CAP);
  return list.map((event, i) => {
    const next = list[i + 1];
    const to = next && next.a === event.a ? pos(next) : ageEndOf(spans, event.a);
    return { from: pos(event), to: Math.max(to, pos(event) + 1), stage: Number(event.q) || 1, n: event.n || "" };
  });
}

/**
 * The milestone kind of an event for the local player's timeline, or "" when it is not one.
 * @param {HistoryEvent} event
 * @param {number} local
 * @returns {string}
 */
export function markKind(event, local) {
  if (event.k === "victory") return "victory";
  if (event.k === "elim") return "elim";
  if ((event.k === "capture" || event.k === "razed") && event.q === local) return "lost";
  if (event.p !== local) return "";
  return ["wonder", "religion", "triumph", "capture"].includes(event.k) ? event.k : "";
}

/**
 * Milestones, capped by importance and returned in time order.
 * @param {HistoryEvent[]} events
 * @param {number} local
 * @param {(event: HistoryEvent) => number} pos
 * @param {IconOf} [iconOf]
 * @returns {Timeline["marks"]}
 */
export function milestones(events, local, pos, iconOf = () => "") {
  const all = events
    .map((event, i) => ({ event, i, kind: markKind(event, local) }))
    .filter((x) => x.kind)
    .sort((a, b) => MARK_ORDER.indexOf(a.kind) - MARK_ORDER.indexOf(b.kind) || a.i - b.i)
    .slice(0, MARKS_CAP)
    .sort((a, b) => a.i - b.i);
  return all.map(({ event, kind }) => ({
    at: pos(event),
    k: kind,
    p: event.p,
    q: event.q ?? -1,
    n: event.n || "",
    x: event.x || "",
    d: event.d || "",
    i: iconOf(event.x || "", kind)
  }));
}

/** @param {CampaignDoc} doc */
function seriesTurns(doc) {
  return doc.series.turns || [];
}

/** @param {CampaignDoc} doc */
function localSeries(doc) {
  return (doc.series.by || {})[String(doc.local)];
}

/** @param {CampaignDoc} doc */
function localPops(doc) {
  return localSeries(doc)?.pops || [];
}

/**
 * Axis position of every trend sample. Samples carry turns that restart each age, so the age of a
 * sample advances whenever its turn goes back down.
 * @param {CampaignDoc} doc
 * @param {AgeSpan[]} spans
 * @returns {number[]} Position per sample.
 */
export function samplePositions(doc, spans) {
  const turns = seriesTurns(doc);
  let ageIndex = 0;
  return turns.map((turn, i) => {
    if (i > 0 && turn < turns[i - 1]) ageIndex = Math.min(ageIndex + 1, spans.length - 1);
    return positionOf(spans, doc.ages, ageIndex, turn);
  });
}

/**
 * Pick `count` evenly spaced points from a list (first and last included).
 * @template T
 * @param {T[]} all
 * @param {number} count
 * @returns {T[]}
 */
function thin(all, count) {
  return Array.from({ length: count }, (_, i) => all[Math.round((i * (all.length - 1)) / (count - 1))]);
}

/**
 * The local player's scaled population across the game, thinned to CURVE_POINTS points.
 * @param {CampaignDoc} doc
 * @param {AgeSpan[]} spans
 * @returns {Timeline["curve"]}
 */
export function popCurve(doc, spans) {
  const pops = localPops(doc);
  const positions = samplePositions(doc, spans);
  const all = positions.map((at, i) => ({ at, v: pops[i] || 0 }));
  return all.length <= CURVE_POINTS ? all : thin(all, CURVE_POINTS);
}

/**
 * Scaled-population milestones the local player crossed. Samples carry turns that restart each
 * age, so the age of a sample advances whenever its turn goes back down.
 * @param {CampaignDoc} doc
 * @param {AgeSpan[]} spans
 * @returns {Timeline["pops"]}
 */
export function popMilestones(doc, spans) {
  const pops = localPops(doc);
  const turns = seriesTurns(doc);
  /** @type {Timeline["pops"]} */
  const out = [];
  let ageIndex = 0;
  let next = 0;
  for (let i = 0; i < turns.length; i++) {
    if (i > 0 && turns[i] < turns[i - 1]) ageIndex = Math.min(ageIndex + 1, spans.length - 1);
    while (next < POP_MILESTONES.length && (pops[i] || 0) >= POP_MILESTONES[next]) {
      if (i > 0) out.push({ at: positionOf(spans, doc.ages, ageIndex, turns[i]), v: POP_MILESTONES[next] });
      next++;
    }
  }
  return out;
}

/** Stretches the migration lane divides the game into. */
export const MIGRATION_BUCKETS = 40;
/** Natural disasters kept on a timeline (the most recent when there are more). */
export const DISASTERS_CAP = 48;

/** Settlement foundings kept on a timeline (the earliest when there are more). */
export const FOUNDS_CAP = 80;

/**
 * Settlements the local player founded.
 * @param {HistoryEvent[]} events
 * @param {number} local
 * @param {(event: HistoryEvent) => number} pos
 * @returns {Timeline["founds"]}
 */
export function foundings(events, local, pos) {
  return events
    .filter((event) => event.k === "found" && event.p === local)
    .slice(0, FOUNDS_CAP)
    .map((event) => ({ at: pos(event), n: event.n || "", d: event.d || "" }));
}

/**
 * Natural disasters that struck known civilizations' lands.
 * @param {HistoryEvent[]} events
 * @param {(event: HistoryEvent) => number} pos
 * @returns {Timeline["disasters"]}
 */
export function disasterMarks(events, pos) {
  return events
    .filter((event) => event.k === "disaster")
    .slice(-DISASTERS_CAP)
    .map((event) => ({ at: pos(event), n: event.n || "", x: event.x || "", p: event.p, d: event.d || "" }));
}

/**
 * The local player's migration (Emigration mod) as people in and out per stretch of the game,
 * from its cumulative tallies.
 * @param {CampaignDoc} doc
 * @param {AgeSpan[]} spans
 * @param {number} total Axis length.
 * @returns {Timeline["mig"]} Buckets that saw movement.
 */
export function migrationBuckets(doc, spans, total) {
  const series = localSeries(doc);
  const arrived = series?.mi || [];
  const left = series?.mo || [];
  if (arrived.length < 2) return [];
  const positions = samplePositions(doc, spans);
  const size = Math.max(1, total / MIGRATION_BUCKETS);
  /** @type {Map<number, {at:number, i:number, o:number}>} */
  const out = new Map();
  for (let k = 1; k < arrived.length; k++) {
    const bucket = Math.min(MIGRATION_BUCKETS - 1, Math.floor(positions[k] / size));
    const cur = out.get(bucket) || { at: Math.round(bucket * size + size / 2), i: 0, o: 0 };
    cur.i += Math.max(0, arrived[k] - arrived[k - 1]);
    cur.o += Math.max(0, (left[k] ?? 0) - (left[k - 1] ?? 0));
    out.set(bucket, cur);
  }
  return [...out.values()].filter((x) => x.i > 0 || x.o > 0).sort((a, b) => a.at - b.at);
}

/**
 * Wars fought between two civilizations other than the local player, as intervals.
 * @param {HistoryEvent[]} events
 * @param {number} local
 * @param {(event: HistoryEvent) => number} pos
 * @param {AgeSpan[]} spans Age spans (a war ends with its age).
 * @returns {RivalTracks["wars"]}
 */
export function rivalWars(events, local, pos, spans) {
  /** @type {RivalWarIo} */
  const io = { open: new Map(), out: [], pos };
  const ageEnd = (/** @type {number} */ ageIndex) => ageEndOf(spans, ageIndex);
  for (const event of events) {
    for (const [pair, war] of io.open) if (event.a !== war.age) closeRivalWar(io, pair, ageEnd(war.age));
    rivalWarStep(io, event, local);
  }
  for (const [pair, war] of io.open) closeRivalWar(io, pair, ageEnd(war.age));
  return io.out.sort((x, y) => x.from - y.from).slice(-RIVAL_WARS_CAP);
}

/**
 * @typedef {{open: Map<string, {from:number, a:number, b:number, age:number, d:string}>,
 *   out: RivalTracks["wars"], pos: (event: HistoryEvent) => number}} RivalWarIo
 */

/**
 * @param {RivalWarIo} io
 * @param {string} pair
 * @param {number} to
 */
function closeRivalWar(io, pair, to) {
  const war = io.open.get(pair);
  if (war) io.out.push({ from: war.from, to: Math.max(to, war.from + 1), a: war.a, b: war.b, d: war.d });
  io.open.delete(pair);
}

/**
 * @param {RivalWarIo} io
 * @param {HistoryEvent} event
 * @param {number} local
 */
function rivalWarStep(io, event, local) {
  if (event.k === "elim") return closeWarsOf(io, event);
  const other = event.q ?? -1;
  if (!isRivalPair(event.p, other, local)) return;
  const pair = Math.min(event.p, other) + "|" + Math.max(event.p, other);
  if (event.k === "war" && !io.open.has(pair)) {
    io.open.set(pair, { from: io.pos(event), a: event.p, b: other, age: event.a, d: event.d || "" });
  } else if (event.k === "peace") closeRivalWar(io, pair, io.pos(event));
}

/**
 * @param {RivalWarIo} io
 * @param {HistoryEvent} event
 */
function closeWarsOf(io, event) {
  for (const [pair, war] of io.open) {
    if (war.a === event.p || war.b === event.p) closeRivalWar(io, pair, io.pos(event));
  }
}

/**
 * @param {number} first
 * @param {number} second
 * @param {number} local
 */
function isRivalPair(first, second, local) {
  return first >= 0 && second >= 0 && first !== local && second !== local;
}

/**
 * The other known civilizations' own milestones and foundings, capped per civilization.
 * @param {HistoryEvent[]} events
 * @param {number} local
 * @param {(event: HistoryEvent) => number} pos
 * @param {IconOf} [iconOf]
 * @returns {{marks: RivalTracks["marks"], founds: RivalTracks["founds"]}}
 */
export function rivalDeeds(events, local, pos, iconOf = () => "") {
  /** @type {Map<number, {marks: HistoryEvent[], founds: HistoryEvent[]}>} */
  const byPid = new Map();
  events.forEach((event) => {
    if (event.p < 0 || event.p === local) return;
    const slot = byPid.get(event.p) || { marks: [], founds: [] };
    if (event.k === "found") slot.founds.push(event);
    // (a capture from the local player is already its "lost" milestone)
    else if (["wonder", "religion", "triumph"].includes(event.k) || (event.k === "capture" && event.q !== local)) {
      slot.marks.push(event);
    }
    byPid.set(event.p, slot);
  });
  /** @type {RivalTracks["marks"]} */
  const marks = [];
  /** @type {RivalTracks["founds"]} */
  const founds = [];
  for (const slot of byPid.values()) {
    const kept = slot.marks
      .map((event, i) => ({ event, i }))
      .sort((x, y) => MARK_ORDER.indexOf(x.event.k) - MARK_ORDER.indexOf(y.event.k) || x.i - y.i)
      .slice(0, RIVAL_MARKS_CAP);
    for (const { event } of kept) marks.push(rivalMark(event, pos, iconOf));
    for (const event of slot.founds.slice(0, RIVAL_FOUNDS_CAP)) {
      founds.push({ at: pos(event), n: event.n || "", d: event.d || "", p: event.p });
    }
  }
  return { marks: marks.sort((x, y) => x.at - y.at), founds: founds.sort((x, y) => x.at - y.at) };
}

/**
 * @param {HistoryEvent} event
 * @param {(event: HistoryEvent) => number} pos
 * @param {IconOf} iconOf
 * @returns {RivalTracks["marks"][number]}
 */
function rivalMark(event, pos, iconOf) {
  return {
    at: pos(event),
    k: event.k,
    p: event.p,
    q: event.q ?? -1,
    n: event.n || "",
    d: event.d || "",
    i: iconOf(event.x || "", event.k)
  };
}

/**
 * The other known civilizations' scaled population, each thinned to RIVAL_CURVE_POINTS.
 * @param {CampaignDoc} doc
 * @param {AgeSpan[]} spans
 * @param {(pid:number) => boolean} known Whether a civilization may be shown.
 * @returns {RivalTracks["curves"]} By player id.
 */
export function rivalCurves(doc, spans, known) {
  const byPid = doc.series.by || {};
  const positions = samplePositions(doc, spans);
  /** @type {RivalTracks["curves"]} */
  const out = {};
  for (const [pid, series] of Object.entries(byPid)) {
    if (Number(pid) === doc.local || !known(Number(pid)) || !series.pops?.some((v) => v > 0)) continue;
    const all = positions.map((at, i) => ({ at, v: series.pops?.[i] || 0 }));
    out[pid] = all.length <= RIVAL_CURVE_POINTS ? all : thin(all, RIVAL_CURVE_POINTS);
  }
  return out;
}

/**
 * The whole timeline of a live campaign.
 * @param {CampaignDoc} doc
 * @param {(event: HistoryEvent) => boolean} [visible] Spoiler filter for events (default: all).
 * @param {(pid:number) => boolean} [known] Spoiler filter for civilizations (default: all).
 * @param {IconOf} [iconOf] Icon resolver for wonders and religions (default: none).
 * @returns {Timeline}
 */
export function buildTimeline(doc, visible = () => true, known = () => true, iconOf = () => "") {
  const spans = ageSpans(doc.ages);
  const events = doc.events.filter(visible);
  const pos = (/** @type {HistoryEvent} */ event) => positionOf(spans, doc.ages, event.a, event.t);
  const last = spans[spans.length - 1];
  const total = last ? last.from + last.len : 1;
  return {
    total,
    ages: ageBands(doc.ages, spans, doc.events),
    wars: warIntervals(events, doc.local, pos, spans),
    crises: crisisIntervals(events, pos, spans),
    marks: milestones(events, doc.local, pos, iconOf),
    pops: popMilestones(doc, spans),
    curve: popCurve(doc, spans),
    disasters: disasterMarks(events, pos),
    founds: foundings(events, doc.local, pos),
    rivals: {
      ...rivalDeeds(events, doc.local, pos, iconOf),
      wars: rivalWars(events, doc.local, pos, spans),
      curves: rivalCurves(doc, spans, known)
    },
    mig: migrationBuckets(doc, spans, total)
  };
}

/**
 * A position on the timeline, rounded for storage. Positions are percentages of the whole game, so
 * two decimals are finer than a pixel on any screen and take a third of the bytes.
 * @param {number} position
 * @returns {number}
 */
const at2 = (position) => Math.round(Number(position) * 100) / 100;

/**
 * Compact form for an archived record. The one-letter keys and array rows are what the Hall of Fame
 * archive stores, so they stay as they are.
 * @param {Timeline} tl
 * @returns {*}
 */
export function packTimeline(tl) {
  return {
    n: tl.total,
    g: tl.ages.map((age) => [at2(age.from), at2(age.len), age.age, age.n, age.d, age.t0]),
    w: tl.wars.map((war) => [at2(war.from), at2(war.to), war.other, war.d]),
    c: tl.crises.map((stage) => [at2(stage.from), at2(stage.to), stage.stage, stage.n]),
    m: tl.marks.map((mark) => [at2(mark.at), mark.k, mark.p, mark.q, mark.n, mark.d, mark.i || ""]),
    p: tl.pops.map((pop) => [at2(pop.at), pop.v]),
    s: tl.curve.map((point) => [at2(point.at), Math.round(point.v)]),
    z: tl.disasters.map((strike) => [at2(strike.at), strike.n, strike.x, strike.p, strike.d]),
    f: tl.founds.map((found) => [at2(found.at), found.n, found.d]),
    r: packRivals(tl.rivals),
    v: tl.mig.map((bucket) => [at2(bucket.at), Math.round(bucket.i), Math.round(bucket.o)])
  };
}

/** @param {*} value */
const arr = (value) => (Array.isArray(value) ? value : []);

/**
 * Unpack an archived timeline (tolerating a missing or partial one).
 * @param {*} packed
 * @returns {Timeline|null} Timeline, or null when there is none.
 */
export function unpackTimeline(packed) {
  if (!packed || typeof packed !== "object" || !Array.isArray(packed.g)) return null;
  return {
    total: Number(packed.n) || 1,
    ages: arr(packed.g).map((row) =>
      ({ from: row[0], len: row[1], age: row[2], n: row[3] || "", d: row[4] || "", t0: Number(row[5]) || 1 })),
    wars: arr(packed.w).map((row) => ({ from: row[0], to: row[1], other: row[2], d: row[3] || "" })),
    crises: arr(packed.c).map((row) => ({ from: row[0], to: row[1], stage: row[2], n: row[3] || "" })),
    marks: arr(packed.m).map((row) => ({
      at: row[0], k: row[1], p: row[2], q: row[3], n: row[4] || "", x: "", d: row[5] || "", i: row[6] || ""
    })),
    pops: arr(packed.p).map((row) => ({ at: row[0], v: row[1] })),
    curve: arr(packed.s).map((row) => ({ at: row[0], v: row[1] })),
    disasters: arr(packed.z).map((row) =>
      ({ at: row[0], n: row[1] || "", x: row[2] || "", p: Number(row[3]), d: row[4] || "" })),
    founds: arr(packed.f).map((row) => ({ at: row[0], n: row[1] || "", d: row[2] || "" })),
    rivals: unpackRivals(packed.r),
    mig: arr(packed.v).map((row) => ({ at: row[0], i: row[1] || 0, o: row[2] || 0 }))
  };
}

/** @param {RivalTracks} rivals */
function packRivals(rivals) {
  /** @type {Record<string, number[][]>} */
  const curves = {};
  for (const [pid, curve] of Object.entries(rivals.curves)) {
    curves[pid] = curve.map((point) => [at2(point.at), Math.round(point.v)]);
  }
  return {
    m: rivals.marks.map((mark) => [at2(mark.at), mark.k, mark.p, mark.q, mark.n, mark.d, mark.i || ""]),
    f: rivals.founds.map((found) => [at2(found.at), found.n, found.d, found.p]),
    w: rivals.wars.map((war) => [at2(war.from), at2(war.to), war.a, war.b, war.d]),
    s: curves
  };
}

/**
 * Unpack the rival tracks (empty when an older record has none).
 * @param {*} packed
 * @returns {RivalTracks}
 */
function unpackRivals(packed) {
  /** @type {RivalTracks["curves"]} */
  const curves = {};
  const src = packed && typeof packed.s === "object" && packed.s ? packed.s : {};
  for (const [pid, rows] of Object.entries(src)) curves[pid] = arr(rows).map((row) => ({ at: row[0], v: row[1] }));
  return {
    marks: arr(packed?.m).map((row) => ({
      at: row[0], k: row[1], p: Number(row[2]), q: Number(row[3]), n: row[4] || "", d: row[5] || "", i: row[6] || ""
    })),
    founds: arr(packed?.f).map((row) => ({ at: row[0], n: row[1] || "", d: row[2] || "", p: Number(row[3]) })),
    wars: arr(packed?.w).map((row) =>
      ({ from: row[0], to: row[1], a: Number(row[2]), b: Number(row[3]), d: row[4] || "" })),
    curves
  };
}

/**
 * The timeline narrowed to the civilizations picked in its filter: the local player's own lanes
 * when it is picked, and each picked rival's milestones, foundings, wars, disasters on its land and
 * population line folded into the same lanes. The victory, ages and crises always stay; an
 * elimination stays when the fallen civilization is picked.
 * @param {Timeline} tl
 * @param {number} local
 * @param {Set<number>} shown Picked civilizations.
 * @returns {Timeline}
 */
export function focusTimeline(tl, local, shown) {
  const mine = shown.has(local);
  const rivals = tl.rivals;
  const keepMark = (/** @type {Timeline["marks"][number]} */ mark) => {
    if (mark.k === "victory") return true;
    return mark.k === "elim" ? shown.has(mark.p) : mine;
  };
  const rivalWar = (/** @type {RivalTracks["wars"][number]} */ war) =>
    ({ from: war.from, to: war.to, other: war.b, a: war.a, d: war.d });
  return {
    ...tl,
    wars: [
      ...(mine ? tl.wars.map((war) => ({ ...war, a: local })) : []),
      ...rivals.wars.filter((war) => shown.has(war.a) || shown.has(war.b)).map(rivalWar)
    ].sort((x, y) => x.from - y.from),
    marks: [
      ...tl.marks.filter(keepMark),
      ...rivals.marks.filter((mark) => shown.has(mark.p)).map((mark) => ({ ...mark, x: "" }))
    ].sort((x, y) => x.at - y.at),
    founds: [
      ...(mine ? tl.founds.map((found) => ({ ...found, p: local })) : []),
      ...rivals.founds.filter((found) => shown.has(found.p))
    ].sort((x, y) => x.at - y.at),
    disasters: tl.disasters.filter((strike) => shown.has(strike.p)),
    mig: mine ? tl.mig : [],
    pops: mine ? tl.pops : [],
    curve: mine ? tl.curve : [],
    lines: Object.entries(rivals.curves)
      .filter(([pid]) => shown.has(Number(pid)))
      .map(([pid, pts]) => ({ pid: Number(pid), pts }))
  };
}

/**
 * Every civilization the timeline can show, the local player first.
 * @param {Timeline} tl
 * @param {number} local
 * @returns {number[]}
 */
export function timelineCivs(tl, local) {
  const rivals = tl.rivals;
  const ids = new Set([
    ...tl.wars.map((war) => war.other),
    ...rivals.wars.flatMap((war) => [war.a, war.b]),
    ...rivals.marks.map((mark) => mark.p),
    ...rivals.founds.map((found) => found.p),
    ...Object.keys(rivals.curves).map(Number),
    ...tl.disasters.map((strike) => strike.p)
  ]);
  ids.delete(local);
  return [local, ...[...ids].filter((pid) => pid >= 0).sort((a, b) => a - b)];
}
