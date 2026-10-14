// relations-edges.js
//
// Per-subtab edge builders for the Global Relations ring: political actions
// (alliance / war / denounced / research / endeavors / open borders), economic
// trade routes and pairwise attitudes. Also owns the diplomatic-query and
// attitude/color helpers, which the City-State builders in
// relations-edges-city-states.js reuse.

import {
  AGREEMENT_TYPES,
  safeCall
} from "/demographics/ui/screen-demographics/views/relations/relations-shared.js";
import { getAttitudeColors } from "/demographics/ui/core/demographics-palette.js";

/**
 * One relationship edge between two ring nodes. `a`/`b` are player ids; the
 * remaining fields are visual hints consumed by the ring renderer.
 * @typedef {Object} Edge
 * @property {number} a Source player id.
 * @property {number} b Target player id.
 * @property {string} [color] Stroke color (hex or rgba).
 * @property {string} [label] Optional human-readable edge label.
 * @property {string} [filterKey] Filter category this edge belongs to.
 * @property {boolean} [dashed] Dashed-line flag, set directly by suzerain edges.
 * @property {boolean} [directed] When set, render a→b direction chevrons.
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
 * @property {string} key Per-action filter key (the edge's `filterKey`).
 */

// diplomatic queries

/**
 * @param {*} player
 * @param {number} otherPid
 * @returns {boolean}
 */
function hasAlliance(player, otherPid) {
  return safeCall(
    "hasAllied",
    () => {
      const diplomacy = player?.Diplomacy;
      if (!diplomacy) return false;
      if (typeof diplomacy.hasAllied === "function") return !!diplomacy.hasAllied(otherPid);
      return false;
    },
    false
  );
}

/**
 * Whether `player` is at war with player `otherPid`, defensively.
 * @param {*} player
 * @param {number} otherPid
 * @returns {boolean} True when at war.
 */
export function isAtWar(player, otherPid) {
  return safeCall(
    "isAtWarWith",
    () => {
      const diplomacy = player?.Diplomacy;
      if (!diplomacy) return false;
      if (typeof diplomacy.isAtWarWith === "function") return !!diplomacy.isAtWarWith(otherPid);
      return false;
    },
    false
  );
}

/**
 * Resolve the engine relationship enum from `player` toward `otherPid`, defensively.
 * @param {*} player
 * @param {number} otherPid
 * @returns {*} The relationship enum value, or `undefined`.
 */
export function getRelationship(player, otherPid) {
  return safeCall("getRelationshipEnum", () => {
    const diplomacy = player?.Diplomacy;
    if (!diplomacy || typeof diplomacy.getRelationshipEnum !== "function") return undefined;
    return diplomacy.getRelationshipEnum(otherPid);
  });
}

/**
 * Build a relationship-enum to attitude-key lookup map from engine constants.
 * @returns {Map<*, string>}
 */
export function relationshipKeyMap() {
  /** @type {Map<*, string>} */
  const map = new Map();
  if (typeof DiplomacyPlayerRelationships === "undefined" || !DiplomacyPlayerRelationships) {
    return map;
  }
  const relEnum = DiplomacyPlayerRelationships;
  map.set(relEnum.PLAYER_RELATIONSHIP_ALLIANCE, "alliance");
  map.set(relEnum.PLAYER_RELATIONSHIP_FRIENDLY, "friendly");
  map.set(relEnum.PLAYER_RELATIONSHIP_HELPFUL, "helpful");
  map.set(relEnum.PLAYER_RELATIONSHIP_NEUTRAL, "neutral");
  map.set(relEnum.PLAYER_RELATIONSHIP_UNFRIENDLY, "unfriendly");
  map.set(relEnum.PLAYER_RELATIONSHIP_HOSTILE, "hostile");
  map.set(relEnum.PLAYER_RELATIONSHIP_AT_WAR, "war");
  return map;
}

// color tables

// Attitude colors are fetched live from `getAttitudeColors()` so the
// colorblind-mode toggle in Options swaps them without a mod reload. The keys
// match DiplomacyPlayerRelationships, resolved at runtime by attitudeKeyFromEnum.

/**
 * Map an engine relationship enum to one of the seven attitude keys.
 * @param {*} rel
 * @returns {string} The attitude key (defaults to "neutral").
 */
