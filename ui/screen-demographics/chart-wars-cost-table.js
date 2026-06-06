// chart-wars-cost-table.js
//
// The shared row-major cost table (label column + one value column per entry, so
// labels, stat icons, values, and portrait headers all line up by column).
// Extracted from chart-wars-gantt.js so the Crises pages can build the same
// table without importing the big gantt render module. Used by the war-timeline
// tooltip (chart-wars-gantt) and the Crisis Stages cost sections
// (chart-crisis-stages).

import {
  buildCostIcon,
  formatCostFigure,
  formatMagnitude,
  costMetricTitle
} from "/demographics/ui/screen-demographics/chart-wars-cost.js";
import { t } from "/demographics/ui/demographics-i18n.js";

/**
 * Build the row-major cost table (label column + one value column per entry, so
 * labels, stat icons, values, and headers all line up by column). Shared by the
 * war tooltip and the crisis-stages cost sections.
 * @param {*[]} cols The columns (major / combined-CS / individual-CS).
 * @param {*[]} metrics The COST_METRICS subset to show, in order.
 * @param {Snapshot[]} samples The sample stream (for portrait identity).
 * @param {number} vsAt Column index a "vs" divider precedes (-1 for none).
 * @returns {HTMLElement} The table element.
 */
export function buildCostTable(cols, metrics, samples, vsAt) {
  const table = document.createElement("div");
  table.className = "demographics-wars-tooltip-table";
  table.appendChild(buildTableHeadRow(cols, samples, vsAt));
  for (const m of metrics) table.appendChild(buildTableMetricRow(m, cols, vsAt));
  return table;
}

/**
 * Resolve a participant's leader-icon type + primary color from the latest
 * sample that carries the pid.
 * @param {Pid|string} pid The participant pid.
 * @param {Snapshot[]} samples The sample stream.
 * @returns {{ leaderType: string|null, color: string|null }} Identity bits.
 */
function participantIdentity(pid, samples) {
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i];
    const ps = s && s.players ? s.players[pid] : null;
    if (ps) {
      return {
        leaderType: typeof ps.leaderTypeString === "string" ? ps.leaderTypeString : null,
        color: typeof ps.primaryColor === "string" ? ps.primaryColor : null
      };
    }
  }
  return { leaderType: null, color: null };
}

/**
 * Build a round leader-portrait element: a real <fxs-icon> when a LEADER_* type
 * is known (the element the Factbook uses), else a neutral placeholder circle.
 * @param {string|null} leaderType The LEADER_* type string.
 * @returns {HTMLElement} The portrait wrapper.
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
 * @param {Snapshot[]} samples The sample stream (for icon/color).
 * @returns {HTMLElement} The header cell.
 */
function buildLeaderHeadCell(entry, samples) {
  const id = participantIdentity(entry.pid, samples);
  // The roster entry carries the civ color; the LEADER_* type is in the samples
  // (pidInfo stores civTypeString) - newer wars also stamp entry.leaderType.
  const leaderType = entry.leaderType || id.leaderType;
  const color = entry.color || id.color;
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
 * @param {*} m The cost-metric descriptor.
 * @param {*} cost The participant's per-metric figures (keyed by m.key).
 * @param {{ power: number, lost: number }|null} csTotals The side's CS totals, or null.
 * @returns {HTMLElement} The value cell.
 */
function buildValueCell(m, cost, csTotals) {
  const fig = formatCostFigure(cost[m.key], m.mode);
  const cell = document.createElement("div");
  cell.className = "demographics-wars-tooltip-tcell";
  if (m.blp) cell.appendChild(buildCostIcon(m.blp));
  const val = document.createElement("span");
  val.className = "demographics-wars-tooltip-leader-val " + fig.cls;
  val.textContent = fig.text + alliedSuffix(m, cost, csTotals);
  cell.appendChild(val);
  return cell;
}

/**
 * Build a fixed-width label cell (the leftmost prose-label column).
 * @param {string} text The label text ("" for the header spacer).
 * @returns {HTMLElement} The label cell.
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
 * @param {string} text The cell text ("" for spacer rows).
 * @returns {HTMLElement} The vs cell.
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
 * @param {Snapshot[]} samples The sample stream.
 * @param {number} vsAt The column index the vs divider precedes (-1 for none).
 * @returns {HTMLElement} The header row.
 */
function buildTableHeadRow(cols, samples, vsAt) {
  const row = document.createElement("div");
  row.className = "demographics-wars-tooltip-trow is-head";
  row.appendChild(buildLabelCell(""));
  cols.forEach((c, i) => {
    if (i === vsAt) row.appendChild(buildVsCell(t("LOC_DEMOGRAPHICS_WARS_VS")));
    row.appendChild(headCellFor(c, samples));
  });
  return row;
}

/**
 * Build a column's header cell (a major leader's portrait + color dot).
 * @param {*} c The column.
 * @param {Snapshot[]} samples The sample stream (for leader identity).
 * @returns {HTMLElement} The header cell.
 */
function headCellFor(c, samples) {
  return buildLeaderHeadCell(c.entry, samples);
}

/**
 * Build one metric row: the prose label, then each leader's icon+value cell
 * (with the vs spacer between the two sides).
 * @param {*} m The cost-metric descriptor.
 * @param {*[]} cols The leader columns.
 * @param {number} vsAt The column index the vs divider precedes (-1 for none).
 * @returns {HTMLElement} The metric row.
 */
function buildTableMetricRow(m, cols, vsAt) {
  const row = document.createElement("div");
  row.className = "demographics-wars-tooltip-trow";
  row.appendChild(buildLabelCell(costMetricTitle(m)));
  cols.forEach((c, i) => {
    if (i === vsAt) row.appendChild(buildVsCell(""));
    row.appendChild(buildValueCell(m, c.cost, c.cs));
  });
  return row;
}

/**
 * The allied-total parenthetical for a metric row: " (major + side CS)" on the
 * Military Power and Power Lost rows when the side has city-state allies; ""
 * otherwise.
 * @param {*} m The cost-metric descriptor.
 * @param {*} cost The participant's per-metric figures.
 * @param {{ power: number, lost: number }|null} csTotals The side's CS totals, or null.
 * @returns {string} The parenthetical suffix (may be "").
 */
function alliedSuffix(m, cost, csTotals) {
  if (!csTotals) return "";
  if (m.key === "milPower") return " (" + formatMagnitude((cost.milPower || 0) + csTotals.power) + ")";
  if (m.key === "milLost") {
    const total = (cost.milLost || 0) + csTotals.lost;
    return " (" + (total > 0 ? formatMagnitude(total) : "0") + ")";
  }
  return "";
}
