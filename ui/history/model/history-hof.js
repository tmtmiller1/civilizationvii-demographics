// history-hof.js
//
// Pure: Hall of Fame figures computed from archive records. No engine access, no DOM.
// ("hof" in file names is the Hall of Fame.)
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
 * @param {ArchiveRecord} rec
 * @param {keyof ArchiveRecord["stats"]} key
 * @returns {number}
 */
export function statOf(rec, key) {
  const value = rec.stats ? rec.stats[key] : 0;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Records to show.
 * @param {ArchiveRecord[]} records
 * @param {{showShort?: boolean, keep?: string}} [opts] Show short unfinished games too; always keep
 *   one id (the game being played).
 * @returns {ArchiveRecord[]} Visible records, newest first.
 */
export function visibleRecords(records, opts = {}) {
  return records
    .filter((rec) =>
      opts.showShort || rec.id === opts.keep || rec.outcome.status !== "in_progress" || rec.turns >= SHORT_GAME_TURNS)
    .sort((a, b) => b.updated - a.updated);
}

/** @param {HistoryStatus} status */
function outcomeWeight(status) {
  return status === "victory" ? 0 : status === "defeat" || status === "ended" ? 1 : 2;
}

/**
 * Games in ranking order.
 * @param {ArchiveRecord[]} records
 * @returns {ArchiveRecord[]} A ranked copy.
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
 *   its 1-based rank, and its neighbors.
 */

/**
 * The best games, and where the current game stands among them.
 * @param {ArchiveRecord[]} records Visible games.
 * @param {string} [currentId] The game being played; when absent, the most recently updated game.
 * @param {number} [topN] How many of the best to list.
 * @returns {Standing}
 */
export function standing(records, currentId = "", topN = 10) {
  const order = ranked(records);
  const latest = records.slice().sort((a, b) => b.updated - a.updated)[0];
  const id = currentId && order.some((r) => r.id === currentId) ? currentId : latest?.id;
  const index = order.findIndex((r) => r.id === id);
  return {
    order,
    top: order.slice(0, topN),
    current: index < 0
      ? null
      : {
        rec: order[index],
        rank: index + 1,
        of: order.length,
        above: order[index - 1] || null,
        below: order[index + 1] || null
      }
  };
}

/**
 * Honorific index (1 = best) for a game, against the best game's Triumphs.
 * @param {ArchiveRecord} rec
 * @param {number} best Highest Triumph count among all games.
 * @returns {number} 1..TITLE_COUNT.
 */
export function titleIndex(rec, best) {
  if (best <= 0) return TITLE_COUNT;
  const share = Math.max(0, Math.min(1, statOf(rec, "triumphs") / best));
  return 1 + Math.round((1 - share) * (TITLE_COUNT - 1));
}

/**
 * @template T
 * @param {T[]} items
 * @param {(item:T) => string} key
 * @returns {Map<string, number>}
 */
function tally(items, key) {
  const counts = new Map();
  for (const it of items) {
    const bucket = key(it);
    if (bucket) counts.set(bucket, (counts.get(bucket) || 0) + 1);
  }
  return counts;
}

/** @param {Map<string, number>} counts */
function topKey(counts) {
  let best = "";
  let most = 0;
  for (const [candidate, count] of counts) {
    if (count > most) {
      best = candidate;
      most = count;
    }
  }
  return best;
}

/**
 * Overview figures.
 * @param {ArchiveRecord[]} records
 * @returns {{games:number, victories:number, finished:number, turns:number, triumphs:number,
 *   favoriteLeader:string, victoriesByType:Array<[string, number]>, latest: ArchiveRecord|null}}
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
 * @param {Map<string, GroupRow & {turnSum:number}>} rows Accumulator.
 * @param {string} key
 * @param {string} name LOC tag.
 * @param {ArchiveRecord} rec
 */
function fold(rows, key, name, rec) {
  const blank = {
    key, name, games: 0, wins: 0, losses: 0, ended: 0, open: 0, finished: 0, bestTriumphs: 0, avgTurns: 0, turnSum: 0
  };
  const row = rows.get(key) || blank;
  row.games++;
  if (rec.outcome.status !== "in_progress") row.finished++;
  if (rec.outcome.status === "victory") row.wins++;
  else if (rec.outcome.status === "defeat") row.losses++;
  else if (rec.outcome.status === "ended") row.ended++;
  else row.open++;
  row.bestTriumphs = Math.max(row.bestTriumphs, statOf(rec, "triumphs"));
  row.turnSum += rec.turns;
  row.avgTurns = Math.round(row.turnSum / row.games);
  rows.set(key, row);
}

/**
 * Who a game counts toward in one Hall of Fame table: a type key and its name's LOC tag.
 * @typedef {{key: string, name: string}} TallyEntry
 */

/**
 * Tally games into one row per key, most played first, then most won. A game that lists the same
 * key twice counts once, under the first name it gives.
 * @param {ArchiveRecord[]} records
 * @param {(r: ArchiveRecord) => TallyEntry[]} entriesOf Who each game counts toward.
 * @returns {GroupRow[]}
 */
export function tallyGames(records, entriesOf) {
  const rows = new Map();
  for (const rec of records) {
    const counted = new Set();
    for (const { key, name } of entriesOf(rec)) {
      if (counted.has(key)) continue;
      counted.add(key);
      fold(rows, key, name, rec);
    }
  }
  return [...rows.values()].sort((a, b) => b.games - a.games || b.wins - a.wins);
}

/**
 * A game counts toward the leader who played it.
 * @param {ArchiveRecord} r @returns {TallyEntry[]}
 */
export const byLeader = (r) => [{ key: r.leader, name: r.leaderName }];

/**
 * A game counts toward every civilization led in any of its ages.
 * @param {ArchiveRecord} r @returns {TallyEntry[]}
 */
export const byCivilization = (r) => r.civs.map((c) => ({ key: c.civ, name: c.name }));

/**
 * @typedef {Object} RecordHolder
 * @property {string} id Record id: "triumphs" | "wonders" | "settlements" | "captured" | "fastest" | "longest".
 * @property {ArchiveRecord} game The holding game.
 * @property {number} value The figure.
 */

/**
 * @param {ArchiveRecord[]} records
 * @param {(r:ArchiveRecord) => number} val
 * @param {boolean} [lowest] Pick the lowest instead of the highest.
 */
function bestBy(records, val, lowest = false) {
  let best = null;
  for (const rec of records) {
    const value = val(rec);
    if (value <= 0) continue;
    if (!best || (lowest ? value < val(best) : value > val(best))) best = rec;
  }
  return best;
}

/**
 * Record holders across every game.
 * @param {ArchiveRecord[]} records
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
