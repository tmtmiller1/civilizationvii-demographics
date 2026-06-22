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
import { DemographicsSettings } from "/demographics/ui/core/demographics-settings.js";
import {
  getMetric,
  EXTERNAL_PAGE_METRICS,
  EXTERNAL_PANELS,
  EXTERNAL_METRIC_GROUPS,
  PANEL_SUBTAB_SEP
} from "/demographics/ui/metrics/demographics-metrics.js";
import {
  buildPageTabRow,
  buildMetricTabRow,
  buildChartTitle,
  visibleMetricsForAge
} from "/demographics/ui/screen-demographics/views/history/history-tabs.js";
import {
  appendMetricCaptions,
  buildPolicyBanner
} from "/demographics/ui/screen-demographics/views/history/history-captions.js";
import { pillRow } from "/demographics/ui/screen-demographics/views/shared/view-pills.js";
import { buildToolbar } from "/demographics/ui/screen-demographics/views/history/history-controls.js";
import { buildOptionsButton } from "/demographics/ui/screen-demographics/views/shared/options-button.js";
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
 * Fold any companion-mod page placements (registerMetricToPage) into PAGES and
 * return PAGES. Idempotent and called each render, so it applies regardless of
 * when the external mod registered relative to this module loading.
 * @returns {typeof PAGES} The (possibly augmented) PAGES array.
 */
function mergeExternalPageMetrics() {
  mergeExternalPanels();
  for (const e of EXTERNAL_PAGE_METRICS) {
    const page = PAGES.find((p) => p.id === e.pageId);
    if (!page || !Array.isArray(page.metrics) || page.metrics.includes(e.metricId)) continue;
    const at = e.afterMetricId ? page.metrics.indexOf(e.afterMetricId) : -1;
    if (at >= 0) page.metrics.splice(at + 1, 0, e.metricId);
    else page.metrics.push(e.metricId);
  }
  mergeMetricGroups();
  return PAGES;
}

// Per-group selection (2D groups store {metric:idx, view:viewId}; flat groups store a metric id),
// PERSISTED so a Scaled/Civ (and metric) choice is sticky across reopening the screen — otherwise it
// reset to the first view each open and, via the companion-panel groupView, clobbered the Emigration
// tabs' remembered number mode.
const GROUP_SEL_KEY = "historyGroupSel";
/** @type {Record<string, *>|null} */
let _groupSel = null;

/** The persisted per-group selection map (lazily loaded from settings). */
function groupSelAll() {
  if (_groupSel) return _groupSel;
  let stored = null;
  try {
    stored = DemographicsSettings.getSetting(GROUP_SEL_KEY, null);
  } catch (_) {
    /* settings unavailable → in-memory only */
  }
  const next = stored && typeof stored === "object" ? stored : {};
  _groupSel = next;
  return next;
}

/**
 * Set + persist one group's selection.
 * @param {string} id The group id.
 * @param {*} val The selection ({metric, view} for 2D groups; a metric id for flat groups).
 */
function setGroupSel(id, val) {
  groupSelAll()[id] = val;
  try {
    DemographicsSettings.setSetting(GROUP_SEL_KEY, _groupSel);
  } catch (_) {
    /* settings unavailable → in-memory only */
  }
}

/** Every member metric id of a group (2D members×views, or a flat metricIds list). */
function groupMemberIds(/** @type {*} */ g) {
  if (Array.isArray(g.members) && Array.isArray(g.views)) {
    return g.members.flatMap((/** @type {*} */ m) => g.views.map((/** @type {*} */ v) => m[v.id]))
      .filter(Boolean);
  }
  return Array.isArray(g.metricIds) ? g.metricIds : [];
}

/**
 * Fold companion metric GROUPS into PAGES: register a synthetic-meta label for each group id, drop the
 * group's member metrics from their page's tab row (they're shown via the in-tab toggle instead), and
 * place the group id as a tab (at the front when `first`). Idempotent; called each render.
 */
