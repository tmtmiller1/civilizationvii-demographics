import assert from "node:assert/strict";

import { computeNodeBaselines } from "/demographics/ui/sampler/sampler-collectors-economy.js";

// History grows forward only: while sampling age N, the persisted stream holds
// samples from ages <= N. Stored techs/civics are already cumulative.

const antiquity = [
  { age: "AGE_ANTIQUITY", players: { 0: { metrics: { techs: 2, civics: 1 } } } },
  { age: "AGE_ANTIQUITY", players: { 0: { metrics: { techs: 5, civics: 3 } } } }
];
const throughExploration = [
  ...antiquity,
  { age: "AGE_EXPLORATION", players: { 0: { metrics: { techs: 7, civics: 4 } } } }
];

function testFirstAgeHasNoBaseline() {
  // In Antiquity the only prior samples ARE Antiquity, so they're excluded.
  const b = computeNodeBaselines(antiquity, "AGE_ANTIQUITY");
  assert.deepEqual(b[0] ?? { techs: 0, civics: 0 }, { techs: 0, civics: 0 });
}

function testBaselineIsPriorAgeMax() {
  // Sampling in Exploration: baseline = Antiquity's final (max) cumulative count.
  const b = computeNodeBaselines(throughExploration, "AGE_EXPLORATION");
  assert.deepEqual(b[0], { techs: 5, civics: 3 });
}

function testBaselineSpansAllPriorAges() {
  // Sampling in Modern: baseline = max across Antiquity + Exploration (the
  // Exploration value is already cumulative through Antiquity).
  const b = computeNodeBaselines(throughExploration, "AGE_MODERN");
  assert.deepEqual(b[0], { techs: 7, civics: 4 });
}

function testDecimationRobustViaMax() {
  // If the LAST Antiquity sample is decimated away, the max of the survivors is
  // used (never a later/lower value), so the baseline only ever under-reports
  // slightly rather than collapsing.
  const survivors = [
    { age: "AGE_ANTIQUITY", players: { 0: { metrics: { techs: 5, civics: 3 } } } },
    { age: "AGE_ANTIQUITY", players: { 0: { metrics: { techs: 4, civics: 2 } } } }
  ];
  const b = computeNodeBaselines(survivors, "AGE_EXPLORATION");
  assert.deepEqual(b[0], { techs: 5, civics: 3 });
}

function testUntaggedLegacySamplesIgnored() {
  const withLegacy = [
    { players: { 0: { metrics: { techs: 999, civics: 999 } } } },
    ...antiquity
  ];
  const b = computeNodeBaselines(withLegacy, "AGE_EXPLORATION");
  assert.deepEqual(b[0], { techs: 5, civics: 3 });
}

function testToleratesBadInput() {
  assert.deepEqual(computeNodeBaselines(undefined, "AGE_EXPLORATION"), {});
  assert.deepEqual(computeNodeBaselines(throughExploration, undefined), {});
  assert.deepEqual(computeNodeBaselines([null, {}, { age: 5 }], "AGE_EXPLORATION"), {});
}

testFirstAgeHasNoBaseline();
testBaselineIsPriorAgeMax();
testBaselineSpansAllPriorAges();
testDecimationRobustViaMax();
testUntaggedLegacySamplesIgnored();
testToleratesBadInput();

console.log("node-baselines harness passed");
