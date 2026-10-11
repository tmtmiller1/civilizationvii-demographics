// chart-conflicts-graphs.js
//
// The Conflicts "War Graphs" sub-tab: pick a war from the toolbar dropdown and
// see each participant civ's trajectory for every war-cost metric over that
// war's window, as a scrollable grid of small line charts ("small multiples").
// Driven by COST_METRICS (each `id` is the snapshot.metrics key) over the same
// turn window the war tooltip uses, so the graphs and the tooltip stay in sync.

import {
  barLabels,
  buildCivBarSvg,
  buildLineChartFromSeries,
  buildMiniSvg,
  buildPlot,
  lineLabels
} from "/demographics/ui/screen-demographics/charts/wars/chart-war-mini-chart.js";
import { MIL_GRAPH_IDS, milSeriesFor } from "/demographics/ui/screen-demographics/charts/wars/chart-war-military.js";
import {
  buildSeries,
  lossSeriesCounter,
  lossSeriesDeclines,
  seriesBounds,
  windowNet
} from "/demographics/ui/screen-demographics/charts/wars/chart-war-series.js";
import {
  COST_METRICS,
  buildCostIcon,
  graphMetricTitle,
  warAgeScope
} from "/demographics/ui/screen-demographics/charts/conflicts/chart-conflicts-cost.js";
import { mergeWars, policyVisibleWars } from "/demographics/ui/screen-demographics/charts/wars/chart-wars-merge.js";
import { nameMergedWars } from "/demographics/ui/screen-demographics/charts/wars/chart-wars-naming.js";
import { t, tPlayerFallback } from "/demographics/ui/core/demographics-i18n.js";
import { scaleCasualtiesAt } from "/demographics/ui/metrics/demographics-metrics-helpers.js";
import {
  attachBarHover,
  attachHover,
  buildNoData,
  appendGraphsEmpty
} from "/demographics/ui/screen-demographics/charts/wars/chart-war-graphs-hover.js";
import { clearHost } from "/demographics/ui/screen-demographics/screen/dom-helpers.js";
import { makeLogger } from "/demographics/ui/core/demographics-log.js";

/**
 * Y-axis title (unit) per COST_METRICS id; the X axis is always the turn.
 * @type {Record<string, string>}
 */
const Y_LABEL = {
  milpower: "LOC_DEMOGRAPHICS_WAR_GRAPHS_Y_STRENGTH",
  cityWarNetCum: "LOC_DEMOGRAPHICS_WAR_GRAPHS_Y_CITIES",
  razedCum: "LOC_DEMOGRAPHICS_WAR_GRAPHS_Y_RAZED",
  warLandCum: "LOC_DEMOGRAPHICS_WAR_GRAPHS_Y_LAND",
  populationRaw: "LOC_DEMOGRAPHICS_WAR_GRAPHS_Y_POP",
  crops: "LOC_DEMOGRAPHICS_WAR_GRAPHS_Y_CROPS",
  production: "LOC_DEMOGRAPHICS_WAR_GRAPHS_Y_PROD",
  warProdCum: "LOC_DEMOGRAPHICS_WAR_GRAPHS_Y_WARPROD",
  milpowerLevel: "LOC_DEMOGRAPHICS_WAR_GRAPHS_Y_STRENGTH",
  unitsLostCum: "LOC_DEMOGRAPHICS_WAR_GRAPHS_Y_UNITS"
};

// For the click handlers that re-enter a render outside the initial render's guard.
const log = makeLogger("chart-conflicts-graphs");

/**
 * Run a re-render from a click handler. The initial render runs inside the view's safeCall, but a
 * click handler does not, so a throw here is logged rather than escaping the handler (the prior
 * DOM stays in place).
 * @param {string} what The re-render name (for the log line).
 * @param {() => void} fn
 */
function safeRerender(what, fn) {
  try {
    fn();
  } catch (e) {
    // Logged, not rethrown: the handler must not surface an uncaught error to the engine.
    log.error(what + " re-render failed:", e);
  }
}

/**
 * Resolve the war to display: the one matching `id`, else the most recent war.
 * @param {*[]} wars The history war list.
 * @param {*} id The selected warUniqueID (or null).
 * @returns {*} The war record, or null when there are no wars.
 */
