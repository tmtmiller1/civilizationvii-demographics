// chart-quarters-board.js
//
// The Quarters board: per leader/civilization, per settlement, the settlement's
// quarters (urban tiles): the buildings occupying each, the tile's yields
// (which already include adjacency; the engine exposes no isolated per-quarter
// adjacency total), Unique Quarters labeled by name, and a warning when a civ
// Unique Building is placed but not yet combined into its Unique Quarter.
// Live snapshot read from each settlement's city handle; every engine read is guarded.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { buildSettlementBoard } from "/demographics/ui/screen-demographics/settlements/settlements-data.js";
import { quarterAdjacency } from "/demographics/ui/screen-demographics/settlements/settlements-adjacency.js";
import * as board from "/demographics/ui/screen-demographics/charts/boards/board-ui.js";
import { liveCivDroppedByPolicy } from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";
import { orFallback } from "/demographics/ui/screen-demographics/screen/guarded-reads.js";

/** Engine globals via an any-cast (avoids ambient-declaration coupling for tsc). */
const engineApi = /** @type {*} */ (globalThis);

// Engine reads

/** @type {Set<string>|null} Cached BUILDING types tagged UNIQUE (civ unique buildings). */
let cachedUniqueTypes = null;

/** @returns {Set<string>} The set of civ Unique building types. */
function uniqueBuildingTypes() {
  if (cachedUniqueTypes) return cachedUniqueTypes;
  const set = new Set();
  // The table iteration stays inside orFallback(): a non-iterable table must not throw.
  orFallback(() => {
    for (const row of engineApi.GameInfo.TypeTags) if (row && row.Tag === "UNIQUE") set.add(row.Type);
  }, null);
  cachedUniqueTypes = set;
  return cachedUniqueTypes;
}

/**
 * @param {*} type
 * @returns {string} Localized constructible name.
 */
function constructibleName(type) {
  const info = orFallback(() => engineApi.GameInfo.Constructibles.lookup(type), null);
  if (!info) return String(type);
  return orFallback(() => engineApi.Locale.compose(info.Name), info.Name) || info.ConstructibleType || String(type);
}

/**
 * @param {*} type
 * @returns {string} The ConstructibleClass ("BUILDING" / …).
 */
function constructibleClass(type) {
  const info = orFallback(() => engineApi.GameInfo.Constructibles.lookup(type), null);
  return info ? info.ConstructibleClass : "";
}

/**
 * @param {*} location
 * @returns {string|null} The tile's Unique Quarter name, or null.
 */
function uniqueQuarterName(location) {
  const district = orFallback(() => engineApi.Districts.getAtLocation(location), null);
  const quarterType = district && district.uniqueQuarterType;
  const none = orFallback(() => engineApi.UniqueQuarterTypes.NO_QUARTER, undefined);
  if (quarterType == null || quarterType === none) return null;
  const info = orFallback(() => engineApi.GameInfo.UniqueQuarters.lookup(quarterType), null);
  return info ? orFallback(() => engineApi.Locale.compose(info.Name), info.Name) || null : null;
}

/**
 * @param {*} entry One raw yield entry: a [type, amount] pair or a {yieldType, amount} object.
 * @returns {{name:string, amount:number}|null} A named yield, or null.
 */
function parseYield(entry) {
  const type = Array.isArray(entry) ? entry[0] : entry && entry.yieldType;
  const amount = Array.isArray(entry) ? entry[1] : entry && entry.amount;
  if (typeof amount !== "number" || amount === 0) return null;
  const info = orFallback(() => engineApi.GameInfo.Yields.lookup(type), null);
  const name = info ? orFallback(() => engineApi.Locale.compose(info.Name), info.Name) : String(type);
  return { name, amount };
}

/**
 * @param {*} location
 * @param {number} pid
 * @returns {{name:string, amount:number}[]} Non-zero tile yields.
 */
function tileYields(location, pid) {
  const plotIndex = orFallback(() => engineApi.GameplayMap.getIndexFromLocation(location), null);
  const raw = plotIndex == null ? null : orFallback(() => engineApi.GameplayMap.getYields(plotIndex, pid), null);
  return Array.isArray(raw) ? /** @type {*[]} */ (raw.map(parseYield).filter(Boolean)) : [];
}

/**
 * @param {*} type
 * @returns {string} "Name — needs Partner" for a lone unique building.
 */
