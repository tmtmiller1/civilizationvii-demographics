import assert from "node:assert/strict";

const savedLocale = globalThis.Locale;
globalThis.Locale = {
  compose: (k, ...args) => {
    if (k === "LOC_CIVILIZATION_ROME_ADJECTIVE") return "Roman";
    if (k === "LOC_CIVILIZATION_EGYPT_ADJECTIVE") return "Egyptian";
    return String(k) + (args.length ? "(" + args.join("|") + ")" : "");
  }
};

const {
  majorsOnSide,
  parseYear,
  nameMergedWars,
  buildWarNameOverrides,
  conflictLabelText,
  warDurationYears,
  buildContinentMap
} = await import(
  "/demographics/ui/screen-demographics/charts/wars/chart-wars-naming.js"
);

assert.equal(majorsOnSide([{ isCS: true }, { isCS: false }, null]).length, 1);
assert.equal(majorsOnSide(null).length, 0);
assert.equal(majorsOnSide(undefined).length, 0);
assert.equal(parseYear("2725 BCE"), -2725);
assert.equal(parseYear("100 CE"), 100);
assert.equal(parseYear("123"), 123);
assert.equal(parseYear(42), 42);
assert.equal(parseYear("bad"), null);
assert.equal(parseYear(null), null);
const savedParseInt = globalThis.parseInt;
globalThis.parseInt = () => NaN;
assert.equal(parseYear("123 CE"), null);
globalThis.parseInt = savedParseInt;

const samples = [
  {
    turn: 10,
    gameYear: "300 BCE",
    players: {
      1: { continent: 1 },
      2: { continent: 1 },
      3: { continent: 2 },
      4: { continent: 2 },
      5: { continent: 1 },
      6: { continent: 2 }
    }
  },
  {
    turn: 400,
    gameYear: "100 CE",
    players: {
      1: { continent: 1 },
      2: { continent: 1 },
      3: { continent: 2 },
      4: { continent: 2 },
      5: { continent: 1 },
      6: { continent: 2 }
    }
  }
];

const continentMap = buildContinentMap(samples);
assert.equal(continentMap.get(1), 1);
assert.equal(continentMap.get(4), 2);
assert.equal(buildContinentMap([{ turn: 1, players: null }]).size, 0);
assert.equal(buildContinentMap(null).size, 0);
assert.equal(buildContinentMap([]).size, 0);

const shortBilateral = {
  warUniqueID: 11,
  name: "Short War",
  startTurn: 10,
  endTurn: 30,
  startYear: "300 BCE",
  endYear: "280 BCE",
  sideACivs: [{ pid: 1, civ: "Rome", civTypeString: "CIVILIZATION_ROME", isCS: false }],
  sideBCivs: [{ pid: 2, civ: "Egypt", civTypeString: "CIVILIZATION_EGYPT", isCS: false }]
};

const longBilateral = {
  warUniqueID: 12,
  name: "Long War",
  startTurn: 40,
  endTurn: 340,
  startYear: "250 BCE",
  endYear: "50 CE",
  sideACivs: [{ pid: 1, civ: "Rome", civTypeString: "CIVILIZATION_ROME", isCS: false }],
  sideBCivs: [{ pid: 2, civ: "Egypt", civTypeString: "CIVILIZATION_EGYPT", isCS: false }]
};

const regionalCoalition = {
  warUniqueID: 13,
  name: "Regional",
  startTurn: 50,
  endTurn: 120,
  sideACivs: [
    { pid: 1, civ: "Rome", civTypeString: "CIVILIZATION_ROME", isCS: false },
    { pid: 2, civ: "Egypt", civTypeString: "CIVILIZATION_EGYPT", isCS: false }
  ],
  sideBCivs: [
    { pid: 5, civ: "Aztec", civTypeString: "CIVILIZATION_AZTEC", isCS: false },
    { pid: 2, civ: "Egypt", civTypeString: "CIVILIZATION_EGYPT", isCS: true }
  ]
};