function resolveWar(wars, id) {
  if (typeof id === "number") {
    const found = wars.find((w) => w && w.warUniqueID === id);
    if (found) return found;
  }
  return wars.length ? wars[wars.length - 1] : null;
}

/**
 * Whether a roster entry is a unique major participant row.
 * @param {*} entry
 * @param {Set<number>} seen
 * @returns {boolean}
 */
function includeMajorParticipant(entry, seen) {
  if (!entry || entry.isCS) return false;
  if (typeof entry.pid !== "number") return false;
  return !seen.has(entry.pid);
}

/**
 * @param {{ pid: number, name: string, color: string }[]} out
 * @param {Set<number>} seen
 * @param {*} entry
 */
function pushMajorParticipant(out, seen, entry) {
  seen.add(entry.pid);
  out.push({
    pid: entry.pid,
    name: entry.civ || tPlayerFallback(entry.pid),
    color: entry.color || "#9aa8c8"
  });
}

/**
 * The war's major participants (both sides), de-duplicated by pid.
 * @param {*} war
 * @returns {{ pid: number, name: string, color: string }[]}
 */
function warParticipants(war) {
  const rosters = /** @type {any[]} */ ([]).concat(war.sideACivs || [], war.sideBCivs || []);
  const seen = new Set();
  /** @type {{ pid: number, name: string, color: string }[]} */
  const out = [];
  for (const entry of rosters) {
    if (!includeMajorParticipant(entry, seen)) continue;
    pushMajorParticipant(out, seen, entry);
  }
  return out;
}

/**
 * A cell head: cost icon + metric title.
 * @param {*} metric A COST_METRICS entry.
 * @returns {HTMLElement}
 */
function buildCellHead(metric) {
  const head = document.createElement("div");
  head.className = "demographics-war-graph-cell-head";
  if (metric.blp) head.appendChild(buildCostIcon(metric.blp));
  const title = document.createElement("span");
  title.textContent = metricTitle(metric);
  // Surface the Guide's plain-language explanation as a hover tooltip on the
  // graph title, so the notes are available in context (not just on the Guide tab).
  if (metric.glossary) {
    title.setAttribute("data-tooltip-content", t(metric.glossary));
    title.style.cursor = "help";
  }
  head.appendChild(title);
  return head;
}

/**
 * Build one metric cell. The two military graphs get a 3-way filter (belligerent
 * civs / city-state allies / cumulative allied); the rest are plain.
 * @param {*} metric A COST_METRICS entry.
 * @param {{ war: *, participants: { pid: number, name: string,
 *   color: string }[], win: Snapshot[] }} view
 * @returns {HTMLElement}
 */
function buildMetricCell(metric, view) {
  if (MIL_GRAPH_IDS.has(metric.id)) return buildMilitaryCell(metric, view);
  if (metric.id === "unitsLostCum") return buildCasualtyCell(metric, view);
  return buildPlainMetricCell(metric, visibleParticipants(view.participants), view.win);
}

/** The two casualties-graph representation modes: raw unit count vs scaled "soldiers killed". */
const CAS_MODES = [
  { id: "units", label: "LOC_DEMOGRAPHICS_WAR_GRAPHS_CAS_UNITS", y: "LOC_DEMOGRAPHICS_WAR_GRAPHS_Y_UNITS" },
  { id: "scaled", label: "LOC_DEMOGRAPHICS_WAR_GRAPHS_CAS_SCALED", y: "LOC_DEMOGRAPHICS_WAR_GRAPHS_Y_SOLDIERS" }
];

/** Current representation per casualties graph id (persists across re-renders). */
const casMode = /** @type {Record<string, string>} */ ({});

/**
 * Build the casualties graph cell: head, a 2-way Units / Scaled toggle, then a body
 * that re-renders in place. "Scaled" multiplies the loss line by the era's
 * soldiers-per-unit factor (scaleCasualties), matching the war tooltip's estimate.
 * @param {*} metric The COST_METRICS entry.
 * @param {{ war: *, participants: *[], win: Snapshot[] }} view
 * @returns {HTMLElement}
 */
function buildCasualtyCell(metric, view) {
  const cell = document.createElement("div");
  cell.className = "demographics-war-graph-cell";
  cell.appendChild(buildCellHead(metric));
  const body = document.createElement("div");
  body.className = "demographics-war-graph-mil-body";
  cell.appendChild(buildCasToggle(metric, view, body));
  cell.appendChild(body);
  renderCasualtyChart(metric, view, body, casMode[metric.id] || "units");
  return cell;
}

