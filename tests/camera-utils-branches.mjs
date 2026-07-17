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
  captionText, flavorText, localeCode, districtPhrase, highlightNames,
  articledName, englishArticled, startsWithArticle, normalizeArticleName,
  NO_ARTICLE_TYPES
} = await import(
  "/demographics/ui/screen-demographics/camera/cinematic-overlay.js"
);

assert.ok(Array.isArray(ORDINAL_WORDS));
assert.equal(ordinalWord(1), "single");
assert.equal(ordinalWord(2), "second");
assert.equal(ordinalWord(100), "#100");

// ordinalText: the tag is unresolved in this harness (Locale.compose echoes the key),
// so it always falls back to the English ordinal word within the Top-25 tag range and
// to ordinalWord ("#N") beyond it.
assert.equal(ORDINAL_TAG_MAX, 25);
assert.equal(ordinalText(1), "single");
assert.equal(ordinalText(6), "sixth");
assert.equal(ordinalText(7), "seventh"); // within the tag range → English fallback in this harness
assert.equal(ordinalText(25), "twenty-fifth"); // ORDINAL_WORDS spells through the full Top-25
assert.equal(ordinalText(100), "#100"); // beyond the tag range → ordinalWord "#N"
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
// Un-tabled / new quarters now default to "the" instead of coming out bare.
assert.equal(districtPhrase({ name: "Unknown", quarterType: "QUARTER_NONE" }), "the Unknown");

// Wonders now flow through the article system too (was bare "LOC_W").
assert.deepEqual(highlightNames({ wonders: [{ nameKey: "LOC_W" }], districts: [{ name: "Acropolis", quarterType: "QUARTER_ACROPOLIS" }] }),
  ["the LOC_W", "the Acropolis"]);