const worldWar = {
  warUniqueID: 14,
  name: "World",
  startTurn: 60,
  endTurn: 200,
  sideACivs: [
    { pid: 1, civ: "Rome", civTypeString: "CIVILIZATION_ROME", isCS: false },
    { pid: 2, civ: "Egypt", civTypeString: "CIVILIZATION_EGYPT", isCS: false },
    { pid: 3, civ: "Han", civTypeString: "CIVILIZATION_HAN", isCS: false }
  ],
  sideBCivs: [
    { pid: 4, civ: "Aztec", civTypeString: "CIVILIZATION_AZTEC", isCS: false },
    { pid: 5, civ: "Maya", civTypeString: "CIVILIZATION_MAYA", isCS: false },
    { pid: 6, civ: "Zulu", civTypeString: "CIVILIZATION_ZULU", isCS: false }
  ]
};

const oddFallback = {
  warUniqueID: 15,
  name: "Fallback Name",
  startTurn: 70,
  sideACivs: [{ pid: 1, civ: "Rome", civTypeString: "CIVILIZATION_ROME", isCS: true }],
  sideBCivs: []
};

const greatWar = {
  warUniqueID: 16,
  name: "Great War",
  startTurn: 80,
  endTurn: 120,
  sideACivs: [
    { pid: 1, civ: "Rome", civTypeString: "CIVILIZATION_ROME", isCS: false },
    { pid: 2, civ: "Egypt", civTypeString: "CIVILIZATION_EGYPT", isCS: false }
  ],
  sideBCivs: [{ pid: 3, civ: "Han", civTypeString: "CIVILIZATION_HAN", isCS: false }]
};

const sameYearEpic = {
  warUniqueID: 17,
  name: "Same Year",
  startTurn: 90,
  endTurn: 190,
  startYear: "100 CE",
  endYear: "200 CE",
  sideACivs: [{ pid: 1, civ: "Rome", civTypeString: "CIVILIZATION_ROME", isCS: false }],
  sideBCivs: [{ pid: 2, civ: "Egypt", civTypeString: "CIVILIZATION_EGYPT", isCS: false }]
};

const cleanedNameWar = {
  warUniqueID: 18,
  name: "Cleaned",
  startTurn: 95,
  sideACivs: ["the Rome"],
  sideBCivs: ["Egypt"]
};

const invalidNameWar = {
  warUniqueID: 18.25,
  name: "Invalid Name",
  startTurn: 95,
  sideACivs: [{ pid: 7, civ: null, civTypeString: "CIVILIZATION_UNKNOWN", isCS: false }],
  sideBCivs: [{ pid: 6, civ: "", civTypeString: "CIVILIZATION_UNKNOWN", isCS: false }]
};

const emptyStemWar = {
  warUniqueID: 18.5,
  name: "Empty Stem",
  startTurn: 95,
  sideACivs: [{ pid: 7, civ: "Rome", civTypeString: "CIVILIZATION_", isCS: false }],
  sideBCivs: [{ pid: 6, civ: "Egypt", civTypeString: "CIVILIZATION_", isCS: false }]
};

const suffixWars = [
  { warUniqueID: 19, name: "Suffix IA", startTurn: 96, sideACivs: ["Medeia"], sideBCivs: ["Kord"] },
  { warUniqueID: 20, name: "Suffix Y", startTurn: 97, sideACivs: ["Burgundy"], sideBCivs: ["Zora"] },
  { warUniqueID: 21, name: "Suffix A", startTurn: 98, sideACivs: ["Zora"], sideBCivs: ["Mede"] },
  { warUniqueID: 22, name: "Suffix E", startTurn: 99, sideACivs: ["Mede"], sideBCivs: ["Tivolo"] },
  { warUniqueID: 23, name: "Suffix O", startTurn: 100, sideACivs: ["Tivolo"], sideBCivs: ["Kord"] },
  { warUniqueID: 24, name: "Suffix Else", startTurn: 101, sideACivs: ["Kord"], sideBCivs: ["Medeia"] },
  { warUniqueID: 25, name: "Empty Name", startTurn: 102, sideACivs: [""], sideBCivs: [""] }
];