/**
 * Build the 2-way Units ↔ Scaled toggle pills for the casualties graph; clicking re-renders the
 * body.
 * @param {*} metric The COST_METRICS entry.
 * @param {{ war: *, participants: *[], win: Snapshot[] }} view
 * @param {HTMLElement} body The chart body to re-render.
 * @returns {HTMLElement}
 */
function buildCasToggle(metric, view, body) {
  const row = document.createElement("div");
  row.className = "demographics-war-graph-filter";
  for (const mode of CAS_MODES) {
    const btn = document.createElement("div");
    btn.className = "demographics-war-graph-filter-btn";
    btn.textContent = t(mode.label);
    if ((casMode[metric.id] || "units") === mode.id) btn.classList.add("is-active");
    btn.addEventListener("click", () => {
      casMode[metric.id] = mode.id;
      for (const pill of Array.from(row.children)) pill.classList.remove("is-active");
      btn.classList.add("is-active");
      safeRerender("renderCasualtyChart", () => renderCasualtyChart(metric, view, body, mode.id));
    });
    row.appendChild(btn);
  }
  return row;
}

/**
 * Render (or re-render) the casualties chart for the chosen representation. "scaled" multiplies
 * every loss-line value by scaleCasualties at the war-end era (a constant, so the shape is
 * unchanged).
 * @param {*} metric The COST_METRICS entry.
 * @param {{ war: *, participants: *[], win: Snapshot[] }} view
 * @param {HTMLElement} body
 * @param {string} mode The active representation id ("units" | "scaled").
 */
function renderCasualtyChart(metric, view, body, mode) {
  while (body.firstChild) body.removeChild(body.firstChild);
  const win = view.win;
  const parts = visibleParticipants(view.participants);
  let seriesList = parts.map((p) => lossSeriesCounter(p, win, "unitsLostCum", "milpower"));
  const ySpec = mode === "scaled" ? CAS_MODES[1].y : CAS_MODES[0].y;
  if (mode === "scaled") {
    const endTurn = win.length ? Number(win[win.length - 1]?.turn) || 0 : 0;
    const factor = scaleCasualtiesAt(1, endTurn); // soldiers per unit at the war's end era
    seriesList = seriesList.map((series) => ({
      ...series,
      points: series.points.map((pt) => ({ x: pt.x, y: pt.y * factor }))
    }));
  }
  const chart = buildLineChartFromSeries(seriesList, ySpec);
  if (!chart) {
    body.appendChild(buildNoData());
    return;
  }
  body.appendChild(buildPlot(chart.svg, chart.labels));
  if (chart.hover) {
    chart.hover.blp = metric.blp;
    attachHover(body, chart.svg, chart.hover);
  }
}

/**
 * Build a plain (non-military) metric cell: head, then the mini chart (or a
 * no-data note).
 * @param {*} metric A COST_METRICS entry.
 * @param {{ pid: number, name: string, color: string }[]} participants
 * @param {Snapshot[]} win The windowed samples.
 * @returns {HTMLElement}
 */
function buildPlainMetricCell(metric, participants, win) {
  const cell = document.createElement("div");
  cell.className = "demographics-war-graph-cell";
  cell.appendChild(buildCellHead(metric));

  const chart = buildChart(metric, participants, win);
  if (!chart) {
    cell.appendChild(buildNoData());
    return cell;
  }
  cell.appendChild(buildPlot(chart.svg, chart.labels));
  if (chart.hover) attachHover(cell, chart.svg, chart.hover);
  if (chart.bars) attachBarHover(cell, chart.bars, metricTitle(metric), metric.blp);
  return cell;
}

/** The three filter modes for the military graphs. */
const MIL_FILTER_MODES = [
  { id: "belligerents", label: "LOC_DEMOGRAPHICS_WAR_GRAPHS_FILTER_BELLIGERENTS" },
  { id: "cs", label: "LOC_DEMOGRAPHICS_WAR_GRAPHS_FILTER_CS" },
  { id: "cumulative", label: "LOC_DEMOGRAPHICS_WAR_GRAPHS_FILTER_CUMULATIVE" }
];

/** Current filter mode per military graph id (persists across re-renders). */
const milFilterMode = /** @type {Record<string, string>} */ ({});

