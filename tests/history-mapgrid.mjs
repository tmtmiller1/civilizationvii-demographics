// Territory-map capture against a stubbed world: terrain classes, the explored mask, settlements
// hidden where unexplored, and one cell per tile.
import assert from "node:assert/strict";

const W = 6, H = 4;
const world = (x, y) => ({
  water: y === 0, ocean: y === 0 && x < 3, mountain: x === 5 && y === 3,
  biome: ["BIOME_GRASSLAND", "BIOME_PLAINS", "BIOME_DESERT", "BIOME_TUNDRA", "BIOME_TROPICAL", "BIOME_MARINE"][x],
  owner: x < 2 && y > 0 ? 0 : x === 4 && y === 2 ? 7 : -1, revealed: x < 5
});
globalThis.RevealedStates = { HIDDEN: 0, REVEALED: 1, VISIBLE: 2 };
globalThis.GameContext = { localPlayerID: 0 };
globalThis.GameInfo = {
  Terrains: { lookup: (t) => ({ TerrainType: t }) },
  Biomes: { lookup: (b) => ({ BiomeType: b }) }
};
globalThis.GameplayMap = {
  getGridWidth: () => W, getGridHeight: () => H,
  isWater: (x, y) => world(x, y).water, isMountain: (x, y) => world(x, y).mountain,
  getTerrainType: (x, y) => (world(x, y).ocean ? "TERRAIN_OCEAN" : "TERRAIN_COAST"),
  getBiomeType: (x, y) => world(x, y).biome,
  getOwner: (x, y) => world(x, y).owner,
  getRevealedState: (p, x, y) => (world(x, y).revealed ? 1 : 0)
};
globalThis.Players = {
  getEverAlive: () => [{ id: 0, isMajor: true, isAlive: true }, { id: 1, isMajor: true, isAlive: true }],
  get: (pid) => ({ Cities: { getCities: () => (pid === 0 ? [{ location: { x: 1, y: 2 } }] : [{ location: { x: 5, y: 1 } }]) } })
};

const { captureMap, terrainAt, TERRAIN, UNEXPLORED, OTHER_OWNER } = await import("/demographics/ui/history/capture/history-mapgrid.js");
const { unrle } = await import("/demographics/ui/history/model/history-map.js");

assert.equal(terrainAt(0, 0), TERRAIN.OCEAN);
assert.equal(terrainAt(4, 0), TERRAIN.COAST, "shallow water");
assert.equal(terrainAt(5, 3), TERRAIN.MOUNTAIN);
assert.deepEqual([0, 1, 2, 3, 4].map((x) => terrainAt(x, 2)), [TERRAIN.GRASSLAND, TERRAIN.PLAINS, TERRAIN.DESERT, TERRAIN.TUNDRA, TERRAIN.TROPICAL]);
assert.equal(terrainAt(5, 2), TERRAIN.LAND, "an unlisted biome is plain land");

const doc = { map: undefined };
assert.equal(captureMap(doc, 0, 1, true), true);
assert.deepEqual([doc.map.w, doc.map.h], [W, H], "one cell per tile");
const owners = unrle(doc.map.frames[0].o, W * H);
const at = (x, y) => owners[y * W + x];
assert.equal(at(0, 1), 0, "held by the local player");
assert.equal(at(4, 2), OTHER_OWNER, "held by someone who is not a major civilization");
assert.equal(at(5, 1), UNEXPLORED, "not explored");
assert.equal(at(3, 2), -1, "explored, unowned");
assert.deepEqual(doc.map.frames[0].c, [[2 * W + 1, 0]], "the settlement in an unexplored cell is left out");

// Without an explored-state API the map is shown whole rather than hidden.
delete globalThis.RevealedStates;
const open = { map: undefined };
captureMap(open, 0, 1, true);
assert.ok(!unrle(open.map.frames[0].o, W * H).includes(UNEXPLORED));

console.log("history-mapgrid harness passed");
