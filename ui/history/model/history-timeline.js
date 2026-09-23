// history-timeline.js
//
// Pure: lay one campaign out on a single game-wide axis for the Timeline graphic. The game's turn
// counter restarts every age, so a position is the turns of every earlier age plus the turn within
// the current one. pack()/unpack() store it compactly with an archived game for the Hall of Fame.

/** Scaled-population milestones, in people. */
export const POP_MILESTONES = [100e3, 250e3, 500e3, 1e6, 2.5e6, 5e6, 10e6, 25e6, 50e6, 100e6, 250e6, 500e6, 1e9];
/** Most milestones kept; the least important kinds are dropped first. */
export const MARKS_CAP = 36;
/** Milestone kinds by importance (most first). */
const MARK_ORDER = ["victory", "wonder", "religion", "triumph", "capture", "lost", "elim"];

/**
 * @typedef {Object} Timeline
 * @property {number} total Length of the axis in turns.
 * @property {{from:number, len:number, age:string, n:string, d:string, t0:number}[]} ages Age bands (t0: the
 *   age's first game turn, for turn labels).
 * @property {{from:number, to:number, other:number, d:string, a?:number}[]} wars Wars of the local player (after
 *   focusTimeline, also wars between shown rivals, `a` being the first party).
 * @property {{from:number, to:number, stage:number, n:string}[]} crises Crisis stages.
 * @property {{at:number, k:string, p:number, q:number, n:string, x:string, d:string, i?:string}[]} marks Milestones
 *   (`i`: the wonder's or religion's own icon, when it was resolved in game).
 * @property {{at:number, v:number}[]} pops Population milestones reached.
 * @property {{at:number, v:number}[]} curve Scaled population across the game (for the growth curve).
 * @property {{at:number, n:string, x:string, p:number, d:string}[]} disasters Natural disasters on known lands.
 * @property {{at:number, n:string, d:string, p?:number}[]} founds Settlements the local player founded (after
 *   focusTimeline, also the shown rivals', with their owner `p`).
 * @property {{pid:number, pts:{at:number, v:number}[]}[]} [lines] After focusTimeline: shown rivals' population.
 * @property {RivalTracks} rivals What the other known civilizations did, for the timeline's civilization filter.
 * @property {{at:number, i:number, o:number}[]} mig People in from and out to other civilizations per stretch
 *   of the game (Emigration mod only; empty otherwise).
 */

/**
 * @typedef {Object} RivalTracks
 * @property {{at:number, k:string, p:number, q:number, n:string, d:string, i?:string}[]} marks Their wonders, Triumphs,
 *   religions and conquests.
 * @property {{at:number, n:string, d:string, p:number}[]} founds Settlements they founded.
 * @property {{from:number, to:number, a:number, b:number, d:string}[]} wars Wars between two of them.
 * @property {Record<string, {at:number, v:number}[]>} curves Their scaled population, by player id.
 */

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
 * @param {HnrAge[]} ages Ages of the campaign.
 * @returns {{from:number, len:number}[]} Spans.
 */
export function ageSpans(ages) {
  let from = 0;
  return ages.map((a) => {
    const len = Math.max(1, a.end - a.start + 1);
    const span = { from, len };
    from += len;
    return span;
  });
}

/**
 * The span of an age index, falling back to the last age (an event recorded past the ages the
 * document knows) or a unit span for a document without ages.
 * @param {{from:number, len:number}[]} spans Age spans.
 * @param {number} a Age index.
 * @returns {{from:number, len:number}} Span.
 */
function spanOf(spans, a) {
  return spans[a] || spans[spans.length - 1] || { from: 0, len: 1 };
}

/**
 * Axis position of the end of an age.
 * @param {{from:number, len:number}[]} spans Age spans.
 * @param {number} a Age index.
 * @returns {number} Position.
 */
function ageEndOf(spans, a) {
  const s = spanOf(spans, a);
  return s.from + s.len;
}

/**
 * Axis position of a turn in an age.
 * @param {{from:number, len:number}[]} spans Age spans.
 * @param {HnrAge[]} ages Ages.
 * @param {number} a Age index.
 * @param {number} t Turn (restarts each age).
 * @returns {number} Position.
 */
