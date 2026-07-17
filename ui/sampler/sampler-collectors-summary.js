// sampler-collectors-summary.js
//
// Per-civ collectors sourced from the engine-native Game.Summary adapter:
// Tourism (city-scope culture-victory-points total) and Great People Earned
// (player-scope cumulative). These read empty until the game generates the data
// (Tourism needs tourism sources; Great People needs one earned), so the tab
// auto-hide keeps them out of the selector until then.
//
// buildPlayerCtx runs once per player within a single turn's sample, so the
// batch Summary reads are memoized per turn (one getDataSets pass per dataset per
// turn) and each per-player call just looks up its id.

import { datasetByPlayer, summaryAvailable } from "/demographics/ui/sampler/sampler-game-summary.js";

/** The turn the memo below was built for (-1 = empty). */
let _memoTurn = -1;
/** @type {Map<string, Map<number, number>>} datasetKey → (pid → value). */
const _memo = new Map();

/**
 * Current game turn, defensively (0 when unavailable).
 * @returns {number} The turn.
 */
function currentTurn() {
  try {
    return typeof Game !== "undefined" && typeof Game.turn === "number" ? Game.turn : 0;
  } catch (_) {
    return 0;
  }
}

/**
 * A per-turn-memoized `datasetByPlayer` map, so the getDataSets pass runs once
 * per dataset per turn rather than once per player.
 * @param {string} datasetId The Hall-of-Fame dataset id.
 * @param {"Player"|"City"} scope The owning-object type.
 * @param {boolean} delta Sum (delta series) vs latest (level series).
 * @returns {Map<number, number>} pid → value.
 */
function memoByPlayer(datasetId, scope, delta) {
  const turn = currentTurn();
  if (turn !== _memoTurn) {
    _memoTurn = turn;
    _memo.clear();
  }
  let m = _memo.get(datasetId);
  if (!m) {
    m = datasetByPlayer(datasetId, turn, scope, delta);
    _memo.set(datasetId, m);
  }
  return m;
}

/**
 * Stamp Game.Summary-sourced metrics onto a player's ctx: `tourism` (city-scope
 * sum) and `greatPeople` (player-scope cumulative). No-op when Summary is
 * unavailable or the civ has no such data yet.
 * @param {import("/demographics/ui/sampler/sampler-collectors-core.js").PlayerCtx} ctx The context.
 * @param {Pid} id The player id.
 */
export function collectSummaryMetrics(ctx, id) {
  if (!summaryAvailable()) return;
  stampPlayer(ctx, id, "tourism", memoByPlayer("Tourism", "City", false));
  stampPlayer(ctx, id, "greatPeople", memoByPlayer("GreatPeopleEarned", "Player", true));
  stampPlayer(ctx, id, "unitsKilled", memoByPlayer("UnitsKilled", "Player", true));
  stampPlayer(ctx, id, "unitsLost", memoByPlayer("UnitsLost", "Player", true));
  stampPlayer(ctx, id, "faith", memoByPlayer("Faith", "Player", false));
  stampPlayer(ctx, id, "combats", memoByPlayer("Combats", "Player", true));
  stampPlayer(ctx, id, "warsDeclared", memoByPlayer("WarsDeclared", "Player", true));
  stampPlayer(ctx, id, "warsReceived", memoByPlayer("WarsReceived", "Player", true));
  stampPlayer(ctx, id, "naturalWonders", memoByPlayer("NaturalWondersDiscovered", "Player", true));
}

/**
 * Write `map`'s value for `id` onto `ctx[field]` when it is a finite number.
 * @param {*} ctx The per-player context.
 * @param {Pid} id The player id.
 * @param {string} field The ctx field to set.
 * @param {Map<number, number>} map The per-player value map.
 */
function stampPlayer(ctx, id, field, map) {
  const v = map.get(id);
  if (typeof v === "number" && isFinite(v)) ctx[field] = v;
}
