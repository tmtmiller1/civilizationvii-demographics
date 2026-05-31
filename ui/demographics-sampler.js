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

// How many turns between samples. Resolved from the user setting each call
// so a runtime change in the Options panel takes effect on the next turn
// without needing to restart the sampler.
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
function shouldSampleThisTurn(turn) {
  if (typeof turn !== "number") return true;
  const n = getPollEveryNTurns();
  if (n <= 1) return true;
  if (turn === lastSampledTurn) return false;
  if (turn % n !== 0) return false;
  return true;
}

let DEMOGRAPHICS_DEBUG = true;
function vlog(...a) {
  if (DEMOGRAPHICS_DEBUG) console.warn("[Demographics.sampler]", ...a);
}
function ilog(...a) {
  console.warn("[Demographics.sampler]", ...a);
}
function elog(...a) {
  console.error("[Demographics.sampler]", ...a);
}

// ---- kill switch ---------------------------------------------------------
let errorCount = 0;
const KILL_THRESHOLD = 3;
let disabled = false;
let started = false;
let firstSampleSucceeded = false;
let handlerRef = null;

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

function getPlayer(id) {
  return safeCall("Players.get(" + id + ")", () => {
    if (typeof Players === "undefined" || typeof Players.get !== "function") return undefined;
    return Players.get(id);
  });
}

// ---- numeric helpers -----------------------------------------------------

function safeNum(v) {
  return typeof v === "number" && isFinite(v) ? v : undefined;
}

// Resolve a YieldTypes.YIELD_* enum value defensively. Returns undefined if
// either the global isn't there or the specific key isn't defined.
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

// Count nodes in a single tree object whose state === FULLY_UNLOCKED for pid.
function countNodesInTree(tree, pid, treeKind) {
  if (!tree || !Array.isArray(tree.nodes)) return 0;
  const fullyUnlocked = _resolveFullyUnlockedState();
  let count = 0;
  for (const node of tree.nodes) {
    try {
      const nodeType = node?.nodeType ?? node?.type ?? node;
      if (nodeType === undefined) continue;
      let state = undefined;
      if (
        typeof Game !== "undefined" &&
        Game.ProgressionTrees &&
        typeof Game.ProgressionTrees.getNodeState === "function"
      ) {
        state = Game.ProgressionTrees.getNodeState(pid, nodeType);
      }
      if (fullyUnlocked !== undefined && state === fullyUnlocked) {
        count++;
        continue;
      }
      if (fullyUnlocked === undefined) {
        const nd =
          typeof Game !== "undefined" &&
          Game.ProgressionTrees &&
          typeof Game.ProgressionTrees.getNode === "function"
            ? Game.ProgressionTrees.getNode(pid, nodeType)
            : undefined;
        if (nd && typeof nd.depthUnlocked === "number" && nd.depthUnlocked > 0) {
          count++;
        }
      }
    } catch (e) {
      if (DEMOGRAPHICS_DEBUG) vlog("node iter err in", treeKind, "for pid", pid, e);
    }
  }
  return count;
}

// Returns the current age type string (e.g. "AGE_ANTIQUITY") or undefined.
// Cached at module level per turn-load to avoid repeated lookups.
let _cachedAgeType;
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
const _treesBySystemAndAge = new Map();
function getTreesForSystem(systemType) {
  const age = getCurrentAgeType();
  const cacheKey = systemType + "|" + (age || "ANY");
  if (_treesBySystemAndAge.has(cacheKey)) return _treesBySystemAndAge.get(cacheKey);
  const list = [];
  try {
    if (
      typeof GameInfo?.ProgressionTrees !== "undefined" &&
      GameInfo.ProgressionTrees[Symbol.iterator]
    ) {
      for (const row of GameInfo.ProgressionTrees) {
        if (!row) continue;
        if (row.SystemType !== systemType) continue;
        if (age && row.AgeType && row.AgeType !== age) continue;
        list.push(row.ProgressionTreeType);
      }
    }
  } catch (_) {
    /* */
  }
  _treesBySystemAndAge.set(cacheKey, list);
  return list;
}

// Count progression-tree nodes that are FULLY UNLOCKED for a player across
// ALL relevant trees for the given branch.
//   treeKind === "Techs"   → all SYSTEM_TECH trees of the current age
//   treeKind === "Culture" → all SYSTEM_CULTURE trees of the current age
// (Civ7 gives each civ access to mainline + civ-unique tree; we sum both.)
// ProgressionTree.SystemType cited from
//   age-antiquity/data/progression-trees-culture-tot-common.xml:21
//   age-antiquity/data/progression-trees-culture-unique.xml:95+
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
function sumOwnedTiles(cityList, pid) {
  if (!Array.isArray(cityList)) return undefined;
  let total = 0;
  let anyOK = false;
  for (const c of cityList) {
    try {
      if (c && typeof c.getPurchasedPlots === "function") {
        const plots = c.getPurchasedPlots();
        if (Array.isArray(plots)) {
          total += plots.length;
          anyOK = true;
        } else if (plots && typeof plots.length === "number") {
          total += plots.length;
          anyOK = true;
        }
      }
    } catch (e) {
      if (DEMOGRAPHICS_DEBUG) vlog("getPurchasedPlots err pid=", pid, e);
    }
  }
  return anyOK ? total : undefined;
}

