// history-tables-csv.js
//
// Table-shaped CSV builders for History sub-pages whose data ISN'T captured by
// the per-turn sample dump (history-csv.js). Currently: the Conflicts page's war
// list (history.wars), which the sample matrix doesn't include. One row per
// merged war with its span, status, and both rosters.

import { mergeWars, policyVisibleWars } from "/demographics/ui/screen-demographics/charts/wars/chart-wars-merge.js";
import { nameMergedWars } from "/demographics/ui/screen-demographics/charts/wars/chart-wars-naming.js";
import { t, tPlayerFallback } from "/demographics/ui/core/demographics-i18n.js";

/**
 * Build a pid → display-name map from the latest sample's players.
 * @param {*[]} samples
 * @returns {Map<number, string>} pid → leader/civ name.
 */
function pidNameMap(samples) {
  /** @type {Map<number, string>} */
  const map = new Map();
  const last = samples.length ? samples[samples.length - 1] : null;
  const players = last?.players || {};
  for (const pid of Object.keys(players)) {
    const player = players[pid] || {};
    map.set(Number(pid), player.leaderName || player.civName || tPlayerFallback(pid));
  }
  return map;
}

/**
 * Join a war side's roster into a "; "-separated name list.
 * @param {*[]} side The side roster (entries with a `pid`).
 * @param {Map<number, string>} names
 * @returns {string}
 */
function sideNames(side, names) {
  return (Array.isArray(side) ? side : [])
    .map((entry) => names.get(Number(entry?.pid)) || tPlayerFallback(entry?.pid))
    .join("; ");
}

/**
 * Build {headers, rows} for the Conflicts page's war list.
 * @param {*} history
 * @returns {{ headers: string[], rows: Array<Array<string|number>> }}
 */
export function warsCsv(history) {
  const safeHistory = history || {};
  const samples = Array.isArray(safeHistory.samples) ? safeHistory.samples : [];
  const latest = samples.length ? samples[samples.length - 1].turn || 0 : 0;
  const wars = mergeWars(policyVisibleWars(safeHistory.wars, samples), latest);
  const named = nameMergedWars(wars, samples);
  const names = pidNameMap(samples);
  const headers = ["war", "startTurn", "endTurn", "status", "sideA", "sideB"];
  const rows = wars.map((war) => [
    named.get(war.warUniqueID) || t("LOC_DEMOGRAPHICS_WAR_FALLBACK_NAME", war.warUniqueID),
    typeof war.startTurn === "number" ? war.startTurn : "",
    typeof war.endTurn === "number" ? war.endTurn : "",
    typeof war.endTurn === "number" ? "ended" : "ongoing",
    sideNames(war.sideACivs, names),
    sideNames(war.sideBCivs, names)
  ]);
  return { headers, rows };
}
