import { METRICS } from "/demographics/ui/demographics-metrics.js";

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
 * @typedef {Object} FactbookSettings
 * @property {(key: string, fallback?: *) => *} [getSetting] Read a setting.
 * @property {(key: string, value: *) => void} [setSetting] Write a setting.
 */

/**
 * Render context handed to `render`.
 * @typedef {Object} FactbookCtx
 * @property {DemoHistory} [history] The full persisted history blob.
 * @property {FactbookSettings} [settings] Persisted-setting accessor.
 */

/**
 * Ranking result for a single metric across all civs.
 * @typedef {Object} RankResult
 * @property {Map<string, number>} ranks Map of pid -> 1-based rank (ties share).
 * @property {number} total Count of civs with a numeric value.
 */

/**
 * Invoke `fn` and return its result, or `fb` if it throws.
 * @template T
 * @param {() => T} fn Thunk to evaluate.
 * @param {T} [fb] Fallback returned on throw.
 * @returns {T|undefined} `fn()` result, or `fb`.
 */
function safeCall(fn, fb) {
  try {
    return fn();
  } catch (_) {
    // Defensive engine-boundary wrapper - `fn` reads GameContext.localPlayerID
    // / localObserverID, which can throw; return the fallback.
    return fb;
  }
}

/**
 * Resolve the local player id from the engine `GameContext`, defensively.
 * @returns {number|undefined} Local player (or observer) id, if numeric.
 */
function getLocalId() {
  return safeCall(() => {
    if (typeof GameContext !== "undefined" && GameContext) {
      const v = GameContext.localPlayerID;
      if (typeof v === "number") return v;
      const o = GameContext.localObserverID;
      if (typeof o === "number") return o;
    }
    return undefined;
  });
}

/**
 * Create a fresh, empty `CivProfile` for a player id.
 * @param {string} pid Player id (string key).
 * @param {CivSample} ps The first per-civ sample seen for this pid.
 * @returns {CivProfile} A blank profile seeded with the stable leader key.
 */
