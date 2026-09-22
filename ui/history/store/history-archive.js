// history-archive.js
//
// Pure: turn a CampaignDoc into a compact ArchiveRecord (about 1-2 KB) and maintain the ArchiveSlice
// that holds every record. No storage access; dgh-archive-store.js reads and writes the slice.
//
// Merge rule: when two copies of the same campaign disagree, the one with more progress wins (more
// ages, then more turns, then the later update). Reloading an older save of a campaign therefore
// cannot roll its Hall of Fame entry back.

import { triumphCounts } from "/demographics/ui/history/store/history-campaign.js";
import { buildTimeline, packTimeline } from "/demographics/ui/history/model/history-timeline.js";
import { mapView, packMap } from "/demographics/ui/history/model/history-map.js";
import { engineIcon } from "/demographics/ui/history/core/history-icons.js";
import { castFromDoc, eventVisible } from "/demographics/ui/history/model/history-narrate.js";

export const ARCHIVE_SCHEMA = 1;
export const RECORD_VERSION = 1;
/**
 * Byte budget for the whole slice: room for roughly 30 long games with their timelines, or many
 * more short ones. Names are shared across the archive and positions are rounded, so a game with
 * its whole story costs about 15 KB. It shares one localStorage value with other mods' settings,
 * which they parse on load, so it stays well under a megabyte.
 */
export const SLICE_BYTE_CAP = 512 * 1024;
/** Most highlights kept per record. */
export const HIGHLIGHTS_CAP = 30;
/** Points kept per sparkline. */
export const SPARK_POINTS = 24;

/** Importance of each kind when choosing highlights (higher first). */
const HIGHLIGHT_WEIGHT = /** @type {Record<string, number>} */ ({
  victory: 9, elim: 8, age: 7, wonder: 6, religion: 5, capture: 4, razed: 4, triumph: 3, war: 2, peace: 2,
  crisis: 2, civ: 1, disaster: 1
});

/**
 * An empty slice.
 * @returns {ArchiveSlice} The slice.
 */
export function emptySlice() {
  return { __schema: ARCHIVE_SCHEMA, games: {}, hidden: {}, texts: {} };
}

/**
 * Whether a value is a record this version can display.
 * @param {*} r Candidate.
 * @returns {boolean} True when usable.
 */
export function isRecord(r) {
  return !!(
    r && typeof r === "object" && r.v === RECORD_VERSION && typeof r.id === "string" &&
    typeof r.leader === "string" && r.outcome && typeof r.turns === "number" && Array.isArray(r.civs)
  );
}

/**
 * Whether a value is an archive slice written by this mod. Used before every write so the mod never
 * replaces something it does not recognize.
 * @param {*} s Candidate.
 * @returns {boolean} True when it is a slice.
 */
export function isSlice(s) {
  return !!(
    s && typeof s === "object" && !Array.isArray(s) && s.__schema === ARCHIVE_SCHEMA &&
    s.games && typeof s.games === "object" && s.hidden && typeof s.hidden === "object"
  );
}

/**
 * The names a slice carries, with those of an older slice that kept them inside its records.
 * @param {ArchiveSlice} slice The slice.
 * @returns {Record<string, string>} Tag -> text.
 */
export function sliceTexts(slice) {
  const out = { ...(slice.texts || {}) };
  for (const rec of Object.values(slice.games)) Object.assign(out, (/** @type {*} */ (rec)).texts || {});
  return out;
}

/**
 * Downsample a series to at most `n` points, always keeping the last.
 * @param {number[]} arr Values.
 * @param {number} n Target size.
 * @returns {number[]} The sampled values.
 */
export function downsample(arr, n) {
  if (arr.length <= n) return arr.slice();
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.round((i * (arr.length - 1)) / (n - 1))]);
  return out;
}

/**
 * Turns played across every recorded age.
 * @param {CampaignDoc} doc The campaign.
 * @returns {number} Turn count.
 */
export function turnsPlayed(doc) {
  const recorded = doc.ages.reduce((sum, a) => sum + Math.max(0, a.end - a.start + 1), 0);
  // Recording began mid-game: count the turns before it too, so the game is not mistaken for a
  // short test game.
  const before = doc.since?.partial ? Math.max(0, doc.since.t - 1) : 0;
  return recorded + before;
}

