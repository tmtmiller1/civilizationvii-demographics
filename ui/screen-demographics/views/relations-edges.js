// relations-edges.js
//
// Per-subtab edge builders for the Global Relations ring: political actions
// (alliance / war / denounced / research / endeavors / open borders), economic
// trade routes, pairwise attitudes, and the City-State suzerain / trade /
// attitude builders. Also owns the diplomatic-query helpers, attitude/color
// resolution, and the City-State type resolution those builders rely on.
// Split out of view-relations.js.
//
// V7 diplomacy accessors in use:
//   player.Diplomacy.isAtWarWith(other)
//   player.Diplomacy.hasAllied(other)
//   player.Diplomacy.getRelationshipEnum(other)
//   DiplomacyPlayerRelationships.PLAYER_RELATIONSHIP_*
//   csPlayer.Influence.getSuzerain()
//   player.Trade.countPlayerTradeRoutesTo(otherId)
//   DiplomacyActionTypes.DIPLOMACY_ACTION_OPEN_BORDERS
//   Game.Diplomacy.getPlayerEvents(playerId)

import { safeCall } from "/demographics/ui/screen-demographics/views/relations-shared.js";
import { getAttitudeColors } from "/demographics/ui/demographics-palette.js";
export {
  buildCsAttitudeEdges,
  buildCsSuzerainEdges,
  buildCsTradeEdges,
  csTypeMeta,
  resolveCsType
} from "/demographics/ui/screen-demographics/views/relations-edges-cs.js";

/**
 * One relationship edge between two ring nodes. `a`/`b` are player ids; the
 * remaining fields are visual hints consumed by the ring renderer.
 * @typedef {Object} Edge
 * @property {number} a Source player id.
 * @property {number} b Target player id.
 * @property {string} [color] Stroke color (hex or rgba).
 * @property {string} [label] Optional human-readable edge label.
 * @property {string} [filterKey] Filter category this edge belongs to.
 * @property {boolean} [dashed] Legacy dashed-line flag (suzerain edges).
 * @property {number} [width] Per-edge stroke width (currently ignored).
 * @property {number} [opacity] Per-edge stroke opacity (currently ignored).
 * @property {string|null} [_dashOverride] Per-tab dash-pattern override.
 */

/**
 * A pre-resolved endeavor/treaty action lookup: engine action-type int plus
 * the edge color and original action name.
 * @typedef {Object} ActionLookup
 * @property {number} t Engine `DiplomacyActionTypes` int.
 * @property {string} color Edge color for this action.
 * @property {string} name Original `DIPLOMACY_ACTION_*` name.
 */

// ---- diplomatic queries ---------------------------------------------------

/**
 * Whether `p1` has an alliance with player `p2id`, defensively.
 * @param {*} p1 Source player handle.
 * @param {number} p2id Target player id.
 * @returns {boolean} True when an alliance is reported.
 */
function hasAlliance(p1, p2id) {
  return safeCall(
    "hasAllied",
    () => {
      const d = p1?.Diplomacy;
      if (!d) return false;
      if (typeof d.hasAllied === "function") return !!d.hasAllied(p2id);
      return false;
    },
    false
  );
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
      const d = p1?.Diplomacy;
      if (!d) return false;
      if (typeof d.isAtWarWith === "function") return !!d.isAtWarWith(p2id);
      return false;
    },
    false
  );
}

/**
 * Resolve the engine relationship enum from `p1` toward `p2id`, defensively.
 * @param {*} p1 Source player handle.
 * @param {number} p2id Target player id.
 * @returns {*} The relationship enum value, or `undefined`.
 */
function getRelationship(p1, p2id) {
  return safeCall("getRelationshipEnum", () => {
    const d = p1?.Diplomacy;
    if (!d || typeof d.getRelationshipEnum !== "function") return undefined;
    return d.getRelationshipEnum(p2id);
  });
}

// ---- color tables ---------------------------------------------------------

// Attitude colors are fetched live from `getAttitudeColors()` so the
// colorblind-mode toggle in Options swaps them without a mod reload. The keys
// match DiplomacyPlayerRelationships, resolved at runtime by attitudeKeyFromEnum.

