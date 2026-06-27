import assert from "node:assert/strict";

import { DemographicsSettings } from "/demographics/ui/core/demographics-settings.js";
import {
  detectGameSpeedType,
  decimationDisabled,
  resolveEffectiveCap
} from "/demographics/ui/storage/storage-cap.js";

const savedGetSetting = DemographicsSettings.getSetting;
const savedGame = globalThis.Game;
const savedGameInfo = globalThis.GameInfo;

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

try {
  testOverrideModes();
  testAutoFallbackAndSpeedDetection();
  testDecimationDisabledGuard();
  console.log("storage-cap-branches harness passed");
} finally {
  DemographicsSettings.getSetting = savedGetSetting;
  globalThis.Game = savedGame;
  globalThis.GameInfo = savedGameInfo;
}
