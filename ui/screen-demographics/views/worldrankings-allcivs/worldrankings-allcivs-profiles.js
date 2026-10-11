import { METRICS } from "/demographics/ui/metrics/demographics-metrics.js";
import { orFallback } from "/demographics/ui/screen-demographics/screen/guarded-reads.js";

/**
 * A civ "profile": the latest non-empty value of each identity field folded
 * across the whole history, plus the latest numeric value of each metric.
 * @typedef {Object} CivProfile
 * @property {string} pid Player id (as a string key).
 * @property {string} leaderKey Stable key (leader type or `"pid:<id>"`).
 * @property {string|undefined} leaderName Most recent non-empty leader name.
 * @property {string|undefined} civName Most recent non-empty civ name.
 * @property {string[]} civNames All distinct civ names seen, in first-seen order.
 * @property {string|undefined} leaderTypeString Engine LeaderType string.
 * @property {string|undefined} civTypeString Engine CivilizationType string.
 * @property {string|undefined} primaryColor Civ primary color (hex/css).
 * @property {string|undefined} secondaryColor Civ secondary color (hex/css).
 * @property {boolean} [met] Whether the local player has met this civ.
 * @property {Record<string, number>} latest Latest numeric value per metric id.
 */

/**
 * Persisted-setting accessor surface read off the render context.
 * @typedef {Object} WorldRankingsAllCivsSettings
 * @property {(key: string, fallback?: *) => *} [getSetting] Read a setting.
 * @property {(key: string, value: *) => void} [setSetting] Write a setting.
 */

/**
 * Render context handed to `render`.
 * @typedef {Object} WorldRankingsAllCivsCtx
 * @property {DemoHistory} [history] The full persisted history blob.
 * @property {WorldRankingsAllCivsSettings} [settings] Persisted-setting accessor.
 */

/**
 * Ranking result for a single metric across all civs.
 * @typedef {Object} RankResult
 * @property {Map<string, number>} ranks Map of pid -> 1-based rank (ties share).
 * @property {number} total Count of civs with a numeric value.
 */

/**
 * Resolve the local player id from the engine `GameContext`, defensively.
 * @returns {number|undefined} Local player (or observer) id, if numeric.
 */
function getLocalId() {
  return orFallback(() => {
    if (typeof GameContext !== "undefined" && GameContext) {
      const playerId = GameContext.localPlayerID;
      if (typeof playerId === "number") return playerId;
      const observerId = GameContext.localObserverID;
      if (typeof observerId === "number") return observerId;
    }
    return undefined;
  });
}

/**
 * Create a fresh, empty `CivProfile` for a player id.
 * @param {string} pid
 * @param {CivSample} civSample The first per-civ sample seen for this pid.
 * @returns {CivProfile} Seeded with the stable leader key.
 */
export function makeBlankProfile(pid, civSample) {
  return {
    pid,
    leaderKey: String(civSample?.leaderType ?? "pid:" + pid),
    leaderName: undefined,
    civName: undefined,
    civNames: [],
    leaderTypeString: undefined,
    civTypeString: undefined,
    primaryColor: undefined,
    secondaryColor: undefined,
    latest: {}
  };
}

/**
 * Fold one per-civ sample's numeric metrics into a profile's `latest` map,
 * keeping every finite value.
 * @param {CivProfile} profile
 * @param {Record<string, *>} metrics
 */
export function mergeProfileMetrics(profile, metrics) {
  for (const metricId of Object.keys(metrics)) {
    const value = metrics[metricId];
    if (typeof value === "number" && isFinite(value)) profile.latest[metricId] = value;
  }
}

/**
 * Return `value` when it is a non-empty string, otherwise `undefined`. Mirrors the
 * `typeof x === "string" && x.length > 0` guard used across the sample fold.
 * @param {*} value
 * @returns {string|undefined}
 */
export function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Fold one sample's leader-name and civ-name identity fields into a profile,
 * tracking distinct civ names in first-seen order.
 * @param {CivProfile} profile
 * @param {CivSample} civSample
 */