/**
 * Map an engine relationship enum to one of the seven attitude keys.
 * @param {*} rel The relationship enum value.
 * @returns {string} The attitude key (defaults to "neutral").
 */
function attitudeKeyFromEnum(rel) {
  if (typeof DiplomacyPlayerRelationships === "undefined" || !DiplomacyPlayerRelationships) {
    return "neutral";
  }
  const E = DiplomacyPlayerRelationships;
  if (rel === E.PLAYER_RELATIONSHIP_ALLIANCE) return "alliance";
  if (rel === E.PLAYER_RELATIONSHIP_FRIENDLY) return "friendly";
  if (rel === E.PLAYER_RELATIONSHIP_HELPFUL) return "helpful";
  if (rel === E.PLAYER_RELATIONSHIP_NEUTRAL) return "neutral";
  if (rel === E.PLAYER_RELATIONSHIP_UNFRIENDLY) return "unfriendly";
  if (rel === E.PLAYER_RELATIONSHIP_HOSTILE) return "hostile";
  if (rel === E.PLAYER_RELATIONSHIP_AT_WAR) return "war";
  return "neutral";
}

/**
 * Resolve the live palette color for an attitude key.
 * @param {string} key Attitude key.
 * @returns {string} The palette color (gray fallback).
 */
function categoryColor(key) {
  const colors = getAttitudeColors();
  return colors[key] || "#bfbfbf";
}

// Action-type display config for endeavor-class diplomatic actions.
/** @type {Record<string, { name: string, color: string }[]>} */
const ENDEAVOR_ACTIONS = {
  research: [
    { name: "DIPLOMACY_ACTION_RESEARCH_COLLABORATION", color: "#c084fc" },
    { name: "DIPLOMACY_ACTION_SHARE_INNOVATIONS", color: "#c084fc" },
    { name: "DIPLOMACY_ACTION_SABOTAGE_RESEARCH", color: "#aa3030" }
  ],
  endeavors: [
    { name: "DIPLOMACY_ACTION_CULTURAL_EXCHANGE", color: "#c9a2dc" },
    { name: "DIPLOMACY_ACTION_IMPROVE_TRADE_RELATIONS", color: "#3fbf3f" },
    { name: "DIPLOMACY_ACTION_FARMERS_MARKET", color: "#9ad17a" },
    { name: "DIPLOMACY_ACTION_LOCAL_FESTIVALS", color: "#e6a23c" },
    { name: "DIPLOMACY_ACTION_PIONEERING", color: "#dba268" },
    { name: "DIPLOMACY_ACTION_GINSING_AGREEMENT", color: "#f5a060" },
    { name: "DIPLOMACY_ACTION_FRIEND_OF_WA", color: "#f5a060" },
    { name: "DIPLOMACY_ACTION_SEND_DELEGATION", color: "#a0d0e0" },
    { name: "DIPLOMACY_ACTION_TRADE_MAP", color: "#81a2be" },
    { name: "DIPLOMACY_ACTION_MILITARY_AID", color: "#d97c7c" }
  ]
};

// ---- per-subtab edge builders ---------------------------------------------
// Each builder returns an array of edge objects:
//   { a, b, color, label?, dashed?, width?, opacity? }
// where a, b are pids and a <= b unless otherwise noted.

/**
 * Read a player's diplomatic events list defensively.
 * @param {number} a Player id whose events to read.
 * @returns {*[]} The events array (empty on any error).
 */
function getPlayerEvents(a) {
  return (
    safeCall("getPlayerEvents(" + a + ")", () => {
      if (
        typeof Game === "undefined" ||
        !Game.Diplomacy ||
        typeof Game.Diplomacy.getPlayerEvents !== "function"
      )
        return [];
      return Game.Diplomacy.getPlayerEvents(a) || [];
    }) || []
  );
}

/**
 * Resolve the "other" player id involved in a diplomacy event, relative to
 * the queried player `a`. Mirrors the original target/other/initial fallback.
 * @param {*} ev One diplomacy event.
 * @param {number} a The player whose events list `ev` came from.
 * @returns {number|undefined} The other player id, or `undefined`.
 */
