// history-mapgrid.js
//
// Captures the territory map (model/history-map.js): the terrain once, then every few turns a frame
// of who owns each cell, which cells the local player has explored, and where the major
// civilizations' settlements stand. One cell per tile, as the game's own minimap draws it (very large
// maps are sampled down to MAX_CELLS_W cells across). Map rows count from the south edge, as the
// game's do; the painter flips them.

import { safe } from "/demographics/ui/history/core/history-log.js";
import { everMajors } from "/demographics/ui/history/capture/history-world.js";
import { rle, addFrame } from "/demographics/ui/history/model/history-map.js";

/** World tiles per grid cell, and the bounds on cells across (its height follows the map's shape). */
export const TILES_PER_CELL = 1;
export const MIN_CELLS_W = 30;
export const MAX_CELLS_W = 110;
/** Owner value for land held by anyone but a major civilization (independent peoples). */
export const OTHER_OWNER = -2;
/** Owner value for a cell the local player has not explored (drawn blank, as on the game's minimap). */
export const UNEXPLORED = -3;

/**
 * Terrain classes. 0-2 are the classes older records used (water, land, mountain), so they still
 * draw; the rest add the detail of the game's minimap.
 */
export const TERRAIN = {
  OCEAN: 0, LAND: 1, MOUNTAIN: 2, COAST: 3, GRASSLAND: 4, PLAINS: 5, DESERT: 6, TUNDRA: 7, TROPICAL: 8
};
const BIOME_CLASS = /** @type {Record<string, number>} */ ({
  BIOME_GRASSLAND: TERRAIN.GRASSLAND,
  BIOME_PLAINS: TERRAIN.PLAINS,
  BIOME_DESERT: TERRAIN.DESERT,
  BIOME_TUNDRA: TERRAIN.TUNDRA,
  BIOME_TROPICAL: TERRAIN.TROPICAL
});
/** Turns between frames (an age's first reading and forced readings are always taken). */
export const MAP_EVERY = 3;

/**
 * Cells across the grid for a world this many tiles wide.
 * @param {number} w World width in tiles.
 * @returns {number} Cells.
 */
export function gridWidth(w) {
  return Math.min(w, Math.max(MIN_CELLS_W, Math.min(MAX_CELLS_W, Math.round(w / TILES_PER_CELL))));
}

/**
 * The world's size and the grid it is sampled to.
 * @returns {{w:number, h:number, gw:number, gh:number}|null} Dimensions, or null without a map.
 */
function dims() {
  const w = Number(safe(() => GameplayMap.getGridWidth(), 0));
  const h = Number(safe(() => GameplayMap.getGridHeight(), 0));
  if (!(w > 0 && h > 0)) return null;
  const gw = gridWidth(w);
  return { w, h, gw, gh: Math.max(1, Math.round((gw * h) / w)) };
}

/**
 * Sample the world onto the grid.
 * @param {{w:number, h:number, gw:number, gh:number}} d Dimensions.
 * @param {(x:number, y:number) => number} fn Value of a plot.
 * @returns {number[]} Values, row by row.
 */
function sample(d, fn) {
  const out = new Array(d.gw * d.gh);
  for (let gy = 0; gy < d.gh; gy++) {
    const y = Math.min(d.h - 1, Math.floor(((gy + 0.5) * d.h) / d.gh));
    for (let gx = 0; gx < d.gw; gx++) {
      out[gy * d.gw + gx] = fn(Math.min(d.w - 1, Math.floor(((gx + 0.5) * d.w) / d.gw)), y);
    }
  }
  return out;
}

/**
 * Terrain class of a plot (see TERRAIN): deep ocean or shallow coast and lakes, mountains, and the
 * land's biome.
 * @param {number} x Column.
 * @param {number} y Row.
 * @returns {number} Class.
 */
export function terrainAt(x, y) {
  if (safe(() => GameplayMap.isWater(x, y), false)) {
    const t = String(safe(() => GameInfo.Terrains.lookup(GameplayMap.getTerrainType(x, y))?.TerrainType, "") || "");
    return t === "TERRAIN_OCEAN" ? TERRAIN.OCEAN : TERRAIN.COAST;
  }
  if (safe(() => GameplayMap.isMountain(x, y), false)) return TERRAIN.MOUNTAIN;
  const b = String(safe(() => GameInfo.Biomes.lookup(GameplayMap.getBiomeType(x, y))?.BiomeType, "") || "");
  return BIOME_CLASS[b] ?? TERRAIN.LAND;
}

/**
 * Whether the local player has explored a plot. True when that cannot be read, so a map is never
 * hidden by an engine change.
 * @param {number} local Local player id.
 * @param {number} x Column.
 * @param {number} y Row.
 * @returns {boolean} Explored.
 */
function explored(local, x, y) {
  const hidden = safe(() => RevealedStates.HIDDEN, undefined);
  if (hidden === undefined || local < 0) return true;
  return safe(() => GameplayMap.getRevealedState(local, x, y), hidden) !== hidden;
}

/**
 * The settlements of the major civilizations as [cell, owner].
 * @param {{w:number, h:number, gw:number, gh:number}} d Dimensions.
 * @param {Set<number>} majors Major player ids.
 * @returns {number[][]} Settlements.
 */
function settlements(d, majors) {
  const out = [];
  for (const pid of majors) {
    const list = safe(() => Players.get(pid)?.Cities?.getCities?.(), []) || [];
    for (const c of list) {
      const loc = safe(() => c.location, null);
      if (!loc || typeof loc.x !== "number" || typeof loc.y !== "number") continue;
      const gx = Math.min(d.gw - 1, Math.floor((loc.x * d.gw) / d.w));
      const gy = Math.min(d.gh - 1, Math.floor((loc.y * d.gh) / d.h));
      out.push([gy * d.gw + gx, pid]);
    }
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/**
 * Take a map frame for the campaign when one is due.
 * @param {CampaignDoc} doc Campaign (mutated: its map).
 * @param {number} ageIdx Age index.
 * @param {number} turn Game turn.
 * @param {boolean} force Take one regardless of the spacing.
 * @returns {boolean} True when a frame was recorded.
 */
export function captureMap(doc, ageIdx, turn, force) {
  const d = dims();
  if (!d) return false;
  if (!doc.map || doc.map.w !== d.gw || doc.map.h !== d.gh) {
    doc.map = { w: d.gw, h: d.gh, terrain: rle(sample(d, terrainAt)), frames: [] };
  }
  const last = doc.map.frames[doc.map.frames.length - 1];
  const due = force || !last || last.a !== ageIdx || turn - last.t >= MAP_EVERY;
  if (!due) return false;
  const majors = new Set(everMajors().map((p) => p.id));
  const local = Number(safe(() => GameContext.localPlayerID, -1));
  const owner = (/** @type {number} */ x, /** @type {number} */ y) => {
    if (!explored(local, x, y)) return UNEXPLORED;
    const o = Number(safe(() => GameplayMap.getOwner(x, y), -1));
    if (majors.has(o)) return o;
    return o >= 0 ? OTHER_OWNER : -1;
  };
  const owners = sample(d, owner);
  const towns = settlements(d, majors).filter((c) => owners[c[0]] !== UNEXPLORED);
  return addFrame(doc.map, { t: turn, a: ageIdx, o: rle(owners), c: towns });
}
