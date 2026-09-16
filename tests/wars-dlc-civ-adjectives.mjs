// Covers: chart-wars-naming.js CIV_ADJECTIVE fallback for shipped civilizations.
//
// War names resolve a civ's adjective from the engine string
// (LOC_CIVILIZATION_<STEM>_ADJECTIVE) whenever the war record carries a
// civTypeString. When it does not — older saves, or any name-only path — naming
// falls back to the bundled CIV_ADJECTIVE map and then to an English suffix
// heuristic. The heuristic is wrong for most real civ names ("Gauls" -> "Gaulsan",
// "Babylon" -> "Babylonan"), so every shipped civ needs an entry whose KEY is the
// game's actual display name. Several original keys were written from guessed
// names and never matched ("Babylonia" vs the shipped "Babylon", "Britain" vs
// "Great Britain"), which is what this test exists to catch.
//
// Values below are the game's own en_us LOC_CIVILIZATION_*_NAME / _ADJECTIVE
// pairs, audited against Civilization VII 1.5.0 including the Babylon / England /
// Gaul DLC.
import assert from "node:assert/strict";
import fs from "node:fs";

const xml = fs.readFileSync("text/en_us/ModText.xml", "utf8");
/** @type {Record<string,string>} */
const MOD = {};
for (const m of xml.matchAll(/<Row Tag="([^"]+)">\s*<Text>([\s\S]*?)<\/Text>/g)) {
  MOD[m[1]] = m[2].trim();
}
// Locale stub that knows only the mod's OWN strings, so the civ adjective must
// come from the bundled map rather than the engine.
globalThis.Locale = {
  compose(key, ...args) {
    const raw = MOD[key] ?? String(key);
    return raw
      .replace(/\{(\d+)_[A-Za-z]+\}/g, (_m, n) => String(args[Number(n) - 1] ?? ""))
      .trim()
      .replace(/\s{2,}/g, " ");
  }
};

const { nameMergedWars } = await import(
  "/demographics/ui/screen-demographics/charts/wars/chart-wars-naming.js"
);

const CONTROL = { pid: 99, civ: "Rome" }; // "Roman" — a known-good entry
const SAMPLES = [
  { chartTurn: 10, turn: 10, players: {} },
  { chartTurn: 30, turn: 30, players: {} }
];

/**
 * The adjective the namer produces for a civ given ONLY its display name.
 * @param {string} displayName The game's LOC_CIVILIZATION_*_NAME text.
 * @returns {string|null} The adjective, or null when the name could not be parsed.
 */
function fallbackAdjective(displayName) {
  const wars = [
    {
      warUniqueID: 1,
      sideACivs: [{ pid: 1, civ: displayName }],
      sideBCivs: [CONTROL],
      startTurn: 10,
      endTurn: 30
    }
  ];
  const name = [...nameMergedWars(wars, SAMPLES).values()][0];
  const m = /First (.+)–(.+) War/.exec(String(name));
  if (!m) return null;
  return m[1] === "Roman" ? m[2] : m[1];
}

// Control: prove the harness resolves a civ that has always been in the map.
assert.equal(fallbackAdjective("Egypt"), "Egyptian", "control civ must resolve from the map");

// The 1.5.0 DLC civilizations.
assert.equal(fallbackAdjective("Babylon"), "Babylonian", "Babylon (1.5.0 DLC)");
assert.equal(fallbackAdjective("England"), "English", "England (1.5.0 DLC)");
assert.equal(fallbackAdjective("Gauls"), "Gallic", "Gauls (1.5.0 DLC)");

// Shipped civs whose display name differs from the guessed key originally used.
const SHIPPED = {
  "Great Britain": "British",
  "Achaemenid Persia": "Achaemenid Persian",
  "French Empire": "French Imperial",
  "Meiji Japan": "Meiji Japanese",
  "Sengoku Japan": "Sengoku",
  "Hawai'i": "Hawaiian",
  Mongolia: "Mongolian",
  Maya: "Maya",
  Goryeo: "Goryeo",
  Joseon: "Joseon",
  Nepal: "Nepalese"
};
for (const [name, want] of Object.entries(SHIPPED)) {
  assert.equal(fallbackAdjective(name), want, name + " must use the game's own adjective");
}

// The engine string must still win when the record carries a civTypeString, even
// if the bundled map disagrees.
globalThis.Locale = {
  compose(key, ...args) {
    if (key === "LOC_CIVILIZATION_GAUL_ADJECTIVE") return "ENGINE_WINS";
    const raw = MOD[key] ?? String(key);
    return raw
      .replace(/\{(\d+)_[A-Za-z]+\}/g, (_m, n) => String(args[Number(n) - 1] ?? ""))
      .trim()
      .replace(/\s{2,}/g, " ");
  }
};
const wars = [
  {
    warUniqueID: 1,
    sideACivs: [{ pid: 1, civ: "Gauls", civTypeString: "CIVILIZATION_GAUL" }],
    sideBCivs: [CONTROL],
    startTurn: 10,
    endTurn: 30
  }
];
assert.match(
  String([...nameMergedWars(wars, SAMPLES).values()][0]),
  /ENGINE_WINS/,
  "the engine adjective must take precedence over the bundled map"
);

delete globalThis.Locale;
console.log("wars-dlc-civ-adjectives harness passed (1.5.0 DLC civs + shipped display names)");