/**
 * The most important events for the local player, oldest first.
 * @param {CampaignDoc} doc The campaign.
 * @returns {HnrEvent[]} Up to HIGHLIGHTS_CAP events.
 */
export function pickHighlights(doc) {
  const mine = (/** @type {HnrEvent} */ e) =>
    e.k === "victory" || e.k === "age" || e.k === "crisis" || e.p === doc.local || (e.k === "elim" && e.q === doc.local);
  const scored = doc.events
    .map((e, i) => ({ e, i, w: HIGHLIGHT_WEIGHT[e.k] || 0 }))
    .filter((x) => x.w > 0 && mine(x.e));
  scored.sort((a, b) => b.w - a.w || a.i - b.i);
  return scored
    .slice(0, HIGHLIGHTS_CAP)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.e);
}

/**
 * Count the local player's events of a kind.
 * @param {CampaignDoc} doc The campaign.
 * @param {HnrEventKind} kind Kind.
 * @returns {number} Count.
 */
function countMine(doc, kind) {
  return doc.events.filter((e) => e.k === kind && (e.p === doc.local || e.q === doc.local)).length;
}

/**
 * Headline figures for the local player.
 * @param {CampaignDoc} doc The campaign.
 * @returns {ArchiveRecord["stats"]} Stats.
 */
export function localStats(doc) {
  const me = String(doc.local);
  const ps = doc.series.by[me] || { set: [], pop: [], tri: [] };
  const state = doc.last?.players[me] || null;
  const religion = doc.events.find((e) => e.k === "religion" && e.p === doc.local);
  const byMe = (/** @type {HnrEventKind} */ k) => doc.events.filter((e) => e.k === k && e.p === doc.local).length;
  return {
    settlements: state ? Object.keys(state.cities).length : lastOf(ps.set),
    peakSettlements: Math.max(0, ...ps.set),
    ...localPopulation(state, ps),
    wonders: Math.max(state ? state.wonders.length : 0, byMe("wonder")),
    triumphs: triumphCounts(doc)[me] || 0,
    captured: byMe("capture"),
    wars: countMine(doc, "war"),
    religion: religion?.n || ""
  };
}

/**
 * The local player's population, as a count and in Demographics' real-world scale.
 * @param {HnrPlayerState|null} state Latest state, if any.
 * @param {HnrPlayerSeries} ps The player's series.
 * @returns {{population:number, populationScaled:number}} Population.
 */
function localPopulation(state, ps) {
  if (state) return { population: state.population, populationScaled: state.popScaled || 0 };
  return { population: lastOf(ps.pop), populationScaled: lastOf(ps.pops || []) };
}

/**
 * Last element of a number array, or 0.
 * @param {number[]} arr Values.
 * @returns {number} Last value.
 */
function lastOf(arr) {
  return arr.length ? arr[arr.length - 1] || 0 : 0;
}

/**
 * Everyone else the player met, frozen with their final civilization. Civilizations never met are
 * left out, so the Hall of Fame does not reveal them for a game still being played.
 * @param {CampaignDoc} doc The campaign.
 * @returns {HnrRival[]} Rivals.
 */
export function rivalsOf(doc) {
  const tri = triumphCounts(doc);
  const met = (/** @type {string} */ pid) => !doc.last || !!doc.last.players[pid]?.met || doc.players[pid]?.elim === -1;
  return Object.entries(doc.players)
    .filter(([pid]) => Number(pid) !== doc.local && met(pid))
    .map(([pid, p]) => {
      const civ = p.civs[p.civs.length - 1] || { civ: "", name: "" };
      /** @type {HnrRival} */
      const r = [Number(pid), p.leader, p.leaderName, civ.civ, civ.name, p.color, p.elim, tri[pid] || 0, p.color2 || ""];
      return r;
    });
}

/**
 * Build the archive record for a campaign.
 * @param {CampaignDoc} doc The campaign.
 * @returns {ArchiveRecord|null} The record, or null when the local player is unknown.
 */
