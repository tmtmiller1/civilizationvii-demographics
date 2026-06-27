import assert from "node:assert/strict";

import {
  buildCsEdges,
  applyCivEdgeOverrides,
  applyCsEdgeOverrides,
  buildFilterDefs,
  computeCivRingData,
  computeCsRingData
} from "/demographics/ui/screen-demographics/views/relations/relations-ring-compute.js";
import { pillColorFor } from "/demographics/ui/screen-demographics/views/relations/relations-filters.js";

const saved = {
  Game: globalThis.Game,
  Players: globalThis.Players
};

globalThis.Game = { turn: 9 };

globalThis.Players = {
  getAliveIds: () => [1, 3],
  get: (id) => ({
    1: { isMajor: true },
    3: { isMajor: false, isMinor: true }
  }[id] || null)
};

function testFilterDefsAndOverrides() {
  const civDefs = buildFilterDefs("civ");
  assert.ok(civDefs.some((f) => f.key === "war" && typeof f.color === "string"));

  const edges = [
    { filterKey: "suzerain", color: "#000" },
    { filterKey: "trade", color: "#000" },
    { filterKey: "war", color: "#000" }
  ];
  applyCsEdgeOverrides(edges);
  assert.equal(edges[0].color, "#f0cf3c");
  assert.equal(edges[1].color, "#f0c33c");

  applyCivEdgeOverrides(edges);
  assert.equal(edges[2].color, pillColorFor("war", "civ"));

  const mixed = [null, {}, { filterKey: "trade", color: "#000" }];
  applyCivEdgeOverrides(mixed);
  assert.equal(mixed[2].color, pillColorFor("trade", "civ"));
  assert.deepEqual(mixed[1], {});

  const csMixed = [{}, { filterKey: "trade", color: "#000" }];
  applyCsEdgeOverrides(csMixed);
  assert.ok(typeof csMixed[0] === "object");
  assert.notEqual(csMixed[1].color, "#000", "known CS key should receive override color");
}

function testComputeCivRingDataCacheHitPath() {
  const names = {
    1: { leaderName: "Local" },
    2: { leaderName: "Foreign" }
  };
  const rs = {
    localId: 1,
    metIds: [1, 2],
    showUnmetNames: false,
    ctx: { history: { samples: [{ players: { "2": { met: false } } }] } },
    edgeCacheByTop: {
      civ: { key: "1|9|1|2|att:1", edges: [{ a: 1, b: 2, filterKey: "war" }] },
      cs: { key: "", edges: [] }
    }
  };
  const out = computeCivRingData(rs, new Set(["war"]), names);
  assert.equal(out.ringIds.length, 2);
  assert.equal(out.edges.length, 1);
  assert.notEqual(out.names[2].leaderName, "Foreign", "unmet civ should be masked when spoilers are hidden");
}

function testComputeCivRingDataUnmetMaskOnMissingNameEntry() {
  const rs = {
    localId: 1,
    metIds: [1, 2],
    showUnmetNames: false,
    ctx: { history: { samples: [{ players: { "2": { met: false } } }] } },
    edgeCacheByTop: {
      civ: { key: "1|9|1|2|att:0", edges: [] },
      cs: { key: "", edges: [] }
    }
  };
  const out = computeCivRingData(rs, new Set(["trade"]), {});
  assert.equal(out.names[2].leaderName, "LOC_DEMOGRAPHICS_UNMET_CIV");
  assert.equal(out.names[2].civName, undefined);
}

function testComputeCsRingDataCacheHitPath() {
  const names = { 1: { leaderName: "Viewer" } };
  const rs = {
    localId: 1,
    csViewerPid: 1,
    metIds: [1, 2],
    showUnmetNames: true,
    ctx: { history: { samples: [] } },
    buildCsNodeInfo: () => ({ leaderName: "CS", csMet: true }),
    edgeCacheByTop: {
      civ: { key: "", edges: [] },
      cs: { key: "1|9|1|2|1|att:0", edges: [{ a: 1, b: 3, filterKey: "trade" }] }
    }
  };

  const out = computeCsRingData(rs, new Set(["trade"]), names);
  assert.deepEqual(out.ringIds, [1, 3]);
  assert.equal(out.edges.length, 1);
  assert.equal(out.names[3].leaderName, "CS");
}

function testComputeCsRingDataViewerFallbackPath() {
  const names = { 1: { leaderName: "Viewer" } };
  const rs = {
    localId: 1,
    csViewerPid: "bad",
    metIds: [1],
    showUnmetNames: false,
    ctx: { history: { samples: [{ players: { "1": { met: true } } }] } },
    buildCsNodeInfo: () => ({ leaderName: "CS", csMet: true }),
    edgeCacheByTop: {
      civ: { key: "", edges: [] },
      cs: { key: "1|9|1|1|1|att:1", edges: [{ a: 1, b: 3, filterKey: "trade" }] }
    }
  };

  const out = computeCsRingData(rs, new Set(["war", "trade"]), names);
  assert.equal(out.ringViewerPid, 1, "non-numeric csViewerPid should fall back to local id");
  assert.deepEqual(out.ringIds, [1, 3]);
}

