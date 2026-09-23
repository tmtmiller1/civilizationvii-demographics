import assert from "node:assert/strict";

import {
  valueOf,
  buildSettlementBoard,
  SETTLEMENT_OUTPUTS
} from "/demographics/ui/screen-demographics/settlements/settlements-data.js";

/**
 * Mock Players.getAlive() to return a set of civs with cities.
 */
function setupPlayers(civs) {
  globalThis.Players = {
    getAlive: () => civs,
    get: (pid) => civs.find((c) => c.id === pid) || null
  };
}

/**
 * Create a mock city for testing.
 */
function makeCity(owner, name, opts = {}) {
  const o = opts;
  return {
    owner,
    name,
    isTown: !!o.isTown,
    isCapital: !!o.isCapital,
    location: o.location || { x: 0, y: 0 },
    id: o.componentId || { owner, n: Math.random() },
    population: o.population ?? 10,
    Yields: {
      getNetYield: (yieldType) => o.yields?.[yieldType] ?? 0
    },
    Constructibles: {
      getNumWonders: () => o.wonders?.length ?? 0,
      getIdsOfClass: (cls) => (cls === "WONDER" ? o.wonders ?? [] : [])
    }
  };
}

/**
 * Create a mock player (civ).
 */
function makeCiv(id, opts = {}) {
  return {
    id,
    Cities: {
      getCities: () => opts.cities || []
    }
  };
}

function testValueOfComposite() {
  const settlement = { composite: 75, outputs: {} };
  assert.equal(valueOf(settlement, "composite"), 75, "composite read correctly");
}

function testValueOfYield() {
  const settlement = {
    composite: 50,
    outputs: { food: 12, production: 8, gold: 0 }
  };
  assert.equal(valueOf(settlement, "food"), 12, "food output read");
  assert.equal(valueOf(settlement, "production"), 8, "production output read");
  assert.equal(valueOf(settlement, "gold"), 0, "zero gold output read");
}

function testValueOfMissingKey() {
  const settlement = { composite: 50, outputs: { food: 12 } };
  assert.equal(valueOf(settlement, "science"), 0, "missing key defaults to 0");
  assert.equal(valueOf(settlement, "unknown"), 0, "unknown key defaults to 0");
}

function testBuildSettlementBoardEmpty() {
  // Mock an empty world
  setupPlayers([]);
  globalThis.UI = { Player: { getPrimaryColorValueAsString: () => "#ffffff" } };
  globalThis.GameInfo = { Leaders: { lookup: () => ({ Name: "Leader" }) },
    Civilizations: { lookup: () => ({ Name: "Civ" }) } };
  globalThis.scaleCityPopulationAt = () => 10;
  globalThis.getFounded = () => null;
  globalThis.getCityTrend = () => null;
  globalThis.applyPopulationVarianceAndEnsureUnique = (s) => s;

  const board = buildSettlementBoard();
  assert.ok(Array.isArray(board.settlements), "settlements is array");
  assert.equal(board.settlements.length, 0, "empty world yields empty settlements");
  assert.ok(typeof board.leaders === "object", "leaders is object");
}

function testBuildSettlementBoardSingleCity() {
  const city = makeCity(1, "Rome", { population: 15, yields: { YIELD_FOOD: 10,
    YIELD_PRODUCTION: 8 } });
  const civ = makeCiv(1, { cities: [city] });
  setupPlayers([civ]);

  globalThis.UI = { Player: { getPrimaryColorValueAsString: () => "#ff0000" } };
  globalThis.GameInfo = {
    Leaders: { lookup: () => ({ Name: "Augustus" }) },
    Civilizations: { lookup: () => ({ Name: "Rome" }) }
  };
  globalThis.scaleCityPopulationAt = () => 15;
  globalThis.getFounded = () => null;
  globalThis.getCityTrend = () => null;
  globalThis.applyPopulationVarianceAndEnsureUnique = (s) => s;

  const board = buildSettlementBoard();
  assert.equal(board.settlements.length, 1, "one city yields one settlement");
  assert.equal(board.settlements[0].name, "Rome", "city name preserved");
  assert.equal(board.settlements[0].population, 15, "population preserved");
}

