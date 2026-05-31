// demographics-chart.js
//
// All chart rendering: the main line chart, the triumph radar, the
// resources stacked-area, the wars gantt, and the triumph race /
// completion / stack views.
//
// Originally a hand-rolled SVG renderer; migrated to Chart.js once the
// engine confirmed it was already loaded into the UI runtime (the
// in-game HoF screen uses it). Reusing Chart.defaults gives us
// pixel-identical fonts, gridlines, and tooltips for free.
//
// Main entry point:
//   renderChart(host, { history, metric, hiddenCivs, width, height })
//     host:       HTMLElement mount target
//     history:    { version, seed, samples: [{ turn, players: { pid: {
//                   leaderType, civType, metrics: { id: n } } } }] }
//     metric:     metric id (default "score")
//     hiddenCivs: Set<string> | Array<string> of leaderType keys to hide
//     width/height: numbers (defaults 1400 × 600)
//   Returns { svg, series }. `series` is the complete series list so
//   callers can render a legend that still includes hidden civs.

import { getMetric } from "/demographics/ui/demographics-metrics.js";
import { DemographicsSettings } from "/demographics/ui/demographics-settings.js";
import { safePlaySound } from "/demographics/ui/demographics-audio.js";
import { getPalette, getSemantic } from "/demographics/ui/demographics-palette.js";

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

const DBG = true;
/**
 * Debug logger; no-op unless {@link DBG} is set.
 * @param {...*} a Values to log.
 * @returns {void}
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.chart]", ...a);
}

const SVG_NS = "http://www.w3.org/2000/svg";

// Each chart render reads the palette fresh so the colorblind-mode toggle
// in Options takes effect on the very next paint without a mod reload.
// Define PALETTE as a getter so existing `PALETTE[i]` indexing keeps working.
// Typed `any` because the Proxy returns either a number (`.length`) or a color
// string (numeric index) depending on the key — a dynamic shape callers index
// freely.
/** @type {*} */
const PALETTE = new Proxy(/** @type {Record<string, string>} */ ({}), {
  /**
   * @param {Record<string, string>} _ Unused proxy target.
   * @param {string|symbol} prop `"length"` or a numeric index.
   * @returns {*} The palette length or the color at the index.
   */
  get(_, prop) {
    const p = getPalette();
    if (prop === "length") return p.length;
    return p[Number(prop)];
  }
});

/**
 * Create an SVG element with attributes set via `setAttribute`.
 * @param {string} tag SVG tag name.
 * @param {Record<string, *>} [attrs] Attribute map.
 * @returns {SVGElement} The created element.
 */
function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k]);
  return el;
}

/**
 * Read a history blob's `samples` array defensively.
 * @param {DemoHistory|*} history The history blob.
 * @returns {Snapshot[]} The samples, or an empty array.
 */
function historySamples(history) {
  return history && Array.isArray(history.samples) ? history.samples : [];
}

/**
 * Append a standard empty-state / notice element to a host.
 * @param {HTMLElement} host The host element.
 * @param {string} text The notice text.
 * @returns {void}
 */
function appendEmptyNotice(host, text) {
  const msg = document.createElement("div");
  msg.className = "demographics-empty font-body text-base";
  msg.textContent = text;
  host.appendChild(msg);
}

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
            /* fall through */
          }
        }
        return row.Name;
      }
    }
  } catch (_) {
    /* swallow — fall through to fallback */
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

// Walk samples for one pid and return an ORDERED list of unique civ names
// in chronological order. Skips empty/missing civ names.
/**
 * Collect a pid's distinct civ names in chronological first-seen order.
 * @param {Snapshot[]} samples The history sample stream.
 * @param {string} pid Player id key.
 * @returns {string[]} Distinct civ names, chronological.
 */
function collectCivHistory(samples, pid) {
  /** @type {string[]} */
  const list = [];
  for (const s of samples) {
    const ps = s && s.players && s.players[pid];
    const nm = ps && typeof ps.civName === "string" ? ps.civName : "";
    if (!nm) continue;
    if (list.length === 0 || list[list.length - 1] !== nm) {
      // Only append when the LATEST civ differs from the previous entry
      // — otherwise we'd push "Rome" twice if it shows up in turns 1..80.
      // We still want to detect non-adjacent recurrence (Rome → Han → Rome),
      // so de-dup by sequence position, not set membership.
      if (!list.includes(nm)) list.push(nm);
    }
  }
  return list;
}

// Compose the end-of-line / legend display name.
//   civHistory.length === 0 → just leader name.
//   civHistory.length === 1 → "Leader (Civ)".
//   civHistory.length >= 2  → "Leader (CivOld → CivNew)" using arrow separator.
/**
 * Compose the end-of-line / legend display name from a leader name and the
 * civ-name history.
 * @param {string} leaderOnly The bare leader name.
 * @param {string[]} civHistory Distinct civ names, chronological.
 * @returns {string} The composed display name.
 */
function displayName(leaderOnly, civHistory) {
  if (!Array.isArray(civHistory) || civHistory.length === 0) return leaderOnly;
  if (civHistory.length === 1) return leaderOnly + " (" + civHistory[0] + ")";
  return leaderOnly + " (" + civHistory.join(" → ") + ")";
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
    /* */
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

export { collectCivHistory, displayName };

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

// One Chart instance per render. Tear it down before mounting a new one so
// canvases don't leak between metric switches.
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
    } catch (_) {}
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
    /* */
  }
}
// X-axis time-unit mode shared across every history chart (line, stacks,
// gantt). "both" = "T-N / Year", "turn" = "T-N", "year" = "Year". Toolbar
// toggle in view-history sets it before requesting a reload.
let _xAxisMode = "both";
/**
 * Set the shared X-axis time-unit mode. Ignores unrecognized values.
 * @param {string} mode One of `"turn"`, `"year"`, `"both"`.
 * @returns {void}
 */
export function setXAxisMode(mode) {
  if (mode === "turn" || mode === "year" || mode === "both") _xAxisMode = mode;
}
/**
 * Read the shared X-axis time-unit mode.
 * @returns {string} The current mode (`"turn"`, `"year"`, or `"both"`).
 */
export function getXAxisMode() {
  return _xAxisMode;
}

// NOTE: The dead one-shot `chartJsSmokeTest` probe (never called) was removed
// during modularization.

/**
 * Coerce a `Set`/array option into a `Set<string>`.
 * @param {Set<*>|*[]|*} src Source set/array (or anything else → empty).
 * @returns {Set<string>} The stringified key set.
 */
