// chart-line.js
//
// The main per-civ time-series line chart (Chart.js): renderChart plus its
// private series builders, wonder-marker overlay, crisis / age-boundary
// markers, focus-glow / hover-crosshair / cap-limit plugins, and the HTML
// tooltip. Migrated verbatim from the original demographics-chart.js.

import { getMetric } from "/demographics/ui/demographics-metrics.js";
import { DemographicsSettings } from "/demographics/ui/demographics-settings.js";
import {
  dlog,
  PALETTE,
  collectCivHistory,
  displayName,
  getXAxisMode,
  coerceKeySet,
  resolveLocalPid,
  resolveTurnRange,
  addLiveTurnYear,
  nearestByTurn,
  escapeHtml
} from "/demographics/ui/screen-demographics/chart-shared.js";

/**
 * Error logger for this module. Always logs (unlike the gated {@link dlog}) so
 * own-logic bugs surface in UI.log rather than being silently swallowed.
 * @param {...*} a Values to log.
 * @returns {void}
 */
function derr(...a) {
  console.error("[Demographics.chart-line]", ...a);
}

/**
 * One per-civ data series built from history for a single metric.
 * @typedef {Object} ChartSeries
 * @property {string} name End-of-line / legend display name.
 * @property {number} pid Player id.
 * @property {boolean} met Whether the local player has met this civ.
 * @property {boolean} [eliminated] Whether the civ is eliminated.
 * @property {string} leaderType Stable series key (leader type or `pid:<id>`).
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

// Brighten a civ primary color when it's about to be painted as TEXT or a
// small swatch on the dark tooltip background. Civs with dark-blue / dark-
// purple primaries (Persia, etc.) become unreadable as-is on `img-tooltip-bg`.
// Handles both plain hex (#RRGGBB), 8-char ARGB (#AARRGGBB), and rgba()
// (which is produced by colorWithAlpha for dimmed lines). Channels are
// scaled proportionally so the hue is preserved while the perceived
// luminance is dragged up over a readability floor.
/**
 * Brighten a dim blue civ color so it reads as text/swatch on the dark
 * tooltip background, preserving hue. Pass-through for non-string or
 * non-blue-dominant inputs.
 * @param {*} input Plain hex, 8-char ARGB, or `rgba()` color.
 * @returns {*} The (possibly lifted) color, or `input` unchanged.
 */
function tooltipSafeTextColor(input) {
  if (typeof input !== "string") return input;
  let r, g, b;
  let alphaSuffix = "";
  const hexMatch = input.match(/^#?([0-9a-fA-F]{6,8})$/);
  const rgbaMatch = input.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\)$/);
  if (hexMatch) {
    const rgb = hexMatch[1].slice(-6);
    r = parseInt(rgb.slice(0, 2), 16);
    g = parseInt(rgb.slice(2, 4), 16);
    b = parseInt(rgb.slice(4, 6), 16);
  } else if (rgbaMatch) {
    r = parseInt(rgbaMatch[1], 10);
    g = parseInt(rgbaMatch[2], 10);
    b = parseInt(rgbaMatch[3], 10);
    if (rgbaMatch[4] !== undefined) alphaSuffix = "," + rgbaMatch[4];
  } else {
    return input;
  }
  // Lift dim blue civ colors so their text/swatch reads on the dark
  // tooltip background. Criteria:
  //   1. Blue is the dominant channel (with a small gap over r/g)
  //   2. Perceived luminance is below a readability floor
  // Reds, greens, browns, purples without a dominant blue pass through.
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const isBlueDominant = b >= r && b >= g && b > Math.max(r, g) + 10;
  if (!isBlueDominant || lum >= 110) return input;
  // Scale all channels so blue lands near 230 — bright enough to read
  // on rgba(12,9,6,0.96) while preserving the hue.
  const scale = 230 / Math.max(b, 1);
  r = Math.min(255, Math.round(r * scale));
  g = Math.min(255, Math.round(g * scale));
  b = Math.min(255, Math.round(b * scale));
  if (alphaSuffix) return "rgba(" + r + "," + g + "," + b + alphaSuffix + ")";
  /**
   * Format one 0-255 channel as a 2-digit hex pair.
   * @param {number} n Channel value.
   * @returns {string} Zero-padded hex pair.
   */
  const hex2 = (n) => n.toString(16).padStart(2, "0");
  return "#" + hex2(r) + hex2(g) + hex2(b);
}

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
      if (row && row.Name) {
        if (typeof Locale !== "undefined" && typeof Locale.compose === "function") {
          try {
            return Locale.compose(row.Name);
          } catch (_) {
            // Locale.compose may throw on a malformed tag; fall through to the raw row.Name.
          }
        }
        return row.Name;
      }
    }
  } catch (_) {
    // GameInfo.Leaders.lookup may be absent or throw; fall through to null.
  }
  return null;
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

// Build series from a history object for one metric id.
// Compute a sample's "global" X-axis position deterministically from
// (age, localTurn) — no stored offset, no statefulness. Antiquity samples
// land at X = localTurn, exploration at X = antiquityMax + localTurn,
// modern at X = antiquityMax + explorationMax + localTurn. This is what
// the user described as "start exploration at antiquity-turn-count + 1,
// modern at antiquity + exploration + 1". The offsets are recomputed on
// every render from the samples themselves so no historical bug can
// permanently corrupt the X axis.
const AGE_ORDER = ["AGE_ANTIQUITY", "AGE_EXPLORATION", "AGE_MODERN"];
/**
 * Infer a sample's age type. Trusts explicit `s.age`; legacy samples without
 * it predate age-tagging and are treated as Antiquity.
 * @param {Snapshot|*} s One sample.
 * @param {AgeBoundary[]} [_ageBoundaries] Unused (kept for call-site parity).
 * @returns {string} The age type string.
 */
function inferSampleAge(s, _ageBoundaries) {
  // Trust explicit `s.age` whenever present.
  if (s && typeof s.age === "string") return s.age;
  // Legacy samples without `age` predate the age-tagging code, which
  // means they MUST be antiquity (it was the only age that existed when
  // those samples were written). Earlier we tried to bucket them via the
  // ageBoundaries table, but boundary `.turn` is now stored as age-local
  // (=1) which collapses every legacy sample into the latest age — the
  // opposite of what we want. Just return antiquity unconditionally.
  return "AGE_ANTIQUITY";
}
/**
 * Infer a sample's age-local turn. Uses explicit `localTurn`, else the stored
 * `turn` (age-local for legacy samples), else `null`.
 * @param {Snapshot|*} s One sample.
 * @param {string} [_age] Unused (kept for call-site parity).
 * @param {AgeBoundary[]} [_ageBoundaries] Unused (kept for call-site parity).
 * @returns {number|null} The age-local turn, or `null`.
 */
function inferLocalTurn(s, _age, _ageBoundaries) {
  // Use explicit localTurn when present, otherwise fall back to the
  // stored turn (which IS age-local for legacy samples, since they were
  // never offset).
  if (s && typeof s.localTurn === "number") return s.localTurn;
  if (s && typeof s.turn === "number") return s.turn;
  return null;
}

/**
 * Compute cumulative per-age X-axis offsets from the samples' max age-local
 * turns, so each age's first turn lands right after the prior age ends.
 * @param {Snapshot[]} samples The sample stream.
 * @param {AgeBoundary[]} ageBoundaries Age boundary table.
 * @returns {{ offsets: Map<string, number>, maxLocalByAge: Map<string, number> }}
 *   The per-age cumulative offset map and the per-age max-local-turn map.
 */
function computeAgeOffsets(samples, ageBoundaries) {
  /** @type {Map<string, number>} */
  const maxLocalByAge = new Map();
  for (const s of samples) {
    if (!s || typeof s !== "object") continue;
    const age = inferSampleAge(s, ageBoundaries);
    const lt = inferLocalTurn(s, age, ageBoundaries);
    if (lt === null) continue;
    const prev = maxLocalByAge.get(age) || 0;
    if (lt > prev) maxLocalByAge.set(age, lt);
  }
  /** @type {Map<string, number>} */
  const offsets = new Map();
  let cum = 0;
  for (const age of AGE_ORDER) {
    offsets.set(age, cum);
    cum += maxLocalByAge.get(age) || 0;
  }
  return { offsets, maxLocalByAge };
}

/**
 * Compute a sample's deterministic chart-X position from its age offset plus
 * age-local turn, falling back to the raw stored `turn`.
 * @param {Snapshot|*} sample One sample.
 * @param {Map<string, number>} offsets Per-age cumulative offsets.
 * @param {AgeBoundary[]} ageBoundaries Age boundary table.
 * @returns {number|undefined} The chart-X position, or `undefined`.
 */
function sampleX(sample, offsets, ageBoundaries) {
  if (!sample) return undefined;
  const age = inferSampleAge(sample, ageBoundaries);
  const lt = inferLocalTurn(sample, age, ageBoundaries);
  const off = offsets.get(age);
  if (typeof lt === "number" && off !== undefined) {
    return off + lt;
  }
  if (typeof sample.turn === "number") return sample.turn;
  return undefined;
}

/**
 * Accumulated per-pid state folded across the sample stream.
 * @typedef {Object} PidFold
 * @property {ChartPoint[]} points Plotted points (chart-X, value).
 * @property {*} leaderType First non-null leader type seen.
 * @property {string|null} leaderName First non-empty leader name.
 * @property {string|null} primaryColor Latest non-empty primary color.
 * @property {boolean|undefined} metFlag Latest `met` flag.
 */

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
 * Fold one pid's per-sample data into points + identity state.
 * @param {Snapshot[]} samples The sample stream.
 * @param {string} pid Player id key.
 * @param {string} metricId Metric id to extract.
 * @param {Map<string, number>} ageOffsets Per-age cumulative offsets.
 * @param {AgeBoundary[]} ageBoundariesLocal Age boundary table.
 * @returns {PidFold} The accumulated fold for this pid.
 */
function foldPidSamples(samples, pid, metricId, ageOffsets, ageBoundariesLocal) {
  /** @type {PidFold} */
  const fold = {
    points: [],
    leaderType: null,
    leaderName: null,
    primaryColor: null,
    metFlag: undefined
  };
  for (const s of samples) {
    const ps = s.players && s.players[pid];
    if (!ps) continue;
    mergePidIdentity(fold, ps);
    const v = ps.metrics ? ps.metrics[metricId] : undefined;
    if (typeof v === "number" && isFinite(v)) {
      const x = sampleX(s, ageOffsets, ageBoundariesLocal);
      if (typeof x === "number") fold.points.push({ t: x, v });
    }
  }
  return fold;
}

/**
 * Merge one civ sample's identity fields into a pid fold: first non-null
 * leader type / leader name, latest non-empty primary color, latest met flag.
 * @param {PidFold} fold Accumulator (mutated).
 * @param {CivSample|*} ps One civ's sample.
 * @returns {void}
 */