export function mergeCivNames(profile, civSample) {
  const leaderName = nonEmptyString(civSample?.leaderName);
  if (leaderName) profile.leaderName = leaderName;
  const civName = nonEmptyString(civSample?.civName);
  if (civName) {
    profile.civName = civName;
    const civNames = profile.civNames;
    if (!civNames.includes(civName)) civNames.push(civName);
  }
}

/**
 * Fold one sample's engine type strings and civ colors into a profile.
 * @param {CivProfile} profile
 * @param {CivSample} civSample
 */
export function mergeCivTypesAndColors(profile, civSample) {
  const leaderTypeString = nonEmptyString(civSample?.leaderTypeString);
  if (leaderTypeString) profile.leaderTypeString = leaderTypeString;
  const civTypeString = nonEmptyString(civSample?.civTypeString);
  if (civTypeString) profile.civTypeString = civTypeString;
  const primaryColor = nonEmptyString(civSample?.primaryColor);
  if (primaryColor) profile.primaryColor = primaryColor;
  const secondaryColor = nonEmptyString(civSample?.secondaryColor);
  if (secondaryColor) profile.secondaryColor = secondaryColor;
}

/**
 * Fold one per-civ sample over an existing profile, overwriting each identity
 * field only when the newer sample carries a non-empty value.
 * @param {CivProfile} profile
 * @param {CivSample} civSample
 */
export function mergeCivSample(profile, civSample) {
  mergeCivNames(profile, civSample);
  mergeCivTypesAndColors(profile, civSample);
  if (typeof civSample?.met === "boolean") profile.met = civSample.met;
  mergeProfileMetrics(profile, civSample?.metrics || {});
}

/**
 * Build a `{ pid -> profile }` map by folding every newer non-empty field over
 * the older one across the full history.
 * @param {DemoHistory|undefined} history
 * @returns {Record<string, CivProfile>} Keyed by player id.
 */
export function buildCivProfiles(history) {
  /** @type {Record<string, CivProfile>} */
  const profiles = {};
  // A repaired/foreign blob can carry a non-array `samples`; treat it as no history.
  const samples = Array.isArray(history?.samples) ? history.samples : [];
  for (const sample of samples) {
    if (!sample?.players) continue;
    for (const pid of Object.keys(sample.players)) {
      const civSample = sample.players[pid];
      if (!profiles[pid]) profiles[pid] = makeBlankProfile(pid, civSample);
      mergeCivSample(profiles[pid], civSample);
    }
  }
  return profiles;
}

/**
 * Compute a `Map<pid, rank>` over all civs that have a numeric value for
 * `metricId`. Ranks are 1-based and ties share a rank.
 * @param {Record<string, CivProfile>} profiles
 * @param {string} metricId
 * @returns {RankResult}
 */
export function computeRanks(profiles, metricId) {
  /** @type {{ pid: string, value: number }[]} */
  const entries = [];
  for (const pid of Object.keys(profiles)) {
    const value = profiles[pid].latest?.[metricId];
    if (typeof value === "number" && isFinite(value)) entries.push({ pid, value });
  }
  entries.sort((a, b) => b.value - a.value);
  const ranks = new Map();
  /** @type {number|undefined} */
  let lastValue;
  let lastRank = 0;
  entries.forEach((entry, i) => {
    if (entry.value !== lastValue) {
      lastRank = i + 1;
      lastValue = entry.value;
    }
    ranks.set(entry.pid, lastRank);
  });
  return { ranks, total: entries.length };
}

/**
 * Whether `pid` leads a metric: ranked first (ties share first place) while at
 * least one ranked civ is behind. A metric where every civ is equal (all zero
 * net migration, say) has no leader, so nothing is highlighted for it.
 * @param {{ ranks: Map<string, number>, total: number }|undefined} info The metric's ranks.
 * @param {string} pid
 * @returns {boolean}
 */
