// sampler-collectors-civics.js
//
// Civic, diplomatic, and resource collectors for per-civ sampling.

import { dlog, safeCall } from "/demographics/ui/sampler/sampler-collectors-core.js";

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
 * @param {import("./sampler-collectors-core.js").PlayerCtx} ctx The context.
 * @param {*} p The sampled player handle.
 */
export function collectVictoryPoints(ctx, p) {
  ctx.victoryPointsCulture = 0;
  ctx.victoryPointsEconomic = 0;
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
      // Iterating GameInfo.Victories can throw if the table is absent.
    }
  });
}

/**
 * Capture one Victories row's points into the matching `ctx` field.
 * @param {import("./sampler-collectors-core.js").PlayerCtx} ctx The context.
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
    // v.getPointsForVictoryType() can throw pre-Modern age.
  }
}

/**
 * Score one OTHER player's contribution to `id`'s diplomatic approval.
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
 * City-state contribution: +2 when `id` is the CS's suzerain, else 0.
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
    // other.Influence.getSuzerain() can throw for unresolved players.
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
 * Compute aggregate weighted relationship scores.
 * @param {import("./sampler-collectors-core.js").PlayerCtx} ctx The context.
 * @param {Pid} id The sampled player id.
 * @param {*} p The sampled player handle.
 */
export function collectDiplomaticApproval(ctx, id, p) {
  safeCall("diplomaticApproval", () => {
    const dip = p?.Diplomacy;
    if (!_approvalApiAvailable(dip)) return;
    const { major: majorScore, cs: csScore } = _sumApprovalScores(dip, id);
    ctx.diplomaticApproval = majorScore + 0.3 * csScore;
    ctx.diplomaticApprovalMajor = majorScore;
    ctx.diplomaticApprovalCS = csScore;
    dlog(
      "diplomaticApproval pid=" + id,
      "major=" + majorScore,
      "cs=" + csScore,
      "total=" + ctx.diplomaticApproval.toFixed(2)
    );
  });
}

/**
 * Whether the diplomacy + relationship-enum APIs for approval scoring exist.
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
 * Sum the major + city-state approval contributions across alive players.
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
    // Players.getAlive() can throw mid age-transition.
  }
  return { major, cs };
}

/**
 * Resolve a single ResourceEntry's class string.
 * @param {*} r A ResourceEntry item.
 * @returns {*} The resource class string, or undefined.
 */
function resolveResourceClass(r) {
  const cls = r?.classType;
  if (cls) return cls;
  const resType = r?.uniqueResource?.resource ?? r?.type ?? r?.ResourceType;
  return _resourceClassByType(resType);
}

/**
 * Resolve a resource class string from a resource type/hash.
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
    // GameInfo.Resources.lookup() can throw on an unknown resType.
  }
  return undefined;
}

/**
 * Tally a player's resources by class and store counts + total on `ctx`.
 * @param {import("./sampler-collectors-core.js").PlayerCtx} ctx The context.
 * @param {Pid} id The player id.
 * @param {*} p The sampled player handle.
 */
export function collectResourceCategories(ctx, id, p) {
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

/**
 * @typedef {{ bonus: number, empire: number, city: number, factory: number,
 *   treasure: number, unknown: number }} ResourceCounts
 */

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
