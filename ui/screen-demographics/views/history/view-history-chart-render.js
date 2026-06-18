// view-history-chart-render.js
//
// Chart host and render routing for the Historical Data view.

import { EXTERNAL_PANELS } from "/demographics/ui/metrics/demographics-metrics.js";

/**
 * @typedef {{ min: number, max: number }} TurnRange
 */

/**
 * @typedef {{
 *   metricExists: (id: string) => boolean,
 *   nyiText: string,
 *   dlog: (...a: any[]) => void,
 *   derr: (...a: any[]) => void
 * }} ChartRenderDeps
 */

/**
 * Run fn, returning result or fallback on throw.
 * @template T
 * @param {() => T} fn Thunk to run.
 * @param {(...a: any[]) => void} derr Error logger.
 * @param {T} [fb] Fallback value.
 * @returns {T|undefined} Result or fallback.
 */
function safeCall(fn, derr, fb) {
  try {
    return fn();
  } catch (e) {
    derr("safeCall:", e);
    return fb;
  }
}

/**
 * Compute clamped chart dimensions from host bounds.
 * @param {HTMLElement} chartHost The chart host element.
 * @returns {{ width: number, height: number }} Clamped dimensions.
 */
function measureChartSize(chartHost) {
  const hostRect = chartHost.getBoundingClientRect?.();
  const width = Math.max(960, Math.min(2800, Math.round(hostRect?.width || 1600)));
  const height = Math.max(360, Math.min(1400, Math.round(hostRect?.height || 600)));
  return { width, height };
}

/**
 * Route rendering to synthetic or standard chart paths.
 * @param {HTMLElement} chartHost Chart host element.
 * @param {*} ctx Render context.
 * @param {string} activeMetric Active metric id.
 * @param {TurnRange|null} turnRange Active turn window.
 * @param {{ width: number, height: number }} size Chart size.
 */
function routeChartRender(chartHost, ctx, activeMetric, turnRange, size) {
  if (tryRenderExternalPanel(chartHost, ctx, activeMetric)) return;
  if (tryRenderSynthetic(chartHost, ctx, activeMetric, turnRange, size)) return;
  renderStandardChart(chartHost, ctx, activeMetric, turnRange, size);
}

// Last external-panel render, to skip redundant rebuilds (Perf plan P1 #5).
/** @type {{ id: string|null, turn: number, host: HTMLElement|null }} */
let _extLast = { id: null, turn: -1, host: null };

/**
 * The current game turn (for external-panel render-skip invalidation), or -1 off-engine.
 * @returns {number} The turn.
 */
function currentTurn() {
  try {
    return typeof Game !== "undefined" && typeof Game.turn === "number" ? Game.turn : -1;
  } catch (_) {
    return -1;
  }
}

/**
 * Render a companion-registered external panel (registerPanel) by handing it the chart host. The
 * companion owns the entire body; a throw inside it must never break the screen.
 *
 * Perf plan P1 #5: an external panel (e.g. Emigration's Migration page) only depends on its own
 * page being selected + the turn — NOT on unrelated history-view state (time filters, other
 * metrics). So when the same panel is already rendered into this same host for the same turn, skip
 * the rebuild; any real change (page switch, new host, turn advance) re-renders normally.
 * @param {HTMLElement} chartHost Chart host element.
 * @param {*} ctx Render context.
 * @param {string} activeMetric Active metric/panel id.
 * @returns {boolean} True if an external panel handled it.
 */
function tryRenderExternalPanel(chartHost, ctx, activeMetric) {
  const panel = EXTERNAL_PANELS.find((p) => p.id === activeMetric);
  if (!panel || typeof panel.render !== "function") return false;
  const turn = currentTurn();
  if (_extLast.id === activeMetric && _extLast.turn === turn && _extLast.host === chartHost
    && chartHost.childElementCount > 0) {
    return true; // unchanged since last render into this host — leave the existing DOM in place
  }
  try {
    chartHost.innerHTML = "";
    panel.render(chartHost, ctx);
    _extLast = { id: activeMetric, turn, host: chartHost };
  } catch (e) {
    if (ctx && typeof ctx.derr === "function") ctx.derr("external panel render:", e);
  }
  return true;
}

/**
 * Attempt synthetic metric rendering.
 * @param {HTMLElement} chartHost Chart host element.
 * @param {*} ctx Render context.
 * @param {string} activeMetric Active metric id.
 * @param {TurnRange|null} turnRange Active turn window.
 * @param {{ width: number, height: number }} size Chart size.
 * @returns {boolean} True if handled.
 */
function tryRenderSynthetic(chartHost, ctx, activeMetric, turnRange, size) {
  const { width, height } = size;
  const chartMod = /** @type {*} */ (ctx.chartMod);
  if (activeMetric === "legacy_radar" && typeof chartMod.renderLegacyRadar === "function") {
    chartMod.renderLegacyRadar(chartHost, {
      history: ctx.history,
      hiddenCivs: ctx.hiddenCivs,
      width,
      height,
      ageSource: ctx.activeRadarAge || "current",
      onToggleCiv: (/** @type {string} */ leaderKey) => ctx.toggleCiv?.(leaderKey)
    });
    return true;
  }
  if (
    activeMetric === "resources_stack" &&
    typeof chartMod.renderResourcesStack === "function"
  ) {
    chartMod.renderResourcesStack(chartHost, {
      history: ctx.history,
      width,
      height,
      turnRange,
      viewerPid: ctx.resourcesViewerPid
    });
    return true;
  }
  if (tryRenderCrisis(chartHost, ctx, activeMetric)) return true;
  return tryRenderWars(chartHost, ctx, activeMetric, turnRange, size);
}

