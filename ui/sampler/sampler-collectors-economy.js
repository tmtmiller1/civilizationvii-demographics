// sampler-collectors-economy.js
//
// Economy and progression collectors for per-civ sampling.

import {
  _readFiniteProp,
  dlog,
  netYield,
  safeCall,
  safeNum
} from "/demographics/ui/sampler/sampler-collectors-core.js";
import { recordCity } from "/demographics/ui/sampler/sampler-war-events.js";
import { scaleCityPopulationAt } from "/demographics/ui/metrics/demographics-metrics-helpers.js";

/**
 * Resolve the `NODE_STATE_FULLY_UNLOCKED` enum value once.
 * @returns {*} The enum value, or undefined if unavailable.
 */
function _resolveFullyUnlockedState() {
  try {
    if (
      typeof ProgressionTreeNodeState !== "undefined" &&
      ProgressionTreeNodeState &&
      typeof ProgressionTreeNodeState.NODE_STATE_FULLY_UNLOCKED !== "undefined"
    ) {
      return ProgressionTreeNodeState.NODE_STATE_FULLY_UNLOCKED;
    }
  } catch (_) {
    // ProgressionTreeNodeState global can be absent / throw in the sandbox.
  }
  return undefined;
}

/**
 * Resolve a single tree node's state for `pid`.
 * @param {*} nodeType The node type/hash.
 * @param {Pid} pid The player id.
 * @returns {*} The engine node-state value, or undefined.
 */
function _nodeState(nodeType, pid) {
  if (
    typeof Game !== "undefined" &&
    Game.ProgressionTrees &&
    typeof Game.ProgressionTrees.getNodeState === "function"
  ) {
    return Game.ProgressionTrees.getNodeState(pid, nodeType);
  }
  return undefined;
}

/**
 * Fallback completion check used when the FULLY_UNLOCKED enum is unavailable.
 * @param {*} nodeType The node type/hash.
 * @param {Pid} pid The player id.
 * @returns {boolean} True if the node looks fully unlocked.
 */
function _nodeUnlockedByDepth(nodeType, pid) {
  const nd =
    typeof Game !== "undefined" &&
    Game.ProgressionTrees &&
    typeof Game.ProgressionTrees.getNode === "function"
      ? Game.ProgressionTrees.getNode(pid, nodeType)
      : undefined;
  return !!(nd && typeof nd.depthUnlocked === "number" && nd.depthUnlocked > 0);
}

/**
 * Decide whether a single tree node is fully unlocked for `pid`.
 * @param {*} node A tree node (object or raw type).
 * @param {Pid} pid The player id.
 * @param {*} fullyUnlocked The resolved FULLY_UNLOCKED enum, or undefined.
 * @returns {boolean} True if the node is fully unlocked for `pid`.
 */
function _nodeIsFullyUnlocked(node, pid, fullyUnlocked) {
  const nodeType = node?.nodeType ?? node?.type ?? node;
  if (nodeType === undefined) return false;
  if (fullyUnlocked !== undefined) {
    return _nodeState(nodeType, pid) === fullyUnlocked;
  }
  return _nodeUnlockedByDepth(nodeType, pid);
}

/**
 * Count nodes in a single tree object that are fully unlocked for `pid`.
 * @param {*} tree A tree object exposing a `nodes` array.
 * @param {Pid} pid The player id.
 * @param {string} treeKind "Techs" or "Culture" (for log attribution).
 * @returns {number} The count of fully-unlocked nodes (0 if none/unknown).
 */
function countNodesInTree(tree, pid, treeKind) {
  if (!tree || !Array.isArray(tree.nodes)) return 0;
  const fullyUnlocked = _resolveFullyUnlockedState();
  let count = 0;
  for (const node of tree.nodes) {
    try {
      if (_nodeIsFullyUnlocked(node, pid, fullyUnlocked)) count++;
    } catch (e) {
      dlog("node iter err in", treeKind, "for pid", pid, e);
    }
  }
  return count;
}

/** @type {string | undefined} */
let _cachedAgeType;

/**
 * Resolve the current age type from live engine globals.
 * @returns {string | undefined} The age type, or undefined.
 */
