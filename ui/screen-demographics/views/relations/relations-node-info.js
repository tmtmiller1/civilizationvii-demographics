// relations-node-info.js
//
// Name-map and city-state node-info resolution for Global Relations.

import { t, tCsFallback } from "/demographics/ui/core/demographics-i18n.js";
import {
  log,
  safeCall,
  normalizeCivColor
} from "/demographics/ui/screen-demographics/views/relations/relations-shared.js";
import {
  resolveCsType,
  csTypeMeta
} from "/demographics/ui/screen-demographics/views/relations/relations-edges-city-states.js";
import { resolveMet } from "/demographics/ui/screen-demographics/views/relations/relations-queries.js";

const UNMET_GRAY = "#7d7d7d";

/**
 * @param {Record<string, *>} target
 * @param {string} field
 * @param {*} value
 */
function assignIfNonEmpty(target, field, value) {
  if (typeof value === "string" && value.length > 0) {
    target[field] = value;
  }
}

/**
 * @param {Record<string, Record<string, *>>} map
 * @param {string} pid
 * @param {*} samplePlayer
 */
function foldNameSample(map, pid, samplePlayer) {
  if (!map[pid]) map[pid] = {};
  const target = map[pid];
  assignIfNonEmpty(target, "leaderName", samplePlayer?.leaderName);
  assignIfNonEmpty(target, "civName", samplePlayer?.civName);
  assignIfNonEmpty(target, "leaderTypeString", samplePlayer?.leaderTypeString);
  assignIfNonEmpty(target, "primaryColor", samplePlayer?.primaryColor);
}

/**
 * Build a pid -> node-info name map from persisted history.
 * @param {*} history
 * @returns {Record<string, Record<string, *>>} Name info keyed by player id.
 */
export function buildNameMap(history) {
  /** @type {Record<string, Record<string, *>>} */
  const map = {};
  // A non-array `samples` (a corrupt blob or another mod's saved data) must not
  // reach the for..of below, which would throw on a non-iterable.
  const samples = Array.isArray(history?.samples) ? history.samples : [];
  for (const sample of samples) {
    if (!sample?.players) continue;
    for (const pid of Object.keys(sample.players)) {
      foldNameSample(map, pid, sample.players[pid]);
    }
  }
  return map;
}

/** @param {number} pid */
function resolveCsPrimaryColor(pid) {
  return safeCall(
    "resolveCsPrimaryColor(" + pid + ")",
    () => {
      if (typeof UI?.Player?.getPrimaryColorValueAsString === "function") {
        const color = UI.Player.getPrimaryColorValueAsString(pid);
        if (typeof color === "string" && color.length > 0) return color;
      }
      return "";
    },
    ""
  );
}

/**
 * @param {string} key
 * @returns {string}
 */
function localeComposeSafe(key) {
  if (typeof Locale?.compose === "function") {
    try {
      const composed = Locale.compose(key);
      // Guard against a missing tag echoing the raw key back (it would render "LOC_..." on a node).
      if (typeof composed === "string" && composed.length > 0 && !composed.startsWith("LOC_")) return composed;
    } catch (_) {
      // Fall through to raw key.
    }
  }
  return key;
}

/**
 * @param {*} cityState
 * @returns {string|null}
 */
function csNameFromCivType(cityState) {
  try {
    const civType = cityState?.civilizationType;
    if (typeof GameInfo?.Civilizations?.lookup === "function") {
      const row = GameInfo.Civilizations.lookup(civType);
      if (row?.Name) return localeComposeSafe(row.Name);
    }
  } catch (_) {
    // Fall through to null.
  }
  return null;
}

/** @param {number} pid */
function resolveCsName(pid) {
  return safeCall(
    "resolveCsName(" + pid + ")",
    () => {
      const cityState = typeof Players?.get === "function" ? Players.get(pid) : null;
      if (cityState && cityState.name) {
        const composed = localeComposeSafe(cityState.name);
        if (typeof composed === "string" && composed.length > 0) return composed;
      }
      return csNameFromCivType(cityState) || tCsFallback(pid);
    },
    tCsFallback(pid)
  );
}

function unmetCsVisuals() {
  return {
    csType: null,
    typeMeta: null,
    safePrimary: null,
    csColor: UNMET_GRAY,
    typeLabel: null,
    typeColor: UNMET_GRAY,
    typeIcon: null
  };
}

/**
 * @param {number} id
 * @param {boolean} csIsMet
 * @returns {{
 *   csType: string|null,
 *   typeMeta: { label: string, color: string, icon: string }|null,
 *   safePrimary: string|null,
 *   csColor: string,
 *   typeLabel: string|null,
 *   typeColor: string,
 *   typeIcon: string|null
 * }}
 */
function resolveCsVisuals(id, csIsMet) {
  if (!csIsMet) {
    log.debug("CS pid=" + id, "met=false", "type=null", "typeColor=-", "primary=-");
    return unmetCsVisuals();
  }
  const csType = resolveCsType(id);
  const typeMeta = csTypeMeta(csType);
  const primary = resolveCsPrimaryColor(id);
  const safePrimary = normalizeCivColor(primary);
  const typeColor = typeMeta ? typeMeta.color : null;
  const metColor = typeColor || safePrimary || "#9aa8c8";
  log.debug(
    "CS pid=" + id,
    "met=true",
    "type=" + csType,
    "typeColor=" + (typeColor || "-"),
    "primary=" + (primary || "-")
  );
  return {
    csType,
    typeMeta,
    safePrimary,
    csColor: metColor,
    typeLabel: typeMeta ? typeMeta.label : null,
    typeColor: metColor,
    typeIcon: typeMeta ? typeMeta.icon : null
  };
}

/**
 * Resolve a single city-state node-info payload.
 * @param {number} id
 * @param {number} viewerPid
 * @param {boolean} showUnmetNames When true, always show real names.
 * @param {number|undefined} localId
 * @param {*} history
 * @returns {Record<string, *>}
 */
export function buildCsNodeInfo(id, viewerPid, showUnmetNames, localId, history) {
  const metCs = resolveMet(viewerPid, id, localId, history);
  const label =
    metCs === false && !showUnmetNames
      ? t("LOC_DEMOGRAPHICS_RELATIONS_UNMET_CS")
      : resolveCsName(id);
  const csIsMet = metCs !== false;
  const visuals = resolveCsVisuals(id, csIsMet);
  return {
    isCityState: true,
    csName: label,
    leaderName: label,
    csMet: csIsMet,
    primaryColor: visuals.csColor,
    csTypeKey: visuals.csType,
    csTypeLabel: visuals.typeLabel,
    csTypeColor: visuals.typeColor,
    csTypeIcon: visuals.typeIcon
  };
}
