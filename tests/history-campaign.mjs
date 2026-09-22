import assert from "node:assert/strict";
import {
  newCampaign, isCampaign, ensureAge, upsertPlayer, appendEvents, trimEvents, appendSample,
  applyOutcome, triumphCounts, noteTriumphs, EVENTS_CAP, SERIES_CAP
} from "/demographics/ui/history/store/history-campaign.js";
import { pstate, world } from "./_history-fixtures.mjs";

const setup = { speed: "S", difficulty: "D", mapSize: "M", mapScript: "x.js", startAge: "AGE_ANTIQUITY" };
const fresh = () => newCampaign({ id: "g1", seed: 7, now: 1000, setup, local: 0 });

// Round trip and validation.
{
  const doc = fresh();
  assert.ok(isCampaign(JSON.parse(JSON.stringify(doc))));
  assert.ok(!isCampaign(null));
  assert.ok(!isCampaign({ ...doc, v: 99 }));
  assert.ok(!isCampaign({ v: 2, games: {} }), "the old History & Rankings archive shape is rejected");
}

// Ages: appended once, end turn extended.
{
  const doc = fresh();
  assert.equal(ensureAge(doc, "AGE_ANTIQUITY", 1), 0);
  assert.equal(ensureAge(doc, "AGE_ANTIQUITY", 40), 0);
  assert.equal(ensureAge(doc, "AGE_EXPLORATION", 1), 1);
  assert.deepEqual(doc.ages[0], { age: "AGE_ANTIQUITY", start: 1, end: 40 });
}

// Lineage: one span per age, even when the civilization is unchanged.
{
  const doc = fresh();
  const id = (civ) => ({ leader: "LEADER_A", leaderName: "LOC_A", civ, civName: "LOC_" + civ, color: "#fff", human: true });
  upsertPlayer(doc, 0, id("CIV_ROME"), { age: "AGE_ANTIQUITY", turn: 1 });
  upsertPlayer(doc, 0, id("CIV_ROME"), { age: "AGE_ANTIQUITY", turn: 2 });
  upsertPlayer(doc, 0, id("CIV_NORMAN"), { age: "AGE_EXPLORATION", turn: 1 });
  upsertPlayer(doc, 0, id("CIV_NORMAN"), { age: "AGE_MODERN", turn: 1 });
  assert.deepEqual(doc.players["0"].civs.map((c) => c.age + ":" + c.civ), [
    "AGE_ANTIQUITY:CIV_ROME", "AGE_EXPLORATION:CIV_NORMAN", "AGE_MODERN:CIV_NORMAN"
  ]);
}

// Event cap drops the least important kinds first and marks eliminations.
{
  const doc = fresh();
  doc.players["2"] = { leader: "L", leaderName: "", civs: [], human: false, color: "", elim: 0 };
  appendEvents(doc, [{ t: 9, a: 0, k: "elim", p: 2 }]);
  assert.equal(doc.players["2"].elim, 9);
  const evs = [];
  for (let i = 0; i < EVENTS_CAP; i++) evs.push({ t: i, a: 0, k: i % 2 ? "met" : "wonder", p: 0 });
  evs.push({ t: 1, a: 0, k: "victory", p: 0 }, { t: 2, a: 0, k: "age", p: -1 });
  trimEvents(evs);
  assert.equal(evs.length, EVENTS_CAP);
  assert.ok(evs.some((e) => e.k === "victory") && evs.some((e) => e.k === "age"));
  assert.equal(evs.filter((e) => e.k === "wonder").length, EVENTS_CAP / 2, "every wonder survives");
}

