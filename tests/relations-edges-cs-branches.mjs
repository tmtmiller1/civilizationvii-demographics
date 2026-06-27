import assert from "node:assert/strict";

const saved = {
  Players: globalThis.Players,
  Game: globalThis.Game,
  GameInfo: globalThis.GameInfo,
  Locale: globalThis.Locale,
  DiplomacyActionTypes: globalThis.DiplomacyActionTypes,
  DiplomacyPlayerRelationships: globalThis.DiplomacyPlayerRelationships,
  localStorage: globalThis.localStorage
};

globalThis.Locale = { compose: (k) => "T:" + String(k) };
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
};

globalThis.DiplomacyPlayerRelationships = {
  PLAYER_RELATIONSHIP_ALLIANCE: 1,
  PLAYER_RELATIONSHIP_FRIENDLY: 2,
  PLAYER_RELATIONSHIP_HELPFUL: 3,
  PLAYER_RELATIONSHIP_NEUTRAL: 4,
  PLAYER_RELATIONSHIP_UNFRIENDLY: 5,
  PLAYER_RELATIONSHIP_HOSTILE: 6,
  PLAYER_RELATIONSHIP_AT_WAR: 7
};

globalThis.DiplomacyActionTypes = {
  DIPLOMACY_ACTION_GIVE_INFLUENCE_TOKEN: 21,
  DIPLOMACY_ACTION_CS_PROMOTE_GROWTH: 22,
  DIPLOMACY_ACTION_CS_BOLSTER_MILITARY: 23
};

const suzerains = new Map([
  [100, 1],
  [101, 2],
  [102, -1]
]);

const relationships = new Map([
  ["1|100", globalThis.DiplomacyPlayerRelationships.PLAYER_RELATIONSHIP_FRIENDLY],
  ["2|100", undefined],
  ["1|101", undefined],
  ["2|101", undefined]
]);

const wars = new Set(["1|100"]);

const tradeRoutes = new Map([
  ["1|100", 2],
  ["2|100", 0],
  ["1|101", "throw"],
  ["2|101", 1]
]);

const csEvents = new Map([
  [
    100,
    [
      { actionType: 21, targetPlayer: 1 },
      { actionType: 21, targetPlayer: 1 },
      { actionType: 22, targetPlayer: 2 }
    ]
  ],
  [101, [{ actionType: 23, targetPlayer: 2 }]],
  [102, []]
]);

function k(a, b) {
  return String(a) + "|" + String(b);
}

function makePlayer(pid) {
  return {
    civilizationAdjective: pid === 101 ? "Alpha" : pid === 102 ? "Beta" : "Major",
    Influence: {
      getSuzerain: () => suzerains.get(pid) ?? -1
    },
    Diplomacy: {
      isAtWarWith: (other) => wars.has(k(pid, other)) || wars.has(k(other, pid)),
      getRelationshipEnum: (other) => relationships.get(k(pid, other))
    },
    Trade: {
      countPlayerTradeRoutesTo: (other) => {
        const v = tradeRoutes.get(k(pid, other));
        if (v === "throw") throw new Error("trade failed");
        return Number(v || 0);
      }
    }
  };
}

globalThis.Players = {
  get: (pid) => makePlayer(Number(pid))
};

globalThis.Game = {
  CityStates: {
    getBonusType: (pid) => (Number(pid) === 100 ? 10 : -1)
  },
  Diplomacy: {
    getPlayerEvents: (pid) => csEvents.get(Number(pid)) || []
  }
};

globalThis.GameInfo = {
  CityStateBonuses: [{ $hash: 10, CityStateType: "SCIENTIFIC" }],
  Independents: [
    { CityStateName: "Alpha", CityStateType: "CULTURAL" },
    { CityStateName: "Gamma", CityStateType: "MILITARISTIC" }
  ]
};

const {
  resolveCsType,
  csTypeMeta,
  buildCsSuzerainEdges,
  buildCsTradeEdges,
  buildCsAgreementEdges,
  buildCsAttitudeEdges
} = await import("/demographics/ui/screen-demographics/views/relations/relations-edges-cs.js");

function testTypeResolutionAndMeta() {
  assert.equal(resolveCsType(100), "SCIENTIFIC");
  assert.equal(resolveCsType(101), "CULTURAL");
  assert.equal(resolveCsType(999), null);

  const scientific = csTypeMeta("scientific");
  assert.equal(scientific.icon, "blp:bonus_scientific");
  assert.equal(scientific.label, "T:LOC_DEMOGRAPHICS_CSTYPE_SCIENTIFIC");
  assert.equal(csTypeMeta("unknown"), null);
  assert.equal(csTypeMeta(123), null);
}

