// sampler-collectors.js
//
// Per-civ metric collector helpers extracted from demographics-sampler.js.
// Each `collect*` helper reads one safe slice of a player's state into the
// shared per-civ context object and is hard-defensive: every accessor is both
// try/catch-wrapped and typeof-checked. The kill-switch-aware `safeCall` /
// player-resolution helpers live in the sampler core and are imported here so
// the kill-switch state stays single-owner.
//
// Accessor crib sheet (all under Resources/Base/modules):
//   Stats.getNetYield(YieldTypes.YIELD_*)         - diplo-ribbon/model-diplo-ribbon.js
//   Stats.numSettlements / settlementCap          - same file
//   Stats.numCities / numTowns / totalPopulation  - same file
//   Treasury.getGoldBalance() / goldBalance       - advice/advice-support.js
//   Cities.getCities()                            - pre-existing
//   city.getPurchasedPlots()                      - city-zoomer/city-zoomer.js
//   Trade.countPlayerTradeRoutes()                - age-antiquity tutorial
//   Game.Diplomacy.getPlayerEvents(playerId)      - diplomacy-actions panel
//   player.Stats.getNumWonders(orig, currentAge)  - advice/advice-support.js
//   player.Units.getUnitIds() + Units.get(id)     - age-antiquity tutorial
//   GameInfo.Unit_Stats[].Combat joined on UnitType
//                                                  - civilopedia-sidebar-panels.js
//   FormationClass classifier (LAND_COMBAT / NAVAL / AIR → military)
//                                                  - interface-mode-unit-selected.js
//   Techs.getTreeType() + Game.ProgressionTrees.getTree(pid, treeType).nodes
//                                                  - tutorial/tutorial-support.js
//   Culture: analogous via player.Culture.getTreeType()
//   ProgressionTreeNodeState.NODE_STATE_FULLY_UNLOCKED = "researched"
//                                                  - tree-grid/tree-grid.js

import {
  safeCall,
  safeNum,
  getLocalPlayerID,
  getPlayer
} from "/demographics/ui/demographics-sampler.js";
import { recordUnitStrength, recordCity } from "/demographics/ui/sampler-war-events.js";

/**
 * The per-civ context object assembled by {@link buildPlayerCtx}. Engine-
 * sourced handles (`player`, `stats`) stay loose; the mod's own numeric and
 * string fields are typed. Extends {@link CivSample} so it can flow into the
 * snapshot pipeline.
 * @typedef {object} PlayerCtx
 * @property {Pid} id Player id this context describes.
 * @property {*} [player] Live player library handle, or undefined.
 * @property {*} [leaderType] Raw leader type (numeric hash or "LEADER_*").
 * @property {*} [civType] Raw civilization type (numeric hash or string).
 * @property {*} [stats] Player Stats handle, or undefined.
 * @property {boolean} [met] Whether the local player has met this player.
 * @property {string} [leaderName] Resolved, localized leader display name.
 * @property {string} [civName] Resolved, localized civ display name.
 * @property {string} [leaderTypeString] Canonical "LEADER_*" string.
 * @property {string} [civTypeString] Canonical "CIVILIZATION_*" string.
 * @property {string} [primaryColor] Player banner primary color string.
 * @property {string} [secondaryColor] Player banner secondary color string.
 * @property {number} [gold] Gold balance.
 * @property {number} [settlementsCount] Count of settlements (cities + towns).
 * @property {number} [techsCount] Fully-unlocked tech nodes.
 * @property {number} [civicsCount] Fully-unlocked culture nodes.
 * @property {number} [yieldGold] Net gold yield.
 * @property {number} [yieldScience] Net science yield.
 * @property {number} [yieldCulture] Net culture yield.
 * @property {number} [yieldHappiness] Net happiness yield.
 * @property {number} [yieldProduction] Net production yield.
 * @property {number} [yieldFood] Net food yield.
 * @property {number} [yieldDiplomacy] Net diplomacy (influence) yield.
 * @property {number} [totalPopulation] Total population.
 * @property {number} [citiesCount] Number of cities.
 * @property {number} [townsCount] Number of towns.
 * @property {number} [tilesOwned] Total owned tiles across cities.
 * @property {number} [continent] Home-continent type (capital's landmass).
 * @property {number} [tradeRoutesCount] Player-wide trade-route count.
 * @property {number} [ongoingDealsCount] Ongoing diplomatic action count.
 * @property {number} [wondersCount] Completed wonder count.
 * @property {string[]} [wonderTypes] ConstructibleType strings of wonders.
 * @property {number} [militaryPower] Summed military unit strength.
 * @property {number} [settlementCap] Settlement cap.
 * @property {number} [numSettlements] Settlements used against the cap.
 * @property {number} [triumphsCultural] Triggered cultural triumphs.
 * @property {number} [triumphsDiplomatic] Triggered diplomatic triumphs.
 * @property {number} [triumphsEconomic] Triggered economic triumphs.
 * @property {number} [triumphsScientific] Triggered scientific triumphs.
 * @property {number} [triumphsMilitaristic] Triggered militaristic triumphs.
 * @property {number} [triumphsExpansionist] Triggered expansionist triumphs.
 * @property {number} [triumphsInProgress] In-progress (untriggered) triumphs.
 * @property {Record<string, any>} [legacyDiag] Leftover legacy-path probes.
 * @property {number} [victoryPointsCulture] Modern culture victory points.
 * @property {number} [victoryPointsEconomic] Modern economic (GDP) points.
 * @property {number} [victoryPointsMilitary] Modern military victory points.
 * @property {number} [victoryPointsScience] Modern science victory points.
 * @property {number} [diplomaticApproval] Weighted total reputation score.
 * @property {number} [diplomaticApprovalMajor] Major-civ reputation portion.
 * @property {number} [diplomaticApprovalCS] City-state reputation portion.
 * @property {number} [resourcesBonus] Bonus-class resource count.
 * @property {number} [resourcesEmpire] Empire-class resource count.
 * @property {number} [resourcesCity] City-class resource count.
 * @property {number} [resourcesFactory] Factory-class resource count.
 * @property {number} [resourcesTreasure] Treasure-class resource count.
 * @property {number} [resourcesTotal] Total resource count across classes.
 * @property {number} [ageProgressPct] Game-wide age progress percent (stamped).
 * @property {number} [crisisStage] Game-wide crisis stage (stamped).
 * @property {number} [crisisStageMax] Game-wide crisis stage max (stamped).
 */

const DBG = false;
/**
 * Debug logger, no-op unless {@link DBG} is set.
 * @param {...*} a Values to log.
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.sampler]", ...a);
}

// ---- numeric helpers -----------------------------------------------------

// Resolve a YieldTypes.YIELD_* enum value defensively. Returns undefined if
// either the global isn't there or the specific key isn't defined.
/**
 * Resolve a `YieldTypes.YIELD_*` enum value defensively.
 * @param {string} key The enum key, e.g. "YIELD_GOLD".
 * @returns {number | string | undefined} The enum value, or undefined.
 */
function yieldEnum(key) {
  try {
    if (typeof YieldTypes !== "undefined" && YieldTypes != null) {
      const v = YieldTypes[key];
      if (typeof v === "number" || typeof v === "string") return v;
    }
  } catch (_e) {
    // YieldTypes[key] access can throw if the enum global is absent; treat the
    // yield as unavailable.
  }
  return undefined;
}

/**
 * Read a single net yield off a Stats handle.
 * @param {*} stats The player Stats handle.
 * @param {string} key The `YIELD_*` enum key.
 * @param {Pid} pid The player id (for log attribution).
 * @returns {number | undefined} The finite yield value, or undefined.
 */
