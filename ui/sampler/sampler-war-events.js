// sampler-war-events.js
//
// Event-based war-loss tracker: true unit casualties + permanently razed
// settlements. The per-turn sampler can only see standing state, so it misses
// things that happen and reverse between samples and can't tell destruction from
// transfer. We close both gaps with engine events.
//
// (1) UNIT CASUALTIES. The sampler only sees a player's STANDING army, so a unit
// built and destroyed between two samples is invisible and net production masks
// losses. We listen to `UnitKilledInCombat` and accumulate, per player, the
// combat strength of each destroyed unit. The catch: when the event fires the
// unit object is already gone (the base game's unit-flag manager resolves the
// dead unit from its OWN cache, not Units.get - unit-flag-manager.js
// onUnitRemovedFromMap). So we keep a live `owner:id -> { owner, strength }`
// cache, refreshed every sample as the military-power collector already iterates
// every unit (sampler-collectors.js _sumUnitStrengths), and resolve the dead
// unit's strength from it at kill time.
//
// (3) PRODUCTION DIRECTED TO WAR. On CityProductionCompleted we classify the
// finished item - military units (by FormationClass) and military/fortification
// buildings (by GameInfo.TypeTags) - and add its production cost to the city
// owner's cumulative `warProdCum`. The decode (ProductionKind + GameInfo lookup)
// and classification were confirmed against a live build.
//
// (2) RAZED SETTLEMENTS. A captured city merely changes hands (recoverable); a
// razed city is destroyed for good. We listen to `CityRazingStarted` and count,
// per player, the settlements that are permanently destroyed - attributed to the
// VICTIM (the civ that owned the city before it was captured), not the razer.
// Razing only starts AFTER capture, so at event time the city is owned by the
// conqueror; to recover the victim we cache each city's owner BY LOCATION every
// sample (location is stable across capture/raze, unlike the ComponentID owner)
// and snapshot the prior owner on `CityTransfered`.
//
// Both running per-player totals are sampled into each snapshot as cumulative,
// monotonically non-decreasing metrics (`milLostCum`, `razedCum`). The war
// tooltip reads each one's INCREASE over a participant's war window. milLostCum
// falls back to the standing-army drawdown proxy for wars predating this
// tracking; razedCum simply reads as "no data" (-) for those.
//
// Scope/limits (documented honestly):
//   - Casualties: only combat deaths count (not disband/upgrade/attrition); a
//     unit that lived and died within one turn is never cached, so it's missed
//     (at most a one-turn window at the default cadence); strength is the unit
//     type's base combat value, not HP at death.
//   - Razing: counted at CityRazingStarted, so a raze that is later halted
//     (CityRazingStopped, e.g. liberation) is still counted; a city razed
//     directly from a non-major (independent power) is attributed to that
//     non-major and so never appears in the major-vs-major tooltip.
//   - War production: counts the produced item's EFFECTIVE cost in the building
//     city (city.Production.getUnit/ConstructibleProductionCost - the same value
//     the production chooser shows), so leader/civ/policy discounts are already
//     applied. Gold/faith purchases fire CityMadePurchase, not this event, so
//     they aren't counted (treasury, not production); overflow isn't split out.
//     Whole-game cumulative; the tooltip shows only the increase per war window,
//     so peacetime builds aren't attributed.

// Flip to true for local debugging (committed off, matching the rest of the mod).
const DEMOGRAPHICS_DEBUG = false;
/**
 * Informational logger; no-op unless {@link DEMOGRAPHICS_DEBUG} is set.
 * @param {...*} a Values to log.
 */
function clog(...a) {
  if (DEMOGRAPHICS_DEBUG) console.warn("[Demographics.casualties]", ...a);
}

/**
 * Live cache of each tracked unit's owner + combat strength, keyed by
 * `owner:id`, refreshed every sample so a unit's strength is still known after
 * the unit object is destroyed.
 * @type {Map<string, { owner: number, strength: number }>}
 */
