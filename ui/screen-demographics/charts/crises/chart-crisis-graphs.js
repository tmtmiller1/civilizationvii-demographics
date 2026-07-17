// chart-crisis-graphs.js
//
// The Crises "Graphs" sub-tab: every crisis statistic plotted per civ over the
// WHOLE game (all ages), as a scrollable grid of small line charts ("small
// multiples"), one per metric. Unlike the War Graphs tab (scoped to one war's
// window + that war's belligerents), this shows ALL civilizations across ALL
// samples, driven by the same crisis-cost metric set as the Crises table.
//
// A single shared legend (one swatch per civ) sits above the grid; toggling a
// civ hides/shows its line in EVERY graph at once. Per-civ series, colors, and
// X positions (laid out across age boundaries) come from buildSeriesFromHistory,
// the same builder the main historical line chart uses - so identity, colors,
// and the unmet-spoiler gate all match.

import { buildSeriesFromHistory } from "/demographics/ui/screen-demographics/charts/line/chart-line-series.js";
import {
  buildLineChartFromSeries,
  buildPlot
} from "/demographics/ui/screen-demographics/charts/wars/chart-war-mini-chart.js";
import {
  attachHover,
  buildNoData
} from "/demographics/ui/screen-demographics/charts/wars/chart-war-graphs-hover.js";
import {
  COST_METRICS,
  buildCostIcon,
  graphMetricTitle
} from "/demographics/ui/screen-demographics/charts/conflicts/chart-conflicts-cost.js";
import { computeAgeOffsets, sampleX } from "/demographics/ui/screen-demographics/charts/line/chart-line-axis.js";
import {
  crisisStageOnsets,
  CRISIS_STAGE_COLORS,
  CRISIS_STAGE_LABELS
} from "/demographics/ui/screen-demographics/charts/crises/crisis-stage-data.js";
import { t } from "/demographics/ui/core/demographics-i18n.js";

/**
 * Which snapshot.metrics series each crisis-cost metric is graphed from. Most
 * cost ids ARE the sampled key; the two military ids map to their level / running
 * loss counters.
 * @type {Record<string, string>}
 */
const SERIES_KEY = { milpowerLevel: "milpower", milpower: "milLostCum" };

/**
 * Y-axis unit (LOC tag) per crisis-cost metric id; reused from the war graphs.
 * @type {Record<string, string>}
 */
const Y_LABEL = {
  milpowerLevel: "LOC_DEMOGRAPHICS_WAR_GRAPHS_Y_STRENGTH",
  milpower: "LOC_DEMOGRAPHICS_WAR_GRAPHS_Y_STRENGTH",
  cityWarNetCum: "LOC_DEMOGRAPHICS_WAR_GRAPHS_Y_CITIES",
  warLandCum: "LOC_DEMOGRAPHICS_WAR_GRAPHS_Y_LAND",
  populationRaw: "LOC_DEMOGRAPHICS_WAR_GRAPHS_Y_POP",
  crops: "LOC_DEMOGRAPHICS_WAR_GRAPHS_Y_CROPS",
  production: "LOC_DEMOGRAPHICS_WAR_GRAPHS_Y_PROD"
};

/**
 * The graphed metrics: the crisis-cost set (war-cost metrics minus the war-only
 * "Directed to War" + "Settlements Razed"), each tagged with its series key and
 * Y-axis unit.
 * @type {{ id: string, label: string, blp: string, series: string, yLabel: string }[]}
 */
const CRISIS_GRAPH_METRICS = COST_METRICS.filter(
  (m) => m.id !== "warProdCum" && m.id !== "razedCum"
).map((m) => ({ ...m, series: SERIES_KEY[m.id] || m.id, yLabel: Y_LABEL[m.id] || "" }));

/**
 * Dropdown scope label (LOC tag) per crisis-bearing age. Each age runs its own
 * crisis; this lets the user view one age's crisis in isolation.
 * @type {Record<string, string>}
 */