function orphanNote(type) {
  const name = constructibleName(type);
  // The table iteration stays inside orFallback(): a non-iterable table must not throw.
  const partner = orFallback(() => {
    for (const row of engineApi.GameInfo.UniqueQuarters) {
      if (row && row.BuildingType1 === type) return row.BuildingType2;
      if (row && row.BuildingType2 === type) return row.BuildingType1;
    }
    return null;
  }, null);
  if (partner == null) return name;
  return t("LOC_DEMOGRAPHICS_BOARD_ORPHAN_NEEDS", name, constructibleName(partner));
}

/**
 * Fold one constructible into the per-tile building groups.
 * @param {*} id A constructible component id.
 * @param {Map<string, *>} tiles tile-key → group.
 */
function foldConstructible(id, tiles) {
  const constructible = orFallback(() => engineApi.Constructibles.getByComponentID(id), null);
  if (!constructible || constructibleClass(constructible.type) !== "BUILDING" || !constructible.location) return;
  const key = constructible.location.x + "," + constructible.location.y;
  let tile = tiles.get(key);
  if (!tile) tiles.set(key, (tile = { location: constructible.location, buildings: [] }));
  tile.buildings.push({ type: constructible.type, name: constructibleName(constructible.type) });
}

/**
 * A settlement's quarters (building groups per tile) + any lone unique buildings.
 * @param {*} city The city handle.
 * @param {number} pid The owner id.
 * @returns {{quarters:*[], orphans:string[]}}
 */
function readCityQuarters(city, pid) {
  const ids = orFallback(() => city.Constructibles.getIds(), null);
  /** @type {Map<string, *>} */
  const tiles = new Map();
  if (Array.isArray(ids)) for (const id of ids) foldConstructible(id, tiles);
  const uniqueTypes = uniqueBuildingTypes();
  /** @type {*[]} */
  const quarters = [];
  /** @type {string[]} */
  const orphans = [];
  tiles.forEach((tile) => {
    const unique = uniqueQuarterName(tile.location);
    const buildingTypes = () => tile.buildings.map((/** @type {*} */ building) => building.type);
    quarters.push({
      unique,
      complete: tile.buildings.length >= 2,
      buildings: tile.buildings.map((/** @type {*} */ building) => building.name),
      yields: tileYields(tile.location, pid),
      adjacency: orFallback(() => quarterAdjacency(city, tile.location, buildingTypes()), [])
    });
    if (!unique) {
      for (const building of tile.buildings) {
        if (uniqueTypes.has(building.type)) orphans.push(orphanNote(building.type));
      }
    }
  });
  return { quarters, orphans };
}

// Rendering

/**
 * @param {{name:string, amount:number}[]} yields
 * @returns {string} A compact yield string.
 */
function yieldStr(yields) {
  return yields.map((entry) => "+" + Math.round(entry.amount) + " " + entry.name).join(" · ");
}

/**
 * @param {*} quarter
 * @returns {HTMLElement} The quarter detail row.
 */
function quarterRow(quarter) {
  const label = quarter.unique
    ? "★ " + quarter.unique
    : quarter.complete ? t("LOC_DEMOGRAPHICS_BOARD_QUARTER") : t("LOC_DEMOGRAPHICS_BOARD_DEVELOPING");
  const color = quarter.unique ? board.ACCENT : board.INK;
  const line = board.box("padding:0.167rem 0");
  line.appendChild(board.box("color:" + color + ";font-size:var(--dg-fs-85);font-weight:600", label, "font-body"));
  line.appendChild(board.box(
    "color:" + board.INK + ";font-size:var(--dg-fs-85)",
    quarter.buildings.join(" + ") || "—",
    "font-body"
  ));
  if (quarter.yields.length) {
    line.appendChild(board.box(
      "color:" + board.INK_MUTED + ";font-size:var(--dg-fs-78)",
      yieldStr(quarter.yields),
      "font-body"
    ));
  }
  if (quarter.adjacency && quarter.adjacency.length) {
    const adj = t("LOC_DEMOGRAPHICS_BOARD_ADJACENCY_EST", yieldStr(quarter.adjacency));
    line.appendChild(board.box("color:" + board.INK_DIM + ";font-size:var(--dg-fs-78)", adj, "font-body"));
  }
  return line;
}

/**
 * @param {*} settlement A settlement item {name, quarters, orphans, uniques}.
 * @returns {HTMLElement} The expandable row.
 */