function resolveEventOther(ev, a) {
  let other = ev.targetPlayer;
  if (typeof other !== "number") other = ev.otherPlayer;
  if (typeof other !== "number") {
    other = ev.initialPlayer !== a ? ev.initialPlayer : undefined;
  }
  return other;
}

/**
 * Build undirected alliance edges among the met-major ring.
 * @param {number[]} metIds Met major ids.
 * @returns {Edge[]} Alliance edges.
 */
function buildAllianceEdges(metIds) {
  /** @type {Edge[]} */
  const edges = [];
  for (let i = 0; i < metIds.length; i++) {
    const a = metIds[i];
    const pa = Players.get(a);
    if (!pa) continue;
    for (let j = i + 1; j < metIds.length; j++) {
      const b = metIds[j];
      if (hasAlliance(pa, b)) {
        edges.push({ a, b, color: "#9933ff", filterKey: "alliance" });
      }
    }
  }
  return edges;
}

/**
 * Build undirected at-war edges among the met-major ring.
 * @param {number[]} metIds Met major ids.
 * @returns {Edge[]} War edges.
 */
function buildWarEdges(metIds) {
  /** @type {Edge[]} */
  const edges = [];
  for (let i = 0; i < metIds.length; i++) {
    const a = metIds[i];
    const pa = Players.get(a);
    if (!pa) continue;
    for (let j = i + 1; j < metIds.length; j++) {
      const b = metIds[j];
      if (isAtWar(pa, b)) {
        edges.push({ a, b, color: "#e02020", filterKey: "war" });
      }
    }
  }
  return edges;
}

/**
 * Build undirected edges for a single diplomatic action type queried via
 * `getPlayerEvents`, deduping reciprocal events with a sorted pair key.
 * @param {number[]} metIds Met major ids.
 * @param {number|undefined} actionType The `DIPLOMACY_ACTION_*` int to match.
 * @param {string} color Edge color.
 * @param {string} filterKey Filter key to tag edges with.
 * @returns {Edge[]} The matching edges.
 */
function buildActionTypeEdges(metIds, actionType, color, filterKey) {
  /** @type {Edge[]} */
  const edges = [];
  if (actionType === undefined) return edges;
  const seen = new Set();
  for (const a of metIds) {
    const events = getPlayerEvents(a);
    for (const ev of events) {
      if (!ev || ev.actionType !== actionType) continue;
      const other = resolveEventOther(ev, a);
      if (typeof other !== "number" || other === a) continue;
      if (!metIds.includes(other)) continue;
      const key = Math.min(a, other) + "|" + Math.max(a, other);
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ a, b: other, color, filterKey });
    }
  }
  return edges;
}

/**
 * Pre-resolve an endeavor action list into engine int + color lookups,
 * skipping entries with no runtime `DiplomacyActionTypes` int.
 * @param {{ name: string, color: string }[]} actionList Endeavor entries.
 * @returns {ActionLookup[]} Resolved lookups.
 */
function resolveEndeavorLookups(actionList) {
  /** @type {ActionLookup[]} */
  const lookups = [];
  const Types = typeof DiplomacyActionTypes !== "undefined" ? DiplomacyActionTypes : null;
  if (!Types) return lookups;
  for (const entry of actionList) {
    const actionInt = Types[entry.name];
    if (typeof actionInt === "number") {
      lookups.push({ t: actionInt, color: entry.color, name: entry.name });
    }
  }
  return lookups;
}

/**
 * Format an endeavor action name into a human-readable edge label.
 * @param {string} name The `DIPLOMACY_ACTION_*` name.
 * @returns {string} The lower-cased, spaced label.
 */
function endeavorLabel(name) {
  return name
    .replace(/^DIPLOMACY_ACTION_/, "")
    .toLowerCase()
    .replace(/_/g, " ");
}

/**
 * Generic endeavor / treaty scanner. Each diplomatic action type appears in
 * BOTH participants' `getPlayerEvents()` list, so we dedupe via a sorted pair
 * + action-type key. Each entry carries its own edge color.
 * @param {{ name: string, color: string }[]} actionList ENDEAVOR_ACTIONS entry.
 * @param {number[]} metIds Met major ids.
 * @param {string} filterKey Filter key to tag edges with.
 * @returns {Edge[]} The endeavor edges.
 */