function mergePidIdentity(fold, ps) {
  if (!fold.leaderType && ps.leaderType !== undefined && ps.leaderType !== null) {
    fold.leaderType = ps.leaderType;
  }
  if (!fold.leaderName && typeof ps.leaderName === "string" && ps.leaderName.length > 0) {
    fold.leaderName = ps.leaderName;
  }
  // Take the LATEST non-empty primary color — civilization swaps at age
  // transitions change civ colors too, and we want the line color to
  // reflect the current civ identity.
  if (typeof ps.primaryColor === "string" && ps.primaryColor.length > 0) {
    fold.primaryColor = ps.primaryColor;
  }
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
 * Build one {@link ChartSeries} from a pid's folded state.
 * @param {Snapshot[]} samples The sample stream.
 * @param {string} pid Player id key.
 * @param {number} idx Index for palette fallback.
 * @param {PidFold} fold The pid's accumulated fold.
 * @param {Record<string, *>} eliminatedMap The history eliminated map.
 * @returns {ChartSeries} The built series.
 */
function buildSeriesEntry(samples, pid, idx, fold, eliminatedMap) {
  const { points, leaderType, leaderName, primaryColor, metFlag } = fold;
  const key = String(leaderType ?? "pid:" + pid);
  const leaderOnly =
    leaderName || (leaderType !== null ? leaderDisplayName(leaderType, pid) : "Player " + pid);
  let allCivNames = collectCivHistory(samples, pid);
  // Live fallback for snapshots that don't carry civName yet
  // (older history rows pre-$hash fix). Pull directly via
  // player.civilizationName so the chart label never says
  // "Augustus" alone when we can resolve "Augustus (Rome)" now.
  if (allCivNames.length === 0) {
    allCivNames = liveCivNameFallback(pid);
  }
  const isEliminated = !!eliminatedMap[String(pid)] || !!eliminatedMap[Number(pid)];
  // Prefer the civ's actual primary color so each line matches
  // the in-game banner color. Fall back to the rotating palette
  // only when the sampler didn't capture a color (older saves).
  const color =
    typeof primaryColor === "string" && primaryColor.length > 0
      ? primaryColor
      : PALETTE[idx % PALETTE.length];
  return {
    // End-of-line labels: "Leader (Civ)" or "Leader (Old → New)".
    name: displayName(leaderOnly, allCivNames) + (isEliminated ? " ✝" : ""),
    pid: Number(pid),
    met: metFlag === undefined ? true : metFlag,
    eliminated: isEliminated,
    leaderType: key,
    color,
    points,
    allCivNames
  };
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

  const pids = collectPidSet(samples);
  /** @type {ChartSeries[]} */
  const series = [];
  pids.forEach((pid, idx) => {
    const fold = foldPidSamples(samples, pid, metricId, ageOffsets, ageBoundariesLocal);
    if (fold.points.length >= 1) {
      series.push(buildSeriesEntry(samples, pid, idx, fold, eliminatedMap));
    }
  });
  return { series, sampleCount: samples.length };
}

// NOTE: The dead helpers `ageLabel` and `decollideLabels` (leftover from the
// pre-Chart.js SVG renderer) were removed during modularization — neither was
// referenced anywhere in the module.

// Line chart — Chart.js implementation.
// Replaces the prior custom SVG renderer. Chart.js is loaded into Civ7's
// runtime by the engine (used by <fxs-hof-chart>), so we can instantiate
// directly. We get pixel-identical fonts, gridlines, axis labels, and
// tooltips to the in-game graphs by reusing Chart.defaults the engine sets.
//
// Features preserved from the SVG version:
//   - Per-civ lines with the civ's primary color
//   - Hidden civs (dataset.hidden = true, dimmed in legend)
//   - Focused civs (non-focused get lower alpha)
//   - Time-range filter (filtered at data-build time)
//   - Year-aware X axis ticks ("T-52 / 2725 BCE")
//   - Y axis formatted per-metric (e.g. "$1.2B" for GDP, "Stage 1" for crisis)
//   - Click legend entry → toggle civ; click line → toggle focus
//   - Eliminated civs shown strikethrough in legend
//   - Global metrics (crisis_stage / age_progress) collapse to one line

/**
 * Destroy any prior Chart instance cached on the host before re-mounting.
 * @param {HTMLElement|*} host The chart host element.
 * @returns {void}
 */
function teardownExistingChart(host) {
  if (!host) return;
  const cur = host._demographicsChart;
  if (cur && typeof cur.destroy === "function") {
    try {
      cur.destroy();
    } catch (_) {
      // Chart#destroy may throw on an already-disposed instance; ignore.
    }
  }
  host._demographicsChart = null;
}

// Color helpers used to dim non-focused civs / dim hidden civs etc.
/**
 * Return `hex` with alpha `a` applied as an `rgba()` string. Accepts hex,
 * `rgb()`, or `rgba()` inputs; falls back to translucent white.
 * @param {*} hex Source color.
 * @param {number} a Alpha (0-1).
 * @returns {string} An `rgba()` color string.
 */
function colorWithAlpha(hex, a) {
  if (typeof hex !== "string") return "rgba(255,255,255," + a + ")";
  if (hex.startsWith("rgba")) return hex.replace(/[\d.]+\)$/, a + ")");
  if (hex.startsWith("rgb(")) return hex.replace(")", "," + a + ")").replace("rgb(", "rgba(");
  const m = hex.match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return "rgba(255,255,255," + a + ")";
  const n = parseInt(m[1], 16);
  return "rgba(" + ((n >> 16) & 0xff) + "," + ((n >> 8) & 0xff) + "," + (n & 0xff) + "," + a + ")";
}

// Apply the same Chart.defaults that the engine's fxs-hof-chart sets at
// module load (see core/ui/components/fxs-hof-chart.js:5-9). The defaults
// stick after first application, so duplicates are harmless; but if our
// chart instantiates before hof-chart has ever loaded, the stock Chart.js
// defaults (Arial, #666 text, etc.) leak through and our graphs look NOTHING
// like the in-game ones. Setting them ourselves guarantees parity.
let _engineDefaultsApplied = false;
/**
 * Apply the engine's `fxs-hof-chart` Chart.defaults (font, color) once, so our
 * charts match the in-game graphs even if hof-chart hasn't loaded yet.
 * @returns {void}
 */
function applyEngineChartDefaults() {
  if (_engineDefaultsApplied) return;
  if (typeof Chart === "undefined") return;
  try {
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.color = "#E5E5E5";
    // Layout.textSizeToScreenPixels("lg") in-game resolves to ~17-18px
    // at typical UI scales. Hardcoding 16 is close enough and avoids a
    // dependency on Layout being in scope.
    if (Chart.defaults.font) {
      Chart.defaults.font.size = 16;
      // BodyFont is Civ7's actual UI font; fall back through TitilliumWeb
      // and sans-serif so we don't render in Times if BodyFont isn't
      // resolvable in our scope.
      Chart.defaults.font.family =
        "BodyFont, BodyFont-SC, BodyFont-TC, BodyFont-JP, BodyFont-KR, TitilliumWeb, sans-serif";
      Chart.defaults.font.weight = "normal";
      Chart.defaults.font.style = "normal";
    }
    _engineDefaultsApplied = true;
  } catch (_) {
    // Chart.defaults may be frozen/absent before hof-chart loads; leave stock defaults.
  }
}

// NOTE: The dead one-shot `chartJsSmokeTest` probe (never called) was removed
// during modularization.

/**
 * Apply the `showEliminatedCivs` setting (default true): strip eliminated
 * series when the user disabled it.
 * @param {ChartSeries[]} allSeries The series list.
 * @returns {ChartSeries[]} The (possibly filtered) series list.
 */
function applyShowEliminated(allSeries) {
  try {
    const showElim = !!DemographicsSettings.getSetting("showEliminatedCivs", true);
    if (!showElim) {
      return allSeries.filter((s) => !s.eliminated);
    }
  } catch (_) {
    // DemographicsSettings.getSetting may throw; fall back to showing all series.
  }
  return allSeries;
}

/**
 * Apply the `smoothChart` setting: 3-turn centered moving average, in place.
 * First/last points keep raw values; series with <3 points are untouched.
 * @param {ChartSeries[]} allSeries The series list (mutated).
 * @returns {void}
 */
function applySmoothChart(allSeries) {
  let smooth = false;
  try {
    smooth = !!DemographicsSettings.getSetting("smoothChart", false);
  } catch (_) {
    /* setting unreadable — leave smoothing off */
  }
  if (!smooth) return;
  // Own-logic smoothing math runs OUTSIDE the engine guard so a real bug here
  // surfaces (propagating to the logged top-level render guard) rather than
  // being swallowed.
  for (const s of allSeries) {
    if (!Array.isArray(s.points) || s.points.length < 3) continue;
    const src = s.points;
    const out = new Array(src.length);
    out[0] = src[0];
    out[src.length - 1] = src[src.length - 1];
    for (let i = 1; i < src.length - 1; i++) {
      const a = src[i - 1].v,
        b = src[i].v,
        c = src[i + 1].v;
      out[i] = { t: src[i].t, v: (a + b + c) / 3 };
    }
    s.points = out;
  }
}

/**
 * Resolve a metric's metadata, defensively.
 * @param {string} metricId Metric id.
 * @returns {*} The metric metadata, or `null`.
 */
function resolveMetricMeta(metricId) {
  try {
    return getMetric(metricId);
  } catch (_) {
    // getMetric may throw on an unknown metric id; fall back to null metadata.
    return null;
  }
}

/**
 * For a `global` metric, collapse all series into a single donor line.
 * @param {ChartSeries[]} allSeries The series list.
 * @param {*} metricMeta The metric metadata.
 * @param {string} metricId Metric id.
 * @returns {ChartSeries[]} The (possibly collapsed) series list.
 */
function collapseGlobalMetric(allSeries, metricMeta, metricId) {
  if (metricMeta && metricMeta.global && allSeries.length > 1) {
    const donor = allSeries.find((s) => s.points.length > 0) || allSeries[0];
    return [
      {
        name: metricMeta.title || metricMeta.label || metricId,
        pid: donor?.pid,
        met: true,
        leaderType: "GLOBAL_" + metricId,
        color: "#f3c34c",
        points: donor ? donor.points.slice() : [],
        allCivNames: []
      }
    ];
  }
  return allSeries;
}

/**
 * Apply the `showUnmetNames` setting (default false): mask each non-local,
 * unmet civ's series name with a generic placeholder.
 * @param {ChartSeries[]} allSeries The series list (mutated).
 * @returns {void}
 */
function applyUnmetNames(allSeries) {
  let showUnmet = false;
  try {
    showUnmet = !!DemographicsSettings.getSetting("showUnmetNames", false);
  } catch (_) {
    // DemographicsSettings.getSetting may throw; leave showUnmet at its default (false).
  }
  const localPid = resolveLocalPid();
  if (!showUnmet) {
    for (const s of allSeries) {
      const isLocal = localPid !== undefined && s.pid === localPid;
      if (!isLocal && s.met === false) s.name = "Unmet Civilization";
    }
  }
}

/**
 * Age info attached to a chart-X position.
 * @typedef {Object} TurnAgeInfo
 * @property {string} age Age type string.
 * @property {number} localTurn Age-local turn.
 */

/**
 * Year/age lookup maps keyed by chart-X position.
 * @typedef {Object} TurnMaps
 * @property {Map<number, string>} turnYearMap chart-X → game-year string.
 * @property {Map<number, TurnAgeInfo>} turnAgeMap chart-X → age info.
 */

/**
 * Build the chart-X → year and chart-X → age maps from the sample stream,
 * plus a live entry for the current engine turn.
 * @param {Snapshot[]} samps The sample stream.
 * @param {Map<string, number>} ageOffsets Per-age cumulative offsets.
 * @param {AgeBoundary[]} boundaries Age boundary table.
 * @returns {TurnMaps} The year and age maps.
 */
function buildTurnMaps(samps, ageOffsets, boundaries) {
  /** @type {Map<number, string>} */
  const turnYearMap = new Map();
  /** @type {Map<number, TurnAgeInfo>} */
  const turnAgeMap = new Map();
  for (const s of samps) {
    if (!s) continue;
    const x = sampleX(s, ageOffsets, boundaries);
    if (typeof x !== "number") continue;
    if (typeof s.gameYear === "string" && s.gameYear.length > 0) {
      turnYearMap.set(x, s.gameYear);
    }
    const inferredAge = inferSampleAge(s, boundaries);
    const inferredLT = inferLocalTurn(s, inferredAge, boundaries);
    if (typeof inferredLT === "number") {
      turnAgeMap.set(x, { age: inferredAge, localTurn: inferredLT });
    }
  }
  addLiveTurnYear(turnYearMap);
  return { turnYearMap, turnAgeMap };
}

/** @type {Record<string, string>} */
const AGE_PREFIX = {
  AGE_ANTIQUITY: "A",
  AGE_EXPLORATION: "E",
  AGE_MODERN: "M"
};

/**
 * X-axis tick / Y-axis tick formatter pair.
 * @typedef {Object} AxisFormatters
 * @property {(v: number) => string} fmtX X-axis tick formatter.
 * @property {(v: number) => string} fmtY Y-axis tick formatter.
 */

/**
 * Build the X / Y axis tick formatters bound to the supplied turn maps and
 * metric metadata. Honors the shared {@link getXAxisMode} setting.
 * @param {TurnMaps} maps The chart-X → year/age maps.
 * @param {*} metricMeta The metric metadata (for Y formatting).
 * @returns {AxisFormatters} The formatter pair.
 */
function makeAxisFormatters(maps, metricMeta) {
  const { turnYearMap, turnAgeMap } = maps;
  /**
   * Format a chart-X as an age-relative turn label ("A12", "E1", "T-N").
   * @param {number} t The chart-X position.
   * @returns {string} The label.
   */
  const ageTurnLabel = (t) => {
    const info = nearestByTurn(turnAgeMap, t);
    if (!info) return "T-" + t;
    const pfx = AGE_PREFIX[info.age] || info.age.replace(/^AGE_/, "")[0] || "T";
    return pfx + info.localTurn;
  };
  /**
   * Format a chart-X tick per the active axis mode.
   * @param {number} v The chart-X value.
   * @returns {string} The tick label.
   */
  const fmtX = (v) => {
    const t = Math.round(v);
    const y = nearestByTurn(turnYearMap, t);
    const ageLbl = ageTurnLabel(t);
    if (getXAxisMode() === "turn") return ageLbl;
    if (getXAxisMode() === "year") return y || ageLbl;
    return y ? ageLbl + " / " + y : ageLbl;
  };
  /**
   * Format a Y tick using the metric's formatter when available.
   * @param {number} v The value.
   * @returns {string} The formatted value.
   */
  const fmtY = (v) => {
    if (metricMeta && typeof metricMeta.format === "function") {
      try {
        const s = metricMeta.format(v);
        if (typeof s === "string") return s;
      } catch (e) {
        derr("fmtY: metric.format threw:", e);
      }
    }
    return String(v);
  };
  return { fmtX, fmtY };
}