const AGE_SCOPE_LABEL = {
  AGE_ANTIQUITY: "LOC_DEMOGRAPHICS_CRISIS_SCOPE_AGE_ANTIQUITY",
  AGE_EXPLORATION: "LOC_DEMOGRAPHICS_CRISIS_SCOPE_AGE_EXPLORATION",
  AGE_MODERN: "LOC_DEMOGRAPHICS_CRISIS_SCOPE_AGE_MODERN"
};

/**
 * The distinct ages that have at least one crisis onset, in chronological
 * (first-seen) order, plus the most recent such age. Ages only ever advance, so
 * the last first-seen age is the newest crisis.
 * @param {*} history The history blob.
 * @returns {{ ages: string[], latest: (string|undefined) }} Crisis ages + newest.
 */
function crisisAges(history) {
  const samples = Array.isArray(history.samples) ? history.samples : [];
  const seen = [];
  const set = new Set();
  for (const o of crisisStageOnsets(samples)) {
    const age = o.sample && typeof o.sample.age === "string" ? o.sample.age : undefined;
    if (!age || set.has(age)) continue;
    set.add(age);
    seen.push(age);
  }
  return { ages: seen, latest: seen.length ? seen[seen.length - 1] : undefined };
}

/**
 * The selectable crisis scopes for the toolbar dropdown: an "All Ages" combined
 * view followed by one entry per crisis-bearing age. Returns [] until a SECOND
 * crisis exists, so the dropdown only appears once (e.g.) the Exploration crisis
 * has begun - a single Antiquity crisis needs no selector.
 * @param {*} history The history blob.
 * @returns {{ id: string, label: string }[]} The scope options ([] when < 2 crises).
 */
export function collectCrisisScopes(history) {
  const { ages } = crisisAges(history || {});
  if (ages.length < 2) return [];
  const scopes = [{ id: "all", label: t("LOC_DEMOGRAPHICS_CRISIS_SCOPE_ALL") }];
  for (const age of ages) {
    scopes.push({ id: age, label: t(AGE_SCOPE_LABEL[age] || "") || age });
  }
  return scopes;
}

/**
 * Resolve a stored scope id - which may be the "latest" sentinel (follow the
 * newest crisis), "all", a concrete age, or a stale age from an earlier game -
 * to a concrete render scope. Returns "all" whenever fewer than two crises
 * exist, so single-crisis games render exactly as before.
 * @param {*} history The history blob.
 * @param {*} scopeId The stored scope selection.
 * @returns {string} "all" or a concrete age type.
 */
export function resolveCrisisScope(history, scopeId) {
  const { ages, latest } = crisisAges(history || {});
  if (ages.length < 2) return "all";
  if (scopeId === "all") return "all";
  if (typeof scopeId === "string" && ages.includes(scopeId)) return scopeId;
  return latest || "all";
}

/** Stable series keys (civ identities) the user has toggled off, shared by all graphs. */
const hiddenKeys = new Set();

/**
 * Cache of parsed series keyed by (history object identity → series key). A
 * legend toggle re-renders the whole grid via renderInto, which previously
 * re-walked the ENTIRE sample stream once PER metric (~7×) on every click even
 * though only the hiddenKeys VISIBILITY filter changed. Keying on the history
 * object means a toggle (same history) reuses the parsed raw series, while fresh
 * data (a new history object) misses and rebuilds. Raw series are never mutated
 * downstream (seriesFor/canonicalRoster clip+map into new arrays), so sharing
 * the cached arrays is safe.
 * @type {WeakMap<object, Map<string, any[]>>}
 */
const _rawSeriesCache = new WeakMap();

/**
 * Parse (or reuse a cached) per-civ series for one metric out of `history`.
 * @param {*} history The history blob.
 * @param {string} seriesKey The metric series id.
 * @returns {any[]} The raw per-civ series array.
 */
function rawSeriesFor(history, seriesKey) {
  if (!history || typeof history !== "object") {
    return buildSeriesFromHistory(history, seriesKey).series;
  }
  let byKey = _rawSeriesCache.get(history);
  if (!byKey) {
    byKey = new Map();
    _rawSeriesCache.set(history, byKey);
  }
  let raw = byKey.get(seriesKey);
  if (!raw) {
    raw = buildSeriesFromHistory(history, seriesKey).series;
    byKey.set(seriesKey, raw);
  }
  return raw;
}