export function positionOf(spans, ages, a, t) {
  const s = spanOf(spans, a);
  const start = ages[a]?.start ?? 0;
  return s.from + Math.max(0, Math.min(s.len - 1, t - start));
}

/**
 * Age bands, named and dated from each age's opening event.
 * @param {HnrAge[]} ages Ages.
 * @param {{from:number, len:number}[]} spans Spans.
 * @param {HnrEvent[]} events Events.
 * @returns {Timeline["ages"]} Bands.
 */
function ageBands(ages, spans, events) {
  return ages.map((a, i) => {
    const open = events.find((e) => e.k === "age" && e.a === i);
    return { ...spans[i], age: a.age, n: open?.n || "", d: open?.d || "", t0: a.start };
  });
}

/**
 * The other party of an event involving the local player, or -1.
 * @param {HnrEvent} e Event.
 * @param {number} local Local player id.
 * @returns {number} Player id.
 */
function otherParty(e, local) {
  if (e.p === local) return e.q ?? -1;
  return e.q === local ? e.p : -1;
}

/**
 * The local player's wars as intervals on the axis.
 * @param {HnrEvent[]} events Events.
 * @param {number} local Local player id.
 * @param {(e: HnrEvent) => number} pos Position of an event.
 * @param {{from:number, len:number}[]} spans Age spans (a war ends with its age).
 * @returns {Timeline["wars"]} Wars.
 */
export function warIntervals(events, local, pos, spans) {
  /** @type {Map<number, {from:number, a:number, d:string}>} */
  const open = new Map();
  /** @type {Timeline["wars"]} */
  const out = [];
  const ageEnd = (/** @type {number} */ a) => ageEndOf(spans, a);
  const close = (/** @type {number} */ other, /** @type {number} */ to) => {
    const w = open.get(other);
    if (w) out.push({ from: w.from, to: Math.max(to, w.from + 1), other, d: w.d });
    open.delete(other);
  };
  for (const e of events) {
    for (const [other, w] of open) if (e.a !== w.a) close(other, ageEnd(w.a));
    warStep(e, otherParty(e, local), { open, close, pos });
  }
  for (const [other, w] of open) close(other, ageEnd(w.a));
  return out.sort((x, y) => x.from - y.from);
}

/**
 * Apply one event to the open wars.
 * @param {HnrEvent} e Event.
 * @param {number} other The other party when the local player is involved, else -1.
 * @param {{open: Map<number, {from:number, a:number, d:string}>, close: (o:number, to:number) => void,
 *   pos: (e: HnrEvent) => number}} io Open wars and helpers.
 */
function warStep(e, other, io) {
  if (e.k === "war" && other >= 0 && !io.open.has(other)) io.open.set(other, { from: io.pos(e), a: e.a, d: e.d || "" });
  else if (e.k === "peace" && other >= 0) io.close(other, io.pos(e));
  else if (e.k === "elim" && io.open.has(e.p)) io.close(e.p, io.pos(e));
}

/**
 * Crisis stages as intervals: each stage lasts until the next one or the end of its age.
 * @param {HnrEvent[]} events Events.
 * @param {(e: HnrEvent) => number} pos Position of an event.
 * @param {{from:number, len:number}[]} spans Age spans.
 * @returns {Timeline["crises"]} Stages.
 */
export function crisisIntervals(events, pos, spans) {
  // A real game has at most four stages an age; the cap only bounds odd or modded data.
  const list = events.filter((e) => e.k === "crisis").slice(-CRISES_CAP);
  return list.map((e, i) => {
    const next = list[i + 1];
    const to = next && next.a === e.a ? pos(next) : ageEndOf(spans, e.a);
    return { from: pos(e), to: Math.max(to, pos(e) + 1), stage: Number(e.q) || 1, n: e.n || "" };
  });
}

/**
 * The milestone kind of an event for the local player's timeline, or "" when it is not one.
 * @param {HnrEvent} e Event.
 * @param {number} local Local player id.
 * @returns {string} Kind.
 */
export function markKind(e, local) {
  if (e.k === "victory") return "victory";
  if (e.k === "elim") return "elim";
  if ((e.k === "capture" || e.k === "razed") && e.q === local) return "lost";
  if (e.p !== local) return "";
  return ["wonder", "religion", "triumph", "capture"].includes(e.k) ? e.k : "";
}