/**
 * Build the Chart.js dataset array from the series list, applying hidden /
 * dimmed / focused styling and the time-range filter.
 * @param {ChartSeries[]} allSeries The series list.
 * @param {Set<string>} hidden Hidden series keys.
 * @param {Set<string>} focused Focused series keys.
 * @param {{ min: number, max: number }|null} tr Time-range filter, or null.
 * @returns {Record<string, *>[]} The Chart.js datasets.
 */
function buildChartDatasets(allSeries, hidden, focused, tr) {
  return allSeries.map((s) => {
    const isHidden = hidden.has(s.leaderType);
    const anyFocused = focused.size > 0;
    const isDimmed = anyFocused && !focused.has(s.leaderType);
    const isFocused = anyFocused && focused.has(s.leaderType);
    const dataPoints = s.points
      .filter((p) => !tr || (p.t >= tr.min && p.t <= tr.max))
      .map((p) => ({ x: p.t, y: p.v }));
    // Lift dim blue civ colors so the line / label / value reads on
    // the dark chart background (same lift used in the tooltip).
    const baseColor = tooltipSafeTextColor(s.color) || s.color;
    const color = isDimmed ? colorWithAlpha(baseColor, 0.35) : baseColor;
    return {
      label: s.name,
      data: dataPoints,
      borderColor: color,
      backgroundColor: color,
      // Slightly thicker stroke for all lines (subtle):
      // Focused: 3 → 3.4, Dimmed: 1 → 1.2, Normal: 2 → 2.4
      borderWidth: isFocused ? 3.4 : isDimmed ? 1.2 : 2.4,
      _focused: isFocused,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0,
      spanGaps: true,
      hidden: isHidden,
      leaderType: s.leaderType
    };
  });
}

/**
 * Compute the viewport-relative canvas render size, clamping to the caller's
 * width/height hints when they're meaningfully large.
 * @param {ChartOptions} opts The render options.
 * @param {number} W Caller width floor.
 * @param {number} H Caller height floor.
 * @returns {{ renderW: number, renderH: number }} The render dimensions.
 */
function computeRenderSize(opts, W, H) {
  let renderW, renderH;
  try {
    const vw = typeof window !== "undefined" && window.innerWidth ? window.innerWidth : 1920;
    const vh = typeof window !== "undefined" && window.innerHeight ? window.innerHeight : 1080;
    renderW = Math.max(960, Math.round(vw * 0.92));
    renderH = Math.max(420, Math.round(vh * 0.62));
    // Honor the caller's W/H as an upper bound (caller measured chartHost
    // — on a tall/wide layout it's the most accurate value we have).
    if (typeof opts.width === "number" && opts.width > renderW * 0.6)
      renderW = Math.min(renderW, opts.width);
    if (typeof opts.height === "number" && opts.height > renderH * 0.6)
      renderH = Math.min(renderH, opts.height);
  } catch (_) {
    renderW = Math.max(960, W);
    renderH = Math.max(420, H);
  }
  return { renderW, renderH };
}

/**
 * A detected wonder-built event on a civ's line.
 * @typedef {Object} WonderEvent
 * @property {number|*} turn Chart-X position (or raw turn fallback).
 * @property {string} year Game-year string ("" when unknown).
 * @property {string} wonderType Engine constructible type.
 * @property {string} [iconUrl] Resolved icon URL.
 * @property {string} [wonderName] Resolved wonder display name.
 * @property {string} [wonderDescription] Resolved flavor description.
 */

/**
 * Read the `showWonderMarkers` setting; defaults OFF on the Crisis Stage
 * chart, ON elsewhere.
 * @param {string} metricId Active metric id.
 * @returns {boolean} Whether wonder markers should be shown.
 */
function shouldShowWonders(metricId) {
  const wonderDefault = metricId === "crisis_stage" ? false : true;
  try {
    return !!DemographicsSettings.getSetting("showWonderMarkers", wonderDefault);
  } catch (_) {
    // DemographicsSettings.getSetting may throw; fall back to the per-metric default.
    return wonderDefault;
  }
}

/**
 * Detect wonder-built events by diffing each civ's `wonderTypes` list between
 * consecutive samples. Pre-existing wonders on a civ's first observed sample
 * are seeded (not emitted).
 * @param {Snapshot[]} samples The sample stream.
 * @param {Map<string, number>} ageOffsets Per-age cumulative offsets.
 * @param {AgeBoundary[]} boundaries Age boundary table.
 * @returns {Map<string, WonderEvent[]>} pid → detected wonder events.
 */
function collectWonderEvents(samples, ageOffsets, boundaries) {
  /** @type {Map<string, WonderEvent[]>} */
  const wonderEventsByPid = new Map();
  /** @type {Map<string, Set<string>>} */
  const seenTypesByPid = new Map(); // pid → Set of types seen so far
  /** @type {Set<string>} */
  const sampledPids = new Set(); // pids we've ever observed in any sample
  for (const s of samples) {
    if (!s?.players) continue;
    for (const pid of Object.keys(s.players)) {
      const ps = s.players[pid];
      const types = Array.isArray(ps?.wonderTypes) ? ps.wonderTypes : null;
      // "First sample for this civ" must be based on whether we've ever
      // sampled THIS CIV at all — NOT on whether we've ever seen a
      // wonderTypes array for them. A civ that starts the game wonderless
      // and builds their very first wonder mid-run otherwise gets its real
      // new-wonder event silently dropped (because `seen` didn't exist yet,
      // so it was treated as a "seed").
      const isFirstSample = !sampledPids.has(pid);
      sampledPids.add(pid);
      if (types && types.length > 0) {
        foldWonderTypes(
          wonderEventsByPid,
          seenTypesByPid,
          pid,
          s,
          types,
          isFirstSample,
          ageOffsets,
          boundaries
        );
      }
    }
  }
  return wonderEventsByPid;
}

/**
 * Fold one sample's wonder-type list into the running seen-set + event map.
 * @param {Map<string, WonderEvent[]>} wonderEventsByPid pid → events (mutated).
 * @param {Map<string, Set<string>>} seenTypesByPid pid → seen types (mutated).
 * @param {string} pid Player id key.
 * @param {Snapshot} s The current sample.
 * @param {string[]} types Wonder-type list on this sample.
 * @param {boolean} isFirstSample Whether this is the civ's first sample.
 * @param {Map<string, number>} ageOffsets Per-age cumulative offsets.
 * @param {AgeBoundary[]} boundaries Age boundary table.
 * @returns {void}
 */
function foldWonderTypes(
  wonderEventsByPid,
  seenTypesByPid,
  pid,
  s,
  types,
  isFirstSample,
  ageOffsets,
  boundaries
) {
  let seen = seenTypesByPid.get(pid);
  if (!seen) {
    seen = new Set();
    seenTypesByPid.set(pid, seen);
  }
  if (isFirstSample) {
    // Seed-only: these were pre-existing when the sampler first observed
    // this civ. Don't emit.
    for (const t of types) seen.add(t);
    return;
  }
  for (const t of types) {
    if (seen.has(t)) continue;
    seen.add(t);
    let events = wonderEventsByPid.get(pid);
    if (!events) {
      events = [];
      wonderEventsByPid.set(pid, events);
    }
    const wx = sampleX(s, ageOffsets, boundaries);
    events.push({
      turn: typeof wx === "number" ? wx : s.turn,
      year: s.gameYear || "",
      wonderType: t
    });
  }
}

/**
 * Resolve the engine icon URL for a wonder event, mutating `ev.iconUrl`.
 * @param {WonderEvent} ev The event (mutated).
 * @returns {void}
 */
function resolveWonderIcon(ev) {
  try {
    if (typeof UI !== "undefined" && typeof UI.getIconURL === "function") {
      ev.iconUrl = UI.getIconURL(ev.wonderType, "WONDER");
    }
  } catch (_) {
    // UI.getIconURL may be absent or throw; leave ev.iconUrl unset (event dropped upstream).
  }
}

/**
 * Resolve the longest composable flavor description from a Constructibles row.
 * @param {*} info The Constructibles lookup row (or null).
 * @returns {string} The best description, or "" when none compose.
 */
function bestWonderDescription(info) {
  const candidates = [info?.Description, info?.Tooltip].filter(Boolean);
  let best = "";
  for (const tag of candidates) {
    let composed = tag;
    try {
      if (typeof Locale?.compose === "function") composed = Locale.compose(tag);
    } catch (_) {
      // Locale.compose may throw on a malformed tag; keep the raw tag (skipped below).
    }
    // Skip if compose returned the raw tag (no string in the localization
    // DB for the active language).
    if (composed && composed !== tag && composed.length > best.length) {
      best = composed;
    }
  }
  return best;
}

/**
 * Resolve display name + flavor description for a wonder event, mutating it.
 * @param {WonderEvent} ev The event (mutated).
 * @returns {void}
 */
function resolveWonderMeta(ev) {
  try {
    const info =
      typeof GameInfo !== "undefined" &&
      GameInfo.Constructibles &&
      typeof GameInfo.Constructibles.lookup === "function"
        ? GameInfo.Constructibles.lookup(ev.wonderType)
        : null;
    ev.wonderName = resolveWonderName(ev.wonderType, info);
    // Flavor / mechanical description. Civ7's Constructibles table carries
    // Description (short mechanical line) and Tooltip (richer text); prefer
    // the longer of the two when both compose successfully.
    const best = bestWonderDescription(info);
    if (best) ev.wonderDescription = best;
  } catch (_) {
    // GameInfo.Constructibles.lookup may be absent or throw; fall back to the raw type as name.
    ev.wonderName = ev.wonderType;
  }
}

/**
 * Resolve a wonder's display name from its Constructibles row, falling back to
 * a humanized type string.
 * @param {string} wonderType The engine constructible type.
 * @param {*} info The Constructibles lookup row (or null).
 * @returns {string} The display name.
 */
function resolveWonderName(wonderType, info) {
  if (info && info.Name && typeof Locale?.compose === "function") {
    return Locale.compose(info.Name);
  }
  if (info && info.Name) return info.Name;
  return wonderType.replace(/^BUILDING_/, "").replace(/_/g, " ");
}

/**
 * Resolve icon + name for every wonder event, dropping events with no icon
 * and pruning pids that end up empty.
 * @param {Map<string, WonderEvent[]>} wonderEventsByPid pid → events (mutated).
 * @returns {void}
 */
function resolveWonderEvents(wonderEventsByPid) {
  // Resolve display name + icon URL for each event using the engine's
  // canonical accessors. Cite: utilities-image.js:71-74
  //   Icon.getWonderIconFromDefinition() === UI.getIconURL(type, "WONDER")
  for (const [pid, events] of wonderEventsByPid) {
    /** @type {WonderEvent[]} */
    const kept = [];
    for (const ev of events) {
      if (!ev.wonderType) continue;
      resolveWonderIcon(ev);
      // Only drop events where the engine returned NO icon URL at all.
      // We previously also dropped events whose URL matched the generic
      // "blp:ntf_wonder_completed" notification, but UI.getIconURL never
      // returns that URL for real wonders — filtering on it was just
      // suppressing real wonders whose specific BLPs the engine happens to
      // resolve to a similarly-named fallback.
      if (!ev.iconUrl) continue;
      resolveWonderMeta(ev);
      kept.push(ev);
    }
    if (kept.length === 0) wonderEventsByPid.delete(pid);
    else wonderEventsByPid.set(pid, kept);
  }
}

/**
 * Mutable wrapper around the singleton wonder hover-tooltip element.
 * @typedef {Object} WonderTipState
 * @property {HTMLElement|null} wonderTip The tip element (lazily created).
 */

/**
 * Ensure the singleton wonder hover-tooltip exists and is attached to `wrap`.
 * @param {WonderTipState} state The tip state wrapper (mutated).
 * @param {HTMLElement} wrap The chart wrap to mount the tip into.
 * @returns {HTMLElement} The tip element.
 */
function ensureWonderTip(state, wrap) {
  if (state.wonderTip && state.wonderTip.isConnected) return state.wonderTip;
  const wonderTip = document.createElement("div");
  wonderTip.className =
    "demographics-wonder-tooltip demographics-line-wonder-tip img-tooltip-border img-tooltip-bg";
  wrap.appendChild(wonderTip);
  state.wonderTip = wonderTip;
  return wonderTip;
}

/**
 * Show the wonder hover-tooltip for an event, anchored to the icon.
 * @param {WonderTipState} state The tip state wrapper.
 * @param {HTMLElement} wrap The chart wrap.
 * @param {WonderEvent} ev The hovered event.
 * @param {string} civLabel The civ display label.
 * @param {number} iconLeft Icon left offset (px).
 * @param {number} iconTop Icon top offset (px).
 * @param {number} iconSize Icon edge length (px).
 * @returns {void}
 */
