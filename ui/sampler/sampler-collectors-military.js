// sampler-collectors-military.js
//
// Military, wonders, and triumph collectors for per-civ sampling.

import { collectorLog, safeCall, safeNum } from "/demographics/ui/sampler/sampler-shared.js";
import { recordUnitStrength } from "/demographics/ui/sampler/sampler-war-events.js";

/**
 * @param {*} cityList The city list (array/array-like) or undefined.
 * @param {Pid} id The player id (for log attribution).
 */
function sumCityWonders(cityList, id) {
  if (!Array.isArray(cityList)) return undefined;
  let total = 0;
  let anyOK = false;
  for (const city of cityList) {
    try {
      const count = _cityWonderCount(city);
      if (count !== undefined) {
        total += count;
        anyOK = true;
      }
    } catch (e) {
      collectorLog.debug("city wonders err pid=", id, e);
    }
  }
  return anyOK ? total : undefined;
}

/** @param {*} city A city handle. */
function _cityWonderCount(city) {
  const con = city?.Constructibles;
  if (!con || typeof con.getNumWonders !== "function") return undefined;
  const count = con.getNumWonders();
  return typeof count === "number" && isFinite(count) ? count : undefined;
}

/**
 * Capture the wonder count.
 * @param {import("./sampler-collectors-core.js").PlayerCtx} ctx
 * @param {Pid} id
 * @param {*} stats The player Stats handle.
 * @param {*} cityList The city list for the fallback path.
 */
export function collectWonderCount(ctx, id, stats, cityList) {
  if (stats && typeof stats.getNumWonders === "function") {
    const wn = safeCall("stats.getNumWonders(false,false) (pid=" + id + ")", () => {
      const total = stats.getNumWonders(false, false);
      return safeNum(total);
    });
    if (typeof wn === "number") ctx.wondersCount = wn;
  }
  if (ctx.wondersCount === undefined) {
    const total = sumCityWonders(cityList, id);
    if (typeof total === "number") ctx.wondersCount = total;
  }
}

/**
 * Capture per-wonder identity (ConstructibleType strings).
 * @param {import("./sampler-collectors-core.js").PlayerCtx} ctx
 * @param {Pid} id
 * @param {*} player The sampled player handle.
 */
export function collectWonderTypes(ctx, id, player) {
  try {
    const playerCon = player?.Constructibles;
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
    collectorLog.debug("wonder type capture err pid=", id, e);
  }
}

/** @param {*} playerCon The player's Constructibles handle. */
function _wonderApiAvailable(playerCon) {
  return !!(
    playerCon &&
    typeof playerCon.getWonders === "function" &&
    typeof Constructibles !== "undefined" &&
    typeof Constructibles.getByComponentID === "function"
  );
}

/** @param {*} type The constructible type/hash (con.type). */
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

/** @param {*} wc A wonder ComponentID. */
function _wonderComponentType(wc) {
  try {
    const con = Constructibles.getByComponentID(wc);
    if (!con || !con.complete || con.damaged) return undefined;
    return _constructibleTypeString(con.type);
  } catch (_) {
    // Constructibles.getByComponentID() can throw for a stale ComponentID.
  }
  return undefined;
}

/**
 * Module-scoped cache for the UnitType map. `GameInfo.Unit_Stats` is static game
 * data that never changes within a session, so a successful build is reused for
 * every player on every sample instead of re-scanning the whole table per call.
 * @type {Map<string, { Combat: number, RangedCombat: number, score: number }>|null}
 */
let _unitStatsByType = null;

/**
 * Build (once, then cache) a UnitType -> strongest-stats-row map from
 * GameInfo.Unit_Stats.
 * @returns {Map<string, { Combat: number, RangedCombat: number, score: number }>}
 *   The cached map (empty, and not cached, on any failure so it can retry).
 */
export function buildUnitStatsByType() {
  if (_unitStatsByType && _unitStatsByType.size > 0) return _unitStatsByType;
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
    // Iterating GameInfo.Unit_Stats can throw if the table is absent.
  }
  if (statsByType.size > 0) _unitStatsByType = statsByType;
  return statsByType;
}

/**
 * @param {Map<string, { Combat: number, RangedCombat: number, score: number }>} statsByType
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

const MILITARY_FORMATIONS = new Set([
  "FORMATION_CLASS_LAND_COMBAT",
  "FORMATION_CLASS_NAVAL",
  "FORMATION_CLASS_AIR"
]);

/**
 * @param {*} unit The unit handle.
 * @param {Map<string, { Combat: number, RangedCombat: number, score: number }>} statsByType
 */
function unitStrength(unit, statsByType) {
  const utype = unit.type;
  if (utype === undefined || utype === null) return 0;
  const def = GameInfo?.Units?.lookup ? GameInfo.Units.lookup(utype) : null;
  if (!def) return 0;
  if (!MILITARY_FORMATIONS.has(def.FormationClass)) return 0;
  return _defStrength(def, statsByType);
}

