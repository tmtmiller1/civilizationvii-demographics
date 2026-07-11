// Covers: city-camera-controller-utils.js, cinematic-overlay.js,
//         cinematic-tour.js (pure exports), city-map-view.js
// Uses DOM stub for elements created by cinematic-overlay.
import assert from "node:assert/strict";
import { createFakeDocument } from "./_dom-stub.mjs";

const { document } = createFakeDocument();
globalThis.document = document;
globalThis.Locale = { compose: (k) => String(k), getCurrentLocale: () => "en_US" };

// ── city-camera-controller-utils ────────────────────────────────────
const {
  clamp, enumVal, nowMs, isEscape, classifyInput, consumeEvent,
  blockedTarget, inputDebounced
} = await import(
  "/demographics/ui/screen-demographics/camera/city-camera-controller-utils.js"
);

assert.equal(clamp(5, 1, 10), 5);
assert.equal(clamp(-1, 0, 10), 0);
assert.equal(clamp(20, 0, 10), 10);
assert.equal(clamp(NaN, 0, 10), 0);

assert.equal(enumVal("InterpolationFunc", "any"), undefined); // no global available
assert.equal(enumVal("KeyframeFlag", "any"), undefined);

assert.equal(typeof nowMs(), "number");
assert.ok(nowMs() >= 0);

assert.equal(isEscape({ key: "Escape" }), true);
assert.equal(isEscape({ key: "Enter" }), false);
assert.equal(isEscape({ keyCode: 27 }), true);
assert.equal(isEscape(null), false);

assert.equal(classifyInput({ name: "cancel" }), "exit");
assert.equal(classifyInput({ name: "mousebutton-right" }), "exit");
assert.equal(classifyInput({ name: "mousebutton-left" }), "replay");
assert.equal(classifyInput({ name: "accept" }), "replay");
assert.equal(classifyInput({ name: "unknown" }), "");
assert.equal(classifyInput(null), "");

// consumeEvent is a side-effect no-op; just confirm it doesn't throw
consumeEvent({ preventDefault() {}, stopImmediatePropagation() {} });
consumeEvent(null);

assert.equal(blockedTarget(null), true);
assert.equal(blockedTarget({ masked: true }), true);
assert.equal(blockedTarget({ owner: { met: false } }), true);
assert.equal(blockedTarget({ name: "City", owner: { met: true } }), false);

const s = {};
assert.equal(inputDebounced(s), false); // first call sets timestamp
assert.equal(inputDebounced(s), true);  // within 500ms window

// ── cinematic-overlay ────────────────────────────────────────────────
const {
  ORDINAL_WORDS, ORDINAL_TAG_MAX, ordinalWord, ordinalText, joinNames, composeOr, isEnglishLocale,
  captionText, flavorText, localeCode, districtPhrase, highlightNames
} = await import(
  "/demographics/ui/screen-demographics/camera/cinematic-overlay.js"
);

assert.ok(Array.isArray(ORDINAL_WORDS));
assert.equal(ordinalWord(1), "single");
assert.equal(ordinalWord(2), "second");
assert.equal(ordinalWord(100), "#100");

// ordinalText: the tag is unresolved in this harness (Locale.compose echoes the key),
// so it falls back to the English word within the Top-6 range and to ordinalWord beyond it.
assert.equal(ORDINAL_TAG_MAX, 6);
assert.equal(ordinalText(1), "single");
assert.equal(ordinalText(6), "sixth");
assert.equal(ordinalText(7), "seventh"); // beyond the tag range → English ordinal word
assert.equal(ordinalText(100), "#100");
// standingRank caption routes through ordinalText, then composes the sentence frame.
assert.equal(captionText({ standingRank: 2 }), "LOC_DEMOGRAPHICS_SETTLEMENTS_CONGRATS_PLAIN");
assert.equal(joinNames(["A"]), "A");
assert.equal(joinNames(["A", "B"]), "A LOC_DEMOGRAPHICS_SETTLEMENTS_CONGRATS_AND B");
assert.equal(composeOr("hello", "fallback"), "hello");
assert.equal(composeOr("LOC_KEY", "fallback"), "fallback");
assert.equal(isEnglishLocale(), true);
assert.equal(localeCode(), "en");

assert.equal(captionText(null), "");
assert.equal(captionText({ text: "hi" }), "hi");
assert.equal(captionText({ nameKey: "LOC_X" }), "LOC_X");
assert.equal(captionText({ nameKey: "LOC_X", year: "2000" }), "LOC_X · LOC_DEMOGRAPHICS_SETTLEMENTS_WONDER_BUILT");

assert.equal(flavorText(null), "");
assert.equal(flavorText({ flavor: "tasty" }), "tasty");
assert.equal(flavorText({ flavorKey: "LOC_F" }), "LOC_F");

assert.equal(districtPhrase(null), "");
assert.equal(districtPhrase({ name: "Forum", quarterType: "QUARTER_FORUM" }), "the Forum");
assert.equal(districtPhrase({ name: "Unknown", quarterType: "QUARTER_NONE" }), "Unknown");

assert.deepEqual(highlightNames({ wonders: [{ nameKey: "LOC_W" }], districts: [{ name: "Acropolis", quarterType: "QUARTER_ACROPOLIS" }] }),
  ["LOC_W", "the Acropolis"]);

// ── cinematic-tour pure exports ──────────────────────────────────────
const {
  FIREWORK_VFX, orbitParams, flyoverParams
} = await import(
  "/demographics/ui/screen-demographics/camera/cinematic-tour.js"
);
assert.ok(Array.isArray(FIREWORK_VFX));
const op = orbitParams({ pitch: 1, yaw: 0, distance: 2, duration: 3 }, 45);
assert.ok(op && typeof op === "object");
const fp = flyoverParams({ pitch: 1, distance: 1, duration: 2 });
assert.ok(fp && typeof fp === "object");

delete globalThis.document;
delete globalThis.Locale;
console.log("camera-utils-branches harness passed");
