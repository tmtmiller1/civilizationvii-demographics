// Partisans risings on Demographics' own history: the contract read (absent global, a throwing or
// junk API), per-row validation, the merge into history.risings (new rows, end and outcome updates,
// earlier-age rows, the cap) and the chart-turn placement of raw Game.turn values.
import assert from "node:assert/strict";

const {
  RISINGS_CAP,
  readPartisanRisings,
  validateRising
} = await import("/demographics/ui/core/demographics-risings-contract.js");
const { mergeRisings, runRisingsTracker } = await import("/demographics/ui/sampler/sampler-risings.js");
const { placeRisingTurn, previousAge } = await import("/demographics/ui/sampler/sampler-risings-place.js");

const good = (over = {}) => ({
  id: 1, at: "10,12", name: "Mutsu", owner: 0, cause: "flip", from: 2, ip: 40, start: 50, ...over
});

// The global: absent, wrong version, throwing, non-array, fine.
delete globalThis.__towerPartisans;
assert.equal(readPartisanRisings(), null, "no Partisans: null, not an empty list");
globalThis.__towerPartisans = { apiVersion: 0, risings: () => [good()] };
assert.equal(readPartisanRisings(), null, "an older API version is ignored");
globalThis.__towerPartisans = { apiVersion: 1, risings: () => { throw new Error("boom"); } };
assert.equal(readPartisanRisings(), null, "a throwing API reads as no Partisans");
globalThis.__towerPartisans = { apiVersion: 1, risings: () => "junk" };
assert.equal(readPartisanRisings(), null, "a non-array answer reads as no Partisans");
globalThis.__towerPartisans = { apiVersion: 2, risings: () => [good()] };
assert.deepEqual(readPartisanRisings(), [good()], "a newer API version still works");
globalThis.__towerPartisans = { apiVersion: 1, risings: () => Array.from({ length: 400 }, (_, i) => good({ id: i })) };
assert.equal(readPartisanRisings().length, RISINGS_CAP, "at most the cap, newest kept");
assert.equal(readPartisanRisings()[0].id, 100);
delete globalThis.__towerPartisans;

// Validation: every field is checked.
assert.deepEqual(validateRising(good()), good());
for (const [label, row] of [
  ["null", null],
  ["string", "rising"],
  ["negative id", good({ id: -1 })],
  ["fractional owner", good({ owner: 1.5 })],
  ["bad plot", good({ at: "ten,12" })],
  ["unknown cause", good({ cause: "revolt" })],
  ["empty name", good({ name: "   " })],
  ["name not a string", good({ name: 7 })],
  ["missing start", good({ start: undefined })],
  ["missing ip", good({ ip: null })]
]) {
  assert.equal(validateRising(row), null, label + " is rejected");
}
assert.equal(validateRising(good({ name: "Mu\u0007tsu  " })).name, "Mutsu", "control characters and edges trimmed");
assert.equal(validateRising(good({ name: "x".repeat(200) })).name.length, 80, "long names capped");
assert.equal(validateRising(good({ from: 0 })).from, undefined, "from equal to the owner is dropped");
assert.equal(validateRising(good({ cause: "misery" })).from, undefined, "from only belongs to a flip");
const enclave = validateRising(good({ cause: "enclave", from: undefined, homeland: 3, policy: "TRADITION_X" }));
assert.equal(enclave.homeland, 3);
assert.equal(enclave.policy, "TRADITION_X");
assert.equal(validateRising(good({ cause: "enclave", policy: "<script>" })).policy, undefined, "odd policy dropped");
assert.equal(validateRising(good({ end: 40 })).end, undefined, "an end before the start is dropped");
assert.equal(validateRising(good({ end: 55, outcome: "won" })).outcome, undefined, "unknown outcome dropped");
assert.deepEqual(
  { ...validateRising(good({ end: 55, outcome: "burned" })) },
  { ...good(), end: 55, outcome: "burned" }
);
assert.equal(validateRising(good({ outcome: "burned" })).outcome, undefined, "an outcome needs an end");

// Placement on the chart-turn axis.
const samples = [
  { age: "AGE_ANTIQUITY", localTurn: 90, chartTurn: 90, gameYear: "100 CE" },
  { age: "AGE_ANTIQUITY", localTurn: 100, chartTurn: 100, gameYear: "200 CE" },
  { age: "AGE_EXPLORATION", localTurn: 1, chartTurn: 101, gameYear: "250 CE" },
  { age: "AGE_EXPLORATION", localTurn: 20, chartTurn: 120, gameYear: "400 CE" }
];
const place = { chartTurn: 120, localTurn: 20, age: "AGE_EXPLORATION", gameYear: "400 CE", samples };
assert.deepEqual(placeRisingTurn(20, "AGE_EXPLORATION", place), { chartTurn: 120, year: "400 CE" });
assert.deepEqual(placeRisingTurn(1, "AGE_EXPLORATION", place), { chartTurn: 101, year: "250 CE" });
assert.deepEqual(placeRisingTurn(15, "AGE_EXPLORATION", place), { chartTurn: 115, year: undefined });
assert.deepEqual(placeRisingTurn(95, "AGE_ANTIQUITY", place), { chartTurn: 95, year: undefined }, "earlier age");
assert.deepEqual(placeRisingTurn(100, "AGE_ANTIQUITY", place), { chartTurn: 100, year: "200 CE" });
assert.equal(placeRisingTurn(5, "AGE_MODERN", place), null, "an age with no samples can't be placed");
assert.equal(previousAge(place), "AGE_ANTIQUITY");
assert.equal(previousAge({ ...place, samples: samples.slice(2) }), null);

