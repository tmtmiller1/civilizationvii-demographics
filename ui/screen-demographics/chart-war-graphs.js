// chart-war-graphs.js
//
// The Conflicts "War Graphs" sub-tab: pick a war from the toolbar dropdown and
// see each participant civ's trajectory for every war-cost metric over that
// war's window, as a scrollable grid of small line charts ("small multiples").
//
// Driven by COST_METRICS, so the eight graphs match the war tooltip's eight
// figures and stay in sync. Each metric's per-turn series is read straight from
// snapshot.metrics[<cost id>] (the cost `id` IS the sampled metric key), so this
// needs no chart-registry plumbing and handles the injected cumulative counters
// (razedCum, warProdCum) the same as the level metrics. The window is the same
// turn range the tooltip uses ([startTurn, endTurn|latest]).

import {
  barLabels,
  buildCivBarSvg,
  buildLineChartFromSeries,
  buildMiniSvg,
  buildPlot,
  lineLabels,
  MINI_H,
  MINI_W,
  PAD_B,
  PAD_L,
  PAD_R,
  PAD_T
} from "/demographics/ui/screen-demographics/chart-war-mini-chart.js";
import { MIL_GRAPH_IDS, milSeriesFor } from "/demographics/ui/screen-demographics/chart-war-military.js";
import {
  buildSeries,
  collectTurns,
  lossSeriesCounter,
  lossSeriesDeclines,
  nearestTurn,
  seriesBounds,
  tipVal,
  windowNet
} from "/demographics/ui/screen-demographics/chart-war-series.js";
import {
  COST_METRICS,
  buildCostIcon,
  graphMetricTitle
} from "/demographics/ui/screen-demographics/chart-wars-cost.js";
import { mergeWars } from "/demographics/ui/screen-demographics/chart-wars-merge.js";
import { nameMergedWars } from "/demographics/ui/screen-demographics/chart-wars-naming.js";
import { svgEl } from "/demographics/ui/screen-demographics/chart-shared.js";
import { t } from "/demographics/ui/demographics-i18n.js";

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
  milpowerLevel: "LOC_DEMOGRAPHICS_WAR_GRAPHS_Y_STRENGTH"
};

/**
 * Remove every child of `host`.
 * @param {HTMLElement} host The element to clear.
 */
function clearHost(host) {
  while (host.firstChild) host.removeChild(host.firstChild);
}

/**
 * Resolve the war to display: the one matching `id`, else the most recent war.
 * @param {*[]} wars The history war list.
 * @param {*} id The selected warUniqueID (or null).
 * @returns {*} The war record, or null.
 */
function resolveWar(wars, id) {
  if (typeof id === "number") {
    const found = wars.find((w) => w && w.warUniqueID === id);
    if (found) return found;
  }
  return wars.length ? wars[wars.length - 1] : null;
}

/**
 * The war's major participants (both sides), de-duplicated by pid.
 * @param {*} war The war record.
 * @returns {{ pid: number, name: string, color: string }[]} Participant rows.
 */
function warParticipants(war) {
  const rosters = /** @type {any[]} */ ([]).concat(war.sideACivs || [], war.sideBCivs || []);
  const seen = new Set();
  const out = [];
  for (const e of rosters) {
    if (!e || e.isCS || typeof e.pid !== "number" || seen.has(e.pid)) continue;
    seen.add(e.pid);
    out.push({ pid: e.pid, name: e.civ || "Player " + e.pid, color: e.color || "#9aa8c8" });
  }
  return out;
}

/**
 * Build a cell head (cost icon + metric title).
 * @param {*} m A COST_METRICS entry.
 * @returns {HTMLElement} The head element.
 */
function buildCellHead(m) {
  const head = document.createElement("div");
  head.className = "demographics-war-graph-cell-head";
  if (m.blp) head.appendChild(buildCostIcon(m.blp));
  const title = document.createElement("span");
  title.textContent = metricTitle(m);
  head.appendChild(title);
  return head;
}

/**
 * Build one metric cell. The two military graphs get a 3-way filter (belligerent
 * civs / city-state allies / cumulative allied); the rest are plain.
 * @param {*} m A COST_METRICS entry.
 * @param {{ war: *, participants: { pid: number, name: string, color: string }[], win: Snapshot[] }} view The war view.
 * @returns {HTMLElement} The cell element.
 */