function lookupCurrentAgeType() {
  if (typeof Game === "undefined") return undefined;
  if (Game.age === undefined) return undefined;
  if (typeof GameInfo === "undefined") return undefined;
  if (typeof GameInfo?.Ages?.lookup !== "function") return undefined;
  const row = GameInfo.Ages.lookup(Game.age);
  if (!row?.AgeType) return undefined;
  return row.AgeType;
}
/**
 * Resolve the current age type string, caching the result.
 * @returns {string | undefined} The age type (e.g. "AGE_ANTIQUITY").
 */
export function getCurrentAgeType() {
  if (typeof _cachedAgeType !== "undefined") return _cachedAgeType;
  try {
    const ageType = lookupCurrentAgeType();
    if (ageType) {
      _cachedAgeType = ageType;
      return _cachedAgeType;
    }
  } catch (_) {
    // Game.age / GameInfo.Ages.lookup() can be absent / throw.
  }
  return undefined;
}

/** @type {Map<string, string[]>} */
const _treesBySystemAndAge = new Map();

/**
 * Clear the age + trees caches so {@link getCurrentAgeType} re-reads Game.age.
 */
export function resetAgeCaches() {
  _cachedAgeType = undefined;
  _treesBySystemAndAge.clear();
}

/**
 * Collect every `ProgressionTree` type matching `systemType` in the current
 * age, caching per (systemType, age).
 * @param {string} systemType e.g. "SYSTEM_TECH" or "SYSTEM_CULTURE".
 * @returns {string[]} The matching `ProgressionTreeType` strings.
 */
function getTreesForSystem(systemType) {
  const age = getCurrentAgeType();
  const cacheKey = systemType + "|" + (age || "ANY");
  const cached = _treesBySystemAndAge.get(cacheKey);
  if (cached) return cached;
  /** @type {string[]} */
  const list = [];
  try {
    if (
      typeof GameInfo?.ProgressionTrees !== "undefined" &&
      GameInfo.ProgressionTrees[Symbol.iterator]
    ) {
      for (const row of GameInfo.ProgressionTrees) {
        if (_treeRowMatches(row, systemType, age)) list.push(row.ProgressionTreeType);
      }
    }
  } catch (_) {
    // Iterating GameInfo.ProgressionTrees can throw if the table is absent.
  }
  _treesBySystemAndAge.set(cacheKey, list);
  return list;
}

/**
 * Whether a ProgressionTrees row matches the requested system + current age.
 * @param {*} row A GameInfo.ProgressionTrees row.
 * @param {string} systemType e.g. "SYSTEM_TECH".
 * @param {string | undefined} age The current age type (or undefined for any).
 * @returns {boolean} True if the row should be collected.
 */
function _treeRowMatches(row, systemType, age) {
  if (!row) return false;
  if (row.SystemType !== systemType) return false;
  if (age && row.AgeType && row.AgeType !== age) return false;
  return true;
}

/**
 * Count fully-unlocked nodes for a player across all trees of a branch.
 * @param {Pid} pid The player id.
 * @param {string} treeKind "Techs" or "Culture".
 * @returns {number | undefined} Total count, or undefined if no tree found.
 */
function countCompletedNodes(pid, treeKind) {
  const systemType = treeKind === "Culture" ? "SYSTEM_CULTURE" : "SYSTEM_TECH";
  const treeTypes = getTreesForSystem(systemType);
  if (treeTypes.length === 0) return undefined;

  let total = 0;
  let anyTreeFound = false;
  for (const treeType of treeTypes) {
    const tree = safeCall("getTree(" + pid + "," + treeKind + ":" + treeType + ")", () => {
      if (
        typeof Game === "undefined" ||
        !Game.ProgressionTrees ||
        typeof Game.ProgressionTrees.getTree !== "function"
      ) {
        return undefined;
      }
      return Game.ProgressionTrees.getTree(pid, treeType);
    });
    if (!tree || !Array.isArray(tree.nodes)) continue;
    anyTreeFound = true;
    total += countNodesInTree(tree, pid, treeKind);
  }
  return anyTreeFound ? total : undefined;
}

/**
 * Sum total owned tiles across a player's cities/towns.
 * @param {*} cityList The array (or array-like) of city handles.
 * @param {Pid} pid The player id (for log attribution).
 * @returns {number | undefined} Total tiles, or undefined if none readable.
 */
