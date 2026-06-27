// chart-line-series.js
//
// The history -> per-civ series pipeline for the line chart: fold each player's
// samples into points + identity, resolve leader/civ display names, gate by the
// unmet/back-fill spoiler modes, and emit one ChartSeries per civ. Pure data -
// no Chart.js. Extracted from chart-line.js.

import {
  PALETTE,
  collectCivHistory,
  displayName,
  hideUnmetEnabled,
  backfillMetHistoryEnabled
} from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";
import {
  computeAgeOffsets,
  sampleX
} from "/demographics/ui/screen-demographics/charts/line/chart-line-axis.js";
import {
  preferReadableColor,
  safeTextColor,
  deconflictColors
} from "/demographics/ui/core/civ-color-utils.js";
import {
  policyOwnCivOnly,
  isLocalCiv
} from "/demographics/ui/core/demographics-governance.js";

/**
 * One per-civ data series built from history for a single metric.
 * @typedef {Object} ChartSeries
 * @property {string} name End-of-line / legend display name.
 * @property {number} pid Player id.
 * @property {boolean} met Whether the local player has met this civ.
 * @property {boolean} [eliminated] Whether the civ is eliminated.
 * @property {string} leaderType Stable series key (leader type or `pid:<id>`).
 * @property {string|null} [leaderTypeString] Canonical `LEADER_*` type for icons.
 * @property {string} color Line/swatch color (civ primary or palette).
 * @property {ChartPoint[]} points Plotted points in chart-X order.
 * @property {string[]} allCivNames Distinct civ names seen, chronological.
 */

/**
 * One plotted point: chart-X position and metric value.
 * @typedef {Object} ChartPoint
 * @property {number} t Chart-X (deterministic age-offset position).
 * @property {number} v Metric value.
 */

/**
 * Result of {@link buildSeriesFromHistory}.
 * @typedef {Object} SeriesResult
 * @property {ChartSeries[]} series One entry per civ with >=1 point.
 * @property {number} sampleCount Count of samples scanned.
 */

/**
 * Accumulated per-pid state folded across the sample stream.
 * @typedef {Object} PidFold
 * @property {ChartPoint[]} points Plotted points (chart-X, value).
 * @property {*} leaderType First non-null leader type seen.
 * @property {string|null} leaderTypeString First non-empty canonical `LEADER_*` type.
 * @property {string|null} leaderName First non-empty leader name.
 * @property {string|null} primaryColor Latest non-empty primary color.
 * @property {string|null} secondaryColor Latest non-empty secondary color.
 * @property {boolean|undefined} metFlag Latest `met` flag.
 */

/**
 * Resolve the engine's localized leader name for a leader type, or `null`
 * when GameInfo has no usable row.
 * @param {*} leaderType Engine LeaderType string or hash.
 * @returns {string|null} The localized name, or `null`.
 */
function lookupLeaderName(leaderType) {
  try {
    if (
      typeof GameInfo !== "undefined" &&
      GameInfo.Leaders &&
      typeof GameInfo.Leaders.lookup === "function"
    ) {
      const row = GameInfo.Leaders.lookup(leaderType);
      if (row && row.Name) return composeLeaderName(row.Name);
    }
  } catch (_) {
    // GameInfo.Leaders.lookup may be absent or throw; fall through to null.
  }
  return null;
}

/**
 * Compose a leader Name tag, falling back to the raw tag if Locale is absent
 * or throws.
 * @param {string} name The leader Name tag.
 * @returns {string} The composed (or raw) name.
 */
function composeLeaderName(name) {
  if (typeof Locale !== "undefined" && typeof Locale.compose === "function") {
    try {
      return Locale.compose(name);
    } catch (_) {
      // Locale.compose may throw on a malformed tag; fall through to the raw name.
    }
  }
  return name;
}

/**
 * Compose a friendly leader display name from a leader type, falling back
 * to `"Player <pid>"` for missing/numeric-hash types.
 * @param {*} leaderType Engine LeaderType string or hash.
 * @param {*} pid Player id (for the fallback label).
 * @returns {string} The display name.
 */
function leaderDisplayName(leaderType, pid) {
  if (!leaderType) return "Player " + pid;
  const resolved = lookupLeaderName(leaderType);
  if (resolved) return resolved;
  const s = String(leaderType);
  // Avoid surfacing a raw numeric hash as the display name.
  if (/^-?\d+$/.test(s)) return "Player " + pid;
  return s.replace(/^LEADER_/, "").replace(/_/g, " ");
}

/**
 * Collect every player-id key that appears in any sample.
 * @param {Snapshot[]} samples The sample stream.
 * @returns {string[]} Distinct pid keys.
 */