function coerceKeySet(src) {
  const arr = src instanceof Set ? Array.from(src) : Array.isArray(src) ? src : [];
  return new Set(arr.map((v) => String(v)));
}

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
    /* */
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
  try {
    const smooth = !!DemographicsSettings.getSetting("smoothChart", false);
    if (smooth) {
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
  } catch (_) {
    /* */
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
 * Resolve the local player/observer id from the engine `GameContext`.
 * @returns {number|undefined} Local id, if numeric.
 */
function resolveLocalPid() {
  try {
    if (typeof GameContext !== "undefined" && GameContext != null) {
      if (typeof GameContext.localPlayerID === "number") return GameContext.localPlayerID;
      if (typeof GameContext.localObserverID === "number") return GameContext.localObserverID;
    }
  } catch (_) {
    /* */
  }
  return undefined;
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
    /* */
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

/**
 * Add the live current-turn → year entry from the engine `Game`, defensively.
 * @param {Map<number, string>} turnYearMap chart-X → year map (mutated).
 * @returns {void}
 */
function addLiveTurnYear(turnYearMap) {
  try {
    if (
      typeof Game !== "undefined" &&
      typeof Game.turn === "number" &&
      typeof Game.getTurnDate === "function"
    ) {
      const y = Game.getTurnDate();
      if (typeof y === "string" && y.length > 0) turnYearMap.set(Game.turn, y);
    }
  } catch (_) {
    /* */
  }
}

/**
 * Find the map value whose key is nearest to `turn` (exact hit short-circuits).
 * @template V
 * @param {Map<number, V>} map A chart-X keyed map.
 * @param {number} turn The chart-X to match.
 * @returns {V|null} The nearest value, or `null` when the map is empty.
 */
function nearestByTurn(map, turn) {
  if (map.has(turn)) return /** @type {V} */ (map.get(turn));
  /** @type {V|null} */
  let best = null;
  let bestDist = Infinity;
  map.forEach((val, t) => {
    const d = Math.abs(t - turn);
    if (d < bestDist) {
      bestDist = d;
      best = val;
    }
  });
  return best;
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
    if (_xAxisMode === "turn") return ageLbl;
    if (_xAxisMode === "year") return y || ageLbl;
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
      } catch (_) {
        /* */
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
    /* */
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
      /* */
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
 * Escape HTML-special characters for safe insertion into tooltip markup.
 * @param {*} s Source value (coerced to string).
 * @returns {string} The escaped string.
 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  wonderTip.className = "demographics-wonder-tooltip img-tooltip-border img-tooltip-bg";
  wonderTip.style.cssText = [
    "position:absolute",
    "display:none",
    "z-index:30",
    "pointer-events:none",
    "padding:0.55rem 0.75rem 0.6rem",
    "min-width:14rem",
    "max-width:24rem",
    "color:#c2c4cc",
    "font-family:BodyFont, sans-serif",
    "font-size:0.78rem",
    "line-height:1.4",
    "background:rgba(12, 9, 6, 0.96)",
    "border:1px solid rgba(243, 195, 76, 0.6)",
    "border-radius:0.2rem",
    "white-space:normal"
  ].join(";");
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
    arrow.style.cssText = [
      "position:absolute",
      "width:0;height:0;",
      "border:8px solid transparent;",
      "z-index:31;",
      "pointer-events:none;"
    ].join("");
    arrow.className = "wonder-tip-arrow";
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
  mk.className = "demographics-wonder-marker";
  // Only real per-wonder icons reach this code path — events without a
  // specific icon are pre-filtered upstream, so no generic fallback is
  // stacked.
  mk.style.cssText = [
    "position:absolute",
    "width:" + WONDER_ICON_SIZE + "px",
    "height:" + WONDER_ICON_SIZE + "px",
    "background-image:url('" + ev.iconUrl + "')",
    "background-size:contain",
    "background-repeat:no-repeat",
    "background-position:center",
    "pointer-events:auto",
    "z-index:6",
    "filter:drop-shadow(0 0 3px rgba(0,0,0,0.9))",
    "cursor:pointer"
  ].join(";");
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
        /* */
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
    /* */
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
    tip.className = "demographics-chart-tooltip img-tooltip-border img-tooltip-bg";
    tip.style.cssText = [
      "position:absolute",
      "pointer-events:none",
      "min-width:14rem",
      "max-width:22rem",
      "padding:0.55rem 0.7rem",
      "color:#c2c4cc",
      "font-family:BodyFont, sans-serif",
      "font-size:0.85rem",
      "line-height:1.3",
      "z-index:50",
      "opacity:0",
      "transition:opacity 0.08s"
    ].join(";");
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
    /* */
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
 * Resolve the time-range filter from options, or `null`.
 * @param {ChartOptions} opts The render options.
 * @returns {{ min: number, max: number }|null} The filter, or `null`.
 */
function resolveTurnRange(opts) {
  return opts.turnRange &&
    typeof opts.turnRange.min === "number" &&
    typeof opts.turnRange.max === "number"
    ? opts.turnRange
    : null;
}

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
  wrap.className = "demographics-chartjs-wrap";
  wrap.style.cssText =
    "position:relative;width:" + renderW + "px;height:" + renderH + "px;flex:0 0 auto;";
  const canvas = document.createElement("canvas");
  canvas.width = renderW;
  canvas.height = renderH;
  canvas.style.cssText = "display:block;width:" + renderW + "px;height:" + renderH + "px;";
  wrap.appendChild(canvas);
  return { wrap, canvas };
}

// Triumph radar — 6-axis polar chart, one polygon per civ. Reads
// triumphs_cultural / _diplomatic / _economic / _scientific / _militaristic
// / _expansionist counts (Test-of-Time Legacies system). For the CURRENT
// age, values are also live-pulled from `player.Legacies.isTriggered` so
// progress reflects the engine state right now, not just the latest sample.
const LEGACY_AXES = [
  { id: "triumphs_militaristic", label: "Militaristic", angle: -Math.PI / 2 }, // top
  { id: "triumphs_economic", label: "Economic", angle: -Math.PI / 6 }, // upper-right
  { id: "triumphs_diplomatic", label: "Diplomatic", angle: Math.PI / 6 }, // lower-right
  { id: "triumphs_cultural", label: "Cultural", angle: Math.PI / 2 }, // bottom
  { id: "triumphs_scientific", label: "Scientific", angle: (5 * Math.PI) / 6 }, // lower-left
  { id: "triumphs_expansionist", label: "Expansionist", angle: (-5 * Math.PI) / 6 } // upper-left
];

const RADAR_AXIS_KEYS = [
  "triumphs_militaristic",
  "triumphs_economic",
  "triumphs_diplomatic",
  "triumphs_cultural",
  "triumphs_scientific",
  "triumphs_expansionist"
];

/** @type {Record<string, string>} */
const RADAR_SUBTYPE_TO_AXIS = {
  LEGACY_CULTURAL: "triumphs_cultural",
  LEGACY_DIPLOMATIC: "triumphs_diplomatic",
  LEGACY_ECONOMIC: "triumphs_economic",
  LEGACY_SCIENTIFIC: "triumphs_scientific",
  LEGACY_MILITARISTIC: "triumphs_militaristic",
  LEGACY_EXPANSIONIST: "triumphs_expansionist"
};

/**
 * A civ entry in the legacy radar.
 * @typedef {Object} RadarCiv
 * @property {string} pid Player id key.
 * @property {string} leaderType Stable key.
 * @property {string} name Display name.
 * @property {string} color Polygon color.
 * @property {Record<string, number>} values Per-axis triumph counts.
 */

/**
 * A fresh per-axis values map initialized to zero.
 * @returns {Record<string, number>} The zeroed values map.
 */
function radarEmptyValues() {
  /** @type {Record<string, number>} */
  const v = {};
  for (const k of RADAR_AXIS_KEYS) v[k] = 0;
  return v;
}

/**
 * Compose a civ display name from leader/civ fields ("Leader (Civ)").
 * @param {*} src Source object carrying leaderName/civName.
 * @param {string} pid Player id key (for the fallback).
 * @returns {string} The display name.
 */
function radarCivName(src, pid) {
  if (!src.leaderName) return "Player " + pid;
  return src.civName ? src.leaderName + " (" + src.civName + ")" : src.leaderName;
}

/**
 * Build the civ map from a frozen per-age legacy snapshot.
 * @param {Record<string, *>} snap The snapshot (pid → row).
 * @returns {Map<string, RadarCiv>} The civ map.
 */
function loadRadarCivsFromSnapshot(snap) {
  /** @type {Map<string, RadarCiv>} */
  const out = new Map();
  let idx = 0;
  for (const pid of Object.keys(snap)) {
    const row = snap[pid];
    const values = radarEmptyValues();
    for (const k of RADAR_AXIS_KEYS) {
      if (typeof row[k] === "number" && isFinite(row[k])) values[k] = row[k];
    }
    out.set(pid, {
      pid,
      leaderType: String(row.leaderType ?? "pid:" + pid),
      name: radarCivName(row, pid),
      color: PALETTE[idx++ % PALETTE.length],
      values
    });
  }
  return out;
}

/**
 * Build the civ map for the current age by folding sample max-values, then
 * overriding with a live `player.Legacies` pull.
 * @param {Snapshot[]} samples The sample stream.
 * @returns {Map<string, RadarCiv>} The civ map.
 */
function loadRadarCivsCurrent(samples) {
  /** @type {Map<string, RadarCiv>} */
  const civs = new Map();
  /** @type {string[]} */
  const pidOrder = [];
  // Walk samples for names + colors and as a fallback data source.
  samples.forEach((s) => {
    if (!s || !s.players) return;
    for (const pid of Object.keys(s.players)) {
      foldRadarSample(civs, pidOrder, pid, s.players[pid]);
    }
  });
  // LIVE pull via player.Legacies (Test of Time): tally triggered triumphs by
  // LegacySubtype for each alive major; overrides sample values when higher.
  liveRadarPull(civs, pidOrder);
  return civs;
}

/**
 * Fold one civ's sample into the radar civ map (create-on-first-seen, then
 * take the per-axis max — triumph counts are non-decreasing per age).
 * @param {Map<string, RadarCiv>} civs The civ map (mutated).
 * @param {string[]} pidOrder Insertion order (mutated, for palette).
 * @param {string} pid Player id key.
 * @param {CivSample|*} ps One civ's sample.
 * @returns {void}
 */
function foldRadarSample(civs, pidOrder, pid, ps) {
  const m = ps?.metrics || {};
  let civ = civs.get(pid);
  if (!civ) {
    const color =
      typeof ps.primaryColor === "string" && ps.primaryColor.length > 0
        ? ps.primaryColor
        : PALETTE[pidOrder.length % PALETTE.length];
    civ = {
      pid,
      leaderType: String(ps.leaderType ?? "pid:" + pid),
      name: radarCivName(ps, pid),
      color,
      values: radarEmptyValues()
    };
    civs.set(pid, civ);
    pidOrder.push(pid);
  }
  // Take the MAX — triumph counts are non-decreasing per age.
  mergeMaxAxes(civ.values, m);
}

/**
 * Merge per-axis values into a target, keeping the max of each finite value.
 * @param {Record<string, number>} target The values to update (mutated).
 * @param {Record<string, *>} src The source values (numeric or not).
 * @returns {void}
 */
function mergeMaxAxes(target, src) {
  for (const k of RADAR_AXIS_KEYS) {
    const v = src[k];
    if (typeof v === "number" && isFinite(v) && v > target[k]) {
      target[k] = v;
    }
  }
}

/**
 * Tally one alive major's triggered triumphs by axis from `player.Legacies`.
 * @param {*} pl The player's Legacies accessor.
 * @returns {Record<string, number>} The per-axis triggered counts.
 */
function tallyLiveTriumphs(pl) {
  const counts = radarEmptyValues();
  try {
    for (const row of GameInfo.Legacies) {
      if (!row || !row.LegacyType) continue;
      const axis = RADAR_SUBTYPE_TO_AXIS[row.LegacySubtype];
      if (!axis) continue;
      let triggered = false;
      try {
        triggered = !!pl.isTriggered?.(row.LegacyType);
      } catch (_) {
        /* */
      }
      if (triggered) counts[axis]++;
    }
  } catch (_) {
    /* */
  }
  return counts;
}

/**
 * Override radar civ values with a live `player.Legacies` triumph pull for
 * every alive major (creating civ entries that lack samples).
 * @param {Map<string, RadarCiv>} civs The civ map (mutated).
 * @param {string[]} pidOrder Insertion order (mutated, for palette).
 * @returns {void}
 */
function liveRadarPull(civs, pidOrder) {
  try {
    if (!legaciesApiAvailable()) return;
    for (const pid of Players.getAliveMajorIds()) {
      const pl = typeof Players?.get === "function" ? Players.get(pid)?.Legacies : null;
      if (!pl) continue;
      mergeLiveMajorTriumphs(civs, pidOrder, pid, tallyLiveTriumphs(pl));
    }
  } catch (_) {
    /* */
  }
}

/**
 * Whether the Test-of-Time Legacies + alive-majors API is available.
 * @returns {boolean} True when both GameInfo.Legacies and the player API exist.
 */
function legaciesApiAvailable() {
  return (
    typeof GameInfo !== "undefined" &&
    !!GameInfo.Legacies &&
    typeof Players?.getAliveMajorIds === "function"
  );
}

/**
 * Merge one alive major's live triumph counts into the radar civ map,
 * creating the civ entry when it has no samples yet.
 * @param {Map<string, RadarCiv>} civs The civ map (mutated).
 * @param {string[]} pidOrder Insertion order (mutated, for palette).
 * @param {number} pid The major's pid.
 * @param {Record<string, number>} counts The per-axis triggered counts.
 * @returns {void}
 */
function mergeLiveMajorTriumphs(civs, pidOrder, pid, counts) {
  // Ensure civ exists (alive majors may not have samples yet if the storage
  // was reset).
  const pidStr = String(pid);
  let civ = civs.get(pidStr);
  if (!civ) {
    civ = {
      pid: pidStr,
      leaderType: "pid:" + pidStr,
      name: "Player " + pidStr,
      color: PALETTE[pidOrder.length % PALETTE.length],
      values: radarEmptyValues()
    };
    civs.set(pidStr, civ);
    pidOrder.push(pidStr);
  }
  mergeMaxAxes(civ.values, counts);
}

/**
 * Resolve the radar civ map from the active source (frozen snapshot or live
 * current-age data).
 * @param {ChartOptions|*} opts The render options.
 * @param {Snapshot[]} samples The sample stream.
 * @returns {Map<string, RadarCiv>} The civ map.
 */
function loadRadarCivs(opts, samples) {
  const snapshots =
    opts.history && opts.history.legacySnapshots && typeof opts.history.legacySnapshots === "object"
      ? opts.history.legacySnapshots
      : {};
  const ageSource = typeof opts.ageSource === "string" ? opts.ageSource : "current";
  if (ageSource !== "current" && snapshots[ageSource]) {
    return loadRadarCivsFromSnapshot(snapshots[ageSource]);
  }
  return loadRadarCivsCurrent(samples);
}

/**
 * The maximum triumph value across all civs/axes (>=1).
 * @param {Map<string, RadarCiv>} civs The civ map.
 * @returns {number} The scale maximum.
 */
function radarScaleMax(civs) {
  let scaleMax = 0;
  civs.forEach((c) => {
    for (const k of Object.keys(c.values)) {
      if (c.values[k] > scaleMax) scaleMax = c.values[k];
    }
  });
  return scaleMax <= 0 ? 1 : scaleMax;
}

/**
 * Radar geometry derived from canvas dimensions.
 * @typedef {Object} RadarGeometry
 * @property {number} cx Center x.
 * @property {number} cy Center y.
 * @property {number} R Outer radius.
 * @property {number} innerR Inner pedestal radius.
 */

/**
 * Draw the inner pedestal ring + concentric count rings (with labels) and the
 * axis spokes + labels into the SVG.
 * @param {SVGElement} svg The radar SVG.
 * @param {RadarGeometry} geo The radar geometry.
 * @param {number} scaleMax The scale maximum.
 * @returns {void}
 */
function drawRadarGrid(svg, geo, scaleMax) {
  const { cx, cy, innerR } = geo;
  // Inner "pedestal" ring (base radius for 1-2 triumph silhouettes).
  svg.appendChild(
    svgEl("polygon", {
      points: LEGACY_AXES.map(
        (a) => cx + Math.cos(a.angle) * innerR + "," + (cy + Math.sin(a.angle) * innerR)
      ).join(" "),
      fill: "none",
      stroke: "rgba(201, 162, 76, 0.55)",
      "stroke-width": "1.6"
    })
  );
  // Concentric guide rings — one per integer count up to scaleMax; thinner
  // stroke once past ~12 rings so the chart stays legible.
  const maxRings = Math.max(1, Math.ceil(scaleMax));
  const ringStrokeW = maxRings <= 12 ? 1 : maxRings <= 20 ? 0.8 : 0.6;
  for (let i = 1; i <= maxRings; i++) {
    drawRadarRing(svg, geo, i, maxRings, ringStrokeW);
  }
  drawRadarSpokes(svg, geo);
}

/**
 * Draw one concentric count ring + its numeric label (top spoke).
 * @param {SVGElement} svg The radar SVG.
 * @param {RadarGeometry} geo The radar geometry.
 * @param {number} i The ring index (1-based count).
 * @param {number} maxRings The total ring count.
 * @param {number} ringStrokeW The ring stroke width.
 * @returns {void}
 */
function drawRadarRing(svg, geo, i, maxRings, ringStrokeW) {
  const { cx, cy, R } = geo;
  const r = (R * i) / maxRings;
  const pts = LEGACY_AXES.map(
    (a) => cx + Math.cos(a.angle) * r + "," + (cy + Math.sin(a.angle) * r)
  ).join(" ");
  svg.appendChild(
    svgEl("polygon", {
      points: pts,
      fill: "none",
      stroke: "rgba(201, 162, 76, 0.25)",
      "stroke-width": String(ringStrokeW)
    })
  );
  // Numeric label on the militaristic (top) axis, just inside the ring.
  const topAxis = LEGACY_AXES[0];
  const ringLabel = svgEl("text", {
    x: cx + Math.cos(topAxis.angle) * r + 8,
    y: cy + Math.sin(topAxis.angle) * r + 4,
    fill: "rgba(229, 210, 172, 0.65)",
    "font-size": "11",
    "font-weight": "600",
    "text-anchor": "start",
    "dominant-baseline": "middle",
    stroke: "rgba(20, 16, 10, 0.85)",
    "stroke-width": "2.5",
    "paint-order": "stroke"
  });
  ringLabel.textContent = String(i);
  svg.appendChild(ringLabel);
}

/**
 * Draw the axis spokes (center → rim) and the axis labels.
 * @param {SVGElement} svg The radar SVG.
 * @param {RadarGeometry} geo The radar geometry.
 * @returns {void}
 */
function drawRadarSpokes(svg, geo) {
  const { cx, cy, R } = geo;
  LEGACY_AXES.forEach((a) => {
    svg.appendChild(
      svgEl("line", {
        x1: cx,
        y1: cy,
        x2: cx + Math.cos(a.angle) * R,
        y2: cy + Math.sin(a.angle) * R,
        stroke: "rgba(201, 162, 76, 0.45)",
        "stroke-width": "1"
      })
    );
    const lbl = svgEl("text", {
      x: cx + Math.cos(a.angle) * (R + 22),
      y: cy + Math.sin(a.angle) * (R + 22),
      fill: "#f3c34c",
      "font-size": "18",
      "font-weight": "600",
      "text-anchor": "middle",
      "dominant-baseline": "middle",
      stroke: "#1c1408",
      "stroke-width": "3",
      "paint-order": "stroke"
    });
    lbl.textContent = a.label;
    svg.appendChild(lbl);
  });
}

/**
 * A built radar polygon for one civ.
 * @typedef {Object} RadarPoly
 * @property {RadarCiv} c The source civ.
 * @property {{ x: number, y: number, v: number }[]} points Per-axis vertices.
 * @property {{ x: number, y: number, v: number }[]} polyPts Drawn polygon vertices.
 * @property {number} area Shoelace area (for back-to-front sort).
 * @property {string} color Polygon color.
 */

/**
 * Build the drawable polygon for one civ (per-axis vertices + the populated-
 * only polygon path + its shoelace area).
 * @param {RadarCiv} c The civ.
 * @param {RadarGeometry} geo The radar geometry.
 * @param {number} scaleMax The scale maximum.
 * @returns {RadarPoly} The built polygon.
 */
function buildRadarPoly(c, geo, scaleMax) {
  const { cx, cy, R, innerR } = geo;
  // Per-axis vertex positions for spokes + vertex dots.
  const points = LEGACY_AXES.map((a) => {
    const v = c.values[a.id] || 0;
    const r = (v / scaleMax) * R;
    return { x: cx + Math.cos(a.angle) * r, y: cy + Math.sin(a.angle) * r, v };
  });
  // Populated-only polygon: connect ONLY axes with value > 0 (3+), so the
  // shaded area runs directly between populated vertices. For 1-2 populated
  // axes, fall back to the inner pedestal on empty axes to form a small
  // targeted diamond. 0 populated → no shape.
  const populated = points.map((pt, i) => ({ ...pt, i })).filter((pt) => pt.v > 0);
  /** @type {{ x: number, y: number, v: number }[]} */
  let polyPts;
  if (populated.length === 0) {
    polyPts = [];
  } else if (populated.length <= 2) {
    polyPts = LEGACY_AXES.map((a, i) => {
      const pt = points[i];
      if (pt.v > 0) return pt;
      return { x: cx + Math.cos(a.angle) * innerR, y: cy + Math.sin(a.angle) * innerR, v: 0, i };
    });
  } else {
    polyPts = populated;
  }
  // Shoelace area on the drawn polygon — larger shapes sort behind smaller.
  let area = 0;
  if (polyPts.length >= 3) {
    for (let i = 0; i < polyPts.length; i++) {
      const j = (i + 1) % polyPts.length;
      area += polyPts[i].x * polyPts[j].y - polyPts[j].x * polyPts[i].y;
    }
    area = Math.abs(area) / 2;
  }
  return { c, points, polyPts, area, color: c.color };
}

/**
 * Draw all four civ-polygon passes (fills, spokes, outlines, vertex dots).
 * @param {SVGElement} svg The radar SVG.
 * @param {RadarPoly[]} polys The polygons (already sorted back-to-front).
 * @param {RadarGeometry} geo The radar geometry.
 * @returns {void}
 */
function drawRadarPolys(svg, polys, geo) {
  // Pass 1 — translucent fills; Pass 2 — spokes; Pass 3 — outlines; Pass 4 —
  // vertex dots. Each pass runs over every poly so later passes sit on top.
  for (const p of polys) drawRadarPolyFill(svg, p);
  for (const p of polys) drawRadarPolySpokes(svg, p, geo);
  for (const p of polys) drawRadarPolyOutline(svg, p);
  for (const p of polys) drawRadarPolyDots(svg, p);
}

/**
 * Draw one polygon's translucent fill (skipped for < 3 vertices).
 * @param {SVGElement} svg The radar SVG.
 * @param {RadarPoly} p The polygon.
 * @returns {void}
 */
function drawRadarPolyFill(svg, p) {
  if (!p.polyPts || p.polyPts.length < 3) return;
  const pts = p.polyPts.map((pt) => pt.x + "," + pt.y).join(" ");
  svg.appendChild(
    svgEl("polygon", { points: pts, fill: p.color, "fill-opacity": "0.35", stroke: "none" })
  );
}

/**
 * Draw one polygon's spokes (center → each populated vertex).
 * @param {SVGElement} svg The radar SVG.
 * @param {RadarPoly} p The polygon.
 * @param {RadarGeometry} geo The radar geometry.
 * @returns {void}
 */
function drawRadarPolySpokes(svg, p, geo) {
  LEGACY_AXES.forEach((a, idx) => {
    if ((p.c.values[a.id] || 0) <= 0) return;
    svg.appendChild(
      svgEl("line", {
        x1: geo.cx,
        y1: geo.cy,
        x2: p.points[idx].x,
        y2: p.points[idx].y,
        stroke: p.color,
        "stroke-width": "1.2",
        "stroke-opacity": "0.55"
      })
    );
  });
}

/**
 * Draw one polygon's outline (skipped for < 2 vertices).
 * @param {SVGElement} svg The radar SVG.
 * @param {RadarPoly} p The polygon.
 * @returns {void}
 */
function drawRadarPolyOutline(svg, p) {
  if (!p.polyPts || p.polyPts.length < 2) return;
  const pts = p.polyPts.map((pt) => pt.x + "," + pt.y).join(" ");
  svg.appendChild(
    svgEl("polygon", {
      points: pts,
      fill: "none",
      stroke: p.color,
      "stroke-width": "2.2",
      "stroke-linejoin": "round",
      "stroke-opacity": "0.95"
    })
  );
}

/**
 * Draw one polygon's vertex dots on populated axes.
 * @param {SVGElement} svg The radar SVG.
 * @param {RadarPoly} p The polygon.
 * @returns {void}
 */
function drawRadarPolyDots(svg, p) {
  LEGACY_AXES.forEach((a, idx) => {
    if ((p.c.values[a.id] || 0) <= 0) return;
    svg.appendChild(
      svgEl("circle", {
        cx: p.points[idx].x,
        cy: p.points[idx].y,
        r: "3.4",
        fill: p.color,
        stroke: "#1c1408",
        "stroke-width": "0.8"
      })
    );
  });
}

/**
 * Sum a civ's six triumph-axis values, rounded.
 * @param {RadarCiv} c The civ.
 * @returns {number} The rounded total.
 */
function radarTriumphTotal(c) {
  return Math.round(
    (c.values.triumphs_cultural || 0) +
      (c.values.triumphs_diplomatic || 0) +
      (c.values.triumphs_economic || 0) +
      (c.values.triumphs_scientific || 0) +
      (c.values.triumphs_militaristic || 0) +
      (c.values.triumphs_expansionist || 0)
  );
}

/**
 * Build one radar legend entry (colored dot + civ name + Σ total), wiring its
 * click-to-toggle handler.
 * @param {RadarCiv} c The civ.
 * @param {boolean} isHidden Whether the civ is hidden.
 * @param {{ legendX: number, gy: number, W: number, H: number }} pos Placement.
 * @param {((leaderType: string) => void)|null} onToggle Toggle callback.
 * @returns {HTMLElement} The legend entry element.
 */
function buildRadarLegendEntry(c, isHidden, pos, onToggle) {
  const div = document.createElement("div");
  div.className = "demographics-chart-line-label";
  if (isHidden) div.classList.add("is-hidden");
  div.style.position = "absolute";
  div.style.left = (pos.legendX / pos.W) * 100 + "%";
  div.style.top = (pos.gy / pos.H) * 100 + "%";
  div.style.cursor = onToggle ? "pointer" : "default";

  const dot = document.createElement("span");
  dot.className = "demographics-chart-line-label-dot";
  if (isHidden) dot.classList.add("is-hollow");
  dot.style.backgroundColor = isHidden ? "transparent" : c.color;
  dot.style.borderColor = c.color;
  div.appendChild(dot);

  const txt = document.createElement("span");
  txt.className = "demographics-chart-line-label-text";
  // Show the polygon "area" (sum of axes) so the user can compare overall
  // legacy progress without doing arithmetic in their head.
  txt.textContent = c.name + " — Σ " + radarTriumphTotal(c);
  div.appendChild(txt);

  if (onToggle) {
    div.addEventListener("click", (ev) => {
      ev.stopPropagation();
      safePlaySound("data-audio-select-press", "audio-screen-unlocks");
      onToggle(c.leaderType);
    });
  }
  return div;
}

/**
 * Render the Legacy Path radar (6-axis polar chart, one polygon per civ) into
 * `host`. Reads triumph counts per attribute, optionally live-pulled from
 * `player.Legacies` for the current age.
 * @param {HTMLElement} host The view host element (cleared and repopulated).
 * @param {ChartOptions} [options] Render options (history, hiddenCivs,
 *   ageSource, onToggleCiv, width, height).
 * @returns {{ svg: SVGElement }|null} The mounted SVG handle, or `null`.
 */
export function renderLegacyRadar(host, options) {
  if (!host) return null;
  while (host.firstChild) host.removeChild(host.firstChild);
  const opts = options || {};
  const W = opts.width || 1400;
  const H = opts.height || 600;

  const hidden = coerceKeySet(opts.hiddenCivs);

  const samples = opts.history && Array.isArray(opts.history.samples) ? opts.history.samples : [];
  if (samples.length === 0) {
    appendEmptyNotice(host, "No samples yet — play a turn and reopen.");
    return null;
  }

  // Source: a frozen per-age snapshot, or the live current-age running max.
  const civs = loadRadarCivs(opts, samples);
  const scaleMax = radarScaleMax(civs);

  /** @type {RadarGeometry} */
  const geo = {
    cx: W / 2,
    cy: H / 2 + 10, // slight nudge down to leave room for title
    R: Math.min(W, H) * 0.42,
    innerR: Math.min(W, H) * 0.42 * 0.1
  };

  const { svg, visibleCount } = buildRadarSvg(civs, hidden, geo, scaleMax, W, H);

  // HTML wrap so we can put a side legend with click-to-toggle.
  const wrap = document.createElement("div");
  wrap.className = "demographics-chart-wrap";
  wrap.appendChild(svg);
  mountRadarLegend(wrap, civs, hidden, opts, W, H);

  host.appendChild(wrap);
  dlog("legacy radar mounted; civs=", civs.size, "visible=", visibleCount);
  return { svg };
}

/**
 * Build the radar SVG: grid + every visible civ polygon (back-to-front).
 * @param {Map<string, RadarCiv>} civs The civ map.
 * @param {Set<string>} hidden Hidden series keys.
 * @param {RadarGeometry} geo The radar geometry.
 * @param {number} scaleMax The scale maximum.
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 * @returns {{ svg: SVGElement, visibleCount: number }} The SVG + visible count.
 */
function buildRadarSvg(civs, hidden, geo, scaleMax, W, H) {
  const svg = svgEl("svg", {
    xmlns: SVG_NS,
    viewBox: `0 0 ${W} ${H}`,
    width: String(W),
    height: String(H),
    preserveAspectRatio: "xMidYMid meet",
    class: "demographics-chart-svg",
    "aria-label": "Legacy Path radar"
  });
  drawRadarGrid(svg, geo, scaleMax);
  // Build all polys, then draw back-to-front by area so darker fills don't
  // bury lighter ones.
  /** @type {RadarPoly[]} */
  const polys = [];
  let visibleCount = 0;
  civs.forEach((c) => {
    if (hidden.has(c.leaderType)) return;
    polys.push(buildRadarPoly(c, geo, scaleMax));
    visibleCount++;
  });
  polys.sort((a, b) => b.area - a.area); // largest first → drawn behind
  drawRadarPolys(svg, polys, geo);
  return { svg, visibleCount };
}

/**
 * Mount the radar side legend (one entry per civ) into the wrap.
 * @param {HTMLElement} wrap The chart wrap.
 * @param {Map<string, RadarCiv>} civs The civ map.
 * @param {Set<string>} hidden Hidden series keys.
 * @param {ChartOptions|*} opts The render options (onToggleCiv).
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 * @returns {void}
 */
function mountRadarLegend(wrap, civs, hidden, opts, W, H) {
  const onToggle = typeof opts.onToggleCiv === "function" ? opts.onToggleCiv : null;
  let gy = 18;
  civs.forEach((c) => {
    const entry = buildRadarLegendEntry(
      c,
      hidden.has(c.leaderType),
      { legendX: 16, gy, W, H },
      onToggle
    );
    wrap.appendChild(entry);
    gy += 26;
  });
}

// Resources stacked-area chart — LOCAL player only. For each turn, stack
// the 5 resource-class counts (bonus, empire, city, factory, treasure) so
// the user can see how their resource allocation strategy evolved over the
// course of the game. Compares CATEGORIES, not civs.
const RESOURCE_BANDS = [
  { id: "resources_bonus", label: "Bonus", color: "#7fb3e6" },
  { id: "resources_empire", label: "Empire", color: "#e6a23c" },
  { id: "resources_city", label: "City", color: "#9ad17a" },
  { id: "resources_factory", label: "Factory", color: "#c9a2dc" },
  { id: "resources_treasure", label: "Treasure", color: "#f3c34c" }
];

/**
 * Compose a dropdown/option label from a civ sample ("Leader (Civ)" or
 * "Leader" or "Player <pid>").
 * @param {CivSample|*} ps One civ's sample.
 * @param {string} pid Player id key.
 * @returns {string} The option label.
 */
function civOptionLabel(ps, pid) {
  if (!ps.leaderName) return "Player " + pid;
  return ps.civName ? ps.leaderName + " (" + ps.civName + ")" : ps.leaderName;
}

/**
 * Whether a metrics object carries any resource-class value.
 * @param {Record<string, *>} m One civ's metrics.
 * @returns {boolean} True when any resource metric is numeric.
 */
function hasResourceMetric(m) {
  return (
    typeof m.resources_total === "number" ||
    typeof m.resources_bonus === "number" ||
    typeof m.resources_empire === "number" ||
    typeof m.resources_city === "number"
  );
}

// Collect all civs that have at least one sample with any resource value,
// so the resources stack viewer dropdown can list them by leader name.
/**
 * List every civ that has at least one sample with a resource value, for the
 * resources-stack viewer dropdown.
 * @param {DemoHistory|*} history The history blob.
 * @returns {{ pid: string, label: string }[]} The civ options.
 */
export function collectResourceCivOptions(history) {
  const samps = history && Array.isArray(history.samples) ? history.samples : [];
  /** @type {Map<string, { pid: string, label: string }>} */
  const seen = new Map();
  for (const s of samps) {
    if (!s?.players) continue;
    for (const pid of Object.keys(s.players)) {
      foldResourceCivOption(seen, s.players[pid], pid);
    }
  }
  return Array.from(seen.values());
}

/**
 * Record a civ as a resource-stack option when it has a resource metric.
 * @param {Map<string, { pid: string, label: string }>} seen Options map (mutated).
 * @param {CivSample|*} ps One civ's sample.
 * @param {string} pid Player id key.
 * @returns {void}
 */
function foldResourceCivOption(seen, ps, pid) {
  const m = ps?.metrics;
  if (!m || !hasResourceMetric(m) || seen.has(pid)) return;
  seen.set(pid, { pid, label: civOptionLabel(ps, pid) });
}

/**
 * A stacked-area band definition.
 * @typedef {Object} StackBand
 * @property {string} id Metric id.
 * @property {string} label Display label.
 * @property {string} color Band fill color.
 */

/**
 * One per-turn stack row.
 * @typedef {Object} StackPoint
 * @property {number|*} turn The turn.
 * @property {Record<string, number>} values Per-band values.
 */

/**
 * Stack-chart layout constants + plot rect.
 * @typedef {Object} StackLayout
 * @property {number} padL Left pad.
 * @property {number} padR Right pad.
 * @property {number} padT Top pad.
 * @property {number} padB Bottom pad.
 * @property {number} innerW Plot width.
 * @property {number} innerH Plot height.
 * @property {(t: number) => number} xOf Turn → pixel x.
 * @property {(v: number) => number} yOf Value → pixel y.
 */

/**
 * Resolve the band set: `opts.bands` when non-empty, else the resource bands.
 * @param {StackOptions|*} opts The render options.
 * @returns {StackBand[]} The band set.
 */
function resolveStackBands(opts) {
  return Array.isArray(opts.bands) && opts.bands.length > 0 ? opts.bands : RESOURCE_BANDS;
}

/**
 * Resolve the target pid whose resources to chart: explicit `viewerPid`, else
 * the local player, else `null` (first civ per sample).
 * @param {ChartOptions|*} opts The render options.
 * @returns {string|null} The target pid key, or `null`.
 */
function resolveStackTargetPid(opts) {
  if (opts.viewerPid !== undefined && opts.viewerPid !== null) return String(opts.viewerPid);
  const localPid = resolveLocalPid();
  return localPid !== undefined ? String(localPid) : null;
}

/**
 * Build the per-turn stack rows for the target civ across the bands. Rows with
 * no positive band value are skipped.
 * @param {Snapshot[]} samples The sample stream.
 * @param {string|null} targetPid The target pid (or null → first civ per row).
 * @param {StackBand[]} bands The band set.
 * @returns {StackPoint[]} The stack rows.
 */
function buildStackPoints(samples, targetPid, bands) {
  /** @type {StackPoint[]} */
  const points = [];
  for (const s of samples) {
    if (!s?.players) continue;
    const pid = targetPid ? targetPid : Object.keys(s.players)[0];
    const ps = s.players[pid];
    if (!ps?.metrics) continue;
    const row = buildStackRow(s.turn, ps.metrics, bands);
    if (row) points.push(row);
  }
  return points;
}

/**
 * Build one stack row from a metrics object, or `null` when no band is
 * positive.
 * @param {number|*} turn The turn.
 * @param {Record<string, *>} m One civ's metrics.
 * @param {StackBand[]} bands The band set.
 * @returns {StackPoint|null} The row, or `null`.
 */
function buildStackRow(turn, m, bands) {
  /** @type {StackPoint} */
  const row = { turn, values: {} };
  let any = false;
  for (const band of bands) {
    const v = typeof m[band.id] === "number" && isFinite(m[band.id]) ? m[band.id] : 0;
    if (v > 0) any = true;
    row.values[band.id] = v;
  }
  return any ? row : null;
}

/**
 * Clamp the stack rows to a time range in place, when one is set.
 * @param {StackPoint[]} points The stack rows (mutated).
 * @param {ChartOptions|*} opts The render options.
 * @returns {void}
 */
function clampStackPoints(points, opts) {
  const stackTr = resolveTurnRange(opts);
  if (!stackTr) return;
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].turn < stackTr.min || points[i].turn > stackTr.max) {
      points.splice(i, 1);
    }
  }
}

