// view-history.js
//
// "Historical Data" view: a paginated metric tab bar, the chart, and the
// per-civ legend. Mirrors the layout of the V5 main historical-graphs
// panel - three metric pages plus the chart.js renderer.
//
// The page list keeps placeholders for metrics that aren't wired up yet
// (milpower, wonders); those render as disabled tabs labelled "Not yet
// implemented".
//
// This file is the render orchestrator. The toolbar / tab-row builders, the
// time-range filter, and the CSV export each live in a sibling module; the
// public API (PAGES, render, computeTurnRange, buildTimeFilterRow,
// exportHistoryAsCsv) is preserved by re-exporting the relocated symbols here.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { getMetric } from "/demographics/ui/metrics/demographics-metrics.js";
import {
  buildPageTabRow,
  buildMetricTabRow,
  buildChartTitle
} from "/demographics/ui/screen-demographics/views/history/history-tabs.js";
import { appendMetricCaptions } from "/demographics/ui/screen-demographics/views/history/history-captions.js";
import { buildToolbar } from "/demographics/ui/screen-demographics/views/history/history-controls.js";
import {
  TIME_FILTERS,
  computeTurnRange,
  buildTimeFilterRow
} from "/demographics/ui/screen-demographics/views/history/history-time-filter.js";
import {
  buildChartHostPanel
} from "/demographics/ui/screen-demographics/views/history/view-history-chart-render.js";
import {
  resolveActiveFilterState,
  resolveActiveMetricState,
  resolveActivePageState
} from "/demographics/ui/screen-demographics/views/history/view-history-state.js";

// Re-export the relocated public symbols so external importers and the public
// API are unchanged.
export {
  computeTurnRange,
  buildTimeFilterRow
} from "/demographics/ui/screen-demographics/views/history/history-time-filter.js";
export { exportHistoryAsCsv } from "/demographics/ui/screen-demographics/views/history/history-csv.js";

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
 * @property {(host: HTMLElement, opts: *) => void} [renderResourcesStack]
 * @property {(host: HTMLElement, opts: *) => void} [renderConflictsTimeline]
 * @property {(host: HTMLElement, opts: *) => void} [renderConflictsGraphs]
 * @property {(host: HTMLElement, opts: *) => void} [renderCrisisStages]
 * @property {(host: HTMLElement, opts: *) => void} [renderCrisisGraphs]
 * @property {(history: *) => Array<*>} [collectWarCivOptions]
 * @property {(history: *) => Array<*>} [collectResourceCivOptions]
 * @property {(history: *) => Array<{ id: string, label: string }>} [collectCrisisScopes]
 * @property {(history: *, scopeId: *) => string} [resolveCrisisScope]
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
 * @property {number|null} [warGraphsWarId] Selected war (warUniqueID) for the War Graphs sub-tab.
 * @property {string} [crisisGraphsAge] Selected crisis scope for the Crisis Graphs sub-tab.
 * @property {Pid} [resourcesViewerPid] Selected resources viewer civ.
 * @property {(id: string) => void} [setActiveMetric] Select a metric.
 * @property {(id: string) => void} [setActivePage] Select a page.
 * @property {(id: string) => void} [setActiveTimeFilter] Select a time filter.
 * @property {(id: string) => void} [setActiveRadarAge] Select a radar age.
 * @property {(pid: Pid|null) => void} [setWarsFilterPid] Set wars civ filter.
 * @property {(id: number|null) => void} [setWarGraphsWarId] Select a war for War Graphs.
 * @property {(id: string) => void} [setCrisisGraphsAge] Select a crisis scope for Crisis Graphs.
 * @property {(v: boolean) => void} [setWarsActiveOnly] Toggle ongoing-only.
 * @property {(pid: Pid) => void} [setResourcesViewerPid] Set resources viewer.
 * @property {(leaderKey: string) => void} [toggleCiv] Hide/show a civ.
 * @property {(hide: boolean, keys: string[]) => void} [setAllCivsHidden]
 *   Hide/show all civs at once.
 * @property {(leaderKey: string) => void} [toggleFocusCiv] Focus/unfocus a civ.
 * @property {() => void} [clearFocus] Clear all focused civs.
 * @property {() => void} [requestReload] Re-render the active view.
 */