function collectPidSet(samples) {
  /** @type {Set<string>} */
  const pidSet = new Set();
  for (const s of samples) {
    if (s && s.players) {
      for (const k of Object.keys(s.players)) pidSet.add(k);
    }
  }
  return Array.from(pidSet);
}

  /**
   * Resolve one metric point from a sample/player row.
   * @param {*} sample One sample.
   * @param {*} playerSample One player's row from that sample.
   * @param {string} metricId Metric id.
   * @param {Map<string, number>} ageOffsets Per-age offsets.
   * @param {AgeBoundary[]} ageBoundariesLocal Age boundaries.
   * @returns {{ t: number, v: number }|null} Point, or null when unavailable.
   */
  function metricPoint(sample, playerSample, metricId, ageOffsets, ageBoundariesLocal) {
    const value = playerSample?.metrics ? playerSample.metrics[metricId] : undefined;
    if (typeof value !== "number" || !isFinite(value)) return null;
    const x = sampleX(sample, ageOffsets, ageBoundariesLocal);
    if (typeof x !== "number") return null;
    return { t: x, v: value };
  }

// Metrics that the game mechanically RESETS at an age boundary (Civ VII slashes urban/rural population
// on age rollover; see age-transition-gameeffects.xml). Their raw series dips sharply at each boundary
// and recovers over the new age — an artifact of the mechanic, not a real demographic collapse. For
// these we bridge the dip on the DISPLAYED line so it reads continuously across the boundary.
const AGE_RESET_BRIDGED_METRICS = new Set(["population"]);

/**
 * The chart x-positions of age boundaries: each later age starts at its cumulative offset (the first
 * age starts at 0, which is not a boundary). Sorted ascending.
 * @param {Map<string, number>} ageOffsets Per-age cumulative offsets.
 * @returns {number[]} Boundary x-positions.
 */
function ageBoundaryXs(ageOffsets) {
  if (!ageOffsets || typeof ageOffsets.values !== "function") return [];
  return Array.from(ageOffsets.values())
    .filter((v) => typeof v === "number" && isFinite(v) && v > 0)
    .sort((a, b) => a - b);
}

/**
 * Index of the last point at or before x (−1 if none). Points are ascending by `t`. Inclusive because
 * a prior age's final sample sits exactly AT the boundary x (its max local turn equals the next age's
 * cumulative offset), and that peak is the value we bridge from.
 * @param {{t:number}[]} points Points. @param {number} x Threshold. @returns {number} Index or −1.
 */
function lastIndexAtOrBefore(points, x) {
  let i = -1;
  for (let k = 0; k < points.length; k++) {
    if (points[k].t <= x) i = k;
    else break;
  }
  return i;
}

/**
 * Add back the mechanic's reset as an OFFSET that tapers out by ACTUAL regrowth — NOT by lifting onto a
 * recovery line. The offset is the boundary drop (peak → FIRST post-boundary sample); it shrinks in
 * proportion to how far the running-max has climbed back toward the peak. Because it keys off the
 * running-max (never decreasing), a genuine post-boundary loss (war, razing) still appears as a real
 * drop on the shifted line instead of being masked — which a recovery-line fill could not distinguish.
 *
 * The trough is taken as the FIRST post-boundary sample, deliberately. The sampler records every turn
 * by default (`sampleEveryNTurns: 1`), so the one-turn mechanic reset lands in exactly one sample and
 * this is exact. Under SPARSE sampling the true bottom can fall between samples — we then UNDER-correct
 * (a small residual dip), which is the safe failure: a multi-sample "descent" look-back could instead
 * swallow a real loss a turn or two after the boundary and mask it. Fully separating a multi-sample
 * reset from a reset+loss is impossible from the (t,v) line alone; it would need the mechanic-
 * attributable drop recorded at sample time (the sampler knows the exact transition turn). See the
 * design doc / review-round3 (#3). Mutates; only raises.
 * @param {{t:number,v:number}[]} points Points (mutated). @param {number} i Pre-boundary peak index.
 * @param {number} segEnd Segment-end x. @param {number} vPre Pre-boundary value.
 */
function applyResetOffset(points, i, segEnd, vPre) {
  const trough = points[i + 1].v;
  const drop = vPre - trough; // the mechanic's reset magnitude (conservative: first post-boundary sample)
  if (drop <= 0) return;
  let runningMax = trough;
  for (let k = i + 1; k < points.length && points[k].t < segEnd && points[k].v < vPre; k++) {
    if (points[k].v > runningMax) runningMax = points[k].v;
    const offset = drop * (1 - Math.max(0, Math.min(1, (runningMax - trough) / drop)));
    const lifted = points[k].v + offset;
    if (lifted > points[k].v) points[k] = { t: points[k].t, v: lifted };
  }
}

