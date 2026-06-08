import assert from "node:assert/strict";

import {
  arbitraryColor,
  colorDistance,
  deconflictColors,
  preferReadableColor,
  safeTextColor
} from "/demographics/ui/core/civ-color-utils.js";

/** Relative luminance of a `#RRGGBB` color. */
function luminanceOf(hex) {
  const n = hex.replace("#", "");
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function testPureBlackLiftsToReadableGrey() {
  const out = safeTextColor("#000000");
  assert.notEqual(out.toLowerCase(), "#000000", "pure black must not stay black");
  assert.ok(
    luminanceOf(out) > 120,
    `lifted black should be clearly visible on dark bg, got ${out}`
  );
}

function testNearBlackPreservesHue() {
  // Alexander-style near-black-with-a-tint: a very dark red must come back red,
  // not grey, and must be bright enough to read.
  const out = safeTextColor("#1a0000");
  const n = out.replace("#", "");
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  assert.ok(r > g && r > b, `near-black red should stay red-dominant, got ${out}`);
  assert.ok(r >= 160, `near-black red should be lifted bright, got ${out}`);
}

function testNearBlackRgbaKeepsAlpha() {
  const out = safeTextColor("rgba(10, 10, 12, 0.4)");
  assert.match(out, /^rgba\(\d+,\d+,\d+,0\.4\)$/, `should stay rgba with alpha, got ${out}`);
}

function testBrightColorsUnchanged() {
  // A bright, non-blue-dim color must pass straight through.
  assert.equal(safeTextColor("#f3c34c"), "#f3c34c", "bright gold must be untouched");
  assert.equal(safeTextColor("#ffffff"), "#ffffff", "white reads on dark bg; leave it");
}

function testDimBlueStillLifts() {
  // Existing behavior must be preserved: a dim blue (above the near-black floor)
  // is brightened rather than passed through.
  const out = safeTextColor("#202060");
  assert.notEqual(out.toLowerCase(), "#202060", "dim blue should still be lifted");
}

function testNonStringPassThrough() {
  assert.equal(safeTextColor(null), null);
  assert.equal(safeTextColor(undefined), undefined);
}

function testPreferSecondaryWhenPrimaryNearBlack() {
  // Alexander-style: near-black primary, light secondary → use the secondary.
  assert.equal(
    preferReadableColor("#0a0a0a", "#d9b34c"),
    "#d9b34c",
    "near-black primary should yield the readable secondary"
  );
}

function testKeepPrimaryWhenReadable() {
  // A bright primary is kept even if a secondary exists.
  assert.equal(
    preferReadableColor("#c0392b", "#ffffff"),
    "#c0392b",
    "readable primary must be kept"
  );
}

function testKeepPrimaryWhenSecondaryAlsoDark() {
  // Both banner colors near-black → keep primary; safeTextColor lifts it later.
  assert.equal(
    preferReadableColor("#0a0a0a", "#050505"),
    "#0a0a0a",
    "with no readable secondary, primary is kept for lifting"
  );
}

function testPreferReadableColorMissingInputs() {
  // No secondary captured (older saves) → keep the (near-black) primary.
  assert.equal(preferReadableColor("#000000", undefined), "#000000");
  // No primary at all → pass through so caller can use the palette fallback.
  assert.equal(preferReadableColor("", "#ffffff"), "");
}

function testDarkGreyAboveOldBandIsLifted() {
  // Alexander regression: a dark grey bright enough to clear the old luminance
  // band (~#4a4a4a, luminance 74) must still be lifted to a clearly visible tone.
  const out = safeTextColor("#4a4a4a");
  assert.notEqual(out.toLowerCase(), "#4a4a4a", "dark grey must not pass through unchanged");
  assert.ok(luminanceOf(out) > 150, `dark grey should be lifted bright, got ${out}`);
}

function testDarkGreyPrimarySwapsToSecondary() {
  // A dark-grey primary that the old code left alone now defers to the secondary.
  assert.equal(
    preferReadableColor("#4a4a4a", "#c8a24c"),
    "#c8a24c",
    "dark-grey primary should swap to the secondary banner color"
  );
}

function testDarkButSaturatedPrimaryIsKept() {
  // A dark navy is saturated, not a grey — keep its identity, don't swap.
  assert.equal(
    preferReadableColor("#1a3a6e", "#ffffff"),
    "#1a3a6e",
    "dark saturated primary should be kept (lifting preserves its hue)"
  );
}

function testDarkSaturatedColorLiftedPreservingHue() {
  const out = safeTextColor("#1a3a6e");
  const n = out.replace("#", "");
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  assert.ok(b > r && b > g, `lifted dark navy should stay blue-dominant, got ${out}`);
  assert.ok(luminanceOf(out) > luminanceOf("#1a3a6e"), "should be brighter than the original");
}

function testColorDistanceBasics() {
  assert.equal(colorDistance("#123456", "#123456"), 0, "identical colors → 0");
  assert.ok(
    colorDistance("#ff0000", "#00ff00") > colorDistance("#ff0000", "#ff1010"),
    "far colors should measure more distant than near colors"
  );
  assert.equal(colorDistance("not-a-color", "#fff"), Infinity, "unparseable → Infinity");
}

function testArbitraryColorsAreDistinctAndReadable() {
  const seen = new Set();
  for (let i = 0; i < 12; i++) {
    const c = arbitraryColor(i);
    assert.match(c, /^#[0-9a-f]{6}$/i, `arbitraryColor(${i}) should be hex, got ${c}`);
    seen.add(c);
    // Successive arbitrary colors must be visibly different from each other.
    if (i > 0) {
      assert.ok(
        colorDistance(arbitraryColor(i - 1), c) > 40,
        `arbitraryColor(${i - 1}) and (${i}) should differ`
      );
    }
  }
  assert.equal(seen.size, 12, "arbitrary colors should be unique over a short run");
}

function testDeconflictKeepsDistinctColors() {
  const input = ["#ff0000", "#00ff00", "#0000ff"];
  assert.deepEqual(deconflictColors(input), input, "already-distinct colors are untouched");
}

function testDeconflictReassignsCollisions() {
  // Three near-identical reds: first kept, the other two pushed apart.
  const out = deconflictColors(["#ff0000", "#fe0101", "#fd0202"]);
  assert.equal(out[0], "#ff0000", "highest-priority color is preserved");
  assert.ok(colorDistance(out[0], out[1]) >= 80, "second color separated from first");
  assert.ok(colorDistance(out[0], out[2]) >= 80, "third color separated from first");
  assert.ok(colorDistance(out[1], out[2]) >= 80, "second and third separated from each other");
}

function testDeconflictHandlesUnparseable() {
  const out = deconflictColors(["#ff0000", "garbage"]);
  assert.equal(out[0], "#ff0000");
  assert.match(out[1], /^#[0-9a-f]{6}$/i, "unparseable color replaced with a real color");
}

function main() {
  testPureBlackLiftsToReadableGrey();
  testNearBlackPreservesHue();
  testNearBlackRgbaKeepsAlpha();
  testBrightColorsUnchanged();
  testDimBlueStillLifts();
  testNonStringPassThrough();
  testPreferSecondaryWhenPrimaryNearBlack();
  testKeepPrimaryWhenReadable();
  testKeepPrimaryWhenSecondaryAlsoDark();
  testPreferReadableColorMissingInputs();
  testDarkGreyAboveOldBandIsLifted();
  testDarkGreyPrimarySwapsToSecondary();
  testDarkButSaturatedPrimaryIsKept();
  testDarkSaturatedColorLiftedPreservingHue();
  testColorDistanceBasics();
  testArbitraryColorsAreDistinctAndReadable();
  testDeconflictKeepsDistinctColors();
  testDeconflictReassignsCollisions();
  testDeconflictHandlesUnparseable();
  console.log("civ-color-utils harness passed");
}

main();
