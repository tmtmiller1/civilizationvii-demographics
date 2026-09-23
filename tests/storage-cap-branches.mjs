import assert from "node:assert/strict";

import { DemographicsSettings } from "/demographics/ui/core/demographics-settings.js";
import {
  detectGameSpeedType,
  decimationDisabled,
  PAYLOAD_HARD_BYTES,
  PAYLOAD_SOFT_BYTES,
  resolveEffectiveCap
} from "/demographics/ui/storage/storage-cap.js";
import { DemographicsStorage } from "/demographics/ui/storage/demographics-storage.js";
import { serializeWithinBudget } from "/demographics/ui/storage/storage-retention.js";

const savedGetSetting = DemographicsSettings.getSetting;
const savedGame = globalThis.Game;
const savedGameInfo = globalThis.GameInfo;
const savedConfiguration = globalThis.Configuration;
const savedDatabase = globalThis.Database;
const savedConsoleError = console.error;

function setOverride(value) {
  DemographicsSettings.getSetting = (key, dflt) => {
    if (key === "sampleCapOverride") return value;
    if (key === "disableDecimation") return false;
    return dflt;
  };
}

function testOverrideModes() {
  setOverride(-1);
  const unlimited = resolveEffectiveCap(() => {});
  assert.equal(unlimited.cap, Infinity);
  assert.equal(unlimited.source, "user:unlimited");

  setOverride("900");
  const fromString = resolveEffectiveCap(() => {});
  assert.equal(fromString.cap, 900);
  assert.equal(fromString.source, "user:900");

  setOverride(1200);
  const fromNumber = resolveEffectiveCap(() => {});
  assert.equal(fromNumber.cap, 1200);
  assert.equal(fromNumber.source, "user:1200");
}

function testAutoFallbackAndSpeedDetection() {
  setOverride("auto");
  globalThis.Game = { gameSpeedType: "GAMESPEED_STANDARD" };
  assert.equal(detectGameSpeedType(), "GAMESPEED_STANDARD");
  const auto = resolveEffectiveCap(() => {});
  assert.ok(auto.source.startsWith("auto:"), "auto mode should resolve adaptive cap");
  assert.ok(isFinite(auto.cap) && auto.cap > 0, "adaptive cap should be finite positive");

  globalThis.Game = { gameSpeed: 777 };
  globalThis.GameInfo = {
    GameSpeeds: {
      lookup: (hash) => (hash === 777 ? { GameSpeedType: "GAMESPEED_MARATHON" } : null)
    }
  };
  assert.equal(detectGameSpeedType(), "GAMESPEED_MARATHON", "hash lookup should resolve speed");
}

function testDecimationDisabledGuard() {
  DemographicsSettings.getSetting = () => {
    throw new Error("bad setting read");
  };
  assert.equal(decimationDisabled(() => {}), false, "decimationDisabled should fail safe to false");
}

/** Map-backed GameConfiguration fake; returns the map for assertions. */
function installConfigurationFake() {
  const map = new Map();
  globalThis.Configuration = {
    getGame: () => ({ startSeed: "seed-bytes", getValue: (k) => (map.has(k) ? map.get(k) : null) }),
    editGame: () => ({ setValue: (k, v) => map.set(k, v) })
  };
  // A hash API keeps the Tutorial-bag fallback quiet; no GameContext, so it resolves to null.
  globalThis.Database = { makeHash: (s) => s };
  return map;
}

function mkBytesHistory(count, padBytes) {
  const samples = [];
  for (let i = 1; i <= count; i++) samples.push({ turn: i, players: { 0: { metrics: { gdp: i } } }, pad: "x".repeat(padBytes) });
  return { version: 1, seed: "seed-bytes", samples, ageBoundaries: [], eliminated: {} };
}