export function attitudeKeyFromEnum(rel) {
  const key = relationshipKeyMap().get(rel);
  return key || "neutral";
}

/**
 * Resolve the live palette color for an attitude key.
 * @param {string} key
 * @returns {string} The palette color (gray fallback).
 */
export function categoryColor(key) {
  const colors = getAttitudeColors();
  return colors[key] || "#bfbfbf";
}

// per-subtab edge builders
// Each builder returns an array of edge objects:
//   { a, b, color, label?, dashed?, width?, opacity? }
// where a, b are pids and a <= b unless otherwise noted.

/**
 * Read a player's diplomatic events list defensively.
 * @param {number} pid
 * @returns {*[]} The events array (empty on any error).
 */
export function getPlayerEvents(pid) {
  return safeCall(
    "getPlayerEvents(" + pid + ")",
    () => {
      if (
        typeof Game === "undefined" ||
        !Game.Diplomacy ||
        typeof Game.Diplomacy.getPlayerEvents !== "function"
      )
        return [];
      // The engine can hand back a non-array (a plain object / null); the
      // for..of consumers need a real array or they throw on a non-iterable.
      const events = Game.Diplomacy.getPlayerEvents(pid);
      return Array.isArray(events) ? events : [];
    },
    []
  );
}

/**
 * Resolve the "other" player id involved in a diplomacy event, relative to
 * the queried player `sourcePid`: the target player, else the other player, else the initiator.
 * @param {*} ev
 * @param {number} sourcePid The player whose events list `ev` came from.
 * @returns {number|undefined} The other player id, or `undefined`.
 */
export function resolveEventOther(ev, sourcePid) {
  let other = ev.targetPlayer;
  if (typeof other !== "number") other = ev.otherPlayer;
  if (typeof other !== "number") {
    other = ev.initialPlayer !== sourcePid ? ev.initialPlayer : undefined;
  }
  return other;
}

/** @param {number[]} metIds */
function buildAllianceEdges(metIds) {
  /** @type {Edge[]} */
  const edges = [];
  for (let i = 0; i < metIds.length; i++) {
    const pidA = metIds[i];
    const playerA = safeCall("Players.get(" + pidA + ")", () => Players.get(pidA), null);
    if (!playerA) continue;
    for (let j = i + 1; j < metIds.length; j++) {
      const pidB = metIds[j];
      if (hasAlliance(playerA, pidB)) {
        // The palette's alliance swatch, the same color the filter pill shows for this line.
        edges.push({ a: pidA, b: pidB, color: categoryColor("alliance"), filterKey: "alliance" });
      }
    }
  }
  return edges;
}

/** @param {number[]} metIds */
function buildWarEdges(metIds) {
  /** @type {Edge[]} */
  const edges = [];
  for (let i = 0; i < metIds.length; i++) {
    const pidA = metIds[i];
    const playerA = safeCall("Players.get(" + pidA + ")", () => Players.get(pidA), null);
    if (!playerA) continue;
    for (let j = i + 1; j < metIds.length; j++) {
      const pidB = metIds[j];
      if (isAtWar(playerA, pidB)) {
        edges.push({ a: pidA, b: pidB, color: "#e02020", filterKey: "war" });
      }
    }
  }
  return edges;
}

/**
 * @param {*} ev
 * @param {number} sourcePid
 * @param {number|undefined} actionType
 * @param {Set<number>} metSet
 */
function actionPairFromEvent(ev, sourcePid, actionType, metSet) {
  if (!ev || ev.actionType !== actionType) return null;
  const other = resolveEventOther(ev, sourcePid);
  if (typeof other !== "number" || other === sourcePid) return null;
  if (!metSet.has(other)) return null;
  return { a: sourcePid, b: other };
}

/**
 * @param {Edge} edge
 * @param {*} ev
 * @param {Set<number>} metSet
 */
function orientByInitiator(edge, ev, metSet) {
  const initiator = ev && typeof ev.initialPlayer === "number" ? ev.initialPlayer : undefined;
  if (initiator === undefined || !metSet.has(initiator)) return;
  if (edge.b === initiator) {
    const tmp = edge.a;
    edge.a = edge.b;
    edge.b = tmp;
  }
}

