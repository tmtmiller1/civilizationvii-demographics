// chart-settlement-boards.js
//
// Per-settlement boards grouped by leader/civilization: one civ-colored column
// per civ, each listing that civ's settlements with a count (Districts /
// Buildings). Buildings rows DRILL DOWN — click a settlement to expand the exact
// building types it holds. Live snapshot from the settlement data layer; identity
// is the civ-colored column accent, every value stays in ink (board-ui).

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { inlineLabel } from "/demographics/ui/core/player-label.js";
import { buildSettlementBoard } from "/demographics/ui/screen-demographics/settlements/settlements-data.js";
import * as U from "/demographics/ui/screen-demographics/charts/boards/board-ui.js";

/** @param {*} owner @returns {string} A stable civ key. */
function ownerKey(owner) {
  if (!owner) return "?";
  return owner.leaderType || ("pid:" + owner.pid);
}

/** @param {*} owner @returns {string} The civ label (honors the Civ/Leader order). */
function ownerLabel(owner) {
  if (!owner) return "—";
  return owner.leaderName ? inlineLabel(owner.leaderName, owner.civName) : owner.civName || t("LOC_DEMOGRAPHICS_BOARD_PLAYER_GENERIC");
}

/** @param {*} owner @returns {string} A readable civ color. */
function ownerColor(owner) {
  return U.readable((owner && (owner.readable || owner.primary)) || "#B0B0B0");
}

/**
 * A civ column of settlements.
 * @typedef {Object} CivColumn
 * @property {string} name Civ label. @property {string} color Readable civ color.
 * @property {{name:string, count:number, types:string[]|null}[]} items Settlements. @property {number} total Civ total.
 */

/**
 * Group all settlements by owner, tallying `field` and (optionally) capturing the
 * per-settlement type list from `typesField` for drill-down.
 * @param {*[]} settlements The world's settlements.
 * @param {string} field The count field. @param {string} [typesField] The type-list field.
 * @returns {CivColumn[]} Per-civ columns.
 */
function groupByCiv(settlements, field, typesField) {
  /** @type {Map<string, CivColumn>} */
  const groups = new Map();
  for (const s of settlements) {
    // City-states are excluded: this is a comparative civ-vs-civ board, so it
    // shows only major civilizations (matching Civ Ranking / Relations / Wars).
    if (s.owner && s.owner.isMajor === false) continue;
    const key = ownerKey(s.owner);
    let g = groups.get(key);
    if (!g) {
      g = { name: ownerLabel(s.owner), color: ownerColor(s.owner), items: [], total: 0 };
      groups.set(key, g);
    }
    const count = typeof s[field] === "number" ? s[field] : 0;
    const types = typesField && Array.isArray(s[typesField]) ? s[typesField] : null;
    g.items.push({ name: s.name, count, types });
    g.total += count;
  }
  return [...groups.values()];
}

/** @param {string[]} names @returns {[string, number][]} Distinct names → count, most first. */
function aggregate(names) {
  const m = new Map();
  for (const n of names) m.set(n, (m.get(n) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/**
 * One settlement row: "Name" + count. When `types` is present, the row is
 * clickable and toggles an indented list of the settlement's building types.
 * @param {{name:string, count:number, types:string[]|null}} item The settlement.
 * @returns {HTMLElement} The row (wrapper).
 */
function settlementRow(item) {
  const drill = Array.isArray(item.types) && item.types.length > 0;
  const wrap = U.box("border-bottom:1px solid rgba(0,0,0,0.18)");
  const row = U.box("display:flex;align-items:center;gap:8px;padding:6px 12px;" + (drill ? "cursor:pointer" : ""));
  // Drill-down settlements carry a leading "+" on the name so it's clear the card
  // opens to reveal that settlement's individual buildings.
  const nameBox = U.box("flex:1 1 auto;color:" + U.INK + ";font-size:0.9rem;white-space:nowrap;" +
    "overflow:hidden;text-overflow:ellipsis", item.name, "font-body");
  if (drill) nameBox.insertBefore(U.expandBadge(), nameBox.firstChild);
  row.appendChild(nameBox);
  row.appendChild(U.box("flex:0 0 auto;color:" + U.INK_MUTED + ";font-size:0.85rem", String(item.count), "font-body"));
  wrap.appendChild(row);
  if (drill) {
    const sub = U.box("display:none;padding:2px 12px 8px 24px");
    for (const [name, n] of aggregate(item.types || [])) {
      sub.appendChild(U.box("color:" + U.INK_DIM + ";font-size:0.82rem;padding:1px 0",
        n > 1 ? name + " ×" + n : name, "font-body"));
    }
    let open = false;
    row.addEventListener("click", () => { open = !open; sub.style.display = open ? "block" : "none"; });
    wrap.appendChild(sub);
  }
  return wrap;
}

/** @param {CivColumn} civ @returns {HTMLElement} A civ column (header + settlement rows). */
function civColumn(civ) {
  const col = U.box("flex:0 0 auto;min-width:12rem;max-width:20rem;display:flex;flex-direction:column;" +
    "border:1px solid " + U.BORDER + ";border-radius:6px;overflow:hidden;background:" + U.PANEL);
  col.appendChild(U.columnHeader(civ.name, civ.color, civ.total));
  civ.items.sort((a, b) => b.count - a.count);
  for (const it of civ.items) col.appendChild(settlementRow(it));
  return col;
}

/**
 * Render a per-settlement, per-civ board of a constructible count (Districts /
 * Buildings): one civ-colored column, its settlements listed with their counts
 * (settlements by count desc, civs by total desc). When `opts.typesField` is set,
 * each settlement row expands to show its building types.
 * @param {HTMLElement} host The chart host.
 * @param {{field:string, typesField?:string, empty?:string}} opts Render options.
 * @returns {void}
 */
export function renderConstructiblesBoard(host, opts) {
  host.innerHTML = "";
  const o = opts || {};
  const field = o.field || "districts";
  /** @type {*[]} */
  let settlements = [];
  try {
    const board = buildSettlementBoard();
    settlements = board && Array.isArray(board.settlements) ? board.settlements : [];
  } catch (_) {
    settlements = [];
  }
  const cols = groupByCiv(settlements, field, o.typesField).filter((c) => c.total > 0);
  if (!cols.length) return U.emptyState(host, t(o.empty || "LOC_DEMOGRAPHICS_BOARD_NO_SETTLEMENTS"));
  cols.sort((a, b) => b.total - a.total);
  const row = U.columnsRow(host, true);
  for (const c of cols) row.appendChild(civColumn(c));
}