function sumOwnedTiles(cityList, pid) {
  if (!Array.isArray(cityList)) return undefined;
  let total = 0;
  let anyOK = false;
  for (const c of cityList) {
    try {
      const n = _cityPlotCount(c);
      if (n !== undefined) {
        total += n;
        anyOK = true;
      }
    } catch (e) {
      dlog("getPurchasedPlots err pid=", pid, e);
    }
  }
  return anyOK ? total : undefined;
}

/**
 * Whether a city handle is the player's capital (defensively).
 * @param {*} c A city handle.
 * @returns {boolean} True for the capital.
 */
function _isCapital(c) {
  try {
    return !!c && c.isCapital === true;
  } catch (_) {
    return false;
  }
}

/**
 * The continent type under a player's capital (or first city), or undefined.
 * @param {*} cityList The player's city list.
 * @returns {number | undefined} The continent type, or undefined.
 */
function _capitalContinent(cityList) {
  const loc = _capitalLoc(cityList);
  if (!loc) return undefined;
  if (
    typeof GameplayMap === "undefined" ||
    typeof GameplayMap.getContinentType !== "function"
  ) {
    return undefined;
  }
  const cont = GameplayMap.getContinentType(loc.x, loc.y);
  return typeof cont === "number" ? cont : undefined;
}

/**
 * The capital's (or first city's) plot location, or null when unreadable.
 * @param {*} cityList The player's city list.
 * @returns {{ x: number, y: number } | null} The location, or null.
 */
function _capitalLoc(cityList) {
  if (!Array.isArray(cityList) || !cityList.length) return null;
  const cap = cityList.find((c) => _isCapital(c)) || cityList[0];
  const loc = cap?.location;
  if (!loc || typeof loc.x !== "number" || typeof loc.y !== "number") return null;
  return loc;
}

/**
 * Count purchased plots for one city.
 * @param {*} c A city handle.
 * @returns {number | undefined} The plot count, or undefined if unreadable.
 */
function _cityPlotCount(c) {
  if (!c || typeof c.getPurchasedPlots !== "function") return undefined;
  const plots = c.getPurchasedPlots();
  if (Array.isArray(plots)) return plots.length;
  if (plots && typeof plots.length === "number") return plots.length;
  return undefined;
}

/**
 * Read the gold balance off the player's Treasury handle.
 * @param {import("/demographics/ui/sampler/sampler-collectors-core.js").PlayerCtx} ctx The context.
 * @param {Pid} id The player id.
 * @param {*} p The sampled player handle.
 */
export function collectGold(ctx, id, p) {
  const treasury = safeCall("p.Treasury (pid=" + id + ")", () => p.Treasury);
  if (treasury) {
    const g = safeCall("treasury.getGoldBalance() (pid=" + id + ")", () => {
      if (typeof treasury.getGoldBalance === "function") return treasury.getGoldBalance();
      if (typeof treasury.goldBalance === "number") return treasury.goldBalance;
      return undefined;
    });
    if (typeof g === "number" && isFinite(g)) ctx.gold = g;
  }
}

/**
 * Read the count of slotted great works off the player's Stats handle.
 * citation: player.Stats.getTotalGreatWorksSlotted() (base-standard).
 * @param {import("/demographics/ui/sampler/sampler-collectors-core.js").PlayerCtx} ctx The context.
 * @param {Pid} id The player id.
 * @param {*} stats The player Stats handle.
 */
export function collectGreatWorks(ctx, id, stats) {
  if (stats && typeof stats.getTotalGreatWorksSlotted === "function") {
    const gw = safeCall(
      "stats.getTotalGreatWorksSlotted() (pid=" + id + ")",
      () => safeNum(stats.getTotalGreatWorksSlotted())
    );
    if (typeof gw === "number") ctx.greatWorks = gw;
  }
}

/**
 * Read the cumulative count of settlements taken by force off the Stats handle.
 * citation: player.Stats.getNumConqueredSettlements(...) (base-standard).
 * @param {import("/demographics/ui/sampler/sampler-collectors-core.js").PlayerCtx} ctx The context.
 * @param {Pid} id The player id.
 * @param {*} stats The player Stats handle.
 */
