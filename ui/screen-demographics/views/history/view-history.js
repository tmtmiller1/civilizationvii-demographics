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
import { SYNTHETIC_METRICS } from "/demographics/ui/screen-demographics/views/history/history-synthetic-metrics.js";
import {
  getMetric,
  localizedMetricName,
  EXTERNAL_PAGE_METRICS,
  EXTERNAL_PANELS,
  EXTERNAL_METRIC_GROUPS,
  EXTERNAL_HUB_PAGES,
  PANEL_SUBTAB_SEP,
  migrationHubHasCompanion
} from "/demographics/ui/metrics/demographics-metrics.js";
import {
  buildPageTabRow,
  buildMetricTabRow,
  buildChartTitle,
  visibleMetrics
} from "/demographics/ui/screen-demographics/views/history/history-tabs.js";
import {
  appendMetricCaptions,
  buildPolicyBanner
} from "/demographics/ui/screen-demographics/views/history/history-captions.js";
import { pillRow } from "/demographics/ui/screen-demographics/views/shared/view-pills.js";
import { buildToolbar, buildRadarSnapshotRow, buildWarGraphsPicker, buildPopulationModeToggle } from "/demographics/ui/screen-demographics/views/history/history-controls.js";
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
 * @property {string} [hub] Owning hub id ("statistics" | "migration" | "geopolitics").
 *   Pages without a hub (legacy/external metric pages) are not shown under any hub.
 * @property {string} [tier] Min UI-complexity tier ("basic" | "standard" | "analyst");
 *   default standard.
 * @property {string[]} [metrics] Metric ids in display order (a line/synthetic page).
 *   EXCLUSIVE with `render`.
 * @property {(host: HTMLElement, ctx: *) => void} [render] Custom view as a page (e.g.
 *   Relations). EXCLUSIVE with `metrics`.
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
  // ── GLOBAL STATISTICS hub ───────────────────────────────────────────────
  {
    // All per-turn output rates in one place (stock/flow split from Economy):
    // Food · Production · Gold · Science · Culture · Happiness · Influence.
    id: "yields",
    label: "LOC_DEMOGRAPHICS_PAGE_YIELDS",
    hub: "statistics",
    tier: "basic",
    metrics: ["gpt", "production", "crops", "science_yield", "culture_yield", "influence", "hpt"]
  },
  {
    // Economy & Resources: wealth stocks (GDP, Treasury, Trade) then the strategic
    // resource-allocation charts (page-level stacked mix + per-class comparisons).
    // Keeps id "economy" so the default landing page stays valid.
    id: "economy",
    label: "LOC_DEMOGRAPHICS_PAGE_ECONOMY_RESOURCES",
    hub: "statistics",
    tier: "basic",
    metrics: ["gdp", "gold", "trade", "resources_total", "resources_stack", "resources_bonus",
      "resources_empire", "resources_city", "resources_factory", "resources_treasure"]
  },
  {
    // Society & culture: social standing, culture-collection, the wonder group, and the
    // Legacy Path triumph radar (legacy_radar, folded in from the former Age page).
    id: "society",
    label: "LOC_DEMOGRAPHICS_PAGE_SOCIETY",
    hub: "statistics",
    tier: "basic",
    metrics: ["faith", "tourism", "great_people", "great_works", "techs", "civics",
      "wonders", "wonders_board", "wonder_races", "natural_wonders", "legacy_radar"]
  },
  {
    // Religion: spread + by-population over time (line charts) + current standings.
    id: "religion",
    label: "LOC_DEMOGRAPHICS_PAGE_RELIGION",
    hub: "statistics",
    tier: "standard",
    // Antiquity shows the pantheons chosen; Exploration/Modern show the founded-religion
    // standings/spread/by-population charts. The age gate (history-tabs.js) hides whichever
    // set doesn't apply, so only one "Religion" pill is ever visible for the current age.
    metrics: ["religion_pantheons", "religion_pantheon_yields", "religion_standings",
      "religion_spread", "religion_by_pop"]
  },
  {
    // Empire footprint: settlement counts/cap, land area, the size histogram, and the
    // by-type construction boards (buildings/districts, folded from the former Construction page).
    id: "settlements_land",
    label: "LOC_DEMOGRAPHICS_PAGE_SETTLEMENTS_LAND",
    hub: "statistics",
    tier: "basic",
    metrics: ["land", "land_share_area", "settlements", "settlements_atlas", "settlement_cap_pct",
      "settlement_cap", "cities", "towns", "districts_type", "buildings_type"]
  },

  // ── MIGRATION hub ───────────────────────────────────────────────────────
  {
    // Population is the Migration hub's headline + anchor. Standalone Demographics shows
    // only this; the Emigration companion injects the rest of the hub after it (Phase 3).
    id: "population",
    label: "LOC_DEMOGRAPHICS_PAGE_POPULATION",
    hub: "migration",
    tier: "basic",
    metrics: ["population"]
  },

  // ── GEOPOLITICS hub ─────────────────────────────────────────────────────
  {
    // "Global Relations": a RENDER page (the former top-level Relations view). First in the
    // hub + the default page loaded when Geopolitics is selected.
    id: "relations",
    label: "LOC_DEMOGRAPHICS_PAGE_RELATIONS",
    hub: "geopolitics",
    tier: "basic",
    render: renderRelationsPage
  },
  {
    id: "agreements", label: "LOC_DEMOGRAPHICS_PAGE_AGREEMENTS",
    hub: "geopolitics", tier: "standard", metrics: ["approval", "deals"]
  },
  {
    // The current age's crisis, broken into stages with a per-civ cost section.
    id: "crises",
    label: "LOC_DEMOGRAPHICS_PAGE_CRISES",
    hub: "geopolitics",
    tier: "standard",
    metrics: ["crisis_stages", "crisis_graphs"]
  },
  {
    // "Soft Power" dashboard: Score, the Score rank-race, the Fingerprint scatters
    // (civ_scatter/scatter_*), and the Archetype radar. Placed after Crises. tier
    // omitted ⇒ standard.
    id: "power",
    label: "LOC_DEMOGRAPHICS_PAGE_POWER",
    hub: "geopolitics",
    metrics: ["score", "power_race", "civ_scatter", "scatter_wealth_culture", "scatter_soft_power",
      "power_radar"]
  },
  {
    // "Military Power": strength, kills/losses, combats, wars, conquest, by-type breakdowns.
    id: "military",
    label: "LOC_DEMOGRAPHICS_PAGE_MILITARY",
    hub: "geopolitics",
    tier: "basic",
    // War Timeline (wars_gantt) + War Impact (war_graphs) folded in from the former Wars page.
    metrics: ["milpower", "units_killed", "units_lost", "combats", "wars_declared", "wars_received",
      "settlements_conquered", "conquest_pct", "wars_gantt", "war_graphs",
      "units_trained_type", "units_killed_type", "units_lost_type"]
  }
];

