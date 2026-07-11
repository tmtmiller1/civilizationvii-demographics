import assert from "node:assert/strict";

import { runWarTracker } from "/demographics/ui/sampler/sampler-wars-core.js";
import DemographicsStorage from "/demographics/ui/storage/demographics-storage.js";
import {
  augmentWarsWithAllies,
  augmentWarsWithCityStates,
  migrateWarRecords,
  pidInfo
} from "/demographics/ui/sampler/sampler-wars-augment.js";

const originalGame = globalThis.Game;
const originalPlayers = globalThis.Players;
const originalLocale = globalThis.Locale;
const originalStoragePeek = DemographicsStorage.peek;
const originalStorageLoad = DemographicsStorage.load;
const originalStorageSave = DemographicsStorage.save;

const phase = { value: 1 };

const playerHandles = new Map([
  [1, {
    id: 1,
    isMinor: false,
    civilizationName: "Alpha",
    civilizationType: "CIVILIZATION_ALPHA",
    Diplomacy: {
      hasAllied: () => false,
      hasDefensivePact: () => false
    }
  }],
  [2, {
    id: 2,
    isMinor: false,
    civilizationName: "Beta",
    civilizationType: "CIVILIZATION_BETA",
    Diplomacy: {
      hasAllied: () => false,
      hasDefensivePact: () => false
    }
  }],
  [3, {
    id: 3,
    isMinor: false,
    civilizationName: "Gamma",
    civilizationType: "CIVILIZATION_GAMMA",
    Diplomacy: {
      hasAllied: () => false,
      hasDefensivePact: () => false
    }
  }]
]);

function eventsForPhase(pid) {
  if (pid !== 1) return [];
  if (phase.value === 4 || phase.value === 8 || phase.value === 10) return [];
  if (phase.value === 9) {
    return [{ actionTypeName: "DIPLOMACY_ACTION_DECLARE_WAR", uniqueID: 9003 }];
  }
  if (phase.value >= 6) {
    return [{ actionTypeName: "DIPLOMACY_ACTION_DECLARE_WAR", uniqueID: 9002 }];
  }
  return [{ actionTypeName: "DIPLOMACY_ACTION_DECLARE_WAR", uniqueID: 9001 }];
}

function supportersForPhase() {
  if (phase.value === 2) return [{ id: 3 }];
  return [];
}

globalThis.Players = {
  getAlive: () => Array.from(playerHandles.values()),
  get: (pid) => playerHandles.get(Number(pid)) || null
};

globalThis.Game = {
  Diplomacy: {
    getPlayerEvents: (pid) => eventsForPhase(pid),
    getDiplomaticEventData: (uid) => {
      assert.ok(uid === 9001 || uid === 9002 || uid === 9003);
      return { initialPlayer: 1, targetPlayer: 2, startTurn: 1 };
    },
    getSupportingPlayersWithBonusEnvoys: () => supportersForPhase(),
    getOpposingPlayersWithBonusEnvoys: () => []
  },
  getTurnDate: () => `YEAR_${phase.value}`
};

globalThis.Locale = {
  compose: (s) => s
};

function makeSnapshot(chartTurn) {
  return {
    chartTurn,
    players: {
      1: {
        civName: "Alpha",
        leaderName: "Leader Alpha",
        primaryColor: "#111111",
        civTypeString: "CIVILIZATION_ALPHA"
      },
      2: {
        civName: "Beta",
        leaderName: "Leader Beta",
        primaryColor: "#222222",
        civTypeString: "CIVILIZATION_BETA"
      },
      3: {
        civName: "Gamma",
        leaderName: "Leader Gamma",
        primaryColor: "#333333",
        civTypeString: "CIVILIZATION_GAMMA"
      }
    }
  };
}

const history = {
  version: 1,
  seed: "test-seed",
  samples: [],
  ageBoundaries: [],
  eliminated: {},
  wars: []
};

const standaloneStore = {
  version: 1,
  seed: "standalone-seed",
  samples: [],
  ageBoundaries: [],
  eliminated: {},
  wars: []
};
const saveCalls = [];
DemographicsStorage.peek = () => standaloneStore;
DemographicsStorage.load = () => standaloneStore;
DemographicsStorage.save = (h) => {
  saveCalls.push(h);
};

