// chart-war-military.js
//
// Side/mode military graph helpers used by chart-conflicts-graphs.

import { t } from "/demographics/ui/core/demographics-i18n.js";

import {
  buildSeries,
  lossSeriesCounter,
  metricAt
} from "/demographics/ui/screen-demographics/charts/wars/chart-war-series.js";

/** The two graphs that carry the belligerents / CS allies / cumulative filter. */
export const MIL_GRAPH_IDS = new Set(["milpower", "milpowerLevel"]);

/**
 * The per-line series for a military graph under a filter mode.
 * @param {{ war: *, win: Snapshot[] }} view The war view.
 * @param {string} mode The filter mode id.
 * @param {boolean} isLoss Whether this is the "lost" graph (vs the level graph).
 * @param {{ pid: number, name: string, color: string }[]} belligerents Visible belligerent civs.
 * @returns {{ name: string, color: string, points: { x: number, y: number }[] }[]} The series.
 */
export function milSeriesFor(view, mode, isLoss, belligerents) {
  if (mode === "cs") {
    return csParticipants(view.war).map((p) => memberSeries(p, view.win, isLoss));
  }
  if (mode === "cumulative") {
    return cumulativeSeries(view, isLoss);
  }
  return belligerents.map((p) =>
    memberSeries({ ...p, fromMinors: false }, view.win, isLoss)
  );
}

/**
 * Whether a roster entry is a unique city-state participant row.
 * @param {*} entry One roster entry.
 * @param {Set<number>} seen Seen pid set.
 * @returns {boolean} True when entry should be included.
 */
function includeCsParticipant(entry, seen) {
  if (!entry || !entry.isCS) return false;
  if (typeof entry.pid !== "number") return false;
  return !seen.has(entry.pid);
}

/**
 * Push one city-state participant row.
 * @param {{ pid: number, name: string, color: string, fromMinors: boolean }[]} out
 *   Output list.
 * @param {Set<number>} seen Seen pid set.
 * @param {*} entry One roster entry.
 */
function pushCsParticipant(out, seen, entry) {
  seen.add(entry.pid);
  out.push({
    pid: entry.pid,
    name: entry.civ || "CS " + entry.pid,
    color: entry.color || "#8c98b8",
    fromMinors: true
  });
}

/**
 * One member's military series: standing power (level) or cumulative power lost.
 * @param {{ pid: number, name: string, color: string, fromMinors?: boolean }} member The member.
 * @param {Snapshot[]} win The windowed samples.
 * @param {boolean} isLoss Whether to build the loss series.
 * @returns {{ name: string, color: string, points: { x: number, y: number }[] }} The series.
 */
function memberSeries(member, win, isLoss) {
  return isLoss
    ? lossSeriesCounter(member, win, "milLostCum", "milpower", member.fromMinors)
    : buildSeries(member, win, "milpower", member.fromMinors);
}

/**
 * The city-state ally participants of a war (deduped by pid).
 * @param {*} war The war record.
 * @returns {{ pid: number, name: string, color: string, fromMinors: boolean }[]} The CS rows.
 */
function csParticipants(war) {
  const rosters = /** @type {any[]} */ ([]).concat(war.sideACivs || [], war.sideBCivs || []);
  const seen = new Set();
  /** @type {{ pid: number, name: string, color: string, fromMinors: boolean }[]} */
  const out = [];
  for (const e of rosters) {
    if (!includeCsParticipant(e, seen)) continue;
    pushCsParticipant(out, seen, e);
  }
  return out;
}

/**
 * Per-side cumulative allied series (majors + city-states summed), one line per
 * side that has any members with data.
 * @param {{ war: *, win: Snapshot[] }} view The war view.
 * @param {boolean} isLoss Whether to sum losses (vs standing power).
 * @returns {{ name: string, color: string, points: { x: number, y: number }[] }[]} The side series.
 */
function cumulativeSeries(view, isLoss) {
  return sideGroups(view.war)
    .map((g) => sumGroupSeries(g, view.win, isLoss))
    .filter((s) => s.points.length);
}