/** Hub ids whose pages render via the (generalized) history machinery. Rankings is its own view. */
export const HUBS = Object.freeze(["statistics", "migration", "geopolitics"]);

/**
 * Pages belonging to a hub, in display order.
 * @param {PageDef[]} allPages The merged page list.
 * @param {string} hub The hub id.
 * @returns {PageDef[]} The hub's pages.
 */
export function pagesForHub(allPages, hub) {
  const pages = allPages.filter((p) => p.hub === hub);
  // When a companion fills the Migration hub, it owns Population too, folded into its
  // combined "Population & Migration" page as the first pill (and Population Share is a member of
  // that page's group, added by the companion), so drop the host's standalone Population page.
  if (hub === "migration" && migrationHubHasCompanion()) {
    return pages.filter((p) => p.id !== "population");
  }
  // Standalone Demographics hides the Migration hub entirely, so surface its Population anchor
  // (and Population Share, which travels with it) as the first pills on the Global Statistics
  // "Society" page instead. Idempotent; leaves Population first, Share right after.
  if (hub === "statistics" && !migrationHubHasCompanion()) {
    const m = pages.find((p) => p.id === "society")?.metrics;
    if (m && !m.includes("population")) m.unshift("population", "pop_share_area");
  }
  return pages;
}

/**
 * Render the Relations diplomacy view as a Geopolitics page. Lazily imports the view
 * module (matching the old lazy-view path) and renders it into the page body; the host
 * was already cleared upstream.
 * @param {HTMLElement} host The page body.
 * @param {*} ctx Render context (carries `history`, `settings`).
 */
