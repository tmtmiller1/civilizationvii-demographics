// relations-ring-compute.js
//
// Ring-data computation for the Global Relations view.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import {
  buildCivTaggedEdges,
  buildCsAttitudeEdges,
  buildCsSuzerainEdges,
  buildCsTradeEdges
} from "/demographics/ui/screen-demographics/views/relations/relations-edges.js";
import {
  filtersForView,
  filterVisuals,
  pillColorFor
} from "/demographics/ui/screen-demographics/views/relations/relations-filters.js";
import {
  getCityStateIds,
  readGameTurn,
  resolveMet
} from "/demographics/ui/screen-demographics/views/relations/relations-queries.js";

/** @type {Set<string>} */
const ATTITUDE_FILTER_KEYS = new Set([
  "war",
  "alliance",
  "helpful",
  "friendly",
  "unfriendly",
  "hostile"
]);

/**
 * Whether any attitude-family filter is active.
 * @param {Set<string>} activeSet Active filter keys.
 * @returns {boolean} True when any attitude key is active.
 */
function hasActiveAttitudeFilter(activeSet) {
  for (const key of ATTITUDE_FILTER_KEYS) {
    if (activeSet.has(key)) return true;
  }
  return false;
}

/**
 * Mask unmet major-civ labels with "Unmet Civilization" placeholders.
 * Mutates `names` in place.
 * @param {number} viewerPid Viewer player id.
 * @param {number[]} metIds Met major ids.
 * @param {Record<string, *>} names Node display-info map.
 * @param {{ showUnmetNames: boolean, localId: number|undefined,
 *   history: DemoHistory|undefined }} ctx Masking toggle + local id + history.
 */
function applyMetMaskForMajors(viewerPid, metIds, names, ctx) {
  const { showUnmetNames, localId, history } = ctx;
  if (showUnmetNames) return;
  for (const pid of metIds) {
    if (pid === viewerPid) continue;
    const met = resolveMet(viewerPid, pid, localId, history);
    if (met === false) {
      names[pid] = Object.assign({}, names[pid] || {}, {
        leaderName: t("LOC_DEMOGRAPHICS_UNMET_CIV"),
        civName: undefined
      });
    }
  }
}

/**
 * Build set of met city-state ids from resolved node data.
 * @param {number[]} csIds City-state ids.
 * @param {Record<string, *>} names Node display-info map.
 * @returns {Set<number>} Met CS set.
 */
function buildCsMetSet(csIds, names) {
  const csMetSet = new Set();
  for (const id of csIds) {
    if (names[id]?.csMet !== false) csMetSet.add(id);
  }
  return csMetSet;
}

/**
 * Build the overlaid CS edge set anchored at one viewer civ.
 * @param {number} viewerPid Viewer player id.
 * @param {number[]} csIds City-state ids.
 * @param {boolean} includeAttitude Whether to include attitude-family edges.
 * @param {Set<number>} csMetSet Met CS id set.
 * @returns {*[]} Combined CS edges.
 */
export function buildCsEdges(viewerPid, csIds, includeAttitude, csMetSet) {
  const viewerMajors = [viewerPid];
  /** @type {*[]} */
  let edges = [];
  edges = edges.concat(buildCsSuzerainEdges(viewerMajors, csIds, viewerPid));
  edges = edges.concat(buildCsTradeEdges(viewerMajors, csIds, viewerPid));
  if (includeAttitude) {
    edges = edges.concat(buildCsAttitudeEdges(viewerMajors, csIds, viewerPid));
  }
  return edges.filter((edge) => {
    if (edge.a !== viewerPid && edge.b !== viewerPid) return false;
    if (csIds.includes(edge.a) && !csMetSet.has(edge.a)) return false;
    if (csIds.includes(edge.b) && !csMetSet.has(edge.b)) return false;
    return true;
  });
}

/**
 * Build per-tab filter descriptors with resolved color + dash visuals.
 * @param {string} topTab Either "civ" or "cs".
 * @returns {*[]} Visual-resolved filter descriptors.
 */
export function buildFilterDefs(topTab) {
  return filtersForView(topTab).map((filter) => {
    const override = filterVisuals(filter.key, topTab);
    return {
      ...filter,
      color: (override && override.color) || pillColorFor(filter.key, topTab),
      _dashOverride: override ? override.dash : undefined
    };
  });
}