const unitStrengthCache = new Map();

/**
 * Cumulative combat strength of each player's units killed in combat, keyed by
 * pid. Monotonically non-decreasing for the life of the JS process; seeded from
 * persisted history on a fresh process so it survives a full restart.
 * @type {Map<number, number>}
 */
const casualtyByPid = new Map();

/**
 * Cumulative COUNT of each player's units killed in combat, keyed by pid. The body-count companion to
 * {@link casualtyByPid} (which sums combat STRENGTH); monotonic, seeded from persisted history.
 * @type {Map<number, number>}
 */
const unitsLostByPid = new Map();

/**
 * Last-sampled owner pid of the city at each map location ("x,y"), refreshed
 * every sample. Keyed by LOCATION (not ComponentID) because a city's
 * ComponentID owner changes on capture while its plot does not.
 * @type {Map<string, number>}
 */
const cityOwnerByLoc = new Map();

/**
 * The owner a city was captured FROM, keyed by location, recorded on
 * CityTransfered so a subsequent razing can be charged to the victim rather than
 * the conqueror who owns the city at raze time.
 * @type {Map<string, number>}
 */
const capturedFromByLoc = new Map();

/**
 * Cumulative count of each player's settlements permanently razed, keyed by pid.
 * Monotonic; seeded from persisted history like {@link casualtyByPid}.
 * @type {Map<number, number>}
 */
const razedByPid = new Map();

/**
 * Net cities WON minus LOST through capture, keyed by pid: +1 to the captor and
 * -1 to the prior owner on every CityTransfered. Unlike the sampled settlement
 * COUNT, this never counts a city founded with a settler - only cities that
 * actually changed hands - which is what "cities gained/lost in the war" means.
 * Not monotonic (a recaptured city nets back out). Seeded from history.
 * @type {Map<number, number>}
 */
const cityWarNetByPid = new Map();

/**
 * Cumulative production each player has spent on military items (units + military
 * buildings), keyed by pid. Monotonic; seeded from persisted history.
 * @type {Map<number, number>}
 */
const warProdByPid = new Map();

/**
 * Net territory (in km²) each player has WON minus LOST through city capture,
 * keyed by pid: a captured city's tiles are added to the captor and subtracted
 * from the prior owner on every CityTransfered. This is the ONLY territory that
 * actually changes hands in war - unlike the per-civ owned-tile total (the Land
 * Area line), which also moves with peaceful settling and border growth. Not
 * monotonic (a recaptured city nets back out). Seeded from history.
 * @type {Map<number, number>}
 */
const warLandByPid = new Map();

/**
 * km² per owned hex, matching scaleLandArea in demographics-metrics.js, so the
 * war "Land Area" figure reads in the same units as the Land Area line.
 */
const LAND_KM2_PER_TILE = 7000;

/** @type {((data: *) => void) | null} */
let killHandlerRef = null;
/** @type {((data: *) => void) | null} */
let transferHandlerRef = null;
/** @type {((data: *) => void) | null} */
let razeHandlerRef = null;
/** @type {((data: *) => void) | null} */
let prodHandlerRef = null;

/**
 * Extract a numeric unit id from a unit id that may be a raw number or a
 * ComponentID-like object ({ owner, id, type }).
 * @param {*} uid The unit id / ComponentID.
 * @returns {number | null} The numeric unit id, or null.
 */
function unitIdOf(uid) {
  if (typeof uid === "number") return uid;
  if (uid && typeof uid.id === "number") return uid.id;
  return null;
}

/**
 * Build the cache key for a unit.
 * @param {number} owner The owner pid.
 * @param {number} id The unit id.
 * @returns {string} The `owner:id` key.
 */
function unitKey(owner, id) {
  return owner + ":" + id;
}

/**
 * Record one military unit's strength so it can be resolved after the unit dies.
 * Called by the military-power collector for every counted (strength > 0) unit.
 * @param {*} uid The unit id / ComponentID from getUnitIds().
 * @param {number} owner The owner pid.
 * @param {number} strength The unit's combat strength.
 */