function renderRelationsPage(host, ctx) {
  import("/demographics/ui/screen-demographics/views/relations/view-relations.js")
    .then((mod) => mod.render(host, { history: ctx.history, settings: ctx.settings }))
    .catch((/** @type {*} */ e) => derr("relations page load failed:", e));
}


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
  mergeHubPages();
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

/** Index of the last page belonging to `hub`, or -1. @param {string} hub @returns {number} */
function lastHubPageIndex(hub) {
  let li = -1;
  PAGES.forEach((p, i) => {
    if (p.hub === hub) li = i;
  });
  return li;
}

/**
 * Fold companion-registered hub pages (registerHubPages) into PAGES, in registration
 * order, contiguous with their hub. Idempotent: a page already present (by id) is skipped.
 * Inserted after the hub's last current page (so they group cleanly after the host's own
 * pages, e.g. Migration's Population anchor).
 */
function mergeHubPages() {
  for (const e of EXTERNAL_HUB_PAGES) {
    if (PAGES.some((p) => p.id === e.page.id)) continue;
    const def = Object.assign({ tier: "standard" }, e.page, { hub: e.hubId });
    const li = lastHubPageIndex(e.hubId);
    const anchorIdx = li < 0 && e.after ? PAGES.findIndex((p) => p.id === e.after) : li;
    if (anchorIdx >= 0) PAGES.splice(anchorIdx + 1, 0, def);
    else PAGES.push(def);
  }
}

// Per-group selection (2D groups store {metric:idx, view:viewId}; flat groups store a
// metric id), PERSISTED so a Scaled/Civ (and metric) choice is sticky across reopening the
// screen, otherwise it reset to the first view each open and, via the companion-panel
// groupView, clobbered the Emigration tabs' remembered number mode.
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

/**
 * Reset every group's member selection to its default (member 0), called on a top-level
 * hub switch so a hub opens on its first page's first member (e.g. Migration → "Population
 * & Migration" → Population), rather than restoring a stale member. The Scaled/Civ view is
 * bound to NumberMode, so it's untouched.
 */
