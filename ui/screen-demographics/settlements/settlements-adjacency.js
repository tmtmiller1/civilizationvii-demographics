// settlements-adjacency.js
//
// Computes a placed building's / quarter's ADJACENCY yield bonus from the game's
// static adjacency rules against the LIVE map — the engine exposes no per-placed-
// building adjacency total (only a prospective placement sim), so this recomputes
// it: for each of a building's Constructible_Adjacencies rules, count the
// qualifying neighbor tiles and multiply by the rule's YieldChange (÷ TilesRequired).
// A faithful best-effort over the common condition types; edge rules (appeal,
// biome, trait-exclusions, TilesRequired>1 rounding) are approximated. Defensive.

/** Engine globals via an any-cast (avoids ambient-declaration coupling for tsc). */
const G = /** @type {*} */ (globalThis);

/** @param {()=>*} fn @param {*} [fb] @returns {*} fn() or fb on throw. */
function safe(fn, fb) {
  try {
    return fn();
  } catch (_) {
    return fb;
  }
}

// ── Static-rule indices (built once) ─────────────────────────────────────────

/** @type {Map<string, *[]>|null} ConstructibleType → its adjacency rule rows. */
let _adjByType = null;
/** @type {Map<string, *>|null} YieldChangeId → Adjacency_YieldChanges row. */
let _ycById = null;
/** @type {Map<string, *>|null} YieldChangeId → wildcard row. */
let _wildById = null;
/** @type {Map<string, Set<string>>|null} ConstructibleType → its tags. */
let _tagMap = null;

/** Index Constructible_Adjacencies rows by their ConstructibleType. */
function indexAdjRules() {
  _adjByType = new Map();
  for (const r of safe(() => G.GameInfo.Constructible_Adjacencies, []) || []) {
    let a = _adjByType.get(r.ConstructibleType);
    if (!a) _adjByType.set(r.ConstructibleType, (a = []));
    a.push(r);
  }
}

/** Index TypeTags as ConstructibleType → Set of tags. */
function indexTags() {
  _tagMap = new Map();
  for (const r of safe(() => G.GameInfo.TypeTags, []) || []) {
    let s = _tagMap.get(r.Type);
    if (!s) _tagMap.set(r.Type, (s = new Set()));
    s.add(r.Tag);
  }
}

/** @param {string} type @param {string} tag @returns {boolean} Whether the type carries the tag. */
function hasTag(type, tag) {
  const s = _tagMap && _tagMap.get(type);
  return !!(s && s.has(tag));
}

/** Build the static-rule indices from GameInfo (idempotent). */
function buildIndices() {
  if (_adjByType) return;
  indexAdjRules();
  _ycById = new Map();
  for (const r of safe(() => G.GameInfo.Adjacency_YieldChanges, []) || []) _ycById.set(r.ID, r);
  _wildById = new Map();
  for (const r of safe(() => G.GameInfo.Constructible_WildcardAdjacencies, []) || []) _wildById.set(r.YieldChangeId, r);
  indexTags();
}

// ── Live neighbor classification ─────────────────────────────────────────────

/** @param {*} loc @returns {{x:number,y:number}[]} The plot's adjacent locations. */
function neighbors(loc) {
  const out = [];
  const n = safe(() => G.DirectionTypes.NUM_DIRECTION_TYPES, 6);
  for (let d = 0; d < n; d++) {
    const a = safe(() => G.GameplayMap.getAdjacentPlotLocation(loc, d), null);
    if (a) out.push(a);
  }
  return out;
}

/** @param {*} loc @returns {{isQuarter:boolean, uq:*, type:string|null}|null} The tile's district facts. */
function districtAt(loc) {
  const d = safe(() => G.Districts.getAtLocation(loc), null);
  if (!d) return null;
  const info = safe(() => G.GameInfo.Districts.lookup(d.type), null);
  return { isQuarter: !!d.isQuarter, uq: d.uniqueQuarterType, type: info ? info.DistrictType : null };
}

/** @param {*} yc @param {*} loc @returns {boolean} District/quarter conditions. */
function matchDistrict(yc, loc) {
  if (!yc.AdjacentQuarter && !yc.AdjacentUniqueQuarter && !yc.AdjacentDistrict) return false;
  const d = districtAt(loc);
  if (!d) return false;
  if (yc.AdjacentQuarter) return d.isQuarter;
  const none = safe(() => G.UniqueQuarterTypes.NO_QUARTER, undefined);
  if (yc.AdjacentUniqueQuarter) return d.uq != null && d.uq !== none;
  return d.type === yc.AdjacentDistrict;
}

