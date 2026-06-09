// relations-settings.js
//
// Persisted settings and in-memory caches for the Global Relations view.

import {
  FILTER_GROUPS,
  filtersForView
} from "/demographics/ui/screen-demographics/views/relations/relations-filters.js";

// Coherent localStorage can be unreliable in this UI context; keep an
// in-memory authoritative cache for filter sets and persist best-effort.
const _filterSetCache = new Map();

// In-memory node-focus selections keyed by top tab ("civ" / "cs").
const _nodeSelectionCache = new Map();

/**
 * Read the persisted top tab ("civ"/"cs"), defaulting to "civ".
 * @param {*} settings Settings accessor.
 * @returns {string} Validated top tab.
 */
export function readTopTab(settings) {
  let topTab = "civ";
  try {
    topTab = settings?.getSetting?.("relationsTopTab", "civ") || "civ";
    if (!["civ", "cs"].includes(topTab)) topTab = "civ";
  } catch (_) {
    // Storage boundary can throw; keep default.
  }
  return topTab;
}

/**
 * Read the persisted "show unmet names" toggle.
 * @param {*} settings Settings accessor.
 * @returns {boolean} Toggle value.
 */
export function readShowUnmetNames(settings) {
  try {
    return !!settings?.getSetting?.("showUnmetNames", false);
  } catch (_) {
    return false;
  }
}

/**
 * Read the persisted active filter sub-group ("politics"/"reputation"/
 * "agreements"), defaulting to "politics".
 * @param {*} settings Settings accessor.
 * @returns {string} Validated sub-group key.
 */
export function readActiveSubGroup(settings) {
  let g = "politics";
  try {
    g = settings?.getSetting?.("relationsSubGroup", "politics") || "politics";
    if (!FILTER_GROUPS.some((x) => x.key === g)) g = "politics";
  } catch (_) {
    // Storage boundary can throw; keep default.
  }
  return g;
}

/**
 * Persist the active filter sub-group (best-effort).
 * @param {*} settings Settings accessor.
 * @param {string} key The sub-group key.
 */
export function writeActiveSubGroup(settings, key) {
  try {
    settings?.setSetting?.("relationsSubGroup", key);
  } catch (_) {
    // Persistence is best-effort; the live render state already holds the value.
  }
}

/**
 * Resolve the CS-tab viewer pid, falling back to local when needed.
 * @param {*} settings Settings accessor.
 * @param {number|undefined} localId Local player id.
 * @param {number[]} metIds Met major ids.
 * @returns {number|undefined} Viewer pid.
 */
export function readCsViewerPid(settings, localId, metIds) {
  let csViewerPid = localId;
  try {
    const saved = settings?.getSetting?.("relationsCsViewerPid", localId);
    if (typeof saved === "number" && metIds.includes(saved)) csViewerPid = saved;
    else if (typeof localId === "number") csViewerPid = localId;
  } catch (_) {
    csViewerPid = localId;
  }
  return csViewerPid;
}

/**
 * Persisted-setting key for a top-tab filter set.
 * @param {string} topTab Either "civ" or "cs".
 * @returns {string} Settings key.
 */
function filterKeyForState(topTab) {
  // Versioned keys: when the filter vocabulary changes, a fresh key resets everyone
  // to all-on rather than leaving new pills stale-off. CS bumped to v3 when the CS
  // agreement pills (befriend / suzerain directives) were added.
  return topTab === "civ" ? "relationsCivFilters2" : "relationsCsFilters3";
}

/**
 * Default all-on filter key list for a top tab.
 * @param {string} topTab Either "civ" or "cs".
 * @returns {string[]} Default filter keys.
 */
function defaultFiltersFor(topTab) {
  return filtersForView(topTab).map((f) => f.key);
}

/**
 * Build the cached filter-set reader.
 * @param {*} settings Settings accessor.
 * @returns {(top: string) => Set<string>} Reader.
 */
export function makeFilterSetReader(settings) {
  return (top) => {
    if (_filterSetCache.has(top)) return _filterSetCache.get(top);
    const key = filterKeyForState(top);
    const dflt = defaultFiltersFor(top);
    let arr;
    try {
      arr = settings?.getSetting?.(key, dflt);
    } catch (_) {
      arr = dflt;
    }
    if (!Array.isArray(arr)) arr = dflt;
    const set = new Set(arr);
    _filterSetCache.set(top, set);
    return set;
  };
}

/**
 * Build the filter-set writer (cache + best-effort persistence).
 * @param {*} settings Settings accessor.
 * @returns {(top: string, set: Set<string>) => void} Writer.
 */
export function makeFilterSetWriter(settings) {
  return (top, set) => {
    _filterSetCache.set(top, set);
    const key = filterKeyForState(top);
    try {
      settings?.setSetting?.(key, Array.from(set));
    } catch (_) {
      // Cache remains authoritative for current session.
    }
  };
}

/**
 * Build the node-focus selection reader.
 * @returns {(top: string) => Set<number>} Reader.
 */
export function makeNodeSelectionReader() {
  return (top) => {
    const set = _nodeSelectionCache.get(top);
    return set instanceof Set ? set : new Set();
  };
}

/**
 * Build the node-focus selection writer.
 * @returns {(top: string, set: Set<number>) => void} Writer.
 */
export function makeNodeSelectionWriter() {
  return (top, set) => {
    _nodeSelectionCache.set(top, new Set(set));
  };
}