const DBG = false;
/**
 * Debug logger, no-op unless {@link DBG} is set.
 * @param {...*} a Values to log.
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.view-history]", ...a);
}
/**
 * Error logger for this view.
 * @param {...*} a Values to log.
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
    // triumph views are SYNTHETIC metrics - they route to dedicated
    // renderers in demographics-chart.js rather than the line-chart
    // pipeline. The per-attribute line graphs were removed; a step-
    // counter over hundreds of turns is poor info density next to the
    // radar / race / completion / stack views below.
    id: "age",
    label: "LOC_DEMOGRAPHICS_PAGE_AGE",
    // `triumphs_race` and `triumphs_completion` removed - per-civ progress
    // bars now ride on the native Legacies → Triumphs cards via the
    // standalone `triumphs-progress-overlay` mod. Cloning them inside Info
    // Addict was redundant once the in-game cards carry the same data.
    metrics: ["legacy_radar"]
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
    metrics: ["wars_gantt", "war_graphs"]
  },
  {
    // Crises page: the current age's crisis broken into its stages, each with a
    // permanent per-civ cost section (the war-tooltip table sans war-only rows).
    id: "crises",
    label: "LOC_DEMOGRAPHICS_PAGE_CRISES",
    metrics: ["crisis_stages", "crisis_graphs"]
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
    title: "LOC_DEMOGRAPHICS_SYNTH_RADAR_TITLE"
  },
  resources_stack: {
    label: "Stacked",
    title: "LOC_DEMOGRAPHICS_SYNTH_RESOURCES_TITLE"
  },
  wars_gantt: {
    label: "Wars",
    title: "LOC_DEMOGRAPHICS_SYNTH_WARS_TITLE"
  },
  war_graphs: {
    label: "War Graphs",
    title: "LOC_DEMOGRAPHICS_SYNTH_WAR_GRAPHS_TITLE"
  },
  crisis_stages: {
    label: "Crises",
    title: "LOC_DEMOGRAPHICS_SYNTH_CRISIS_TITLE"
  },
  crisis_graphs: {
    label: "Graphs",
    title: "LOC_DEMOGRAPHICS_SYNTH_CRISIS_GRAPHS_TITLE"
  }
};

/**
 * Resolve a synthetic metric's display meta, localizing its title/subtitle
 * (stored as `LOC_*` keys) at render time. The non-displayed `label` field is
 * passed through unchanged.
 * @param {string} id Synthetic metric id.
 * @returns {SyntheticMeta|null} The localized meta, or null when not synthetic.
 */
function resolveSyntheticMeta(id) {
  const raw = SYNTHETIC_METRICS[id];
  if (!raw) return null;
  /** @type {SyntheticMeta} */
  const meta = { label: raw.label, title: t(raw.title) };
  if (raw.subtitle) meta.subtitle = t(raw.subtitle);
  return meta;
}
/**
 * Whether `id` names a synthetic metric routed to a custom renderer.
 * @param {string} id Metric id.
 * @returns {boolean} True if synthetic.
 */
function isSynthetic(id) {
  return Object.prototype.hasOwnProperty.call(SYNTHETIC_METRICS, id);
}
/**
 * Whether `id` is renderable - a synthetic metric or a real METRICS entry.
 * @param {string} id Metric id.
 * @returns {boolean} True if renderable.
 */
export function metricExists(id) {
  if (isSynthetic(id)) return true;
  const metric = getMetric(id);
  return !!metric && metric.id === id;
}

/**
 * Remove every child of `host`.
 * @param {HTMLElement} host Element to empty.
 */
function clearHost(host) {
  while (host.firstChild) host.removeChild(host.firstChild);
}

/**
 * Build and append the chart host, then route chart rendering.
 * @param {HTMLElement} host The view host element.
 * @param {HistoryCtx} ctx Render context.
 * @param {string} activeMetric Active metric id.
 * @param {TurnRange|null} turnRange Active turn window.
 */
function buildChartHost(host, ctx, activeMetric, turnRange) {
  buildChartHostPanel(host, ctx, activeMetric, turnRange, {
    metricExists,
    nyiText: t("LOC_DEMOGRAPHICS_EMPTY_NYI"),
    dlog,
    derr
  });
}

/**
 * Render the Historical Data view into `host`: clears the host, then builds the
 * page tab row, metric tab row, chart title + captions, time-range filter row,
 * toolbar, and chart host in their fixed display order.
 * @param {HTMLElement} host The view host element (cleared and repopulated).
 * @param {HistoryCtx} ctx Render context (history, selection state, callbacks).
 */
export function render(host, ctx) {
  clearHost(host);

  // ── Page tab row ────────────────────────────────────────────────────
  const activePage = resolveActivePageState(ctx, PAGES);
  buildPageTabRow(host, ctx, activePage);

  // ── Metric tab row (for the active page) ───────────────────────────
  const page = PAGES.find((p) => p.id === activePage) || PAGES[0];
  // Active metric: only valid if it's in this page AND exists.
  const activeMetric = resolveActiveMetricState(ctx, page, metricExists);
  buildMetricTabRow(host, ctx, page, activeMetric);

  // ── Chart title (full descriptive name above the plot) ────────────
  const metricObj = (() => {
    try {
      return getMetric(activeMetric);
    } catch (e) {
      derr("resolve metricObj:", e);
      return null;
    }
  })();
  const synthMeta = isSynthetic(activeMetric) ? resolveSyntheticMeta(activeMetric) : null;
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
  // are greyed out - see CROSS_AGE_DISABLED_TOOLTIP), silently fall
  // back to "age" (Current Age) so the chart still renders a sane
  // default instead of an empty window.
  const activeFilter = resolveActiveFilterState(ctx, TIME_FILTERS);
  const turnRange = computeTurnRange(ctx.history, activeFilter);
  // Crisis Graphs span every age (they ignore the turn window) and the Crisis
  // Stages tables show fixed per-stage windows, so the current-age/year time
  // filter would be misleading - hide it there.
  const TIME_FILTER_HIDDEN_FOR = new Set(["legacy_radar", "crisis_graphs", "crisis_stages"]);
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
  // the title) - see the earlier block in this function. Kept the
  // bottom-of-chart block free of duplicates.
}
