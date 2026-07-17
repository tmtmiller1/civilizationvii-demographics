// view-history-chart-render.js
//
// Chart host and render routing for the Historical Data view.

import { EXTERNAL_PANELS, PANEL_SUBTAB_SEP } from "/demographics/ui/metrics/demographics-metrics.js";
import { effectivePolicy } from "/demographics/ui/core/demographics-governance.js";

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
 * Compute chart dimensions from the measured host. When the host is laid out we
 * trust its real size (so the canvas matches the panel at ANY resolution /
 * Interface Size); a 16:9-ish default is used ONLY when the rect is still 0
 * (pre-layout). The generous clamp keeps a high-res / ultrawide display crisp
 * (the old 2800×1400 ceiling left the canvas under-resolved and dead space on
 * wide monitors) without ever sizing absurdly. The resize re-fit
 * ({@link ensureChartResizeReflow}) re-measures on any later change.
 * @param {HTMLElement} chartHost The chart host element.
 * @returns {{ width: number, height: number }} Dimensions.
 */
function measureChartSize(chartHost) {
  const hostRect = chartHost.getBoundingClientRect?.();
  const rawW = Math.round(hostRect?.width || 0);
  const rawH = Math.round(hostRect?.height || 0);
  const width = rawW > 0 ? Math.max(480, Math.min(4096, rawW)) : 1600;
  const height = rawH > 0 ? Math.max(320, Math.min(2304, rawH)) : 600;
  return { width, height };
}

// Re-fit the active history chart on window resize / Interface-Size change. Every
// chart bakes pixel dimensions measured once from its host (measureChartSize), so
// without this they keep a stale size when the window resizes or the player
// changes Interface Size while Demographics is open — the canvas/SVG then no
// longer matches the reflowed host. Mirrors the relations ring's resize re-fit:
// a SINGLE module-level listener re-runs the latest chart's render (every render
// path clears its host first, so re-running is idempotent); it no-ops once the
// host detaches.
/** @type {(() => void) | null} */
let activeChartReflow = null;
let chartResizeWired = false;

/**
 * Install the one-time window-resize → chart re-fit hook (idempotent), rAF-
 * debounced so a resize drag coalesces to one re-render per frame.
 */