// Turn 1: starts a new war with sides 1 vs 2.
phase.value = 1;
runWarTracker(makeSnapshot(101), 1, history);
assert.equal(history.wars.length, 1, "first active declaration should create one war record");
const war = history.wars[0];
assert.equal(war.warUniqueID, 9001);
assert.deepEqual(war.sideA, [1]);
assert.deepEqual(war.sideB, [2]);
assert.equal(war.startTurn, 1);
assert.equal(war.startChartTurn, 101);
assert.equal(war.lastChartTurn, 101);
assert.equal(war.endTurn, null);
assert.equal(war.declaredBy?.pid, 1);
assert.ok(String(war.name).startsWith("1st "));

// Turn 2: supporter 3 joins sideA.
phase.value = 2;
runWarTracker(makeSnapshot(102), 2, history);
assert.deepEqual(war.sideA.sort((a, b) => a - b), [1, 3]);
const entrant = war.sideACivs.find((p) => p.pid === 3);
assert.ok(entrant, "new side entrant should be tracked in cumulative roster");
assert.equal(entrant.joinTurn, 2);
assert.equal(entrant.active, true);
assert.equal(war.lastChartTurn, 102);

// Turn 3: supporter 3 leaves the active side and should be marked inactive.
phase.value = 3;
runWarTracker(makeSnapshot(103), 3, history);
const departed = war.sideACivs.find((p) => p.pid === 3);
assert.ok(departed, "existing participant should remain in cumulative roster after leaving");
assert.equal(departed.active, false);
assert.equal(departed.leaveTurn, 3);
assert.deepEqual(war.sideA.sort((a, b) => a - b), [1, 3]);
assert.equal(war.lastChartTurn, 103);

// Turn 4: no active events; war should close and map end to last active chart turn.
phase.value = 4;
runWarTracker(makeSnapshot(104), 4, history);
assert.equal(war.endTurn, 4);
assert.equal(war.endYear, "YEAR_4");
assert.equal(war.endChartTurn, 103);

// Turn 5: war reappears with same unique id; existing record reopens.
phase.value = 5;
runWarTracker(makeSnapshot(105), 5, history);
assert.equal(war.endTurn, null, "existing record should reopen when war becomes active again");
assert.equal(war.endYear, null);
assert.equal(war.lastChartTurn, 105);

// Turn 6: new unique war id with same sides should be named as the second conflict.
phase.value = 6;
runWarTracker(makeSnapshot(106), 6, history);
assert.equal(history.wars.length, 2, "new unique id should produce a new war record");
const war2 = history.wars.find((w) => w.warUniqueID === 9002);
assert.ok(war2, "second unique id war must be present");
assert.ok(String(war2.name).startsWith("2nd "));

// Turn 7 keeps war2 active then turn 8 closes it.
phase.value = 7;
runWarTracker(makeSnapshot(107), 7, history);
assert.equal(war2.lastChartTurn, 107);
phase.value = 8;
runWarTracker(makeSnapshot(108), 8, history);
assert.equal(war2.endTurn, 8);
assert.equal(war2.endChartTurn, 107);

// Turn 9 starts third conflict with same sides; ordinal should become 3rd.
phase.value = 9;
runWarTracker(makeSnapshot(109), 9, history);
const war3 = history.wars.find((w) => w.warUniqueID === 9003);
assert.ok(war3, "third unique id war must be present");
assert.ok(String(war3.name).startsWith("3rd "));

// Turn 10 closes war3 cleanly.
phase.value = 10;
runWarTracker(makeSnapshot(110), 10, history);
assert.equal(war3.endTurn, 10);

// Standalone path (no threaded history) should persist exactly once when APIs are valid.
phase.value = 1;
saveCalls.length = 0;
runWarTracker(makeSnapshot(201), 201);
assert.equal(saveCalls.length, 1, "standalone tracker should persist once");
assert.equal(saveCalls[0], standaloneStore, "standalone save should use resolved store object");

// Missing Players.getAlive should short-circuit without persisting.
globalThis.Players = {};
saveCalls.length = 0;
runWarTracker(makeSnapshot(202), 202);
assert.equal(saveCalls.length, 0, "missing getAlive should skip save");