function showWonderTip(state, wrap, ev, civLabel, iconLeft, iconTop, iconSize) {
  const tip = ensureWonderTip(state, wrap);
  const yearStr = ev.year ? " · " + ev.year : "";
  const descHtml = ev.wonderDescription
    ? '<div style="margin-top:0.4rem;color:#c2c4cc;font-style:italic;">' +
      escapeHtml(ev.wonderDescription) +
      "</div>"
    : "";
  tip.innerHTML =
    "" +
    '<div style="font-family:TitleFont, BodyFont, sans-serif;' +
    "font-weight:600;color:#f3c34c;font-size:0.92rem;" +
    "letter-spacing:0.02em;margin-bottom:0.25rem;" +
    "border-bottom:1px solid rgba(168,132,90,0.45);" +
    'padding-bottom:0.2rem;">' +
    escapeHtml(ev.wonderName || "Wonder") +
    "</div>" +
    '<div><span style="color:#e5d2ac;">Built by</span> ' +
    escapeHtml(civLabel) +
    "</div>" +
    '<div style="color:#9aa0aa;font-size:0.74rem;">Turn ' +
    ev.turn +
    escapeHtml(yearStr) +
    "</div>" +
    descHtml;
  tip.style.display = "block";
  positionWonderTip(state, iconLeft, iconTop, iconSize);
}

/**
 * Compute the tooltip's left/top placement relative to the icon, clamped
 * inside the chart wrap.
 * @param {HTMLElement} wonderTip The visible tip element.
 * @param {HTMLElement|*} wrap The chart wrap (for clamping).
 * @param {number} iconLeft Icon left offset (px).
 * @param {number} iconTop Icon top offset (px).
 * @param {number} iconSize Icon edge length (px).
 * @returns {{ left: number, top: number, tipW: number, tipH: number }}
 *   The placement and measured tip size.
 */
function computeWonderTipPlacement(wonderTip, wrap, iconLeft, iconTop, iconSize) {
  const GAP_X = 18;
  // Measure after the tip is visible so offsetWidth/Height are real.
  const tipW = wonderTip.offsetWidth;
  const tipH = wonderTip.offsetHeight;
  // Default: place above and to the right of the icon, so the cursor never
  // overlaps the tip.
  let left = iconLeft + iconSize + GAP_X;
  let top = iconTop - tipH / 2 + iconSize / 2;
  // If not enough room to the right, try left side.
  if (wrap && left + tipW > wrap.clientWidth - 4) {
    left = iconLeft - tipW - GAP_X;
  }
  // Clamp horizontally to the wrap so the tip stays on-screen.
  if (wrap) {
    const maxLeft = wrap.clientWidth - tipW - 4;
    if (left > maxLeft) left = maxLeft;
    if (left < 4) left = 4;
    // Clamp vertically as well.
    const maxTop = wrap.clientHeight - tipH - 4;
    if (top > maxTop) top = maxTop;
    if (top < 4) top = 4;
  }
  return { left, top, tipW, tipH };
}

/**
 * Apply the connecting arrow's edge + color to a wonder tooltip.
 * @param {*} wonderTip The tip element (carries a custom `.arrow` child).
 * @param {number} left The tip's resolved left (px).
 * @param {number} iconLeft Icon left offset (px).
 * @param {number} tipW Measured tip width (px).
 * @param {number} tipH Measured tip height (px).
 * @returns {void}
 */
function applyWonderTipArrow(wonderTip, left, iconLeft, tipW, tipH) {
  if (!wonderTip.arrow) {
    const arrow = document.createElement("div");
    arrow.className = "wonder-tip-arrow demographics-line-wonder-tip-arrow";
    wonderTip.appendChild(arrow);
    wonderTip.arrow = arrow;
  }
  const arrow = wonderTip.arrow;
  // Position arrow on the edge closest to the icon.
  if (left > iconLeft) {
    // Tooltip is to the right of the icon.
    arrow.style.left = "-16px";
    arrow.style.top = tipH / 2 - 8 + "px";
    arrow.style.borderRightColor = "rgba(243, 195, 76, 0.6)";
    arrow.style.borderLeftColor = "transparent";
  } else {
    // Tooltip is to the left of the icon.
    arrow.style.left = tipW - 0 + "px";
    arrow.style.top = tipH / 2 - 8 + "px";
    arrow.style.borderLeftColor = "rgba(243, 195, 76, 0.6)";
    arrow.style.borderRightColor = "transparent";
  }
  arrow.style.borderTopColor = "transparent";
  arrow.style.borderBottomColor = "transparent";
}

/**
 * Position the wonder tooltip near its icon and draw the connecting arrow.
 * @param {WonderTipState} state The tip state wrapper.
 * @param {number} iconLeft Icon left offset (px).
 * @param {number} iconTop Icon top offset (px).
 * @param {number} iconSize Icon edge length (px).
 * @returns {void}
 */
function positionWonderTip(state, iconLeft, iconTop, iconSize) {
  const wonderTip = state.wonderTip;
  if (!wonderTip) return;
  const wrap = wonderTip.parentNode;
  const { left, top, tipW, tipH } = computeWonderTipPlacement(
    wonderTip,
    wrap,
    iconLeft,
    iconTop,
    iconSize
  );
  wonderTip.style.left = left + "px";
  wonderTip.style.top = top + "px";
  // Add a small arrow to visually connect the tip to the icon.
  applyWonderTipArrow(wonderTip, left, iconLeft, tipW, tipH);
}

/**
 * Hide the wonder hover-tooltip.
 * @param {WonderTipState} state The tip state wrapper.
 * @returns {void}
 */
function hideWonderTip(state) {
  if (state.wonderTip) state.wonderTip.style.display = "none";
}

const WONDER_ICON_SIZE = 28;

/**
 * Find the data point on a dataset nearest to a wonder event's turn, within a
 * small tolerance.
 * @param {Record<string, *>} ds The Chart.js dataset.
 * @param {number|*} turn The event's chart-X turn.
 * @returns {{ x: number, y: number }|null} The matched point, or `null`.
 */
function findEventDataPoint(ds, turn) {
  let dp = ds.data.find((/** @type {*} */ p) => p && p.x === turn);
  if (!dp) {
    let bestDist = 3;
    for (const p of ds.data) {
      if (!p) continue;
      const d = Math.abs(p.x - turn);
      if (d < bestDist) {
        bestDist = d;
        dp = p;
      }
    }
  }
  return dp || null;
}

/**
 * Create (and wire hover) a wonder marker element for an event.
 * @param {WonderTipState} tipState The wonder tooltip state.
 * @param {HTMLElement} wrap The chart wrap.
 * @param {WonderEvent} ev The event.
 * @param {string} civLabel The civ display label.
 * @returns {HTMLElement} The marker element.
 */
function createWonderMarker(tipState, wrap, ev, civLabel) {
  const mk = document.createElement("div");
  mk.className = "demographics-wonder-marker demographics-line-wonder-marker";
  // Only real per-wonder icons reach this code path — events without a
  // specific icon are pre-filtered upstream, so no generic fallback is
  // stacked. Per-event icon URL stays inline (dynamic).
  mk.style.backgroundImage = "url('" + ev.iconUrl + "')";
  // Custom hover tooltip — native `title` doesn't render in Coherent.
  // Anchor the tip to the icon's current position (not the cursor) so it
  // sits in a predictable spot and doesn't jitter. Read the icon's offset
  // at hover time, because the marker may have been repositioned since this
  // listener was attached (pan, resize, filter change).
  mk.addEventListener("mouseenter", () => {
    showWonderTip(tipState, wrap, ev, civLabel, mk.offsetLeft, mk.offsetTop, WONDER_ICON_SIZE);
  });
  mk.addEventListener("mouseleave", () => hideWonderTip(tipState));
  return mk;
}

/**
 * Render/update markers for one dataset's wonder events, tracking rendered
 * keys for later garbage collection.
 * @param {Record<string, *>} ctx Shared marker pass context.
 * @param {Record<string, *>} ds The Chart.js dataset.
 * @param {WonderEvent[]} events The dataset civ's events.
 * @param {number} pid The civ pid.
 * @returns {void}
 */
function renderDatasetWonderMarkers(ctx, ds, events, pid) {
  const { wrap, xScale, yScale, offX, offY, wonderMarkerEls, renderedKeys, tipState } = ctx;
  for (const ev of events) {
    if (ev.turn < xScale.min || ev.turn > xScale.max) continue;
    const dp = findEventDataPoint(ds, ev.turn);
    if (!dp) continue;
    const x = xScale.getPixelForValue(ev.turn);
    const y = yScale.getPixelForValue(dp.y);
    const leftPx = offX + x - WONDER_ICON_SIZE / 2;
    const topPx = offY + y - WONDER_ICON_SIZE / 2;
    const key = pid + ":" + ev.turn;
    renderedKeys.add(key);
    const mk = getOrCreateWonderMarker(wonderMarkerEls, key, tipState, wrap, ev, ds.label);
    // Update position only — don't rewrite the entire style string, which
    // would invalidate the browser's hover state and cause the blink the
    // user saw.
    if (mk.style.left !== leftPx + "px") mk.style.left = leftPx + "px";
    if (mk.style.top !== topPx + "px") mk.style.top = topPx + "px";
  }
}

/**
 * Reuse the cached marker for a key, recreating it when its DOM was wiped.
 * @param {Map<string, HTMLElement>} wonderMarkerEls key → marker element.
 * @param {string} key The "pid:turn" key.
 * @param {WonderTipState} tipState The wonder tooltip state.
 * @param {HTMLElement} wrap The chart wrap.
 * @param {WonderEvent} ev The event.
 * @param {string|*} dsLabel The dataset label (civ name).
 * @returns {HTMLElement} The (existing or created) marker element.
 */
function getOrCreateWonderMarker(wonderMarkerEls, key, tipState, wrap, ev, dsLabel) {
  /** @type {HTMLElement|null|undefined} */
  let mk = wonderMarkerEls.get(key);
  if (mk && !mk.isConnected) {
    // DOM was wiped by something external (panel reattach); drop our
    // reference and recreate below.
    wonderMarkerEls.delete(key);
    mk = null;
  }
  if (!mk) {
    mk = createWonderMarker(tipState, wrap, ev, dsLabel || "Unknown");
    wrap.appendChild(mk);
    wonderMarkerEls.set(key, mk);
  }
  return mk;
}

/**
 * Garbage-collect markers no longer rendered this pass.
 * @param {Map<string, HTMLElement>} wonderMarkerEls key → marker element.
 * @param {Set<string>} renderedKeys Keys rendered this pass.
 * @returns {void}
 */
function gcWonderMarkers(wonderMarkerEls, renderedKeys) {
  for (const [key, el] of wonderMarkerEls) {
    if (!renderedKeys.has(key)) {
      try {
        el.remove();
      } catch (_) {
        // Element.remove may throw if already detached by Coherent; drop the ref regardless.
      }
      wonderMarkerEls.delete(key);
    }
  }
}

/**
 * Build the HTML-overlay wonder-marker Chart.js plugin. Markers are managed
 * as absolutely-positioned divs over the chart wrap (canvas drawImage of BLP
 * sources is unreliable in Coherent). Updates are differential to avoid the
 * hover flicker a full teardown caused.
 * @param {ChartSeries[]} allSeries The series list (for pid lookup).
 * @param {Map<string, WonderEvent[]>} wonderEventsByPid pid → events.
 * @param {Map<string, HTMLElement>} wonderMarkerEls key → marker element.
 * @param {WonderTipState} tipState The wonder tooltip state.
 * @returns {Record<string, *>} The Chart.js plugin object.
 */
function makeWonderMarkersPlugin(allSeries, wonderEventsByPid, wonderMarkerEls, tipState) {
  return {
    id: "demographicsWonderMarkers",
    /**
     * @param {*} c The Chart instance.
     * @returns {void}
     */
    afterDatasetsDraw(c) {
      const wrap = c.canvas.parentNode;
      if (!wrap) return;
      const xScale = c.scales.x;
      const yScale = c.scales.y;
      if (!xScale || !yScale) return;
      const datasets = c.data.datasets || [];
      // Track which keys we render this pass; anything in the map but not in
      // this set at the end gets removed.
      const renderedKeys = new Set();
      const passCtx = {
        wrap,
        xScale,
        yScale,
        offX: c.canvas.offsetLeft,
        offY: c.canvas.offsetTop,
        wonderMarkerEls,
        renderedKeys,
        tipState
      };
      for (let di = 0; di < datasets.length; di++) {
        renderOneDatasetWonders(passCtx, datasets[di], allSeries, wonderEventsByPid);
      }
      // Garbage-collect any markers that no longer correspond to a visible
      // event (e.g. dataset hidden by user click, or scale panned to exclude
      // the turn).
      gcWonderMarkers(wonderMarkerEls, renderedKeys);
    }
  };
}