function ensureChartResizeReflow() {
  if (chartResizeWired) return;
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  chartResizeWired = true;
  let scheduled = false;
  const run = () => {
    scheduled = false;
    const reflow = activeChartReflow;
    if (typeof reflow === "function") reflow();
  };
  window.addEventListener("resize", () => {
    if (scheduled) return;
    scheduled = true;
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else setTimeout(run, 16);
  });
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

// Last external-panel render, to skip redundant rebuilds (Perf plan P1 #5). Includes the effective
// analytics-visibility policy so a Spoilers change re-renders the companion panel (e.g. the
// Emigration tabs mask unmet civs by it) instead of leaving the stale, unmasked DOM in place on the
// same turn.
/** @type {{ id: string|null, turn: number, host: HTMLElement|null, policy: string }} */
let _extLast = { id: null, turn: -1, host: null, policy: "" };

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
 * The effective analytics-visibility policy, defensively (for the render-skip key).
 * @returns {string} The policy id, or "" off-engine.
 */
function safePolicy() {
  try {
    return effectivePolicy() || "";
  } catch (_) {
    return "";
  }
}

/**
 * Resolve `activeMetric` to its owning external panel and (for multi-tab panels) the bare sub-tab
 * id, or null when it isn't an external panel/sub-tab.
 * @param {string} activeMetric The active metric id (a panel id, or "panelId::subId").
 * @returns {{panel:*, subId:(string|undefined)}|null} The owning panel + sub-tab id, or null.
 */
function findPanelFor(activeMetric) {
  for (const p of EXTERNAL_PANELS) {
    if (activeMetric === p.id) return { panel: p, subId: undefined };
    const prefix = p.id + PANEL_SUBTAB_SEP;
    if (typeof activeMetric === "string" && activeMetric.startsWith(prefix)) {
      return { panel: p, subId: activeMetric.slice(prefix.length) };
    }
  }
  return null;
}

// Perf plan P1 #5: an external panel (e.g. Emigration's Migration page) only depends on its own
// page/sub-tab being selected + the turn (and the analytics policy it masks by), NOT on unrelated
// history-view state (time filters, other metrics). Skip the rebuild when nothing relevant changed.

/**
 * Whether the external panel is already rendered into this host for the same id, turn, and policy
 * (so the rebuild can be skipped).
 * @param {string} activeMetric Active metric/panel/sub-tab id.
 * @param {number} turn Current game turn.
 * @param {string} policy Effective analytics-visibility policy.
 * @param {HTMLElement} chartHost Chart host element.
 * @returns {boolean} True when the existing DOM can be kept.
 */
function extUnchanged(activeMetric, turn, policy, chartHost) {
  return _extLast.id === activeMetric && _extLast.turn === turn && _extLast.host === chartHost
    && _extLast.policy === policy && chartHost.childElementCount > 0;
}

/**
 * Render a companion-registered external panel (registerPanel) by handing it the chart host. The
 * companion owns the entire body; a throw inside it must never break the screen. Re-renders on any
 * real change (page/sub-tab switch, new host, turn advance, analytics-policy change), else skips.
 * @param {HTMLElement} chartHost Chart host element.
 * @param {*} ctx Render context.
 * @param {string} activeMetric Active metric/panel/sub-tab id.
 * @returns {boolean} True if an external panel handled it.
 */
function tryRenderExternalPanel(chartHost, ctx, activeMetric) {
  const found = findPanelFor(activeMetric);
  if (!found || typeof found.panel.render !== "function") return false;
  const turn = currentTurn();
  const policy = safePolicy();
  if (extUnchanged(activeMetric, turn, policy, chartHost)) {
    return true; // unchanged since last render into this host , leave the existing DOM in place
  }
  try {
    chartHost.innerHTML = "";
    found.panel.render(chartHost, ctx, found.subId);
    _extLast = { id: activeMetric, turn, host: chartHost, policy };
  } catch (e) {
    // The history ctx doesn't carry derr, so a companion-panel throw was previously swallowed with
    // no trace; log it so a broken external panel is at least diagnosable.
    if (ctx && typeof ctx.derr === "function") ctx.derr("external panel render:", e);
    else console.error("[Demographics] external panel render:", e);
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
      onToggleCiv: (/** @type {string} */ leaderKey) => ctx.toggleCiv?.(leaderKey),
      onSetAllHidden: (/** @type {boolean} */ h, /** @type {string[]} */ keys) =>
        ctx.setAllCivsHidden?.(h, keys)
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
  if (tryRenderTrend(chartHost, ctx, activeMetric, size)) return true;
  if (tryRenderCrisis(chartHost, ctx, activeMetric)) return true;
  if (tryRenderBoards(chartHost, ctx, activeMetric, size)) return true;
  return tryRenderWars(chartHost, ctx, activeMetric, turnRange, size);
}

/**
 * by-type synthetic ids → their Game.Summary datapoint + GameInfo lookup table.
 * @type {Record<string, {datapointId:string, lookup:string}>}
 */
const BYTYPE_SPECS = {
  units_trained_type: { datapointId: "UnitsTrainedByType", lookup: "Units" },
  units_killed_type: { datapointId: "UnitsKilledByType", lookup: "Units" },
  units_lost_type: { datapointId: "UnitsLostByType", lookup: "Units" }
};

/**
 * Per-settlement, per-civ boards: synthetic id → the settlement count field.
 * Districts / Buildings broken down by settlement, grouped by leader/civilization.
 * @type {Record<string, {field:string, typesField?:string, empty:string}>}
 */
const SETTLEMENT_BOARDS = {
  buildings_type: { field: "buildings", typesField: "buildingTypes", empty: "LOC_DEMOGRAPHICS_BOARD_NO_BUILDINGS" }
};

/**
 * Synthetic board id → renderer invocation. Renderers are statically exported
 * (always present), so no per-id `typeof` guard is needed here.
 * @type {Record<string, (cm:*, host:HTMLElement, ctx:*) => void>}
 */
const BOARD_RENDERERS = {
  wonders_board: (cm, h, ctx) => cm.renderWondersBoard(h, { history: ctx.history }),
  wonder_races: (cm, h, ctx) => cm.renderWonderRaces(h, { history: ctx.history }),
  religion_pantheons: (cm, h, ctx) => cm.renderReligionPantheons(h, { history: ctx.history }),
  religion_pantheon_yields: (cm, h, ctx) => cm.renderReligionPantheonYields(h, { history: ctx.history }),
  religion_standings: (cm, h) => cm.renderReligionStandings(h, {}),
  religion_spread: (cm, h, ctx) => cm.renderReligionSpread(h, { history: ctx.history }),
  religion_by_pop: (cm, h, ctx) => cm.renderReligionByPop(h, { history: ctx.history }),
  settlements_atlas: (cm, h) => cm.renderSettlementsAtlas(h, {})
};

/**
 * Two-axis "Fingerprint" scatters: synthetic id → the metric pair + axis titles.
 * Each renders every civ as a dot so the cloud shape reveals strategic archetypes.
 * @type {Record<string, {xMetric:string, yMetric:string, xTitle:string, yTitle:string}>}
 */
const SCATTER_SPECS = {
  civ_scatter: {
    xMetric: "science_yield", yMetric: "milpower",
    xTitle: "LOC_DEMOGRAPHICS_SCATTER_AXIS_SCIENCE_PT", yTitle: "LOC_DEMOGRAPHICS_SCATTER_AXIS_MILITARY_POWER"
  },
  scatter_wealth_culture: {
    xMetric: "gpt", yMetric: "culture_yield",
    xTitle: "LOC_DEMOGRAPHICS_SCATTER_AXIS_GOLD_PT", yTitle: "LOC_DEMOGRAPHICS_SCATTER_AXIS_CULTURE_PT"
  },
  scatter_soft_power: {
    xMetric: "influence", yMetric: "hpt",
    xTitle: "LOC_DEMOGRAPHICS_SCATTER_AXIS_INFLUENCE_PT", yTitle: "LOC_DEMOGRAPHICS_SCATTER_AXIS_HAPPINESS_PT"
  }
};

/**
 * Trend/compare charts that share the line-chart legend + civ filter: id → the
 * chartMod renderer name. Rendered via the synthetic path so they receive the
 * canvas size and the hidden-civ toggle callbacks.
 * @type {Record<string, string>}
 */
const FILTERABLE_TRENDS = {
  power_race: "renderPowerRace",
  pop_share_area: "renderPopShareArea",
  land_share_area: "renderLandShareArea",
  power_radar: "renderPowerRadar"
};

/**
 * Attempt a filterable trend/compare chart (Power Race, Population Share, Power
 * Fingerprint): a Chart.js / SVG render wired to the shared civ-filter legend.
 * @param {HTMLElement} chartHost Chart host element.
 * @param {*} ctx Render context.
 * @param {string} activeMetric Active metric id.
 * @param {{ width: number, height: number }} size Chart size.
 * @returns {boolean} True if handled.
 */
function tryRenderTrend(chartHost, ctx, activeMetric, size) {
  const fnName = FILTERABLE_TRENDS[activeMetric];
  const cm = /** @type {*} */ (ctx.chartMod);
  if (!fnName || typeof cm[fnName] !== "function") return false;
  cm[fnName](chartHost, {
    history: ctx.history,
    width: size.width,
    height: size.height,
    hiddenCivs: ctx.hiddenCivs,
    onToggleCiv: (/** @type {string} */ k) => ctx.toggleCiv?.(k),
    onSetAllHidden: (/** @type {boolean} */ h, /** @type {string[]} */ keys) => ctx.setAllCivsHidden?.(h, keys)
  });
  return true;
}

/**
 * Attempt plain-DOM / SVG board synthetic rendering (Wonders, by-type, Religion,
 * Atlas), plus the Chart.js civ scatters (which need the canvas size).
 * @param {HTMLElement} chartHost Chart host element.
 * @param {*} ctx Render context.
 * @param {string} activeMetric Active metric id.
 * @param {{ width: number, height: number }} [size] Chart size (for the scatters).
 * @returns {boolean} True if handled.
 */
function tryRenderBoards(chartHost, ctx, activeMetric, size) {
  const cm = /** @type {*} */ (ctx.chartMod);
  const fn = BOARD_RENDERERS[activeMetric];
  if (fn) {
    fn(cm, chartHost, ctx);
    return true;
  }
  const scatter = SCATTER_SPECS[activeMetric];
  if (scatter && typeof cm.renderCivScatter === "function") {
    cm.renderCivScatter(chartHost, {
      history: ctx.history, ...scatter,
      width: size?.width,
      height: size?.height,
      hiddenCivs: ctx.hiddenCivs,
      onToggleCiv: (/** @type {string} */ k) => ctx.toggleCiv?.(k),
      onSetAllHidden: (/** @type {boolean} */ h, /** @type {string[]} */ keys) => ctx.setAllCivsHidden?.(h, keys)
    });
    return true;
  }
  return tryConstructibleBoards(cm, chartHost, ctx, activeMetric);
}

/**
 * Attempt the constructible-based boards: Quarters (districts_type), the per-settlement
 * Buildings board, and the Game.Summary by-type breakdowns.
 * @param {*} cm The chart module. @param {HTMLElement} chartHost The host.
 * @param {*} ctx Render context. @param {string} activeMetric Active metric id.
 * @returns {boolean} True if handled.
 */
function tryConstructibleBoards(cm, chartHost, ctx, activeMetric) {
  if (activeMetric === "districts_type" && typeof cm.renderQuartersBoard === "function") {
    cm.renderQuartersBoard(chartHost, {});
    return true;
  }
  const settle = SETTLEMENT_BOARDS[activeMetric];
  if (settle && typeof cm.renderConstructiblesBoard === "function") {
    cm.renderConstructiblesBoard(chartHost, settle);
    return true;
  }
  const spec = BYTYPE_SPECS[activeMetric];
  if (spec && typeof cm.renderByTypeBoard === "function") {
    cm.renderByTypeBoard(chartHost, { history: ctx.history, ...spec });
    return true;
  }
  return false;
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
  // Building a fresh host: drop any prior chart's reflow so a resize during the
  // NYI-placeholder case (below) can't re-render a stale, detached chart.
  activeChartReflow = null;

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

  // Re-fit THIS chart on resize / Interface-Size change. External panels skip
  // redundant rebuilds keyed by turn (extUnchanged); a resize isn't a turn change,
  // so clear that skip cache first to force them to re-measure too. Bail (and
  // release the closure) once the host detaches.
  activeChartReflow = () => {
    if (chartHost.isConnected === false) {
      activeChartReflow = null;
      return;
    }
    _extLast = { id: null, turn: -1, host: null, policy: "" };
    doRender();
  };
  ensureChartResizeReflow();

  // Measure after TWO frames so GameFace has finished laying out the flex column (controls row +
  // chart host). One frame can read a not-yet-settled host and clamp the canvas to its small floor,
  // which renders a chart that stays small instead of filling the window.
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => requestAnimationFrame(doRender));
  } else {
    setTimeout(doRender, 0);
  }
}
