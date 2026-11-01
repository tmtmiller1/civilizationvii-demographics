// One sample pass reads the stored history once and writes it once. The baseline seed, the chart
// turn and the append all work on the object doSample loaded, through the real appendSample.
import assert from "node:assert/strict";

globalThis.engine = { whenReady: Promise.resolve(), on: () => {}, off: () => {} };
globalThis.Loading = { runWhenLoaded: () => {} };
const mk = (id) => ({ id, isMajor: true, isAlive: true });
globalThis.Players = { getAliveMajorIds: () => [1, 2], getAlive: () => [mk(1), mk(2)], get: (id) => mk(id) };
globalThis.Game = { turn: 5, age: 7 };
globalThis.GameInfo = { Ages: { lookup: () => ({ AgeType: "AGE_ANTIQUITY" }) } };
globalThis.Configuration = { getGame: () => ({ startSeed: "SEED-1" }) };

const S = await import("/demographics/ui/sampler/demographics-sampler.js");
const DS = (await import("/demographics/ui/storage/demographics-storage.js")).default;

let history = { version: 1, seed: "SEED-1", samples: [], ageBoundaries: [], eliminated: {}, wars: [] };
let loads = 0;
let saves = 0;
DS.load = () => {
  loads += 1;
  return history;
};
DS.save = (h) => {
  saves += 1;
  history = h;
  return true;
};
// appendSample stays the real one: it must take the pass's history instead of loading again.

const savedError = console.error;
console.error = () => {};
try {
  S.startSampler();
  loads = 0;
  saves = 0;
  const snap = S.sampleNow();
  assert.ok(snap, "the stubbed sample commits");
  assert.equal(loads, 1, "exactly one load per sample pass");
  assert.equal(saves, 1, "exactly one save per sample pass");
  assert.equal(history.samples.length, 1, "the appended sample sits on the loaded object");
  assert.equal(history.samples[0], snap);

  // A second pass on a later turn: still one load, one save, and the chart turn continued from the
  // sample the first pass appended (same age, delta of two turns).
  globalThis.Game.turn = 7;
  loads = 0;
  saves = 0;
  const second = S.sampleNow();
  assert.ok(second);
  assert.equal(loads, 1);
  assert.equal(saves, 1);
  assert.equal(history.samples.length, 2);
  assert.equal(second.chartTurn, snap.chartTurn + 2, "chart turn read from the threaded history");

  // A history for another game is refused by appendSample's seed guard: it loads instead (two loads).
  history = { version: 1, seed: "SEED-2", samples: [], ageBoundaries: [], eliminated: {}, wars: [] };
  loads = 0;
  saves = 0;
  globalThis.Game.turn = 9;
  const third = S.sampleNow();
  assert.ok(third);
  assert.equal(loads, 2, "a history of another seed makes appendSample load again");
  assert.equal(saves, 1);
} finally {
  console.error = savedError;
}

for (const k of ["Players", "Game", "GameInfo", "Configuration", "Loading", "engine"]) delete globalThis[k];
console.log("sampler-single-load harness passed");
