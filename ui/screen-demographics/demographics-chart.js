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
import { makeClickable } from "/demographics/ui/demographics-a11y.js";

const DBG = true;
function dlog(...a) {
  if (DBG) console.warn("[Demographics.chart]", ...a);
}

const SVG_NS = "http://www.w3.org/2000/svg";

// Each chart render reads the palette fresh so the colorblind-mode toggle
// in Options takes effect on the very next paint without a mod reload.
// Define PALETTE as a getter so existing `PALETTE[i]` indexing keeps working.
const PALETTE = new Proxy(
  {},
  {
    get(_, prop) {
      const p = getPalette();
      if (prop === "length") return p.length;
      return p[Number(prop)];
    }
  }
);

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k]);
  return el;
}

// Brighten a civ primary color when it's about to be painted as TEXT or a
// small swatch on the dark tooltip background. Civs with dark-blue / dark-
// purple primaries (Persia, etc.) become unreadable as-is on `img-tooltip-bg`.
// Handles both plain hex (#RRGGBB), 8-char ARGB (#AARRGGBB), and rgba()
// (which is produced by colorWithAlpha for dimmed lines). Channels are
// scaled proportionally so the hue is preserved while the perceived
// luminance is dragged up over a readability floor.
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
  const hex2 = (n) => n.toString(16).padStart(2, "0");
  return "#" + hex2(r) + hex2(g) + hex2(b);
}

function leaderDisplayName(leaderType, pid) {
  if (!leaderType) return "Player " + pid;
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
  } catch (e) {
    /* swallow — fall through to fallback */
  }
  const s = String(leaderType);
  // Avoid surfacing a raw numeric hash as the display name.
  if (/^-?\d+$/.test(s)) return "Player " + pid;
  return s.replace(/^LEADER_/, "").replace(/_/g, " ");
}

