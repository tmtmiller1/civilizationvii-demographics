import assert from "node:assert/strict";

import {
  closeEndedWars,
  collectActiveWars
} from "/demographics/ui/sampler/sampler-wars-detect.js";

const originalGame = globalThis.Game;

try {
  globalThis.Game = {};
  assert.equal(collectActiveWars([{ id: 1 }]), null);

  globalThis.Game = {
    Diplomacy: {
      getPlayerEvents: (pid) => {
        if (pid === 1) {
          return [
            { actionTypeName: "DIPLOMACY_ACTION_DECLARE_WAR", uniqueID: 4001 },
            { actionTypeName: "DIPLOMACY_ACTION_DECLARE_WAR", uniqueID: 4001 }
          ];
        }
        if (pid === 2) {
          throw new Error("stale player");
        }
        if (pid === 3) return "not-an-array";
        return [];
      },
      getDiplomaticEventData: (uid) => {
        if (uid === 4001) {
          return { initialPlayer: 1, targetPlayer: 2, startTurn: 7 };
        }
        return null;
      },
      getSupportingPlayersWithBonusEnvoys: () => [{ id: 3 }],
      getOpposingPlayersWithBonusEnvoys: () => [{ id: 4 }]
    }
  };

  const activeWars = collectActiveWars([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
  assert.equal(activeWars.size, 1);
  const war = activeWars.get(4001);
  assert.deepEqual(war.sideA, [1, 3]);
  assert.deepEqual(war.sideB, [2, 4]);
  assert.equal(war.headerStartTurn, 7);

  const wars = [
    {
      name: "Legacy war",
      warUniqueID: null,
      endTurn: null,
      endYear: null,
      lastChartTurn: null
    },
    {
      name: "Open war",
      warUniqueID: 77,
      endTurn: null,
      endYear: null,
      lastChartTurn: 55
    },
    {
      name: "Closed war",
      warUniqueID: 88,
      endTurn: 4,
      endYear: "YEAR_4",
      lastChartTurn: 44
    }
  ];
  closeEndedWars(wars, new Map(), "YEAR_7", 7);
  assert.equal(wars[0].endTurn, 7);
  assert.equal(wars[0].endYear, "YEAR_7");
  assert.equal(wars[1].endTurn, 7);
  assert.equal(wars[1].endYear, "YEAR_7");
  assert.equal(wars[1].endChartTurn, 55);
  assert.equal(wars[2].endTurn, 4);
  assert.equal(wars[2].endYear, "YEAR_4");

  console.log("sampler-wars-detect-branches harness passed");
} finally {
  if (originalGame === undefined) delete globalThis.Game;
  else globalThis.Game = originalGame;
}