// sampler-collectors-civics.js
//
// Civic, diplomatic, and resource collectors for per-civ sampling.

import { collectorLog, safeCall } from "/demographics/ui/sampler/sampler-shared.js";

// Map of Modern victory type → ctx field name.
/** @type {Record<string, keyof import("./sampler-collectors-core.js").PlayerCtx>} */
const VICTORY_TYPE_TO_KEY = {
  VICTORY_CULTURE_MODERN: "victoryPointsCulture",
  VICTORY_ECONOMIC_MODERN: "victoryPointsEconomic",
  VICTORY_MILITARY_MODERN: "victoryPointsMilitary",
  VICTORY_SCIENCE_MODERN: "victoryPointsScience"
};

/**
 * Capture real Modern-age victory points per civ via player.Victories.
 * @param {import("./sampler-collectors-core.js").PlayerCtx} ctx
 * @param {*} player The sampled player handle.
 */
export function collectVictoryPoints(ctx, player) {
  ctx.victoryPointsCulture = 0;
  ctx.victoryPointsEconomic = 0;
  ctx.victoryPointsMilitary = 0;
  ctx.victoryPointsScience = 0;
  safeCall("victoryPoints", () => {
    const victories = player?.Victories;
    if (!victories || typeof victories.getPointsForVictoryType !== "function") return;
    if (typeof GameInfo === "undefined" || !GameInfo.Victories) return;
    try {
      for (const row of GameInfo.Victories) {
        _captureVictoryRow(ctx, victories, row);
      }
    } catch (_) {
      // Iterating GameInfo.Victories can throw if the table is absent.
    }
  });
}

/**
 * @param {import("./sampler-collectors-core.js").PlayerCtx} ctx
 * @param {*} victories The player's Victories handle.
 * @param {*} row A GameInfo.Victories row.
 */
function _captureVictoryRow(ctx, victories, row) {
  if (!row) return;
  const key = VICTORY_TYPE_TO_KEY[row.VictoryType];
  if (!key) return;
  try {
    const pts = victories.getPointsForVictoryType(row.$hash);
    if (typeof pts === "number" && isFinite(pts) && pts > 0) {
      ctx[key] = pts;
    }
  } catch (_) {
    // v.getPointsForVictoryType() can throw pre-Modern age.
  }
}

/**
 * @param {*} dip The sampled player's Diplomacy handle.
 * @param {Pid} id
 * @param {*} other The other player handle.
 * @param {Record<string, number>} weightMajor Relationship-enum weight map.
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
 * @param {*} other The city-state player handle.
 * @param {Pid} id
 */
function _csSuzerainScore(other, id) {
  try {
    const inf = other.Influence;
    if (inf && typeof inf.getSuzerain === "function") {
      const suz = inf.getSuzerain();
      if (suz === id) return 2;
    }
  } catch (_) {
    // other.Influence.getSuzerain() can throw for unresolved players.
  }
  return 0;
}

/**
 * @param {*} dip The sampled player's Diplomacy handle.
 * @param {Pid} oid
 * @param {Record<string, number>} weightMajor Relationship-enum weight map.
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
 * Compute aggregate weighted relationship scores.
 * @param {import("./sampler-collectors-core.js").PlayerCtx} ctx
 * @param {Pid} id
 * @param {*} player The sampled player handle.
 */
export function collectDiplomaticApproval(ctx, id, player) {
  safeCall("diplomaticApproval", () => {
    const dip = player?.Diplomacy;
    if (!_approvalApiAvailable(dip)) return;
    const { major: majorScore, cs: csScore } = _sumApprovalScores(dip, id);
    ctx.diplomaticApproval = majorScore + 0.3 * csScore;
    ctx.diplomaticApprovalMajor = majorScore;
    ctx.diplomaticApprovalCS = csScore;
    collectorLog.debug(
      "diplomaticApproval pid=" + id,
      "major=" + majorScore,
      "cs=" + csScore,
      "total=" + ctx.diplomaticApproval.toFixed(2)
    );
  });
}

/** @param {*} dip The sampled player's Diplomacy handle. */
function _approvalApiAvailable(dip) {
  return !!(
    dip &&
    typeof dip.hasMet === "function" &&
    typeof dip.getRelationshipEnum === "function" &&
    typeof DiplomacyPlayerRelationships !== "undefined"
  );
}