/**
 * When `directed`, each edge is oriented initiator → target and flagged so the renderer draws chevrons.
 * @param {number[]} metIds
 * @param {number|undefined} actionType The `DIPLOMACY_ACTION_*` int to match.
 * @param {string} color
 * @param {string} filterKey
 * @param {boolean} [directed]
 */
function buildActionTypeEdges(metIds, actionType, color, filterKey, directed) {
  /** @type {Edge[]} */
  const edges = [];
  if (actionType === undefined) return edges;
  const metSet = new Set(metIds);
  const seen = new Set();
  for (const sourcePid of metIds) {
    const events = getPlayerEvents(sourcePid);
    for (const ev of events) {
      const pair = actionPairFromEvent(ev, sourcePid, actionType, metSet);
      if (!pair) continue;
      const key = Math.min(pair.a, pair.b) + "|" + Math.max(pair.a, pair.b);
      if (seen.has(key)) continue;
      seen.add(key);
      /** @type {Edge} */
      const edge = { a: pair.a, b: pair.b, color, filterKey };
      if (directed) {
        orientByInitiator(edge, ev, metSet);
        edge.directed = true;
      }
      edges.push(edge);
    }
  }
  return edges;
}

/** @param {{ key: string, action: string, color: string }[]} actionList */
function resolveEndeavorLookups(actionList) {
  /** @type {ActionLookup[]} */
  const lookups = [];
  const Types = typeof DiplomacyActionTypes !== "undefined" ? DiplomacyActionTypes : null;
  if (!Types) return lookups;
  for (const entry of actionList) {
    const actionInt = Types[entry.action];
    if (typeof actionInt === "number") {
      lookups.push({ t: actionInt, color: entry.color, name: entry.action, key: entry.key });
    }
  }
  return lookups;
}

/** @param {string} name */
function endeavorLabel(name) {
  return name
    .replace(/^DIPLOMACY_ACTION_/, "")
    .toLowerCase()
    .replace(/_/g, " ");
}

/**
 * Build every individual cooperative-agreement edge among the met-major ring,
 * deduped via a sorted pair + action-type key (each action appears in both
 * participants' `getPlayerEvents()`). Each edge carries its own per-action
 * `filterKey` from {@link AGREEMENT_TYPES}.
 * @param {number[]} metIds
 * @returns {Edge[]}
 */
function buildAgreementEdges(metIds) {
  /** @type {Edge[]} */
  const edges = [];
  // Pre-resolve action-type ints + their colors/keys so the inner loop is
  // O(events × types) without repeating string→enum lookups.
  const lookups = resolveEndeavorLookups(AGREEMENT_TYPES);
  if (lookups.length === 0) return edges;
  /** @type {{ metIds: number[], lookups: ActionLookup[] }} */
  const ctx = { metIds, lookups };
  const seen = new Set();
  for (const sourcePid of metIds) {
    for (const ev of getPlayerEvents(sourcePid)) {
      pushOneEndeavorEdge(edges, seen, ev, sourcePid, ctx);
    }
  }
  return edges;
}

/**
 * @param {Edge[]} edges
 * @param {Set<string>} seen
 * @param {*} ev
 * @param {number} sourcePid
 * @param {{ metIds: number[], lookups: ActionLookup[] }} ctx
 */
function pushOneEndeavorEdge(edges, seen, ev, sourcePid, ctx) {
  const { metIds, lookups } = ctx;
  if (!ev || typeof ev.actionType !== "number") return;
  const hit = lookups.find((lookup) => lookup.t === ev.actionType);
  if (!hit) return;
  const other = resolveEventOther(ev, sourcePid);
  if (typeof other !== "number" || other === sourcePid) return;
  if (!metIds.includes(other)) return;
  // Dedupe pair + action-type so different agreements between the same pair
  // show as separate edges.
  const key = Math.min(sourcePid, other) + "|" + Math.max(sourcePid, other) + "|" + hit.t;
  if (seen.has(key)) return;
  seen.add(key);
  edges.push({
    a: sourcePid,
    b: other,
    color: hit.color,
    filterKey: hit.key,
    label: endeavorLabel(hit.name)
  });
}

/** @param {string} name */
function actionTypeByName(name) {
  return typeof DiplomacyActionTypes !== "undefined" ? DiplomacyActionTypes[name] : undefined;
}