export function recordUnitStrength(uid, owner, strength) {
  const id = unitIdOf(uid);
  if (id === null || typeof owner !== "number" || !(strength > 0)) return;
  unitStrengthCache.set(unitKey(owner, id), { owner, strength });
}

/**
 * The cumulative combat strength of a player's units killed in combat.
 * @param {*} pid The player id.
 * @returns {number} The cumulative casualty strength (0 if untracked).
 */
export function getCumulativeCasualty(pid) {
  const v = casualtyByPid.get(Number(pid));
  return typeof v === "number" && isFinite(v) ? v : 0;
}

/**
 * The cumulative COUNT of a player's units killed in combat.
 * @param {*} pid The player id.
 * @returns {number} The cumulative unit-loss count (0 if untracked).
 */
export function getCumulativeUnitsLost(pid) {
  const v = unitsLostByPid.get(Number(pid));
  return typeof v === "number" && isFinite(v) ? v : 0;
}

/**
 * Location key ("x,y") for a city handle's plot, or null if unreadable.
 * @param {*} loc A { x, y } location.
 * @returns {string | null} The key, or null.
 */
function locKey(loc) {
  if (!loc || typeof loc.x !== "number" || typeof loc.y !== "number") return null;
  return loc.x + "," + loc.y;
}

/**
 * Record a city's current owner against its plot location, refreshed every
 * sample so a later razing can recover who owned the plot before any capture.
 * Called by the city collector for each of a player's settlements.
 * @param {*} city A city handle (carries `location`).
 * @param {number} owner The owner pid.
 */
export function recordCity(city, owner) {
  try {
    const key = locKey(city?.location);
    if (key === null || typeof owner !== "number") return;
    cityOwnerByLoc.set(key, owner);
  } catch (e) {
    clog("recordCity threw:", /** @type {*} */ (e)?.message);
  }
}

/**
 * The cumulative count of a player's settlements permanently razed.
 * @param {*} pid The player id.
 * @returns {number} The cumulative razed count (0 if untracked).
 */
export function getCumulativeRazed(pid) {
  const v = razedByPid.get(Number(pid));
  return typeof v === "number" && isFinite(v) ? v : 0;
}

/**
 * The cumulative production a player has directed to war (military units +
 * military buildings).
 * @param {*} pid The player id.
 * @returns {number} The cumulative war production (0 if untracked).
 */
export function getCumulativeWarProd(pid) {
  const v = warProdByPid.get(Number(pid));
  return typeof v === "number" && isFinite(v) ? v : 0;
}

/**
 * The net cities a player has won minus lost through capture (founding never
 * counts). Can be negative. 0 if untracked.
 * @param {*} pid The player id.
 * @returns {number} The cumulative net captures.
 */
export function getCumulativeCityWarNet(pid) {
  const v = cityWarNetByPid.get(Number(pid));
  return typeof v === "number" && isFinite(v) ? v : 0;
}

/**
 * The net territory (km²) a player has won minus lost through city capture
 * (peaceful expansion never counts). Can be negative. 0 if untracked.
 * @param {*} pid The player id.
 * @returns {number} The cumulative net captured territory in km².
 */
export function getCumulativeWarLand(pid) {
  const v = warLandByPid.get(Number(pid));
  return typeof v === "number" && isFinite(v) ? v : 0;
}

/**
 * Read purchased plots for a city id, or null.
 * @param {*} cityID City component id.
 * @returns {*|null} Purchased plots payload.
 */
function cityPurchasedPlots(cityID) {
  if (typeof Cities === "undefined" || typeof Cities.get !== "function") return null;
  const city = Cities.get(cityID);
  if (!city || typeof city.getPurchasedPlots !== "function") return null;
  return city.getPurchasedPlots();
}

/**
 * Resolve a purchased-plots payload length.
 * @param {*} plots Purchased plots payload.
 * @returns {number|null} Plot count when finite, else null.
 */
