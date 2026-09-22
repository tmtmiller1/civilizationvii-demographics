import assert from "node:assert/strict";
import {
  recordTags, buildRecord, upsert, emptySlice, hideGame, mergeSlices, fitSlice, supersedes, downsample, isSlice, pickHighlights,
  sliceTexts, pruneTexts,
  HIGHLIGHTS_CAP
} from "/demographics/ui/history/store/history-archive.js";
import { newCampaign, ensureAge, appendEvents, appendSample, upsertPlayer } from "/demographics/ui/history/store/history-campaign.js";
import { pstate, world } from "./_history-fixtures.mjs";

const setup = { speed: "S", difficulty: "D", mapSize: "M", mapScript: "x.js", startAge: "AGE_ANTIQUITY" };

/** A small but complete two-player campaign. */
function campaign(id = "g1", turns = 30) {
  const doc = newCampaign({ id, seed: 7, now: 1000, setup, local: 0 });
  ensureAge(doc, "AGE_ANTIQUITY", 1);
  ensureAge(doc, "AGE_ANTIQUITY", turns);
  const idn = (leader, civ) => ({ leader, leaderName: "LOC_" + leader, civ, civName: "LOC_" + civ, color: "#c00", color2: "#0c0", human: leader === "LA" });
  upsertPlayer(doc, 0, idn("LA", "CIV_ROME"), { age: "AGE_ANTIQUITY", turn: 1 });
  upsertPlayer(doc, 1, idn("LB", "CIV_EGYPT"), { age: "AGE_ANTIQUITY", turn: 1 });
  appendEvents(doc, [
    { t: 3, a: 0, k: "found", p: 0, n: "Antium" },
    { t: 4, a: 0, k: "wonder", p: 0, x: "W", n: "LOC_W" },
    { t: 5, a: 0, k: "triumph", p: 0, x: "L1" },
    { t: 6, a: 0, k: "triumph", p: 1, x: "L2" },
    { t: 7, a: 0, k: "capture", p: 0, q: 1, n: "Memphis" },
    { t: 8, a: 0, k: "war", p: 0, q: 1 },
    { t: 9, a: 0, k: "religion", p: 0, n: "LOC_REL" },
    { t: 10, a: 0, k: "met", p: 1, q: 0 }
  ]);
  appendSample(doc, world(1, { 0: pstate({ cities: { a: "A" } }), 1: pstate() }));
  const last = world(turns, { 0: pstate({ cities: { a: "A", b: "B", c: "C" }, population: 12, popScaled: 1200000, wonders: ["W"] }), 1: pstate() });
  appendSample(doc, last);
  doc.last = last;
  return doc;
}

// Building a record.
{
  const rec = buildRecord(campaign());
  assert.equal(rec.local, 0);
  assert.equal(rec.leader, "LA");
  assert.equal(rec.turns, 30);
  assert.deepEqual(rec.stats, {
    settlements: 3, peakSettlements: 3, population: 12, populationScaled: 1200000, wonders: 1, triumphs: 1, captured: 1, wars: 1, religion: "LOC_REL"
  });
  assert.deepEqual(rec.rivals, [[1, "LB", "LOC_LB", "CIV_EGYPT", "LOC_CIV_EGYPT", "#c00", 0, 1, "#0c0"]]);
  assert.equal(rec.color2, "#0c0", "the secondary banner color is kept for readable colors at the main menu");
  assert.ok(!rec.highlights.some((e) => e.k === "met" || e.k === "found"), "highlights skip routine events");
  assert.ok(JSON.stringify(rec).length < 2500, "a record stays compact");
  assert.equal(buildRecord({ ...campaign(), local: 5 }), null);
  const unmet = campaign();
  unmet.last.players["1"].met = false;
  assert.deepEqual(buildRecord(unmet).rivals, [], "civilizations never met are left out");
}

