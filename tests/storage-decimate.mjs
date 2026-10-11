import assert from "node:assert/strict";

import DemographicsStorage from "/demographics/ui/storage/demographics-storage.js";

function testMaybeDecimatePreservesBoundaryAndLatestWindow() {
  const history = {
    version: 1,
    seed: "unit-test",
    eliminated: {},
    ageBoundaries: [
      { age: "AGE_EXPLORATION", turn: 100 },
      { age: "AGE_MODERN", turn: 200 }
    ],
    samples: Array.from({ length: 260 }, (_, i) => ({ turn: i + 1 }))
  };
  const eff = { cap: 1000, source: "test" };
  const ctx = { _noteDecimation() {} };

  DemographicsStorage._maybeDecimate.call(ctx, history, eff);

  const turns = new Set(history.samples.map((s) => s.turn));
  assert.ok(turns.has(100), "decimation must preserve age-boundary turns");
  for (let t = 200; t <= 260; t++) {
    assert.ok(turns.has(t), "decimation must preserve every sample in latest age window");
  }
}

testMaybeDecimatePreservesBoundaryAndLatestWindow();
console.log("storage-decimate harness passed");