function settlementRow(settlement) {
  const wrap = board.box("border-bottom:1px solid rgba(0,0,0,0.18)");
  const head = board.box("display:flex;align-items:center;gap:0.444rem;padding:0.333rem 0.667rem;cursor:pointer");
  // Leading "+" marks the row as click-to-expand (opens this settlement's quarters).
  const nameBox = board.box("flex:1 1 auto;color:" + board.INK + ";font-size:var(--dg-fs-85);white-space:nowrap;" +
    "overflow:hidden;text-overflow:ellipsis", settlement.name, "font-body");
  nameBox.insertBefore(board.expandBadge(), nameBox.firstChild);
  head.appendChild(nameBox);
  // Total quarter count (which already includes unique quarters, so it matches the
  // rows shown when the row is expanded), with a star when the settlement holds a
  // Unique Quarter: bare "5★" for a single unique, "5 · 2★" for multiple.
  const badge = settlement.uniques > 1
    ? settlement.quarters.length + " · " + settlement.uniques + "★"
    : settlement.uniques
      ? settlement.quarters.length + "★"
      : String(settlement.quarters.length);
  head.appendChild(board.box(
    "flex:0 0 auto;color:" + board.INK_MUTED + ";font-size:var(--dg-fs-85)",
    badge,
    "font-body"
  ));
  wrap.appendChild(head);
  const sub = board.box("display:none;padding:0.111rem 0.667rem 0.444rem 1.111rem");
  for (const quarter of settlement.quarters) sub.appendChild(quarterRow(quarter));
  for (const orphan of settlement.orphans) {
    // A half-built Unique Quarter: the gold ink and the "needs <partner>" wording mark it.
    sub.appendChild(board.box("color:" + board.ACCENT + ";font-size:var(--dg-fs-78);padding:0.111rem 0",
      t("LOC_DEMOGRAPHICS_BOARD_UNIQUE_WARN", orphan), "font-body"));
  }
  let open = false;
  head.addEventListener("click", () => {
    open = !open;
    sub.style.display = open ? "block" : "none";
  });
  wrap.appendChild(sub);
  return wrap;
}

/**
 * @param {*} civ
 * @returns {HTMLElement}
 */
function civColumn(civ) {
  const col = board.box("flex:0 0 auto;min-width:15rem;max-width:24rem;display:flex;flex-direction:column;" +
    "border:1px solid " + board.BORDER + ";border-radius:0.333rem;overflow:hidden;background:" + board.PANEL);
  col.appendChild(board.columnHeader(civ.name, civ.color, civ.total));
  civ.items.sort((/** @type {*} */ a, /** @type {*} */ b) => b.quarters.length - a.quarters.length);
  for (const settlement of civ.items) col.appendChild(settlementRow(settlement));
  return col;
}

/**
 * @param {*[]} settlements
 * @returns {*[]} Per-civ columns of settlements + quarter data.
 */
function groupByCiv(settlements) {
  const groups = new Map();
  for (const settlement of settlements) {
    if (!settlement || !settlement._city || (settlement.owner && settlement.owner.isMajor === false)) continue;
    const owner = settlement.owner;
    if (owner && liveCivDroppedByPolicy(owner.pid)) continue;
    const key = board.ownerKey(owner);
    let group = groups.get(key);
    if (!group) {
      group = { name: board.ownerLabel(owner), color: board.ownerColor(owner), items: [], total: 0 };
      groups.set(key, group);
    }
    const cityQuarters = readCityQuarters(settlement._city, owner && owner.pid);
    const uniques = cityQuarters.quarters.filter((quarter) => quarter.unique).length;
    group.items.push({
      name: settlement.name,
      quarters: cityQuarters.quarters,
      orphans: cityQuarters.orphans,
      uniques
    });
    group.total += cityQuarters.quarters.length;
  }
  return [...groups.values()];
}

/**
 * Render the Quarters board: per civ, its settlements, each expandable to its
 * quarters (buildings + yields), Unique Quarters flagged, lone unique buildings warned.
 * @param {HTMLElement} host
 * @param {*} _opts
 * @returns {void}
 */
export function renderQuartersBoard(host, _opts) {
  host.innerHTML = "";
  /** @type {*[]} */
  let settlements = [];
  try {
    const settlementBoard = buildSettlementBoard();
    settlements = settlementBoard && Array.isArray(settlementBoard.settlements) ? settlementBoard.settlements : [];
  } catch (_) {
    settlements = [];
  }
  const cols = groupByCiv(settlements).filter((col) => col.total > 0);
  if (!cols.length) return board.emptyState(host, t("LOC_DEMOGRAPHICS_BOARD_NO_QUARTERS"));
  cols.sort((a, b) => b.total - a.total);
  const row = board.columnsRow(host, true);
  for (const col of cols) row.appendChild(civColumn(col));
}
