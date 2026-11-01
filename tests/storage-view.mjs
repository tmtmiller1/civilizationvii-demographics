import assert from "node:assert/strict";

import { DemographicsSettings } from "/demographics/ui/core/demographics-settings.js";
import { DemographicsStorage } from "/demographics/ui/storage/demographics-storage.js";

// loadForView() is the screen's read path (spec 6.2). After a save the store holds exactly what the
// mirror was serialized to, so the method answers with the mirror object and parses nothing. It falls
// back to load() when the store's value has a different length, and when the mirror is for another game.

const KEY = "Demographics__demographics-history-v1__json";
const savedGetSetting = DemographicsSettings.getSetting;
const savedConfiguration = globalThis.Configuration;
const savedDatabase = globalThis.Database;
const savedParse = JSON.parse;

DemographicsSettings.getSetting = (key, dflt) => {
  if (key === "sampleCapOverride") return -1;
  if (key === "disableDecimation") return false;
  return dflt;
};

const map = new Map();
let reads = 0;
globalThis.Configuration = {
  getGame: () => ({
    startSeed: "seed-view",
    getValue: (k) => {
      if (k === KEY) reads += 1;
      return map.has(k) ? map.get(k) : null;
    }
  }),
  editGame: () => ({ setValue: (k, v) => map.set(k, v) })
};
globalThis.Database = { makeHash: (s) => s };

let parses = 0;
JSON.parse = function countingParse(text, reviver) {
  parses += 1;
  return savedParse.call(JSON, text, reviver);
};

function mkHistory(count) {
  const samples = [];
  for (let i = 1; i <= count; i++) samples.push({ turn: i, players: { 0: { metrics: { gdp: i } } } });
  return { version: 1, seed: "seed-view", samples, ageBoundaries: [], eliminated: {} };
}

try {
  assert.equal(typeof DemographicsStorage.loadForView, "function", "loadForView() exists on the storage singleton");

  // Branch 1: the store still holds what the mirror was written as; the mirror comes back, no parse.
  const history = mkHistory(5);
  assert.equal(DemographicsStorage.save(history), true);
  const mirror = DemographicsStorage.peek();
  assert.equal(mirror, history, "save sets the mirror to the saved object");
  parses = 0;
  reads = 0;
  const viewed = DemographicsStorage.loadForView();
  assert.equal(viewed, mirror, "loadForView returns the mirror object itself");
  assert.equal(parses, 0, "loadForView parses nothing when the store length matches");
  assert.equal(reads, 1, "loadForView reads the store once to compare lengths");

  // Branch 2: the store's value changed length (another save of the same game loaded mid-session).
  const other = mkHistory(9);
  map.set(KEY, JSON.stringify({ v: 2, data: other }));
  parses = 0;
  const reloaded = DemographicsStorage.loadForView();
  assert.notEqual(reloaded, mirror, "a store of a different length is loaded afresh");
  assert.equal(reloaded.samples.length, 9, "the loaded history is the store's content");
  assert.ok(parses >= 1, "the fallback goes through load() and parses the store");

  // Branch 3: the mirror is stamped with another game's seed; the store is read and parsed.
  assert.equal(DemographicsStorage.save(mkHistory(3)), true);
  const stale = DemographicsStorage.peek();
  stale.seed = "seed-elsewhere";
  parses = 0;
  const fresh = DemographicsStorage.loadForView();
  assert.notEqual(fresh, stale, "a mirror of another seed is not returned");
  assert.ok(parses >= 1, "the seed mismatch falls back to load()");

  console.log("storage-view harness passed");
} finally {
  JSON.parse = savedParse;
  DemographicsSettings.getSetting = savedGetSetting;
  globalThis.Configuration = savedConfiguration;
  globalThis.Database = savedDatabase;
}