function testBuildCsEdgesFiltersToViewerAndMetCs() {
  const prev = {
    Game: globalThis.Game,
    Players: globalThis.Players,
    GameInfo: globalThis.GameInfo,
    DiplomacyActionTypes: globalThis.DiplomacyActionTypes,
    DiplomacyPlayerRelationships: globalThis.DiplomacyPlayerRelationships
  };

  globalThis.DiplomacyActionTypes = {
    DIPLOMACY_ACTION_GIVE_INFLUENCE_TOKEN: 21
  };
  globalThis.DiplomacyPlayerRelationships = {
    PLAYER_RELATIONSHIP_NEUTRAL: 4
  };

  globalThis.Game = {
    Diplomacy: {
      getPlayerEvents: () => [{ actionType: 21, targetPlayer: 1 }]
    }
  };
  globalThis.GameInfo = {
    CityStateBonuses: [],
    Independents: []
  };
  globalThis.Players = {
    get: (id) => {
      if (id === 1) {
        return {
          Trade: { countPlayerTradeRoutesTo: (to) => (to === 10 ? 2 : 0) },
          Diplomacy: {
            getRelationshipEnum: () => 4,
            isAtWarWith: () => false
          }
        };
      }
      if (id === 10) {
        return {
          Influence: { getSuzerain: () => 1 }
        };
      }
      if (id === 11) {
        return {
          Influence: { getSuzerain: () => 1 }
        };
      }
      return null;
    }
  };

  const out = buildCsEdges(1, [10, 11], true, new Set([10]));
  assert.ok(out.length > 0, "at least one met city-state edge should remain");
  assert.ok(out.every((e) => e.a === 1 || e.b === 1), "all edges should touch the viewer");
  assert.ok(out.every((e) => e.a !== 11 && e.b !== 11), "unmet city-state edges should be filtered");

  globalThis.Game = prev.Game;
  globalThis.Players = prev.Players;
  globalThis.GameInfo = prev.GameInfo;
  globalThis.DiplomacyActionTypes = prev.DiplomacyActionTypes;
  globalThis.DiplomacyPlayerRelationships = prev.DiplomacyPlayerRelationships;
}

function testBuildCsEdgesPathologicalViewerFiltering() {
  const prev = {
    Game: globalThis.Game,
    Players: globalThis.Players,
    GameInfo: globalThis.GameInfo,
    DiplomacyActionTypes: globalThis.DiplomacyActionTypes,
    DiplomacyPlayerRelationships: globalThis.DiplomacyPlayerRelationships
  };

  globalThis.DiplomacyActionTypes = {
    DIPLOMACY_ACTION_GIVE_INFLUENCE_TOKEN: 21
  };
  globalThis.DiplomacyPlayerRelationships = {
    PLAYER_RELATIONSHIP_NEUTRAL: 4
  };

  globalThis.GameInfo = {
    CityStateBonuses: [],
    Independents: []
  };
  globalThis.Game = {
    Diplomacy: {
      getPlayerEvents: () => [
        { actionType: 21, targetPlayer: Number.NaN }
      ]
    }
  };
  globalThis.Players = {
    get: (id) => {
      if (Number.isNaN(id)) {
        return {
          Trade: { countPlayerTradeRoutesTo: () => 0 },
          Diplomacy: { getRelationshipEnum: () => 4, isAtWarWith: () => false }
        };
      }
      if (id === 10) {
        return {
          Influence: { getSuzerain: () => Number.NaN }
        };
      }
      if (id === 11) {
        return {
          Influence: { getSuzerain: () => 10 }
        };
      }
      return null;
    }
  };

  const out = buildCsEdges(Number.NaN, [10, 11], false, new Set([11]));
  assert.deepEqual(out, [], "edges not touching viewer or touching unmet viewer-in-cs set should be filtered");

  globalThis.Game = prev.Game;
  globalThis.Players = prev.Players;
  globalThis.GameInfo = prev.GameInfo;
  globalThis.DiplomacyActionTypes = prev.DiplomacyActionTypes;
  globalThis.DiplomacyPlayerRelationships = prev.DiplomacyPlayerRelationships;
}

function testBuildCsEdgesFiltersWhenViewerAlsoInCsList() {
  const prev = {
    Game: globalThis.Game,
    Players: globalThis.Players,
    GameInfo: globalThis.GameInfo,
    DiplomacyActionTypes: globalThis.DiplomacyActionTypes,
    DiplomacyPlayerRelationships: globalThis.DiplomacyPlayerRelationships
  };

  globalThis.DiplomacyActionTypes = {};
  globalThis.DiplomacyPlayerRelationships = {};
  globalThis.Game = { Diplomacy: { getPlayerEvents: () => [] } };
  globalThis.GameInfo = { CityStateBonuses: [], Independents: [] };
  globalThis.Players = {
    get: (id) => {
      if (id === 10) {
        return {
          Trade: { countPlayerTradeRoutesTo: () => 0 },
          Diplomacy: { getRelationshipEnum: () => undefined, isAtWarWith: () => false }
        };
      }
      if (id === 11) {
        return {
          Influence: { getSuzerain: () => 10 }
        };
      }
      return null;
    }
  };

  const out = buildCsEdges(10, [10, 11], false, new Set([11]));
  assert.deepEqual(out, [], "edge should be filtered when source city-state id is not in met set");

  globalThis.Game = prev.Game;
  globalThis.Players = prev.Players;
  globalThis.GameInfo = prev.GameInfo;
  globalThis.DiplomacyActionTypes = prev.DiplomacyActionTypes;
  globalThis.DiplomacyPlayerRelationships = prev.DiplomacyPlayerRelationships;
}

try {
  testFilterDefsAndOverrides();
  testComputeCivRingDataCacheHitPath();
    testComputeCivRingDataUnmetMaskOnMissingNameEntry();
  testComputeCsRingDataCacheHitPath();
    testComputeCsRingDataViewerFallbackPath();
    testBuildCsEdgesFiltersToViewerAndMetCs();
    testBuildCsEdgesPathologicalViewerFiltering();
    testBuildCsEdgesFiltersWhenViewerAlsoInCsList();
  console.log("relations-ring-compute-branches harness passed");
} finally {
  globalThis.Game = saved.Game;
  globalThis.Players = saved.Players;
}
