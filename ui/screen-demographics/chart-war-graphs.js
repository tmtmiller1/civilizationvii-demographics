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

import { svgEl } from "/demographics/ui/screen-demographics/chart-shared.js";
import {
  COST_METRICS,
  buildCostIcon,
  graphMetricTitle
} from "/demographics/ui/screen-demographics/chart-wars-cost.js";
import { mergeWars } from "/demographics/ui/screen-demographics/chart-wars-merge.js";
import { nameMergedWars } from "/demographics/ui/screen-demographics/chart-wars-naming.js";
import { t } from "/demographics/ui/demographics-i18n.js";

const MINI_W = 340;
const MINI_H = 200;
const PAD_L = 24;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 28;

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
 * Compact magnitude format (e.g. 12.3K, 1.2M) for axis labels.
 * @param {number} n The value.
 * @returns {string} The formatted value.
 */
function fmt(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
}

/**
 * Coerce to a finite number or null.
 * @param {*} v The value.
 * @returns {number | null} The finite number, or null.
 */
function num(v) {
  return typeof v === "number" && isFinite(v) ? v : null;
}

/**
 * Read one metric value at a sample for a pid, from either the `players` map
 * (majors) or the `minors` map (city-states).
 * @param {*} s The snapshot.
 * @param {number} pid The participant pid.
 * @param {string} metricId The metric key.
 * @param {boolean} fromMinors Read from `minors` instead of `players`.
 * @returns {number | null} The finite value, or null.
 */
function metricAt(s, pid, metricId, fromMinors) {
  const bag = fromMinors ? s?.minors : s?.players;
  return num(bag?.[pid]?.metrics?.[metricId]);
}

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
 * Build one participant's point series for a metric over the window.
 * @param {{ pid: number, name: string, color: string }} p The participant.
 * @param {Snapshot[]} win The windowed samples.
 * @param {string} metricId The snapshot.metrics key.
 * @param {boolean} [fromMinors] Read from the `minors` bag (city-states).
 * @returns {{ name: string, color: string, points: { x: number, y: number }[] }} Series.
 */
function buildSeries(p, win, metricId, fromMinors) {
  const points = [];
  for (const s of win) {
    const y = metricAt(s, p.pid, metricId, !!fromMinors);
    if (y !== null && typeof s.turn === "number") points.push({ x: s.turn, y });
  }
  return { name: p.name, color: p.color, points };
}

/**
 * Build one participant's cumulative-LOSS series for a level metric, plotted
 * NEGATIVE: each point is the running sum of every per-turn decline so far,
 * negated, so the line starts at 0 and descends as the civ loses ground. Rises
 * are ignored (growth never offsets a loss), matching the tooltip's "lost".
 * @param {{ pid: number, name: string, color: string }} p The participant.
 * @param {Snapshot[]} win The windowed samples.
 * @param {string} metricId The level snapshot.metrics key.
 * @param {boolean} [fromMinors] Read from the `minors` bag (city-states).
 * @returns {{ name: string, color: string, points: { x: number, y: number }[] }} Loss series.
 */
function lossSeriesDeclines(p, win, metricId, fromMinors) {
  const points = [];
  let prev = null;
  let cum = 0;
  for (const s of win) {
    const v = metricAt(s, p.pid, metricId, !!fromMinors);
    if (v === null || typeof s.turn !== "number") continue;
    if (prev !== null && v < prev) cum += prev - v;
    prev = v;
    points.push({ x: s.turn, y: -cum });
  }
  return { name: p.name, color: p.color, points };
}

/**
 * Build one participant's cumulative-loss series from a monotonic loss counter
 * (e.g. milLostCum), plotted negative as the increase since the window start.
 * Falls back to {@link lossSeriesDeclines} on `fallbackId` when the counter has
 * no in-window data (a war predating the counter).
 * @param {{ pid: number, name: string, color: string }} p The participant.
 * @param {Snapshot[]} win The windowed samples.
 * @param {string} counterId The cumulative loss-counter key.
 * @param {string} fallbackId The level metric to derive declines from instead.
 * @param {boolean} [fromMinors] Read from the `minors` bag (city-states).
 * @returns {{ name: string, color: string, points: { x: number, y: number }[] }} Loss series.
 */
