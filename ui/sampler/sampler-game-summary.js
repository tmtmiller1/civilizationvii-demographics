// sampler-game-summary.js
//
// Defensive read-only adapter over the engine-native `Game.Summary` API (the
// game's Hall-of-Fame graph data; schema in base-standard/config/hall-of-fame.xml).
// Every export returns an EMPTY map on any absence or schema drift and never
// throws — matching the mod's "schema drift yields missing data, not crashes"
// contract. Consumers treat an empty/absent value as "no data yet", which the
// tab auto-hide (history-tabs.js#metricHasData) then handles in the UI.
//
// Scope note (from the probe, docs/plans T0 findings): Player-scope datasets
// (Gold, Science, GreatPeopleEarned, …) resolve one dataset per player; City-scope
// datasets (Tourism, Population, …) resolve one per city and must be summed per
// owning player. Delta datasets (GreatPeopleEarned) accumulate; level datasets
// (Tourism) take the latest point up to the turn.

const DBG = false;
/**
 * Debug logger, no-op unless {@link DBG}.
 * @param {...*} a Values to log.
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.summary]", ...a);
}

/**
 * Whether the Game.Summary dataset API is present and callable.
 * @returns {boolean} True when usable.
 */
export function summaryAvailable() {
  try {
    return (
      typeof Game !== "undefined" &&
      !!Game.Summary &&
      typeof Game.Summary.getDataSets === "function" &&
      typeof Game.Summary.getObjects === "function"
    );
  } catch (_) {
    return false;
  }
}

/**
 * Build a map of Summary object id → object ({ID, type, ownerPlayer, …}).
 * @returns {Map<*, *>} The object map (empty on failure).
 */
function objectMap() {
  const m = new Map();
  try {
    for (const o of Game.Summary.getObjects() || []) m.set(o.ID, o);
  } catch (e) {
    dlog("getObjects threw:", /** @type {*} */ (e)?.message);
  }
  return m;
}

/**
 * Reduce one dataset's `values` up to `turn`: the SUM of points (delta series)
 * or the LATEST point's value (level series).
 * @param {{x:number, y:number}[]} values The dataset points.
 * @param {number} turn Ignore points with x > turn.
 * @param {boolean} delta Sum points when true; take the latest when false.
 * @returns {number|null} The reduced value, or null when no point qualifies.
 */
function reduceValues(values, turn, delta) {
  let acc = 0;
  let last = null;
  let bestX = -Infinity;
  let any = false;
  for (const pt of values) {
    if (!pt || pt.x == null || pt.y == null || pt.x > turn) continue;
    any = true;
    if (delta) {
      acc += pt.y;
    } else if (pt.x >= bestX) {
      bestX = pt.x;
      last = pt.y;
    }
  }
  if (!any) return null;
  return delta ? acc : last;
}

/**
 * Reduce a dataset to a per-player value, aggregating across owners of the given
 * scope (one dataset per Player, or summed across a player's Cities).
 * @param {string} datasetId The Hall-of-Fame dataset id (e.g. "Tourism").
 * @param {number} turn Cap: ignore points beyond this turn.
 * @param {"Player"|"City"} scope The owning-object type to include.
 * @param {boolean} delta Sum (delta series) vs latest (level series).
 * @returns {Map<number, number>} pid → value (empty on absence/miss).
 */
export function datasetByPlayer(datasetId, turn, scope, delta) {
  const out = new Map();
  if (!summaryAvailable()) return out;
  const sets = getDataSetsSafe(datasetId);
  if (!sets.length) return out;
  const objs = objectMap();
  const spec = { scope, delta, turn };
  for (const ds of sets) accumulateDataset(ds, objs, out, spec);
  return out;
}

/**
 * Fetch a dataset's sets defensively.
 * @param {string} datasetId The dataset id.
 * @returns {any[]} The sets (empty on absence/throw).
 */
function getDataSetsSafe(datasetId) {
  try {
    const sets = Game.Summary.getDataSets(datasetId);
    return Array.isArray(sets) ? sets : [];
  } catch (e) {
    dlog("getDataSets(" + datasetId + ") threw:", /** @type {*} */ (e)?.message);
    return [];
  }
}

/**
 * Fold one dataset's contribution into the per-player accumulator, in place.
 * @param {*} ds One dataset ({owner, values}).
 * @param {Map<*, *>} objs The object map.
 * @param {Map<number, number>} out The accumulator (mutated).
 * @param {{scope:"Player"|"City", delta:boolean, turn:number}} spec Reduce spec.
 */
function accumulateDataset(ds, objs, out, spec) {
  const owner = ds && ds.owner != null ? objs.get(ds.owner) : null;
  if (!owner || owner.type !== spec.scope || owner.ownerPlayer == null || !ds.values) return;
  const v = reduceValues(ds.values, spec.turn, spec.delta);
  if (v != null) out.set(owner.ownerPlayer, (out.get(owner.ownerPlayer) || 0) + v);
}

/**
 * Cumulative by-type counts per player from a getDataPoints datapoint id
 * (e.g. "UnitsTrainedByType", "BuildingsBuiltByType"). Player-scope only.
 * @param {string} datapointId The datapoint id.
 * @returns {Map<number, Map<string, number>>} pid → (type → count), empty on miss.
 */
export function byTypeCounts(datapointId) {
  const out = new Map();
  if (!summaryAvailable() || typeof Game.Summary.getDataPoints !== "function") return out;
  let dps;
  try {
    dps = Game.Summary.getDataPoints();
  } catch (e) {
    dlog("getDataPoints threw:", /** @type {*} */ (e)?.message);
    return out;
  }
  if (!Array.isArray(dps)) return out;
  const objs = objectMap();
  for (const dp of dps) accumulateDatapoint(dp, objs, datapointId, out);
  return out;
}

/**
 * Whether a datapoint is a usable numeric by-type entry for `datapointId`.
 * @param {*} dp One datapoint.
 * @param {string} datapointId The datapoint id to match.
 * @returns {boolean} True when usable.
 */
function dpValid(dp, datapointId) {
  return (
    dp && dp.ID === datapointId && dp.value && dp.value.numeric != null &&
    dp.type != null && String(dp.type).trim() !== ""
  );
}

/**
 * Fold one datapoint into the per-player by-type accumulator, in place.
 * @param {*} dp One datapoint ({ID, owner, type, value:{numeric}}).
 * @param {Map<*, *>} objs The object map.
 * @param {string} datapointId The datapoint id to match.
 * @param {Map<number, Map<string, number>>} out The accumulator (mutated).
 */
function accumulateDatapoint(dp, objs, datapointId, out) {
  if (!dpValid(dp, datapointId)) return;
  const owner = dp.owner != null ? objs.get(dp.owner) : null;
  if (!owner || owner.type !== "Player" || owner.ownerPlayer == null) return;
  let m = out.get(owner.ownerPlayer);
  if (!m) {
    m = new Map();
    out.set(owner.ownerPlayer, m);
  }
  m.set(dp.type, (m.get(dp.type) || 0) + dp.value.numeric);
}