function purchasedPlotCount(plots) {
  if (Array.isArray(plots)) return plots.length;
  const count = plots?.length;
  if (typeof count === "number" && isFinite(count)) return count;
  return null;
}

/**
 * The owned-tile count of a city handle, in km² (× LAND_KM2_PER_TILE), or 0 when
 * unreadable. Reads the same getPurchasedPlots() the land collector sums.
 * @param {*} cityID The city ComponentID.
 * @returns {number} The city's territory in km² (0 if unreadable).
 */
function cityLandKm2(cityID) {
  try {
    const plots = cityPurchasedPlots(cityID);
    const count = purchasedPlotCount(plots);
    if (count === null) return 0;
    return count * LAND_KM2_PER_TILE;
  } catch (_) {
    // Cities.get()/getPurchasedPlots() can throw for a stale id; treat as 0.
  }
  return 0;
}

/**
 * Resolve a city event payload to its city handle + plot key. City events carry
 * `data.cityID` (a ComponentID); the handle gives the stable plot location.
 * @param {*} data The event payload.
 * @returns {{ key: string, cityID: * } | null} The plot key + cityID, or null.
 */
function resolveEventCity(data) {
  if (!data) return null;
  const cityID = data.cityID || data.city || (typeof data.owner === "number" ? data : null);
  if (!cityID) return null;
  const key = locKey(cityLocationOf(cityID, data));
  return key === null ? null : { key, cityID };
}

/**
 * Read a city's plot location from its handle, falling back to any location
 * carried on the event payload if the handle is unavailable.
 * @param {*} cityID The city ComponentID.
 * @param {*} data The event payload (may carry `location`).
 * @returns {*} A { x, y } location, or null.
 */
function cityLocationOf(cityID, data) {
  try {
    const city = typeof Cities !== "undefined" && Cities.get ? Cities.get(cityID) : null;
    if (city?.location) return city.location;
  } catch (_) {
    // Cities.get() can throw for a stale/removed cityID; fall through.
  }
  return data?.location || null;
}

/**
 * Apply one side of a capture to the net-captures and net-territory tallies:
 * `sign` is +1 for the captor, -1 for the prior owner.
 * @param {number} pid The player id.
 * @param {number} sign +1 (gained) or -1 (lost).
 * @param {number} land The captured city's territory in km².
 */
function applyCaptureTallies(pid, sign, land) {
  cityWarNetByPid.set(pid, (cityWarNetByPid.get(pid) || 0) + sign);
  warLandByPid.set(pid, (warLandByPid.get(pid) || 0) + sign * land);
}

/**
 * CityTransfered handler: remember who the city was captured FROM (the last
 * sampled owner of its plot) so a later razing is charged to that victim, then
 * advance the plot's current owner to the new owner.
 * @param {*} data The event payload.
 */
function onCityTransfered(data) {
  try {
    const ev = resolveEventCity(data);
    if (!ev) return;
    // The captured city's territory (km²) transfers from the prior owner to the
    // captor - this is the land actually taken in the war.
    const land = cityLandKm2(ev.cityID);
    const prior = cityOwnerByLoc.get(ev.key);
    if (typeof prior === "number") {
      capturedFromByLoc.set(ev.key, prior);
      applyCaptureTallies(prior, -1, land);
    }
    const newOwner = typeof ev.cityID?.owner === "number" ? ev.cityID.owner : undefined;
    if (typeof newOwner === "number") {
      cityOwnerByLoc.set(ev.key, newOwner);
      applyCaptureTallies(newOwner, 1, land);
    }
  } catch (e) {
    clog("onCityTransfered threw:", /** @type {*} */ (e)?.message);
  }
}

/**
 * CityRazingStarted handler: charge one permanently-razed settlement to the
 * victim - the civ the city was captured from, else its last-known owner.
 * @param {*} data The event payload.
 */