/**
 * Bridge one age boundary's dip in place (if there is one). The first point after the boundary (within
 * the segment) must dip below the pre-boundary value to qualify.
 * @param {{t:number,v:number}[]} points Points (mutated). @param {number} bx Boundary x.
 * @param {number} segEnd Segment-end x (next boundary or Infinity).
 */
function bridgeOneBoundary(points, bx, segEnd) {
  const i = lastIndexAtOrBefore(points, bx);
  if (i < 0 || i + 1 >= points.length) return;
  const next = points[i + 1];
  const vPre = points[i].v;
  if (!(next.t < segEnd) || next.v >= vPre) return; // no reset dip in this segment
  applyResetOffset(points, i, segEnd, vPre);
}

/**
 * Bridge the post-boundary dip in a reset-prone series by adding back the mechanic's instantaneous
 * reset as a regrowth-tapered offset (see {@link applyResetOffset}). This removes the artificial notch
 * while PRESERVING any genuine post-boundary loss (a war crash still shows as a drop on the shifted
 * line). Capped to the same age segment; only raises points; raw samples untouched.
 * @param {{t:number,v:number}[]} points The series points.
 * @param {number[]} boundaryXs Age boundary x-positions (ascending).
 * @returns {{t:number,v:number}[]} The bridged points.
 */
function bridgeAgeResetDips(points, boundaryXs) {
  if (!Array.isArray(points) || points.length < 3 || !boundaryXs.length) return points;
  for (let m = 0; m < boundaryXs.length; m++) {
    const segEnd = m + 1 < boundaryXs.length ? boundaryXs[m + 1] : Infinity;
    bridgeOneBoundary(points, boundaryXs[m], segEnd);
  }
  return points;
}

/**
 * Fold one pid's per-sample data into points + identity state.
 * @param {Snapshot[]} samples The sample stream.
 * @param {string} pid Player id key.
 * @param {string} metricId Metric id to extract.
 * @param {{ ageOffsets: Map<string, number>, ageBoundariesLocal: AgeBoundary[],
 *   fromContactOnly: boolean }} opts Age offsets/boundaries + contact-gating mode.
 *   `fromContactOnly`: when true, withhold points from samples taken before the
 *   local player met this civ (met === false), so the line begins at first
 *   contact; when false (back-fill mode), all points are kept and the caller
 *   gates the whole civ on its current met status instead.
 * @returns {PidFold} The accumulated fold for this pid. `metFlag` carries the
 *   civ's CURRENT met status (latest sample wins); the caller uses it to gate
 *   the whole civ.
 */
function foldPidSamples(samples, pid, metricId, opts) {
  const { ageOffsets, ageBoundariesLocal, fromContactOnly } = opts;
  /** @type {PidFold} */
  const fold = {
    points: [],
    leaderType: null,
    leaderTypeString: null,
    leaderName: null,
    primaryColor: null,
    secondaryColor: null,
    metFlag: undefined
  };
  for (const s of samples) {
    const ps = s.players && s.players[pid];
    if (!ps) continue;
    mergePidIdentity(fold, ps);
    // "From first contact" mode: drop points taken while still unmet. Met /
    // unknown → kept. In back-fill mode this is skipped entirely (full history).
    if (fromContactOnly && ps.met === false) continue;
    const point = metricPoint(s, ps, metricId, ageOffsets, ageBoundariesLocal);
    if (point) fold.points.push(point);
  }
  // Smooth the mechanical age-reset dip on reset-prone metrics so the displayed line bridges the
  // boundary instead of plunging (the underlying samples are untouched).
  if (AGE_RESET_BRIDGED_METRICS.has(metricId)) {
    bridgeAgeResetDips(fold.points, ageBoundaryXs(ageOffsets));
  }
  return fold;
}

/**
 * Capture the first non-empty canonical "LEADER_*" string into the fold. Kept
 * separate from `mergePidIdentity` so that function stays under the complexity
 * cap. This string (distinct from the raw `leaderType` hash) resolves the
 * leader portrait <fxs-icon> in the tooltip.
 * @param {PidFold} fold Accumulator (mutated).
 * @param {CivSample|*} ps One civ's sample.
 */
function mergeLeaderTypeString(fold, ps) {
  if (
    !fold.leaderTypeString &&
    typeof ps.leaderTypeString === "string" &&
    ps.leaderTypeString.length > 0
  ) {
    fold.leaderTypeString = ps.leaderTypeString;
  }
}