/**
 * Apply top-tab visual overrides to CS edges. Mutates edge objects.
 * @param {*[]} edges Edges to mutate.
 */
export function applyCsEdgeOverrides(edges) {
  for (const edge of edges) {
    const override = filterVisuals(edge.filterKey || "", "cs");
    if (!override) continue;
    if (override.color) edge.color = override.color;
    if (override.dash !== undefined) edge._dashOverride = override.dash;
  }
}

/**
 * Filter edges by active filter keys.
 * @param {*[]} edges Full edge set.
 * @param {Set<string>} activeSet Active filter keys.
 * @returns {*[]} Filtered edge set.
 */
function filterEdgesByActiveSet(edges, activeSet) {
  return edges.filter((edge) => !!edge.filterKey && activeSet.has(edge.filterKey));
}

/**
 * Compute civ-tab ring data, including edge caching and active-filter pass.
 * @param {*} rs Render state object.
 * @param {Set<string>} activeSet Active filter keys.
 * @param {Record<string, *>} names Node display-info map.
 * @returns {{ ringIds: number[], edges: *[], names: Record<string, *>,
 *   capText: string, ringViewerPid: number|undefined }}
 *   Ring-data payload.
 */
export function computeCivRingData(rs, activeSet, names) {
  const localId = /** @type {number} */ (rs.localId);
  applyMetMaskForMajors(localId, rs.metIds, names, {
    showUnmetNames: rs.showUnmetNames,
    localId,
    history: rs.ctx.history
  });

  const turn = readGameTurn();
  const includeAttitude = hasActiveAttitudeFilter(activeSet);
  const cacheKey =
    String(localId) +
    "|" +
    String(turn) +
    "|" +
    String(localId) +
    "|" +
    String(rs.metIds.length) +
    "|att:" +
    String(includeAttitude ? 1 : 0);
  const slot = rs.edgeCacheByTop.civ;
  if (slot.key !== cacheKey) {
    slot.key = cacheKey;
    slot.edges = buildCivTaggedEdges(rs.metIds, localId, includeAttitude);
  }

  return {
    ringIds: rs.metIds.slice(),
    edges: filterEdgesByActiveSet(slot.edges, activeSet),
    names,
    capText: t("LOC_DEMOGRAPHICS_RELATIONS_CAPTION_CIV"),
    ringViewerPid: localId
  };
}

/**
 * Compute city-state-tab ring data, including edge caching and filter pass.
 * @param {*} rs Render state object.
 * @param {Set<string>} activeSet Active filter keys.
 * @param {Record<string, *>} names Node display-info map.
 * @returns {{ ringIds: number[], edges: *[], names: Record<string, *>,
 *   capText: string, ringViewerPid: number|undefined }}
 *   Ring-data payload.
 */
export function computeCsRingData(rs, activeSet, names) {
  const localId = /** @type {number} */ (rs.localId);
  const viewerPid = typeof rs.csViewerPid === "number" ? rs.csViewerPid : localId;
  applyMetMaskForMajors(viewerPid, rs.metIds, names, {
    showUnmetNames: rs.showUnmetNames,
    localId,
    history: rs.ctx.history
  });

  const csIds = getCityStateIds();
  const ringIds = [viewerPid].concat(csIds);
  for (const id of csIds) {
    names[id] = Object.assign(
      {},
      names[id] || {},
      rs.buildCsNodeInfo(id, viewerPid, rs.showUnmetNames, localId, rs.ctx.history)
    );
  }

  const csMetSet = buildCsMetSet(csIds, names);
  const turn = readGameTurn();
  const includeAttitude = hasActiveAttitudeFilter(activeSet);
  const cacheKey =
    String(localId) +
    "|" +
    String(turn) +
    "|" +
    String(viewerPid) +
    "|" +
    String(rs.metIds.length) +
    "|" +
    String(csIds.length) +
    "|att:" +
    String(includeAttitude ? 1 : 0);
  const slot = rs.edgeCacheByTop.cs;
  if (slot.key !== cacheKey) {
    slot.key = cacheKey;
    slot.edges = buildCsEdges(viewerPid, csIds, includeAttitude, csMetSet);
  }

  return {
    ringIds,
    edges: filterEdgesByActiveSet(slot.edges, activeSet),
    names,
    capText: t("LOC_DEMOGRAPHICS_RELATIONS_CAPTION_CS"),
    ringViewerPid: viewerPid
  };
}
