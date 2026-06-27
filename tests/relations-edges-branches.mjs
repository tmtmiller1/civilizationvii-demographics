import assert from "node:assert/strict";

const saved = {
  Players: globalThis.Players,
  Game: globalThis.Game,
  DiplomacyActionTypes: globalThis.DiplomacyActionTypes,
  DiplomacyPlayerRelationships: globalThis.DiplomacyPlayerRelationships,
  Locale: globalThis.Locale,
  GameInfo: globalThis.GameInfo,
  localStorage: globalThis.localStorage
};

globalThis.Locale = { compose: (k) => String(k) };
globalThis.GameInfo = globalThis.GameInfo || {};
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
  DIPLOMACY_ACTION_DENOUNCE: 10,
  DIPLOMACY_ACTION_OPEN_BORDERS: 11,
  DIPLOMACY_ACTION_SEND_DELEGATION: 12
};

const alliances = new Set(["1|2"]);
const wars = new Set(["1|3"]);
const relationships = new Map([
  ["1|2", globalThis.DiplomacyPlayerRelationships.PLAYER_RELATIONSHIP_FRIENDLY],
  ["1|3", globalThis.DiplomacyPlayerRelationships.PLAYER_RELATIONSHIP_NEUTRAL],
  ["2|3", globalThis.DiplomacyPlayerRelationships.PLAYER_RELATIONSHIP_UNFRIENDLY],
  ["4|1", globalThis.DiplomacyPlayerRelationships.PLAYER_RELATIONSHIP_HELPFUL]
]);
const routes = new Map([
  ["1|2", 2],
  ["2|1", 1],
  ["4|1", 3],
  ["4|2", 0],
  ["3|1", "throw"]
]);

const eventsByPid = new Map([
  [
    1,
    [
      { actionType: 10, targetPlayer: 2, initialPlayer: 1 },
      { actionType: 11, targetPlayer: 2, initialPlayer: 1 },
      { actionType: 12, targetPlayer: 3, initialPlayer: 1 }
    ]
  ],
  [2, [{ actionType: 10, targetPlayer: 1, initialPlayer: 1 }]],
  [3, []],
  [4, []]
]);

function key(a, b) {
  return String(a) + "|" + String(b);
}

