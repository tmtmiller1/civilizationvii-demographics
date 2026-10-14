// settlements-adjacency.js
//
// Computes a placed building's / quarter's adjacency yield bonus from the game's
// static Constructible_Adjacencies rules against the live map, since the engine
// exposes no per-placed-building adjacency total. Common condition types are
// faithful; edge rules (appeal, biome, trait-exclusions) are approximated.

import { orFallback } from "/demographics/ui/screen-demographics/screen/guarded-reads.js";

/** Engine globals via an any-cast (avoids ambient-declaration coupling for tsc). */
const engine = /** @type {*} */ (globalThis);

// Static-rule indices (built once)

/** @type {Map<string, *[]>|null} ConstructibleType → its adjacency rule rows. */
let _rulesByType = null;
/** @type {Map<string, *>|null} YieldChangeId → Adjacency_YieldChanges row. */
let _yieldChangeById = null;
/** @type {Map<string, *>|null} YieldChangeId → wildcard row. */
let _wildcardById = null;
/** @type {Map<string, Set<string>>|null} ConstructibleType → its tags. */
let _tagMap = null;

function indexAdjRules() {
  _rulesByType = new Map();
  for (const row of orFallback(() => engine.GameInfo.Constructible_Adjacencies, []) || []) {
    let rules = _rulesByType.get(row.ConstructibleType);
    if (!rules) _rulesByType.set(row.ConstructibleType, (rules = []));
    rules.push(row);
  }
}

function indexTags() {
  _tagMap = new Map();
  for (const row of orFallback(() => engine.GameInfo.TypeTags, []) || []) {
    let tags = _tagMap.get(row.Type);
    if (!tags) _tagMap.set(row.Type, (tags = new Set()));
    tags.add(row.Tag);
  }
}

/** @param {string} type @param {string} tag */
function hasTag(type, tag) {
  const tags = _tagMap && _tagMap.get(type);
  return !!(tags && tags.has(tag));
}

function buildIndices() {
  if (_rulesByType) return;
  indexAdjRules();
  _yieldChangeById = new Map();
  for (const row of orFallback(() => engine.GameInfo.Adjacency_YieldChanges, []) || []) {
    _yieldChangeById.set(row.ID, row);
  }
  _wildcardById = new Map();
  for (const row of orFallback(() => engine.GameInfo.Constructible_WildcardAdjacencies, []) || []) {
    _wildcardById.set(row.YieldChangeId, row);
  }
  indexTags();
}

// Live neighbor classification

/**
 * @param {*} loc
 * @returns {{x:number,y:number}[]}
 */
function neighbors(loc) {
  const out = [];
  const directionCount = orFallback(() => engine.DirectionTypes.NUM_DIRECTION_TYPES, 6);
  for (let direction = 0; direction < directionCount; direction++) {
    const adjacent = orFallback(() => engine.GameplayMap.getAdjacentPlotLocation(loc, direction), null);
    if (adjacent) out.push(adjacent);
  }
  return out;
}

/**
 * @param {*} loc
 * @returns {{isQuarter:boolean, uq:*, type:string|null}|null} The tile's district facts (`uq` is the
 *   unique-quarter type).
 */
function districtAt(loc) {
  const district = orFallback(() => engine.Districts.getAtLocation(loc), null);
  if (!district) return null;
  const info = orFallback(() => engine.GameInfo.Districts.lookup(district.type), null);
  return { isQuarter: !!district.isQuarter, uq: district.uniqueQuarterType, type: info ? info.DistrictType : null };
}

/**
 * @param {*} yieldChange
 * @param {*} loc
 * @returns {boolean} District/quarter conditions.
 */
function matchDistrict(yieldChange, loc) {
  if (!yieldChange.AdjacentQuarter && !yieldChange.AdjacentUniqueQuarter && !yieldChange.AdjacentDistrict) return false;
  const district = districtAt(loc);
  if (!district) return false;
  if (yieldChange.AdjacentQuarter) return district.isQuarter;
  const none = orFallback(() => engine.UniqueQuarterTypes.NO_QUARTER, undefined);
  if (yieldChange.AdjacentUniqueQuarter) return district.uq != null && district.uq !== none;
  return district.type === yieldChange.AdjacentDistrict;
}

/**
 * @param {*} yieldChange
 * @param {*} loc
 * @returns {boolean} River/lake conditions.
 */
