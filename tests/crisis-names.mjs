import assert from "node:assert/strict";

import { flavorCrisisName } from "/demographics/ui/screen-demographics/charts/crises/crisis-names.js";

function testFlavorCrisisNameDeterministic() {
  const sample = {
    age: "AGE_EXPLORATION",
    crisisEventType: "EXPLORATION_CRISIS_RELIGION"
  };
  const seed = "fixed-seed-42";
  const first = flavorCrisisName(sample, 2, seed);
  const second = flavorCrisisName(sample, 2, seed);
  assert.equal(first, second, "flavorCrisisName must be deterministic for identical inputs");
}

testFlavorCrisisNameDeterministic();
console.log("crisis-names harness passed");