/** @param {*} yc @param {*} loc @returns {boolean} River/lake conditions. */
function matchWater(yc, loc) {
  if (yc.AdjacentNavigableRiver) return !!safe(() => G.GameplayMap.isNavigableRiver(loc.x, loc.y), false);
  if (yc.AdjacentLake) return !!safe(() => G.GameplayMap.isLake(loc.x, loc.y), false);
  if (yc.AdjacentRiver) return !!safe(() => G.GameplayMap.isRiver(loc.x, loc.y), false);
  return false;
}

/** @param {*} loc @returns {*} The feature def at loc, or null. */
function featureAt(loc) {
  const f = safe(() => G.GameplayMap.getFeatureType(loc.x, loc.y), null);
  return f == null ? null : safe(() => G.GameInfo.Features.lookup(f), null);
}

/** @param {*} yc @param {*} loc @returns {boolean} Feature/terrain/natural-wonder conditions. */
function matchNature(yc, loc) {
  if (yc.AdjacentNaturalWonder) {
    const f = featureAt(loc);
    return !!(f && (f.NaturalWonder || f.Tier != null));
  }
  if (yc.AdjacentFeature) {
    const f = featureAt(loc);
    return !!(f && f.FeatureType === yc.AdjacentFeature);
  }
  if (yc.AdjacentTerrain) {
    const tr = safe(() => G.GameInfo.Terrains.lookup(G.GameplayMap.getTerrainType(loc.x, loc.y)), null);
    return !!(tr && tr.TerrainType === yc.AdjacentTerrain);
  }
  return false;
}

/** @param {*} loc @returns {*} The resource def at loc, or null. */
function resourceAt(loc) {
  const r = safe(() => G.GameplayMap.getResourceType(loc.x, loc.y), null);
  return r == null ? null : safe(() => G.GameInfo.Resources.lookup(r), null);
}

/** @param {*} yc @param {*} loc @returns {boolean} Resource conditions. */
function matchResource(yc, loc) {
  const wantsRes = yc.AdjacentResource || yc.AdjacentSpecificResource
    || (yc.AdjacentResourceClass && yc.AdjacentResourceClass !== "NO_RESOURCECLASS");
  if (!wantsRes) return false;
  const r = resourceAt(loc);
  if (!r) return false;
  if (yc.AdjacentSpecificResource) return r.ResourceType === yc.AdjacentSpecificResource;
  if (yc.AdjacentResourceClass && yc.AdjacentResourceClass !== "NO_RESOURCECLASS") {
    return r.ResourceClassType === yc.AdjacentResourceClass;
  }
  return true;
}

/** @param {*} loc @returns {{type:string, cls:string}[]} Constructibles on the tile. */
function constructiblesAt(loc) {
  const ids = safe(() => G.MapConstructibles.getConstructibles(loc.x, loc.y), null);
  if (!Array.isArray(ids)) return [];
  const out = [];
  for (const id of ids) {
    const c = safe(() => G.Constructibles.getByComponentID(id), null);
    const info = c && safe(() => G.GameInfo.Constructibles.lookup(c.type), null);
    if (info) out.push({ type: info.ConstructibleType, cls: info.ConstructibleClass });
  }
  return out;
}

/**
 * @param {*} yc @param {{type:string, cls:string}} c @param {*} wild
 * @returns {boolean} Whether one neighbor constructible matches the rule.
 */
function conMatches(yc, c, wild) {
  if (yc.AdjacentConstructible && c.type === yc.AdjacentConstructible) return true;
  if (yc.AdjacentConstructibleClass && c.cls === yc.AdjacentConstructibleClass) return true;
  if (yc.AdjacentConstructibleTag && hasTag(c.type, yc.AdjacentConstructibleTag)) return true;
  return !!(wild && wildMatch(wild, c));
}

/** @param {*} yc @param {*} loc @param {*} wild @returns {boolean} Constructible (+wildcard) conditions. */
function matchConstructible(yc, loc, wild) {
  const wantsType = yc.AdjacentConstructible || yc.AdjacentConstructibleClass || yc.AdjacentConstructibleTag;
  if (!wantsType && !wild) return false;
  for (const c of constructiblesAt(loc)) if (conMatches(yc, c, wild)) return true;
  return false;
}