export function collectConquered(ctx, id, stats) {
  if (stats && typeof stats.getNumConqueredSettlements === "function") {
    const n = safeCall(
      "stats.getNumConqueredSettlements() (pid=" + id + ")",
      () => safeNum(stats.getNumConqueredSettlements(true, true, true, false))
    );
    if (typeof n === "number") ctx.conqueredCum = n;
  }
}

/**
 * Resolve the player's cities, store settlement count + owned tiles, and
 * return the city list for downstream reuse.
 * @param {import("/demographics/ui/sampler/sampler-collectors-core.js").PlayerCtx} ctx The context.
 * @param {Pid} id The player id.
 * @param {*} p The sampled player handle.
 * @returns {*} The city list (array/array-like), or undefined.
 */
export function collectCities(ctx, id, p) {
  const cities = safeCall("p.Cities (pid=" + id + ")", () => p.Cities);
  let cityList = undefined;
  if (cities) {
    cityList = safeCall("cities.getCities() (pid=" + id + ")", () => {
      if (typeof cities.getCities === "function") return cities.getCities();
      return undefined;
    });
    if (Array.isArray(cityList)) ctx.settlementsCount = cityList.length;
    else if (cityList && typeof cityList.length === "number") {
      ctx.settlementsCount = cityList.length;
    }

    const tiles = sumOwnedTiles(cityList, id);
    if (typeof tiles === "number") ctx.tilesOwned = tiles;

    if (Array.isArray(cityList)) {
      for (const c of cityList) recordCity(c, id);
    }

    collectScaledPopulation(ctx, cityList);
  }
  return cityList;
}

/**
 * Read a settlement's size (raw population points) defensively: `population`, else urban+rural.
 * @param {*} c City handle.
 * @returns {number} The size (0 when unreadable).
 */
function readCitySize(c) {
  try {
    if (typeof c?.population === "number" && isFinite(c.population)) return c.population;
    const u = typeof c?.urbanPopulation === "number" ? c.urbanPopulation : 0;
    const r = typeof c?.ruralPopulation === "number" ? c.ruralPopulation : 0;
    return u + r;
  } catch (_) {
    return 0;
  }
}

/**
 * Read current age-progress percent [0,100] from the AgeProgressManager (undefined when unavailable).
 * @returns {number | undefined} Progress percent, or undefined.
 */
function readAgeProgressPct() {
  try {
    const apm = typeof Game !== "undefined" ? Game.AgeProgressManager : null;
    if (!apm || typeof apm.getCurrentAgeProgressionPoints !== "function") return undefined;
    const cur = apm.getCurrentAgeProgressionPoints();
    const max = apm.getMaxAgeProgressionPoints();
    if (typeof cur === "number" && typeof max === "number" && max > 0) return (cur / max) * 100;
  } catch (_) {
    // APM can be absent / throw mid-transition.
  }
  return undefined;
}

/**
 * Compute the civ's scaled people total as the SUM of its settlements' per-city estimates (the same
 * growth-formula curve the Settlements board uses), and stash the age context for the metric layer.
 * Summing per-settlement — never scaling the aggregate — is required because the curve is super-linear.
 * @param {import("/demographics/ui/sampler/sampler-collectors-core.js").PlayerCtx} ctx The context.
 * @param {*} cityList The player's city list.
 */
function collectScaledPopulation(ctx, cityList) {
  if (!Array.isArray(cityList)) return;
  const ageType = getCurrentAgeType();
  const ageProgressPct = readAgeProgressPct();
  ctx.ageType = ageType;
  ctx.ageProgressPct = ageProgressPct;
  let sum = 0;
  for (const c of cityList) {
    sum += scaleCityPopulationAt(readCitySize(c), undefined, ageType, ageProgressPct);
  }
  ctx.populationScaled = sum;
}

/**
 * Capture the civ's home continent from capital (or first city).
 * @param {import("/demographics/ui/sampler/sampler-collectors-core.js").PlayerCtx} ctx The context.
 * @param {*} cityList The player's city list (from collectCities).
 */
export function collectContinent(ctx, cityList) {
  safeCall("collectContinent", () => {
    const cont = _capitalContinent(cityList);
    if (typeof cont === "number") ctx.continent = cont;
  });
}

