// relations-edges-city-states.js
//
// City-State edge and type helpers for the Global Relations ring.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import {
  CS_AGREEMENT_TYPES,
  log,
  safeCall
} from "/demographics/ui/screen-demographics/views/relations/relations-shared.js";
import {
  attitudeKeyFromEnum,
  categoryColor,
  getPlayerEvents,
  getRelationship,
  isAtWar,
  resolveEventOther,
  resolveTradeHandle,
  tradeRouteCount
} from "/demographics/ui/screen-demographics/views/relations/relations-edges.js";

/**
 * One relationship edge between two ring nodes.
 * @typedef {Object} Edge
 * @property {number} a Source player id.
 * @property {number} b Target player id.
 * @property {string} [color] Stroke color.
 * @property {string} [label] Optional edge label.
 * @property {string} [filterKey] Filter category.
 * @property {boolean} [dashed] Dashed-line flag, set directly by suzerain edges.
 * @property {boolean} [directed] When set, render a→b direction chevrons.
 * @property {number} [width] Per-edge stroke width.
 * @property {number} [opacity] Per-edge stroke opacity.
 * @property {string|null} [_dashOverride] Per-tab dash-pattern override.
 */

function canResolveCsBonusType() {
  if (!Game?.CityStates) return false;
  if (typeof Game.CityStates.getBonusType !== "function") return false;
  if (typeof GameInfo === "undefined") return false;
  return !!GameInfo.CityStateBonuses;
}

