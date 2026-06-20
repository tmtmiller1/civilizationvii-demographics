// relations-node-info.js
//
// Name-map and city-state node-info resolution for Global Relations.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import {
  dlog,
  safeCall,
  normalizeCivColor
} from "/demographics/ui/screen-demographics/views/relations/relations-shared.js";
import {
  resolveCsType,
  csTypeMeta
} from "/demographics/ui/screen-demographics/views/relations/relations-edges.js";
import { resolveMet } from "/demographics/ui/screen-demographics/views/relations/relations-queries.js";

const UNMET_GRAY = "#7d7d7d";

/**
 * Assign target[field] = value when value is a non-empty string.
 * @param {Record<string, *>} target Object to mutate.
 * @param {string} field Field name.
 * @param {*} value Candidate value.
 */
function assignIfNonEmpty(target, field, value) {
  if (typeof value === "string" && value.length > 0) {
    target[field] = value;
  }
}

/**
 * Fold one civ sample into the running name map.
 * @param {Record<string, Record<string, *>>} map Name map to mutate.
 * @param {string} pid Player id key.
 * @param {*} ps One civ sample.
 */
function foldNameSample(map, pid, ps) {
  if (!map[pid]) map[pid] = {};
  const target = map[pid];
  assignIfNonEmpty(target, "leaderName", ps?.leaderName);
  assignIfNonEmpty(target, "civName", ps?.civName);
  assignIfNonEmpty(target, "leaderTypeString", ps?.leaderTypeString);
  assignIfNonEmpty(target, "primaryColor", ps?.primaryColor);
}

/**
 * Build a pid -> node-info name map from persisted history.
 * @param {*} history The persisted history blob.
 * @returns {Record<string, Record<string, *>>} Name info keyed by player id.
 */
export function buildNameMap(history) {
  /** @type {Record<string, Record<string, *>>} */
  const map = {};
  const samples = history?.samples || [];
  for (const s of samples) {
    if (!s?.players) continue;
    for (const pid of Object.keys(s.players)) {
      foldNameSample(map, pid, s.players[pid]);
    }
  }
  return map;
}

/**
 * Resolve a CS primary color via UI.Player accessor.
 * @param {number} pid City-state player id.
 * @returns {string} The color string, or empty when unavailable.
 */
function resolveCsPrimaryColor(pid) {
  return safeCall(
    "resolveCsPrimaryColor(" + pid + ")",
    () => {
      if (typeof UI?.Player?.getPrimaryColorValueAsString === "function") {
        const s = UI.Player.getPrimaryColorValueAsString(pid);
        if (typeof s === "string" && s.length > 0) return s;
      }
      return "";
    },
    ""
  );
}

/**
 * Compose a locale key safely; return raw key on failure.
 * @param {string} key The locale key or raw string.
 * @returns {string} The composed string, or key unchanged.
 */
function localeComposeSafe(key) {
  if (typeof Locale?.compose === "function") {
    try {
      const s = Locale.compose(key);
      // Guard against a missing tag echoing the raw key back (it would render "LOC_..." on a node).
      if (typeof s === "string" && s.length > 0 && !s.startsWith("LOC_")) return s;
    } catch (_) {
      // Fall through to raw key.
    }
  }
  return key;
}

/**
 * Resolve CS name from GameInfo.Civilizations row.
 * @param {*} p The CS player handle.
 * @returns {string|null} The composed/raw name, or null.
 */
function csNameFromCivType(p) {
  try {
    const civType = p?.civilizationType;
    if (typeof GameInfo?.Civilizations?.lookup === "function") {
      const row = GameInfo.Civilizations.lookup(civType);
      if (row?.Name) return localeComposeSafe(row.Name);
    }
  } catch (_) {
    // Fall through to null.
  }
  return null;
}

/**
 * Resolve a city-state display name.
 * @param {number} pid City-state player id.
 * @returns {string} The resolved display name.
 */
function resolveCsName(pid) {
  return safeCall(
    "resolveCsName(" + pid + ")",
    () => {
      const p = typeof Players?.get === "function" ? Players.get(pid) : null;
      if (p && p.name) {
        const composed = localeComposeSafe(p.name);
        if (typeof composed === "string" && composed.length > 0) return composed;
      }
      return csNameFromCivType(p) || "City-State " + pid;
    },
    "City-State " + pid
  );
}

/**
 * The neutral all-gray visuals used for unmet city-states.
 * @returns {{
 *   csType: null,
 *   typeMeta: null,
 *   safePrimary: null,
 *   csColor: string,
 *   typeLabel: null,
 *   typeColor: string,
 *   typeIcon: null
 * }} The unmet visual fields.
 */
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
 * Resolve CS visual fields for met/unmet state.
 * @param {number} id City-state player id.
 * @param {boolean} csIsMet Whether the viewer has met this CS.
 * @returns {{
 *   csType: string|null,
 *   typeMeta: { label: string, color: string, icon: string }|null,
 *   safePrimary: string|null,
 *   csColor: string,
 *   typeLabel: string|null,
 *   typeColor: string,
 *   typeIcon: string|null
 * }} The resolved visual fields.
 */
function resolveCsVisuals(id, csIsMet) {
  if (!csIsMet) {
    dlog("CS pid=" + id, "met=false", "type=null", "typeColor=-", "primary=-");
    return unmetCsVisuals();
  }
  const csType = resolveCsType(id);
  const typeMeta = csTypeMeta(csType);
  const primary = resolveCsPrimaryColor(id);
  const safePrimary = normalizeCivColor(primary);
  const typeColor = typeMeta ? typeMeta.color : null;
  const metColor = typeColor || safePrimary || "#9aa8c8";
  dlog(
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
 * @param {number} id City-state player id.
 * @param {number} viewerPid The viewer player id.
 * @param {boolean} showUnmetNames When true, always show real names.
 * @param {number|undefined} localId Local player id.
 * @param {*} history The persisted history blob.
 * @returns {Record<string, *>} The CS node-info patch.
 */
export function buildCsNodeInfo(id, viewerPid, showUnmetNames, localId, history) {
  const metCs = resolveMet(viewerPid, id, localId, history);
  const label =
    metCs === false && !showUnmetNames
      ? t("LOC_DEMOGRAPHICS_RELATIONS_UNMET_CS")
      : resolveCsName(id);
  const csIsMet = metCs !== false;
  const v = resolveCsVisuals(id, csIsMet);
  return {
    isCityState: true,
    csName: label,
    leaderName: label,
    csMet: csIsMet,
    primaryColor: v.csColor,
    csTypeKey: v.csType,
    csTypeLabel: v.typeLabel,
    csTypeColor: v.typeColor,
    csTypeIcon: v.typeIcon
  };
}