// Series: aligned arrays, same-turn replacement, cumulative Triumphs, decimation under the cap.
{
  const doc = fresh();
  ensureAge(doc, "AGE_ANTIQUITY", 1);
  appendSample(doc, world(1, { 0: pstate({ cities: { a: "A" }, population: 3, popScaled: 30000 }) }));
  appendEvents(doc, [{ t: 2, a: 0, k: "triumph", p: 0, x: "L" }]);
  appendSample(doc, world(2, { 0: pstate({ cities: { a: "A", b: "B" }, population: 5 }), 1: pstate() }));
  appendSample(doc, world(2, { 0: pstate({ cities: { a: "A", b: "B" }, population: 6, popScaled: 52000 }), 1: pstate() }));
  assert.deepEqual(doc.series.turns, [1, 2]);
  assert.deepEqual(doc.series.by["0"], { set: [1, 2], pop: [3, 6], tri: [0, 1], pops: [30000, 52000] });
  const old = { turns: [1], by: { 0: { set: [1], pop: [3], tri: [0] } } };
  appendSample({ ...doc, series: old, ages: [] }, world(2, { 0: pstate({ popScaled: 9 }) }));
  assert.deepEqual(old.by["0"].pops, [0, 9], "a series recorded before scaled population is padded");
  assert.deepEqual(doc.series.by["1"].set, [0, 0], "a late joiner is padded");
  assert.deepEqual(triumphCounts(doc), { 0: 1 });
  for (let t = 3; t <= SERIES_CAP + 40; t++) appendSample(doc, world(t, { 0: pstate() }));
  assert.ok(doc.series.turns.length <= SERIES_CAP);
  assert.equal(doc.series.turns[doc.series.turns.length - 1], SERIES_CAP + 40, "newest sample kept");
  assert.equal(doc.series.by["0"].set.length, doc.series.turns.length);
}

// Migration (Emigration mod): kept for the local player, padded when the mod arrived late, trimmed
// with the rest of the series.
{
  const doc = fresh();
  ensureAge(doc, "AGE_ANTIQUITY", 1);
  appendSample(doc, world(1, { 0: pstate() }));
  appendSample(doc, world(2, { 0: pstate({ mig: { i: 50, o: 10 } }) }));
  appendSample(doc, world(3, { 0: pstate({ mig: { i: 80, o: 10 } }) }));
  appendSample(doc, world(3, { 0: pstate({ mig: { i: 90, o: 20 } }) }));
  assert.deepEqual([doc.series.by["0"].mi, doc.series.by["0"].mo], [[50, 50, 90], [10, 10, 20]],
    "padded with the first reading (no movement) and a same-turn sample replaced");
  for (let t = 4; t <= SERIES_CAP + 40; t++) appendSample(doc, world(t, { 0: pstate({ mig: { i: 90 + t, o: 20 } }) }));
  assert.equal(doc.series.by["0"].mi.length, doc.series.turns.length, "decimated in step with the turns");
  assert.equal(doc.series.by["0"].mi[doc.series.by["0"].mi.length - 1], 90 + SERIES_CAP + 40);
}

// Triumphs held before recording began count: the engine's per-age list is the truth, summed over
// ages, and never below what the chronicle recorded.
{
  const doc = fresh();
  noteTriumphs(doc, 0, world(70, { 0: pstate({ triumphs: ["A", "B", "C"] }), 1: pstate() }));
  noteTriumphs(doc, 0, world(71, { 0: pstate({ triumphs: ["A", "B"] }), 1: pstate() }));
  noteTriumphs(doc, 1, world(1, { 0: pstate({ triumphs: ["D"] }), 1: pstate({ triumphs: ["E"] }) }));
  appendEvents(doc, [{ t: 2, a: 1, k: "triumph", p: 1 }, { t: 3, a: 1, k: "triumph", p: 1 }]);
  assert.deepEqual(triumphCounts(doc), { 0: 4, 1: 2 });
}

// Outcome: a team win for the local player is a victory; a rival's is a defeat.
{
  const teamOf = (pid) => (pid === 4 ? 0 : pid);
  const a = fresh();
  applyOutcome(a, [{ t: 300, a: 2, k: "victory", p: 4, x: "VICTORY_SCIENCE_MODERN" }], teamOf);
  assert.equal(a.outcome.status, "victory");
  const b = fresh();
  applyOutcome(b, [{ t: 300, a: 2, k: "victory", p: 3, x: "VICTORY_CULTURE_MODERN", n: "LOC_V" }], teamOf);
  assert.deepEqual(b.outcome, { status: "defeat", victory: "VICTORY_CULTURE_MODERN", name: "LOC_V", winner: 3, turn: 300 });
  const c = fresh();
  applyOutcome(c, [{ t: 90, a: 1, k: "elim", p: 0 }], teamOf);
  assert.equal(c.outcome.status, "defeat");
}

console.log("history-campaign harness passed");
