// computeChartTurn takes the loaded history as its third argument and never reads storage itself.
import assert from "node:assert/strict";
import fs from "node:fs";
import { computeChartTurn } from "/demographics/ui/sampler/sampler-chart-turn.js";

const src = fs.readFileSync(new URL("../ui/sampler/sampler-chart-turn.js", import.meta.url), "utf8");
assert.equal(/demographics-storage/.test(src), false, "the module has no storage import");
assert.equal(computeChartTurn.length, 3, "history is a declared parameter");

// Empty or absent history: the chart turn is the age-local turn (at least 1).
assert.equal(computeChartTurn("AGE_ANTIQUITY", 7, { samples: [] }), 7);
assert.equal(computeChartTurn("AGE_ANTIQUITY", 0, { samples: [] }), 1);
assert.equal(computeChartTurn("AGE_ANTIQUITY", -3, { samples: [] }), 1);
assert.equal(computeChartTurn("AGE_ANTIQUITY", 5, null), 5);
assert.equal(computeChartTurn("AGE_ANTIQUITY", 5, undefined), 5);

// A non-array `samples` counts as empty.
assert.equal(computeChartTurn("AGE_ANTIQUITY", 9, { samples: "nope" }), 9);
assert.equal(computeChartTurn("AGE_ANTIQUITY", 9, { samples: { length: 3 } }), 9);

// Same-age continuation: spacing follows the local-turn delta.
const antiquity = {
  samples: [
    { age: "AGE_ANTIQUITY", turn: 10, localTurn: 10, chartTurn: 10 },
    { age: "AGE_ANTIQUITY", turn: 12, localTurn: 12, chartTurn: 12 }
  ]
};
assert.equal(computeChartTurn("AGE_ANTIQUITY", 15, antiquity), 15);
assert.equal(computeChartTurn("AGE_ANTIQUITY", 12, antiquity), 12, "a repeat turn keeps the chart turn");
assert.equal(computeChartTurn("AGE_ANTIQUITY", 11, antiquity), 13, "a backwards local turn still advances by one");

// Age change: the new age's local turn is added on top of the last chart turn.
const lateAntiquity = {
  samples: [{ age: "AGE_ANTIQUITY", turn: 60, localTurn: 60, chartTurn: 60 }]
};
assert.equal(computeChartTurn("AGE_EXPLORATION", 1, lateAntiquity), 61);
assert.equal(computeChartTurn("AGE_EXPLORATION", 3, lateAntiquity), 63);
assert.equal(computeChartTurn("AGE_EXPLORATION", 0, lateAntiquity), 61, "advances by at least one");

// A last sample without chartTurn falls back to its turn; without a usable local turn it is an age change.
assert.equal(computeChartTurn("AGE_ANTIQUITY", 4, { samples: [{ age: "AGE_ANTIQUITY", turn: 3 }] }), 4);
assert.equal(computeChartTurn("AGE_ANTIQUITY", 4, { samples: [{ age: "AGE_ANTIQUITY" }] }), 4);

// Same samples, same answer: the history argument carries everything the old fallback load read.
const copy = JSON.parse(JSON.stringify(antiquity));
assert.equal(computeChartTurn("AGE_ANTIQUITY", 20, copy), computeChartTurn("AGE_ANTIQUITY", 20, antiquity));

console.log("sampler-chart-turn harness passed");