function mergeMetricGroups() {
  for (const g of EXTERNAL_METRIC_GROUPS) {
    const page = PAGES.find((p) => p.id === g.pageId);
    if (!page || !Array.isArray(page.metrics)) continue;
    if (!SYNTHETIC_METRICS[g.id]) SYNTHETIC_METRICS[g.id] = { label: g.label, title: g.label };
    const members = groupMemberIds(g);
    page.metrics = page.metrics.filter((m) => !members.includes(m));
    if (!page.metrics.includes(g.id)) {
      if (g.first) page.metrics.unshift(g.id);
      else page.metrics.push(g.id);
    }
  }
}

/**
 * If `activeMetric` is a metric group, append its toggle(s) to `host` and return the metric id to
 * actually chart; otherwise return `activeMetric` unchanged. Supports 2D (members × views, two
 * toggles) and flat (metricIds, one toggle) groups.
 * @param {HTMLElement} host View host.
 * @param {*} ctx Render context.
 * @param {string} activeMetric Active metric/group id.
 * @returns {string} The effective metric id to render.
 */
function resolveGroupMember(host, ctx, activeMetric) {
  const group = EXTERNAL_METRIC_GROUPS.find((g) => g.id === activeMetric);
  if (!group) return activeMetric;
  const rerender = () => { if (typeof ctx.requestReload === "function") ctx.requestReload(); };
  return Array.isArray(group.members) && Array.isArray(group.views)
    ? resolve2DGroup(host, ctx, group, rerender)
    : resolveFlatGroup(host, group, rerender);
}

/** 2D group: a metric toggle (members) + a view toggle (views). Returns members[metric][view]. */
function resolve2DGroup(/** @type {*} */ host, /** @type {*} */ ctx, /** @type {*} */ group, /** @type {()=>void} */ rerender) {
  const sel = groupSelAll()[group.id] || {};
  const mIdx = Number.isInteger(sel.metric) && sel.metric >= 0 && sel.metric < group.members.length
    ? sel.metric : 0;
  const vId = group.views.some((/** @type {*} */ v) => v.id === sel.view) ? sel.view : group.views[0].id;
  // Surface the active view to a companion-panel member (e.g. the Emigration "Net Migration (Table)"),
  // so a panel that isn't a chart can mirror the Scaled / Civ-numbers toggle in its own render.
  if (ctx) ctx.groupView = vId;
  host.appendChild(pillRow(group.members.map((/** @type {*} */ m, /** @type {number} */ i) => ({ key: i, label: m.label })),
    mIdx, (k) => { setGroupSel(group.id, { metric: k, view: vId }); rerender(); }));
  host.appendChild(pillRow(group.views.map((/** @type {*} */ v) => ({ key: v.id, label: v.label })),
    vId, (k) => { setGroupSel(group.id, { metric: mIdx, view: k }); rerender(); }));
  const member = group.members[mIdx];
  return member[vId] || member[group.views[0].id];
}

/** Flat group: a single metric toggle over `metricIds`. Returns the selected metric id. */
function resolveFlatGroup(/** @type {*} */ host, /** @type {*} */ group, /** @type {()=>void} */ rerender) {
  const ids = group.metricIds || [];
  const sel = groupSelAll()[group.id];
  const effective = typeof sel === "string" && ids.includes(sel) ? sel : ids[0];
  host.appendChild(pillRow(ids.map((/** @type {string} */ mid) => {
    const m = getMetric(mid);
    return { key: mid, label: m && m.label ? m.label : mid };
  }), effective, (k) => { setGroupSel(group.id, k); rerender(); }));
  return effective;
}

/**
 * Fold any companion-mod PANELS (registerPanel) into PAGES: each becomes its own page with a single
 * synthetic metric that routes to the companion's render callback (handled in the chart-render
 * dispatch). Idempotent; called each render so it applies regardless of registration order.
 */
/**
 * The metric ids a panel contributes: one synthetic per declared sub-tab (so each shows as a native
 * Demographics sub-tab), else a single id for the whole panel (legacy single-tab panels).
 * @param {*} panel The external panel spec.
 * @returns {string[]} The metric ids.
 */