function testSerializeWithinBudgetTightens() {
  const tightened = [];
  const history = { samples: Array.from({ length: 100 }, (_, i) => ({ turn: i, pad: "y".repeat(100) })) };
  const out = serializeWithinBudget(history, {
    cap: Infinity,
    softBytes: 4000,
    tighten: (h, cap) => {
      tightened.push(cap);
      h.samples = h.samples.slice(-cap);
    }
  });
  assert.deepEqual(tightened, [50, 25], "cap halves from the sample count until under the soft budget");
  assert.equal(out.attempts, 2);
  assert.ok(out.initialBytes > 4000 && out.serialized.length <= 4000);
  assert.equal(history.samples.length, 25, "history is shrunk in place");

  const small = { samples: [{ turn: 1 }] };
  const untouched = serializeWithinBudget(small, { cap: 10, softBytes: 4000, tighten: () => assert.fail("no tightening") });
  assert.equal(untouched.attempts, 0);
  assert.equal(small.samples.length, 1);
}

function testSaveByteBudget() {
  setOverride(-1);
  const map = installConfigurationFake();
  const errors = [];
  console.error = (...a) => errors.push(a.join(" "));
  const KEY = "Demographics__demographics-history-v1__json";

  // Under the soft budget: nothing is tightened and no budget notice fires.
  const small = mkBytesHistory(10, 100);
  assert.equal(DemographicsStorage.save(small), true);
  assert.equal(small.samples.length, 10, "under-budget history is untouched");
  assert.equal(map.get(KEY).length, JSON.stringify({ v: 2, data: small }).length);
  assert.equal(DemographicsStorage.decimationStatus().payloadBytes, map.get(KEY).length);
  assert.equal(errors.filter((e) => /budget/.test(e)).length, 0);

  // Over the soft budget: tightened before the write, soft notice once, hard notice never (fits).
  const big = mkBytesHistory(6000, 640);
  const before = JSON.stringify({ v: 2, data: big }).length;
  assert.ok(before > PAYLOAD_SOFT_BYTES && before < PAYLOAD_HARD_BYTES, "fixture sits between soft and hard");
  assert.equal(DemographicsStorage.save(big), true);
  assert.ok(big.samples.length < 6000, "over-budget history is decimated further before the write");
  assert.ok(map.get(KEY).length <= PAYLOAD_SOFT_BYTES, "written payload fits the soft budget");
  assert.equal(map.get(KEY).length, JSON.stringify({ v: 2, data: big }).length, "what was written is what was kept");
  assert.equal(DemographicsStorage.decimationStatus().payloadBytes, map.get(KEY).length);
  assert.equal(errors.filter((e) => /soft budget/.test(e)).length, 1, "soft notice fires once");
  assert.equal(errors.filter((e) => /hard budget/.test(e)).length, 0);

  // A second over-budget save: still written, but the soft notice does not repeat.
  const again = mkBytesHistory(6000, 640);
  assert.equal(DemographicsStorage.save(again), true);
  assert.equal(errors.filter((e) => /soft budget/.test(e)).length, 1, "soft notice is once per session");

  // Over the hard budget even at one sample: still written (never lose the current game), logged every save.
  const huge = mkBytesHistory(1, PAYLOAD_HARD_BYTES + 1024);
  assert.equal(DemographicsStorage.save(huge), true);
  assert.equal(huge.samples.length, 1);
  assert.ok(map.get(KEY).length > PAYLOAD_HARD_BYTES, "over-hard payload is still written");
  assert.equal(errors.filter((e) => /hard budget/.test(e)).length, 1);
  assert.equal(DemographicsStorage.save(mkBytesHistory(1, PAYLOAD_HARD_BYTES + 1024)), true);
  assert.equal(errors.filter((e) => /hard budget/.test(e)).length, 2, "hard notice repeats on every save");
}

try {
  testOverrideModes();
  testAutoFallbackAndSpeedDetection();
  testDecimationDisabledGuard();
  testSerializeWithinBudgetTightens();
  testSaveByteBudget();
  console.log("storage-cap-branches harness passed");
} finally {
  DemographicsSettings.getSetting = savedGetSetting;
  globalThis.Game = savedGame;
  globalThis.GameInfo = savedGameInfo;
  globalThis.Configuration = savedConfiguration;
  globalThis.Database = savedDatabase;
  console.error = savedConsoleError;
}