export function resetGroupSelections() {
  _groupSel = {};
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
 * Fold companion metric GROUPS into PAGES: register a synthetic-meta label for each group
 * id, drop the group's member metrics from their page's tab row (they're shown via the
 * in-tab toggle instead), and place the group id as a tab (at the front when `first`).
 * Idempotent; called each render.
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

/**
 * The group's active view id. When the group declares a `viewBinding` (an external owner
 * of the Scaled/Civ choice, e.g. Emigration's number mode), read it from there so this
 * toggle and the owner's own control stay one setting; otherwise from the persisted
 * per-group selection.
 * @param {*} group The metric group.
 * @param {*} sel The group's persisted selection.
 * @returns {string} The active view id.
 */
function groupViewId(group, sel) {
  const b = group.viewBinding;
  const cur = b && typeof b.get === "function" ? b.get() : sel.view;
  return group.views.some((/** @type {*} */ v) => v.id === cur) ? cur : group.views[0].id;
}

/**
 * Commit a view change: write through the group's `viewBinding` (if any) AND persist it locally, so
 * the choice sticks whether or not an external owner backs it.
 * @param {*} group The metric group.
 * @param {number} mIdx The active member index.
 * @param {string} k The chosen view id.
 */
function setGroupView(group, mIdx, k) {
  if (group.viewBinding && typeof group.viewBinding.set === "function") group.viewBinding.set(k);
  setGroupSel(group.id, { metric: mIdx, view: k });
}

/** 2D group: a metric toggle (members) + a view toggle (views). Returns members[metric][view]. */
function resolve2DGroup(
  /** @type {*} */ host,
  /** @type {*} */ ctx,
  /** @type {*} */ group,
  /** @type {()=>void} */ rerender
) {
  const sel = groupSelAll()[group.id] || {};
  const mIdx = Number.isInteger(sel.metric) && sel.metric >= 0 && sel.metric < group.members.length
    ? sel.metric : 0;
  const vId = groupViewId(group, sel);
  // Surface the active view to a companion-panel member (e.g. the Emigration "Net
  // Migration (Table)"), so a panel that isn't a chart can mirror the Scaled / Civ-numbers
  // toggle in its own render.
  if (ctx) ctx.groupView = vId;
  const memberPills = group.members.map(
    (/** @type {*} */ m, /** @type {number} */ i) => ({ key: i, label: localizedMetricName(m) })
  );
  host.appendChild(pillRow(memberPills,
    mIdx, (k) => { setGroupSel(group.id, { metric: k, view: vId }); rerender(); }));
  // The VIEW row (e.g. Scaled / Civ numbers) transforms the data → render it as flat
  // filter buttons, matching the time/age filters; the metric row above stays rounded view
  // pills.
  host.appendChild(pillRow(group.views.map((/** @type {*} */ v) => ({ key: v.id, label: v.label })),
    vId, (k) => { setGroupView(group, mIdx, k); rerender(); }, "filter"));
  const member = group.members[mIdx];
  return member[vId] || member[group.views[0].id];
}

/** Flat group: a single metric toggle over `metricIds`. Returns the selected metric id. */
function resolveFlatGroup(
  /** @type {*} */ host,
  /** @type {*} */ group,
  /** @type {()=>void} */ rerender
) {
  const ids = group.metricIds || [];
  const sel = groupSelAll()[group.id];
  const effective = typeof sel === "string" && ids.includes(sel) ? sel : ids[0];
  host.appendChild(pillRow(ids.map((/** @type {string} */ mid) => {
    const m = getMetric(mid);
    return { key: mid, label: m && m.label ? localizedMetricName(m) : mid };
  }), effective, (k) => { setGroupSel(group.id, k); rerender(); }));
  return effective;
}

/**
 * Fold any companion-mod PANELS (registerPanel) into PAGES: each becomes its own page with
 * a single synthetic metric that routes to the companion's render callback (handled in the
 * chart-render dispatch). Idempotent; called each render so it applies regardless of
 * registration order.
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
 * The active metric for `page`, coerced to one the tab row will actually show. Metrics are dropped
 * from the tab row both by age gating AND by the empty-data auto-hide; a default/persisted selection
 * can still resolve to a hidden one, which would highlight tab 0 while the chart renders the hidden
 * metric — and, for the empty-data case, make the metric appear as a lone pill only while it's the
 * default active, then vanish when the user picks a populated sibling. Coercing to the DATA-aware
 * visible set (not just age) keeps the row and chart in agreement and stops the flicker.
 * @param {*} ctx Render context.
 * @param {{id:string, metrics?:string[]}} page The active page.
 * @returns {string} The visible active metric id.
 */
function resolveVisibleActiveMetric(ctx, page) {
  const active = resolveActiveMetricState(ctx, page, metricExists);
  const visible = visibleMetrics(page.metrics || [], ctx);
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
 * @param {{onlyPage?:string, hub?:string}|undefined} opts Render options.
 * @returns {string} The active page id.
 */
function resolvePageAndTabRow(host, ctx, opts) {
  const allPages = mergeExternalPageMetrics();
  if (opts && opts.onlyPage && allPages.some((p) => p.id === opts.onlyPage)) return opts.onlyPage;
  // Hub-scoped: a hub view (Statistics / Migration / Geopolitics) shows only its own pages.
  // The legacy "all pages in one row" path (no hub) still works for any caller that passes
  // no hub.
  const topLevelIds = new Set(EXTERNAL_PANELS.filter((p) => p && p.topLevel).map((p) => p.id));
  const scoped = (opts && opts.hub ? pagesForHub(allPages, opts.hub) : allPages)
    .filter((p) => !topLevelIds.has(p.id));
  const activePage = resolveActivePageState(ctx, scoped);
  buildPageTabRow(host, ctx, activePage, scoped);
  return activePage;
}

// Metrics that ignore the turn window (snapshot/cross-age views), the time-range filter is
// hidden.
const TIME_FILTER_HIDDEN_FOR = new Set(["legacy_radar", "crisis_graphs", "crisis_stages"]);

/**
 * External companion panel controls: a controls area the panel fills with its own pills (via
 * ctx.panelControls) plus the Options button. Under the `--centered` column the panel's pills sit
 * on the first centered row and the Options button on the centered row below — matching every other
 * page's two-row controls formatting.
 * @param {HTMLElement} row The controls row.
 * @param {*} ctx Render context (receives `panelControls`).
 */
function appendExternalPanelControls(row, ctx) {
  const panelControls = document.createElement("div");
  panelControls.className = "demographics-panel-controls";
  row.appendChild(panelControls);
  ctx.panelControls = panelControls;
  const toolbar = document.createElement("div");
  toolbar.className = "demographics-chart-toolbar";
  toolbar.appendChild(buildOptionsButton());
  row.appendChild(toolbar);
}

/**
 * Build the combined controls row: the time-range filter pills on the LEFT and the chart
 * toolbar (Time / Wonders / Copy as CSV) on the RIGHT, on one horizontal row. Either side
 * is omitted when not applicable (filter hidden for snapshot metrics; toolbar skipped for
 * external panels).
 * @param {HTMLElement} host View host.
 * @param {*} ctx Render context.
 * @param {string} effective The metric being charted.
 * @param {string} activeFilter The active time-range filter id.
 */
function buildControlsRow(host, ctx, effective, activeFilter) {
  const row = document.createElement("div");
  row.className = "demographics-history-controls-row";
  const hasFilters = !TIME_FILTER_HIDDEN_FOR.has(effective) && !isExternalPanel(effective);
  const isRadar = effective === "legacy_radar";
  const hasToolbar = !isExternalPanel(effective);
  // Stack the controls as two centered rows (CSS `--centered`, a flex column): the pill/control row
  // on top, the toolbar below. Applies to metric/radar pages (filters/snapshot + toolbar) AND to
  // companion panels like Emigration (`!hasToolbar` → their own controls + the Options button), so
  // they get the same formatting. Toolbar-only pages (e.g. Crises) are left as a single right row.
  if (!hasToolbar || hasFilters || isRadar) row.classList.add("demographics-history-controls-row--centered");
  if (hasFilters) {
    row.appendChild(buildTimeFilterRow(activeFilter, (id) => {
      if (typeof ctx.setActiveTimeFilter === "function") ctx.setActiveTimeFilter(id);
    }));
  } else if (isRadar) {
    // The radar hides the time-filter row; center its Snapshot selector here instead of
    // the toolbar.
    row.appendChild(buildRadarSnapshotRow(ctx));
  }
  if (hasToolbar) buildToolbar(row, ctx, effective); // includes the Options button
  else appendExternalPanelControls(row, ctx);
  appendMetricSpecificControl(row, ctx, effective);
  if (row.children.length) host.appendChild(row);
}

/**
 * Append the one metric-specific control for pages that have one: the War Graphs
 * "Pick war" dropdown (pinned far left), or the Population Scaled/Game toggle.
 * No-op for every other metric.
 * @param {HTMLElement} row The controls row.
 * @param {*} ctx Render context.
 * @param {string} effective The charted metric id.
 */
function appendMetricSpecificControl(row, ctx, effective) {
  if (effective === "war_graphs") row.appendChild(buildWarGraphsPicker(ctx));
  else if (effective === "population") row.appendChild(buildPopulationModeToggle(ctx));
}

/**
 * The metric id actually charted for the Population page: swaps the scaled
 * `population` for its raw-Civ twin `population_civ` when the toggle is in "civ"
 * mode. Every other id passes through unchanged.
 * @param {*} ctx Render context.
 * @param {string} id The effective (display) metric id.
 * @returns {string} The metric id to chart.
 */
function populationChartId(ctx, id) {
  if (id !== "population") return id;
  const mode = ctx?.settings?.getSetting?.("populationNumberMode", "scaled");
  return mode === "civ" ? "population_civ" : "population";
}

/**
 * The Emigration mod's timeline-detail note text (read cross-mod), only for the sub-tab
 * the companion scopes it to (its `metricId`); "" otherwise / when absent / not coarse.
 * @param {string} effective The metric/sub-tab id being rendered.
 * @returns {string} The note text, or "".
 */
function readTimelineNote(effective) {
  try {
    const n = /** @type {*} */ (globalThis).EmigrationTimelineNote;
    // The companion declares which sub-tab the note belongs to (its `metricId`); only show
    // it there, not on every panel sub-tab.
    if (n && typeof n.text === "function" && n.metricId === effective) return n.text() || "";
  } catch (_) {
    /* ignore */
  }
  return "";
}

/**
 * Whether the active external-panel sub-tab opts out of the analytics-policy banner. A
 * sub-tab that shows no per-civ data (a static reference page, e.g. Emigration's Guide)
 * sets `hidePolicyBanner`, since the visibility policy is moot there. `effective` is
 * "panelId::subId".
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
 * panel (Emigration), the timeline-detail note, side by side in one centered row, matching fonts.
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
 * Render a custom (non-metric) page body, e.g. the Relations diplomacy view hosted as a Geopolitics
 * page. The page-tab row was already built by the caller.
 * @param {HTMLElement} host The view host.
 * @param {PageDef} page The active page.
 * @param {*} ctx Render context.
 * @returns {boolean} True when `page` is a render page and was handled.
 */
function renderCustomPageBody(host, page, ctx) {
  if (typeof page.render !== "function") return false;
  const body = document.createElement("div");
  body.className = "demographics-history-render-page w-full";
  host.appendChild(body);
  page.render(body, ctx);
  return true;
}

/**
 * Render a metric page: metric tab row, group-member resolution, chart title/captions,
 * controls row, chart host, and bottom notes, the standard Historical-Data flow.
 * @param {HTMLElement} host The view host.
 * @param {*} ctx Render context.
 * @param {PageDef} page The active (metric) page.
 */
function renderMetricFlow(host, ctx, page) {
  const activeMetric = resolveVisibleActiveMetric(ctx, page);
  buildMetricTabRow(host, ctx, page, activeMetric);
  // A metric GROUP tab keeps itself selected above, but renders a member toggle + the
  // SELECTED member's chart below. `effective` is the metric actually charted (the group
  // member, or activeMetric).
  const effective = resolveGroupMember(host, ctx, activeMetric);
  const metricObj = (() => {
    try {
      return getMetric(effective);
    } catch (e) {
      derr("resolve metricObj:", e);
      return null;
    }
  })();
  const synthMeta = isSynthetic(effective) ? resolveSyntheticMeta(effective) : null;
  // A companion panel subtab renders its own headers, so skip the redundant chart title + caption.
  if (!isExternalPanel(effective)) {
    buildChartTitle(host, effective, metricObj, synthMeta);
    appendMetricCaptions(host, effective);
  }
  const activeFilter = resolveActiveFilterState(ctx, TIME_FILTERS);
  const turnRange = computeTurnRange(ctx.history, activeFilter);
  buildControlsRow(host, ctx, effective, activeFilter);
  // The Population page keeps its heading/tab as "population" but charts the raw-Civ twin when the
  // Scaled/Game toggle is in "civ" mode, so only the curve/axis change — not the title.
  buildChartHost(host, ctx, populationChartId(ctx, effective), turnRange);
  appendBottomNotes(host, effective);
}

/**
 * Render the Historical Data view into `host`: clears the host, then builds the
 * page tab row, metric tab row, chart title + captions, time-range filter row,
 * toolbar, and chart host in their fixed display order.
 * @param {HTMLElement} host The view host element (cleared and repopulated).
 * @param {HistoryCtx} ctx Render context (history, selection state, callbacks).
 * @param {{onlyPage?:string, hub?:string}} [opts] `onlyPage` pins a single page (no tab
 *   row) for a companion `topLevel` panel; `hub` scopes the page row to one hub (Statistics
 *   / Migration / Geopolitics).
 */
export function render(host, ctx, opts) {
  clearHost(host);

  // ── Page tab row ────────────────────────────────────────────────────
  const activePage = resolvePageAndTabRow(host, ctx, opts);

  // ── Metric tab row (for the active page) ───────────────────────────
  const page = PAGES.find((p) => p.id === activePage) || PAGES[0];
  // A RENDER page (e.g. Relations) draws its own body and has no metric/chart pipeline.
  if (renderCustomPageBody(host, page, ctx)) return;
  renderMetricFlow(host, ctx, page);
}