function onCityRazingStarted(data) {
  try {
    const ev = resolveEventCity(data);
    if (!ev) {
      clog("raze payload not resolvable; keys=", data && Object.keys(data));
      return;
    }
    const victim = capturedFromByLoc.has(ev.key)
      ? capturedFromByLoc.get(ev.key)
      : cityOwnerByLoc.get(ev.key);
    if (typeof victim === "number") {
      razedByPid.set(victim, (razedByPid.get(victim) || 0) + 1);
      clog("razed: victim=", victim, "loc=", ev.key, "cum=", razedByPid.get(victim));
    }
    capturedFromByLoc.delete(ev.key);
    cityOwnerByLoc.delete(ev.key);
  } catch (e) {
    clog("onCityRazingStarted threw:", /** @type {*} */ (e)?.message);
  }
}

/**
 * Pick the ComponentID-like field that carries the killed unit out of a
 * UnitKilledInCombat payload. Verified in a live build: the payload is
 * `{ unitKilled, unitKiller }`, each a ComponentID (owner/id/type) - so the
 * victim is `data.unitKilled`. (UnitKilledInCombat does NOT follow the `data.unit`
 * convention used by UnitRemovedFromMap/UnitDamageChanged.) The remaining field
 * names + bare-ComponentID fallback are cheap insurance against build variation.
 * @param {*} data The event payload.
 * @returns {*} The unit ComponentID-like object, or null.
 */
function pickUnitField(data) {
  const cid =
    data.unitKilled || data.unit || data.targetUnit || data.defeatedUnit || data.killedUnit;
  if (cid) return cid;
  if (typeof data.owner === "number" && typeof data.id === "number") return data;
  return null;
}

/**
 * Resolve the killed unit's owner + id from a UnitKilledInCombat payload.
 * @param {*} data The event payload.
 * @returns {{ owner: number, id: number } | null} The victim id, or null.
 */
function resolveKilledUnit(data) {
  if (!data) return null;
  const cid = pickUnitField(data);
  if (!cid || typeof cid.owner !== "number") return null;
  const id = unitIdOf(cid);
  return id === null ? null : { owner: cid.owner, id };
}

/**
 * UnitKilledInCombat handler: add the dead unit's cached strength to its owner's
 * cumulative casualty total.
 * @param {*} data The event payload.
 */
function onUnitKilledInCombat(data) {
  try {
    const victim = resolveKilledUnit(data);
    if (!victim) {
      clog("kill payload not resolvable; keys=", data && Object.keys(data));
      return;
    }
    const key = unitKey(victim.owner, victim.id);
    const cached = unitStrengthCache.get(key);
    if (!cached) {
      // Unit never sampled (built and killed within one turn) - strength is
      // gone with the unit; can't be counted.
      clog("kill with no cached strength for", key);
      return;
    }
    casualtyByPid.set(cached.owner, (casualtyByPid.get(cached.owner) || 0) + cached.strength);
    unitsLostByPid.set(cached.owner, (unitsLostByPid.get(cached.owner) || 0) + 1); // body count
    unitStrengthCache.delete(key);
    clog("casualty owner=", cached.owner, "str=", cached.strength, "cum=", casualtyByPid.get(cached.owner));
  } catch (e) {
    clog("onUnitKilledInCombat threw:", /** @type {*} */ (e)?.message);
  }
}

/**
 * Reset every per-player cumulative war-event total (casualties, razed
 * settlements, war production) to match the latest persisted snapshot's
 * `milLostCum` / `razedCum` / `warProdCum`. Makes the persisted history
 * authoritative on every (re)load: it restores the counters after a full restart
 * (fresh JS process) AND clears stale totals when a new game starts in the same
 * process (module state persists, but an empty history correctly seeds everyone
 * to zero). Called once per startWarEventTracker, before the first sample. The
 * totals are otherwise retained across an in-session save/load so nothing is
 * lost mid-session.
 * @param {Snapshot[] | undefined} samples The persisted sample stream.
 */