function panelMetricIds(panel) {
  return Array.isArray(panel.tabs) && panel.tabs.length
    ? panel.tabs.map((/** @type {*} */ tab) => panel.id + PANEL_SUBTAB_SEP + tab.id)
    : [panel.id];
}

/**
 * Register one synthetic metric per declared sub-tab of a multi-tab panel.
 * @param {*} panel The external panel spec (with `tabs`).
 */
function registerPanelTabSynthetics(panel) {
  const fallbackTitle = panel.title || panel.pageLabel || panel.id;
  for (const tab of /** @type {*[]} */ (panel.tabs)) {
    const id = panel.id + PANEL_SUBTAB_SEP + tab.id;
    if (SYNTHETIC_METRICS[id]) continue;
    SYNTHETIC_METRICS[id] = {
      label: tab.label || tab.title || tab.id,
      title: tab.title || tab.label || fallbackTitle
    };
  }
}

/**
 * Register synthetic-metric entries for an external panel (so the screen treats each tab as
 * renderable + titled): one per sub-tab when the panel declares `tabs`, else one for the panel.
 * @param {*} panel The external panel spec.
 */
function ensureExternalSynthetic(panel) {
  if (Array.isArray(panel.tabs) && panel.tabs.length) {
    registerPanelTabSynthetics(panel);
    return;
  }
  if (SYNTHETIC_METRICS[panel.id]) return;
  SYNTHETIC_METRICS[panel.id] = {
    label: panel.tabLabel || "View",
    title: panel.title || panel.pageLabel || panel.id
  };
}

function mergeExternalPanels() {
  for (const panel of EXTERNAL_PANELS) {
    if (!panel || typeof panel.id !== "string") continue;
    ensureExternalSynthetic(panel);
    if (PAGES.some((p) => p.id === panel.id)) continue;
    const label = panel.pageLabel || panel.title || panel.id;
    PAGES.push({ id: panel.id, label, metrics: panelMetricIds(panel) });
  }
}

/**
 * Whether `id` is a companion-registered external panel (a whole-page custom render), for which the
 * time-range filter and CSV toolbar don't apply.
 * @param {string} id The metric/panel id.
 * @returns {boolean} True if external.
 */
function isExternalPanel(id) {
  return typeof id === "string"
    && EXTERNAL_PANELS.some((p) => id === p.id || id.startsWith(p.id + PANEL_SUBTAB_SEP));
}

/**
 * The active metric for `page`, coerced to one the tab row will actually show. Age-gated metrics
 * (resources_treasure/_factory) are dropped from the tab row in the wrong age, but a persisted
 * selection can still resolve to one — which would highlight tab 0 while the chart renders the
 * hidden metric. Coercing to a tab-VISIBLE metric keeps the row and the chart in agreement.
 * @param {*} ctx Render context.
 * @param {{id:string, metrics:string[]}} page The active page.
 * @returns {string} The visible active metric id.
 */
function resolveVisibleActiveMetric(ctx, page) {
  const active = resolveActiveMetricState(ctx, page, metricExists);
  const visible = visibleMetricsForAge(page.metrics);
  return visible.length && !visible.includes(active) ? visible[0] : active;
}

/**
 * Resolve the active page and build the page-tab row. `mergeExternalPageMetrics()` folds in
 * companion-mod panels (whole pages) + metric placements first. When `opts.onlyPage` is set, render
 * is being driven AS a companion `topLevel` panel's own view tab: pin to that page and emit NO page
 * tab row. Otherwise, exclude any `topLevel` companion panel from the selectable Historical-Data
 * pages (they live as their own top-level tabs) and build the normal page-tab row.
 * @param {HTMLElement} host The view host element.
 * @param {*} ctx Render context.
 * @param {{onlyPage?:string}|undefined} opts Render options.
 * @returns {string} The active page id.
 */
function resolvePageAndTabRow(host, ctx, opts) {
  const allPages = mergeExternalPageMetrics();
  if (opts && opts.onlyPage && allPages.some((p) => p.id === opts.onlyPage)) return opts.onlyPage;
  const topLevelIds = new Set(EXTERNAL_PANELS.filter((p) => p && p.topLevel).map((p) => p.id));
  const activePage = resolveActivePageState(ctx, allPages.filter((p) => !topLevelIds.has(p.id)));
  buildPageTabRow(host, ctx, activePage);
  return activePage;
}

