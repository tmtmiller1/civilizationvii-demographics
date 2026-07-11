import assert from "node:assert/strict";

import {
  CRISIS_METRICS,
  COST_KEY_MODE,
  crisisParticipants,
  groupCrises,
  mergeAgeCols,
  mergeCost,
  participantIdentity,
  toTableCols
} from "/demographics/ui/screen-demographics/charts/crises/crisis-cost-model.js";

assert.ok(CRISIS_METRICS.every((m) => m.id !== "warProdCum" && m.id !== "razedCum"));
assert.equal(COST_KEY_MODE.milPower, "level");
assert.equal(COST_KEY_MODE.popLost, "losses");

function testCrisisParticipantsOrderAndBounds() {
  const samples = [
    { turn: 1, players: { 7: {}, 3: {} } },
    { turn: 2, players: { 3: {}, 9: {} } },
    { turn: 3, players: { 11: {} } },
    { turn: 4, players: { 13: {} } }
  ];
  const cols = crisisParticipants(samples, 1, 3);
  assert.deepEqual(cols.map((c) => c.pid), [3, 7, 9, 11]);
}

function testGroupCrisesSplitsOnStageAndAgeChange() {
  const segments = [
    { stage: 2, start: 1, end: 2, sample: { age: "A" } },
    { stage: 3, start: 2, end: 3, sample: { age: "A" } },
    { stage: 1, start: 4, end: 5, sample: { age: "A" } },
    { stage: 2, start: 5, end: 6, sample: { age: "A" } },
    { stage: 2, start: 1, end: 2, sample: { age: "B" } },
    { stage: 3, start: 2, end: 4, sample: { age: "B" } }
  ];
  const groups = groupCrises(segments);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].segments.length, 2);
  assert.equal(groups[1].segments.length, 2);
  assert.equal(groups[2].segments.length, 2);
  assert.equal(groups[0].age, "A");
  assert.equal(groups[2].age, "B");
}

function testMergeCostHandlesLevelAndSummedMetrics() {
  const acc = { milPower: 10, popLost: 5 };
  mergeCost(acc, {
    milPower: 18,
    popLost: 7,
    cropLost: 4,
    prodLost: Infinity,
    unitsLost: NaN,
    weird: "x"
  });
  assert.equal(acc.milPower, 18);
  assert.equal(acc.popLost, 12);
  assert.equal(acc.cropLost, 4);
  assert.ok(!Object.prototype.hasOwnProperty.call(acc, "prodLost"));
  assert.ok(!Object.prototype.hasOwnProperty.call(acc, "unitsLost"));
}

function testParticipantIdentityUsesLatestValidSampleAndFallback() {
  const samples = [
    { players: { 7: { leaderTypeString: 123, primaryColor: 456 } } },
    { players: { 7: { leaderTypeString: "LEADER_LATEST", primaryColor: "#aabbcc" } } }
  ];
  assert.deepEqual(participantIdentity(7, samples), {
    leaderType: "LEADER_LATEST",
    color: "#aabbcc"
  });
  assert.deepEqual(participantIdentity(99, samples), {
    leaderType: undefined,
    color: undefined
  });
}

function testTableColHelpers() {
  const cols = [
    { pid: 7, leaderType: "LEADER_X", color: "#123456", cost: { milPower: 9, popLost: 2 } },
    { pid: 7, leaderType: "LEADER_X", color: "#123456", cost: { milPower: 4, cropLost: 6 } },
    { pid: 9, leaderType: "LEADER_Y", color: "#abcdef", cost: { milPower: 2, popLost: 1 } }
  ];
  const tableCols = toTableCols(cols);
  assert.equal(tableCols.length, 3);
  assert.deepEqual(tableCols[0], {
    entry: { pid: 7, leaderType: "LEADER_X", color: "#123456" },
    cs: null,
    cost: { milPower: 9, popLost: 2 }
  });

  const merged = mergeAgeCols([
    cols.slice(0, 2),
    null,
    [cols[2]]
  ]);
  assert.equal(merged.length, 2);
  const mergedSeven = merged.find((c) => c.entry.pid === 7);
  assert.equal(mergedSeven.cost.milPower, 4);
  assert.equal(mergedSeven.cost.popLost, 2);
  assert.equal(mergedSeven.cost.cropLost, 6);
  const mergedNine = merged.find((c) => c.entry.pid === 9);
  assert.equal(mergedNine.cost.milPower, 2);
  assert.equal(mergedNine.cost.popLost, 1);
  assert.deepEqual(mergeAgeCols(null), []);
  assert.deepEqual(toTableCols(null), []);
}

testCrisisParticipantsOrderAndBounds();
testGroupCrisesSplitsOnStageAndAgeChange();
testMergeCostHandlesLevelAndSummedMetrics();
testParticipantIdentityUsesLatestValidSampleAndFallback();
testTableColHelpers();

console.log("crisis-cost-branches harness passed");