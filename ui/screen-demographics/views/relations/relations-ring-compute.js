// relations-ring-compute.js
//
// Ring-data computation for the Global Relations view.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { buildCivTaggedEdges } from "/demographics/ui/screen-demographics/views/relations/relations-edges.js";
import {
  buildCsAgreementEdges,
  buildCsAttitudeEdges,
  buildCsSuzerainEdges,
  buildCsTradeEdges
} from "/demographics/ui/screen-demographics/views/relations/relations-edges-city-states.js";
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

/** @param {Set<string>} activeSet */
function hasActiveAttitudeFilter(activeSet) {
  for (const key of ATTITUDE_FILTER_KEYS) {
    if (activeSet.has(key)) return true;
  }
  return false;
}

/**
 * @param {number} viewerPid
 * @param {number[]} metIds
 * @param {Record<string, *>} names
 * @param {{ showUnmetNames: boolean, localId: number|undefined,
 *   history: DemoHistory|undefined }} ctx
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
 * @param {number[]} csIds
 * @param {Record<string, *>} names
 * @returns {Set<number>}
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
 * @param {number} viewerPid
 * @param {number[]} csIds
 * @param {boolean} includeAttitude
 * @param {Set<number>} csMetSet
 * @returns {*[]}
 */
export function buildCsEdges(viewerPid, csIds, includeAttitude, csMetSet) {
  const viewerMajors = [viewerPid];
  /** @type {*[]} */
  let edges = [];
  edges = edges.concat(buildCsSuzerainEdges(viewerMajors, csIds, viewerPid));
  edges = edges.concat(buildCsTradeEdges(viewerMajors, csIds, viewerPid));
  edges = edges.concat(buildCsAgreementEdges(viewerMajors, csIds, viewerPid));
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
 * @param {string} topTab
 * @returns {*[]}
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
 * @param {*[]} edges
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
 * Force every civ edge's color to its filter's legend (pill) color, so the
 * filter-pill swatch is a faithful key for the lines on the ring (the
 * diplomacy-event builders tag edges with per-action colors). Dash already
 * derives from LINE_DASH by filterKey. Mutates edge objects.
 * @param {*[]} edges
 */
export function applyCivEdgeOverrides(edges) {
  for (const edge of edges) {
    if (!edge || typeof edge.filterKey !== "string") continue;
    edge.color = pillColorFor(edge.filterKey, "civ");
  }
}

/**
 * @param {*[]} edges
 * @param {Set<string>} activeSet
 */
function filterEdgesByActiveSet(edges, activeSet) {
  return edges.filter((edge) => !!edge.filterKey && activeSet.has(edge.filterKey));
}

/**
 * Compute civ-tab ring data, including edge caching and active-filter pass.
 * @param {*} renderState
 * @param {Set<string>} activeSet
 * @param {Record<string, *>} names
 * @returns {{ ringIds: number[], edges: *[], names: Record<string, *>,
 *   capText: string, ringViewerPid: number|undefined }}
 */
export function computeCivRingData(renderState, activeSet, names) {
  const localId = /** @type {number} */ (renderState.localId);
  applyMetMaskForMajors(localId, renderState.metIds, names, {
    showUnmetNames: renderState.showUnmetNames,
    localId,
    history: renderState.ctx.history
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
    String(renderState.metIds.length) +
    "|att:" +
    String(includeAttitude ? 1 : 0);
  const slot = renderState.edgeCacheByTop.civ;
  if (slot.key !== cacheKey) {
    slot.key = cacheKey;
    slot.edges = buildCivTaggedEdges(renderState.metIds, localId, includeAttitude);
  }

  return {
    ringIds: renderState.metIds.slice(),
    edges: filterEdgesByActiveSet(slot.edges, activeSet),
    names,
    // No descriptive caption: the diagram + legend are self-explanatory. (The
    // focus hint still appends here when nodes are selected.)
    capText: "",
    ringViewerPid: localId
  };
}

/**
 * Compute city-state-tab ring data, including edge caching and filter pass.
 * @param {*} renderState
 * @param {Set<string>} activeSet
 * @param {Record<string, *>} names
 * @returns {{ ringIds: number[], edges: *[], names: Record<string, *>,
 *   capText: string, ringViewerPid: number|undefined }}
 */
export function computeCsRingData(renderState, activeSet, names) {
  const localId = /** @type {number} */ (renderState.localId);
  const viewerPid = typeof renderState.csViewerPid === "number" ? renderState.csViewerPid : localId;
  applyMetMaskForMajors(viewerPid, renderState.metIds, names, {
    showUnmetNames: renderState.showUnmetNames,
    localId,
    history: renderState.ctx.history
  });

  const csIds = getCityStateIds();
  const ringIds = [viewerPid].concat(csIds);
  for (const id of csIds) {
    names[id] = Object.assign(
      {},
      names[id] || {},
      renderState.buildCsNodeInfo(id, viewerPid, renderState.showUnmetNames, localId, renderState.ctx.history)
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
    String(renderState.metIds.length) +
    "|" +
    String(csIds.length) +
    "|att:" +
    String(includeAttitude ? 1 : 0);
  const slot = renderState.edgeCacheByTop.cs;
  if (slot.key !== cacheKey) {
    slot.key = cacheKey;
    slot.edges = buildCsEdges(viewerPid, csIds, includeAttitude, csMetSet);
  }

  return {
    ringIds,
    edges: filterEdgesByActiveSet(slot.edges, activeSet),
    names,
    // No descriptive caption (see civ tab); focus hint still appends downstream.
    capText: "",
    ringViewerPid: viewerPid
  };
}