/**
 * Resolve a war's two side groups (each: a label, color, and member list of
 * { pid, fromMinors }), dropping empty sides.
 * @param {*} war The war record.
 * @returns {{ label: string, color: string,
 *   members: { pid: number, fromMinors: boolean }[] }[]} The groups.
 */
function sideGroups(war) {
  return [buildSideGroup(war.sideACivs), buildSideGroup(war.sideBCivs)].filter(
    (g) => g.members.length
  );
}

/**
 * Build one side group from its roster: every pid as a member (city-states
 * flagged fromMinors), labeled + colored by the side's lead major civ.
 * @param {*[]} roster A war side's roster.
 * @returns {{ label: string, color: string,
 *   members: { pid: number, fromMinors: boolean }[] }} The group.
 */
function buildSideGroup(roster) {
  const members = [];
  let color = null;
  let lead = null;
  for (const e of roster || []) {
    if (!e || typeof e.pid !== "number") continue;
    members.push({ pid: e.pid, fromMinors: !!e.isCS });
    if (!e.isCS && !color) {
      color = e.color;
      lead = e.civ;
    }
  }
  const label = lead
    ? t("LOC_DEMOGRAPHICS_WAR_GRAPHS_CUM_SIDE", lead)
    : t("LOC_DEMOGRAPHICS_WAR_GRAPHS_CUM_SIDE_UNKNOWN");
  return { label, color: color || "#9aa8c8", members };
}

/**
 * Sum a side group's members into one series: per turn, the sum of standing
 * power (level) or of each member's loss-since-window-start (loss, negated).
 * @param {{ label: string, color: string,
 *   members: { pid: number, fromMinors: boolean }[] }} g The group.
 * @param {Snapshot[]} win The windowed samples.
 * @param {boolean} isLoss Whether to sum losses.
 * @returns {{ name: string, color: string, points: { x: number, y: number }[] }} The summed series.
 */
function sumGroupSeries(g, win, isLoss) {
  const base = isLoss ? groupLossBaselines(g, win) : new Map();
  const points = [];
  for (const s of win) {
    if (typeof s.turn !== "number") continue;
    let sum = 0;
    let any = false;
    for (const mbr of g.members) {
      const c = memberContribution(s, mbr, isLoss, base);
      if (c === null) continue;
      sum += c;
      any = true;
    }
    if (any) points.push({ x: s.turn, y: isLoss ? -sum : sum });
  }
  return { name: g.label, color: g.color, points };
}

/**
 * One member's contribution to a side's cumulative series at a sample: its
 * standing power (level), or its loss accrued since the window baseline.
 * @param {*} s The snapshot.
 * @param {{ pid: number, fromMinors: boolean }} mbr The member.
 * @param {boolean} isLoss Whether to compute loss (vs level).
 * @param {Map<number, number>} base Per-member loss baselines (loss mode only).
 * @returns {number | null} The contribution, or null when no data.
 */
function memberContribution(s, mbr, isLoss, base) {
  if (!isLoss) return metricAt(s, mbr.pid, "milpower", mbr.fromMinors);
  const v = metricAt(s, mbr.pid, "milLostCum", mbr.fromMinors);
  const b0 = base.get(mbr.pid);
  if (v === null || b0 === undefined) return null;
  return v - b0;
}

/**
 * Each member's first in-window cumulative-loss value (the baseline subtracted so
 * losses count only what accrued during the displayed window).
 * @param {{ members: { pid: number, fromMinors: boolean }[] }} g The group.
 * @param {Snapshot[]} win The windowed samples.
 * @returns {Map<number, number>} pid -> baseline milLostCum.
 */
function groupLossBaselines(g, win) {
  const base = new Map();
  for (const mbr of g.members) {
    for (const s of win) {
      const v = metricAt(s, mbr.pid, "milLostCum", mbr.fromMinors);
      if (v !== null) {
        base.set(mbr.pid, v);
        break;
      }
    }
  }
  return base;
}
