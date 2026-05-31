// view-history.js
//
// "Historical Data" view: a paginated metric tab bar, the chart, and the
// per-civ legend. Mirrors the layout of the V5 main historical-graphs
// panel — three metric pages plus the chart.js renderer.
//
// The page list keeps placeholders for metrics that aren't wired up yet
// (milpower, wonders); those render as disabled tabs labelled "Not yet
// implemented".
//
// This file is the render orchestrator. The toolbar / tab-row builders, the
// time-range filter, and the CSV export each live in a sibling module; the
// public API (PAGES, render, computeTurnRange, buildTimeFilterRow,
// exportHistoryAsCsv) is preserved by re-exporting the relocated symbols here.

import { METRICS, getMetric } from "/demographics/ui/demographics-metrics.js";
import {
  buildPageTabRow,
  buildMetricTabRow,
  buildChartTitle,
  appendMetricCaptions,
  buildToolbar
} from "/demographics/ui/screen-demographics/views/history-toolbar.js";
import {
  TIME_FILTERS,
  computeTurnRange,
  buildTimeFilterRow
} from "/demographics/ui/screen-demographics/views/history-time-filter.js";

// Re-export the relocated public symbols so external importers and the public
// API are unchanged.
export {
  computeTurnRange,
  buildTimeFilterRow
} from "/demographics/ui/screen-demographics/views/history-time-filter.js";
export { exportHistoryAsCsv } from "/demographics/ui/screen-demographics/views/history-csv.js";

/**
 * One metric page in the tab bar: an id, a localization key, and the ordered
 * list of metric ids it shows.
 * @typedef {Object} PageDef
 * @property {string} id Stable page id.
 * @property {string} label Localization key for the page tab label.
 * @property {string[]} metrics Metric ids in display order.
 */

/**
 * Metadata for a synthetic metric that routes to a custom chart renderer.
 * @typedef {Object} SyntheticMeta
 * @property {string} label Short tab label.
 * @property {string} title Chart title text.
 * @property {string} [subtitle] Optional parenthetical subtitle line.
 */

/**
 * Inclusive turn window the chart clamps to, or null for the full domain.
 * @typedef {Object} TurnRange
 * @property {number} min First turn shown.
 * @property {number} max Last turn shown.
 */

/**
 * Chart-module surface read off the render context. All members are optional;
 * each is feature-detected before use. Loose at the engine boundary.
 * @typedef {Object} HistoryChartMod
 * @property {(host: HTMLElement, opts: *) => void} [renderChart]
 * @property {(host: HTMLElement, opts: *) => void} [renderLegacyRadar]
 * @property {(host: HTMLElement, opts: *) => void} [renderTriumphStack]
 * @property {(host: HTMLElement, opts: *) => void} [renderResourcesStack]
 * @property {(host: HTMLElement, opts: *) => void} [renderWarsGantt]
 * @property {(history: *) => Array<*>} [collectWarCivOptions]
 * @property {(history: *) => Array<*>} [collectTriumphCivOptions]
 * @property {(history: *) => Array<*>} [collectResourceCivOptions]
 * @property {(mode: string) => void} [setXAxisMode]
 */

/**
 * Persisted-setting accessor surface read off the render context.
 * @typedef {Object} HistorySettings
 * @property {(key: string, fallback?: *) => *} [getSetting] Read a setting.
 * @property {(key: string, value: *) => void} [setSetting] Write a setting.
 */