/**
 * Attempt crisis synthetic rendering.
 * @param {HTMLElement} chartHost Chart host element.
 * @param {*} ctx Render context.
 * @param {string} activeMetric Active metric id.
 * @returns {boolean} True if handled.
 */
function tryRenderCrisis(chartHost, ctx, activeMetric) {
  const chartMod = /** @type {*} */ (ctx.chartMod);
  if (activeMetric === "crisis_stages" && typeof chartMod.renderCrisisStages === "function") {
    chartMod.renderCrisisStages(chartHost, { history: ctx.history });
    return true;
  }
  if (activeMetric === "crisis_graphs" && typeof chartMod.renderCrisisGraphs === "function") {
    chartMod.renderCrisisGraphs(chartHost, {
      history: ctx.history,
      crisisAge: ctx.crisisGraphsAge
    });
    return true;
  }
  return false;
}

/**
 * Attempt wars synthetic rendering.
 * @param {HTMLElement} chartHost Chart host element.
 * @param {*} ctx Render context.
 * @param {string} activeMetric Active metric id.
 * @param {TurnRange|null} turnRange Active turn window.
 * @param {{ width: number, height: number }} size Chart size.
 * @returns {boolean} True if handled.
 */
function tryRenderWars(chartHost, ctx, activeMetric, turnRange, size) {
  const { width, height } = size;
  const chartMod = /** @type {*} */ (ctx.chartMod);
  if (activeMetric === "wars_gantt" && typeof chartMod.renderConflictsTimeline === "function") {
    chartMod.renderConflictsTimeline(chartHost, {
      history: ctx.history,
      width,
      height,
      turnRange,
      filterPid: ctx.warsFilterPid,
      showCs: ctx.warsShowCs !== false,
      activeOnly: ctx.warsActiveOnly
    });
    return true;
  }
  if (activeMetric === "war_graphs" && typeof chartMod.renderConflictsGraphs === "function") {
    chartMod.renderConflictsGraphs(chartHost, {
      history: ctx.history,
      selectedWarId: ctx.warGraphsWarId
    });
    return true;
  }
  return false;
}

/**
 * Render standard line-chart metric.
 * @param {HTMLElement} chartHost Chart host element.
 * @param {*} ctx Render context.
 * @param {string} activeMetric Active metric id.
 * @param {TurnRange|null} turnRange Active turn window.
 * @param {{ width: number, height: number }} size Chart size.
 */
function renderStandardChart(chartHost, ctx, activeMetric, turnRange, size) {
  const { width, height } = size;
  const chartMod = /** @type {*} */ (ctx.chartMod);
  chartMod.renderChart?.(chartHost, {
    history: ctx.history,
    metric: activeMetric,
    hiddenCivs: ctx.hiddenCivs,
    focusedCivs: ctx.focusedCivs,
    width,
    height,
    turnRange,
    onToggleCiv: (/** @type {string} */ leaderKey) => {
      if (typeof ctx.toggleFocusCiv === "function") ctx.toggleFocusCiv(leaderKey);
      else ctx.toggleCiv?.(leaderKey);
    },
    onToggleVisibility: (/** @type {string} */ leaderKey) => ctx.toggleCiv?.(leaderKey),
    onSetAllHidden: (/** @type {boolean} */ hide, /** @type {string[]} */ keys) =>
      ctx.setAllCivsHidden?.(hide, keys)
  });
}

/**
 * Build and append the chart host, then render or show NYI placeholder.
 * @param {HTMLElement} host View host.
 * @param {*} ctx Render context.
 * @param {string} activeMetric Active metric id.
 * @param {TurnRange|null} turnRange Active turn window.
 * @param {ChartRenderDeps} deps Render dependencies.
 */
export function buildChartHostPanel(host, ctx, activeMetric, turnRange, deps) {
  const chartHost = document.createElement("div");
  chartHost.className = "demographics-chart-host relative flex flex-col items-center";
  host.appendChild(chartHost);

  if (!deps.metricExists(activeMetric)) {
    const ph = document.createElement("div");
    ph.className = "demographics-nyi font-body text-base";
    ph.textContent = deps.nyiText;
    chartHost.appendChild(ph);
    return;
  }

  const doRender = () =>
    safeCall(() => {
      const { width, height } = measureChartSize(chartHost);
      deps.dlog("chart render size=" + width + "x" + height, "activeMetric=" + activeMetric);
      routeChartRender(chartHost, ctx, activeMetric, turnRange, { width, height });
    }, deps.derr);

  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(doRender);
  } else {
    setTimeout(doRender, 0);
  }
}
