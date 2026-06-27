import assert from "node:assert/strict";

import {
  getCityStateIds,
  getLocalId,
  getMetMajorIds,
  isMetMajor,
  readGameTurn,
  resolveMet,
  viewerHasMet
} from "/demographics/ui/screen-demographics/views/relations/relations-queries.js";

const saved = {
  Configuration: globalThis.Configuration,
  Game: globalThis.Game,
  GameContext: globalThis.GameContext,
  Players: globalThis.Players
};

function restore() {
  globalThis.Configuration = saved.Configuration;
  globalThis.Game = saved.Game;
  globalThis.GameContext = saved.GameContext;
  globalThis.Players = saved.Players;
}

function mockPlayers() {
  const major1 = {
    isMajor: true,
    Diplomacy: { hasMet: (id) => id === 2 }
  };
  const major2 = { isMajor: true, Diplomacy: { hasMet: () => true } };
  const minor3 = { isMajor: false, isMinor: true };

  globalThis.Players = {
    getAliveIds: () => [1, 2, 3],
    get: (id) => ({ 1: major1, 2: major2, 3: minor3 }[id] || null)
  };
}

function testLocalIdAndMetMajor() {
  mockPlayers();
  globalThis.GameContext = { localPlayerID: 1, localObserverID: 5 };
  assert.equal(getLocalId(), 1);

  globalThis.GameContext = { localObserverID: 5 };
  assert.equal(getLocalId(), 5);

  globalThis.GameContext = null;
  assert.equal(getLocalId(), undefined);

  const humanDiplo = { hasMet: (id) => id === 2 };
  assert.equal(isMetMajor(2, 1, humanDiplo), true);
  assert.equal(isMetMajor(3, 1, humanDiplo), false);

  assert.equal(isMetMajor(999, 1, humanDiplo), false);

  globalThis.Players = {
    getAliveIds: () => [1, 2],
    get: (id) => ({ isMajor: true, Diplomacy: null, id } )
  };
  assert.equal(isMetMajor(2, 1, null), true);
}

function testGetMetMajorIdsWithPolicyClamp() {
  mockPlayers();
  globalThis.GameContext = { localPlayerID: 1, localObserverID: 1 };

  globalThis.Configuration = {
    getGame: () => ({ getValue: (k) => (k === "DemographicsAnalyticsPolicy_v1" ? "own-civ-only" : null) })
  };
  assert.deepEqual(getMetMajorIds(1), [1], "own-civ policy should clamp relations ids");
    assert.deepEqual(getMetMajorIds(undefined), [], "own-civ policy without local id should return empty list");

  globalThis.Configuration = {
    getGame: () => ({ getValue: () => null })
  };
  const met = getMetMajorIds(1);
  assert.deepEqual(met, [1, 2], "met-major ids should include local + met major civs");

  globalThis.Players = undefined;
  assert.deepEqual(getMetMajorIds(1), []);

  globalThis.Players = { getAliveIds: () => "not-array", get: () => null };
  assert.deepEqual(getMetMajorIds(1), []);

  globalThis.Players = {
    getAliveIds: () => [1, 2],
    get: () => {
      throw new Error("lookup failed");
    }
  };
  assert.deepEqual(getMetMajorIds(1), []);

    // Trigger pushIfMetMajor's internal catch by throwing in humanDiplo.hasMet.
    globalThis.Players = {
      getAliveIds: () => [1, 2],
      get: (id) => {
        if (id === 1) {
          return {
            isMajor: true,
            Diplomacy: {
              hasMet: () => {
                throw new Error("hasMet failed");
              }
            }
          };
        }
        return { isMajor: true };
      }
    };
    assert.deepEqual(getMetMajorIds(1), [1]);

    // Alive function surfaces missing / invalid.
    globalThis.Players = { getAliveMajorIds: "nope", get: () => null };
    assert.deepEqual(getMetMajorIds(1), []);

    globalThis.Players = { getAliveMajorIds: () => [1], get: () => ({ isMajor: true }) };
    assert.deepEqual(getMetMajorIds(1), [1]);

    globalThis.Players = { getAliveIds: () => [1], get: "nope" };
    assert.deepEqual(getMetMajorIds(1), []);
}

function testCityStateAndMetResolution() {
  mockPlayers();
  const cs = getCityStateIds();
  assert.deepEqual(cs, [3], "minor city-state ids should be discovered");

  assert.equal(viewerHasMet(1, 2), true);
  assert.equal(viewerHasMet(1, 999), false);
  assert.equal(viewerHasMet("x", 2), undefined);
  assert.equal(viewerHasMet(2, 2), true);

  globalThis.Players = {
    getAliveIds: () => {
      throw new Error("primary failed");
    },
    getAlive: () => [{ id: 7 }, 8],
    get: (id) => ({ isMinor: id === 7 || id === 8 })
  };
  assert.deepEqual(getCityStateIds(), [7, 8]);

    globalThis.Players = {
      getAliveIds: () => [7, 8, 9],
      get: (id) => (id === 9 ? null : { isMinor: true })
    };
    assert.deepEqual(getCityStateIds(), [7, 8]);

    globalThis.Players = undefined;
    assert.deepEqual(getCityStateIds(), []);

    globalThis.Players = {
      getAliveIds: () => [],
      getAlive: () => {
        throw new Error("fallback failed");
      },
      get: () => null
    };
    assert.deepEqual(getCityStateIds(), []);

    globalThis.Players = {
      getAliveIds: () => [],
      getAlive: "missing",
      get: () => null
    };
    assert.deepEqual(getCityStateIds(), []);

  const history = {
    samples: [
      { players: { "2": { met: false } } },
      { players: { "2": { met: true } } }
    ]
  };
  // No live diplo path for non-local viewer -> use history fallback only when viewer is local.
  const resolved = resolveMet(1, 2, 1, history);
  assert.equal(typeof resolved, "boolean", "resolveMet should produce a boolean when data exists");

  globalThis.Players = {
    getAliveIds: () => [1],
    get: () => ({ Diplomacy: {} })
  };
  assert.equal(resolveMet(1, 2, 1, history), true);
  assert.equal(resolveMet(2, 2, 1, history), true);
    assert.equal(resolveMet(1, 2, 1, undefined), undefined);
}

function testReadGameTurn() {
  globalThis.Game = { turn: 42 };
  assert.equal(readGameTurn(), 42);
  delete globalThis.Game;
  assert.equal(readGameTurn(), undefined);
}

try {
  testLocalIdAndMetMajor();
  testGetMetMajorIdsWithPolicyClamp();
  testCityStateAndMetResolution();
  testReadGameTurn();
  console.log("relations-queries-branches harness passed");
} finally {
  restore();
}