function lossSeriesCounter(p, win, counterId, fallbackId, fromMinors) {
  const raw = [];
  for (const s of win) {
    const v = metricAt(s, p.pid, counterId, !!fromMinors);
    if (v !== null && typeof s.turn === "number") raw.push({ x: s.turn, y: v });
  }
  if (raw.length < 2) return lossSeriesDeclines(p, win, fallbackId, fromMinors);
  const base = raw[0].y;
  return { name: p.name, color: p.color, points: raw.map((pt) => ({ x: pt.x, y: -(pt.y - base) })) };
}

/**
 * Bounds across a set of series (x = turn, y = value).
 * @param {{ points: { x: number, y: number }[] }[]} seriesList The series.
 * @returns {{ xMin: number, xMax: number, yMin: number, yMax: number } | null} Bounds, or null when empty.
 */
function seriesBounds(seriesList) {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const s of seriesList) {
    for (const pt of s.points) {
      if (pt.x < xMin) xMin = pt.x;
      if (pt.x > xMax) xMax = pt.x;
      if (pt.y < yMin) yMin = pt.y;
      if (pt.y > yMax) yMax = pt.y;
    }
  }
  return isFinite(xMin) ? { xMin, xMax, yMin, yMax } : null;
}

/**
 * Build the polyline `points` string for one series under the given bounds.
 * @param {{ points: { x: number, y: number }[] }} s The series.
 * @param {{ xMin: number, xMax: number, yMin: number, yMax: number }} b The bounds.
 * @returns {string} The SVG points attribute.
 */
function polyPoints(s, b) {
  const innerW = MINI_W - PAD_L - PAD_R;
  const innerH = MINI_H - PAD_T - PAD_B;
  const xSpan = b.xMax - b.xMin || 1;
  const ySpan = b.yMax - b.yMin || 1;
  return s.points
    .map((pt) => {
      const px = PAD_L + ((pt.x - b.xMin) / xSpan) * innerW;
      const py = PAD_T + innerH - ((pt.y - b.yMin) / ySpan) * innerH;
      return px.toFixed(1) + "," + py.toFixed(1);
    })
    .join(" ");
}

/**
 * Draw vertical crisis-stage marker lines (dashed, stage-colored) at each
 * marker's chart-X, mirroring the war-timeline overlay. Markers outside the
 * bounds are skipped.
 * @param {SVGElement} svg The chart SVG.
 * @param {{ x: number, color: string }[]} markers The crisis markers.
 * @param {{ xMin: number, xMax: number }} b The bounds.
 */
function drawGraphMarkers(svg, markers, b) {
  const innerW = MINI_W - PAD_L - PAD_R;
  const xSpan = b.xMax - b.xMin || 1;
  for (const m of markers) {
    if (m.x < b.xMin || m.x > b.xMax) continue;
    const px = (PAD_L + ((m.x - b.xMin) / xSpan) * innerW).toFixed(1);
    svg.appendChild(
      svgEl("line", {
        class: "demographics-war-graph-crisis-marker",
        x1: px,
        x2: px,
        y1: PAD_T,
        y2: MINI_H - PAD_B,
        stroke: m.color,
        "stroke-width": "1.4",
        "stroke-dasharray": "4 3",
        "stroke-opacity": "0.85"
      })
    );
  }
}

/**
 * Build the mini line-chart SVG for one metric.
 * @param {{ color: string, points: { x: number, y: number }[] }[]} seriesList Per-civ series.
 * @param {{ xMin: number, xMax: number, yMin: number, yMax: number }} b The bounds.
 * @param {{ x: number, color: string }[]} [markers] Optional crisis-stage markers.
 * @returns {SVGElement} The chart SVG.
 */
function buildMiniSvg(seriesList, b, markers) {
  const svg = svgEl("svg", {
    class: "demographics-war-graph-svg",
    viewBox: "0 0 " + MINI_W + " " + MINI_H,
    preserveAspectRatio: "none"
  });
  svg.appendChild(
    svgEl("line", {
      class: "demographics-war-graph-axis",
      x1: PAD_L,
      y1: MINI_H - PAD_B,
      x2: MINI_W - PAD_R,
      y2: MINI_H - PAD_B
    })
  );
  if (markers && markers.length) drawGraphMarkers(svg, markers, b);
  for (const s of seriesList) {
    if (!s.points.length) continue;
    svg.appendChild(
      svgEl("polyline", {
        class: "demographics-war-graph-line",
        points: polyPoints(s, b),
        stroke: s.color
      })
    );
  }
  // Axis tick labels + titles are NOT drawn in the SVG: this SVG is stretched
  // non-uniformly (preserveAspectRatio="none") to fill the cell, which would
  // distort any text. They're rendered as crisp HTML overlays in buildPlot()
  // instead, matching the historical charts' typography exactly.
  return svg;
}

