// view-settlements-table.js
//
// Table and leaders rendering for the Settlements view.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { div, fmt, iconEl } from "/demographics/ui/core/ui-helpers.js";
import {
  SETTLEMENT_OUTPUTS,
  valueOf
} from "/demographics/ui/screen-demographics/settlements/settlements-data.js";
import { rankedRowClass } from "/demographics/ui/screen-demographics/views/settlements/view-settlements-showcase.js";

/**
 * @typedef {{
 *   topN: number,
 *   setSetting: (settings: *, key: string, value: *) => void,
 *   safePlaySound: (id: string) => void,
 *   rerenderContent: (st: *) => void,
 *   displayOf: (st: *, s: *) => *,
 *   buildOwnerCell: (owner: *) => HTMLElement,
 *   buildTypeBadge: (isTown: boolean) => HTMLElement,
 *   buildSectionTitle: (key: string) => HTMLElement,
 *   buildEmpty: () => HTMLElement
 * }} TableDeps
 */

/**
 * The table filters, in display order.
 * @type {Array<{ id: string, label: string, test: (s: *) => boolean }>}
 */
const FILTERS = [
  { id: "all", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_FILTER_ALL", test: () => true },
  {
    id: "cities",
    label: "LOC_DEMOGRAPHICS_SETTLEMENTS_FILTER_CITIES",
    test: (s) => !s.isTown
  },
  {
    id: "towns",
    label: "LOC_DEMOGRAPHICS_SETTLEMENTS_FILTER_TOWNS",
    test: (s) => s.isTown
  }
];

/**
 * The leading value of each output within a settlement pool (the rows the active
 * All/Cities/Towns filter admits, not just the 25 shown), keyed by output id.
 * An output nobody leads (every settlement equal, or no positive value) is left
 * out, so nothing is highlighted for it.
 * @param {*[]} pool The filtered settlements.
 * @returns {Record<string, number>} Output id → leading value.
 */
function columnLeaders(pool) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const col of SETTLEMENT_OUTPUTS) {
    const vals = pool.map((s) => valueOf(s, col.id));
    const max = Math.max(...vals);
    if (max > 0 && vals.some((v) => v < max)) out[col.id] = max;
  }
  return out;
}

/**
 * Build the All/Cities/Towns filter chip row.
 * @param {*} st The render state.
 * @param {TableDeps} deps Rendering dependencies.
 * @returns {HTMLElement} The chip row.
 */
function buildFilterRow(st, deps) {
  const row = div("demographics-settle-filters");
  for (const f of FILTERS) {
    const chip = div(
      "demographics-chart-time-filter-pill" + (st.filter === f.id ? " is-active" : "")
    );
    chip.textContent = t(f.label);
    chip.addEventListener("click", () => {
      if (st.filter === f.id) return;
      st.filter = f.id;
      // Session-only: the ranking always reopens on All (see view-settlements.js),
      // so the chosen filter is intentionally not persisted.
      deps.safePlaySound("data-audio-activate");
      deps.rerenderContent(st);
    });
    row.appendChild(chip);
  }
  return row;
}

/**
 * The fixed leading columns of the table.
 * @type {Array<{ id: string, label: string }>}
 */