/**
 * Render context handed to {@link render}. Engine-boundary callbacks are loose.
 * @typedef {Object} HistoryCtx
 * @property {DemoHistory} [history] The full persisted history blob.
 * @property {string} [activeMetric] Currently selected metric id.
 * @property {string} [activePage] Currently selected page id.
 * @property {string} [activeTimeFilter] Currently selected time-filter id.
 * @property {string} [activeRadarAge] Selected radar snapshot age source.
 * @property {Set<string>} [hiddenCivs] Leader keys hidden from the chart.
 * @property {Set<string>} [focusedCivs] Leader keys focused (head-to-head).
 * @property {HistoryChartMod} [chartMod] Chart-rendering module.
 * @property {HistorySettings} [settings] Persisted-setting accessor.
 * @property {Pid|null} [warsFilterPid] Active wars-view civ filter.
 * @property {boolean} [warsActiveOnly] Show only ongoing wars.
 * @property {boolean} [warsShowCs] Show city-state wars.
 * @property {Pid} [triumphsViewerPid] Selected triumphs viewer civ.
 * @property {Pid} [resourcesViewerPid] Selected resources viewer civ.
 * @property {(id: string) => void} [setActiveMetric] Select a metric.
 * @property {(id: string) => void} [setActivePage] Select a page.
 * @property {(id: string) => void} [setActiveTimeFilter] Select a time filter.
 * @property {(id: string) => void} [setActiveRadarAge] Select a radar age.
 * @property {(pid: Pid|null) => void} [setWarsFilterPid] Set wars civ filter.
 * @property {(v: boolean) => void} [setWarsActiveOnly] Toggle ongoing-only.
 * @property {(pid: Pid) => void} [setTriumphsViewerPid] Set triumphs viewer.
 * @property {(pid: Pid) => void} [setResourcesViewerPid] Set resources viewer.
 * @property {(leaderKey: string) => void} [toggleCiv] Hide/show a civ.
 * @property {(leaderKey: string) => void} [toggleFocusCiv] Focus/unfocus a civ.
 * @property {() => void} [clearFocus] Clear all focused civs.
 * @property {() => void} [requestReload] Re-render the active view.
 */

const DBG = false;
/**
 * Debug logger, no-op unless {@link DBG} is set.
 * @param {...*} a Values to log.
 * @returns {void}
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.view-history]", ...a);
}
/**
 * Error logger for this view.
 * @param {...*} a Values to log.
 * @returns {void}
 */
function derr(...a) {
  console.error("[Demographics.view-history]", ...a);
}

/**
 * Page definitions. Each page lists metric IDs in display order. IDs that
 * don't exist in METRICS register as placeholder ("Not yet implemented").
 * @type {PageDef[]}
 */
export const PAGES = [
  {
    id: "economy",
    label: "LOC_DEMOGRAPHICS_PAGE_ECONOMY",
    metrics: ["score", "gdp", "gold", "gpt", "production", "crops", "trade"]
  },
  {
    id: "power",
    label: "LOC_DEMOGRAPHICS_PAGE_POWER",
    metrics: ["milpower", "population", "settlements", "settlement_cap_pct", "land", "wonders"]
  },
  {
    id: "knowledge",
    label: "LOC_DEMOGRAPHICS_PAGE_KNOWLEDGE",
    metrics: [
      "techs",
      "civics",
      "science_yield",
      "culture_yield",
      "influence",
      "hpt",
      "approval",
      "deals"
    ]
  },
  {
    // Civ7 Test of Time triumph dashboard + crisis stage. All four
    // triumph views are SYNTHETIC metrics — they route to dedicated
    // renderers in demographics-chart.js rather than the line-chart
    // pipeline. The per-attribute line graphs were removed; a step-
    // counter over hundreds of turns is poor info density next to the
    // radar / race / completion / stack views below.
    id: "age",
    label: "LOC_DEMOGRAPHICS_PAGE_AGE",
    // `triumphs_race` and `triumphs_completion` removed — per-civ progress
    // bars now ride on the NATIVE Legacies → Triumphs cards via
    // ui/demographics-triumphs-decorator.js. Cloning them inside Info
    // Addict was redundant once the in-game cards carry the same data.
    metrics: ["legacy_radar", "triumphs_stack", "crisis_stage"]
  },
  {
    // Resource-allocation page. First metric is a stacked-area page-
    // level view showing the LOCAL player's per-category resource
    // count over time; the rest are per-category line charts that
    // compare ALL civs in the standard chart pipeline.
    id: "resources",
    label: "LOC_DEMOGRAPHICS_PAGE_RESOURCES",
    metrics: [
      "resources_stack",
      "resources_total",
      "resources_bonus",
      "resources_empire",
      "resources_city",
      "resources_factory",
      "resources_treasure"
    ]
  },
  {
    // Conflicts page: Gantt chart of every war this game has seen.
    // Tracked by the sampler against `history.wars`.
    id: "conflicts",
    label: "LOC_DEMOGRAPHICS_PAGE_CONFLICTS",
    metrics: ["wars_gantt"]
  }
];

/**
 * Synthetic "metrics" that route to a custom renderer instead of the
 * standard line-chart pipeline. They live in PAGES.metrics like normal
 * tab IDs but have no entry in METRICS; metricExists() must accept them
 * or the page logic would fall through to the "Not yet implemented" stub.
 * @type {Record<string, SyntheticMeta>}
 */