// Missing diplomacy APIs should short-circuit without persisting.
globalThis.Players = {
  getAlive: () => Array.from(playerHandles.values()),
  get: (pid) => playerHandles.get(Number(pid)) || null
};
globalThis.Game = {
  getTurnDate: () => "YEAR_STANDALONE"
};
runWarTracker(makeSnapshot(203), 203);
assert.equal(saveCalls.length, 0, "missing diplomacy API should skip save");

// readTurnDate should tolerate empty and throwing sources while still building the war record.
const turnDateHistory = {
  version: 1,
  seed: "turn-date-seed",
  samples: [],
  ageBoundaries: [],
  eliminated: {},
  wars: []
};
globalThis.Game = {
  Diplomacy: {
    getPlayerEvents: (pid) => eventsForPhase(pid),
    getDiplomaticEventData: (uid) => {
      assert.ok(uid === 9001 || uid === 9002 || uid === 9003);
      return { initialPlayer: 1, targetPlayer: 2, startTurn: 1 };
    },
    getSupportingPlayersWithBonusEnvoys: () => supportersForPhase(),
    getOpposingPlayersWithBonusEnvoys: () => []
  },
  getTurnDate: () => ""
};
phase.value = 1;
runWarTracker(makeSnapshot(204), 204, turnDateHistory);
assert.equal(turnDateHistory.wars[0].startYear, undefined);

const throwingTurnDateHistory = {
  version: 1,
  seed: "turn-date-throw-seed",
  samples: [],
  ageBoundaries: [],
  eliminated: {},
  wars: []
};
globalThis.Game.getTurnDate = () => {
  throw new Error("clock not ready");
};
runWarTracker(makeSnapshot(205), 205, throwingTurnDateHistory);
assert.equal(throwingTurnDateHistory.wars[0].startYear, undefined);

// Augment helpers: allies are added once and never duplicated.
const allyWars = new Map([
  [
    1,
    {
      sideA: [1],
      sideB: [2]
    }
  ]
]);
const allyPlayers = [
  {
    id: 1,
    isMinor: false,
    Diplomacy: {
      hasAllied: (id) => id === 3,
      hasDefensivePact: () => false
    }
  },
  {
    id: 2,
    isMinor: false,
    Diplomacy: {
      hasAllied: () => false,
      hasDefensivePact: () => false
    }
  },
  {
    id: 3,
    isMinor: false,
    Diplomacy: {
      hasAllied: () => false,
      hasDefensivePact: () => false
    }
  }
];
augmentWarsWithAllies(allyWars, allyPlayers);
augmentWarsWithAllies(allyWars, allyPlayers);
assert.deepEqual(allyWars.get(1).sideA.sort((a, b) => a - b), [1, 3]);
assert.deepEqual(allyWars.get(1).sideB, [2]);

// Augment helpers: suzerained city-states are appended once.
const csWars = new Map([
  [
    2,
    {
      sideA: [1],
      sideB: [2]
    }
  ]
]);
const csPlayers = [
  { id: 1, isMinor: false },
  { id: 2, isMinor: false },
  {
    id: 41,
    isMinor: true,
    Influence: {
      getSuzerain: () => 1
    }
  }
];
augmentWarsWithCityStates(csWars, csPlayers);
augmentWarsWithCityStates(csWars, csPlayers);
assert.deepEqual(csWars.get(2).sideA.sort((a, b) => a - b), [1, 41]);

// pidInfo fallback + CS name detection branch.
globalThis.Locale = {
  compose: (s) => s
};
const fallbackInfo = pidInfo({ players: {} }, "99");
assert.equal(fallbackInfo.civ, "Player 99");
assert.equal(fallbackInfo.isCS, false);
const nameDetected = pidInfo(
  {
    players: {
      77: {
        civName: "Village"
      }
    }
  },
  77
);
assert.equal(nameDetected.isCS, true);

