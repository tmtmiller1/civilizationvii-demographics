// demographics-sampler.js
//
// Subscribes to PlayerTurnActivated and records a snapshot of safe
// metrics for every alive major player. Hard-defensive: every accessor
// is both try/catch-wrapped and typeof-checked, and the sampler
// permanently unsubscribes after KILL_THRESHOLD consecutive throws to
// isolate a degraded session from compounding errors.
//
// The engine.on/off subscription pattern is established in
// base-standard/ui/quest-tracker/quest-list.js and
// notification-train/model-notification-train.js (the data.player payload
// field is documented at quest-list.js, around line 206).
// Players.getAliveMajorIds() is from base-standard/maps/assign-starting-plots.js.
//
// Accessor crib sheet (all under Resources/Base/modules):
//   Stats.getNetYield(YieldTypes.YIELD_*)         — diplo-ribbon/model-diplo-ribbon.js
//   Stats.numSettlements / settlementCap          — same file
//   Stats.numCities / numTowns / totalPopulation  — same file
//   Treasury.getGoldBalance() / goldBalance       — advice/advice-support.js
//   Cities.getCities()                            — pre-existing
//   city.getPurchasedPlots()                      — city-zoomer/city-zoomer.js
//   Trade.countPlayerTradeRoutes()                — age-antiquity tutorial
//   Game.Diplomacy.getPlayerEvents(playerId)      — diplomacy-actions panel
//   player.Stats.getNumWonders(orig, currentAge)  — advice/advice-support.js
//   player.Units.getUnitIds() + Units.get(id)     — age-antiquity tutorial
//   GameInfo.Unit_Stats[].Combat joined on UnitType
//                                                  — civilopedia-sidebar-panels.js
//   FormationClass classifier (LAND_COMBAT / NAVAL / AIR → military)
//                                                  — interface-mode-unit-selected.js
//   Techs.getTreeType() + Game.ProgressionTrees.getTree(pid, treeType).nodes
//                                                  — tutorial/tutorial-support.js
//   Culture: analogous via player.Culture.getTreeType()
//   ProgressionTreeNodeState.NODE_STATE_FULLY_UNLOCKED = "researched"
//                                                  — tree-grid/tree-grid.js

import { METRICS } from "/demographics/ui/demographics-metrics.js";
import DemographicsStorage from "/demographics/ui/demographics-storage.js";
import { DemographicsSettings } from "/demographics/ui/demographics-settings.js";

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

/**
 * The persisted history blob as the sampler sees it: the shared {@link
 * DemoHistory} fields plus the sampler's own runtime extensions (`wars`,
 * `legacySnapshots`, the obsolete `cumulativeTurnOffset`). These extra fields
 * live on the same blob but aren't in the shared typedef, so they are declared
 * here locally as an intersection with the shared {@link DemoHistory}.
 * @typedef {DemoHistory & WarHistoryExtras} WarHistory
 */

/**
 * The sampler's runtime extension fields on the persisted history blob.
 * @typedef {object} WarHistoryExtras
 * @property {WarRecord[]} [wars] Tracked war records.
 * @property {Record<string, Record<string, object>>} [legacySnapshots] Age-end triumph snapshots, keyed by age.
 * @property {number} [cumulativeTurnOffset] Obsolete stored offset (deleted on migrate).
 */

/**
 * One persisted war record. Field shapes are the mod's own, but the record is
 * a runtime extension of the storage history (not in the shared typedef), so
 * it carries an index signature for back-compat / migration fields.
 * @typedef {object} WarRecord
 * @property {number} [warUniqueID] Stable engine uniqueID; primary key.
 * @property {Pid[]} [sideA] Side A roster (pids).
 * @property {Pid[]} [sideB] Side B roster (pids).
 * @property {Pid[]} [participants] All participant pids.
 * @property {object[]} [sideACivs] Side A roster info entries.
 * @property {object[]} [sideBCivs] Side B roster info entries.
 * @property {Pid} [aPid] Legacy scalar side-A pid (pre-array schema).
 * @property {Pid} [bPid] Legacy scalar side-B pid (pre-array schema).
 * @property {number | null} [startTurn] Global start turn.
 * @property {number | null} [endTurn] Global end turn (null while open).
 * @property {string} [startYear] In-game start year label.
 * @property {string | null} [endYear] In-game end year label.
 * @property {object | null} [declaredBy] Declarer info.
 * @property {string} [_nameKeyA] Sorted matchup key A (for ordinal naming).
 * @property {string} [_nameKeyB] Sorted matchup key B (for ordinal naming).
 * @property {string} [name] Display name.
 * @property {*} [extra] Index signature for any other fields.
 */

/**
 * A resolved war-roster entry for one participant.
 * @typedef {object} WarRosterEntry
 * @property {Pid | string} pid The participant pid.
 * @property {string} civ Display civ name.
 * @property {string} leader Display leader name.
 * @property {string} color Banner color string.
 * @property {string | undefined} civTypeString Canonical CIVILIZATION_* type.
 * @property {boolean} isCS Whether the participant is a city-state / IP.
 */

/**
 * The normalized active-war info derived from a DECLARE_WAR event header.
 * @typedef {object} ActiveWar
 * @property {*} uniqueID The engine uniqueID.
 * @property {Pid | null} initialPid The declarer pid.
 * @property {Pid | null} targetPid The target pid.
 * @property {Pid[]} sideA Side A roster (pids).
 * @property {Pid[]} sideB Side B roster (pids).
 * @property {number | null} headerStartTurn Age-local declaration turn.
 */

// How many turns between samples. Resolved from the user setting each call
// so a runtime change in the Options panel takes effect on the next turn
// without needing to restart the sampler.
/**
 * Resolve the configured sample cadence (turns between samples).
 * @returns {number} A finite integer >= 1; defaults to 1 on any failure.
 */
function getPollEveryNTurns() {
  try {
    const v = DemographicsSettings.getSetting("sampleEveryNTurns", 1);
    const n = Math.round(Number(v));
    if (Number.isFinite(n) && n >= 1) return n;
  } catch (_) {
    /* */
  }
  return 1;
}

// Track the last turn we actually recorded a snapshot on so the throttle
// stays correct across (a) save/load round-trips and (b) settings changes
// — we don't want the user to switch from "every 5 turns" to "every 2"
// and immediately get a duplicate sample on the same turn.
let lastSampledTurn = -1;
/**
 * Decide whether a snapshot should be recorded on the given turn, honoring
 * the polling cadence and the last recorded turn.
 * @param {*} turn The current game turn (numeric) or any other value.
 * @returns {boolean} True if a sample should be taken this turn.
 */
function shouldSampleThisTurn(turn) {
  if (typeof turn !== "number") return true;
  const n = getPollEveryNTurns();
  if (n <= 1) return true;
  if (turn === lastSampledTurn) return false;
  if (turn % n !== 0) return false;
  return true;
}

let DEMOGRAPHICS_DEBUG = true;
/**
 * Verbose debug logger; no-op unless {@link DEMOGRAPHICS_DEBUG} is set.
 * @param {...*} a Values to log.
 * @returns {void}
 */
function vlog(...a) {
  if (DEMOGRAPHICS_DEBUG) console.warn("[Demographics.sampler]", ...a);
}
/**
 * Informational logger; always emits.
 * @param {...*} a Values to log.
 * @returns {void}
 */
function ilog(...a) {
  console.warn("[Demographics.sampler]", ...a);
}
/**
 * Error logger; always emits.
 * @param {...*} a Values to log.
 * @returns {void}
 */
function elog(...a) {
  console.error("[Demographics.sampler]", ...a);
}

// ---- kill switch ---------------------------------------------------------
let errorCount = 0;
const KILL_THRESHOLD = 3;
let disabled = false;
let started = false;
let firstSampleSucceeded = false;
/** @type {*} */
let handlerRef = null;

/**
 * Increment the error counter and, once it reaches {@link KILL_THRESHOLD},
 * permanently disable sampling and unsubscribe for this session.
 * @param {string} label A label identifying where the error occurred.
 * @param {*} e The thrown error.
 * @returns {void}
 */
function tripIfTooMany(label, e) {
  errorCount++;
  elog("error in", label, "errorCount=", errorCount, "/", KILL_THRESHOLD, "err:", e);
  if (errorCount >= KILL_THRESHOLD) {
    ilog("kill switch tripped, disabling sampling permanently for this session");
    disabled = true;
    try {
      if (typeof engine !== "undefined" && typeof engine.off === "function" && handlerRef) {
        engine.off("PlayerTurnActivated", handlerRef);
        vlog("engine.off PlayerTurnActivated done");
      }
    } catch (e2) {
      elog("engine.off threw during kill:", e2);
    }
  }
}