const SYNTHETIC_METRICS = {
  legacy_radar: {
    label: "Radar",
    title: "Triumph Radar — all civs, all 6 attribute paths"
  },
  triumphs_stack: {
    label: "Triumphs Over Time",
    // Two-line: bold heading + parenthetical subtitle below.
    title: "Triumphs Over Time",
    subtitle: "(Cumulative Count, Stacked by Attribute)"
  },
  resources_stack: {
    label: "Stacked",
    title: "Resource Allocation Over Time (stacked area)"
  },
  wars_gantt: {
    label: "Wars",
    title: "Conflicts Timeline — every war this game has seen"
  }
};
/**
 * Whether `id` names a synthetic metric routed to a custom renderer.
 * @param {string} id Metric id.
 * @returns {boolean} True if synthetic.
 */
function isSynthetic(id) {
  return Object.prototype.hasOwnProperty.call(SYNTHETIC_METRICS, id);
}
/**
 * Whether `id` is renderable — a synthetic metric or a real METRICS entry.
 * @param {string} id Metric id.
 * @returns {boolean} True if renderable.
 */
export function metricExists(id) {
  return isSynthetic(id) || METRICS.some((m) => m.id === id);
}

/**
 * Run `fn`, returning its result or `fb` if it throws.
 * @template T
 * @param {() => T} fn Thunk to run.
 * @param {T} [fb] Fallback value on throw.
 * @returns {T|undefined} The result or the fallback.
 */
function safeCall(fn, fb) {
  try {
    return fn();
  } catch (e) {
    derr("safeCall:", e);
    return fb;
  }
}

/**
 * Remove every child of `host`.
 * @param {HTMLElement} host Element to empty.
 * @returns {void}
 */
function clearHost(host) {
  while (host.firstChild) host.removeChild(host.firstChild);
}

/**
 * Resolve the active page id from `ctx`, defaulting to "economy" when the
 * persisted id is missing or unknown.
 * @param {HistoryCtx} ctx Render context.
 * @returns {string} A valid page id.
 */
function resolveActivePage(ctx) {
  return ctx.activePage && PAGES.some((p) => p.id === ctx.activePage) ? ctx.activePage : "economy";
}

/**
 * Resolve the active metric for `page` from `ctx`, falling back to the first
 * implemented metric (or "score") when the persisted metric isn't valid here.
 * @param {HistoryCtx} ctx Render context.
 * @param {PageDef} page The active page.
 * @returns {string} A valid metric id within `page`.
 */
function resolveActiveMetric(ctx, page) {
  let activeMetric = ctx.activeMetric || "";
  const activeInPage = page.metrics.includes(activeMetric) && metricExists(activeMetric);
  if (!activeInPage) {
    activeMetric = page.metrics.find(metricExists) || "score";
  }
  return activeMetric;
}

/**
 * Resolve the active time filter from `ctx`, falling back to "age" when the
 * persisted value is a disabled cross-age filter or otherwise invalid.
 * @param {HistoryCtx} ctx Render context.
 * @returns {string} A valid, enabled filter id.
 */
function resolveActiveFilter(ctx) {
  let activeFilter = ctx.activeTimeFilter || "age";
  // Belt-and-suspenders: if anything upstream passed us a disabled
  // cross-age filter (stale state, manual settings edit, etc.) fall
  // back to the current-age window so the chart renders something.
  if (["all", "age1", "age2", "age3"].includes(activeFilter)) activeFilter = "age";
  const activeDef = TIME_FILTERS.find((f) => f.id === activeFilter);
  if (!activeDef || activeDef.disabled) activeFilter = "age";
  return activeFilter;
}

/**
 * Compute the clamped chart dimensions from `chartHost`'s measured rect,
 * falling back to the static 1600×600 defaults when the rect is 0×0.
 * @param {HTMLElement} chartHost The chart host element.
 * @returns {{ width: number, height: number }} Clamped pixel dimensions.
 */
function measureChartSize(chartHost) {
  const hostRect = chartHost.getBoundingClientRect?.();
  const width = Math.max(960, Math.min(2800, Math.round(hostRect?.width || 1600)));
  const height = Math.max(360, Math.min(1400, Math.round(hostRect?.height || 600)));
  return { width, height };
}