function matchWater(yieldChange, loc) {
  if (yieldChange.AdjacentNavigableRiver) {
    return !!orFallback(() => engine.GameplayMap.isNavigableRiver(loc.x, loc.y), false);
  }
  if (yieldChange.AdjacentLake) return !!orFallback(() => engine.GameplayMap.isLake(loc.x, loc.y), false);
  if (yieldChange.AdjacentRiver) return !!orFallback(() => engine.GameplayMap.isRiver(loc.x, loc.y), false);
  return false;
}

/**
 * @param {*} loc
 * @returns {*} The feature def at loc, or null.
 */
function featureAt(loc) {
  const featureType = orFallback(() => engine.GameplayMap.getFeatureType(loc.x, loc.y), null);
  return featureType == null ? null : orFallback(() => engine.GameInfo.Features.lookup(featureType), null);
}

/**
 * @param {*} yieldChange
 * @param {*} loc
 * @returns {boolean} Feature/terrain/natural-wonder conditions.
 */
function matchNature(yieldChange, loc) {
  if (yieldChange.AdjacentNaturalWonder) {
    const feature = featureAt(loc);
    return !!(feature && (feature.NaturalWonder || feature.Tier != null));
  }
  if (yieldChange.AdjacentFeature) {
    const feature = featureAt(loc);
    return !!(feature && feature.FeatureType === yieldChange.AdjacentFeature);
  }
  if (yieldChange.AdjacentTerrain) {
    const terrain = orFallback(
      () => engine.GameInfo.Terrains.lookup(engine.GameplayMap.getTerrainType(loc.x, loc.y)),
      null
    );
    return !!(terrain && terrain.TerrainType === yieldChange.AdjacentTerrain);
  }
  return false;
}

/**
 * @param {*} loc
 * @returns {*} The resource def at loc, or null.
 */
function resourceAt(loc) {
  const resourceType = orFallback(() => engine.GameplayMap.getResourceType(loc.x, loc.y), null);
  return resourceType == null ? null : orFallback(() => engine.GameInfo.Resources.lookup(resourceType), null);
}

/**
 * @param {*} yieldChange
 * @param {*} loc
 * @returns {boolean} Resource conditions.
 */
function matchResource(yieldChange, loc) {
  const wantsRes = yieldChange.AdjacentResource || yieldChange.AdjacentSpecificResource
    || (yieldChange.AdjacentResourceClass && yieldChange.AdjacentResourceClass !== "NO_RESOURCECLASS");
  if (!wantsRes) return false;
  const resource = resourceAt(loc);
  if (!resource) return false;
  if (yieldChange.AdjacentSpecificResource) return resource.ResourceType === yieldChange.AdjacentSpecificResource;
  if (yieldChange.AdjacentResourceClass && yieldChange.AdjacentResourceClass !== "NO_RESOURCECLASS") {
    return resource.ResourceClassType === yieldChange.AdjacentResourceClass;
  }
  return true;
}

/**
 * @param {*} loc
 * @returns {{type:string, cls:string}[]} Constructibles on the tile (`cls` is the ConstructibleClass).
 */
function constructiblesAt(loc) {
  const ids = orFallback(() => engine.MapConstructibles.getConstructibles(loc.x, loc.y), null);
  if (!Array.isArray(ids)) return [];
  const out = [];
  for (const id of ids) {
    const constructible = orFallback(() => engine.Constructibles.getByComponentID(id), null);
    const info = constructible && orFallback(() => engine.GameInfo.Constructibles.lookup(constructible.type), null);
    if (info) out.push({ type: info.ConstructibleType, cls: info.ConstructibleClass });
  }
  return out;
}

/**
 * @param {*} yieldChange
 * @param {{type:string, cls:string}} constructible
 * @param {*} wild
 */
function constructibleMatches(yieldChange, constructible, wild) {
  if (yieldChange.AdjacentConstructible && constructible.type === yieldChange.AdjacentConstructible) return true;
  if (yieldChange.AdjacentConstructibleClass && constructible.cls === yieldChange.AdjacentConstructibleClass) {
    return true;
  }
  if (yieldChange.AdjacentConstructibleTag && hasTag(constructible.type, yieldChange.AdjacentConstructibleTag)) {
    return true;
  }
  return !!(wild && wildMatch(wild, constructible));
}

/**
 * @param {*} yieldChange
 * @param {*} loc
 * @param {*} wild
 * @returns {boolean} Constructible (+wildcard) conditions.
 */
function matchConstructible(yieldChange, loc, wild) {
  const wantsType = yieldChange.AdjacentConstructible || yieldChange.AdjacentConstructibleClass
    || yieldChange.AdjacentConstructibleTag;
  if (!wantsType && !wild) return false;
  for (const constructible of constructiblesAt(loc)) {
    if (constructibleMatches(yieldChange, constructible, wild)) return true;
  }
  return false;
}

