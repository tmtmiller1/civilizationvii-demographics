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
import * as board from "/demographics/ui/screen-demographics/charts/boards/board-ui.js";
import {
  civDroppedByPolicy,
  liveCivDroppedByPolicy,
  historySamples
} from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";
import {
  YIELD_CATEGORIES,
  emptyYields,
  effectText,
  estimateYields
} from "/demographics/ui/screen-demographics/charts/boards/pantheon-effects.js";

/**
 * The players map of the most recent sample, or {} when history is empty.
 * @param {*} history The persisted history blob.
 * @returns {Record<string, any>}
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
 * @param {*} player A sample player.
 * @param {string} pid
 * @returns {string}
 */
function civLabel(player, pid) {
  if (!player) return tPlayerFallback(pid);
  return player.leaderName ? inlineLabel(player.leaderName, player.civName) : player.civName || tPlayerFallback(pid);
}

/**
 * Readable words from a database type id, used when the game has no localized name for it:
 * BUILDING_GREAT_LIBRARY becomes "Great Library" (the leading table prefix is dropped).
 * @param {string} type
 * @returns {string}
 */
function titleCaseFromType(type) {
  const words = String(type).replace(/^[A-Z]+_/, "").toLowerCase().split("_");
  return words.map((word) => word.replace(/\b\w/g, (c) => c.toUpperCase())).join(" ");
}

/**
 * The game's localized name for a type id, or null when the table, the row, its Name, or the
 * Locale lookup is missing or comes back blank.
 * @param {string} table The GameInfo table.
 * @param {string} type
 * @returns {string | null}
 */
function localizedTypeName(table, type) {
  try {
    if (typeof GameInfo === "undefined" || typeof Locale === "undefined") return null;
    const rows = GameInfo[table];
    const row = rows ? rows.lookup(type) : null;
    if (!row || !row.Name) return null;
    const text = Locale.compose(row.Name);
    return text && text.trim() ? text : null;
  } catch (_) {
    return null; // a lookup that throws reads the same as a missing row
  }
}

// Wonders board + races

/**
 * Fold one player's wonderTypes into the first-seen-turn accumulator.
 * @param {*} player A sample player.
 * @param {number} turn The chart turn.
 * @param {Map<string, Map<string, number>>} out
 * @param {string} pid
 */
function foldWonderPlayer(player, turn, out, pid) {
  const types = player && Array.isArray(player.wonderTypes) ? player.wonderTypes : null;
  if (!types) return;
  let firstTurns = out.get(pid);
  if (!firstTurns) {
    firstTurns = new Map();
    out.set(pid, firstTurns);
  }
  for (const type of types) if (!firstTurns.has(type)) firstTurns.set(type, turn);
}

/**
 * For each civ, the chart-turn each wonder type first appeared.
 * @param {*} history The persisted history blob.
 * @returns {Map<string, Map<string, number>>} pid → (type → first chartTurn).
 */
function wonderFirstTurns(history) {
  const out = new Map();
  const samples = historySamples(history);
  for (const sample of samples) foldSample(sample, out, samples);
  return out;
}

/**
 * @param {*} sample
 * @param {Map<string, Map<string, number>>} out The accumulator.
 * @param {*[]} samples The whole stream, for the spoiler guard.
 */
function foldSample(sample, out, samples) {
  const players = sample && sample.players;
  const turn = sample && sample.chartTurn;
  if (!players) return;
  for (const pid in players) {
    if (!civDroppedByPolicy(samples, pid)) foldWonderPlayer(players[pid], turn, out, pid);
  }
}

/**
 * Wonder labels for one civ, in completion order, annotated with the turn.
 * @param {string[]} types Wonder ConstructibleType ids.
 * @param {Map<string, number>} [turns] type → first chart-turn.
 * @returns {string[]}
 */
function wonderLabels(types, turns) {
  const items = types.map((type) => ({
    name: localizedTypeName("Constructibles", type) || titleCaseFromType(type),
    turn: turns ? turns.get(type) : undefined
  }));
  items.sort((a, b) => (a.turn == null ? 1e9 : a.turn) - (b.turn == null ? 1e9 : b.turn));
  return items.map(({ name, turn }) => (turn != null ? name + " · " + t("LOC_DEMOGRAPHICS_WONDER_TURN", turn) : name));
}