/**
 * Route a chart render to the appropriate chartMod renderer for `activeMetric`:
 * the synthetic page-level views (radar / triumphs / resources / wars) each
 * have a dedicated renderer; everything else falls through to the standard
 * line chart.
 * @param {HTMLElement} chartHost The chart host element.
 * @param {HistoryCtx} ctx Render context.
 * @param {string} activeMetric Active metric id.
 * @param {TurnRange|null} turnRange Active turn window.
 * @param {number} width Chart width in pixels.
 * @param {number} height Chart height in pixels.
 * @returns {void}
 */
function routeChartRender(chartHost, ctx, activeMetric, turnRange, width, height) {
  if (tryRenderSynthetic(chartHost, ctx, activeMetric, turnRange, width, height)) return;
  renderStandardChart(chartHost, ctx, activeMetric, turnRange, width, height);
}

/**
 * Render one of the synthetic page-level views (radar / triumphs / resources /
 * wars) when `activeMetric` names one and its renderer is available.
 * @param {HTMLElement} chartHost The chart host element.
 * @param {HistoryCtx} ctx Render context.
 * @param {string} activeMetric Active metric id.
 * @param {TurnRange|null} turnRange Active turn window.
 * @param {number} width Chart width in pixels.
 * @param {number} height Chart height in pixels.
 * @returns {boolean} True when a synthetic renderer handled the render.
 */
function tryRenderSynthetic(chartHost, ctx, activeMetric, turnRange, width, height) {
  const chartMod = /** @type {HistoryChartMod} */ (ctx.chartMod);
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
  if (activeMetric === "triumphs_stack" && typeof chartMod.renderTriumphStack === "function") {
    chartMod.renderTriumphStack(chartHost, {
      history: ctx.history,
      width,
      height,
      turnRange,
      viewerPid: ctx.triumphsViewerPid
    });
    return true;
  }
  if (activeMetric === "resources_stack" && typeof chartMod.renderResourcesStack === "function") {
    chartMod.renderResourcesStack(chartHost, {
      history: ctx.history,
      width,
      height,
      turnRange,
      viewerPid: ctx.resourcesViewerPid
    });
    return true;
  }
  if (activeMetric === "wars_gantt" && typeof chartMod.renderWarsGantt === "function") {
    // Wars timeline shows EVERY war regardless of the line-chart
    // time filter. Clamping to "current age" silently hid wars
    // from earlier ages and produced an empty chart for mid- and
    // late-game saves.
    chartMod.renderWarsGantt(chartHost, {
      history: ctx.history,
      width,
      height,
      turnRange: null,
      filterPid: ctx.warsFilterPid,
      showCs: ctx.warsShowCs !== false,
      activeOnly: ctx.warsActiveOnly
    });
    return true;
  }
  return false;
}

/**
 * Render the standard per-civ line chart for `activeMetric`.
 * @param {HTMLElement} chartHost The chart host element.
 * @param {HistoryCtx} ctx Render context.
 * @param {string} activeMetric Active metric id.
 * @param {TurnRange|null} turnRange Active turn window.
 * @param {number} width Chart width in pixels.
 * @param {number} height Chart height in pixels.
 * @returns {void}
 */
function renderStandardChart(chartHost, ctx, activeMetric, turnRange, width, height) {
  const chartMod = /** @type {HistoryChartMod} */ (ctx.chartMod);
  chartMod.renderChart?.(chartHost, {
    history: ctx.history,
    metric: activeMetric,
    hiddenCivs: ctx.hiddenCivs,
    focusedCivs: ctx.focusedCivs,
    width,
    height,
    turnRange,
    onToggleCiv: (/** @type {string} */ leaderKey) => {
      // Repurposed: clicking a line label toggles FOCUS on
      // that civ (head-to-head view) rather than hiding.
      if (typeof ctx.toggleFocusCiv === "function") ctx.toggleFocusCiv(leaderKey);
      else ctx.toggleCiv?.(leaderKey);
    }
  });
}

/**
 * Build and append the chart host, then either show the "Not yet implemented"
 * placeholder or schedule a deferred render once flex layout has settled (so
 * the chart-host rect is measurable rather than 0×0 on first attach).
 * @param {HTMLElement} host The view host element.
 * @param {HistoryCtx} ctx Render context.
 * @param {string} activeMetric Active metric id.
 * @param {TurnRange|null} turnRange Active turn window.
 * @returns {void}
 */