export function leadsMetric(info, pid) {
  if (!info || info.ranks.get(pid) !== 1) return false;
  let firsts = 0;
  for (const rank of info.ranks.values()) if (rank === 1) firsts++;
  return firsts < info.ranks.size;
}

/**
 * Read a boolean persisted setting defensively, returning `fallback` on any
 * error.
 * @param {WorldRankingsAllCivsCtx} ctx
 * @param {string} key
 * @param {boolean} fallback Value used when reading throws or is unavailable.
 * @returns {boolean}
 */
export function readBoolSetting(ctx, key, fallback) {
  try {
    return !!ctx.settings?.getSetting?.(key, fallback);
  } catch (_) {
    return fallback;
  }
}

/**
 * Strip eliminated civs from the profile map in place. The eliminated map
 * comes from `history.eliminated`, populated by the sampler at civ death.
 * @param {Record<string, CivProfile>} profiles
 * @param {DemoHistory|undefined} history
 */
export function stripEliminatedCivs(profiles, history) {
  const eliminated =
    history && history.eliminated && typeof history.eliminated === "object"
      ? history.eliminated
      : {};
  for (const pid of Object.keys(profiles)) {
    if (eliminated[pid] || eliminated[Number(pid)]) {
      delete profiles[pid];
    }
  }
}

/** Diplomacy-category metric ids - the spoiler-gated set (computed once). */
const DIPLOMACY_METRIC_IDS = /** @type {MetricDef[]} */ (METRICS)
  .filter((metric) => metric.category === "diplomacy")
  .map((metric) => metric.id);

/**
 * Spoiler guard (display-time): strip diplomacy-category metric values from the profiles of
 * civs the local player has not met (`met === false`). Both the displayed cells and the rank
 * computation read `latest`, so removing the value here covers both.
 * @param {Record<string, CivProfile>} profiles
 */
export function stripUnmetDiplomacy(profiles) {
  for (const pid of Object.keys(profiles)) {
    const profile = profiles[pid];
    if (profile.met !== false) continue;
    for (const id of DIPLOMACY_METRIC_IDS) delete profile.latest[id];
  }
}

/**
 * Drop every non-local civ from the profile map in place, for the own-civ-only / disabled
 * analytics policy. When the local player can't be resolved, leaves the map untouched.
 * @param {Record<string, CivProfile>} profiles
 */
export function stripNonLocalCivs(profiles) {
  const localId = getLocalId();
  if (typeof localId !== "number") return;
  const keep = String(localId);
  for (const pid of Object.keys(profiles)) {
    if (pid !== keep) delete profiles[pid];
  }
}

/**
 * Pick the local player's pid: the resolved engine id when it has a profile,
 * otherwise the first available pid.
 * @param {Record<string, CivProfile>} profiles
 * @param {string[]} allPids
 * @returns {string}
 */
export function pickLocalPid(profiles, allPids) {
  const localId = getLocalId();
  return typeof localId === "number" && profiles[String(localId)]
    ? String(localId)
    : allPids[0];
}

/**
 * Order the non-local pids by civilization score, highest first (a left→right
 * leaderboard beside the local player's pinned column). Leader name (locale-aware)
 * breaks ties and orders any civ missing a score, which sorts last.
 * @param {Record<string, CivProfile>} profiles
 * @param {string[]} allPids
 * @param {string} localPid The local-column pid to exclude.
 * @returns {string[]}
 */
export function sortOtherPids(profiles, allPids, localPid) {
  const scoreOf = (/** @type {string} */ pid) => {
    const score = profiles[pid]?.latest?.score;
    return typeof score === "number" && isFinite(score) ? score : -Infinity;
  };
  return allPids
    .filter((pid) => pid !== localPid)
    .sort((a, b) => {
      const scoreDiff = scoreOf(b) - scoreOf(a); // descending score
      if (scoreDiff !== 0) return scoreDiff;
      const nameA = profiles[a].leaderName || a;
      const nameB = profiles[b].leaderName || b;
      return nameA.localeCompare(nameB);
    });
}
