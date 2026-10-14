// towns-history.js
//
// A small rolling window of the local player's town stats, used by the Town
// Advisor for population-growth trends. It stays out of the main sample stream:
// the buffer is one value inside the mod's settings slice (the shared `modSettings`
// key), capped per town and namespaced by game seed so it self-resets on a new game.
//
// recordLocalTownsNow() is called once per sample by the sampler; getTownTrend()
// is read by towns-data.js at advisor render time.

import { DemographicsSettings } from "/demographics/ui/core/demographics-settings.js";
import { getGameSeed, orFallback } from "/demographics/ui/screen-demographics/screen/guarded-reads.js";

/** Settings key holding the rolling buffer (lives under the shared modSettings slice). */
const KEY = "townTrendBuf";
/** Max samples retained per town. */
const CAP = 12;

function localPid() {
  return orFallback(() => {
    if (typeof GameContext === "undefined") return undefined;
    const playerId = GameContext.localPlayerID;
    if (typeof playerId === "number") return playerId;
    const observerId = GameContext.localObserverID;
    return typeof observerId === "number" ? observerId : undefined;
  }, undefined);
}

/** @param {*} id The settlement ComponentID. */
function lightTownAt(id) {
  const city = orFallback(() => (typeof Cities !== "undefined" ? Cities.get(id) : null), null);
  if (!city || !orFallback(() => city.isTown, false)) return null;
  const loc = orFallback(() => city.location, null);
  if (!loc || loc.x == null || loc.y == null) return null;
  return { locId: loc.x + "," + loc.y, pop: orFallback(() => city.population, 0) || 0 };
}

function readLightTowns() {
  const pid = localPid();
  if (typeof pid !== "number" || typeof Players === "undefined") return [];
  const player = orFallback(() => Players.get(pid), null);
  const ids = orFallback(() => player?.Cities?.getCityIds?.(), null);
  if (!Array.isArray(ids)) return [];
  /** @type {Array<{locId: string, pop: number}>} */
  const out = [];
  for (const id of ids) {
    const town = lightTownAt(id);
    if (town) out.push(town);
  }
  return out;
}

/**
 * @param {string} seed
 * @returns {{seed: string, byLoc: Record<string, Array<{t: number, pop: number}>>}}
 */
function loadBuffer(seed) {
  const buffer = DemographicsSettings.getSetting(KEY, null);
  if (buffer && buffer.seed === seed && buffer.byLoc && typeof buffer.byLoc === "object") return buffer;
  return { seed, byLoc: {} };
}

/**
 * Record the local player's town populations for this sample turn into the
 * rolling window: idempotent per turn, caps each town's window, and prunes
 * absent towns. Returns the settings key + updated buffer to persist, or null.
 * @param {number} turn The (monotonic) sample turn.
 * @returns {{key: string, value: *}|null} The settings entry to persist, or null.
 */
export function recordLocalTownsNow(turn) {
  const towns = readLightTowns();
  if (!towns.length) return null;
  const seed = getGameSeed();
  const buffer = loadBuffer(seed);
  /** @type {Record<string, boolean>} */
  const present = {};
  for (const town of towns) {
    present[town.locId] = true;
    const samples = buffer.byLoc[town.locId] || (buffer.byLoc[town.locId] = []);
    const last = samples[samples.length - 1];
    if (last && last.t === turn) last.pop = town.pop;
    else samples.push({ t: turn, pop: town.pop });
    if (samples.length > CAP) samples.splice(0, samples.length - CAP);
  }
  for (const loc of Object.keys(buffer.byLoc)) if (!present[loc]) delete buffer.byLoc[loc];
  return { key: KEY, value: buffer };
}

/**
 * The population trend for a town from the rolling window, or null when there is
 * not enough history (or the buffer belongs to a different game).
 * @param {string|null|undefined} locId The town's "x,y" plot key.
 * @returns {{popGrowthPerTurn: number, samples: number, span: number}|null}
 */
export function getTownTrend(locId) {
  if (!locId) return null;
  const buffer = DemographicsSettings.getSetting(KEY, null);
  if (!buffer || buffer.seed !== getGameSeed() || !buffer.byLoc) return null;
  const samples = buffer.byLoc[locId];
  if (!Array.isArray(samples) || samples.length < 2) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const span = last.t - first.t;
  return {
    popGrowthPerTurn: span > 0 ? (last.pop - first.pop) / span : 0,
    samples: samples.length,
    span
  };
}