/**
 * Milestones, capped by importance and returned in time order.
 * @param {HnrEvent[]} events Events.
 * @param {number} local Local player id.
 * @param {(e: HnrEvent) => number} pos Position of an event.
 * @param {IconOf} [iconOf] Icon resolver.
 * @returns {Timeline["marks"]} Milestones.
 */
export function milestones(events, local, pos, iconOf = () => "") {
  const all = events
    .map((e, i) => ({ e, i, k: markKind(e, local) }))
    .filter((x) => x.k)
    .sort((a, b) => MARK_ORDER.indexOf(a.k) - MARK_ORDER.indexOf(b.k) || a.i - b.i)
    .slice(0, MARKS_CAP)
    .sort((a, b) => a.i - b.i);
  return all.map(({ e, k }) =>
    ({ at: pos(e), k, p: e.p, q: e.q ?? -1, n: e.n || "", x: e.x || "", d: e.d || "", i: iconOf(e.x || "", k) }));
}

/**
 * The sample turns of a campaign (empty for a document without them).
 * @param {CampaignDoc} doc Campaign.
 * @returns {number[]} Turns.
 */
function seriesTurns(doc) {
  return doc.series.turns || [];
}

/**
 * The local player's series, if the campaign has one.
 * @param {CampaignDoc} doc Campaign.
 * @returns {HnrPlayerSeries|undefined} Series.
 */
function localSeries(doc) {
  return (doc.series.by || {})[String(doc.local)];
}

/**
 * The local player's scaled population per sample (empty when never recorded).
 * @param {CampaignDoc} doc Campaign.
 * @returns {number[]} People per sample.
 */
function localPops(doc) {
  return localSeries(doc)?.pops || [];
}

/**
 * Axis position of every trend sample. Samples carry turns that restart each age, so the age of a
 * sample advances whenever its turn goes back down.
 * @param {CampaignDoc} doc Campaign.
 * @param {{from:number, len:number}[]} spans Age spans.
 * @returns {number[]} Position per sample.
 */
export function samplePositions(doc, spans) {
  const turns = seriesTurns(doc);
  let a = 0;
  return turns.map((t, i) => {
    if (i > 0 && t < turns[i - 1]) a = Math.min(a + 1, spans.length - 1);
    return positionOf(spans, doc.ages, a, t);
  });
}

/**
 * The local player's scaled population across the game, thinned to CURVE_POINTS points.
 * @param {CampaignDoc} doc Campaign.
 * @param {{from:number, len:number}[]} spans Age spans.
 * @returns {Timeline["curve"]} Curve.
 */
export function popCurve(doc, spans) {
  const pops = localPops(doc);
  const at = samplePositions(doc, spans);
  const all = at.map((x, i) => ({ at: x, v: pops[i] || 0 }));
  if (all.length <= CURVE_POINTS) return all;
  const out = [];
  for (let i = 0; i < CURVE_POINTS; i++) out.push(all[Math.round((i * (all.length - 1)) / (CURVE_POINTS - 1))]);
  return out;
}

/**
 * Scaled-population milestones the local player crossed. Samples carry turns that restart each
 * age, so the age of a sample advances whenever its turn goes back down.
 * @param {CampaignDoc} doc Campaign.
 * @param {{from:number, len:number}[]} spans Age spans.
 * @returns {Timeline["pops"]} Milestones.
 */