/**
 * Compute the stack chart's x/y domain from the rows.
 * @param {StackPoint[]} points The stack rows.
 * @param {StackBand[]} bands The band set.
 * @returns {{ xMin: number, xMax: number, yMax: number }} The domain.
 */
function computeStackDomain(points, bands) {
  let xMin = Infinity,
    xMax = -Infinity,
    yMax = 0;
  for (const p of points) {
    if (p.turn < xMin) xMin = p.turn;
    if (p.turn > xMax) xMax = p.turn;
    const stack = sumBands(p.values, bands);
    if (stack > yMax) yMax = stack;
  }
  if (!isFinite(xMin)) xMin = 0;
  if (!isFinite(xMax)) xMax = 1;
  if (xMin === xMax) xMax = xMin + 1;
  if (yMax <= 0) yMax = 1;
  return { xMin, xMax, yMax };
}

/**
 * Sum a row's band values.
 * @param {Record<string, number>} values Per-band values.
 * @param {StackBand[]} bands The band set.
 * @returns {number} The stacked total.
 */
function sumBands(values, bands) {
  let stack = 0;
  for (const band of bands) stack += values[band.id] || 0;
  return stack;
}

/**
 * Build the stack-chart layout (pads, plot size, x/y mappers).
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 * @param {{ xMin: number, xMax: number, yMax: number }} dom The domain.
 * @returns {StackLayout} The layout.
 */
function buildStackLayout(W, H, dom) {
  const padL = 70,
    padR = 200,
    padT = 30,
    padB = 64;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  return {
    padL,
    padR,
    padT,
    padB,
    innerW,
    innerH,
    xOf: (t) => padL + ((t - dom.xMin) / (dom.xMax - dom.xMin || 1)) * innerW,
    yOf: (v) => padT + innerH - (v / dom.yMax) * innerH
  };
}

/**
 * Build the turn → year map for stack x-ticks (samples + live current turn).
 * @param {Snapshot[]} samples The sample stream.
 * @returns {Map<number, string>} chart-turn → year map.
 */
function buildStackTurnYears(samples) {
  /** @type {Map<number, string>} */
  const stackTurnYears = new Map();
  for (const s of samples) {
    if (
      s &&
      typeof s.turn === "number" &&
      typeof s.gameYear === "string" &&
      s.gameYear.length > 0
    ) {
      stackTurnYears.set(s.turn, s.gameYear);
    }
  }
  addLiveTurnYear(stackTurnYears);
  return stackTurnYears;
}

/**
 * Draw the stack plot background + Y gridlines and labels.
 * @param {SVGElement} svg The chart SVG.
 * @param {StackLayout} L The layout.
 * @param {number} yMax The y-domain maximum.
 * @returns {void}
 */
function drawStackGrid(svg, L, yMax) {
  svg.appendChild(
    svgEl("rect", {
      x: L.padL,
      y: L.padT,
      width: L.innerW,
      height: L.innerH,
      fill: "rgba(20, 16, 10, 0.55)",
      stroke: "#c9a24c",
      "stroke-width": "1"
    })
  );
  // Y gridlines (4 divisions) + labels.
  for (let i = 0; i <= 4; i++) {
    const v = (yMax * i) / 4;
    const y = L.yOf(v);
    svg.appendChild(
      svgEl("line", {
        x1: L.padL,
        y1: y,
        x2: L.padL + L.innerW,
        y2: y,
        stroke: "rgba(201, 162, 76, 0.18)",
        "stroke-width": "1"
      })
    );
    const lbl = svgEl("text", {
      x: L.padL - 6,
      y: y + 4,
      fill: "rgba(243, 231, 196, 0.85)",
      "font-size": "12",
      "text-anchor": "end"
    });
    lbl.textContent = String(Math.round(v));
    svg.appendChild(lbl);
  }
}

/**
 * Draw the stack X-axis tick marks and return their HTML-overlay positions.
 * @param {SVGElement} svg The chart SVG.
 * @param {StackLayout} L The layout.
 * @param {{ xMin: number, xMax: number }} dom The x-domain.
 * @param {Map<number, string>} stackTurnYears chart-turn → year map.
 * @returns {{ t: number, x: number, year: string|null, labelY: number }[]}
 *   The tick positions.
 */
function drawStackXTicks(svg, L, dom, stackTurnYears) {
  const xTicks = 6;
  const stackTickPositions = [];
  for (let i = 0; i <= xTicks; i++) {
    const t = Math.round(dom.xMin + ((dom.xMax - dom.xMin) * i) / xTicks);
    const x = L.xOf(t);
    svg.appendChild(
      svgEl("line", {
        x1: x,
        x2: x,
        y1: L.padT + L.innerH,
        y2: L.padT + L.innerH + 4,
        stroke: "#f3e7c4",
        "stroke-width": "1"
      })
    );
    stackTickPositions.push({
      t,
      x,
      year: nearestByTurn(stackTurnYears, t),
      labelY: L.padT + L.innerH + 8
    });
  }
  return stackTickPositions;
}

/**
 * Draw the stacked-area band polygons bottom-up.
 * @param {SVGElement} svg The chart SVG.
 * @param {StackPoint[]} points The stack rows.
 * @param {StackBand[]} bands The band set.
 * @param {StackLayout} L The layout.
 * @returns {void}
 */
function drawStackBands(svg, points, bands, L) {
  // For each band, build a polygon bounded above by (cum + band) and below by
  // (cum), then bump cum.
  const cum = new Array(points.length).fill(0);
  for (const band of bands) {
    const upper = [];
    const lower = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const v = p.values[band.id] || 0;
      lower.push({ x: L.xOf(p.turn), y: L.yOf(cum[i]) });
      cum[i] += v;
      upper.push({ x: L.xOf(p.turn), y: L.yOf(cum[i]) });
    }
    // Build polygon: upper left→right, then lower right→left.
    const pts =
      upper.map((p) => p.x + "," + p.y).join(" ") +
      " " +
      lower
        .slice()
        .reverse()
        .map((p) => p.x + "," + p.y)
        .join(" ");
    svg.appendChild(
      svgEl("polygon", {
        points: pts,
        fill: band.color,
        "fill-opacity": "0.7",
        stroke: band.color,
        "stroke-width": "1",
        "stroke-opacity": "0.9"
      })
    );
  }
}

/**
 * Mount the stack chart's axis-title overlays.
 * @param {HTMLElement} wrap The chart wrap.
 * @param {StackLayout} L The layout.
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 * @param {string} yAxisLabel The y-axis title text.
 * @returns {void}
 */
function mountStackAxisTitles(wrap, L, W, H, yAxisLabel) {
  const xTitle = document.createElement("div");
  xTitle.className = "demographics-chart-axis-title demographics-chart-axis-x";
  xTitle.style.position = "absolute";
  xTitle.style.left = ((L.padL + L.innerW / 2) / W) * 100 + "%";
  xTitle.style.top = ((H - 4) / H) * 100 + "%";
  xTitle.style.transform = "translate(-50%, -100%)";
  xTitle.textContent = "Time (turn / year)";
  wrap.appendChild(xTitle);
  const yTitle = document.createElement("div");
  yTitle.className = "demographics-chart-axis-title demographics-chart-axis-y";
  yTitle.style.position = "absolute";
  yTitle.style.left = (12 / W) * 100 + "%";
  yTitle.style.top = ((L.padT + L.innerH / 2) / H) * 100 + "%";
  yTitle.style.transform = "translate(-50%, -50%) rotate(-90deg)";
  yTitle.textContent = yAxisLabel;
  wrap.appendChild(yTitle);
}

/**
 * Mount the stack chart's X-tick HTML labels (turn and/or year per axis mode).
 * @param {HTMLElement} wrap The chart wrap.
 * @param {{ t: number, x: number, year: string|null, labelY: number }[]} ticks
 *   The tick positions.
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 * @returns {void}
 */
function mountStackXTickLabels(wrap, ticks, W, H) {
  ticks.forEach((tick) => {
    const div = document.createElement("div");
    div.className = "demographics-chart-x-tick";
    div.style.position = "absolute";
    div.style.left = (tick.x / W) * 100 + "%";
    div.style.top = (tick.labelY / H) * 100 + "%";
    div.style.transform = "translateX(-50%)";
    if (_xAxisMode !== "year") {
      appendTickTurn(div, tick.t);
    }
    if (_xAxisMode !== "turn" && tick.year) {
      const yr = document.createElement("div");
      yr.className = "demographics-chart-x-tick-year";
      yr.textContent = tick.year;
      div.appendChild(yr);
    } else if (_xAxisMode === "year" && !tick.year) {
      appendTickTurn(div, tick.t);
    }
    wrap.appendChild(div);
  });
}

/**
 * Append a "T-N" turn sub-label to a tick container.
 * @param {HTMLElement} div The tick container.
 * @param {number} t The turn.
 * @returns {void}
 */
function appendTickTurn(div, t) {
  const tn = document.createElement("div");
  tn.className = "demographics-chart-x-tick-turn";
  tn.textContent = "T-" + t;
  div.appendChild(tn);
}

/**
 * Mount the stack chart's right-margin band legend (label + latest value).
 * @param {HTMLElement} wrap The chart wrap.
 * @param {StackBand[]} bands The band set.
 * @param {StackPoint[]} points The stack rows.
 * @param {StackLayout} L The layout.
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 * @returns {void}
 */
function mountStackLegend(wrap, bands, points, L, W, H) {
  let gy = L.padT + 8;
  const gx = L.padL + L.innerW + 16;
  bands.forEach((band) => {
    const div = document.createElement("div");
    div.className = "demographics-chart-line-label";
    div.style.position = "absolute";
    div.style.left = (gx / W) * 100 + "%";
    div.style.top = (gy / H) * 100 + "%";

    const dot = document.createElement("span");
    dot.className = "demographics-chart-line-label-dot";
    dot.style.backgroundColor = band.color;
    div.appendChild(dot);

    const txt = document.createElement("span");
    txt.className = "demographics-chart-line-label-text";
    // Latest value of this band.
    const latest = points[points.length - 1]?.values?.[band.id] || 0;
    txt.textContent = band.label + " — " + latest;
    div.appendChild(txt);

    wrap.appendChild(div);
    gy += 26;
  });
}

/**
 * Options accepted by {@link renderResourcesStack}.
 * @typedef {Object} StackOptions
 * @property {DemoHistory|*} [history] The history blob.
 * @property {StackBand[]} [bands] Override band set (used by triumph stack).
 * @property {number} [width] Canvas width.
 * @property {number} [height] Canvas height.
 * @property {number|string} [viewerPid] Which civ to chart.
 * @property {{ min: number, max: number }} [turnRange] Time-range filter.
 * @property {string} [yAxisLabel] Y-axis title override.
 */

/**
 * Render the resources stacked-area chart (one civ, bands stacked over time)
 * into `host`. Reused by {@link renderTriumphStack} via the `bands` /
 * `yAxisLabel` options.
 * @param {HTMLElement} host The view host element (cleared and repopulated).
 * @param {StackOptions} [options] Render options.
 * @returns {{ svg: SVGElement }|null} The mounted SVG handle, or `null`.
 */
export function renderResourcesStack(host, options) {
  if (!host) return null;
  while (host.firstChild) host.removeChild(host.firstChild);
  const opts = options || {};
  // `opts.bands` lets `renderTriumphStack` reuse this entire SVG path by
  // passing a different band set (cultural/diplomatic/etc) while keeping all
  // the layout, axes, tooltips, and per-civ dropdown logic.
  const BANDS = resolveStackBands(opts);
  const W = opts.width || 1400;
  const H = opts.height || 600;
  const samples = historySamples(opts.history);
  if (samples.length === 0) {
    appendEmptyNotice(host, "No samples yet — play a turn and reopen.");
    return null;
  }
  // viewerPid (option) lets the caller pick which civ's stacked resources to
  // chart; defaults to the local player so the panel "just works" on first open.
  const points = buildStackPoints(samples, resolveStackTargetPid(opts), BANDS);
  clampStackPoints(points, opts);
  if (points.length === 0) {
    appendEmptyNotice(
      host,
      "No resource samples yet — once you assign your first resource the chart will populate."
    );
    return null;
  }

  const dom = computeStackDomain(points, BANDS);
  const L = buildStackLayout(W, H, dom);
  const { svg, tickPositions } = buildStackSvg(samples, points, BANDS, L, dom, W, H);
  const wrap = mountStackWrap(svg, opts, BANDS, points, tickPositions, L, W, H);

  host.appendChild(wrap);
  dlog("resources stacked area mounted; turns=", points.length, "yMax=", dom.yMax);
  return { svg };
}

