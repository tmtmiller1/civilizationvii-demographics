// relations-edges-cs.js
//
// City-State edge and type helpers for the Global Relations ring. Split from
// relations-edges.js so that module can focus on major-civ edge builders.

import { t } from "/demographics/ui/demographics-i18n.js";
import { getAttitudeColors } from "/demographics/ui/demographics-palette.js";
import { dlog, safeCall } from "/demographics/ui/screen-demographics/views/relations-shared.js";

/**
 * One relationship edge between two ring nodes.
 * @typedef {Object} Edge
 * @property {number} a Source player id.
 * @property {number} b Target player id.
 * @property {string} [color] Stroke color.
 * @property {string} [label] Optional edge label.
 * @property {string} [filterKey] Filter category.
 * @property {boolean} [dashed] Legacy dashed-line flag.
 * @property {number} [width] Per-edge stroke width.
 * @property {number} [opacity] Per-edge stroke opacity.
 * @property {string|null} [_dashOverride] Per-tab dash-pattern override.
 */

/**
 * Resolve the live palette color for an attitude key.
 * @param {string} key Attitude key.
 * @returns {string} The palette color (gray fallback).
 */
function categoryColor(key) {
  const colors = getAttitudeColors();
  return colors[key] || "#bfbfbf";
}

/**
 * Map an engine relationship enum to one of the seven attitude keys.
 * @param {*} rel Relationship enum value.
 * @returns {string} The attitude key.
 */
function attitudeKeyFromEnum(rel) {
  if (
    typeof DiplomacyPlayerRelationships === "undefined" ||
    !DiplomacyPlayerRelationships
  ) {
    return "neutral";
  }
  const relEnum = DiplomacyPlayerRelationships;
  if (rel === relEnum.PLAYER_RELATIONSHIP_ALLIANCE) return "alliance";
  if (rel === relEnum.PLAYER_RELATIONSHIP_FRIENDLY) return "friendly";
  if (rel === relEnum.PLAYER_RELATIONSHIP_HELPFUL) return "helpful";
  if (rel === relEnum.PLAYER_RELATIONSHIP_NEUTRAL) return "neutral";
  if (rel === relEnum.PLAYER_RELATIONSHIP_UNFRIENDLY) return "unfriendly";
  if (rel === relEnum.PLAYER_RELATIONSHIP_HOSTILE) return "hostile";
  if (rel === relEnum.PLAYER_RELATIONSHIP_AT_WAR) return "war";
  return "neutral";
}

/**
 * Whether `p1` is at war with player `p2id`, defensively.
 * @param {*} p1 Source player handle.
 * @param {number} p2id Target player id.
 * @returns {boolean} True when at war.
 */
function isAtWar(p1, p2id) {
  return safeCall(
    "isAtWarWith",
    () => {
      const diplo = p1?.Diplomacy;
      if (!diplo) return false;
      if (typeof diplo.isAtWarWith === "function") return !!diplo.isAtWarWith(p2id);
      return false;
    },
    false
  );
}

/**
 * Resolve the engine relationship enum from `p1` toward `p2id`.
 * @param {*} p1 Source player handle.
 * @param {number} p2id Target player id.
 * @returns {*} Relationship enum or `undefined`.
 */
function getRelationship(p1, p2id) {
  return safeCall("getRelationshipEnum", () => {
    const diplo = p1?.Diplomacy;
    if (!diplo || typeof diplo.getRelationshipEnum !== "function") return undefined;
    return diplo.getRelationshipEnum(p2id);
  });
}

/**
 * Find the `GameInfo.CityStateBonuses` row whose `$hash` matches `bonusHash`.
 * @param {number} bonusHash Bonus-type hash to match.
 * @returns {*} Matching row, or `null`.
 */
function findBonusRow(bonusHash) {
  /** @type {*} */
  let row = null;
  try {
    if (typeof GameInfo.CityStateBonuses.find === "function") {
      row = GameInfo.CityStateBonuses.find((/** @type {*} */ r) => r && r.$hash === bonusHash);
    } else if (GameInfo.CityStateBonuses[Symbol.iterator]) {
      for (const r of GameInfo.CityStateBonuses) {
        if (r && r.$hash === bonusHash) {
          row = r;
          break;
        }
      }
    }
  } catch (_) {
    // Engine boundary can throw; leave unresolved.
  }
  return row;
}

/**
 * Pass 1: classify a CS by its assigned bonus.
 * @param {number} pid City-state player id.
 * @returns {string|null} The `CityStateType` string.
 */
function csTypeFromBonus(pid) {
  if (
    Game?.CityStates &&
    typeof Game.CityStates.getBonusType === "function" &&
    typeof GameInfo !== "undefined" &&
    GameInfo.CityStateBonuses
  ) {
    const bonusHash = Game.CityStates.getBonusType(pid);
    if (bonusHash != null && bonusHash !== -1) {
      const row = findBonusRow(bonusHash);
      if (row?.CityStateType) return row.CityStateType;
    }
  }
  return null;
}

