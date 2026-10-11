// chart-war-military.js
//
// Side/mode military graph helpers used by chart-conflicts-graphs.

import { t, tCsFallback } from "/demographics/ui/core/demographics-i18n.js";

import {
  buildSeries,
  lossSeriesCounter,
  metricAt
} from "/demographics/ui/screen-demographics/charts/wars/chart-war-series.js";

/** The two graphs that carry the belligerents / CS allies / cumulative filter. */
export const MIL_GRAPH_IDS = new Set(["milpower", "milpowerLevel"]);

/**
 * The per-line series for a military graph under a filter mode.
 * @param {{ war: *, win: Snapshot[] }} view
 * @param {string} mode The filter mode id.
 * @param {boolean} isLoss Whether this is the "lost" graph (vs the level graph).
 * @param {{ pid: number, name: string, color: string }[]} belligerents Visible belligerent civs.
 * @returns {{ name: string, color: string, points: { x: number, y: number }[] }[]}
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
 * Whether a roster entry is a city-state participant not yet seen.
 * @param {*} entry
 * @param {Set<number>} seen
 * @returns {boolean}
 */
function includeCsParticipant(entry, seen) {
  if (!entry || !entry.isCS) return false;
  if (typeof entry.pid !== "number") return false;
  return !seen.has(entry.pid);
}

/**
 * Record a city-state participant as seen and add its series descriptor (read from `minors`).
 * @param {{ pid: number, name: string, color: string, fromMinors: boolean }[]} out
 * @param {Set<number>} seen
 * @param {*} entry
 */
function pushCsParticipant(out, seen, entry) {
  seen.add(entry.pid);
  out.push({
    pid: entry.pid,
    name: entry.civ || tCsFallback(entry.pid),
    color: entry.color || "#8c98b8",
    fromMinors: true
  });
}

/**
 * One member's military series: standing power (level) or cumulative power lost.
 * @param {{ pid: number, name: string, color: string, fromMinors?: boolean }} member
 * @param {Snapshot[]} win
 * @param {boolean} isLoss
 * @returns {{ name: string, color: string, points: { x: number, y: number }[] }}
 */
function memberSeries(member, win, isLoss) {
  return isLoss
    ? lossSeriesCounter(member, win, "milLostCum", "milpower", member.fromMinors)
    : buildSeries(member, win, "milpower", member.fromMinors);
}

/**
 * The city-state ally participants of a war (deduped by pid).
 * @param {*} war
 * @returns {{ pid: number, name: string, color: string, fromMinors: boolean }[]}
 */
function csParticipants(war) {
  const rosters = /** @type {any[]} */ ([]).concat(war.sideACivs || [], war.sideBCivs || []);
  const seen = new Set();
  /** @type {{ pid: number, name: string, color: string, fromMinors: boolean }[]} */
  const out = [];
  for (const entry of rosters) {
    if (!includeCsParticipant(entry, seen)) continue;
    pushCsParticipant(out, seen, entry);
  }
  return out;
}

/**
 * Per-side cumulative allied series (majors + city-states summed), one line per
 * side that has any members with data.
 * @param {{ war: *, win: Snapshot[] }} view
 * @param {boolean} isLoss Whether to sum losses (vs standing power).
 * @returns {{ name: string, color: string, points: { x: number, y: number }[] }[]}
 */
function cumulativeSeries(view, isLoss) {
  return sideGroups(view.war)
    .map((group) => sumGroupSeries(group, view.win, isLoss))
    .filter((series) => series.points.length);
}

/**
 * Resolve a war's two side groups (each: a label, color, and member list of
 * { pid, fromMinors }), dropping empty sides.
 * @param {*} war
 * @returns {{ label: string, color: string,
 *   members: { pid: number, fromMinors: boolean }[] }[]}
 */
function sideGroups(war) {
  return [buildSideGroup(war.sideACivs), buildSideGroup(war.sideBCivs)].filter(
    (group) => group.members.length
  );
}

/**
 * Build one side group from its roster: every pid as a member (city-states
 * flagged fromMinors), labeled + colored by the side's lead major civ.
 * @param {*[]} roster A war side's roster.
 * @returns {{ label: string, color: string,
 *   members: { pid: number, fromMinors: boolean }[] }}
 */
function buildSideGroup(roster) {
  const members = [];
  let color = null;
  let lead = null;
  for (const entry of roster || []) {
    if (!entry || typeof entry.pid !== "number") continue;
    members.push({ pid: entry.pid, fromMinors: !!entry.isCS });
    if (!entry.isCS && !color) {
      color = entry.color;
      lead = entry.civ;
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
 *   members: { pid: number, fromMinors: boolean }[] }} group
 * @param {Snapshot[]} win
 * @param {boolean} isLoss
 * @returns {{ name: string, color: string, points: { x: number, y: number }[] }}
 */
function sumGroupSeries(group, win, isLoss) {
  const baselines = isLoss ? groupLossBaselines(group, win) : new Map();
  const points = [];
  for (const sample of win) {
    if (typeof sample.turn !== "number") continue;
    let sum = 0;
    let any = false;
    for (const member of group.members) {
      const contribution = memberContribution(sample, member, isLoss, baselines);
      if (contribution === null) continue;
      sum += contribution;
      any = true;
    }
    if (any) points.push({ x: sample.turn, y: isLoss ? -sum : sum });
  }
  return { name: group.label, color: group.color, points };
}

/**
 * One member's contribution to a side's cumulative series at a sample: its
 * standing power (level), or its loss accrued since the window baseline.
 * @param {*} sample
 * @param {{ pid: number, fromMinors: boolean }} member
 * @param {boolean} isLoss Whether to compute loss (vs level).
 * @param {Map<number, number>} baselines Per-member loss baselines (loss mode only).
 * @returns {number | null} The contribution, or null when no data.
 */
function memberContribution(sample, member, isLoss, baselines) {
  if (!isLoss) return metricAt(sample, member.pid, "milpower", member.fromMinors);
  const value = metricAt(sample, member.pid, "milLostCum", member.fromMinors);
  const baseline = baselines.get(member.pid);
  if (value === null || baseline === undefined) return null;
  return value - baseline;
}

/**
 * Each member's first in-window cumulative-loss value (the baseline subtracted so
 * losses count only what accrued during the displayed window).
 * @param {{ members: { pid: number, fromMinors: boolean }[] }} group
 * @param {Snapshot[]} win
 * @returns {Map<number, number>} pid -> baseline milLostCum.
 */
function groupLossBaselines(group, win) {
  const baselines = new Map();
  for (const member of group.members) {
    for (const sample of win) {
      const value = metricAt(sample, member.pid, "milLostCum", member.fromMinors);
      if (value !== null) {
        baselines.set(member.pid, value);
        break;
      }
    }
  }
  return baselines;
}