// Walk samples for one pid and return an ORDERED list of unique civ names
// in chronological order. Skips empty/missing civ names.
function collectCivHistory(samples, pid) {
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
function inferSampleAge(s /*, ageBoundaries */) {
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
function inferLocalTurn(s /*, age, ageBoundaries */) {
  // Use explicit localTurn when present, otherwise fall back to the
  // stored turn (which IS age-local for legacy samples, since they were
  // never offset).
  if (s && typeof s.localTurn === "number") return s.localTurn;
  if (s && typeof s.turn === "number") return s.turn;
  return null;
}
function computeAgeOffsets(samples, ageBoundaries) {
  const maxLocalByAge = new Map();
  for (const s of samples) {
    if (!s || typeof s !== "object") continue;
    const age = inferSampleAge(s, ageBoundaries);
    const lt = inferLocalTurn(s, age, ageBoundaries);
    if (lt === null) continue;
    const prev = maxLocalByAge.get(age) || 0;
    if (lt > prev) maxLocalByAge.set(age, lt);
  }
  const offsets = new Map();
  let cum = 0;
  for (const age of AGE_ORDER) {
    offsets.set(age, cum);
    cum += maxLocalByAge.get(age) || 0;
  }
  return { offsets, maxLocalByAge };
}
function sampleX(sample, offsets, ageBoundaries) {
  if (!sample) return undefined;
  const age = inferSampleAge(sample, ageBoundaries);
  const lt = inferLocalTurn(sample, age, ageBoundaries);
  if (typeof lt === "number" && offsets.has(age)) {
    return offsets.get(age) + lt;
  }
  if (typeof sample.turn === "number") return sample.turn;
  return undefined;
}

// Returns { series: [{ name, leaderType, color, points: [{ t, v }], allCivNames }], sampleCount }
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

  const pidSet = new Set();
  for (const s of samples) {
    if (s && s.players) {
      for (const k of Object.keys(s.players)) pidSet.add(k);
    }
  }
  const pids = Array.from(pidSet);
  const series = [];
  pids.forEach((pid, idx) => {
    const points = [];
    let leaderType = null;
    let leaderName = null;
    let primaryColor = null;
    let metFlag;
    for (const s of samples) {
      const ps = s.players && s.players[pid];
      if (!ps) continue;
      if (!leaderType && ps.leaderType !== undefined && ps.leaderType !== null)
        leaderType = ps.leaderType;
      if (!leaderName && typeof ps.leaderName === "string" && ps.leaderName.length > 0)
        leaderName = ps.leaderName;
      // Take the LATEST non-empty primary color — civilization swaps
      // at age transitions change civ colors too, and we want the
      // line color to reflect the current civ identity.
      if (typeof ps.primaryColor === "string" && ps.primaryColor.length > 0) {
        primaryColor = ps.primaryColor;
      }
      if (typeof ps.met === "boolean") metFlag = ps.met; // latest wins
      const v = ps.metrics ? ps.metrics[metricId] : undefined;
      if (typeof v === "number" && isFinite(v)) {
        const x = sampleX(s, ageOffsets, ageBoundariesLocal);
        if (typeof x === "number") points.push({ t: x, v });
      }
    }
    if (points.length >= 1) {
      const key = String(leaderType ?? "pid:" + pid);
      const leaderOnly =
        leaderName || (leaderType !== null ? leaderDisplayName(leaderType, pid) : "Player " + pid);
      let allCivNames = collectCivHistory(samples, pid);
      // Live fallback for snapshots that don't carry civName yet
      // (older history rows pre-$hash fix). Pull directly via
      // player.civilizationName so the chart label never says
      // "Augustus" alone when we can resolve "Augustus (Rome)" now.
      if (allCivNames.length === 0) {
        try {
          const p = typeof Players?.get === "function" ? Players.get(Number(pid)) : null;
          const live = p?.civilizationName;
          if (typeof live === "string" && live.length > 0) {
            const composed = typeof Locale?.compose === "function" ? Locale.compose(live) : live;
            if (composed && composed.length > 0) allCivNames = [composed];
          }
        } catch (_) {
          /* */
        }
      }
      const isEliminated = !!eliminatedMap[String(pid)] || !!eliminatedMap[Number(pid)];
      // Prefer the civ's actual primary color so each line matches
      // the in-game banner color. Fall back to the rotating palette
      // only when the sampler didn't capture a color (older saves).
      const color =
        typeof primaryColor === "string" && primaryColor.length > 0
          ? primaryColor
          : PALETTE[idx % PALETTE.length];
      series.push({
        // End-of-line labels: "Leader (Civ)" or "Leader (Old → New)".
        name: displayName(leaderOnly, allCivNames) + (isEliminated ? " ✝" : ""),
        pid: Number(pid),
        met: metFlag === undefined ? true : metFlag,
        eliminated: isEliminated,
        leaderType: key,
        color,
        points,
        allCivNames
      });
    }
  });
  return { series, sampleCount: samples.length };
}

export { collectCivHistory, displayName };

// Resolve a friendly age label from an AgeType string like "AGE_EXPLORATION".
function ageLabel(ageType) {
  if (!ageType) return "";
  try {
    if (
      typeof GameInfo !== "undefined" &&
      GameInfo.Ages &&
      typeof GameInfo.Ages.lookup === "function"
    ) {
      const row = GameInfo.Ages.lookup(ageType);
      if (row && row.Name) {
        if (typeof Locale !== "undefined" && typeof Locale.compose === "function") {
          try {
            return Locale.compose(row.Name);
          } catch (_) {
            /* */
          }
        }
        return String(row.Name);
      }
    }
  } catch (_) {
    /* */
  }
  return String(ageType)
    .replace(/^AGE_/, "")
    .split("_")
    .map((w) => (w[0] ? w[0].toUpperCase() : "") + w.slice(1).toLowerCase())
    .join(" ");
}

// De-collision pass for right-edge labels.
// Inputs: labels = [{ y, intendedY, anchorY, ... }] sorted by intendedY ascending.
// Output: same array with .y adjusted so each label.y >= previous.y + minGap,
// and clamped to [yMin, yMax]. See spec sub-task 4.
function decollideLabels(labels, minGap, yMin, yMax) {
  labels.sort((a, b) => a.intendedY - b.intendedY);
  const N = labels.length;
  if (N === 0) return;
  // If the requested minGap would push the stack past the plot bounds,
  // shrink it so every label fits without overlap. With many civs we'd
  // rather have tightly packed (but still ordered) labels than two pasted
  // on top of each other after a final yMin clamp.
  const available = yMax - yMin;
  const gap = N > 1 && (N - 1) * minGap > available ? Math.max(1, available / (N - 1)) : minGap;
  // Forward pass: enforce y >= prev + gap, and y >= yMin.
  let prev = yMin - gap;
  for (let i = 0; i < N; i++) {
    const lo = Math.max(prev + gap, yMin);
    if (labels[i].y < lo) labels[i].y = lo;
    prev = labels[i].y;
  }
  // Backward pass: enforce y <= yMax and y <= next - gap.
  let next = yMax + gap;
  for (let i = N - 1; i >= 0; i--) {
    const hi = Math.min(next - gap, yMax);
    if (labels[i].y > hi) labels[i].y = hi;
    next = labels[i].y;
  }
}

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
export function setXAxisMode(mode) {
  if (mode === "turn" || mode === "year" || mode === "both") _xAxisMode = mode;
}
export function getXAxisMode() {
  return _xAxisMode;
}

// One-shot Chart.js smoke test. Runs the first time renderChart is called so
// UI.log records definitive evidence about whether Chart.js can instantiate
// and lay out inside our scope of the Coherent GameFace runtime. Does NOT
// replace the SVG renderer below — purely an instrumented probe.
let _chartJsSmokeDone = false;
function chartJsSmokeTest(host, W, H) {
  if (_chartJsSmokeDone) return;
  _chartJsSmokeDone = true;
  try {
    console.warn("[Demographics.smoke] begin; typeof Chart=", typeof Chart);
    if (typeof Chart === "undefined") {
      console.warn(
        "[Demographics.smoke] Chart global is undefined — Chart.js not loaded in our scope"
      );
      return;
    }
    console.warn("[Demographics.smoke] Chart.version=", Chart.version || "unknown");
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:absolute;left:-99999px;top:0;width:" + W + "px;height:" + H + "px;";
    document.body.appendChild(probe);
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    canvas.style.cssText = "display:block;width:" + W + "px;height:" + H + "px;";
    probe.appendChild(canvas);
    console.warn(
      "[Demographics.smoke] probe attached; probe.clientWidth=",
      probe.clientWidth,
      "probe.clientHeight=",
      probe.clientHeight,
      "canvas.width=",
      canvas.width,
      "canvas.height=",
      canvas.height
    );
    const ctx2d = canvas.getContext("2d");
    console.warn("[Demographics.smoke] getContext('2d') returned:", ctx2d ? "ok" : "NULL");
    if (!ctx2d) {
      document.body.removeChild(probe);
      return;
    }
    let chart;
    try {
      chart = new Chart(ctx2d, {
        type: "line",
        data: {
          labels: ["A", "B", "C"],
          datasets: [{ label: "smoke", data: [1, 2, 3], borderColor: "#f3c34c" }]
        },
        options: { responsive: false, maintainAspectRatio: false, animation: false }
      });
      console.warn(
        "[Demographics.smoke] new Chart() OK; chart.width=",
        chart.width,
        "chart.height=",
        chart.height
      );
    } catch (e) {
      console.error("[Demographics.smoke] new Chart() THREW:", e && e.message, e && e.stack);
    }
    // Cleanup
    try {
      if (chart && chart.destroy) chart.destroy();
    } catch (_) {}
    try {
      document.body.removeChild(probe);
    } catch (_) {}
    console.warn("[Demographics.smoke] done");
  } catch (e) {
    console.error("[Demographics.smoke] outer threw:", e && e.message, e && e.stack);
  }
}

export function renderChart(host, options) {
  if (!host) {
    console.error("[Demographics.chart] renderChart: host is required");
    return null;
  }
  teardownExistingChart(host);
  while (host.firstChild) host.removeChild(host.firstChild);

  const opts = options || {};
  let W = opts.width || 1400;
  let H = opts.height || 600;
  const metricId = opts.metric || "score";

  // Sizing strategy: don't trust the caller's W/H — those come from a rAF
  // measurement of chartHost BEFORE it has any content, and when an
  // upstream flex layout hasn't settled chartHost reports 0×0 and the
  // caller falls back to the static 1600×600. Instead we (1) append the
  // chart wrap with flex sizing so it claims the host's REAL available
  // space, then (2) read its post-layout BCR and use THAT for the canvas
  // bitmap. This way the chart always exactly fills its host — never
  // larger (no scrollbars), never smaller (no shrunken chart for switch-2+
  // metrics). Caller W/H still acts as a floor when measurement fails.

  if (typeof Chart === "undefined") {
    console.error("[Demographics.chart] Chart.js global missing — cannot render");
    return null;
  }
  applyEngineChartDefaults();

  // Hidden / focused civs.
  const hidden = (() => {
    const h = opts.hiddenCivs;
    const src = h instanceof Set ? Array.from(h) : Array.isArray(h) ? h : [];
    return new Set(src.map((v) => String(v)));
  })();
  const focused = (() => {
    const f = opts.focusedCivs;
    const src = f instanceof Set ? Array.from(f) : Array.isArray(f) ? f : [];
    return new Set(src.map((v) => String(v)));
  })();

  // Build series from history.
  const result = buildSeriesFromHistory(opts.history, metricId);
  let allSeries = result.series;
  const sampleCount = result.sampleCount;

  // ── showEliminatedCivs option ──────────────────────────────────────
  // Default true (eliminated civs visible). When the user disables it,
  // strip any series whose `eliminated` flag was set by
  // buildSeriesFromHistory off of `history.eliminated[pid]`. Eliminated
  // civs are still in the underlying sample data — we just hide their
  // lines so the rank order reflects living competition.
  try {
    const showElim = !!DemographicsSettings.getSetting("showEliminatedCivs", true);
    if (!showElim) {
      allSeries = allSeries.filter((s) => !s.eliminated);
    }
  } catch (_) {
    /* */
  }

  // ── smoothChart option ─────────────────────────────────────────────
  // 3-turn centered moving average. Applied per-series in-place; the
  // first and last point keep their raw values (insufficient neighbors
  // to average). Skipped for global metrics (already a single smooth
  // curve) and for series with fewer than 3 points.
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

  const metricMeta = (() => {
    try {
      return getMetric(metricId);
    } catch (_) {
      return null;
    }
  })();
  if (metricMeta && metricMeta.global && allSeries.length > 1) {
    const donor = allSeries.find((s) => s.points.length > 0) || allSeries[0];
    allSeries = [
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

  // Unmet name placeholder (Fix 4).
  let _showUnmet = false;
  try {
    _showUnmet = !!DemographicsSettings.getSetting("showUnmetNames", false);
  } catch (_) {}
  let _localPid;
  try {
    if (typeof GameContext !== "undefined" && GameContext != null) {
      if (typeof GameContext.localPlayerID === "number") _localPid = GameContext.localPlayerID;
      else if (typeof GameContext.localObserverID === "number")
        _localPid = GameContext.localObserverID;
    }
  } catch (_) {}
  if (!_showUnmet) {
    for (const s of allSeries) {
      const isLocal = _localPid !== undefined && s.pid === _localPid;
      if (!isLocal && s.met === false) s.name = "Unmet Civilization";
    }
  }

  // Time-range filter.
  const tr =
    opts.turnRange &&
    typeof opts.turnRange.min === "number" &&
    typeof opts.turnRange.max === "number"
      ? opts.turnRange
      : null;

  // Year + age aware x-axis labels.
  const turnYearMap = new Map();
  // x → { age, localTurn } so we can show age-relative labels (e.g.
  // "A12", "E1") instead of the abstract monotonic chart-X number.
  const turnAgeMap = new Map();
  const samps = opts.history && Array.isArray(opts.history.samples) ? opts.history.samples : [];
  const _renderBoundaries =
    opts.history && Array.isArray(opts.history.ageBoundaries) ? opts.history.ageBoundaries : [];
  const { offsets: _renderAgeOffsets } = computeAgeOffsets(samps, _renderBoundaries);
  for (const s of samps) {
    if (!s) continue;
    const x = sampleX(s, _renderAgeOffsets, _renderBoundaries);
    if (typeof x !== "number") continue;
    if (typeof s.gameYear === "string" && s.gameYear.length > 0) {
      turnYearMap.set(x, s.gameYear);
    }
    const inferredAge = inferSampleAge(s, _renderBoundaries);
    const inferredLT = inferLocalTurn(s, inferredAge, _renderBoundaries);
    if (typeof inferredLT === "number") {
      turnAgeMap.set(x, { age: inferredAge, localTurn: inferredLT });
    }
  }
  try {
    if (
      typeof Game !== "undefined" &&
      typeof Game.turn === "number" &&
      typeof Game.getTurnDate === "function"
    ) {
      const y = Game.getTurnDate();
      if (typeof y === "string" && y.length > 0) turnYearMap.set(Game.turn, y);
    }
  } catch (_) {}
  function nearestGameYear(turn) {
    if (turnYearMap.has(turn)) return turnYearMap.get(turn);
    let best = null,
      bestDist = Infinity;
    turnYearMap.forEach((y, t) => {
      const d = Math.abs(t - turn);
      if (d < bestDist) {
        bestDist = d;
        best = y;
      }
    });
    return best;
  }
  function nearestAge(turn) {
    if (turnAgeMap.has(turn)) return turnAgeMap.get(turn);
    let best = null,
      bestDist = Infinity;
    turnAgeMap.forEach((info, t) => {
      const d = Math.abs(t - turn);
      if (d < bestDist) {
        bestDist = d;
        best = info;
      }
    });
    return best;
  }
  const AGE_PREFIX = {
    AGE_ANTIQUITY: "A",
    AGE_EXPLORATION: "E",
    AGE_MODERN: "M"
  };
  function ageTurnLabel(t) {
    const info = nearestAge(t);
    if (!info) return "T-" + t;
    const pfx = AGE_PREFIX[info.age] || info.age.replace(/^AGE_/, "")[0] || "T";
    return pfx + info.localTurn;
  }
  const fmtX = (v) => {
    const t = Math.round(v);
    const y = nearestGameYear(t);
    const ageLbl = ageTurnLabel(t);
    if (_xAxisMode === "turn") return ageLbl;
    if (_xAxisMode === "year") return y || ageLbl;
    return y ? ageLbl + " / " + y : ageLbl;
  };
  const fmtY = (v) => {
    if (metricMeta && typeof metricMeta.format === "function") {
      try {
        const s = metricMeta.format(v);
        if (typeof s === "string") return s;
      } catch (_) {}
    }
    return String(v);
  };

  // Build Chart.js datasets.
  const datasets = allSeries.map((s) => {
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

  // Sizing strategy: every flex/BCR-based measurement strategy in this
  // file has been fragile in Coherent GameFace — the host either reads 0
  // (empty + unsettled layout) or balloons to the parent's full size
  // (over-eager walkup). Use viewport-relative sizing tuned to fit inside
  // the .demographics-frame (96vw × 94vh) MINUS the title bar, view tab
  // bar, page tab bar, toolbar and time-filter pills above the chart, and
  // padding below. Empirically those siblings total ~20-22% of viewport
  // height. Use 92vw and 62vh — fills the chart area without overflow.
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

  // ── Wonder-built event markers ─────────────────────────────────────
  // Walk samples to find every turn where a civ's `metrics.wonders` value
  // increased relative to the prior sample for the SAME civ. Each such
  // increase = one wonder completed by that civ on that turn. The plugin
  // below renders a tiny icon at (turn, value_on_current_metric) on the
  // civ's line, so wonder events float over whichever metric line you're
  // viewing. Setting-gated via `showWonderMarkers` (default ON).
  // wonderEventsByPid: pid → array of { turn, year, wonderType, wonderName, iconUrl }
  // Detected by diffing each civ's `wonderTypes` list between consecutive
  // samples — every type that appears for the first time = a wonder
  // completed on that turn. Falls back to plain count-increment events
  // (with the generic icon) if `wonderTypes` isn't present on the
  // sample (legacy data from before per-wonder identity capture).
  const wonderEventsByPid = new Map();
  try {
    let showWonders = true;
    // Wonder markers default OFF on the Crisis Stage chart — wonders
    // aren't related to crisis progression and crowd the markers that
    // matter (stage transitions). Toggle still respected if the user
    // explicitly turned it on.
    const wonderDefault = metricId === "crisis_stage" ? false : true;
    try {
      showWonders = !!DemographicsSettings.getSetting("showWonderMarkers", wonderDefault);
    } catch (_) {
      showWonders = wonderDefault;
    }
    if (showWonders && opts.history && Array.isArray(opts.history.samples)) {
      const seenTypesByPid = new Map(); // pid → Set of types seen so far
      const sampledPids = new Set(); // pids we've ever observed in any sample
      for (const s of opts.history.samples) {
        if (!s?.players) continue;
        for (const pid of Object.keys(s.players)) {
          const ps = s.players[pid];
          const types = Array.isArray(ps?.wonderTypes) ? ps.wonderTypes : null;
          // "First sample for this civ" must be based on whether
          // we've ever sampled THIS CIV at all — NOT on whether
          // we've ever seen a wonderTypes array for them. A civ
          // that starts the game wonderless and builds their
          // very first wonder mid-run otherwise gets its real
          // new-wonder event silently dropped (because `seen`
          // didn't exist yet, so it was treated as a "seed").
          const isFirstSample = !sampledPids.has(pid);
          sampledPids.add(pid);
          if (types && types.length > 0) {
            let seen = seenTypesByPid.get(pid);
            if (!seen) {
              seen = new Set();
              seenTypesByPid.set(pid, seen);
            }
            if (isFirstSample) {
              // Seed-only: these were pre-existing when the
              // sampler first observed this civ. Don't emit.
              for (const t of types) seen.add(t);
            } else {
              for (const t of types) {
                if (seen.has(t)) continue;
                seen.add(t);
                if (!wonderEventsByPid.has(pid)) wonderEventsByPid.set(pid, []);
                const wx = sampleX(s, _renderAgeOffsets, _renderBoundaries);
                wonderEventsByPid.get(pid).push({
                  turn: typeof wx === "number" ? wx : s.turn,
                  year: s.gameYear || "",
                  wonderType: t
                });
              }
            }
          }
        }
      }
    }
  } catch (_) {
    /* */
  }
  // Resolve display name + icon URL for each event using the engine's
  // canonical accessors. Cite: utilities-image.js:71-74
  //   Icon.getWonderIconFromDefinition() === UI.getIconURL(type, "WONDER")
  for (const [pid, events] of wonderEventsByPid) {
    const kept = [];
    for (const ev of events) {
      if (!ev.wonderType) continue;
      try {
        if (typeof UI !== "undefined" && typeof UI.getIconURL === "function") {
          ev.iconUrl = UI.getIconURL(ev.wonderType, "WONDER");
        }
      } catch (_) {
        /* */
      }
      // Only drop events where the engine returned NO icon URL at all.
      // We previously also dropped events whose URL matched the generic
      // "blp:ntf_wonder_completed" notification, but UI.getIconURL never
      // returns that URL for real wonders — filtering on it was just
      // suppressing real wonders whose specific BLPs the engine happens
      // to resolve to a similarly-named fallback.
      if (!ev.iconUrl) continue;
      try {
        const info =
          typeof GameInfo !== "undefined" &&
          GameInfo.Constructibles &&
          typeof GameInfo.Constructibles.lookup === "function"
            ? GameInfo.Constructibles.lookup(ev.wonderType)
            : null;
        if (info && info.Name && typeof Locale?.compose === "function") {
          ev.wonderName = Locale.compose(info.Name);
        } else if (info && info.Name) {
          ev.wonderName = info.Name;
        } else {
          ev.wonderName = ev.wonderType.replace(/^BUILDING_/, "").replace(/_/g, " ");
        }
        // Flavor / mechanical description. Civ7's Constructibles
        // table carries Description (short mechanical line) and
        // Tooltip (richer text); prefer the longer of the two
        // when both compose successfully. Both are localization
        // tags; resolve via Locale.compose.
        const candidates = [info?.Description, info?.Tooltip].filter(Boolean);
        let best = "";
        for (const tag of candidates) {
          let composed = tag;
          try {
            if (typeof Locale?.compose === "function") composed = Locale.compose(tag);
          } catch (_) {
            /* */
          }
          // Skip if compose returned the raw tag (no string in
          // the localization DB for the active language).
          if (composed && composed !== tag && composed.length > best.length) {
            best = composed;
          }
        }
        if (best) ev.wonderDescription = best;
      } catch (_) {
        ev.wonderName = ev.wonderType;
      }
      kept.push(ev);
    }
    if (kept.length === 0) wonderEventsByPid.delete(pid);
    else wonderEventsByPid.set(pid, kept);
  }
  // Pre-load the icon once per render. blp:ntf_wonder_completed is the
  // notification icon Civ7 itself uses for "wonder completed" — exact
  // semantic match. Falls through harmlessly if the asset doesn't load.
  dlog(
    "wonder events detected:",
    wonderEventsByPid.size,
    "civs;",
    Array.from(wonderEventsByPid.values()).reduce((n, arr) => n + arr.length, 0),
    "total wonder events"
  );
  // HTML-overlay marker plugin. Canvas drawImage of a BLP fails in
  // Coherent — `Image.naturalWidth` stays undefined for BLP sources
  // even after onload fires, so we couldn't reliably draw onto the
  // canvas. Engine UIs render BLP icons as CSS background-image on
  // <div> elements; we mimic that pattern by managing absolute-
  // positioned divs over the chart's parent wrap. The wrap already
  // has position:relative (set at chart creation below).
  // DIFFERENTIAL marker update — the prior implementation wiped + rebuilt
  // every marker on each `afterDatasetsDraw` call, but Chart.js fires that
  // hook on EVERY mouse-move while the cursor is over the canvas (for the
  // line tooltip). Tearing down a marker the cursor was over caused the
  // mouseover to flicker, and the whole row of markers visibly blinked.
  // We now maintain a Map of (eventKey → DOM element) keyed by pid:turn,
  // and only create/update/remove the DELTA on each call.
  const wonderMarkerEls = new Map(); // key: "pid:turn" → div element
  // Singleton custom hover tooltip — Coherent's renderer ignores native
  // HTML `title` attributes, so `mk.title = ...` produced a help-cursor
  // with no popup. We mount one tip per chart wrap and show/hide on
  // marker mouseenter/leave. Positioning is anchored to the icon (not
  // the cursor) so the tip doesn't jitter or duck under the pointer,
  // and is placed above the icon by default with a flip-below fallback
  // when there isn't enough headroom.
  let wonderTip = null;
  function ensureWonderTip(wrap) {
    if (wonderTip && wonderTip.isConnected) return wonderTip;
    wonderTip = document.createElement("div");
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
    return wonderTip;
  }
  function showWonderTip(wrap, ev, civLabel, iconLeft, iconTop, iconSize) {
    const tip = ensureWonderTip(wrap);
    const yearStr = ev.year ? " \u00B7 " + ev.year : "";
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
    positionWonderTip(iconLeft, iconTop, iconSize);
  }
  function positionWonderTip(iconLeft, iconTop, iconSize) {
    if (!wonderTip) return;
    const wrap = wonderTip.parentNode;
    const GAP_X = 18,
      GAP_Y = 8;
    // Measure after the tip is visible so offsetWidth/Height are real.
    const tipW = wonderTip.offsetWidth;
    const tipH = wonderTip.offsetHeight;
    // Default: place above and to the right of the icon, so the cursor never overlaps the tip.
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
    wonderTip.style.left = left + "px";
    wonderTip.style.top = top + "px";
    // Add a small arrow to visually connect the tip to the icon.
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
  function hideWonderTip() {
    if (wonderTip) wonderTip.style.display = "none";
  }
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  const wonderMarkersPlugin = {
    id: "demographicsWonderMarkers",
    afterDatasetsDraw(c) {
      const wrap = c.canvas.parentNode;
      if (!wrap) return;
      const xScale = c.scales.x;
      const yScale = c.scales.y;
      if (!xScale || !yScale) return;
      const datasets = c.data.datasets || [];
      const ICON_SIZE = 28;
      const offX = c.canvas.offsetLeft,
        offY = c.canvas.offsetTop;
      // Track which keys we render this pass; anything in the map but
      // not in this set at the end gets removed.
      const renderedKeys = new Set();
      for (let di = 0; di < datasets.length; di++) {
        const ds = datasets[di];
        if (!ds || ds.hidden) continue;
        const series = allSeries.find((s) => s.leaderType === ds.leaderType);
        const pid = series?.pid;
        if (typeof pid !== "number") continue;
        const events = wonderEventsByPid.get(String(pid)) || wonderEventsByPid.get(pid);
        if (!events || events.length === 0) continue;
        for (const ev of events) {
          if (ev.turn < xScale.min || ev.turn > xScale.max) continue;
          let dp = ds.data.find((p) => p && p.x === ev.turn);
          if (!dp) {
            let bestDist = 3;
            for (const p of ds.data) {
              if (!p) continue;
              const d = Math.abs(p.x - ev.turn);
              if (d < bestDist) {
                bestDist = d;
                dp = p;
              }
            }
          }
          if (!dp) continue;
          const x = xScale.getPixelForValue(ev.turn);
          const y = yScale.getPixelForValue(dp.y);
          const leftPx = offX + x - ICON_SIZE / 2;
          const topPx = offY + y - ICON_SIZE / 2;
          const key = pid + ":" + ev.turn;
          renderedKeys.add(key);
          let mk = wonderMarkerEls.get(key);
          if (mk && !mk.isConnected) {
            // DOM was wiped by something external (panel reattach);
            // drop our reference and recreate below.
            wonderMarkerEls.delete(key);
            mk = null;
          }
          if (!mk) {
            mk = document.createElement("div");
            mk.className = "demographics-wonder-marker";
            // Only real per-wonder icons reach this code path —
            // events without a specific icon are pre-filtered
            // upstream, so no generic fallback is stacked.
            mk.style.cssText = [
              "position:absolute",
              "width:" + ICON_SIZE + "px",
              "height:" + ICON_SIZE + "px",
              "background-image:url('" + ev.iconUrl + "')",
              "background-size:contain",
              "background-repeat:no-repeat",
              "background-position:center",
              "pointer-events:auto",
              "z-index:6",
              "filter:drop-shadow(0 0 3px rgba(0,0,0,0.9))",
              "cursor:pointer"
            ].join(";");
            const civLabel = ds.label || "Unknown";
            // Custom hover tooltip — native `title` doesn't
            // render in Coherent. Anchor the tip to the icon's
            // current position (not the cursor) so it sits in
            // a predictable spot and doesn't jitter. Read the
            // icon's offset at hover time, because the marker
            // may have been repositioned since this listener
            // was attached (pan, resize, filter change).
            mk.addEventListener("mouseenter", () => {
              showWonderTip(wrap, ev, civLabel, mk.offsetLeft, mk.offsetTop, ICON_SIZE);
            });
            mk.addEventListener("mouseleave", hideWonderTip);
            wrap.appendChild(mk);
            wonderMarkerEls.set(key, mk);
          }
          // Update position only — don't rewrite the entire style
          // string, which would invalidate the browser's hover state
          // and cause the blink the user saw.
          if (mk.style.left !== leftPx + "px") mk.style.left = leftPx + "px";
          if (mk.style.top !== topPx + "px") mk.style.top = topPx + "px";
        }
      }
      // Garbage-collect any markers that no longer correspond to a
      // visible event (e.g. dataset hidden by user click, or scale
      // panned to exclude the turn).
      for (const [key, el] of wonderMarkerEls) {
        if (!renderedKeys.has(key)) {
          try {
            el.remove();
          } catch (_) {}
          wonderMarkerEls.delete(key);
        }
      }
    }
  };

  // ── Crisis stage transition markers ─────────────────────────────────
  // Walk the history once to find every turn where the GAME-WIDE crisis
  // stage advanced. Stages come from ctx.crisisStage (engine values
  // -1 / 0 / 1 / 2 / 3 → display stages Pre / 1 / 2 / 3 / 4-Ends). We
  // mark each transition with a labeled vertical line so all the line
  // charts (not just the Crisis tab) show when the world crisis kicked
  // in. Suppress on the crisis_stage tab itself — the line IS the data.
  // Crisis names — historian-style naming. Pools are heavy on hand-written
  // literals (the way periods actually get coined in textbooks: by place,
  // by people, by effect, by era) plus a small number of templates that
  // only take {place} / {regional} / {color}. We don't generate adjectives
  // like "Whispering" or "Hollow" — they read like fantasy chapter titles
  // rather than historical periods. Pool keys are the AgeCrisisEventTypes
  // declared in age-{antiquity,exploration}/data/crisis-stages.xml.
  //
  // Civ7 only triggers narrative crises in the Antiquity and Exploration
  // ages — the Modern age has no AgeCrisis pipeline (see
  // model-government.js:147 which hides the crisis tab on AGE_MODERN). So
  // we don't include MODERN here; MODERN markers should never fire anyway,
  // but if one slips through we fall back to a neutral name.
  // Each entry is { names: [...], arcs: [[s1,s2,s3,s4], ...] }. `names`
  // is the single-pick pool (the chosen name stays the same across all
  // four crisis stages, like "The Bronze Age Collapse"). `arcs` is the
  // multi-stage progression pool — when an arc is chosen for the game,
  // each stage of the crisis surfaces a different beat of the same
  // story, e.g. raids → wars → sack → migration. The arc decision is
  // seeded so the same game always reads consistently.
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
        [
          "The Pretenders' War",
          "The Civil Wars",
          "The Age of Usurpers",
          "The Collapse of Authority"
        ],
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
        [
          "The Plague of the Coast",
          "The Great Pestilence",
          "The Great Dying",
          "The Years of Ashes"
        ],
        ["The Sweating Sickness", "The Wasting Plague", "The Time of Pestilence", "The Dying Time"]
      ]
    }
  };
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

  function _hashString(s) {
    let h = 2166136261 >>> 0; // FNV-1a-ish
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
  function _pick(arr, seed) {
    return arr[seed % arr.length];
  }
  function _getGameSeed() {
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
  const _gameSeedStr = _getGameSeed();

  function flavorCrisisName(sample, stage) {
    const t = sample && sample.crisisEventType;
    const entry = (t && CRISIS_NAME_TEMPLATES[t]) ||
      CRISIS_FALLBACK_BY_AGE[sample && sample.age] || { names: ["The Crisis"], arcs: [] };
    // Backward-compat: tolerate the legacy flat-array shape.
    const names = Array.isArray(entry) ? entry : entry.names || ["The Crisis"];
    const arcs = Array.isArray(entry) ? [] : entry.arcs || [];

    const seedKey = (t || (sample && sample.age) || "crisis") + "|" + _gameSeedStr;
    const seed = _hashString(seedKey);

    // Arc vs single-name decision — seeded so each game commits to one
    // mode for the run. ~35% chance of an arc when arcs exist; otherwise
    // pick from the single-name pool. Single-name is the default so the
    // marker reads as one stable event across all four stages most of
    // the time.
    const useArc = arcs.length > 0 && _hashString(seedKey + "|arc-choice") % 100 < 35;
    if (useArc) {
      const arc = arcs[seed % arcs.length];
      const idx = Math.max(0, Math.min(arc.length - 1, (stage | 0 || 1) - 1));
      return arc[idx];
    }

    const template = _pick(names, seed);
    return template
      .replace(/\{color\}/g, _pick(CRISIS_COLORS, _hashString(seedKey + "|color")))
      .replace(/\{place\}/g, _pick(CRISIS_PLACES, _hashString(seedKey + "|place")))
      .replace(/\{regional\}/g, _pick(CRISIS_REGIONAL, _hashString(seedKey + "|regional")));
  }

  const crisisMarkers = [];
  if (
    metricId !== "crisis_stage" &&
    opts.history &&
    Array.isArray(opts.history.samples) &&
    opts.history.samples.length > 0
  ) {
    const STAGE_LABELS = [
      "Crisis Begins",
      "Crisis Intensifies",
      "Crisis Culminates",
      "Crisis Ends"
    ];
    const STAGE_COLORS = ["#e69a3c", "#e57c1a", "#d54a2b", "#9a2a2a"];
    let prev = -2; // sentinel different from -1 so first sample is "init"
    for (const s of opts.history.samples) {
      // crisis_stage was stored on EVERY player's metrics by the
      // sampler (it's a global value). Read from any one player.
      const players = s?.players;
      if (!players) continue;
      const pidKeys = Object.keys(players);
      if (pidKeys.length === 0) continue;
      const m = players[pidKeys[0]]?.metrics;
      const raw = m && typeof m.crisis_stage === "number" ? m.crisis_stage : undefined;
      if (raw === undefined) continue;
      // raw is the DISPLAY value (engine+1 from the accessor): 0..4.
      // A transition from 0/lower → ≥1 is a stage onset.
      if (raw > prev && raw >= 1 && prev >= 0) {
        const stageIdx = Math.min(STAGE_LABELS.length - 1, raw - 1);
        const cx = sampleX(s, _renderAgeOffsets, _renderBoundaries);
        crisisMarkers.push({
          turn: typeof cx === "number" ? cx : s.turn,
          stage: raw,
          label: STAGE_LABELS[stageIdx],
          color: STAGE_COLORS[stageIdx],
          year: s.gameYear || "",
          crisisName: flavorCrisisName(s, raw)
        });
      }
      if (raw >= 0) prev = raw;
      else if (prev === -2) prev = raw; // first sample seed
    }
  }
  // Subtle focus glow — draws each focused line a second time, slightly
  // wider and very translucent, BEHIND the real strokes. The combined
  // effect reads as "this line glows faintly," nothing dramatic. Pulled
  // out as its own plugin so the rest of the chart code stays clean.
  const focusGlowPlugin = {
    id: "demographicsFocusGlow",
    beforeDatasetsDraw(c) {
      const ctx2 = c.ctx;
      const meta = c.data && c.data.datasets;
      if (!meta) return;
      for (let i = 0; i < meta.length; i++) {
        const ds = meta[i];
        if (!ds || !ds._focused || ds.hidden) continue;
        const dsMeta = c.getDatasetMeta(i);
        if (!dsMeta || dsMeta.hidden) continue;
        const elems = dsMeta.data;
        if (!elems || elems.length < 2) continue;
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
    }
  };

  // Hover crosshair plugin — a thin yellow vertical line that tracks the
  // cursor's nearest-x position so the reader can correlate every civ's
  // value at the hovered turn at a glance. Style mirrors the red dashed
  // crisis markers (same dash, same width) but in cream-gold so it reads
  // as "cursor follower" rather than "event marker."
  const hoverCrosshairPlugin = {
    id: "demographicsHoverCrosshair",
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

  // Custom Chart.js plugin: draws vertical lines + labels at each crisis
  // marker turn AFTER the datasets render so they sit on top of the lines.
  // Uses chart.scales.x to convert turn → pixel position, so it respects
  // the active time-range filter automatically (markers outside range get
  // skipped via the scale's min/max).
  const crisisMarkerPlugin = {
    id: "demographicsCrisisMarkers",
    afterDatasetsDraw(c) {
      if (!crisisMarkers || crisisMarkers.length === 0) return;
      const xScale = c.scales.x;
      if (!xScale) return;
      const ctx2 = c.ctx;
      const { top, bottom } = c.chartArea;
      for (const mk of crisisMarkers) {
        if (mk.turn < xScale.min || mk.turn > xScale.max) continue;
        const x = xScale.getPixelForValue(mk.turn);
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
        // Two-line label: stage on top (in the marker's color), the
        // formal crisis name below in cream. A single background pill
        // sized to the wider of the two lines holds both.
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
    }
  };

  // Cap-limit line plugin — bold red horizontal line at y=100 on the
  // Settlement Cap Utilization chart. 100% is the hard cap (over it incurs
  // happiness/yield penalties), so it deserves a clear, unmissable rule
  // rather than being just another gridline value. No-op on every other
  // metric.
  const capLimitLinePlugin = {
    id: "demographicsCapLimitLine",
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

  // Age-boundary marker plugin — vertical purple lines + labels at every
  // Antiquity→Exploration, Exploration→Modern transition. Same visual
  // language as the crisis markers but in purple so the two read as
  // distinct event classes at a glance. Source data: history.ageBoundaries
  // (populated by the sampler at PlayerAgeTransitionComplete).
  const ageMarkers = [];
  if (opts.history && Array.isArray(opts.history.ageBoundaries)) {
    const AGE_NAMES = {
      AGE_ANTIQUITY: "Antiquity Begins",
      AGE_EXPLORATION: "Exploration Begins",
      AGE_MODERN: "Modern Begins"
    };
    for (const b of opts.history.ageBoundaries) {
      if (!b || typeof b.age !== "string") continue;
      // The boundary marker should sit at the LEFTMOST X of the new
      // age. From the deterministic offset table that's simply the
      // age's offset + 1 (the new age's first localTurn is 1).
      const baseOffset = _renderAgeOffsets.get(b.age);
      if (typeof baseOffset !== "number") continue;
      ageMarkers.push({
        turn: baseOffset + 1,
        label: AGE_NAMES[b.age] || b.age.replace(/^AGE_/, "") + " Begins",
        color: "#b78cff" // soft purple
      });
    }
  }
  const ageMarkerPlugin = {
    id: "demographicsAgeMarkers",
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
        // Long-dash pattern (different from crisis [4,3]) so the two
        // marker types are distinguishable beyond color alone.
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

  const wrap = document.createElement("div");
  wrap.className = "demographics-chartjs-wrap";
  wrap.style.cssText =
    "position:relative;width:" + renderW + "px;height:" + renderH + "px;flex:0 0 auto;";
  const canvas = document.createElement("canvas");
  canvas.width = renderW;
  canvas.height = renderH;
  canvas.style.cssText = "display:block;width:" + renderW + "px;height:" + renderH + "px;";
  wrap.appendChild(canvas);
  host.appendChild(wrap);
  W = renderW;
  H = renderH;

  let chart;
  try {
    const ctx2d = canvas.getContext("2d");
    chart = new Chart(ctx2d, {
      type: "line",
      data: { datasets },
      plugins: [
        focusGlowPlugin,
        wonderMarkersPlugin,
        hoverCrosshairPlugin,
        crisisMarkerPlugin,
        ageMarkerPlugin,
        capLimitLinePlugin
      ],
      options: {
        responsive: false,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        normalized: true,
        interaction: { mode: "nearest", intersect: false, axis: "x" },
        plugins: {
          legend: {
            position: "right",
            labels: {
              color: "#E5E5E5",
              usePointStyle: true,
              boxWidth: 12,
              // Bumped from 8 → 14 for a touch more breathing
              // room between each civ legend entry.
              padding: 14,
              font: { family: Chart.defaults.font.family, size: 14 }
            },
            onClick: (_e, item, legend) => {
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
            }
          },
          tooltip: {
            // Disable Chart.js's canvas-painted tooltip and use
            // an HTML overlay styled with the engine's own
            // `img-tooltip-border` + `img-tooltip-bg` classes —
            // border-image from blp:base_tooltip-bg, the same
            // dark gradient native tooltips use. Each row gets
            // a small leader icon next to the civ label.
            enabled: false,
            external: function (context) {
              const { chart, tooltip } = context;
              const wrap = chart.canvas.parentNode;
              let tip = wrap.querySelector(".demographics-chart-tooltip");
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
              if (tooltip.opacity === 0) {
                tip.style.opacity = "0";
                return;
              }
              // Header: turn / year (yellow).
              const titleText =
                tooltip.dataPoints && tooltip.dataPoints.length
                  ? fmtX(tooltip.dataPoints[0].parsed.x)
                  : "";
              // Body: one row per civ, with leader icon + name + value.
              // Sort tooltip rows to match chart/legend line order.
              let dataPoints = tooltip.dataPoints ? tooltip.dataPoints.slice() : [];
              if (dataPoints.length && chart.data && chart.data.datasets) {
                const dsOrder = chart.data.datasets.map((ds) => ds.label);
                dataPoints.sort((a, b) => {
                  const ai = dsOrder.indexOf(a.dataset.label);
                  const bi = dsOrder.indexOf(b.dataset.label);
                  return ai - bi;
                });
              }
              const rows = [];
              for (const dp of dataPoints) {
                const ds = dp.dataset;
                const rawColor = typeof ds.borderColor === "string" ? ds.borderColor : "#e5d2ac";
                // Lift dark civ colors (dark blue/purple) so
                // the value column and the leader-dot stay
                // readable on the dark tooltip background.
                const color = tooltipSafeTextColor(rawColor);
                const label = ds.label || "";
                const valStr = fmtY(dp.parsed.y);
                // Resolve leader icon URL once per dataset
                // and cache on the dataset for reuse.
                if (!ds._leaderIconHTML) {
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
                }
                rows.push(
                  '<div style="display:flex;align-items:center;gap:0.45rem;padding:0.12rem 0;">' +
                    ds._leaderIconHTML +
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
              tip.innerHTML =
                '<div style="font-family:TitleFont, BodyFont, sans-serif;' +
                "font-weight:700;text-transform:uppercase;letter-spacing:0.08em;" +
                "color:#f3c34c;font-size:0.85rem;" +
                "border-bottom:1px solid rgba(168,132,90,0.5);" +
                'padding-bottom:0.25rem;margin-bottom:0.3rem;">' +
                titleText +
                "</div>" +
                rows.join("");
              // Position next to the cursor. Chart.js gives
              // caretX/Y in canvas pixels — relative to the
              // parent wrap that contains both canvas+tooltip.
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
          },
          title: {
            display: !!(metricMeta && (metricMeta.title || metricMeta.label)),
            text: metricMeta ? metricMeta.title || metricMeta.label || metricId : metricId,
            color: "#f3c34c",
            font: { family: Chart.defaults.font.family, size: 18, weight: "600" },
            padding: { top: 4, bottom: 12 }
          }
        },
        scales: {
          x: {
            type: "linear",
            ticks: {
              color: "#E5E5E5",
              font: { family: Chart.defaults.font.family, size: 15 },
              maxRotation: 0,
              autoSkipPadding: 30,
              callback: (v) => fmtX(v)
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
              // For metrics flagged `integerOnly`, blank out
              // fractional tick labels so e.g. Crisis Stage
              // doesn't repeat "Stage 1 (Begins)" at 1, 1.5,
              // and 2 all rounding to the same integer.
              // Chart.js still draws gridlines at fractional
              // positions; only the labels are suppressed.
              callback: (v) => {
                if (metricMeta && metricMeta.integerOnly && Math.round(v) !== v) return "";
                return fmtY(v);
              },
              // Force integer step + zero decimals when the
              // metric is integer-only AND its expected range
              // is small (so we don't constrain large-range
              // metrics like Score with stepSize=1).
              ...(metricMeta && metricMeta.integerOnly ? { stepSize: 1, precision: 0 } : {})
            },
            grid: { color: "rgba(133, 135, 140, 0.25)" },
            border: { color: "#85878C" }
          }
        }
      }
    });
    host._demographicsChart = chart;
    const visibleCount = datasets.filter((d) => !d.hidden).length;
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
  } catch (e) {
    console.error("[Demographics.chart] Chart.js new Chart threw:", e && e.message, e && e.stack);
    const msg = document.createElement("div");
    msg.className = "demographics-empty font-body text-base";
    msg.textContent = "Chart failed to render — see UI.log.";
    host.appendChild(msg);
    return null;
  }

  return { canvas, chart, series: allSeries };
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

export function renderLegacyRadar(host, options) {
  if (!host) return null;
  while (host.firstChild) host.removeChild(host.firstChild);
  const opts = options || {};
  const W = opts.width || 1400;
  const H = opts.height || 600;

  const hidden = (() => {
    const h = opts.hiddenCivs;
    const src = h instanceof Set ? Array.from(h) : Array.isArray(h) ? h : [];
    return new Set(src.map((v) => String(v)));
  })();

  const samples = opts.history && Array.isArray(opts.history.samples) ? opts.history.samples : [];
  if (samples.length === 0) {
    const msg = document.createElement("div");
    msg.className = "demographics-empty font-body text-base";
    msg.textContent = "No samples yet — play a turn and reopen.";
    host.appendChild(msg);
    return null;
  }
  // Sources for the radar:
  //   "current" — running max across the latest samples (in-progress age).
  //   "AGE_ANTIQUITY" / "AGE_EXPLORATION" — frozen per-age snapshots
  //   captured at age transitions in demographics-sampler.js.
  const snapshots =
    opts.history && opts.history.legacySnapshots && typeof opts.history.legacySnapshots === "object"
      ? opts.history.legacySnapshots
      : {};
  const ageSource = typeof opts.ageSource === "string" ? opts.ageSource : "current";

  const AXIS_KEYS = [
    "triumphs_militaristic",
    "triumphs_economic",
    "triumphs_diplomatic",
    "triumphs_cultural",
    "triumphs_scientific",
    "triumphs_expansionist"
  ];
  function emptyValues() {
    const v = {};
    for (const k of AXIS_KEYS) v[k] = 0;
    return v;
  }
  function loadCivsFromSnapshot(snap) {
    const out = new Map();
    let idx = 0;
    for (const pid of Object.keys(snap)) {
      const row = snap[pid];
      const values = emptyValues();
      for (const k of AXIS_KEYS) {
        if (typeof row[k] === "number" && isFinite(row[k])) values[k] = row[k];
      }
      out.set(pid, {
        pid,
        leaderType: String(row.leaderType ?? "pid:" + pid),
        name: row.leaderName
          ? row.civName
            ? row.leaderName + " (" + row.civName + ")"
            : row.leaderName
          : "Player " + pid,
        color: PALETTE[idx++ % PALETTE.length],
        values
      });
    }
    return out;
  }

  let civs;
  let pidOrder = [];
  if (ageSource !== "current" && snapshots[ageSource]) {
    civs = loadCivsFromSnapshot(snapshots[ageSource]);
    pidOrder = Array.from(civs.keys());
  } else {
    civs = new Map();
    // Walk samples for names + colors and as a fallback data source.
    samples.forEach((s) => {
      if (!s || !s.players) return;
      for (const pid of Object.keys(s.players)) {
        const ps = s.players[pid];
        const m = ps?.metrics || {};
        let civ = civs.get(pid);
        if (!civ) {
          civ = {
            pid,
            leaderType: String(ps.leaderType ?? "pid:" + pid),
            name: ps.leaderName
              ? ps.civName
                ? ps.leaderName + " (" + ps.civName + ")"
                : ps.leaderName
              : "Player " + pid,
            color:
              typeof ps.primaryColor === "string" && ps.primaryColor.length > 0
                ? ps.primaryColor
                : PALETTE[pidOrder.length % PALETTE.length],
            values: emptyValues()
          };
          civs.set(pid, civ);
          pidOrder.push(pid);
        }
        // Take the MAX — triumph counts are non-decreasing per age.
        for (const k of AXIS_KEYS) {
          if (typeof m[k] === "number" && isFinite(m[k]) && m[k] > civ.values[k]) {
            civ.values[k] = m[k];
          }
        }
      }
    });
    // LIVE pull via player.Legacies (Test of Time). Iterate
    // GameInfo.Legacies and tally triggered triumphs by LegacySubtype
    // for each alive major. Overrides sample values when higher.
    try {
      if (
        typeof GameInfo !== "undefined" &&
        GameInfo.Legacies &&
        typeof Players?.getAliveMajorIds === "function"
      ) {
        const SUBTYPE_TO_AXIS = {
          LEGACY_CULTURAL: "triumphs_cultural",
          LEGACY_DIPLOMATIC: "triumphs_diplomatic",
          LEGACY_ECONOMIC: "triumphs_economic",
          LEGACY_SCIENTIFIC: "triumphs_scientific",
          LEGACY_MILITARISTIC: "triumphs_militaristic",
          LEGACY_EXPANSIONIST: "triumphs_expansionist"
        };
        for (const pid of Players.getAliveMajorIds()) {
          const pl = typeof Players?.get === "function" ? Players.get(pid)?.Legacies : null;
          if (!pl) continue;
          const counts = emptyValues();
          try {
            for (const row of GameInfo.Legacies) {
              if (!row || !row.LegacyType) continue;
              const axis = SUBTYPE_TO_AXIS[row.LegacySubtype];
              if (!axis) continue;
              let triggered = false;
              try {
                triggered = !!pl.isTriggered?.(row.LegacyType);
              } catch (_) {}
              if (triggered) counts[axis]++;
            }
          } catch (_) {}
          // Ensure civ exists (alive majors may not have samples yet
          // if the storage was reset).
          const pidStr = String(pid);
          let civ = civs.get(pidStr);
          if (!civ) {
            civ = {
              pid: pidStr,
              leaderType: "pid:" + pidStr,
              name: "Player " + pidStr,
              color: PALETTE[pidOrder.length % PALETTE.length],
              values: emptyValues()
            };
            civs.set(pidStr, civ);
            pidOrder.push(pidStr);
          }
          for (const k of AXIS_KEYS) {
            if (counts[k] > civ.values[k]) civ.values[k] = counts[k];
          }
        }
      }
    } catch (_) {}
  } // close: else (current-age path)
  // Determine scaling: the highest value across all civs and axes.
  let scaleMax = 0;
  civs.forEach((c) => {
    for (const k of Object.keys(c.values)) {
      if (c.values[k] > scaleMax) scaleMax = c.values[k];
    }
  });
  if (scaleMax <= 0) scaleMax = 1;

  const cx = W / 2;
  const cy = H / 2 + 10; // slight nudge down to leave room for title
  const R = Math.min(W, H) * 0.42; // radius

  const svg = svgEl("svg", {
    xmlns: SVG_NS,
    viewBox: `0 0 ${W} ${H}`,
    width: String(W),
    height: String(H),
    preserveAspectRatio: "xMidYMid meet",
    class: "demographics-chart-svg",
    "aria-label": "Legacy Path radar"
  });

  // Inner "pedestal" ring. NOT a triumph-count ring — it's a small base
  // radius the polygon falls back to on non-populated axes when a civ has
  // 1 or 2 triumphs, so a single triumph reads as a pointed diamond
  // instead of a thin spoke + dot. Counted neither in axis labels nor in
  // the ring-label sequence below. Drawn with a slightly heavier stroke
  // so a reader can visually distinguish it from the count rings.
  const INNER_R = R * 0.1;
  svg.appendChild(
    svgEl("polygon", {
      points: LEGACY_AXES.map(
        (a) => cx + Math.cos(a.angle) * INNER_R + "," + (cy + Math.sin(a.angle) * INNER_R)
      ).join(" "),
      fill: "none",
      stroke: "rgba(201, 162, 76, 0.55)",
      "stroke-width": "1.6"
    })
  );

  // Background concentric guide rings — one per integer triumph count up
  // to the actual scaleMax (capped at 10 so a high-progress game doesn't
  // draw fifty rings). Previously we always drew exactly 4 rings, which
  // visually implied "max = 4" even when the highest count on any axis
  // was 2 — and meant the 4-ring grid only happened to line up with
  // integer counts in the special case where scaleMax was 4.
  // Ring count tracks the actual max triumph count on any axis — no
  // hard cap. Earlier we clamped at 10 to avoid drawing fifty rings on
  // pathological games, but that meant a civ at 12 triumphs visually
  // sat on the same ring as a civ at 10. We now always draw one ring
  // per integer up to scaleMax, and just thin the stroke once we cross
  // ~12 rings so the chart stays legible at high counts.
  const maxRings = Math.max(1, Math.ceil(scaleMax));
  const ringStrokeW = maxRings <= 12 ? 1 : maxRings <= 20 ? 0.8 : 0.6;
  for (let i = 1; i <= maxRings; i++) {
    const r = (R * i) / maxRings;
    const pts = LEGACY_AXES.map((a) => {
      return cx + Math.cos(a.angle) * r + "," + (cy + Math.sin(a.angle) * r);
    }).join(" ");
    svg.appendChild(
      svgEl("polygon", {
        points: pts,
        fill: "none",
        stroke: "rgba(201, 162, 76, 0.25)",
        "stroke-width": String(ringStrokeW)
      })
    );
    // Numeric label on the ring (top spoke) so the reader can read the
    // count directly. Placed just inside the ring on the militaristic
    // (top) axis where it's clear of most polygons.
    const topAxis = LEGACY_AXES[0]; // militaristic — angle -π/2
    const labelX = cx + Math.cos(topAxis.angle) * r + 8;
    const labelY = cy + Math.sin(topAxis.angle) * r + 4;
    const ringLabel = svgEl("text", {
      x: labelX,
      y: labelY,
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
  // Axis spokes + axis labels.
  LEGACY_AXES.forEach((a) => {
    const ex = cx + Math.cos(a.angle) * R;
    const ey = cy + Math.sin(a.angle) * R;
    svg.appendChild(
      svgEl("line", {
        x1: cx,
        y1: cy,
        x2: ex,
        y2: ey,
        stroke: "rgba(201, 162, 76, 0.45)",
        "stroke-width": "1"
      })
    );
    const lx = cx + Math.cos(a.angle) * (R + 22);
    const ly = cy + Math.sin(a.angle) * (R + 22);
    const lbl = svgEl("text", {
      x: lx,
      y: ly,
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

  // One polygon per visible civ. Draw in TWO passes so darker fills don't
  // bury lighter ones — pass 1 = fills (back-to-front by total area, biggest
  // shapes drawn first), pass 2 = outlines + vertex dots on top.
  const visibleCivs = [];
  const polys = []; // { c, points: [{x,y}], area, color }
  civs.forEach((c) => {
    if (hidden.has(c.leaderType)) return;
    // Per-axis vertex positions for spokes + vertex dots.
    const points = LEGACY_AXES.map((a) => {
      const v = c.values[a.id] || 0;
      const r = (v / scaleMax) * R;
      return { x: cx + Math.cos(a.angle) * r, y: cy + Math.sin(a.angle) * r, v };
    });
    // Populated-only polygon: connect ONLY the axes where the civ has
    // value > 0, in angular order around the circle. Skipping zero axes
    // means the shaded region runs DIRECTLY between adjacent populated
    // axes instead of dipping back through the center — which is what
    // the previous inner-ring inflation was forcing.
    //
    // Special cases:
    //   0 populated axes → nothing to draw (skipped).
    //   1 populated axis → polygon is a single point; we render only a
    //     dot + spoke, no polygon.
    //   2 populated axes → degenerate line; close into a thin triangle
    //     by adding the center as a third vertex so there's visible area.
    //   3+ populated axes → simple convex/concave polygon of populated
    //     points, naturally filled.
    const populated = points.map((pt, i) => ({ ...pt, i })).filter((pt) => pt.v > 0);
    // Build the polygon vertex list:
    //   0 populated → nothing (no shape).
    //   1 or 2 populated → use the inner pedestal as the base on
    //     non-populated axes so the silhouette spikes outward to the
    //     populated vertex/vertices, producing the small targeted
    //     diamond shape the user asked for. Without this, a single-
    //     triumph civ only had a spoke + dot.
    //   3+ populated → connect ONLY the populated vertices in angular
    //     order (existing behavior — produces a natural polygon area).
    let polyPts;
    if (populated.length === 0) {
      polyPts = [];
    } else if (populated.length <= 2) {
      polyPts = LEGACY_AXES.map((a, i) => {
        const pt = points[i];
        if (pt.v > 0) return pt;
        return {
          x: cx + Math.cos(a.angle) * INNER_R,
          y: cy + Math.sin(a.angle) * INNER_R,
          v: 0,
          i
        };
      });
    } else {
      polyPts = populated;
    }
    // Shoelace area on the polygon we'll actually draw — sort larger
    // shapes behind smaller ones so every civ's silhouette stays
    // visible regardless of overlap.
    let area = 0;
    if (polyPts.length >= 3) {
      for (let i = 0; i < polyPts.length; i++) {
        const j = (i + 1) % polyPts.length;
        area += polyPts[i].x * polyPts[j].y - polyPts[j].x * polyPts[i].y;
      }
      area = Math.abs(area) / 2;
    }
    polys.push({ c, points, polyPts, area, color: c.color });
    visibleCivs.push(c);
  });
  polys.sort((a, b) => b.area - a.area); // largest first → drawn behind

  // Pass 1 — translucent FILLS of the populated-axis polygon. Draws
  // directly between populated vertices so the shaded area runs between
  // them, not back through the center.
  for (const p of polys) {
    if (!p.polyPts || p.polyPts.length < 3) continue;
    const pts = p.polyPts.map((pt) => pt.x + "," + pt.y).join(" ");
    svg.appendChild(
      svgEl("polygon", {
        points: pts,
        fill: p.color,
        "fill-opacity": "0.35",
        stroke: "none"
      })
    );
  }
  // Pass 2 — spokes (radial lines from center to each populated vertex)
  // so the chart also "draws lines between each of the points and the
  // center" per the standard radar look.
  for (const p of polys) {
    LEGACY_AXES.forEach((a, idx) => {
      const v = p.c.values[a.id] || 0;
      if (v <= 0) return;
      svg.appendChild(
        svgEl("line", {
          x1: cx,
          y1: cy,
          x2: p.points[idx].x,
          y2: p.points[idx].y,
          stroke: p.color,
          "stroke-width": "1.2",
          "stroke-opacity": "0.55"
        })
      );
    });
  }
  // Pass 3 — polygon outline (between populated vertices) on top of fills.
  for (const p of polys) {
    if (!p.polyPts || p.polyPts.length < 2) continue;
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
  // Pass 4 — vertex dots on populated axes only.
  for (const p of polys) {
    LEGACY_AXES.forEach((a, idx) => {
      const v = p.c.values[a.id] || 0;
      if (v <= 0) return;
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

  // HTML wrap so we can put a side legend with click-to-toggle.
  const wrap = document.createElement("div");
  wrap.className = "demographics-chart-wrap";
  wrap.appendChild(svg);

  // Side legend (top-right) listing ALL civs (visible + hidden). Click to
  // toggle just like the line chart's end-of-line labels.
  const onToggle = typeof opts.onToggleCiv === "function" ? opts.onToggleCiv : null;
  const legendX = 16,
    legendYBase = 18;
  let gy = legendYBase;
  civs.forEach((c) => {
    const isHidden = hidden.has(c.leaderType);
    const div = document.createElement("div");
    div.className = "demographics-chart-line-label";
    if (isHidden) div.classList.add("is-hidden");
    div.style.position = "absolute";
    div.style.left = (legendX / W) * 100 + "%";
    div.style.top = (gy / H) * 100 + "%";
    div.style.cursor = onToggle ? "pointer" : "default";

    const dot = document.createElement("span");
    dot.className = "demographics-chart-line-label-dot";
    if (isHidden) dot.classList.add("is-hollow");
    dot.style.backgroundColor = isHidden ? "transparent" : c.color;
    dot.style.borderColor = c.color;
    div.appendChild(dot);

    const txt = document.createElement("span");
    txt.className = "demographics-chart-line-label-text";
    // Show the polygon "area" (sum of axes) so the user can compare
    // overall legacy progress without doing arithmetic in their head.
    const total = Math.round(
      (c.values.triumphs_cultural || 0) +
        (c.values.triumphs_diplomatic || 0) +
        (c.values.triumphs_economic || 0) +
        (c.values.triumphs_scientific || 0) +
        (c.values.triumphs_militaristic || 0) +
        (c.values.triumphs_expansionist || 0)
    );
    txt.textContent = c.name + " — Σ " + total;
    div.appendChild(txt);

    if (onToggle) {
      div.addEventListener("click", (ev) => {
        ev.stopPropagation();
        safePlaySound("data-audio-select-press", "audio-screen-unlocks");
        onToggle(c.leaderType);
      });
    }
    wrap.appendChild(div);
    gy += 26;
  });

  host.appendChild(wrap);
  dlog("legacy radar mounted; civs=", civs.size, "visible=", visibleCivs.length);
  return { svg };
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

// Collect all civs that have at least one sample with any resource value,
// so the resources stack viewer dropdown can list them by leader name.
export function collectResourceCivOptions(history) {
  const samps = history && Array.isArray(history.samples) ? history.samples : [];
  const seen = new Map();
  for (const s of samps) {
    if (!s?.players) continue;
    for (const pid of Object.keys(s.players)) {
      const ps = s.players[pid];
      const m = ps?.metrics;
      if (!m) continue;
      const has =
        typeof m.resources_total === "number" ||
        typeof m.resources_bonus === "number" ||
        typeof m.resources_empire === "number" ||
        typeof m.resources_city === "number";
      if (!has) continue;
      if (seen.has(pid)) continue;
      seen.set(pid, {
        pid,
        label: ps.leaderName
          ? ps.civName
            ? ps.leaderName + " (" + ps.civName + ")"
            : ps.leaderName
          : "Player " + pid
      });
    }
  }
  return Array.from(seen.values());
}

export function renderResourcesStack(host, options) {
  if (!host) return null;
  while (host.firstChild) host.removeChild(host.firstChild);
  const opts = options || {};
  // `opts.bands` lets `renderTriumphStack` reuse this entire SVG path
  // by passing a different band set (cultural/diplomatic/etc) while
  // keeping all the layout, axes, tooltips, and per-civ dropdown logic.
  const BANDS = Array.isArray(opts.bands) && opts.bands.length > 0 ? opts.bands : RESOURCE_BANDS;
  const W = opts.width || 1400;
  const H = opts.height || 600;
  const samples = opts.history && Array.isArray(opts.history.samples) ? opts.history.samples : [];
  if (samples.length === 0) {
    const msg = document.createElement("div");
    msg.className = "demographics-empty font-body text-base";
    msg.textContent = "No samples yet — play a turn and reopen.";
    host.appendChild(msg);
    return null;
  }
  let localPid;
  try {
    if (typeof GameContext !== "undefined" && GameContext != null) {
      if (typeof GameContext.localPlayerID === "number") localPid = GameContext.localPlayerID;
      else if (typeof GameContext.localObserverID === "number")
        localPid = GameContext.localObserverID;
    }
  } catch (_) {
    /* */
  }
  // viewerPid (option) lets the caller pick which civ's stacked resources
  // to chart; defaults to the local player so the panel "just works" on
  // first open.
  const targetPid =
    opts.viewerPid !== undefined && opts.viewerPid !== null
      ? String(opts.viewerPid)
      : localPid !== undefined
        ? String(localPid)
        : null;
  // Build a per-turn array of { turn, values: {bonus, empire, ...} }
  const points = [];
  for (const s of samples) {
    if (!s?.players) continue;
    const pid = targetPid ? targetPid : Object.keys(s.players)[0];
    const ps = s.players[pid];
    if (!ps?.metrics) continue;
    const m = ps.metrics;
    const row = { turn: s.turn, values: {} };
    let any = false;
    for (const band of BANDS) {
      const v = typeof m[band.id] === "number" && isFinite(m[band.id]) ? m[band.id] : 0;
      if (v > 0) any = true;
      row.values[band.id] = v;
    }
    if (any) points.push(row);
  }
  // Optional time-range clamp (same shape as renderChart).
  const stackTr =
    opts.turnRange &&
    typeof opts.turnRange.min === "number" &&
    typeof opts.turnRange.max === "number"
      ? opts.turnRange
      : null;
  if (stackTr) {
    for (let i = points.length - 1; i >= 0; i--) {
      if (points[i].turn < stackTr.min || points[i].turn > stackTr.max) {
        points.splice(i, 1);
      }
    }
  }
  if (points.length === 0) {
    const msg = document.createElement("div");
    msg.className = "demographics-empty font-body text-base";
    msg.textContent =
      "No resource samples yet — once you assign your first resource the chart will populate.";
    host.appendChild(msg);
    return null;
  }
  // Compute domain.
  let xMin = Infinity,
    xMax = -Infinity,
    yMax = 0;
  for (const p of points) {
    if (p.turn < xMin) xMin = p.turn;
    if (p.turn > xMax) xMax = p.turn;
    let stack = 0;
    for (const band of BANDS) stack += p.values[band.id] || 0;
    if (stack > yMax) yMax = stack;
  }
  if (!isFinite(xMin)) xMin = 0;
  if (!isFinite(xMax)) xMax = 1;
  if (xMin === xMax) xMax = xMin + 1;
  if (yMax <= 0) yMax = 1;
  const padL = 70,
    padR = 200,
    padT = 30,
    padB = 64;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const xOf = (t) => padL + ((t - xMin) / (xMax - xMin || 1)) * innerW;
  const yOf = (v) => padT + innerH - (v / yMax) * innerH;

  const svg = svgEl("svg", {
    xmlns: SVG_NS,
    viewBox: `0 0 ${W} ${H}`,
    width: String(W),
    height: String(H),
    preserveAspectRatio: "none",
    class: "demographics-chart-svg",
    "aria-label": "Resources by category over time"
  });
  // Plot bg.
  svg.appendChild(
    svgEl("rect", {
      x: padL,
      y: padT,
      width: innerW,
      height: innerH,
      fill: "rgba(20, 16, 10, 0.55)",
      stroke: "#c9a24c",
      "stroke-width": "1"
    })
  );
  // Y gridlines (4 divisions) + labels.
  for (let i = 0; i <= 4; i++) {
    const v = (yMax * i) / 4;
    const y = yOf(v);
    svg.appendChild(
      svgEl("line", {
        x1: padL,
        y1: y,
        x2: padL + innerW,
        y2: y,
        stroke: "rgba(201, 162, 76, 0.18)",
        "stroke-width": "1"
      })
    );
    const lbl = svgEl("text", {
      x: padL - 6,
      y: y + 4,
      fill: "rgba(243, 231, 196, 0.85)",
      "font-size": "12",
      "text-anchor": "end"
    });
    lbl.textContent = String(Math.round(v));
    svg.appendChild(lbl);
  }
  // X-axis turn labels — "T-N / <gameYear>". Collected for HTML overlay.
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
  try {
    if (
      typeof Game !== "undefined" &&
      typeof Game.getTurnDate === "function" &&
      typeof Game.turn === "number"
    ) {
      const live = Game.getTurnDate();
      if (typeof live === "string" && live.length > 0) {
        stackTurnYears.set(Game.turn, live);
      }
    }
  } catch (_) {
    /* */
  }
  function nearestStackYear(turn) {
    if (stackTurnYears.has(turn)) return stackTurnYears.get(turn);
    let best = null,
      bestDist = Infinity;
    stackTurnYears.forEach((y, t) => {
      const d = Math.abs(t - turn);
      if (d < bestDist) {
        bestDist = d;
        best = y;
      }
    });
    return best;
  }
  const xTicks = 6;
  const stackTickPositions = [];
  for (let i = 0; i <= xTicks; i++) {
    const t = Math.round(xMin + ((xMax - xMin) * i) / xTicks);
    const x = xOf(t);
    svg.appendChild(
      svgEl("line", {
        x1: x,
        x2: x,
        y1: padT + innerH,
        y2: padT + innerH + 4,
        stroke: "#f3e7c4",
        "stroke-width": "1"
      })
    );
    stackTickPositions.push({ t, x, year: nearestStackYear(t), labelY: padT + innerH + 8 });
  }
  // Stack the bands from bottom up. For each band, build a polygon
  // bounded above by (cum + band) and below by (cum), then bump cum.
  const cum = new Array(points.length).fill(0);
  for (const band of BANDS) {
    const upper = [];
    const lower = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const v = p.values[band.id] || 0;
      lower.push({ x: xOf(p.turn), y: yOf(cum[i]) });
      cum[i] += v;
      upper.push({ x: xOf(p.turn), y: yOf(cum[i]) });
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

  // Legend at right margin (HTML overlay, clickable later if we add toggles).
  const wrap = document.createElement("div");
  wrap.className = "demographics-chart-wrap";
  wrap.appendChild(svg);

  // Axis titles.
  {
    const xTitle = document.createElement("div");
    xTitle.className = "demographics-chart-axis-title demographics-chart-axis-x";
    xTitle.style.position = "absolute";
    xTitle.style.left = ((padL + innerW / 2) / W) * 100 + "%";
    xTitle.style.top = ((H - 4) / H) * 100 + "%";
    xTitle.style.transform = "translate(-50%, -100%)";
    xTitle.textContent = "Time (turn / year)";
    wrap.appendChild(xTitle);
    const yTitle = document.createElement("div");
    yTitle.className = "demographics-chart-axis-title demographics-chart-axis-y";
    yTitle.style.position = "absolute";
    yTitle.style.left = (12 / W) * 100 + "%";
    yTitle.style.top = ((padT + innerH / 2) / H) * 100 + "%";
    yTitle.style.transform = "translate(-50%, -50%) rotate(-90deg)";
    // Callers can override the y-axis title via opts.yAxisLabel —
    // renderTriumphStack passes "Triumphs (count)" to replace the
    // resources-specific default.
    yTitle.textContent =
      typeof opts.yAxisLabel === "string" && opts.yAxisLabel
        ? opts.yAxisLabel
        : "Resources Assigned (count)";
    wrap.appendChild(yTitle);
  }

  // HTML overlay X-tick labels (turn + year).
  stackTickPositions.forEach((tick) => {
    const div = document.createElement("div");
    div.className = "demographics-chart-x-tick";
    div.style.position = "absolute";
    div.style.left = (tick.x / W) * 100 + "%";
    div.style.top = (tick.labelY / H) * 100 + "%";
    div.style.transform = "translateX(-50%)";

    if (_xAxisMode !== "year") {
      const tn = document.createElement("div");
      tn.className = "demographics-chart-x-tick-turn";
      tn.textContent = "T-" + tick.t;
      div.appendChild(tn);
    }
    if (_xAxisMode !== "turn" && tick.year) {
      const yr = document.createElement("div");
      yr.className = "demographics-chart-x-tick-year";
      yr.textContent = tick.year;
      div.appendChild(yr);
    } else if (_xAxisMode === "year" && !tick.year) {
      const tn = document.createElement("div");
      tn.className = "demographics-chart-x-tick-turn";
      tn.textContent = "T-" + tick.t;
      div.appendChild(tn);
    }
    wrap.appendChild(div);
  });

  let gy = padT + 8;
  const gx = padL + innerW + 16;
  BANDS.forEach((band) => {
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

  host.appendChild(wrap);
  dlog(
    "resources stacked area mounted; turns=",
    points.length,
    "yMax=",
    yMax,
    "localPid=",
    localPid
  );
  return { svg };
}

// Wars Gantt — one horizontal bar per war, stacked vertically by start turn.
// X-axis = turn (with year ticks). Bars colored by the attacker's primary
// color; named with the ordinal-style label the sampler generates.
// Collect every civ pid that's appeared in any war (with display labels) so
// the conflicts page filter dropdown can list them.
export function collectWarCivOptions(history) {
  const wars = history && Array.isArray(history.wars) ? history.wars : [];
  const seen = new Map();
  for (const w of wars) {
    const allRosters = [].concat(w.sideACivs || [], w.sideBCivs || []);
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

export function renderWarsGantt(host, options) {
  if (!host) return null;
  while (host.firstChild) host.removeChild(host.firstChild);
  const opts = options || {};
  const W = opts.width || 1400;
  let H = opts.height || 600;
  const wars = opts.history && Array.isArray(opts.history.wars) ? opts.history.wars.slice() : [];
  const samples = opts.history && Array.isArray(opts.history.samples) ? opts.history.samples : [];

  if (wars.length === 0) {
    const msg = document.createElement("div");
    msg.className = "demographics-empty font-body text-base";
    msg.textContent = "No wars yet. Once any civ declares war, the timeline will populate.";
    host.appendChild(msg);
    return null;
  }
  wars.sort((a, b) => (a.startTurn || 0) - (b.startTurn || 0));
  const latestTurn = samples.length > 0 ? samples[samples.length - 1].turn : 0;

  // Filter pipeline ---------------------------------------------------
  // City states are dropped entirely from the conflicts view per user
  // direction — this is a major-civ engagement timeline. Wars between
  // a major and a city-state alone are hidden; coalition wars between
  // two majors (even if a CS ally exists on a side) still show, but
  // only the major civs are rendered as bars.
  const filterPid = typeof opts.filterPid === "number" ? opts.filterPid : null;
  const showActiveOnly = !!opts.activeOnly;

  function involvedPids(w) {
    return Array.isArray(w.participants) ? w.participants : [].concat(w.sideA || [], w.sideB || []);
  }
  function majorsOnSide(roster) {
    return (roster || []).filter((r) => r && !r.isCS);
  }
  function majorPidsForWar(w) {
    return [].concat(majorsOnSide(w.sideACivs), majorsOnSide(w.sideBCivs)).map((r) => r.pid);
  }
  function isMajorVsMajor(w) {
    return majorsOnSide(w.sideACivs).length > 0 && majorsOnSide(w.sideBCivs).length > 0;
  }
  let filtered = wars.filter((w) => {
    if (showActiveOnly && typeof w.endTurn === "number") return false;
    // Drop any war that doesn't pit at least one major on each side.
    if (!isMajorVsMajor(w)) return false;
    if (filterPid !== null) {
      if (!majorPidsForWar(w).map(Number).includes(Number(filterPid))) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    const msg = document.createElement("div");
    msg.className = "demographics-empty font-body text-base";
    msg.textContent = "No wars match the current filters.";
    host.appendChild(msg);
    return null;
  }

  // Optional time-range clamp.
  const tr =
    opts.turnRange &&
    typeof opts.turnRange.min === "number" &&
    typeof opts.turnRange.max === "number"
      ? opts.turnRange
      : null;

  let xMin = Infinity,
    xMax = -Infinity;
  for (const w of filtered) {
    const s = w.startTurn;
    const e = typeof w.endTurn === "number" ? w.endTurn : latestTurn;
    if (tr && (e < tr.min || s > tr.max)) continue;
    if (s < xMin) xMin = s;
    if (e > xMax) xMax = e;
  }
  if (!isFinite(xMin)) xMin = samples[0]?.turn ?? 0;
  if (!isFinite(xMax)) xMax = latestTurn || xMin + 1;
  if (tr) {
    xMin = tr.min;
    xMax = tr.max;
  }
  if (xMin === xMax) xMax = xMin + 1;

  // One bar per war (per user direction). Each bar is a single solid
  // strip spanning the war's start→end turns, with the war name and
  // duration labelled INSIDE the bar (overlapping). Rich hover tooltip
  // replaces the per-civ stacked sub-bar treatment.
  const BAR_H = 24; // bar height (label fits comfortably inside)
  const ROW_GAP = 10; // gap between wars
  const padL = 60,
    padR = 60,
    padT = 30,
    padB = 64;
  // Pre-compute Y offsets so we can size H upfront — uniform row height
  // now that every war is one strip regardless of participant count.
  const rowTops = [];
  let accumY = padT + 6;
  for (let i = 0; i < filtered.length; i++) {
    rowTops.push(accumY);
    accumY += BAR_H + ROW_GAP;
  }
  const minInnerH = Math.max(120, accumY - padT - 6 + 16);
  H = Math.max(H, padT + minInnerH + padB);
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const xOf = (t) => padL + ((t - xMin) / (xMax - xMin || 1)) * innerW;

  const svg = svgEl("svg", {
    xmlns: SVG_NS,
    viewBox: `0 0 ${W} ${H}`,
    width: String(W),
    height: String(H),
    preserveAspectRatio: "none",
    class: "demographics-chart-svg",
    "aria-label": "Conflicts timeline"
  });
  // Plot background — neutral dark to match the Chart.js views' style
  // (Chart.defaults uses #E5E5E5 text on dark, gridlines #85878C). Keep
  // the gold border for the Civ7 accent.
  svg.appendChild(
    svgEl("rect", {
      x: padL,
      y: padT,
      width: innerW,
      height: innerH,
      fill: "rgba(18, 20, 24, 0.85)",
      stroke: "#c9a24c",
      "stroke-width": "1"
    })
  );

  // Year labels (HTML overlay, like the line chart).
  const turnYearMap = new Map();
  for (const s of samples) {
    if (
      s &&
      typeof s.turn === "number" &&
      typeof s.gameYear === "string" &&
      s.gameYear.length > 0
    ) {
      turnYearMap.set(s.turn, s.gameYear);
    }
  }
  try {
    if (
      typeof Game !== "undefined" &&
      typeof Game.getTurnDate === "function" &&
      typeof Game.turn === "number"
    ) {
      const live = Game.getTurnDate();
      if (typeof live === "string" && live.length > 0) {
        turnYearMap.set(Game.turn, live);
      }
    }
  } catch (_) {
    /* */
  }
  function nearestYear(turn) {
    if (turnYearMap.has(turn)) return turnYearMap.get(turn);
    let best = null,
      bestDist = Infinity;
    turnYearMap.forEach((y, t) => {
      const d = Math.abs(t - turn);
      if (d < bestDist) {
        bestDist = d;
        best = y;
      }
    });
    return best;
  }
  const xTicks = 6;
  const tickPositions = [];
  for (let i = 0; i <= xTicks; i++) {
    const t = Math.round(xMin + ((xMax - xMin) * i) / xTicks);
    const x = xOf(t);
    svg.appendChild(
      svgEl("line", {
        x1: x,
        x2: x,
        y1: padT + innerH,
        y2: padT + innerH + 4,
        stroke: "#E5E5E5",
        "stroke-width": "1"
      })
    );
    // Vertical grid line — Chart.js neutral grid color.
    svg.appendChild(
      svgEl("line", {
        x1: x,
        x2: x,
        y1: padT,
        y2: padT + innerH,
        stroke: "rgba(133, 135, 140, 0.35)",
        "stroke-width": "1"
      })
    );
    tickPositions.push({ t, x, year: nearestYear(t) });
  }

  // Look up the LATEST primaryColor for a pid from the sample stream so
  // bar colors match the line-chart palette. The civ swap on age
  // transition updates the line-chart color; this does the same.
  function currentPrimaryColor(pid) {
    for (let i = samples.length - 1; i >= 0; i--) {
      const ps = samples[i]?.players?.[pid];
      if (ps && typeof ps.primaryColor === "string" && ps.primaryColor.length > 0) {
        return ps.primaryColor;
      }
    }
    return "#9aa8c8";
  }

  // Render each war as ONE bar spanning start→end. The bar is split into
  // two horizontal halves so both sides' primary colors are still visible
  // at a glance (top half = side A, bottom = side B). Ongoing wars get a
  // pulsing red right-edge marker and no closing stripe. Per-civ stacked
  // sub-bars (the old layout) are gone — coalition information lives in
  // the tooltip instead.
  const barRects = []; // { war, x1, x2, y, w, h } for tooltip hit-testing
  for (let i = 0; i < filtered.length; i++) {
    const w = filtered[i];
    const sTurn = w.startTurn;
    const eTurn = typeof w.endTurn === "number" ? w.endTurn : latestTurn;
    if (tr && (eTurn < tr.min || sTurn > tr.max)) continue;
    const x1 = xOf(Math.max(sTurn, xMin));
    const x2 = xOf(Math.min(eTurn, xMax));
    const isClosed = typeof w.endTurn === "number";
    const baseY = rowTops[i];

    const majorA = majorsOnSide(w.sideACivs);
    const majorB = majorsOnSide(w.sideBCivs);
    const sem = getSemantic();
    // Build the full participant list (sideA first, then sideB) so the
    // bar is striped one band per civ: 2 civs = 2 stripes, 3 = 3, etc.
    // Side ordering preserved so allies sit together visually.
    const participants = [].concat(majorA, majorB);
    const stripes =
      participants.length > 0
        ? participants
        : [
            { pid: null, color: sem.sideA_fallback },
            { pid: null, color: sem.sideB_fallback }
          ];
    const barW = Math.max(2, x2 - x1);
    const stripeH = BAR_H / stripes.length;

    // One colored stripe per participating civ — height = BAR_H / N.
    stripes.forEach((c, idx) => {
      const fill =
        (typeof c.pid === "number" && currentPrimaryColor(c.pid)) ||
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
    // Thin hairlines between adjacent stripes so 3+ civ wars don't blur
    // visually into a single block.
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
    // Single outline around the combined bar.
    svg.appendChild(
      svgEl("rect", {
        x: x1,
        y: baseY,
        width: barW,
        height: BAR_H,
        fill: "none",
        stroke: "#1c1408",
        "stroke-width": "1"
      })
    );
    // Concluded marker: a hatch on the right edge so closed/ongoing
    // reads at a glance.
    if (isClosed) {
      svg.appendChild(
        svgEl("line", {
          x1: x2,
          x2: x2,
          y1: baseY,
          y2: baseY + BAR_H,
          stroke: "#1c1408",
          "stroke-width": "2"
        })
      );
    } else {
      svg.appendChild(
        svgEl("circle", {
          cx: x2,
          cy: baseY + BAR_H / 2,
          r: 5,
          fill: sem.ongoing_marker,
          stroke: "#1c1408",
          "stroke-width": "0.5"
        })
      );
    }
    barRects.push({ war: w, x: x1, y: baseY, w: barW, h: BAR_H, x2, isClosed });
  }

  // Wrap + HTML overlays (war labels + x-tick year labels).
  const wrap = document.createElement("div");
  wrap.className = "demographics-chart-wrap";
  wrap.style.position = "relative";
  wrap.appendChild(svg);

  function pctX(x) {
    return (x / W) * 100;
  }
  function pctY(y) {
    return (y / H) * 100;
  }

  // X-tick labels (HTML).
  tickPositions.forEach((tick) => {
    const div = document.createElement("div");
    div.className = "demographics-chart-x-tick";
    div.style.position = "absolute";
    div.style.left = pctX(tick.x) + "%";
    div.style.top = pctY(padT + innerH + 8) + "%";
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

  // Axis titles for the Gantt.
  {
    const xTitle = document.createElement("div");
    xTitle.className = "demographics-chart-axis-title demographics-chart-axis-x";
    xTitle.style.position = "absolute";
    xTitle.style.left = ((padL + innerW / 2) / W) * 100 + "%";
    xTitle.style.top = ((H - 4) / H) * 100 + "%";
    xTitle.style.transform = "translate(-50%, -100%)";
    xTitle.textContent = "Time (turn / year)";
    wrap.appendChild(xTitle);
    const yTitle = document.createElement("div");
    yTitle.className = "demographics-chart-axis-title demographics-chart-axis-y";
    yTitle.style.position = "absolute";
    yTitle.style.left = (12 / W) * 100 + "%";
    yTitle.style.top = ((padT + innerH / 2) / H) * 100 + "%";
    yTitle.style.transform = "translate(-50%, -50%) rotate(-90deg)";
    yTitle.textContent = "Conflicts (one bar per war)";
    wrap.appendChild(yTitle);
  }

  // Pseudo-realistic casualty estimator. Combines war duration, the
  // average military power of all participants, and an era multiplier
  // that scales by start turn — so an antiquity skirmish reports
  // thousands, a modern war reports millions to tens of millions.
  // Calibrated to roughly:
  //   T-20 ancient, 8-turn war, 200 milpower → ~4k
  //   T-100 exploration, 15-turn, 600 milpower → ~250k
  //   T-180 modern, 20-turn, 1500 milpower → ~12M
  function estimateCasualties(war) {
    const duration = Math.max(
      1,
      (typeof war.endTurn === "number" ? war.endTurn : latestTurn) - war.startTurn
    );
    // Pull each participant's latest sampled militaryPower.
    const allPids = [].concat(war.sideA || [], war.sideB || []);
    let totalPower = 0;
    for (let i = samples.length - 1; i >= 0 && totalPower === 0; i--) {
      const s = samples[i];
      if (!s?.players) continue;
      for (const pid of allPids) {
        const mp = s.players[pid]?.metrics?.milpower;
        if (typeof mp === "number" && isFinite(mp)) totalPower += mp;
      }
    }
    if (totalPower <= 0) totalPower = 100; // fallback minimum
    const avgPower = totalPower / Math.max(1, allPids.length);
    const eraMult = 0.5 * Math.pow(1.04, war.startTurn || 0);
    return Math.round(duration * avgPower * 0.5 * eraMult);
  }
  function formatCasualties(n) {
    if (!isFinite(n) || n <= 0) return "—";
    if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return String(Math.round(n));
  }

  // Parse a Civ7 gameYear string ("2725 BCE", "100 CE", "1842") into a
  // signed integer (BCE → negative). Used to compute war duration in
  // years for the in-bar label.
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
  function durationYears(war) {
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

  // Compute display-name overrides for every war based on participant
  // count + duration. Original storage names ("1st Rome vs Egypt War")
  // were grammatically off and didn't scale to multi-party conflicts.
  // We rebuild names at render time with proper adjectival forms and
  // size-aware flavor.
  //
  // CIV_ADJECTIVE — civ display-name → grammatical adjective form.
  // Mapping covers every base + DLC civilization across all three ages.
  // Anything not in the map falls back to a heuristic (rough English
  // adjective derivation) so unknown civs don't read as raw nouns.
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
  // Primary path: ask the engine for the canonical adjective via
  // `Locale.compose("LOC_CIVILIZATION_X_ADJECTIVE")`. Every shipped civ
  // (and DLC additions automatically) has one of these strings — so we
  // never have to maintain a hardcoded table to stay current.
  // Cite: CivilizationText.xml — every <Row Tag="LOC_CIVILIZATION_*_ADJECTIVE">.
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
  // Fallback path: use the bundled adjective map keyed by display name,
  // then a heuristic English suffix derivation. Used when (a) civTypeString
  // isn't on the roster (legacy war records pre-civTypeString-capture)
  // or (b) the engine returns the raw LOC_ token (untranslated mod).
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
  function civAdjective(rosterEntry) {
    // Accepts either a roster object ({civ, civTypeString}) or a raw
    // string (legacy call sites).
    if (rosterEntry && typeof rosterEntry === "object") {
      const fromEngine = adjectiveFromCivType(rosterEntry.civTypeString);
      if (fromEngine) return fromEngine;
      return civAdjectiveFromName(rosterEntry.civ);
    }
    return civAdjectiveFromName(rosterEntry);
  }
  const ordinalInt = (n) => {
    const v = n % 100,
      s = ["th", "st", "nd", "rd"];
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };
  const romanize = (n) => {
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
  };

  const nameOverride = new Map(); // war → display label
  {
    // Count prior wars with the EXACT same participant set so we can
    // ordinal-number recurring matchups ("Second Roman-Carthaginian War").
    const pairCounts = new Map(); // sortedAdjKey → count
    const worldWars = []; // war list in chronological order (for "World War N")

    const sorted = warsFiltered.slice().sort((a, b) => (a.startTurn || 0) - (b.startTurn || 0));

    for (const w of sorted) {
      const a = majorsOnSide(w.sideACivs);
      const b = majorsOnSide(w.sideBCivs);
      const n = a.length + b.length;
      // Pass the FULL roster object so civAdjective can use
      // civTypeString for the engine LOC_*_ADJECTIVE lookup.
      const adjA = a.map((r) => civAdjective(r));
      const adjB = b.map((r) => civAdjective(r));
      const yrs = durationYears(w);
      let label;

      if (n >= 6) {
        // World War.
        worldWars.push(w);
        label = "World War " + romanize(worldWars.length);
      } else if (n >= 4) {
        // Great War with headline combatants + extras.
        label = "Great War: " + adjA[0] + " vs " + adjB[0] + " (+" + (n - 2) + " civs)";
      } else if (n === 3) {
        // Tripartite — list all three by adjective.
        const all = [].concat(adjA, adjB).sort();
        label = "Tripartite " + all.join("–") + " War";
      } else if (n === 2) {
        // Standard bilateral. Build a stable adjective key (alpha
        // order) so reruns of the same matchup get ordinal suffixes
        // ("Second Roman-Egyptian War").
        const pair = [adjA[0] || "Unknown", adjB[0] || "Unknown"].sort();
        const key = pair.join("|");
        const count = (pairCounts.get(key) || 0) + 1;
        pairCounts.set(key, count);
        const ord = ordinalInt(count);
        label = ord + " " + pair[0] + "–" + pair[1] + " War";
      } else {
        label = w.name; // single-party / odd fallback
      }

      // Duration flair — long protracted conflicts get a flavor
      // prefix to convey scale at a glance.
      if (yrs >= 100 && n < 6) {
        label = label.replace(/ War$/, "") + " (Hundred Years' War)";
      } else if (yrs >= 50 && n < 6) {
        label = label.replace(/ War$/, "") + " (Long War)";
      }
      nameOverride.set(w, label);
    }
  }
  // Keep the legacy variable name used downstream.
  const wwOverride = nameOverride;

  // War labels INSIDE each bar (overlapping the colored fill), centered
  // vertically with a text-shadow for legibility. Long titles get
  // truncated with an ellipsis to the bar width.
  barRects.forEach(({ war, x, y, w, h }) => {
    const yrs = durationYears(war);
    const displayName = wwOverride.get(war) || war.name;
    const label = displayName + "  ·  " + yrs + " yr" + (yrs === 1 ? "" : "s");
    const div = document.createElement("div");
    div.className = "demographics-chart-war-label";
    div.style.position = "absolute";
    div.style.left = pctX(x) + "%";
    div.style.top = pctY(y + h / 2) + "%";
    div.style.width = pctX(w) + "%";
    // The label sits inside the bar; translate so it's vertically
    // centered on the bar's midline.
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

  // ── Hover tooltip ────────────────────────────────────────────────────
  // Custom callout replacing the unreliable `title` attribute. Tracks
  // mouse position over the SVG, hit-tests against barRects, and shows
  // a rich multi-line panel anchored near the cursor.
  function rosterLines(roster) {
    const majors = (roster || []).filter((r) => r && !r.isCS);
    if (majors.length === 0) return ["(no major civs)"];
    return majors.map((r) => (r.leader ? r.leader + ", " + r.civ : r.civ));
  }
  function buildTooltipBody(w) {
    const sTurn = w.startTurn;
    const eTurn = typeof w.endTurn === "number" ? w.endTurn : latestTurn;
    const startYr = w.startYear || "T-" + sTurn;
    const endYr = typeof w.endTurn === "number" ? w.endYear || "T-" + eTurn : "ongoing";
    const yrs = durationYears(w);
    const turns = eTurn - sTurn;
    const casualties = formatCasualties(estimateCasualties(w));
    const partyMul = Math.sqrt(
      Math.max(1, (w.sideA || []).length) * Math.max(1, (w.sideB || []).length)
    );
    const battles = Math.max(1, Math.round(turns * 0.4 * partyMul * Math.pow(1.02, sTurn || 0)));
    const declared =
      w.declaredBy && !w.declaredBy.isCS
        ? w.declaredBy.leader
          ? w.declaredBy.leader + ", " + w.declaredBy.civ
          : w.declaredBy.civ
        : "unknown";
    return {
      // Use the World War override when 4+ civs are involved; fall back
      // to the bilateral name otherwise.
      title: wwOverride.get(w) || w.name,
      status: typeof w.endTurn === "number" ? "concluded" : "ongoing",
      sideA: rosterLines(w.sideACivs),
      sideB: rosterLines(w.sideBCivs),
      declared,
      startYr,
      endYr,
      yrs,
      turns,
      battles,
      casualties
    };
  }

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
  wrap.appendChild(tooltip);

  function renderTooltipFor(w) {
    const t = buildTooltipBody(w);
    while (tooltip.firstChild) tooltip.removeChild(tooltip.firstChild);
    const head = document.createElement("div");
    head.style.fontWeight = "700";
    head.style.color = "#f3c34c";
    head.style.marginBottom = "0.25rem";
    head.textContent = t.title + "  [" + t.status + "]";
    tooltip.appendChild(head);
    function sect(label, lines) {
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
    sect("Attackers:", t.sideA);
    sect("Defenders:", t.sideB);
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

  function hitTest(svgX, svgY) {
    for (const r of barRects) {
      if (svgX >= r.x && svgX <= r.x + r.w && svgY >= r.y && svgY <= r.y + r.h) return r.war;
    }
    return null;
  }
  wrap.addEventListener("mousemove", (ev) => {
    const rect = svg.getBoundingClientRect();
    if (!rect || rect.width === 0) {
      tooltip.style.display = "none";
      return;
    }
    const sx = ((ev.clientX - rect.left) / rect.width) * W;
    const sy = ((ev.clientY - rect.top) / rect.height) * H;
    const w = hitTest(sx, sy);
    if (!w) {
      tooltip.style.display = "none";
      return;
    }
    renderTooltipFor(w);
    const wrapRect = wrap.getBoundingClientRect();
    const lx = ev.clientX - wrapRect.left + 14;
    const ly = ev.clientY - wrapRect.top + 14;
    tooltip.style.left = lx + "px";
    tooltip.style.top = ly + "px";
    tooltip.style.display = "block";
  });
  wrap.addEventListener("mouseleave", () => {
    tooltip.style.display = "none";
  });

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
function localizeText(key) {
  if (typeof key !== "string" || key.length === 0) return "";
  let out = key;
  try {
    if (typeof Locale?.compose === "function") {
      const composed = Locale.compose(key);
      if (typeof composed === "string" && composed.length > 0) out = composed;
    }
  } catch (_) {
    /* */
  }
  if (typeof out !== "string") return "";
  // Case 1: Locale.compose echoed back the raw key (or stripped wrapping).
  if (out.startsWith("LOC_")) return humanizeLocToken(out);
  // Case 2: composed text contains embedded unresolved LOC_ tokens (Civ7
  // sometimes returns "Build {LOC_TERM_WONDER} wonders" when the inner
  // token isn't in the loaded string table). Scrub each one in place.
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
function alliveMajorsFromHistory(history) {
  const out = [];
  try {
    if (typeof Players?.getAliveMajorIds === "function") {
      for (const pid of Players.getAliveMajorIds()) out.push(pid);
      return out;
    }
  } catch (_) {}
  const samples = history?.samples || [];
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
function civColor(history, pid) {
  const samples = history?.samples || [];
  for (let i = samples.length - 1; i >= 0; i--) {
    const ps = samples[i]?.players?.[String(pid)];
    if (ps?.primaryColor) return ps.primaryColor;
  }
  return PALETTE[pid % PALETTE.length];
}

// Triumph Race — per-civ progress on each first-come-first-served triumph
// (those marked FirstPlayerOnly in GameInfo.Legacies). Reads
// Players.get(pid).Legacies.getProgress(legacyType) live each render so the
// `raceWinner` field surfaces immediately when a civ claims a race.
export function renderTriumphRace(host, options) {
  if (!host) return null;
  while (host.firstChild) host.removeChild(host.firstChild);
  const opts = options || {};
  host.style.overflowY = "auto";
  host.style.padding = "0.6rem 0.8rem";

  if (typeof GameInfo === "undefined" || !GameInfo.Legacies || typeof Players?.get !== "function") {
    const msg = document.createElement("div");
    msg.className = "demographics-empty font-body text-base";
    msg.textContent = "Test-of-Time Legacies API unavailable.";
    host.appendChild(msg);
    return null;
  }

  const age = currentAgeType();
  const majors = alliveMajorsFromHistory(opts.history);
  if (majors.length === 0) {
    const msg = document.createElement("div");
    msg.className = "demographics-empty font-body text-base";
    msg.textContent = "No civs sampled yet.";
    host.appendChild(msg);
    return null;
  }

  // Collect ALL triumphs (major + minor, race + non-race) for this age.
  // Earlier this filtered to FirstPlayerOnly + MajorLegacy, but the user
  // wants every triumph to appear card-style identical to the Completion
  // screen, with progress bars only for civs actively making progress.
  const races = [];
  try {
    for (const row of GameInfo.Legacies) {
      if (!row || !row.LegacyType) continue;
      if (age && row.Age && row.Age !== age) continue;
      // Skip the wildcard / catch-all row (no attribute color, no civ
      // claims it directly).
      if (!row.LegacySubtype) continue;
      races.push(row);
    }
  } catch (_) {}

  if (races.length === 0) {
    const msg = document.createElement("div");
    msg.className = "demographics-empty font-body text-base";
    msg.textContent = age ? "No triumphs available in " + age + "." : "No triumphs available.";
    host.appendChild(msg);
    return null;
  }

  // For each race row, query every civ's progress.
  function progressFor(pid, legacyType) {
    try {
      const player = Players.get(pid);
      const pl = player?.Legacies;
      if (!pl) return null;
      const p = pl.getProgress?.(legacyType);
      const triggered = !!pl.isTriggered?.(legacyType);
      const cur = p?.progress?.[0]?.current ?? 0;
      const tot = p?.progress?.[0]?.total ?? 0;
      const raceWinner = typeof p?.raceWinner === "number" ? p.raceWinner : -1;
      return { current: cur, total: tot, triggered, raceWinner };
    } catch (_) {
      return null;
    }
  }

  // Build per-race rows.
  const raceData = races.map((row) => {
    const civs = majors.map((pid) => ({
      pid,
      ...(progressFor(pid, row.LegacyType) || {
        current: 0,
        total: 0,
        triggered: false,
        raceWinner: -1
      })
    }));
    // Race winner is reported on every civ's progress equally; grab from
    // any non-null reading.
    let winner = -1;
    for (const c of civs) {
      if (c.raceWinner !== -1) {
        winner = c.raceWinner;
        break;
      }
    }
    // Total available is whichever non-zero we saw (every civ has the
    // same total for a given legacy).
    let total = 0;
    for (const c of civs) {
      if (c.total > total) total = c.total;
    }
    // Sort civs by progress (and put the winner first if any).
    civs.sort((a, b) => {
      if (a.pid === winner && b.pid !== winner) return -1;
      if (b.pid === winner && a.pid !== winner) return 1;
      return b.current - a.current;
    });
    return { row, civs, winner, total };
  });

  // Order: by attribute then by activity, alphabetical tiebreak.
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

  // Render — direct clone of the native triumph-card from
  //   base-standard/ui-next/screens/legacies/triumph-card.js
  // using the same engine chrome:
  //   - `ornate-card-bg` (border-image hud_mini_box.png)
  //   - 4 corner adornments (mp_player_detail BLP, rotated)
  //   - Top filigrees (base_top-filigree_left/right BLP)
  //   - Centered top ring with trait icon
  //   - Triumph name uppercase font-title text-secondary
  //   - "Commemorative" / "Instant" dedication-pill with horizontal dividers
  //   - Requirements text
  // PLUS: small per-civ progress bars in the body for civs with current>0
  //       (the user-requested addition over the native single-player card).
  // Cards are laid out as a wrapping flex grid (same as native triumphs tab).
  const grid = document.createElement("div");
  grid.style.display = "flex";
  grid.style.flexWrap = "wrap";
  grid.style.gap = "1.2rem 1rem";
  grid.style.justifyContent = "center";
  grid.style.padding = "0.5rem 0.3rem";

  const CORNER_BLP = "blp:mp_player_detail";
  const FILIGREE_L = "blp:base_top-filigree_left";
  const FILIGREE_R = "blp:base_top-filigree_right";
  const RING_BLP = "blp:base_triumph_ring";

  for (const rd of raceData) {
    const a = attrMetaFor(rd.row.LegacySubtype);
    const isMajor = rd.row.MajorLegacy !== false;
    const isTriggered = rd.civs.some((c) => c.triggered);

    // Outer ornate card (engine border-image chrome).
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

    // 4 corner adornments — exact clone of OrnateCard's _tmpl$.
    function addCorner(rotate, position) {
      const c = document.createElement("div");
      c.style.cssText = [
        "position:absolute",
        "width:1.5rem",
        "height:1.5rem",
        "background-image:url('" + CORNER_BLP + "')",
        "background-size:contain",
        "background-repeat:no-repeat",
        "background-position:center",
        "transform:rotate(" + rotate + ")",
        position
      ].join(";");
      card.appendChild(c);
    }
    addCorner("180deg", "top:0.5rem;left:0.4rem");
    addCorner("-90deg", "top:0.5rem;right:0.4rem");
    addCorner("90deg", "bottom:0.4rem;left:0.4rem");
    addCorner("0deg", "bottom:0.4rem;right:0.4rem");

    // Top filigree pair behind the ring.
    const filigreeRow = document.createElement("div");
    filigreeRow.style.cssText =
      "position:absolute;top:0;left:0;right:0;height:2.5rem;pointer-events:none;";
    if (a.color) filigreeRow.style.background = a.color + "22"; // very subtle tint
    const filL = document.createElement("div");
    filL.style.cssText =
      "position:absolute;width:7rem;height:2.5rem;left:1rem;top:-0.2rem;" +
      "background-image:url('" +
      FILIGREE_L +
      "');background-size:contain;" +
      "background-repeat:no-repeat;background-position:center;opacity:0.4;";
    const filR = document.createElement("div");
    filR.style.cssText =
      "position:absolute;width:7rem;height:2.5rem;right:1rem;top:-0.2rem;" +
      "background-image:url('" +
      FILIGREE_R +
      "');background-size:contain;" +
      "background-repeat:no-repeat;background-position:center;opacity:0.4;";
    filigreeRow.appendChild(filL);
    filigreeRow.appendChild(filR);
    card.appendChild(filigreeRow);

    // Top centered ring with attribute-color fill, overlaying card top.
    const ringWrap = document.createElement("div");
    ringWrap.style.cssText = [
      "position:absolute",
      "top:-1.6rem",
      "left:50%",
      "transform:translateX(-50%)",
      "width:4.4rem",
      "height:4.4rem",
      "background-image:url('" + RING_BLP + "')",
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

    // Triumph name (uppercase font-title text-secondary, centered).
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
    name.textContent = localizeText(rd.row.Name) || rd.row.LegacyType || "Triumph";
    card.appendChild(name);

    // Major/Minor "dedication-pill" with horizontal dividers either side.
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

    // Requirements (TriggerDescription) — centered xs, mirrors native.
    if (rd.row.TriggerDescription) {
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
      req.textContent = localizeText(rd.row.TriggerDescription);
      card.appendChild(req);
    }
    // Reward description.
    const rewardText = rd.row.Description || rd.row.RewardDescription || null;
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

    // Winner trophy if claimed.
    if (rd.winner !== -1) {
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
      trophy.textContent = "🏆 " + civDisplayName(opts.history, rd.winner);
      card.appendChild(trophy);
    }

    // Spacer that pushes the bars to the bottom of the card.
    const spacer = document.createElement("div");
    spacer.style.flex = "1 1 auto";
    spacer.style.minHeight = "0.6rem";
    card.appendChild(spacer);

    // Small per-civ progress bars — ONLY for civs with current > 0
    // (winner included). This is the user-requested addition.
    const active = rd.civs.filter((c) => c.current > 0 || c.pid === rd.winner);
    const barsBox = document.createElement("div");
    barsBox.style.cssText = "width:100%;display:flex;flex-direction:column;gap:0.18rem;";
    if (active.length === 0) {
      const noneMsg = document.createElement("div");
      noneMsg.style.cssText =
        "font-size:0.72rem;color:#85878c;font-style:italic;text-align:center;";
      noneMsg.textContent = "No progress yet.";
      barsBox.appendChild(noneMsg);
    } else {
      for (const c of active) {
        const row = document.createElement("div");
        row.style.cssText =
          "display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr) minmax(2.4rem,auto);gap:0.4rem;align-items:center;";

        const nameCell = document.createElement("div");
        nameCell.style.cssText = "display:flex;align-items:center;gap:0.3rem;min-width:0;";
        const dot = document.createElement("span");
        dot.style.cssText =
          "width:0.45rem;height:0.45rem;border-radius:50%;flex-shrink:0;background:" +
          civColor(opts.history, c.pid) +
          ";";
        nameCell.appendChild(dot);
        const nm = document.createElement("span");
        nm.style.cssText =
          "font-size:0.72rem;color:" +
          (c.pid === rd.winner ? "#f3c34c" : "#e5d2ac") +
          ";font-weight:" +
          (c.pid === rd.winner ? "700" : "500") +
          ";overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;";
        nm.textContent = civDisplayName(opts.history, c.pid);
        nameCell.appendChild(nm);
        row.appendChild(nameCell);

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
        row.appendChild(bar);

        const num = document.createElement("div");
        num.style.cssText =
          "font-family:monospace, ui-monospace;font-size:0.7rem;color:" +
          (c.pid === rd.winner ? "#f3c34c" : "#c2c4cc") +
          ";text-align:right;font-weight:" +
          (c.triggered ? "700" : "500") +
          ";";
        num.textContent = c.current + "/" + rd.total + (c.triggered ? " ✓" : "");
        row.appendChild(num);

        barsBox.appendChild(row);
      }
    }
    card.appendChild(barsBox);

    grid.appendChild(card);
  }
  host.appendChild(grid);

  dlog("triumph race rendered; races=", raceData.length);
  return null;
}

// Triumph Completion — per-civ × per-attribute grid for the current age.
// Cell shows triggered count / total available + bar.
export function renderTriumphCompletion(host, options) {
  if (!host) return null;
  while (host.firstChild) host.removeChild(host.firstChild);
  const opts = options || {};
  host.style.overflowY = "auto";
  host.style.padding = "0.6rem 0.8rem";

  if (typeof GameInfo === "undefined" || !GameInfo.Legacies || typeof Players?.get !== "function") {
    const msg = document.createElement("div");
    msg.className = "demographics-empty font-body text-base";
    msg.textContent = "Test-of-Time Legacies API unavailable.";
    host.appendChild(msg);
    return null;
  }

  const age = currentAgeType();
  const majors = alliveMajorsFromHistory(opts.history);

  // Per-attribute total available in this age.
  const totals = {};
  for (const a of TRIUMPH_ATTR_META) totals[a.key] = 0;
  try {
    for (const row of GameInfo.Legacies) {
      if (!row || !row.LegacySubtype) continue;
      if (age && row.Age && row.Age !== age) continue;
      if (totals[row.LegacySubtype] !== undefined) totals[row.LegacySubtype]++;
    }
  } catch (_) {}

  // Per-civ per-attribute triggered count (live API).
  const civRows = majors.map((pid) => {
    const player = Players.get(pid);
    const pl = player?.Legacies;
    const counts = {};
    for (const a of TRIUMPH_ATTR_META) counts[a.key] = 0;
    if (pl) {
      try {
        for (const row of GameInfo.Legacies) {
          if (!row || !row.LegacySubtype) continue;
          if (age && row.Age && row.Age !== age) continue;
          if (counts[row.LegacySubtype] === undefined) continue;
          let triggered = false;
          try {
            triggered = !!pl.isTriggered?.(row.LegacyType);
          } catch (_) {}
          if (triggered) counts[row.LegacySubtype]++;
        }
      } catch (_) {}
    }
    const sumTriggered = Object.values(counts).reduce((s, n) => s + n, 0);
    return { pid, counts, sumTriggered };
  });
  civRows.sort((a, b) => b.sumTriggered - a.sumTriggered);

  // Header.
  const header = document.createElement("div");
  header.style.fontSize = "0.85rem";
  header.style.color = "#c9b88c";
  header.style.marginBottom = "0.5rem";
  header.textContent =
    "Current age: " +
    (age || "unknown") +
    ". Cells show triggered / total available; bar is filled percent.";
  host.appendChild(header);

  // Sections organized by ATTRIBUTE (mirrors the base-game Victors panel,
  // where each tab covers one advisor/path). Within each attribute section,
  // every civ gets a row with a pipped progress bar — one pip per legacy
  // achievable in that path, filled-gold for triggered and hollow for not,
  // matching the native `advisor-panel__reward-pip-icon-done` /
  // `_icon-empty` style from screen-victory-progress.
  const stack = document.createElement("div");
  stack.style.display = "flex";
  stack.style.flexDirection = "column";
  stack.style.gap = "0.9rem";

  for (const a of TRIUMPH_ATTR_META) {
    const tot = totals[a.key] || 0;

    const section = document.createElement("div");
    section.style.background = "rgba(20, 16, 10, 0.55)";
    section.style.border = "1px solid rgba(201, 162, 76, 0.25)";
    section.style.borderTop = "0.18rem solid " + a.color;
    section.style.borderRadius = "0.2rem";
    section.style.padding = "0.55rem 0.8rem 0.7rem";

    // Section header — attribute name in path color (mirrors victory-title).
    const sectionHead = document.createElement("div");
    sectionHead.style.display = "flex";
    sectionHead.style.alignItems = "baseline";
    sectionHead.style.justifyContent = "space-between";
    sectionHead.style.marginBottom = "0.5rem";

    const sectionTitle = document.createElement("div");
    // Engine fxs-header style: TitleFont uppercase tracking-150 with the
    // attribute's path color. Mirrors advisor-panel_victory-title.
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
    section.appendChild(sectionHead);

    // Per-civ rows. Civs sorted by progress in THIS attribute (desc).
    const rowsForAttr = civRows
      .map((cr) => ({ pid: cr.pid, got: cr.counts[a.key] || 0 }))
      .sort((x, y) => y.got - x.got);

    const rowsContainer = document.createElement("div");
    rowsContainer.style.display = "flex";
    rowsContainer.style.flexDirection = "column";
    rowsContainer.style.gap = "0.3rem";

    for (const cr of rowsForAttr) {
      const row = document.createElement("div");
      row.style.display = "grid";
      row.style.gridTemplateColumns = "minmax(10rem, 14rem) 1fr minmax(3rem, auto)";
      row.style.gap = "0.6rem";
      row.style.alignItems = "center";

      // Civ name with colored dot.
      const nameCell = document.createElement("div");
      nameCell.style.display = "flex";
      nameCell.style.alignItems = "center";
      nameCell.style.gap = "0.4rem";
      const dot = document.createElement("span");
      dot.style.width = "0.6rem";
      dot.style.height = "0.6rem";
      dot.style.borderRadius = "50%";
      dot.style.background = civColor(opts.history, cr.pid);
      dot.style.flexShrink = "0";
      nameCell.appendChild(dot);
      const nm = document.createElement("span");
      nm.style.color = "#f3e7c4";
      nm.style.fontSize = "0.85rem";
      nm.style.overflow = "hidden";
      nm.style.textOverflow = "ellipsis";
      nm.style.whiteSpace = "nowrap";
      nm.textContent = civDisplayName(opts.history, cr.pid);
      nameCell.appendChild(nm);
      row.appendChild(nameCell);

      // Pipped progress bar. Backdrop bar + pips overlaid evenly spaced.
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
      if (tot > 0 && cr.got > 0) {
        const fill = document.createElement("div");
        fill.style.position = "absolute";
        fill.style.left = "0";
        fill.style.height = "0.32rem";
        fill.style.width = (cr.got / tot) * 100 + "%";
        fill.style.background = a.color;
        fill.style.opacity = "0.85";
        fill.style.borderRadius = "0.15rem";
        barWrap.appendChild(fill);
      }

      // Pips: one per legacy. Done = filled circle in attr color with
      // gold stroke; remaining = hollow circle. Even spacing across.
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
        if (i < cr.got) {
          pip.style.background = a.color;
          pip.style.border = "2px solid #f3c34c";
          pip.style.boxShadow = "0 0 4px " + a.color;
        } else {
          pip.style.background = "rgba(20, 16, 10, 0.85)";
          pip.style.border = "2px solid rgba(201, 162, 76, 0.55)";
        }
        pipRow.appendChild(pip);
      }
      barWrap.appendChild(pipRow);
      row.appendChild(barWrap);

      // Count.
      const num = document.createElement("div");
      num.style.fontFamily = "monospace, ui-monospace";
      num.style.fontSize = "0.8rem";
      num.style.color = cr.got > 0 ? "#f3c34c" : "#9a8c5c";
      num.style.textAlign = "right";
      num.style.fontWeight = cr.got === tot && tot > 0 ? "700" : "500";
      num.textContent = cr.got + "/" + tot;
      row.appendChild(num);

      rowsContainer.appendChild(row);
    }
    section.appendChild(rowsContainer);
    stack.appendChild(section);
  }
  host.appendChild(stack);
  dlog("triumph completion rendered; civs=", civRows.length, "age=", age);
  return null;
}

// Triumph Stack Over Time — per-civ stacked-area chart of cumulative triumph
// counts over the sample history, stacked by attribute.
export function collectTriumphCivOptions(history) {
  const samps = history && Array.isArray(history.samples) ? history.samples : [];
  const seen = new Map();
  for (const s of samps) {
    if (!s?.players) continue;
    for (const pid of Object.keys(s.players)) {
      if (seen.has(pid)) continue;
      const ps = s.players[pid];
      seen.set(pid, {
        pid,
        label: ps.leaderName
          ? ps.civName
            ? ps.leaderName + " (" + ps.civName + ")"
            : ps.leaderName
          : "Player " + pid
      });
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
