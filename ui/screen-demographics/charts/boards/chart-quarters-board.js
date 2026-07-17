// chart-quarters-board.js
//
// The Quarters board: per leader/civilization, per settlement, the settlement's
// QUARTERS (urban tiles) — the buildings occupying each, the tile's yields
// (which already include adjacency; the engine exposes no isolated per-quarter
// adjacency total), Unique Quarters labeled by name, and a warning when a civ
// Unique Building is placed but NOT yet combined into its Unique Quarter.
// Live snapshot read from each settlement's city handle. Defensive throughout.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { inlineLabel } from "/demographics/ui/core/player-label.js";
import { buildSettlementBoard } from "/demographics/ui/screen-demographics/settlements/settlements-data.js";
import { quarterAdjacency } from "/demographics/ui/screen-demographics/settlements/settlements-adjacency.js";
import * as U from "/demographics/ui/screen-demographics/charts/boards/board-ui.js";

/** Engine globals via an any-cast (avoids ambient-declaration coupling for tsc). */
const G = /** @type {*} */ (globalThis);

/** @param {()=>*} fn @param {*} [fb] @returns {*} fn() or fb on throw. */
function safe(fn, fb) {
  try {
    return fn();
  } catch (_) {
    return fb;
  }
}

// ── Engine reads ─────────────────────────────────────────────────────────────

/** @type {Set<string>|null} Cached BUILDING types tagged UNIQUE (civ unique buildings). */
let _uniqueSet = null;

/** @returns {Set<string>} The set of civ Unique building types. */
function uniqueBuildingTypes() {
  if (_uniqueSet) return _uniqueSet;
  _uniqueSet = new Set();
  const tags = safe(() => G.GameInfo.TypeTags, null);
  if (tags) for (const row of tags) if (row && row.Tag === "UNIQUE") _uniqueSet.add(row.Type);
  return _uniqueSet;
}

/** @param {*} type @returns {string} Localized constructible name. */
function constructibleName(type) {
  const info = safe(() => G.GameInfo.Constructibles.lookup(type), null);
  if (!info) return String(type);
  return safe(() => G.Locale.compose(info.Name), info.Name) || info.ConstructibleType || String(type);
}

/** @param {*} type @returns {string} The ConstructibleClass ("BUILDING" / …). */
function constructibleClass(type) {
  const info = safe(() => G.GameInfo.Constructibles.lookup(type), null);
  return info ? info.ConstructibleClass : "";
}

/** @param {*} location @returns {string|null} The tile's Unique Quarter name, or null. */
function uniqueQuarterName(location) {
  const d = safe(() => G.Districts.getAtLocation(location), null);
  const uq = d && d.uniqueQuarterType;
  const none = safe(() => G.UniqueQuarterTypes.NO_QUARTER, undefined);
  if (uq == null || uq === none) return null;
  const info = safe(() => G.GameInfo.UniqueQuarters.lookup(uq), null);
  return info ? safe(() => G.Locale.compose(info.Name), info.Name) || null : null;
}

/** @param {*} y One raw yield entry. @returns {{name:string, amount:number}|null} A named yield, or null. */
function parseYield(y) {
  const type = Array.isArray(y) ? y[0] : y && y.yieldType;
  const amt = Array.isArray(y) ? y[1] : y && y.amount;
  if (typeof amt !== "number" || amt === 0) return null;
  const info = safe(() => G.GameInfo.Yields.lookup(type), null);
  return { name: info ? safe(() => G.Locale.compose(info.Name), info.Name) : String(type), amount: amt };
}

/** @param {*} location @param {number} pid @returns {{name:string, amount:number}[]} Non-zero tile yields. */
function tileYields(location, pid) {
  const idx = safe(() => G.GameplayMap.getIndexFromLocation(location), null);
  const raw = idx == null ? null : safe(() => G.GameplayMap.getYields(idx, pid), null);
  return Array.isArray(raw) ? /** @type {*[]} */ (raw.map(parseYield).filter(Boolean)) : [];
}