function buildMetricCell(m, view) {
  if (MIL_GRAPH_IDS.has(m.id)) return buildMilitaryCell(m, view);
  return buildPlainMetricCell(m, visibleParticipants(view.participants), view.win);
}

/**
 * Build a plain (non-military) metric cell: head, then the mini chart (or a
 * no-data note).
 * @param {*} m A COST_METRICS entry.
 * @param {{ pid: number, name: string, color: string }[]} participants The civs.
 * @param {Snapshot[]} win The windowed samples.
 * @returns {HTMLElement} The cell element.
 */
function buildPlainMetricCell(m, participants, win) {
  const cell = document.createElement("div");
  cell.className = "demographics-war-graph-cell";
  cell.appendChild(buildCellHead(m));

  const chart = buildChart(m, participants, win);
  if (!chart) {
    cell.appendChild(buildNoData());
    return cell;
  }
  cell.appendChild(buildPlot(chart.svg, chart.labels));
  if (chart.hover) attachHover(cell, chart.svg, chart.hover);
  if (chart.bars) attachBarHover(cell, chart.bars, metricTitle(m));
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
 * @param {{ pid: number }[]} participants The participants.
 * @returns {*[]} The visible participants.
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
 * @param {*} m A COST_METRICS entry (milpower / milpowerLevel).
 * @param {{ war: *, participants: *[], win: Snapshot[] }} view The war view.
 * @returns {HTMLElement} The cell element.
 */
function buildMilitaryCell(m, view) {
  const cell = document.createElement("div");
  cell.className = "demographics-war-graph-cell";
  cell.appendChild(buildCellHead(m));
  const body = document.createElement("div");
  body.className = "demographics-war-graph-mil-body";
  cell.appendChild(buildMilFilter(m, view, body));
  cell.appendChild(body);
  renderMilChart(m, view, body, milFilterMode[m.id] || "belligerents");
  return cell;
}

/**
 * Build the 3-way filter pill row for a military graph; clicking re-renders the
 * chart body in place and remembers the choice.
 * @param {*} m The COST_METRICS entry.
 * @param {{ war: *, participants: *[], win: Snapshot[] }} view The war view.
 * @param {HTMLElement} body The chart body to re-render.
 * @returns {HTMLElement} The filter row.
 */
function buildMilFilter(m, view, body) {
  const row = document.createElement("div");
  row.className = "demographics-war-graph-filter";
  for (const mode of MIL_FILTER_MODES) {
    const btn = document.createElement("div");
    btn.className = "demographics-war-graph-filter-btn";
    btn.textContent = t(mode.label);
    if ((milFilterMode[m.id] || "belligerents") === mode.id) btn.classList.add("is-active");
    btn.addEventListener("click", () => {
      milFilterMode[m.id] = mode.id;
      for (const b of Array.from(row.children)) b.classList.remove("is-active");
      btn.classList.add("is-active");
      renderMilChart(m, view, body, mode.id);
    });
    row.appendChild(btn);
  }
  return row;
}

/**
 * Render (or re-render) a military graph's chart body for the chosen filter mode.
 * @param {*} m The COST_METRICS entry.
 * @param {{ war: *, participants: *[], win: Snapshot[] }} view The war view.
 * @param {HTMLElement} body The chart body container.
 * @param {string} mode The active filter mode id.
 */
function renderMilChart(m, view, body, mode) {
  while (body.firstChild) body.removeChild(body.firstChild);
  const isLoss = m.id === "milpower";
  const seriesList = milSeriesFor(view, mode, isLoss, visibleParticipants(view.participants));
  const chart = buildLineChartFromSeries(seriesList, Y_LABEL[m.id]);
  if (!chart) {
    body.appendChild(buildNoData());
    return;
  }
  body.appendChild(buildPlot(chart.svg, chart.labels));
  if (chart.hover) attachHover(body, chart.svg, chart.hover);
}

/**
 * Build the "cities gained/lost" chart: one zero-centered bar per participant,
 * its height the net cities WON (above) or LOST (below) through capture during
 * the war - read from the event-based `cityWarNetCum` (so cities founded with a
 * settler are never counted). Returns null when no civ has capture data.
 * @param {{ pid: number, name: string, color: string }[]} participants The civs.
 * @param {Snapshot[]} win The windowed samples.
 * @param {string} metricId The cumulative metric key ("cityWarNetCum").
 * @returns {{ svg: SVGElement, civs: { name: string, color: string, net: number }[], m: number } | null} The chart, per-civ nets, and symmetric extent, or null.
 */
function buildSettlementsBars(participants, win, metricId) {
  const civs = [];
  let mag = 0;
  for (const p of participants) {
    const net = windowNet(p, win, metricId);
    if (net === null) continue;
    civs.push({ name: p.name, color: p.color, net });
    if (Math.abs(net) > mag) mag = Math.abs(net);
  }
  if (!civs.length) return null;
  const m = Math.max(mag, 1);
  return { svg: buildCivBarSvg(civs, m), civs, m };
}

/**
 * Format a settlement net for the bar tooltip ("+2" / "−1" / "0").
 * @param {number} n The net value.
 * @returns {string} The signed display.
 */
function barVal(n) {
  if (n > 0) return "+" + n;
  if (n < 0) return "−" + Math.abs(n);
  return "0";
}

/**
 * Wire a hover tooltip onto the settlements bar chart listing each civ's net
 * settlements won/lost. (The bars aren't a time series, so there's no crosshair.)
 * @param {HTMLElement} cell The chart cell (positioned container).
 * @param {{ name: string, color: string, net: number }[]} civs Per-civ nets.
 * @param {string} label The tooltip header (metric name).
 */
function attachBarHover(cell, civs, label) {
  cell.style.position = "relative";
  const tip = document.createElement("div");
  tip.className = "demographics-war-graph-hovertip";
  fillBarTip(tip, civs, label);
  cell.appendChild(tip);
  cell.addEventListener("mousemove", (ev) => {
    const cRect = cell.getBoundingClientRect();
    tip.style.left = ev.clientX - cRect.left + 14 + "px";
    tip.style.top = ev.clientY - cRect.top + 14 + "px";
    tip.style.display = "block";
  });
  cell.addEventListener("mouseleave", () => {
    tip.style.display = "none";
  });
}

/**
 * Populate the bar tooltip with every civ's net settlements.
 * @param {HTMLElement} tip The tooltip element.
 * @param {{ name: string, color: string, net: number }[]} civs Per-civ nets.
 * @param {string} label The header text.
 */
function fillBarTip(tip, civs, label) {
  const head = document.createElement("div");
  head.className = "demographics-war-graph-hovertip-head";
  head.textContent = label;
  tip.appendChild(head);
  for (const c of civs) {
    const row = document.createElement("div");
    row.className = "demographics-war-graph-hovertip-row";
    const dot = document.createElement("span");
    dot.className = "demographics-war-graph-hovertip-dot";
    dot.style.backgroundColor = c.color;
    row.appendChild(dot);
    row.appendChild(document.createTextNode(c.name || ""));
    const val = document.createElement("span");
    val.className = "demographics-war-graph-hovertip-val";
    val.textContent = barVal(c.net);
    row.appendChild(val);
    tip.appendChild(row);
  }
}

/**
 * Populate the hover tooltip with each civ's value at the hovered turn.
 * @param {HTMLElement} tip The tooltip element.
 * @param {number} turn The hovered turn.
 * @param {{ name?: string, color: string, points: { x: number, y: number }[] }[]} series The series.
 * @param {string} yLabel The metric unit (shown in the header).
 * @param {{ x: number, color: string, label?: string }[]} [markers] Optional crisis markers.
 */
function fillHoverTip(tip, turn, series, yLabel, markers) {
  while (tip.firstChild) tip.removeChild(tip.firstChild);
  const head = document.createElement("div");
  head.className = "demographics-war-graph-hovertip-head";
  head.textContent = "Turn " + turn + (yLabel ? " · " + yLabel : "");
  tip.appendChild(head);
  appendCrisisHoverRow(tip, turn, markers);
  for (const s of series) {
    const pt = s.points.find((p) => p.x === turn);
    if (!pt) continue;
    const row = document.createElement("div");
    row.className = "demographics-war-graph-hovertip-row";
    const dot = document.createElement("span");
    dot.className = "demographics-war-graph-hovertip-dot";
    dot.style.backgroundColor = s.color;
    row.appendChild(dot);
    row.appendChild(document.createTextNode(s.name || ""));
    const val = document.createElement("span");
    val.className = "demographics-war-graph-hovertip-val";
    val.textContent = tipVal(pt.y);
    row.appendChild(val);
    tip.appendChild(row);
  }
}

/**
 * Add a crisis-stage row to the hover tooltip when the hovered turn lands on a
 * crisis-stage onset (so the marker line's label appears as a hover popup,
 * matching the rest of the charts instead of an always-on caption).
 * @param {HTMLElement} tip The tooltip element.
 * @param {number} turn The hovered turn.
 * @param {{ x: number, color: string, label?: string }[]|undefined} markers The crisis markers.
 */
function appendCrisisHoverRow(tip, turn, markers) {
  if (!markers || !markers.length) return;
  const mk = markers.find((m) => m.x === turn && m.label);
  if (!mk) return;
  const row = document.createElement("div");
  row.className = "demographics-war-graph-hovertip-row";
  const dot = document.createElement("span");
  dot.className = "demographics-war-graph-hovertip-dot";
  dot.style.backgroundColor = mk.color;
  row.appendChild(dot);
  const txt = document.createElement("span");
  txt.style.color = mk.color;
  txt.textContent = mk.label || "";
  row.appendChild(txt);
  tip.appendChild(row);
}

/**
 * Move handler: snap to the nearest turn, position the crosshair, and fill the
 * tooltip with each civ's value there.
 * @param {*} ev The mouse event.
 * @param {*} ctx The hover context (svg, cross, cell, tip, turns, series, bounds, yLabel, markers).
 */
function onHoverMove(ev, ctx) {
  const sRect = ctx.svg.getBoundingClientRect();
  if (!sRect.width) return;
  const innerW = MINI_W - PAD_L - PAD_R;
  const xSpan = ctx.bounds.xMax - ctx.bounds.xMin || 1;
  const vx = ((ev.clientX - sRect.left) / sRect.width) * MINI_W;
  const frac = Math.min(1, Math.max(0, (vx - PAD_L) / innerW));
  const turn = nearestTurn(ctx.turns, ctx.bounds.xMin + frac * xSpan);
  const xPx = (PAD_L + ((turn - ctx.bounds.xMin) / xSpan) * innerW).toFixed(1);
  ctx.cross.setAttribute("x1", xPx);
  ctx.cross.setAttribute("x2", xPx);
  ctx.cross.setAttribute("visibility", "visible");
  fillHoverTip(ctx.tip, turn, ctx.series, ctx.yLabel, ctx.markers);
  const cRect = ctx.cell.getBoundingClientRect();
  ctx.tip.style.left = ev.clientX - cRect.left + 14 + "px";
  ctx.tip.style.top = ev.clientY - cRect.top + 14 + "px";
  ctx.tip.style.display = "block";
}

/**
 * Wire the crosshair + per-civ hover tooltip onto a time-series chart cell,
 * mirroring the gantt's container-level hover. No-op when the chart has no turns.
 * @param {HTMLElement} cell The chart cell (positioned container).
 * @param {SVGElement} svg The chart SVG (gets the crosshair line).
 * @param {{ series: *[], bounds: *, yLabel: string, markers?: * }} hover The hover data.
 */
export function attachHover(cell, svg, hover) {
  const turns = collectTurns(hover.series);
  if (!turns.length) return;
  cell.style.position = "relative";
  const tip = document.createElement("div");
  tip.className = "demographics-war-graph-hovertip";
  cell.appendChild(tip);
  const cross = svgEl("line", {
    class: "demographics-war-graph-crosshair",
    x1: 0,
    y1: PAD_T,
    x2: 0,
    y2: MINI_H - PAD_B,
    visibility: "hidden"
  });
  svg.appendChild(cross);
  const ctx = {
    svg,
    cross,
    cell,
    tip,
    turns,
    series: hover.series,
    bounds: hover.bounds,
    yLabel: hover.yLabel,
    markers: hover.markers
  };
  cell.addEventListener("mousemove", (ev) => onHoverMove(ev, ctx));
  cell.addEventListener("mouseleave", () => {
    cross.setAttribute("visibility", "hidden");
    tip.style.display = "none";
  });
}

/**
 * The "no data recorded" placeholder element.
 * @returns {HTMLElement} The placeholder.
 */
export function buildNoData() {
  const none = document.createElement("div");
  none.className = "demographics-war-graph-nodata";
  none.textContent = t("LOC_DEMOGRAPHICS_WAR_GRAPHS_NODATA");
  return none;
}

/**
 * Per-metric graph rendering, keyed by COST_METRICS id:
 *   - "bars": one zero-centered bar per civ (cities won/lost).
 *   - "loss": a cumulative-loss line plotted negative (descends from 0); `title`
 *     overrides the row label, `counter`/`fallback` use a loss counter else the
 *     metric's own per-turn declines.
 *   - "level"/(absent): a plain line of a level series - `series` overrides which
 *     snapshot.metrics key to read (else the metric's own id).
 * @type {Record<string, { kind?: string, title?: string, counter?: string, fallback?: string, series?: string }>}
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
  milpowerLevel: { series: "milpower" }
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
for (const m of COST_METRICS) GRAPH_BY_ID[m.id] = m;
for (const m of EXTRA_GRAPHS) GRAPH_BY_ID[m.id] = m;

/** War Graphs display order: three rows of three. */
const GRAPH_ORDER = [
  "milpowerLevel", // Military Power
  "milpower", // Military Power Lost
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
 * Build the chart for one metric per {@link GRAPH_SPEC}: cities as zero-centered
 * bars, the loss metrics as negative cumulative-loss lines, everything else as a
 * plain level line. Returns null when there's no data. The `hover` field carries
 * the per-civ series + bounds so the cell can wire the crosshair tooltip (null
 * for the bar chart, which isn't a time series).
 * @param {*} m A COST_METRICS entry.
 * @param {{ pid: number, name: string, color: string }[]} participants The civs.
 * @param {Snapshot[]} win The windowed samples.
 * @returns {{ svg: SVGElement, hover: { series: *[], bounds: *, yLabel: string } | null, bars?: *[], labels: * } | null} The chart, or null.
 */
function buildChart(m, participants, win) {
  const spec = GRAPH_SPEC[m.id];
  const yLabel = t(Y_LABEL[m.id] || "");
  if (spec?.kind === "bars") {
    const r = buildSettlementsBars(participants, win, m.id);
    return r ? { svg: r.svg, hover: null, bars: r.civs, labels: barLabels(yLabel, r.m) } : null;
  }
  let seriesList;
  if (spec?.kind === "loss") {
    seriesList = participants.map((p) =>
      spec.counter
        ? lossSeriesCounter(p, win, spec.counter, spec.fallback || m.id)
        : lossSeriesDeclines(p, win, m.id)
    );
  } else {
    const key = spec?.series || m.id;
    seriesList = participants.map((p) => buildSeries(p, win, key));
  }
  const b = seriesBounds(seriesList);
  if (!b) return null;
  const hover = { series: seriesList, bounds: b, yLabel };
  return { svg: buildMiniSvg(seriesList, b), hover, labels: lineLabels(yLabel, b) };
}

/**
 * The chart title for a metric - the shared descriptive title (so it always
 * matches the war-timeline tooltip's prose labels).
 * @param {*} m A COST_METRICS entry.
 * @returns {string} The localized title.
 */
function metricTitle(m) {
  return graphMetricTitle(m);
}

/**
 * Build the "All" / "None" bulk-select controls that show or hide every
 * belligerent civ at once across all war graphs.
 * @param {{ pid: number }[]} participants The civs.
 * @param {() => void} onChange Re-render callback.
 * @returns {HTMLElement} The controls row.
 */
function buildLegendControls(participants, onChange) {
  const row = document.createElement("div");
  row.className = "demographics-war-graph-filter demographics-war-graphs-controls";
  const all = document.createElement("div");
  all.className = "demographics-war-graph-filter-btn";
  all.textContent = t("LOC_DEMOGRAPHICS_WAR_GRAPHS_ALL") || "All";
  all.addEventListener("click", () => {
    hiddenWarCivs.clear();
    onChange();
  });
  const none = document.createElement("div");
  none.className = "demographics-war-graph-filter-btn";
  none.textContent = t("LOC_DEMOGRAPHICS_WAR_GRAPHS_NONE") || "None";
  none.addEventListener("click", () => {
    for (const p of participants) hiddenWarCivs.add(p.pid);
    onChange();
  });
  row.appendChild(all);
  row.appendChild(none);
  return row;
}

/**
 * Build one clickable legend item (swatch + name); clicking toggles that civ's
 * lines across the per-civ graphs and re-renders.
 * @param {{ pid: number, name: string, color: string }} p The participant.
 * @param {() => void} onChange Re-render callback.
 * @returns {HTMLElement} The legend item.
 */
function buildLegendItem(p, onChange) {
  const item = document.createElement("span");
  item.className = "demographics-war-graphs-legend-item";
  if (hiddenWarCivs.has(p.pid)) item.classList.add("is-hidden");
  const dot = document.createElement("span");
  dot.className = "demographics-war-graphs-legend-dot";
  dot.style.backgroundColor = p.color;
  item.appendChild(dot);
  item.appendChild(document.createTextNode(p.name));
  item.addEventListener("click", () => {
    if (hiddenWarCivs.has(p.pid)) hiddenWarCivs.delete(p.pid);
    else hiddenWarCivs.add(p.pid);
    onChange();
  });
  return item;
}

/**
 * Build the header: the war name, the All/None controls, and the interactive
 * participant legend that governs the per-civ graphs.
 * @param {{ war: *, participants: { pid: number, name: string, color: string }[], warName?: string }} view The war view.
 * @param {() => void} onChange Re-render callback.
 * @returns {HTMLElement} The header element.
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
  for (const p of view.participants) legend.appendChild(buildLegendItem(p, onChange));
  head.appendChild(legend);
  return head;
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
 * Resolve the selected war and its participant/window data, or null when there
 * are no wars to show.
 * @param {*} history The history blob (carries `wars` + `samples`).
 * @param {*} selectedWarId The selected warUniqueID (or null).
 * @returns {{ war: *, warName: string, participants: { pid: number, name: string, color: string }[], win: Snapshot[] } | null} The view data, or null.
 */
function buildWarView(history, selectedWarId) {
  const rawWars = Array.isArray(history.wars) ? history.wars : [];
  const samples = Array.isArray(history.samples) ? history.samples : [];
  const latest = samples.length ? samples[samples.length - 1].turn : 0;
  // Collapse multi-front wars so the picker + graphs match the timeline.
  const wars = mergeWars(rawWars, latest);
  const war = wars.length ? resolveWar(wars, selectedWarId) : null;
  if (!war) return null;
  const wStart = typeof war.startTurn === "number" ? war.startTurn : 0;
  const wEnd = typeof war.endTurn === "number" ? war.endTurn : latest;
  const win = samples.filter(
    (/** @type {*} */ s) => typeof s?.turn === "number" && s.turn >= wStart && s.turn <= wEnd
  );
  // Same fancy name the timeline + picker use (keyed by warUniqueID).
  const warName = nameMergedWars(wars, samples).get(war.warUniqueID) || war.name;
  return { war, warName, participants: warParticipants(war), win };
}

/**
 * Render the War Graphs sub-tab into `host`.
 * @param {HTMLElement} host The chart host (cleared and repopulated).
 * @param {{ history?: *, selectedWarId?: * }} [opts] Render options.
 * @returns {null} Always null (no chart handle).
 */
export function renderWarGraphs(host, opts) {
  if (!host) return null;
  clearHost(host);
  const o = opts || {};
  const view = buildWarView(o.history || {}, o.selectedWarId);
  if (!view) {
    appendEmpty(host, t("LOC_DEMOGRAPHICS_WAR_GRAPHS_EMPTY_NONE"));
    return null;
  }
  pruneHiddenWarCivs(view.participants);
  const panel = document.createElement("div");
  panel.className = "demographics-war-graphs";
  panel.appendChild(buildHeader(view, () => renderWarGraphs(host, opts)));
  const grid = document.createElement("div");
  grid.className = "demographics-war-graphs-grid";
  for (const m of GRAPH_METRICS) grid.appendChild(buildMetricCell(m, view));
  panel.appendChild(grid);
  host.appendChild(panel);
  return null;
}
