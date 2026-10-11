// chart-wars-cost-table.js
//
// The shared row-major cost table (label column + one value column per entry, so
// labels, stat icons, values, and portrait headers all line up by column). Used
// by the war-timeline tooltip and the Crisis Stages cost sections.

import {
  buildCostIcon,
  formatCostFigure,
  formatMagnitude,
  costMetricTitle
} from "/demographics/ui/screen-demographics/charts/conflicts/chart-conflicts-cost.js";
import { t } from "/demographics/ui/core/demographics-i18n.js";

/**
 * Build the row-major cost table (label column + one value column per entry, so
 * labels, stat icons, values, and headers all line up by column). Shared by the
 * war tooltip and the crisis-stages cost sections.
 * @param {*[]} cols The columns (major / combined-CS / individual-CS).
 * @param {*[]} metrics The COST_METRICS subset to show, in order.
 * @param {Snapshot[]} samples For portrait identity.
 * @param {number} vsAt Column index a "vs" divider precedes (-1 for none).
 * @returns {HTMLElement}
 */
export function buildCostTable(cols, metrics, samples, vsAt) {
  const table = document.createElement("div");
  table.className = "demographics-wars-tooltip-table";
  table.appendChild(buildTableHeadRow(cols, samples, vsAt));
  for (const metric of metrics) table.appendChild(buildTableMetricRow(metric, cols, vsAt));
  return table;
}

/**
 * Resolve a participant's leader-icon type + primary color from the latest
 * sample that carries the pid.
 * @param {Pid|string} pid
 * @param {Snapshot[]} samples
 * @returns {{ leaderType: string|null, color: string|null }}
 */
function participantIdentity(pid, samples) {
  for (let i = samples.length - 1; i >= 0; i--) {
    const sample = samples[i];
    const samplePlayer = sample && sample.players ? sample.players[pid] : null;
    if (samplePlayer) {
      return {
        leaderType:
          typeof samplePlayer.leaderTypeString === "string" ? samplePlayer.leaderTypeString : null,
        color: typeof samplePlayer.primaryColor === "string" ? samplePlayer.primaryColor : null
      };
    }
  }
  return { leaderType: null, color: null };
}

/**
 * Build a round leader-portrait element: a real <fxs-icon> when a LEADER_* type
 * is known (the element the WorldRankingsAllCivs uses), else a neutral placeholder circle.
 * @param {string|null} leaderType
 * @returns {HTMLElement}
 */
function buildCombatantPortrait(leaderType) {
  const wrap = document.createElement("div");
  wrap.className = "demographics-wars-tooltip-portrait";
  if (leaderType && /^LEADER_/.test(leaderType)) {
    const icon = document.createElement("fxs-icon");
    icon.className = "demographics-wars-tooltip-portrait-icon";
    icon.setAttribute("data-icon-id", leaderType);
    icon.setAttribute("data-icon-context", "LEADER");
    wrap.appendChild(icon);
  }
  return wrap;
}

/**
 * Build one leader's header cell: the leader portrait above a civ-color dot.
 * @param {*} entry The roster participant entry.
 * @param {Snapshot[]} samples For icon/color.
 * @returns {HTMLElement}
 */
function buildLeaderHeadCell(entry, samples) {
  const identity = participantIdentity(entry.pid, samples);
  // The roster entry carries the civ color; the LEADER_* type is in the samples
  // (pidInfo stores civTypeString); newer wars also stamp entry.leaderType.
  const leaderType = entry.leaderType || identity.leaderType;
  const color = entry.color || identity.color;
  const cell = document.createElement("div");
  cell.className = "demographics-wars-tooltip-tcell demographics-wars-tooltip-thead-cell";
  cell.appendChild(buildCombatantPortrait(leaderType));
  if (color) {
    const dot = document.createElement("span");
    dot.className = "demographics-wars-tooltip-dot";
    dot.style.backgroundColor = color;
    cell.appendChild(dot);
  }
  return cell;
}

/**
 * Build one leader's value cell for a metric: the stat icon + the value (with
 * the allied-total parenthetical on the Military Power / Power Lost rows).
 * @param {*} metric The cost-metric descriptor.
 * @param {*} cost The participant's per-metric figures (keyed by metric.key).
 * @param {{ power: number, lost: number }|null} csTotals The side's CS totals, or null.
 * @returns {HTMLElement}
 */