/**
 * Merge the latest non-empty banner colors into the fold. Kept separate from
 * `mergePidIdentity` so that function stays under the complexity cap. The
 * LATEST color wins because civilization swaps at age transitions change banner
 * colors, and the line should reflect the current civ identity.
 * @param {PidFold} fold Accumulator (mutated).
 * @param {CivSample|*} ps One civ's sample.
 */
function mergeBannerColors(fold, ps) {
  if (typeof ps.primaryColor === "string" && ps.primaryColor.length > 0) {
    fold.primaryColor = ps.primaryColor;
  }
  // Secondary is used as a readable fallback line color when the primary banner
  // color is near-black (see preferReadableColor).
  if (typeof ps.secondaryColor === "string" && ps.secondaryColor.length > 0) {
    fold.secondaryColor = ps.secondaryColor;
  }
}

/**
 * Merge one civ sample's identity fields into a pid fold: first non-null
 * leader type / leader name, latest non-empty banner colors, latest met flag.
 * @param {PidFold} fold Accumulator (mutated).
 * @param {CivSample|*} ps One civ's sample.
 */
function mergePidIdentity(fold, ps) {
  if (!fold.leaderType && ps.leaderType !== undefined && ps.leaderType !== null) {
    fold.leaderType = ps.leaderType;
  }
  mergeLeaderTypeString(fold, ps);
  if (!fold.leaderName && typeof ps.leaderName === "string" && ps.leaderName.length > 0) {
    fold.leaderName = ps.leaderName;
  }
  mergeBannerColors(fold, ps);
  if (typeof ps.met === "boolean") fold.metFlag = ps.met; // latest wins
}

/**
 * Live fallback for the civ-name list when history rows carry no civName:
 * pull `player.civilizationName` directly from the engine.
 * @param {string} pid Player id key.
 * @returns {string[]} A single-element civ-name list, or empty on failure.
 */
function liveCivNameFallback(pid) {
  try {
    if (typeof Players?.get !== "function") return [];
    const p = Players.get(Number(pid));
    const live = p?.civilizationName;
    if (typeof live !== "string" || live.length === 0) return [];
    const composed = composeLocale(live);
    if (composed && composed.length > 0) return [composed];
  } catch (_) {
    // Players.get / player.civilizationName may be absent or throw; fall back to empty list.
  }
  return [];
}

/**
 * Compose a localization tag via `Locale.compose`, or echo it when Locale is
 * unavailable.
 * @param {string} tag The localization tag (or literal).
 * @returns {string} The composed string, or `tag`.
 */
function composeLocale(tag) {
  return typeof Locale?.compose === "function" ? Locale.compose(tag) : tag;
}

/**
 * Resolve the leader-only display text for one series.
 * @param {string|null} leaderName Folded leader name.
 * @param {*} leaderType Raw leader-type value.
 * @param {string} pid Player id key.
 * @returns {string} Leader display text.
 */
function leaderOnlyLabel(leaderName, leaderType, pid) {
  if (leaderName) return leaderName;
  if (leaderType !== null) return leaderDisplayName(leaderType, pid);
  return "Player " + pid;
}

/**
 * Resolve final series color from sampled banner colors.
 * @param {*} primaryColor Primary banner color.
 * @param {*} secondaryColor Secondary banner color.
 * @param {number} idx Palette index.
 * @returns {string} Series color.
 */
function seriesColor(primaryColor, secondaryColor, idx) {
  if (typeof primaryColor === "string" && primaryColor.length > 0) {
    return preferReadableColor(primaryColor, secondaryColor);
  }
  return PALETTE[idx % PALETTE.length];
}

/**
 * Build one {@link ChartSeries} from a pid's folded state.
 * @param {Snapshot[]} samples The sample stream.
 * @param {string} pid Player id key.
 * @param {number} idx Index for palette fallback.
 * @param {PidFold} fold The pid's accumulated fold.
 * @param {Record<string, *>} eliminatedMap The history eliminated map.
 * @returns {ChartSeries} The built series.
 */