// Per-pid cumulative tech/civic baseline for the CURRENT sample: the sum of
// completed nodes from all PRIOR ages. Each Civ7 age has its own fresh tech /
// culture tree, so the live engine count (current-age trees only) restarts at 0
// every age. Adding this baseline keeps Techs/Civics - and the score fallback
// that reads them - continuous across age boundaries. Set once per sample by
// the sampler (see computeNodeBaselines); read here per pid.
/** @type {Record<string, { techs: number, civics: number }> | null} */
let _nodeBaselineByPid = null;

/**
 * Set the per-pid cumulative tech/civic baseline for the current sample.
 * @param {Record<string, { techs: number, civics: number }> | null} map Baseline
 *   map keyed by pid, or null to clear (treated as all-zero).
 */
export function setNodeBaselineByPid(map) {
  _nodeBaselineByPid = map && typeof map === "object" ? map : null;
}

/**
 * Resolve one pid's cumulative tech/civic baseline, defaulting to zeros.
 * @param {Pid} id The player id.
 * @returns {{ techs: number, civics: number }} Prior-age completed-node totals.
 */
function nodeBaselineFor(id) {
  const m = _nodeBaselineByPid;
  const b = m ? m[String(id)] || m[/** @type {*} */ (id)] : undefined;
  return {
    techs: b && typeof b.techs === "number" ? b.techs : 0,
    civics: b && typeof b.civics === "number" ? b.civics : 0
  };
}

/**
 * Compute each pid's cumulative tech/civic baseline from history: the highest
 * stored techsCount/civicsCount across all samples from EARLIER ages (any age
 * other than the one being sampled now). Stored counts are themselves
 * cumulative and only grow within an age, so taking the max is robust to
 * old-sample decimation. Untagged (age-less) legacy samples are ignored so they
 * can never be mistaken for a prior age relative to the first (Antiquity) age.
 * @param {*} samples The persisted sample stream (array; tolerates undefined).
 * @param {string | undefined} currentAge The age being sampled now.
 * @returns {Record<string, { techs: number, civics: number }>} Per-pid baseline.
 */
export function computeNodeBaselines(samples, currentAge) {
  /** @type {Record<string, { techs: number, civics: number }>} */
  const out = {};
  if (!Array.isArray(samples) || typeof currentAge !== "string") return out;
  for (const s of samples) foldNodeBaselineSample(out, s, currentAge);
  return out;
}

/**
 * Fold one prior-age sample's per-pid tech/civic counts into the running max
 * baseline. No-ops for the current age, untagged, or player-less samples.
 * @param {Record<string, { techs: number, civics: number }>} out Baseline map (mutated).
 * @param {*} s One persisted sample.
 * @param {string} currentAge The age being sampled now.
 */
function foldNodeBaselineSample(out, s, currentAge) {
  if (!s || typeof s.age !== "string" || s.age === currentAge || !s.players) return;
  for (const pid of Object.keys(s.players)) {
    const m = s.players[pid] && s.players[pid].metrics;
    if (m) bumpBaselineMax(out[pid] || (out[pid] = { techs: 0, civics: 0 }), m);
  }
}

/**
 * Raise a pid's running tech/civic baseline to the max seen so far. Reads the
 * STORED metric keys (`metrics.techs` / `metrics.civics` - the metric ids set by
 * computeMetrics), NOT the `*Count` ctx field names; those stored values are
 * themselves already cumulative under this scheme.
 * @param {{ techs: number, civics: number }} cur The pid's baseline (mutated).
 * @param {*} m One sample's metric map for that pid.
 */
function bumpBaselineMax(cur, m) {
  if (typeof m.techs === "number" && m.techs > cur.techs) cur.techs = m.techs;
  if (typeof m.civics === "number" && m.civics > cur.civics) cur.civics = m.civics;
}

/**
 * Count fully-unlocked tech + culture nodes and store them on `ctx`, made
 * cumulative across ages by adding the prior-age baseline (see
 * {@link computeNodeBaselines}). When the current age's tree handle isn't ready
 * yet (e.g. turn 1 of a new age), the count holds at the baseline rather than
 * dipping back toward zero.
 * @param {import("/demographics/ui/sampler/sampler-collectors-core.js").PlayerCtx} ctx The context.
 * @param {Pid} id The player id.
 */
