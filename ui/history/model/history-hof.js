// history-hof.js
//
// Pure: Hall of Fame figures computed from archive records. No engine access, no DOM.
//
// Ranking model: finished games before unfinished ones and victories before other results, then
// more Triumphs, then fewer turns. The honorific is the rank of the game's Triumphs against your
// best game, on a 12-step ladder.

/** Unfinished games shorter than this are treated as test loads and hidden by default. */
export const SHORT_GAME_TURNS = 20;
/** Number of honorific titles (LOC_DEMOGRAPHICS_HIST_TITLE_1 is the highest). */
export const TITLE_COUNT = 12;

/**
 * A headline figure of a record, 0 when the record carries no figures (an archive written by hand
 * or by another version passes isRecord without them).
 * @param {ArchiveRecord} r Record.
 * @param {keyof ArchiveRecord["stats"]} key Figure.
 * @returns {number} The figure.
 */
export function statOf(r, key) {
  const v = r.stats ? r.stats[key] : 0;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Records to show.
 * @param {ArchiveRecord[]} records All records.
 * @param {{showShort?: boolean, keep?: string}} [opts] Show short unfinished games too; always keep
 *   one id (the game being played).
 * @returns {ArchiveRecord[]} Visible records, newest first.
 */
export function visibleRecords(records, opts = {}) {
  return records
    .filter((r) => opts.showShort || r.id === opts.keep || r.outcome.status !== "in_progress" || r.turns >= SHORT_GAME_TURNS)
    .sort((a, b) => b.updated - a.updated);
}

/**
 * Sort weight of an outcome (lower first).
 * @param {HnrStatus} s Status.
 * @returns {number} Weight.
 */
function outcomeWeight(s) {
  return s === "victory" ? 0 : s === "defeat" || s === "ended" ? 1 : 2;
}

/**
 * Games in ranking order.
 * @param {ArchiveRecord[]} records Records.
 * @returns {ArchiveRecord[]} Ranked copy.
 */
export function ranked(records) {
  return records.slice().sort(
    (a, b) =>
      outcomeWeight(a.outcome.status) - outcomeWeight(b.outcome.status) ||
      statOf(b, "triumphs") - statOf(a, "triumphs") ||
      a.turns - b.turns ||
      b.updated - a.updated
  );
}

/**
 * @typedef {Object} Standing
 * @property {ArchiveRecord[]} order Every visible game, best first.
 * @property {ArchiveRecord[]} top The best games (up to `topN`).
 * @property {{rec: ArchiveRecord, rank: number, of: number, above: ArchiveRecord|null,
 *   below: ArchiveRecord|null}|null} current The current game (the one being played, else the latest),
 *   its 1-based rank, and its neighbours.
 */

/**
 * The best games, and where the current game stands among them.
 * @param {ArchiveRecord[]} records Visible games.
 * @param {string} [currentId] The game being played; when absent, the most recently updated game.
 * @param {number} [topN] How many of the best to list.
 * @returns {Standing} Standing.
 */
export function standing(records, currentId = "", topN = 10) {
  const order = ranked(records);
  const latest = records.slice().sort((a, b) => b.updated - a.updated)[0];
  const id = currentId && order.some((r) => r.id === currentId) ? currentId : latest?.id;
  const i = order.findIndex((r) => r.id === id);
  return {
    order,
    top: order.slice(0, topN),
    current: i < 0
      ? null
      : { rec: order[i], rank: i + 1, of: order.length, above: order[i - 1] || null, below: order[i + 1] || null }
  };
}

/**
 * Honorific index (1 = best) for a game, against the best game's Triumphs.
 * @param {ArchiveRecord} rec The game.
 * @param {number} best Highest Triumph count among all games.
 * @returns {number} 1..TITLE_COUNT.
 */
export function titleIndex(rec, best) {
  if (best <= 0) return TITLE_COUNT;
  const share = Math.max(0, Math.min(1, statOf(rec, "triumphs") / best));
  return 1 + Math.round((1 - share) * (TITLE_COUNT - 1));
}

/**
 * Count values by key.
 * @template T
 * @param {T[]} items Items.
 * @param {(item:T) => string} key Key function ("" skipped).
 * @returns {Map<string, number>} Counts.
 */
function tally(items, key) {
  const m = new Map();
  for (const it of items) {
    const k = key(it);
    if (k) m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

/**
 * Key with the highest count (ties: first seen).
 * @param {Map<string, number>} m Counts.
 * @returns {string} Key, or "".
 */
function topKey(m) {
  let best = "";
  let n = 0;
  for (const [k, v] of m) if (v > n) { best = k; n = v; }
  return best;
}

/**
 * Overview figures.
 * @param {ArchiveRecord[]} records Visible records.
 * @returns {{games:number, victories:number, finished:number, turns:number, triumphs:number,
 *   favoriteLeader:string, victoriesByType:Array<[string, number]>, latest: ArchiveRecord|null}} Overview.
 */
export function overview(records) {
  const wins = records.filter((r) => r.outcome.status === "victory");
  const byType = tally(wins, (r) => r.outcome.victory || "UNKNOWN");
  return {
    games: records.length,
    victories: wins.length,
    finished: records.filter((r) => r.outcome.status !== "in_progress").length,
    turns: records.reduce((s, r) => s + r.turns, 0),
    triumphs: records.reduce((s, r) => s + statOf(r, "triumphs"), 0),
    favoriteLeader: topKey(tally(records, (r) => r.leader)),
    victoriesByType: [...byType.entries()].sort((a, b) => b[1] - a[1]),
    latest: records.slice().sort((a, b) => b.updated - a.updated)[0] || null
  };
}

/**
 * @typedef {Object} GroupRow
 * @property {string} key Leader or civilization type.
 * @property {string} name LOC tag for the name.
 * @property {number} games Games played.
 * @property {number} wins Victories.
 * @property {number} losses Defeats.
 * @property {number} ended Games that ended without a victory or a defeat.
 * @property {number} open Games still in progress.
 * @property {number} finished Games that reached a result.
 * @property {number} bestTriumphs Most Triumphs in one game.
 * @property {number} avgTurns Average turns per game.
 */

/**
 * Fold one record into a group row.
 * @param {Map<string, GroupRow & {turnSum:number}>} rows Accumulator.
 * @param {string} key Group key.
 * @param {string} name LOC tag.
 * @param {ArchiveRecord} r Record.
 */
function fold(rows, key, name, r) {
  const blank = {
    key, name, games: 0, wins: 0, losses: 0, ended: 0, open: 0, finished: 0, bestTriumphs: 0, avgTurns: 0, turnSum: 0
  };
  const row = rows.get(key) || blank;
  row.games++;
  if (r.outcome.status !== "in_progress") row.finished++;
  if (r.outcome.status === "victory") row.wins++;
  else if (r.outcome.status === "defeat") row.losses++;
  else if (r.outcome.status === "ended") row.ended++;
  else row.open++;
  row.bestTriumphs = Math.max(row.bestTriumphs, statOf(r, "triumphs"));
  row.turnSum += r.turns;
  row.avgTurns = Math.round(row.turnSum / row.games);
  rows.set(key, row);
}

/**
 * Per-leader table, most played first.
 * @param {ArchiveRecord[]} records Records.
 * @returns {GroupRow[]} Rows.
 */
export function leaderRows(records) {
  const rows = new Map();
  for (const r of records) fold(rows, r.leader, r.leaderName, r);
  return [...rows.values()].sort((a, b) => b.games - a.games || b.wins - a.wins);
}

/**
 * Per-civilization table (every civilization led in any age), most played first.
 * @param {ArchiveRecord[]} records Records.
 * @returns {GroupRow[]} Rows.
 */
export function civRows(records) {
  const rows = new Map();
  for (const r of records) {
    const seen = new Set();
    for (const c of r.civs) {
      if (seen.has(c.civ)) continue;
      seen.add(c.civ);
      fold(rows, c.civ, c.name, r);
    }
  }
  return [...rows.values()].sort((a, b) => b.games - a.games || b.wins - a.wins);
}

/**
 * @typedef {Object} RecordHolder
 * @property {string} id Record id: "triumphs" | "wonders" | "settlements" | "captured" | "fastest" | "longest".
 * @property {ArchiveRecord} game The holding game.
 * @property {number} value The figure.
 */

/**
 * Best game by a figure.
 * @param {ArchiveRecord[]} records Candidates.
 * @param {(r:ArchiveRecord) => number} val Figure.
 * @param {boolean} [lowest] Pick the lowest instead of the highest.
 * @returns {ArchiveRecord|null} The game, or null when every figure is 0.
 */
function bestBy(records, val, lowest = false) {
  let best = null;
  for (const r of records) {
    const v = val(r);
    if (v <= 0) continue;
    if (!best || (lowest ? v < val(best) : v > val(best))) best = r;
  }
  return best;
}

/**
 * Record holders across every game.
 * @param {ArchiveRecord[]} records Records.
 * @returns {RecordHolder[]} Holders (records nobody has set are omitted).
 */
export function recordHolders(records) {
  /** @type {Array<[string, (r:ArchiveRecord) => number, ArchiveRecord[], boolean]>} */
  const specs = [
    ["triumphs", (r) => statOf(r, "triumphs"), records, false],
    ["wonders", (r) => statOf(r, "wonders"), records, false],
    ["settlements", (r) => statOf(r, "peakSettlements"), records, false],
    ["captured", (r) => statOf(r, "captured"), records, false],
    ["fastest", (r) => r.turns, records.filter((r) => r.outcome.status === "victory"), true],
    ["longest", (r) => r.turns, records, false]
  ];
  /** @type {RecordHolder[]} */
  const out = [];
  for (const [id, val, pool, lowest] of specs) {
    const game = bestBy(pool, val, lowest);
    if (game) out.push({ id, game, value: val(game) });
  }
  return out;
}