/**
 * Render the Wonders board: one civ-colored column per civ, wonders in
 * completion order with their turn.
 * @param {HTMLElement} host
 * @param {{history:*}} opts
 */
export function renderWondersBoard(host, opts) {
  host.innerHTML = "";
  const history = opts && opts.history;
  const players = latestPlayers(history);
  const firstTurns = wonderFirstTurns(history);
  const cols = [];
  for (const pid in players) {
    if (civDroppedByPolicy(historySamples(history), pid)) continue;
    const player = players[pid];
    const types = player && Array.isArray(player.wonderTypes) ? player.wonderTypes : [];
    if (!types.length) continue;
    const items = wonderLabels(types, firstTurns.get(pid));
    cols.push({ name: civLabel(player, pid), color: board.civColor(player), items });
  }
  cols.sort((a, b) => b.items.length - a.items.length);
  if (!cols.length) return board.emptyState(host, t("LOC_DEMOGRAPHICS_BOARD_NO_WONDERS"));
  const row = board.columnsRow(host);
  for (const col of cols) row.appendChild(board.boardColumn(col.name, col.color, col.items.length, col.items));
}

/**
 * Pivot the per-civ first-turns into the earliest builder of each wonder.
 * @param {Map<string, Map<string, number>>} firstTurns pid → (type → turn).
 * @returns {Map<string, {pid:string, turn:number}>}
 */
function wonderWinners(firstTurns) {
  const winners = new Map();
  for (const [pid, typeTurns] of firstTurns) {
    for (const [type, turn] of typeTurns) {
      const best = winners.get(type);
      if (!best || (turn != null && (best.turn == null || turn < best.turn))) winners.set(type, { pid, turn });
    }
  }
  return winners;
}

/**
 * @param {{name:string, civ:string, color:string, turn:number|undefined}} race
 * @returns {HTMLElement}
 */
function wonderRaceRow(race) {
  const line = board.box("display:flex;align-items:center;gap:0.556rem;min-height:1.222rem");
  line.setAttribute("data-tooltip-content", race.name + " — " + race.civ);
  line.appendChild(board.box("flex:0 0 14rem;color:" + board.INK + ";font-size:var(--dg-fs-95);text-align:right;" +
    "white-space:nowrap;overflow:hidden;text-overflow:ellipsis", race.name, "font-body"));
  const who = board.box("flex:1 1 auto;display:flex;align-items:center;gap:0.389rem;min-width:0");
  who.appendChild(board.swatch(race.color, 11));
  who.appendChild(board.box("color:" + board.INK + ";font-size:var(--dg-fs-85);white-space:nowrap;overflow:hidden;" +
    "text-overflow:ellipsis", race.civ, "font-body"));
  line.appendChild(who);
  line.appendChild(board.box("flex:0 0 5rem;color:" + board.INK_MUTED + ";font-size:var(--dg-fs-85)",
    race.turn != null ? t("LOC_DEMOGRAPHICS_WONDER_TURN", race.turn) : "—", "font-body"));
  return line;
}

/**
 * Render Wonder Races: one row per wonder, who built it first, and when.
 * @param {HTMLElement} host
 * @param {{history:*}} opts
 */
export function renderWonderRaces(host, opts) {
  host.innerHTML = "";
  const players = latestPlayers(opts && opts.history);
  const completed = completedWonderRows(opts && opts.history, players);
  const building = inProgressWonderRows();
  if (!completed.length && !building.length) {
    return board.emptyState(host, t("LOC_DEMOGRAPHICS_BOARD_NO_WONDERS_OR_BUILDING"));
  }
  appendWonderSection(host, t("LOC_DEMOGRAPHICS_BOARD_SECTION_UNDER_CONSTRUCTION"), building, wonderProgressRow);
  appendWonderSection(host, t("LOC_DEMOGRAPHICS_BOARD_SECTION_COMPLETED"), completed, wonderRaceRow);
}