/** Belligerent civ pids hidden from every war graph (toggled via the legend). */
const hiddenWarCivs = new Set();

/**
 * Filter a participant list to those not hidden via the legend.
 * @param {{ pid: number }[]} participants
 * @returns {*[]}
 */
function visibleParticipants(participants) {
  return participants.filter((p) => !hiddenWarCivs.has(p.pid));
}

/**
 * Drop hidden pids not among the current war's participants, so a toggle from a
 * previously-viewed war can't linger when switching wars.
 * @param {{ pid: number }[]} participants The current war's participants.
 */
function pruneHiddenWarCivs(participants) {
  const valid = new Set(participants.map((p) => p.pid));
  for (const pid of hiddenWarCivs) if (!valid.has(pid)) hiddenWarCivs.delete(pid);
}

/**
 * Build a military graph cell: head, a 3-way filter row, then a chart body that
 * re-renders in place when the filter changes.
 * @param {*} metric A COST_METRICS entry (milpower / milpowerLevel).
 * @param {{ war: *, participants: *[], win: Snapshot[] }} view
 * @returns {HTMLElement}
 */
function buildMilitaryCell(metric, view) {
  const cell = document.createElement("div");
  cell.className = "demographics-war-graph-cell";
  cell.appendChild(buildCellHead(metric));
  const body = document.createElement("div");
  body.className = "demographics-war-graph-mil-body";
  cell.appendChild(buildMilFilter(metric, view, body));
  cell.appendChild(body);
  renderMilChart(metric, view, body, milFilterMode[metric.id] || "belligerents");
  return cell;
}

/**
 * Build the 3-way filter pill row for a military graph; clicking re-renders the
 * chart body in place and remembers the choice.
 * @param {*} metric The COST_METRICS entry.
 * @param {{ war: *, participants: *[], win: Snapshot[] }} view
 * @param {HTMLElement} body The chart body to re-render.
 * @returns {HTMLElement}
 */
function buildMilFilter(metric, view, body) {
  const row = document.createElement("div");
  row.className = "demographics-war-graph-filter";
  for (const mode of MIL_FILTER_MODES) {
    const btn = document.createElement("div");
    btn.className = "demographics-war-graph-filter-btn";
    btn.textContent = t(mode.label);
    if ((milFilterMode[metric.id] || "belligerents") === mode.id) btn.classList.add("is-active");
    btn.addEventListener("click", () => {
      milFilterMode[metric.id] = mode.id;
      for (const pill of Array.from(row.children)) pill.classList.remove("is-active");
      btn.classList.add("is-active");
      safeRerender("renderMilChart", () => renderMilChart(metric, view, body, mode.id));
    });
    row.appendChild(btn);
  }
  return row;
}

/**
 * Render (or re-render) a military graph's chart body for the chosen filter mode.
 * @param {*} metric The COST_METRICS entry.
 * @param {{ war: *, participants: *[], win: Snapshot[] }} view
 * @param {HTMLElement} body
 * @param {string} mode The active filter mode id.
 */
function renderMilChart(metric, view, body, mode) {
  while (body.firstChild) body.removeChild(body.firstChild);
  const isLoss = metric.id === "milpower";
  const seriesList = milSeriesFor(view, mode, isLoss, visibleParticipants(view.participants));
  const chart = buildLineChartFromSeries(seriesList, Y_LABEL[metric.id]);
  if (!chart) {
    body.appendChild(buildNoData());
    return;
  }
  body.appendChild(buildPlot(chart.svg, chart.labels));
  // buildLineChartFromSeries doesn't know the cost metric, so graft on the BLP
  // here; otherwise the two military graphs' hover headers lack the cost icon
  // the other seven graphs show.
  if (chart.hover) {
    chart.hover.blp = metric.blp;
    attachHover(body, chart.svg, chart.hover);
  }
}

/**
 * Build the "cities gained/lost" chart: one zero-centered bar per participant,
 * its height the net cities won (above) or lost (below) through capture, read
 * from `cityWarNetCum`. Returns null when no civ has capture data.
 * @param {{ pid: number, name: string, color: string }[]} participants
 * @param {Snapshot[]} win The windowed samples.
 * @param {string} metricId The cumulative metric key ("cityWarNetCum").
 * @returns {{ svg: SVGElement, civs: { name: string, color: string,
 *   net: number }[], m: number } | null}
 *   The chart, per-civ nets, and symmetric extent, or null.
 */