// Pull only-safe surface from a Player handle. All deeply-nested calls split.
function buildPlayerCtx(id) {
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

  const p = getPlayer(id);
  if (!p) return ctx;
  ctx.player = p;

  // Snapshot of whether the LOCAL player has met this player at sample time.
  // Read defensively from the local player's Diplomacy.hasMet(otherPid)
  // (sloth global-relations-panel.js:127). The local player is always met.
  // Stored on snapshot.players[pid].met for downstream renderers (chart
  // legend / factbook / relations rings).
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

  // leaderType / civType — keep the RAW value (typically a numeric hash on
  // most builds; sometimes a "LEADER_*" string). GameInfo.Leaders.lookup
  // accepts either form (see core/ui-next/screens/unlocks/civ-unlocks-model.js:18
  // and base-standard/maps/map-utilities.js:24-25), but coercing to a digit
  // string ("3506950841") breaks the lookup. We also resolve the display
  // name HERE so the screen doesn't have to re-resolve at render time.
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

  // Resolve the display name ONCE at sample time. Stored on the snapshot
  // as `leaderName` so legend/factbook code can just read it.
  const leaderRow = (() => {
    try {
      if (typeof GameInfo === "undefined" || !GameInfo.Leaders) return null;
      if (
        typeof GameInfo.Leaders.lookup === "function" &&
        rawLeader !== undefined &&
        rawLeader !== null
      ) {
        const direct = GameInfo.Leaders.lookup(rawLeader);
        if (direct) return direct;
        // Try the string form too in case this build expects a typed string.
        const asStr = String(rawLeader);
        if (asStr !== "") {
          const byStr = GameInfo.Leaders.lookup(asStr);
          if (byStr) return byStr;
        }
      }
      // Last resort: iterate the table looking for matching Hash / LeaderType.
      const iter = GameInfo.Leaders;
      if (iter && typeof iter[Symbol.iterator] === "function") {
        for (const row of iter) {
          if (!row) continue;
          // Vanilla uses `$hash` (e.g. city-banners.js:266:
          // `GameInfo.CityStateBonuses.find(t => t.$hash == bonusType)`).
          // `Hash` (no $) doesn't exist on these rows.
          if (row.$hash === rawLeader || row.Hash === rawLeader) return row;
          if (typeof rawLeader === "string" && row.LeaderType === rawLeader) return row;
        }
      }
    } catch (_) {
      /* swallow */
    }
    return null;
  })();
  ctx.leaderName = (() => {
    try {
      const nm = leaderRow?.Name;
      if (nm) {
        if (typeof Locale !== "undefined" && typeof Locale.compose === "function") {
          try {
            return Locale.compose(nm);
          } catch (_) {
            /* */
          }
        }
        return String(nm);
      }
    } catch (_) {
      /* */
    }
    const typeStr = leaderRow?.LeaderType || (typeof rawLeader === "string" ? rawLeader : "");
    if (typeStr) {
      return String(typeStr)
        .replace(/^LEADER_/, "")
        .split("_")
        .map((w) => (w[0] ? w[0].toUpperCase() : "") + w.slice(1).toLowerCase())
        .join(" ");
    }
    return "Player " + id;
  })();

  // Resolve civilization name similarly so Factbook can show "Rome", "Egypt", etc.
  const civRow = (() => {
    try {
      if (typeof GameInfo === "undefined" || !GameInfo.Civilizations) return null;
      if (
        typeof GameInfo.Civilizations.lookup === "function" &&
        rawCiv !== undefined &&
        rawCiv !== null
      ) {
        const direct = GameInfo.Civilizations.lookup(rawCiv);
        if (direct) return direct;
        const asStr = String(rawCiv);
        if (asStr !== "") {
          const byStr = GameInfo.Civilizations.lookup(asStr);
          if (byStr) return byStr;
        }
      }
      // Last resort: iterate the table looking for matching Hash / CivilizationType.
      // Mirrors the Leader-resolution iteration above so a numeric-hash civType
      // still resolves when `lookup()` won't accept it directly.
      const iter = GameInfo.Civilizations;
      if (iter && typeof iter[Symbol.iterator] === "function") {
        for (const row of iter) {
          if (!row) continue;
          // Vanilla uses `$hash` on GameInfo rows; see city-banners.js:266.
          if (row.$hash === rawCiv || row.Hash === rawCiv) return row;
          if (typeof rawCiv === "string" && row.CivilizationType === rawCiv) return row;
        }
      }
    } catch (_) {
      /* swallow */
    }
    return null;
  })();
  ctx.civName = (() => {
    // DIRECT accessor — `player.civilizationName` returns the LOC tag
    // for the civ's display name. Cited:
    //   age-antiquity/ui/tutorial/tutorial-items-antiquity.js:3528
    //   `civName = player.civilizationName;`
    // This bypasses the unreliable GameInfo.Civilizations.lookup() path
    // that returns null for numeric-hash civType.
    try {
      const direct = p?.civilizationName;
      if (typeof direct === "string" && direct.length > 0) {
        if (typeof Locale !== "undefined" && typeof Locale.compose === "function") {
          try {
            const s = Locale.compose(direct);
            if (typeof s === "string" && s.length > 0) return s;
          } catch (_) {
            /* */
          }
        }
        return direct;
      }
      // Fallback: civilizationFullName (utilities-image.js:189).
      const full = p?.civilizationFullName;
      if (typeof full === "string" && full.length > 0) {
        if (typeof Locale?.compose === "function") {
          try {
            const s = Locale.compose(full);
            if (typeof s === "string" && s.length > 0) return s;
          } catch (_) {
            /* */
          }
        }
        return full;
      }
    } catch (_) {
      /* */
    }
    // Final fallback: the GameInfo row found by iteration (legacy path).
    try {
      const nm = civRow?.Name;
      if (nm) {
        if (typeof Locale?.compose === "function") {
          try {
            return Locale.compose(nm);
          } catch (_) {
            /* */
          }
        }
        return String(nm);
      }
    } catch (_) {
      /* */
    }
    const typeStr = civRow?.CivilizationType || (typeof rawCiv === "string" ? rawCiv : "");
    if (typeStr) {
      return String(typeStr)
        .replace(/^CIVILIZATION_/, "")
        .split("_")
        .map((w) => (w[0] ? w[0].toUpperCase() : "") + w.slice(1).toLowerCase())
        .join(" ");
    }
    return "";
  })();
  vlog("civName (pid=" + id + ") = '" + ctx.civName + "'");

  // LeaderType STRING (canonical "LEADER_AUGUSTUS") for <fxs-icon> /
  // <leader-icon>. Vanilla extracts this exact way at
  // base-standard/ui/diplo-ribbon/model-diplo-ribbon.js:402.
  try {
    const lt = leaderRow?.LeaderType;
    if (typeof lt === "string" && lt.length > 0) ctx.leaderTypeString = lt;
    else if (typeof rawLeader === "string" && rawLeader.length > 0)
      ctx.leaderTypeString = rawLeader;
  } catch (_) {
    /* */
  }
  try {
    const ct = civRow?.CivilizationType;
    if (typeof ct === "string" && ct.length > 0) ctx.civTypeString = ct;
    else if (typeof rawCiv === "string" && rawCiv.length > 0) ctx.civTypeString = rawCiv;
  } catch (_) {
    /* */
  }

  // Player banner colors. Pattern at
  // base-standard/ui/diplo-ribbon/model-diplo-ribbon.js:407-408.
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

  // Stats handle (used for score + yields + size counts)
  try {
    ctx.stats = p.Stats;
  } catch (e) {
    /* ignore */
  }
  const stats = ctx.stats;

  // Treasury / gold
  const treasury = safeCall("p.Treasury (pid=" + id + ")", () => p.Treasury);
  if (treasury) {
    const g = safeCall("treasury.getGoldBalance() (pid=" + id + ")", () => {
      if (typeof treasury.getGoldBalance === "function") return treasury.getGoldBalance();
      if (typeof treasury.goldBalance === "number") return treasury.goldBalance;
      return undefined;
    });
    if (typeof g === "number" && isFinite(g)) ctx.gold = g;
  }

  // Cities -> settlement count + tiles owned + (cached for downstream)
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

  // Techs / Civics — vanilla doesn't expose a numeric "researched count";
  // we iterate the tree and count NODE_STATE_FULLY_UNLOCKED nodes.
  const techsN = countCompletedNodes(p, id, "Techs");
  if (typeof techsN === "number") ctx.techsCount = techsN;
  const civicsN = countCompletedNodes(p, id, "Culture");
  if (typeof civicsN === "number") ctx.civicsCount = civicsN;

  // Yields via Stats.getNetYield(YieldTypes.YIELD_*)
  if (stats) {
    ctx.yieldGold = netYield(stats, "YIELD_GOLD", id);
    ctx.yieldScience = netYield(stats, "YIELD_SCIENCE", id);
    ctx.yieldCulture = netYield(stats, "YIELD_CULTURE", id);
    ctx.yieldHappiness = netYield(stats, "YIELD_HAPPINESS", id);
    ctx.yieldProduction = netYield(stats, "YIELD_PRODUCTION", id);
    ctx.yieldFood = netYield(stats, "YIELD_FOOD", id);
    ctx.yieldDiplomacy = netYield(stats, "YIELD_DIPLOMACY", id);

    // Population / city / town counts (numeric properties per
    // model-diplo-ribbon.js:557,566,575).
    try {
      const tp = stats.totalPopulation;
      if (typeof tp === "number" && isFinite(tp)) ctx.totalPopulation = tp;
    } catch (e) {
      /* ignore */
    }
    try {
      const nc = stats.numCities;
      if (typeof nc === "number" && isFinite(nc)) ctx.citiesCount = nc;
    } catch (e) {
      /* ignore */
    }
    try {
      const nt = stats.numTowns;
      if (typeof nt === "number" && isFinite(nt)) ctx.townsCount = nt;
    } catch (e) {
      /* ignore */
    }
  }

  // Trade routes — player-level total count.
  const trade = safeCall("p.Trade (pid=" + id + ")", () => p.Trade);
  if (trade) {
    const tr = safeCall("trade.countPlayerTradeRoutes() (pid=" + id + ")", () => {
      if (typeof trade.countPlayerTradeRoutes === "function") return trade.countPlayerTradeRoutes();
      return undefined;
    });
    if (typeof tr === "number" && isFinite(tr)) ctx.tradeRoutesCount = tr;
  }

  // Ongoing diplomatic actions involving this player.
  // Game.Diplomacy.getPlayerEvents(pid) returns array of action records.
  // We count actions the player initiated OR is the target of.
  const events = safeCall("Game.Diplomacy.getPlayerEvents(" + id + ")", () => {
    if (typeof Game === "undefined" || !Game.Diplomacy) return undefined;
    if (typeof Game.Diplomacy.getPlayerEvents !== "function") return undefined;
    const arr = Game.Diplomacy.getPlayerEvents(id);
    return Array.isArray(arr) ? arr : undefined;
  });
  if (Array.isArray(events)) ctx.ongoingDealsCount = events.length;

  // Wonders — prefer player.Stats.getNumWonders(false, false) (player-wide,
  // all ages). Cite advice-support.js:33. Fall back to summing
  // city.Constructibles.getNumWonders() across cityList per
  // model-city-capture-chooser.js:30, peace-deal-tooltip.js:218.
  if (stats && typeof stats.getNumWonders === "function") {
    const wn = safeCall("stats.getNumWonders(false,false) (pid=" + id + ")", () => {
      const v = stats.getNumWonders(false, false);
      return safeNum(v);
    });
    if (typeof wn === "number") ctx.wondersCount = wn;
  }
  if (ctx.wondersCount === undefined && Array.isArray(cityList)) {
    let total = 0;
    let anyOK = false;
    for (const c of cityList) {
      try {
        const con = c?.Constructibles;
        if (con && typeof con.getNumWonders === "function") {
          const n = con.getNumWonders();
          if (typeof n === "number" && isFinite(n)) {
            total += n;
            anyOK = true;
          }
        }
      } catch (e) {
        if (DEMOGRAPHICS_DEBUG) vlog("city wonders err pid=", id, e);
      }
    }
    if (anyOK) ctx.wondersCount = total;
  }

  // Per-wonder identity capture. Cite:
  //   endgame-cinematics.js:319-323 — getWonders(playerId) returns
  //   ComponentIDs, then Constructibles.getByComponentID(id) → object
  //   with `type` (a hash) which GameInfo.Constructibles.lookup() maps
  //   to a row carrying ConstructibleType/Name. We store the
  //   ConstructibleType strings on the sample so the chart can detect
  //   newly-built wonders per turn (by diffing this turn's list vs
  //   the prior sample's) and look up the matching icon/name.
  try {
    const playerCon = p?.Constructibles;
    if (
      playerCon &&
      typeof playerCon.getWonders === "function" &&
      typeof Constructibles !== "undefined" &&
      typeof Constructibles.getByComponentID === "function"
    ) {
      const wonderComps = playerCon.getWonders(id);
      if (Array.isArray(wonderComps)) {
        const types = [];
        for (const wc of wonderComps) {
          try {
            const con = Constructibles.getByComponentID(wc);
            if (!con || !con.complete || con.damaged) continue;
            const info =
              typeof GameInfo !== "undefined" &&
              GameInfo.Constructibles &&
              typeof GameInfo.Constructibles.lookup === "function"
                ? GameInfo.Constructibles.lookup(con.type)
                : null;
            const ct = info && info.ConstructibleType;
            if (typeof ct === "string" && ct.length > 0) types.push(ct);
          } catch (_) {
            /* per-wonder failure shouldn't kill the loop */
          }
        }
        if (types.length > 0) ctx.wonderTypes = types;
      }
    }
  } catch (e) {
    if (DEMOGRAPHICS_DEBUG) vlog("wonder type capture err pid=", id, e);
  }

  // Military Power — no clean player-level accessor exists in the vanilla
  // corpus (grep produced zero hits for militaryPower / MilitaryStrength /
  // getMilitaryStrength). Computed defensively from unit iteration:
  //   for unitID of player.Units.getUnitIds():
  //     unit = Units.get(unitID)
  //     def  = GameInfo.Units.lookup(unit.type)
  //     if def.FormationClass is military (LAND_COMBAT|NAVAL|AIR):
  //        sum max(Combat, RangedCombat) from GameInfo.Unit_Stats row
  // Pattern at age-antiquity/ui/tutorial/tutorial-items-antiquity.js:218-221.
  // The ENTIRE iteration is wrapped in ONE safeCall so a single bad lookup
  // doesn't trip the kill switch repeatedly per turn.
  safeCall("computeMilitaryPower(pid=" + id + ")", () => {
    const units = p.Units;
    if (!units || typeof units.getUnitIds !== "function") return;
    const ids = units.getUnitIds();
    if (!ids || typeof ids[Symbol.iterator] !== "function") return;
    const MILITARY_FORMATIONS = new Set([
      "FORMATION_CLASS_LAND_COMBAT",
      "FORMATION_CLASS_NAVAL",
      "FORMATION_CLASS_AIR"
    ]);
    // Build a quick UnitType -> stats row map once, lazily, per sample.
    const statsByType = new Map();
    try {
      if (
        typeof GameInfo !== "undefined" &&
        GameInfo.Unit_Stats &&
        typeof GameInfo.Unit_Stats[Symbol.iterator] === "function"
      ) {
        for (const row of GameInfo.Unit_Stats) {
          if (row && typeof row.UnitType === "string") {
            // If a unit has multiple rows (per-age), keep the
            // strongest — best approximation of "current" strength.
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
        }
      }
    } catch (_) {
      /* ignore — empty map means 0 power, not a kill */
    }
    let total = 0;
    let counted = 0;
    for (const uid of ids) {
      try {
        const u =
          typeof Units !== "undefined" && typeof Units.get === "function"
            ? Units.get(uid)
            : undefined;
        if (!u) continue;
        const utype = u.type;
        if (utype === undefined || utype === null) continue;
        const def = GameInfo?.Units?.lookup ? GameInfo.Units.lookup(utype) : null;
        if (!def) continue;
        if (!MILITARY_FORMATIONS.has(def.FormationClass)) continue;
        // Combat strength lives in Unit_Stats keyed by UnitType string.
        const utStr = def.UnitType;
        const sRow = utStr ? statsByType.get(utStr) : undefined;
        let strength = 0;
        if (sRow) strength = Math.max(sRow.Combat, sRow.RangedCombat);
        // Fallback: some defs expose .Combat directly.
        if (!strength && typeof def.Combat === "number") strength = def.Combat;
        if (strength > 0) {
          total += strength;
          counted++;
        }
      } catch (_) {
        /* skip one bad unit, never trip the kill switch */
      }
    }
    if (counted > 0 || total > 0) ctx.militaryPower = total;
    else ctx.militaryPower = 0; // alive player with zero military still
    // gets a real "0" rather than dropped.
  });

  // ── Settlement cap (Civ7-specific) ─────────────────────────────────
  // player.Stats.settlementCap + player.Stats.numSettlements
  // citation: base-standard/ui/diplo-ribbon/panel-yield-banner.js:208-209
  safeCall("settlementCap", () => {
    if (!stats) return;
    const cap = stats.settlementCap;
    if (typeof cap === "number" && isFinite(cap)) ctx.settlementCap = cap;
    const n = stats.numSettlements;
    if (typeof n === "number" && isFinite(n)) ctx.numSettlements = n;
  });

  // ── Triumph counts per civ (Test of Time legacy system) ────────────
  // Civ7 Test of Time replaced the 4 legacy paths with a 6-attribute
  // triumph system. Per-civ progress lives at:
  //   Players.get(pid).Legacies.isTriggered(LEGACY_TYPE)  // bool
  //   Players.get(pid).Legacies.getProgress(LEGACY_TYPE)  // {progress:[{current,total}], raceWinner}
  // Legacy rows in GameInfo.Legacies are categorized by `LegacySubtype`:
  //   LEGACY_CULTURAL / LEGACY_DIPLOMATIC / LEGACY_ECONOMIC /
  //   LEGACY_SCIENTIFIC / LEGACY_MILITARISTIC / LEGACY_EXPANSIONIST
  // (CRISIS legacies exist but are negative — we skip them for the radar).
  //
  // Citations:
  //   ui-next/screens/legacies/legacies-model.js:73   getProgress shape
  //   ui-next/screens/legacies/legacies-model.js:67   per-other-player access
  //   ui-next/screens/legacies/triumph-tracking-manager.js:73-83
  //   age-antiquity/data/legacies.xml:170-178         LegacySubtype values
  //
  // The OLD GameInfo.LegacyPaths / Game.VictoryManager APIs still exist
  // but return frozen zeros post-ToT. Don't read from them.
  ctx.triumphsCultural = 0;
  ctx.triumphsDiplomatic = 0;
  ctx.triumphsEconomic = 0;
  ctx.triumphsScientific = 0;
  ctx.triumphsMilitaristic = 0;
  ctx.triumphsExpansionist = 0;
  ctx.triumphsInProgress = 0; // total in-progress (any attribute), informational
  ctx.legacyDiag = {}; // (kept for any leftover legacy-path API probes)
  // Bucket map: Legacies.LegacySubtype → ctx field name.
  const SUBTYPE_TO_KEY = {
    LEGACY_CULTURAL: "triumphsCultural",
    LEGACY_DIPLOMATIC: "triumphsDiplomatic",
    LEGACY_ECONOMIC: "triumphsEconomic",
    LEGACY_SCIENTIFIC: "triumphsScientific",
    LEGACY_MILITARISTIC: "triumphsMilitaristic",
    LEGACY_EXPANSIONIST: "triumphsExpansionist"
    // LEGACY_CRISIS exists but doesn't fit the 6-axis radar; tally as
    // generic in-progress only.
  };
  // Count triumphs (Test of Time API). Iterates GameInfo.Legacies, asks
  // the player's Legacies object whether each one is triggered, and tallies
  // by attribute. In-progress triumphs (current > 0 but not triggered) get
  // counted under `triumphsInProgress` for informational use.
  safeCall("triumphs/test-of-time", () => {
    const pl = p?.Legacies;
    if (!pl) return;
    if (typeof GameInfo === "undefined" || !GameInfo.Legacies) return;
    let inProgress = 0;
    try {
      for (const row of GameInfo.Legacies) {
        if (!row || !row.LegacyType) continue;
        const ctxKey = SUBTYPE_TO_KEY[row.LegacySubtype];
        let triggered = false;
        try {
          triggered = !!pl.isTriggered?.(row.LegacyType);
        } catch (_) {}
        if (triggered) {
          if (ctxKey) ctx[ctxKey] = (ctx[ctxKey] || 0) + 1;
          continue;
        }
        // Count any non-zero progress toward an untriggered triumph.
        try {
          const prog = pl.getProgress?.(row.LegacyType);
          const cur = prog?.progress?.[0]?.current;
          if (typeof cur === "number" && cur > 0) inProgress++;
        } catch (_) {}
      }
    } catch (_) {
      /* */
    }
    ctx.triumphsInProgress = inProgress;
  });

  // ── Real Modern-age Victory Points ─────────────────────────────────
  // Test of Time exposes per-civ victory progress via player.Victories.
  // The vanilla Victories screen's "GDP graph" reads this exact value for
  // the Economic victory. We sample the four Modern victories so our
  // history chart can mirror the same numbers when in Modern age (pre-
  // Modern these return 0 and the metric accessors fall back to other
  // signals). Citation: ui-next/screens/victories/victories-screen-model.js:1096,1137.
  ctx.victoryPointsCulture = 0;
  ctx.victoryPointsEconomic = 0; // GDP
  ctx.victoryPointsMilitary = 0;
  ctx.victoryPointsScience = 0;
  safeCall("victoryPoints", () => {
    const v = p?.Victories;
    if (!v || typeof v.getPointsForVictoryType !== "function") return;
    if (typeof GameInfo === "undefined" || !GameInfo.Victories) return;
    const MAP = {
      VICTORY_CULTURE_MODERN: "victoryPointsCulture",
      VICTORY_ECONOMIC_MODERN: "victoryPointsEconomic",
      VICTORY_MILITARY_MODERN: "victoryPointsMilitary",
      VICTORY_SCIENCE_MODERN: "victoryPointsScience"
    };
    try {
      for (const row of GameInfo.Victories) {
        if (!row) continue;
        const key = MAP[row.VictoryType];
        if (!key) continue;
        try {
          const pts = v.getPointsForVictoryType(row.$hash);
          if (typeof pts === "number" && isFinite(pts) && pts > 0) {
            ctx[key] = pts;
          }
        } catch (_) {}
      }
    } catch (_) {}
  });

  // ── Diplomatic Approval (Civ7-specific) ────────────────────────────
  // Aggregate "international reputation": sum of weighted relationship
  // scores across all met major civs + a damped contribution from
  // city-states (where viewer is suzerain). Mirrors the relationship API
  // already used by view-relations.js.
  // citations:
  //   view-relations.js:164 — getRelationshipEnum
  //   view-relations.js:501 — getSuzerain
  safeCall("diplomaticApproval", () => {
    const dip = p?.Diplomacy;
    if (
      !dip ||
      typeof dip.hasMet !== "function" ||
      typeof dip.getRelationshipEnum !== "function" ||
      typeof DiplomacyPlayerRelationships === "undefined"
    ) {
      return;
    }
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
    let majorScore = 0;
    let csScore = 0;
    try {
      const all = Players.getAlive ? Players.getAlive() : null;
      if (!all || !Array.isArray(all)) return;
      for (const other of all) {
        if (!other) continue;
        const oid = other.id;
        if (oid === id) continue;
        let met = false;
        try {
          met = !!dip.hasMet(oid);
        } catch (_) {
          met = false;
        }
        if (!met) continue;
        const isCS =
          typeof other.isMinor === "boolean"
            ? other.isMinor
            : typeof other.isIndependent === "boolean"
              ? other.isIndependent
              : false;
        if (isCS) {
          // CS contribution: +2 when we are their suzerain, 0 when
          // met but they have another or no suzerain. Damped to 0.3×.
          try {
            const inf = other.Influence;
            if (inf && typeof inf.getSuzerain === "function") {
              const suz = inf.getSuzerain();
              if (suz === id) csScore += 2;
            }
          } catch (_) {
            /* */
          }
        } else {
          let rel;
          try {
            rel = dip.getRelationshipEnum(oid);
          } catch (_) {
            rel = undefined;
          }
          if (rel !== undefined && WEIGHT_MAJOR[rel] !== undefined) {
            majorScore += WEIGHT_MAJOR[rel];
          }
        }
      }
    } catch (_) {
      /* */
    }
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

  // ── Resources assigned by class (Bonus / Empire / City / Factory / Treasure)
  // player.Resources.getResources() returns ResourceEntry items where the
  // useful class info lives at `r.uniqueResource.resource` (a resource
  // hash/type that we look up in GameInfo.Resources to get ResourceClassType).
  // Defensive: a flatter shape with `r.classType` exists in some builds, so
  // we accept either. Citation: base-standard/ui/resource-allocation/
  // model-resource-allocation.js:126-131.
  safeCall("resourceCategories", () => {
    const rs = p?.Resources;
    if (!rs || typeof rs.getResources !== "function") return;
    const list = rs.getResources();
    if (!Array.isArray(list)) return;
    let bonus = 0,
      empire = 0,
      city = 0,
      factory = 0,
      treasure = 0,
      unknown = 0;
    for (const r of list) {
      let cls = r?.classType;
      if (!cls) {
        // Try the nested uniqueResource shape.
        const resType = r?.uniqueResource?.resource ?? r?.type ?? r?.ResourceType;
        if (
          resType !== undefined &&
          typeof GameInfo !== "undefined" &&
          GameInfo.Resources &&
          typeof GameInfo.Resources.lookup === "function"
        ) {
          try {
            const def = GameInfo.Resources.lookup(resType);
            cls = def?.ResourceClassType || def?.classType;
          } catch (_) {
            /* */
          }
        }
      }
      const cnt = typeof r?.count === "number" && isFinite(r.count) && r.count > 0 ? r.count : 1;
      if (cls === "RESOURCECLASS_BONUS") bonus += cnt;
      else if (cls === "RESOURCECLASS_EMPIRE") empire += cnt;
      else if (cls === "RESOURCECLASS_CITY") city += cnt;
      else if (cls === "RESOURCECLASS_FACTORY") factory += cnt;
      else if (cls === "RESOURCECLASS_TREASURE") treasure += cnt;
      else unknown += cnt;
    }
    ctx.resourcesBonus = bonus;
    ctx.resourcesEmpire = empire;
    ctx.resourcesCity = city;
    ctx.resourcesFactory = factory;
    ctx.resourcesTreasure = treasure;
    ctx.resourcesTotal = bonus + empire + city + factory + treasure + unknown;
    vlog(
      "resources pid=" + id,
      "B=" + bonus,
      "E=" + empire,
      "C=" + city,
      "F=" + factory,
      "T=" + treasure,
      "?=" + unknown,
      "rawCount=" + list.length
    );
  });

  return ctx;
}

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

function getGlobalAgeContext() {
  const out = {
    crisisStage: undefined,
    crisisStageMax: 0,
    ageProgressPct: undefined,
    ageEnabled: undefined,
    crisisEventType: undefined
  };
  safeCall("crisisAgeGlobal", () => {
    try {
      const cm = typeof Game !== "undefined" ? Game.CrisisManager : null;
      if (cm) {
        if (typeof cm.isCrisisEnabled === "function") {
          out.ageEnabled = !!cm.isCrisisEnabled(0);
        }
        if (typeof cm.getCurrentCrisisStage === "function") {
          const s = cm.getCurrentCrisisStage(0);
          if (typeof s === "number" && isFinite(s)) out.crisisStage = s;
        }
        // Trigger percents are constants per stage; we record the
        // highest stage's trigger so consumers can normalise.
        if (typeof cm.getCrisisStageTriggerPercent === "function") {
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
      }
      const apm = typeof Game !== "undefined" ? Game.AgeProgressManager : null;
      if (apm) {
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
    } catch (_) {
      /* */
    }
  });
  out.crisisEventType = probeCrisisEventType();
  return out;
}

function getCurrentTurn() {
  return safeCall("Game.turn", () => {
    if (typeof Game !== "undefined" && typeof Game.turn === "number") return Game.turn;
    return undefined;
  });
}

// ---- the sampler ---------------------------------------------------------

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
  // Capture the in-game date label for this turn so chart x-axis labels
  // can show e.g. "T-52 / 2725 BCE". Game.getTurnDate() reads the CURRENT
  // turn only — we record it now, while we're at that turn, so historical
  // samples retain the right year. citation: base-standard/ui/system-bar/
  // panel-system-bar.js:192
  let gameYear;
  safeCall("getTurnDate", () => {
    if (typeof Game !== "undefined" && typeof Game.getTurnDate === "function") {
      const s = Game.getTurnDate();
      if (typeof s === "string" && s.length > 0) gameYear = s;
    }
  });
  const snapshot = {
    turn,
    localTurn,
    age: ageType,
    gameYear,
    crisisEventType: globalAge.crisisEventType,
    players: {}
  };
  for (const pid of ids) {
    const ctx = buildPlayerCtx(pid);
    // Stamp game-wide age/crisis values so metric accessors can read
    // them via the same per-player ctx shape they use today.
    ctx.ageProgressPct = globalAge.ageProgressPct;
    ctx.crisisStage = globalAge.crisisStage;
    ctx.crisisStageMax = globalAge.crisisStageMax;
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
    snapshot.players[pid] = {
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
      // List of ConstructibleType strings for completed wonders this
      // civ owns at this turn. Used by the chart's wonder-marker
      // plugin to diff against the prior sample and identify which
      // SPECIFIC wonder was completed (so we can show its icon, name
      // and a tooltip).
      wonderTypes: Array.isArray(ctx.wonderTypes) ? ctx.wonderTypes : undefined
    };
  }
  try {
    DemographicsStorage.appendSample(snapshot);
    ilog(
      "appendSample OK localTurn=",
      localTurn,
      "age=",
      ageType,
      "players=",
      Object.keys(snapshot.players).length
    );
  } catch (e) {
    tripIfTooMany("DemographicsStorage.appendSample", e);
  }
  // ── War tracker ────────────────────────────────────────────────────
  // Builds connected components of currently-at-war pairs (so a 2v2
  // coalition becomes ONE war record) and reconciles against open wars
  // in history.wars[]. Each war record carries sideA/sideB arrays so
  // multi-civ conflicts are first-class.
  safeCall("warTracker", () => {
    const h = DemographicsStorage.load();
    if (!Array.isArray(h.wars)) h.wars = [];
    // Migrate any legacy war records from the old (aPid/bPid scalars)
    // schema into the new (sideA/sideB arrays) schema. Without this
    // the overlap-matching loop below treats every existing war as
    // having no participants and creates duplicates each turn.
    for (const w of h.wars) {
      if (!Array.isArray(w.sideA) || !Array.isArray(w.sideB)) {
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
      // Always refresh rosters from the current pidInfo() so the
      // isCS flag reflects the latest player state — old records
      // may have it stale (or unset, which then defaulted to false
      // and incorrectly let CS conflicts show up as "major" wars).
      w.sideACivs = (w.sideA || []).map((p) => pidInfo(p));
      w.sideBCivs = (w.sideB || []).map((p) => pidInfo(p));
    }
    let gameYear;
    try {
      if (typeof Game !== "undefined" && typeof Game.getTurnDate === "function") {
        const s = Game.getTurnDate();
        if (typeof s === "string" && s.length > 0) gameYear = s;
      }
    } catch (_) {}
    const allPlayers = typeof Players?.getAlive === "function" ? Players.getAlive() : null;
    if (!Array.isArray(allPlayers)) return;

    function pidInfo(pid) {
      const ps = snapshot.players[pid];
      let civ = ps?.civName;
      let leader = ps?.leaderName;
      let color = ps?.primaryColor;
      let civTypeString = ps?.civTypeString;
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
          function flag(v) {
            if (typeof v === "boolean") return v;
            if (typeof v === "function") {
              try {
                return !!v.call(p);
              } catch (_) {}
            }
            return undefined;
          }
          // Mirror the trio of checks view-relations.js uses
          // (line 133-135): isMinor / isIndependent / isCityState.
          if (flag(p.isMinor) === true) isCS = true;
          if (flag(p.isIndependent) === true) isCS = true;
          if (flag(p.isCityState) === true) isCS = true;
          // Fallback: if explicitly NOT a major / full civ.
          if (!isCS) {
            const major = flag(p.isMajor);
            const fullCiv = flag(p.isFullCiv);
            if (major === false || fullCiv === false) isCS = true;
          }
        }
      } catch (_) {}
      // Last-resort name-based detection: Independent Powers and
      // city-state encampments often surface as "Village" or
      // "Independent" in civilizationName. Treat them as CS so they
      // never pollute the major-civ conflict timeline.
      if (!isCS && typeof civ === "string") {
        const low = civ.toLowerCase();
        if (
          low === "village" ||
          low.startsWith("independent") ||
          low.startsWith("city-state") ||
          low.startsWith("cs ")
        ) {
          isCS = true;
        }
      }
      // Also try Players.get(pid).civilizationType as a fallback so
      // wars carry the CIVILIZATION_X type string. The chart's name
      // generator uses this to look up the engine's own
      // LOC_CIVILIZATION_X_ADJECTIVE — the canonical, DLC-safe path.
      if (!civTypeString) {
        try {
          const p = Players.get(Number(pid));
          const ct = p?.civilizationType;
          if (typeof ct === "string" && ct.length > 0) civTypeString = ct;
        } catch (_) {
          /* */
        }
      }
      return {
        pid,
        civ: civ || "Player " + pid,
        leader: leader || "",
        color: color || "#9aa8c8",
        civTypeString: civTypeString || undefined,
        isCS
      };
    }

    // 1) Enumerate every DECLARE_WAR event via the engine's diplomacy
    //    API. This is the canonical source of war records — citation:
    //      core/ui/utilities/diplomacy-utilities.js:70 (jointEvents query)
    //      base-standard/ui/diplo-ribbon/model-diplo-ribbon.js:1088
    //    For each war we read:
    //      uniqueID       — stable across turns; our primary key.
    //      initialPlayer  — the civ that declared war (TRUE initiator).
    //      Supporting/Opposing players → sideA / sideB rosters.
    //    Wars are enumerated via getPlayerEvents(pid) for each major civ
    //    and de-duped on uniqueID since the same event appears in every
    //    participant's event list.
    const activeWarsByID = new Map();
    if (
      !Game?.Diplomacy ||
      typeof Game.Diplomacy.getPlayerEvents !== "function" ||
      typeof Game.Diplomacy.getDiplomaticEventData !== "function"
    ) {
      ilog("warTracker: Game.Diplomacy API unavailable, skipping turn");
      return;
    }
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
        if (!ev || ev.actionTypeName !== "DIPLOMACY_ACTION_DECLARE_WAR") continue;
        const uid = ev.uniqueID;
        if (uid == null || activeWarsByID.has(uid)) continue;
        let header;
        try {
          header = Game.Diplomacy.getDiplomaticEventData(uid);
        } catch (_) {}
        if (!header) continue;
        let supporters = [];
        let opposers = [];
        try {
          supporters = Game.Diplomacy.getSupportingPlayersWithBonusEnvoys(uid) || [];
        } catch (_) {}
        try {
          opposers = Game.Diplomacy.getOpposingPlayersWithBonusEnvoys(uid) || [];
        } catch (_) {}
        const initialPid = typeof header.initialPlayer === "number" ? header.initialPlayer : null;
        const targetPid = typeof header.targetPlayer === "number" ? header.targetPlayer : null;
        // SideA = initiator + supporters; SideB = target + opposers.
        const sideASet = new Set();
        if (initialPid !== null) sideASet.add(initialPid);
        for (const id of asPidList(supporters)) sideASet.add(id);
        const sideBSet = new Set();
        if (targetPid !== null) sideBSet.add(targetPid);
        for (const id of asPidList(opposers)) sideBSet.add(id);
        // Engine sometimes returns the initiator listed in supporters
        // and vice versa — strip cross-membership to keep the bipartite
        // split clean.
        for (const id of sideASet) sideBSet.delete(id);
        activeWarsByID.set(uid, {
          uniqueID: uid,
          initialPid,
          targetPid,
          sideA: Array.from(sideASet),
          sideB: Array.from(sideBSet),
          headerStartTurn: header.startTurn ?? header.turn ?? null
        });
      }
    }

    // 2) Reconcile against history.wars[] keyed by uniqueID.
    const knownByID = new Map();
    for (const w of h.wars) {
      if (typeof w.warUniqueID === "number") knownByID.set(w.warUniqueID, w);
    }
    for (const [uid, info] of activeWarsByID) {
      const existing = knownByID.get(uid);
      const aRoster = info.sideA.map((p) => pidInfo(p));
      const bRoster = info.sideB.map((p) => pidInfo(p));
      if (existing) {
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
        continue;
      }
      // New war.
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
      const priorCount = h.wars.filter(
        (w) => [w._nameKeyA || "", w._nameKeyB || ""].sort().join("|") === sortedNames.join("|")
      ).length;
      const ordinal = ordinalSuffix(priorCount + 1);
      const name = ordinal + " " + sortedNames[0] + " vs " + sortedNames[1] + " War";
      const declarer = pidInfo(info.initialPid);
      const newWar = {
        warUniqueID: uid,
        // `info.headerStartTurn` comes from the engine's diplomacy
        // event header — it's age-local (Game.turn at declaration).
        // Add the current cumulativeOffset so it lives in the same
        // global coordinate space as the chart's X axis (which is
        // also global). Wars cross-age are rare/non-existent in
        // Civ7, so applying the current offset is sufficient.
        startTurn:
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
      h.wars.push(newWar);
      ilog(
        "WAR STARTED:",
        name,
        "uid=",
        uid,
        "declarer=pid" + info.initialPid + " (" + (declarer?.civ || "?") + ")",
        "sideA=",
        info.sideA.join(","),
        "sideB=",
        info.sideB.join(",")
      );
    }
    // 3) Any open war whose uniqueID is no longer in the active set has
    // ended (peace concluded, civ eliminated, etc.).
    for (const w of h.wars) {
      if (typeof w.endTurn === "number") continue;
      if (typeof w.warUniqueID !== "number") {
        // Pre-API legacy record with no uniqueID — close it on first
        // pass after migration so it doesn't linger forever.
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
    DemographicsStorage.save(h);
  });
  return snapshot;
}

// Returns "1st", "2nd", "3rd", "4th"... for any positive integer.
function ordinalSuffix(n) {
  const s = ["th", "st", "nd", "rd"],
    v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

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
    // silently skipped — the in-game turn still advances, we just
    // don't write a new snapshot. lastSampledTurn is updated below
    // only on successful capture so a missed sample (e.g. due to
    // error) doesn't shift the cadence.
    const curTurn =
      typeof Game !== "undefined" && typeof Game.turn === "number" ? Game.turn : undefined;
    if (!shouldSampleThisTurn(curTurn)) {
      vlog("skip turn", curTurn, "by polling rate (every", getPollEveryNTurns(), "turns)");
      return;
    }

    vlog("about to sample turn for localPlayer=", localId);
    const snap = doSample();
    if (snap) {
      if (typeof curTurn === "number") lastSampledTurn = curTurn;
      if (!firstSampleSucceeded) {
        firstSampleSucceeded = true;
        DEMOGRAPHICS_DEBUG = false; // downgrade verbosity after first success
        ilog("first sample SUCCEEDED; downgrading log verbosity for subsequent turns");
      }
    }
  } catch (e) {
    tripIfTooMany("onPlayerTurnActivated", e);
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
let _ageHandlerRef = null;

function _readNewAgeType() {
  // Clear cache first so getCurrentAgeType re-reads Game.age.
  _cachedAgeType = undefined;
  _treesBySystemAndAge.clear();
  return getCurrentAgeType();
}

function _ageBoundaryAlreadyRecorded(history, age, turn) {
  const arr = history && history.ageBoundaries;
  if (!Array.isArray(arr)) return false;
  // Same age + same age-local turn = same transition event (multiple
  // pids report it). We check `b.localTurn` (the age-local Game.turn)
  // because `b.turn` was switched to a GLOBAL value for chart alignment
  // — checking against that would always miss and we'd append a fresh
  // boundary for every per-pid transition event.
  return arr.some((b) => {
    if (!b || b.age !== age) return false;
    if (typeof b.localTurn === "number") return b.localTurn === turn;
    // Back-compat with old boundary entries that only had `.turn`.
    return b.turn === turn;
  });
}

function onPlayerAgeTransitionComplete(data) {
  if (disabled) return;
  try {
    const newAge = _readNewAgeType();
    const turn = getCurrentTurn() ?? -1;
    ilog("PlayerAgeTransitionComplete pid=", data && data.player, "newAge=", newAge, "turn=", turn);

    // Persist the boundary (dedupe across the per-pid stream).
    try {
      const h = DemographicsStorage.load();
      if (newAge && !_ageBoundaryAlreadyRecorded(h, newAge, turn)) {
        // Bump the cumulative turn offset by the max age-local turn
        // we ever saw in the prior age, so the chart's X axis runs
        // monotonically across age boundaries instead of stacking
        // exploration turn-1 on top of antiquity turn-1.
        //
        // Legacy samples (from builds before localTurn existed) only
        // have `s.turn` — and at that time `s.turn` was set to
        // Game.turn (age-local) because no offset was applied. So
        // for those samples, `s.turn` IS the age-local position and
        // we use it as a fallback. Without this fallback the offset
        // bump computed to 0, leaving exploration samples at the
        // same X coords as antiquity samples and hiding the
        // antiquity data behind the new lines.
        // Clear obsolete stored offset (no longer used — chart
        // computes X at render time from age + localTurn). This
        // also gets rid of garbage values like offset=235 baked
        // into earlier corrupt saves.
        delete h.cumulativeTurnOffset;
        h.ageBoundaries.push({
          turn, // age-local Game.turn at transition
          localTurn: turn,
          age: newAge
        });
        ilog("ageBoundary: recorded", newAge, "at localTurn=", turn);
        // Snapshot per-civ TRIUMPH counts at this moment — values
        // from the latest sample for each civ are the age-end totals.
        // Stored under history.legacySnapshots[age] as a
        // { pid → {triumphs_*, leaderName, civName, leaderType} } map
        // (the storage key is kept as `legacySnapshots` for
        // back-compat with existing saves; the contained data is
        // the new triumph-count shape).
        if (!h.legacySnapshots || typeof h.legacySnapshots !== "object") {
          h.legacySnapshots = {};
        }
        const finishedAge = (() => {
          // The boundary fires when newAge BEGINS. The "finished"
          // age is the previous one — find it from the boundary
          // list (the one just before this turn).
          const sorted = h.ageBoundaries.slice().sort((a, b) => (a.turn || 0) - (b.turn || 0));
          const idx = sorted.findIndex((b) => b.age === newAge && b.turn === turn);
          if (idx > 0) return sorted[idx - 1].age;
          return "AGE_ANTIQUITY"; // first transition — finishing antiquity
        })();
        const snap = {};
        const samps = h.samples || [];
        for (let i = samps.length - 1; i >= 0; i--) {
          const s = samps[i];
          if (!s?.players) continue;
          for (const pid of Object.keys(s.players)) {
            if (snap[pid]) continue;
            const m = s.players[pid].metrics;
            if (!m) continue;
            snap[pid] = {
              triumphs_cultural: m.triumphs_cultural || 0,
              triumphs_diplomatic: m.triumphs_diplomatic || 0,
              triumphs_economic: m.triumphs_economic || 0,
              triumphs_scientific: m.triumphs_scientific || 0,
              triumphs_militaristic: m.triumphs_militaristic || 0,
              triumphs_expansionist: m.triumphs_expansionist || 0,
              leaderName: s.players[pid].leaderName,
              civName: s.players[pid].civName,
              leaderType: s.players[pid].leaderType
            };
          }
        }
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

export function startSampler() {
  // Saved-game load re-runs bootstrap → calls startSampler() again. The
  // sampler MODULE is cached for the lifetime of the Coherent JS process,
  // so module-scope `started`, `handlerRef`, `disabled`, and `errorCount`
  // all persist into the new game. That used to make us:
  //   (a) refuse to re-register (`started === true` → early return)
  //   (b) carry a stale handler ref the engine no longer recognizes
  //   (c) honor a kill switch that tripped in the previous game
  // Result: graphs silently stopped recording on the new save.
  //
  // Reset every cross-load piece of state and always re-register fresh.
  if (typeof engine !== "undefined" && typeof engine.off === "function") {
    // Tear down stale subscriptions from a prior game session. Both
    // engine.off calls are safe no-ops if nothing was registered.
    try {
      if (handlerRef) engine.off("PlayerTurnActivated", handlerRef);
    } catch (e) {
      vlog("engine.off PlayerTurnActivated (stale) threw:", e?.message);
    }
    try {
      if (_ageHandlerRef) engine.off("PlayerAgeTransitionComplete", _ageHandlerRef);
    } catch (e) {
      vlog("engine.off PlayerAgeTransitionComplete (stale) threw:", e?.message);
    }
  }
  handlerRef = null;
  _ageHandlerRef = null;
  started = false;
  // Clear any prior-session kill state — the new game deserves a fresh
  // budget of retries before we decide the sampler is broken.
  disabled = false;
  errorCount = 0;
  firstSampleSucceeded = false;
  // Seed the poll-cadence tracker from the most recent stored sample so
  // the new session doesn't re-record the same turn (which would happen
  // if we left `lastSampledTurn = -1` and the resume kickoff ran on a
  // turn that's already in storage).
  try {
    const h = DemographicsStorage.load?.();
    if (h && Array.isArray(h.samples) && h.samples.length > 0) {
      const last = h.samples[h.samples.length - 1];
      if (last && typeof last.turn === "number") lastSampledTurn = last.turn;
    }
  } catch (_) {
    /* */
  }

  if (typeof engine === "undefined" || typeof engine.on !== "function") {
    elog("engine.on unavailable; cannot start sampler");
    return;
  }
  try {
    handlerRef = (data) => onPlayerTurnActivated(data);
    engine.on("PlayerTurnActivated", handlerRef);
    _ageHandlerRef = (data) => onPlayerAgeTransitionComplete(data);
    engine.on("PlayerAgeTransitionComplete", _ageHandlerRef);
    started = true;
    ilog(
      "subscribed to PlayerTurnActivated + PlayerAgeTransitionComplete",
      "(re-registered fresh on load, kill at",
      KILL_THRESHOLD,
      "errors)"
    );
    // Important: defer the kickoff sample until AFTER the game's save
    // data has actually been deserialized into GameTutorial. The map-
    // tack mod (which is the working reference) uses Loading.runWhenLoaded
    // for the same reason. `engine.whenReady` only tells us the engine
    // is alive, NOT that the save's GameTutorial properties have been
    // populated. If we sample before that:
    //   1) DemographicsStorage.load() reads empty (save state not yet
    //      deserialized).
    //   2) We write a "fresh" first sample with no antiquity data.
    //   3) The save layer then treats our just-written state as truth.
    //   4) The actual antiquity history we PERSISTED in the save file
    //      gets clobbered.
    // This is the root cause of "no antiquity persistence across the
    // age transition" — age transition is a save→load cycle and we've
    // been racing the deserializer.
    const runKickoff = () => {
      try {
        if (disabled) return;
        const curTurn =
          typeof Game !== "undefined" && typeof Game.turn === "number" ? Game.turn : undefined;
        let storedCount = 0;
        try {
          storedCount = DemographicsStorage.load?.()?.samples?.length || 0;
        } catch (_) {
          /* */
        }
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
    };
    if (typeof Loading !== "undefined" && typeof Loading.runWhenLoaded === "function") {
      ilog("startSampler: deferring kickoff until Loading.runWhenLoaded");
      Loading.runWhenLoaded(runKickoff);
    } else {
      // Loading API unavailable — fall back to the timeout-based
      // kickoff so we don't break in test contexts.
      ilog("startSampler: Loading.runWhenLoaded unavailable; using 250ms timeout fallback");
      setTimeout(runKickoff, 250);
    }
  } catch (e) {
    elog("engine.on threw during startSampler:", e);
  }
}

export function isSamplerDisabled() {
  return disabled;
}

// On-demand sample so the modal can force a snapshot when it opens with
// an empty history.
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