export function collectTechAndCivicCounts(ctx, id) {
  const base = nodeBaselineFor(id);
  const techsN = countCompletedNodes(id, "Techs");
  if (typeof techsN === "number") ctx.techsCount = techsN + base.techs;
  else if (base.techs > 0) ctx.techsCount = base.techs;
  const civicsN = countCompletedNodes(id, "Culture");
  if (typeof civicsN === "number") ctx.civicsCount = civicsN + base.civics;
  else if (base.civics > 0) ctx.civicsCount = base.civics;
}

/**
 * Read net yields + population/city/town counts off the Stats handle.
 * @param {import("/demographics/ui/sampler/sampler-collectors-core.js").PlayerCtx} ctx The context.
 * @param {Pid} id The player id.
 * @param {*} stats The player Stats handle.
 */
export function collectYieldsAndSizes(ctx, id, stats) {
  if (!stats) return;
  ctx.yieldGold = netYield(stats, "YIELD_GOLD", id);
  ctx.yieldScience = netYield(stats, "YIELD_SCIENCE", id);
  ctx.yieldCulture = netYield(stats, "YIELD_CULTURE", id);
  ctx.yieldHappiness = netYield(stats, "YIELD_HAPPINESS", id);
  ctx.yieldProduction = netYield(stats, "YIELD_PRODUCTION", id);
  ctx.yieldFood = netYield(stats, "YIELD_FOOD", id);
  ctx.yieldDiplomacy = netYield(stats, "YIELD_DIPLOMACY", id);

  const tp = _readFiniteProp(stats, "totalPopulation");
  if (tp !== undefined) ctx.totalPopulation = tp;
  const nc = _readFiniteProp(stats, "numCities");
  if (nc !== undefined) ctx.citiesCount = nc;
  const nt = _readFiniteProp(stats, "numTowns");
  if (nt !== undefined) ctx.townsCount = nt;
}

/**
 * Read the player-level trade-route count off the Trade handle.
 * @param {import("/demographics/ui/sampler/sampler-collectors-core.js").PlayerCtx} ctx The context.
 * @param {Pid} id The player id.
 * @param {*} p The sampled player handle.
 */
export function collectTradeRoutes(ctx, id, p) {
  const trade = safeCall("p.Trade (pid=" + id + ")", () => p.Trade);
  if (trade) {
    const tr = safeCall("trade.countPlayerTradeRoutes() (pid=" + id + ")", () => {
      if (typeof trade.countPlayerTradeRoutes === "function") {
        return trade.countPlayerTradeRoutes();
      }
      return undefined;
    });
    if (typeof tr === "number" && isFinite(tr)) ctx.tradeRoutesCount = tr;
  }
}

/**
 * Count ongoing diplomatic actions involving this player.
 * @param {import("/demographics/ui/sampler/sampler-collectors-core.js").PlayerCtx} ctx The context.
 * @param {Pid} id The player id.
 */
export function collectOngoingDeals(ctx, id) {
  const events = safeCall("Game.Diplomacy.getPlayerEvents(" + id + ")", () => {
    if (typeof Game === "undefined" || !Game.Diplomacy) return undefined;
    if (typeof Game.Diplomacy.getPlayerEvents !== "function") return undefined;
    const arr = Game.Diplomacy.getPlayerEvents(id);
    return Array.isArray(arr) ? arr : undefined;
  });
  if (Array.isArray(events)) ctx.ongoingDealsCount = events.length;
}

/**
 * Capture the settlement cap + settlements-used.
 * @param {import("/demographics/ui/sampler/sampler-collectors-core.js").PlayerCtx} ctx The context.
 * @param {*} stats The player Stats handle.
 */
export function collectSettlementCap(ctx, stats) {
  safeCall("settlementCap", () => {
    if (!stats) return;
    const cap = stats.settlementCap;
    if (typeof cap === "number" && isFinite(cap)) ctx.settlementCap = cap;
    const n = stats.numSettlements;
    if (typeof n === "number" && isFinite(n)) ctx.numSettlements = n;
  });
}