function buildSettlementsBars(participants, win, metricId) {
  const civs = [];
  let maxMagnitude = 0;
  for (const participant of participants) {
    const net = windowNet(participant, win, metricId);
    if (net === null) continue;
    civs.push({ name: participant.name, color: participant.color, net });
    if (Math.abs(net) > maxMagnitude) maxMagnitude = Math.abs(net);
  }
  if (!civs.length) return null;
  const extent = Math.max(maxMagnitude, 1);
  return { svg: buildCivBarSvg(civs, extent), civs, m: extent };
}

/**
 * Per-metric graph rendering, keyed by COST_METRICS id. "bars" is one
 * zero-centered bar per civ; "loss" is a cumulative-loss line plotted negative
 * (`counter`/`fallback` pick the source); "level" (or absent) is a plain line
 * (`series` overrides the snapshot.metrics key). `title` overrides the row label.
 * @type {Record<string, {
 *   kind?: string,
 *   title?: string,
 *   counter?: string,
 *   fallback?: string,
 *   series?: string
 * }>}
 */
const GRAPH_SPEC = {
  cityWarNetCum: { kind: "bars", title: "LOC_DEMOGRAPHICS_WAR_GRAPHS_T_SETTLEMENTS" },
  razedCum: { title: "LOC_DEMOGRAPHICS_WAR_GRAPHS_T_RAZED" },
  milpower: {
    kind: "loss",
    title: "LOC_DEMOGRAPHICS_WAR_GRAPHS_T_STRENGTH",
    counter: "milLostCum",
    fallback: "milpower"
  },
  warLandCum: { kind: "loss", title: "LOC_DEMOGRAPHICS_WAR_GRAPHS_T_LAND" },
  populationRaw: { kind: "loss", title: "LOC_DEMOGRAPHICS_WAR_GRAPHS_T_POP" },
  crops: { kind: "loss", title: "LOC_DEMOGRAPHICS_WARS_COST_LBL_CROPLOST" },
  production: { kind: "loss", title: "LOC_DEMOGRAPHICS_WARS_COST_LBL_PRODLOST" },
  // Level line of cumulative production directed to war; clarified title.
  warProdCum: { title: "LOC_DEMOGRAPHICS_WAR_GRAPHS_T_WARPROD" },
  // 9th graph: standing army strength over the war (a level line, not a loss).
  milpowerLevel: { series: "milpower" },
  // Units lost (body count): cumulative-loss line from the unitsLostCum counter; toggles raw ↔
  // scaled.
  unitsLostCum: { kind: "loss", counter: "unitsLostCum", fallback: "milpower" }
};

/**
 * Graph-only descriptors appended after the eight cost metrics. Same shape the
 * cell builder expects ({ id, label, blp }); their behavior comes from GRAPH_SPEC.
 * @type {{ id: string, label: string, blp: string }[]}
 */
const EXTRA_GRAPHS = [
  {
    id: "milpowerLevel",
    label: "LOC_DEMOGRAPHICS_WAR_GRAPHS_MILPOWER",
    blp: "blp:fi_military_64"
  }
];

/** Every graph descriptor by id (cost metrics + extras), for explicit ordering. */
const GRAPH_BY_ID = /** @type {Record<string, any>} */ ({});
for (const metric of COST_METRICS) GRAPH_BY_ID[metric.id] = metric;
for (const metric of EXTRA_GRAPHS) GRAPH_BY_ID[metric.id] = metric;

/** War Graphs display order: three rows of three. */
const GRAPH_ORDER = [
  "milpowerLevel", // Military Power
  "milpower", // Military Power Lost
  "unitsLostCum", // Units Lost (count ↔ scaled toggle)
  "warProdCum", // Prod. Directed to War
  "cityWarNetCum", // Settlements Lost/Gained
  "razedCum", // Settlements Razed
  "warLandCum", // Land Area Lost
  "populationRaw", // Population Lost
  "production", // Production Lost
  "crops" // Crop Yield Lost
];

/** The ordered War Graphs list. */
const GRAPH_METRICS = GRAPH_ORDER.map((id) => GRAPH_BY_ID[id]).filter(Boolean);

