// view-settlements-table.js
//
// Table and leaders rendering for the Settlements view.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { div, fmt, iconEl } from "/demographics/ui/core/ui-helpers.js";
import {
  SETTLEMENT_OUTPUTS,
  valueOf
} from "/demographics/ui/screen-demographics/settlements/settlements-data.js";

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
 * Build one category leader card.
 * @param {{ id: string, icon: string, label: string }} col The output column.
 * @param {*} L The display leader settlement.
 * @returns {HTMLElement} The leader card.
 */
function buildLeaderCard(col, L) {
  const card = div("demographics-settle-leader-card");
  const head = div("demographics-settle-leader-head");
  head.appendChild(iconEl(col.icon, "demographics-settle-leader-icon"));
  head.appendChild(
    div(
      "demographics-settle-leader-cat",
      t("LOC_DEMOGRAPHICS_SETTLEMENTS_BEST_IN", t(col.label))
    )
  );
  card.appendChild(head);
  card.appendChild(div("demographics-settle-leader-name", L.name));
  card.appendChild(
    div(
      "demographics-settle-leader-val",
      fmt(valueOf(L, col.id)) + " · " + (L.owner.leaderName || "")
    )
  );
  return card;
}

/**
 * The category leader (highest value in `colId`) within a settlement pool.
 * @param {*[]} pool The settlements to rank.
 * @param {string} colId The output/category id.
 * @returns {*} The leading settlement, or null when the pool is empty.
 */
function leaderFor(pool, colId) {
  let best = null;
  let bestVal = -Infinity;
  for (const s of pool) {
    const v = valueOf(s, colId);
    if (typeof v === "number" && v > bestVal) {
      bestVal = v;
      best = s;
    }
  }
  return best;
}

/**
 * Build the category leaders strip. Leaders are computed over the SAME
 * All/Cities/Towns filter the table below uses, so "best Food" reflects only
 * the rows currently shown.
 * @param {*} st The render state.
 * @param {TableDeps} deps Rendering dependencies.
 * @returns {HTMLElement} The strip element.
 */
function buildLeadersStrip(st, deps) {
  const strip = div("demographics-settle-leaders");
  const filter = FILTERS.find((f) => f.id === st.filter) || FILTERS[0];
  const pool = st.board.settlements.filter(filter.test);
  for (const col of SETTLEMENT_OUTPUTS) {
    const leader = leaderFor(pool, col.id);
    if (!leader) continue;
    strip.appendChild(buildLeaderCard(col, deps.displayOf(st, leader)));
  }
  return strip;
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
      deps.setSetting(st.settings, "settlementsFilter", f.id);
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
 * Build one settlement data row for the table.
 * @param {*} s The settlement.
 * @param {number} rank The 1-based rank within the current sort.
 * @param {string} sortKey The active sort key.
 * @param {TableDeps} deps Rendering dependencies.
 * @returns {HTMLElement} The row.
 */
function buildTableRow(s, rank, sortKey, deps) {
  const row = div("demographics-settle-row demographics-settle-datarow");
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
  for (const col of SETTLEMENT_OUTPUTS) {
    row.appendChild(
      div(
        "demographics-settle-td demographics-settle-col-" +
          col.id +
          (sortKey === col.id ? " is-sorted" : ""),
        fmt(s.outputs[col.id])
      )
    );
  }
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
  st.content.appendChild(deps.buildSectionTitle("LOC_DEMOGRAPHICS_SETTLEMENTS_LEADERS_TITLE"));
  st.content.appendChild(buildLeadersStrip(st, deps));
  st.content.appendChild(deps.buildSectionTitle("LOC_DEMOGRAPHICS_SETTLEMENTS_TABLE_TITLE"));
  const filter = FILTERS.find((f) => f.id === st.filter) || FILTERS[0];
  const rows = st.board.settlements
    .filter(filter.test)
    .slice()
    .sort(
      (/** @type {*} */ a, /** @type {*} */ b) =>
        valueOf(b, st.sortKey) - valueOf(a, st.sortKey)
    )
    .slice(0, deps.topN);
  const table = div("demographics-settle-table");
  table.appendChild(buildHeaderRow(st, deps));
  for (let i = 0; i < rows.length; i++) {
    table.appendChild(buildTableRow(deps.displayOf(st, rows[i]), i + 1, st.sortKey, deps));
  }
  st.content.appendChild(table);
}