export function seedWarEventsFromHistory(samples) {
  try {
    casualtyByPid.clear();
    unitsLostByPid.clear();
    razedByPid.clear();
    warProdByPid.clear();
    cityWarNetByPid.clear();
    warLandByPid.clear();
    const last = Array.isArray(samples) && samples.length > 0 ? samples[samples.length - 1] : null;
    const players = last?.players;
    if (!players) return;
    for (const pid in players) seedOnePlayer(pid, players[pid]?.metrics);
  } catch (e) {
    clog("seedWarEventsFromHistory threw:", /** @type {*} */ (e)?.message);
  }
}

/**
 * Seed both cumulative counters for one pid from its stored metrics.
 * @param {string} pid The player id (object key).
 * @param {*} metrics The stored per-player metrics (may be undefined).
 */
function seedOnePlayer(pid, metrics) {
  seedOnePid(casualtyByPid, pid, metrics?.milLostCum);
  seedOnePid(unitsLostByPid, pid, metrics?.unitsLostCum);
  seedOnePid(razedByPid, pid, metrics?.razedCum);
  seedOnePid(warProdByPid, pid, metrics?.warProdCum);
  seedOnePid(cityWarNetByPid, pid, metrics?.cityWarNetCum);
  seedOnePid(warLandByPid, pid, metrics?.warLandCum);
}

/**
 * Seed one pid's cumulative total into a counter map from a stored value.
 * @param {Map<number, number>} into The counter map (casualtyByPid / razedByPid).
 * @param {string} pid The player id (object key).
 * @param {*} v The stored cumulative value.
 */
function seedOnePid(into, pid, v) {
  if (typeof v !== "number" || !isFinite(v)) return;
  into.set(Number(pid), v);
}

/**
 * Lazily build the set of ConstructibleTypes tagged MILITARY / FORTIFICATION /
 * UNIT_FORTIFICATION (walls + military buildings), read from GameInfo.TypeTags.
 * @type {Set<string> | null}
 */
let _militaryConstructibles = null;
/**
 * Return cached military-related constructible types from TypeTags.
 * @returns {Set<string>} Set of constructible type ids tagged for military use.
 */
function militaryConstructibleSet() {
  if (_militaryConstructibles) return _militaryConstructibles;
  const set = new Set();
  try {
    const tags = typeof GameInfo !== "undefined" && GameInfo.TypeTags ? GameInfo.TypeTags : [];
    for (const row of tags) {
      if (row && MILITARY_CONSTRUCTIBLE_TAGS.has(row.Tag)) set.add(row.Type);
    }
  } catch (e) {
    clog("militaryConstructibleSet threw:", /** @type {*} */ (e)?.message);
  }
  _militaryConstructibles = set;
  return set;
}

/** Constructible tags that count as military for "production directed to war". */
const MILITARY_CONSTRUCTIBLE_TAGS = new Set(["MILITARY", "FORTIFICATION", "UNIT_FORTIFICATION"]);

/** Unit formation classes that count as military. */
const MILITARY_FORMATIONS = new Set([
  "FORMATION_CLASS_LAND_COMBAT",
  "FORMATION_CLASS_NAVAL",
  "FORMATION_CLASS_AIR"
]);

/**
 * Decode a CityProductionCompleted item to { table, typeStr, formation } via the
 * city-banner pattern (ProductionKind + GameInfo.<table>.lookup), or null.
 * @param {*} kind The payload's productionKind.
 * @param {*} item The payload's productionItem.
 * @returns {{ table: string, typeStr: *, formation: * } | null} Decoded item.
 */
function decodeProduced(kind, item) {
  if (typeof ProductionKind === "undefined") return null;
  if (kind === ProductionKind.UNIT) {
    const d = lookupDef("Units", item);
    return d ? { table: "UNIT", typeStr: d.UnitType, formation: d.FormationClass } : null;
  }
  if (kind === ProductionKind.CONSTRUCTIBLE) {
    const d = lookupDef("Constructibles", item);
    return d ? { table: "CONSTRUCTIBLE", typeStr: d.ConstructibleType, formation: "" } : null;
  }
  return null;
}

