// chart-boards.js
//
// Plain-DOM board/bar renderers for synthetic Historical-Data metrics: the
// Wonders board + Wonder Races, the by-type breakdowns (as per-civ bar charts),
// Religion standings (bars), and the Settlements Atlas (size histogram + a
// size-shrunk Most-Urbanized ranking). All styling comes from board-ui so
// identity is a colored swatch/accent/bar-fill and every value stays in ink.

import { t, tPlayerFallback } from "/demographics/ui/core/demographics-i18n.js";
import { inlineLabel } from "/demographics/ui/core/player-label.js";
import { byTypeCounts } from "/demographics/ui/sampler/sampler-game-summary.js";
import { buildSettlementBoard } from "/demographics/ui/screen-demographics/settlements/settlements-data.js";
import * as U from "/demographics/ui/screen-demographics/charts/boards/board-ui.js";
import {
  YIELD_CATEGORIES,
  emptyYields,
  effectText,
  estimateYields
} from "/demographics/ui/screen-demographics/charts/boards/pantheon-effects.js";

/**
 * The players map of the most recent sample, or {} when history is empty.
 * @param {*} history The persisted history blob.
 * @returns {Record<string, any>} The latest players map.
 */
function latestPlayers(history) {
  try {
    const samples = history && Array.isArray(history.samples) ? history.samples : [];
    const last = samples[samples.length - 1];
    return last && last.players ? last.players : {};
  } catch (_) {
    return {};
  }
}

/**
 * A civ's display label (honors the Civ/Leader order).
 * @param {*} ps A sample player. @param {string} pid The player id key.
 * @returns {string} The label.
 */
function civLabel(ps, pid) {
  if (!ps) return tPlayerFallback(pid);
  return ps.leaderName ? inlineLabel(ps.leaderName, ps.civName) : ps.civName || tPlayerFallback(pid);
}

