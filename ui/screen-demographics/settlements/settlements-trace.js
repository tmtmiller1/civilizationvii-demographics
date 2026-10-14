// settlements-trace.js
//
// Per-settlement history the Top Cities cards need but the per-civ sample stream
// doesn't carry: founding turn/year and a rolling population window per
// settlement, keyed by plot location ("x,y") and stored on the sampled history
// blob (`history.settleTrace`) so they survive quit/load and the age transition.
// Founding is exact from the CityAddedToMap event (held in memory until the next
// sample folds it in) or approximate from the first sampler sighting.
// recordSettlementTrace() runs once per sample; getFounded()/getCityTrend() read
// an in-memory copy at render time.

import { DemographicsStorage } from "/demographics/ui/storage/demographics-storage.js";
import { getGameSeed, orFallback } from "/demographics/ui/screen-demographics/screen/guarded-reads.js";

/** Max population samples retained per settlement. */
const CAP = 12;

/**
 * The per-settlement trace: founding stamps and rolling population windows.
 * @typedef {{ founded: Record<string, {turn: number, year: string, exact: boolean}>,
 *   pop: Record<string, Array<{t: number, pop: number}>> }} Trace
 */

/**
 * The trace readers use, keyed by the game seed it belongs to. A save loaded
 * from inside a running game does not recreate the page, so the seed check is
 * what keeps one game's trace out of another's.
 * @type {{ seed: string, trace: Trace }|null}
 */
let cache = null;

/**
 * Exact foundings seen via CityAddedToMap since the last sample (plot key →
 * stamp), folded into the history by the next recordSettlementTrace().
 * @type {Map<string, {turn: number, year: string, exact: boolean}>}
 */
const pendingExact = new Map();

/**
 * @param {*} value
 * @returns {Trace|null}
 */
function asTrace(value) {
  return value && typeof value === "object" && value.founded && typeof value.founded === "object" &&
    value.pop && typeof value.pop === "object" ? value : null;
}

/** @returns {Trace} */
function currentTrace() {
  const seed = getGameSeed();
  if (cache && cache.seed === seed) return cache.trace;
  const saved = orFallback(() => DemographicsStorage.load(), null);
  const trace = asTrace(saved && saved.settleTrace) || { founded: {}, pop: {} };
  cache = { seed, trace };
  return trace;
}

/** @param {*} city */
function locKey(city) {
  const key = orFallback(() => {
    const loc = city?.location;
    return loc && loc.x != null && loc.y != null ? loc.x + "," + loc.y : null;
  }, null);
  return typeof key === "string" ? key : null;
}

// CityAddedToMap (exact founding)

/** @type {((data: *) => void) | null} */
let addedHandlerRef = null;

/** @param {*} data */
function cityIdFromAddedEvent(data) {
  if (!data || typeof data !== "object") return null;
  return data.cityID || data.city || null;
}

/** @param {*} cityId */
function cityFromId(cityId) {
  if (!cityId) return null;
  if (typeof Cities === "undefined" || typeof Cities.get !== "function") return null;
  return Cities.get(cityId);
}

/** @param {string} loc */
function noteExactFounding(loc) {
  if (pendingExact.has(loc) || currentTrace().founded[loc]) return;
  const turn = orFallback(() => (typeof Game !== "undefined" ? Game.turn : undefined), undefined);
  const year = orFallback(
    () => (typeof Game !== "undefined" && Game.getTurnDate ? Game.getTurnDate() : ""),
    ""
  );
  pendingExact.set(loc, { turn: typeof turn === "number" ? turn : -1, year: year || "", exact: true });
}

/** @param {*} data */
function onCityAdded(data) {
  orFallback(() => {
    const city = cityFromId(cityIdFromAddedEvent(data));
    const loc = locKey(city);
    if (!loc) return;
    noteExactFounding(loc);
  });
}

/**
 * Subscribe to CityAddedToMap so foundings are recorded exactly going forward.
 * Idempotent. Safe if the engine/event is unavailable.
 */
export function startFoundingTracker() {
  stopFoundingTracker();
  // Module state outlives the game: a founding stamped in the previous game but
  // never folded (no sample ran after it) must not land on this game's history.
  pendingExact.clear();
  orFallback(() => {
    if (typeof engine === "undefined" || typeof engine.on !== "function") return;
    addedHandlerRef = (/** @type {*} */ data) => onCityAdded(data);
    engine.on("CityAddedToMap", addedHandlerRef);
  });
}