const localeVariantWar = {
  warUniqueID: 26,
  name: "Locale Variant",
  startTurn: 103,
  sideACivs: [{ pid: 9, civ: "Medeia", civTypeString: "CIVILIZATION_UNKNOWN", isCS: false }],
  sideBCivs: [{ pid: 8, civ: "Burgundy", civTypeString: "CIVILIZATION_UNKNOWN", isCS: false }]
};

const wars = [longBilateral, shortBilateral, regionalCoalition, worldWar, oddFallback];
const turnYearMap = new Map([
  [10, "300 BCE"],
  [340, "50 CE"],
  [400, "100 CE"]
]);

const overrides = buildWarNameOverrides(wars, turnYearMap, 400, continentMap);
assert.ok(overrides.get(shortBilateral).includes("LOC_DEMOGRAPHICS_WARNAME_BILATERAL"));
assert.ok(overrides.get(longBilateral).includes("LOC_DEMOGRAPHICS_WARNAME_BILATERAL"));
assert.ok(overrides.get(longBilateral).includes("LOC_DEMOGRAPHICS_WARNAME_CENTURIES"));
assert.ok(overrides.get(regionalCoalition).includes("LOC_DEMOGRAPHICS_WARNAME_REGIONAL"));
assert.ok(overrides.get(worldWar).includes("LOC_DEMOGRAPHICS_WARNAME_WORLD"));
assert.ok(overrides.get(oddFallback).includes("Fallback Name"));

const byId = nameMergedWars(wars, samples);
assert.equal(typeof byId.get(11), "string");
assert.equal(typeof byId.get(14), "string");
assert.equal(nameMergedWars([], [{}, {}]).size, 0);

assert.equal(warDurationYears(shortBilateral, turnYearMap, 400), 20);
assert.equal(warDurationYears({ startTurn: 1, endTurn: 1 }, turnYearMap, 400), 1);
assert.equal(
  warDurationYears(
    {
      startYear: "100 CE",
      endYear: "100 CE",
      startTurn: 10,
      endTurn: 20
    },
    turnYearMap,
    400
  ),
  1
);

const label = conflictLabelText(shortBilateral, overrides, turnYearMap, 400);
assert.ok(label.includes("LOC_DEMOGRAPHICS_WARS_DURATION_YR"));
const oneYearLabel = conflictLabelText({ ...shortBilateral, startYear: "100 CE", endYear: "101 CE", startTurn: 1, endTurn: 2 }, overrides, turnYearMap, 400);
assert.ok(oneYearLabel.includes("LOC_DEMOGRAPHICS_WARS_DURATION_YR_ONE"));

const epicOverridden = buildWarNameOverrides(
  [
    shortBilateral,
    { ...shortBilateral, warUniqueID: 28, startTurn: 11, endTurn: 31 },
    sameYearEpic
  ],
  turnYearMap,
  400,
  continentMap
);
assert.ok(epicOverridden.get(sameYearEpic).includes("LOC_DEMOGRAPHICS_WARNAME_HUNDRED"));

const yearsWar = { ...shortBilateral, warUniqueID: 28.75, startTurn: 13, endTurn: 163, startYear: "100 CE", endYear: "250 CE" };
const yearsOverridden = buildWarNameOverrides(
  [shortBilateral, { ...shortBilateral, warUniqueID: 28.5, startTurn: 12, endTurn: 32 }, yearsWar],
  turnYearMap,
  400,
  continentMap
);
assert.ok(String(yearsOverridden.get(yearsWar)).includes("LOC_DEMOGRAPHICS_WARNAME_YEARS"));

