import assert from "node:assert/strict";
import { newCrisisState, crisisStep } from "/demographics/ui/history/capture/history-crisis.js";

// Onsets are new highs only; a steady stage is not re-announced.
{
  const st = newCrisisState("AGE_ANTIQUITY");
  assert.deepEqual([0, 0, 1, 1, 2, 2, 3, 4, 4].map((s) => crisisStep(st, "AGE_ANTIQUITY", s)), [0, 0, 1, 0, 2, 0, 3, 4, 0]);
}
// A stage lingering into the next age is not a new crisis; the new age's crisis counts once it
// has reported a pre-crisis reading.
{
  const st = newCrisisState("AGE_ANTIQUITY");
  crisisStep(st, "AGE_ANTIQUITY", 4);
  assert.equal(crisisStep(st, "AGE_EXPLORATION", 4), 0, "lingering stage 4");
  assert.equal(crisisStep(st, "AGE_EXPLORATION", 4), 0);
  assert.equal(crisisStep(st, "AGE_EXPLORATION", 0), 0);
  assert.equal(crisisStep(st, "AGE_EXPLORATION", 1), 1, "the new age's first stage");
}
// Unreadable values change nothing.
{
  const st = newCrisisState("A");
  assert.equal(crisisStep(st, "A", undefined), 0);
  assert.equal(crisisStep(st, "A", 2), 2);
}
console.log("history-crisis harness passed");