/**
 * Build the chart for one metric per {@link GRAPH_SPEC}. Returns null when
 * there's no data. The `hover` field carries the per-civ series + bounds for the
 * crosshair tooltip (null for the bar chart, which isn't a time series).
 * @param {*} metric A COST_METRICS entry.
 * @param {{ pid: number, name: string, color: string }[]} participants
 * @param {Snapshot[]} win The windowed samples.
 * @returns {{ svg: SVGElement, hover: { series: *[], bounds: *,
 *   yLabel: string } | null, bars?: *[], labels: * } | null}
 */
function buildChart(metric, participants, win) {
  const spec = GRAPH_SPEC[metric.id];
  const yLabel = t(Y_LABEL[metric.id] || "");
  if (spec?.kind === "bars") {
    const settlement = buildSettlementsBars(participants, win, metric.id);
    if (!settlement) return null;
    return {
      svg: settlement.svg,
      hover: null,
      bars: settlement.civs,
      labels: barLabels(yLabel, settlement.m)
    };
  }
  const seriesList = buildMetricSeries(spec, participants, win, metric.id);
  const bounds = seriesBounds(seriesList);
  if (!bounds) return null;
  const hover = { series: seriesList, bounds, yLabel, blp: metric.blp };
  return { svg: buildMiniSvg(seriesList, bounds), hover, labels: lineLabels(yLabel, bounds) };
}

/**
 * Resolve one metric's series list by graph spec kind.
 * @param {*} spec A GRAPH_SPEC entry.
 * @param {{ pid: number, name: string, color: string }[]} participants
 * @param {Snapshot[]} win Windowed samples.
 * @param {string} metricId
 * @returns {*[]}
 */
function buildMetricSeries(spec, participants, win, metricId) {
  if (spec?.kind === "loss") {
    return participants.map((p) =>
      spec.counter
        ? lossSeriesCounter(p, win, spec.counter, spec.fallback || metricId)
        : lossSeriesDeclines(p, win, metricId)
    );
  }
  const key = spec?.series || metricId;
  return participants.map((p) => buildSeries(p, win, key));
}

/**
 * The chart title for a metric: the shared descriptive title, so it always
 * matches the war-timeline tooltip's prose labels.
 * @param {*} metric A COST_METRICS entry.
 * @returns {string} Localized.
 */
function metricTitle(metric) {
  return graphMetricTitle(metric);
}

/**
 * Build the "All" / "None" bulk-select controls that show or hide every
 * belligerent civ at once across all war graphs.
 * @param {{ pid: number }[]} participants
 * @param {() => void} onChange Re-render callback.
 * @returns {HTMLElement}
 */
function buildLegendControls(participants, onChange) {
  const row = document.createElement("div");
  row.className = "demographics-war-graph-filter demographics-war-graphs-controls";
  const all = document.createElement("div");
  all.className = "demographics-war-graph-filter-btn";
  all.textContent = t("LOC_DEMOGRAPHICS_WAR_GRAPHS_ALL");
  all.addEventListener("click", () => {
    hiddenWarCivs.clear();
    onChange();
  });
  const none = document.createElement("div");
  none.className = "demographics-war-graph-filter-btn";
  none.textContent = t("LOC_DEMOGRAPHICS_WAR_GRAPHS_NONE");
  none.addEventListener("click", () => {
    for (const participant of participants) hiddenWarCivs.add(participant.pid);
    onChange();
  });
  row.appendChild(all);
  row.appendChild(none);
  return row;
}

/**
 * Build one clickable legend item (swatch + name); clicking toggles that civ's
 * lines across the per-civ graphs and re-renders.
 * @param {{ pid: number, name: string, color: string }} participant
 * @param {() => void} onChange Re-render callback.
 * @returns {HTMLElement}
 */
function buildLegendItem(participant, onChange) {
  const item = document.createElement("span");
  item.className = "demographics-war-graphs-legend-item";
  if (hiddenWarCivs.has(participant.pid)) item.classList.add("is-hidden");
  const dot = document.createElement("span");
  dot.className = "demographics-war-graphs-legend-dot";
  dot.style.backgroundColor = participant.color;
  item.appendChild(dot);
  item.appendChild(document.createTextNode(participant.name));
  item.addEventListener("click", () => {
    if (hiddenWarCivs.has(participant.pid)) hiddenWarCivs.delete(participant.pid);
    else hiddenWarCivs.add(participant.pid);
    onChange();
  });
  return item;
}