/**
 * @param {*} def A GameInfo.Units row.
 * @param {Map<string, { Combat: number, RangedCombat: number, score: number }>} statsByType
 */
function _defStrength(def, statsByType) {
  const utStr = def.UnitType;
  const sRow = utStr ? statsByType.get(utStr) : undefined;
  let strength = 0;
  if (sRow) strength = Math.max(sRow.Combat, sRow.RangedCombat);
  if (!strength && typeof def.Combat === "number") strength = def.Combat;
  return strength;
}

/**
 * Compute military power by iterating the player's units and summing combat
 * strength for military formations.
 * @param {import("./sampler-collectors-core.js").PlayerCtx} ctx
 * @param {Pid} id
 * @param {*} player The sampled player handle.
 */
export function collectMilitaryPower(ctx, id, player) {
  safeCall("computeMilitaryPower(pid=" + id + ")", () => {
    const units = player.Units;
    if (!units || typeof units.getUnitIds !== "function") return;
    const ids = units.getUnitIds();
    if (!ids || typeof ids[Symbol.iterator] !== "function") return;
    const statsByType = buildUnitStatsByType();
    const { total, counted } = sumUnitStrengths(ids, statsByType, id);
    if (counted > 0 || total > 0) ctx.militaryPower = total;
    else ctx.militaryPower = 0;
  });
}

/**
 * Iterate unit ids and sum military strength, skipping any unit that throws.
 * Each counted unit's strength is also recorded against its owner.
 * @param {Iterable<*>} ids The player's unit ids.
 * @param {Map<string, { Combat: number, RangedCombat: number, score: number }>} statsByType
 *   Map from {@link buildUnitStatsByType}.
 * @param {number} [owner] The owner pid (for casualty-cache recording).
 * @returns {{ total: number, counted: number }} The summed strength + count.
 */
export function sumUnitStrengths(ids, statsByType, owner) {
  let total = 0;
  let counted = 0;
  for (const uid of ids) {
    try {
      const unit =
        typeof Units !== "undefined" && typeof Units.get === "function"
          ? Units.get(uid)
          : undefined;
      if (!unit) continue;
      const strength = unitStrength(unit, statsByType);
      if (strength > 0) {
        total += strength;
        counted++;
        if (typeof owner === "number") recordUnitStrength(uid, owner, strength);
      }
    } catch (_) {
      // Units.get(uid) can throw for a unit destroyed mid-iteration.
    }
  }
  return { total, counted };
}

// Bucket map: Legacies.LegacySubtype → ctx field name.
/** @type {Record<string, keyof import("./sampler-collectors-core.js").PlayerCtx>} */
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
 * @param {import("./sampler-collectors-core.js").PlayerCtx} ctx
 * @param {*} player The sampled player handle.
 */
export function collectLegacyTriumphs(ctx, player) {
  ctx.triumphsCultural = 0;
  ctx.triumphsDiplomatic = 0;
  ctx.triumphsEconomic = 0;
  ctx.triumphsScientific = 0;
  ctx.triumphsMilitaristic = 0;
  ctx.triumphsExpansionist = 0;
  ctx.triumphsInProgress = 0;
  safeCall("triumphs/test-of-time", () => {
    const legacies = player?.Legacies;
    if (!legacies) return;
    if (typeof GameInfo === "undefined" || !GameInfo.Legacies) return;
    let inProgress = 0;
    try {
      for (const row of GameInfo.Legacies) {
        if (tallyTriumphRow(ctx, legacies, row)) inProgress++;
      }
    } catch (_) {
      // Iterating GameInfo.Legacies / probing Legacies handle can throw.
    }
    ctx.triumphsInProgress = inProgress;
  });
}

/**
 * Tally one Legacies row.
 * @param {import("./sampler-collectors-core.js").PlayerCtx} ctx
 * @param {*} legacies The player's Legacies handle.
 * @param {*} row A GameInfo.Legacies row.
 * @returns {boolean} True if the row is an untriggered, in-progress triumph.
 */
export function tallyTriumphRow(ctx, legacies, row) {
  if (!row || !row.LegacyType) return false;
  const ctxKey = SUBTYPE_TO_KEY[row.LegacySubtype];
  if (_legacyTriggered(legacies, row.LegacyType)) {
    if (ctxKey) ctx[ctxKey] = (ctx[ctxKey] || 0) + 1;
    return false;
  }
  return _legacyInProgress(legacies, row.LegacyType);
}

/**
 * @param {*} legacies The player's Legacies handle.
 * @param {string} legacyType
 */
function _legacyTriggered(legacies, legacyType) {
  try {
    return !!legacies.isTriggered?.(legacyType);
  } catch (_) {
    return false;
  }
}

/**
 * @param {*} legacies The player's Legacies handle.
 * @param {string} legacyType
 */
function _legacyInProgress(legacies, legacyType) {
  try {
    const prog = legacies.getProgress?.(legacyType);
    const cur = prog?.progress?.[0]?.current;
    return typeof cur === "number" && cur > 0;
  } catch (_) {
    return false;
  }
}