// Metrics that ignore the turn window (snapshot/cross-age views) — the time-range filter is hidden.
const TIME_FILTER_HIDDEN_FOR = new Set(["legacy_radar", "crisis_graphs", "crisis_stages"]);

/**
 * Build the combined controls row: the time-range filter pills on the LEFT and the chart toolbar
 * (Time / Wonders / Copy as CSV) on the RIGHT, on one horizontal row. Either side is omitted when not
 * applicable (filter hidden for snapshot metrics; toolbar skipped for external panels).
 * @param {HTMLElement} host View host.
 * @param {*} ctx Render context.
 * @param {string} effective The metric being charted.
 * @param {string} activeFilter The active time-range filter id.
 */
function buildControlsRow(host, ctx, effective, activeFilter) {
  const row = document.createElement("div");
  row.className = "demographics-history-controls-row";
  const hasFilters = !TIME_FILTER_HIDDEN_FOR.has(effective) && !isExternalPanel(effective);
  const hasToolbar = !isExternalPanel(effective);
  // When both are present, pull the toolbar OUT of flow (CSS `--centered`) so the filter pills center
  // on the FULL row width. A flex child can't shrink below its content, so an in-flow toolbar steals
  // space and shoves the pills left of true center; absolute-positioning it sidesteps that entirely.
  if (hasFilters && hasToolbar) row.classList.add("demographics-history-controls-row--centered");
  if (hasFilters) {
    row.appendChild(buildTimeFilterRow(activeFilter, (id) => {
      if (typeof ctx.setActiveTimeFilter === "function") ctx.setActiveTimeFilter(id);
    }));
  }
  if (hasToolbar) {
    buildToolbar(row, ctx, effective); // includes the Options button
  } else {
    // External companion panel (e.g. Emigration) has no chart toolbar, but still gets the Options
    // button in the same top-right location as the historical-data graphs.
    const toolbar = document.createElement("div");
    toolbar.className = "demographics-chart-toolbar";
    toolbar.appendChild(buildOptionsButton());
    row.appendChild(toolbar);
  }
  if (row.children.length) host.appendChild(row);
}

/**
 * The Emigration mod's timeline-detail note text (read cross-mod) — only for the sub-tab the companion
 * scopes it to (its `metricId`); "" otherwise / when absent / not coarse.
 * @param {string} effective The metric/sub-tab id being rendered.
 * @returns {string} The note text, or "".
 */
function readTimelineNote(effective) {
  try {
    const n = /** @type {*} */ (globalThis).EmigrationTimelineNote;
    // The companion declares which sub-tab the note belongs to (its `metricId`); only show it there,
    // not on every panel sub-tab.
    if (n && typeof n.text === "function" && n.metricId === effective) return n.text() || "";
  } catch (_) {
    /* ignore */
  }
  return "";
}

/**
 * Whether the active external-panel sub-tab opts out of the analytics-policy banner. A sub-tab that
 * shows no per-civ data (a static reference page, e.g. Emigration's Guide) sets `hidePolicyBanner`,
 * since the visibility policy is moot there. `effective` is "panelId::subId".
 * @param {string} effective The active metric/panel id.
 * @returns {boolean} True when the banner should be suppressed.
 */
function panelSubtabHidesPolicy(effective) {
  if (typeof effective !== "string") return false;
  const sep = effective.indexOf(PANEL_SUBTAB_SEP);
  if (sep < 0) return false;
  const panelId = effective.slice(0, sep);
  const subId = effective.slice(sep + PANEL_SUBTAB_SEP.length);
  const panel = EXTERNAL_PANELS.find((p) => p && p.id === panelId);
  const tabs = panel && Array.isArray(panel.tabs) ? panel.tabs : null;
  const tab = tabs ? tabs.find((/** @type {*} */ tt) => tt && tt.id === subId) : null;
  return !!(tab && tab.hidePolicyBanner);
}

