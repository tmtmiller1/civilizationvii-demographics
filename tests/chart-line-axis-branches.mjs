import assert from "node:assert/strict";

import {
  buildTurnMaps,
  computeAgeOffsets,
  makeAxisFormatters,
  sampleX
} from "/demographics/ui/screen-demographics/charts/line/chart-line-axis.js";
import { setXAxisMode } from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";

const savedGame = globalThis.Game;

function samples() {
  return [
    { age: "AGE_ANTIQUITY", localTurn: 1, turn: 1, gameYear: "4000 BCE" },
    { age: "AGE_ANTIQUITY", localTurn: 5, turn: 5, gameYear: "3600 BCE" },
    { age: "AGE_EXPLORATION", localTurn: 1, turn: 1, gameYear: "500 CE" },
    { age: "AGE_EXPLORATION", localTurn: 3, turn: 3, gameYear: "600 CE" }
  ];
}

function testOffsetsAndSampleX() {
  const { offsets, maxLocalByAge } = computeAgeOffsets(samples(), []);
  assert.equal(offsets.get("AGE_ANTIQUITY"), 0);
  assert.equal(offsets.get("AGE_EXPLORATION"), 5);
  assert.equal(maxLocalByAge.get("AGE_EXPLORATION"), 3);

  assert.equal(sampleX({ age: "AGE_EXPLORATION", localTurn: 2 }, offsets, []), 7);
  assert.equal(sampleX({ turn: 12 }, offsets, []), 12, "fallback to raw turn should work");
}

function testTurnMapsAndFormatters() {
  const { offsets, maxLocalByAge } = computeAgeOffsets(samples(), []);
  globalThis.Game = { turn: 3, getTurnDate: () => "700 CE" };
  const maps = buildTurnMaps(samples(), offsets, []);
  assert.equal(maps.turnYearMap.get(8), "700 CE", "live turn should be offset into current age domain");

  const metricMeta = {
    format: (v) => {
      if (v === 99) throw new Error("fmt boom");
      return "V:" + v;
    }
  };
  const f = makeAxisFormatters(maps, metricMeta, offsets, maxLocalByAge);

  setXAxisMode("turn");
  assert.equal(f.fmtX(1), "A1");
  setXAxisMode("year");
  assert.equal(f.fmtX(1), "4000 BCE");
  setXAxisMode("both");
  assert.ok(f.fmtX(1).includes("A1"));

  assert.equal(f.fmtY(10), "V:10");
  assert.equal(f.fmtY(99), "99", "format throw should fall back to numeric formatter");
}

try {
  testOffsetsAndSampleX();
  testTurnMapsAndFormatters();
  console.log("chart-line-axis-branches harness passed");
} finally {
  globalThis.Game = savedGame;
}