/**
 * Build the chart wrap and mount the SVG + axis titles + x-tick labels +
 * band legend overlays.
 * @param {SVGElement} svg The chart SVG.
 * @param {StackOptions} opts The render options (for yAxisLabel).
 * @param {StackBand[]} bands The band set.
 * @param {StackPoint[]} points The stack rows.
 * @param {{ t: number, x: number, year: string|null, labelY: number }[]} tickPositions
 *   The x-tick positions.
 * @param {StackLayout} L The layout.
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 * @returns {HTMLElement} The chart wrap.
 */
function mountStackWrap(svg, opts, bands, points, tickPositions, L, W, H) {
  // Legend at right margin (HTML overlay, clickable later if we add toggles).
  const wrap = document.createElement("div");
  wrap.className = "demographics-chart-wrap";
  wrap.appendChild(svg);
  // Callers can override the y-axis title via opts.yAxisLabel —
  // renderTriumphStack passes "Triumphs (count)" to replace the default.
  const yAxisLabel =
    typeof opts.yAxisLabel === "string" && opts.yAxisLabel
      ? opts.yAxisLabel
      : "Resources Assigned (count)";
  mountStackAxisTitles(wrap, L, W, H, yAxisLabel);
  mountStackXTickLabels(wrap, tickPositions, W, H);
  mountStackLegend(wrap, bands, points, L, W, H);
  return wrap;
}

/**
 * Build the stack chart SVG (background grid, X-ticks, band polygons).
 * @param {Snapshot[]} samples The sample stream.
 * @param {StackPoint[]} points The stack rows.
 * @param {StackBand[]} bands The band set.
 * @param {StackLayout} L The layout.
 * @param {{ xMin: number, xMax: number, yMax: number }} dom The domain.
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 * @returns {{ svg: SVGElement, tickPositions: { t: number, x: number, year: string|null, labelY: number }[] }}
 *   The SVG and the x-tick positions for HTML overlays.
 */
function buildStackSvg(samples, points, bands, L, dom, W, H) {
  const svg = svgEl("svg", {
    xmlns: SVG_NS,
    viewBox: `0 0 ${W} ${H}`,
    width: String(W),
    height: String(H),
    preserveAspectRatio: "none",
    class: "demographics-chart-svg",
    "aria-label": "Resources by category over time"
  });
  drawStackGrid(svg, L, dom.yMax);
  const stackTurnYears = buildStackTurnYears(samples);
  const tickPositions = drawStackXTicks(svg, L, dom, stackTurnYears);
  drawStackBands(svg, points, bands, L);
  return { svg, tickPositions };
}

// Wars Gantt — one horizontal bar per war, stacked vertically by start turn.
// X-axis = turn (with year ticks). Bars colored by the attacker's primary
// color; named with the ordinal-style label the sampler generates.

/**
 * Filter a roster to its major (non-city-state) civs.
 * @param {*[]} roster A war side's roster.
 * @returns {*[]} The major civs.
 */
function majorsOnSide(roster) {
  return (roster || []).filter((r) => r && !r.isCS);
}

// CIV_ADJECTIVE — civ display-name → grammatical adjective form. Covers every
// base + DLC civ across all three ages; unknown civs fall back to a heuristic.
/** @type {Record<string, string>} */
const CIV_ADJECTIVE = {
  // Antiquity
  Aksum: "Aksumite",
  Carthage: "Carthaginian",
  Egypt: "Egyptian",
  Greece: "Greek",
  Han: "Han",
  Khmer: "Khmer",
  Maurya: "Mauryan",
  Maya: "Mayan",
  Mississippian: "Mississippian",
  Persia: "Persian",
  Rome: "Roman",
  // Exploration
  Abbasid: "Abbasid",
  Chola: "Chola",
  Hawaii: "Hawaiian",
  Inca: "Incan",
  Majapahit: "Majapahit",
  Ming: "Ming",
  Mongolia: "Mongol",
  Mongol: "Mongol",
  Norman: "Norman",
  Normans: "Norman",
  Shawnee: "Shawnee",
  Songhai: "Songhai",
  Spain: "Spanish",
  // Modern
  America: "American",
  "United States": "American",
  Buganda: "Bugandan",
  France: "French",
  Japan: "Japanese",
  Korea: "Korean",
  Meiji: "Meiji",
  Mexico: "Mexican",
  Mughal: "Mughal",
  Prussia: "Prussian",
  Qing: "Qing",
  Russia: "Russian",
  Siam: "Siamese",
  Thailand: "Thai",
  // Common DLC / wishlist
  Aztec: "Aztec",
  Babylonia: "Babylonian",
  Britain: "British",
  Byzantium: "Byzantine",
  England: "English",
  Ethiopia: "Ethiopian",
  Germany: "German",
  India: "Indian",
  Israel: "Israeli",
  Italy: "Italian",
  Khazar: "Khazar",
  Macedon: "Macedonian",
  Maori: "Maori",
  Netherlands: "Dutch",
  Phoenicia: "Phoenician",
  Poland: "Polish",
  Portugal: "Portuguese",
  Sumeria: "Sumerian",
  Sweden: "Swedish",
  Turkey: "Turkish",
  Vietnam: "Vietnamese",
  Zulu: "Zulu"
};

/**
 * Resolve a civ's adjective from the engine's `LOC_CIVILIZATION_*_ADJECTIVE`
 * string, or `null` when unavailable. Cite: CivilizationText.xml.
 * @param {*} civType The engine CivilizationType string.
 * @returns {string|null} The composed adjective, or `null`.
 */
function adjectiveFromCivType(civType) {
  if (typeof civType !== "string" || !civType) return null;
  const stem = civType.replace(/^CIVILIZATION_/, "");
  if (!stem) return null;
  const tag = "LOC_CIVILIZATION_" + stem + "_ADJECTIVE";
  try {
    if (typeof Locale?.compose === "function") {
      const v = Locale.compose(tag);
      if (typeof v === "string" && v.length > 0 && !v.startsWith("LOC_")) return v;
    }
  } catch (_) {
    /* */
  }
  return null;
}

/**
 * Resolve a civ's adjective from the bundled map, then a heuristic English
 * suffix derivation. Used when the engine adjective isn't available.
 * @param {*} name The civ display name.
 * @returns {string} The adjective.
 */
function civAdjectiveFromName(name) {
  if (typeof name !== "string" || !name.length) return "Unknown";
  if (CIV_ADJECTIVE[name]) return CIV_ADJECTIVE[name];
  const cleaned = name.replace(/^the\s+/i, "").trim();
  if (CIV_ADJECTIVE[cleaned]) return CIV_ADJECTIVE[cleaned];
  if (/ia$/i.test(cleaned)) return cleaned.replace(/ia$/i, "ian");
  if (/y$/i.test(cleaned)) return cleaned.replace(/y$/i, "ian");
  if (/a$/i.test(cleaned)) return cleaned + "n";
  if (/e$/i.test(cleaned)) return cleaned.replace(/e$/i, "ean");
  if (/o$/i.test(cleaned)) return cleaned + "an";
  return cleaned + "an";
}

/**
 * Resolve a roster entry's (or raw string's) civ adjective, preferring the
 * engine LOC lookup.
 * @param {*} rosterEntry A roster object ({civ, civTypeString}) or a string.
 * @returns {string} The adjective.
 */
function civAdjective(rosterEntry) {
  if (rosterEntry && typeof rosterEntry === "object") {
    const fromEngine = adjectiveFromCivType(rosterEntry.civTypeString);
    if (fromEngine) return fromEngine;
    return civAdjectiveFromName(rosterEntry.civ);
  }
  return civAdjectiveFromName(rosterEntry);
}

/**
 * Format an integer with its English ordinal suffix ("1st", "2nd", ...).
 * @param {number} n The integer.
 * @returns {string} The ordinal string.
 */