/**
 * Drop hidden-civ keys not present in the current roster, so a stale toggle from
 * an earlier history/game can't linger or coincidentally match a reused leader
 * key. Keeps the module-global set bounded to the civs actually on screen.
 * @param {{ key: string }[]} roster The current civ roster.
 */
function pruneHiddenKeys(roster) {
  const valid = new Set(roster.map((c) => c.key));
  for (const key of hiddenKeys) if (!valid.has(key)) hiddenKeys.delete(key);
}

/**
 * Remove every child of `host`.
 * @param {HTMLElement} host The element to clear.
 */
function clearHost(host) {
  while (host.firstChild) host.removeChild(host.firstChild);
}

/**
 * Append a centered empty-state message.
 * @param {HTMLElement} host The host.
 * @param {string} msg The message.
 */
function appendEmpty(host, msg) {
  const el = document.createElement("div");
  el.className = "demographics-war-graphs-empty";
  el.textContent = msg;
  host.appendChild(el);
}

/**
 * The canonical civ roster: every civ that has military-power data, with its
 * stable key, display name, and deconflicted line color - the single source of
 * truth for the legend and for coloring every graph's lines consistently.
 * @param {*} history The history blob.
 * @returns {{ key: string, name: string, color: string }[]} The roster.
 */
function canonicalRoster(history) {
  const raw = rawSeriesFor(history, "milpower");
  return raw.map((s) => ({ key: s.leaderType, name: s.name, color: s.color }));
}

/** Lead-in (in chart-X turns) shown before the first crisis onset. */
const PRE_CRISIS_LEAD = 8;

/**
 * Build one metric's per-civ series (points mapped to chart-X/Y), colored from
 * the canonical roster, filtered to the civs not toggled off, and clipped to the
 * shared x-domain start (so the long pre-crisis run isn't plotted).
 * @param {{ series: string }} m The crisis graph metric.
 * @param {*} history The history blob.
 * @param {Map<string, { name: string, color: string }>} rosterMap Key -> identity.
 * @param {number|undefined} minX The earliest chart-X to keep (or undefined for all).
 * @param {number|undefined} maxX The latest chart-X to keep (or undefined for all).
 * @returns {{ name: string, color: string, points: { x: number, y: number }[] }[]} The series.
 */
function seriesFor(m, history, rosterMap, minX, maxX) {
  const raw = rawSeriesFor(history, m.series);
  const out = [];
  for (const s of raw) {
    if (hiddenKeys.has(s.leaderType)) continue;
    const points = clipPoints(s.points, minX, maxX);
    if (!points.length) continue;
    const meta = rosterMap.get(s.leaderType);
    out.push({ name: meta ? meta.name : s.name, color: meta ? meta.color : s.color, points });
  }
  return out;
}

/**
 * Map a sampled series' points to chart {x,y}, dropping any outside the shared
 * x-window so a scoped view doesn't draw the other ages' runs.
 * @param {{ t: number, v: number }[]} rawPoints The series points.
 * @param {number|undefined} minX The earliest chart-X to keep (or undefined for all).
 * @param {number|undefined} maxX The latest chart-X to keep (or undefined for all).
 * @returns {{ x: number, y: number }[]} The clipped points.
 */
function clipPoints(rawPoints, minX, maxX) {
  const points = [];
  for (const p of rawPoints) {
    if (typeof minX === "number" && p.t < minX) continue;
    if (typeof maxX === "number" && p.t > maxX) continue;
    points.push({ x: p.t, y: p.v });
  }
  return points;
}

/**
 * Build the crisis-stage onset markers AND the shared x-domain in chart-X space.
 * Every onset's sample is mapped through the same age-offset layout the series
 * use, paired with its stage color + label. The shared x-domain is applied to
 * every graph so they share one time scale (markers line up across all graphs);
 * it starts a short lead before the FIRST crisis onset rather than at the game's
 * first turn, so the long pre-crisis stretch isn't shown.
 * When `scopeAge` is a concrete age (not "all"), only that age's onsets and
 * samples are considered, so the graphs zoom to that single crisis's window.
 * @param {*} history The history blob.
 * @param {string} scopeAge "all" or the age type to isolate.
 * @returns {{ markers: { x: number, color: string, label: string }[],
 *   xDomain: ({ xMin: number, xMax: number }|null) }}
 *   The markers and the shared x-domain.
 */