const greatOverrides = buildWarNameOverrides([greatWar], turnYearMap, 400, continentMap);
assert.ok(greatOverrides.get(greatWar).includes("LOC_DEMOGRAPHICS_WARNAME_GREAT"));

const cleanedOverrides = buildWarNameOverrides([cleanedNameWar], turnYearMap, 400, continentMap);
assert.ok(cleanedOverrides.get(cleanedNameWar).includes("Roman"));

const invalidNameOverrides = buildWarNameOverrides([invalidNameWar], turnYearMap, 400, continentMap);
assert.equal(typeof invalidNameOverrides.get(invalidNameWar), "string");

const noSampleName = nameMergedWars([], []);
assert.equal(noSampleName.size, 0);

const noPlayersMap = buildContinentMap(null);
assert.equal(noPlayersMap.size, 0);

const allLarge = buildWarNameOverrides([worldWar, { ...worldWar, warUniqueID: 30, startTurn: 61, endTurn: 210 }], turnYearMap, 400, continentMap);
assert.equal(typeof allLarge.get(worldWar), "string");

const worldWars = [
  { ...worldWar, warUniqueID: 40, startTurn: 70, endTurn: 220 },
  { ...worldWar, warUniqueID: 41, startTurn: 71, endTurn: 221 },
  { ...worldWar, warUniqueID: 42, startTurn: 72, endTurn: 222 },
  { ...worldWar, warUniqueID: 43, startTurn: 73, endTurn: 223 },
  { ...worldWar, warUniqueID: 44, startTurn: 74, endTurn: 224 },
  { ...worldWar, warUniqueID: 45, startTurn: 75, endTurn: 225 }
];
const worldWarOverrides = buildWarNameOverrides(worldWars, turnYearMap, 400, continentMap);
assert.equal(worldWarOverrides.size, 6);

const missingStartTurnWars = [
  { ...shortBilateral, warUniqueID: 46, startTurn: undefined },
  { ...shortBilateral, warUniqueID: 47, startTurn: undefined },
  { ...worldWar, warUniqueID: 48, startTurn: undefined }
];
assert.equal(buildWarNameOverrides(missingStartTurnWars, turnYearMap, 400, continentMap).size, 3);

const unknownSideAWar = {
  warUniqueID: 49,
  name: "Unknown Side A",
  startTurn: 90,
  endTurn: 95,
  startYear: "80 CE",
  endYear: "85 CE",
  sideACivs: [{ pid: 1, civ: "City State", civTypeString: "CIVILIZATION_UNKNOWN", isCS: true }],
  sideBCivs: [
    { pid: 2, civ: "Rome", civTypeString: "CIVILIZATION_ROME", isCS: false },
    { pid: 3, civ: "Egypt", civTypeString: "CIVILIZATION_EGYPT", isCS: false }
  ]
};
const unknownSideBWar = {
  warUniqueID: 50,
  name: "Unknown Side B",
  startTurn: 96,
  endTurn: 100,
  startYear: "86 CE",
  endYear: "90 CE",
  sideACivs: [
    { pid: 4, civ: "Rome", civTypeString: "CIVILIZATION_ROME", isCS: false },
    { pid: 5, civ: "Egypt", civTypeString: "CIVILIZATION_EGYPT", isCS: false }
  ],
  sideBCivs: [{ pid: 6, civ: "City State", civTypeString: "CIVILIZATION_UNKNOWN", isCS: true }]
};
const unknownSideOverrides = buildWarNameOverrides([unknownSideAWar, unknownSideBWar], turnYearMap, 400, continentMap);
assert.equal(typeof unknownSideOverrides.get(unknownSideAWar), "string");
assert.equal(typeof unknownSideOverrides.get(unknownSideBWar), "string");

const emptyStemOverrides = buildWarNameOverrides([emptyStemWar], turnYearMap, 400, continentMap);
assert.equal(typeof emptyStemOverrides.get(emptyStemWar), "string");