/**
 * Render wonder markers for a single dataset (resolving its pid + events).
 * @param {Record<string, *>} passCtx Shared marker pass context.
 * @param {Record<string, *>} ds The Chart.js dataset.
 * @param {ChartSeries[]} allSeries The series list (for pid lookup).
 * @param {Map<string, WonderEvent[]>} wonderEventsByPid pid → events.
 * @returns {void}
 */
function renderOneDatasetWonders(passCtx, ds, allSeries, wonderEventsByPid) {
  if (!ds || ds.hidden) return;
  const series = allSeries.find((s) => s.leaderType === ds.leaderType);
  const pid = series?.pid;
  if (typeof pid !== "number") return;
  const events =
    wonderEventsByPid.get(String(pid)) || wonderEventsByPid.get(/** @type {*} */ (pid));
  if (!events || events.length === 0) return;
  renderDatasetWonderMarkers(passCtx, ds, events, pid);
}

/**
 * Crisis-name template pools keyed by AgeCrisisEventType. Each entry is
 * `{ names, arcs }`: `names` is the single-pick pool (stable across all four
 * stages); `arcs` are multi-stage progressions (one beat per stage). See the
 * crisis-stages.xml for the source event types. Modern age has no AgeCrisis
 * pipeline, so only Antiquity/Exploration are represented.
 * @type {Record<string, { names: string[], arcs: string[][] }>}
 */
const CRISIS_NAME_TEMPLATES = {
  ANTIQUITY_CRISIS_INVASION: {
    names: [
      "The Bronze Age Collapse",
      "The Great Migration",
      "The Age of Migrations",
      "The Coming of the Sea Peoples",
      "The Barbarian Invasions",
      "The Barbarian Wars",
      "The Great Horde",
      "The Coming of the Horse Lords",
      "The March of Strangers",
      "The Years of Devastation",
      "The Years of Turmoil",
      "The Frontier Collapse",
      "The Crisis of the Frontier",
      "The Frontier Wars",
      "The {regional} Invasions",
      "The Storm from the {place}",
      "The Sack of the {place}"
    ],
    arcs: [
      [
        "The Border Raids",
        "The Barbarian Invasions",
        "The Sack of the Frontier",
        "The Great Migration"
      ],
      [
        "The Coming of the Horse Lords",
        "The Storm from the Steppe",
        "The Fall of the Frontier",
        "The Years of Devastation"
      ],
      [
        "The Frontier Wars",
        "The Barbarian Wars",
        "The Sack of the Provinces",
        "The Bronze Age Collapse"
      ]
    ]
  },
  ANTIQUITY_CRISIS_PLAGUE: {
    names: [
      "The Antonine Plague",
      "The Plague of Galen",
      "The Great Pestilence",
      "The Great Mortality",
      "The Great Fever",
      "The Great Dying",
      "The Plague Years",
      "The Dying Time",
      "The Time of Pestilence",
      "The Years of Mortality",
      "The Years of Ashes",
      "The Sweating Sickness",
      "The Wasting Plague",
      "The Summer Plague",
      "The Winter Sickness",
      "The Silent Death",
      "The {color} Death",
      "The Plague of the {place}"
    ],
    arcs: [
      ["The Summer Plague", "The Plague Years", "The Great Mortality", "The Dying Time"],
      [
        "The Sweating Sickness",
        "The Plague of the Coast",
        "The Great Pestilence",
        "The Years of Ashes"
      ],
      ["The Winter Sickness", "The Wasting Plague", "The Great Dying", "The Silent Death"]
    ]
  },
  ANTIQUITY_CRISIS_LOYALTY: {
    names: [
      "The Servile Wars",
      "The Civil Wars",
      "The Years of Revolt",
      "The Years of Anarchy",
      "The Years of Turmoil",
      "The Time of Tyrants",
      "The Age of Usurpers",
      "The Age of Pretenders",
      "The Age of Warlords",
      "The Crisis of the Third Century",
      "The Crisis of Succession",
      "The Crisis of Legitimacy",
      "The Crisis of Authority",
      "The Collapse of Authority",
      "The Great Fracturing",
      "The Sundering",
      "The Troubles",
      "The Soldier's Revolt",
      "The Pretenders' War",
      "The War of Succession",
      "The Provincial Revolts",
      "The Crisis of the Provinces",
      "The Revolt of the {place}"
    ],
    arcs: [
      ["The Pretenders' War", "The Civil Wars", "The Age of Usurpers", "The Collapse of Authority"],
      ["The Soldier's Revolt", "The Provincial Revolts", "The Years of Anarchy", "The Sundering"],
      [
        "The Crisis of Succession",
        "The War of Succession",
        "The Civil Wars",
        "The Time of Tyrants"
      ],
      [
        "The Years of Revolt",
        "The Crisis of the Provinces",
        "The Great Fracturing",
        "The Age of Warlords"
      ]
    ]
  },
  EXPLORATION_CRISIS_REVOLUTION: {
    names: [
      "The Age of Revolutions",
      "The Age of Reform",
      "The Revolutionary Years",
      "The National Revolutions",
      "The Spring of Nations",
      "The Year of Liberty",
      "The Year of the Republic",
      "The Glorious Revolution",
      "The Great Awakening",
      "The Reform Movement",
      "The People's Rising",
      "The People's Revolution",
      "The National Rising",
      "The Republican Rising",
      "The Crisis of the Crown",
      "The Crisis of the Republic",
      "The Fall of the Crown",
      "The Constitutional Crisis",
      "The Risings in the {place}"
    ],
    arcs: [
      [
        "The Year of Liberty",
        "The Republican Rising",
        "The Fall of the Crown",
        "The Revolutionary Years"
      ],
      [
        "The Constitutional Crisis",
        "The People's Rising",
        "The People's Revolution",
        "The Spring of Nations"
      ],
      [
        "The Reform Movement",
        "The Crisis of the Crown",
        "The National Rising",
        "The Age of Revolutions"
      ]
    ]
  },
  EXPLORATION_CRISIS_RELIGION: {
    names: [
      "The Great Schism",
      "The Sacred Schism",
      "The Temple Schism",
      "The Provincial Schism",
      "The Reformation",
      "The Counter-Reformation",
      "The Reformation of the Provinces",
      "The Wars of Religion",
      "The Age of Heresies",
      "The Age of Prophets",
      "The Religious Upheaval",
      "The Crisis of Faith",
      "The Crisis of Orthodoxy",
      "The Sacred Wars",
      "The War of the Faithful",
      "The War of the Prophets",
      "The Iconoclast Crisis",
      "The Temple Crisis",
      "The Pilgrim Wars",
      "The {regional} Reformation",
      "The Heresy of the {place}"
    ],
    arcs: [
      ["The Crisis of Faith", "The Sacred Schism", "The Wars of Religion", "The Reformation"],
      [
        "The Iconoclast Crisis",
        "The Age of Heresies",
        "The Pilgrim Wars",
        "The Counter-Reformation"
      ],
      ["The Temple Crisis", "The War of the Prophets", "The Great Schism", "The Age of Prophets"]
    ]
  },
  EXPLORATION_CRISIS_PLAGUE: {
    names: [
      "The Black Death",
      "The Great Pestilence",
      "The Great Mortality",
      "The Great Fever",
      "The Great Dying",
      "The Time of Pestilence",
      "The Years of Mortality",
      "The Sweating Sickness",
      "The Wasting Plague",
      "The Plague Years",
      "The Dying Time",
      "The Years of Ashes",
      "The Summer Plague",
      "The Winter Sickness",
      "The Silent Death",
      "The {color} Death",
      "The Plague of the {place}"
    ],
    arcs: [
      ["The Summer Plague", "The Plague Years", "The Black Death", "The Great Mortality"],
      ["The Plague of the Coast", "The Great Pestilence", "The Great Dying", "The Years of Ashes"],
      ["The Sweating Sickness", "The Wasting Plague", "The Time of Pestilence", "The Dying Time"]
    ]
  }
};

/** @type {Record<string, { names: string[], arcs: string[][] }>} */
const CRISIS_FALLBACK_BY_AGE = {
  AGE_ANTIQUITY: {
    names: [
      "The Age of Upheaval",
      "The Troubles",
      "The Time of Troubles",
      "The Crisis of Empire",
      "The Years of Anarchy",
      "The Years of Turmoil",
      "The Great Fracturing",
      "The Sundering"
    ],
    arcs: []
  },
  AGE_EXPLORATION: {
    names: [
      "The Crisis of Empire",
      "The Age of Upheaval",
      "The Revolutionary Years",
      "The Reform Crisis"
    ],
    arcs: []
  }
};
// Tiny placeholder pools — only the most evocative entries kept.
// {regional} dropped "Provincial" (read awkwardly with "Invasions" /
// "Reformation"); the specific provincial names that DO work live as
// literals in the relevant pools (Provincial Revolts, Provincial Schism,
// Reformation of the Provinces).
const CRISIS_COLORS = ["Black", "Red", "Grey", "Ashen"];
const CRISIS_PLACES = ["Frontier", "Provinces", "Steppe", "Coast", "Heartland"];
const CRISIS_REGIONAL = ["Northern", "Eastern"];

/**
 * FNV-1a-ish 32-bit string hash, used to seed deterministic crisis-name picks.
 * @param {string} s Source string.
 * @returns {number} An unsigned 32-bit hash.
 */