/** @param {string} type @returns {string} "Type Like This" from TYPE_LIKE_THIS. */
function prettifyType(type) {
  return String(type).replace(/^[A-Z]+_/, "").toLowerCase().replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Resolve a type id to a localized name via GameInfo, else prettify.
 * @param {string} table The GameInfo table. @param {string} type The type id.
 * @returns {string} The display name.
 */
function resolveTypeName(table, type) {
  try {
    const def = typeof GameInfo !== "undefined" && GameInfo[table] && GameInfo[table].lookup(type);
    if (def && def.Name && typeof Locale !== "undefined") {
      const name = Locale.compose(def.Name);
      if (name && name.trim()) return name;
    }
  } catch (_) {
    /* prettify */
  }
  return prettifyType(type);
}

// ── Wonders board + races ──────────────────────────────────────────────────

/**
 * Fold one player's wonderTypes into the first-seen-turn accumulator.
 * @param {*} ps A sample player. @param {number} turn The chart turn.
 * @param {Map<string, Map<string, number>>} out pid → (type → turn).
 * @param {string} pid The player id key.
 */
function foldWonderPlayer(ps, turn, out, pid) {
  const types = ps && Array.isArray(ps.wonderTypes) ? ps.wonderTypes : null;
  if (!types) return;
  let m = out.get(pid);
  if (!m) {
    m = new Map();
    out.set(pid, m);
  }
  for (const tp of types) if (!m.has(tp)) m.set(tp, turn);
}

/**
 * For each civ, the chart-turn each wonder type first appeared.
 * @param {*} history The persisted history blob.
 * @returns {Map<string, Map<string, number>>} pid → (type → first chartTurn).
 */
function wonderFirstTurns(history) {
  const out = new Map();
  const samples = history && Array.isArray(history.samples) ? history.samples : [];
  for (const s of samples) foldSample(s, out);
  return out;
}

/** @param {*} s A sample. @param {Map<string, Map<string, number>>} out The accumulator. */
function foldSample(s, out) {
  const players = s && s.players;
  const turn = s && s.chartTurn;
  if (!players) return;
  for (const pid in players) foldWonderPlayer(players[pid], turn, out, pid);
}

/**
 * Wonder labels for one civ, in completion order, annotated with the turn.
 * @param {string[]} types Wonder ConstructibleType ids.
 * @param {Map<string, number>} [turns] type → first chart-turn.
 * @returns {string[]} The ordered labels.
 */
function wonderLabels(types, turns) {
  const items = types.map((tp) => ({
    name: resolveTypeName("Constructibles", tp),
    turn: turns ? turns.get(tp) : undefined
  }));
  items.sort((a, b) => (a.turn == null ? 1e9 : a.turn) - (b.turn == null ? 1e9 : b.turn));
  return items.map((it) => (it.turn != null ? it.name + " · " + t("LOC_DEMOGRAPHICS_WONDER_TURN", it.turn) : it.name));
}

/**
 * Render the Wonders board: one civ-colored column per civ, wonders in
 * completion order with their turn.
 * @param {HTMLElement} host The chart host. @param {{history:*}} opts Options.
 */
export function renderWondersBoard(host, opts) {
  host.innerHTML = "";
  const history = opts && opts.history;
  const players = latestPlayers(history);
  const firstTurns = wonderFirstTurns(history);
  const cols = [];
  for (const pid in players) {
    const ps = players[pid];
    const types = ps && Array.isArray(ps.wonderTypes) ? ps.wonderTypes : [];
    if (!types.length) continue;
    cols.push({ name: civLabel(ps, pid), color: U.civColor(ps), items: wonderLabels(types, firstTurns.get(pid)) });
  }
  cols.sort((a, b) => b.items.length - a.items.length);
  if (!cols.length) return U.emptyState(host, t("LOC_DEMOGRAPHICS_BOARD_NO_WONDERS"));
  const row = U.columnsRow(host);
  for (const c of cols) row.appendChild(U.boardColumn(c.name, c.color, c.items.length, c.items));
}

/**
 * Pivot the per-civ first-turns into the earliest builder of each wonder.
 * @param {Map<string, Map<string, number>>} firstTurns pid → (type → turn).
 * @returns {Map<string, {pid:string, turn:number}>} type → winner.
 */
function wonderWinners(firstTurns) {
  const winners = new Map();
  for (const [pid, m] of firstTurns) {
    for (const [type, turn] of m) {
      const cur = winners.get(type);
      if (!cur || (turn != null && (cur.turn == null || turn < cur.turn))) winners.set(type, { pid, turn });
    }
  }
  return winners;
}

/** @param {{name:string, civ:string, color:string, turn:number|undefined}} r @returns {HTMLElement} */
function wonderRaceRow(r) {
  const line = U.box("display:flex;align-items:center;gap:10px;min-height:22px");
  line.setAttribute("data-tooltip-content", r.name + " — " + r.civ);
  line.appendChild(U.box("flex:0 0 14rem;color:" + U.INK + ";font-size:0.92rem;text-align:right;" +
    "white-space:nowrap;overflow:hidden;text-overflow:ellipsis", r.name, "font-body"));
  const who = U.box("flex:1 1 auto;display:flex;align-items:center;gap:7px;min-width:0");
  who.appendChild(U.swatch(r.color, 11));
  who.appendChild(U.box("color:" + U.INK + ";font-size:0.9rem;white-space:nowrap;overflow:hidden;" +
    "text-overflow:ellipsis", r.civ, "font-body"));
  line.appendChild(who);
  line.appendChild(U.box("flex:0 0 5rem;color:" + U.INK_MUTED + ";font-size:0.88rem",
    r.turn != null ? t("LOC_DEMOGRAPHICS_WONDER_TURN", r.turn) : "—", "font-body"));
  return line;
}

/**
 * Render Wonder Races: one row per wonder — who built it first, and when.
 * @param {HTMLElement} host The chart host. @param {{history:*}} opts Options.
 */
export function renderWonderRaces(host, opts) {
  host.innerHTML = "";
  const players = latestPlayers(opts && opts.history);
  const completed = completedWonderRows(opts && opts.history, players);
  const building = inProgressWonderRows();
  if (!completed.length && !building.length) {
    return U.emptyState(host, t("LOC_DEMOGRAPHICS_BOARD_NO_WONDERS_OR_BUILDING"));
  }
  appendWonderSection(host, t("LOC_DEMOGRAPHICS_BOARD_SECTION_UNDER_CONSTRUCTION"), building, wonderProgressRow);
  appendWonderSection(host, t("LOC_DEMOGRAPHICS_BOARD_SECTION_COMPLETED"), completed, wonderRaceRow);
}

/**
 * Completed-wonder rows (first builder + turn), earliest first.
 * @param {*} history @param {Record<string, any>} players @returns {*[]} The rows.
 */
function completedWonderRows(history, players) {
  const rows = [];
  for (const [type, w] of wonderWinners(wonderFirstTurns(history))) {
    const ps = players[w.pid];
    rows.push({
      name: resolveTypeName("Constructibles", type), civ: civLabel(ps, w.pid),
      color: U.civColor(ps), turn: w.turn
    });
  }
  rows.sort((a, b) => (a.turn == null ? 1e9 : a.turn) - (b.turn == null ? 1e9 : b.turn));
  return rows;
}

/**
 * Live wonders currently under construction (who's building each + how close),
 * closest to done first. Reads each settlement's BuildQueue via the data layer.
 * @returns {{name:string, civ:string, settlement:string, color:string, percent:number|null, turnsLeft:number|null}[]}
 */
function inProgressWonderRows() {
  /** @type {*[]} */
  let settlements = [];
  try {
    const b = buildSettlementBoard();
    settlements = b && Array.isArray(b.settlements) ? b.settlements : [];
  } catch (_) {
    settlements = [];
  }
  const rows = /** @type {*[]} */ (settlements.map(inProgressWonderRow).filter(Boolean));
  rows.sort((a, b) => (b.percent == null ? -1 : b.percent) - (a.percent == null ? -1 : a.percent));
  return rows;
}

/** @param {*} s A settlement. @returns {*|null} Its in-progress-wonder row, or null. */
function inProgressWonderRow(s) {
  const w = s.wonderInProgress;
  if (!w) return null;
  const o = s.owner || {};
  const civ = o.leaderName ? inlineLabel(o.leaderName, o.civName) : o.civName || "—";
  return {
    name: w.name, civ, settlement: s.name,
    color: U.readable((o.readable || o.primary) || "#B0B0B0"),
    percent: w.percent, turnsLeft: w.turnsLeft
  };
}

/** @param {HTMLElement} host @param {string} title @param {*[]} rows @param {(r:*)=>HTMLElement} rowFn */
function appendWonderSection(host, title, rows, rowFn) {
  if (!rows.length) return;
  host.appendChild(U.sectionTitle(title));
  const wrap = U.stack();
  for (const r of rows) wrap.appendChild(rowFn(r));
  host.appendChild(wrap);
}

/**
 * One in-progress wonder row: a progress bar (how close) with the wonder name,
 * the building civ + settlement, and turns-left.
 * @param {{name:string, civ:string, settlement:string, color:string, percent:number|null, turnsLeft:number|null}} r
 * @returns {HTMLElement} The bar row.
 */
function wonderProgressRow(r) {
  const pct = r.percent != null ? r.percent + "%" : "—";
  const turns = r.turnsLeft != null ? " · " + t("LOC_DEMOGRAPHICS_BOARD_TURNS_LEFT", r.turnsLeft) : "";
  return U.barRow({
    label: r.name, value: r.percent || 0, max: 100, color: r.color,
    right: pct + turns + " · " + r.civ, labelWidth: "13rem"
  });
}

// ── By-type breakdowns (per-civ bar charts) ────────────────────────────────

/** @param {{name:string, color:string, total:number, items:{name:string, n:number}[]}} c @returns {HTMLElement} */
function byTypeColumn(c) {
  const col = U.box(
    "flex:0 0 auto;min-width:14rem;max-width:19rem;display:flex;flex-direction:column;" +
      "border:1px solid " + U.BORDER + ";border-radius:6px;overflow:hidden;background:" + U.PANEL
  );
  col.appendChild(U.columnHeader(c.name, c.color, c.total));
  const max = Math.max(1, ...c.items.map((i) => i.n));
  const body = U.box("display:flex;flex-direction:column;gap:5px;padding:8px 10px");
  for (const it of c.items) {
    body.appendChild(U.barRow({ label: it.name, value: it.n, max, color: c.color, right: String(it.n), labelWidth: "7rem" }));
  }
  col.appendChild(body);
  return col;
}

/**
 * Reduce one civ's by-type map to sorted {name, n} items + a total.
 * @param {Map<string, number>} byType type → count.
 * @param {string} lookup The GameInfo table for name resolution.
 * @returns {{total:number, items:{name:string, n:number}[]}} The items + total.
 */
function byTypeItems(byType, lookup) {
  let total = 0;
  const items = [];
  for (const [type, n] of byType) {
    total += n;
    items.push({ name: resolveTypeName(lookup, type), n });
  }
  items.sort((a, b) => b.n - a.n);
  return { total, items };
}

/**
 * Render a by-type breakdown: one civ-colored column per civ, a bar per type.
 * @param {HTMLElement} host The chart host.
 * @param {{history:*, datapointId:string, lookup:string}} opts Options.
 */
export function renderByTypeBoard(host, opts) {
  host.innerHTML = "";
  const players = latestPlayers(opts && opts.history);
  const counts = byTypeCounts((opts && opts.datapointId) || "");
  const lookup = (opts && opts.lookup) || "Units";
  const cols = [];
  for (const [pid, byType] of counts) {
    const { total, items } = byTypeItems(byType, lookup);
    if (!items.length) continue;
    cols.push({ name: civLabel(players[pid], String(pid)), color: U.civColor(players[pid]), total, items });
  }
  cols.sort((a, b) => b.total - a.total);
  if (!cols.length) return U.emptyState(host, t("LOC_DEMOGRAPHICS_BOARD_NO_BREAKDOWN"));
  const row = U.columnsRow(host);
  for (const c of cols) row.appendChild(byTypeColumn(c));
}

// ── Religion standings (bars) ──────────────────────────────────────────────

/**
 * Build the religion → row map from GameInfo.Religions.
 * @returns {Map<*, *>} hash → {name, color, settlements:0, pop:0}.
 */
function buildReligionMeta() {
  const meta = new Map();
  if (typeof GameInfo === "undefined" || !GameInfo.Religions || typeof Locale === "undefined") return meta;
  for (const r of GameInfo.Religions) {
    if (!r || r.$hash == null) continue;
    const name = r.Name ? Locale.compose(r.Name) : prettifyType(r.ReligionType);
    meta.set(r.$hash, { name, color: r.Color || "#B0B0B0", settlements: 0, pop: 0 });
  }
  return meta;
}

/** @param {*} c A city. @param {Map<*, *>} meta The religion map (mutated). */
function tallyCity(c, meta) {
  try {
    const rel = c && c.Religion && c.Religion.majorityReligion;
    const m = rel != null && rel !== -1 ? meta.get(rel) : null;
    if (!m) return;
    m.settlements += 1;
    if (typeof c.population === "number") m.pop += c.population;
  } catch (_) {
    /* stale handle */
  }
}

/** @param {Map<*, *>} meta Add each alive player's cities' majority religion. */
function tallyReligion(meta) {
  for (const p of Players.getAlive() || []) {
    if (!p || !p.Cities || typeof p.Cities.getCities !== "function") continue;
    for (const c of p.Cities.getCities() || []) tallyCity(c, meta);
  }
}

/** @returns {{name:string, color:string, settlements:number, pop:number}[]} Live rows. */
function collectReligionRows() {
  try {
    if (typeof Players === "undefined") return [];
    const meta = buildReligionMeta();
    tallyReligion(meta);
    const out = [];
    for (const m of meta.values()) if (m.settlements > 0) out.push(m);
    return out;
  } catch (_) {
    return [];
  }
}

/**
 * Render the Religion standings as bars (settlements following), colored by each
 * religion's own color.
 * @param {HTMLElement} host The chart host. @param {*} _opts Unused.
 */
export function renderReligionStandings(host, _opts) {
  const rows = collectReligionRows().sort((a, b) => b.settlements - a.settlements);
  host.innerHTML = "";
  if (!rows.length) return U.emptyState(host, t("LOC_DEMOGRAPHICS_BOARD_NO_RELIGION"));
  const max = Math.max(1, ...rows.map((r) => r.settlements));
  const wrap = U.stack();
  for (const r of rows) {
    wrap.appendChild(U.barRow({
      label: r.name, value: r.settlements, max, color: U.readable(r.color),
      right: r.settlements + " · " + t("LOC_DEMOGRAPHICS_BOARD_POP_SUFFIX", r.pop), labelWidth: "11rem"
    }));
  }
  host.appendChild(wrap);
}

// ── Religion pantheons (Antiquity) ─────────────────────────────────────────

/**
 * @typedef {Object} PantheonEntry
 * @property {string} name The localized pantheon (belief) name.
 * @property {string} effect The plain-text effect summary (belief Description), or "".
 * @property {Record<string,number>} yields Estimated flat per-category yields.
 * @property {boolean} conditional True when the belief also has uncounted (percent /
 *   per-unit) yield effects.
 */

/**
 * One chosen pantheon's entry from a belief handle, or null when the handle isn't a
 * lookupable pantheon belief (wrong class, no name, unavailable).
 * @param {*} ref A pantheon belief handle (from player.Religion.getPantheons()).
 * @param {*} canLookup Whether GameInfo.Beliefs.lookup is available.
 * @returns {PantheonEntry|null}
 */
function pantheonEntryFromRef(ref, canLookup) {
  const def = canLookup ? GameInfo.Beliefs.lookup(ref) : null;
  if (!def) return null;
  if (def.BeliefClassType && def.BeliefClassType !== "BELIEF_CLASS_PANTHEON") return null;
  const name = def.Name && typeof Locale !== "undefined"
    ? Locale.compose(def.Name) : prettifyType(def.BeliefType || "");
  if (!name) return null;
  const est = estimateYields(def);
  return { name, effect: effectText(def), yields: est.yields, conditional: est.conditional };
}

/**
 * The raw pantheon belief handles a live player has chosen, or null when unavailable.
 * @param {*} player A live player (from Players.getAlive()).
 * @returns {*} The belief handles (array-like), or null.
 */
function pantheonRefsFor(player) {
  try {
    return player && player.Religion && typeof player.Religion.getPantheons === "function"
      ? player.Religion.getPantheons() : null;
  } catch (_) {
    return null;
  }
}

/**
 * The pantheon beliefs a live player has chosen, each with its name, effect text, and
 * an estimated flat-yield breakdown.
 * @param {*} player A live player (from Players.getAlive()).
 * @returns {PantheonEntry[]} Chosen pantheons (empty if none / unavailable).
 */
function pantheonEntriesFor(player) {
  /** @type {PantheonEntry[]} */
  const out = [];
  const refs = pantheonRefsFor(player);
  if (!refs) return out;
  const canLookup = typeof GameInfo !== "undefined" && GameInfo.Beliefs &&
    typeof GameInfo.Beliefs.lookup === "function";
  for (const ref of refs) {
    try {
      const entry = pantheonEntryFromRef(ref, canLookup);
      if (entry) out.push(entry);
    } catch (_) {
      /* stale handle */
    }
  }
  return out;
}

/**
 * @typedef {Object} PantheonRow
 * @property {string} label The civ label.
 * @property {string} color The readable civ color.
 * @property {PantheonEntry[]} pantheons The civ's chosen pantheons.
 * @property {Record<string,number>} yields The civ's summed flat-yield estimate.
 * @property {boolean} conditional True when any of its pantheons has uncounted effects.
 */

/**
 * One civ's pantheon row from a live player, labeled/colored from the latest sample,
 * with a per-civ flat-yield total, or null when the player has no pantheon.
 * @param {*} p A live player (from Players.getAlive()).
 * @param {*} sample The latest sample's player map (for civ names/colors).
 * @returns {PantheonRow|null}
 */
function pantheonRowFor(p, sample) {
  const pantheons = pantheonEntriesFor(p);
  if (!pantheons.length) return null;
  const pid = String(p.id);
  const ps = sample[pid];
  const yields = emptyYields();
  let conditional = false;
  for (const pn of pantheons) {
    for (const c of YIELD_CATEGORIES) yields[c.key] += pn.yields[c.key] || 0;
    if (pn.conditional) conditional = true;
  }
  return { label: civLabel(ps, pid), color: U.civColor(ps), pantheons, yields, conditional };
}

/**
 * Collect each major civ's chosen pantheons from live game state, labeled/colored
 * from the latest sample's player map, with a per-civ flat-yield total.
 * @param {*} history The persisted history blob (for civ names/colors).
 * @returns {PantheonRow[]} One entry per civ that has a pantheon.
 */
function collectPantheonRows(history) {
  try {
    if (typeof Players === "undefined") return [];
    const sample = latestPlayers(history);
    /** @type {PantheonRow[]} */
    const out = [];
    for (const p of Players.getAlive() || []) {
      if (!p) continue;
      const row = pantheonRowFor(p, sample);
      if (row) out.push(row);
    }
    return out;
  } catch (_) {
    return [];
  }
}

/**
 * Render the pantheons chosen (Antiquity Religion view) as one identity column per
 * civ, listing each pantheon's name and its effect.
 * @param {HTMLElement} host The chart host.
 * @param {*} opts { history } for civ names/colors.
 */
export function renderReligionPantheons(host, opts) {
  const rows = collectPantheonRows(opts && opts.history);
  host.innerHTML = "";
  if (!rows.length) return U.emptyState(host, t("LOC_DEMOGRAPHICS_BOARD_NO_PANTHEONS"));
  const row = U.columnsRow(host);
  for (const r of rows) {
    const items = r.pantheons.map((pn) => ({ title: pn.name, sub: pn.effect }));
    row.appendChild(U.boardColumn(r.label, U.readable(r.color), r.pantheons.length, items));
  }
}

/**
 * Render the estimated pantheon YIELDS (Antiquity Religion view) as a small-multiple
 * card per civ: a colored, labeled horizontal bar per yield category, on a shared max
 * across civs so cards are directly comparable. Estimate only — see pantheon-effects.js.
 * @param {HTMLElement} host The chart host.
 * @param {*} opts { history } for civ names/colors.
 */
export function renderReligionPantheonYields(host, opts) {
  const rows = collectPantheonRows(opts && opts.history);
  host.innerHTML = "";
  const withYields = rows.filter((r) => YIELD_CATEGORIES.some((c) => (r.yields[c.key] || 0) > 0));
  if (!withYields.length) return U.emptyState(host, t("LOC_DEMOGRAPHICS_BOARD_NO_PANTHEON_YIELDS"));
  // Shared scale: the largest single-category value across all civs.
  let max = 1;
  for (const r of withYields) {
    for (const c of YIELD_CATEGORIES) max = Math.max(max, r.yields[c.key] || 0);
  }
  const flow = U.columnsRow(host, true);
  for (const r of withYields) flow.appendChild(pantheonYieldCard(r, max));
}

/**
 * One civ's estimated-yield card: identity header + a labeled colored bar per yield
 * category (zero categories omitted), plus a note when conditional effects exist.
 * @param {PantheonRow} r The civ row.
 * @param {number} max The shared per-category max.
 * @returns {HTMLElement} The card.
 */
function pantheonYieldCard(r, max) {
  const card = U.box(
    "flex:0 0 auto;min-width:15rem;max-width:20rem;display:flex;flex-direction:column;" +
      "border:1px solid " + U.BORDER + ";border-radius:6px;overflow:hidden;background:" + U.PANEL
  );
  const nonZero = YIELD_CATEGORIES.filter((c) => (r.yields[c.key] || 0) > 0);
  card.appendChild(U.columnHeader(r.label, U.readable(r.color), nonZero.length));
  const wrap = U.stack();
  for (const c of nonZero) {
    const v = r.yields[c.key];
    wrap.appendChild(U.barRow({
      label: t(c.label), value: v, max, color: c.color, right: "+" + v, labelWidth: "6.5rem"
    }));
  }
  card.appendChild(wrap);
  if (r.conditional) {
    card.appendChild(U.box(
      "padding:4px 12px 9px;color:" + U.INK_DIM + ";font-size:0.76rem;font-style:italic",
      t("LOC_DEMOGRAPHICS_BOARD_PANTHEON_YIELDS_CONDITIONAL"), "font-body"
    ));
  }
  return card;
}

// ── Settlements Atlas (size histogram + Most Urbanized) ─────────────────────

/** Raw-population size buckets [lo, hi]. */
const SIZE_BUCKETS = [[1, 5], [6, 10], [11, 15], [16, 20], [21, Infinity]];
const MIN_URBAN_POP = 5;
const URBAN_PRIOR = 6;

/** @param {*} c @param {number[]} counts Fold a city into size buckets. */
function bucketCity(c, counts) {
  try {
    const pop = c && c.population;
    if (typeof pop !== "number" || !isFinite(pop)) return;
    for (let i = 0; i < SIZE_BUCKETS.length; i++) {
      if (pop >= SIZE_BUCKETS[i][0] && pop <= SIZE_BUCKETS[i][1]) {
        counts[i] += 1;
        return;
      }
    }
  } catch (_) {
    /* stale handle */
  }
}

/** @returns {number[]} Per-bucket settlement counts. */
function collectSizeDistribution() {
  const counts = SIZE_BUCKETS.map(() => 0);
  try {
    if (typeof Players === "undefined") return counts;
    for (const p of Players.getAlive() || []) {
      if (!p || !p.Cities || typeof p.Cities.getCities !== "function") continue;
      for (const c of p.Cities.getCities() || []) bucketCity(c, counts);
    }
  } catch (_) {
    /* defensive */
  }
  return counts;
}

/** @param {HTMLElement} host Append the settlement-size histogram. */
function appendSizeHistogram(host) {
  const counts = collectSizeDistribution();
  if (!counts.reduce((a, b) => a + b, 0)) return;
  const max = Math.max(1, ...counts);
  host.appendChild(U.sectionTitle(t("LOC_DEMOGRAPHICS_BOARD_SECTION_SETTLEMENT_SIZES")));
  const wrap = U.stack();
  SIZE_BUCKETS.forEach((b, i) => {
    const label = t("LOC_DEMOGRAPHICS_BOARD_POP_SUFFIX", b[1] === Infinity ? b[0] + "+" : b[0] + "–" + b[1]);
    wrap.appendChild(U.barRow({ label, value: counts[i], max, color: U.ACCENT, right: String(counts[i]), labelWidth: "7rem" }));
  });
  host.appendChild(wrap);
}

/** @param {*} c @returns {string} Localized city name. */
function cityName(c) {
  try {
    return typeof Locale !== "undefined" ? Locale.compose(c.name) : String(c && c.name);
  } catch (_) {
    return "?";
  }
}

/**
 * @typedef {{name:string, urban:number, total:number, index?:number}} UrbanRow
 */

/** @param {*} c @param {UrbanRow[]} rows Add a city's urbanization row. */
function addUrbanRow(c, rows) {
  try {
    const total = c && c.population;
    const urban = c && c.urbanPopulation;
    if (typeof total !== "number" || typeof urban !== "number" || total < MIN_URBAN_POP) return;
    rows.push({ name: cityName(c), urban, total });
  } catch (_) {
    /* stale handle */
  }
}

/** @returns {UrbanRow[]} Live urbanization rows. */
function collectUrbanization() {
  /** @type {UrbanRow[]} */
  const rows = [];
  try {
    if (typeof Players === "undefined") return rows;
    for (const p of Players.getAlive() || []) {
      if (!p || !p.Cities || typeof p.Cities.getCities !== "function") continue;
      for (const c of p.Cities.getCities() || []) addUrbanRow(c, rows);
    }
  } catch (_) {
    /* defensive */
  }
  return rows;
}

/** @param {HTMLElement} host Append the size-shrunk Most-Urbanized ranking. */
function appendMostUrbanized(host) {
  const rows = collectUrbanization();
  if (!rows.length) return;
  let su = 0;
  let st = 0;
  for (const r of rows) {
    su += r.urban;
    st += r.total;
  }
  const pBar = st > 0 ? su / st : 0;
  for (const r of rows) r.index = (r.urban + URBAN_PRIOR * pBar) / (r.total + URBAN_PRIOR);
  rows.sort((a, b) => (b.index || 0) - (a.index || 0));
  host.appendChild(U.sectionTitle(t("LOC_DEMOGRAPHICS_BOARD_SECTION_MOST_URBANIZED")));
  const wrap = U.stack();
  for (const r of rows.slice(0, 12)) {
    wrap.appendChild(U.barRow({
      label: r.name, value: r.index || 0, max: 1, color: "#6FA8DC",
      right: t("LOC_DEMOGRAPHICS_BOARD_URBAN_PCT", Math.round((r.urban / r.total) * 100)), labelWidth: "10rem"
    }));
  }
  host.appendChild(wrap);
}

/**
 * Render the Settlements Atlas: size histogram + Most-Urbanized ranking.
 * @param {HTMLElement} host The chart host. @param {*} _opts Unused.
 */
export function renderSettlementsAtlas(host, _opts) {
  host.innerHTML = "";
  const scroll = U.box("width:100%;height:100%;overflow:auto");
  appendSizeHistogram(scroll);
  appendMostUrbanized(scroll);
  if (!scroll.childElementCount) U.emptyState(scroll, t("LOC_DEMOGRAPHICS_BOARD_NO_SETTLEMENTS_CHART"));
  host.appendChild(scroll);
}