/**
 * @param {*} wild
 * @param {{type:string, cls:string}} constructible
 * @returns {boolean} Wildcard constructible match.
 */
function wildMatch(wild, constructible) {
  if (wild.ConstructibleClass && constructible.cls !== wild.ConstructibleClass) return false;
  if (wild.ConstructibleTag && !hasTag(constructible.type, wild.ConstructibleTag)) return false;
  return !!(wild.ConstructibleClass || wild.ConstructibleTag);
}

/**
 * @param {*} yieldChange
 * @param {*} loc
 * @param {*} wild
 * @returns {boolean} Whether the tile satisfies the condition.
 */
function tileMatches(yieldChange, loc, wild) {
  return matchDistrict(yieldChange, loc) || matchWater(yieldChange, loc) || matchNature(yieldChange, loc)
    || matchResource(yieldChange, loc) || matchConstructible(yieldChange, loc, wild);
}

// Public: per-building / per-quarter adjacency

/**
 * @param {*} city
 * @param {string} yieldChangeId
 * @returns {boolean} Whether an activation-gated rule is unlocked.
 */
function unlocked(city, yieldChangeId) {
  const isUnlocked = orFallback(() => city.Constructibles.isAdjacencyUnlocked(yieldChangeId), true);
  return isUnlocked !== false;
}

/**
 * @param {*} yieldChange
 * @param {*} loc
 * @param {{x:number,y:number}[]} neighborLocs
 * @param {*} wild
 * @returns {number} The count of qualifying tiles (own tile if `Self`, else neighbors).
 */
function ruleCount(yieldChange, loc, neighborLocs, wild) {
  if (yieldChange.Self) return tileMatches(yieldChange, loc, wild) ? 1 : 0;
  let count = 0;
  for (const neighbor of neighborLocs) if (tileMatches(yieldChange, neighbor, wild)) count++;
  return count;
}

/**
 * @param {*} city
 * @param {*} rule A Constructible_Adjacencies row.
 * @param {*} loc
 * @param {{x:number,y:number}[]} neighborLocs
 * @returns {{yield:string, amount:number}|null}
 */
function ruleAmount(city, rule, loc, neighborLocs) {
  if (rule.RequiresActivation && !unlocked(city, rule.YieldChangeId)) return null;
  const yieldChange = _yieldChangeById && _yieldChangeById.get(rule.YieldChangeId);
  if (!yieldChange) return null;
  const wild = _wildcardById && _wildcardById.get(rule.YieldChangeId);
  const tilesRequired = yieldChange.TilesRequired > 0 ? yieldChange.TilesRequired : 1;
  const matches = ruleCount(yieldChange, loc, neighborLocs, wild);
  const amount = Math.floor(matches / tilesRequired) * (yieldChange.YieldChange || 0);
  return amount ? { yield: yieldChange.YieldType, amount } : null;
}

/**
 * @param {*} city
 * @param {string} type The building ConstructibleType.
 * @param {*} loc
 * @param {{x:number,y:number}[]} neighborLocs
 */
function buildingAdjacency(city, type, loc, neighborLocs) {
  const out = /** @type {Record<string, number>} */ ({});
  const rules = _rulesByType && _rulesByType.get(type);
  if (!rules) return out;
  for (const rule of rules) {
    const result = ruleAmount(city, rule, loc, neighborLocs);
    if (result) out[result.yield] = (out[result.yield] || 0) + result.amount;
  }
  return out;
}

/**
 * The cumulative adjacency of a quarter (sum over its buildings), as named yields.
 * @param {*} city
 * @param {*} loc The quarter tile.
 * @param {string[]} buildingTypes The ConstructibleTypes on the tile.
 * @returns {{name:string, amount:number}[]} Named non-zero adjacency yields (most first).
 */
export function quarterAdjacency(city, loc, buildingTypes) {
  buildIndices();
  const neighborLocs = neighbors(loc);
  const total = /** @type {Record<string, number>} */ ({});
  for (const type of buildingTypes) {
    const perYield = buildingAdjacency(city, type, loc, neighborLocs);
    for (const yieldType in perYield) total[yieldType] = (total[yieldType] || 0) + perYield[yieldType];
  }
  const out = [];
  for (const yieldType in total) {
    if (!total[yieldType]) continue;
    const info = orFallback(() => engine.GameInfo.Yields.lookup(yieldType), null);
    const name = info ? orFallback(() => engine.Locale.compose(info.Name), info.Name) : String(yieldType);
    out.push({ name, amount: total[yieldType] });
  }
  out.sort((a, b) => b.amount - a.amount);
  return out;
}