export function buildRecord(doc) {
  const me = doc.players[String(doc.local)];
  if (!me) return null;
  const ps = doc.series.by[String(doc.local)] || { set: [], pop: [], tri: [] };
  return {
    v: RECORD_VERSION,
    id: doc.id,
    created: doc.created,
    updated: doc.updated,
    local: doc.local,
    leader: me.leader,
    leaderName: me.leaderName,
    color: me.color,
    color2: me.color2 || "",
    civs: me.civs.slice(),
    setup: { ...doc.setup },
    turns: turnsPlayed(doc),
    ages: doc.ages.map((a) => a.age),
    outcome: { ...doc.outcome },
    stats: localStats(doc),
    rivals: rivalsOf(doc),
    highlights: pickHighlights(doc),
    spark: { tri: downsample(ps.tri, SPARK_POINTS), set: downsample(ps.set, SPARK_POINTS) },
    tl: packTimeline(buildTimeline(doc, (e) => eventVisible(e, castFromDoc(doc)), castFromDoc(doc).known, engineIcon)),
    map: packMap(mapView(doc))
  };
}

/**
 * The LOC tags of a record that may not resolve at the main menu, where only setup text is loaded:
 * names first seen in a game (settlements, wonders, Triumphs, religions) and the victory's name.
 * Leader, civilization, age and setup names are setup text and always resolve, so they are left out
 * to keep records small.
 * @param {ArchiveRecord} rec The record.
 * @returns {string[]} Unique tags.
 */
export function recordTags(rec) {
  const col = (/** @type {*} */ list, /** @type {number} */ i) =>
    (Array.isArray(list) ? list.map((/** @type {*[]} */ x) => String(x[i] || "")) : []);
  const tl = rec.tl || {};
  const r = tl.r || {};
  const names = [...col(tl.m, 4), ...col(tl.z, 1), ...col(tl.f, 1), ...col(r.m, 4), ...col(r.f, 1)];
  const all = [rec.outcome.name, rec.stats.religion, ...rec.highlights.map((e) => e.n || ""), ...names];
  return [...new Set(all.filter((x) => typeof x === "string" && x.startsWith("LOC_")))];
}

/**
 * Whether record `a` shows at least as much progress as `b`.
 * @param {ArchiveRecord} a Candidate.
 * @param {ArchiveRecord} b Existing.
 * @returns {boolean} True when `a` should replace `b`.
 */
export function supersedes(a, b) {
  if (a.outcome.status !== "in_progress" && b.outcome.status === "in_progress") return true;
  if (a.outcome.status === "in_progress" && b.outcome.status !== "in_progress") return false;
  if (a.ages.length !== b.ages.length) return a.ages.length > b.ages.length;
  if (a.turns !== b.turns) return a.turns > b.turns;
  return a.updated >= b.updated;
}

/**
 * Insert or replace a record unless it is hidden or an existing copy shows more progress.
 * @param {ArchiveSlice} slice The slice (mutated).
 * @param {ArchiveRecord} rec The record.
 * @returns {boolean} True when the slice changed.
 */
export function upsert(slice, rec) {
  if (slice.hidden[rec.id]) return false;
  const cur = slice.games[rec.id];
  if (cur && isRecord(cur) && !supersedes(rec, cur)) return false;
  // The names a game needs read the same in every game, so they are kept once for the whole
  // archive instead of a copy inside each record: twenty games used to carry twenty copies.
  if (rec.texts) {
    slice.texts = { ...slice.texts, ...rec.texts };
    delete rec.texts;
  }
  slice.games[rec.id] = rec;
  return true;
}

/**
 * Merge every record of `from` into `into` using the progress rule; hidden ids are unioned.
 * @param {ArchiveSlice} into Target (mutated).
 * @param {ArchiveSlice} from Source.
 */
export function mergeSlices(into, from) {
  for (const [id, stamp] of Object.entries(from.hidden)) {
    into.hidden[id] = stamp;
    delete into.games[id];
  }
  into.texts = { ...into.texts, ...(from.texts || {}) };
  for (const rec of Object.values(from.games)) if (isRecord(rec)) upsert(into, rec);
}