/**
 * Invoke `fn`, returning its result, or undefined if it throws (counting the
 * failure toward the kill switch). Never throws.
 * @template T
 * @param {string} label A label for logging/error attribution.
 * @param {() => T} fn Thunk to invoke.
 * @returns {T | undefined} The result of `fn`, or undefined on error.
 */
function safeCall(label, fn) {
  try {
    if (DEMOGRAPHICS_DEBUG) vlog("about to call", label);
    const v = fn();
    if (DEMOGRAPHICS_DEBUG)
      vlog(label, "returned", typeof v, Array.isArray(v) ? "[len=" + v.length + "]" : "");
    return v;
  } catch (e) {
    tripIfTooMany(label, e);
    return undefined;
  }
}

/**
 * Resolve the local player (or observer) id defensively.
 * @returns {number | undefined} The numeric id, or undefined if unavailable.
 */
function getLocalPlayerID() {
  try {
    if (typeof GameContext !== "undefined" && GameContext != null) {
      const v = GameContext.localPlayerID;
      if (typeof v === "number") return v;
      const o = GameContext.localObserverID;
      if (typeof o === "number") return o;
    }
  } catch (e) {
    elog("getLocalPlayerID threw:", e);
  }
  return undefined;
}

/**
 * Get the list of alive major player ids, defensively.
 * @returns {Pid[]} The ids, or an empty array on any failure.
 */
function getAliveMajorIds() {
  return (
    safeCall("Players.getAliveMajorIds()", () => {
      if (typeof Players === "undefined") return [];
      if (typeof Players.getAliveMajorIds !== "function") return [];
      const arr = Players.getAliveMajorIds();
      return Array.isArray(arr) ? arr : [];
    }) || []
  );
}

/**
 * Get a player library handle defensively.
 * @param {Pid} id The player id.
 * @returns {*} The player handle, or undefined.
 */
function getPlayer(id) {
  return safeCall("Players.get(" + id + ")", () => {
    if (typeof Players === "undefined" || typeof Players.get !== "function") return undefined;
    return Players.get(id);
  });
}

// ---- numeric helpers -----------------------------------------------------

/**
 * Coerce to a finite number, or undefined.
 * @param {*} v Candidate value.
 * @returns {number | undefined} `v` if it is a finite number, else undefined.
 */
function safeNum(v) {
  return typeof v === "number" && isFinite(v) ? v : undefined;
}

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
  } catch (e) {
    /* swallow */
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
    /* swallow */
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
      if (DEMOGRAPHICS_DEBUG) vlog("node iter err in", treeKind, "for pid", pid, e);
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
function getCurrentAgeType() {
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
    /* */
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
    /* */
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
//   age-antiquity/data/progression-trees-culture-tot-common.xml:21
//   age-antiquity/data/progression-trees-culture-unique.xml:95+
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
      if (DEMOGRAPHICS_DEBUG) vlog("getPurchasedPlots err pid=", pid, e);
    }
  }
  return anyOK ? total : undefined;
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
 * (sloth global-relations-panel.js:127).
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {Pid} id The player id being sampled.
 * @param {*} p The sampled player handle.
 * @returns {void}
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
    /* leave undefined */
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
  } catch (e) {
    /* ignore */
  }
  try {
    rawCiv = p.civilizationType ?? p.CivilizationType;
    if (rawCiv !== undefined && rawCiv !== null) ctx.civType = rawCiv;
  } catch (e) {
    /* ignore */
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
    /* */
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
    // Vanilla uses `$hash` on GameInfo rows; see city-banners.js:266.
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
    /* swallow */
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
    /* */
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
 * `player.civilizationName` accessor (tutorial-items-antiquity.js:3528) which
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
    // Fallback: civilizationFullName (utilities-image.js:189).
    const full = p?.civilizationFullName;
    if (typeof full === "string" && full.length > 0) {
      return _composeLocale(full) || full;
    }
  } catch (_) {
    /* */
  }
  // Final fallback: the GameInfo row found by iteration (legacy path).
  return resolveDisplayName(civRow, "CivilizationType", rawCiv, "CIVILIZATION_", "");
}

/**
 * Resolve leader/civ display names + canonical type strings and store them on
 * `ctx`. GameInfo.Leaders.lookup accepts either hash or "LEADER_*" string
 * (civ-unlocks-model.js:18, map-utilities.js:24-25); LeaderType STRING for
 * <fxs-icon>/<leader-icon> is extracted as in model-diplo-ribbon.js:402.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {Pid} id The player id (used in the "Player N" fallback).
 * @param {*} p The sampled player handle.
 * @param {*} rawLeader The raw leader type value.
 * @param {*} rawCiv The raw civ type value.
 * @returns {void}
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
  vlog("civName (pid=" + id + ") = '" + ctx.civName + "'");

  // LeaderType STRING (canonical "LEADER_AUGUSTUS") for <fxs-icon> /
  // <leader-icon>. Vanilla extracts this exact way at
  // base-standard/ui/diplo-ribbon/model-diplo-ribbon.js:402.
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
  try {
    if (typeof rowType === "string" && rowType.length > 0) return rowType;
    if (typeof raw === "string" && raw.length > 0) return raw;
  } catch (_) {
    /* */
  }
  return undefined;
}

/**
 * Capture the player's banner colors. Pattern at
 * base-standard/ui/diplo-ribbon/model-diplo-ribbon.js:407-408.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {Pid} id The player id.
 * @returns {void}
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
    /* */
  }
}

/**
 * Read the gold balance off the player's Treasury handle.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {Pid} id The player id.
 * @param {*} p The sampled player handle.
 * @returns {void}
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
  }
  return cityList;
}

/**
 * Count fully-unlocked tech + culture nodes and store them on `ctx`. Vanilla
 * doesn't expose a numeric "researched count"; we iterate the tree.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {Pid} id The player id.
 * @param {*} p The sampled player handle.
 * @returns {void}
 */
function collectTechAndCivicCounts(ctx, id, p) {
  const techsN = countCompletedNodes(p, id, "Techs");
  if (typeof techsN === "number") ctx.techsCount = techsN;
  const civicsN = countCompletedNodes(p, id, "Culture");
  if (typeof civicsN === "number") ctx.civicsCount = civicsN;
}

/**
 * Read net yields + population/city/town counts off the Stats handle.
 * Numeric properties per model-diplo-ribbon.js:557,566,575.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {Pid} id The player id.
 * @param {*} stats The player Stats handle.
 * @returns {void}
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
  // model-diplo-ribbon.js:557,566,575).
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
  } catch (e) {
    /* ignore */
  }
  return undefined;
}

/**
 * Read the player-level trade-route count off the Trade handle.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {Pid} id The player id.
 * @param {*} p The sampled player handle.
 * @returns {void}
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
 * @returns {void}
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
 * player-wide accessor is unavailable). Cite model-city-capture-chooser.js:30,
 * peace-deal-tooltip.js:218.
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
      if (DEMOGRAPHICS_DEBUG) vlog("city wonders err pid=", id, e);
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
 * (advice-support.js:33), falling back to summing across cities.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {Pid} id The player id.
 * @param {*} stats The player Stats handle.
 * @param {*} cityList The city list for the fallback path.
 * @returns {void}
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
 * undamaged wonders. Cite endgame-cinematics.js:319-323. Used by the chart's
 * wonder-marker plugin to diff against the prior sample.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {Pid} id The player id.
 * @param {*} p The sampled player handle.
 * @returns {void}
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
    if (DEMOGRAPHICS_DEBUG) vlog("wonder type capture err pid=", id, e);
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
    /* per-wonder failure shouldn't kill the loop */
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
    /* ignore — empty map means 0 power, not a kill */
  }
  return statsByType;
}

/**
 * Merge one GameInfo.Unit_Stats row into the UnitType map, keeping the
 * strongest row when a unit has multiple (per-age) entries.
 * @param {Map<string, { Combat: number, RangedCombat: number, score: number }>} statsByType
 *   The map to mutate.
 * @param {*} row A GameInfo.Unit_Stats row.
 * @returns {void}
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
 * age-antiquity/ui/tutorial/tutorial-items-antiquity.js:218-221. The ENTIRE
 * iteration is wrapped in ONE safeCall so a single bad lookup doesn't trip the
 * kill switch repeatedly per turn.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {Pid} id The player id.
 * @param {*} p The sampled player handle.
 * @returns {void}
 */