// In-game names are collected for saved text; setup-text names are not.
{
  const tags = recordTags(buildRecord(campaign()));
  for (const k of ["LOC_REL", "LOC_W"]) assert.ok(tags.includes(k), k);
  assert.ok(!tags.includes("LOC_LA") && !tags.includes("LOC_CIV_ROME"), "setup-text names are not duplicated");
  assert.equal(new Set(tags).size, tags.length);
}

// Highlights are capped and kept in chronological order.
{
  const doc = campaign();
  for (let i = 0; i < HIGHLIGHTS_CAP + 10; i++) appendEvents(doc, [{ t: 20 + i, a: 0, k: "wonder", p: 0, x: "W" + i }]);
  const h = pickHighlights(doc);
  assert.equal(h.length, HIGHLIGHTS_CAP);
  assert.ok(h.every((e, i) => i === 0 || e.t >= h[i - 1].t));
}

// Progress rule: more ages, then more turns, finished beats unfinished; older progress never wins.
{
  const a = buildRecord(campaign("g1", 30));
  const b = buildRecord(campaign("g1", 60));
  assert.ok(supersedes(b, a));
  assert.ok(!supersedes(a, b));
  const slice = emptySlice();
  assert.ok(upsert(slice, b));
  assert.ok(!upsert(slice, a), "an older save cannot roll the record back");
  const done = { ...a, outcome: { status: "victory", victory: "V", name: "", winner: 0, turn: 30 } };
  assert.ok(upsert(slice, done), "a finished game replaces an unfinished copy");
}

// Hidden games stay hidden, and hiding survives a merge.
{
  const slice = emptySlice();
  upsert(slice, buildRecord(campaign("g1")));
  hideGame(slice, "g1", 5);
  assert.ok(!upsert(slice, buildRecord(campaign("g1", 90))));
  const other = emptySlice();
  upsert(other, buildRecord(campaign("g1")));
  mergeSlices(other, slice);
  assert.equal(other.games.g1, undefined);
  assert.ok(isSlice(other));
}

// The byte budget evicts unfinished games first, oldest first.
{
  const slice = emptySlice();
  for (let i = 0; i < 12; i++) {
    const r = buildRecord(campaign("g" + i));
    r.updated = i;
    if (i === 0) r.outcome = { status: "victory", victory: "V", winner: 0, turn: 30 };
    upsert(slice, r);
  }
  const evicted = fitSlice(slice, 8000);
  assert.ok(evicted.length > 0);
  assert.equal(evicted[0], "g1", "oldest unfinished goes first");
  assert.ok(slice.games.g0, "finished game kept");
  assert.ok(JSON.stringify(slice).length <= 8000);
}

// Maps go first: the oldest games lose their maps before any game is evicted.
{
  const slice = emptySlice();
  const bigMap = { w: 40, h: 25, r: "1x1000", f: Array.from({ length: 16 }, (_, i) => [i, "0x" + (i + 1) + ".-1x" + (999 - i), [[i, 0]]]) };
  for (let i = 0; i < 4; i++) {
    const r = buildRecord(campaign("m" + i));
    r.updated = i;
    r.map = JSON.parse(JSON.stringify(bigMap));
    upsert(slice, r);
  }
  const size = JSON.stringify(slice).length;
  const oneMap = JSON.stringify(bigMap).length;
  assert.deepEqual(fitSlice(slice, size - oneMap), [], "no game evicted");
  assert.ok(!slice.games.m0.map, "the oldest game's map dropped");
  assert.ok(slice.games.m3.map, "the newest game keeps its map");
  // Past every map, the other civilizations' timeline tracks go next, oldest game first.
  for (const r of Object.values(slice.games)) { delete r.map; r.tl.r = { m: Array.from({ length: 200 }, (_, i) => [i, "wonder", 1, -1, "LOC_X", ""]), f: [], w: [], s: {} }; }
  const withTracks = JSON.stringify(slice).length;
  const oneTrack = JSON.stringify(slice.games.m0.tl.r).length;
  assert.deepEqual(fitSlice(slice, withTracks - oneTrack), []);
  assert.ok(!slice.games.m0.tl.r && slice.games.m3.tl.r, "the oldest game's rival tracks dropped first");
  // Then whole timelines, still before any game is removed.
  for (const r of Object.values(slice.games)) delete r.tl.r;
  const noTracks = JSON.stringify(slice).length;
  assert.deepEqual(fitSlice(slice, noTracks - JSON.stringify(slice.games.m0.tl).length), []);
  assert.ok(!slice.games.m0.tl && slice.games.m3.tl, "the oldest game's timeline dropped, every game kept");
}