/** @param {*} type @returns {string} "Name — needs Partner" for a lone unique building. */
function orphanNote(type) {
  const name = constructibleName(type);
  const rows = safe(() => G.GameInfo.UniqueQuarters, null);
  if (rows) {
    for (const r of rows) {
      if (r.BuildingType1 === type) return t("LOC_DEMOGRAPHICS_BOARD_ORPHAN_NEEDS", name, constructibleName(r.BuildingType2));
      if (r.BuildingType2 === type) return t("LOC_DEMOGRAPHICS_BOARD_ORPHAN_NEEDS", name, constructibleName(r.BuildingType1));
    }
  }
  return name;
}

/**
 * Fold one constructible into the per-tile building groups.
 * @param {*} id A constructible component id. @param {Map<string, *>} tiles tile-key → group.
 */
function foldConstructible(id, tiles) {
  const c = safe(() => G.Constructibles.getByComponentID(id), null);
  if (!c || constructibleClass(c.type) !== "BUILDING" || !c.location) return;
  const key = c.location.x + "," + c.location.y;
  let t = tiles.get(key);
  if (!t) tiles.set(key, (t = { location: c.location, buildings: [] }));
  t.buildings.push({ type: c.type, name: constructibleName(c.type) });
}

/**
 * A settlement's quarters (building groups per tile) + any lone unique buildings.
 * @param {*} city The city handle. @param {number} pid The owner id.
 * @returns {{quarters:*[], orphans:string[]}} The quarter data.
 */
function readCityQuarters(city, pid) {
  const ids = safe(() => city.Constructibles.getIds(), null);
  /** @type {Map<string, *>} */
  const tiles = new Map();
  if (Array.isArray(ids)) for (const id of ids) foldConstructible(id, tiles);
  const uq = uniqueBuildingTypes();
  /** @type {*[]} */
  const quarters = [];
  /** @type {string[]} */
  const orphans = [];
  tiles.forEach((t) => {
    const unique = uniqueQuarterName(t.location);
    quarters.push({
      unique, complete: t.buildings.length >= 2,
      buildings: t.buildings.map((/** @type {*} */ b) => b.name),
      yields: tileYields(t.location, pid),
      adjacency: safe(() => quarterAdjacency(city, t.location, t.buildings.map((/** @type {*} */ b) => b.type)), [])
    });
    if (!unique) for (const b of t.buildings) if (uq.has(b.type)) orphans.push(orphanNote(b.type));
  });
  return { quarters, orphans };
}

// ── Rendering ────────────────────────────────────────────────────────────────

/** @param {*} owner @returns {string} A stable civ key. */
function ownerKey(owner) {
  return (owner && (owner.leaderType || "pid:" + owner.pid)) || "?";
}

/** @param {*} owner @returns {string} The civ label. */
function ownerLabel(owner) {
  if (!owner) return "—";
  return owner.leaderName ? inlineLabel(owner.leaderName, owner.civName) : owner.civName || t("LOC_DEMOGRAPHICS_BOARD_PLAYER_GENERIC");
}

/** @param {*} owner @returns {string} A readable civ color. */
function ownerColor(owner) {
  return U.readable((owner && (owner.readable || owner.primary)) || "#B0B0B0");
}

/** @param {{name:string, amount:number}[]} yields @returns {string} A compact yield string. */
function yieldStr(yields) {
  return yields.map((y) => "+" + Math.round(y.amount) + " " + y.name).join(" · ");
}

/** @param {*} q A quarter. @returns {HTMLElement} The quarter detail row. */
function quarterRow(q) {
  const label = q.unique ? "★ " + q.unique : q.complete ? t("LOC_DEMOGRAPHICS_BOARD_QUARTER") : t("LOC_DEMOGRAPHICS_BOARD_DEVELOPING");
  const color = q.unique ? U.ACCENT : U.INK;
  const line = U.box("padding:3px 0");
  line.appendChild(U.box("color:" + color + ";font-size:0.85rem;font-weight:600", label, "font-body"));
  line.appendChild(U.box("color:" + U.INK + ";font-size:0.82rem", q.buildings.join(" + ") || "—", "font-body"));
  if (q.yields.length) {
    line.appendChild(U.box("color:" + U.INK_MUTED + ";font-size:0.78rem", yieldStr(q.yields), "font-body"));
  }
  if (q.adjacency && q.adjacency.length) {
    const adj = t("LOC_DEMOGRAPHICS_BOARD_ADJACENCY_EST", yieldStr(q.adjacency));
    line.appendChild(U.box("color:" + U.INK_DIM + ";font-size:0.76rem;font-style:italic", adj, "font-body"));
  }
  return line;
}

