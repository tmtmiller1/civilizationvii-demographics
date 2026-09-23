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
 *   displayOf: (st: *, s: *) => *,
 *   buildOwnerCell: (owner: *) => HTMLElement,
 *   buildTypeBadge: (isTown: boolean) => HTMLElement,
 *   buildSectionTitle: (key: string) => HTMLElement,
 *   buildEmpty: () => HTMLElement
 * }} TableDeps
 */

/**
 * Live handles to the panel's persistent chrome, so a filter/sort change can update it IN PLACE
 * instead of rebuilding it. Rebuilding is what made the filigree and the column yield icons blink:
 * a fresh element's `blp:` background resolves a frame or more after it is inserted, so identical
 * chrome visibly flashed on every click. The chrome below is built ONCE per panel render and only
 * ever has classes toggled on it; only the data rows are swapped.
 * @typedef {{
 *   chips: Map<string, HTMLElement>,
 *   heads: Map<string, HTMLElement>,
 *   table: HTMLElement,
 *   rows: HTMLElement[],
 *   refresh: () => void
 * }} TableUi
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
 * filter admits, not just the 25 shown), keyed by output id. An output nobody
 * leads (every settlement equal, or no positive value) is left out.
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
 * Build the All/Cities/Towns filter chip row. The chips are built once and registered in `ui`;
 * their active state is a class toggle in {@link refreshTable}.
 * @param {*} st The render state.
 * @param {TableDeps} deps Rendering dependencies.
 * @param {TableUi} ui The panel's chrome handles.
 * @returns {HTMLElement} The chip row.
 */
function buildFilterRow(st, deps, ui) {
  const row = div("demographics-settle-filters");
  for (const f of FILTERS) {
    const chip = div("demographics-chart-time-filter-pill");
    chip.textContent = t(f.label);
    chip.addEventListener("click", () => {
      if (st.filter === f.id) return;
      st.filter = f.id;
      // Session-only: the ranking always reopens on All (see view-settlements.js),
      // so the chosen filter is intentionally not persisted.
      deps.safePlaySound("data-audio-activate");
      ui.refresh();
    });
    ui.chips.set(f.id, chip);
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
 * Build a sortable header cell. The cell (and the yield icon it carries) is built once and
 * registered in `ui`; its sorted state is a class toggle in {@link refreshTable}.
 * @param {*} st The render state.
 * @param {string} key The sort key.
 * @param {HTMLElement} inner Header content.
 * @param {TableDeps} deps Rendering dependencies.
 * @param {TableUi} ui The panel's chrome handles.
 * @returns {HTMLElement} The header cell.
 */
function buildSortHeader(st, key, inner, deps, ui) {
  const cell = div("demographics-settle-th demographics-settle-col-" + key);
  cell.appendChild(inner);
  cell.addEventListener("click", () => {
    if (st.sortKey === key) return;
    st.sortKey = key;
    deps.setSetting(st.settings, "settlementsSortKey", key);
    deps.safePlaySound("data-audio-activate");
    ui.refresh();
  });
  ui.heads.set(key, cell);
  return cell;
}

/**
 * Build the table header row.
 * @param {*} st The render state.
 * @param {TableDeps} deps Rendering dependencies.
 * @param {TableUi} ui The panel's chrome handles.
 * @returns {HTMLElement} The header row.
 */
function buildHeaderRow(st, deps, ui) {
  const row = div("demographics-settle-row demographics-settle-header");
  for (const c of FIXED_COLS) {
    if (c.id === "composite") {
      row.appendChild(
        buildSortHeader(
          st,
          "composite",
          div("demographics-settle-th-label", t(c.label)),
          deps,
          ui
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
    row.appendChild(buildSortHeader(st, col.id, inner, deps, ui));
  }
  return row;
}

/**
 * Build one output cell. The leading settlement's cell carries the gold leader
 * wash and a "World leader in <output>" tooltip.
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
 * Toggle one class on an element without disturbing the rest of its class list (so a chrome
 * element is never rebuilt just to change its state).
 * @param {HTMLElement} el The element.
 * @param {string} cls The class to toggle.
 * @param {boolean} on Whether the class should be present.
 */
function setClass(el, cls, on) {
  if (on) el.classList.add(cls);
  else el.classList.remove(cls);
}

/**
 * Re-apply the current filter + sort: update the persistent chrome's state classes in place and
 * swap ONLY the data rows. The filter chips, the filigree section title and the header row (with
 * its yield icons) are never rebuilt, so nothing re-resolves a `blp:` background and nothing
 * blinks.
 * @param {*} st The render state.
 * @param {TableDeps} deps Rendering dependencies.
 * @param {TableUi} ui The panel's chrome handles.
 */
function refreshTable(st, deps, ui) {
  for (const [id, chip] of ui.chips) setClass(chip, "is-active", id === st.filter);
  for (const [key, cell] of ui.heads) setClass(cell, "is-sorted", key === st.sortKey);
  for (const row of ui.rows) {
    if (row.parentNode === ui.table) ui.table.removeChild(row);
  }
  ui.rows.length = 0;
  const filter = FILTERS.find((f) => f.id === st.filter) || FILTERS[0];
  const pool = st.board.settlements.filter(filter.test);
  const leads = columnLeaders(pool);
  const ranked = pool
    .slice()
    .sort(
      (/** @type {*} */ a, /** @type {*} */ b) =>
        valueOf(b, st.sortKey) - valueOf(a, st.sortKey)
    )
    .slice(0, deps.topN);
  for (let i = 0; i < ranked.length; i++) {
    const row = buildTableRow(deps.displayOf(st, ranked[i]), i + 1, st.sortKey, leads, deps);
    ui.rows.push(row);
    ui.table.appendChild(row);
  }
}

/**
 * Render the detail table (filter chips + sortable rows). The chrome is built once here; every
 * later filter/sort click goes through {@link refreshTable} rather than a panel rebuild.
 * @param {*} st The render state.
 * @param {TableDeps} deps Rendering dependencies.
 */
export function renderTablePanel(st, deps) {
  /** @type {TableUi} */
  const ui = {
    chips: new Map(),
    heads: new Map(),
    table: div("demographics-settle-table"),
    rows: [],
    refresh: () => {}
  };
  ui.refresh = () => refreshTable(st, deps, ui);
  st.content.appendChild(buildFilterRow(st, deps, ui));
  if (!st.board.settlements.length) {
    st.content.appendChild(deps.buildEmpty());
    return;
  }
  st.content.appendChild(deps.buildSectionTitle("LOC_DEMOGRAPHICS_SETTLEMENTS_TABLE_TITLE"));
  ui.table.appendChild(buildHeaderRow(st, deps, ui));
  st.content.appendChild(ui.table);
  refreshTable(st, deps, ui);
}