function testSuzerainEdges() {
  const edges = buildCsSuzerainEdges([1], [100, 101, 102], 2);
  assert.equal(edges.length, 2);
  assert.ok(edges.some((e) => e.a === 1 && e.b === 100));
  assert.ok(edges.some((e) => e.a === 2 && e.b === 101));
}

function testTradeEdges() {
  const edges = buildCsTradeEdges([1], [100, 101], 2);
  assert.ok(edges.some((e) => e.a === 1 && e.b === 100));
  assert.ok(edges.some((e) => e.a === 2 && e.b === 101));
  assert.ok(edges.every((e) => e.filterKey === "trade"));
}

function testAgreementEdges() {
  const edges = buildCsAgreementEdges([1], [100, 101], 2);
  assert.ok(edges.some((e) => e.filterKey === "befriend" && e.a === 1 && e.b === 100));
  assert.ok(edges.some((e) => e.filterKey === "cs_promote_growth" && e.a === 2 && e.b === 100));
  assert.ok(edges.some((e) => e.filterKey === "cs_bolster_military" && e.a === 2 && e.b === 101));
  const duplicateBefriend = edges.filter((e) => e.filterKey === "befriend" && e.a === 1 && e.b === 100);
  assert.equal(duplicateBefriend.length, 1);
}

function testAttitudeEdges() {
  const edges = buildCsAttitudeEdges([1], [100, 101, 102], 2);
  assert.ok(edges.some((e) => e.a === 1 && e.b === 100 && e.filterKey === "war"));
  assert.ok(edges.some((e) => e.a === 2 && e.b === 100 && e.filterKey === "neutral"));
  assert.ok(edges.some((e) => e.a === 2 && e.b === 101 && e.filterKey === "helpful"));
}

function testMissingPlayersGuard() {
  const prevPlayers = globalThis.Players;
  globalThis.Players = undefined;
  assert.deepEqual(buildCsSuzerainEdges([1], [100], 2), []);
  assert.deepEqual(buildCsTradeEdges([1], [100], 2), []);
  assert.deepEqual(buildCsAgreementEdges([1], [100], 2), []);
  assert.deepEqual(buildCsAttitudeEdges([1], [100], 2), []);
  globalThis.Players = prevPlayers;
}

function testResolverFallbackAndGuardBranches() {
  const prev = {
    Players: globalThis.Players,
    Game: globalThis.Game,
    GameInfo: globalThis.GameInfo,
    DiplomacyActionTypes: globalThis.DiplomacyActionTypes,
    DiplomacyPlayerRelationships: globalThis.DiplomacyPlayerRelationships
  };

  globalThis.Players = undefined;
  globalThis.GameInfo = { CityStateBonuses: [] };
  globalThis.Game = undefined;
  assert.equal(resolveCsType(1), null, "missing Game should short-circuit bonus lookup");

  globalThis.Game = { CityStates: {} };
  assert.equal(resolveCsType(1), null, "missing getBonusType should short-circuit bonus lookup");

  globalThis.Game = { CityStates: { getBonusType: () => 10 } };
  globalThis.GameInfo = undefined;
  assert.equal(resolveCsType(1), null, "missing GameInfo should short-circuit bonus lookup");

  globalThis.GameInfo = {
    CityStateBonuses: {
      [Symbol.iterator]: function* () {
        yield { $hash: 77, CityStateType: "ECONOMIC" };
      }
    }
  };
  globalThis.Game = { CityStates: { getBonusType: () => 77 } };
  assert.equal(resolveCsType(1), "ECONOMIC", "iterable bonuses should resolve type");

  globalThis.GameInfo = {
    CityStateBonuses: {
      find: () => {
        throw new Error("find failed");
      }
    }
  };
  assert.equal(resolveCsType(1), null, "find throws should safely fall back to null");

  globalThis.GameInfo = {
    CityStateBonuses: [{ $hash: 88 }],
    Independents: {
      [Symbol.iterator]: function* () {
        yield { CityStateName: "IterAdj", CityStateType: "MILITARISTIC" };
      }
    }
  };
  globalThis.Players = {
    get: () => ({ civilizationAdjective: "IterAdj" })
  };
  globalThis.Game = { CityStates: { getBonusType: () => 88 } };
  assert.equal(resolveCsType(1), "MILITARISTIC", "missing bonus row type should fall back to independents");

  globalThis.GameInfo = {
    CityStateBonuses: [{ $hash: 99 }],
    Independents: {
      forEach: () => {
        throw new Error("independents failed");
      }
    }
  };
  assert.equal(resolveCsType(1), null, "independent lookup throw should safely return null");

  globalThis.GameInfo = {
    CityStateBonuses: [{ $hash: 100 }],
    Independents: []
  };
  globalThis.Players = {
    get: () => ({ civilizationAdjective: "" })
  };
  globalThis.Game = { CityStates: { getBonusType: () => 100 } };
  assert.equal(resolveCsType(1), null, "empty adjective should not resolve independent type");

  globalThis.Players = prev.Players;
  globalThis.Game = prev.Game;
  globalThis.GameInfo = prev.GameInfo;
  globalThis.DiplomacyActionTypes = prev.DiplomacyActionTypes;
  globalThis.DiplomacyPlayerRelationships = prev.DiplomacyPlayerRelationships;
}