// Merge: new rows get chart turns, names and policy names; ends update in place.
const ctx = {
  ...place,
  resolveCiv: (pid) => ({ civ: "Civ" + pid, civTypeString: "CIVILIZATION_C" + pid, leader: "Leader" + pid }),
  resolvePolicyName: (type) => "LOC_" + type + "_NAME"
};
let list = mergeRisings(undefined, [good({ id: 5, start: 18 }), null, { id: "x" }], ctx);
assert.equal(list.length, 1, "junk rows skipped");
assert.equal(list[0].startChartTurn, 118);
assert.equal(list[0].lastChartTurn, 120);
assert.equal(list[0].age, "AGE_EXPLORATION");
assert.deepEqual(list[0].ownerCiv, { civ: "Civ0", civTypeString: "CIVILIZATION_C0", leader: "Leader0" });
assert.equal(list[0].otherCiv.civ, "Civ2", "flip: the civ the rebels are loyal to");
assert.equal(list[0].end, undefined);

list = mergeRisings(list, [good({ id: 5, start: 18, end: 19, outcome: "dispersed" })], ctx);
assert.equal(list.length, 1, "keyed by Partisans id");
assert.equal(list[0].end, 19);
assert.equal(list[0].outcome, "dispersed");
assert.equal(list[0].endChartTurn, 119);
assert.equal(list[0].startChartTurn, 118, "the start never moves");

list = mergeRisings(list, [good({ id: 5, start: 18, end: 20, outcome: "burned" })], ctx);
assert.equal(list[0].outcome, "burned", "a changed outcome updates");
assert.equal(list[0].endChartTurn, 120);
assert.equal(list[0].endYear, "400 CE");

// A rising tracked in its own age that ends with the age is closed on that age's samples.
const old = mergeRisings([], [good({ id: 9, start: 95 })], {
  ...ctx, chartTurn: 100, localTurn: 100, age: "AGE_ANTIQUITY", gameYear: "200 CE", samples: samples.slice(0, 2)
});
assert.equal(old[0].startChartTurn, 95);
const closed = mergeRisings(old, [good({ id: 9, start: 95, end: 100, outcome: "age" })], ctx);
assert.equal(closed[0].endChartTurn, 100, "placed against the earlier age's samples");
assert.equal(closed[0].endYear, "200 CE");

// First sight of rows from an earlier age: everything up to the newest "ended with the age" row.
const fresh = mergeRisings([], [
  good({ id: 1, start: 91, end: 93, outcome: "dispersed" }),
  good({ id: 2, start: 96, end: 100, outcome: "age" }),
  good({ id: 3, start: 5, end: 9, outcome: "time" })
], ctx);
assert.deepEqual(fresh.map((r) => r.age), ["AGE_ANTIQUITY", "AGE_ANTIQUITY", "AGE_EXPLORATION"]);
assert.deepEqual(fresh.map((r) => r.startChartTurn), [91, 96, 105]);
assert.deepEqual(fresh.map((r) => r.endChartTurn), [93, 100, 109]);
const lateCtx = { ...ctx, samples: samples.slice(2) };
const unplaced = mergeRisings([], [good({ id: 4, start: 40, end: 45, outcome: "age" })], lateCtx);
assert.equal(unplaced[0].startChartTurn, undefined, "no samples of that age: kept but unplaced");
assert.equal(unplaced[0].endChartTurn, undefined);

// Saved junk is dropped; the cap keeps the newest ids.
const many = Array.from({ length: RISINGS_CAP + 20 }, (_, i) => good({ id: i, start: 10 }));
// Partisans names the age: a running Antiquity rising is placed in Antiquity even with no age change before it in the
// list, and a named age with no samples left stays unplaced.
const named = mergeRisings([], [good({ id: 6, start: 95, age: "AGE_ANTIQUITY" })], ctx);
assert.equal(named[0].age, "AGE_ANTIQUITY");
assert.equal(named[0].startChartTurn, 95);
const namedGone = mergeRisings([], [good({ id: 7, start: 40, age: "AGE_ANTIQUITY" })], lateCtx);
assert.equal(namedGone[0].age, "");
assert.equal(namedGone[0].startChartTurn, undefined);
assert.equal(validateRising(good({ age: "nonsense" })).age, undefined, "an age that isn't an AgeType is dropped");

const capped = mergeRisings([null, "junk", { id: 1 }], many, ctx);
assert.equal(capped.length, RISINGS_CAP);
assert.equal(capped[0].id, 20);

// The tracker: no Partisans adds no key; a junk answer never throws; rows land on the history.
const history = { samples };
const snapshot = { chartTurn: 120, localTurn: 20, age: "AGE_EXPLORATION", gameYear: "400 CE", players: {} };
runRisingsTracker(snapshot, 20, history);
assert.equal("risings" in history, false, "no Partisans, no new save key");
globalThis.__towerPartisans = { apiVersion: 1, risings: () => [] };
runRisingsTracker(snapshot, 20, history);
assert.equal("risings" in history, false, "no risings yet, no new save key");
globalThis.__towerPartisans = { apiVersion: 1, risings: () => [{ id: "bad" }, good({ id: 7, start: 19 })] };
globalThis.Players = { get: () => ({ civilizationName: "LOC_CIV_NAME" }) };
runRisingsTracker(snapshot, 20, history);
assert.equal(history.risings.length, 1);
assert.equal(history.risings[0].startChartTurn, 119);
delete globalThis.__towerPartisans;
runRisingsTracker(snapshot, 20, history);
assert.equal(history.risings.length, 1, "Partisans removed: the saved risings stay");
delete globalThis.Players;

console.log("sampler-risings harness passed");