function collectMilitaryPower(ctx, id, p) {
  safeCall("computeMilitaryPower(pid=" + id + ")", () => {
    const units = p.Units;
    if (!units || typeof units.getUnitIds !== "function") return;
    const ids = units.getUnitIds();
    if (!ids || typeof ids[Symbol.iterator] !== "function") return;
    // Build a quick UnitType -> stats row map once, lazily, per sample.
    const statsByType = buildUnitStatsByType();
    const { total, counted } = _sumUnitStrengths(ids, statsByType);
    if (counted > 0 || total > 0) ctx.militaryPower = total;
    else ctx.militaryPower = 0; // alive player with zero military still
    // gets a real "0" rather than dropped.
  });
}

/**
 * Iterate unit ids and sum military strength, skipping any unit that throws.
 * @param {Iterable<*>} ids The player's unit ids.
 * @param {Map<string, { Combat: number, RangedCombat: number, score: number }>} statsByType
 *   Map from {@link buildUnitStatsByType}.
 * @returns {{ total: number, counted: number }} The summed strength + count.
 */
function _sumUnitStrengths(ids, statsByType) {
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
      }
    } catch (_) {
      /* skip one bad unit, never trip the kill switch */
    }
  }
  return { total, counted };
}

/**
 * Capture the settlement cap + settlements-used.
 * Citation: base-standard/ui/diplo-ribbon/panel-yield-banner.js:208-209.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {*} stats The player Stats handle.
 * @returns {void}
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
 *   ui-next/screens/legacies/legacies-model.js:73   getProgress shape
 *   ui-next/screens/legacies/legacies-model.js:67   per-other-player access
 *   ui-next/screens/legacies/triumph-tracking-manager.js:73-83
 *   age-antiquity/data/legacies.xml:170-178         LegacySubtype values
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {*} p The sampled player handle.
 * @returns {void}
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
      /* */
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
 * ui-next/screens/victories/victories-screen-model.js:1096,1137.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {*} p The sampled player handle.
 * @returns {void}
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
    } catch (_) {}
  });
}

/**
 * Capture one Victories row's points into the matching `ctx` field, when the
 * row maps to a Modern victory and reports positive points.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {*} v The player's Victories handle.
 * @param {*} row A GameInfo.Victories row.
 * @returns {void}
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
  } catch (_) {}
}

/**
 * Score one OTHER player's contribution to `id`'s diplomatic approval. City-
 * states contribute via suzerainty (+2, damped later); majors via a weighted
 * relationship enum. Cite view-relations.js:164 (getRelationshipEnum), :501
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
    /* */
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
 * @returns {void}
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
    // varying across turns/civs (FIXES.md #3 — flatness diagnosis).
    vlog(
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
    /* */
  }
  return { major, cs };
}

/**
 * Resolve a single ResourceEntry's class string, accepting either the flat
 * `classType` shape or the nested `uniqueResource.resource` hash (which we
 * look up in GameInfo.Resources). Cite
 * base-standard/ui/resource-allocation/model-resource-allocation.js:126-131.
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
    /* */
  }
  return undefined;
}

/**
 * Tally a player's resources by class (Bonus / Empire / City / Factory /
 * Treasure) and store the counts + total on `ctx`.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {Pid} id The player id.
 * @param {*} p The sampled player handle.
 * @returns {void}
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
    vlog(
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
 * @returns {void}
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
    tradeRoutesCount: undefined,
    ongoingDealsCount: undefined,
    wondersCount: undefined,
    militaryPower: undefined,
    // Resolved names + LeaderType STRING (for <fxs-icon data-icon-id> /
    // <leader-icon leader=...>) — these elements need the canonical
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
function buildPlayerCtx(id) {
  const ctx = _newPlayerCtx(id);

  const p = getPlayer(id);
  if (!p) return ctx;
  ctx.player = p;

  // Snapshot of whether the LOCAL player has met this player at sample time.
  // Stored on snapshot.players[pid].met for downstream renderers (chart
  // legend / factbook / relations rings).
  collectMet(ctx, id, p);

  // leaderType / civType — keep the RAW value; resolve display names + the
  // canonical type strings HERE so the screen doesn't re-resolve at render.
  const { rawLeader, rawCiv } = collectRawTypes(ctx, p);
  collectNamesAndTypeStrings(ctx, id, p, rawLeader, rawCiv);

  // Player banner colors.
  collectColors(ctx, id);

  // Stats handle (used for score + yields + size counts)
  try {
    ctx.stats = p.Stats;
  } catch (e) {
    /* ignore */
  }
  const stats = ctx.stats;

  // Treasury / gold
  collectGold(ctx, id, p);

  // Cities -> settlement count + tiles owned + (cached for downstream)
  const cityList = collectCities(ctx, id, p);

  // Techs / Civics — count NODE_STATE_FULLY_UNLOCKED nodes.
  collectTechAndCivicCounts(ctx, id, p);

  // Yields via Stats.getNetYield + population / city / town counts.
  collectYieldsAndSizes(ctx, id, stats);

  // Trade routes — player-level total count.
  collectTradeRoutes(ctx, id, p);

  // Ongoing diplomatic actions involving this player.
  collectOngoingDeals(ctx, id);

  // Wonders — count then per-wonder identity capture.
  collectWonderCount(ctx, id, stats, cityList);
  collectWonderTypes(ctx, id, p);

  // Military Power — computed defensively from unit iteration.
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
 * The game-wide age + crisis context sampled once per snapshot and stamped
 * onto every player's ctx.
 * @typedef {object} GlobalAgeContext
 * @property {number} [crisisStage] Current crisis stage.
 * @property {number} crisisStageMax Highest stage trigger percent seen.
 * @property {number} [ageProgressPct] Age progress as a percentage.
 * @property {boolean} [ageEnabled] Whether the age crisis is enabled.
 * @property {string} [crisisEventType] Specific crisis event type, if probed.
 */

// Crisis + age progress are GAME-WIDE, not per-player. We sample them once
// per snapshot and stamp the value on every player's ctx so the existing
// per-civ chart pipeline can plot them (every civ gets the same line — by
// design, since crisis affects everyone in the age).
// Try to identify the SPECIFIC age-crisis event the game rolled this run
// (e.g. ANTIQUITY_CRISIS_PLAGUE vs ANTIQUITY_CRISIS_INVASION). The engine
// doesn't expose this on CrisisManager, but the choice is recorded in
// game-setup config. We probe several likely parameter names and accept the
// first that looks like an AgeCrisisEventType. Returns undefined on miss
// (callers fall back to age-themed flavor names).
/**
 * Probe game-setup config for the specific age-crisis event type.
 * @returns {string | undefined} The crisis event type, or undefined on miss.
 */
function probeCrisisEventType() {
  return safeCall("probeCrisisEventType", () => {
    if (typeof Configuration === "undefined" || !Configuration.getGame) return undefined;
    const cfg = Configuration.getGame();
    if (!cfg || typeof cfg.getValue !== "function") return undefined;
    const keys = [
      "Crisis",
      "CrisisType",
      "AgeCrisis",
      "AgeCrisisEvent",
      "AgeCrisisEventType",
      "CrisisEventType"
    ];
    for (const k of keys) {
      try {
        const v = cfg.getValue(k);
        if (typeof v === "string" && /^[A-Z_]+_CRISIS_[A-Z_]+$/.test(v)) return v;
      } catch (_) {
        /* */
      }
    }
    return undefined;
  });
}

/**
 * Read the crisis stage / trigger percents off Game.CrisisManager into `out`.
 * @param {GlobalAgeContext} out The context to mutate.
 * @returns {void}
 */
function readCrisisManager(out) {
  const cm = typeof Game !== "undefined" ? Game.CrisisManager : null;
  if (!cm) return;
  if (typeof cm.isCrisisEnabled === "function") {
    out.ageEnabled = !!cm.isCrisisEnabled(0);
  }
  if (typeof cm.getCurrentCrisisStage === "function") {
    const s = cm.getCurrentCrisisStage(0);
    if (typeof s === "number" && isFinite(s)) out.crisisStage = s;
  }
  _readCrisisStageMax(cm, out);
}