function buildChartHost(host, ctx, activeMetric, turnRange) {
  const chartHost = document.createElement("div");
  chartHost.className = "demographics-chart-host relative flex flex-col items-center";
  host.appendChild(chartHost);

  if (!metricExists(activeMetric)) {
    // Placeholder for unimplemented metric.
    const ph = document.createElement("div");
    ph.className = "demographics-nyi font-body text-base";
    ph.textContent = "Not yet implemented — coming in a future iteration.";
    chartHost.appendChild(ph);
    return;
  }
  // Defer to the next tick so flex layout completes and we can read
  // the chart-host's real width/height (otherwise rect is 0×0 on
  // first attach and we'd fall back to the static 1600×600 defaults
  // that don't fill the screen).
  const doRender = () =>
    safeCall(() => {
      const { width, height } = measureChartSize(chartHost);
      dlog("chart render size=" + width + "x" + height, "activeMetric=" + activeMetric);
      routeChartRender(chartHost, ctx, activeMetric, turnRange, width, height);
    });
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(doRender);
  } else {
    setTimeout(doRender, 0);
  }
}

/**
 * Render the Historical Data view into `host`: clears the host, then builds the
 * page tab row, metric tab row, chart title + captions, time-range filter row,
 * toolbar, and chart host in their fixed display order.
 * @param {HTMLElement} host The view host element (cleared and repopulated).
 * @param {HistoryCtx} ctx Render context (history, selection state, callbacks).
 * @returns {void}
 */
export function render(host, ctx) {
  clearHost(host);

  // ── Page tab row ────────────────────────────────────────────────────
  const activePage = resolveActivePage(ctx);
  buildPageTabRow(host, ctx, activePage);

  // ── Metric tab row (for the active page) ───────────────────────────
  const page = PAGES.find((p) => p.id === activePage) || PAGES[0];
  // Active metric: only valid if it's in this page AND exists.
  const activeMetric = resolveActiveMetric(ctx, page);
  buildMetricTabRow(host, ctx, page, activeMetric);

  // ── Chart title (full descriptive name above the plot) ────────────
  const metricObj = (() => {
    try {
      return getMetric(activeMetric);
    } catch (_) {
      return null;
    }
  })();
  const synthMeta = isSynthetic(activeMetric) ? SYNTHETIC_METRICS[activeMetric] : null;
  buildChartTitle(host, activeMetric, metricObj, synthMeta);

  // ── Per-metric explanation caption (moved ABOVE the filter row so the
  //    page reads top-down as: title → caption → filters → chart). ──
  appendMetricCaptions(host, activeMetric);

  // ── Time-range filter row ─────────────────────────────────────────
  // The time-range filter is only meaningful for time-series charts.
  // Race / Completion show a snapshot of current legacies and ignore the
  // turn window entirely, so hide the row for those metrics to avoid
  // suggesting they're filterable.
  //
  // If the persisted active filter is now disabled (cross-age filters
  // are greyed out — see CROSS_AGE_DISABLED_TOOLTIP), silently fall
  // back to "age" (Current Age) so the chart still renders a sane
  // default instead of an empty window.
  const activeFilter = resolveActiveFilter(ctx);
  const turnRange = computeTurnRange(ctx.history, activeFilter);
  const TIME_FILTER_HIDDEN_FOR = new Set(["legacy_radar"]);
  if (!TIME_FILTER_HIDDEN_FOR.has(activeMetric)) {
    const filterRow = buildTimeFilterRow(activeFilter, (id) => {
      if (typeof ctx.setActiveTimeFilter === "function") ctx.setActiveTimeFilter(id);
    });
    host.appendChild(filterRow);
  }

  // ── Toolbar: viewer dropdown (resources only), focus-clear, CSV ──
  buildToolbar(host, ctx, activeMetric);

  // ── Chart host ─────────────────────────────────────────────────────
  buildChartHost(host, ctx, activeMetric, turnRange);

  // Line labels on the right edge of the chart now serve as the legend
  // (clickable to hide; hidden civs appear as faded labels below the
  // plot area, clickable to restore). The bottom legend list was
  // removed to simplify the UI.
  // Per-metric explanation captions are appended ABOVE the chart (after
  // the title) — see the earlier block in this function. Kept the
  // bottom-of-chart block free of duplicates.
}