function crisisAxis(history, scopeAge) {
  const samples = Array.isArray(history.samples) ? history.samples : [];
  const boundaries = Array.isArray(history.ageBoundaries) ? history.ageBoundaries : [];
  const { offsets } = computeAgeOffsets(samples, boundaries);
  const { lo, hi } = scopeXRange(samples, offsets, boundaries, scopeAge);
  const { markers, firstOnset } = buildCrisisMarkers(samples, offsets, boundaries, scopeAge);
  if (!isFinite(lo) || !isFinite(hi)) return { markers, xDomain: null };
  const xMin =
    markers.length && isFinite(firstOnset)
      ? Math.max(lo, firstOnset - PRE_CRISIS_LEAD)
      : lo;
  return { markers, xDomain: { xMin, xMax: hi } };
}

/**
 * The chart-X range to plot: the whole game for "all", or just the samples of
 * one age when scoped to a single crisis.
 * @param {Snapshot[]} samples The sample stream.
 * @param {Map<string, number>} offsets The age offsets.
 * @param {*[]} boundaries The age boundary table.
 * @param {string} scopeAge "all" or the age type to isolate.
 * @returns {{ lo: number, hi: number }} The chart-X range.
 */
function scopeXRange(samples, offsets, boundaries, scopeAge) {
  const scoped =
    scopeAge && scopeAge !== "all"
      ? samples.filter((s) => s && s.age === scopeAge)
      : samples;
  return sampleXRange(scoped, offsets, boundaries);
}

/**
 * The min/max chart-X across all samples.
 * @param {Snapshot[]} samples The sample stream.
 * @param {Map<string, number>} offsets The age offsets.
 * @param {*[]} boundaries The age boundary table.
 * @returns {{ lo: number, hi: number }} The chart-X range (Infinity/-Infinity when empty).
 */
function sampleXRange(samples, offsets, boundaries) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of samples) {
    const x = sampleX(s, offsets, boundaries);
    if (typeof x !== "number") continue;
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  return { lo, hi };
}

/**
 * Build the crisis-stage onset markers (chart-X, stage color, stage label) and
 * the earliest onset's chart-X.
 * @param {Snapshot[]} samples The sample stream.
 * @param {Map<string, number>} offsets The age offsets.
 * @param {*[]} boundaries The age boundary table.
 * @param {string} scopeAge "all", or an age type to keep only that crisis's onsets.
 * @returns {{ markers: { x: number, color: string, label: string }[],
 *   firstOnset: number }} The markers + first onset.
 */
function buildCrisisMarkers(samples, offsets, boundaries, scopeAge) {
  const markers = [];
  let firstOnset = Infinity;
  for (const o of crisisStageOnsets(samples)) {
    if (scopeAge && scopeAge !== "all" && o.sample && o.sample.age !== scopeAge) continue;
    const x = sampleX(o.sample, offsets, boundaries);
    if (typeof x !== "number") continue;
    if (x < firstOnset) firstOnset = x;
    const idx = Math.max(0, Math.min(3, o.stage - 1));
    markers.push({ x, color: CRISIS_STAGE_COLORS[idx], label: t(CRISIS_STAGE_LABELS[idx]) });
  }
  return { markers, firstOnset };
}

/**
 * Build a metric cell head: the cost icon + the shared metric title (so titles
 * match the war graphs + the war-timeline tooltip).
 * @param {*} m The crisis graph metric.
 * @returns {HTMLElement} The head element.
 */
function buildCellHead(m) {
  const head = document.createElement("div");
  head.className = "demographics-war-graph-cell-head";
  if (m.blp) head.appendChild(buildCostIcon(m.blp));
  const title = document.createElement("span");
  title.textContent = graphMetricTitle(m);
  head.appendChild(title);
  return head;
}

