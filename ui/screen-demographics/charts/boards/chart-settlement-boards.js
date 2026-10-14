// chart-settlement-boards.js
//
// Per-settlement boards grouped by leader/civilization: one civ-colored column
// per civ, each listing that civ's settlements with a count (Districts /
// Buildings). Buildings rows drill down: click a settlement to expand the exact
// building types it holds. Live snapshot from the settlement data layer; identity
// is the civ-colored column accent, every value stays in ink (board-ui).

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { buildSettlementBoard } from "/demographics/ui/screen-demographics/settlements/settlements-data.js";
import * as board from "/demographics/ui/screen-demographics/charts/boards/board-ui.js";
import { liveCivDroppedByPolicy } from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";

/**
 * A civ column of settlements.
 * @typedef {Object} CivColumn
 * @property {string} name Civ label.
 * @property {string} color Readable civ color.
 * @property {{name:string, count:number, types:string[]|null}[]} items Settlements.
 * @property {number} total Civ total.
 */

/**
 * Whether a settlement belongs on the board. City-states are excluded: this is a comparative
 * civ-vs-civ board, so it shows only major civilizations (matching Civ Ranking / Relations /
 * Wars). Civs the spoiler guard hides are excluded too.
 * @param {*} settlement
 * @returns {boolean}
 */
function onBoard(settlement) {
  if (!settlement) return false;
  const owner = settlement.owner;
  return !(owner && (owner.isMajor === false || liveCivDroppedByPolicy(owner.pid)));
}

/**
 * @param {*[]} settlements
 * @param {string} field The count field.
 * @param {string} [typesField] The type-list field.
 */
function groupByCiv(settlements, field, typesField) {
  /** @type {Map<string, CivColumn>} */
  const groups = new Map();
  for (const settlement of settlements) {
    if (!onBoard(settlement)) continue;
    const owner = settlement.owner;
    const key = board.ownerKey(owner);
    let group = groups.get(key);
    if (!group) {
      group = { name: board.ownerLabel(owner), color: board.ownerColor(owner), items: [], total: 0 };
      groups.set(key, group);
    }
    const count = typeof settlement[field] === "number" ? settlement[field] : 0;
    const types = typesField && Array.isArray(settlement[typesField]) ? settlement[typesField] : null;
    group.items.push({ name: settlement.name, count, types });
    group.total += count;
  }
  return [...groups.values()];
}

/**
 * @param {string[]} names
 * @returns {[string, number][]} Distinct names → count, most first.
 */
function aggregate(names) {
  const counts = new Map();
  for (const name of names) counts.set(name, (counts.get(name) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** @param {{name:string, count:number, types:string[]|null}} item */
function settlementRow(item) {
  const drill = Array.isArray(item.types) && item.types.length > 0;
  const wrap = board.box("border-bottom:1px solid rgba(0,0,0,0.18)");
  const row = board.box(
    "display:flex;align-items:center;gap:0.444rem;padding:0.333rem 0.667rem;" + (drill ? "cursor:pointer" : "")
  );
  // Drill-down settlements carry a leading "+" on the name so it's clear the card
  // opens to reveal that settlement's individual buildings.
  const nameBox = board.box("flex:1 1 auto;color:" + board.INK + ";font-size:var(--dg-fs-85);white-space:nowrap;" +
    "overflow:hidden;text-overflow:ellipsis", item.name, "font-body");
  if (drill) nameBox.insertBefore(board.expandBadge(), nameBox.firstChild);
  row.appendChild(nameBox);
  row.appendChild(board.box(
    "flex:0 0 auto;color:" + board.INK_MUTED + ";font-size:var(--dg-fs-85)",
    String(item.count),
    "font-body"
  ));
  wrap.appendChild(row);
  if (drill) {
    const sub = board.box("display:none;padding:0.111rem 0.667rem 0.444rem 1.333rem");
    for (const [name, count] of aggregate(item.types || [])) {
      sub.appendChild(board.box("color:" + board.INK_DIM + ";font-size:var(--dg-fs-85);padding:0.056rem 0",
        count > 1 ? name + " ×" + count : name, "font-body"));
    }
    let open = false;
    row.addEventListener("click", () => {
      open = !open;
      sub.style.display = open ? "block" : "none";
    });
    wrap.appendChild(sub);
  }
  return wrap;
}

/**
 * @param {CivColumn} civ
 * @returns {HTMLElement} A civ column (header + settlement rows).
 */
function civColumn(civ) {
  const col = board.box("flex:0 0 auto;min-width:12rem;max-width:20rem;display:flex;flex-direction:column;" +
    "border:1px solid " + board.BORDER + ";border-radius:0.333rem;overflow:hidden;background:" + board.PANEL);
  col.appendChild(board.columnHeader(civ.name, civ.color, civ.total));
  civ.items.sort((a, b) => b.count - a.count);
  for (const item of civ.items) col.appendChild(settlementRow(item));
  return col;
}

/**
 * Render a per-settlement, per-civ board of a constructible count (Districts /
 * Buildings): one civ-colored column, its settlements listed with their counts
 * (settlements by count desc, civs by total desc). When `opts.typesField` is set,
 * each settlement row expands to show its building types.
 * @param {HTMLElement} host
 * @param {{field:string, typesField?:string, empty?:string}} opts
 * @returns {void}
 */
export function renderConstructiblesBoard(host, opts) {
  host.innerHTML = "";
  const settings = opts || {};
  const field = settings.field || "districts";
  /** @type {*[]} */
  let settlements = [];
  try {
    const settlementBoard = buildSettlementBoard();
    settlements = settlementBoard && Array.isArray(settlementBoard.settlements) ? settlementBoard.settlements : [];
  } catch (_) {
    settlements = [];
  }
  const cols = groupByCiv(settlements, field, settings.typesField).filter((col) => col.total > 0);
  if (!cols.length) return board.emptyState(host, t(settings.empty || "LOC_DEMOGRAPHICS_BOARD_NO_SETTLEMENTS"));
  cols.sort((a, b) => b.total - a.total);
  const row = board.columnsRow(host, true);
  for (const col of cols) row.appendChild(civColumn(col));
}