/**
 * @param {*} dip The sampled player's Diplomacy handle.
 * @param {Pid} id
 */
function _sumApprovalScores(dip, id) {
  const Relationship = DiplomacyPlayerRelationships;
  const WEIGHT_MAJOR = {
    [Relationship.PLAYER_RELATIONSHIP_ALLIANCE]: 5,
    [Relationship.PLAYER_RELATIONSHIP_HELPFUL]: 3,
    [Relationship.PLAYER_RELATIONSHIP_FRIENDLY]: 2,
    [Relationship.PLAYER_RELATIONSHIP_NEUTRAL]: 0,
    [Relationship.PLAYER_RELATIONSHIP_UNFRIENDLY]: -2,
    [Relationship.PLAYER_RELATIONSHIP_HOSTILE]: -3,
    [Relationship.PLAYER_RELATIONSHIP_AT_WAR]: -5
  };
  let major = 0;
  let cityStateScore = 0;
  try {
    const all = Players.getAlive ? Players.getAlive() : null;
    if (!all || !Array.isArray(all)) return { major, cs: cityStateScore };
    for (const other of all) {
      if (!other) continue;
      const part = scoreApprovalContribution(dip, id, other, WEIGHT_MAJOR);
      major += part.major;
      cityStateScore += part.cs;
    }
  } catch (_) {
    // Players.getAlive() can throw mid age-transition.
  }
  return { major, cs: cityStateScore };
}

/** @param {*} resource A ResourceEntry item. */
function resolveResourceClass(resource) {
  const cls = resource?.classType;
  if (cls) return cls;
  const resType = resource?.uniqueResource?.resource ?? resource?.type ?? resource?.ResourceType;
  return _resourceClassByType(resType);
}

/** @param {*} resType The resource type/hash. */
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
    // GameInfo.Resources.lookup() can throw on an unknown resType.
  }
  return undefined;
}

/**
 * Tally a player's resources by class and store counts + total on `ctx`.
 * @param {import("./sampler-collectors-core.js").PlayerCtx} ctx
 * @param {Pid} id
 * @param {*} player The sampled player handle.
 */
export function collectResourceCategories(ctx, id, player) {
  safeCall("resourceCategories", () => {
    const rs = player?.Resources;
    if (!rs || typeof rs.getResources !== "function") return;
    const list = rs.getResources();
    if (!Array.isArray(list)) return;
    const counts = { bonus: 0, empire: 0, city: 0, factory: 0, treasure: 0, unknown: 0 };
    for (const resource of list) {
      _bucketResource(counts, resolveResourceClass(resource), _resourceCount(resource));
    }
    ctx.resourcesBonus = counts.bonus;
    ctx.resourcesEmpire = counts.empire;
    ctx.resourcesCity = counts.city;
    ctx.resourcesFactory = counts.factory;
    ctx.resourcesTreasure = counts.treasure;
    ctx.resourcesTotal = counts.bonus + counts.empire + counts.city + counts.factory + counts.treasure + counts.unknown;
    collectorLog.debug(
      "resources pid=" + id,
      "B=" + counts.bonus,
      "E=" + counts.empire,
      "C=" + counts.city,
      "F=" + counts.factory,
      "T=" + counts.treasure,
      "?=" + counts.unknown,
      "rawCount=" + list.length
    );
  });
}

/** @param {*} resource A ResourceEntry item. */
function _resourceCount(resource) {
  return typeof resource?.count === "number" && isFinite(resource.count) && resource.count > 0 ? resource.count : 1;
}

/**
 * @typedef {{ bonus: number, empire: number, city: number, factory: number,
 *   treasure: number, unknown: number }} ResourceCounts
 */

/**
 * @param {ResourceCounts} counts
 * @param {*} cls The resource class string.
 * @param {number} cnt
 */
function _bucketResource(counts, cls, cnt) {
  if (cls === "RESOURCECLASS_BONUS") counts.bonus += cnt;
  else if (cls === "RESOURCECLASS_EMPIRE") counts.empire += cnt;
  else if (cls === "RESOURCECLASS_CITY") counts.city += cnt;
  else if (cls === "RESOURCECLASS_FACTORY") counts.factory += cnt;
  else if (cls === "RESOURCECLASS_TREASURE") counts.treasure += cnt;
  else counts.unknown += cnt;
}
