import assert from "node:assert/strict";

import { ingestWarEvent } from "/demographics/ui/sampler/sampler-wars-ingest.js";

const originalGame = globalThis.Game;

try {
  globalThis.Game = {
    Diplomacy: {
      getDiplomaticEventData: (uid) => {
        if (uid === 5001) {
          return {
            initialPlayer: 1,
            targetPlayer: 2,
            startTurn: 9,
            turn: 8
          };
        }
        if (uid === 5002) {
          return {
            initialPlayer: "bad",
            targetPlayer: 2,
            turn: 11
          };
        }
        throw new Error("stale unique id");
      },
      getSupportingPlayersWithBonusEnvoys: (uid) => {
        if (uid === 5001) return [{ id: 3 }, { playerID: 4 }, { player: 5 }, { id: -1 }];
        if (uid === 5002) return [2, 7, { id: 8 }];
        return [];
      },
      getOpposingPlayersWithBonusEnvoys: (uid) => {
        if (uid === 5001) return [{ id: 2 }, { playerID: 6 }, { player: 7 }];
        if (uid === 5002) return [1, { id: 9 }];
        return [];
      }
    }
  };

  const activeWars = new Map();
  ingestWarEvent(null, activeWars);
  ingestWarEvent({ actionTypeName: "DIPLOMACY_ACTION_DECLARE_WAR" }, activeWars);
  ingestWarEvent({ actionTypeName: "DIPLOMACY_ACTION_NOT_WAR", uniqueID: 1 }, activeWars);
  assert.equal(activeWars.size, 0);

  ingestWarEvent({ actionTypeName: "DIPLOMACY_ACTION_DECLARE_WAR", uniqueID: 5001 }, activeWars);
  assert.equal(activeWars.size, 1);
  const war = activeWars.get(5001);
  assert.deepEqual(war.sideA, [1, 3, 4, 5]);
  assert.deepEqual(war.sideB, [2, 6, 7]);
  assert.equal(war.initialPid, 1);
  assert.equal(war.targetPid, 2);
  assert.equal(war.headerStartTurn, 9);

  ingestWarEvent({ actionTypeName: "DIPLOMACY_ACTION_DECLARE_WAR", uniqueID: 5001 }, activeWars);
  assert.equal(activeWars.size, 1);

  ingestWarEvent({ actionTypeName: "DIPLOMACY_ACTION_DECLARE_WAR", uniqueID: 5002 }, activeWars);
  const war2 = activeWars.get(5002);
  assert.deepEqual(war2.sideA, [2, 7, 8]);
  assert.deepEqual(war2.sideB, [1, 9]);
  assert.equal(war2.initialPid, null);
  assert.equal(war2.headerStartTurn, 11);

  globalThis.Game.Diplomacy.getDiplomaticEventData = () => {
    throw new Error("stale unique id");
  };
  ingestWarEvent({ actionTypeName: "DIPLOMACY_ACTION_DECLARE_WAR", uniqueID: 5003 }, activeWars);
  assert.equal(activeWars.has(5003), false);

  console.log("sampler-wars-ingest-branches harness passed");
} finally {
  if (originalGame === undefined) delete globalThis.Game;
  else globalThis.Game = originalGame;
}