function makePlayer(pid) {
  return {
    Diplomacy: {
      hasAllied: (other) => alliances.has(key(pid, other)) || alliances.has(key(other, pid)),
      isAtWarWith: (other) => wars.has(key(pid, other)) || wars.has(key(other, pid)),
      getRelationshipEnum: (other) => relationships.get(key(pid, other))
    },
    Trade: {
      countPlayerTradeRoutesTo: (other) => {
        const v = routes.get(key(pid, other));
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
  Diplomacy: {
    getPlayerEvents: (pid) => eventsByPid.get(Number(pid)) || []
  }
};

const {
  buildPoliticalEdges,
  buildEconomicEdges,
  buildAttitudeEdges,
  buildCivTaggedEdges
} = await import("/demographics/ui/screen-demographics/views/relations/relations-edges.js");

function testPoliticalEdges() {
  const met = [1, 2, 3];

  const allianceEdges = buildPoliticalEdges(met, "alliance");
  assert.equal(allianceEdges.length, 1);
  assert.equal(allianceEdges[0].filterKey, "alliance");

  const warEdges = buildPoliticalEdges(met, "war");
  assert.equal(warEdges.length, 1);
  assert.equal(warEdges[0].filterKey, "war");

  const denounced = buildPoliticalEdges(met, "denounced");
  assert.equal(denounced.length, 1);
  assert.equal(denounced[0].directed, true);
  assert.equal(denounced[0].a, 1);
  assert.equal(denounced[0].b, 2);

  const openBorders = buildPoliticalEdges(met, "openborders");
  assert.equal(openBorders.length, 1);
  assert.equal(openBorders[0].filterKey, "openborders");

  assert.deepEqual(buildPoliticalEdges(met, "unknown"), []);
}

function testEconomicEdges() {
  const edges = buildEconomicEdges([1, 2, 3], "trade", 4);
  assert.ok(edges.some((e) => e.a === 1 && e.b === 2));
  assert.ok(edges.some((e) => e.a === 4 && e.b === 1));
  assert.ok(edges.every((e) => e.directed === true));
  assert.ok(edges.every((e) => typeof e.opacity === "number"));
}

function testAttitudeEdges() {
  const edges = buildAttitudeEdges([1, 2, 3], 1);
  assert.equal(edges.length, 3);
  assert.ok(edges.some((e) => e.filterKey === "alliance"));
  assert.ok(edges.some((e) => e.filterKey === "war"));
}

function testTaggedEdges() {
  const withAttitude = buildCivTaggedEdges([1, 2, 3], 4, true);
  assert.ok(withAttitude.some((e) => e.filterKey === "denounced"));
  assert.ok(withAttitude.some((e) => e.filterKey === "openborders"));
  assert.ok(withAttitude.some((e) => e.filterKey === "delegation"));
  assert.ok(withAttitude.some((e) => e.filterKey === "trade"));
  assert.ok(withAttitude.some((e) => e.filterKey === "alliance" || e.filterKey === "war"));

  const noAttitude = buildCivTaggedEdges([1, 2, 3], 4, false);
  assert.ok(noAttitude.some((e) => e.filterKey === "denounced"));
  assert.ok(noAttitude.every((e) => e.filterKey !== "friendly" && e.filterKey !== "war" && e.filterKey !== "alliance"));
}

function testMissingPlayersGuard() {
  const prevPlayers = globalThis.Players;
  globalThis.Players = undefined;
  assert.deepEqual(buildPoliticalEdges([1, 2], "war"), []);
  assert.deepEqual(buildEconomicEdges([1, 2], "trade", 1), []);
  assert.deepEqual(buildAttitudeEdges([1, 2], 1), []);
  assert.deepEqual(buildCivTaggedEdges([1, 2], 1, true), []);
  globalThis.Players = prevPlayers;
}

function testDefensiveAndFallbackBranches() {
  const prev = {
    Players: globalThis.Players,
    Game: globalThis.Game,
    DiplomacyActionTypes: globalThis.DiplomacyActionTypes,
    DiplomacyPlayerRelationships: globalThis.DiplomacyPlayerRelationships
  };

  globalThis.DiplomacyActionTypes = {
    DIPLOMACY_ACTION_DENOUNCE: 10,
    DIPLOMACY_ACTION_OPEN_BORDERS: 11
  };

  const defensiveEvents = new Map([
    [1, [{ actionType: 10, targetPlayer: "x", otherPlayer: "x", initialPlayer: 2 }]],
    [2, [{ actionType: 10, targetPlayer: "x", otherPlayer: "x", initialPlayer: 2 }]],
    [3, null],
    [4, [{ actionType: 10, targetPlayer: 4, initialPlayer: 4 }]]
  ]);

  globalThis.Game = {
    Diplomacy: {
      getPlayerEvents: (pid) => {
        if (pid === 5) throw new Error("events fail");
        return defensiveEvents.get(pid) || [];
      }
    }
  };

  globalThis.Players = {
    get: (pid) => {
      if (pid === 3) return null;
      if (pid === 6) {
        return {
          Diplomacy: {
            isAtWarWith: () => {
              throw new Error("pair failure");
            },
            hasAllied: () => false,
            getRelationshipEnum: () => undefined
          },
          Trade: {}
        };
      }
      if (pid === 7) {
        return {
          Diplomacy: {},
          Trade: {}
        };
      }
      return {
        Diplomacy: {
          hasAllied: (other) => Number(other) === 2,
          isAtWarWith: (other) => Number(other) === 2,
          getRelationshipEnum: () => undefined
        },
        Trade: {}
      };
    }
  };

  const alliance = buildPoliticalEdges([1, 2, 3], "alliance");
  assert.ok(alliance.every((e) => e.filterKey === "alliance"));

  const war = buildPoliticalEdges([1, 2, 3], "war");
  assert.ok(war.every((e) => e.filterKey === "war"));

  const denounced = buildPoliticalEdges([1, 2, 3, 4], "denounced");
  assert.equal(denounced.length, 1, "duplicate event pairs should be deduped");
  assert.equal(denounced[0].a, 2, "directed denounce edge should orient by initiator");
  assert.equal(denounced[0].b, 1);

  globalThis.Game = undefined;
  assert.deepEqual(buildPoliticalEdges([1], "openborders"), [], "missing Game should return empty events safely");

  globalThis.Game = {
    Diplomacy: {
      getPlayerEvents: (pid) => {
        if (pid === 5) throw new Error("events fail");
        return defensiveEvents.get(pid) || [];
      }
    }
  };
  assert.deepEqual(buildPoliticalEdges([5], "openborders"), [], "thrown events query should safely fall back to []");

  const econ = buildEconomicEdges([6, 7], "trade");
  assert.deepEqual(econ, [], "players without usable trade handles should emit no economic edges");

  const attitude = buildAttitudeEdges([3], 6);
  assert.equal(attitude.length, 0, "missing player handles should be skipped in attitude build");

  const tagged = buildCivTaggedEdges([6, 7], undefined, true);
  assert.ok(Array.isArray(tagged), "tagged edge build should survive pair-level exceptions");

  globalThis.Players = prev.Players;
  globalThis.Game = prev.Game;
  globalThis.DiplomacyActionTypes = prev.DiplomacyActionTypes;
  globalThis.DiplomacyPlayerRelationships = prev.DiplomacyPlayerRelationships;
}

try {
  testPoliticalEdges();
  testEconomicEdges();
  testAttitudeEdges();
  testTaggedEdges();
  testMissingPlayersGuard();
    testDefensiveAndFallbackBranches();
  console.log("relations-edges-branches harness passed");
} finally {
  globalThis.Players = saved.Players;
  globalThis.Game = saved.Game;
  globalThis.DiplomacyActionTypes = saved.DiplomacyActionTypes;
  globalThis.DiplomacyPlayerRelationships = saved.DiplomacyPlayerRelationships;
  globalThis.Locale = saved.Locale;
  globalThis.GameInfo = saved.GameInfo;
  globalThis.localStorage = saved.localStorage;
}