function ordinalInt(n) {
  const v = n % 100,
    s = ["th", "st", "nd", "rd"];
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * Convert an integer to a Roman numeral (>=1; "I" minimum).
 * @param {number} n The integer.
 * @returns {string} The Roman numeral.
 */
function romanize(n) {
  /** @type {[string, number][]} */
  const numerals = [
    ["M", 1000],
    ["CM", 900],
    ["D", 500],
    ["CD", 400],
    ["C", 100],
    ["XC", 90],
    ["L", 50],
    ["XL", 40],
    ["X", 10],
    ["IX", 9],
    ["V", 5],
    ["IV", 4],
    ["I", 1]
  ];
  let r = "",
    v = n;
  for (const [s, d] of numerals) {
    while (v >= d) {
      r += s;
      v -= d;
    }
  }
  return r || "I";
}

/**
 * Parse a Civ7 gameYear ("2725 BCE", "100 CE", "1842") into a signed integer
 * (BCE → negative). Numbers pass through.
 * @param {*} s The year string or number.
 * @returns {number|null} The signed year, or `null`.
 */
function parseYear(s) {
  if (typeof s !== "number") {
    if (typeof s !== "string") return null;
    const m = s.match(/(-?\d+)\s*(BCE|BC|CE|AD)?/i);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    if (!isFinite(n)) return null;
    const era = (m[2] || "").toUpperCase();
    return era === "BCE" || era === "BC" ? -n : n;
  }
  return s;
}

/**
 * Format an estimated casualty count with a magnitude suffix.
 * @param {number} n The count.
 * @returns {string} The formatted count ("—" for non-positive).
 */
function formatCasualties(n) {
  if (!isFinite(n) || n <= 0) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
}

// Collect every civ pid that's appeared in any war (with display labels) so
// the conflicts page filter dropdown can list them.
/**
 * List every civ that has appeared in any war, sorted majors-first then by
 * label, for the conflicts-page filter dropdown.
 * @param {DemoHistory|*} history The history blob.
 * @returns {{ pid: *, isCS: boolean, label: string }[]} The civ options.
 */
export function collectWarCivOptions(history) {
  const wars = history && Array.isArray(history.wars) ? history.wars : [];
  const seen = new Map();
  for (const w of wars) {
    const allRosters = /** @type {any[]} */ ([]).concat(w.sideACivs || [], w.sideBCivs || []);
    for (const r of allRosters) {
      if (!r || seen.has(r.pid)) continue;
      seen.set(r.pid, {
        pid: r.pid,
        isCS: !!r.isCS,
        label: r.leader ? r.leader + ", " + r.civ : r.civ
      });
    }
  }
  return Array.from(seen.values()).sort((a, b) => {
    if (a.isCS !== b.isCS) return a.isCS ? 1 : -1;
    return a.label.localeCompare(b.label);
  });
}

/**
 * Whether a war pits at least one major civ on each side.
 * @param {*} w The war record.
 * @returns {boolean} True for a major-vs-major war.
 */
function isMajorVsMajor(w) {
  return majorsOnSide(w.sideACivs).length > 0 && majorsOnSide(w.sideBCivs).length > 0;
}

/**
 * The major-civ pids participating in a war.
 * @param {*} w The war record.
 * @returns {*[]} The major pids.
 */
function majorPidsForWar(w) {
  return /** @type {any[]} */ ([])
    .concat(majorsOnSide(w.sideACivs), majorsOnSide(w.sideBCivs))
    .map((r) => r.pid);
}

/**
 * Filter wars to the major-vs-major engagements matching the active filters.
 * @param {*[]} wars The (sorted) war list.
 * @param {boolean} showActiveOnly Hide concluded wars when true.
 * @param {number|null} filterPid Limit to a specific civ, or null.
 * @returns {*[]} The filtered wars.
 */
function filterGanttWars(wars, showActiveOnly, filterPid) {
  return wars.filter((w) => {
    if (showActiveOnly && typeof w.endTurn === "number") return false;
    // Drop any war that doesn't pit at least one major on each side.
    if (!isMajorVsMajor(w)) return false;
    if (filterPid !== null) {
      if (!majorPidsForWar(w).map(Number).includes(Number(filterPid))) return false;
    }
    return true;
  });
}

/**
 * Compute the Gantt x-domain [xMin, xMax] from the filtered wars, honoring an
 * explicit time-range override.
 * @param {*[]} filtered The filtered wars.
 * @param {{ min: number, max: number }|null} tr Time-range filter, or null.
 * @param {number} latestTurn The latest sampled turn.
 * @param {Snapshot[]} samples The sample stream (for fallback).
 * @returns {{ xMin: number, xMax: number }} The x-domain.
 */
function computeGanttDomain(filtered, tr, latestTurn, samples) {
  const span = ganttWarSpan(filtered, tr, latestTurn);
  let xMin = span.xMin;
  let xMax = span.xMax;
  if (!isFinite(xMin)) xMin = samples[0]?.turn ?? 0;
  if (!isFinite(xMax)) xMax = latestTurn || xMin + 1;
  if (tr) {
    xMin = tr.min;
    xMax = tr.max;
  }
  if (xMin === xMax) xMax = xMin + 1;
  return { xMin, xMax };
}

/**
 * Compute the min start / max end turn across the in-range wars.
 * @param {*[]} filtered The filtered wars.
 * @param {{ min: number, max: number }|null} tr Time-range filter, or null.
 * @param {number} latestTurn The latest sampled turn.
 * @returns {{ xMin: number, xMax: number }} The raw span (may be infinite).
 */
function ganttWarSpan(filtered, tr, latestTurn) {
  let xMin = Infinity,
    xMax = -Infinity;
  for (const w of filtered) {
    const s = w.startTurn;
    const e = typeof w.endTurn === "number" ? w.endTurn : latestTurn;
    if (tr && (e < tr.min || s > tr.max)) continue;
    if (s < xMin) xMin = s;
    if (e > xMax) xMax = e;
  }
  return { xMin, xMax };
}

/**
 * Gantt layout + plot mappers.
 * @typedef {Object} GanttLayout
 * @property {number} padL Left pad.
 * @property {number} padT Top pad.
 * @property {number} innerW Plot width.
 * @property {number} innerH Plot height.
 * @property {number} H Final canvas height.
 * @property {number[]} rowTops Per-war row top offsets.
 * @property {number} barH Bar height.
 * @property {(t: number) => number} xOf Turn → pixel x.
 */

const GANTT_BAR_H = 24; // bar height (label fits comfortably inside)
const GANTT_ROW_GAP = 10; // gap between wars

/**
 * Build the Gantt layout: row offsets, final height, plot rect, x-mapper.
 * @param {number} W Canvas width.
 * @param {number} H0 Caller height floor.
 * @param {number} warCount The filtered war count.
 * @param {{ xMin: number, xMax: number }} dom The x-domain.
 * @returns {GanttLayout} The layout.
 */
function buildGanttLayout(W, H0, warCount, dom) {
  const padL = 60,
    padR = 60,
    padT = 30,
    padB = 64;
  // Pre-compute Y offsets so we can size H upfront — uniform row height.
  const rowTops = [];
  let accumY = padT + 6;
  for (let i = 0; i < warCount; i++) {
    rowTops.push(accumY);
    accumY += GANTT_BAR_H + GANTT_ROW_GAP;
  }
  const minInnerH = Math.max(120, accumY - padT - 6 + 16);
  const H = Math.max(H0, padT + minInnerH + padB);
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  return {
    padL,
    padT,
    innerW,
    innerH,
    H,
    rowTops,
    barH: GANTT_BAR_H,
    xOf: (t) => padL + ((t - dom.xMin) / (dom.xMax - dom.xMin || 1)) * innerW
  };
}

/**
 * Look up the latest sampled primary color for a pid, with a neutral fallback.
 * @param {Snapshot[]} samples The sample stream.
 * @param {*} pid Player id key.
 * @returns {string} The hex/css color.
 */
function currentPrimaryColor(samples, pid) {
  for (let i = samples.length - 1; i >= 0; i--) {
    const ps = samples[i]?.players?.[pid];
    if (ps && typeof ps.primaryColor === "string" && ps.primaryColor.length > 0) {
      return ps.primaryColor;
    }
  }
  return "#9aa8c8";
}

/**
 * Draw the Gantt background, year grid + ticks. Returns the tick positions for
 * HTML overlays.
 * @param {SVGElement} svg The chart SVG.
 * @param {GanttLayout} L The layout.
 * @param {{ xMin: number, xMax: number }} dom The x-domain.
 * @param {Map<number, string>} turnYearMap chart-turn → year map.
 * @returns {{ t: number, x: number, year: string|null }[]} The tick positions.
 */
function drawGanttGrid(svg, L, dom, turnYearMap) {
  svg.appendChild(
    svgEl("rect", {
      x: L.padL,
      y: L.padT,
      width: L.innerW,
      height: L.innerH,
      fill: "rgba(18, 20, 24, 0.85)",
      stroke: "#c9a24c",
      "stroke-width": "1"
    })
  );
  const xTicks = 6;
  const tickPositions = [];
  for (let i = 0; i <= xTicks; i++) {
    const t = Math.round(dom.xMin + ((dom.xMax - dom.xMin) * i) / xTicks);
    const x = L.xOf(t);
    svg.appendChild(
      svgEl("line", {
        x1: x,
        x2: x,
        y1: L.padT + L.innerH,
        y2: L.padT + L.innerH + 4,
        stroke: "#E5E5E5",
        "stroke-width": "1"
      })
    );
    // Vertical grid line — Chart.js neutral grid color.
    svg.appendChild(
      svgEl("line", {
        x1: x,
        x2: x,
        y1: L.padT,
        y2: L.padT + L.innerH,
        stroke: "rgba(133, 135, 140, 0.35)",
        "stroke-width": "1"
      })
    );
    tickPositions.push({ t, x, year: nearestByTurn(turnYearMap, t) });
  }
  return tickPositions;
}

/**
 * One war bar's hit-test rectangle.
 * @typedef {Object} BarRect
 * @property {*} war The war record.
 * @property {number} x Bar left.
 * @property {number} y Bar top.
 * @property {number} w Bar width.
 * @property {number} h Bar height.
 * @property {number} x2 Bar right.
 * @property {boolean} isClosed Whether the war concluded.
 */

/**
 * Draw one war bar (per-civ stripes, hairlines, outline, end marker) and
 * return its hit-test rect.
 * @param {SVGElement} svg The chart SVG.
 * @param {*} w The war record.
 * @param {GanttLayout} L The layout.
 * @param {{ xMin: number, xMax: number }} dom The x-domain.
 * @param {number} baseY The bar's top offset.
 * @param {number} latestTurn The latest sampled turn.
 * @param {Snapshot[]} samples The sample stream (for colors).
 * @returns {BarRect} The bar hit-test rect.
 */
function drawWarBar(svg, w, L, dom, baseY, latestTurn, samples) {
  const sTurn = w.startTurn;
  const eTurn = typeof w.endTurn === "number" ? w.endTurn : latestTurn;
  const x1 = L.xOf(Math.max(sTurn, dom.xMin));
  const x2 = L.xOf(Math.min(eTurn, dom.xMax));
  const isClosed = typeof w.endTurn === "number";
  const sem = getSemantic();
  // Build the full participant list (sideA first, then sideB) so the bar is
  // striped one band per civ. Side ordering preserved so allies sit together.
  const participants = /** @type {any[]} */ ([]).concat(
    majorsOnSide(w.sideACivs),
    majorsOnSide(w.sideBCivs)
  );
  const stripes =
    participants.length > 0
      ? participants
      : [
          { pid: null, color: sem.sideA_fallback },
          { pid: null, color: sem.sideB_fallback }
        ];
  const barW = Math.max(2, x2 - x1);
  drawWarBarStripes(svg, { stripes, samples, sem, x1, baseY, barW, barH: L.barH, isClosed });
  // Single outline around the combined bar.
  svg.appendChild(
    svgEl("rect", {
      x: x1,
      y: baseY,
      width: barW,
      height: L.barH,
      fill: "none",
      stroke: "#1c1408",
      "stroke-width": "1"
    })
  );
  drawWarBarEndMarker(svg, isClosed, x2, baseY, L.barH, sem);
  return { war: w, x: x1, y: baseY, w: barW, h: L.barH, x2, isClosed };
}

/**
 * Draw a war bar's per-civ color stripes plus the hairlines between them.
 * @param {SVGElement} svg The chart SVG.
 * @param {Object} args Stripe-drawing inputs.
 * @param {*[]} args.stripes The participant stripes.
 * @param {Snapshot[]} args.samples The sample stream (for colors).
 * @param {*} args.sem The semantic palette.
 * @param {number} args.x1 Bar left x.
 * @param {number} args.baseY Bar top y.
 * @param {number} args.barW Bar width.
 * @param {number} args.barH Bar height.
 * @param {boolean} args.isClosed Whether the war concluded.
 * @returns {void}
 */
function drawWarBarStripes(svg, args) {
  const { stripes, samples, sem, x1, baseY, barW, barH, isClosed } = args;
  const stripeH = barH / stripes.length;
  // One colored stripe per participating civ — height = BAR_H / N.
  stripes.forEach((c, idx) => {
    const fill =
      (typeof c.pid === "number" && currentPrimaryColor(samples, c.pid)) ||
      c.color ||
      (idx % 2 === 0 ? sem.sideA_fallback : sem.sideB_fallback);
    svg.appendChild(
      svgEl("rect", {
        x: x1,
        y: baseY + idx * stripeH,
        width: barW,
        height: stripeH,
        fill,
        "fill-opacity": isClosed ? "0.85" : "1"
      })
    );
  });
  // Thin hairlines between adjacent stripes so 3+ civ wars don't blur.
  for (let s = 1; s < stripes.length; s++) {
    svg.appendChild(
      svgEl("line", {
        x1: x1,
        x2: x1 + barW,
        y1: baseY + s * stripeH,
        y2: baseY + s * stripeH,
        stroke: "rgba(28, 20, 8, 0.55)",
        "stroke-width": "0.7"
      })
    );
  }
}

/**
 * Draw a war bar's right-edge marker: a hatch (concluded) or a circle (ongoing).
 * @param {SVGElement} svg The chart SVG.
 * @param {boolean} isClosed Whether the war concluded.
 * @param {number} x2 Bar right x.
 * @param {number} baseY Bar top.
 * @param {number} barH Bar height.
 * @param {*} sem The semantic palette.
 * @returns {void}
 */
function drawWarBarEndMarker(svg, isClosed, x2, baseY, barH, sem) {
  if (isClosed) {
    svg.appendChild(
      svgEl("line", {
        x1: x2,
        x2: x2,
        y1: baseY,
        y2: baseY + barH,
        stroke: "#1c1408",
        "stroke-width": "2"
      })
    );
  } else {
    svg.appendChild(
      svgEl("circle", {
        cx: x2,
        cy: baseY + barH / 2,
        r: 5,
        fill: sem.ongoing_marker,
        stroke: "#1c1408",
        "stroke-width": "0.5"
      })
    );
  }
}

/**
 * Draw every filtered war's bar, returning the hit-test rects.
 * @param {SVGElement} svg The chart SVG.
 * @param {*[]} filtered The filtered wars.
 * @param {GanttLayout} L The layout.
 * @param {{ xMin: number, xMax: number }} dom The x-domain.
 * @param {{ min: number, max: number }|null} tr Time-range filter, or null.
 * @param {number} latestTurn The latest sampled turn.
 * @param {Snapshot[]} samples The sample stream.
 * @returns {BarRect[]} The bar hit-test rects.
 */
function drawWarBars(svg, filtered, L, dom, tr, latestTurn, samples) {
  /** @type {BarRect[]} */
  const barRects = [];
  for (let i = 0; i < filtered.length; i++) {
    const w = filtered[i];
    const eTurn = typeof w.endTurn === "number" ? w.endTurn : latestTurn;
    if (tr && (eTurn < tr.min || w.startTurn > tr.max)) continue;
    barRects.push(drawWarBar(svg, w, L, dom, L.rowTops[i], latestTurn, samples));
  }
  return barRects;
}

/**
 * Compute a war's duration in years from its year strings, falling back to the
 * turn count.
 * @param {*} war The war record.
 * @param {Map<number, string>} turnYearMap chart-turn → year map.
 * @param {number} latestTurn The latest sampled turn.
 * @returns {number} The duration in years (>=1).
 */
function warDurationYears(war, turnYearMap, latestTurn) {
  const sY = parseYear(war.startYear);
  const eY =
    typeof war.endTurn === "number"
      ? parseYear(war.endYear)
      : parseYear(turnYearMap.get(latestTurn));
  if (sY !== null && eY !== null) {
    const d = Math.abs(eY - sY);
    return d > 0 ? d : 1;
  }
  // Fallback: turn-count when years aren't available.
  const t = (typeof war.endTurn === "number" ? war.endTurn : latestTurn) - war.startTurn;
  return Math.max(1, t);
}

/**
 * Build the per-war display-name override map: ordinal-numbered recurring
 * matchups, tripartite/great-war/world-war labels, and duration flair.
 * @param {*[]} filtered The filtered wars.
 * @param {Map<number, string>} turnYearMap chart-turn → year map.
 * @param {number} latestTurn The latest sampled turn.
 * @returns {Map<*, string>} war → display label.
 */
function buildWarNameOverrides(filtered, turnYearMap, latestTurn) {
  /** @type {Map<*, string>} */
  const nameOverride = new Map();
  // Count prior wars with the EXACT same participant set so we can
  // ordinal-number recurring matchups ("Second Roman-Carthaginian War").
  /** @type {Map<string, number>} */
  const pairCounts = new Map();
  /** @type {*[]} */
  const worldWars = []; // chronological order (for "World War N")
  const sorted = filtered.slice().sort((a, b) => (a.startTurn || 0) - (b.startTurn || 0));
  for (const w of sorted) {
    const yrs = warDurationYears(w, turnYearMap, latestTurn);
    const n = majorsOnSide(w.sideACivs).length + majorsOnSide(w.sideBCivs).length;
    let label = composeWarLabel(w, pairCounts, worldWars);
    // Duration flair — long protracted conflicts get a flavor prefix.
    if (yrs >= 100 && n < 6) {
      label = label.replace(/ War$/, "") + " (Hundred Years' War)";
    } else if (yrs >= 50 && n < 6) {
      label = label.replace(/ War$/, "") + " (Long War)";
    }
    nameOverride.set(w, label);
  }
  return nameOverride;
}

/**
 * Compose a war's base name by participant count (world / great / tripartite /
 * bilateral / fallback), advancing the pair-count and world-war state.
 * @param {*} w The war record.
 * @param {Map<string, number>} pairCounts Recurring-matchup counts (mutated).
 * @param {*[]} worldWars World-war list (mutated, for numbering).
 * @returns {string} The base label.
 */
function composeWarLabel(w, pairCounts, worldWars) {
  const a = majorsOnSide(w.sideACivs);
  const b = majorsOnSide(w.sideBCivs);
  const n = a.length + b.length;
  // Pass the FULL roster object so civAdjective can use civTypeString.
  const adjA = a.map((r) => civAdjective(r));
  const adjB = b.map((r) => civAdjective(r));
  if (n >= 6) {
    worldWars.push(w);
    return "World War " + romanize(worldWars.length);
  }
  if (n >= 4) {
    return "Great War: " + adjA[0] + " vs " + adjB[0] + " (+" + (n - 2) + " civs)";
  }
  if (n === 3) {
    return "Tripartite " + /** @type {any[]} */ ([]).concat(adjA, adjB).sort().join("–") + " War";
  }
  if (n === 2) {
    // Standard bilateral. Build a stable adjective key (alpha order) so reruns
    // of the same matchup get ordinal suffixes ("Second Roman-Egyptian War").
    const pair = [adjA[0] || "Unknown", adjB[0] || "Unknown"].sort();
    const key = pair.join("|");
    const count = (pairCounts.get(key) || 0) + 1;
    pairCounts.set(key, count);
    return ordinalInt(count) + " " + pair[0] + "–" + pair[1] + " War";
  }
  return w.name; // single-party / odd fallback
}

/**
 * Mount the per-bar war-name labels (inside each bar) into the wrap.
 * @param {HTMLElement} wrap The chart wrap.
 * @param {BarRect[]} barRects The bar rects.
 * @param {Map<*, string>} nameOverride war → display label.
 * @param {Map<number, string>} turnYearMap chart-turn → year map.
 * @param {number} latestTurn The latest sampled turn.
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 * @returns {void}
 */
function mountWarLabels(wrap, barRects, nameOverride, turnYearMap, latestTurn, W, H) {
  barRects.forEach(({ war, x, y, w, h }) => {
    const yrs = warDurationYears(war, turnYearMap, latestTurn);
    const displayName = nameOverride.get(war) || war.name;
    const label = displayName + "  ·  " + yrs + " yr" + (yrs === 1 ? "" : "s");
    const div = document.createElement("div");
    div.className = "demographics-chart-war-label";
    div.style.position = "absolute";
    div.style.left = (x / W) * 100 + "%";
    div.style.top = ((y + h / 2) / H) * 100 + "%";
    div.style.width = (w / W) * 100 + "%";
    // The label sits inside the bar; translate so it's vertically centered.
    div.style.transform = "translateY(-50%)";
    div.style.padding = "0 0.5rem";
    div.style.color = "#f7ecc8";
    div.style.textShadow = "0 0 0.2rem rgba(0,0,0,0.95), 0 0 0.4rem rgba(0,0,0,0.7)";
    div.style.whiteSpace = "nowrap";
    div.style.overflow = "hidden";
    div.style.textOverflow = "ellipsis";
    div.style.pointerEvents = "none";
    div.style.fontWeight = "600";
    div.style.fontSize = "0.85rem";
    div.style.lineHeight = "1";
    div.textContent = label;
    wrap.appendChild(div);
  });
}

/**
 * Mount the Gantt X-tick HTML labels (year and/or turn per axis mode).
 * @param {HTMLElement} wrap The chart wrap.
 * @param {{ t: number, x: number, year: string|null }[]} tickPositions Ticks.
 * @param {GanttLayout} L The layout.
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 * @returns {void}
 */
function mountGanttXTicks(wrap, tickPositions, L, W, H) {
  tickPositions.forEach((tick) => {
    const div = document.createElement("div");
    div.className = "demographics-chart-x-tick";
    div.style.position = "absolute";
    div.style.left = (tick.x / W) * 100 + "%";
    div.style.top = ((L.padT + L.innerH + 8) / H) * 100 + "%";
    div.style.transform = "translateX(-50%)";
    if (_xAxisMode !== "turn" && tick.year) {
      const yr = document.createElement("div");
      yr.className = "demographics-chart-x-tick-year";
      yr.textContent = tick.year;
      div.appendChild(yr);
    }
    if (_xAxisMode !== "year" || !tick.year) {
      const tn = document.createElement("div");
      tn.className = "demographics-chart-x-tick-turn";
      tn.textContent = _xAxisMode === "both" && tick.year ? "(T-" + tick.t + ")" : "T-" + tick.t;
      div.appendChild(tn);
    }
    wrap.appendChild(div);
  });
}

/**
 * Mount the Gantt axis titles.
 * @param {HTMLElement} wrap The chart wrap.
 * @param {GanttLayout} L The layout.
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 * @returns {void}
 */
function mountGanttAxisTitles(wrap, L, W, H) {
  const xTitle = document.createElement("div");
  xTitle.className = "demographics-chart-axis-title demographics-chart-axis-x";
  xTitle.style.position = "absolute";
  xTitle.style.left = ((L.padL + L.innerW / 2) / W) * 100 + "%";
  xTitle.style.top = ((H - 4) / H) * 100 + "%";
  xTitle.style.transform = "translate(-50%, -100%)";
  xTitle.textContent = "Time (turn / year)";
  wrap.appendChild(xTitle);
  const yTitle = document.createElement("div");
  yTitle.className = "demographics-chart-axis-title demographics-chart-axis-y";
  yTitle.style.position = "absolute";
  yTitle.style.left = (12 / W) * 100 + "%";
  yTitle.style.top = ((L.padT + L.innerH / 2) / H) * 100 + "%";
  yTitle.style.transform = "translate(-50%, -50%) rotate(-90deg)";
  yTitle.textContent = "Conflicts (one bar per war)";
  wrap.appendChild(yTitle);
}

/**
 * Estimate a war's casualty count from duration, participant military power,
 * and an era multiplier.
 * @param {*} war The war record.
 * @param {Snapshot[]} samples The sample stream.
 * @param {number} latestTurn The latest sampled turn.
 * @returns {number} The estimated casualties.
 */
function estimateCasualties(war, samples, latestTurn) {
  const duration = Math.max(
    1,
    (typeof war.endTurn === "number" ? war.endTurn : latestTurn) - war.startTurn
  );
  const allPids = /** @type {any[]} */ ([]).concat(war.sideA || [], war.sideB || []);
  let totalPower = sumLatestWarPower(samples, allPids);
  if (totalPower <= 0) totalPower = 100; // fallback minimum
  const avgPower = totalPower / Math.max(1, allPids.length);
  const eraMult = 0.5 * Math.pow(1.04, war.startTurn || 0);
  return Math.round(duration * avgPower * 0.5 * eraMult);
}

/**
 * Sum the participants' military power from the latest sample that has any
 * (walking backwards until a non-zero total is found).
 * @param {Snapshot[]} samples The sample stream.
 * @param {*[]} allPids The participant pids.
 * @returns {number} The summed military power (0 when none found).
 */
function sumLatestWarPower(samples, allPids) {
  let totalPower = 0;
  for (let i = samples.length - 1; i >= 0 && totalPower === 0; i--) {
    const s = samples[i];
    if (!s?.players) continue;
    for (const pid of allPids) {
      const mp = s.players[pid]?.metrics?.milpower;
      if (typeof mp === "number" && isFinite(mp)) totalPower += mp;
    }
  }
  return totalPower;
}

/**
 * The roster lines (per major civ) for a war side.
 * @param {*[]} roster A war side's roster.
 * @returns {string[]} The "Leader, Civ" lines (or a placeholder).
 */
function warRosterLines(roster) {
  const majors = majorsOnSide(roster);
  if (majors.length === 0) return ["(no major civs)"];
  return majors.map((r) => (r.leader ? r.leader + ", " + r.civ : r.civ));
}

/**
 * Build the structured tooltip body for a war.
 * @param {*} w The war record.
 * @param {Object} ctx Shared Gantt context.
 * @param {Map<*, string>} ctx.nameOverride war → display label.
 * @param {Map<number, string>} ctx.turnYearMap chart-turn → year map.
 * @param {number} ctx.latestTurn The latest sampled turn.
 * @param {Snapshot[]} ctx.samples The sample stream.
 * @returns {Record<string, *>} The tooltip body fields.
 */
function buildWarTooltipBody(w, ctx) {
  const { nameOverride, turnYearMap, latestTurn, samples } = ctx;
  const sTurn = w.startTurn;
  const eTurn = typeof w.endTurn === "number" ? w.endTurn : latestTurn;
  const startYr = w.startYear || "T-" + sTurn;
  const endYr = typeof w.endTurn === "number" ? w.endYear || "T-" + eTurn : "ongoing";
  const yrs = warDurationYears(w, turnYearMap, latestTurn);
  const turns = eTurn - sTurn;
  const casualties = formatCasualties(estimateCasualties(w, samples, latestTurn));
  const partyMul = Math.sqrt(
    Math.max(1, (w.sideA || []).length) * Math.max(1, (w.sideB || []).length)
  );
  const battles = Math.max(1, Math.round(turns * 0.4 * partyMul * Math.pow(1.02, sTurn || 0)));
  const declared = warDeclaredBy(w);
  return {
    // Use the World War override when 4+ civs are involved; fall back to the
    // bilateral name otherwise.
    title: nameOverride.get(w) || w.name,
    status: typeof w.endTurn === "number" ? "concluded" : "ongoing",
    sideA: warRosterLines(w.sideACivs),
    sideB: warRosterLines(w.sideBCivs),
    declared,
    startYr,
    endYr,
    yrs,
    turns,
    battles,
    casualties
  };
}

/**
 * The "declared by" line for a war (its major declarer, else "unknown").
 * @param {*} w The war record.
 * @returns {string} The declarer label.
 */
function warDeclaredBy(w) {
  if (!w.declaredBy || w.declaredBy.isCS) return "unknown";
  return w.declaredBy.leader ? w.declaredBy.leader + ", " + w.declaredBy.civ : w.declaredBy.civ;
}

/**
 * Render the tooltip DOM for a war into the shared tooltip element.
 * @param {HTMLElement} tooltip The tooltip element (cleared and repopulated).
 * @param {*} w The war record.
 * @param {*} ctx Shared Gantt context (see {@link buildWarTooltipBody}).
 * @returns {void}
 */
function renderWarTooltip(tooltip, w, ctx) {
  const t = buildWarTooltipBody(w, ctx);
  while (tooltip.firstChild) tooltip.removeChild(tooltip.firstChild);
  const head = document.createElement("div");
  head.style.fontWeight = "700";
  head.style.color = "#f3c34c";
  head.style.marginBottom = "0.25rem";
  head.textContent = t.title + "  [" + t.status + "]";
  tooltip.appendChild(head);
  appendTooltipSection(tooltip, "Attackers:", t.sideA);
  appendTooltipSection(tooltip, "Defenders:", t.sideB);
  const meta = document.createElement("div");
  meta.style.marginTop = "0.4rem";
  meta.style.opacity = "0.9";
  meta.innerHTML =
    "Declared by: " +
    t.declared +
    "<br>Duration: " +
    t.yrs +
    " years" +
    " (" +
    t.startYr +
    " → " +
    t.endYr +
    ", " +
    t.turns +
    " turns)" +
    "<br>Estimated battles: ~" +
    t.battles +
    "<br>Estimated casualties: ~" +
    t.casualties;
  tooltip.appendChild(meta);
}

/**
 * Append a labeled bullet section to the war tooltip.
 * @param {HTMLElement} tooltip The tooltip element.
 * @param {string} label The section label.
 * @param {string[]} lines The bullet lines.
 * @returns {void}
 */
function appendTooltipSection(tooltip, label, lines) {
  const h = document.createElement("div");
  h.style.fontWeight = "600";
  h.style.opacity = "0.85";
  h.style.marginTop = "0.25rem";
  h.textContent = label;
  tooltip.appendChild(h);
  lines.forEach((l) => {
    const r = document.createElement("div");
    r.style.paddingLeft = "0.7rem";
    r.textContent = "• " + l;
    tooltip.appendChild(r);
  });
}

/**
 * Create the shared Gantt hover-tooltip element (hidden, absolute).
 * @returns {HTMLElement} The tooltip element.
 */
function createGanttTooltip() {
  const tooltip = document.createElement("div");
  tooltip.className = "demographics-chart-hover-tooltip";
  tooltip.style.display = "none";
  tooltip.style.position = "absolute";
  tooltip.style.zIndex = "20";
  tooltip.style.minWidth = "16rem";
  tooltip.style.maxWidth = "26rem";
  tooltip.style.padding = "0.55rem 0.75rem";
  tooltip.style.background = "rgba(12, 9, 6, 0.96)";
  tooltip.style.border = "1px solid rgba(243, 195, 76, 0.6)";
  tooltip.style.borderRadius = "0.2rem";
  tooltip.style.color = "#f3e7c4";
  tooltip.style.fontFamily = "TitilliumWeb, sans-serif";
  tooltip.style.fontSize = "0.85rem";
  tooltip.style.lineHeight = "1.35";
  tooltip.style.pointerEvents = "none";
  tooltip.style.boxShadow = "0 0.2rem 0.6rem rgba(0,0,0,0.7)";
  return tooltip;
}

/**
 * Hit-test a point (in SVG coords) against the war bar rects.
 * @param {BarRect[]} barRects The bar rects.
 * @param {number} svgX The SVG-space x.
 * @param {number} svgY The SVG-space y.
 * @returns {*} The war under the point, or `null`.
 */
function hitTestBars(barRects, svgX, svgY) {
  for (const r of barRects) {
    if (svgX >= r.x && svgX <= r.x + r.w && svgY >= r.y && svgY <= r.y + r.h) return r.war;
  }
  return null;
}

/**
 * Wire the Gantt's mousemove/leave hover tooltip behavior.
 * @param {Object} args Wiring inputs.
 * @param {HTMLElement} args.wrap The chart wrap.
 * @param {SVGElement} args.svg The chart SVG.
 * @param {HTMLElement} args.tooltip The tooltip element.
 * @param {BarRect[]} args.barRects The bar rects.
 * @param {Object} args.ctx Shared Gantt context (for tooltip rendering).
 * @param {number} args.W Canvas width.
 * @param {number} args.H Canvas height.
 * @returns {void}
 */
function wireGanttHover(args) {
  const { wrap, svg, tooltip, barRects, ctx, W, H } = args;
  wrap.addEventListener("mousemove", (ev) => {
    const rect = svg.getBoundingClientRect();
    if (!rect || rect.width === 0) {
      tooltip.style.display = "none";
      return;
    }
    const sx = ((ev.clientX - rect.left) / rect.width) * W;
    const sy = ((ev.clientY - rect.top) / rect.height) * H;
    const w = hitTestBars(barRects, sx, sy);
    if (!w) {
      tooltip.style.display = "none";
      return;
    }
    renderWarTooltip(tooltip, w, ctx);
    const wrapRect = wrap.getBoundingClientRect();
    tooltip.style.left = ev.clientX - wrapRect.left + 14 + "px";
    tooltip.style.top = ev.clientY - wrapRect.top + 14 + "px";
    tooltip.style.display = "block";
  });
  wrap.addEventListener("mouseleave", () => {
    tooltip.style.display = "none";
  });
}

/**
 * Options accepted by {@link renderWarsGantt}.
 * @typedef {Object} GanttOptions
 * @property {DemoHistory|*} [history] The history blob (wars + samples).
 * @property {number} [width] Canvas width.
 * @property {number} [height] Canvas height floor.
 * @property {number} [filterPid] Limit to a specific civ.
 * @property {boolean} [activeOnly] Hide concluded wars.
 * @property {{ min: number, max: number }} [turnRange] Time-range filter.
 */

/**
 * Render the conflicts Gantt timeline (one bar per major-vs-major war) into
 * `host`, with per-civ stripes, in-bar labels, and a hover tooltip.
 * @param {HTMLElement} host The view host element (cleared and repopulated).
 * @param {GanttOptions} [options] Render options.
 * @returns {{ svg: SVGElement }|null} The mounted SVG handle, or `null`.
 */
export function renderWarsGantt(host, options) {
  if (!host) return null;
  while (host.firstChild) host.removeChild(host.firstChild);
  const opts = options || {};
  const W = opts.width || 1400;
  const prep = prepareGanttData(host, opts);
  if (!prep) return null;
  const { wars, filtered, latestTurn, samples, filterPid, showActiveOnly } = prep;

  const tr = resolveTurnRange(opts);
  const dom = computeGanttDomain(filtered, tr, latestTurn, samples);
  const L = buildGanttLayout(W, opts.height || 600, filtered.length, dom);
  const H = L.H;
  const turnYearMap = buildStackTurnYears(samples);
  const env = { turnYearMap, latestTurn, samples, W, H };

  const { svg, barRects, tickPositions } = buildGanttSvg(filtered, L, dom, tr, env);
  const wrap = mountGanttWrap(svg, { filtered, barRects, tickPositions, L, ...env });

  host.appendChild(wrap);
  dlog(
    "wars gantt mounted; wars=",
    wars.length,
    "filtered=" + filtered.length,
    "filterPid=" + filterPid,
    "activeOnly=" + showActiveOnly
  );
  return { svg };
}

/**
 * Prepared Gantt data: the sorted wars, the filtered subset, and filter flags.
 * @typedef {Object} GanttPrep
 * @property {*[]} wars The sorted war list.
 * @property {*[]} filtered The filtered subset.
 * @property {number} latestTurn The latest sampled turn.
 * @property {Snapshot[]} samples The sample stream.
 * @property {number|null} filterPid Active civ filter, or null.
 * @property {boolean} showActiveOnly Whether concluded wars are hidden.
 */

/**
 * Read + sort + filter the wars; render the appropriate empty notice and
 * return `null` when there's nothing to draw.
 * @param {HTMLElement} host The view host (for empty notices).
 * @param {GanttOptions} opts The render options.
 * @returns {GanttPrep|null} The prepared data, or `null`.
 */
function prepareGanttData(host, opts) {
  /** @type {any[]} */
  const wars = opts.history && Array.isArray(opts.history.wars) ? opts.history.wars.slice() : [];
  const samples = historySamples(opts.history);
  if (wars.length === 0) {
    appendEmptyNotice(host, "No wars yet. Once any civ declares war, the timeline will populate.");
    return null;
  }
  wars.sort((a, b) => (a.startTurn || 0) - (b.startTurn || 0));
  const latestTurn = samples.length > 0 ? (samples[samples.length - 1].turn ?? 0) : 0;
  // Filter pipeline: city states are dropped — this is a major-civ engagement
  // timeline. Coalition wars between two majors still show, but only major
  // civs are rendered as bars.
  const filterPid = typeof opts.filterPid === "number" ? opts.filterPid : null;
  const showActiveOnly = !!opts.activeOnly;
  const filtered = filterGanttWars(wars, showActiveOnly, filterPid);
  if (filtered.length === 0) {
    appendEmptyNotice(host, "No wars match the current filters.");
    return null;
  }
  return { wars, filtered, latestTurn, samples, filterPid, showActiveOnly };
}

/**
 * Build the Gantt SVG (background grid + ticks + war bars).
 * @param {*[]} filtered The filtered wars.
 * @param {GanttLayout} L The layout.
 * @param {{ xMin: number, xMax: number }} dom The x-domain.
 * @param {{ min: number, max: number }|null} tr Time-range filter, or null.
 * @param {*} env Shared environment (turnYearMap, latestTurn, samples, W, H).
 * @returns {{ svg: SVGElement, barRects: BarRect[], tickPositions: { t: number, x: number, year: string|null }[] }}
 *   The SVG, bar rects, and x-tick positions.
 */
function buildGanttSvg(filtered, L, dom, tr, env) {
  const { turnYearMap, latestTurn, samples, W, H } = env;
  const svg = svgEl("svg", {
    xmlns: SVG_NS,
    viewBox: `0 0 ${W} ${H}`,
    width: String(W),
    height: String(H),
    preserveAspectRatio: "none",
    class: "demographics-chart-svg",
    "aria-label": "Conflicts timeline"
  });
  const tickPositions = drawGanttGrid(svg, L, dom, turnYearMap);
  const barRects = drawWarBars(svg, filtered, L, dom, tr, latestTurn, samples);
  return { svg, barRects, tickPositions };
}

/**
 * Build the Gantt wrap and mount all HTML overlays (x-ticks, axis titles,
 * war labels) plus the hover tooltip.
 * @param {SVGElement} svg The chart SVG.
 * @param {Object} env Shared environment.
 * @param {*[]} env.filtered The filtered wars.
 * @param {BarRect[]} env.barRects The bar rects.
 * @param {{ t: number, x: number, year: string|null }[]} env.tickPositions Ticks.
 * @param {GanttLayout} env.L The layout.
 * @param {Map<number, string>} env.turnYearMap chart-turn → year map.
 * @param {number} env.latestTurn The latest sampled turn.
 * @param {Snapshot[]} env.samples The sample stream.
 * @param {number} env.W Canvas width.
 * @param {number} env.H Canvas height.
 * @returns {HTMLElement} The chart wrap.
 */
function mountGanttWrap(svg, env) {
  const { filtered, barRects, tickPositions, L, turnYearMap, latestTurn, samples, W, H } = env;
  const wrap = document.createElement("div");
  wrap.className = "demographics-chart-wrap";
  wrap.style.position = "relative";
  wrap.appendChild(svg);

  mountGanttXTicks(wrap, tickPositions, L, W, H);
  mountGanttAxisTitles(wrap, L, W, H);

  const nameOverride = buildWarNameOverrides(filtered, turnYearMap, latestTurn);
  mountWarLabels(wrap, barRects, nameOverride, turnYearMap, latestTurn, W, H);

  // Hover tooltip — custom callout replacing the unreliable `title` attribute.
  const tooltip = createGanttTooltip();
  wrap.appendChild(tooltip);
  const ctx = { nameOverride, turnYearMap, latestTurn, samples };
  wireGanttHover({ wrap, svg, tooltip, barRects, ctx, W, H });
  return wrap;
}

// Triumph data helpers — shared by the Race / Completion / Stack renderers.

// Map LegacySubtype → human attribute label + stripe color. Colors borrowed
// from base-standard/ui-next/screens/legacies/legacies-support.js so our
// surfaces look at home next to the in-game Triumphs panel.
const TRIUMPH_ATTR_META = [
  { key: "LEGACY_CULTURAL", label: "Cultural", color: "#AC088E" },
  { key: "LEGACY_DIPLOMATIC", label: "Diplomatic", color: "#255BE4" },
  { key: "LEGACY_ECONOMIC", label: "Economic", color: "#C05D16" },
  { key: "LEGACY_SCIENTIFIC", label: "Scientific", color: "#356F8F" },
  { key: "LEGACY_MILITARISTIC", label: "Militaristic", color: "#B31515" },
  { key: "LEGACY_EXPANSIONIST", label: "Expansionist", color: "#00A717" }
];
/**
 * Resolve the attribute metadata (label + color) for a LegacySubtype, with a
 * neutral "Other" fallback.
 * @param {*} subtype The LegacySubtype string.
 * @returns {{ key: string, label: string, color: string }} The metadata.
 */
function attrMetaFor(subtype) {
  return (
    TRIUMPH_ATTR_META.find((a) => a.key === subtype) || {
      key: "LEGACY_WILDCARD",
      label: "Other",
      color: "#888888"
    }
  );
}

// Localize a LOC_* key with a defensive fallback. Locale.compose can return
// the raw key when the string table for that age isn't loaded, OR when the
// key references another LOC_ token internally that doesn't resolve. We
// detect those cases and produce a humanized fallback from the key itself
// (e.g. "LOC_LEGACY_ANTIQUITY_CULTURAL_1_NAME" → "Antiquity Cultural 1 Name")
// so the user never sees raw LOC_ tokens in the UI.
/**
 * Humanize a raw `LOC_*` token into Title-Case words (e.g.
 * "LOC_LEGACY_ANTIQUITY_CULTURAL_1_NAME" → "Antiquity Cultural 1").
 * @param {*} token The LOC token.
 * @returns {string} The humanized string.
 */
function humanizeLocToken(token) {
  let s = String(token).replace(/^LOC_/, "");
  s = s.replace(/_(NAME|DESCRIPTION|DESC|TRIGGER_DESCRIPTION|TRIGGER|TITLE|TOOLTIP)$/, "");
  s = s.replace(
    /^(LEGACY|TRIUMPH|VICTORY|CRISIS|MODIFIER|BONUS|AGE|PROJECT|UNIT|BUILDING|CIVIC|TECH)_/,
    ""
  );
  return s
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
/**
 * `Locale.compose(key)` returning a usable string, or the raw `key` when
 * compose is unavailable, throws, or yields nothing.
 * @param {string} key The localization key.
 * @returns {string} The composed string, or `key`.
 */
function tryComposeKey(key) {
  try {
    if (typeof Locale?.compose === "function") {
      const composed = Locale.compose(key);
      if (typeof composed === "string" && composed.length > 0) return composed;
    }
  } catch (_) {
    /* */
  }
  return key;
}

/**
 * Localize a `LOC_*` key with a defensive fallback: humanize a raw-key echo,
 * scrub embedded unresolved tokens, and strip leftover stylize tags. So the
 * user never sees raw LOC_ tokens.
 * @param {*} key The localization key.
 * @returns {string} The localized (or humanized) text.
 */
function localizeText(key) {
  if (typeof key !== "string" || key.length === 0) return "";
  let out = tryComposeKey(key);
  if (typeof out !== "string") return "";
  // Case 1: Locale.compose echoed back the raw key (or stripped wrapping).
  if (out.startsWith("LOC_")) return humanizeLocToken(out);
  // Case 2: composed text contains embedded unresolved LOC_ tokens (Civ7
  // sometimes returns "Build {LOC_TERM_WONDER} wonders" when the inner token
  // isn't in the loaded string table). Scrub each one in place.
  if (out.indexOf("LOC_") !== -1) {
    out = out.replace(/\{?LOC_[A-Z0-9_]+\}?/g, (m) => humanizeLocToken(m.replace(/[{}]/g, "")));
  }
  // Strip any remaining stylize tags Civ7 didn't expand.
  out = out
    .replace(/\[(N|B|\/B|LIST|\/LIST|LI)\]/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return out;
}

// Current age string for filtering legacies (matches GameInfo.Legacies.Age).
/**
 * Resolve the current age type string for filtering legacies.
 * @returns {string|null} The AgeType string, or `null`.
 */
function currentAgeType() {
  try {
    if (typeof Game !== "undefined" && Game.age != null) {
      const row =
        typeof GameInfo !== "undefined" && GameInfo.Ages?.lookup
          ? GameInfo.Ages.lookup(Game.age)
          : null;
      if (row?.AgeType) return row.AgeType;
      return String(Game.age);
    }
  } catch (_) {}
  return null;
}

// Get all major civs in the order they should be listed (by pid). Reads
// from the latest sample if Players.getAliveMajorIds isn't available.
/**
 * List the major civ pids, preferring the live engine `getAliveMajorIds`,
 * else scanning the history samples newest-first.
 * @param {DemoHistory|*} history The history blob.
 * @returns {number[]} The major civ pids.
 */
function alliveMajorsFromHistory(history) {
  try {
    if (typeof Players?.getAliveMajorIds === "function") {
      return Array.from(Players.getAliveMajorIds());
    }
  } catch (_) {
    /* */
  }
  return majorsFromSamples(history?.samples || []);
}

/**
 * Collect distinct numeric pids from the samples, newest-first.
 * @param {Snapshot[]} samples The sample stream.
 * @returns {number[]} The distinct pids.
 */
function majorsFromSamples(samples) {
  /** @type {number[]} */
  const out = [];
  const seen = new Set();
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i];
    if (!s?.players) continue;
    for (const pid of Object.keys(s.players)) {
      const n = Number(pid);
      if (!Number.isNaN(n) && !seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
  }
  return out;
}

// Display "Leader (Civ)" / fallback to "Player N", reading from latest sample.
/**
 * Resolve a civ's display name ("Leader (Civ)") from the latest sample.
 * @param {DemoHistory|*} history The history blob.
 * @param {number} pid Player id.
 * @returns {string} The display name.
 */
function civDisplayName(history, pid) {
  const samples = history?.samples || [];
  for (let i = samples.length - 1; i >= 0; i--) {
    const ps = samples[i]?.players?.[String(pid)];
    if (!ps) continue;
    if (ps.leaderName) {
      return ps.civName ? ps.leaderName + " (" + ps.civName + ")" : ps.leaderName;
    }
  }
  return "Player " + pid;
}

/**
 * Resolve a civ's primary color from the latest sample, falling back to the
 * rotating palette.
 * @param {DemoHistory|*} history The history blob.
 * @param {number} pid Player id.
 * @returns {string} The color.
 */
function civColor(history, pid) {
  const samples = history?.samples || [];
  for (let i = samples.length - 1; i >= 0; i--) {
    const ps = samples[i]?.players?.[String(pid)];
    if (ps?.primaryColor) return ps.primaryColor;
  }
  return PALETTE[pid % PALETTE.length];
}

/**
 * Whether the Test-of-Time Legacies player API is available for the triumph
 * views.
 * @returns {boolean} True when GameInfo.Legacies + Players.get exist.
 */
function triumphApiAvailable() {
  return (
    typeof GameInfo !== "undefined" && !!GameInfo.Legacies && typeof Players?.get === "function"
  );
}

/**
 * Collect the triumph (Legacy) rows for an age that have a subtype.
 * @param {string|null} age The current age type, or null.
 * @returns {*[]} The legacy rows.
 */
function collectTriumphRows(age) {
  const races = [];
  try {
    for (const row of GameInfo.Legacies) {
      if (!row || !row.LegacyType) continue;
      if (age && row.Age && row.Age !== age) continue;
      // Skip the wildcard / catch-all row (no attribute color).
      if (!row.LegacySubtype) continue;
      races.push(row);
    }
  } catch (_) {
    /* */
  }
  return races;
}

/**
 * One civ's progress on a legacy.
 * @typedef {Object} TriumphProgress
 * @property {number} current Current progress.
 * @property {number} total Total required.
 * @property {boolean} triggered Whether the legacy is triggered.
 * @property {number} raceWinner The winning pid, or -1.
 */

/**
 * Query one civ's live progress on a legacy via `player.Legacies`.
 * @param {number} pid Player id.
 * @param {*} legacyType The legacy type.
 * @returns {TriumphProgress|null} The progress, or `null`.
 */
function triumphProgressFor(pid, legacyType) {
  try {
    const player = Players.get(pid);
    const pl = player?.Legacies;
    if (!pl) return null;
    const p = pl.getProgress ? pl.getProgress(legacyType) : null;
    return readTriumphProgress(pl, p, legacyType);
  } catch (_) {
    return null;
  }
}

/**
 * Read a {@link TriumphProgress} from a `getProgress` result + Legacies handle.
 * @param {*} pl The player's Legacies accessor.
 * @param {*} p The `getProgress(legacyType)` result (may be null).
 * @param {*} legacyType The legacy type.
 * @returns {TriumphProgress} The progress.
 */
function readTriumphProgress(pl, p, legacyType) {
  const slot = p && p.progress ? p.progress[0] : null;
  const raceWinner = p && typeof p.raceWinner === "number" ? p.raceWinner : -1;
  return {
    current: (slot && slot.current) ?? 0,
    total: (slot && slot.total) ?? 0,
    triggered: !!(pl.isTriggered && pl.isTriggered(legacyType)),
    raceWinner
  };
}

/**
 * One race row's resolved data (per-civ progress, winner, total).
 * @typedef {Object} RaceDatum
 * @property {*} row The legacy row.
 * @property {(TriumphProgress & { pid: number })[]} civs Per-civ progress.
 * @property {number} winner The winning pid, or -1.
 * @property {number} total Total required.
 */

/**
 * Build the per-race data: each civ's progress, the race winner, and the total.
 * @param {*[]} races The legacy rows.
 * @param {number[]} majors The major civ pids.
 * @returns {RaceDatum[]} The race data.
 */
function buildRaceData(races, majors) {
  return races.map((row) => {
    const civs = majors.map((pid) => ({
      pid,
      ...(triumphProgressFor(pid, row.LegacyType) || {
        current: 0,
        total: 0,
        triggered: false,
        raceWinner: -1
      })
    }));
    // Race winner is reported on every civ's progress equally; grab any one.
    let winner = -1;
    for (const c of civs) {
      if (c.raceWinner !== -1) {
        winner = c.raceWinner;
        break;
      }
    }
    // Total available is whichever non-zero we saw (same for a given legacy).
    let total = 0;
    for (const c of civs) {
      if (c.total > total) total = c.total;
    }
    // Sort civs by progress, with the winner first.
    civs.sort((a, b) => {
      if (a.pid === winner && b.pid !== winner) return -1;
      if (b.pid === winner && a.pid !== winner) return 1;
      return b.current - a.current;
    });
    return { row, civs, winner, total };
  });
}

/**
 * Sort race data by attribute order, then activity, then localized name.
 * @param {RaceDatum[]} raceData The race data (sorted in place).
 * @returns {void}
 */
function sortRaceData(raceData) {
  const ATTR_ORDER = TRIUMPH_ATTR_META.map((a) => a.key);
  raceData.sort((a, b) => {
    const ai = ATTR_ORDER.indexOf(a.row.LegacySubtype);
    const bi = ATTR_ORDER.indexOf(b.row.LegacySubtype);
    if (ai !== bi) return ai - bi;
    const aActive = a.civs.some((c) => c.current > 0) ? 1 : 0;
    const bActive = b.civs.some((c) => c.current > 0) ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    const an = localizeText(a.row.Name) || a.row.LegacyType || "";
    const bn = localizeText(b.row.Name) || b.row.LegacyType || "";
    return an.localeCompare(bn);
  });
}

const TRIUMPH_CARD_CORNER_BLP = "blp:mp_player_detail";
const TRIUMPH_CARD_FILIGREE_L = "blp:base_top-filigree_left";
const TRIUMPH_CARD_FILIGREE_R = "blp:base_top-filigree_right";
const TRIUMPH_CARD_RING_BLP = "blp:base_triumph_ring";

/**
 * Append one rotated corner adornment to a triumph card.
 * @param {HTMLElement} card The card element.
 * @param {string} rotate The CSS rotation (e.g. "180deg").
 * @param {string} position The CSS position fragment.
 * @returns {void}
 */
function addCardCorner(card, rotate, position) {
  const c = document.createElement("div");
  c.style.cssText = [
    "position:absolute",
    "width:1.5rem",
    "height:1.5rem",
    "background-image:url('" + TRIUMPH_CARD_CORNER_BLP + "')",
    "background-size:contain",
    "background-repeat:no-repeat",
    "background-position:center",
    "transform:rotate(" + rotate + ")",
    position
  ].join(";");
  card.appendChild(c);
}

/**
 * Append the four corner adornments to a triumph card.
 * @param {HTMLElement} card The card element.
 * @returns {void}
 */
function addCardCorners(card) {
  addCardCorner(card, "180deg", "top:0.5rem;left:0.4rem");
  addCardCorner(card, "-90deg", "top:0.5rem;right:0.4rem");
  addCardCorner(card, "90deg", "bottom:0.4rem;left:0.4rem");
  addCardCorner(card, "0deg", "bottom:0.4rem;right:0.4rem");
}

/**
 * Append the top filigree pair (tinted by attribute color) to a card.
 * @param {HTMLElement} card The card element.
 * @param {{ color: string }} a The attribute metadata.
 * @returns {void}
 */
function addCardFiligree(card, a) {
  const filigreeRow = document.createElement("div");
  filigreeRow.style.cssText =
    "position:absolute;top:0;left:0;right:0;height:2.5rem;pointer-events:none;";
  if (a.color) filigreeRow.style.background = a.color + "22"; // very subtle tint
  const filL = document.createElement("div");
  filL.style.cssText =
    "position:absolute;width:7rem;height:2.5rem;left:1rem;top:-0.2rem;" +
    "background-image:url('" +
    TRIUMPH_CARD_FILIGREE_L +
    "');background-size:contain;" +
    "background-repeat:no-repeat;background-position:center;opacity:0.4;";
  const filR = document.createElement("div");
  filR.style.cssText =
    "position:absolute;width:7rem;height:2.5rem;right:1rem;top:-0.2rem;" +
    "background-image:url('" +
    TRIUMPH_CARD_FILIGREE_R +
    "');background-size:contain;" +
    "background-repeat:no-repeat;background-position:center;opacity:0.4;";
  filigreeRow.appendChild(filL);
  filigreeRow.appendChild(filR);
  card.appendChild(filigreeRow);
}

/**
 * Append the top ring (attribute initial, or ✓ when triggered) to a card.
 * @param {HTMLElement} card The card element.
 * @param {{ color: string, label: string }} a The attribute metadata.
 * @param {boolean} isTriggered Whether any civ triggered this triumph.
 * @returns {void}
 */
function addCardRing(card, a, isTriggered) {
  const ringWrap = document.createElement("div");
  ringWrap.style.cssText = [
    "position:absolute",
    "top:-1.6rem",
    "left:50%",
    "transform:translateX(-50%)",
    "width:4.4rem",
    "height:4.4rem",
    "background-image:url('" + TRIUMPH_CARD_RING_BLP + "')",
    "background-size:contain",
    "background-repeat:no-repeat",
    "background-position:center",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "pointer-events:none"
  ].join(";");
  const ringInner = document.createElement("div");
  ringInner.style.cssText = [
    "width:2.8rem",
    "height:2.8rem",
    "border-radius:50%",
    "background:" + a.color,
    "border:2px solid #e5d2ac",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "color:#ffffff",
    "font-family:TitleFont, BodyFont, sans-serif",
    "font-size:1.2rem",
    "font-weight:800",
    "box-shadow:0 0 0.5rem rgba(0,0,0,0.6)"
  ].join(";");
  ringInner.textContent = a.label.charAt(0);
  if (isTriggered) {
    ringInner.textContent = "✓";
    ringInner.style.background = "#f3c34c";
    ringInner.style.color = "#1c1408";
  }
  ringWrap.appendChild(ringInner);
  card.appendChild(ringWrap);
}

/**
 * Append the triumph name to a card.
 * @param {HTMLElement} card The card element.
 * @param {*} row The legacy row.
 * @returns {void}
 */
function addCardName(card, row) {
  const name = document.createElement("div");
  name.style.cssText = [
    "margin-top:2.6rem",
    "color:#e5d2ac",
    "font-family:TitleFont, BodyFont, sans-serif",
    "font-size:1rem",
    "font-weight:800",
    "text-transform:uppercase",
    "letter-spacing:0.08em",
    "text-align:center",
    "text-shadow:0 0 0.3rem rgba(0,0,0,0.7)",
    "line-height:1.2",
    "padding:0 0.4rem"
  ].join(";");
  name.textContent = localizeText(row.Name) || row.LegacyType || "Triumph";
  card.appendChild(name);
}

/**
 * Append the Commemorative/Instant dedication pill (with dividers) to a card.
 * @param {HTMLElement} card The card element.
 * @param {{ color: string, label: string }} a The attribute metadata.
 * @param {boolean} isMajor Whether the legacy is a major (commemorative) one.
 * @returns {void}
 */
function addCardPill(card, a, isMajor) {
  const pillRow = document.createElement("div");
  pillRow.style.cssText =
    "display:flex;align-items:center;justify-content:center;margin-top:0.4rem;gap:0.4rem;width:100%;";
  const divL = document.createElement("div");
  divL.style.cssText =
    "flex:0 0 3.5rem;height:1px;background:linear-gradient(to right, rgba(81,78,84,0), rgba(81,78,84,0.9));";
  const pill = document.createElement("div");
  pill.className = "dedication-pill";
  pill.style.cssText = [
    "padding:0.05rem 0.6rem",
    "font-family:TitleFont, BodyFont, sans-serif",
    "font-size:0.72rem",
    "color:" + (isMajor ? a.color : "#85878c"),
    "text-transform:uppercase",
    "letter-spacing:0.12em",
    "font-weight:700",
    "white-space:nowrap"
  ].join(";");
  pill.textContent = isMajor ? "Commemorative · " + a.label : "Instant · " + a.label;
  const divR = document.createElement("div");
  divR.style.cssText =
    "flex:0 0 3.5rem;height:1px;background:linear-gradient(to left, rgba(81,78,84,0), rgba(81,78,84,0.9));";
  pillRow.appendChild(divL);
  pillRow.appendChild(pill);
  pillRow.appendChild(divR);
  card.appendChild(pillRow);
}

/**
 * Append the requirements + reward text rows to a card (when present).
 * @param {HTMLElement} card The card element.
 * @param {*} row The legacy row.
 * @returns {void}
 */
function addCardRequirementsAndReward(card, row) {
  if (row.TriggerDescription) {
    const req = document.createElement("div");
    req.style.cssText = [
      "margin-top:0.6rem",
      "font-size:0.78rem",
      "color:#c2c4cc",
      "text-align:center",
      "line-height:1.3",
      "padding:0 0.3rem",
      "font-style:italic"
    ].join(";");
    req.textContent = localizeText(row.TriggerDescription);
    card.appendChild(req);
  }
  const rewardText = row.Description || row.RewardDescription || null;
  if (rewardText) {
    const rwd = document.createElement("div");
    rwd.style.cssText = [
      "margin-top:0.45rem",
      "font-size:0.78rem",
      "color:#c2c4cc",
      "text-align:center",
      "line-height:1.3",
      "padding:0 0.3rem"
    ].join(";");
    const rwdLabel = document.createElement("span");
    rwdLabel.style.cssText =
      "color:#e5d2ac;font-family:TitleFont, BodyFont, sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;";
    rwdLabel.textContent = "Reward: ";
    rwd.appendChild(rwdLabel);
    const rwdBody = document.createElement("span");
    rwdBody.textContent = localizeText(rewardText);
    rwd.appendChild(rwdBody);
    card.appendChild(rwd);
  }
}

/**
 * Append the winner trophy line to a card when the race has a winner.
 * @param {HTMLElement} card The card element.
 * @param {RaceDatum} rd The race datum.
 * @param {DemoHistory|*} history The history blob (for the name).
 * @returns {void}
 */
function addCardTrophy(card, rd, history) {
  if (rd.winner === -1) return;
  const trophy = document.createElement("div");
  trophy.style.cssText = [
    "margin-top:0.55rem",
    "color:#f3c34c",
    "font-family:TitleFont, BodyFont, sans-serif",
    "font-size:0.82rem",
    "font-weight:700",
    "text-transform:uppercase",
    "letter-spacing:0.08em",
    "text-align:center"
  ].join(";");
  trophy.textContent = "🏆 " + civDisplayName(history, rd.winner);
  card.appendChild(trophy);
}

/**
 * Append the spacer + per-civ progress bars (or a "No progress yet." note) to
 * a card.
 * @param {HTMLElement} card The card element.
 * @param {RaceDatum} rd The race datum.
 * @param {{ color: string }} a The attribute metadata.
 * @param {DemoHistory|*} history The history blob (for names/colors).
 * @returns {void}
 */
function addCardProgressBars(card, rd, a, history) {
  // Spacer that pushes the bars to the bottom of the card.
  const spacer = document.createElement("div");
  spacer.style.flex = "1 1 auto";
  spacer.style.minHeight = "0.6rem";
  card.appendChild(spacer);

  // Small per-civ progress bars — ONLY for civs with current > 0 (winner
  // included). This is the user-requested addition.
  const active = rd.civs.filter((c) => c.current > 0 || c.pid === rd.winner);
  const barsBox = document.createElement("div");
  barsBox.style.cssText = "width:100%;display:flex;flex-direction:column;gap:0.18rem;";
  if (active.length === 0) {
    const noneMsg = document.createElement("div");
    noneMsg.style.cssText = "font-size:0.72rem;color:#85878c;font-style:italic;text-align:center;";
    noneMsg.textContent = "No progress yet.";
    barsBox.appendChild(noneMsg);
  } else {
    for (const c of active) {
      barsBox.appendChild(buildCivProgressRow(c, rd, a, history));
    }
  }
  card.appendChild(barsBox);
}

/**
 * Build one civ's progress row (name + bar + count) for a triumph card.
 * @param {TriumphProgress & { pid: number }} c The civ progress.
 * @param {RaceDatum} rd The race datum.
 * @param {{ color: string }} a The attribute metadata.
 * @param {DemoHistory|*} history The history blob (for name/color).
 * @returns {HTMLElement} The row element.
 */
function buildCivProgressRow(c, rd, a, history) {
  const isWinner = c.pid === rd.winner;
  const row = document.createElement("div");
  row.style.cssText =
    "display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr) minmax(2.4rem,auto);gap:0.4rem;align-items:center;";
  row.appendChild(buildCivProgressNameCell(c, isWinner, history));
  row.appendChild(buildCivProgressBar(c, rd, a));
  const num = document.createElement("div");
  num.style.cssText =
    "font-family:monospace, ui-monospace;font-size:0.7rem;color:" +
    (isWinner ? "#f3c34c" : "#c2c4cc") +
    ";text-align:right;font-weight:" +
    (c.triggered ? "700" : "500") +
    ";";
  num.textContent = c.current + "/" + rd.total + (c.triggered ? " ✓" : "");
  row.appendChild(num);
  return row;
}

/**
 * Build the name cell (dot + civ name) for a civ progress row.
 * @param {TriumphProgress & { pid: number }} c The civ progress.
 * @param {boolean} isWinner Whether this civ won the race.
 * @param {DemoHistory|*} history The history blob (for name/color).
 * @returns {HTMLElement} The name cell.
 */
function buildCivProgressNameCell(c, isWinner, history) {
  const nameCell = document.createElement("div");
  nameCell.style.cssText = "display:flex;align-items:center;gap:0.3rem;min-width:0;";
  const dot = document.createElement("span");
  dot.style.cssText =
    "width:0.45rem;height:0.45rem;border-radius:50%;flex-shrink:0;background:" +
    civColor(history, c.pid) +
    ";";
  nameCell.appendChild(dot);
  const nm = document.createElement("span");
  nm.style.cssText =
    "font-size:0.72rem;color:" +
    (isWinner ? "#f3c34c" : "#e5d2ac") +
    ";font-weight:" +
    (isWinner ? "700" : "500") +
    ";overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;";
  nm.textContent = civDisplayName(history, c.pid);
  nameCell.appendChild(nm);
  return nameCell;
}

/**
 * Build the progress bar (track + optional fill) for a civ progress row.
 * @param {TriumphProgress & { pid: number }} c The civ progress.
 * @param {RaceDatum} rd The race datum.
 * @param {{ color: string }} a The attribute metadata.
 * @returns {HTMLElement} The bar element.
 */
function buildCivProgressBar(c, rd, a) {
  const bar = document.createElement("div");
  bar.style.cssText =
    "position:relative;height:0.3rem;background:rgba(20,16,10,0.7);border:1px solid rgba(168,132,90,0.4);border-radius:0.1rem;overflow:hidden;";
  if (rd.total > 0 && c.current > 0) {
    const fill = document.createElement("div");
    const pct = Math.min(100, (c.current / rd.total) * 100);
    fill.style.cssText =
      "position:absolute;left:0;top:0;bottom:0;width:" +
      pct +
      "%;background:" +
      (c.triggered ? "#f3c34c" : a.color) +
      ";opacity:" +
      (c.triggered ? "0.95" : "0.85") +
      ";";
    bar.appendChild(fill);
  }
  return bar;
}

/**
 * Build one full triumph card (ornate chrome + ring + name + pill +
 * requirements + reward + trophy + per-civ progress bars).
 * @param {RaceDatum} rd The race datum.
 * @param {DemoHistory|*} history The history blob.
 * @returns {HTMLElement} The card element.
 */
function buildTriumphCard(rd, history) {
  const a = attrMetaFor(rd.row.LegacySubtype);
  const isMajor = rd.row.MajorLegacy !== false;
  const isTriggered = rd.civs.some((c) => c.triggered);

  const card = document.createElement("div");
  card.className = "ornate-card-bg triumph-card";
  card.style.cssText = [
    "position:relative",
    "width:22rem",
    "min-height:24rem",
    "padding:1.5rem 1rem 1rem",
    "display:flex",
    "flex-direction:column",
    "align-items:center",
    "pointer-events:auto"
  ].join(";");

  addCardCorners(card);
  addCardFiligree(card, a);
  addCardRing(card, a, isTriggered);
  addCardName(card, rd.row);
  addCardPill(card, a, isMajor);
  addCardRequirementsAndReward(card, rd.row);
  addCardTrophy(card, rd, history);
  addCardProgressBars(card, rd, a, history);
  return card;
}

// Triumph Race — per-civ progress on each first-come-first-served triumph
// (those marked FirstPlayerOnly in GameInfo.Legacies). Reads
// Players.get(pid).Legacies.getProgress(legacyType) live each render so the
// `raceWinner` field surfaces immediately when a civ claims a race.
/**
 * Render the Triumph Race view: one ornate card per triumph for the current
 * age, with small per-civ progress bars. Reads `player.Legacies` live.
 * @param {HTMLElement} host The view host (cleared and repopulated).
 * @param {{ history?: DemoHistory|* }} [options] Render options.
 * @returns {null} Always `null` (the view has no chart handle).
 */
export function renderTriumphRace(host, options) {
  if (!host) return null;
  while (host.firstChild) host.removeChild(host.firstChild);
  const opts = options || {};
  host.style.overflowY = "auto";
  host.style.padding = "0.6rem 0.8rem";

  if (!triumphApiAvailable()) {
    appendEmptyNotice(host, "Test-of-Time Legacies API unavailable.");
    return null;
  }

  const age = currentAgeType();
  const majors = alliveMajorsFromHistory(opts.history);
  if (majors.length === 0) {
    appendEmptyNotice(host, "No civs sampled yet.");
    return null;
  }

  // Collect ALL triumphs (major + minor, race + non-race) for this age — every
  // triumph appears card-style like the Completion screen, with progress bars
  // only for civs actively making progress.
  const races = collectTriumphRows(age);
  if (races.length === 0) {
    appendEmptyNotice(
      host,
      age ? "No triumphs available in " + age + "." : "No triumphs available."
    );
    return null;
  }

  const raceData = buildRaceData(races, majors);
  // Order: by attribute then by activity, alphabetical tiebreak.
  sortRaceData(raceData);

  // Render — direct clone of the native triumph-card chrome (ornate-card-bg,
  // corner adornments, top filigrees, attribute ring, name, dedication pill,
  // requirements) PLUS small per-civ progress bars. Laid out as a wrapping
  // flex grid like the native triumphs tab.
  const grid = document.createElement("div");
  grid.style.display = "flex";
  grid.style.flexWrap = "wrap";
  grid.style.gap = "1.2rem 1rem";
  grid.style.justifyContent = "center";
  grid.style.padding = "0.5rem 0.3rem";
  for (const rd of raceData) {
    grid.appendChild(buildTriumphCard(rd, opts.history));
  }
  host.appendChild(grid);

  dlog("triumph race rendered; races=", raceData.length);
  return null;
}

/**
 * Count the available triumphs per attribute for an age.
 * @param {string|null} age The current age type, or null.
 * @returns {Record<string, number>} Per-attribute totals.
 */
function computeTriumphTotals(age) {
  /** @type {Record<string, number>} */
  const totals = {};
  for (const a of TRIUMPH_ATTR_META) totals[a.key] = 0;
  try {
    for (const row of GameInfo.Legacies) {
      if (!row || !row.LegacySubtype) continue;
      if (age && row.Age && row.Age !== age) continue;
      if (totals[row.LegacySubtype] !== undefined) totals[row.LegacySubtype]++;
    }
  } catch (_) {
    /* */
  }
  return totals;
}

/**
 * Whether a civ has triggered a given legacy (defensive).
 * @param {*} pl The player's Legacies accessor.
 * @param {*} legacyType The legacy type.
 * @returns {boolean} True when triggered.
 */
function isLegacyTriggered(pl, legacyType) {
  try {
    return !!pl.isTriggered?.(legacyType);
  } catch (_) {
    return false;
  }
}

/**
 * Tally one civ's triggered triumphs per attribute for an age.
 * @param {*} pl The player's Legacies accessor (may be null).
 * @param {string|null} age The current age type, or null.
 * @returns {Record<string, number>} Per-attribute triggered counts.
 */
function tallyCivCounts(pl, age) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const a of TRIUMPH_ATTR_META) counts[a.key] = 0;
  if (!pl) return counts;
  try {
    for (const row of GameInfo.Legacies) {
      if (!legacyCountsForAge(row, age) || counts[row.LegacySubtype] === undefined) continue;
      if (isLegacyTriggered(pl, row.LegacyType)) counts[row.LegacySubtype]++;
    }
  } catch (_) {
    /* */
  }
  return counts;
}

/**
 * Whether a Legacies row has a subtype and belongs to the active age.
 * @param {*} row A GameInfo.Legacies row.
 * @param {string|null} age The current age type, or null.
 * @returns {boolean} True when the row counts for this age.
 */
function legacyCountsForAge(row, age) {
  if (!row || !row.LegacySubtype) return false;
  if (age && row.Age && row.Age !== age) return false;
  return true;
}

/**
 * One civ's completion row data.
 * @typedef {Object} CivCompletion
 * @property {number} pid Player id.
 * @property {Record<string, number>} counts Per-attribute triggered counts.
 * @property {number} sumTriggered Total triggered across attributes.
 */

/**
 * Build the per-civ triggered-count rows (live API), sorted by total desc.
 * @param {number[]} majors The major civ pids.
 * @param {string|null} age The current age type, or null.
 * @returns {CivCompletion[]} The civ completion rows.
 */
function computeCivCompletions(majors, age) {
  const civRows = majors.map((pid) => {
    const pl = Players.get(pid)?.Legacies;
    const counts = tallyCivCounts(pl, age);
    const sumTriggered = Object.values(counts).reduce((s, n) => s + n, 0);
    return { pid, counts, sumTriggered };
  });
  civRows.sort((a, b) => b.sumTriggered - a.sumTriggered);
  return civRows;
}

/**
 * Build the completion view header line.
 * @param {string|null} age The current age type, or null.
 * @returns {HTMLElement} The header element.
 */
function buildCompletionHeader(age) {
  const header = document.createElement("div");
  header.style.fontSize = "0.85rem";
  header.style.color = "#c9b88c";
  header.style.marginBottom = "0.5rem";
  header.textContent =
    "Current age: " +
    (age || "unknown") +
    ". Cells show triggered / total available; bar is filled percent.";
  return header;
}

/**
 * Build one attribute section's header (title + available count).
 * @param {{ color: string, label: string }} a The attribute metadata.
 * @param {number} tot The available-triumph count.
 * @returns {HTMLElement} The section header element.
 */
function buildAttrSectionHead(a, tot) {
  const sectionHead = document.createElement("div");
  sectionHead.style.display = "flex";
  sectionHead.style.alignItems = "baseline";
  sectionHead.style.justifyContent = "space-between";
  sectionHead.style.marginBottom = "0.5rem";
  const sectionTitle = document.createElement("div");
  // Engine fxs-header style: TitleFont uppercase tracking-150 in path color.
  sectionTitle.style.color = a.color;
  sectionTitle.style.fontFamily = "TitleFont, BodyFont, sans-serif";
  sectionTitle.style.fontSize = "1.1rem";
  sectionTitle.style.fontWeight = "800";
  sectionTitle.style.textTransform = "uppercase";
  sectionTitle.style.letterSpacing = "0.15em";
  sectionTitle.style.textShadow = "0 0 0.3rem rgba(0,0,0,0.6)";
  sectionTitle.textContent = a.label;
  sectionHead.appendChild(sectionTitle);
  const sectionCount = document.createElement("div");
  sectionCount.style.fontSize = "0.78rem";
  sectionCount.style.color = "#c9b88c";
  sectionCount.style.fontFamily = "monospace, ui-monospace";
  sectionCount.textContent = tot + " triumph" + (tot === 1 ? "" : "s") + " available";
  sectionHead.appendChild(sectionCount);
  return sectionHead;
}

/**
 * Build a completion row's name cell (dot + civ name).
 * @param {number} pid Player id.
 * @param {DemoHistory|*} history The history blob.
 * @returns {HTMLElement} The name cell.
 */
function buildCompletionNameCell(pid, history) {
  const nameCell = document.createElement("div");
  nameCell.style.display = "flex";
  nameCell.style.alignItems = "center";
  nameCell.style.gap = "0.4rem";
  const dot = document.createElement("span");
  dot.style.width = "0.6rem";
  dot.style.height = "0.6rem";
  dot.style.borderRadius = "50%";
  dot.style.background = civColor(history, pid);
  dot.style.flexShrink = "0";
  nameCell.appendChild(dot);
  const nm = document.createElement("span");
  nm.style.color = "#f3e7c4";
  nm.style.fontSize = "0.85rem";
  nm.style.overflow = "hidden";
  nm.style.textOverflow = "ellipsis";
  nm.style.whiteSpace = "nowrap";
  nm.textContent = civDisplayName(history, pid);
  nameCell.appendChild(nm);
  return nameCell;
}

/**
 * Build a completion row's pipped progress bar (track + fill + pips).
 * @param {{ color: string }} a The attribute metadata.
 * @param {number} tot The available count.
 * @param {number} got The triggered count.
 * @returns {HTMLElement} The bar wrapper element.
 */
function buildCompletionBar(a, tot, got) {
  const barWrap = document.createElement("div");
  barWrap.style.position = "relative";
  barWrap.style.height = "1.1rem";
  barWrap.style.display = "flex";
  barWrap.style.alignItems = "center";
  // Track behind the pips.
  const track = document.createElement("div");
  track.style.position = "absolute";
  track.style.left = "0";
  track.style.right = "0";
  track.style.height = "0.32rem";
  track.style.background = "rgba(20, 16, 10, 0.7)";
  track.style.border = "1px solid rgba(201, 162, 76, 0.25)";
  track.style.borderRadius = "0.15rem";
  barWrap.appendChild(track);
  // Filled portion of the track up to the triggered count.
  if (tot > 0 && got > 0) {
    const fill = document.createElement("div");
    fill.style.position = "absolute";
    fill.style.left = "0";
    fill.style.height = "0.32rem";
    fill.style.width = (got / tot) * 100 + "%";
    fill.style.background = a.color;
    fill.style.opacity = "0.85";
    fill.style.borderRadius = "0.15rem";
    barWrap.appendChild(fill);
  }
  barWrap.appendChild(buildCompletionPips(a, tot, got));
  return barWrap;
}

/**
 * Build the evenly-spaced pip row: filled pips up to `got`, hollow beyond.
 * @param {{ color: string }} a The attribute metadata.
 * @param {number} tot The available count.
 * @param {number} got The triggered count.
 * @returns {HTMLElement} The pip row element.
 */
function buildCompletionPips(a, tot, got) {
  const pipRow = document.createElement("div");
  pipRow.style.position = "relative";
  pipRow.style.width = "100%";
  pipRow.style.display = "flex";
  pipRow.style.justifyContent = "space-between";
  pipRow.style.alignItems = "center";
  // Pad ends slightly so first/last pips don't get clipped.
  pipRow.style.padding = "0 0.18rem";
  pipRow.style.boxSizing = "border-box";
  const pipCount = Math.max(1, tot);
  for (let i = 0; i < pipCount; i++) {
    const pip = document.createElement("div");
    pip.style.width = "0.72rem";
    pip.style.height = "0.72rem";
    pip.style.borderRadius = "50%";
    pip.style.flexShrink = "0";
    if (i < got) {
      pip.style.background = a.color;
      pip.style.border = "2px solid #f3c34c";
      pip.style.boxShadow = "0 0 4px " + a.color;
    } else {
      pip.style.background = "rgba(20, 16, 10, 0.85)";
      pip.style.border = "2px solid rgba(201, 162, 76, 0.55)";
    }
    pipRow.appendChild(pip);
  }
  return pipRow;
}

/**
 * Build one completion row (name cell + pipped bar + count) for a civ.
 * @param {{ pid: number, got: number }} cr The civ row data.
 * @param {{ color: string }} a The attribute metadata.
 * @param {number} tot The available count.
 * @param {DemoHistory|*} history The history blob.
 * @returns {HTMLElement} The row element.
 */
function buildCompletionRow(cr, a, tot, history) {
  const row = document.createElement("div");
  row.style.display = "grid";
  row.style.gridTemplateColumns = "minmax(10rem, 14rem) 1fr minmax(3rem, auto)";
  row.style.gap = "0.6rem";
  row.style.alignItems = "center";
  row.appendChild(buildCompletionNameCell(cr.pid, history));
  row.appendChild(buildCompletionBar(a, tot, cr.got));
  const num = document.createElement("div");
  num.style.fontFamily = "monospace, ui-monospace";
  num.style.fontSize = "0.8rem";
  num.style.color = cr.got > 0 ? "#f3c34c" : "#9a8c5c";
  num.style.textAlign = "right";
  num.style.fontWeight = cr.got === tot && tot > 0 ? "700" : "500";
  num.textContent = cr.got + "/" + tot;
  row.appendChild(num);
  return row;
}

/**
 * Build one attribute section (header + per-civ pipped rows sorted by progress).
 * @param {{ key: string, color: string, label: string }} a The attribute meta.
 * @param {Record<string, number>} totals Per-attribute available counts.
 * @param {CivCompletion[]} civRows The civ completion rows.
 * @param {DemoHistory|*} history The history blob.
 * @returns {HTMLElement} The section element.
 */
function buildAttrSection(a, totals, civRows, history) {
  const tot = totals[a.key] || 0;
  const section = document.createElement("div");
  section.style.background = "rgba(20, 16, 10, 0.55)";
  section.style.border = "1px solid rgba(201, 162, 76, 0.25)";
  section.style.borderTop = "0.18rem solid " + a.color;
  section.style.borderRadius = "0.2rem";
  section.style.padding = "0.55rem 0.8rem 0.7rem";
  section.appendChild(buildAttrSectionHead(a, tot));
  // Per-civ rows, sorted by progress in THIS attribute (desc).
  const rowsForAttr = civRows
    .map((cr) => ({ pid: cr.pid, got: cr.counts[a.key] || 0 }))
    .sort((x, y) => y.got - x.got);
  const rowsContainer = document.createElement("div");
  rowsContainer.style.display = "flex";
  rowsContainer.style.flexDirection = "column";
  rowsContainer.style.gap = "0.3rem";
  for (const cr of rowsForAttr) {
    rowsContainer.appendChild(buildCompletionRow(cr, a, tot, history));
  }
  section.appendChild(rowsContainer);
  return section;
}

// Triumph Completion — per-civ × per-attribute grid for the current age.
// Cell shows triggered count / total available + bar.
/**
 * Render the Triumph Completion view: one section per attribute, each with a
 * pipped progress row per civ (live `player.Legacies` triggered counts).
 * @param {HTMLElement} host The view host (cleared and repopulated).
 * @param {{ history?: DemoHistory|* }} [options] Render options.
 * @returns {null} Always `null` (the view has no chart handle).
 */
export function renderTriumphCompletion(host, options) {
  if (!host) return null;
  while (host.firstChild) host.removeChild(host.firstChild);
  const opts = options || {};
  host.style.overflowY = "auto";
  host.style.padding = "0.6rem 0.8rem";

  if (!triumphApiAvailable()) {
    appendEmptyNotice(host, "Test-of-Time Legacies API unavailable.");
    return null;
  }

  const age = currentAgeType();
  const majors = alliveMajorsFromHistory(opts.history);
  const totals = computeTriumphTotals(age);
  const civRows = computeCivCompletions(majors, age);

  host.appendChild(buildCompletionHeader(age));

  // Sections organized by ATTRIBUTE (mirrors the base-game Victors panel).
  // Each civ gets a pipped progress bar — one pip per legacy in that path,
  // filled-gold for triggered and hollow for not.
  const stack = document.createElement("div");
  stack.style.display = "flex";
  stack.style.flexDirection = "column";
  stack.style.gap = "0.9rem";
  for (const a of TRIUMPH_ATTR_META) {
    stack.appendChild(buildAttrSection(a, totals, civRows, opts.history));
  }
  host.appendChild(stack);
  dlog("triumph completion rendered; civs=", civRows.length, "age=", age);
  return null;
}

// Triumph Stack Over Time — per-civ stacked-area chart of cumulative triumph
// counts over the sample history, stacked by attribute.
/**
 * List every sampled civ (with display labels), for the triumph-stack viewer
 * dropdown.
 * @param {DemoHistory|*} history The history blob.
 * @returns {{ pid: string, label: string }[]} The civ options.
 */
export function collectTriumphCivOptions(history) {
  const samps = history && Array.isArray(history.samples) ? history.samples : [];
  /** @type {Map<string, { pid: string, label: string }>} */
  const seen = new Map();
  for (const s of samps) {
    if (!s?.players) continue;
    for (const pid of Object.keys(s.players)) {
      if (seen.has(pid)) continue;
      const ps = s.players[pid];
      seen.set(pid, { pid, label: civOptionLabel(ps, pid) });
    }
  }
  return Array.from(seen.values());
}

const TRIUMPH_BANDS = [
  { id: "triumphs_cultural", label: "Cultural", color: "#AC088E" },
  { id: "triumphs_diplomatic", label: "Diplomatic", color: "#255BE4" },
  { id: "triumphs_economic", label: "Economic", color: "#C05D16" },
  { id: "triumphs_scientific", label: "Scientific", color: "#356F8F" },
  { id: "triumphs_militaristic", label: "Militaristic", color: "#B31515" },
  { id: "triumphs_expansionist", label: "Expansionist", color: "#00A717" }
];

/**
 * Render the Triumph Stack: per-civ stacked-area of cumulative triumph counts
 * over time, stacked by attribute. Reuses {@link renderResourcesStack}.
 * @param {StackOptions} [options] Render options.
 * @param {HTMLElement} host The view host element.
 * @returns {{ svg: SVGElement }|null} The mounted SVG handle, or `null`.
 */
export function renderTriumphStack(host, options) {
  // Reuse the SVG stacked-area renderer with the triumph band set.
  // `yAxisLabel` lets the host override the hardcoded "Resources Assigned"
  // axis title that the shared renderer otherwise paints.
  return renderResourcesStack(
    host,
    Object.assign({}, options || {}, {
      bands: TRIUMPH_BANDS,
      yAxisLabel: "Triumphs (count)"
    })
  );
}
