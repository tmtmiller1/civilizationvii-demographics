// towns-history.js
//
// A small, self-contained ROLLING WINDOW of the local player's town stats, used
// by the Town Advisor for population-growth trends ("not just a single turn").
//
// It deliberately stays OUT of the main sample stream + decimation path: the
// buffer is persisted as one value inside the mod's existing settings slice
// (DemographicsSettings → the single shared `modSettings` localStorage key, so we
// never add a second top-level key, which other mods would treat as a signal to
// wipe localStorage). The window is capped per town and namespaced by game seed,
// so it self-resets on a new game and can never grow unbounded.
//
// recordLocalTownsNow() is called once per sample by the sampler (a cheap
// locId+population read); getTownTrend() is read by towns-data.js at advisor
// render time.

import { DemographicsSettings } from "/demographics/ui/demographics-settings.js";

/** Settings key holding the rolling buffer (lives under the shared modSettings slice). */
const KEY = "townTrendBuf";
/** Max samples retained per town. */
const CAP = 12;

/**
 * Run `fn`, returning its result or `fb` on throw. Never throws.
 * @template T
 * @param {() => T} fn Thunk.
 * @param {T} [fb] Fallback.
 * @returns {T|undefined} Result or fallback.
 */
function safe(fn, fb) {
  try {
    return fn();
  } catch (_) {
    return fb;
  }
}

/**
 * Current game seed (string), for namespacing the buffer per playthrough.
 * @returns {string} The seed, or "".
 */
function gameSeed() {
  return (
    safe(() => {
      if (typeof Configuration !== "undefined" && typeof Configuration.getGame === "function") {
        const g = Configuration.getGame();
        const s = g && (g.startSeed ?? g.gameSeed ?? g.mapSeed);
        if (s !== undefined && s !== null) return String(s);
      }
      return "";
    }, "") || ""
  );
}

/**
 * The local player (or observer) id.
 * @returns {number|undefined} The id, or undefined.
 */
function localPid() {
  return safe(() => {
    if (typeof GameContext === "undefined") return undefined;
    const v = GameContext.localPlayerID;
    if (typeof v === "number") return v;
    const o = GameContext.localObserverID;
    return typeof o === "number" ? o : undefined;
  }, undefined);
}

/**
 * Light read of one settlement id: { locId, pop } when it is a town, else null.
 * @param {*} id The settlement ComponentID.
 * @returns {{locId: string, pop: number}|null} The light town, or null.
 */
function lightTownAt(id) {
  const c = safe(() => (typeof Cities !== "undefined" ? Cities.get(id) : null), null);
  if (!c || !safe(() => c.isTown, false)) return null;
  const loc = safe(() => c.location, null);
  if (!loc || loc.x == null || loc.y == null) return null;
  return { locId: loc.x + "," + loc.y, pop: safe(() => c.population, 0) || 0 };
}

/**
 * Cheap read of the local player's towns: just plot key + population.
 * @returns {Array<{locId: string, pop: number}>} The light town list.
 */
function readLightTowns() {
  const pid = localPid();
  if (typeof pid !== "number" || typeof Players === "undefined") return [];
  const player = safe(() => Players.get(pid), null);
  const ids = safe(() => player?.Cities?.getCityIds?.(), null);
  if (!Array.isArray(ids)) return [];
  /** @type {Array<{locId: string, pop: number}>} */
  const out = [];
  for (const id of ids) {
    const tn = lightTownAt(id);
    if (tn) out.push(tn);
  }
  return out;
}

/**
 * Load the buffer, resetting it when the game seed changed (new game).
 * @param {string} seed Current game seed.
 * @returns {{seed: string, byLoc: Record<string, Array<{t: number, pop: number}>>}}
 */
function loadBuffer(seed) {
  const buf = DemographicsSettings.getSetting(KEY, null);
  if (buf && buf.seed === seed && buf.byLoc && typeof buf.byLoc === "object") return buf;
  return { seed, byLoc: {} };
}

/**
 * Record the local player's town populations for this sample turn into the
 * rolling window. Idempotent per turn (a repeated turn overwrites, not appends),
 * caps each town's window, and prunes towns no longer present.
 * @param {number} turn The (monotonic) sample turn.
 */
export function recordLocalTownsNow(turn) {
  const towns = readLightTowns();
  if (!towns.length) return;
  const seed = gameSeed();
  const buf = loadBuffer(seed);
  /** @type {Record<string, boolean>} */
  const present = {};
  for (const tn of towns) {
    present[tn.locId] = true;
    const arr = buf.byLoc[tn.locId] || (buf.byLoc[tn.locId] = []);
    const last = arr[arr.length - 1];
    if (last && last.t === turn) last.pop = tn.pop;
    else arr.push({ t: turn, pop: tn.pop });
    if (arr.length > CAP) arr.splice(0, arr.length - CAP);
  }
  for (const loc of Object.keys(buf.byLoc)) if (!present[loc]) delete buf.byLoc[loc];
  safe(() => DemographicsSettings.setSetting(KEY, buf));
}

/**
 * The population trend for a town from the rolling window, or null when there is
 * not enough history (or the buffer belongs to a different game).
 * @param {string|null|undefined} locId The town's "x,y" plot key.
 * @returns {{popGrowthPerTurn: number, samples: number, span: number}|null}
 */
export function getTownTrend(locId) {
  if (!locId) return null;
  const buf = DemographicsSettings.getSetting(KEY, null);
  if (!buf || buf.seed !== gameSeed() || !buf.byLoc) return null;
  const arr = buf.byLoc[locId];
  if (!Array.isArray(arr) || arr.length < 2) return null;
  const first = arr[0];
  const last = arr[arr.length - 1];
  const span = last.t - first.t;
  return {
    popGrowthPerTurn: span > 0 ? (last.pop - first.pop) / span : 0,
    samples: arr.length,
    span
  };
}