function netYield(stats, key, pid) {
  if (!stats || typeof stats.getNetYield !== "function") return undefined;
  const yt = yieldEnum(key);
  if (yt === undefined) return undefined;
  return safeCall("stats.getNetYield(" + key + ") (pid=" + pid + ")", () => {
    const v = stats.getNetYield(yt);
    return safeNum(v);
  });
}

// Count progression-tree nodes that are FULLY UNLOCKED for a player on a
// specific tree object branch (treeKind === "Techs" or "Culture").
// Returns undefined on any error; 0 is a valid result.
// Resolve the FULLY_UNLOCKED enum once at module level.
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
    // ProgressionTreeNodeState global can be absent / throw in the sandbox; fall
    // back to the depth-unlocked heuristic.
  }
  return undefined;
}

/**
 * Resolve a single tree node's state for `pid`, preferring the engine's
 * node-state API. Returns the raw state value, or undefined.
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
 * Fallback completion check used when the FULLY_UNLOCKED enum is unavailable:
 * a node counts as complete if its `depthUnlocked` is a positive number.
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
 * Decide whether a single tree node is fully unlocked for `pid`, using the
 * FULLY_UNLOCKED state when available, else the depth-unlocked fallback.
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

// Count nodes in a single tree object whose state === FULLY_UNLOCKED for pid.
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
      if (DBG) dlog("node iter err in", treeKind, "for pid", pid, e);
    }
  }
  return count;
}

// Returns the current age type string (e.g. "AGE_ANTIQUITY") or undefined.
// Cached at module level per turn-load to avoid repeated lookups.
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
    // Game.age / GameInfo.Ages.lookup() can be absent / throw before the game
    // is fully loaded; report the age as unknown.
  }
  return undefined;
}

// Collect every ProgressionTree row matching {SystemType, current age}.
// Cached per (systemType, age). Civ7 grants each civ access to the
// MAIN tree + their civ-unique tree (and sometimes more). We try each one;
// trees the player doesn't have access to return null from getTree.
/** @type {Map<string, string[]>} */
const _treesBySystemAndAge = new Map();

/**
 * Clear the age + trees caches so {@link getCurrentAgeType} re-reads Game.age.
 * Called by the sampler core on a PlayerAgeTransitionComplete event.
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
    // Iterating GameInfo.ProgressionTrees can throw if the table is absent;
    // cache whatever was collected (possibly empty).
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

// Count progression-tree nodes that are FULLY UNLOCKED for a player across
// ALL relevant trees for the given branch.
//   treeKind === "Techs"   → all SYSTEM_TECH trees of the current age
//   treeKind === "Culture" → all SYSTEM_CULTURE trees of the current age
// (Civ7 gives each civ access to mainline + civ-unique tree; we sum both.)
// ProgressionTree.SystemType cited from
//   age-antiquity/data/progression-trees-culture-tot-common.xml
//   age-antiquity/data/progression-trees-culture-unique.xml+
/**
 * Count fully-unlocked nodes for a player across all trees of a branch.
 * @param {*} player The player handle (currently unused; kept for parity).
 * @param {Pid} pid The player id.
 * @param {string} treeKind "Techs" or "Culture".
 * @returns {number | undefined} Total count, or undefined if no tree found.
 */
function countCompletedNodes(player, pid, treeKind) {
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
      )
        return undefined;
      return Game.ProgressionTrees.getTree(pid, treeType);
    });
    if (!tree || !Array.isArray(tree.nodes)) continue;
    anyTreeFound = true;
    total += countNodesInTree(tree, pid, treeKind);
  }
  return anyTreeFound ? total : undefined;
}

// Sum total tiles owned across all of a player's cities/towns.
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
      if (DBG) dlog("getPurchasedPlots err pid=", pid, e);
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
 * Capture the civ's home continent: the continent type under its capital (or
 * first city). Used by the war-naming logic to decide world vs regional flavor.
 * Defensive - leaves ctx.continent undefined when the map API is unavailable.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {*} cityList The player's city list (from collectCities).
 */
function collectContinent(ctx, cityList) {
  safeCall("collectContinent", () => {
    const cont = _capitalContinent(cityList);
    if (typeof cont === "number") ctx.continent = cont;
  });
}

/**
 * The continent type under a player's capital (or first city), or undefined when
 * unavailable.
 * @param {*} cityList The player's city list.
 * @returns {number | undefined} The continent type, or undefined.
 */