/**
 * Record the highest crisis-stage trigger percent (a per-stage constant) into
 * `out.crisisStageMax`, so consumers can normalise.
 * @param {*} cm The Game.CrisisManager handle.
 * @param {GlobalAgeContext} out The context to mutate.
 * @returns {void}
 */
function _readCrisisStageMax(cm, out) {
  if (typeof cm.getCrisisStageTriggerPercent !== "function") return;
  for (let st = 0; st < 4; st++) {
    try {
      const t = cm.getCrisisStageTriggerPercent(0, st);
      if (typeof t === "number" && isFinite(t) && t > out.crisisStageMax) {
        out.crisisStageMax = t;
      }
    } catch (_) {
      /* */
    }
  }
}

/**
 * Read the age-progress percentage off Game.AgeProgressManager into `out`.
 * @param {GlobalAgeContext} out The context to mutate.
 * @returns {void}
 */
function readAgeProgress(out) {
  const apm = typeof Game !== "undefined" ? Game.AgeProgressManager : null;
  if (!apm) return;
  let cur, max;
  try {
    cur = apm.getCurrentAgeProgressionPoints();
  } catch (_) {}
  try {
    max = apm.getMaxAgeProgressionPoints();
  } catch (_) {}
  if (typeof cur === "number" && typeof max === "number" && max > 0) {
    out.ageProgressPct = (cur / max) * 100;
  }
}

/**
 * Sample the game-wide age + crisis context once per snapshot.
 * @returns {GlobalAgeContext} The assembled global age context.
 */
function getGlobalAgeContext() {
  /** @type {GlobalAgeContext} */
  const out = {
    crisisStage: undefined,
    crisisStageMax: 0,
    ageProgressPct: undefined,
    ageEnabled: undefined,
    crisisEventType: undefined
  };
  safeCall("crisisAgeGlobal", () => {
    try {
      readCrisisManager(out);
      readAgeProgress(out);
    } catch (_) {
      /* */
    }
  });
  out.crisisEventType = probeCrisisEventType();
  return out;
}

/**
 * Read the current game turn defensively.
 * @returns {number | undefined} The current turn, or undefined.
 */
function getCurrentTurn() {
  return safeCall("Game.turn", () => {
    if (typeof Game !== "undefined" && typeof Game.turn === "number") return Game.turn;
    return undefined;
  });
}

// ---- the sampler ---------------------------------------------------------

/**
 * Read the in-game date label for the CURRENT turn (Game.getTurnDate reads the
 * current turn only). Citation: base-standard/ui/system-bar/
 * panel-system-bar.js:192.
 * @returns {string | undefined} The date label, or undefined.
 */
function readGameYear() {
  let gameYear;
  safeCall("getTurnDate", () => {
    if (typeof Game !== "undefined" && typeof Game.getTurnDate === "function") {
      const s = Game.getTurnDate();
      if (typeof s === "string" && s.length > 0) gameYear = s;
    }
  });
  return gameYear;
}

/**
 * Run all METRICS accessors (with optional scaling) over a per-civ ctx,
 * returning the metric-id → value map. NaN is never propagated.
 * @param {PlayerCtx} ctx The per-civ context.
 * @param {number} turn The current turn (scaling context).
 * @returns {Record<string, number>} The computed metrics.
 */
function computeMetrics(ctx, turn) {
  /** @type {Record<string, number>} */
  const metrics = {};
  const scaleCtx = { turn, sampleIndex: undefined };
  for (const m of METRICS) {
    try {
      let v = m.accessor(ctx);
      if (typeof v === "number" && isFinite(v)) {
        // Optional scaling pass; never propagate NaN.
        if (typeof m.scale === "function") {
          try {
            const sv = m.scale(v, scaleCtx, ctx);
            if (typeof sv === "number" && isFinite(sv)) v = sv;
          } catch (e) {
            if (DEMOGRAPHICS_DEBUG) vlog("scale fn threw for", m.id, e);
          }
        }
        metrics[m.id] = v;
      }
    } catch (e) {
      tripIfTooMany("metric accessor " + m.id, e);
    }
  }
  return metrics;
}

/**
 * Build the persisted per-player snapshot record from a sampled ctx + metrics.
 * @param {PlayerCtx} ctx The per-civ context.
 * @param {Record<string, number>} metrics The computed metrics.
 * @returns {object} The snapshot player record.
 */
function buildSnapshotPlayer(ctx, metrics) {
  return {
    leaderType: ctx.leaderType,
    civType: ctx.civType,
    leaderName: ctx.leaderName,
    civName: ctx.civName,
    leaderTypeString: ctx.leaderTypeString,
    civTypeString: ctx.civTypeString,
    primaryColor: ctx.primaryColor,
    secondaryColor: ctx.secondaryColor,
    met: ctx.met,
    metrics,
    // List of ConstructibleType strings for completed wonders this civ owns
    // at this turn. Used by the chart's wonder-marker plugin to diff against
    // the prior sample and identify which SPECIFIC wonder was completed (so
    // we can show its icon, name and a tooltip).
    wonderTypes: Array.isArray(ctx.wonderTypes) ? ctx.wonderTypes : undefined
  };
}

/**
 * Take one snapshot: sample every alive major player, persist it, and update
 * the war tracker. Returns the snapshot, or null if skipped/too-few-players.
 * @returns {Snapshot | null} The recorded snapshot, or null.
 */
function doSample() {
  const localTurn = getCurrentTurn() ?? -1;
  const ids = getAliveMajorIds();
  if (ids.length < 2) {
    ilog("skip sample: too few alive players (", ids.length, ") at localTurn=", localTurn);
    return null;
  }
  const globalAge = getGlobalAgeContext();
  // Each sample is stamped with:
  //   localTurn — Game.turn at sample time (age-local; resets per age)
  //   age       — current age type
  //   turn      — same as localTurn (no precomputed offset). The chart
  //               computes the GLOBAL X position at render time by
  //               walking all samples to build per-age offsets:
  //                 X(sample) = offsets[sample.age] + sample.localTurn
  //               This is robust to any historical offset corruption —
  //               we don't store stateful offsets that can drift.
  const ageType = getCurrentAgeType();
  const turn = localTurn;
  // Capture the in-game date label for this turn so chart x-axis labels can
  // show e.g. "T-52 / 2725 BCE".
  const gameYear = readGameYear();
  /** @type {Snapshot} */
  const snapshot = {
    turn,
    localTurn,
    age: ageType,
    gameYear,
    crisisEventType: globalAge.crisisEventType,
    players: {}
  };
  const players = snapshot.players || (snapshot.players = {});
  for (const pid of ids) {
    const ctx = buildPlayerCtx(pid);
    // Stamp game-wide age/crisis values so metric accessors can read them via
    // the same per-player ctx shape they use today.
    ctx.ageProgressPct = globalAge.ageProgressPct;
    ctx.crisisStage = globalAge.crisisStage;
    ctx.crisisStageMax = globalAge.crisisStageMax;
    const metrics = computeMetrics(ctx, turn);
    players[pid] = buildSnapshotPlayer(ctx, metrics);
  }
  try {
    DemographicsStorage.appendSample(snapshot);
    ilog(
      "appendSample OK localTurn=",
      localTurn,
      "age=",
      ageType,
      "players=",
      Object.keys(players).length
    );
  } catch (e) {
    tripIfTooMany("DemographicsStorage.appendSample", e);
  }
  runWarTracker(snapshot, turn);
  return snapshot;
}

// ---- war tracker ---------------------------------------------------------

/**
 * Resolve display info (civ/leader/color/type-string + isCS) for a pid, using
 * the snapshot first and falling back to live engine reads. Mirrors the trio
 * of CS checks view-relations.js uses (lines 133-135).
 * @param {Snapshot} snapshot The current snapshot (for cached player info).
 * @param {Pid | string} pid The player id.
 * @returns {WarRosterEntry} The resolved war-roster entry.
 */
function pidInfo(snapshot, pid) {
  const ps = snapshot.players?.[pid] || {};
  const live = _pidLiveInfo(pid, ps.civName);
  const civ = live.civ;
  const isCS = live.isCS || _isCSByName(civ);
  const civTypeString = ps.civTypeString || _civTypeStringFor(pid);
  return {
    pid,
    civ: civ || "Player " + pid,
    leader: ps.leaderName || "",
    color: ps.primaryColor || "#9aa8c8",
    civTypeString: civTypeString || undefined,
    isCS
  };
}

