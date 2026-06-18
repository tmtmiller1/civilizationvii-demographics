import assert from "node:assert/strict";

// War rosters must name each belligerent by the civ they WERE when the war happened, not the
// player's current-age civ (a player is Han in Antiquity but Qajar in Modern; history persists
// across ages). migrateWarRecords re-derives civ identity from the recorded sample at the war's
// start chart-turn. Engine globals are absent here, so pidInfo falls back to the snapshot , the
// deterministic path asserted below.
import { migrateWarRecords } from "/demographics/ui/sampler/sampler-wars-augment.js";

const HAN = { civName: "Han", civTypeString: "CIVILIZATION_HAN" };
const QAJAR = { civName: "Qajar", civTypeString: "CIVILIZATION_QAJAR" };
const ROME = { civName: "Rome", civTypeString: "CIVILIZATION_ROME" };

// Current (Modern-age) snapshot: player 7 is now Qajar, player 3 still Rome.
const NOW = { players: { 7: QAJAR, 3: ROME } };

/** Samples: player 7 was Han at the war's start (chartTurn 5), Qajar by the Modern era. */
const SAMPLES = [
  { chartTurn: 5, players: { 7: { ...HAN }, 3: { ...ROME } } },
  { chartTurn: 200, players: { 7: { ...QAJAR }, 3: { ...ROME } } }
];

/**
 * A war record whose side-A roster was (wrongly) stamped with the current-age civ, as an older
 * build would have left an existing save.
 * @returns {object} The war record.
 */
function corruptedWar() {
  return {
    warUniqueID: 1,
    name: "War",
    startTurn: 5,
    startChartTurn: 5,
    endTurn: 9,
    sideA: [7],
    sideB: [3],
    sideACivs: [{ pid: 7, civ: "Qajar", civTypeString: "CIVILIZATION_QAJAR", joinTurn: 5, active: true }],
    sideBCivs: [{ pid: 3, civ: "Rome", civTypeString: "CIVILIZATION_ROME", joinTurn: 5, active: true }]
  };
}

function testHealsExistingRosterToStartAgeCiv() {
  const w = corruptedWar();
  migrateWarRecords(NOW, [w], SAMPLES);
  assert.equal(w.sideACivs[0].civ, "Han"); // re-derived from the start sample, not current Qajar
  assert.equal(w.sideACivs[0].civTypeString, "CIVILIZATION_HAN");
  assert.equal(w.sideBCivs[0].civ, "Rome"); // unchanged civ stays correct
}

function testLegacyBackfillUsesStartAgeCiv() {
  // No per-entry history (sideACivs absent) → rebuilt from pids; still pinned to the start age.
  const w = { warUniqueID: 2, name: "War", startTurn: 5, startChartTurn: 5, endTurn: 9, sideA: [7], sideB: [3] };
  migrateWarRecords(NOW, [w], SAMPLES);
  assert.equal(w.sideACivs[0].civ, "Han");
  assert.equal(w.sideACivs[0].civTypeString, "CIVILIZATION_HAN");
}

function testPicksNearestSampleAtOrBeforeStart() {
  // Start chart-turn 5 with samples at 3 (Han) and 10 (Qajar) → the 3 (≤ 5) sample wins.
  const samples = [
    { chartTurn: 3, players: { 7: { ...HAN } } },
    { chartTurn: 10, players: { 7: { ...QAJAR } } }
  ];
  const w = corruptedWar();
  migrateWarRecords(NOW, [w], samples);
  assert.equal(w.sideACivs[0].civTypeString, "CIVILIZATION_HAN");
}

function testGracefulWhenNoStartSample() {
  // No samples (or none at/ before start) → fall back to the snapshot civ; never throws.
  const w = corruptedWar();
  migrateWarRecords(NOW, [w], []);
  assert.equal(w.sideACivs[0].civ, "Qajar"); // nothing to heal from → current value stands
  const w2 = corruptedWar();
  migrateWarRecords(NOW, [w2], [{ chartTurn: 99, players: { 7: { ...QAJAR } } }]); // only AFTER start
  assert.equal(w2.sideACivs[0].civTypeString, "CIVILIZATION_QAJAR");
}

testHealsExistingRosterToStartAgeCiv();
testLegacyBackfillUsesStartAgeCiv();
testPicksNearestSampleAtOrBeforeStart();
testGracefulWhenNoStartSample();

console.log("wars-civ-naming harness passed");
