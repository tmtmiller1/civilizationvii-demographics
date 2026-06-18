import assert from "node:assert/strict";

// Crisis "loss" figures (population/crop/production) are sums of per-turn declines, so they need
// dense samples. As old samples decimate, recomputing them from the thinned stream collapses to
// "—". The fix snapshots the per-civ cumulative crisis cost at the age boundary (while dense) so
// the Crises page renders a finished age from the snapshot. These are pure off-engine.
import {
  buildAgeCrisisCols,
  mergeAgeCols
} from "/demographics/ui/screen-demographics/charts/crises/crisis-cost-model.js";
import { _snapshotCrisisCost } from "/demographics/ui/sampler/sampler-age-boundary.js";

const AGE = "AGE_ANTIQUITY";

/**
 * One Antiquity sample: a single player (pid 7) reporting a crisis stage and raw population.
 * @param {number} turn Age-local turn.
 * @param {number} stage Crisis display stage.
 * @param {number} pop Raw population.
 * @returns {object} The sample.
 */
function S(turn, stage, pop) {
  return {
    turn,
    age: AGE,
    players: {
      7: {
        metrics: { crisis_stage: stage, populationRaw: pop },
        leaderTypeString: "LEADER_HATSHEPSUT",
        primaryColor: "#abcdef"
      }
    }
  };
}

// Dense crisis: onset at T2, then population bleeds 1000 → 900 → 800 (two declines of 100).
const DENSE = [S(1, 0, 1000), S(2, 1, 1000), S(3, 1, 900), S(4, 1, 800), S(5, 1, 800)];

function testDenseSamplesYieldRealLosses() {
  const cols = buildAgeCrisisCols(DENSE);
  const c = cols.find((x) => x.pid === 7);
  assert.ok(c, "player 7 present");
  assert.equal(c.cost.popLost, 200); // 100 + 100 summed declines
  assert.equal(c.leaderType, "LEADER_HATSHEPSUT"); // identity captured for snapshot rendering
  assert.equal(c.color, "#abcdef");
}

function testDecimationBlanksTheLossLive() {
  // Heavily decimated: only the onset stage-1 sample survives in the window → < 2 points → null
  // ("—" in the table). This is exactly the symptom the snapshot fixes.
  const sparse = [S(1, 0, 1000), S(5, 1, 800)];
  const cols = buildAgeCrisisCols(sparse);
  const c = cols.find((x) => x.pid === 7);
  assert.ok(c, "player 7 still present (identity survives)");
  // The loss can no longer be summed (< 2 points): the figure is blank , null/absent, which the
  // cost table renders as "—". (mergeCost drops a null figure, so the key is simply absent.)
  assert.ok(c.cost.popLost == null, "popLost is blank under decimation");
}

function testSnapshotPersistsDenseTotals() {
  // Mirrors the age boundary: snapshot while dense, then heavily decimate.
  const h = { samples: DENSE.slice() };
  _snapshotCrisisCost(h, AGE);
  assert.ok(h.crisisSnapshots && h.crisisSnapshots[AGE], "snapshot stored for the finished age");
  const snapCol = h.crisisSnapshots[AGE].find((x) => x.pid === 7);
  assert.equal(snapCol.cost.popLost, 200); // frozen at the dense value, survives later decimation
}

function testMergeAgeColsSumsAcrossAges() {
  const antiquity = [{ pid: 7, leaderType: "LEADER_HATSHEPSUT", color: "#abcdef", cost: { popLost: 200 } }];
  const exploration = [{ pid: 7, cost: { popLost: 50 } }];
  const merged = mergeAgeCols([antiquity, exploration]);
  const col = merged.find((c) => c.entry.pid === 7);
  assert.equal(col.cost.popLost, 250); // summed across ages
  assert.equal(col.entry.leaderType, "LEADER_HATSHEPSUT"); // identity from the first age set
}

testDenseSamplesYieldRealLosses();
testDecimationBlanksTheLossLive();
testSnapshotPersistsDenseTotals();
testMergeAgeColsSumsAcrossAges();

console.log("crisis-cost-snapshot harness passed");