/**
 * Completed-wonder rows (first builder + turn), earliest first.
 * @param {*} history
 * @param {Record<string, any>} players
 * @returns {*[]}
 */
function completedWonderRows(history, players) {
  const rows = [];
  for (const [type, winner] of wonderWinners(wonderFirstTurns(history))) {
    const player = players[winner.pid];
    rows.push({
      name: localizedTypeName("Constructibles", type) || titleCaseFromType(type),
      civ: civLabel(player, winner.pid),
      color: board.civColor(player), turn: winner.turn
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
    const settlementBoard = buildSettlementBoard();
    settlements = settlementBoard && Array.isArray(settlementBoard.settlements) ? settlementBoard.settlements : [];
  } catch (_) {
    settlements = [];
  }
  const rows = /** @type {*[]} */ (settlements.map(inProgressWonderRow).filter(Boolean));
  rows.sort((a, b) => (b.percent == null ? -1 : b.percent) - (a.percent == null ? -1 : a.percent));
  return rows;
}

/**
 * @param {*} settlement
 * @returns {*|null} Its in-progress-wonder row, or null.
 */
function inProgressWonderRow(settlement) {
  const wonder = settlement.wonderInProgress;
  if (!wonder) return null;
  const owner = settlement.owner || {};
  if (owner.pid != null && liveCivDroppedByPolicy(owner.pid)) return null;
  const civ = owner.leaderName ? inlineLabel(owner.leaderName, owner.civName) : owner.civName || "—";
  return {
    name: wonder.name, civ, settlement: settlement.name,
    color: board.readable((owner.readable || owner.primary) || board.FALLBACK_COLOR),
    percent: wonder.percent, turnsLeft: wonder.turnsLeft
  };
}

/**
 * @param {HTMLElement} host
 * @param {string} title
 * @param {*[]} rows
 * @param {(r:*)=>HTMLElement} rowFn
 */
function appendWonderSection(host, title, rows, rowFn) {
  if (!rows.length) return;
  host.appendChild(board.sectionTitle(title));
  const wrap = board.stack();
  for (const row of rows) wrap.appendChild(rowFn(row));
  host.appendChild(wrap);
}

/**
 * One in-progress wonder row: a progress bar (how close) with the wonder name,
 * the building civ + settlement, and turns-left.
 * @param {{name:string, civ:string, settlement:string, color:string, percent:number|null,
 *   turnsLeft:number|null}} wonder
 * @returns {HTMLElement}
 */
function wonderProgressRow(wonder) {
  const percentText = wonder.percent != null ? wonder.percent + "%" : "—";
  const turns = wonder.turnsLeft != null ? " · " + t("LOC_DEMOGRAPHICS_BOARD_TURNS_LEFT", wonder.turnsLeft) : "";
  return board.barRow({
    label: wonder.name, value: wonder.percent || 0, max: 100, color: wonder.color,
    right: percentText + turns + " · " + wonder.civ, labelWidth: "13rem"
  });
}

// By-type breakdowns (per-civ bar charts)

/** @param {string} minWidth @param {string} maxWidth */
function cardBox(minWidth, maxWidth) {
  return board.box(
    "flex:0 0 auto;min-width:" + minWidth + ";max-width:" + maxWidth + ";display:flex;flex-direction:column;" +
      "border:1px solid " + board.BORDER + ";border-radius:0.333rem;overflow:hidden;background:" + board.PANEL
  );
}

/**
 * @param {{name:string, color:string, total:number, items:{name:string, n:number}[]}} column
 * @returns {HTMLElement}
 */
function byTypeColumn(column) {
  const col = cardBox("14rem", "19rem");
  col.appendChild(board.columnHeader(column.name, column.color, column.total));
  const max = Math.max(1, ...column.items.map((item) => item.n));
  const body = board.box("display:flex;flex-direction:column;gap:0.278rem;padding:0.444rem 0.556rem");
  for (const item of column.items) {
    body.appendChild(board.barRow({
      label: item.name, value: item.n, max, color: column.color, right: String(item.n), labelWidth: "7rem"
    }));
  }
  col.appendChild(body);
  return col;
}

/**
 * Reduce one civ's by-type map to sorted {name, n} items + a total.
 * @param {Map<string, number>} byType
 * @param {string} lookup The GameInfo table for name resolution.
 * @returns {{total:number, items:{name:string, n:number}[]}}
 */
function byTypeItems(byType, lookup) {
  let total = 0;
  const items = [];
  for (const [type, count] of byType) {
    total += count;
    items.push({ name: localizedTypeName(lookup, type) || titleCaseFromType(type), n: count });
  }
  items.sort((a, b) => b.n - a.n);
  return { total, items };
}

/**
 * One column per civ the spoiler guard lets through that has at least one type.
 * @param {Map<*, Map<string, number>>} counts pid → (type → count).
 * @param {Record<string, any>} players The latest sample's players (labels/colors).
 * @param {string} lookup The GameInfo table for name resolution.
 * @returns {{name:string, color:string, total:number, items:{name:string, n:number}[]}[]}
 */
function byTypeColumns(counts, players, lookup) {
  const cols = [];
  for (const [pid, byType] of counts) {
    if (liveCivDroppedByPolicy(pid)) continue;
    const { total, items } = byTypeItems(byType, lookup);
    if (!items.length) continue;
    cols.push({ name: civLabel(players[pid], String(pid)), color: board.civColor(players[pid]), total, items });
  }
  return cols;
}

/**
 * Render a by-type breakdown: one civ-colored column per civ, a bar per type.
 * @param {HTMLElement} host
 * @param {{history:*, datapointId:string, lookup:string}} opts
 */
export function renderByTypeBoard(host, opts) {
  host.innerHTML = "";
  const players = latestPlayers(opts && opts.history);
  const counts = byTypeCounts((opts && opts.datapointId) || "");
  const cols = byTypeColumns(counts, players, (opts && opts.lookup) || "Units");
  cols.sort((a, b) => b.total - a.total);
  if (!cols.length) return board.emptyState(host, t("LOC_DEMOGRAPHICS_BOARD_NO_BREAKDOWN"));
  const row = board.columnsRow(host);
  for (const col of cols) row.appendChild(byTypeColumn(col));
}

// Religion standings (bars)

/**
 * Build the religion → row map from GameInfo.Religions.
 * @returns {Map<*, *>} hash → {name, color, settlements:0, pop:0}.
 */
function buildReligionMeta() {
  const meta = new Map();
  if (typeof GameInfo === "undefined" || !GameInfo.Religions || typeof Locale === "undefined") return meta;
  for (const religion of GameInfo.Religions) {
    if (!religion || religion.$hash == null) continue;
    const name = religion.Name ? Locale.compose(religion.Name) : titleCaseFromType(religion.ReligionType);
    meta.set(religion.$hash, { name, color: religion.Color || board.FALLBACK_COLOR, settlements: 0, pop: 0 });
  }
  return meta;
}

/**
 * @param {*} city
 * @param {Map<*, *>} meta The religion map (mutated).
 */
function tallyCity(city, meta) {
  try {
    const majority = city && city.Religion && city.Religion.majorityReligion;
    const entry = majority != null && majority !== -1 ? meta.get(majority) : null;
    if (!entry) return;
    entry.settlements += 1;
    if (typeof city.population === "number") entry.pop += city.population;
  } catch (_) {
    /* stale handle */
  }
}

/** @param {Map<*, *>} meta */
function tallyReligion(meta) {
  for (const player of Players.getAlive() || []) {
    if (!player || !player.Cities || typeof player.Cities.getCities !== "function") continue;
    for (const city of player.Cities.getCities() || []) tallyCity(city, meta);
  }
}

/** @returns {{name:string, color:string, settlements:number, pop:number}[]} Live rows. */
function collectReligionRows() {
  try {
    if (typeof Players === "undefined") return [];
    const meta = buildReligionMeta();
    tallyReligion(meta);
    const out = [];
    for (const entry of meta.values()) if (entry.settlements > 0) out.push(entry);
    return out;
  } catch (_) {
    return [];
  }
}

/**
 * Render the Religion standings as bars (settlements following), colored by each
 * religion's own color.
 * @param {HTMLElement} host
 * @param {*} _opts
 */
export function renderReligionStandings(host, _opts) {
  const rows = collectReligionRows().sort((a, b) => b.settlements - a.settlements);
  host.innerHTML = "";
  if (!rows.length) return board.emptyState(host, t("LOC_DEMOGRAPHICS_BOARD_NO_RELIGION"));
  const max = Math.max(1, ...rows.map((religion) => religion.settlements));
  const wrap = board.stack();
  for (const religion of rows) {
    wrap.appendChild(board.barRow({
      label: religion.name, value: religion.settlements, max, color: board.readable(religion.color),
      right: religion.settlements + " · " + t("LOC_DEMOGRAPHICS_BOARD_POP_SUFFIX", religion.pop), labelWidth: "11rem"
    }));
  }
  host.appendChild(wrap);
}

// Religion pantheons (Antiquity)

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
    ? Locale.compose(def.Name) : titleCaseFromType(def.BeliefType || "");
  if (!name) return null;
  const estimate = estimateYields(def);
  return { name, effect: effectText(def), yields: estimate.yields, conditional: estimate.conditional };
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
 * @param {*} player A live player (from Players.getAlive()).
 * @param {*} samplePlayers The latest sample's player map (for civ names/colors).
 * @returns {PantheonRow|null}
 */
function pantheonRowFor(player, samplePlayers) {
  const pantheons = pantheonEntriesFor(player);
  if (!pantheons.length) return null;
  const pid = String(player.id);
  const samplePlayer = samplePlayers[pid];
  const yields = emptyYields();
  let conditional = false;
  for (const pantheon of pantheons) {
    for (const category of YIELD_CATEGORIES) yields[category.key] += pantheon.yields[category.key] || 0;
    if (pantheon.conditional) conditional = true;
  }
  return { label: civLabel(samplePlayer, pid), color: board.civColor(samplePlayer), pantheons, yields, conditional };
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
    const samplePlayers = latestPlayers(history);
    /** @type {PantheonRow[]} */
    const out = [];
    for (const player of Players.getAlive() || []) {
      if (!player || liveCivDroppedByPolicy(player.id)) continue;
      const row = pantheonRowFor(player, samplePlayers);
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
 * @param {HTMLElement} host
 * @param {*} opts { history } for civ names/colors.
 */
export function renderReligionPantheons(host, opts) {
  const rows = collectPantheonRows(opts && opts.history);
  host.innerHTML = "";
  if (!rows.length) return board.emptyState(host, t("LOC_DEMOGRAPHICS_BOARD_NO_PANTHEONS"));
  const row = board.columnsRow(host);
  for (const civRow of rows) {
    const items = civRow.pantheons.map((pantheon) => ({ title: pantheon.name, sub: pantheon.effect }));
    row.appendChild(board.boardColumn(civRow.label, board.readable(civRow.color), civRow.pantheons.length, items));
  }
}

/**
 * Render the estimated pantheon yields (Antiquity Religion view) as a small-multiple
 * card per civ: a colored, labeled horizontal bar per yield category, on a shared max
 * across civs so cards are directly comparable. Estimate only; see pantheon-effects.js.
 * @param {HTMLElement} host
 * @param {*} opts { history } for civ names/colors.
 */
export function renderReligionPantheonYields(host, opts) {
  const rows = collectPantheonRows(opts && opts.history);
  host.innerHTML = "";
  const withYields = rows.filter((row) => YIELD_CATEGORIES.some((c) => (row.yields[c.key] || 0) > 0));
  if (!withYields.length) return board.emptyState(host, t("LOC_DEMOGRAPHICS_BOARD_NO_PANTHEON_YIELDS"));
  // Shared scale: the largest single-category value across all civs.
  let max = 1;
  for (const civRow of withYields) {
    for (const category of YIELD_CATEGORIES) max = Math.max(max, civRow.yields[category.key] || 0);
  }
  const flow = board.columnsRow(host, true);
  for (const civRow of withYields) flow.appendChild(pantheonYieldCard(civRow, max));
}

/**
 * One civ's estimated-yield card: identity header + a labeled colored bar per yield
 * category (zero categories omitted), plus a note when conditional effects exist.
 * @param {PantheonRow} civRow
 * @param {number} max The shared per-category max.
 * @returns {HTMLElement}
 */
function pantheonYieldCard(civRow, max) {
  const card = cardBox("15rem", "20rem");
  const nonZero = YIELD_CATEGORIES.filter((category) => (civRow.yields[category.key] || 0) > 0);
  card.appendChild(board.columnHeader(civRow.label, board.readable(civRow.color), nonZero.length));
  const wrap = board.stack();
  for (const category of nonZero) {
    const value = civRow.yields[category.key];
    wrap.appendChild(board.barRow({
      label: t(category.label), value, max, color: category.color, right: "+" + value, labelWidth: "6.5rem"
    }));
  }
  card.appendChild(wrap);
  if (civRow.conditional) {
    card.appendChild(board.box(
      "padding:0.222rem 0.667rem 0.5rem;color:" + board.INK_DIM + ";font-size:var(--dg-fs-78)",
      t("LOC_DEMOGRAPHICS_BOARD_PANTHEON_YIELDS_CONDITIONAL"), "font-body"
    ));
  }
  return card;
}

// Settlements Atlas (size histogram + Most Urbanized)

/**
 * Size classes for the histogram, by raw population. Each entry is the largest population in its
 * class; the class starts one above the previous entry (the first at 1), and one more open-ended
 * class holds everything above the last entry.
 */
const SIZE_CLASS_TOPS = [5, 10, 15, 20];
const SIZE_CLASS_COUNT = SIZE_CLASS_TOPS.length + 1;
/** Settlements smaller than this stay out of the Most-Urbanized ranking. */
const URBAN_RANK_MIN_POP = 5;
const URBAN_PRIOR = 6;

/**
 * @param {number} i A size class index.
 * @returns {number} The smallest population in it.
 */
function sizeClassFloor(i) {
  return i === 0 ? 1 : SIZE_CLASS_TOPS[i - 1] + 1;
}

/**
 * The size class a population falls in, or -1 when it is below 1 or sits between two classes.
 * @param {number} pop A finite population.
 * @returns {number}
 */
function sizeClassOf(pop) {
  for (let i = 0; i < SIZE_CLASS_COUNT; i++) {
    if (!(pop >= sizeClassFloor(i))) return -1;
    if (i === SIZE_CLASS_TOPS.length || pop <= SIZE_CLASS_TOPS[i]) return i;
  }
  return -1;
}

/**
 * @param {number} i A size class index.
 * @returns {string} "1–5", ..., "21+".
 */
function sizeClassRange(i) {
  const floor = sizeClassFloor(i);
  return i === SIZE_CLASS_TOPS.length ? floor + "+" : floor + "–" + SIZE_CLASS_TOPS[i];
}

/** @param {*} city @param {number[]} counts */
function bucketCity(city, counts) {
  try {
    const pop = city && city.population;
    if (typeof pop !== "number" || !isFinite(pop)) return;
    const sizeClass = sizeClassOf(pop);
    if (sizeClass >= 0) counts[sizeClass] += 1;
  } catch (_) {
    /* stale handle */
  }
}

/** @returns {number[]} Per-bucket settlement counts. */
function collectSizeDistribution() {
  const counts = new Array(SIZE_CLASS_COUNT).fill(0);
  try {
    if (typeof Players === "undefined") return counts;
    for (const player of Players.getAlive() || []) {
      if (!player || !player.Cities || typeof player.Cities.getCities !== "function") continue;
      for (const city of player.Cities.getCities() || []) bucketCity(city, counts);
    }
  } catch (_) {
    /* unreadable */
  }
  return counts;
}

/** @param {HTMLElement} host Append the settlement-size histogram. */
function appendSizeHistogram(host) {
  const counts = collectSizeDistribution();
  if (!counts.reduce((a, b) => a + b, 0)) return;
  const max = Math.max(1, ...counts);
  host.appendChild(board.sectionTitle(t("LOC_DEMOGRAPHICS_BOARD_SECTION_SETTLEMENT_SIZES")));
  const wrap = board.stack();
  counts.forEach((count, i) => {
    const label = t("LOC_DEMOGRAPHICS_BOARD_POP_SUFFIX", sizeClassRange(i));
    wrap.appendChild(board.barRow({
      label, value: count, max, color: board.ACCENT, right: String(count), labelWidth: "7rem"
    }));
  });
  host.appendChild(wrap);
}

/**
 * @param {*} city
 * @returns {string} Localized city name.
 */
function cityName(city) {
  try {
    return typeof Locale !== "undefined" ? Locale.compose(city.name) : String(city && city.name);
  } catch (_) {
    return "?";
  }
}

/**
 * @typedef {{name:string, urban:number, total:number, index?:number}} UrbanRow
 */

/**
 * @param {*} city
 * @param {UrbanRow[]} rows
 */
function addUrbanRow(city, rows) {
  try {
    const total = city && city.population;
    const urban = city && city.urbanPopulation;
    if (typeof total !== "number" || typeof urban !== "number" || total < URBAN_RANK_MIN_POP) return;
    rows.push({ name: cityName(city), urban, total });
  } catch (_) {
    /* stale handle */
  }
}

/**
 * Whether a live player's cities may enter the Most-Urbanized ranking. City names identify their
 * civ, so the ranking follows the spoiler guard; the size histogram stays world-wide because it
 * counts settlements and names none.
 * @param {*} owner A live player.
 * @returns {boolean} True when its cities are readable and shown.
 */
function rankableOwner(owner) {
  return !!owner && !!owner.Cities && typeof owner.Cities.getCities === "function" && !liveCivDroppedByPolicy(owner.id);
}

/** @returns {UrbanRow[]} Live urbanization rows. */
function collectUrbanization() {
  /** @type {UrbanRow[]} */
  const rows = [];
  try {
    if (typeof Players === "undefined") return rows;
    for (const player of Players.getAlive() || []) {
      if (!rankableOwner(player)) continue;
      for (const city of player.Cities.getCities() || []) addUrbanRow(city, rows);
    }
  } catch (_) {
    /* unreadable */
  }
  return rows;
}

/** @param {HTMLElement} host Append the size-shrunk Most-Urbanized ranking. */
function appendMostUrbanized(host) {
  const rows = collectUrbanization();
  if (!rows.length) return;
  const urbanSum = rows.reduce((sum, row) => sum + row.urban, 0);
  const totalSum = rows.reduce((sum, row) => sum + row.total, 0);
  // Shrink small cities toward the world-wide urban share so a size-5 town can't top the list on noise.
  const worldUrbanShare = totalSum > 0 ? urbanSum / totalSum : 0;
  for (const row of rows) row.index = (row.urban + URBAN_PRIOR * worldUrbanShare) / (row.total + URBAN_PRIOR);
  rows.sort((a, b) => (b.index || 0) - (a.index || 0));
  host.appendChild(board.sectionTitle(t("LOC_DEMOGRAPHICS_BOARD_SECTION_MOST_URBANIZED")));
  const wrap = board.stack();
  for (const row of rows.slice(0, 12)) {
    wrap.appendChild(board.barRow({
      label: row.name, value: row.index || 0, max: 1, color: "#6FA8DC",
      right: t("LOC_DEMOGRAPHICS_BOARD_URBAN_PCT", Math.round((row.urban / row.total) * 100)), labelWidth: "10rem"
    }));
  }
  host.appendChild(wrap);
}

/**
 * Render the Settlements Atlas: size histogram + Most-Urbanized ranking.
 * @param {HTMLElement} host
 * @param {*} _opts
 */
export function renderSettlementsAtlas(host, _opts) {
  host.innerHTML = "";
  const scroll = board.box("width:100%;height:100%;overflow:auto");
  appendSizeHistogram(scroll);
  appendMostUrbanized(scroll);
  if (!scroll.childElementCount) board.emptyState(scroll, t("LOC_DEMOGRAPHICS_BOARD_NO_SETTLEMENTS_CHART"));
  host.appendChild(scroll);
}