function testEdgeBuilderDefensivePaths() {
  const prev = {
    Players: globalThis.Players,
    Game: globalThis.Game,
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

  globalThis.Players = {
    get: (pid) => {
      if (pid === 1) return { Trade: {} };
      if (pid === 2) return null;
      if (pid === 300) {
        return {
          Influence: {
            getSuzerain: () => {
              throw new Error("boom");
            }
          },
          Diplomacy: {
            getRelationshipEnum: () => undefined
          }
        };
      }
      if (pid === 301) {
        return {
          Influence: {
            getSuzerain: () => "bad"
          }
        };
      }
      if (pid === 302) {
        return {};
      }
      return null;
    }
  };

  globalThis.Game = {
    Diplomacy: {
      getPlayerEvents: (pid) => {
        if (pid === 300) {
          return [
            { actionType: "bad", targetPlayer: 1 },
            { actionType: 999, targetPlayer: 1 },
            { actionType: 21, targetPlayer: "no", otherPlayer: 1 },
            { actionType: 21, targetPlayer: "no", otherPlayer: "no", initialPlayer: 1 },
            { actionType: 21, targetPlayer: "no", otherPlayer: "no", initialPlayer: 300 }
          ];
        }
        if (pid === 301) return null;
        if (pid === 302) throw new Error("events failed");
        return [];
      }
    }
  };

  globalThis.GameInfo = {
    CityStateBonuses: [],
    Independents: []
  };

  const tradeEdges = buildCsTradeEdges([1], [300], 2);
  assert.deepEqual(tradeEdges, [], "trade handle without counter method should be ignored");

  const agreementEdges = buildCsAgreementEdges([1], [300, 301, 302], 2);
  assert.equal(
    agreementEdges.filter((e) => e.a === 1 && e.b === 300 && e.filterKey === "befriend").length,
    1,
    "valid eventOther fallbacks should be deduped by major/city-state/action"
  );

  const attitudeEdges = buildCsAttitudeEdges([1, 2], [300, 301, 302], 2);
  assert.equal(attitudeEdges.length, 0, "invalid/missing attitude data should safely emit no edges");

  globalThis.Players = prev.Players;
  globalThis.Game = prev.Game;
  globalThis.GameInfo = prev.GameInfo;
  globalThis.DiplomacyActionTypes = prev.DiplomacyActionTypes;
  globalThis.DiplomacyPlayerRelationships = prev.DiplomacyPlayerRelationships;
}

try {
  testTypeResolutionAndMeta();
  testSuzerainEdges();
  testTradeEdges();
  testAgreementEdges();
  testAttitudeEdges();
  testMissingPlayersGuard();
    testResolverFallbackAndGuardBranches();
    testEdgeBuilderDefensivePaths();
  console.log("relations-edges-cs-branches harness passed");
} finally {
  globalThis.Players = saved.Players;
  globalThis.Game = saved.Game;
  globalThis.GameInfo = saved.GameInfo;
  globalThis.Locale = saved.Locale;
  globalThis.DiplomacyActionTypes = saved.DiplomacyActionTypes;
  globalThis.DiplomacyPlayerRelationships = saved.DiplomacyPlayerRelationships;
  globalThis.localStorage = saved.localStorage;
}
