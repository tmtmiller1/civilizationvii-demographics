// demographics-telemetry.js
//
// Balance telemetry + alert thresholds (combined design plan P2.7).
//
// Beyond the per-sample DURATION timing already logged from the sampler, this
// emits a BALANCE-health signal: a suspected runaway leader , one civ whose
// score dominates the field (by share of total AND multiple of the median).
// That's the demographics-side analogue of the emigration net-flow / refugee
// concentration alerts, surfacing snowballing during playtests.
//
// Debug-gated (DBG flipped off for release) and throttled, so a shipped build is
// silent and the log isn't spammed. Reads the snapshot the sampler just built;
// never throws.

const DBG = false;

// Throttle: emit at most once per this many sampled turns.
const REPORT_INTERVAL = 10;
// A leader holding at least this share of all score, and at least this multiple
// of the median civ's score, is flagged as a suspected runaway.
const SCORE_DOMINANCE_SHARE = 0.4;
const SCORE_MEDIAN_MULTIPLE = 2.5;
const MIN_CIVS = 3;

let _lastReportTurn = -999;

/**
 * Emit a balance message (console-only, debug-gated).
 * @param {string} msg The message.
 */
function blog(msg) {
  if (!DBG) return;
  try {
    console.warn("[Demographics.balance] " + msg);
  } catch (_) {
    /* ignore */
  }
}

/**
 * Collect each major player's `score` metric from a snapshot.
 * @param {*} snapshot The sampler snapshot ({ players: { pid: { metrics } } }).
 * @returns {{pid:string, score:number}[]} Per-civ scores (score >= 0).
 */
function scoresFromSnapshot(snapshot) {
  const players = snapshot && snapshot.players ? snapshot.players : null;
  if (!players) return [];
  /** @type {{pid:string, score:number}[]} */
  const out = [];
  for (const pid of Object.keys(players)) {
    const m = players[pid] && players[pid].metrics;
    const score = m && typeof m.score === "number" ? m.score : 0;
    if (score > 0) out.push({ pid, score });
  }
  return out;
}

/**
 * The median of a numeric list (0 for empty).
 * @param {number[]} nums The values.
 * @returns {number} The median.
 */
function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Emit a suspected-runaway-leader alert when one civ's score dominates by both
 * share-of-total and multiple-of-median. Debug-gated + throttled; never throws.
 * @param {*} snapshot The sampler snapshot just built.
 * @param {number} turn The (chart) turn the snapshot was taken on.
 */
export function reportBalanceSignals(snapshot, turn) {
  try {
    if (typeof turn === "number" && turn - _lastReportTurn < REPORT_INTERVAL) return;
    const scores = scoresFromSnapshot(snapshot);
    if (scores.length < MIN_CIVS) return;
    _lastReportTurn = typeof turn === "number" ? turn : _lastReportTurn;
    const values = scores.map((s) => s.score);
    const total = values.reduce((a, b) => a + b, 0);
    const top = scores.reduce((a, b) => (b.score > a.score ? b : a), scores[0]);
    const med = median(values);
    const share = total > 0 ? top.score / total : 0;
    const multiple = med > 0 ? top.score / med : 0;
    if (share >= SCORE_DOMINANCE_SHARE && multiple >= SCORE_MEDIAN_MULTIPLE) {
      blog(
        "suspected runaway leader civ=" + top.pid + " score=" + Math.round(top.score) +
          " share=" + Math.round(share * 100) + "pct median x" + multiple.toFixed(1) +
          " (>= " + Math.round(SCORE_DOMINANCE_SHARE * 100) + "pct & x" + SCORE_MEDIAN_MULTIPLE + ")"
      );
    }
  } catch (_) {
    /* telemetry must never disrupt sampling */
  }
}