/** Unsubscribe the founding tracker. */
export function stopFoundingTracker() {
  const ref = addedHandlerRef;
  if (ref && typeof engine !== "undefined" && typeof engine.off === "function") {
    orFallback(() => engine.off("CityAddedToMap", ref));
  }
  addedHandlerRef = null;
}

// per-sample recording

function readAllSettlements() {
  const players = orFallback(
    () => (typeof Players !== "undefined" && Players.getAlive ? Players.getAlive() : null),
    null
  );
  if (!Array.isArray(players)) return [];
  /** @type {Array<{locId: string, pop: number}>} */
  const out = [];
  for (const player of players) {
    const ids = orFallback(() => player?.Cities?.getCityIds?.(), null);
    if (!Array.isArray(ids)) continue;
    for (const id of ids) {
      const city = orFallback(() => (typeof Cities !== "undefined" ? Cities.get(id) : null), null);
      const loc = locKey(city);
      if (!loc) continue;
      out.push({ locId: loc, pop: orFallback(() => city.population, 0) || 0 });
    }
  }
  return out;
}

/**
 * Fold this sample into the history's trace: population windows, pending exact
 * foundings, and an approximate founding for any settlement still unrecorded.
 * The caller's single per-turn save persists it.
 * @param {*} history The sampled history blob (mutated: `settleTrace`).
 * @param {number} turn The (monotonic) sample turn.
 * @param {string} [year] The sample's game-year string.
 * @returns {boolean} True when the trace was updated.
 */
export function recordSettlementTrace(history, turn, year) {
  if (!history || typeof history !== "object") return false;
  const settlements = readAllSettlements();
  if (!settlements.length) return false;
  const trace = asTrace(history.settleTrace) || (history.settleTrace = { founded: {}, pop: {} });
  for (const [loc, stamp] of pendingExact) if (!trace.founded[loc]) trace.founded[loc] = stamp;
  pendingExact.clear();
  for (const settlement of settlements) {
    foldPop(trace, settlement, turn);
    foldFounding(trace, settlement.locId, turn, year);
  }
  cache = { seed: getGameSeed(), trace };
  return true;
}

/**
 * @param {*} blob
 * @param {{locId: string, pop: number}} settlement
 * @param {number} turn
 */
function foldPop(blob, settlement, turn) {
  const popWindow = blob.pop[settlement.locId] || (blob.pop[settlement.locId] = []);
  const last = popWindow[popWindow.length - 1];
  if (last && last.t === turn) last.pop = settlement.pop;
  else popWindow.push({ t: turn, pop: settlement.pop });
  if (popWindow.length > CAP) popWindow.splice(0, popWindow.length - CAP);
}

/**
 * Stamp an approximate founding when none exists, or backfill the year of an
 * exact founding recorded without one.
 * @param {*} blob The trace blob (mutated).
 * @param {string} locId
 * @param {number} turn The sample turn.
 * @param {string} [year] The sample's game-year string.
 */
function foldFounding(blob, locId, turn, year) {
  const founded = blob.founded[locId];
  if (!founded) blob.founded[locId] = { turn, year: year || "", exact: false };
  else if (!founded.year && year) founded.year = year;
}

// readers (render time)

/**
 * The recorded founding for a settlement plot, or null.
 * @param {string|null|undefined} locId
 * @returns {{turn: number, year: string, exact: boolean}|null}
 */
export function getFounded(locId) {
  if (!locId) return null;
  return currentTrace().founded[locId] || pendingExact.get(locId) || null;
}

/** @param {number} rate */
function trendDirection(rate) {
  if (rate > 0.001) return 1;
  if (rate < -0.001) return -1;
  return 0;
}

/**
 * The population trend for a settlement plot from the rolling window, or null
 * when there is not enough history.
 * @param {string|null|undefined} locId
 * @returns {{popGrowthPerTurn: number, dir: number, samples: number}|null}
 */
export function getCityTrend(locId) {
  if (!locId) return null;
  const popWindow = currentTrace().pop[locId];
  if (!Array.isArray(popWindow) || popWindow.length < 2) return null;
  const first = popWindow[0];
  const last = popWindow[popWindow.length - 1];
  const span = last.t - first.t;
  const rate = span > 0 ? (last.pop - first.pop) / span : 0;
  return {
    popGrowthPerTurn: rate,
    dir: trendDirection(rate),
    samples: popWindow.length
  };
}