/**
 * Build one metric cell: head, then the line chart (or a no-data note).
 * @param {*} m The crisis graph metric.
 * @param {*} history The history blob.
 * @param {Map<string, { name: string, color: string }>} rosterMap Key -> identity.
 * @param {{ markers: *[], xDomain: * }} axis The shared markers + x-domain.
 * @returns {HTMLElement} The cell element.
 */
function buildCell(m, history, rosterMap, axis) {
  const cell = document.createElement("div");
  cell.className = "demographics-war-graph-cell";
  cell.appendChild(buildCellHead(m));
  const chart = buildLineChartFromSeries(
    seriesFor(
      m,
      history,
      rosterMap,
      axis.xDomain ? axis.xDomain.xMin : undefined,
      axis.xDomain ? axis.xDomain.xMax : undefined
    ),
    m.yLabel,
    axis.markers,
    axis.xDomain
  );
  if (!chart) {
    cell.appendChild(buildNoData());
    return cell;
  }
  cell.appendChild(buildPlot(chart.svg, chart.labels));
  if (chart.hover) attachHover(cell, chart.svg, chart.hover);
  return cell;
}

/**
 * Build an invisible filler cell that occupies one grid column (same flex size
 * as a real cell) so a partial last row doesn't stretch its real graph.
 * @returns {HTMLElement} The filler cell.
 */
function buildFillerCell() {
  const cell = document.createElement("div");
  cell.className = "demographics-war-graph-cell demographics-crisis-graph-filler";
  return cell;
}

/**
 * Build one clickable legend item (swatch + name); clicking toggles that civ
 * across every graph and re-renders.
 * @param {{ key: string, name: string, color: string }} civ The roster entry.
 * @param {() => void} onChange Re-render callback.
 * @returns {HTMLElement} The legend item.
 */
function buildLegendItem(civ, onChange) {
  const item = document.createElement("span");
  item.className = "demographics-war-graphs-legend-item demographics-crisis-graphs-legend-item";
  if (hiddenKeys.has(civ.key)) item.classList.add("is-hidden");
  const dot = document.createElement("span");
  dot.className = "demographics-war-graphs-legend-dot";
  dot.style.backgroundColor = civ.color;
  item.appendChild(dot);
  item.appendChild(document.createTextNode(civ.name));
  item.addEventListener("click", () => {
    if (hiddenKeys.has(civ.key)) hiddenKeys.delete(civ.key);
    else hiddenKeys.add(civ.key);
    onChange();
  });
  return item;
}

/**
 * Build the "All" / "None" bulk-select controls.
 * @param {{ key: string }[]} roster The civ roster.
 * @param {() => void} onChange Re-render callback.
 * @returns {HTMLElement} The controls row.
 */
function buildLegendControls(roster, onChange) {
  const row = document.createElement("div");
  row.className = "demographics-war-graph-filter demographics-crisis-graphs-controls";
  const all = document.createElement("div");
  all.className = "demographics-war-graph-filter-btn";
  all.textContent = t("LOC_DEMOGRAPHICS_CRISIS_GRAPHS_ALL");
  all.addEventListener("click", () => {
    hiddenKeys.clear();
    onChange();
  });
  const none = document.createElement("div");
  none.className = "demographics-war-graph-filter-btn";
  none.textContent = t("LOC_DEMOGRAPHICS_CRISIS_GRAPHS_NONE");
  none.addEventListener("click", () => {
    for (const civ of roster) hiddenKeys.add(civ.key);
    onChange();
  });
  row.appendChild(all);
  row.appendChild(none);
  return row;
}

/**
 * Build the shared header: a title, the All/None controls, and the single
 * interactive civ legend that governs every graph at once.
 * @param {{ key: string, name: string, color: string }[]} roster The civ roster.
 * @param {() => void} onChange Re-render callback.
 * @returns {HTMLElement} The header element.
 */