/**
 * Look up a GameInfo definition row by item id from the named table, defensively.
 * @param {string} tbl The GameInfo table name ("Units" / "Constructibles").
 * @param {*} item The productionItem id.
 * @returns {*} The definition row, or null.
 */
function lookupDef(tbl, item) {
  try {
    const t = typeof GameInfo !== "undefined" ? GameInfo[tbl] : null;
    return t && typeof t.lookup === "function" ? t.lookup(item) : null;
  } catch (_) {
    return null;
  }
}

/**
 * Read the production cost of a produced item from its city's Production handle.
 * @param {*} cityID The city ComponentID.
 * @param {string} table "UNIT" or "CONSTRUCTIBLE".
 * @param {*} typeStr The unit/constructible type string.
 * @returns {number | null} The production cost, or null.
 */
function producedCost(cityID, table, typeStr) {
  if (!typeStr) return null;
  try {
    const city = typeof Cities !== "undefined" && Cities.get ? Cities.get(cityID) : null;
    const prod = city?.Production;
    const fn = prod && COST_FN_BY_TABLE[table];
    return fn && typeof prod[fn] === "function" ? prod[fn](typeStr) : null;
  } catch (_) {
    // Production cost accessors can throw for a stale city / unknown type.
    return null;
  }
}

/**
 * Production-cost accessor method name per production table.
 * @type {Record<string, string>}
 */
const COST_FN_BY_TABLE = {
  UNIT: "getUnitProductionCost",
  CONSTRUCTIBLE: "getConstructibleProductionCost"
};

/**
 * Whether a decoded produced item counts as military (military-formation unit,
 * or a constructible tagged MILITARY / FORTIFICATION).
 * @param {{ table: string, typeStr: *, formation: * } | null} dec Decoded item.
 * @returns {boolean} True when military.
 */
function isMilitaryProduced(dec) {
  if (!dec) return false;
  if (dec.table === "UNIT") return MILITARY_FORMATIONS.has(dec.formation);
  return militaryConstructibleSet().has(dec.typeStr);
}

/**
 * CityProductionCompleted handler: when a city finishes a military item (a
 * military-formation unit, or a building tagged MILITARY / FORTIFICATION), add
 * its production cost to that city owner's cumulative "production directed to
 * war" total. Verified against a live build (ProductionKind decode, GameInfo
 * lookup, formation/tag classification, and the cost accessor all confirmed).
 * @param {*} data The event payload.
 */
/**
 * Resolve a CityProductionCompleted payload to the military-production credit it
 * earns: { owner, cost, typeStr }, or null when the item isn't military / has no
 * resolvable cost / owner.
 * @param {*} data The event payload.
 * @returns {{ owner: number, cost: number, typeStr: * } | null} The credit, or null.
 */
function militaryProductionCredit(data) {
  if (!data || data.canceled) return null;
  const dec = decodeProduced(data.productionKind, data.productionItem);
  if (!dec || !isMilitaryProduced(dec)) return null;
  const owner = data.cityID?.owner;
  if (typeof owner !== "number") return null;
  const cost = producedCost(data.cityID, dec.table, dec.typeStr);
  if (typeof cost !== "number" || cost <= 0) return null;
  return { owner, cost, typeStr: dec.typeStr };
}

/**
 * CityProductionCompleted handler: credit a finished military item's production
 * cost to the city owner's cumulative "directed to war" total.
 * @param {*} data The event payload.
 */
function onCityProductionCompleted(data) {
  try {
    const c = militaryProductionCredit(data);
    if (!c) return;
    warProdByPid.set(c.owner, (warProdByPid.get(c.owner) || 0) + c.cost);
    clog("warProd owner=", c.owner, c.typeStr, "+", c.cost, "cum=", warProdByPid.get(c.owner));
  } catch (e) {
    clog("onCityProductionCompleted threw:", /** @type {*} */ (e)?.message);
  }
}