/**
 * Append the bottom-centre notes row: the analytics-governance policy banner and, on a companion
 * panel (Emigration), the timeline-detail note — side by side in one centered row, matching fonts.
 * @param {HTMLElement} host The view host element.
 * @param {string} effective The metric/panel being rendered.
 */
function appendBottomNotes(host, effective) {
  let wrap = panelSubtabHidesPolicy(effective) ? null : buildPolicyBanner();
  const note = readTimelineNote(effective);
  if (!wrap && !note) return;
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "demographics-policy-banner-wrap";
  }
  if (note) {
    const el = document.createElement("div");
    el.className = "demographics-timeline-note font-body text-sm";
    el.textContent = note;
    wrap.appendChild(el);
  }
  host.appendChild(wrap);
}

/**
 * Render the Historical Data view into `host`: clears the host, then builds the
 * page tab row, metric tab row, chart title + captions, time-range filter row,
 * toolbar, and chart host in their fixed display order.
 * @param {HTMLElement} host The view host element (cleared and repopulated).
 * @param {HistoryCtx} ctx Render context (history, selection state, callbacks).
 * @param {{onlyPage?:string}} [opts] When `onlyPage` is set, render that single page pinned (no page
 *   tab row) - used to present a companion `topLevel` panel as its own top-level view tab.
 */
export function render(host, ctx, opts) {
  clearHost(host);

  // ── Page tab row ────────────────────────────────────────────────────
  const activePage = resolvePageAndTabRow(host, ctx, opts);

  // ── Metric tab row (for the active page) ───────────────────────────
  const page = PAGES.find((p) => p.id === activePage) || PAGES[0];
  const activeMetric = resolveVisibleActiveMetric(ctx, page);
  buildMetricTabRow(host, ctx, page, activeMetric);

  // A metric GROUP tab keeps itself selected in the row above, but renders a member toggle and the
  // SELECTED member's chart below. `effective` is the metric actually charted (the group's member, or
  // just activeMetric when it isn't a group).
  const effective = resolveGroupMember(host, ctx, activeMetric);

  // ── Chart title (full descriptive name above the plot) ────────────
  const metricObj = (() => {
    try {
      return getMetric(effective);
    } catch (e) {
      derr("resolve metricObj:", e);
      return null;
    }
  })();
  const synthMeta = isSynthetic(effective) ? resolveSyntheticMeta(effective) : null;
  // A companion panel subtab (Emigration's Network / Civilizations / …) renders its own headers and
  // content, and the section TAB already names it — so skip the redundant chart title + caption that
  // would otherwise open a gap above the panel's own pills/controls. Graphs and built-in metrics
  // (effective is a real metric id, not a panel) keep theirs.
  if (!isExternalPanel(effective)) {
    buildChartTitle(host, effective, metricObj, synthMeta);
    // ── Per-metric explanation caption (above the filter row so the page reads
    //    top-down: title → caption → filters → chart). ──
    appendMetricCaptions(host, effective);
  }

  // ── Controls row: time-range filters (left) + toolbar (right) on ONE row ──
  // The time-range filter is only meaningful for time-series charts; snapshot/cross-age metrics hide
  // it (see TIME_FILTER_HIDDEN_FOR). A persisted-but-now-disabled filter falls back to "all".
  const activeFilter = resolveActiveFilterState(ctx, TIME_FILTERS);
  const turnRange = computeTurnRange(ctx.history, activeFilter);
  buildControlsRow(host, ctx, effective, activeFilter);

  // ── Chart host ─────────────────────────────────────────────────────
  buildChartHost(host, ctx, effective, turnRange);

  // ── Bottom-centre notes: the analytics-governance policy banner and (on the Emigration page) the
  //    timeline-detail note, side by side in one centered row. ──
  appendBottomNotes(host, effective);

  // Line labels on the right edge of the chart now serve as the legend
  // (clickable to hide; hidden civs appear as faded labels below the
  // plot area, clickable to restore). The bottom legend list was
  // removed to simplify the UI.
  // Per-metric explanation captions are appended ABOVE the chart (after
  // the title) - see the earlier block in this function. Kept the
  // bottom-of-chart block free of duplicates.
}