function pushEndeavorEdges(actionList, metIds, filterKey) {
  /** @type {Edge[]} */
  const edges = [];
  if (!actionList || actionList.length === 0) return edges;
  // Pre-resolve action-type ints + their colors so the inner loop is
  // O(events × types) without repeating string→enum lookups.
  const lookups = resolveEndeavorLookups(actionList);
  if (lookups.length === 0) return edges;
  const seen = new Set();
  for (const a of metIds) {
    for (const ev of getPlayerEvents(a)) {
      pushOneEndeavorEdge(edges, seen, ev, a, metIds, lookups, filterKey);
    }
  }
  return edges;
}

/**
 * Match one diplomacy event against the endeavor lookups and append an edge
 * (deduped on sorted pair + action type) if it qualifies.
 * @param {Edge[]} edges Accumulator to push into.
 * @param {Set<string>} seen Dedupe key set (mutated).
 * @param {*} ev One diplomacy event.
 * @param {number} a The player whose events list `ev` came from.
 * @param {number[]} metIds Met major ids.
 * @param {ActionLookup[]} lookups Pre-resolved endeavor lookups.
 * @param {string} filterKey Filter key to tag the edge with.
 */
function pushOneEndeavorEdge(edges, seen, ev, a, metIds, lookups, filterKey) {
  if (!ev || typeof ev.actionType !== "number") return;
  const hit = lookups.find((l) => l.t === ev.actionType);
  if (!hit) return;
  const other = resolveEventOther(ev, a);
  if (typeof other !== "number" || other === a) return;
  if (!metIds.includes(other)) return;
  // Dedupe pair + action-type so different endeavors between the same pair
  // show as separate edges.
  const key = Math.min(a, other) + "|" + Math.max(a, other) + "|" + hit.t;
  if (seen.has(key)) return;
  seen.add(key);
  edges.push({ a, b: other, color: hit.color, filterKey, label: endeavorLabel(hit.name) });
}

/**
 * Resolve a `DiplomacyActionTypes` enum int by name, defensively.
 * @param {string} name The `DIPLOMACY_ACTION_*` enum name.
 * @returns {number|undefined} The action-type int, or `undefined`.
 */
function actionTypeByName(name) {
  return typeof DiplomacyActionTypes !== "undefined" ? DiplomacyActionTypes[name] : undefined;
}

/**
 * Build the political-action edges for a single filter key (alliance, war,
 * denounced, research, endeavors, openborders) among the met-major ring.
 * @param {number[]} metIds Met major ids.
 * @param {string} filterKey The political filter key to build.
 * @returns {Edge[]} The edges for that filter (empty when unhandled).
 */
export function buildPoliticalEdges(metIds, filterKey) {
  if (typeof Players === "undefined" || typeof Players.get !== "function") return [];

  if (filterKey === "alliance") return buildAllianceEdges(metIds);
  if (filterKey === "war") return buildWarEdges(metIds);
  if (filterKey === "research" || filterKey === "endeavors") {
    return pushEndeavorEdges(ENDEAVOR_ACTIONS[filterKey], metIds, filterKey);
  }
  if (filterKey === "denounced") {
    // Denunciations are diplomatic actions, queried via getPlayerEvents the
    // same way Open Borders is. Direction matters (A denounced B is not
    // symmetric), but the ring treats edges as undirected pairs - we collapse
    // with a sorted key to dedupe reciprocal denounces.
    return buildActionTypeEdges(
      metIds,
      actionTypeByName("DIPLOMACY_ACTION_DENOUNCE"),
      "#ff7f1a",
      "denounced"
    );
  }
  if (filterKey === "openborders") {
    // Open Borders is a diplomatic action/deal. Cited pattern:
    // base-standard/ui/diplomacy-actions/panel-diplomacy-actions.js, 2413-2417.
    return buildActionTypeEdges(
      metIds,
      actionTypeByName("DIPLOMACY_ACTION_OPEN_BORDERS"),
      "#5bc8ff",
      "openborders"
    );
  }
  return [];
}