const FIXED_COLS = [
  { id: "rank", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_COL_RANK" },
  { id: "owner", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_COL_OWNER" },
  { id: "name", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_COL_NAME" },
  { id: "type", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_COL_TYPE" },
  { id: "composite", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_COL_SCORE" }
];

/**
 * Build a sortable header cell.
 * @param {*} st The render state.
 * @param {string} key The sort key.
 * @param {HTMLElement} inner Header content.
 * @param {TableDeps} deps Rendering dependencies.
 * @returns {HTMLElement} The header cell.
 */
function buildSortHeader(st, key, inner, deps) {
  const cell = div(
    "demographics-settle-th demographics-settle-col-" +
      key +
      (st.sortKey === key ? " is-sorted" : "")
  );
  cell.appendChild(inner);
  cell.addEventListener("click", () => {
    if (st.sortKey === key) return;
    st.sortKey = key;
    deps.setSetting(st.settings, "settlementsSortKey", key);
    deps.safePlaySound("data-audio-activate");
    deps.rerenderContent(st);
  });
  return cell;
}

/**
 * Build the table header row.
 * @param {*} st The render state.
 * @param {TableDeps} deps Rendering dependencies.
 * @returns {HTMLElement} The header row.
 */
function buildHeaderRow(st, deps) {
  const row = div("demographics-settle-row demographics-settle-header");
  for (const c of FIXED_COLS) {
    if (c.id === "composite") {
      row.appendChild(
        buildSortHeader(
          st,
          "composite",
          div("demographics-settle-th-label", t(c.label)),
          deps
        )
      );
    } else {
      const cell = div("demographics-settle-th demographics-settle-col-" + c.id);
      cell.appendChild(div("demographics-settle-th-label", t(c.label)));
      row.appendChild(cell);
    }
  }
  for (const col of SETTLEMENT_OUTPUTS) {
    const inner = div("demographics-settle-th-inner");
    inner.appendChild(iconEl(col.icon, "demographics-settle-yield-icon"));
    inner.appendChild(div("demographics-settle-th-label", t(col.label)));
    row.appendChild(buildSortHeader(st, col.id, inner, deps));
  }
  return row;
}

/**
 * Build one output cell. The leading settlement's cell carries the gold leader
 * wash and a "World leader in <output>" tooltip: the table itself marks the
 * category leaders (the separate leader-card strip was removed).
 * @param {*} s The settlement.
 * @param {{ id: string, label: string }} col The output column.
 * @param {string} sortKey The active sort key.
 * @param {Record<string, number>} leads Output id → leading value.
 * @returns {HTMLElement} The cell.
 */
function buildOutputCell(s, col, sortKey, leads) {
  const lead = col.id in leads && valueOf(s, col.id) === leads[col.id];
  const cell = div(
    "demographics-settle-td demographics-settle-col-" + col.id +
      (sortKey === col.id ? " is-sorted" : "") + (lead ? " is-leader" : ""),
    fmt(s.outputs[col.id])
  );
  if (lead) cell.setAttribute("data-tooltip-content", t("LOC_DEMOGRAPHICS_SETTLEMENTS_WORLD_LEADER_TOOLTIP", t(col.label)));
  return cell;
}

/**
 * Build one settlement data row for the table.
 * @param {*} s The settlement.
 * @param {number} rank The 1-based rank within the current sort.
 * @param {string} sortKey The active sort key.
 * @param {Record<string, number>} leads Output id → leading value (see columnLeaders).
 * @param {TableDeps} deps Rendering dependencies.
 * @returns {HTMLElement} The row.
 */
function buildTableRow(s, rank, sortKey, leads, deps) {
  const row = div(rankedRowClass("demographics-settle-row demographics-settle-datarow", s, rank));
  if (s.owner.readable || s.owner.primary) {
    row.style.setProperty("border-left-color", s.owner.readable || s.owner.primary);
  }
  row.appendChild(div("demographics-settle-td demographics-settle-col-rank", String(rank)));
  const ownerTd = div("demographics-settle-td demographics-settle-col-owner");
  ownerTd.appendChild(deps.buildOwnerCell(s.owner));
  row.appendChild(ownerTd);
  row.appendChild(div("demographics-settle-td demographics-settle-col-name", s.name));
  const typeTd = div("demographics-settle-td demographics-settle-col-type");
  typeTd.appendChild(deps.buildTypeBadge(s.isTown));
  row.appendChild(typeTd);
  row.appendChild(
    div(
      "demographics-settle-td demographics-settle-col-composite demographics-settle-scorecell" +
        (sortKey === "composite" ? " is-sorted" : ""),
      fmt(s.composite)
    )
  );
  for (const col of SETTLEMENT_OUTPUTS) row.appendChild(buildOutputCell(s, col, sortKey, leads));
  return row;
}

/**
 * Render the detail table (filter + leaders strip + sortable rows).
 * @param {*} st The render state.
 * @param {TableDeps} deps Rendering dependencies.
 */
export function renderTablePanel(st, deps) {
  st.content.appendChild(buildFilterRow(st, deps));
  if (!st.board.settlements.length) {
    st.content.appendChild(deps.buildEmpty());
    return;
  }
  st.content.appendChild(deps.buildSectionTitle("LOC_DEMOGRAPHICS_SETTLEMENTS_TABLE_TITLE"));
  const filter = FILTERS.find((f) => f.id === st.filter) || FILTERS[0];
  const pool = st.board.settlements.filter(filter.test);
  const leads = columnLeaders(pool);
  const rows = pool
    .slice()
    .sort(
      (/** @type {*} */ a, /** @type {*} */ b) =>
        valueOf(b, st.sortKey) - valueOf(a, st.sortKey)
    )
    .slice(0, deps.topN);
  const table = div("demographics-settle-table");
  table.appendChild(buildHeaderRow(st, deps));
  for (let i = 0; i < rows.length; i++) {
    table.appendChild(buildTableRow(deps.displayOf(st, rows[i]), i + 1, st.sortKey, leads, deps));
  }
  st.content.appendChild(table);
}