function hashString(s) {
  let h = 2166136261 >>> 0; // FNV-1a-ish
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * Pick an array element by seed modulo length.
 * @template T
 * @param {T[]} arr Source array.
 * @param {number} seed Seed value.
 * @returns {T} The selected element.
 */
function pickSeeded(arr, seed) {
  return arr[seed % arr.length];
}

/**
 * Read the game's start seed from the engine `Configuration`, defensively.
 * @returns {string} The seed string, or "" when unavailable.
 */
function getGameSeed() {
  try {
    if (typeof Configuration !== "undefined" && typeof Configuration.getGame === "function") {
      const g = Configuration.getGame();
      const s = g && (g.startSeed ?? g.gameSeed ?? g.mapSeed);
      if (s !== undefined && s !== null) return String(s);
    }
  } catch (_) {
    // Configuration.getGame may be absent or throw; fall back to an empty seed string.
  }
  return "";
}

/**
 * Resolve the `{ names, arcs }` template entry for a crisis sample, tolerating
 * the legacy flat-array shape.
 * @param {Snapshot|*} sample The crisis sample.
 * @returns {{ names: string[], arcs: string[][] }} The resolved pools.
 */
function resolveCrisisEntry(sample) {
  const t = sample && sample.crisisEventType;
  const entry = (t && CRISIS_NAME_TEMPLATES[t]) ||
    CRISIS_FALLBACK_BY_AGE[sample && sample.age] || { names: ["The Crisis"], arcs: [] };
  // Backward-compat: tolerate the legacy flat-array shape.
  const names = Array.isArray(entry) ? entry : entry.names || ["The Crisis"];
  const arcs = Array.isArray(entry) ? [] : entry.arcs || [];
  return { names, arcs };
}

/**
 * Compose a seeded, historian-style crisis name for a sample + stage. The same
 * game (seed) always reads consistently.
 * @param {Snapshot|*} sample The crisis sample (carries crisisEventType/age).
 * @param {number} stage The 1-based display stage.
 * @param {string} gameSeedStr The game's seed string.
 * @returns {string} The composed crisis name.
 */
function flavorCrisisName(sample, stage, gameSeedStr) {
  const t = sample && sample.crisisEventType;
  const { names, arcs } = resolveCrisisEntry(sample);
  const seedKey = (t || (sample && sample.age) || "crisis") + "|" + gameSeedStr;
  const seed = hashString(seedKey);
  // Arc vs single-name decision — seeded so each game commits to one mode for
  // the run. ~35% chance of an arc when arcs exist; otherwise pick from the
  // single-name pool. Single-name is the default so the marker reads as one
  // stable event across all four stages most of the time.
  const useArc = arcs.length > 0 && hashString(seedKey + "|arc-choice") % 100 < 35;
  if (useArc) {
    const arc = arcs[seed % arcs.length];
    const idx = Math.max(0, Math.min(arc.length - 1, (stage | 0 || 1) - 1));
    return arc[idx];
  }
  const template = pickSeeded(names, seed);
  return template
    .replace(/\{color\}/g, pickSeeded(CRISIS_COLORS, hashString(seedKey + "|color")))
    .replace(/\{place\}/g, pickSeeded(CRISIS_PLACES, hashString(seedKey + "|place")))
    .replace(/\{regional\}/g, pickSeeded(CRISIS_REGIONAL, hashString(seedKey + "|regional")));
}

/**
 * A crisis stage-transition marker.
 * @typedef {Object} CrisisMarker
 * @property {number|*} turn Chart-X position.
 * @property {number} stage Display stage (1-4).
 * @property {string} label Stage label.
 * @property {string} color Stage color.
 * @property {string} year Game-year string.
 * @property {string} crisisName Flavor crisis name.
 */

/**
 * Walk the history for game-wide crisis stage onsets and build markers.
 * Suppressed on the crisis_stage chart itself.
 * @param {string} metricId Active metric id.
 * @param {DemoHistory|*} history The history blob.
 * @param {Map<string, number>} ageOffsets Per-age cumulative offsets.
 * @param {AgeBoundary[]} boundaries Age boundary table.
 * @param {string} gameSeedStr The game seed string (for flavor names).
 * @returns {CrisisMarker[]} The crisis markers.
 */
function collectCrisisMarkers(metricId, history, ageOffsets, boundaries, gameSeedStr) {
  /** @type {CrisisMarker[]} */
  const crisisMarkers = [];
  if (
    metricId === "crisis_stage" ||
    !history ||
    !Array.isArray(history.samples) ||
    history.samples.length === 0
  ) {
    return crisisMarkers;
  }
  // `prev` carried across samples by reference via a 1-element holder so the
  // onset-detection logic lives in one small helper.
  const prevHolder = { prev: -2 }; // sentinel != -1 so first sample is "init"
  for (const s of history.samples) {
    const mk = detectCrisisOnset(s, prevHolder, ageOffsets, boundaries, gameSeedStr);
    if (mk) crisisMarkers.push(mk);
  }
  return crisisMarkers;
}

/**
 * Detect a crisis stage onset on one sample, advancing the running `prev`
 * stage. Returns a marker on onset, else `null`.
 * @param {Snapshot|*} s One sample.
 * @param {{ prev: number }} prevHolder Running previous-stage holder (mutated).
 * @param {Map<string, number>} ageOffsets Per-age cumulative offsets.
 * @param {AgeBoundary[]} boundaries Age boundary table.
 * @param {string} gameSeedStr The game seed string.
 * @returns {CrisisMarker|null} The onset marker, or `null`.
 */
function detectCrisisOnset(s, prevHolder, ageOffsets, boundaries, gameSeedStr) {
  const raw = readSampleCrisisStage(s);
  if (raw === undefined) return null;
  const prev = prevHolder.prev;
  // raw is the DISPLAY value (engine+1 from the accessor): 0..4. A transition
  // from 0/lower → ≥1 is a stage onset.
  let marker = null;
  if (raw > prev && raw >= 1 && prev >= 0) {
    marker = makeCrisisMarker(s, raw, ageOffsets, boundaries, gameSeedStr);
  }
  if (raw >= 0) prevHolder.prev = raw;
  else if (prev === -2) prevHolder.prev = raw; // first sample seed
  return marker;
}

const CRISIS_STAGE_LABELS = [
  "Crisis Begins",
  "Crisis Intensifies",
  "Crisis Culminates",
  "Crisis Ends"
];
const CRISIS_STAGE_COLORS = ["#e69a3c", "#e57c1a", "#d54a2b", "#9a2a2a"];

/**
 * Read the global crisis_stage display value off any one player's metrics in a
 * sample.
 * @param {Snapshot|*} s One sample.
 * @returns {number|undefined} The display stage, or `undefined`.
 */
function readSampleCrisisStage(s) {
  // crisis_stage was stored on EVERY player's metrics by the sampler (it's a
  // global value). Read from any one player.
  const players = s?.players;
  if (!players) return undefined;
  const pidKeys = Object.keys(players);
  if (pidKeys.length === 0) return undefined;
  const m = players[pidKeys[0]]?.metrics;
  return m && typeof m.crisis_stage === "number" ? m.crisis_stage : undefined;
}

/**
 * Build one {@link CrisisMarker} for a stage onset.
 * @param {Snapshot} s The onset sample.
 * @param {number} raw The display stage value.
 * @param {Map<string, number>} ageOffsets Per-age cumulative offsets.
 * @param {AgeBoundary[]} boundaries Age boundary table.
 * @param {string} gameSeedStr The game seed string.
 * @returns {CrisisMarker} The marker.
 */
function makeCrisisMarker(s, raw, ageOffsets, boundaries, gameSeedStr) {
  const stageIdx = Math.min(CRISIS_STAGE_LABELS.length - 1, raw - 1);
  const cx = sampleX(s, ageOffsets, boundaries);
  return {
    turn: typeof cx === "number" ? cx : s.turn,
    stage: raw,
    label: CRISIS_STAGE_LABELS[stageIdx],
    color: CRISIS_STAGE_COLORS[stageIdx],
    year: s.gameYear || "",
    crisisName: flavorCrisisName(s, raw, gameSeedStr)
  };
}

/**
 * An age-boundary marker.
 * @typedef {Object} AgeMarker
 * @property {number} turn Chart-X position (age offset + 1).
 * @property {string} label Marker label.
 * @property {string} color Marker color.
 */

/**
 * Build age-boundary markers from `history.ageBoundaries`.
 * @param {DemoHistory|*} history The history blob.
 * @param {Map<string, number>} ageOffsets Per-age cumulative offsets.
 * @returns {AgeMarker[]} The age markers.
 */
function collectAgeMarkers(history, ageOffsets) {
  /** @type {AgeMarker[]} */
  const ageMarkers = [];
  if (!history || !Array.isArray(history.ageBoundaries)) return ageMarkers;
  /** @type {Record<string, string>} */
  const AGE_NAMES = {
    AGE_ANTIQUITY: "Antiquity Begins",
    AGE_EXPLORATION: "Exploration Begins",
    AGE_MODERN: "Modern Begins"
  };
  for (const b of history.ageBoundaries) {
    if (!b || typeof b.age !== "string") continue;
    // The boundary marker should sit at the LEFTMOST X of the new age. From
    // the deterministic offset table that's simply the age's offset + 1 (the
    // new age's first localTurn is 1).
    const baseOffset = ageOffsets.get(b.age);
    if (typeof baseOffset !== "number") continue;
    ageMarkers.push({
      turn: baseOffset + 1,
      label: AGE_NAMES[b.age] || b.age.replace(/^AGE_/, "") + " Begins",
      color: "#b78cff" // soft purple
    });
  }
  return ageMarkers;
}

/**
 * Build the focus-glow Chart.js plugin: redraws each focused line wider and
 * translucent behind the real strokes.
 * @returns {Record<string, *>} The Chart.js plugin object.
 */
function makeFocusGlowPlugin() {
  return {
    id: "demographicsFocusGlow",
    /**
     * @param {*} c The Chart instance.
     * @returns {void}
     */
    beforeDatasetsDraw(c) {
      const ctx2 = c.ctx;
      const meta = c.data && c.data.datasets;
      if (!meta) return;
      for (let i = 0; i < meta.length; i++) {
        const elems = focusedGlowElems(c, meta[i], i);
        if (elems) strokeGlowPath(ctx2, meta[i], elems);
      }
    }
  };
}

/**
 * Return a focused, visible dataset's point elements (>=2), or `null` when the
 * dataset shouldn't glow.
 * @param {*} c The Chart instance.
 * @param {Record<string, *>} ds The dataset.
 * @param {number} i The dataset index.
 * @returns {{ x: number, y: number }[]|null} The point elements, or `null`.
 */
function focusedGlowElems(c, ds, i) {
  if (!ds || !ds._focused || ds.hidden) return null;
  const dsMeta = c.getDatasetMeta(i);
  if (!dsMeta || dsMeta.hidden) return null;
  const elems = dsMeta.data;
  if (!elems || elems.length < 2) return null;
  return elems;
}

/**
 * Stroke one focused line's translucent glow path.
 * @param {*} ctx2 The 2D canvas context.
 * @param {Record<string, *>} ds The Chart.js dataset.
 * @param {{ x: number, y: number }[]} elems The dataset's point elements.
 * @returns {void}
 */
function strokeGlowPath(ctx2, ds, elems) {
  ctx2.save();
  ctx2.strokeStyle = ds.borderColor;
  ctx2.globalAlpha = 0.35;
  ctx2.lineWidth = (ds.borderWidth || 3) + 4;
  ctx2.lineJoin = "round";
  ctx2.lineCap = "round";
  ctx2.beginPath();
  let started = false;
  for (const pt of elems) {
    if (!pt || typeof pt.x !== "number" || typeof pt.y !== "number") continue;
    if (!started) {
      ctx2.moveTo(pt.x, pt.y);
      started = true;
    } else {
      ctx2.lineTo(pt.x, pt.y);
    }
  }
  if (started) ctx2.stroke();
  ctx2.restore();
}

/**
 * Build the hover-crosshair Chart.js plugin: a gold dashed vertical line at
 * the tooltip's nearest-x.
 * @returns {Record<string, *>} The Chart.js plugin object.
 */
function makeHoverCrosshairPlugin() {
  return {
    id: "demographicsHoverCrosshair",
    /**
     * @param {*} c The Chart instance.
     * @returns {void}
     */
    afterDatasetsDraw(c) {
      const tt = c.tooltip;
      if (!tt || !tt.opacity || !tt.dataPoints || tt.dataPoints.length === 0) return;
      const xScale = c.scales.x;
      if (!xScale) return;
      const hoverX = tt.dataPoints[0].element?.x;
      if (typeof hoverX !== "number") return;
      const ctx2 = c.ctx;
      const { top, bottom } = c.chartArea;
      ctx2.save();
      ctx2.strokeStyle = "#f3c34c"; // accent gold
      ctx2.lineWidth = 1.2;
      ctx2.setLineDash([4, 3]);
      ctx2.globalAlpha = 0.9;
      ctx2.beginPath();
      ctx2.moveTo(hoverX, top);
      ctx2.lineTo(hoverX, bottom);
      ctx2.stroke();
      ctx2.restore();
    }
  };
}

/**
 * Draw one crisis marker's vertical line + two-line label pill.
 * @param {*} ctx2 The 2D canvas context.
 * @param {CrisisMarker} mk The marker.
 * @param {number} x Pixel x position.
 * @param {number} top Plot-area top.
 * @param {number} bottom Plot-area bottom.
 * @returns {void}
 */
function drawCrisisMarker(ctx2, mk, x, top, bottom) {
  ctx2.save();
  ctx2.strokeStyle = mk.color;
  ctx2.lineWidth = 1.4;
  ctx2.setLineDash([4, 3]);
  ctx2.globalAlpha = 0.85;
  ctx2.beginPath();
  ctx2.moveTo(x, top);
  ctx2.lineTo(x, bottom);
  ctx2.stroke();
  ctx2.setLineDash([]);
  // Two-line label: stage on top (in the marker's color), the formal crisis
  // name below in cream. A single background pill sized to the wider of the
  // two lines holds both.
  const family = Chart.defaults.font.family || "BodyFont, sans-serif";
  const stageText = mk.label + (mk.year ? " · " + mk.year : "");
  const nameText = mk.crisisName || "";
  ctx2.font = "14px " + family;
  const stageW = ctx2.measureText(stageText).width;
  ctx2.font = "11px " + family;
  const nameW = nameText ? ctx2.measureText(nameText).width : 0;
  const pillW = Math.max(stageW, nameW) + 10;
  const pillH = nameText ? 32 : 20;
  ctx2.translate(x + 4, top + 6);
  ctx2.fillStyle = "rgba(20, 16, 10, 0.85)";
  ctx2.fillRect(0, 0, pillW, pillH);
  ctx2.font = "14px " + family;
  ctx2.fillStyle = mk.color;
  ctx2.fillText(stageText, 5, 15);
  if (nameText) {
    ctx2.font = "11px " + family;
    ctx2.fillStyle = "#e5d2ac";
    ctx2.fillText(nameText, 5, 28);
  }
  ctx2.restore();
}

/**
 * Build the crisis-marker Chart.js plugin: vertical lines + labels at each
 * crisis stage onset, respecting the active x-scale range.
 * @param {CrisisMarker[]} crisisMarkers The markers to draw.
 * @returns {Record<string, *>} The Chart.js plugin object.
 */
function makeCrisisMarkerPlugin(crisisMarkers) {
  return {
    id: "demographicsCrisisMarkers",
    /**
     * @param {*} c The Chart instance.
     * @returns {void}
     */
    afterDatasetsDraw(c) {
      if (!crisisMarkers || crisisMarkers.length === 0) return;
      const xScale = c.scales.x;
      if (!xScale) return;
      const ctx2 = c.ctx;
      const { top, bottom } = c.chartArea;
      for (const mk of crisisMarkers) {
        if (mk.turn < xScale.min || mk.turn > xScale.max) continue;
        const x = xScale.getPixelForValue(mk.turn);
        drawCrisisMarker(ctx2, mk, x, top, bottom);
      }
    }
  };
}

/**
 * Build the cap-limit-line Chart.js plugin: a red rule at y=100 on the
 * Settlement Cap Utilization chart. No-op on other metrics.
 * @param {string} metricId Active metric id.
 * @returns {Record<string, *>} The Chart.js plugin object.
 */
function makeCapLimitLinePlugin(metricId) {
  return {
    id: "demographicsCapLimitLine",
    /**
     * @param {*} c The Chart instance.
     * @returns {void}
     */
    afterDatasetsDraw(c) {
      if (metricId !== "settlement_cap_pct") return;
      const yScale = c.scales.y;
      if (!yScale) return;
      if (100 < yScale.min || 100 > yScale.max) return;
      const y = yScale.getPixelForValue(100);
      const { left, right } = c.chartArea;
      const ctx2 = c.ctx;
      ctx2.save();
      ctx2.strokeStyle = "#e02020";
      ctx2.lineWidth = 2;
      ctx2.globalAlpha = 0.95;
      ctx2.beginPath();
      ctx2.moveTo(left, y);
      ctx2.lineTo(right, y);
      ctx2.stroke();
      // Tiny label on the right edge so the line is self-documenting.
      ctx2.font = "11px " + (Chart.defaults.font.family || "BodyFont, sans-serif");
      const text = "Cap 100%";
      const textW = ctx2.measureText(text).width;
      ctx2.fillStyle = "rgba(20, 16, 10, 0.85)";
      ctx2.fillRect(right - textW - 8, y - 14, textW + 8, 14);
      ctx2.fillStyle = "#e02020";
      ctx2.fillText(text, right - textW - 4, y - 3);
      ctx2.restore();
    }
  };
}

/**
 * Build the age-boundary-marker Chart.js plugin: purple long-dash lines +
 * labels at each age transition.
 * @param {AgeMarker[]} ageMarkers The markers to draw.
 * @returns {Record<string, *>} The Chart.js plugin object.
 */
function makeAgeMarkerPlugin(ageMarkers) {
  return {
    id: "demographicsAgeMarkers",
    /**
     * @param {*} c The Chart instance.
     * @returns {void}
     */
    afterDatasetsDraw(c) {
      if (!ageMarkers || ageMarkers.length === 0) return;
      const xScale = c.scales.x;
      if (!xScale) return;
      const ctx2 = c.ctx;
      const { top, bottom } = c.chartArea;
      for (const mk of ageMarkers) {
        if (mk.turn < xScale.min || mk.turn > xScale.max) continue;
        const x = xScale.getPixelForValue(mk.turn);
        ctx2.save();
        ctx2.strokeStyle = mk.color;
        ctx2.lineWidth = 1.8;
        // Long-dash pattern (different from crisis [4,3]) so the two marker
        // types are distinguishable beyond color alone.
        ctx2.setLineDash([8, 4]);
        ctx2.globalAlpha = 0.95;
        ctx2.beginPath();
        ctx2.moveTo(x, top);
        ctx2.lineTo(x, bottom);
        ctx2.stroke();
        ctx2.setLineDash([]);
        // Label pill — same chrome as crisis markers, just purple.
        ctx2.font = "14px " + (Chart.defaults.font.family || "BodyFont, sans-serif");
        const textW = ctx2.measureText(mk.label).width;
        ctx2.translate(x + 4, top + 28); // offset below crisis labels
        ctx2.fillStyle = "rgba(20, 16, 10, 0.85)";
        ctx2.fillRect(0, 0, textW + 10, 20);
        ctx2.fillStyle = mk.color;
        ctx2.fillText(mk.label, 5, 15);
        ctx2.restore();
      }
    }
  };
}

/**
 * Ensure the HTML-overlay line-chart tooltip element exists in `wrap`.
 * @param {HTMLElement} wrap The chart wrap.
 * @returns {HTMLElement} The tooltip element.
 */
function ensureChartTooltipEl(wrap) {
  let tip = /** @type {HTMLElement|null} */ (wrap.querySelector(".demographics-chart-tooltip"));
  if (!tip) {
    tip = document.createElement("div");
    tip.className =
      "demographics-chart-tooltip demographics-line-chart-tooltip img-tooltip-border img-tooltip-bg";
    wrap.appendChild(tip);
  }
  return tip;
}

/**
 * Sort tooltip data points to match the chart/legend dataset order.
 * @param {*} tooltip The Chart.js tooltip model.
 * @param {*} chart The Chart instance.
 * @returns {*[]} The ordered data-point array.
 */
function sortTooltipDataPoints(tooltip, chart) {
  /** @type {*[]} */
  const dataPoints = tooltip.dataPoints ? tooltip.dataPoints.slice() : [];
  if (dataPoints.length && chart.data && chart.data.datasets) {
    const dsOrder = chart.data.datasets.map((/** @type {*} */ ds) => ds.label);
    dataPoints.sort((/** @type {*} */ a, /** @type {*} */ b) => {
      const ai = dsOrder.indexOf(a.dataset.label);
      const bi = dsOrder.indexOf(b.dataset.label);
      return ai - bi;
    });
  }
  return dataPoints;
}

/**
 * Resolve the cached leader-icon HTML for a dataset (leader portrait dot, or a
 * colored fallback dot), caching it on the dataset.
 * @param {Record<string, *>} ds The Chart.js dataset.
 * @param {string} color The (lifted) row color.
 * @returns {string} The icon HTML.
 */
function resolveLeaderIconHTML(ds, color) {
  if (ds._leaderIconHTML) return ds._leaderIconHTML;
  let iconHTML = "";
  try {
    const lt = ds.leaderType;
    if (
      lt &&
      /^LEADER_/.test(lt) &&
      typeof UI !== "undefined" &&
      typeof UI.getIconURL === "function"
    ) {
      const url = (UI.getIconURL(lt, "LEADER") + ".png").toLowerCase();
      iconHTML =
        '<div style="width:1.4rem;height:1.4rem;border-radius:50%;' +
        "background:url('" +
        url +
        "') center/cover no-repeat;" +
        "border:1px solid " +
        color +
        ';flex-shrink:0;"></div>';
    }
  } catch (_) {
    // UI.getIconURL may be absent or throw; fall through to the colored-dot fallback.
  }
  if (!iconHTML) {
    // No leader icon — show a colored dot.
    iconHTML =
      '<div style="width:0.7rem;height:0.7rem;border-radius:50%;' +
      "background:" +
      color +
      ';flex-shrink:0;margin:0 0.35rem;"></div>';
  }
  ds._leaderIconHTML = iconHTML;
  return iconHTML;
}

/**
 * Build one tooltip row's HTML (icon + civ label + value).
 * @param {*} dp One Chart.js tooltip data point.
 * @param {(v: number) => string} fmtY Y-value formatter.
 * @returns {string} The row HTML.
 */
function buildTooltipRow(dp, fmtY) {
  const ds = dp.dataset;
  const rawColor = typeof ds.borderColor === "string" ? ds.borderColor : "#e5d2ac";
  // Lift dark civ colors (dark blue/purple) so the value column and the
  // leader-dot stay readable on the dark tooltip background.
  const color = tooltipSafeTextColor(rawColor);
  const label = ds.label || "";
  const valStr = fmtY(dp.parsed.y);
  const iconHTML = resolveLeaderIconHTML(ds, color);
  return (
    '<div style="display:flex;align-items:center;gap:0.45rem;padding:0.12rem 0;">' +
    iconHTML +
    '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;' +
    'white-space:nowrap;color:#e5d2ac;">' +
    label +
    "</span>" +
    '<span style="font-family:monospace, ui-monospace;font-weight:700;' +
    "color:" +
    color +
    ';white-space:nowrap;margin-left:0.4rem;">' +
    valStr +
    "</span>" +
    "</div>"
  );
}

/**
 * Position the HTML tooltip near the cursor, clamped inside the wrap.
 * @param {HTMLElement} tip The tooltip element.
 * @param {*} chart The Chart instance.
 * @param {*} tooltip The Chart.js tooltip model.
 * @param {HTMLElement} wrap The chart wrap.
 * @returns {void}
 */
function positionChartTooltip(tip, chart, tooltip, wrap) {
  // Position next to the cursor. Chart.js gives caretX/Y in canvas pixels —
  // relative to the parent wrap that contains both canvas+tooltip.
  const offsetLeft = chart.canvas.offsetLeft;
  const offsetTop = chart.canvas.offsetTop;
  let left = offsetLeft + tooltip.caretX + 14;
  let top = offsetTop + tooltip.caretY - 8;
  // Clamp so it doesn't escape the wrap.
  const wrapW = wrap.clientWidth,
    wrapH = wrap.clientHeight;
  const tipW = tip.offsetWidth,
    tipH = tip.offsetHeight;
  if (left + tipW > wrapW) left = offsetLeft + tooltip.caretX - tipW - 14;
  if (top + tipH > wrapH) top = wrapH - tipH - 4;
  if (top < 0) top = 4;
  tip.style.left = left + "px";
  tip.style.top = top + "px";
  tip.style.opacity = "1";
}

/**
 * Build the Chart.js `tooltip.external` handler bound to the axis formatters.
 * @param {(v: number) => string} fmtX X-value formatter.
 * @param {(v: number) => string} fmtY Y-value formatter.
 * @returns {(context: *) => void} The external tooltip handler.
 */
function makeTooltipExternal(fmtX, fmtY) {
  return function (context) {
    const { chart, tooltip } = context;
    const wrap = chart.canvas.parentNode;
    const tip = ensureChartTooltipEl(wrap);
    if (tooltip.opacity === 0) {
      tip.style.opacity = "0";
      return;
    }
    // Header: turn / year (yellow).
    const titleText =
      tooltip.dataPoints && tooltip.dataPoints.length ? fmtX(tooltip.dataPoints[0].parsed.x) : "";
    // Body: one row per civ, with leader icon + name + value, sorted to match
    // chart/legend line order.
    const dataPoints = sortTooltipDataPoints(tooltip, chart);
    const rows = dataPoints.map((dp) => buildTooltipRow(dp, fmtY));
    tip.innerHTML =
      '<div style="font-family:TitleFont, BodyFont, sans-serif;' +
      "font-weight:700;text-transform:uppercase;letter-spacing:0.08em;" +
      "color:#f3c34c;font-size:0.85rem;" +
      "border-bottom:1px solid rgba(168,132,90,0.5);" +
      'padding-bottom:0.25rem;margin-bottom:0.3rem;">' +
      titleText +
      "</div>" +
      rows.join("");
    positionChartTooltip(tip, chart, tooltip, wrap);
  };
}

/**
 * Build the Chart.js legend `onClick` handler bound to the toggle callback.
 * @param {ChartOptions} opts The render options.
 * @returns {(e: *, item: *, legend: *) => void} The legend click handler.
 */
function makeLegendOnClick(opts) {
  return (_e, item, legend) => {
    const ci = legend.chart;
    const ds = ci.data.datasets[item.datasetIndex];
    const lt = ds && ds.leaderType;
    const cb = opts.onToggleCiv;
    if (typeof cb === "function" && lt) {
      cb(lt);
    } else {
      ds.hidden = !ds.hidden;
      ci.update();
    }
  };
}

/**
 * Build the full Chart.js line-chart config (data + plugins + options).
 * @param {Object} parts Config inputs.
 * @param {Record<string, *>[]} parts.datasets The datasets.
 * @param {Record<string, *>[]} parts.plugins The plugin instances.
 * @param {ChartOptions} parts.opts The render options.
 * @param {*} parts.metricMeta The metric metadata.
 * @param {string} parts.metricId The metric id.
 * @param {AxisFormatters} parts.formatters The axis tick formatters.
 * @returns {Record<string, *>} The Chart.js config object.
 */
function buildLineChartConfig(parts) {
  const { datasets, plugins, opts, metricMeta, metricId, formatters } = parts;
  return {
    type: "line",
    data: { datasets },
    plugins,
    options: {
      responsive: false,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      normalized: true,
      interaction: { mode: "nearest", intersect: false, axis: "x" },
      plugins: buildChartPluginsOpts(opts, metricMeta, metricId, formatters),
      scales: buildChartScalesOpts(metricMeta, formatters)
    }
  };
}

/**
 * Build the Chart.js `options.plugins` block (legend / tooltip / title).
 * @param {ChartOptions} opts The render options.
 * @param {*} metricMeta The metric metadata.
 * @param {string} metricId The metric id.
 * @param {AxisFormatters} formatters The axis tick formatters.
 * @returns {Record<string, *>} The plugins options block.
 */
function buildChartPluginsOpts(opts, metricMeta, metricId, formatters) {
  const { fmtX, fmtY } = formatters;
  return {
    legend: {
      position: "right",
      labels: {
        color: "#E5E5E5",
        usePointStyle: true,
        boxWidth: 12,
        // Bumped from 8 → 14 for a touch more breathing room between each
        // civ legend entry.
        padding: 14,
        font: { family: Chart.defaults.font.family, size: 14 }
      },
      onClick: makeLegendOnClick(opts)
    },
    tooltip: {
      // Disable Chart.js's canvas-painted tooltip and use an HTML overlay
      // styled with the engine's own `img-tooltip-border` + `img-tooltip-bg`
      // classes — border-image from blp:base_tooltip-bg, the same dark
      // gradient native tooltips use. Each row gets a small leader icon next
      // to the civ label.
      enabled: false,
      external: makeTooltipExternal(fmtX, fmtY)
    },
    title: {
      display: !!(metricMeta && (metricMeta.title || metricMeta.label)),
      text: metricMeta ? metricMeta.title || metricMeta.label || metricId : metricId,
      color: "#f3c34c",
      font: { family: Chart.defaults.font.family, size: 18, weight: "600" },
      padding: { top: 4, bottom: 12 }
    }
  };
}

/**
 * Build the Chart.js `options.scales` block (linear x + y axes).
 * @param {*} metricMeta The metric metadata.
 * @param {AxisFormatters} formatters The axis tick formatters.
 * @returns {Record<string, *>} The scales options block.
 */
function buildChartScalesOpts(metricMeta, formatters) {
  const { fmtX, fmtY } = formatters;
  return {
    x: {
      type: "linear",
      ticks: {
        color: "#E5E5E5",
        font: { family: Chart.defaults.font.family, size: 15 },
        maxRotation: 0,
        autoSkipPadding: 30,
        callback: (/** @type {number} */ v) => fmtX(v)
      },
      grid: { color: "rgba(133, 135, 140, 0.25)" },
      border: { color: "#85878C" }
    },
    y: {
      type: "linear",
      beginAtZero: true,
      ticks: {
        color: "#E5E5E5",
        font: { family: Chart.defaults.font.family, size: 15 },
        // For metrics flagged `integerOnly`, blank out fractional tick labels
        // so e.g. Crisis Stage doesn't repeat "Stage 1 (Begins)" at 1, 1.5,
        // and 2 all rounding to the same integer. Chart.js still draws
        // gridlines at fractional positions; only the labels are suppressed.
        callback: (/** @type {number} */ v) => {
          if (metricMeta && metricMeta.integerOnly && Math.round(v) !== v) return "";
          return fmtY(v);
        },
        // Force integer step + zero decimals when the metric is integer-only
        // AND its expected range is small (so we don't constrain large-range
        // metrics like Score with stepSize=1).
        ...(metricMeta && metricMeta.integerOnly ? { stepSize: 1, precision: 0 } : {})
      },
      grid: { color: "rgba(133, 135, 140, 0.25)" },
      border: { color: "#85878C" }
    }
  };
}

/**
 * Mount the Chart.js instance into `host`, logging on success and rendering a
 * fallback message on failure.
 * @param {Object} parts Mount inputs.
 * @param {*} parts.host The chart host (carries the engine `_demographicsChart`).
 * @param {*} parts.canvas The canvas element.
 * @param {Record<string, *>} parts.config The Chart.js config.
 * @param {Record<string, *>[]} parts.datasets The datasets (for logging).
 * @param {string} parts.metricId The metric id (for logging).
 * @param {number} parts.sampleCount The sample count (for logging).
 * @param {number} parts.W Final width (for logging).
 * @param {number} parts.H Final height (for logging).
 * @returns {*} The Chart instance, or `null` on failure.
 */
function mountLineChart(parts) {
  const { host, canvas, config, datasets, metricId, sampleCount, W, H } = parts;
  // Chart.js is a base-game-provided global (core/ui/external/chart-js); guard
  // for its absence the way Firaxis's own fxs-hof-chart.js does.
  if (typeof Chart === "undefined") {
    console.error("[Demographics.chart] Chart.js global unavailable; cannot render chart.");
    const msg = document.createElement("div");
    msg.className = "demographics-empty font-body text-base";
    msg.textContent = "Charts unavailable — Chart.js not loaded.";
    host.appendChild(msg);
    return null;
  }
  try {
    const ctx2d = canvas.getContext("2d");
    const chart = new Chart(ctx2d, config);
    host._demographicsChart = chart;
    const visibleCount = datasets.filter((/** @type {*} */ d) => !d.hidden).length;
    dlog(
      "Chart.js mounted; visible=",
      visibleCount,
      "of",
      datasets.length,
      "metric=",
      metricId,
      "samples=",
      sampleCount,
      "size=",
      W + "x" + H,
      "chart.width=",
      chart.width,
      "chart.height=",
      chart.height
    );
    return chart;
  } catch (e) {
    const err = /** @type {*} */ (e);
    console.error(
      "[Demographics.chart] Chart.js new Chart threw:",
      err && err.message,
      err && err.stack
    );
    const msg = document.createElement("div");
    msg.className = "demographics-empty font-body text-base";
    msg.textContent = "Chart failed to render — see UI.log.";
    host.appendChild(msg);
    return null;
  }
}

/**
 * Hidden/focused/series options accepted by {@link renderChart}.
 * @typedef {Object} ChartOptions
 * @property {DemoHistory|*} [history] The persisted history blob.
 * @property {string} [metric] Metric id to chart (default `"score"`).
 * @property {Set<string>|string[]} [hiddenCivs] Hidden series keys.
 * @property {Set<string>|string[]} [focusedCivs] Focused series keys.
 * @property {number} [width] Caller width hint.
 * @property {number} [height] Caller height hint.
 * @property {{ min: number, max: number }} [turnRange] Time-range filter.
 * @property {(leaderType: string) => void} [onToggleCiv] Legend toggle callback.
 */

/**
 * Prepared chart data: series, metric metadata, datasets, axis formatters,
 * and the age-offset context needed for markers.
 * @typedef {Object} ChartPrep
 * @property {ChartSeries[]} allSeries The (transformed) series list.
 * @property {number} sampleCount The sample count.
 * @property {*} metricMeta The metric metadata.
 * @property {Record<string, *>[]} datasets The Chart.js datasets.
 * @property {AxisFormatters} formatters The axis tick formatters.
 * @property {Map<string, number>} ageOffsets Per-age cumulative offsets.
 * @property {AgeBoundary[]} boundaries Age boundary table.
 */

/**
 * Build all per-render chart data: series (with settings applied), datasets,
 * axis formatters, and the age-offset context for markers.
 * @param {ChartOptions} opts The render options.
 * @param {string} metricId The metric id.
 * @returns {ChartPrep} The prepared chart data.
 */
function prepareChartData(opts, metricId) {
  const hidden = coerceKeySet(opts.hiddenCivs);
  const focused = coerceKeySet(opts.focusedCivs);

  const result = buildSeriesFromHistory(opts.history, metricId);
  let allSeries = result.series;
  const sampleCount = result.sampleCount;

  // showEliminatedCivs (default true) and smoothChart (default false).
  allSeries = applyShowEliminated(allSeries);
  applySmoothChart(allSeries);

  const metricMeta = resolveMetricMeta(metricId);
  allSeries = collapseGlobalMetric(allSeries, metricMeta, metricId);

  // showUnmetNames placeholder (Fix 4).
  applyUnmetNames(allSeries);

  const tr = resolveTurnRange(opts);

  // Year + age aware x-axis labels.
  const samps = opts.history && Array.isArray(opts.history.samples) ? opts.history.samples : [];
  const boundaries =
    opts.history && Array.isArray(opts.history.ageBoundaries) ? opts.history.ageBoundaries : [];
  const { offsets: ageOffsets } = computeAgeOffsets(samps, boundaries);
  const turnMaps = buildTurnMaps(samps, ageOffsets, boundaries);
  const formatters = makeAxisFormatters(turnMaps, metricMeta);

  const datasets = buildChartDatasets(allSeries, hidden, focused, tr);

  return { allSeries, sampleCount, metricMeta, datasets, formatters, ageOffsets, boundaries };
}

/**
 * Build the ordered Chart.js plugin set (focus glow, wonder markers, hover
 * crosshair, crisis markers, age markers, cap-limit line) for one render.
 * @param {ChartOptions} opts The render options.
 * @param {string} metricId The metric id.
 * @param {ChartPrep} prep The prepared chart data.
 * @returns {Record<string, *>[]} The ordered plugin instances.
 */
function buildChartPluginSet(opts, metricId, prep) {
  const { allSeries, ageOffsets, boundaries } = prep;
  // Wonder-built event markers — detect, resolve icons/names, then mount as an
  // HTML overlay plugin (differential updates avoid hover flicker).
  const wonderEventsByPid = shouldShowWonders(metricId)
    ? collectWonderEvents(
        opts.history && Array.isArray(opts.history.samples) ? opts.history.samples : [],
        ageOffsets,
        boundaries
      )
    : new Map();
  resolveWonderEvents(wonderEventsByPid);
  dlog(
    "wonder events detected:",
    wonderEventsByPid.size,
    "civs;",
    Array.from(wonderEventsByPid.values()).reduce((n, arr) => n + arr.length, 0),
    "total wonder events"
  );
  const wonderMarkerEls = new Map(); // key: "pid:turn" -> div element
  // Singleton custom hover tooltip — Coherent ignores native `title`.
  /** @type {WonderTipState} */
  const wonderTipState = { wonderTip: null };
  const wonderMarkersPlugin = makeWonderMarkersPlugin(
    allSeries,
    wonderEventsByPid,
    wonderMarkerEls,
    wonderTipState
  );

  // Crisis stage transition + age-boundary markers.
  const crisisMarkers = collectCrisisMarkers(
    metricId,
    opts.history,
    ageOffsets,
    boundaries,
    getGameSeed()
  );
  const ageMarkers = collectAgeMarkers(opts.history, ageOffsets);

  return [
    makeFocusGlowPlugin(),
    wonderMarkersPlugin,
    makeHoverCrosshairPlugin(),
    makeCrisisMarkerPlugin(crisisMarkers),
    makeAgeMarkerPlugin(ageMarkers),
    makeCapLimitLinePlugin(metricId)
  ];
}

/**
 * Render the main per-civ line chart (Chart.js) into `host`. Tears down any
 * prior chart, builds series from history, applies the showEliminatedCivs /
 * smoothChart / showUnmetNames / time-range options, then mounts the canvas
 * with marker, glow, crosshair, and tooltip plugins.
 * @param {HTMLElement} host The chart host element (cleared and repopulated).
 * @param {ChartOptions} [options] Render options.
 * @returns {{ canvas: HTMLElement, chart: *, series: ChartSeries[] }|null}
 *   Handles to the canvas/chart/series, or `null` on failure.
 */
export function renderChart(host, options) {
  if (!host) {
    console.error("[Demographics.chart] renderChart: host is required");
    return null;
  }
  teardownExistingChart(host);
  while (host.firstChild) host.removeChild(host.firstChild);

  const opts = options || {};
  const W = opts.width || 1400;
  const H = opts.height || 600;
  const metricId = opts.metric || "score";

  if (typeof Chart === "undefined") {
    console.error("[Demographics.chart] Chart.js global missing — cannot render");
    return null;
  }
  applyEngineChartDefaults();

  const prep = prepareChartData(opts, metricId);
  const { allSeries, sampleCount, metricMeta, datasets, formatters } = prep;
  const { renderW, renderH } = computeRenderSize(opts, W, H);

  const plugins = buildChartPluginSet(opts, metricId, prep);
  const { wrap, canvas } = buildChartCanvas(renderW, renderH);
  host.appendChild(wrap);

  const config = buildLineChartConfig({
    datasets,
    plugins,
    opts,
    metricMeta,
    metricId,
    formatters
  });
  const chart = mountLineChart({
    host,
    canvas,
    config,
    datasets,
    metricId,
    sampleCount,
    W: renderW,
    H: renderH
  });
  if (!chart) return null;

  return { canvas, chart, series: allSeries };
}

/**
 * Build the relatively-positioned wrap + sized canvas for the line chart.
 * @param {number} renderW The render width (px).
 * @param {number} renderH The render height (px).
 * @returns {{ wrap: HTMLElement, canvas: HTMLElement }} The wrap and canvas.
 */
function buildChartCanvas(renderW, renderH) {
  const wrap = document.createElement("div");
  wrap.className = "demographics-chartjs-wrap demographics-line-chartjs-wrap";
  // Render dimensions are dynamic (computed per viewport) — keep inline.
  wrap.style.width = renderW + "px";
  wrap.style.height = renderH + "px";
  const canvas = document.createElement("canvas");
  canvas.className = "demographics-line-chartjs-canvas";
  canvas.width = renderW;
  canvas.height = renderH;
  // Canvas CSS size mirrors the dynamic render dimensions — keep inline.
  canvas.style.width = renderW + "px";
  canvas.style.height = renderH + "px";
  wrap.appendChild(canvas);
  return { wrap, canvas };
}