// A record carries its territory map when one was captured.
{
  const doc = campaign("withmap", 30);
  doc.map = { w: 2, h: 1, terrain: "1x2", frames: [{ t: 5, a: 0, o: "0x1.-1x1", c: [[0, 0]] }] };
  assert.deepEqual(buildRecord(doc).map, { w: 2, h: 1, r: "1x2", f: [[4, "0x1.-1x1", [[0, 0]]]] });
  assert.equal(buildRecord(campaign("nomap", 30)).map, undefined);
}

// The game being played (the most recently updated) is kept whole while older games give way, and
// is never evicted, even though unfinished games otherwise go first.
{
  const slice = emptySlice();
  const bigMap = { w: 40, h: 25, r: "1x1000", f: Array.from({ length: 16 }, (_, i) => [i, "0x" + (i + 1) + ".-1x" + (999 - i), [[i, 0]]]) };
  for (let i = 0; i < 6; i++) {
    const r = buildRecord(campaign("p" + i));
    r.updated = i;
    r.map = JSON.parse(JSON.stringify(bigMap));
    if (i < 5) r.outcome = { status: "victory", victory: "V", name: "", winner: 0, turn: 30 };
    upsert(slice, r);
  }
  assert.equal(slice.games.p5.outcome.status, "in_progress");
  const tight = JSON.stringify(slice.games.p5).length + 400;
  fitSlice(slice, tight);
  assert.ok(slice.games.p5 && slice.games.p5.map && slice.games.p5.tl, "the live game survives whole");
  assert.ok(JSON.stringify(slice).length <= tight);
  // Alone over the budget, it is trimmed rather than lost.
  const alone = emptySlice();
  upsert(alone, JSON.parse(JSON.stringify(slice.games.p5)));
  fitSlice(alone, 600);
  assert.ok(alone.games.p5 && !alone.games.p5.map, "trimmed, still there");
}

// A campaign joined mid-game counts the turns before recording began.
{
  const doc = campaign("late", 30);
  doc.since = { t: 71, d: "1100 CE", partial: true };
  assert.equal(buildRecord(doc).turns, 100);
}

assert.deepEqual(downsample([1, 2, 3], 5), [1, 2, 3]);
assert.deepEqual(downsample([0, 1, 2, 3, 4, 5, 6, 7, 8], 3), [0, 4, 8]);


// Names are kept once for the whole archive, not copied into every record, and a game that goes
// takes its own names with it.
{
  const slice = emptySlice();
  const a = buildRecord(campaign("t1"));
  a.texts = { LOC_ONE: "One", LOC_SHARED: "Shared" };
  const b = buildRecord(campaign("t2"));
  b.texts = { LOC_TWO: "Two", LOC_SHARED: "Shared" };
  upsert(slice, a);
  upsert(slice, b);
  assert.equal(a.texts, undefined, "the record no longer carries its own copy");
  assert.deepEqual(slice.texts, { LOC_ONE: "One", LOC_SHARED: "Shared", LOC_TWO: "Two" });
  const old = { ...emptySlice(), games: { x: { ...buildRecord(campaign("t3")), texts: { LOC_OLD: "Old" } } } };
  assert.equal(sliceTexts(old).LOC_OLD, "Old", "an archive written before the change still reads");
  delete slice.games[b.id];
  pruneTexts(slice);
  assert.ok(!("LOC_TWO" in slice.texts), "names only that game used are dropped");
}

console.log("history-archive harness passed");
