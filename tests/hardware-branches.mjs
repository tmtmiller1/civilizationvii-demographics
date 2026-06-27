import assert from "node:assert/strict";

const savedNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const savedUI = globalThis.UI;
const savedUIViewExperience = globalThis.UIViewExperience;
const savedPlayers = globalThis.Players;

function setNavigator(value) {
  Object.defineProperty(globalThis, "navigator", {
    value,
    configurable: true,
    enumerable: true,
    writable: true
  });
}

function restoreGlobals() {
  if (savedNavigatorDesc) {
    Object.defineProperty(globalThis, "navigator", savedNavigatorDesc);
  } else {
    delete globalThis.navigator;
  }
  if (savedUI === undefined) delete globalThis.UI;
  else globalThis.UI = savedUI;
  if (savedUIViewExperience === undefined) delete globalThis.UIViewExperience;
  else globalThis.UIViewExperience = savedUIViewExperience;
  if (savedPlayers === undefined) delete globalThis.Players;
  else globalThis.Players = savedPlayers;
}

try {
  // Low capability + mobile path: drives lower clamp and mobile branch.
  setNavigator({ hardwareConcurrency: 2, deviceMemory: 4 });
  globalThis.UIViewExperience = { Mobile: "mobile" };
  globalThis.UI = { getViewExperience: () => "mobile" };
  globalThis.Players = { getAliveMajorIds: () => new Array(13).fill(0) };

  const hwLow = await import("../ui/core/demographics-hardware.js?case=low");

  assert.equal(hwLow.capabilityFactor(), 0.4);
  assert.equal(hwLow.gameSizeFactor(), 0.7);
  assert.equal(hwLow.retentionScale(), 0.4);
  assert.equal(hwLow.renderPointBudget(), 560);

  const downA = hwLow.lodDownsample([0, 1, 2, 3, 4, 5, 6], 3);
  assert.deepEqual(downA, [0, 3, 6]);
  const downB = hwLow.lodDownsample([0, 1, 2], 2);
  assert.deepEqual(downB, [0, 2]);
  assert.deepEqual(hwLow.lodDownsample([1, 2], 0), [1, 2]);
  assert.equal(hwLow.lodDownsample("not-array", 2), "not-array");

  // High capability + non-mobile path: exercises upper core/memory tiers.
  setNavigator({ hardwareConcurrency: 16, deviceMemory: 32 });
  globalThis.UI = { getViewExperience: () => "desktop" };
  globalThis.Players = { getAliveIds: () => new Array(9).fill(0) };

  const hwHigh = await import("../ui/core/demographics-hardware.js?case=high");

  assert.equal(hwHigh.capabilityFactor(), 1.375);
  assert.equal(hwHigh.gameSizeFactor(), 0.85);
  assert.equal(hwHigh.retentionScale(), 1.16875);
  assert.equal(hwHigh.renderPointBudget(), 1925);

  // Unknown player count path.
  delete globalThis.Players;
  const hwUnknownPlayers = await import("../ui/core/demographics-hardware.js?case=noplayers");
  assert.equal(hwUnknownPlayers.gameSizeFactor(), 1);

  console.log("hardware-branches harness passed");
} finally {
  restoreGlobals();
}
