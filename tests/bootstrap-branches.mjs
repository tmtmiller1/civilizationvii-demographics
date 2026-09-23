import assert from "node:assert/strict";

const savedEngine = globalThis.engine;

globalThis.engine = {
  whenReady: Promise.resolve()
};
// Swallow the deferred kickoffs bootstrap's modules schedule, so nothing fires mid-test.
globalThis.Loading = { runWhenLoaded: () => {} };

await import("/demographics/ui/demographics-bootstrap.js");

// Let the whenReady continuation run.
await Promise.resolve();
await Promise.resolve();

assert.ok(true);

// The sampler runtime through the real wiring (bootstrap loaded the same module instance). Flush
// bootstrap's dynamic-import continuations first: its own startSampler() resets the state below.
const S = await import("/demographics/ui/sampler/demographics-sampler.js");
const DS = (await import("/demographics/ui/storage/demographics-storage.js")).default;
await new Promise((r) => setTimeout(r, 300));

let history = { samples: [], wars: [], ageBoundaries: [] };
let saves = 0;
DS.load = () => history;
DS.peek = () => history;
DS.save = () => { saves++; };
DS.appendSample = (snap) => { history.samples.push(snap); return history; };
const handlers = {};
globalThis.engine = {
  whenReady: Promise.resolve(),
  on: (ev, fn) => { handlers[ev] = fn; },
  off: (ev) => { delete handlers[ev]; }
};
const mk = (id) => ({ id, isMajor: true, isAlive: true });
globalThis.Players = { getAliveMajorIds: () => [1, 2], getAlive: () => [mk(1), mk(2)], get: (id) => mk(id) };
globalThis.Game = { turn: 5 };
let seed = "A";
globalThis.Configuration = { getGame: () => ({ startSeed: seed }) };

// Kill switch counts CONSECUTIVE throws: a committed sample zeroes the count.
{
  const savedError = console.error;
  console.error = () => {};
  const boom = () => S.safeCall("test accessor", () => { throw new Error("stale handle"); });
  boom();
  boom();
  assert.equal(S.isSamplerDisabled(), false, "two throws do not trip");
  assert.ok(S.sampleNow(), "a stubbed sample commits");
  assert.equal(history.samples.length, 1);
  boom();
  boom();
  assert.equal(S.isSamplerDisabled(), false, "two errors, a committed sample, two errors: still enabled");
  boom();
  assert.equal(S.isSamplerDisabled(), true, "three throws with no sample between trip the switch");
  assert.equal(S.reenableSampler(), true, "reenable path still works");
  assert.equal(S.isSamplerDisabled(), false);
  boom();
  boom();
  boom();
  assert.equal(S.isSamplerDisabled(), true, "three in a row trip");
  assert.equal(S.reenableSampler(), true);
  console.error = savedError;
}

// Age-boundary debounce: reset by startSampler, and keyed on the game seed.
{
  globalThis.Game = { turn: 1, age: 7 };
  globalThis.GameInfo = { Ages: { lookup: () => ({ AgeType: "AGE_EXPLORATION" }) } };
  history = { samples: [], wars: [], ageBoundaries: [] };
  saves = 0;
  S.startSampler();
  const fire = () => handlers.PlayerAgeTransitionComplete({ player: 0 });
  fire();
  assert.equal(history.ageBoundaries.length, 1, "first transition event records the boundary");
  assert.equal(saves, 1);
  fire();
  fire();
  assert.equal(saves, 1, "the per-civ event storm is debounced");
  // Load a pre-transition autosave and replay the same transition: startSampler resets the debounce.
  history = { samples: [], wars: [], ageBoundaries: [] };
  S.startSampler();
  handlers.PlayerAgeTransitionComplete({ player: 0 });
  assert.equal(history.ageBoundaries.length, 1, "the same boundary fires again after a restart");
  assert.equal(saves, 2, "recordAgeBoundary ran twice across the reset");
  // A different game (seed) never collides with the last handled key even without a reset.
  seed = "B";
  history = { samples: [], wars: [], ageBoundaries: [] };
  handlers.PlayerAgeTransitionComplete({ player: 0 });
  assert.equal(saves, 3, "a new seed is a new boundary key");
  handlers.PlayerAgeTransitionComplete({ player: 1 });
  assert.equal(saves, 3, "and is debounced within that game");
  S.startSampler();
}

for (const k of ["Players", "Game", "GameInfo", "Configuration", "Loading"]) delete globalThis[k];
if (savedEngine === undefined) {
  delete globalThis.engine;
} else {
  globalThis.engine = savedEngine;
}

console.log("bootstrap-branches harness passed");
