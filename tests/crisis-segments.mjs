import assert from "node:assert/strict";

import {
  ageLastTurns,
  crisisStageOnsets,
  crisisStageSegments,
  sampleAgeKey
} from "/demographics/ui/screen-demographics/charts/crises/crisis-stage-data.js";

const A = "AGE_ANTIQUITY";
const E = "AGE_EXPLORATION";

/**
 * Build a sample whose single player reports `stage` as its crisis stage.
 * @param {string} age Age key.
 * @param {number} turn Age-local turn.
 * @param {number} stage Display crisis stage.
 * @returns {object} The sample.
 */
function crisisSample(age, turn, stage) {
  return { age, turn, players: { 0: { metrics: { crisis_stage: stage } } } };
}

function testSampleAgeKeyNormalizesLegacy() {
  assert.equal(sampleAgeKey({ age: E }), E);
  assert.equal(sampleAgeKey({}), A, "untagged sample reads as Antiquity");
  assert.equal(sampleAgeKey(null), A);
}

function testAgeLastTurns() {
  const samples = [
    { age: A, turn: 10 },
    { age: A, turn: 40 },
    { age: E, turn: 3 },
    { age: E, turn: 5 },
    { turn: 25 } // untagged -> Antiquity
  ];
  const m = ageLastTurns(samples);
  assert.equal(m.get(A), 40);
  assert.equal(m.get(E), 5);
}

function testFinalAntiquitySegmentBoundedToItsAge() {
  // Antiquity crisis stages 2,3,4; the game has since advanced to Exploration,
  // whose turns RESET (latest turn is now a small number). The final Antiquity
  // segment must end at Antiquity's last turn (40), NOT the global latest (5) -
  // otherwise its [start=30, end=5] window inverts and the section goes empty.
  const onsets = [
    { stage: 2, turn: 10, sample: { age: A } },
    { stage: 3, turn: 20, sample: { age: A } },
    { stage: 4, turn: 30, sample: { age: A } }
  ];
  const ageLast = new Map([[A, 40], [E, 5]]);
  const segs = crisisStageSegments(onsets, 5, ageLast);
  assert.deepEqual(segs.map((s) => s.end), [20, 30, 40]);
  for (const s of segs) assert.ok(s.end >= s.start, "no inverted window");
}

function testCrossAgeBoundaryUsesNextOnsetWithinAgeOnly() {
  // Antiquity stage 3 is followed by an EXPLORATION stage-2 onset. The Antiquity
  // segment must NOT borrow the Exploration onset's (reset) turn as its end; it
  // ends at Antiquity's last turn. The Exploration segment runs to its own age end.
  const onsets = [
    { stage: 3, turn: 20, sample: { age: A } },
    { stage: 2, turn: 4, sample: { age: E } }
  ];
  const ageLast = new Map([[A, 35], [E, 9]]);
  const segs = crisisStageSegments(onsets, 9, ageLast);
  assert.equal(segs[0].end, 35, "antiquity segment bounded to antiquity end");
  assert.equal(segs[1].end, 9, "exploration segment runs to exploration end");
}

function testFallsBackToLatestWhenNoAgeMap() {
  const onsets = [{ stage: 2, turn: 10, sample: { age: A } }];
  const segs = crisisStageSegments(onsets, 99);
  assert.equal(segs[0].end, 99);
}

function testLingeringStageDoesNotSpawnPhantomCrisis() {
  // Antiquity climbs 0->1->2->3; Exploration's first samples STILL read 3
  // (lingering from the old age) before the engine resets to pre-crisis (0) and
  // a genuine Exploration crisis (1, 2) begins on its own reset turn numbers.
  const samples = [
    crisisSample(A, 1, 0),
    crisisSample(A, 2, 1),
    crisisSample(A, 3, 2),
    crisisSample(A, 4, 3),
    crisisSample(E, 1, 3), // lingering — must NOT count as an onset
    crisisSample(E, 2, 3),
    crisisSample(E, 3, 0), // pre-crisis confirmed -> armed
    crisisSample(E, 4, 1), // genuine Exploration onset
    crisisSample(E, 5, 2)
  ];
  const onsets = crisisStageOnsets(samples);
  const explore = onsets.filter((o) => o.sample.age === E);
  assert.deepEqual(explore.map((o) => o.stage), [1, 2], "only genuine Exploration onsets");
  assert.deepEqual(explore.map((o) => o.turn), [4, 5]);
  assert.ok(!explore.some((o) => o.turn <= 2), "lingering stage spawned no phantom onset");
  // Antiquity detection is unaffected (first age stays armed).
  const anti = onsets.filter((o) => o.sample.age === A);
  assert.deepEqual(anti.map((o) => o.stage), [1, 2, 3]);
}

function testFirstAgeArmedWithoutPreCrisisZero() {
  // Even if the earliest retained Antiquity sample is already mid-crisis (early
  // pre-crisis samples decimated away), the first age stays armed so its crisis
  // is still detected.
  const samples = [crisisSample(A, 10, 2), crisisSample(A, 11, 3)];
  const onsets = crisisStageOnsets(samples);
  assert.deepEqual(onsets.map((o) => o.stage), [2, 3]);
}

testSampleAgeKeyNormalizesLegacy();
testAgeLastTurns();
testLingeringStageDoesNotSpawnPhantomCrisis();
testFirstAgeArmedWithoutPreCrisisZero();
testFinalAntiquitySegmentBoundedToItsAge();
testCrossAgeBoundaryUsesNextOnsetWithinAgeOnly();
testFallsBackToLatestWhenNoAgeMap();

console.log("crisis-segments harness passed");