// migrateWarRecords legacy migration path + historical civ pinning.
const legacyWar = {
  aPid: 1,
  bPid: 2,
  startTurn: 5,
  endTurn: null,
  startChartTurn: 100,
  sideACivs: [],
  sideBCivs: []
};
const legacyWars = [legacyWar];
migrateWarRecords(
  makeSnapshot(210),
  legacyWars,
  [
    {
      chartTurn: 100,
      players: {
        1: { civName: "Ancient Alpha", civTypeString: "CIVILIZATION_ALPHA_OLD" },
        2: { civName: "Ancient Beta", civTypeString: "CIVILIZATION_BETA_OLD" }
      }
    }
  ]
);
assert.deepEqual(legacyWar.sideA, [1]);
assert.deepEqual(legacyWar.sideB, [2]);
assert.equal(legacyWar.sideACivs[0].civ, "Ancient Alpha");
assert.equal(legacyWar.sideBCivs[0].civ, "Ancient Beta");
assert.equal(legacyWar.sideACivs[0].civTypeString, "CIVILIZATION_ALPHA_OLD");

// pidInfo: snapshot civTypeString takes precedence over live fallback.
const pinnedCivType = pidInfo(
  {
    players: {
      1: {
        civName: "Snapshot Alpha",
        leaderName: "Leader Alpha",
        primaryColor: "#101010",
        civTypeString: "CIVILIZATION_ALPHA_PINNED"
      }
    }
  },
  1
);
assert.equal(pinnedCivType.civTypeString, "CIVILIZATION_ALPHA_PINNED");

// pidInfo: resolve live civ type string when snapshot civTypeString is missing.
const liveCivType = pidInfo(
  {
    players: {
      2: {
        civName: "Snapshot Beta",
        leaderName: "Leader Beta",
        primaryColor: "#202020"
      }
    }
  },
  2
);
assert.equal(liveCivType.civTypeString, "CIVILIZATION_BETA");

// pidInfo: live civ should use raw value when Locale.compose is unavailable.
globalThis.Locale = {};
playerHandles.set(4, {
  id: 4,
  isMinor: false,
  civilizationName: "Live Delta",
  civilizationType: "CIVILIZATION_DELTA",
  Diplomacy: {
    hasAllied: () => false,
    hasDefensivePact: () => false
  }
});
const localeFallback = pidInfo(
  {
    players: {
      4: {
        leaderName: "Leader Delta",
        primaryColor: "#404040"
      }
    }
  },
  4
);
assert.equal(localeFallback.civ, "Live Delta");

// pidInfo: stale player reads should fall back to cached civ and non-CS.
const priorPlayersGet = globalThis.Players.get;
globalThis.Players.get = () => {
  throw new Error("stale handle");
};
const staleFallback = pidInfo(
  {
    players: {
      9: {
        civName: "Cached Nine",
        leaderName: "Leader Nine",
        primaryColor: "#909090"
      }
    }
  },
  9
);
assert.equal(staleFallback.civ, "Cached Nine");
assert.equal(staleFallback.isCS, false);
assert.equal(staleFallback.civTypeString, undefined);
globalThis.Players.get = priorPlayersGet;

// detectCityState flag coverage: explicit booleans/functions and major/full-civ fallback.
playerHandles.set(51, {
  id: 51,
  civilizationName: "Minor Flag",
  isMinor: true,
  civilizationType: "CIVILIZATION_MINOR_FLAG",
  Diplomacy: {
    hasAllied: () => false,
    hasDefensivePact: () => false
  }
});
playerHandles.set(52, {
  id: 52,
  isMinor: false,
  civilizationName: "Independent Flag",
  isIndependent: () => true,
  civilizationType: "CIVILIZATION_INDEPENDENT_FLAG",
  Diplomacy: {
    hasAllied: () => false,
    hasDefensivePact: () => false
  }
});
playerHandles.set(53, {
  id: 53,
  isMinor: false,
  civilizationName: "CityState Flag",
  isCityState: () => true,
  civilizationType: "CIVILIZATION_CITYSTATE_FLAG",
  Diplomacy: {
    hasAllied: () => false,
    hasDefensivePact: () => false
  }
});
playerHandles.set(54, {
  id: 54,
  isMinor: false,
  civilizationName: "Village",
  isMajor: () => false,
  civilizationType: "CIVILIZATION_VILLAGE",
  Diplomacy: {
    hasAllied: () => false,
    hasDefensivePact: () => false
  }
});
playerHandles.set(55, {
  id: 55,
  isMinor: false,
  civilizationName: "Independent Powers",
  isFullCiv: () => false,
  civilizationType: "CIVILIZATION_INDEPENDENT_POWERS",
  Diplomacy: {
    hasAllied: () => false,
    hasDefensivePact: () => false
  }
});
playerHandles.set(56, {
  id: 56,
  isMinor: false,
  civilizationName: "City-State Vanguard",
  isIndependent: () => {
    throw new Error("stale boolean thunk");
  },
  isMajor: () => true,
  isFullCiv: () => true,
  civilizationType: "CIVILIZATION_CITY_STATE_VANGUARD",
  Diplomacy: {
    hasAllied: () => false,
    hasDefensivePact: () => false
  }
});