/**
 * Read the live player handle to fill in a missing civ name and the CS flag.
 * @param {Pid | string} pid The player id.
 * @param {*} cachedCiv The civ name already known from the snapshot, if any.
 * @returns {{ civ: *, isCS: boolean }} The (possibly resolved) civ + CS flag.
 */
function _pidLiveInfo(pid, cachedCiv) {
  let civ = cachedCiv;
  let isCS = false;
  try {
    const p = Players.get(Number(pid));
    if (p) {
      if (!civ && p.civilizationName) {
        civ =
          typeof Locale?.compose === "function"
            ? Locale.compose(p.civilizationName)
            : p.civilizationName;
      }
      isCS = detectCityState(p);
    }
  } catch (_) {}
  return { civ, isCS };
}

/**
 * Last-resort name-based CS detection: Independent Powers and city-state
 * encampments often surface as "Village"/"Independent" in civilizationName.
 * @param {*} civ The (possibly resolved) civ name.
 * @returns {boolean} True if the name looks like a city-state / IP.
 */
function _isCSByName(civ) {
  if (typeof civ !== "string") return false;
  const low = civ.toLowerCase();
  return (
    low === "village" ||
    low.startsWith("independent") ||
    low.startsWith("city-state") ||
    low.startsWith("cs ")
  );
}

/**
 * Resolve the CIVILIZATION_X type string for a pid via the live player handle,
 * so wars carry the canonical, DLC-safe type for adjective lookups.
 * @param {Pid | string} pid The player id.
 * @returns {string | undefined} The civilizationType string, or undefined.
 */
function _civTypeStringFor(pid) {
  try {
    const p = Players.get(Number(pid));
    const ct = p?.civilizationType;
    if (typeof ct === "string" && ct.length > 0) return ct;
  } catch (_) {
    /* */
  }
  return undefined;
}

/**
 * Determine whether a live player handle is a city-state / independent /
 * non-major civ, mirroring view-relations.js (lines 133-135).
 * @param {*} p A live player handle.
 * @returns {boolean} True if the player should be treated as a city-state.
 */
function detectCityState(p) {
  /**
   * Coerce a boolean-or-thunk player flag to a boolean (or undefined).
   * @param {*} v The flag value (boolean, function, or other).
   * @returns {boolean | undefined} The resolved flag, or undefined.
   */
  function flag(v) {
    if (typeof v === "boolean") return v;
    if (typeof v === "function") {
      try {
        return !!v.call(p);
      } catch (_) {}
    }
    return undefined;
  }
  let isCS = false;
  if (flag(p.isMinor) === true) isCS = true;
  if (flag(p.isIndependent) === true) isCS = true;
  if (flag(p.isCityState) === true) isCS = true;
  // Fallback: if explicitly NOT a major / full civ.
  if (!isCS) {
    const major = flag(p.isMajor);
    const fullCiv = flag(p.isFullCiv);
    if (major === false || fullCiv === false) isCS = true;
  }
  return isCS;
}

/**
 * Migrate legacy war records (aPid/bPid scalars) to the sideA/sideB array
 * schema and refresh rosters from current pidInfo() so the isCS flag reflects
 * the latest player state.
 * @param {Snapshot} snapshot The current snapshot (for pidInfo).
 * @param {WarRecord[]} wars The history.wars array (mutated in place).
 * @returns {void}
 */
function migrateWarRecords(snapshot, wars) {
  for (const w of wars) {
    _migrateWarRecord(w);
    // Always refresh rosters from the current pidInfo() so the isCS flag
    // reflects the latest player state — old records may have it stale.
    w.sideACivs = (w.sideA || []).map((p) => pidInfo(snapshot, p));
    w.sideBCivs = (w.sideB || []).map((p) => pidInfo(snapshot, p));
  }
}

/**
 * Migrate one legacy war record's roster fields from the old aPid/bPid scalar
 * schema to the sideA/sideB array schema (in place).
 * @param {WarRecord} w A history war record.
 * @returns {void}
 */
function _migrateWarRecord(w) {
  if (Array.isArray(w.sideA) && Array.isArray(w.sideB)) return;
  if (typeof w.aPid === "number" && typeof w.bPid === "number") {
    w.sideA = [w.aPid];
    w.sideB = [w.bPid];
    w.participants = [w.aPid, w.bPid];
  } else {
    w.sideA = w.sideA || [];
    w.sideB = w.sideB || [];
    if (typeof w.endTurn !== "number") w.endTurn = w.startTurn;
  }
}

/**
 * Coerce a heterogeneous list of player references (numbers or objects with
 * id/playerID/player) to a clean array of non-negative numeric pids.
 * @param {*} arr The raw list.
 * @returns {Pid[]} The extracted pids.
 */
function asPidList(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => {
      if (typeof x === "number") return x;
      if (x && typeof x === "object") {
        if (typeof x.id === "number") return x.id;
        if (typeof x.playerID === "number") return x.playerID;
        if (typeof x.player === "number") return x.player;
      }
      return null;
    })
    .filter((v) => typeof v === "number" && v >= 0);
}

/**
 * Read one DECLARE_WAR event header into a normalized war record and store it
 * (de-duped on uniqueID) in `activeWarsByID`. SideA = initiator + supporters;
 * SideB = target + opposers, with cross-membership stripped.
 * @param {*} ev A diplomacy event from getPlayerEvents.
 * @param {Map<*, ActiveWar>} activeWarsByID Accumulator keyed by uniqueID.
 * @returns {void}
 */
function ingestWarEvent(ev, activeWarsByID) {
  if (!ev || ev.actionTypeName !== "DIPLOMACY_ACTION_DECLARE_WAR") return;
  const uid = ev.uniqueID;
  if (uid == null || activeWarsByID.has(uid)) return;
  let header;
  try {
    header = Game.Diplomacy.getDiplomaticEventData(uid);
  } catch (_) {}
  if (!header) return;
  activeWarsByID.set(uid, _normalizeWarRecord(uid, header));
}

/**
 * Build the normalized active-war record from a uniqueID + event header. SideA
 * = initiator + supporters; SideB = target + opposers, with cross-membership
 * stripped to keep the bipartite split clean.
 * @param {*} uid The war uniqueID.
 * @param {*} header The diplomacy event header.
 * @returns {ActiveWar} The normalized war record.
 */
function _normalizeWarRecord(uid, header) {
  const { supporters, opposers } = _warEnvoyLists(uid);
  const initialPid = typeof header.initialPlayer === "number" ? header.initialPlayer : null;
  const targetPid = typeof header.targetPlayer === "number" ? header.targetPlayer : null;
  const sideASet = _buildWarSide(initialPid, supporters);
  const sideBSet = _buildWarSide(targetPid, opposers);
  // Engine sometimes returns the initiator listed in supporters and vice
  // versa — strip cross-membership.
  for (const id of sideASet) sideBSet.delete(id);
  return {
    uniqueID: uid,
    initialPid,
    targetPid,
    sideA: Array.from(sideASet),
    sideB: Array.from(sideBSet),
    headerStartTurn: header.startTurn ?? header.turn ?? null
  };
}

/**
 * Fetch a war's supporting + opposing players (with bonus envoys) defensively.
 * @param {*} uid The war uniqueID.
 * @returns {{ supporters: *[], opposers: *[] }} The raw lists (empty on error).
 */
function _warEnvoyLists(uid) {
  let supporters = [];
  let opposers = [];
  try {
    supporters = Game.Diplomacy.getSupportingPlayersWithBonusEnvoys(uid) || [];
  } catch (_) {}
  try {
    opposers = Game.Diplomacy.getOpposingPlayersWithBonusEnvoys(uid) || [];
  } catch (_) {}
  return { supporters, opposers };
}

/**
 * Build one war-side participant Set from a seed pid + a raw participant list.
 * @param {Pid | null} seedPid The initiator/target pid (or null).
 * @param {*[]} participants The raw supporting/opposing list.
 * @returns {Set<Pid>} The participant set.
 */
function _buildWarSide(seedPid, participants) {
  const set = new Set();
  if (seedPid !== null) set.add(seedPid);
  for (const id of asPidList(participants)) set.add(id);
  return set;
}

/**
 * Enumerate every active DECLARE_WAR event via getPlayerEvents(pid) for each
 * player and de-dupe on uniqueID. Returns null if the API is unavailable.
 * Citation: core/ui/utilities/diplomacy-utilities.js:70,
 * base-standard/ui/diplo-ribbon/model-diplo-ribbon.js:1088.
 * @param {*[]} allPlayers The alive players list.
 * @returns {Map<*, ActiveWar> | null} Active wars keyed by uniqueID, or null.
 */
