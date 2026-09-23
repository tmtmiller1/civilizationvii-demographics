// settlements-trace.js
//
// Per-settlement history the Top Cities cards need but the per-CIV sample stream
// doesn't carry: founding turn/year and a rolling population window per
// settlement, keyed by plot location ("x,y") and stored on the sampled history
// blob (`history.settleTrace`) so they survive quit/load and the age transition.
// Founding is EXACT from the CityAddedToMap event (held in memory until the next
// sample folds it in) or APPROXIMATE from the first sampler sighting.
// recordSettlementTrace() runs once per sample; getFounded()/getCityTrend() read
// an in-memory copy at render time.

import { DemographicsStorage } from "/demographics/ui/storage/demographics-storage.js";

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
 * The value as a usable trace, or null.
 * @param {*} v Candidate trace.
 * @returns {Trace|null} The trace, or null.
 */
function asTrace(v) {
  return v && typeof v === "object" && v.founded && typeof v.founded === "object" &&
    v.pop && typeof v.pop === "object" ? v : null;
}

/**
 * The trace for the current game: the cached copy, else the one on the saved
 * history (read once), else an empty one.
 * @returns {Trace} The trace.
 */
function currentTrace() {
  const seed = gameSeed();
  if (cache && cache.seed === seed) return cache.trace;
  const saved = safe(() => DemographicsStorage.load(), null);
  const trace = asTrace(saved && saved.settleTrace) || { founded: {}, pop: {} };
  cache = { seed, trace };
  return trace;
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
 * Hold an exact founding stamp for one location key until the next sample.
 * @param {string} loc Plot key.
 */
function noteExactFounding(loc) {
  if (pendingExact.has(loc) || currentTrace().founded[loc]) return;
  const turn = safe(() => (typeof Game !== "undefined" ? Game.turn : undefined), undefined);
  const year = safe(() => (typeof Game !== "undefined" && Game.getTurnDate ? Game.getTurnDate() : ""), "");
  pendingExact.set(loc, { turn: typeof turn === "number" ? turn : -1, year: year || "", exact: true });
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
 * Fold this sample into the history's trace: population windows, pending exact
 * foundings, and an APPROXIMATE founding for any settlement still unrecorded.
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
  for (const s of settlements) {
    foldPop(trace, s, turn);
    foldFounding(trace, s.locId, turn, year);
  }
  cache = { seed: gameSeed(), trace };
  return true;
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
  return currentTrace().founded[locId] || pendingExact.get(locId) || null;
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
  const arr = currentTrace().pop[locId];
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