function buildHeader(roster, onChange) {
  const head = document.createElement("div");
  head.className = "demographics-war-graphs-head";
  const title = document.createElement("div");
  title.className = "demographics-war-graphs-title";
  title.textContent = t("LOC_DEMOGRAPHICS_CRISIS_GRAPHS_LEGEND");
  head.appendChild(title);
  head.appendChild(buildLegendControls(roster, onChange));
  const legend = document.createElement("div");
  legend.className = "demographics-war-graphs-legend";
  for (const civ of roster) legend.appendChild(buildLegendItem(civ, onChange));
  head.appendChild(legend);
  return head;
}

/**
 * Render (or re-render) the Crisis Graphs panel into `host`.
 * @param {HTMLElement} host The chart host.
 * @param {{ history?: *, crisisAge?: * }} opts Render options.
 */
function renderInto(host, opts) {
  clearHost(host);
  const history = opts.history || {};
  const roster = canonicalRoster(history);
  if (!roster.length) {
    appendEmpty(host, t("LOC_DEMOGRAPHICS_CRISIS_GRAPHS_EMPTY"));
    return;
  }
  // Gate on a crisis actually having begun, exactly as the Crises "Stages" sub-tab does
  // (chart-crisis-stages.js). A non-empty roster only means civs exist, without this the graphs
  // would plot ordinary metric history before any crisis, reading as "crisis impact" that hasn't
  // happened yet.
  const samples = Array.isArray(history.samples) ? history.samples : [];
  if (!crisisStageOnsets(samples).length) {
    appendEmpty(host, t("LOC_DEMOGRAPHICS_CRISIS_EMPTY_NONE"));
    return;
  }
  pruneHiddenKeys(roster);
  const scopeAge = resolveCrisisScope(history, opts.crisisAge);
  const rosterMap = buildCrisisRosterMap(roster);
  const panel = buildCrisisPanel(host, opts, roster);
  const axis = crisisAxis(history, scopeAge);
  const grid = buildCrisisGrid(history, rosterMap, axis);
  panel.appendChild(grid);
  host.appendChild(panel);
}

/**
 * Build the key->display map used by crisis graph cells.
 * @param {{ key: string, name: string, color: string }[]} roster Civ roster.
 * @returns {Map<string, { name: string, color: string }>} Roster map.
 */
function buildCrisisRosterMap(roster) {
  return new Map(roster.map((c) => [c.key, { name: c.name, color: c.color }]));
}

/**
 * Build the crisis graph panel shell (container + header).
 * @param {HTMLElement} host The chart host.
 * @param {{ history?: * }} opts Render options.
 * @param {{ key: string, name: string, color: string }[]} roster Civ roster.
 * @returns {HTMLElement} Panel element.
 */
function buildCrisisPanel(host, opts, roster) {
  const panel = document.createElement("div");
  panel.className = "demographics-war-graphs demographics-crisis-graphs";
  panel.appendChild(buildHeader(roster, () => renderInto(host, opts)));
  return panel;
}

/**
 * Build the crisis graph grid and add filler cells for a stable 3-up layout.
 * @param {*} history The history blob.
 * @param {Map<string, { name: string, color: string }>} rosterMap Roster map.
 * @param {*} axis Shared axis domain.
 * @returns {HTMLElement} Grid element.
 */
function buildCrisisGrid(history, rosterMap, axis) {
  const grid = document.createElement("div");
  grid.className = "demographics-war-graphs-grid";
  for (const m of CRISIS_GRAPH_METRICS) {
    grid.appendChild(buildCell(m, history, rosterMap, axis));
  }
  const pad = (3 - (CRISIS_GRAPH_METRICS.length % 3)) % 3;
  for (let i = 0; i < pad; i++) grid.appendChild(buildFillerCell());
  return grid;
}

/**
 * Render the Crises "Graphs" sub-tab into `host`.
 * @param {HTMLElement} host The chart host (cleared and repopulated).
 * @param {{ history?: *, crisisAge?: * }} [opts] Render options (crisisAge scopes
 *   to one age's crisis: "all", a concrete age, or the "latest" sentinel).
 * @returns {null} Always null (no chart handle).
 */
export function renderCrisisGraphs(host, opts) {
  if (!host) return null;
  renderInto(host, opts || {});
  return null;
}