const csMinor = pidInfo({ players: {} }, 51);
const csIndependent = pidInfo({ players: {} }, 52);
const csCityState = pidInfo({ players: {} }, 53);
const csMajorFalse = pidInfo({ players: {} }, 54);
const csFullFalse = pidInfo({ players: {} }, 55);
const csNameFallback = pidInfo({ players: {} }, 56);
assert.equal(csMinor.isCS, true);
assert.equal(csIndependent.isCS, true);
assert.equal(csCityState.isCS, true);
assert.equal(csMajorFalse.isCS, true);
assert.equal(csFullFalse.isCS, true);
assert.equal(csNameFallback.isCS, true);

// migrateWarRecords: invalid legacy sides should normalize and close at start turn.
const malformedLegacyWar = {
  startTurn: 12,
  endTurn: null,
  sideA: null,
  sideB: null,
  sideACivs: [],
  sideBCivs: []
};
migrateWarRecords(makeSnapshot(220), [malformedLegacyWar]);
assert.deepEqual(malformedLegacyWar.sideA, []);
assert.deepEqual(malformedLegacyWar.sideB, []);
assert.equal(malformedLegacyWar.endTurn, 12);

// migrateWarRecords: active participants refresh transient fields, but historical civ stays pinned.
const historicalWar = {
  startTurn: 15,
  endTurn: null,
  startChartTurn: 300,
  sideA: [1],
  sideB: [2],
  sideACivs: [
    {
      pid: 1,
      civ: "Player 1",
      leader: "Old Leader",
      color: "#000000",
      civTypeString: undefined,
      active: true,
      joinTurn: 15
    }
  ],
  sideBCivs: [
    {
      pid: 2,
      civ: "Player 2",
      leader: "Old Leader",
      color: "#000000",
      civTypeString: undefined,
      active: true,
      joinTurn: 15
    }
  ]
};
migrateWarRecords(
  makeSnapshot(221),
  [historicalWar],
  [
    {
      chartTurn: 300,
      players: {
        1: { civName: "Pinned Alpha", civTypeString: "CIVILIZATION_ALPHA_PINNED" },
        2: { civName: "Pinned Beta", civTypeString: "CIVILIZATION_BETA_PINNED" }
      }
    }
  ]
);
assert.equal(historicalWar.sideACivs[0].civ, "Pinned Alpha");
assert.equal(historicalWar.sideACivs[0].civTypeString, "CIVILIZATION_ALPHA_PINNED");
assert.equal(historicalWar.sideACivs[0].leader, "Leader Alpha");
assert.equal(historicalWar.sideBCivs[0].civ, "Pinned Beta");
assert.equal(historicalWar.sideBCivs[0].civTypeString, "CIVILIZATION_BETA_PINNED");
assert.equal(historicalWar.sideBCivs[0].leader, "Leader Beta");

if (originalGame === undefined) delete globalThis.Game;
else globalThis.Game = originalGame;
if (originalPlayers === undefined) delete globalThis.Players;
else globalThis.Players = originalPlayers;
if (originalLocale === undefined) delete globalThis.Locale;
else globalThis.Locale = originalLocale;
DemographicsStorage.peek = originalStoragePeek;
DemographicsStorage.load = originalStorageLoad;
DemographicsStorage.save = originalStorageSave;

console.log("sampler-wars-core-branches harness passed");