/**
 * Find the `GameInfo.Independents` row matching a civ adjective.
 * @param {string} adj Player civilization adjective.
 * @returns {*} Matching row, or `null`.
 */
function findIndependentRow(adj) {
  /** @type {*} */
  let match = null;
  try {
    if (typeof GameInfo.Independents.forEach === "function") {
      GameInfo.Independents.forEach((/** @type {*} */ r) => {
        if (!match && r && r.CityStateName === adj) match = r;
      });
    } else if (GameInfo.Independents[Symbol.iterator]) {
      for (const r of GameInfo.Independents) {
        if (r && r.CityStateName === adj) {
          match = r;
          break;
        }
      }
    }
  } catch (_) {
    // Engine boundary can throw; leave unresolved.
  }
  return match;
}

/**
 * Pass 2: classify a CS from `GameInfo.Independents`.
 * @param {number} pid City-state player id.
 * @returns {string|null} The `CityStateType` string.
 */
function csTypeFromIndependents(pid) {
  if (
    typeof Players?.get === "function" &&
    typeof GameInfo !== "undefined" &&
    GameInfo.Independents
  ) {
    const player = Players.get(pid);
    const adj = player?.civilizationAdjective;
    if (typeof adj === "string" && adj.length > 0) {
      const match = findIndependentRow(adj);
      if (match?.CityStateType) return match.CityStateType;
    }
  }
  return null;
}

/**
 * Resolve a city-state type string (MILITARISTIC / CULTURAL / etc.).
 * @param {number} pid City-state player id.
 * @returns {string|null} The `CityStateType` string.
 */
export function resolveCsType(pid) {
  return safeCall(
    "resolveCsType(" + pid + ")",
    () => csTypeFromBonus(pid) || csTypeFromIndependents(pid),
    null
  );
}

/** @type {Record<string, { label: string, color: string, icon: string }>} */
const CS_TYPE_META = {
  MILITARISTIC: {
    label: "LOC_DEMOGRAPHICS_CSTYPE_MILITARISTIC",
    color: "#d97c7c",
    icon: "blp:bonus_militaristic"
  },
  CULTURAL: {
    label: "LOC_DEMOGRAPHICS_CSTYPE_CULTURAL",
    color: "#c9a2dc",
    icon: "blp:bonus_cultural"
  },
  ECONOMIC: {
    label: "LOC_DEMOGRAPHICS_CSTYPE_ECONOMIC",
    color: "#e6c14c",
    icon: "blp:bonus_economic"
  },
  SCIENTIFIC: {
    label: "LOC_DEMOGRAPHICS_CSTYPE_SCIENTIFIC",
    color: "#7fb3e6",
    icon: "blp:bonus_scientific"
  },
  EXPANSIONIST: {
    label: "LOC_DEMOGRAPHICS_CSTYPE_EXPANSIONIST",
    color: "#9ad17a",
    icon: "blp:bonustype_expansionist"
  },
  DIPLOMATIC: {
    label: "LOC_DEMOGRAPHICS_CSTYPE_DIPLOMATIC",
    color: "#5fb3b3",
    icon: "blp:bonustype_diplomatic"
  }
};

/**
 * Look up display meta (label/color/icon) for a CS type string.
 * @param {*} typeStr `CityStateType` string.
 * @returns {{ label: string, color: string, icon: string }|null} Meta or null.
 */
export function csTypeMeta(typeStr) {
  if (typeof typeStr !== "string") return null;
  const meta = CS_TYPE_META[typeStr.toUpperCase()];
  if (!meta) return null;
  return { label: t(meta.label), color: meta.color, icon: meta.icon };
}

/**
 * Read a city-state's suzerain id defensively.
 * @param {*} cs City-state player handle.
 * @returns {number} Suzeraign id, or `-1`.
 */
function readSuzerain(cs) {
  const inf = cs?.Influence;
  if (!inf || typeof inf.getSuzerain !== "function") return -1;
  let suz = -1;
  try {
    suz = inf.getSuzerain();
  } catch (_) {
    suz = -1;
  }
  return typeof suz === "number" ? suz : -1;
}

/**
 * Read a CS suzerain id via optional chaining, defaulting to `-1`.
 * @param {*} cs City-state player handle.
 * @returns {number} Suzeraign id, or `-1`.
 */
function readSuzerainLoose(cs) {
  try {
    return cs.Influence?.getSuzerain?.() ?? -1;
  } catch (_) {
    return -1;
  }
}

/**
 * Build CS suzerain edges.
 * @param {number[]} metIds Met major ids.
 * @param {number[]} csIds City-state ids.
 * @param {number} [localPid] Local player id.
 * @returns {Edge[]} Suzerain edges.
 */