export function popMilestones(doc, spans) {
  const pops = localPops(doc);
  const turns = seriesTurns(doc);
  /** @type {Timeline["pops"]} */
  const out = [];
  let a = 0;
  let next = 0;
  for (let i = 0; i < turns.length; i++) {
    if (i > 0 && turns[i] < turns[i - 1]) a = Math.min(a + 1, spans.length - 1);
    while (next < POP_MILESTONES.length && (pops[i] || 0) >= POP_MILESTONES[next]) {
      if (i > 0) out.push({ at: positionOf(spans, doc.ages, a, turns[i]), v: POP_MILESTONES[next] });
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
 * @param {HnrEvent[]} events Visible events.
 * @param {number} local Local player id.
 * @param {(e: HnrEvent) => number} pos Position of an event.
 * @returns {Timeline["founds"]} Foundings.
 */
export function foundings(events, local, pos) {
  return events
    .filter((e) => e.k === "found" && e.p === local)
    .slice(0, FOUNDS_CAP)
    .map((e) => ({ at: pos(e), n: e.n || "", d: e.d || "" }));
}

/**
 * Natural disasters that struck known civilizations' lands.
 * @param {HnrEvent[]} events Visible events.
 * @param {(e: HnrEvent) => number} pos Position of an event.
 * @returns {Timeline["disasters"]} Disasters.
 */
export function disasterMarks(events, pos) {
  return events
    .filter((e) => e.k === "disaster")
    .slice(-DISASTERS_CAP)
    .map((e) => ({ at: pos(e), n: e.n || "", x: e.x || "", p: e.p, d: e.d || "" }));
}

/**
 * The local player's migration (Emigration mod) as people in and out per stretch of the game,
 * from its cumulative tallies.
 * @param {CampaignDoc} doc Campaign.
 * @param {{from:number, len:number}[]} spans Age spans.
 * @param {number} total Axis length.
 * @returns {Timeline["mig"]} Buckets that saw movement.
 */
export function migrationBuckets(doc, spans, total) {
  const ps = localSeries(doc);
  const mi = ps?.mi || [];
  const mo = ps?.mo || [];
  if (mi.length < 2) return [];
  const at = samplePositions(doc, spans);
  const size = Math.max(1, total / MIGRATION_BUCKETS);
  /** @type {Map<number, {at:number, i:number, o:number}>} */
  const out = new Map();
  for (let k = 1; k < mi.length; k++) {
    const b = Math.min(MIGRATION_BUCKETS - 1, Math.floor(at[k] / size));
    const cur = out.get(b) || { at: Math.round(b * size + size / 2), i: 0, o: 0 };
    cur.i += Math.max(0, mi[k] - mi[k - 1]);
    cur.o += Math.max(0, (mo[k] ?? 0) - (mo[k - 1] ?? 0));
    out.set(b, cur);
  }
  return [...out.values()].filter((x) => x.i > 0 || x.o > 0).sort((a, b) => a.at - b.at);
}

/**
 * Wars fought between two civilizations other than the local player, as intervals.
 * @param {HnrEvent[]} events Visible events.
 * @param {number} local Local player id.
 * @param {(e: HnrEvent) => number} pos Position of an event.
 * @param {{from:number, len:number}[]} spans Age spans (a war ends with its age).
 * @returns {RivalTracks["wars"]} Wars.
 */
export function rivalWars(events, local, pos, spans) {
  /** @type {RivalWarIo} */
  const io = { open: new Map(), out: [], pos };
  const ageEnd = (/** @type {number} */ a) => ageEndOf(spans, a);
  for (const e of events) {
    for (const [k, w] of io.open) if (e.a !== w.age) closeRivalWar(io, k, ageEnd(w.age));
    rivalWarStep(io, e, local);
  }
  for (const [k, w] of io.open) closeRivalWar(io, k, ageEnd(w.age));
  return io.out.sort((x, y) => x.from - y.from).slice(-RIVAL_WARS_CAP);
}

/**
 * @typedef {{open: Map<string, {from:number, a:number, b:number, age:number, d:string}>,
 *   out: RivalTracks["wars"], pos: (e: HnrEvent) => number}} RivalWarIo
 */

/**
 * End an open war between two rivals.
 * @param {RivalWarIo} io State.
 * @param {string} k Pair key.
 * @param {number} to End position.
 */
function closeRivalWar(io, k, to) {
  const w = io.open.get(k);
  if (w) io.out.push({ from: w.from, to: Math.max(to, w.from + 1), a: w.a, b: w.b, d: w.d });
  io.open.delete(k);
}

/**
 * Apply one event to the rivals' open wars.
 * @param {RivalWarIo} io State.
 * @param {HnrEvent} e Event.
 * @param {number} local Local player id.
 */
function rivalWarStep(io, e, local) {
  if (e.k === "elim") return closeWarsOf(io, e);
  const q = e.q ?? -1;
  if (!isRivalPair(e.p, q, local)) return;
  const k = Math.min(e.p, q) + "|" + Math.max(e.p, q);
  if (e.k === "war" && !io.open.has(k)) io.open.set(k, { from: io.pos(e), a: e.p, b: q, age: e.a, d: e.d || "" });
  else if (e.k === "peace") closeRivalWar(io, k, io.pos(e));
}

/**
 * End every open rival war of an eliminated civilization.
 * @param {RivalWarIo} io State.
 * @param {HnrEvent} e Elimination.
 */
function closeWarsOf(io, e) {
  for (const [key, w] of io.open) if (w.a === e.p || w.b === e.p) closeRivalWar(io, key, io.pos(e));
}

/**
 * Whether two players are both civilizations other than the local player.
 * @param {number} a Player.
 * @param {number} b Player.
 * @param {number} local Local player id.
 * @returns {boolean} True for a pair of rivals.
 */
function isRivalPair(a, b, local) {
  return a >= 0 && b >= 0 && a !== local && b !== local;
}

/**
 * The other known civilizations' own milestones and foundings, capped per civilization.
 * @param {HnrEvent[]} events Visible events.
 * @param {number} local Local player id.
 * @param {(e: HnrEvent) => number} pos Position of an event.
 * @param {IconOf} [iconOf] Icon resolver.
 * @returns {{marks: RivalTracks["marks"], founds: RivalTracks["founds"]}} Tracks.
 */
export function rivalDeeds(events, local, pos, iconOf = () => "") {
  /** @type {Map<number, {m: HnrEvent[], f: HnrEvent[]}>} */
  const by = new Map();
  events.forEach((e) => {
    if (e.p < 0 || e.p === local) return;
    const slot = by.get(e.p) || { m: [], f: [] };
    if (e.k === "found") slot.f.push(e);
    // (a capture from the local player is already its "lost" milestone)
    else if (["wonder", "religion", "triumph"].includes(e.k) || (e.k === "capture" && e.q !== local)) slot.m.push(e);
    by.set(e.p, slot);
  });
  /** @type {RivalTracks["marks"]} */
  const marks = [];
  /** @type {RivalTracks["founds"]} */
  const founds = [];
  for (const slot of by.values()) {
    const kept = slot.m
      .map((e, i) => ({ e, i }))
      .sort((x, y) => MARK_ORDER.indexOf(x.e.k) - MARK_ORDER.indexOf(y.e.k) || x.i - y.i)
      .slice(0, RIVAL_MARKS_CAP);
    for (const { e } of kept) marks.push(rivalMark(e, pos, iconOf));
    for (const e of slot.f.slice(0, RIVAL_FOUNDS_CAP)) founds.push({ at: pos(e), n: e.n || "", d: e.d || "", p: e.p });
  }
  return { marks: marks.sort((x, y) => x.at - y.at), founds: founds.sort((x, y) => x.at - y.at) };
}

/**
 * One rival milestone.
 * @param {HnrEvent} e Event.
 * @param {(e: HnrEvent) => number} pos Position of an event.
 * @param {IconOf} iconOf Icon resolver.
 * @returns {RivalTracks["marks"][number]} Milestone.
 */
function rivalMark(e, pos, iconOf) {
  return { at: pos(e), k: e.k, p: e.p, q: e.q ?? -1, n: e.n || "", d: e.d || "", i: iconOf(e.x || "", e.k) };
}

/**
 * The other known civilizations' scaled population, each thinned to RIVAL_CURVE_POINTS.
 * @param {CampaignDoc} doc Campaign.
 * @param {{from:number, len:number}[]} spans Age spans.
 * @param {(pid:number) => boolean} known Whether a civilization may be shown.
 * @returns {RivalTracks["curves"]} Curves by player id.
 */
export function rivalCurves(doc, spans, known) {
  const by = doc.series.by || {};
  const at = samplePositions(doc, spans);
  /** @type {RivalTracks["curves"]} */
  const out = {};
  for (const [pid, ps] of Object.entries(by)) {
    if (Number(pid) === doc.local || !known(Number(pid)) || !ps.pops?.some((v) => v > 0)) continue;
    const all = at.map((x, i) => ({ at: x, v: ps.pops?.[i] || 0 }));
    out[pid] = all.length <= RIVAL_CURVE_POINTS ? all : Array.from({ length: RIVAL_CURVE_POINTS }, (_, i) =>
      all[Math.round((i * (all.length - 1)) / (RIVAL_CURVE_POINTS - 1))]);
  }
  return out;
}

/**
 * The whole timeline of a live campaign.
 * @param {CampaignDoc} doc Campaign.
 * @param {(e: HnrEvent) => boolean} [visible] Spoiler filter for events (default: all).
 * @param {(pid:number) => boolean} [known] Spoiler filter for civilizations (default: all).
 * @param {IconOf} [iconOf] Icon resolver for wonders and religions (default: none).
 * @returns {Timeline} Timeline.
 */
export function buildTimeline(doc, visible = () => true, known = () => true, iconOf = () => "") {
  const spans = ageSpans(doc.ages);
  const events = doc.events.filter(visible);
  const pos = (/** @type {HnrEvent} */ e) => positionOf(spans, doc.ages, e.a, e.t);
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
 * @param {number} n Position.
 * @returns {number} Rounded.
 */
const at2 = (n) => Math.round(Number(n) * 100) / 100;

/**
 * Compact form for an archived record.
 * @param {Timeline} tl Timeline.
 * @returns {*} Packed timeline.
 */
export function packTimeline(tl) {
  return {
    n: tl.total,
    g: tl.ages.map((a) => [at2(a.from), at2(a.len), a.age, a.n, a.d, a.t0]),
    w: tl.wars.map((w) => [at2(w.from), at2(w.to), w.other, w.d]),
    c: tl.crises.map((c) => [at2(c.from), at2(c.to), c.stage, c.n]),
    m: tl.marks.map((m) => [at2(m.at), m.k, m.p, m.q, m.n, m.d, m.i || ""]),
    p: tl.pops.map((p) => [at2(p.at), p.v]),
    s: tl.curve.map((p) => [at2(p.at), Math.round(p.v)]),
    z: tl.disasters.map((d) => [at2(d.at), d.n, d.x, d.p, d.d]),
    f: tl.founds.map((f) => [at2(f.at), f.n, f.d]),
    r: packRivals(tl.rivals),
    v: tl.mig.map((m) => [at2(m.at), Math.round(m.i), Math.round(m.o)])
  };
}

/**
 * Unpack an archived timeline (tolerating a missing or partial one).
 * @param {*} t Packed timeline.
 * @returns {Timeline|null} Timeline, or null when there is none.
 */
export function unpackTimeline(t) {
  if (!t || typeof t !== "object" || !Array.isArray(t.g)) return null;
  const arr = (/** @type {*} */ x) => (Array.isArray(x) ? x : []);
  return {
    total: Number(t.n) || 1,
    ages: arr(t.g).map((a) => ({ from: a[0], len: a[1], age: a[2], n: a[3] || "", d: a[4] || "", t0: Number(a[5]) || 1 })),
    wars: arr(t.w).map((w) => ({ from: w[0], to: w[1], other: w[2], d: w[3] || "" })),
    crises: arr(t.c).map((c) => ({ from: c[0], to: c[1], stage: c[2], n: c[3] || "" })),
    marks: arr(t.m).map((m) => ({ at: m[0], k: m[1], p: m[2], q: m[3], n: m[4] || "", x: "", d: m[5] || "", i: m[6] || "" })),
    pops: arr(t.p).map((p) => ({ at: p[0], v: p[1] })),
    curve: arr(t.s).map((p) => ({ at: p[0], v: p[1] })),
    disasters: arr(t.z).map((d) => ({ at: d[0], n: d[1] || "", x: d[2] || "", p: Number(d[3]), d: d[4] || "" })),
    founds: arr(t.f).map((f) => ({ at: f[0], n: f[1] || "", d: f[2] || "" })),
    rivals: unpackRivals(t.r),
    mig: arr(t.v).map((m) => ({ at: m[0], i: m[1] || 0, o: m[2] || 0 }))
  };
}

/**
 * Compact form of the rival tracks.
 * @param {RivalTracks} r Tracks.
 * @returns {*} Packed.
 */
function packRivals(r) {
  /** @type {Record<string, number[][]>} */
  const s = {};
  for (const [pid, c] of Object.entries(r.curves)) s[pid] = c.map((p) => [at2(p.at), Math.round(p.v)]);
  return {
    m: r.marks.map((m) => [at2(m.at), m.k, m.p, m.q, m.n, m.d, m.i || ""]),
    f: r.founds.map((f) => [at2(f.at), f.n, f.d, f.p]),
    w: r.wars.map((w) => [at2(w.from), at2(w.to), w.a, w.b, w.d]),
    s
  };
}

/**
 * Unpack the rival tracks (empty when an older record has none).
 * @param {*} r Packed.
 * @returns {RivalTracks} Tracks.
 */
function unpackRivals(r) {
  const arr = (/** @type {*} */ x) => (Array.isArray(x) ? x : []);
  /** @type {RivalTracks["curves"]} */
  const curves = {};
  const src = r && typeof r.s === "object" && r.s ? r.s : {};
  for (const [pid, c] of Object.entries(src)) curves[pid] = arr(c).map((p) => ({ at: p[0], v: p[1] }));
  return {
    marks: arr(r?.m).map((m) => ({ at: m[0], k: m[1], p: Number(m[2]), q: Number(m[3]), n: m[4] || "", d: m[5] || "", i: m[6] || "" })),
    founds: arr(r?.f).map((f) => ({ at: f[0], n: f[1] || "", d: f[2] || "", p: Number(f[3]) })),
    wars: arr(r?.w).map((w) => ({ from: w[0], to: w[1], a: Number(w[2]), b: Number(w[3]), d: w[4] || "" })),
    curves
  };
}

/**
 * The timeline narrowed to the civilizations picked in its filter: the local player's own lanes
 * when it is picked, and each picked rival's milestones, foundings, wars, disasters on its land and
 * population line folded into the same lanes. The victory, ages and crises always stay; an
 * elimination stays when the fallen civilization is picked.
 * @param {Timeline} tl Timeline.
 * @param {number} local Local player id.
 * @param {Set<number>} shown Picked civilizations.
 * @returns {Timeline} Narrowed timeline.
 */
export function focusTimeline(tl, local, shown) {
  const me = shown.has(local);
  const rv = tl.rivals;
  const keepMark = (/** @type {Timeline["marks"][number]} */ m) => {
    if (m.k === "victory") return true;
    return m.k === "elim" ? shown.has(m.p) : me;
  };
  const rivalWar = (/** @type {RivalTracks["wars"][number]} */ x) =>
    ({ from: x.from, to: x.to, other: x.b, a: x.a, d: x.d });
  return {
    ...tl,
    wars: [
      ...(me ? tl.wars.map((x) => ({ ...x, a: local })) : []),
      ...rv.wars.filter((x) => shown.has(x.a) || shown.has(x.b)).map(rivalWar)
    ].sort((x, y) => x.from - y.from),
    marks: [
      ...tl.marks.filter(keepMark),
      ...rv.marks.filter((m) => shown.has(m.p)).map((m) => ({ ...m, x: "" }))
    ].sort((x, y) => x.at - y.at),
    founds: [...(me ? tl.founds.map((f) => ({ ...f, p: local })) : []), ...rv.founds.filter((f) => shown.has(f.p))]
      .sort((x, y) => x.at - y.at),
    disasters: tl.disasters.filter((d) => shown.has(d.p)),
    mig: me ? tl.mig : [],
    pops: me ? tl.pops : [],
    curve: me ? tl.curve : [],
    lines: Object.entries(rv.curves)
      .filter(([pid]) => shown.has(Number(pid)))
      .map(([pid, pts]) => ({ pid: Number(pid), pts }))
  };
}

/**
 * Every civilization the timeline can show, the local player first.
 * @param {Timeline} tl Timeline.
 * @param {number} local Local player id.
 * @returns {number[]} Player ids.
 */
export function timelineCivs(tl, local) {
  const rv = tl.rivals;
  const ids = new Set([
    ...tl.wars.map((x) => x.other), ...rv.wars.flatMap((x) => [x.a, x.b]), ...rv.marks.map((m) => m.p),
    ...rv.founds.map((f) => f.p), ...Object.keys(rv.curves).map(Number), ...tl.disasters.map((d) => d.p)
  ]);
  ids.delete(local);
  return [local, ...[...ids].filter((p) => p >= 0).sort((a, b) => a - b)];
}