function buildSeriesEntry(samples, pid, idx, fold, eliminatedMap) {
  const {
    points,
    leaderType,
    leaderTypeString,
    leaderName,
    primaryColor,
    secondaryColor,
    metFlag
  } = fold;
  const key = String(leaderType ?? "pid:" + pid);
  const leaderOnly = leaderOnlyLabel(leaderName, leaderType, pid);
  let allCivNames = collectCivHistory(samples, pid);
  // Live fallback for snapshots that don't carry civName yet
  // (older history rows pre-$hash fix). Pull directly via
  // player.civilizationName so the chart label never says
  // "Augustus" alone when we can resolve "Augustus (Rome)" now.
  if (allCivNames.length === 0) {
    allCivNames = liveCivNameFallback(pid);
  }
  const isEliminated = !!eliminatedMap[String(pid)] || !!eliminatedMap[Number(pid)];
  // Prefer the civ's actual banner color so each line matches the in-game
  // banner. When the primary is near-black (e.g. Alexander), fall back to the
  // civ's secondary banner color so the line stays readable on the dark
  // background. Fall back to the rotating palette only when the sampler didn't
  // capture a color (older saves). Final near-black/dim lift happens in
  // chart-line-datasets via safeTextColor.
  const color = seriesColor(primaryColor, secondaryColor, idx);
  return {
    // End-of-line labels: "Leader (Civ)" or "Leader (Old → New)".
    name: displayName(leaderOnly, allCivNames) + (isEliminated ? " ✝" : ""),
    pid: Number(pid),
    met: metFlag === undefined ? true : metFlag,
    eliminated: isEliminated,
    leaderType: key,
    leaderTypeString,
    color,
    points,
    allCivNames
  };
}

/**
 * Resolve the two unmet-gating modes from settings.
 *  - `backfill`: gating on AND back-fill on → drop a civ only while currently
 *    unmet, otherwise show its full history.
 *  - `fromContactOnly`: gating on AND back-fill off → withhold per-sample points
 *    taken before first contact so the line begins at meeting.
 * Both false when the spoiler guard is off (everything shows).
 * @returns {{ backfill: boolean, fromContactOnly: boolean }} The gate modes.
 */
function resolveUnmetGateModes() {
  const gateUnmet = hideUnmetEnabled();
  const backfill = gateUnmet && backfillMetHistoryEnabled();
  return { backfill, fromContactOnly: gateUnmet && !backfill };
}

/**
 * Build per-civ series from a history blob for one metric id. Each civ's
 * X positions are derived from a freshly computed age-offset table.
 * @param {DemoHistory|*} history The persisted history blob.
 * @param {string} metricId Metric id to chart.
 * @returns {SeriesResult} The series list and sample count.
 */
function buildSeriesFromHistory(history, metricId) {
  const samples = history && Array.isArray(history.samples) ? history.samples : [];
  if (samples.length === 0) return { series: [], sampleCount: 0 };
  const eliminatedMap =
    history && history.eliminated && typeof history.eliminated === "object"
      ? history.eliminated
      : {};

  // Compute age offsets once for this render pass; every sample's X
  // position is derived from this table.
  const ageBoundariesLocal =
    history && Array.isArray(history.ageBoundaries) ? history.ageBoundaries : [];
  const { offsets: ageOffsets } = computeAgeOffsets(samples, ageBoundariesLocal);

  const { backfill, fromContactOnly } = resolveUnmetGateModes();
  // Governance (P0.1): under own-civ-only / disabled, only the local player's
  // own series may render at all.
  const ownOnly = policyOwnCivOnly();
  const pids = collectPidSet(samples);
  /** @type {ChartSeries[]} */
  const series = [];
  pids.forEach((pid, idx) => {
    if (ownOnly && !isLocalCiv(pid)) return;
    const fold = foldPidSamples(samples, pid, metricId, {
      ageOffsets,
      ageBoundariesLocal,
      fromContactOnly
    });
    // Back-fill mode: drop a civ only while it is still unmet (latest met flag
    // === false); once met the whole line is revealed. From-contact mode keeps
    // currently-unmet civs too - their points were already withheld in the fold,
    // so they simply have no pre-contact data.
    if (backfill && fold.metFlag === false) return;
    if (fold.points.length >= 1) {
      series.push(buildSeriesEntry(samples, pid, idx, fold, eliminatedMap));
    }
  });
  finalizeSeriesColors(series);
  return { series, sampleCount: samples.length };
}

/**
 * Resolve every series' final display color in one global pass: lift each
 * chosen banner color for readability (near-black / dim-blue), then deconflict
 * the whole set so no two civs share a near-identical line color - reassigning
 * collisions to arbitrary, well-separated colors. Earlier series keep their
 * color, so banner identity is preserved wherever possible.
 * @param {ChartSeries[]} series The built series (mutated in place).
 */
function finalizeSeriesColors(series) {
  const lifted = series.map((s) => safeTextColor(s.color));
  const finalColors = deconflictColors(lifted);
  series.forEach((s, i) => {
    s.color = finalColors[i];
  });
}

export { buildSeriesFromHistory };