export function buildCsSuzerainEdges(metIds, csIds, localPid) {
  /** @type {Edge[]} */
  const edges = [];
  if (typeof Players === "undefined" || typeof Players.get !== "function") return edges;
  const majors = new Set(metIds);
  if (typeof localPid === "number") majors.add(localPid);
  for (const csId of csIds) {
    const cs = safeCall("Players.get(" + csId + ")", () => Players.get(csId), null);
    const suz = readSuzerain(cs);
    if (suz < 0 || !majors.has(suz)) continue;
    edges.push({ a: suz, b: csId, color: "#f3c34c", dashed: true, filterKey: "suzerain" });
  }
  return edges;
}

/**
 * Resolve a player's `Trade` handle if it exposes `countPlayerTradeRoutesTo`.
 * @param {number} fromPid Source player id.
 * @returns {*} Trade handle or `null`.
 */
function resolveTradeHandle(fromPid) {
  const fromPlayer = safeCall("Players.get(" + fromPid + ")", () => Players.get(fromPid), null);
  const trade = fromPlayer?.Trade;
  if (!trade || typeof trade.countPlayerTradeRoutesTo !== "function") return null;
  return trade;
}

/**
 * Count trade routes from a trade handle to `toPid`, defensively.
 * @param {*} trade Trade handle.
 * @param {number} toPid Destination player id.
 * @returns {number} Route count.
 */
function tradeRouteCount(trade, toPid) {
  try {
    return trade.countPlayerTradeRoutesTo(toPid) | 0;
  } catch (_) {
    return 0;
  }
}

/**
 * Build CS trade edges (major -> CS).
 * @param {number[]} metIds Met major ids.
 * @param {number[]} csIds City-state ids.
 * @param {number} [localPid] Local player id.
 * @returns {Edge[]} CS trade edges.
 */
export function buildCsTradeEdges(metIds, csIds, localPid) {
  /** @type {Edge[]} */
  const edges = [];
  if (typeof Players === "undefined" || typeof Players.get !== "function") return edges;
  const sources = metIds.slice();
  if (typeof localPid === "number" && !sources.includes(localPid)) sources.push(localPid);
  for (const fromPid of sources) {
    const trade = resolveTradeHandle(fromPid);
    if (!trade) continue;
    for (const csId of csIds) {
      const n = tradeRouteCount(trade, csId);
      if (n > 0) {
        const weight = Math.min(1, n / 3);
        edges.push({
          a: fromPid,
          b: csId,
          color: "#4dc6c6",
          width: 1 + weight * 1.5,
          opacity: 0.5 + weight * 0.5,
          filterKey: "trade"
        });
      }
    }
  }
  return edges;
}

/**
 * Resolve a CS attitude category from one major toward the CS.
 * @param {*} major Major player handle.
 * @param {number} majorPid Major player id.
 * @param {number} csId City-state id.
 * @param {number} suz Precomputed suzerain id (or `-1`).
 * @returns {string|null} Attitude key or `null`.
 */
function csAttitudeCatFor(major, majorPid, csId, suz) {
  const rel = getRelationship(major, csId);
  if (rel !== undefined && rel !== null) {
    if (isAtWar(major, csId)) return "war";
    return attitudeKeyFromEnum(rel);
  }
  if (typeof suz === "number" && suz >= 0) {
    return suz === majorPid ? "helpful" : "neutral";
  }
  return null;
}

/**
 * Append attitude edges between majors and one CS.
 * @param {Edge[]} edges Accumulator.
 * @param {number[]} majors Major player ids.
 * @param {number} csId City-state id.
 * @param {number} suz Suzeraign id.
 * @returns {boolean} True when any edge was emitted.
 */
function appendCsAttitudeForCs(edges, majors, csId, suz) {
  let anyEmitted = false;
  for (const majorPid of majors) {
    const major = safeCall("Players.get(" + majorPid + ")", () => Players.get(majorPid), null);
    if (!major) continue;
    const catKey = csAttitudeCatFor(major, majorPid, csId, suz);
    if (catKey === null) continue;
    edges.push({ a: majorPid, b: csId, color: categoryColor(catKey), filterKey: catKey });
    anyEmitted = true;
  }
  return anyEmitted;
}

/**
 * Build CS attitude edges (major -> CS).
 * @param {number[]} metIds Met major ids.
 * @param {number[]} csIds City-state ids.
 * @param {number} [localPid] Local player id.
 * @returns {Edge[]} CS attitude edges.
 */
export function buildCsAttitudeEdges(metIds, csIds, localPid) {
  /** @type {Edge[]} */
  const edges = [];
  if (typeof Players === "undefined" || typeof Players.get !== "function") return edges;
  const majors = metIds.slice();
  if (typeof localPid === "number" && !majors.includes(localPid)) majors.push(localPid);

  for (const csId of csIds) {
    const cs = safeCall("Players.get(" + csId + ")", () => Players.get(csId), null);
    if (!cs) continue;
    const suz = readSuzerainLoose(cs);
    const anyEmitted = appendCsAttitudeForCs(edges, majors, csId, suz);
    if (!anyEmitted) {
      dlog("CS attitude: skipped CS pid", csId, "(no useful relationship data)");
    }
  }
  return edges;
}
