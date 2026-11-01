// Sample-bearing history fixtures shared by the tests that read them and by the pack round trip.
// Every export is a builder: each call returns fresh objects, because some callers (localizeStoredNames)
// change the history in place. `allHistories()` lists them all for tests that want every shape.

/** storage-display-names: stored names in two languages, a null player and a null sample, wars and risings. */
export function displayNamesHistory() {
  return {
    samples: [
      {
        players: {
          0: {
            civName: "Great Britain",
            leaderName: "Augustus",
            civTypeString: "CIVILIZATION_GREAT_BRITAIN",
            leaderTypeString: "LEADER_AUGUSTUS"
          }
        }
      },
      {
        players: {
          0: {
            civName: "몽골",
            leaderName: "아우구스투스",
            civTypeString: "CIVILIZATION_MONGOLIA",
            leaderTypeString: "LEADER_AUGUSTUS"
          },
          1: { civName: "Kept", leaderName: "City-State", civTypeString: "CIVILIZATION_NOTEXT" },
          2: null
        }
      },
      null
    ],
    wars: [
      {
        name: "1st Great Britain vs Villages War",
        _nameKeyA: "Great Britain",
        sideACivs: [
          {
            pid: 0,
            civ: "Great Britain",
            leader: "Augustus",
            civTypeString: "CIVILIZATION_GREAT_BRITAIN",
            leaderType: "LEADER_AUGUSTUS"
          }
        ],
        sideBCivs: [
          { pid: 34, civ: "Villages", leader: "", isCS: true },
          { pid: 40, civ: "Kumbi Saleh", leader: "", isCS: true },
          { pid: 41, civ: "Villages", leader: "", isCS: false },
          { pid: 42, civ: "촌락", leader: "", isCS: false }
        ],
        declaredBy: { pid: 0, civ: "Great Britain", leader: "Augustus" }
      },
      null,
      { sideACivs: 5 }
    ],
    risings: [
      {
        id: 1,
        ownerCiv: { civ: "Great Britain", civTypeString: "CIVILIZATION_GREAT_BRITAIN", leader: "Augustus",
          leaderType: "LEADER_AUGUSTUS" },
        otherCiv: { civ: "Mongolia", civTypeString: "CIVILIZATION_MONGOLIA" }
      },
      null,
      { id: 2 }
    ]
  };
}

/** wars-naming: six players on two continents, sampled at two turns. */
export function continentSamples() {
  return [
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
}

export const HAN = { civName: "Han", civTypeString: "CIVILIZATION_HAN" };
export const QAJAR = { civName: "Qajar", civTypeString: "CIVILIZATION_QAJAR" };
export const ROME = { civName: "Rome", civTypeString: "CIVILIZATION_ROME" };

/** wars-civ-naming: player 7 was Han at chart turn 5 and Qajar by 200; player 3 stays Rome. */
export function civSwitchSamples() {
  return [
    { chartTurn: 5, players: { 7: { ...HAN }, 3: { ...ROME } } },
    { chartTurn: 200, players: { 7: { ...QAJAR }, 3: { ...ROME } } }
  ];
}

/** sampler-risings: four samples across an age change, no players. */
export function ageChangeSamples() {
  return [
    { age: "AGE_ANTIQUITY", localTurn: 90, chartTurn: 90, gameYear: "100 CE" },
    { age: "AGE_ANTIQUITY", localTurn: 100, chartTurn: 100, gameYear: "200 CE" },
    { age: "AGE_EXPLORATION", localTurn: 1, chartTurn: 101, gameYear: "250 CE" },
    { age: "AGE_EXPLORATION", localTurn: 20, chartTurn: 120, gameYear: "400 CE" }
  ];
}

/** sampler-risings: one player whose civ changes at the age boundary (Heian to Sengoku). */
export function heianSengokuSamples() {
  return [
    { age: "AGE_ANTIQUITY", localTurn: 119, chartTurn: 119, gameYear: "275 BCE",
      players: { 0: { civName: "Heian Japan", civTypeString: "CIVILIZATION_HEIAN", leaderName: "Himiko" } } },
    { age: "AGE_ANTIQUITY", localTurn: 120, chartTurn: 120, gameYear: "250 BCE",
      players: { 0: { civName: "Heian Japan", civTypeString: "CIVILIZATION_HEIAN", leaderName: "Himiko" } } },
    { age: "AGE_EXPLORATION", localTurn: 1, chartTurn: 121, gameYear: "1 CE",
      players: { 0: { civName: "Sengoku Japan", civTypeString: "CIVILIZATION_SENGOKU", leaderName: "Himiko" } } }
  ];
}

/** risings-chart: local 0 (Rome), met 2 (Greece), unmet 3 (Persia); the first sample has no players. */
export function risingsChartSamples() {
  const player = (civ, met, color) => ({ civName: civ, met, primaryColor: color, secondaryColor: "#ffffff" });
  return [
    { age: "AGE_ANTIQUITY", localTurn: 40, chartTurn: 40, gameYear: "1000 BCE", players: {} },
    {
      age: "AGE_ANTIQUITY", localTurn: 60, chartTurn: 60, gameYear: "600 BCE",
      players: {
        0: player("Rome", true, "#aa0000"),
        2: player("Greece", true, "#0000aa"),
        3: player("Persia", false, "#00aa00")
      }
    }
  ];
}

/** Every fixture above as a history, for tests that want each shape once. */
export function allHistories() {
  return [
    ["displayNames", displayNamesHistory()],
    ["continents", { version: 1, seed: "s", samples: continentSamples(), ageBoundaries: [], eliminated: {} }],
    ["civSwitch", { version: 1, seed: 7, samples: civSwitchSamples(), ageBoundaries: [], eliminated: {} }],
    ["ageChange", { version: 1, seed: "s", samples: ageChangeSamples(), ageBoundaries: [], eliminated: {} }],
    ["heianSengoku", { version: 1, seed: "s", samples: heianSengokuSamples(), ageBoundaries: [], eliminated: {} }],
    ["risingsChart", { version: 1, seed: "s", samples: risingsChartSamples(), ageBoundaries: [], eliminated: {} }]
  ];
}