function testBuildSettlementBoardMultipleCivs() {
  const rome = makeCity(1, "Rome", { population: 20, yields: { YIELD_FOOD: 12 } });
  const athens = makeCity(2, "Athens", { population: 18, yields: { YIELD_SCIENCE:
    10 } });
  const civ1 = makeCiv(1, { cities: [rome] });
  const civ2 = makeCiv(2, { cities: [athens] });
  setupPlayers([civ1, civ2]);

  globalThis.UI = { Player: { getPrimaryColorValueAsString: () => "#ffffff" } };
  globalThis.GameInfo = {
    Leaders: { lookup: () => ({ Name: "Leader" }) },
    Civilizations: { lookup: () => ({ Name: "Civ" }) }
  };
  globalThis.scaleCityPopulationAt = () => 10;
  globalThis.getFounded = () => null;
  globalThis.getCityTrend = () => null;
  globalThis.applyPopulationVarianceAndEnsureUnique = (s) => s;

  const board = buildSettlementBoard();
  assert.equal(board.settlements.length, 2, "two civs yield two settlements");
  assert.ok(
    board.settlements.map((s) => s.name).includes("Rome"),
    "Rome in settlements"
  );
  assert.ok(
    board.settlements.map((s) => s.name).includes("Athens"),
    "Athens in settlements"
  );
}

function testBuildSettlementBoardSortedByComposite() {
  const high = makeCity(1, "High", { population: 20, yields: { YIELD_FOOD: 15,
    YIELD_PRODUCTION: 15 } });
  const low = makeCity(2, "Low", { population: 5, yields: { YIELD_FOOD: 2 } });
  const mid = makeCity(3, "Mid", { population: 10, yields: { YIELD_FOOD: 8 } });
  const civ1 = makeCiv(1, { cities: [high] });
  const civ2 = makeCiv(2, { cities: [low] });
  const civ3 = makeCiv(3, { cities: [mid] });
  setupPlayers([civ1, civ2, civ3]);

  globalThis.UI = { Player: { getPrimaryColorValueAsString: () => "#ffffff" } };
  globalThis.GameInfo = {
    Leaders: { lookup: () => ({ Name: "Leader" }) },
    Civilizations: { lookup: () => ({ Name: "Civ" }) }
  };
  globalThis.scaleCityPopulationAt = () => 10;
  globalThis.getFounded = () => null;
  globalThis.getCityTrend = () => null;
  globalThis.applyPopulationVarianceAndEnsureUnique = (s) => s;

  const board = buildSettlementBoard();
  assert.equal(board.settlements.length, 3, "three cities");
  // Composite scores should be in descending order
  const composites = board.settlements.map((s) => s.composite);
  assert.ok(composites[0] >= composites[1], "first ≥ second composite");
  assert.ok(composites[1] >= composites[2], "second ≥ third composite");
}

function testBuildSettlementBoardLeadersPerOutput() {
  const foodLeader = makeCity(1, "Bread", { population: 10, yields: {
    YIELD_FOOD: 100 } });
  const scienceLeader = makeCity(2, "Labs", { population: 10, yields: {
    YIELD_SCIENCE: 80 } });
  const civ1 = makeCiv(1, { cities: [foodLeader] });
  const civ2 = makeCiv(2, { cities: [scienceLeader] });
  setupPlayers([civ1, civ2]);

  globalThis.UI = { Player: { getPrimaryColorValueAsString: () => "#ffffff" } };
  globalThis.GameInfo = {
    Leaders: { lookup: () => ({ Name: "Leader" }) },
    Civilizations: { lookup: () => ({ Name: "Civ" }) }
  };
  globalThis.scaleCityPopulationAt = () => 10;
  globalThis.getFounded = () => null;
  globalThis.getCityTrend = () => null;
  globalThis.applyPopulationVarianceAndEnsureUnique = (s) => s;

  const board = buildSettlementBoard();
  assert.ok(board.leaders.food, "food leader exists");
  assert.ok(board.leaders.science, "science leader exists");
  assert.ok(board.leaders.composite, "composite leader exists");
  // Food leader should be Bread, science leader should be Labs
  assert.ok(
    board.leaders.food.name === "Bread" || board.leaders.food.outputs.food > 50,
    "food leader has high food"
  );
}