function collectActiveWars(allPlayers) {
  const activeWarsByID = new Map();
  if (
    !Game?.Diplomacy ||
    typeof Game.Diplomacy.getPlayerEvents !== "function" ||
    typeof Game.Diplomacy.getDiplomaticEventData !== "function"
  ) {
    ilog("warTracker: Game.Diplomacy API unavailable, skipping turn");
    return null;
  }
  for (const p of allPlayers) {
    if (!p) continue;
    let events;
    try {
      events = Game.Diplomacy.getPlayerEvents(p.id);
    } catch (_) {
      events = null;
    }
    if (!Array.isArray(events)) continue;
    for (const ev of events) {
      ingestWarEvent(ev, activeWarsByID);
    }
  }
  return activeWarsByID;
}

/**
 * Update an existing history war record from freshly-enumerated war info
 * (expanding rosters and reopening if it was wrongly closed).
 * @param {WarRecord} existing The history war record (mutated in place).
 * @param {ActiveWar} info The normalized active-war info.
 * @param {WarRosterEntry[]} aRoster Side A roster entries.
 * @param {WarRosterEntry[]} bRoster Side B roster entries.
 * @param {*} uid The war uniqueID (for logging).
 * @returns {void}
 */
function updateExistingWar(existing, info, aRoster, bRoster, uid) {
  // Update participants in case the war expanded (joined allies).
  existing.sideA = info.sideA.slice();
  existing.sideB = info.sideB.slice();
  existing.participants = info.sideA.concat(info.sideB);
  existing.sideACivs = aRoster;
  existing.sideBCivs = bRoster;
  // If a previous close was wrong (UI lag, etc.), reopen.
  if (typeof existing.endTurn === "number") {
    existing.endTurn = null;
    existing.endYear = null;
    ilog("WAR REOPENED:", existing.name, "uid=", uid);
  }
}

/**
 * Construct a brand-new history war record (computing its ordinal name from
 * prior same-matchup wars).
 * @param {WarRecord[]} wars The history.wars array (read for ordinal counting).
 * @param {ActiveWar} info The normalized active-war info.
 * @param {WarRosterEntry[]} aRoster Side A roster entries.
 * @param {WarRosterEntry[]} bRoster Side B roster entries.
 * @param {Snapshot} snapshot The snapshot (for declarer pidInfo).
 * @param {string | undefined} gameYear The current game-year label.
 * @param {number} turn The current turn (used as a startTurn fallback).
 * @returns {WarRecord} The new war record.
 */
function buildNewWar(wars, info, aRoster, bRoster, snapshot, gameYear, turn) {
  const aName =
    aRoster
      .map((r) => r.civ)
      .sort()
      .join(" & ") || "Side A";
  const bName =
    bRoster
      .map((r) => r.civ)
      .sort()
      .join(" & ") || "Side B";
  const sortedNames = [aName, bName].sort();
  const priorCount = wars.filter(
    (w) => [w._nameKeyA || "", w._nameKeyB || ""].sort().join("|") === sortedNames.join("|")
  ).length;
  const ordinal = ordinalSuffix(priorCount + 1);
  const name = ordinal + " " + sortedNames[0] + " vs " + sortedNames[1] + " War";
  const declarer = pidInfo(snapshot, /** @type {Pid} */ (info.initialPid));
  return {
    warUniqueID: info.uniqueID,
    // `info.headerStartTurn` comes from the engine's diplomacy event header —
    // it's age-local (Game.turn at declaration). Add the current
    // cumulativeOffset so it lives in the same global coordinate space as the
    // chart's X axis (which is also global). Wars cross-age are
    // rare/non-existent in Civ7, so applying the current offset is sufficient.
    // `cumulativeOffset` is intentionally undeclared here — preserved verbatim
    // from the original (it ReferenceErrors at runtime, which the warTracker
    // safeCall swallows). Both directives keep the linters quiet without
    // altering that behavior. See the function-level note above.
    startTurn:
      // @ts-ignore intentional undeclared reference (see note)
      // eslint-disable-next-line no-undef
      typeof info.headerStartTurn === "number" ? info.headerStartTurn + cumulativeOffset : turn,
    endTurn: null,
    startYear: gameYear,
    endYear: null,
    sideA: info.sideA.slice(),
    sideB: info.sideB.slice(),
    participants: info.sideA.concat(info.sideB),
    sideACivs: aRoster,
    sideBCivs: bRoster,
    declaredBy: declarer
      ? {
          pid: declarer.pid,
          civ: declarer.civ,
          leader: declarer.leader
        }
      : null,
    _nameKeyA: sortedNames[0],
    _nameKeyB: sortedNames[1],
    name
  };
}

/**
 * Reconcile the active war set against history.wars[] keyed by uniqueID:
 * update existing records (expanding/reopening) and append new ones.
 * @param {WarRecord[]} wars The history.wars array (mutated in place).
 * @param {Map<*, ActiveWar>} activeWarsByID Active wars keyed by uniqueID.
 * @param {Snapshot} snapshot The current snapshot.
 * @param {string | undefined} gameYear The current game-year label.
 * @param {number} turn The current turn.
 * @returns {void}
 */
function reconcileWars(wars, activeWarsByID, snapshot, gameYear, turn) {
  const knownByID = new Map();
  for (const w of wars) {
    if (typeof w.warUniqueID === "number") knownByID.set(w.warUniqueID, w);
  }
  for (const [uid, info] of activeWarsByID) {
    const existing = knownByID.get(uid);
    const aRoster = info.sideA.map((p) => pidInfo(snapshot, p));
    const bRoster = info.sideB.map((p) => pidInfo(snapshot, p));
    if (existing) {
      updateExistingWar(existing, info, aRoster, bRoster, uid);
      continue;
    }
    const newWar = buildNewWar(wars, info, aRoster, bRoster, snapshot, gameYear, turn);
    wars.push(newWar);
    ilog(
      "WAR STARTED:",
      newWar.name,
      "uid=",
      uid,
      "declarer=pid" +
        info.initialPid +
        " (" +
        (pidInfo(snapshot, /** @type {Pid} */ (info.initialPid))?.civ || "?") +
        ")",
      "sideA=",
      info.sideA.join(","),
      "sideB=",
      info.sideB.join(",")
    );
  }
}

/**
 * Close any open war whose uniqueID is no longer in the active set (peace,
 * elimination, etc.); migrate-close pre-API legacy records on first pass.
 * @param {WarRecord[]} wars The history.wars array (mutated in place).
 * @param {Map<*, ActiveWar>} activeWarsByID Active wars keyed by uniqueID.
 * @param {string | undefined} gameYear The current game-year label.
 * @param {number} turn The current turn.
 * @returns {void}
 */
function closeEndedWars(wars, activeWarsByID, gameYear, turn) {
  for (const w of wars) {
    if (typeof w.endTurn === "number") continue;
    if (typeof w.warUniqueID !== "number") {
      // Pre-API legacy record with no uniqueID — close it on first pass after
      // migration so it doesn't linger forever.
      w.endTurn = turn;
      w.endYear = gameYear;
      ilog("WAR ENDED (legacy migration):", w.name, "turn=", turn);
      continue;
    }
    if (!activeWarsByID.has(w.warUniqueID)) {
      w.endTurn = turn;
      w.endYear = gameYear;
      ilog("WAR ENDED:", w.name, "uid=", w.warUniqueID, "turn=", turn);
    }
  }
}

/**
 * Build connected components of currently-at-war pairs (so a 2v2 coalition
 * becomes ONE war record) and reconcile against open wars in history.wars[].
 * Each war record carries sideA/sideB arrays so multi-civ conflicts are
 * first-class. Wrapped in safeCall to keep one bad turn from tripping the kill
 * switch.
 * @param {Snapshot} snapshot The just-recorded snapshot.
 * @param {number} turn The current turn.
 * @returns {void}
 */
function runWarTracker(snapshot, turn) {
  safeCall("warTracker", () => {
    const h = /** @type {WarHistory} */ (DemographicsStorage.load());
    if (!Array.isArray(h.wars)) h.wars = [];
    migrateWarRecords(snapshot, h.wars);
    const gameYear = _readTurnDate();
    const allPlayers = typeof Players?.getAlive === "function" ? Players.getAlive() : null;
    if (!Array.isArray(allPlayers)) return;

    const activeWarsByID = collectActiveWars(allPlayers);
    if (activeWarsByID === null) return;

    const wars = h.wars || [];
    reconcileWars(wars, activeWarsByID, snapshot, gameYear, turn);
    closeEndedWars(wars, activeWarsByID, gameYear, turn);
    DemographicsStorage.save(h);
  });
}