/**
 * Hide a game: remove its record and remember the id so a save loaded later does not bring it back.
 * @param {ArchiveSlice} slice The slice (mutated).
 * @param {string} id Campaign id.
 * @param {number} now Timestamp.
 */
export function hideGame(slice, id, now) {
  delete slice.games[id];
  slice.hidden[id] = now;
}

/**
 * Make the slice fit its byte budget, losing as little as possible: first the territory maps, then
 * the other civilizations' timeline tracks, then whole timelines are dropped from the least recently
 * played games; only then are games removed (unfinished ones first, oldest first). The most recently
 * updated game (the one being played and just saved) is kept whole, and only trimmed if it alone
 * exceeds the budget. Sizes are measured once per record and kept as a running total, so this is one
 * linear pass even on a full archive.
 * @param {ArchiveSlice} slice The slice (mutated).
 * @param {number} [cap] Byte budget.
 * @returns {string[]} Evicted ids.
 */
export function fitSlice(slice, cap = SLICE_BYTE_CAP) {
  let total = JSON.stringify(slice).length;
  if (total <= cap) return [];
  const all = Object.values(slice.games).sort((a, b) => a.updated - b.updated);
  const newest = all[all.length - 1];
  total = stripParts(all.slice(0, -1), total, cap);
  const evicted = total <= cap ? [] : evictGames(slice, total, cap, newest?.id || "");
  if (evicted.length) pruneTexts(slice);
  if (newest && sizeOf(slice) > cap) stripParts([newest], sizeOf(slice), cap);
  return evicted;
}

/**
 * Drop shared names no remaining game uses, so evicting a game gives its names back too.
 * @param {ArchiveSlice} slice The slice (mutated).
 */
export function pruneTexts(slice) {
  if (!slice.texts) return;
  const used = new Set(Object.values(slice.games).flatMap((r) => recordTags(r)));
  for (const tag of Object.keys(slice.texts)) if (!used.has(tag)) delete slice.texts[tag];
}

/** Byte size of a value as stored. */
const sizeOf = (/** @type {*} */ x) => JSON.stringify(x).length;

/**
 * Drop the bulky optional parts of records, in the order given, until the slice fits.
 * @param {ArchiveRecord[]} byAge Records to trim, least recently played first (mutated).
 * @param {number} total The slice's current size.
 * @param {number} cap Byte budget.
 * @returns {number} The size after.
 */
function stripParts(byAge, total, cap) {
  const strips = [
    (/** @type {ArchiveRecord} */ r) => delete r.map,
    (/** @type {ArchiveRecord} */ r) => r.tl && delete r.tl.r,
    (/** @type {ArchiveRecord} */ r) => delete r.tl
  ];
  for (const strip of strips) {
    for (const r of byAge) {
      if (total <= cap) return total;
      const before = sizeOf(r);
      strip(r);
      total -= before - sizeOf(r);
    }
  }
  return total;
}

/**
 * Remove whole games, unfinished ones first and then the oldest, until the slice fits.
 * @param {ArchiveSlice} slice The slice (mutated).
 * @param {number} total Its current size.
 * @param {number} cap Byte budget.
 * @param {string} keep Id of the game never removed (the one being played).
 * @returns {string[]} Evicted ids.
 */
function evictGames(slice, total, cap, keep) {
  /** @type {string[]} */
  const evicted = [];
  const order = Object.values(slice.games).filter((r) => r.id !== keep).sort(
    (a, b) => Number(a.outcome.status !== "in_progress") - Number(b.outcome.status !== "in_progress") || a.updated - b.updated
  );
  const drop = () => {
    const victim = /** @type {ArchiveRecord} */ (order.shift());
    delete slice.games[victim.id];
    evicted.push(victim.id);
    return victim;
  };
  while (total > cap && order.length > 0) {
    const victim = drop();
    total -= sizeOf(victim) + sizeOf(victim.id) + 2;
  }
  // The running total is exact up to separators; settle any remainder with a real measurement.
  while (sizeOf(slice) > cap && order.length > 0) drop();
  return evicted;
}
