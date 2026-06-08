// settlements-trace.js
//
// Per-settlement history the Top Cities cards need but the per-CIV sample stream
// doesn't carry: (1) FOUNDING turn/year per settlement, and (2) a rolling
// population window per settlement for rising/falling trend.
//
// Both are keyed by stable plot location ("x,y") and persisted INSIDE the mod's
// existing settings slice (one shared `modSettings` localStorage key - adding a
// second top-level key would make other mods wipe localStorage), seed-namespaced
// so it self-resets on a new game. The pop window is capped; the founding map is
// permanent (founding never changes) but bounded by the settlements in the game.
//
// Founding has two sources, distinguished as exact vs approximate:
//   - CityAddedToMap event  → EXACT founding turn (going forward).
//   - first sampler sighting → APPROXIMATE (settlement already existed / old save).
//
// recordSettlementsNow() is called once per sample by the sampler; getFounded()
// and getCityTrend() are read by settlements-data.js at render time.

import { DemographicsSettings } from "/demographics/ui/core/demographics-settings.js";

const KEY = "settleTrace";
/** Max population samples retained per settlement. */
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
 * Current game seed string (namespaces the buffer per playthrough).
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
 * Load the trace blob, resetting it when the game seed changed.
 * @param {string} seed Current game seed.
 * @returns {{seed: string, founded: Record<string, *>,
 *   pop: Record<string, Array<{t: number, pop: number}>>}}
 */
function loadBlob(seed) {
  const b = DemographicsSettings.getSetting(KEY, null);
  if (b && b.seed === seed && b.founded && b.pop) return b;
  return { seed, founded: {}, pop: {} };
}

/**
 * Plot key "x,y" for a city handle, or null.
 * @param {*} city The city handle.
 * @returns {string|null} The key, or null.
 */
function locKey(city) {
  const k = safe(() => {
    const l = city?.location;
    return l && l.x != null && l.y != null ? l.x + "," + l.y : null;
  }, null);
  return typeof k === "string" ? k : null;
}

// ── CityAddedToMap (exact founding) ──────────────────────────────────────────

/** @type {((data: *) => void) | null} */
let addedHandlerRef = null;

/**
 * Resolve a city id from a CityAddedToMap payload.
 * @param {*} data Event payload.
 * @returns {*} City id-like value.
 */
function cityIdFromAddedEvent(data) {
  if (!data || typeof data !== "object") return null;
  return data.cityID || data.city || null;
}

/**
 * Resolve a city handle from a city id.
 * @param {*} cityId City id-like value.
 * @returns {*} City handle or null.
 */
function cityFromId(cityId) {
  if (!cityId) return null;
  if (typeof Cities === "undefined" || typeof Cities.get !== "function") return null;
  return Cities.get(cityId);
}

/**
 * Persist an exact founding snapshot for one location key.
 * @param {string} loc Plot key.
 */
function persistExactFounding(loc) {
  const seed = gameSeed();
  const blob = loadBlob(seed);
  if (blob.founded[loc]) return;
  const turn = safe(() => (typeof Game !== "undefined" ? Game.turn : undefined), undefined);
  const year = safe(() => (typeof Game !== "undefined" && Game.getTurnDate ? Game.getTurnDate() : ""), "");
  blob.founded[loc] = { turn: typeof turn === "number" ? turn : -1, year: year || "", exact: true };
  DemographicsSettings.setSetting(KEY, blob);
}

/**
 * CityAddedToMap handler: stamp an EXACT founding turn/year for the new
 * settlement's plot (only if not already recorded).
 * @param {*} data The event payload (carries cityID).
 */
function onCityAdded(data) {
  safe(() => {
    const cid = cityIdFromAddedEvent(data);
    const city = cityFromId(cid);
    const loc = locKey(city);
    if (!loc) return;
    persistExactFounding(loc);
  });
}

/**
 * Subscribe to CityAddedToMap so foundings are recorded exactly going forward.
 * Idempotent. Safe if the engine/event is unavailable.
 */
export function startFoundingTracker() {
  stopFoundingTracker();
  safe(() => {
    if (typeof engine === "undefined" || typeof engine.on !== "function") return;
    addedHandlerRef = (/** @type {*} */ d) => onCityAdded(d);
    engine.on("CityAddedToMap", addedHandlerRef);
  });
}

/** Unsubscribe the founding tracker. */
export function stopFoundingTracker() {
  const ref = addedHandlerRef;
  if (ref && typeof engine !== "undefined" && typeof engine.off === "function") {
    safe(() => engine.off("CityAddedToMap", ref));
  }
  addedHandlerRef = null;
}