/**
 * Build the header: the war name, the All/None controls, and the interactive
 * participant legend that governs the per-civ graphs.
 * @param {{ war: *, participants: { pid: number, name: string,
 *   color: string }[], warName?: string }} view
 * @param {() => void} onChange Re-render callback.
 * @returns {HTMLElement}
 */
function buildHeader(view, onChange) {
  const head = document.createElement("div");
  head.className = "demographics-war-graphs-head";
  const title = document.createElement("div");
  title.className = "demographics-war-graphs-title";
  title.textContent = view.warName || view.war.name || t("LOC_DEMOGRAPHICS_PAGE_CONFLICTS");
  head.appendChild(title);
  head.appendChild(buildLegendControls(view.participants, onChange));
  const legend = document.createElement("div");
  legend.className = "demographics-war-graphs-legend";
  for (const participant of view.participants) legend.appendChild(buildLegendItem(participant, onChange));
  head.appendChild(legend);
  return head;
}

/**
 * The latest sampled turn (0 when there are no samples).
 * @param {Snapshot[]} samples The (null-free) sample stream.
 * @returns {number}
 */
function latestSampleTurn(samples) {
  if (!samples.length) return 0;
  const turn = samples[samples.length - 1].turn;
  return typeof turn === "number" ? turn : 0;
}

/**
 * Resolve the selected war and its participant/window data, or null when there
 * are no wars to show.
 * @param {*} history The history blob (carries `wars` + `samples`).
 * @param {*} selectedWarId The selected warUniqueID (or null).
 * @returns {{ war: *, warName: string, participants: { pid: number,
 *   name: string, color: string }[], win: Snapshot[] } | null}
 *   The view data, or null.
 */
function buildWarView(history, selectedWarId) {
  // Persisted arrays: drop null elements (a null war / sample) before anything dereferences them.
  const samples = Array.isArray(history.samples) ? history.samples.filter(Boolean) : [];
  const rawWars = policyVisibleWars(history.wars, samples);
  const latest = latestSampleTurn(samples);
  // Collapse multi-front wars so the picker + graphs match the timeline.
  const wars = mergeWars(rawWars, latest);
  const war = wars.length ? resolveWar(wars, selectedWarId) : null;
  if (!war) return null;
  // Age-scope before windowing so a post-Antiquity war doesn't pull in same-numbered
  // (age-local) turns from earlier ages; ageLastTurn bounds an ongoing war to its own age.
  const { scoped, ageLastTurn } = warAgeScope(samples, war);
  const wStart = typeof war.startTurn === "number" ? war.startTurn : 0;
  const wEnd = typeof war.endTurn === "number" ? war.endTurn : ageLastTurn;
  const win = scoped.filter(
    (/** @type {*} */ s) => typeof s?.turn === "number" && s.turn >= wStart && s.turn <= wEnd
  );
  // Same fancy name the timeline + picker use (keyed by warUniqueID).
  const warName = nameMergedWars(wars, samples).get(war.warUniqueID) || war.name;
  return { war, warName, participants: warParticipants(war), win };
}

/**
 * Render the War Graphs sub-tab into `host`.
 * @param {HTMLElement} host The chart host (cleared and repopulated).
 * @param {{ history?: *, selectedWarId?: * }} [opts]
 * @returns {null} Always null (no chart handle).
 */
export function renderConflictsGraphs(host, opts) {
  if (!host) return null;
  clearHost(host);
  const options = opts || {};
  const view = buildWarView(options.history || {}, options.selectedWarId);
  if (!view) {
    appendGraphsEmpty(host, t("LOC_DEMOGRAPHICS_WAR_GRAPHS_EMPTY_NONE"));
    return null;
  }
  pruneHiddenWarCivs(view.participants);
  const panel = document.createElement("div");
  panel.className = "demographics-war-graphs";
  const rerender = () => safeRerender("renderConflictsGraphs", () => renderConflictsGraphs(host, opts));
  panel.appendChild(buildHeader(view, rerender));
  const grid = document.createElement("div");
  grid.className = "demographics-war-graphs-grid";
  for (const metric of GRAPH_METRICS) grid.appendChild(buildMetricCell(metric, view));
  panel.appendChild(grid);
  host.appendChild(panel);
  return null;
}
