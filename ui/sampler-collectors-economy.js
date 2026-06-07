// sampler-collectors-economy.js
//
// Economy and progression collectors for per-civ sampling.

import {
  _readFiniteProp,
  dlog,
  netYield,
  safeCall
} from "/demographics/ui/sampler-collectors-core.js";
import { recordCity } from "/demographics/ui/sampler-war-events.js";

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
 * Resolve the current age type string, caching the result.
 * @returns {string | undefined} The age type (e.g. "AGE_ANTIQUITY").
 */
export function getCurrentAgeType() {
  if (typeof _cachedAgeType !== "undefined") return _cachedAgeType;
  try {
    if (
      typeof Game !== "undefined" &&
      Game.age !== undefined &&
      typeof GameInfo?.Ages?.lookup === "function"
    ) {
      const row = GameInfo.Ages.lookup(Game.age);
      if (row?.AgeType) {
        _cachedAgeType = row.AgeType;
        return _cachedAgeType;
      }
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
 * @param {import("/demographics/ui/sampler-collectors-core.js").PlayerCtx} ctx The context.
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
 * Resolve the player's cities, store settlement count + owned tiles, and
 * return the city list for downstream reuse.
 * @param {import("/demographics/ui/sampler-collectors-core.js").PlayerCtx} ctx The context.
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
  }
  return cityList;
}

/**
 * Capture the civ's home continent from capital (or first city).
 * @param {import("/demographics/ui/sampler-collectors-core.js").PlayerCtx} ctx The context.
 * @param {*} cityList The player's city list (from collectCities).
 */
export function collectContinent(ctx, cityList) {
  safeCall("collectContinent", () => {
    const cont = _capitalContinent(cityList);
    if (typeof cont === "number") ctx.continent = cont;
  });
}

/**
 * Count fully-unlocked tech + culture nodes and store them on `ctx`.
 * @param {import("/demographics/ui/sampler-collectors-core.js").PlayerCtx} ctx The context.
 * @param {Pid} id The player id.
 */
export function collectTechAndCivicCounts(ctx, id) {
  const techsN = countCompletedNodes(id, "Techs");
  if (typeof techsN === "number") ctx.techsCount = techsN;
  const civicsN = countCompletedNodes(id, "Culture");
  if (typeof civicsN === "number") ctx.civicsCount = civicsN;
}

/**
 * Read net yields + population/city/town counts off the Stats handle.
 * @param {import("/demographics/ui/sampler-collectors-core.js").PlayerCtx} ctx The context.
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
 * @param {import("/demographics/ui/sampler-collectors-core.js").PlayerCtx} ctx The context.
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
 * @param {import("/demographics/ui/sampler-collectors-core.js").PlayerCtx} ctx The context.
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
 * @param {import("/demographics/ui/sampler-collectors-core.js").PlayerCtx} ctx The context.
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