/** @param {number} bonusHash */
function findBonusRow(bonusHash) {
  /** @type {*} */
  let row = null;
  try {
    if (typeof GameInfo.CityStateBonuses.find === "function") {
      row = GameInfo.CityStateBonuses.find(
        (/** @type {*} */ bonusRow) => bonusRow && bonusRow.$hash === bonusHash
      );
    } else if (GameInfo.CityStateBonuses[Symbol.iterator]) {
      for (const bonusRow of GameInfo.CityStateBonuses) {
        if (bonusRow && bonusRow.$hash === bonusHash) {
          row = bonusRow;
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
 * @param {number} pid
 * @returns {string|null}
 */
function csTypeFromBonus(pid) {
  if (!canResolveCsBonusType()) return null;
  const bonusHash = Game.CityStates.getBonusType(pid);
  if (bonusHash == null || bonusHash === -1) return null;
  const row = findBonusRow(bonusHash);
  if (row?.CityStateType) return row.CityStateType;
  return null;
}

function canResolveIndependentCsType() {
  if (typeof Players?.get !== "function") return false;
  if (typeof GameInfo === "undefined") return false;
  return !!GameInfo.Independents;
}

/** @param {string} adjective */
function findIndependentRow(adjective) {
  /** @type {*} */
  let match = null;
  try {
    if (typeof GameInfo.Independents.forEach === "function") {
      GameInfo.Independents.forEach((/** @type {*} */ independentRow) => {
        if (!match && independentRow && independentRow.CityStateName === adjective) {
          match = independentRow;
        }
      });
    } else if (GameInfo.Independents[Symbol.iterator]) {
      for (const independentRow of GameInfo.Independents) {
        if (independentRow && independentRow.CityStateName === adjective) {
          match = independentRow;
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
 * @param {number} pid
 * @returns {string|null}
 */
function csTypeFromIndependents(pid) {
  if (!canResolveIndependentCsType()) return null;
  const player = Players.get(pid);
  const adjective = player?.civilizationAdjective;
  if (typeof adjective !== "string" || adjective.length === 0) return null;
  const match = findIndependentRow(adjective);
  if (match?.CityStateType) return match.CityStateType;
  return null;
}

/**
 * Resolve a city-state type string (MILITARISTIC / CULTURAL / etc.).
 * @param {number} pid
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
// City-state type colors use the same vivid game-yield palette as the agreement
// chart (militaristic = military red, cultural = culture purple, economic = gold,
// scientific = science blue, expansionist = production, diplomatic = influence).
const CS_TYPE_META = {
  MILITARISTIC: {
    label: "LOC_DEMOGRAPHICS_CSTYPE_MILITARISTIC",
    color: "#e8493c", // military (vivid red)
    icon: "blp:bonus_militaristic"
  },
  CULTURAL: {
    label: "LOC_DEMOGRAPHICS_CSTYPE_CULTURAL",
    color: "#b25ce0", // culture (vivid purple)
    icon: "blp:bonus_cultural"
  },
  ECONOMIC: {
    label: "LOC_DEMOGRAPHICS_CSTYPE_ECONOMIC",
    color: "#f0c33c", // gold (vivid)
    icon: "blp:bonus_economic"
  },
  SCIENTIFIC: {
    label: "LOC_DEMOGRAPHICS_CSTYPE_SCIENTIFIC",
    color: "#4ea6ec", // science (vivid blue)
    icon: "blp:bonus_scientific"
  },
  EXPANSIONIST: {
    label: "LOC_DEMOGRAPHICS_CSTYPE_EXPANSIONIST",
    color: "#d97b2c", // production (vivid burnt orange)
    icon: "blp:bonustype_expansionist"
  },
  DIPLOMATIC: {
    label: "LOC_DEMOGRAPHICS_CSTYPE_DIPLOMATIC",
    color: "#2fc79a", // influence (vivid teal)
    icon: "blp:bonustype_diplomatic"
  }
};

/**
 * Look up display meta (label/color/icon) for a CS type string.
 * @param {*} typeStr
 * @returns {{ label: string, color: string, icon: string }|null}
 */
export function csTypeMeta(typeStr) {
  if (typeof typeStr !== "string") return null;
  const meta = CS_TYPE_META[typeStr.toUpperCase()];
  if (!meta) return null;
  return { label: t(meta.label), color: meta.color, icon: meta.icon };
}

/** @param {*} cityState */
function readSuzerain(cityState) {
  const influence = cityState?.Influence;
  if (!influence || typeof influence.getSuzerain !== "function") return -1;
  let suzerainId = -1;
  try {
    suzerainId = influence.getSuzerain();
  } catch (_) {
    suzerainId = -1;
  }
  return typeof suzerainId === "number" ? suzerainId : -1;
}

/**
 * @param {*} cityState
 * @returns {number}
 */
function readSuzerainLoose(cityState) {
  try {
    return cityState.Influence?.getSuzerain?.() ?? -1;
  } catch (_) {
    return -1;
  }
}

/**
 * Build CS suzerain edges.
 * @param {number[]} metIds
 * @param {number[]} csIds
 * @param {number} [localPid]
 * @returns {Edge[]}
 */
export function buildCsSuzerainEdges(metIds, csIds, localPid) {
  /** @type {Edge[]} */
  const edges = [];
  if (typeof Players === "undefined" || typeof Players.get !== "function") return edges;
  const majors = new Set(metIds);
  if (typeof localPid === "number") majors.add(localPid);
  for (const csId of csIds) {
    const cityState = safeCall("Players.get(" + csId + ")", () => Players.get(csId), null);
    const suzerainId = readSuzerain(cityState);
    if (suzerainId < 0 || !majors.has(suzerainId)) continue;
    edges.push({ a: suzerainId, b: csId, color: "#f3c34c", dashed: true, filterKey: "suzerain" });
  }
  return edges;
}

/**
 * Build CS trade edges (major -> CS).
 * @param {number[]} metIds
 * @param {number[]} csIds
 * @param {number} [localPid]
 * @returns {Edge[]}
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
      const routeCount = tradeRouteCount(trade, csId);
      if (routeCount > 0) {
        const weight = Math.min(1, routeCount / 3);
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
 * Pre-resolve CS agreement action ints + colors/keys, skipping enums absent at
 * runtime (e.g. an action not present in the current age).
 * @returns {{ t: number, color: string, key: string }[]}
 */
function resolveCsAgreementLookups() {
  /** @type {{ t: number, color: string, key: string }[]} */
  const out = [];
  const Types = typeof DiplomacyActionTypes !== "undefined" ? DiplomacyActionTypes : null;
  if (!Types) return out;
  for (const entry of CS_AGREEMENT_TYPES) {
    const actionInt = Types[entry.action];
    if (typeof actionInt === "number") {
      out.push({ t: actionInt, color: entry.color, key: entry.key });
    }
  }
  return out;
}

/**
 * @typedef {Object} CsAgreementCtx
 * @property {Set<string>} seen Dedupe key set (mutated).
 * @property {Set<number>} majors Major ids in scope.
 * @property {{ t: number, color: string, key: string }[]} lookups Resolved action lookups.
 */

/**
 * @param {Edge[]} edges
 * @param {*} ev
 * @param {number} csId
 * @param {CsAgreementCtx} ctx
 */
function appendCsAgreementEdge(edges, ev, csId, ctx) {
  if (!ev || typeof ev.actionType !== "number") return;
  const hit = ctx.lookups.find((lookup) => lookup.t === ev.actionType);
  if (!hit) return;
  const major = resolveEventOther(ev, csId);
  if (typeof major !== "number" || !ctx.majors.has(major)) return;
  const key = major + "|" + csId + "|" + hit.t;
  if (ctx.seen.has(key)) return;
  ctx.seen.add(key);
  edges.push({ a: major, b: csId, color: hit.color, filterKey: hit.key, directed: true });
}

/**
 * Build City-State cooperative-agreement edges (major -> CS): befriending plus the
 * suzerain benefit directives, read from each CS's own event list (as the base
 * befriend-independent screen does).
 * @param {number[]} metIds
 * @param {number[]} csIds
 * @param {number} [localPid]
 * @returns {Edge[]}
 */
export function buildCsAgreementEdges(metIds, csIds, localPid) {
  /** @type {Edge[]} */
  const edges = [];
  if (typeof Players === "undefined" || typeof Players.get !== "function") return edges;
  const lookups = resolveCsAgreementLookups();
  if (lookups.length === 0) return edges;
  const majors = new Set(metIds);
  if (typeof localPid === "number") majors.add(localPid);
  const ctx = { seen: new Set(), majors, lookups };
  for (const csId of csIds) {
    for (const ev of getPlayerEvents(csId)) {
      appendCsAgreementEdge(edges, ev, csId, ctx);
    }
  }
  return edges;
}

/**
 * @param {*} major
 * @param {number} majorPid
 * @param {number} csId
 * @param {number} suzerainId
 */
function csAttitudeCatFor(major, majorPid, csId, suzerainId) {
  const rel = getRelationship(major, csId);
  if (rel !== undefined && rel !== null) {
    if (isAtWar(major, csId)) return "war";
    return attitudeKeyFromEnum(rel);
  }
  if (typeof suzerainId === "number" && suzerainId >= 0) {
    return suzerainId === majorPid ? "helpful" : "neutral";
  }
  return null;
}

/**
 * @param {Edge[]} edges
 * @param {number[]} majors
 * @param {number} csId
 * @param {number} suzerainId
 */
function appendCsAttitudeForCs(edges, majors, csId, suzerainId) {
  let anyEmitted = false;
  for (const majorPid of majors) {
    const major = safeCall("Players.get(" + majorPid + ")", () => Players.get(majorPid), null);
    if (!major) continue;
    const catKey = csAttitudeCatFor(major, majorPid, csId, suzerainId);
    if (catKey === null) continue;
    edges.push({ a: majorPid, b: csId, color: categoryColor(catKey), filterKey: catKey });
    anyEmitted = true;
  }
  return anyEmitted;
}

/**
 * Build CS attitude edges (major -> CS).
 * @param {number[]} metIds
 * @param {number[]} csIds
 * @param {number} [localPid]
 * @returns {Edge[]}
 */
export function buildCsAttitudeEdges(metIds, csIds, localPid) {
  /** @type {Edge[]} */
  const edges = [];
  if (typeof Players === "undefined" || typeof Players.get !== "function") return edges;
  const majors = metIds.slice();
  if (typeof localPid === "number" && !majors.includes(localPid)) majors.push(localPid);

  for (const csId of csIds) {
    const cityState = safeCall("Players.get(" + csId + ")", () => Players.get(csId), null);
    if (!cityState) continue;
    const suzerainId = readSuzerainLoose(cityState);
    const anyEmitted = appendCsAttitudeForCs(edges, majors, csId, suzerainId);
    if (!anyEmitted) {
      log.debug("CS attitude: skipped CS pid", csId, "(no useful relationship data)");
    }
  }
  return edges;
}