// ── English articling: 100 examples ──────────────────────────────────
// Every row is [displayName, typeId, expected], exercised through the real
// entry point articledName(). Grouped by category; each expected value is the
// grammatically correct English rendering.
const ARTICLE_CASES = [
  // Wonders that take "the" (default rule; typeId irrelevant). 1-34
  ["Parthenon", "BUILDING_PARTHENON", "the Parthenon"],
  ["Colosseum", "", "the Colosseum"],
  ["Oracle", "", "the Oracle"],
  ["Great Library", "", "the Great Library"],
  ["Hanging Gardens", "", "the Hanging Gardens"],          // plural name
  ["Pyramids", "", "the Pyramids"],                        // plural name
  ["Statue of Zeus", "", "the Statue of Zeus"],
  ["Forbidden City", "", "the Forbidden City"],
  ["Great Bath", "", "the Great Bath"],
  ["Terracotta Army", "", "the Terracotta Army"],
  ["Weiyang Palace", "", "the Weiyang Palace"],
  ["Taj Mahal", "", "the Taj Mahal"],
  ["Brandenburg Gate", "", "the Brandenburg Gate"],
  ["Serpent Mound", "", "the Serpent Mound"],
  ["Pyramid of the Sun", "", "the Pyramid of the Sun"],
  ["Great Stele", "", "the Great Stele"],
  ["Monks Mound", "", "the Monks Mound"],
  ["Great Sphinx", "", "the Great Sphinx"],
  ["Temple of Artemis", "", "the Temple of Artemis"],
  ["Colossus of Rhodes", "", "the Colossus of Rhodes"],
  ["Great Wall", "", "the Great Wall"],
  ["Alhambra", "", "the Alhambra"],
  ["Colossus", "", "the Colossus"],
  ["Mausoleum of Halicarnassus", "", "the Mausoleum of Halicarnassus"],
  ["Great Mosque", "", "the Great Mosque"],
  ["Statue of Liberty", "", "the Statue of Liberty"],
  ["Eiffel Tower", "", "the Eiffel Tower"],
  ["Sydney Opera House", "", "the Sydney Opera House"],
  ["Golden Gate Bridge", "", "the Golden Gate Bridge"],
  ["Hypostyle Hall", "", "the Hypostyle Hall"],
  ["Winter Palace", "", "the Winter Palace"],
  ["Crystal Palace", "", "the Crystal Palace"],
  ["Grand Bazaar", "", "the Grand Bazaar"],
  ["Iron Pagoda", "", "the Iron Pagoda"],
  // Toponym wonders (reject "the" via NO_ARTICLE_NAMES). 35-52
  ["Machu Picchu", "", "Machu Picchu"],
  ["Angkor Wat", "", "Angkor Wat"],
  ["Petra", "", "Petra"],
  ["Chichén Itzá", "", "Chichén Itzá"],                    // accents folded to match
  ["Chichen Itza", "", "Chichen Itza"],
  ["Nalanda", "", "Nalanda"],
  ["Mundo Perdido", "", "Mundo Perdido"],
  ["Hagia Sophia", "", "Hagia Sophia"],
  ["Mont-Saint-Michel", "", "Mont-Saint-Michel"],          // hyphens folded to match
  ["Mont Saint Michel", "", "Mont Saint Michel"],
  ["Notre-Dame", "", "Notre-Dame"],
  ["Notre Dame", "", "Notre Dame"],
  ["Borobudur", "", "Borobudur"],
  ["Sigiriya", "", "Sigiriya"],
  ["Mesa Verde", "", "Mesa Verde"],
  ["Great Zimbabwe", "", "Great Zimbabwe"],
  ["Meidan Emam", "", "Meidan Emam"],
  ["Chand Baori", "", "Chand Baori"],
  // Unique quarters — all default to "the", tabled or not. 53-72
  ["Acropolis", "QUARTER_ACROPOLIS", "the Acropolis"],
  ["Forum", "QUARTER_FORUM", "the Forum"],
  ["Matha", "QUARTER_MATHA", "the Matha"],
  ["Necropolis", "QUARTER_NECROPOLIS", "the Necropolis"],
  ["Uwaybil Kuh", "QUARTER_UWAYBIL_KUH", "the Uwaybil Kuh"],
  ["Industrial Park", "QUARTER_INDUSTRIAL_PARK", "the Industrial Park"],
  ["Avenue", "QUARTER_AVENUE", "the Avenue"],
  ["Zaibatsu", "QUARTER_ZAIBATSU", "the Zaibatsu"],
  ["Zocalo", "QUARTER_ZOCALO", "the Zocalo"],
  ["Huiguan", "QUARTER_HUIGUAN", "the Huiguan"],
  ["Donjon", "QUARTER_DONJON", "the Donjon"],
  ["Ulema", "QUARTER_ULEMA", "the Ulema"],
  ["Plaza", "QUARTER_PLAZA", "the Plaza"],
  ["Pura", "QUARTER_PURA", "the Pura"],
  ["Five Hundred Lords", "QUARTER_FIVE_HUNDRED_LORDS", "the Five Hundred Lords"],
  ["Media District", "QUARTER_MEDIA", "the Media District"],           // un-tabled / DLC
  ["Garden District", "QUARTER_GARDEN", "the Garden District"],        // un-tabled / DLC
  ["Trade Hub", "QUARTER_TRADE", "the Trade Hub"],                     // un-tabled / DLC
  ["Harbor Quarter", "QUARTER_HARBOR", "the Harbor Quarter"],          // un-tabled / DLC
  ["Innovation Quarter", "QUARTER_FUTURE", "the Innovation Quarter"],  // un-tabled / DLC
  // Natural wonders — toponyms reject "the". 73-83
  ["Uluru", "", "Uluru"],
  ["Kilimanjaro", "", "Kilimanjaro"],
  ["Mount Kilimanjaro", "", "Mount Kilimanjaro"],
  ["Mount Everest", "", "Mount Everest"],
  ["Everest", "", "Everest"],
  ["Vesuvius", "", "Vesuvius"],
  ["Mount Vesuvius", "", "Mount Vesuvius"],
  ["Zhangye Danxia", "", "Zhangye Danxia"],
  ["Ha Long Bay", "", "Ha Long Bay"],
  ["Lake Victoria", "", "Lake Victoria"],
  ["Mount Kailash", "", "Mount Kailash"],
  // Natural wonders that take "the". 84-90
  ["Grand Canyon", "", "the Grand Canyon"],
  ["Great Barrier Reef", "", "the Great Barrier Reef"],
  ["Bermuda Triangle", "", "the Bermuda Triangle"],
  ["Redwood Forest", "", "the Redwood Forest"],
  ["Fountain of Youth", "", "the Fountain of Youth"],
  ["Cliffs of Dover", "", "the Cliffs of Dover"],
  ["Giant's Causeway", "", "the Giant's Causeway"],
  // Guard / edge cases. 91-100
  ["The Great Bath", "", "The Great Bath"],                // already articled
  ["the Colosseum", "", "the Colosseum"],                  // already articled (lowercase)
  ["A Grand Monument", "", "A Grand Monument"],            // already carries "A "
  ["An Obelisk", "", "An Obelisk"],                        // already carries "An "
  ["", "", ""],                                            // empty name
  ["Theatre of Dionysus", "", "the Theatre of Dionysus"],  // "The..." prefix needs a boundary
  ["Andes Observatory", "", "the Andes Observatory"],      // "An..." prefix needs a boundary
  ["the the Redundant", "", "the the Redundant"],          // guard stops a third article
  ["PETRA", "", "PETRA"],                                  // exception match is case-insensitive
  ["MACHU PICCHU", "", "MACHU PICCHU"]
];
assert.equal(ARTICLE_CASES.length, 100);
for (const [name, typeId, expected] of ARTICLE_CASES) {
  assert.equal(
    articledName({ name, typeId }),
    expected,
    `articledName(${JSON.stringify(name)}, ${JSON.stringify(typeId)}) => ${JSON.stringify(articledName({ name, typeId }))}, expected ${JSON.stringify(expected)}`
  );
}

// Helper-level checks the table implies.
assert.equal(startsWithArticle("the Forum"), true);
assert.equal(startsWithArticle("An Obelisk"), true);
assert.equal(startsWithArticle("Andes Observatory"), false);
assert.equal(normalizeArticleName("Chichén Itzá"), "chichen itza");
assert.equal(normalizeArticleName("Mont-Saint-Michel"), "mont saint michel");

// NO_ARTICLE_TYPES override wins even when the name would default to "the".
NO_ARTICLE_TYPES.add("BUILDING_TEST_TOPONYM");
assert.equal(articledName({ name: "Someplace", typeId: "BUILDING_TEST_TOPONYM" }), "Someplace");
NO_ARTICLE_TYPES.delete("BUILDING_TEST_TOPONYM");

// End-to-end: the full "It houses …" list reads grammatically.
assert.equal(
  joinNames(highlightNames({
    wonders: [{ nameKey: "Parthenon", type: "BUILDING_PARTHENON" }, { nameKey: "Machu Picchu", type: "" }],
    districts: [{ name: "Acropolis", quarterType: "QUARTER_ACROPOLIS" }]
  })),
  "the Parthenon, Machu Picchu, LOC_DEMOGRAPHICS_SETTLEMENTS_CONGRATS_AND the Acropolis"
);

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
