// Covers: settlements-trace.js - founding stamps + population trend windows stored on the
// saved history blob (history.settleTrace), exact foundings held until the next sample,
// and the per-seed read cache.
import assert from "node:assert/strict";

let seed = "seed1";
globalThis.Configuration = { getGame: () => ({ startSeed: seed, getValue: () => null }) };
globalThis.Game = { turn: 10, getTurnDate: () => "1000 BCE" };
const handlers = {};
globalThis.engine = {
  on: (ev, fn) => { handlers[ev] = fn; },
  off: (ev) => { delete handlers[ev]; }
};
const cities = {
  a: { location: { x: 1, y: 2 }, population: 5 },
  b: { location: { x: 3, y: 4 }, population: 8 }
};
let alive = ["a"];
globalThis.Cities = { get: (id) => cities[id] || null };
globalThis.Players = { getAlive: () => [{ Cities: { getCityIds: () => alive } }] };

const T = await import("/demographics/ui/screen-demographics/settlements/settlements-trace.js");

// Nothing to record without a history object, or with no settlements.
assert.equal(T.recordSettlementTrace(null, 1, "x"), false);
alive = [];
assert.equal(T.recordSettlementTrace({ samples: [] }, 1, "x"), false);
alive = ["a"];

// First sighting of an existing settlement → APPROXIMATE founding + first pop sample, on the history.
const history = { samples: [] };
assert.equal(T.recordSettlementTrace(history, 100, "1200 BCE"), true);
assert.deepEqual(history.settleTrace.founded["1,2"], { turn: 100, year: "1200 BCE", exact: false });
assert.deepEqual(history.settleTrace.pop["1,2"], [{ t: 100, pop: 5 }]);
assert.equal(T.getFounded("1,2").exact, false, "readers see the freshly recorded trace");
assert.equal(T.getCityTrend("1,2"), null, "one sample is not a trend");

// A city founded between samples: EXACT stamp held in memory, readable at once, folded at the next sample.
T.startFoundingTracker();
handlers.CityAddedToMap({ cityID: "b" });
assert.deepEqual(T.getFounded("3,4"), { turn: 10, year: "1000 BCE", exact: true });
assert.equal(history.settleTrace.founded["3,4"], undefined, "not written until the next sample");
handlers.CityAddedToMap({ cityID: "a" }); // already founded → ignored
handlers.CityAddedToMap({}); // unreadable payload → ignored
alive = ["a", "b"];
cities.a.population = 7;
assert.equal(T.recordSettlementTrace(history, 101, "1180 BCE"), true);
assert.deepEqual(history.settleTrace.founded["3,4"], { turn: 10, year: "1000 BCE", exact: true },
  "the exact stamp wins over this sample's approximate one");
assert.equal(history.settleTrace.founded["1,2"].turn, 100, "an existing founding never moves");
const trend = T.getCityTrend("1,2");
assert.equal(trend.dir, 1);
assert.equal(trend.samples, 2);
assert.equal(trend.popGrowthPerTurn, 2);
T.stopFoundingTracker();

// Same-turn resample overwrites instead of appending; the window is capped at 12.
T.recordSettlementTrace(history, 101, "1180 BCE");
assert.equal(history.settleTrace.pop["1,2"].length, 2);
for (let t = 102; t < 130; t++) T.recordSettlementTrace(history, t, "");
assert.equal(history.settleTrace.pop["1,2"].length, 12);

// A trace already on a loaded history is extended, not replaced.
const loaded = { samples: [], settleTrace: { founded: { "9,9": { turn: 1, year: "", exact: true } }, pop: {} } };
T.recordSettlementTrace(loaded, 200, "");
assert.ok(loaded.settleTrace.founded["9,9"] && loaded.settleTrace.founded["1,2"]);

// Another game (seed change) never reads this game's trace.
seed = "seed2";
assert.equal(T.getFounded("1,2"), null);
assert.equal(T.getCityTrend("1,2"), null);
assert.equal(T.getFounded(null), null);
assert.equal(T.getCityTrend(""), null);

for (const k of ["Configuration", "Game", "engine", "Cities", "Players"]) delete globalThis[k];
console.log("settlements-trace harness passed");