// ── Per-sample recording ─────────────────────────────────────────────────────

/**
 * Light read of every alive player's settlements: { locId, pop } only.
 * @returns {Array<{locId: string, pop: number}>} The settlements.
 */
function readAllSettlements() {
  const players = safe(() => (typeof Players !== "undefined" && Players.getAlive ? Players.getAlive() : null), null);
  if (!Array.isArray(players)) return [];
  /** @type {Array<{locId: string, pop: number}>} */
  const out = [];
  for (const p of players) {
    const ids = safe(() => p?.Cities?.getCityIds?.(), null);
    if (!Array.isArray(ids)) continue;
    for (const id of ids) {
      const city = safe(() => (typeof Cities !== "undefined" ? Cities.get(id) : null), null);
      const loc = locKey(city);
      if (!loc) continue;
      out.push({ locId: loc, pop: safe(() => city.population, 0) || 0 });
    }
  }
  return out;
}

/**
 * Compute this sample's settlement populations into the rolling window, and stamp
 * an APPROXIMATE founding for any settlement not yet recorded (and fill the year
 * for an exact-but-yearless founding stamped between samples). Returns the
 * settings key + updated blob for the caller to persist (batched into the single
 * per-turn settings write); null when there is nothing to record.
 * @param {number} turn The (monotonic) sample turn.
 * @param {string} [year] The sample's game-year string.
 * @returns {{key: string, value: *}|null} The settings entry to persist, or null.
 */
export function recordSettlementsNow(turn, year) {
  const settlements = readAllSettlements();
  if (!settlements.length) return null;
  const seed = gameSeed();
  const blob = loadBlob(seed);
  for (const s of settlements) {
    foldPop(blob, s, turn);
    foldFounding(blob, s.locId, turn, year);
  }
  return { key: KEY, value: blob };
}

/**
 * Append a settlement's population to its rolling window (dedupe same turn, cap).
 * @param {*} blob The trace blob (mutated).
 * @param {{locId: string, pop: number}} s The settlement.
 * @param {number} turn The sample turn.
 */
function foldPop(blob, s, turn) {
  const arr = blob.pop[s.locId] || (blob.pop[s.locId] = []);
  const last = arr[arr.length - 1];
  if (last && last.t === turn) last.pop = s.pop;
  else arr.push({ t: turn, pop: s.pop });
  if (arr.length > CAP) arr.splice(0, arr.length - CAP);
}

/**
 * Stamp an approximate founding when none exists, or backfill the year of an
 * exact founding recorded without one.
 * @param {*} blob The trace blob (mutated).
 * @param {string} locId The plot key.
 * @param {number} turn The sample turn.
 * @param {string} [year] The sample's game-year string.
 */
function foldFounding(blob, locId, turn, year) {
  const f = blob.founded[locId];
  if (!f) blob.founded[locId] = { turn, year: year || "", exact: false };
  else if (!f.year && year) f.year = year;
}

// ── Readers (render time) ────────────────────────────────────────────────────

/**
 * The recorded founding for a settlement plot, or null.
 * @param {string|null|undefined} locId The plot key.
 * @returns {{turn: number, year: string, exact: boolean}|null}
 */
export function getFounded(locId) {
  if (!locId) return null;
  const blob = DemographicsSettings.getSetting(KEY, null);
  if (!blob || blob.seed !== gameSeed() || !blob.founded) return null;
  return blob.founded[locId] || null;
}

/**
 * Convert growth rate into direction bucket.
 * @param {number} rate Growth per turn.
 * @returns {number} 1 rising, -1 falling, 0 flat.
 */
function trendDirection(rate) {
  if (rate > 0.001) return 1;
  if (rate < -0.001) return -1;
  return 0;
}

/**
 * The population trend for a settlement plot from the rolling window, or null
 * when there is not enough history.
 * @param {string|null|undefined} locId The plot key.
 * @returns {{popGrowthPerTurn: number, dir: number, samples: number}|null}
 */
export function getCityTrend(locId) {
  if (!locId) return null;
  const blob = DemographicsSettings.getSetting(KEY, null);
  if (!blob || !blob.pop) return null;
  if (blob.seed !== gameSeed()) return null;
  const arr = blob.pop[locId];
  if (!Array.isArray(arr) || arr.length < 2) return null;
  const first = arr[0];
  const last = arr[arr.length - 1];
  const span = last.t - first.t;
  const rate = span > 0 ? (last.pop - first.pop) / span : 0;
  return {
    popGrowthPerTurn: rate,
    dir: trendDirection(rate),
    samples: arr.length
  };
}