/**
 * One absolutely-positioned HTML axis-text overlay (a corner tick or the X
 * title), skipped when empty. Rendered as HTML - not SVG text - so it isn't
 * distorted by the plot SVG's non-uniform stretch and can carry the exact same
 * font/size/color as the historical Chart.js axes.
 * @param {HTMLElement} plot The positioned plot container.
 * @param {string} text The label text ("" skips it).
 * @param {string} suffix The position-class suffix (e.g. "ytop", "xtitle").
 */
function appendOverlay(plot, text, suffix) {
  if (!text) return;
  const el = document.createElement("div");
  el.className = "demographics-war-graph-ovl demographics-war-graph-ovl-" + suffix;
  el.textContent = text;
  plot.appendChild(el);
}

/**
 * The rotated Y-axis title overlay: a thin full-height flex column at the left
 * that vertically centers a -90deg-rotated label (reliable in Gameface, unlike
 * absolute-positioned rotation).
 * @param {HTMLElement} plot The positioned plot container.
 * @param {string} text The Y-axis title ("" skips it).
 */
function appendYTitle(plot, text) {
  if (!text) return;
  const col = document.createElement("div");
  col.className = "demographics-war-graph-ovl demographics-war-graph-ovl-ytitle";
  const span = document.createElement("span");
  span.textContent = text;
  col.appendChild(span);
  plot.appendChild(col);
}

/**
 * Wrap a chart SVG in a positioned plot container and overlay the HTML axis
 * text (corner ticks, X title, rotated Y title) around it.
 * @param {SVGElement} svg The chart SVG.
 * @param {{ yLabel: string, xLabel: string, yTop: string, yBottom: string, xLeft: string, xRight: string }} labels The axis text.
 * @returns {HTMLElement} The plot container.
 */
export function buildPlot(svg, labels) {
  const plot = document.createElement("div");
  plot.className = "demographics-war-graph-plot";
  plot.appendChild(svg);
  appendOverlay(plot, labels.yTop, "ytop");
  appendOverlay(plot, labels.yBottom, "ybottom");
  appendOverlay(plot, labels.xLeft, "xleft");
  appendOverlay(plot, labels.xRight, "xright");
  appendOverlay(plot, labels.xLabel, "xtitle");
  appendYTitle(plot, labels.yLabel);
  return plot;
}

/**
 * One participant's net change in a cumulative metric over the window
 * (last − first). Returns null when the metric isn't present in the window
 * (e.g. a war predating the counter); a single in-window point reads as 0.
 * @param {{ pid: number }} p The participant.
 * @param {Snapshot[]} win The windowed samples.
 * @param {string} metricId The cumulative snapshot.metrics key.
 * @returns {number | null} The net change, or null when no data.
 */
