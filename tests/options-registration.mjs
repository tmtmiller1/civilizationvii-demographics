import assert from "node:assert/strict";

// The engine options API is stubbed (tests/loader.mjs → stubs/engine-options-stub.mjs); importing the
// stub here gives us the SAME instance the mod registers against.
import { __collectRegisteredOptions, CategoryType } from "./stubs/engine-options-stub.mjs";
import DemographicsSettings from "/demographics/ui/core/demographics-settings.js";

// Importing the options module runs mod-options.js (sets CategoryType.Mods) and queues the mod's
// init callback against the stubbed Options.addInitCallback.
await import("/demographics/ui/demographics-options.js");

const opts = __collectRegisteredOptions();
const byId = new Map(opts.map((o) => [o.id, o]));

// Every setting the mod is expected to expose in the native Mods → Demographics options screen.
const EXPECTED = [
  "demographics-hide-unmet-stats",
  "demographics-colorblind-mode",
  "demographics-show-wonder-markers",
  "demographics-ui-complexity",
  "demographics-reveal-mode",
  "demographics-smooth-chart",
  "demographics-show-eliminated",
  "demographics-cinematic",
  "demographics-flyby",
  "demographics-flyby-preset",
  "demographics-flyby-rotate"
];

function testAllExpectedOptionsRegister() {
  for (const id of EXPECTED) assert.ok(byId.has(id), `option not registered: ${id}`);
  // mod-options.js must have established the shared Mods category, and every option lives under it.
  assert.equal(CategoryType.Mods, "mods");
  for (const o of opts) assert.equal(o.category, CategoryType.Mods, `wrong category on ${o.id}`);
}

function testEveryOptionHasInitAndUpdateListeners() {
  for (const o of opts) {
    assert.equal(typeof o.initListener, "function", `${o.id} missing initListener`);
    assert.equal(typeof o.updateListener, "function", `${o.id} missing updateListener`);
  }
}

function testCheckboxListenerRoundTrips() {
  const o = byId.get("demographics-smooth-chart");
  DemographicsSettings.setSetting("smoothChart", false);
  const info = {};
  o.initListener(info);
  assert.equal(info.currentValue, false); // init reflects the stored value
  o.updateListener({}, true);
  assert.equal(DemographicsSettings.getSetting("smoothChart", false), true); // update persists
}

function testDropdownListenerMapsIndexToValue() {
  const o = byId.get("demographics-flyby-preset");
  DemographicsSettings.setSetting("topCities.flybyPreset", "short");
  const info = {};
  o.initListener(info);
  assert.equal(info.selectedItemIndex, 0); // stored "short" → index 0
  o.updateListener({}, 1); // select index 1 → "medium"
  assert.equal(DemographicsSettings.getSetting("topCities.flybyPreset", "short"), "medium");
}

function testRevealModeMapsDropdownToLegacyBoolean() {
  // Reveal mode is a 2-item dropdown bound to the legacy `backfillMetHistory` boolean
  // (item 0 = full/back-history = true, item 1 = forward-only = false).
  const o = byId.get("demographics-reveal-mode");
  DemographicsSettings.setSetting("backfillMetHistory", true);
  const info = {};
  o.initListener(info);
  assert.equal(info.selectedItemIndex, 0);
  o.updateListener({}, 1);
  assert.equal(DemographicsSettings.getSetting("backfillMetHistory", true), false);
}

function testComplexityDropdownUsesStringValues() {
  const o = byId.get("demographics-ui-complexity");
  DemographicsSettings.setSetting("uiComplexity", "standard");
  const info = {};
  o.initListener(info);
  assert.equal(info.selectedItemIndex, 1); // basic/standard/analyst → "standard" is index 1
  o.updateListener({}, 2); // "analyst"
  assert.equal(DemographicsSettings.getSetting("uiComplexity", "standard"), "analyst");
}

testAllExpectedOptionsRegister();
testEveryOptionHasInitAndUpdateListeners();
testCheckboxListenerRoundTrips();
testDropdownListenerMapsIndexToValue();
testRevealModeMapsDropdownToLegacyBoolean();
testComplexityDropdownUsesStringValues();

console.log(`options-registration harness passed (${opts.length} options registered under Mods)`);
