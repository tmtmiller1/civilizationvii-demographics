import assert from "node:assert/strict";

import {
  AGREEMENT_TYPES,
  CS_AGREEMENT_TYPES,
  LINE_DASH,
  dasharrayFor,
  derr,
  dlog,
  diplomacyActionLabel,
  getRingPxPerUnit,
  hexToRgba,
  normalizeCivColor,
  safeCall,
  setRingPxPerUnit
} from "/demographics/ui/screen-demographics/views/relations/relations-shared.js";

const savedGameInfo = globalThis.GameInfo;
const savedLocale = globalThis.Locale;

function testColorHelpers() {
  assert.equal(hexToRgba(undefined, 0.2), "rgba(0,0,0,0.2)");
  assert.equal(hexToRgba("#112233", 0.5), "rgba(17, 34, 51, 0.5)");
  assert.equal(hexToRgba("#FF112233", 0.75), "rgba(17, 34, 51, 0.75)");
  assert.equal(hexToRgba("not-a-color", 0.6), "rgba(20, 16, 10, 0.6)");

  assert.equal(normalizeCivColor(55), null);
  assert.equal(normalizeCivColor("#ff8800"), "#FF8800");
  assert.equal(normalizeCivColor("#FFFFFF"), null);
  assert.equal(normalizeCivColor("#000000"), null);
}

function testDashResolution() {
  assert.equal(dasharrayFor(undefined), "");

  const agreement = AGREEMENT_TYPES[0]?.key;
  assert.ok(typeof agreement === "string" && agreement.length > 0, "agreement key should exist");
  assert.equal(dasharrayFor({ filterKey: agreement }), LINE_DASH[agreement]);

  const csAgreement = CS_AGREEMENT_TYPES[0]?.key;
  assert.ok(typeof csAgreement === "string" && csAgreement.length > 0, "CS agreement key should exist");
  assert.equal(dasharrayFor({ filterKey: csAgreement }), LINE_DASH[csAgreement]);

  assert.equal(dasharrayFor({ dashed: true }), "dashed", "legacy dashed flag should be preserved");
  assert.equal(dasharrayFor({ _dashOverride: "dotted", filterKey: "war" }), "dotted");
  assert.equal(dasharrayFor({ _dashOverride: "", filterKey: "war" }), "");
  assert.equal(dasharrayFor({ _dashOverride: null, filterKey: "war" }), "");
  assert.equal(dasharrayFor({ filterKey: "not_mapped" }), "");
}

function testSafeCallAndRingScale() {
  assert.equal(safeCall("ok", () => 7, 0), 7);
  assert.equal(safeCall("boom", () => { throw new Error("x"); }, 11), 11);

  const before = getRingPxPerUnit();
  setRingPxPerUnit(9);
  assert.equal(getRingPxPerUnit(), 9);
  setRingPxPerUnit(-1);
  assert.equal(getRingPxPerUnit(), 9, "invalid publish should be ignored");
  setRingPxPerUnit(before || 9);

    // Exercise both log helpers so function coverage includes non-error utilities.
    dlog("debug-off-noop");
    derr("error-log-path");
}

function testDiplomacyLabelResolution() {
  globalThis.GameInfo = {
    DiplomacyActions: {
      lookup: (name) => (name === "DIPLOMACY_ACTION_TEST" ? { Name: "LOC_TEST_DIPLO" } : null)
    }
  };
  globalThis.Locale = {
    compose: (key) => (key === "LOC_TEST_DIPLO" ? "Localized Test Diplomacy" : key)
  };

  assert.equal(diplomacyActionLabel("DIPLOMACY_ACTION_TEST"), "Localized Test Diplomacy");
  assert.equal(diplomacyActionLabel("DIPLOMACY_ACTION_SHARE_MAP"), "Share Map");

  globalThis.Locale = { compose: () => "LOC_UNRESOLVED" };
  assert.equal(diplomacyActionLabel("DIPLOMACY_ACTION_OPEN_BORDERS"), "Open Borders");

  globalThis.Locale = {
    compose: () => {
      throw new Error("compose crashed");
    }
  };
  assert.equal(diplomacyActionLabel("DIPLOMACY_ACTION_CULTURAL_EXCHANGE"), "Cultural Exchange");

    globalThis.Locale = { compose: () => 0 };
    assert.equal(diplomacyActionLabel("DIPLOMACY_ACTION_TRADE_MAP"), "Trade Map");

    assert.equal(diplomacyActionLabel(undefined), "");
}

try {
  testColorHelpers();
  testDashResolution();
  testSafeCallAndRingScale();
  testDiplomacyLabelResolution();
  console.log("relations-shared-branches harness passed");
} finally {
  globalThis.GameInfo = savedGameInfo;
  globalThis.Locale = savedLocale;
}