function _capitalContinent(cityList) {
  const loc = _capitalLoc(cityList);
  if (!loc) return undefined;
  if (typeof GameplayMap === "undefined" || typeof GameplayMap.getContinentType !== "function") {
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
 * Count purchased plots for one city, accepting either an array or an
 * array-like return from `getPurchasedPlots`.
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

// ---- buildPlayerCtx collector helpers ------------------------------------

/**
 * Capture whether the LOCAL player has met `id` at sample time. The local
 * player is always met. Read from the local player's `Diplomacy.hasMet`
 * (sloth global-relations-panel.js).
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {Pid} id The player id being sampled.
 * @param {*} p The sampled player handle.
 */
function collectMet(ctx, id, p) {
  try {
    const localId = getLocalPlayerID();
    if (typeof localId === "number") {
      if (id === localId) {
        ctx.met = true;
      } else {
        const localP = id === localId ? p : getPlayer(localId);
        const d = localP?.Diplomacy;
        if (d && typeof d.hasMet === "function") {
          try {
            ctx.met = !!d.hasMet(id);
          } catch (_) {
            ctx.met = undefined;
          }
        }
      }
    }
  } catch (_) {
    // getLocalPlayerID() / getPlayer().Diplomacy can be null / throw mid
    // age-transition; leave ctx.met undefined.
  }
}

/**
 * Read the RAW leaderType / civilizationType off the player handle (numeric
 * hash on most builds; sometimes a "LEADER_*"/"CIVILIZATION_*" string) and
 * store them on `ctx`.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {*} p The sampled player handle.
 * @returns {{ rawLeader: *, rawCiv: * }} The raw values for downstream lookup.
 */
function collectRawTypes(ctx, p) {
  let rawLeader = undefined;
  let rawCiv = undefined;
  try {
    rawLeader = p.leaderType ?? p.LeaderType;
    if (rawLeader !== undefined && rawLeader !== null) ctx.leaderType = rawLeader;
  } catch (_e) {
    // p.leaderType property access can throw on a stale player handle; leave the
    // raw leader type undefined.
  }
  try {
    rawCiv = p.civilizationType ?? p.CivilizationType;
    if (rawCiv !== undefined && rawCiv !== null) ctx.civType = rawCiv;
  } catch (_e) {
    // p.civilizationType property access can throw on a stale player handle;
    // leave the raw civ type undefined.
  }
  return { rawLeader, rawCiv };
}

/**
 * Localize a tag via Locale.compose, defensively. Returns a non-empty composed
 * string, or undefined if composing failed or yielded an empty string.
 * @param {*} tag The LOC tag (or any value) to compose.
 * @returns {string | undefined} The composed string, or undefined.
 */
function _composeLocale(tag) {
  if (typeof Locale === "undefined" || typeof Locale.compose !== "function") return undefined;
  try {
    const s = Locale.compose(tag);
    if (typeof s === "string" && s.length > 0) return s;
  } catch (_) {
    // Locale.compose() can throw on a malformed tag; report the tag as
    // uncomposable.
  }
  return undefined;
}

/**
 * Try the table's `lookup()` with the raw value, then its string form.
 * @param {*} table A GameInfo table.
 * @param {*} raw The raw type value (hash or string).
 * @returns {*} The matching row, or null.
 */
function _lookupRowDirect(table, raw) {
  if (typeof table.lookup !== "function" || raw === undefined || raw === null) return null;
  const direct = table.lookup(raw);
  if (direct) return direct;
  const asStr = String(raw);
  if (asStr !== "") {
    const byStr = table.lookup(asStr);
    if (byStr) return byStr;
  }
  return null;
}

/**
 * Iterate a GameInfo table for a row matching `$hash`/`Hash`/`typeField`.
 * @param {*} table A GameInfo table.
 * @param {*} raw The raw type value (hash or string).
 * @param {string} typeField The row's type field name.
 * @returns {*} The matching row, or null.
 */
function _lookupRowByIteration(table, raw, typeField) {
  if (!table || typeof table[Symbol.iterator] !== "function") return null;
  for (const row of table) {
    if (!row) continue;
    // Vanilla uses `$hash` on GameInfo rows; see city-banners.js.
    if (row.$hash === raw || row.Hash === raw) return row;
    if (typeof raw === "string" && row[typeField] === raw) return row;
  }
  return null;
}

/**
 * Look up a GameInfo row by hash/type, trying `lookup()` (numeric then string
 * form) and finally a full-table iteration on `$hash`/`Hash`/`*Type`.
 * @param {*} table A GameInfo table (e.g. GameInfo.Leaders).
 * @param {*} raw The raw type value (hash or string).
 * @param {string} typeField The row's type field name (e.g. "LeaderType").
 * @returns {*} The matching row, or null.
 */
function lookupInfoRow(table, raw, typeField) {
  try {
    if (typeof GameInfo === "undefined" || !table) return null;
    return _lookupRowDirect(table, raw) || _lookupRowByIteration(table, raw, typeField);
  } catch (_) {
    // table.lookup() / table iteration can throw if GameInfo isn't ready; treat
    // the row as not found.
  }
  return null;
}

/**
 * Localize a GameInfo row's Name (via Locale.compose), else prettify the
 * row's type string, else return the supplied fallback.
 * @param {*} row A GameInfo row (or null).
 * @param {string} typeField The row's type field name.
 * @param {*} raw The raw type value (string form is used as a fallback).
 * @param {string} prefix Type-string prefix to strip (e.g. "LEADER_").
 * @param {string} fallback Final fallback display string.
 * @returns {string} The resolved display name.
 */
function resolveDisplayName(row, typeField, raw, prefix, fallback) {
  try {
    const nm = row?.Name;
    if (nm) return _composeLocale(nm) || String(nm);
  } catch (_) {
    // row.Name access can throw on a proxy GameInfo row; fall through to the
    // type-string prettifier.
  }
  const typeStr = row?.[typeField] || (typeof raw === "string" ? raw : "");
  if (typeStr) return _prettifyType(typeStr, prefix);
  return fallback;
}

/**
 * Turn a "PREFIX_FOO_BAR" type string into a Title-Cased display name.
 * @param {string} typeStr The type string.
 * @param {string} prefix The prefix to strip (e.g. "LEADER_").
 * @returns {string} The prettified display name.
 */
function _prettifyType(typeStr, prefix) {
  return String(typeStr)
    .replace(new RegExp("^" + prefix), "")
    .split("_")
    .map((w) => (w[0] ? w[0].toUpperCase() : "") + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Resolve the civilization display name, preferring the DIRECT
 * `player.civilizationName` accessor (tutorial-items-antiquity.js) which
 * works for numeric-hash civTypes, then `civilizationFullName`, then the
 * iterated GameInfo row.
 * @param {*} p The sampled player handle.
 * @param {*} civRow The GameInfo.Civilizations row (or null).
 * @param {*} rawCiv The raw civ type value.
 * @returns {string} The resolved civ display name (may be "").
 */
function resolveCivName(p, civRow, rawCiv) {
  try {
    const direct = p?.civilizationName;
    if (typeof direct === "string" && direct.length > 0) {
      return _composeLocale(direct) || direct;
    }
    // Fallback: civilizationFullName (utilities-image.js).
    const full = p?.civilizationFullName;
    if (typeof full === "string" && full.length > 0) {
      return _composeLocale(full) || full;
    }
  } catch (_) {
    // p.civilizationName / p.civilizationFullName access can throw on a stale
    // handle; fall through to the GameInfo-row lookup.
  }
  // Final fallback: the GameInfo row found by iteration (legacy path).
  return resolveDisplayName(civRow, "CivilizationType", rawCiv, "CIVILIZATION_", "");
}

/**
 * Resolve leader/civ display names + canonical type strings and store them on
 * `ctx`. GameInfo.Leaders.lookup accepts either hash or "LEADER_*" string
 * (civ-unlocks-model.js, map-utilities.js); LeaderType STRING for
 * <fxs-icon>/<leader-icon> is extracted as in model-diplo-ribbon.js.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {Pid} id The player id (used in the "Player N" fallback).
 * @param {*} p The sampled player handle.
 * @param {*} rawLeader The raw leader type value.
 * @param {*} rawCiv The raw civ type value.
 */
function collectNamesAndTypeStrings(ctx, id, p, rawLeader, rawCiv) {
  const leaderRow = lookupInfoRow(
    typeof GameInfo !== "undefined" ? GameInfo.Leaders : null,
    rawLeader,
    "LeaderType"
  );
  ctx.leaderName = resolveDisplayName(
    leaderRow,
    "LeaderType",
    rawLeader,
    "LEADER_",
    "Player " + id
  );

  const civRow = lookupInfoRow(
    typeof GameInfo !== "undefined" ? GameInfo.Civilizations : null,
    rawCiv,
    "CivilizationType"
  );
  ctx.civName = resolveCivName(p, civRow, rawCiv);
  dlog("civName (pid=" + id + ") = '" + ctx.civName + "'");

  // LeaderType STRING (canonical "LEADER_AUGUSTUS") for <fxs-icon> /
  // <leader-icon>. Vanilla extracts this exact way at
  // base-standard/ui/diplo-ribbon/model-diplo-ribbon.js.
  ctx.leaderTypeString = _canonicalTypeString(leaderRow?.LeaderType, rawLeader);
  ctx.civTypeString = _canonicalTypeString(civRow?.CivilizationType, rawCiv);
}

/**
 * Pick the canonical "*_TYPE" string: the GameInfo row's typed value when it
 * is a non-empty string, else the raw value when IT is a non-empty string,
 * else undefined.
 * @param {*} rowType The row's typed value (e.g. row.LeaderType).
 * @param {*} raw The raw type value off the player handle.
 * @returns {string | undefined} The canonical type string, or undefined.
 */
function _canonicalTypeString(rowType, raw) {
  if (typeof rowType === "string" && rowType.length > 0) return rowType;
  if (typeof raw === "string" && raw.length > 0) return raw;
  return undefined;
}

/**
 * Capture the player's banner colors. Pattern at
 * base-standard/ui/diplo-ribbon/model-diplo-ribbon.js.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {Pid} id The player id.
 */
function collectColors(ctx, id) {
  try {
    if (typeof UI !== "undefined" && UI.Player) {
      if (typeof UI.Player.getPrimaryColorValueAsString === "function") {
        const c = UI.Player.getPrimaryColorValueAsString(id);
        if (typeof c === "string" && c.length > 0) ctx.primaryColor = c;
      }
      if (typeof UI.Player.getSecondaryColorValueAsString === "function") {
        const c = UI.Player.getSecondaryColorValueAsString(id);
        if (typeof c === "string" && c.length > 0) ctx.secondaryColor = c;
      }
    }
  } catch (_) {
    // UI.Player.get*ColorValueAsString() can throw for an unresolved player;
    // leave the banner colors unset.
  }
}

/**
 * Read the gold balance off the player's Treasury handle.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {Pid} id The player id.
 * @param {*} p The sampled player handle.
 */
function collectGold(ctx, id, p) {
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
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {Pid} id The player id.
 * @param {*} p The sampled player handle.
 * @returns {*} The city list (array/array-like), or undefined.
 */
function collectCities(ctx, id, p) {
  const cities = safeCall("p.Cities (pid=" + id + ")", () => p.Cities);
  let cityList = undefined;
  if (cities) {
    cityList = safeCall("cities.getCities() (pid=" + id + ")", () => {
      if (typeof cities.getCities === "function") return cities.getCities();
      return undefined;
    });
    if (Array.isArray(cityList)) ctx.settlementsCount = cityList.length;
    else if (cityList && typeof cityList.length === "number")
      ctx.settlementsCount = cityList.length;

    // Total tiles owned (land area)
    const tiles = sumOwnedTiles(cityList, id);
    if (typeof tiles === "number") ctx.tilesOwned = tiles;

    // Stamp each settlement's owner by plot location so the war-loss tracker can
    // attribute a later razing to the civ that owned it before capture.
    if (Array.isArray(cityList)) for (const c of cityList) recordCity(c, id);
  }
  return cityList;
}

/**
 * Count fully-unlocked tech + culture nodes and store them on `ctx`. Vanilla
 * doesn't expose a numeric "researched count"; we iterate the tree.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {Pid} id The player id.
 * @param {*} p The sampled player handle.
 */
function collectTechAndCivicCounts(ctx, id, p) {
  const techsN = countCompletedNodes(p, id, "Techs");
  if (typeof techsN === "number") ctx.techsCount = techsN;
  const civicsN = countCompletedNodes(p, id, "Culture");
  if (typeof civicsN === "number") ctx.civicsCount = civicsN;
}

/**
 * Read net yields + population/city/town counts off the Stats handle.
 * Numeric properties per model-diplo-ribbon.js,566,575.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {Pid} id The player id.
 * @param {*} stats The player Stats handle.
 */
function collectYieldsAndSizes(ctx, id, stats) {
  if (!stats) return;
  ctx.yieldGold = netYield(stats, "YIELD_GOLD", id);
  ctx.yieldScience = netYield(stats, "YIELD_SCIENCE", id);
  ctx.yieldCulture = netYield(stats, "YIELD_CULTURE", id);
  ctx.yieldHappiness = netYield(stats, "YIELD_HAPPINESS", id);
  ctx.yieldProduction = netYield(stats, "YIELD_PRODUCTION", id);
  ctx.yieldFood = netYield(stats, "YIELD_FOOD", id);
  ctx.yieldDiplomacy = netYield(stats, "YIELD_DIPLOMACY", id);

  // Population / city / town counts (numeric properties per
  // model-diplo-ribbon.js,566,575).
  const tp = _readFiniteProp(stats, "totalPopulation");
  if (tp !== undefined) ctx.totalPopulation = tp;
  const nc = _readFiniteProp(stats, "numCities");
  if (nc !== undefined) ctx.citiesCount = nc;
  const nt = _readFiniteProp(stats, "numTowns");
  if (nt !== undefined) ctx.townsCount = nt;
}

/**
 * Read a finite numeric property off an engine handle, swallowing errors.
 * @param {*} obj The engine handle.
 * @param {string} prop The property name.
 * @returns {number | undefined} The finite value, or undefined.
 */
function _readFiniteProp(obj, prop) {
  try {
    const v = obj[prop];
    if (typeof v === "number" && isFinite(v)) return v;
  } catch (_e) {
    // Reading obj[prop] off an engine Stats handle can throw mid-transition;
    // treat the property as unavailable.
  }
  return undefined;
}

/**
 * Read the player-level trade-route count off the Trade handle.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {Pid} id The player id.
 * @param {*} p The sampled player handle.
 */
function collectTradeRoutes(ctx, id, p) {
  const trade = safeCall("p.Trade (pid=" + id + ")", () => p.Trade);
  if (trade) {
    const tr = safeCall("trade.countPlayerTradeRoutes() (pid=" + id + ")", () => {
      if (typeof trade.countPlayerTradeRoutes === "function") return trade.countPlayerTradeRoutes();
      return undefined;
    });
    if (typeof tr === "number" && isFinite(tr)) ctx.tradeRoutesCount = tr;
  }
}

/**
 * Count ongoing diplomatic actions involving this player via
 * Game.Diplomacy.getPlayerEvents(pid).
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {Pid} id The player id.
 */
function collectOngoingDeals(ctx, id) {
  const events = safeCall("Game.Diplomacy.getPlayerEvents(" + id + ")", () => {
    if (typeof Game === "undefined" || !Game.Diplomacy) return undefined;
    if (typeof Game.Diplomacy.getPlayerEvents !== "function") return undefined;
    const arr = Game.Diplomacy.getPlayerEvents(id);
    return Array.isArray(arr) ? arr : undefined;
  });
  if (Array.isArray(events)) ctx.ongoingDealsCount = events.length;
}

/**
 * Sum completed wonders across a player's cities (fallback when the
 * player-wide accessor is unavailable). Cite model-city-capture-chooser.js,
 * peace-deal-tooltip.js.
 * @param {*} cityList The city list (array/array-like) or undefined.
 * @param {Pid} id The player id (for log attribution).
 * @returns {number | undefined} Total wonders, or undefined if none readable.
 */
function sumCityWonders(cityList, id) {
  if (!Array.isArray(cityList)) return undefined;
  let total = 0;
  let anyOK = false;
  for (const c of cityList) {
    try {
      const n = _cityWonderCount(c);
      if (n !== undefined) {
        total += n;
        anyOK = true;
      }
    } catch (e) {
      if (DBG) dlog("city wonders err pid=", id, e);
    }
  }
  return anyOK ? total : undefined;
}

/**
 * Read one city's completed-wonder count off its Constructibles handle.
 * @param {*} c A city handle.
 * @returns {number | undefined} The finite count, or undefined if unreadable.
 */
function _cityWonderCount(c) {
  const con = c?.Constructibles;
  if (!con || typeof con.getNumWonders !== "function") return undefined;
  const n = con.getNumWonders();
  return typeof n === "number" && isFinite(n) ? n : undefined;
}

/**
 * Capture the wonder COUNT, preferring player.Stats.getNumWonders(false,false)
 * (advice-support.js), falling back to summing across cities.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {Pid} id The player id.
 * @param {*} stats The player Stats handle.
 * @param {*} cityList The city list for the fallback path.
 */
function collectWonderCount(ctx, id, stats, cityList) {
  if (stats && typeof stats.getNumWonders === "function") {
    const wn = safeCall("stats.getNumWonders(false,false) (pid=" + id + ")", () => {
      const v = stats.getNumWonders(false, false);
      return safeNum(v);
    });
    if (typeof wn === "number") ctx.wondersCount = wn;
  }
  if (ctx.wondersCount === undefined) {
    const total = sumCityWonders(cityList, id);
    if (typeof total === "number") ctx.wondersCount = total;
  }
}

/**
 * Capture per-wonder identity (ConstructibleType strings) for completed,
 * undamaged wonders. Cite endgame-cinematics.js. Used by the chart's
 * wonder-marker plugin to diff against the prior sample.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {Pid} id The player id.
 * @param {*} p The sampled player handle.
 */
function collectWonderTypes(ctx, id, p) {
  try {
    const playerCon = p?.Constructibles;
    if (!_wonderApiAvailable(playerCon)) return;
    const wonderComps = playerCon.getWonders(id);
    if (!Array.isArray(wonderComps)) return;
    const types = [];
    for (const wc of wonderComps) {
      const ct = _wonderComponentType(wc);
      if (ct !== undefined) types.push(ct);
    }
    if (types.length > 0) ctx.wonderTypes = types;
  } catch (e) {
    if (DBG) dlog("wonder type capture err pid=", id, e);
  }
}

/**
 * Whether the player + global Constructibles wonder APIs are usable.
 * @param {*} playerCon The player's Constructibles handle.
 * @returns {boolean} True if getWonders + getByComponentID are callable.
 */
function _wonderApiAvailable(playerCon) {
  return !!(
    playerCon &&
    typeof playerCon.getWonders === "function" &&
    typeof Constructibles !== "undefined" &&
    typeof Constructibles.getByComponentID === "function"
  );
}

/**
 * Look up a constructible's ConstructibleType string from its type/hash.
 * @param {*} type The constructible type/hash (con.type).
 * @returns {string | undefined} The ConstructibleType, or undefined.
 */
function _constructibleTypeString(type) {
  const info =
    typeof GameInfo !== "undefined" &&
    GameInfo.Constructibles &&
    typeof GameInfo.Constructibles.lookup === "function"
      ? GameInfo.Constructibles.lookup(type)
      : null;
  const ct = info && info.ConstructibleType;
  return typeof ct === "string" && ct.length > 0 ? ct : undefined;
}

/**
 * Resolve the ConstructibleType string for one completed, undamaged wonder
 * ComponentID, via Constructibles.getByComponentID + GameInfo lookup. A
 * per-wonder failure returns undefined rather than throwing.
 * @param {*} wc A wonder ComponentID.
 * @returns {string | undefined} The ConstructibleType, or undefined.
 */
function _wonderComponentType(wc) {
  try {
    const con = Constructibles.getByComponentID(wc);
    if (!con || !con.complete || con.damaged) return undefined;
    return _constructibleTypeString(con.type);
  } catch (_) {
    // Constructibles.getByComponentID() can throw for a stale ComponentID; skip
    // this one wonder rather than failing the whole loop.
  }
  return undefined;
}

/**
 * Build a UnitType -> strongest-stats-row map from GameInfo.Unit_Stats. When a
 * unit has multiple (per-age) rows, keep the strongest as the best
 * approximation of "current" strength.
 * @returns {Map<string, { Combat: number, RangedCombat: number, score: number }>}
 *   The lazily-built map (empty on any failure).
 */
function buildUnitStatsByType() {
  /** @type {Map<string, { Combat: number, RangedCombat: number, score: number }>} */
  const statsByType = new Map();
  try {
    if (
      typeof GameInfo !== "undefined" &&
      GameInfo.Unit_Stats &&
      typeof GameInfo.Unit_Stats[Symbol.iterator] === "function"
    ) {
      for (const row of GameInfo.Unit_Stats) {
        _mergeUnitStatRow(statsByType, row);
      }
    }
  } catch (_) {
    // Iterating GameInfo.Unit_Stats can throw if the table is absent; an empty
    // map just means 0 power, not a kill-switch trip.
  }
  return statsByType;
}

/**
 * Merge one GameInfo.Unit_Stats row into the UnitType map, keeping the
 * strongest row when a unit has multiple (per-age) entries.
 * @param {Map<string, { Combat: number, RangedCombat: number, score: number }>} statsByType
 *   The map to mutate.
 * @param {*} row A GameInfo.Unit_Stats row.
 */
function _mergeUnitStatRow(statsByType, row) {
  if (!row || typeof row.UnitType !== "string") return;
  const prev = statsByType.get(row.UnitType);
  const score = Math.max(row.Combat || 0, row.RangedCombat || 0);
  if (!prev || score > prev.score) {
    statsByType.set(row.UnitType, {
      Combat: row.Combat || 0,
      RangedCombat: row.RangedCombat || 0,
      score
    });
  }
}

/** Formation classes counted as "military" for power. */
const MILITARY_FORMATIONS = new Set([
  "FORMATION_CLASS_LAND_COMBAT",
  "FORMATION_CLASS_NAVAL",
  "FORMATION_CLASS_AIR"
]);

/**
 * Compute the combat strength of one unit (max of Combat / RangedCombat),
 * preferring the Unit_Stats row, falling back to a `.Combat` on the def.
 * @param {*} u The unit handle.
 * @param {Map<string, { Combat: number, RangedCombat: number, score: number }>} statsByType
 *   Map from {@link buildUnitStatsByType}.
 * @returns {number} The unit's strength (0 if non-military or unreadable).
 */
function unitStrength(u, statsByType) {
  const utype = u.type;
  if (utype === undefined || utype === null) return 0;
  const def = GameInfo?.Units?.lookup ? GameInfo.Units.lookup(utype) : null;
  if (!def) return 0;
  if (!MILITARY_FORMATIONS.has(def.FormationClass)) return 0;
  return _defStrength(def, statsByType);
}

/**
 * Resolve a unit def's combat strength from its Unit_Stats row, falling back
 * to a `.Combat` on the def.
 * @param {*} def A GameInfo.Units row.
 * @param {Map<string, { Combat: number, RangedCombat: number, score: number }>} statsByType
 *   Map from {@link buildUnitStatsByType}.
 * @returns {number} The strength (0 if none found).
 */
function _defStrength(def, statsByType) {
  // Combat strength lives in Unit_Stats keyed by UnitType string.
  const utStr = def.UnitType;
  const sRow = utStr ? statsByType.get(utStr) : undefined;
  let strength = 0;
  if (sRow) strength = Math.max(sRow.Combat, sRow.RangedCombat);
  // Fallback: some defs expose .Combat directly.
  if (!strength && typeof def.Combat === "number") strength = def.Combat;
  return strength;
}

/**
 * Compute military power by iterating the player's units and summing combat
 * strength for military formations. Pattern at
 * age-antiquity/ui/tutorial/tutorial-items-antiquity.js. The ENTIRE
 * iteration is wrapped in ONE safeCall so a single bad lookup doesn't trip the
 * kill switch repeatedly per turn.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {Pid} id The player id.
 * @param {*} p The sampled player handle.
 */
function collectMilitaryPower(ctx, id, p) {
  safeCall("computeMilitaryPower(pid=" + id + ")", () => {
    const units = p.Units;
    if (!units || typeof units.getUnitIds !== "function") return;
    const ids = units.getUnitIds();
    if (!ids || typeof ids[Symbol.iterator] !== "function") return;
    // Build a quick UnitType -> stats row map once, lazily, per sample.
    const statsByType = buildUnitStatsByType();
    const { total, counted } = _sumUnitStrengths(ids, statsByType, id);
    if (counted > 0 || total > 0) ctx.militaryPower = total;
    else ctx.militaryPower = 0; // alive player with zero military still
    // gets a real "0" rather than dropped.
  });
}

/**
 * Iterate unit ids and sum military strength, skipping any unit that throws.
 * Each counted unit's strength is also recorded against its owner so the
 * casualty tracker can resolve it after the unit is destroyed.
 * @param {Iterable<*>} ids The player's unit ids.
 * @param {Map<string, { Combat: number, RangedCombat: number, score: number }>} statsByType
 *   Map from {@link buildUnitStatsByType}.
 * @param {number} [owner] The owner pid (for casualty-cache recording).
 * @returns {{ total: number, counted: number }} The summed strength + count.
 */
function _sumUnitStrengths(ids, statsByType, owner) {
  let total = 0;
  let counted = 0;
  for (const uid of ids) {
    try {
      const u =
        typeof Units !== "undefined" && typeof Units.get === "function"
          ? Units.get(uid)
          : undefined;
      if (!u) continue;
      const strength = unitStrength(u, statsByType);
      if (strength > 0) {
        total += strength;
        counted++;
        if (typeof owner === "number") recordUnitStrength(uid, owner, strength);
      }
    } catch (_) {
      // Units.get(uid) can throw for a unit destroyed mid-iteration; skip that
      // one unit rather than tripping the kill switch.
    }
  }
  return { total, counted };
}

/**
 * Capture the settlement cap + settlements-used.
 * Citation: base-standard/ui/diplo-ribbon/panel-yield-banner.js.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {*} stats The player Stats handle.
 */
function collectSettlementCap(ctx, stats) {
  safeCall("settlementCap", () => {
    if (!stats) return;
    const cap = stats.settlementCap;
    if (typeof cap === "number" && isFinite(cap)) ctx.settlementCap = cap;
    const n = stats.numSettlements;
    if (typeof n === "number" && isFinite(n)) ctx.numSettlements = n;
  });
}

// Bucket map: Legacies.LegacySubtype → ctx field name. LEGACY_CRISIS exists
// but doesn't fit the 6-axis radar; tally as generic in-progress only.
/** @type {Record<string, keyof PlayerCtx>} */
const SUBTYPE_TO_KEY = {
  LEGACY_CULTURAL: "triumphsCultural",
  LEGACY_DIPLOMATIC: "triumphsDiplomatic",
  LEGACY_ECONOMIC: "triumphsEconomic",
  LEGACY_SCIENTIFIC: "triumphsScientific",
  LEGACY_MILITARISTIC: "triumphsMilitaristic",
  LEGACY_EXPANSIONIST: "triumphsExpansionist"
};

/**
 * Count triumphs (Test of Time legacy system) per civ and store them on `ctx`.
 * Iterates GameInfo.Legacies, asks the player's Legacies object whether each
 * is triggered, and tallies by attribute; non-zero progress on an untriggered
 * triumph counts toward `triumphsInProgress`.
 *
 * Civ7 ToT replaced the 4 legacy paths with a 6-attribute triumph system. The
 * OLD GameInfo.LegacyPaths / Game.VictoryManager APIs still exist but return
 * frozen zeros post-ToT; don't read from them. Citations:
 *   ui-next/screens/legacies/legacies-model.js   getProgress shape
 *   ui-next/screens/legacies/legacies-model.js   per-other-player access
 *   ui-next/screens/legacies/triumph-tracking-manager.js
 *   age-antiquity/data/legacies.xml         LegacySubtype values
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {*} p The sampled player handle.
 */
function collectTriumphs(ctx, p) {
  ctx.triumphsCultural = 0;
  ctx.triumphsDiplomatic = 0;
  ctx.triumphsEconomic = 0;
  ctx.triumphsScientific = 0;
  ctx.triumphsMilitaristic = 0;
  ctx.triumphsExpansionist = 0;
  ctx.triumphsInProgress = 0; // total in-progress (any attribute), informational
  ctx.legacyDiag = {}; // (kept for any leftover legacy-path API probes)
  safeCall("triumphs/test-of-time", () => {
    const pl = p?.Legacies;
    if (!pl) return;
    if (typeof GameInfo === "undefined" || !GameInfo.Legacies) return;
    let inProgress = 0;
    try {
      for (const row of GameInfo.Legacies) {
        if (_tallyTriumphRow(ctx, pl, row)) inProgress++;
      }
    } catch (_) {
      // Iterating GameInfo.Legacies / probing the player Legacies handle can
      // throw; keep whatever triumphs were tallied before the throw.
    }
    ctx.triumphsInProgress = inProgress;
  });
}

/**
 * Tally one Legacies row: bump the matching `ctx` attribute when triggered,
 * else report whether it has non-zero (in-progress) progress.
 * @param {PlayerCtx} ctx The context to mutate (triggered triumphs).
 * @param {*} pl The player's Legacies handle.
 * @param {*} row A GameInfo.Legacies row.
 * @returns {boolean} True if the row is an untriggered, in-progress triumph.
 */
function _tallyTriumphRow(ctx, pl, row) {
  if (!row || !row.LegacyType) return false;
  const ctxKey = SUBTYPE_TO_KEY[row.LegacySubtype];
  if (_legacyTriggered(pl, row.LegacyType)) {
    if (ctxKey) ctx[ctxKey] = (ctx[ctxKey] || 0) + 1;
    return false;
  }
  // Count any non-zero progress toward an untriggered triumph.
  return _legacyInProgress(pl, row.LegacyType);
}

/**
 * Whether a legacy is triggered for the player, swallowing errors.
 * @param {*} pl The player's Legacies handle.
 * @param {string} legacyType The LegacyType.
 * @returns {boolean} True if triggered.
 */
function _legacyTriggered(pl, legacyType) {
  try {
    return !!pl.isTriggered?.(legacyType);
  } catch (_) {
    return false;
  }
}

/**
 * Whether an untriggered legacy has non-zero progress, swallowing errors.
 * @param {*} pl The player's Legacies handle.
 * @param {string} legacyType The LegacyType.
 * @returns {boolean} True if progress is in progress.
 */
function _legacyInProgress(pl, legacyType) {
  try {
    const prog = pl.getProgress?.(legacyType);
    const cur = prog?.progress?.[0]?.current;
    return typeof cur === "number" && cur > 0;
  } catch (_) {
    return false;
  }
}

// Map of Modern victory type → ctx field name.
/** @type {Record<string, keyof PlayerCtx>} */
const VICTORY_TYPE_TO_KEY = {
  VICTORY_CULTURE_MODERN: "victoryPointsCulture",
  VICTORY_ECONOMIC_MODERN: "victoryPointsEconomic",
  VICTORY_MILITARY_MODERN: "victoryPointsMilitary",
  VICTORY_SCIENCE_MODERN: "victoryPointsScience"
};

/**
 * Capture real Modern-age victory points per civ via player.Victories. The
 * vanilla Victories screen reads this exact value for the Economic (GDP)
 * victory. Pre-Modern these return 0. Citation:
 * ui-next/screens/victories/victories-screen-model.js,1137.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {*} p The sampled player handle.
 */
function collectVictoryPoints(ctx, p) {
  ctx.victoryPointsCulture = 0;
  ctx.victoryPointsEconomic = 0; // GDP
  ctx.victoryPointsMilitary = 0;
  ctx.victoryPointsScience = 0;
  safeCall("victoryPoints", () => {
    const v = p?.Victories;
    if (!v || typeof v.getPointsForVictoryType !== "function") return;
    if (typeof GameInfo === "undefined" || !GameInfo.Victories) return;
    try {
      for (const row of GameInfo.Victories) {
        _captureVictoryRow(ctx, v, row);
      }
    } catch (_) {
      // Iterating GameInfo.Victories can throw if the table is absent; keep the
      // victory points captured so far (all default to 0).
    }
  });
}

/**
 * Capture one Victories row's points into the matching `ctx` field, when the
 * row maps to a Modern victory and reports positive points.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {*} v The player's Victories handle.
 * @param {*} row A GameInfo.Victories row.
 */
function _captureVictoryRow(ctx, v, row) {
  if (!row) return;
  const key = VICTORY_TYPE_TO_KEY[row.VictoryType];
  if (!key) return;
  try {
    const pts = v.getPointsForVictoryType(row.$hash);
    if (typeof pts === "number" && isFinite(pts) && pts > 0) {
      ctx[key] = pts;
    }
  } catch (_) {
    // v.getPointsForVictoryType() can throw pre-Modern age; leave this victory
    // point at its 0 default.
  }
}

/**
 * Score one OTHER player's contribution to `id`'s diplomatic approval. City-
 * states contribute via suzerainty (+2, damped later); majors via a weighted
 * relationship enum. Cite view-relations.js (getRelationshipEnum), :501
 * (getSuzerain).
 * @param {*} dip The sampled player's Diplomacy handle.
 * @param {Pid} id The sampled player id.
 * @param {*} other The other player handle.
 * @param {Record<string, number>} weightMajor Relationship-enum weight map.
 * @returns {{ major: number, cs: number }} This player's score contribution.
 */
function scoreApprovalContribution(dip, id, other, weightMajor) {
  const out = { major: 0, cs: 0 };
  const oid = other.id;
  if (oid === id) return out;
  let met = false;
  try {
    met = !!dip.hasMet(oid);
  } catch (_) {
    met = false;
  }
  if (!met) return out;
  const isCS =
    typeof other.isMinor === "boolean"
      ? other.isMinor
      : typeof other.isIndependent === "boolean"
        ? other.isIndependent
        : false;
  if (isCS) out.cs += _csSuzerainScore(other, id);
  else out.major += _majorRelationshipScore(dip, oid, weightMajor);
  return out;
}

/**
 * City-state contribution: +2 when `id` is the CS's suzerain, else 0 (damped
 * to 0.3× by the caller).
 * @param {*} other The city-state player handle.
 * @param {Pid} id The sampled player id.
 * @returns {number} 2 if suzerain, else 0.
 */
function _csSuzerainScore(other, id) {
  try {
    const inf = other.Influence;
    if (inf && typeof inf.getSuzerain === "function") {
      const suz = inf.getSuzerain();
      if (suz === id) return 2;
    }
  } catch (_) {
    // other.Influence.getSuzerain() can throw for a non-CS / unresolved player;
    // treat as no suzerainty contribution.
  }
  return 0;
}

/**
 * Major-civ contribution: the weight for the relationship enum, or 0.
 * @param {*} dip The sampled player's Diplomacy handle.
 * @param {Pid} oid The other player id.
 * @param {Record<string, number>} weightMajor Relationship-enum weight map.
 * @returns {number} The weighted score (0 if unknown).
 */
function _majorRelationshipScore(dip, oid, weightMajor) {
  let rel;
  try {
    rel = dip.getRelationshipEnum(oid);
  } catch (_) {
    rel = undefined;
  }
  if (rel !== undefined && weightMajor[rel] !== undefined) return weightMajor[rel];
  return 0;
}

/**
 * Compute aggregate "international reputation": weighted relationship scores
 * across all met major civs plus a damped city-state suzerainty contribution.
 * Mirrors the relationship API used by view-relations.js.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {Pid} id The sampled player id.
 * @param {*} p The sampled player handle.
 */
function collectDiplomaticApproval(ctx, id, p) {
  safeCall("diplomaticApproval", () => {
    const dip = p?.Diplomacy;
    if (!_approvalApiAvailable(dip)) return;
    const { major: majorScore, cs: csScore } = _sumApprovalScores(dip, id);
    ctx.diplomaticApproval = majorScore + 0.3 * csScore;
    ctx.diplomaticApprovalMajor = majorScore;
    ctx.diplomaticApprovalCS = csScore;
    // Debug: emit a per-pid trace so we can verify the score is actually
    // varying across turns/civs (FIXES.md #3 - flatness diagnosis).
    dlog(
      "diplomaticApproval pid=" + id,
      "major=" + majorScore,
      "cs=" + csScore,
      "total=" + ctx.diplomaticApproval.toFixed(2)
    );
  });
}

/**
 * Whether the diplomacy + relationship-enum APIs needed for approval scoring
 * are available.
 * @param {*} dip The sampled player's Diplomacy handle.
 * @returns {boolean} True if hasMet + getRelationshipEnum + enums are present.
 */
function _approvalApiAvailable(dip) {
  return !!(
    dip &&
    typeof dip.hasMet === "function" &&
    typeof dip.getRelationshipEnum === "function" &&
    typeof DiplomacyPlayerRelationships !== "undefined"
  );
}

/**
 * Sum the major + city-state approval contributions across all alive players.
 * @param {*} dip The sampled player's Diplomacy handle.
 * @param {Pid} id The sampled player id.
 * @returns {{ major: number, cs: number }} The summed scores.
 */
function _sumApprovalScores(dip, id) {
  const R = DiplomacyPlayerRelationships;
  const WEIGHT_MAJOR = {
    [R.PLAYER_RELATIONSHIP_ALLIANCE]: 5,
    [R.PLAYER_RELATIONSHIP_HELPFUL]: 3,
    [R.PLAYER_RELATIONSHIP_FRIENDLY]: 2,
    [R.PLAYER_RELATIONSHIP_NEUTRAL]: 0,
    [R.PLAYER_RELATIONSHIP_UNFRIENDLY]: -2,
    [R.PLAYER_RELATIONSHIP_HOSTILE]: -3,
    [R.PLAYER_RELATIONSHIP_AT_WAR]: -5
  };
  let major = 0;
  let cs = 0;
  try {
    const all = Players.getAlive ? Players.getAlive() : null;
    if (!all || !Array.isArray(all)) return { major, cs };
    for (const other of all) {
      if (!other) continue;
      const part = scoreApprovalContribution(dip, id, other, WEIGHT_MAJOR);
      major += part.major;
      cs += part.cs;
    }
  } catch (_) {
    // Players.getAlive() can throw mid age-transition; return whatever scores
    // accumulated before the throw.
  }
  return { major, cs };
}

/**
 * Resolve a single ResourceEntry's class string, accepting either the flat
 * `classType` shape or the nested `uniqueResource.resource` hash (which we
 * look up in GameInfo.Resources). Cite
 * base-standard/ui/resource-allocation/model-resource-allocation.js.
 * @param {*} r A ResourceEntry item.
 * @returns {*} The resource class string, or undefined.
 */
function resolveResourceClass(r) {
  const cls = r?.classType;
  if (cls) return cls;
  // Try the nested uniqueResource shape.
  const resType = r?.uniqueResource?.resource ?? r?.type ?? r?.ResourceType;
  return _resourceClassByType(resType);
}

/**
 * Resolve a resource class string from a resource type/hash via the
 * GameInfo.Resources lookup table.
 * @param {*} resType The resource type/hash.
 * @returns {*} The class string, or undefined.
 */
function _resourceClassByType(resType) {
  if (
    resType === undefined ||
    typeof GameInfo === "undefined" ||
    !GameInfo.Resources ||
    typeof GameInfo.Resources.lookup !== "function"
  ) {
    return undefined;
  }
  try {
    const def = GameInfo.Resources.lookup(resType);
    return def?.ResourceClassType || def?.classType;
  } catch (_) {
    // GameInfo.Resources.lookup() can throw on an unknown resType; treat the
    // resource class as unknown.
  }
  return undefined;
}

/**
 * Tally a player's resources by class (Bonus / Empire / City / Factory /
 * Treasure) and store the counts + total on `ctx`.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {Pid} id The player id.
 * @param {*} p The sampled player handle.
 */
function collectResourceCategories(ctx, id, p) {
  safeCall("resourceCategories", () => {
    const rs = p?.Resources;
    if (!rs || typeof rs.getResources !== "function") return;
    const list = rs.getResources();
    if (!Array.isArray(list)) return;
    const c = { bonus: 0, empire: 0, city: 0, factory: 0, treasure: 0, unknown: 0 };
    for (const r of list) {
      _bucketResource(c, resolveResourceClass(r), _resourceCount(r));
    }
    ctx.resourcesBonus = c.bonus;
    ctx.resourcesEmpire = c.empire;
    ctx.resourcesCity = c.city;
    ctx.resourcesFactory = c.factory;
    ctx.resourcesTreasure = c.treasure;
    ctx.resourcesTotal = c.bonus + c.empire + c.city + c.factory + c.treasure + c.unknown;
    dlog(
      "resources pid=" + id,
      "B=" + c.bonus,
      "E=" + c.empire,
      "C=" + c.city,
      "F=" + c.factory,
      "T=" + c.treasure,
      "?=" + c.unknown,
      "rawCount=" + list.length
    );
  });
}

/**
 * Resolve a ResourceEntry's count (positive finite count, else 1).
 * @param {*} r A ResourceEntry item.
 * @returns {number} The count to add.
 */
function _resourceCount(r) {
  return typeof r?.count === "number" && isFinite(r.count) && r.count > 0 ? r.count : 1;
}

/** @typedef {{ bonus: number, empire: number, city: number, factory: number, treasure: number, unknown: number }} ResourceCounts */

/**
 * Add `cnt` to the bucket matching `cls` (unknown bucket if unrecognized).
 * @param {ResourceCounts} c The counts to mutate.
 * @param {*} cls The resource class string.
 * @param {number} cnt The amount to add.
 */
function _bucketResource(c, cls, cnt) {
  if (cls === "RESOURCECLASS_BONUS") c.bonus += cnt;
  else if (cls === "RESOURCECLASS_EMPIRE") c.empire += cnt;
  else if (cls === "RESOURCECLASS_CITY") c.city += cnt;
  else if (cls === "RESOURCECLASS_FACTORY") c.factory += cnt;
  else if (cls === "RESOURCECLASS_TREASURE") c.treasure += cnt;
  else c.unknown += cnt;
}

/**
 * Allocate the per-civ context object with every field pre-initialized to
 * undefined (so the typed shape is stable and downstream reads never see a
 * missing key).
 * @param {Pid} id The player id.
 * @returns {PlayerCtx} The freshly-allocated context.
 */
function _newPlayerCtx(id) {
  /** @type {PlayerCtx} */
  const ctx = {
    id,
    player: undefined,
    leaderType: undefined,
    civType: undefined,
    stats: undefined,
    // Existing safe metrics
    gold: undefined,
    settlementsCount: undefined,
    techsCount: undefined,
    civicsCount: undefined,
    // New metrics
    yieldGold: undefined,
    yieldScience: undefined,
    yieldCulture: undefined,
    yieldHappiness: undefined,
    yieldProduction: undefined,
    yieldFood: undefined,
    yieldDiplomacy: undefined, // = Influence
    totalPopulation: undefined,
    citiesCount: undefined,
    townsCount: undefined,
    tilesOwned: undefined,
    continent: undefined,
    tradeRoutesCount: undefined,
    ongoingDealsCount: undefined,
    wondersCount: undefined,
    militaryPower: undefined,
    // Resolved names + LeaderType STRING (for <fxs-icon data-icon-id> /
    // <leader-icon leader=...>) - these elements need the canonical
    // "LEADER_*" string, not the numeric hash that p.leaderType returns.
    leaderTypeString: undefined,
    civTypeString: undefined,
    primaryColor: undefined,
    secondaryColor: undefined
  };
  return ctx;
}

// Pull only-safe surface from a Player handle. All deeply-nested calls split.
/**
 * Build the per-civ context object for one player by running each section
 * collector in turn. Engine-call order and side-effect order match the
 * original monolithic implementation.
 * @param {Pid} id The player id to sample.
 * @returns {PlayerCtx} The assembled per-civ context.
 */
export function buildPlayerCtx(id) {
  const ctx = _newPlayerCtx(id);

  const p = getPlayer(id);
  if (!p) return ctx;
  ctx.player = p;

  // Snapshot of whether the LOCAL player has met this player at sample time.
  // Stored on snapshot.players[pid].met for downstream renderers (chart
  // legend / factbook / relations rings).
  collectMet(ctx, id, p);

  // leaderType / civType - keep the RAW value; resolve display names + the
  // canonical type strings HERE so the screen doesn't re-resolve at render.
  const { rawLeader, rawCiv } = collectRawTypes(ctx, p);
  collectNamesAndTypeStrings(ctx, id, p, rawLeader, rawCiv);

  // Player banner colors.
  collectColors(ctx, id);

  // Stats handle (used for score + yields + size counts)
  try {
    ctx.stats = p.Stats;
  } catch (_e) {
    // p.Stats accessor can throw on a stale player handle; leave ctx.stats
    // undefined so downstream collectors skip stats-derived metrics.
  }
  const stats = ctx.stats;

  // Treasury / gold
  collectGold(ctx, id, p);

  // Cities -> settlement count + tiles owned + (cached for downstream)
  const cityList = collectCities(ctx, id, p);

  // Home continent (capital's landmass) for war-naming geography.
  collectContinent(ctx, cityList);

  // Techs / Civics - count NODE_STATE_FULLY_UNLOCKED nodes.
  collectTechAndCivicCounts(ctx, id, p);

  // Yields via Stats.getNetYield + population / city / town counts.
  collectYieldsAndSizes(ctx, id, stats);

  // Trade routes - player-level total count.
  collectTradeRoutes(ctx, id, p);

  // Ongoing diplomatic actions involving this player.
  collectOngoingDeals(ctx, id);

  // Wonders - count then per-wonder identity capture.
  collectWonderCount(ctx, id, stats, cityList);
  collectWonderTypes(ctx, id, p);

  // Military Power - computed defensively from unit iteration.
  collectMilitaryPower(ctx, id, p);

  // ── Settlement cap (Civ7-specific) ─────────────────────────────────
  collectSettlementCap(ctx, stats);

  // ── Triumph counts per civ (Test of Time legacy system) ────────────
  collectTriumphs(ctx, p);

  // ── Real Modern-age Victory Points ─────────────────────────────────
  collectVictoryPoints(ctx, p);

  // ── Diplomatic Approval (Civ7-specific) ────────────────────────────
  collectDiplomaticApproval(ctx, id, p);

  // ── Resources assigned by class ────────────────────────────────────
  collectResourceCategories(ctx, id, p);

  return ctx;
}

/**
 * Build a LIGHTWEIGHT context for a minor (city-state / independent) player:
 * identity, banner colors, and military power only - skipping the heavy per-civ
 * collectors. Used to sample city-state war allies cheaply so the Conflicts
 * views can show their power and (via recordUnitStrength) power lost.
 * @param {Pid} id The minor player id.
 * @returns {PlayerCtx} The trimmed per-civ context.
 */
export function buildMinorMilitaryCtx(id) {
  const ctx = _newPlayerCtx(id);
  const p = getPlayer(id);
  if (!p) return ctx;
  ctx.player = p;
  collectMet(ctx, id, p);
  const { rawLeader, rawCiv } = collectRawTypes(ctx, p);
  collectNamesAndTypeStrings(ctx, id, p, rawLeader, rawCiv);
  collectColors(ctx, id);
  // Iterating the minor's units here ALSO records each unit's strength against
  // its owner, so the casualty tracker can resolve city-state power lost later.
  collectMilitaryPower(ctx, id, p);
  return ctx;
}