function buildValueCell(metric, cost, csTotals) {
  const fig = formatCostFigure(cost[metric.key], metric.mode);
  const cell = document.createElement("div");
  cell.className = "demographics-wars-tooltip-tcell";
  if (metric.blp) cell.appendChild(buildCostIcon(metric.blp));
  const val = document.createElement("span");
  val.className = "demographics-wars-tooltip-leader-val " + fig.cls;
  val.textContent =
    fig.text + alliedSuffix(metric, cost, csTotals) + scaledCasualtySuffix(metric, cost);
  cell.appendChild(val);
  return cell;
}

/**
 * The "≈ soldiers killed" parenthetical for the Units-Lost row: the raw unit count scaled to a
 * population-comparable figure (computed in participantCost). "" for every other metric.
 * @param {*} metric The cost-metric descriptor.
 * @param {*} cost The participant's per-metric figures.
 * @returns {string}
 */
function scaledCasualtySuffix(metric, cost) {
  if (metric.key !== "unitsLost" || !(cost.unitsLostScaled > 0)) return "";
  return " (≈" + formatMagnitude(cost.unitsLostScaled) + ")";
}

/**
 * Build a fixed-width label cell (the leftmost prose-label column).
 * @param {string} text "" for the header spacer.
 * @returns {HTMLElement}
 */
export function buildLabelCell(text) {
  const cell = document.createElement("div");
  cell.className = "demographics-wars-tooltip-tlabel";
  cell.textContent = text;
  return cell;
}

/**
 * Build the thin "vs" divider cell between the two sides (text in the head row,
 * an empty spacer in metric rows so columns stay aligned).
 * @param {string} text "" for spacer rows.
 * @returns {HTMLElement}
 */
export function buildVsCell(text) {
  const cell = document.createElement("div");
  cell.className = "demographics-wars-tooltip-tvs";
  cell.textContent = text;
  return cell;
}

/**
 * Build the header row: an empty label spacer, then a portrait/dot cell per
 * leader (with the vs divider inserted between the two sides).
 * @param {*[]} cols The leader columns.
 * @param {Snapshot[]} samples
 * @param {number} vsAt The column index the vs divider precedes (-1 for none).
 * @returns {HTMLElement}
 */
function buildTableHeadRow(cols, samples, vsAt) {
  const row = document.createElement("div");
  row.className = "demographics-wars-tooltip-trow is-head";
  row.appendChild(buildLabelCell(""));
  cols.forEach((column, i) => {
    if (i === vsAt) row.appendChild(buildVsCell(t("LOC_DEMOGRAPHICS_WARS_VS")));
    row.appendChild(headCellFor(column, samples));
  });
  return row;
}

/**
 * Build a column's header cell (a major leader's portrait + color dot).
 * @param {*} column A cost-table column (`entry` is its roster participant).
 * @param {Snapshot[]} samples For leader identity.
 * @returns {HTMLElement}
 */
function headCellFor(column, samples) {
  return buildLeaderHeadCell(column.entry, samples);
}

/**
 * Build one metric row: the prose label, then each leader's icon+value cell
 * (with the vs spacer between the two sides).
 * @param {*} metric The cost-metric descriptor.
 * @param {*[]} cols The leader columns.
 * @param {number} vsAt The column index the vs divider precedes (-1 for none).
 * @returns {HTMLElement}
 */
function buildTableMetricRow(metric, cols, vsAt) {
  const row = document.createElement("div");
  row.className = "demographics-wars-tooltip-trow";
  row.appendChild(buildLabelCell(costMetricTitle(metric)));
  cols.forEach((column, i) => {
    if (i === vsAt) row.appendChild(buildVsCell(""));
    row.appendChild(buildValueCell(metric, column.cost, column.cs));
  });
  return row;
}

/**
 * The allied-total parenthetical for a metric row: " (major + side CS)" on the
 * Military Power and Power Lost rows when the side has city-state allies; ""
 * otherwise.
 * @param {*} metric The cost-metric descriptor.
 * @param {*} cost The participant's per-metric figures.
 * @param {{ power: number, lost: number }|null} csTotals The side's CS totals, or null.
 * @returns {string}
 */
function alliedSuffix(metric, cost, csTotals) {
  if (!csTotals) return "";
  if (metric.key === "milPower") {
    return " (" + formatMagnitude((cost.milPower || 0) + csTotals.power) + ")";
  }
  if (metric.key === "milLost") {
    const total = (cost.milLost || 0) + csTotals.lost;
    return " (" + (total > 0 ? formatMagnitude(total) : "0") + ")";
  }
  return "";
}