/**
 * Resolve a player's `Trade` handle if it exposes `countPlayerTradeRoutesTo`.
 * @param {number} fromPid Source player id.
 * @returns {*} The trade handle, or `null`.
 */
function resolveTradeHandle(fromPid) {
  const fromPlayer = safeCall("Players.get(" + fromPid + ")", () => Players.get(fromPid), null);
  const trade = fromPlayer?.Trade;
  if (!trade || typeof trade.countPlayerTradeRoutesTo !== "function") return null;
  return trade;
}

/**
 * Count trade routes from a trade handle to `toPid`, defensively.
 * @param {*} trade The source player's trade handle.
 * @param {number} toPid Destination player id.
 * @returns {number} The route count (`0` on any error).
 */
function tradeRouteCount(trade, toPid) {
  try {
    return trade.countPlayerTradeRoutesTo(toPid) | 0;
  } catch (_) {
    // trade.countPlayerTradeRoutesTo(toPid) can throw at the engine boundary;
    // treat as no routes.
    return 0;
  }
}

/**
 * Build trade-route edges among the met-major ring (plus the local player),
 * one per directed pair with a route count > 0.
 * @param {number[]} metIds Met major ids.
 * @param {string} _filterKey Unused (kept for builder-signature parity).
 * @param {number} [localPid] Local player id to fold into the source set.
 * @returns {Edge[]} Trade edges.
 */
export function buildEconomicEdges(metIds, _filterKey, localPid) {
  // Per-pair trade route count via player.Trade.countPlayerTradeRoutesTo(otherId).
  /** @type {Edge[]} */
  const edges = [];
  if (typeof Players === "undefined" || typeof Players.get !== "function") return edges;
  const pids = metIds.slice();
  if (typeof localPid === "number" && !pids.includes(localPid)) pids.push(localPid);
  for (const fromPid of pids) {
    const trade = resolveTradeHandle(fromPid);
    if (!trade) continue;
    for (const toPid of pids) {
      if (toPid === fromPid) continue;
      const n = tradeRouteCount(trade, toPid);
      if (n > 0) {
        const weight = Math.min(1, n / 3);
        edges.push({
          a: fromPid,
          b: toPid,
          color: "#4dc6c6",
          opacity: 0.5 + weight * 0.5,
          filterKey: "trade"
        });
      }
    }
  }
  return edges;
}

// Pairwise attitude edges among met majors.
// For each pair (i, j) i<j we look at getRelationship from i's perspective
// (sloth uses the same one-sided lookup; the relationship enum is symmetric
// in practice). War / Alliance are surfaced explicitly so they color over
// the bare enum.

/**
 * Resolve the attitude category key for a directed (a → b) relationship,
 * surfacing war / alliance explicitly over the bare enum.
 * @param {*} pa Source player handle.
 * @param {number} b Target player id.
 * @returns {string} The attitude category key.
 */
function attitudeCatFor(pa, b) {
  if (isAtWar(pa, b)) return "war";
  if (hasAlliance(pa, b)) return "alliance";
  return attitudeKeyFromEnum(getRelationship(pa, b));
}

/**
 * Build pairwise attitude edges among met majors.
 * @param {number[]} metIds Met major ids.
 * @param {number} [_localPid] Unused (kept for builder-signature parity).
 * @returns {Edge[]} Attitude edges.
 */
export function buildAttitudeEdges(metIds, _localPid) {
  /** @type {Edge[]} */
  const edges = [];
  if (typeof Players === "undefined" || typeof Players.get !== "function") return edges;
  for (let i = 0; i < metIds.length; i++) {
    const a = metIds[i];
    const pa = Players.get(a);
    if (!pa) continue;
    for (let j = i + 1; j < metIds.length; j++) {
      const b = metIds[j];
      const catKey = attitudeCatFor(pa, b);
      edges.push({ a, b, color: categoryColor(catKey), filterKey: catKey });
    }
  }
  return edges;
}

/** Political filter keys that are sourced from diplomacy-event scans. */
const POLITICAL_EVENT_FILTER_KEYS = ["openborders", "denounced", "research", "endeavors"];

