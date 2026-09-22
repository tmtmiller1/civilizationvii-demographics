import assert from "node:assert/strict";
import { diffWorld, diffCities, diffWars, warPairs } from "/demographics/ui/history/capture/history-diff.js";
import { pstate, world, NAMER } from "./_history-fixtures.mjs";

const ctx = { ageIdx: 0, local: 0, names: NAMER };
const kinds = (evs) => evs.map((e) => e.k).sort();

// Baseline: the first reading of a campaign produces nothing.
assert.deepEqual(diffWorld(null, world(1, { 0: pstate() }), ctx), []);

// Founding, capture (keyed by location), razing.
{
  const a = world(5, { 0: pstate({ cities: { "1,1": "Roma" } }), 1: pstate({ cities: { "9,9": "Memphis", "8,8": "Thebes" } }) });
  const b = world(6, {
    0: pstate({ cities: { "1,1": "Roma", "2,2": "Antium", "9,9": "Memphis" } }),
    1: pstate({ cities: {} })
  });
  const evs = diffCities(a, b, 0);
  assert.deepEqual(kinds(evs), ["capture", "found", "razed"]);
  const cap = evs.find((e) => e.k === "capture");
  assert.equal(cap.p, 0);
  assert.equal(cap.q, 1);
  assert.equal(cap.n, "Memphis");
  assert.equal(cap.t, 6);
  assert.equal(cap.d, "T6");
  assert.equal(evs.find((e) => e.k === "razed").q, 1);
}

// A wonder is announced once, even when it changes hands with its city.
{
  const a = world(5, { 0: pstate(), 1: pstate({ wonders: ["WONDER_PYRAMIDS"] }) });
  const b = world(6, { 0: pstate({ wonders: ["WONDER_PYRAMIDS", "WONDER_COLOSSUS"] }), 1: pstate() });
  const evs = diffWorld(a, b, ctx).filter((e) => e.k === "wonder");
  assert.equal(evs.length, 1);
  assert.equal(evs[0].x, "WONDER_COLOSSUS");
  assert.equal(evs[0].n, "LOC_WONDER_COLOSSUS_NAME");
}

// Triumphs, religions, first contact, elimination.
{
  const a = world(5, { 0: pstate({ triumphs: ["L1"] }), 1: pstate({ met: false }), 2: pstate() });
  const b = world(6, {
    0: pstate({ triumphs: ["L1", "L2"], religion: "LOC_RELIGION_X" }),
    1: pstate({ met: true }),
    2: pstate({ alive: false })
  });
  const evs = diffWorld(a, b, ctx);
  assert.deepEqual(kinds(evs), ["elim", "met", "religion", "triumph"]);
  assert.equal(evs.find((e) => e.k === "triumph").x, "L2");
  assert.equal(evs.find((e) => e.k === "met").p, 1);
}

// Wars are unordered pairs; peace only when both sides still live.
{
  assert.deepEqual([...warPairs(world(1, { 0: pstate({ wars: [3] }), 3: pstate({ wars: [0] }) }))], ["0:3"]);
  const a = world(5, { 0: pstate({ wars: [1, 2] }), 1: pstate({ wars: [0] }), 2: pstate({ wars: [0] }) });
  const b = world(6, { 0: pstate({ wars: [] }), 1: pstate(), 2: pstate({ alive: false }) });
  const evs = diffWars(a, b, 0);
  assert.equal(evs.length, 1, "no peace with a destroyed civilization");
  assert.equal(evs[0].k, "peace");
  assert.deepEqual([evs[0].p, evs[0].q], [0, 1]);
  const c = world(7, { 0: pstate({ wars: [1] }), 1: pstate({ wars: [0] }) });
  assert.equal(diffWars(b, c, 0)[0].k, "war");
}

// Age change: only the age, civilization changes and eliminations; no invented peace or captures.
{
  const a = world(150, { 0: pstate({ wars: [1], cities: { "1,1": "Roma" } }), 1: pstate({ wars: [0] }), 2: pstate() });
  const b = world(1, {
    0: pstate({ civ: "CIVILIZATION_NORMAN", cities: {} }),
    1: pstate({ civ: "CIVILIZATION_SPAIN" }),
    2: pstate({ alive: false })
  }, { age: "AGE_EXPLORATION" });
  const evs = diffWorld(a, b, { ...ctx, ageIdx: 1 });
  assert.deepEqual(kinds(evs), ["age", "civ", "civ", "elim"]);
  assert.equal(evs.find((e) => e.k === "age").n, "LOC_AGE_EXPLORATION_NAME");
  assert.ok(evs.every((e) => e.a === 1));
}

// Victory: new claims only, resolved to a player through the team.
{
  const a = world(5, { 0: pstate() }, { victories: [] });
  const b = world(6, { 0: pstate() }, { victories: ["3:VICTORY_SCIENCE_MODERN"] });
  const evs = diffWorld(a, b, ctx).filter((e) => e.k === "victory");
  assert.equal(evs.length, 1);
  assert.equal(evs[0].p, 3);
  assert.equal(evs[0].x, "VICTORY_SCIENCE_MODERN");
  assert.equal(diffWorld(b, b, ctx).length, 0);
}

console.log("history-diff harness passed");