/** @param {*} wild @param {{type:string, cls:string}} c @returns {boolean} Wildcard constructible match. */
function wildMatch(wild, c) {
  if (wild.ConstructibleClass && c.cls !== wild.ConstructibleClass) return false;
  if (wild.ConstructibleTag && !hasTag(c.type, wild.ConstructibleTag)) return false;
  return !!(wild.ConstructibleClass || wild.ConstructibleTag);
}

/** @param {*} yc @param {*} loc @param {*} wild @returns {boolean} Whether the tile satisfies the condition. */
function tileMatches(yc, loc, wild) {
  return matchDistrict(yc, loc) || matchWater(yc, loc) || matchNature(yc, loc)
    || matchResource(yc, loc) || matchConstructible(yc, loc, wild);
}

// ── Public: per-building / per-quarter adjacency ─────────────────────────────

/** @param {*} city @param {string} yieldChangeId @returns {boolean} Whether an activation-gated rule is unlocked. */
function unlocked(city, yieldChangeId) {
  const v = safe(() => city.Constructibles.isAdjacencyUnlocked(yieldChangeId), true);
  return v !== false;
}

/**
 * @param {*} yc @param {*} loc @param {{x:number,y:number}[]} nbrs @param {*} wild
 * @returns {number} The count of qualifying tiles (own tile if `Self`, else neighbors).
 */
function ruleCount(yc, loc, nbrs, wild) {
  if (yc.Self) return tileMatches(yc, loc, wild) ? 1 : 0;
  let count = 0;
  for (const nl of nbrs) if (tileMatches(yc, nl, wild)) count++;
  return count;
}

/**
 * One adjacency rule's yield for a building at a location, or null.
 * @param {*} city @param {*} rule A Constructible_Adjacencies row.
 * @param {*} loc @param {{x:number,y:number}[]} nbrs Precomputed neighbors.
 * @returns {{yield:string, amount:number}|null} The yielded amount, or null.
 */
function ruleAmount(city, rule, loc, nbrs) {
  if (rule.RequiresActivation && !unlocked(city, rule.YieldChangeId)) return null;
  const yc = _ycById && _ycById.get(rule.YieldChangeId);
  if (!yc) return null;
  const wild = _wildById && _wildById.get(rule.YieldChangeId);
  const req = yc.TilesRequired > 0 ? yc.TilesRequired : 1;
  const amt = Math.floor(ruleCount(yc, loc, nbrs, wild) / req) * (yc.YieldChange || 0);
  return amt ? { yield: yc.YieldType, amount: amt } : null;
}

/**
 * A building's adjacency yields at a location, as yieldType → amount.
 * @param {*} city The city handle. @param {string} type The building ConstructibleType.
 * @param {*} loc The building's tile. @param {{x:number,y:number}[]} nbrs Precomputed neighbors.
 * @returns {Record<string, number>} yieldType → amount.
 */
function buildingAdjacency(city, type, loc, nbrs) {
  const out = /** @type {Record<string, number>} */ ({});
  const rules = _adjByType && _adjByType.get(type);
  if (!rules) return out;
  for (const rule of rules) {
    const r = ruleAmount(city, rule, loc, nbrs);
    if (r) out[r.yield] = (out[r.yield] || 0) + r.amount;
  }
  return out;
}

/**
 * The cumulative adjacency of a quarter (sum over its buildings), as named yields.
 * @param {*} city The city handle. @param {*} loc The quarter tile.
 * @param {string[]} buildingTypes The ConstructibleTypes on the tile.
 * @returns {{name:string, amount:number}[]} Named non-zero adjacency yields (most first).
 */
export function quarterAdjacency(city, loc, buildingTypes) {
  buildIndices();
  const nbrs = neighbors(loc);
  const total = /** @type {Record<string, number>} */ ({});
  for (const type of buildingTypes) {
    const per = buildingAdjacency(city, type, loc, nbrs);
    for (const y in per) total[y] = (total[y] || 0) + per[y];
  }
  const out = [];
  for (const y in total) {
    if (!total[y]) continue;
    const info = safe(() => G.GameInfo.Yields.lookup(y), null);
    out.push({ name: info ? safe(() => G.Locale.compose(info.Name), info.Name) : String(y), amount: total[y] });
  }
  out.sort((a, b) => b.amount - a.amount);
  return out;
}