/** @param {*} s A settlement item {name, quarters, orphans, uniques}. @returns {HTMLElement} The expandable row. */
function settlementRow(s) {
  const wrap = U.box("border-bottom:1px solid rgba(0,0,0,0.18)");
  const head = U.box("display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer");
  // Leading "+" marks the row as click-to-expand (opens this settlement's quarters).
  const nameBox = U.box("flex:1 1 auto;color:" + U.INK + ";font-size:0.9rem;white-space:nowrap;" +
    "overflow:hidden;text-overflow:ellipsis", s.name, "font-body");
  nameBox.insertBefore(U.expandBadge(), nameBox.firstChild);
  head.appendChild(nameBox);
  // Total quarter count (which already includes unique quarters, so it matches the
  // rows shown when the row is expanded), with a star when the settlement holds a
  // Unique Quarter: bare "5★" for a single unique, "5 · 2★" for multiple.
  const badge = s.uniques > 1
    ? s.quarters.length + " · " + s.uniques + "★"
    : s.uniques
      ? s.quarters.length + "★"
      : String(s.quarters.length);
  head.appendChild(U.box("flex:0 0 auto;color:" + U.INK_MUTED + ";font-size:0.85rem", badge, "font-body"));
  wrap.appendChild(head);
  const sub = U.box("display:none;padding:2px 12px 8px 20px");
  for (const q of s.quarters) sub.appendChild(quarterRow(q));
  for (const o of s.orphans) {
    sub.appendChild(U.box("color:" + U.ACCENT + ";font-size:0.8rem;padding:2px 0", "⚠ " + t("LOC_DEMOGRAPHICS_BOARD_UNIQUE_WARN", o), "font-body"));
  }
  let open = false;
  head.addEventListener("click", () => { open = !open; sub.style.display = open ? "block" : "none"; });
  wrap.appendChild(sub);
  return wrap;
}

/** @param {*} civ A civ column. @returns {HTMLElement} The column. */
function civColumn(civ) {
  const col = U.box("flex:0 0 auto;min-width:15rem;max-width:24rem;display:flex;flex-direction:column;" +
    "border:1px solid " + U.BORDER + ";border-radius:6px;overflow:hidden;background:" + U.PANEL);
  col.appendChild(U.columnHeader(civ.name, civ.color, civ.total));
  civ.items.sort((/** @type {*} */ a, /** @type {*} */ b) => b.quarters.length - a.quarters.length);
  for (const s of civ.items) col.appendChild(settlementRow(s));
  return col;
}

/** @param {*[]} settlements @returns {*[]} Per-civ columns of settlements + quarter data. */
function groupByCiv(settlements) {
  const groups = new Map();
  for (const s of settlements) {
    if (!s._city || (s.owner && s.owner.isMajor === false)) continue;
    const key = ownerKey(s.owner);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { name: ownerLabel(s.owner), color: ownerColor(s.owner), items: [], total: 0 }));
    const q = readCityQuarters(s._city, s.owner && s.owner.pid);
    const uniques = q.quarters.filter((x) => x.unique).length;
    g.items.push({ name: s.name, quarters: q.quarters, orphans: q.orphans, uniques });
    g.total += q.quarters.length;
  }
  return [...groups.values()];
}

/**
 * Render the Quarters board: per civ, its settlements, each expandable to its
 * quarters (buildings + yields), Unique Quarters flagged, lone unique buildings warned.
 * @param {HTMLElement} host The chart host. @param {*} _opts Unused.
 * @returns {void}
 */
export function renderQuartersBoard(host, _opts) {
  host.innerHTML = "";
  /** @type {*[]} */
  let settlements = [];
  try {
    const b = buildSettlementBoard();
    settlements = b && Array.isArray(b.settlements) ? b.settlements : [];
  } catch (_) {
    settlements = [];
  }
  const cols = groupByCiv(settlements).filter((c) => c.total > 0);
  if (!cols.length) return U.emptyState(host, t("LOC_DEMOGRAPHICS_BOARD_NO_QUARTERS"));
  cols.sort((a, b) => b.total - a.total);
  const row = U.columnsRow(host, true);
  for (const c of cols) row.appendChild(civColumn(c));
}