export function makeBlankProfile(pid, ps) {
  return {
    pid,
    leaderKey: String(ps?.leaderType ?? "pid:" + pid),
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
 * @param {CivProfile} profile Profile to mutate.
 * @param {Record<string, *>} metrics Per-metric values from the sample.
 */
export function mergeProfileMetrics(profile, metrics) {
  for (const k of Object.keys(metrics)) {
    const v = metrics[k];
    if (typeof v === "number" && isFinite(v)) profile.latest[k] = v;
  }
}

/**
 * Return `v` when it is a non-empty string, otherwise `undefined`. Mirrors the
 * `typeof x === "string" && x.length > 0` guard used across the sample fold.
 * @param {*} v Candidate value.
 * @returns {string|undefined} The string if non-empty, else `undefined`.
 */
export function nonEmptyString(v) {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Fold one sample's leader-name and civ-name identity fields into a profile,
 * tracking distinct civ names in first-seen order.
 * @param {CivProfile} profile Profile to mutate.
 * @param {CivSample} ps One civ's sample.
 */
export function mergeCivNames(profile, ps) {
  const leaderName = nonEmptyString(ps?.leaderName);
  if (leaderName) profile.leaderName = leaderName;
  const civName = nonEmptyString(ps?.civName);
  if (civName) {
    profile.civName = civName;
    const arr = profile.civNames;
    if (!arr.includes(civName)) arr.push(civName);
  }
}

/**
 * Fold one sample's engine type strings and civ colors into a profile.
 * @param {CivProfile} profile Profile to mutate.
 * @param {CivSample} ps One civ's sample.
 */
export function mergeCivTypesAndColors(profile, ps) {
  const leaderTypeString = nonEmptyString(ps?.leaderTypeString);
  if (leaderTypeString) profile.leaderTypeString = leaderTypeString;
  const civTypeString = nonEmptyString(ps?.civTypeString);
  if (civTypeString) profile.civTypeString = civTypeString;
  const primaryColor = nonEmptyString(ps?.primaryColor);
  if (primaryColor) profile.primaryColor = primaryColor;
  const secondaryColor = nonEmptyString(ps?.secondaryColor);
  if (secondaryColor) profile.secondaryColor = secondaryColor;
}

/**
 * Fold one per-civ sample over an existing profile, overwriting each identity
 * field only when the newer sample carries a non-empty value.
 * @param {CivProfile} profile Profile to mutate.
 * @param {CivSample} ps One civ's sample.
 */
export function mergeCivSample(profile, ps) {
  mergeCivNames(profile, ps);
  mergeCivTypesAndColors(profile, ps);
  if (typeof ps?.met === "boolean") profile.met = ps.met;
  mergeProfileMetrics(profile, ps?.metrics || {});
}

/**
 * Build a `{ pid -> profile }` map by folding every newer non-empty field over
 * the older one across the full history.
 * @param {DemoHistory|undefined} history The persisted history blob.
 * @returns {Record<string, CivProfile>} Profiles keyed by player id.
 */
export function buildCivProfiles(history) {
  /** @type {Record<string, CivProfile>} */
  const profiles = {};
  const samples = history?.samples || [];
  for (const s of samples) {
    if (!s?.players) continue;
    for (const pid of Object.keys(s.players)) {
      const ps = s.players[pid];
      if (!profiles[pid]) profiles[pid] = makeBlankProfile(pid, ps);
      mergeCivSample(profiles[pid], ps);
    }
  }
  return profiles;
}

/**
 * Compute a `Map<pid, rank>` over all civs that have a numeric value for
 * `metricId`. Ranks are 1-based and ties share a rank.
 * @param {Record<string, CivProfile>} profiles All civ profiles.
 * @param {string} metricId Metric id to rank by.
 * @returns {RankResult} The rank map and the count of ranked civs.
 */
export function computeRanks(profiles, metricId) {
  /** @type {{ pid: string, v: number }[]} */
  const entries = [];
  for (const pid of Object.keys(profiles)) {
    const v = profiles[pid].latest?.[metricId];
    if (typeof v === "number" && isFinite(v)) entries.push({ pid, v });
  }
  entries.sort((a, b) => b.v - a.v);
  const ranks = new Map();
  /** @type {number|undefined} */
  let lastV;
  let lastRank = 0;
  entries.forEach((e, i) => {
    if (e.v !== lastV) {
      lastRank = i + 1;
      lastV = e.v;
    }
    ranks.set(e.pid, lastRank);
  });
  return { ranks, total: entries.length };
}

/**
 * Read a boolean persisted setting defensively, returning `fallback` on any
 * error.
 * @param {FactbookCtx} ctx Render context.
 * @param {string} key Setting key.
 * @param {boolean} fallback Value used when reading throws or is unavailable.
 * @returns {boolean} The coerced setting value.
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
 * @param {Record<string, CivProfile>} profiles Profiles to filter (mutated).
 * @param {DemoHistory|undefined} history Source history blob.
 */
export function stripEliminatedCivs(profiles, history) {
  const elim =
    history && history.eliminated && typeof history.eliminated === "object"
      ? history.eliminated
      : {};
  for (const pid of Object.keys(profiles)) {
    if (elim[pid] || elim[Number(pid)]) {
      delete profiles[pid];
    }
  }
}

/** Diplomacy-category metric ids - the spoiler-gated set (computed once). */
const DIPLOMACY_METRIC_IDS = /** @type {MetricDef[]} */ (METRICS)
  .filter((m) => m.category === "diplomacy")
  .map((m) => m.id);

/**
 * Spoiler guard (display-time): strip diplomacy-category metric values from the
 * profiles of civs the local player has not met (`met === false`), so the
 * factbook renders the missing-value placeholder instead of leaking their
 * reputation / influence / deals. Both the displayed cells and the rank
 * computation read `latest`, so removing the value here covers both. Reversible
 * - only called when `hideUnmetStats` is on.
 * @param {Record<string, CivProfile>} profiles Profiles to filter (mutated).
 */
export function stripUnmetDiplomacy(profiles) {
  for (const pid of Object.keys(profiles)) {
    const p = profiles[pid];
    if (p.met !== false) continue;
    for (const id of DIPLOMACY_METRIC_IDS) delete p.latest[id];
  }
}

/**
 * Pick the local player's pid: the resolved engine id when it has a profile,
 * otherwise the first available pid.
 * @param {Record<string, CivProfile>} profiles All profiles.
 * @param {string[]} allPids All profile pids.
 * @returns {string} The local-column pid.
 */
export function pickLocalPid(profiles, allPids) {
  const localId = getLocalId();
  return typeof localId === "number" && profiles[String(localId)]
    ? String(localId)
    : allPids[0];
}

/**
 * Order the non-local pids by leader name (locale-aware), falling back to the
 * pid string when a leader name is absent.
 * @param {Record<string, CivProfile>} profiles All profiles.
 * @param {string[]} allPids All profile pids.
 * @param {string} localPid The local-column pid to exclude.
 * @returns {string[]} The sorted non-local pids.
 */
export function sortOtherPids(profiles, allPids, localPid) {
  return allPids
    .filter((p) => p !== localPid)
    .sort((a, b) => {
      const na = profiles[a].leaderName || a;
      const nb = profiles[b].leaderName || b;
      return na.localeCompare(nb);
    });
}