function testConstructibleNameLookupThrowSkipped() {
  const city = makeCity(1, "Rome", { population: 10 });
  city.Constructibles.getIdsOfClass = (cls) => (cls === "BUILDING" ? [1, 2, 3] : []);
  setupPlayers([makeCiv(1, { cities: [city] })]);
  globalThis.UI = { Player: { getPrimaryColorValueAsString: () => "#ffffff" } };
  globalThis.GameInfo = {
    Leaders: { lookup: () => ({ Name: "Leader" }) },
    Civilizations: { lookup: () => ({ Name: "Civ" }) },
    Constructibles: {
      lookup: (type) => {
        if (type === "bad") throw new Error("lookup boom");
        return { Name: "LOC_B_" + type, ConstructibleType: "BUILDING_" + type };
      }
    }
  };
  // id 1: the handle lookup throws (stale component id); id 2: the table lookup throws.
  globalThis.Constructibles = {
    getByComponentID: (cid) => {
      if (cid === 1) throw new Error("stale id");
      return { type: cid === 2 ? "bad" : "ok" };
    }
  };
  const board = buildSettlementBoard();
  assert.equal(board.settlements.length, 1, "a throwing constructible lookup does not drop the settlement");
  assert.deepEqual(
    board.settlements[0].buildingTypes,
    ["LOC_B_ok"],
    "throwing handle/table lookups are skipped; the readable building is still named"
  );
  assert.equal(board.settlements[0].buildings, 1, "buildings counts the named ones");

  // The lite board (sampler archive) never runs the name scan; the count comes from the class ids.
  globalThis.Constructibles.getByComponentID = () => {
    throw new Error("the lite board must not resolve building handles");
  };
  const lite = buildSettlementBoard({ lite: true });
  assert.deepEqual(lite.settlements[0].buildingTypes, [], "lite board: no building names");
  assert.equal(lite.settlements[0].buildings, 3, "lite board: buildings counts the class ids");
  assert.equal(lite.settlements[0].wonderInProgress, null, "lite board: no wonder-in-progress read");
  assert.equal(lite.settlements[0].name, "Rome", "lite board: every archived field is still read");
  delete globalThis.Constructibles;
}

function testThrowingCityPropertiesFallBack() {
  const city = makeCity(1, "Rome", { population: 10 });
  Object.defineProperty(city, "name", { get() { throw new Error("name boom"); } });
  Object.defineProperty(city, "isTown", { get() { throw new Error("town boom"); } });
  setupPlayers([makeCiv(1, { cities: [city] })]);
  globalThis.UI = { Player: { getPrimaryColorValueAsString: () => "#ffffff" } };
  globalThis.GameInfo = {
    Leaders: { lookup: () => ({ Name: "Leader" }) },
    Civilizations: { lookup: () => ({ Name: "Civ" }) }
  };
  const board = buildSettlementBoard();
  assert.equal(board.settlements.length, 1, "a city whose name/isTown getters throw is still boarded");
  assert.equal(board.settlements[0].name, "LOC_CITY_NAME_UNSET", "a throwing name falls back to the unset tag");
  assert.equal(board.settlements[0].isTown, false, "a throwing isTown reads as a city");
}

function testSettlementOutputsStructure() {
  // Verify SETTLEMENT_OUTPUTS has expected structure
  assert.ok(Array.isArray(SETTLEMENT_OUTPUTS), "SETTLEMENT_OUTPUTS is array");
  assert.ok(SETTLEMENT_OUTPUTS.length > 0, "SETTLEMENT_OUTPUTS not empty");
  
  for (const output of SETTLEMENT_OUTPUTS) {
    assert.ok(typeof output.id === "string", "output has id");
    assert.ok(typeof output.label === "string", "output has label");
    assert.ok(typeof output.icon === "string", "output has icon");
    assert.ok(typeof output.composite === "boolean", "output has composite");
    assert.ok(typeof output.weight === "number", "output has weight");
  }

  // Check for expected outputs
  const ids = SETTLEMENT_OUTPUTS.map((o) => o.id);
  assert.ok(ids.includes("population"), "population output exists");
  assert.ok(ids.includes("food"), "food output exists");
  assert.ok(ids.includes("influence"), "influence output exists");
  assert.ok(!ids.includes("composite"), "composite is not an output itself");

  // Influence is shown as a ranked column but excluded from the composite Score
  // (empire-pooled yield, only sparsely emitted per settlement).
  const influence = SETTLEMENT_OUTPUTS.find((o) => o.id === "influence");
  assert.equal(influence.yt, "YIELD_DIPLOMACY", "influence maps to YIELD_DIPLOMACY");
  assert.equal(influence.composite, false, "influence is not in the composite");
}

testValueOfComposite();
testValueOfYield();
testValueOfMissingKey();
testBuildSettlementBoardEmpty();
testBuildSettlementBoardSingleCity();
testBuildSettlementBoardMultipleCivs();
testBuildSettlementBoardSortedByComposite();
testBuildSettlementBoardLeadersPerOutput();
testConstructibleNameLookupThrowSkipped();
testThrowingCityPropertiesFallBack();
testSettlementOutputsStructure();

console.log("settlements-data harness passed");