/**
 * Subscribe to the war-event sources: UnitKilledInCombat (casualties),
 * CityTransfered + CityRazingStarted (razed settlements), and
 * CityProductionCompleted (production directed to war). Idempotent: drops any
 * prior subscriptions first, mirroring the sampler's re-register-on-load pattern.
 */
export function startWarEventTracker() {
  stopWarEventTracker();
  exposeWarData();
  if (typeof engine === "undefined" || typeof engine.on !== "function") return;
  killHandlerRef = subscribe("UnitKilledInCombat", onUnitKilledInCombat);
  transferHandlerRef = subscribe("CityTransfered", onCityTransfered);
  razeHandlerRef = subscribe("CityRazingStarted", onCityRazingStarted);
  prodHandlerRef = subscribe("CityProductionCompleted", onCityProductionCompleted);
}

/**
 * Publish the cumulative per-civ war tallies on a read-only global surface so OTHER mods (e.g.
 * Emigration's war-severity model + its Causes-tab reporting) can read them. Additive: merges onto any
 * existing globalThis.DemographicsData. The accessors read the live counters, so values stay current.
 */
function exposeWarData() {
  try {
    const g = /** @type {*} */ (globalThis);
    g.DemographicsData = Object.assign(g.DemographicsData || {}, {
      casualtyCumFor: (/** @type {number} */ pid) => getCumulativeCasualty(pid),
      unitsLostCumFor: (/** @type {number} */ pid) => getCumulativeUnitsLost(pid),
      razedCumFor: (/** @type {number} */ pid) => getCumulativeRazed(pid),
      warLandCumFor: (/** @type {number} */ pid) => getCumulativeWarLand(pid),
      cityWarNetCumFor: (/** @type {number} */ pid) => getCumulativeCityWarNet(pid),
      warProdCumFor: (/** @type {number} */ pid) => getCumulativeWarProd(pid)
    });
  } catch (_) {
    /* exposing data must never break the tracker */
  }
}

/**
 * Subscribe one handler to an engine event, returning the bound ref (or null if
 * engine.on throws, e.g. the event name is unknown in this build).
 * @param {string} event The engine event name.
 * @param {(data: *) => void} handler The handler.
 * @returns {((data: *) => void) | null} The bound ref, or null on failure.
 */
function subscribe(event, handler) {
  try {
    const ref = (/** @type {*} */ data) => handler(data);
    engine.on(event, ref);
    clog("subscribed to", event);
    return ref;
  } catch (e) {
    clog("engine.on", event, "threw:", /** @type {*} */ (e)?.message);
    return null;
  }
}

/**
 * Unsubscribe every war-loss event and drop the live per-sample caches (stale
 * across a load/age transition). The cumulative per-player totals are
 * deliberately retained so they persist across an in-session save/load cycle.
 */
export function stopWarEventTracker() {
  killHandlerRef = unsubscribe("UnitKilledInCombat", killHandlerRef);
  transferHandlerRef = unsubscribe("CityTransfered", transferHandlerRef);
  razeHandlerRef = unsubscribe("CityRazingStarted", razeHandlerRef);
  prodHandlerRef = unsubscribe("CityProductionCompleted", prodHandlerRef);
  unitStrengthCache.clear();
  cityOwnerByLoc.clear();
  capturedFromByLoc.clear();
}

/**
 * Unsubscribe one handler from an engine event.
 * @param {string} event The engine event name.
 * @param {((data: *) => void) | null} ref The bound ref to remove.
 * @returns {null} Always null, for reassignment.
 */
function unsubscribe(event, ref) {
  if (ref && typeof engine !== "undefined" && typeof engine.off === "function") {
    try {
      engine.off(event, ref);
    } catch (e) {
      clog("engine.off", event, "threw:", /** @type {*} */ (e)?.message);
    }
  }
  return null;
}