const suffixOverrides = buildWarNameOverrides(suffixWars, turnYearMap, 400, continentMap);
assert.ok(suffixOverrides.get(suffixWars[0]).includes("Medeiaian"));
assert.ok(suffixOverrides.get(suffixWars[1]).includes("Burgundyian"));
assert.ok(suffixOverrides.get(suffixWars[2]).includes("Zoran"));
assert.ok(suffixOverrides.get(suffixWars[3]).includes("Medean"));
assert.ok(suffixOverrides.get(suffixWars[4]).includes("Tivoloan"));
assert.ok(suffixOverrides.get(suffixWars[5]).includes("Kordan"));
assert.ok(suffixOverrides.get(suffixWars[6]).includes("Empty Name"));

const plainObjectWar = {
  warUniqueID: 27,
  name: "Plain Object",
  startTurn: 104,
  sideACivs: [{ pid: 7, civ: "Medeia", civTypeString: "CIVILIZATION_UNKNOWN", isCS: false }],
  sideBCivs: [{ pid: 6, civ: "Tivolo", civTypeString: "CIVILIZATION_UNKNOWN", isCS: false }]
};

const missingComposeLocale = {};
const nonFunctionComposeLocale = { compose: "nope" };
const nonStringComposeLocale = { compose: () => 7 };
const emptyComposeLocale = { compose: () => "" };
const locPrefixComposeLocale = { compose: () => "LOC_TEST_PREFIX" };
const throwingComposeLocale = { compose: () => { throw new Error("boom"); } };

function runLocaleVariant(localeValue, war) {
  const previous = globalThis.Locale;
  if (localeValue === undefined) delete globalThis.Locale;
  else globalThis.Locale = localeValue;
  try {
    return buildWarNameOverrides([war], turnYearMap, 400, continentMap);
  } finally {
    if (previous === undefined) delete globalThis.Locale;
    else globalThis.Locale = previous;
  }
}

runLocaleVariant(undefined, plainObjectWar);
runLocaleVariant(missingComposeLocale, plainObjectWar);
runLocaleVariant(nonFunctionComposeLocale, plainObjectWar);
runLocaleVariant(nonStringComposeLocale, plainObjectWar);
runLocaleVariant(emptyComposeLocale, plainObjectWar);
runLocaleVariant(locPrefixComposeLocale, plainObjectWar);
runLocaleVariant(throwingComposeLocale, plainObjectWar);

const savedPush = Array.prototype.push;
Array.prototype.push = function (...args) {
  return this.length;
};
try {
  const noRomanWar = {
    warUniqueID: 29,
    name: "No Roman",
    startTurn: 105,
    sideACivs: [
      { pid: 1, civ: "Rome", civTypeString: "CIVILIZATION_ROME", isCS: false },
      { pid: 2, civ: "Egypt", civTypeString: "CIVILIZATION_EGYPT", isCS: false },
      { pid: 3, civ: "Han", civTypeString: "CIVILIZATION_HAN", isCS: false }
    ],
    sideBCivs: [
      { pid: 4, civ: "Aztec", civTypeString: "CIVILIZATION_AZTEC", isCS: false },
      { pid: 5, civ: "Maya", civTypeString: "CIVILIZATION_MAYA", isCS: false },
      { pid: 6, civ: "Zulu", civTypeString: "CIVILIZATION_ZULU", isCS: false }
    ]
  };
  const noRomanOverrides = buildWarNameOverrides([noRomanWar], turnYearMap, 400, continentMap);
  assert.ok(String(noRomanOverrides.get(noRomanWar)).includes("LOC_DEMOGRAPHICS_WARNAME_WORLD"));
} finally {
  Array.prototype.push = savedPush;
}

if (savedLocale === undefined) delete globalThis.Locale;
else globalThis.Locale = savedLocale;

console.log("wars-naming-branches harness passed");