/**
 * Context for fused pairwise civ-edge construction.
 * @typedef {Object} CivPairContext
 * @property {number[]} pids Major ids in scope (met + local).
 * @property {Map<number, *>} playersById Cached Players.get handles.
 * @property {Map<number, *>} tradesById Cached Trade handles.
 */

/**
 * Resolve major-player and trade handles once for the civ-ring passes.
 * @param {number[]} metIds Met major ids.
 * @param {number|undefined} localPid Local player id to force-include.
 * @returns {CivPairContext} Resolved pairwise context.
 */
function resolveCivPairContext(metIds, localPid) {
  const pids = metIds.slice();
  if (typeof localPid === "number" && !pids.includes(localPid)) pids.push(localPid);
  /** @type {Map<number, *>} */
  const playersById = new Map();
  /** @type {Map<number, *>} */
  const tradesById = new Map();
  for (const pid of pids) {
    const p = safeCall("Players.get(" + pid + ")", () => Players.get(pid), null);
    playersById.set(pid, p);
    tradesById.set(pid, resolveTradeHandle(pid));
  }
  return { pids, playersById, tradesById };
}

/**
 * Append directional trade edges for one unordered major-major pair.
 * @param {Edge[]} edges Accumulator to push into.
 * @param {number} a First player id.
 * @param {number} b Second player id.
 * @param {*} tradeA Trade handle for `a` (or null).
 * @param {*} tradeB Trade handle for `b` (or null).
 */
function appendPairTradeEdges(edges, a, b, tradeA, tradeB) {
  if (tradeA) {
    const nAB = tradeRouteCount(tradeA, b);
    if (nAB > 0) {
      const wAB = Math.min(1, nAB / 3);
      edges.push({
        a,
        b,
        color: "#4dc6c6",
        opacity: 0.5 + wAB * 0.5,
        filterKey: "trade"
      });
    }
  }
  if (tradeB) {
    const nBA = tradeRouteCount(tradeB, a);
    if (nBA > 0) {
      const wBA = Math.min(1, nBA / 3);
      edges.push({
        a: b,
        b: a,
        color: "#4dc6c6",
        opacity: 0.5 + wBA * 0.5,
        filterKey: "trade"
      });
    }
  }
}

/**
 * Fused civ pair pass: one i<j loop computes attitude (optional) and trade.
 * @param {CivPairContext} ctx Pre-resolved pair context.
 * @param {boolean} includeAttitude Whether to emit attitude-family edges.
 * @returns {Edge[]} Pairwise edges.
 */
function buildPairwiseCivEdges(ctx, includeAttitude) {
  /** @type {Edge[]} */
  const edges = [];
  const { pids, playersById, tradesById } = ctx;
  for (let i = 0; i < pids.length; i++) {
    const a = pids[i];
    const pa = playersById.get(a);
    for (let j = i + 1; j < pids.length; j++) {
      const b = pids[j];
      const tradeA = tradesById.get(a) || null;
      const tradeB = tradesById.get(b) || null;
      try {
        if (includeAttitude && pa) {
          const catKey = attitudeCatFor(pa, b);
          edges.push({ a, b, color: categoryColor(catKey), filterKey: catKey });
        }
        appendPairTradeEdges(edges, a, b, tradeA, tradeB);
      } catch (_) {
        // One pair can fail on transient engine reads; skip that pair only.
      }
    }
  }
  return edges;
}

/**
 * Build the full civ-ring edge set tagged by filter key so callers can cache
 * once and apply filter toggles without re-querying engine state.
 * @param {number[]} metIds Met major ids.
 * @param {number|undefined} localPid Local player id.
 * @param {boolean} includeAttitude Whether to include attitude-family edges.
 * @returns {Edge[]} Full tagged edge set.
 */
export function buildCivTaggedEdges(metIds, localPid, includeAttitude) {
  /** @type {Edge[]} */
  let edges = [];
  if (typeof Players === "undefined" || typeof Players.get !== "function") return edges;
  const pairCtx = resolveCivPairContext(metIds, localPid);
  edges = edges.concat(buildPairwiseCivEdges(pairCtx, includeAttitude));
  for (const k of POLITICAL_EVENT_FILTER_KEYS) {
    edges = edges.concat(buildPoliticalEdges(metIds, k));
  }
  return edges;
}