function windowNet(p, win, metricId) {
  const series = [];
  for (const s of win) {
    const v = num(s?.players?.[p.pid]?.metrics?.[metricId]);
    if (v !== null) series.push(v);
  }
  if (!series.length) return null;
  return series[series.length - 1] - series[0];
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
 * Build a zero-centered bar chart with one bar per civ (gains above the line,
 * losses below), scaled symmetrically to ±m so zero sits in the centre.
 * @param {{ color: string, net: number }[]} civs Per-civ net values.
 * @param {number} m The symmetric y-extent (>= 1).
 * @returns {SVGElement} The chart SVG.
 */
function buildCivBarSvg(civs, m) {
  const innerW = MINI_W - PAD_L - PAD_R;
  const innerH = MINI_H - PAD_T - PAD_B;
  const yPx = (/** @type {number} */ v) => PAD_T + innerH - ((v + m) / (2 * m)) * innerH;
  const zeroY = yPx(0);
  const svg = svgEl("svg", {
    class: "demographics-war-graph-svg",
    viewBox: "0 0 " + MINI_W + " " + MINI_H,
    preserveAspectRatio: "none"
  });
  const slotW = innerW / civs.length;
  const barW = Math.max(2, slotW * 0.55);
  for (let i = 0; i < civs.length; i++) {
    const yv = yPx(civs[i].net);
    if (civs[i].net !== 0) {
      svg.appendChild(
        svgEl("rect", {
          class: "demographics-war-graph-bar",
          x: (PAD_L + i * slotW + (slotW - barW) / 2).toFixed(1),
          y: Math.min(zeroY, yv).toFixed(1),
          width: barW.toFixed(1),
          height: Math.max(0.5, Math.abs(yv - zeroY)).toFixed(1),
          fill: civs[i].color
        })
      );
    }
  }
  svg.appendChild(
    svgEl("line", {
      class: "demographics-war-graph-axis",
      x1: PAD_L,
      y1: zeroY.toFixed(1),
      x2: MINI_W - PAD_R,
      y2: zeroY.toFixed(1)
    })
  );
  // Tick/axis text is rendered as HTML overlays (buildPlot), not in this
  // non-uniformly stretched SVG - see the note in buildMiniSvg.
  return svg;
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

/** The two graphs that carry the belligerents / CS allies / cumulative filter. */
const MIL_GRAPH_IDS = new Set(["milpower", "milpowerLevel"]);

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
  const seriesList = milSeriesFor(view, mode, isLoss);
  const chart = buildLineChartFromSeries(seriesList, Y_LABEL[m.id]);
  if (!chart) {
    body.appendChild(buildNoData());
    return;
  }
  body.appendChild(buildPlot(chart.svg, chart.labels));
  if (chart.hover) attachHover(body, chart.svg, chart.hover);
}

/**
 * The per-line series for a military graph under a filter mode.
 * @param {{ war: *, participants: *[], win: Snapshot[] }} view The war view.
 * @param {string} mode The filter mode id.
 * @param {boolean} isLoss Whether this is the "lost" graph (vs the level graph).
 * @returns {{ name: string, color: string, points: { x: number, y: number }[] }[]} The series.
 */
function milSeriesFor(view, mode, isLoss) {
  if (mode === "cs") {
    return csParticipants(view.war).map((p) => memberSeries(p, view.win, isLoss));
  }
  if (mode === "cumulative") {
    return cumulativeSeries(view, isLoss);
  }
  return visibleParticipants(view.participants).map((p) =>
    memberSeries({ ...p, fromMinors: false }, view.win, isLoss)
  );
}

/**
 * One member's military series: standing power (level) or cumulative power lost.
 * @param {{ pid: number, name: string, color: string, fromMinors?: boolean }} member The member.
 * @param {Snapshot[]} win The windowed samples.
 * @param {boolean} isLoss Whether to build the loss series.
 * @returns {{ name: string, color: string, points: { x: number, y: number }[] }} The series.
 */
function memberSeries(member, win, isLoss) {
  return isLoss
    ? lossSeriesCounter(member, win, "milLostCum", "milpower", member.fromMinors)
    : buildSeries(member, win, "milpower", member.fromMinors);
}

/**
 * The city-state ally participants of a war (deduped by pid).
 * @param {*} war The war record.
 * @returns {{ pid: number, name: string, color: string, fromMinors: boolean }[]} The CS rows.
 */
function csParticipants(war) {
  const rosters = /** @type {any[]} */ ([]).concat(war.sideACivs || [], war.sideBCivs || []);
  const seen = new Set();
  const out = [];
  for (const e of rosters) {
    if (!e || !e.isCS || typeof e.pid !== "number" || seen.has(e.pid)) continue;
    seen.add(e.pid);
    out.push({ pid: e.pid, name: e.civ || "CS " + e.pid, color: e.color || "#8c98b8", fromMinors: true });
  }
  return out;
}

/**
 * Per-side cumulative allied series (majors + city-states summed), one line per
 * side that has any members with data.
 * @param {{ war: *, win: Snapshot[] }} view The war view.
 * @param {boolean} isLoss Whether to sum losses (vs standing power).
 * @returns {{ name: string, color: string, points: { x: number, y: number }[] }[]} The side series.
 */
function cumulativeSeries(view, isLoss) {
  return sideGroups(view.war)
    .map((g) => sumGroupSeries(g, view.win, isLoss))
    .filter((s) => s.points.length);
}

/**
 * Resolve a war's two side groups (each: a label, color, and member list of
 * { pid, fromMinors }), dropping empty sides.
 * @param {*} war The war record.
 * @returns {{ label: string, color: string, members: { pid: number, fromMinors: boolean }[] }[]} The groups.
 */
function sideGroups(war) {
  return [buildSideGroup(war.sideACivs), buildSideGroup(war.sideBCivs)].filter(
    (g) => g.members.length
  );
}

/**
 * Build one side group from its roster: every pid as a member (city-states
 * flagged fromMinors), labeled + colored by the side's lead major civ.
 * @param {*[]} roster A war side's roster.
 * @returns {{ label: string, color: string, members: { pid: number, fromMinors: boolean }[] }} The group.
 */
function buildSideGroup(roster) {
  const members = [];
  let color = null;
  let lead = null;
  for (const e of roster || []) {
    if (!e || typeof e.pid !== "number") continue;
    members.push({ pid: e.pid, fromMinors: !!e.isCS });
    if (!e.isCS && !color) {
      color = e.color;
      lead = e.civ;
    }
  }
  const label = lead
    ? t("LOC_DEMOGRAPHICS_WAR_GRAPHS_CUM_SIDE", lead)
    : t("LOC_DEMOGRAPHICS_WAR_GRAPHS_CUM_SIDE_UNKNOWN");
  return { label, color: color || "#9aa8c8", members };
}

/**
 * Sum a side group's members into one series: per turn, the sum of standing
 * power (level) or of each member's loss-since-window-start (loss, negated).
 * @param {{ label: string, color: string, members: { pid: number, fromMinors: boolean }[] }} g The group.
 * @param {Snapshot[]} win The windowed samples.
 * @param {boolean} isLoss Whether to sum losses.
 * @returns {{ name: string, color: string, points: { x: number, y: number }[] }} The summed series.
 */
function sumGroupSeries(g, win, isLoss) {
  const base = isLoss ? groupLossBaselines(g, win) : new Map();
  const points = [];
  for (const s of win) {
    if (typeof s.turn !== "number") continue;
    let sum = 0;
    let any = false;
    for (const mbr of g.members) {
      const c = memberContribution(s, mbr, isLoss, base);
      if (c === null) continue;
      sum += c;
      any = true;
    }
    if (any) points.push({ x: s.turn, y: isLoss ? -sum : sum });
  }
  return { name: g.label, color: g.color, points };
}

/**
 * One member's contribution to a side's cumulative series at a sample: its
 * standing power (level), or its loss accrued since the window baseline.
 * @param {*} s The snapshot.
 * @param {{ pid: number, fromMinors: boolean }} mbr The member.
 * @param {boolean} isLoss Whether to compute loss (vs level).
 * @param {Map<number, number>} base Per-member loss baselines (loss mode only).
 * @returns {number | null} The contribution, or null when no data.
 */
function memberContribution(s, mbr, isLoss, base) {
  if (!isLoss) return metricAt(s, mbr.pid, "milpower", mbr.fromMinors);
  const v = metricAt(s, mbr.pid, "milLostCum", mbr.fromMinors);
  const b0 = base.get(mbr.pid);
  if (v === null || b0 === undefined) return null;
  return v - b0;
}

/**
 * Each member's first in-window cumulative-loss value (the baseline subtracted so
 * losses count only what accrued during the displayed window).
 * @param {{ members: { pid: number, fromMinors: boolean }[] }} g The group.
 * @param {Snapshot[]} win The windowed samples.
 * @returns {Map<number, number>} pid -> baseline milLostCum.
 */
function groupLossBaselines(g, win) {
  const base = new Map();
  for (const mbr of g.members) {
    for (const s of win) {
      const v = metricAt(s, mbr.pid, "milLostCum", mbr.fromMinors);
      if (v !== null) {
        base.set(mbr.pid, v);
        break;
      }
    }
  }
  return base;
}

/**
 * Build a line-chart handle (svg + hover + axis labels) from a prepared series
 * list, mirroring {@link buildChart}'s line branch. Returns null when empty.
 * @param {{ name: string, color: string, points: { x: number, y: number }[] }[]} seriesList The series.
 * @param {string} yLabelLoc The Y-axis title LOC tag.
 * @param {{ x: number, color: string, label?: string }[]} [markers] Optional crisis-stage markers.
 * @param {{ xMin: number, xMax: number }} [xDomain] A shared x-domain to use for the X axis
 *   (so a set of charts share one time scale); the Y axis still comes from the series.
 * @returns {{ svg: SVGElement, hover: *, labels: * } | null} The chart, or null.
 */
export function buildLineChartFromSeries(seriesList, yLabelLoc, markers, xDomain) {
  const sb = seriesBounds(seriesList);
  if (!sb) return null;
  const b = xDomain
    ? { xMin: xDomain.xMin, xMax: xDomain.xMax, yMin: sb.yMin, yMax: sb.yMax }
    : sb;
  if (markers && markers.length) expandBoundsForMarkers(b, markers);
  const yLabel = t(yLabelLoc || "");
  return {
    svg: buildMiniSvg(seriesList, b, markers),
    hover: { series: seriesList, bounds: b, yLabel, markers },
    labels: lineLabels(yLabel, b)
  };
}

/**
 * Widen the x-bounds so any marker sitting at (or past) an edge gets a little
 * breathing room - e.g. a crisis that begins right at the chart's start renders
 * a few turns in from the left edge instead of being clipped on the axis.
 * @param {{ xMin: number, xMax: number }} b The bounds (mutated).
 * @param {{ x: number }[]} markers The crisis markers.
 */
function expandBoundsForMarkers(b, markers) {
  const pad = 3;
  for (const m of markers) {
    if (m.x < b.xMin + pad) b.xMin = m.x - pad;
    if (m.x > b.xMax - pad) b.xMax = m.x + pad;
  }
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
 * Distinct, sorted turns present across a series list.
 * @param {{ points: { x: number }[] }[]} series The series.
 * @returns {number[]} Sorted distinct turns.
 */
function collectTurns(series) {
  const set = new Set();
  for (const s of series) for (const pt of s.points) set.add(pt.x);
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * The turn in `turns` closest to `t`.
 * @param {number[]} turns Sorted turns.
 * @param {number} t The target turn.
 * @returns {number} The nearest turn.
 */
function nearestTurn(turns, t) {
  let best = turns[0];
  let bd = Math.abs(best - t);
  for (const tn of turns) {
    const d = Math.abs(tn - t);
    if (d < bd) {
      bd = d;
      best = tn;
    }
  }
  return best;
}

/**
 * Format a hovered value (signed; 0 stays "0").
 * @param {number} y The value.
 * @returns {string} The formatted value.
 */
function tipVal(y) {
  if (y === 0) return "0";
  return (y < 0 ? "−" : "") + fmt(Math.abs(y));
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
 * Axis-text overlay values for a zero-centered bar chart: the rotated Y title,
 * the +m / −m corner ticks, and no X axis (the bars aren't a time series).
 * @param {string} yLabel The Y-axis title.
 * @param {number} m The symmetric y-extent.
 * @returns {{ yLabel: string, xLabel: string, yTop: string, yBottom: string, xLeft: string, xRight: string }} The overlay text.
 */
function barLabels(yLabel, m) {
  return { yLabel, xLabel: "", yTop: "+" + fmt(m), yBottom: "−" + fmt(m), xLeft: "", xRight: "" };
}

/**
 * Axis-text overlay values for a line chart: the rotated Y title, the y max/min
 * corner ticks, the "Time (turns)" X title, and the T-min / T-max end ticks.
 * @param {string} yLabel The Y-axis title.
 * @param {{ xMin: number, xMax: number, yMin: number, yMax: number }} b The bounds.
 * @returns {{ yLabel: string, xLabel: string, yTop: string, yBottom: string, xLeft: string, xRight: string }} The overlay text.
 */
function lineLabels(yLabel, b) {
  return {
    yLabel,
    xLabel: t("LOC_DEMOGRAPHICS_WAR_GRAPHS_X_TURN"),
    yTop: fmt(b.yMax),
    yBottom: fmt(b.yMin),
    xLeft: "T" + b.xMin,
    xRight: "T" + b.xMax
  };
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