/**
 * Build the political-action edges for a single filter key (alliance, war,
 * denounced, research, endeavors, openborders) among the met-major ring.
 * @param {number[]} metIds
 * @param {string} filterKey
 * @returns {Edge[]} The edges for that filter (empty when unhandled).
 */
export function buildPoliticalEdges(metIds, filterKey) {
  if (typeof Players === "undefined" || typeof Players.get !== "function") return [];

  if (filterKey === "alliance") return buildAllianceEdges(metIds);
  if (filterKey === "war") return buildWarEdges(metIds);
  if (filterKey === "denounced") {
    // Denunciations are directed diplomatic actions, but the ring treats edges
    // as undirected pairs, so reciprocal denounces collapse via a sorted key.
    return buildActionTypeEdges(
      metIds,
      actionTypeByName("DIPLOMACY_ACTION_DENOUNCE"),
      "#ff7f1a",
      "denounced",
      true // directed: denouncer → denounced
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
 * @param {number} fromPid
 * @returns {*} The trade handle, or `null`.
 */
export function resolveTradeHandle(fromPid) {
  const fromPlayer = safeCall("Players.get(" + fromPid + ")", () => Players.get(fromPid), null);
  const trade = fromPlayer?.Trade;
  if (!trade || typeof trade.countPlayerTradeRoutesTo !== "function") return null;
  return trade;
}

/**
 * Count trade routes from a trade handle to `toPid`, defensively.
 * @param {*} trade The source player's trade handle.
 * @param {number} toPid
 * @returns {number} The route count (`0` on any error).
 */
export function tradeRouteCount(trade, toPid) {
  try {
    return trade.countPlayerTradeRoutesTo(toPid) | 0;
  } catch (_) {
    // trade.countPlayerTradeRoutesTo(toPid) can throw at the engine boundary;
    // treat as no routes.
    return 0;
  }
}

/**
 * @param {Edge[]} edges
 * @param {*} trade
 * @param {number} fromPid
 * @param {number[]} pids
 */
function pushTradeEdgesForSource(edges, trade, fromPid, pids) {
  for (const toPid of pids) {
    if (toPid === fromPid) continue;
    const routeCount = tradeRouteCount(trade, toPid);
    if (routeCount <= 0) continue;
    const weight = Math.min(1, routeCount / 3);
    edges.push({
      a: fromPid,
      b: toPid,
      color: "#4dc6c6",
      opacity: 0.5 + weight * 0.5,
      filterKey: "trade",
      directed: true
    });
  }
}

/**
 * Build trade-route edges among the met-major ring (plus the local player),
 * one per directed pair with a route count > 0.
 * @param {number[]} metIds
 * @param {string} _filterKey Unused (kept for builder-signature parity).
 * @param {number} [localPid] Local player id to fold into the source set.
 * @returns {Edge[]}
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
    pushTradeEdgesForSource(edges, trade, fromPid, pids);
  }
  return edges;
}

// Pairwise attitude edges among met majors: for each pair (i, j) i<j, the
// relationship from i's perspective (the enum is symmetric in practice).
// War / Alliance are surfaced explicitly so they color over the bare enum.

/**
 * Declared stances checked before the attitude enum, in priority order: a pair at war reads as
 * war even if an alliance flag lingers, and only a pair with neither falls through to the enum.
 * @type {[string, (player: *, otherPid: number) => boolean][]}
 */
const DECLARED_STANCES = [
  ["war", isAtWar],
  ["alliance", hasAlliance]
];

/**
 * @param {*} player
 * @param {number} otherPid
 */
function pairAttitudeKey(player, otherPid) {
  const declared = DECLARED_STANCES.find(([, holds]) => holds(player, otherPid));
  return declared ? declared[0] : attitudeKeyFromEnum(getRelationship(player, otherPid));
}

/**
 * Build pairwise attitude edges among met majors.
 * @param {number[]} metIds
 * @param {number} [_localPid] Unused (kept for builder-signature parity).
 * @returns {Edge[]}
 */
export function buildAttitudeEdges(metIds, _localPid) {
  /** @type {Edge[]} */
  const edges = [];
  if (typeof Players === "undefined" || typeof Players.get !== "function") return edges;
  for (let i = 0; i < metIds.length; i++) {
    const pidA = metIds[i];
    const playerA = safeCall("Players.get(" + pidA + ")", () => Players.get(pidA), null);
    if (!playerA) continue;
    for (let j = i + 1; j < metIds.length; j++) {
      const pidB = metIds[j];
      const catKey = pairAttitudeKey(playerA, pidB);
      edges.push({ a: pidA, b: pidB, color: categoryColor(catKey), filterKey: catKey });
    }
  }
  return edges;
}

/** Political filter keys sourced from diplomacy-event scans (cooperative
 *  agreements are built separately via {@link buildAgreementEdges}). */
const POLITICAL_EVENT_FILTER_KEYS = ["openborders", "denounced"];

/**
 * Context for fused pairwise civ-edge construction.
 * @typedef {Object} CivPairContext
 * @property {number[]} pids Major ids in scope (met + local).
 * @property {Map<number, *>} playersById Cached Players.get handles.
 * @property {Map<number, *>} tradesById Cached Trade handles.
 */

/**
 * @param {number[]} metIds
 * @param {number|undefined} localPid
 * @returns {CivPairContext}
 */
function resolveCivPairContext(metIds, localPid) {
  const pids = metIds.slice();
  if (typeof localPid === "number" && !pids.includes(localPid)) pids.push(localPid);
  /** @type {Map<number, *>} */
  const playersById = new Map();
  /** @type {Map<number, *>} */
  const tradesById = new Map();
  for (const pid of pids) {
    const player = safeCall("Players.get(" + pid + ")", () => Players.get(pid), null);
    playersById.set(pid, player);
    tradesById.set(pid, resolveTradeHandle(pid));
  }
  return { pids, playersById, tradesById };
}

/**
 * @param {Edge[]} edges
 * @param {number} pidA
 * @param {number} pidB
 * @param {*} tradeA
 * @param {*} tradeB
 */
function appendPairTradeEdges(edges, pidA, pidB, tradeA, tradeB) {
  if (tradeA) {
    const routesAB = tradeRouteCount(tradeA, pidB);
    if (routesAB > 0) {
      const weightAB = Math.min(1, routesAB / 3);
      edges.push({
        a: pidA,
        b: pidB,
        color: "#4dc6c6",
        opacity: 0.5 + weightAB * 0.5,
        filterKey: "trade",
        directed: true
      });
    }
  }
  if (tradeB) {
    const routesBA = tradeRouteCount(tradeB, pidA);
    if (routesBA > 0) {
      const weightBA = Math.min(1, routesBA / 3);
      edges.push({
        a: pidB,
        b: pidA,
        color: "#4dc6c6",
        opacity: 0.5 + weightBA * 0.5,
        filterKey: "trade",
        directed: true
      });
    }
  }
}

/**
 * @param {CivPairContext} ctx
 * @param {boolean} includeAttitude
 */
function buildPairwiseCivEdges(ctx, includeAttitude) {
  /** @type {Edge[]} */
  const edges = [];
  const { pids, playersById, tradesById } = ctx;
  for (let i = 0; i < pids.length; i++) {
    const pidA = pids[i];
    const playerA = playersById.get(pidA);
    for (let j = i + 1; j < pids.length; j++) {
      const pidB = pids[j];
      const tradeA = tradesById.get(pidA) || null;
      const tradeB = tradesById.get(pidB) || null;
      try {
        if (includeAttitude && playerA) {
          const catKey = pairAttitudeKey(playerA, pidB);
          edges.push({ a: pidA, b: pidB, color: categoryColor(catKey), filterKey: catKey });
        }
        appendPairTradeEdges(edges, pidA, pidB, tradeA, tradeB);
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
 * @param {number[]} metIds
 * @param {number|undefined} localPid
 * @param {boolean} includeAttitude
 * @returns {Edge[]}
 */
export function buildCivTaggedEdges(metIds, localPid, includeAttitude) {
  /** @type {Edge[]} */
  let edges = [];
  if (typeof Players === "undefined" || typeof Players.get !== "function") return edges;
  const pairCtx = resolveCivPairContext(metIds, localPid);
  edges = edges.concat(buildPairwiseCivEdges(pairCtx, includeAttitude));
  for (const filterKey of POLITICAL_EVENT_FILTER_KEYS) {
    edges = edges.concat(buildPoliticalEdges(metIds, filterKey));
  }
  // Each cooperative agreement type is its own per-action-tagged line.
  edges = edges.concat(buildAgreementEdges(metIds));
  return edges;
}