/**
 * Read the current turn's date label via Game.getTurnDate, using a bare
 * try/catch (no safeCall, so it never touches the kill switch).
 * @returns {string | undefined} The date label, or undefined.
 */
function _readTurnDate() {
  try {
    if (typeof Game !== "undefined" && typeof Game.getTurnDate === "function") {
      const s = Game.getTurnDate();
      if (typeof s === "string" && s.length > 0) return s;
    }
  } catch (_) {}
  return undefined;
}

// Returns "1st", "2nd", "3rd", "4th"... for any positive integer.
/**
 * Format an ordinal suffix for a positive integer.
 * @param {number} n The number.
 * @returns {string} e.g. "1st", "2nd", "3rd", "4th".
 */
function ordinalSuffix(n) {
  const s = ["th", "st", "nd", "rd"],
    v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * PlayerTurnActivated handler: samples the local player's turn, honoring the
 * kill switch and the configured polling cadence.
 * @param {*} data The event payload (carries `player`/`playerID`).
 * @returns {void}
 */
function onPlayerTurnActivated(data) {
  if (disabled) return;
  try {
    const localId = getLocalPlayerID();
    const evtPid = data && (data.player ?? data.playerID);
    if (typeof localId !== "number" || typeof evtPid !== "number") {
      vlog("skip: localId/evtPid not numeric", localId, evtPid);
      return;
    }
    if (evtPid !== localId) return; // local-player only

    // Throttle by user-configured polling rate. Off-cadence turns are
    // silently skipped — the in-game turn still advances, we just don't write
    // a new snapshot. lastSampledTurn is updated below only on successful
    // capture so a missed sample (e.g. due to error) doesn't shift the
    // cadence.
    const curTurn = _curGameTurn();
    if (!shouldSampleThisTurn(curTurn)) {
      vlog("skip turn", curTurn, "by polling rate (every", getPollEveryNTurns(), "turns)");
      return;
    }

    vlog("about to sample turn for localPlayer=", localId);
    const snap = doSample();
    if (snap) _noteSampleSucceeded(curTurn);
  } catch (e) {
    tripIfTooMany("onPlayerTurnActivated", e);
  }
}

/**
 * Bookkeeping after a successful sample: advance the cadence tracker and, on
 * the first success, downgrade log verbosity.
 * @param {number | undefined} curTurn The turn that was just sampled.
 * @returns {void}
 */
function _noteSampleSucceeded(curTurn) {
  if (typeof curTurn === "number") lastSampledTurn = curTurn;
  if (!firstSampleSucceeded) {
    firstSampleSucceeded = true;
    DEMOGRAPHICS_DEBUG = false; // downgrade verbosity after first success
    ilog("first sample SUCCEEDED; downgrading log verbosity for subsequent turns");
  }
}

// ---- age transition handler --------------------------------------------
//
// PlayerAgeTransitionComplete fires per-player as each civ finishes its
// transition into the new age. Payload shape `data.player` (a numeric pid)
// is cited from base-standard/ui/diplo-ribbon/model-diplo-ribbon.js:748-752.
// Event row exists at core/data/gamecore-events.xml:148.
//
// After transition:
//   - Cached current age (and the trees-by-age map) are stale; reset both.
//   - Append { turn, age } to history.ageBoundaries (once per age, not per pid).
//   - Force a sample now so the FIRST sample of the new age records the new civ.
/** @type {*} */
let _ageHandlerRef = null;

/**
 * Clear the age + trees caches and re-read the current age type.
 * @returns {string | undefined} The new (re-read) age type.
 */
function _readNewAgeType() {
  // Clear cache first so getCurrentAgeType re-reads Game.age.
  _cachedAgeType = undefined;
  _treesBySystemAndAge.clear();
  return getCurrentAgeType();
}

/**
 * Whether an age boundary for `age` at age-local `turn` is already recorded
 * (the transition event fires once per pid; we dedupe on age + localTurn).
 * @param {*} history The persisted history blob.
 * @param {string} age The new age type.
 * @param {number} turn The age-local Game.turn at transition.
 * @returns {boolean} True if already recorded.
 */
function _ageBoundaryAlreadyRecorded(history, age, turn) {
  const arr = history && history.ageBoundaries;
  if (!Array.isArray(arr)) return false;
  // Same age + same age-local turn = same transition event (multiple pids
  // report it). We check `b.localTurn` (the age-local Game.turn) because
  // `b.turn` was switched to a GLOBAL value for chart alignment — checking
  // against that would always miss and we'd append a fresh boundary for every
  // per-pid transition event.
  return arr.some((b) => {
    if (!b || b.age !== age) return false;
    if (typeof b.localTurn === "number") return b.localTurn === turn;
    // Back-compat with old boundary entries that only had `.turn`.
    return b.turn === turn;
  });
}

/**
 * Identify the age that just FINISHED, given the new age starting at `turn`.
 * The boundary fires when `newAge` BEGINS; the finished age is the one just
 * before this turn in the (sorted) boundary list.
 * @param {*} h The persisted history blob.
 * @param {string} newAge The new age type.
 * @param {number} turn The age-local turn at transition.
 * @returns {string} The finished age type.
 */
function _resolveFinishedAge(h, newAge, turn) {
  const sorted = h.ageBoundaries
    .slice()
    .sort((/** @type {*} */ a, /** @type {*} */ b) => (a.turn || 0) - (b.turn || 0));
  const idx = sorted.findIndex((/** @type {*} */ b) => b.age === newAge && b.turn === turn);
  if (idx > 0) return sorted[idx - 1].age;
  return "AGE_ANTIQUITY"; // first transition — finishing antiquity
}

/**
 * Snapshot per-civ TRIUMPH counts from the most recent sample for each civ
 * (the age-end totals), keyed by pid.
 * @param {*} h The persisted history blob.
 * @returns {Record<string, object>} The pid → triumph-snapshot map.
 */
function _buildLegacySnapshot(h) {
  /** @type {Record<string, object>} */
  const snap = {};
  const samps = h.samples || [];
  for (let i = samps.length - 1; i >= 0; i--) {
    const s = samps[i];
    if (!s?.players) continue;
    for (const pid of Object.keys(s.players)) {
      if (snap[pid]) continue;
      const rec = _legacyRecordForPlayer(s.players[pid]);
      if (rec) snap[pid] = rec;
    }
  }
  return snap;
}

/**
 * Build a single age-end triumph record from a snapshot player entry.
 * @param {*} ps A snapshot player record.
 * @returns {object | undefined} The triumph record, or undefined if no metrics.
 */
function _legacyRecordForPlayer(ps) {
  const m = ps.metrics;
  if (!m) return undefined;
  return {
    triumphs_cultural: m.triumphs_cultural || 0,
    triumphs_diplomatic: m.triumphs_diplomatic || 0,
    triumphs_economic: m.triumphs_economic || 0,
    triumphs_scientific: m.triumphs_scientific || 0,
    triumphs_militaristic: m.triumphs_militaristic || 0,
    triumphs_expansionist: m.triumphs_expansionist || 0,
    leaderName: ps.leaderName,
    civName: ps.civName,
    leaderType: ps.leaderType
  };
}

/**
 * Persist the age boundary (deduped across the per-pid stream) plus the
 * age-end triumph snapshot, bumping the cumulative turn-offset bookkeeping.
 * @param {string | undefined} newAge The new age type.
 * @param {number} turn The age-local Game.turn at transition.
 * @returns {void}
 */
function recordAgeBoundary(newAge, turn) {
  const h = /** @type {WarHistory} */ (DemographicsStorage.load());
  if (!newAge || _ageBoundaryAlreadyRecorded(h, newAge, turn)) return;
  // Clear obsolete stored offset (no longer used — chart computes X at render
  // time from age + localTurn). This also gets rid of garbage values like
  // offset=235 baked into earlier corrupt saves.
  delete h.cumulativeTurnOffset;
  h.ageBoundaries.push({
    turn, // age-local Game.turn at transition
    localTurn: turn,
    age: newAge
  });
  ilog("ageBoundary: recorded", newAge, "at localTurn=", turn);
  // Snapshot per-civ TRIUMPH counts at this moment — values from the latest
  // sample for each civ are the age-end totals. Stored under
  // history.legacySnapshots[age] (the storage key is kept as `legacySnapshots`
  // for back-compat; the contained data is the new triumph-count shape).
  if (!h.legacySnapshots || typeof h.legacySnapshots !== "object") {
    h.legacySnapshots = {};
  }
  const finishedAge = _resolveFinishedAge(h, newAge, turn);
  const snap = _buildLegacySnapshot(h);
  h.legacySnapshots[finishedAge] = snap;
  DemographicsStorage.save(h);
  ilog(
    "appended ageBoundary turn=",
    turn,
    "age=",
    newAge,
    "legacySnapshot=",
    finishedAge,
    "civs=",
    Object.keys(snap).length
  );
}

/**
 * PlayerAgeTransitionComplete handler: resets caches, records the age boundary
 * once, and re-samples immediately so the new civ name lands in history.
 * @param {*} data The event payload (carries `player`).
 * @returns {void}
 */
function onPlayerAgeTransitionComplete(data) {
  if (disabled) return;
  try {
    const newAge = _readNewAgeType();
    const turn = getCurrentTurn() ?? -1;
    ilog("PlayerAgeTransitionComplete pid=", data && data.player, "newAge=", newAge, "turn=", turn);

    // Persist the boundary (dedupe across the per-pid stream).
    try {
      recordAgeBoundary(newAge, turn);
    } catch (e) {
      tripIfTooMany("appendAgeBoundary", e);
    }

    // Re-sample immediately so the new civ name lands in history right away.
    try {
      doSample();
    } catch (e) {
      tripIfTooMany("post-transition sample", e);
    }
  } catch (e) {
    tripIfTooMany("onPlayerAgeTransitionComplete", e);
  }
}

/**
 * Tear down any stale subscriptions left over from a prior game session. Both
 * engine.off calls are safe no-ops if nothing was registered.
 * @returns {void}
 */
function teardownStaleSubscriptions() {
  if (typeof engine !== "undefined" && typeof engine.off === "function") {
    try {
      if (handlerRef) engine.off("PlayerTurnActivated", handlerRef);
    } catch (e) {
      vlog("engine.off PlayerTurnActivated (stale) threw:", /** @type {*} */ (e)?.message);
    }
    try {
      if (_ageHandlerRef) engine.off("PlayerAgeTransitionComplete", _ageHandlerRef);
    } catch (e) {
      vlog("engine.off PlayerAgeTransitionComplete (stale) threw:", /** @type {*} */ (e)?.message);
    }
  }
}

/**
 * Reset every cross-load piece of sampler state to its fresh-game defaults and
 * seed the poll-cadence tracker from the most recent stored sample so a resume
 * kickoff doesn't re-record an already-stored turn.
 * @returns {void}
 */
function resetSamplerState() {
  handlerRef = null;
  _ageHandlerRef = null;
  started = false;
  // Clear any prior-session kill state — the new game deserves a fresh budget
  // of retries before we decide the sampler is broken.
  disabled = false;
  errorCount = 0;
  firstSampleSucceeded = false;
  // Seed the poll-cadence tracker from the most recent stored sample.
  try {
    const h = DemographicsStorage.load?.();
    if (h && Array.isArray(h.samples) && h.samples.length > 0) {
      const last = h.samples[h.samples.length - 1];
      if (last && typeof last.turn === "number") lastSampledTurn = last.turn;
    }
  } catch (_) {
    /* */
  }
}

/**
 * The deferred resume sample. Important: this runs AFTER the save's
 * GameTutorial properties have been deserialized (see startSampler comment),
 * so DemographicsStorage.load() reads the real persisted history rather than
 * clobbering it with a fresh first sample.
 * @returns {void}
 */
function runKickoff() {
  try {
    if (disabled) return;
    const curTurn = _curGameTurn();
    const storedCount = _storedSampleCount();
    ilog("startSampler runKickoff: storedCount=", storedCount, "curTurn=", curTurn);
    if (storedCount === 0 || shouldSampleThisTurn(curTurn)) {
      ilog("startSampler: kicking off resume sample for turn", curTurn);
      const snap = doSample();
      if (snap && typeof curTurn === "number") lastSampledTurn = curTurn;
    } else {
      ilog(
        "startSampler: skipping resume sample — turn",
        curTurn,
        "off-cadence; last sampled turn",
        lastSampledTurn
      );
    }
  } catch (e) {
    tripIfTooMany("resumeSample", e);
  }
}

/**
 * Read Game.turn defensively (raw, no safeCall).
 * @returns {number | undefined} The current turn, or undefined.
 */
function _curGameTurn() {
  return typeof Game !== "undefined" && typeof Game.turn === "number" ? Game.turn : undefined;
}

/**
 * Count stored samples, swallowing any storage error.
 * @returns {number} The number of stored samples (0 on failure).
 */
function _storedSampleCount() {
  try {
    return DemographicsStorage.load?.()?.samples?.length || 0;
  } catch (_) {
    return 0;
  }
}

/**
 * Register the PlayerTurnActivated + PlayerAgeTransitionComplete handlers and
 * schedule the deferred resume kickoff. Assumes state has already been reset.
 * @returns {void}
 */
function registerSamplerHandlers() {
  try {
    handlerRef = (/** @type {*} */ data) => onPlayerTurnActivated(data);
    engine.on("PlayerTurnActivated", handlerRef);
    _ageHandlerRef = (/** @type {*} */ data) => onPlayerAgeTransitionComplete(data);
    engine.on("PlayerAgeTransitionComplete", _ageHandlerRef);
    started = true;
    ilog(
      "subscribed to PlayerTurnActivated + PlayerAgeTransitionComplete",
      "(re-registered fresh on load, kill at",
      KILL_THRESHOLD,
      "errors)"
    );
    // Important: defer the kickoff sample until AFTER the game's save data has
    // actually been deserialized into GameTutorial. The map-tack mod (working
    // reference) uses Loading.runWhenLoaded for the same reason.
    // `engine.whenReady` only tells us the engine is alive, NOT that the
    // save's GameTutorial properties have been populated. If we sample before
    // that, DemographicsStorage.load() reads empty, we write a "fresh" first
    // sample, the save layer treats it as truth, and the real antiquity
    // history persisted in the save file gets clobbered — the root cause of
    // "no antiquity persistence across the age transition" (age transition is
    // a save→load cycle and we've been racing the deserializer).
    if (typeof Loading !== "undefined" && typeof Loading.runWhenLoaded === "function") {
      ilog("startSampler: deferring kickoff until Loading.runWhenLoaded");
      Loading.runWhenLoaded(runKickoff);
    } else {
      // Loading API unavailable — fall back to the timeout-based kickoff so we
      // don't break in test contexts.
      ilog("startSampler: Loading.runWhenLoaded unavailable; using 250ms timeout fallback");
      setTimeout(runKickoff, 250);
    }
  } catch (e) {
    elog("engine.on threw during startSampler:", e);
  }
}

/**
 * Start (or restart) the per-turn sampler. Saved-game load re-runs bootstrap →
 * calls startSampler() again. The sampler MODULE is cached for the lifetime of
 * the Coherent JS process, so module-scope state persists into the new game.
 * That used to make us refuse to re-register, carry a stale handler ref, and
 * honor a kill switch from the previous game — silently stopping recording on
 * the new save. We tear down stale subscriptions, reset every cross-load piece
 * of state, and always re-register fresh.
 * @returns {void}
 */
export function startSampler() {
  teardownStaleSubscriptions();
  resetSamplerState();

  if (typeof engine === "undefined" || typeof engine.on !== "function") {
    elog("engine.on unavailable; cannot start sampler");
    return;
  }
  registerSamplerHandlers();
}

/**
 * Whether the sampler has tripped its kill switch this session.
 * @returns {boolean} True if sampling is permanently disabled this session.
 */
export function isSamplerDisabled() {
  return disabled;
}

// On-demand sample so the modal can force a snapshot when it opens with
// an empty history.
/**
 * Force a snapshot on demand (e.g. when the modal opens with empty history).
 * @returns {Snapshot | null} The recorded snapshot, or null if disabled/failed.
 */
export function sampleNow() {
  if (disabled) {
    ilog("sampleNow called but sampler is disabled");
    return null;
  }
  try {
    ilog("sampleNow invoked");
    return doSample();
  } catch (e) {
    tripIfTooMany("sampleNow", e);
    return null;
  }
}
