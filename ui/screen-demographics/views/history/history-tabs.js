// history-tabs.js
// Page + metric tab rows and chart title for Historical Data view.

import { PAGES, metricExists } from "/demographics/ui/screen-demographics/views/history/view-history.js";
import { SYNTHETIC_METRICS } from "/demographics/ui/screen-demographics/views/history/history-synthetic-metrics.js";
import { getCurrentAgeType } from "/demographics/ui/sampler/sampler-collectors-core.js";
import { t } from "/demographics/ui/core/demographics-i18n.js";
import {
  EXTERNAL_PANELS,
  EXTERNAL_METRIC_GROUPS,
  PANEL_SUBTAB_SEP
} from "/demographics/ui/metrics/demographics-metrics.js";
import { pageVisibleInTier } from "/demographics/ui/core/demographics-tiers.js";
import { pillRow } from "/demographics/ui/screen-demographics/views/shared/view-pills.js";

// Short contextual descriptions for the advanced History pages (P1.5), shown as
// a caption under the page tab row so a newcomer knows what an advanced page is.
/** @type {Record<string, string>} */
const PAGE_DESCRIPTIONS = {
  // Age + Resources page notes intentionally removed (per design): the radar / resource titles are
  // self-explanatory, so the standalone caption was redundant.
  wars: "LOC_DEMOGRAPHICS_PAGE_DESC_CONFLICTS"
  // crises: deliberately omitted, its description rides as a hover tooltip on the chart title
  // instead of a standalone on-page note (see CHART_TITLE_TOOLTIPS / buildChartTitle).
};

// Metrics whose chart title carries a hover tooltip (in place of a standalone page-description
// note).
/** @type {Record<string, string>} */
const CHART_TITLE_TOOLTIPS = {
  crisis_stages: "LOC_DEMOGRAPHICS_PAGE_DESC_CRISES",
  crisis_graphs: "LOC_DEMOGRAPHICS_PAGE_DESC_CRISES"
};

/**
 * The label for a multi-tab panel's sub-tab id ("panelId::subId"), or null when `id` isn't one.
 * @param {string} id The metric/sub-tab id.
 * @returns {string|null} The sub-tab's label, or null.
 */
function subTabLabel(id) {
  const sep = id.indexOf(PANEL_SUBTAB_SEP);
  if (sep <= 0) return null;
  const owner = EXTERNAL_PANELS.find((x) => x.id === id.slice(0, sep));
  if (!owner || !Array.isArray(owner.tabs)) return null;
  const subId = id.slice(sep + PANEL_SUBTAB_SEP.length);
  const tab = owner.tabs.find((/** @type {*} */ tt) => tt.id === subId);
  return tab ? tab.label || tab.title || subId : null;
}

/**
 * The tab label for a companion external panel (whose id can't follow the
 * LOC_DEMOGRAPHICS_METRIC_<ID> convention) or one of its sub-tabs, or null when `id` isn't one.
 * @param {string} id Metric/panel/sub-tab id.
 * @returns {string|null} The panel's own tab label, or null.
 */
function externalTabLabel(id) {
  // Legacy single-tab panel: the id IS the panel id.
  const direct = EXTERNAL_PANELS.find((x) => x.id === id);
  if (direct && !(Array.isArray(direct.tabs) && direct.tabs.length)) {
    return direct.tabLabel || direct.title || id;
  }
  // A companion metric-group tab (one tab that toggles among member metrics).
  const group = EXTERNAL_METRIC_GROUPS.find((g) => g.id === id);
  if (group) return group.label;
  // Sub-tab of a multi-tab panel: id is "panelId::subId".
  return typeof id === "string" ? subTabLabel(id) : null;
}

const DBG = false;

/**
 * @param {...*} a
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.history-tabs]", ...a);
}

/**
 * Build and append the page-level tab bar (the row of metric-group tabs).
 * @param {HTMLElement} host
 * @param {*} ctx
 * @param {string} activePage
 * @param {{id:string,label:string,tier?:string}[]} [pages] Hub-scoped page list (defaults to all
 * PAGES).
 */
export function buildPageTabRow(host, ctx, activePage, pages) {
  const pageHost = document.createElement("div");
  pageHost.className = "demographics-page-tab-host w-full";
  host.appendChild(pageHost);

  const pageBar = document.createElement("fxs-tab-bar");
  pageBar.classList.add("demographics-page-tabs", "w-full", "font-title", "text-sm");
  pageBar.setAttribute("data-audio-group-ref", "audio-screen-unlocks");
  pageBar.setAttribute("tab-item-class", "font-title text-base");
  // UI complexity tiers (P1.5): only show pages the active tier discloses. Also drop any companion
  // panel marked `topLevel` - it has its own top-level view tab, so it must not appear as a page
  // here.
  // `pages` is the hub-scoped list resolved upstream (falls back to all PAGES for legacy callers).
  const topLevelIds = new Set(EXTERNAL_PANELS.filter((p) => p && p.topLevel).map((p) => p.id));
  const source = pages || PAGES;
  const visiblePages = source.filter(
    (p) => pageVisibleInTier(p) && !topLevelIds.has(p.id) && pageHasVisibleContent(p, ctx, activePage)
  );
  const pageTabs = visiblePages.map((p) => ({ id: p.id, label: p.label }));
  pageBar.setAttribute("tab-items", JSON.stringify(pageTabs));
  const pageIdx = Math.max(
    0,
    visiblePages.findIndex((p) => p.id === activePage)
  );
  pageBar.setAttribute("selected-tab-index", String(pageIdx));
  pageBar.addEventListener("tab-selected", (event) => {
    const id = /** @type {*} */ (event)?.detail?.selectedItem?.id;
    onPageTabSelected(ctx, activePage, id);
  });
  pageHost.appendChild(pageBar);
  appendPageDescription(pageHost, activePage);
}

/**
 * Whether a page should appear in the page-tab row: render-pages (custom bodies,
 * no `metrics` array) and the active page are always kept; a metric-page is kept
 * only when at least one of its metrics is currently visible (age + data gated).
 * This gives the empty-category auto-hide (e.g. a Construction page stays hidden
 * until something is built) while never stranding the user on their current page.
 * @param {*} p The page definition.
 * @param {*} ctx The view context (carries `history`).
 * @param {string} activePage The active page id (never hidden).
 * @returns {boolean} True if the page should be shown.
 */
function pageHasVisibleContent(p, ctx, activePage) {
  if (!p) return false;
  if (p.id === activePage) return true;
  if (!Array.isArray(p.metrics)) return true;
  return visibleMetrics(p.metrics, ctx).length > 0;
}

/**
 * Append the advanced-page contextual description caption (P1.5), if any.
 * @param {HTMLElement} pageHost The page-tab host.
 * @param {string} activePage The active page id.
 */
function appendPageDescription(pageHost, activePage) {
  const key = PAGE_DESCRIPTIONS[activePage];
  if (!key) return;
  const desc = document.createElement("div");
  desc.className = "demographics-page-desc font-body text-xs";
  desc.textContent = t(key);
  pageHost.appendChild(desc);
}

/**
 * @param {*} ctx
 * @param {string} activePage
 * @param {string|undefined} id
 */
function onPageTabSelected(ctx, activePage, id) {
  if (!id || id === activePage) return;
  dlog("page-selected:", id);
  const targetPage = PAGES.find((p) => p.id === id);
  const firstMetric = targetPage?.metrics?.[0];
  if (firstMetric && typeof ctx.setActiveMetric === "function") {
    ctx.setActiveMetric(firstMetric);
  }
  if (typeof ctx.setActivePage === "function") ctx.setActivePage(id);
}

// Metrics that only exist in specific age(s). A single string requires exactly that age; an
// array admits any listed age. The Religion page swaps content by age: Antiquity shows the
// chosen pantheons (religion_pantheons); Exploration/Modern show the founded-religion charts.
/** @type {Record<string, string | string[]>} */
const AGE_GATED_METRICS = {
  resources_treasure: "AGE_EXPLORATION",
  resources_factory: "AGE_MODERN",
  religion_pantheons: "AGE_ANTIQUITY",
  religion_pantheon_yields: "AGE_ANTIQUITY",
  religion_standings: ["AGE_EXPLORATION", "AGE_MODERN"],
  religion_spread: ["AGE_EXPLORATION", "AGE_MODERN"],
  religion_by_pop: ["AGE_EXPLORATION", "AGE_MODERN"]
};

/**
 * @param {string[]} metrics
 * @returns {string[]}
 */
export function visibleMetricsForAge(metrics) {
  const age = getCurrentAgeType();
  // Fail OPEN when the age can't be resolved (engine not ready): show everything rather than
  // stranding an age-gated page (e.g. Religion) empty during a momentary unknown-age window.
  if (!age) return metrics;
  return metrics.filter((mid) => {
    const required = AGE_GATED_METRICS[mid];
    if (!required) return true;
    return Array.isArray(required) ? required.includes(age) : required === age;
  });
}

/**
 * Whether any player in one sample has a finite value for `metricId`.
 * @param {*} sample One persisted sample ({ players: { pid: { metrics } } }).
 * @param {string} metricId The metric id.
 * @returns {boolean} True if a finite value is present.
 */
function sampleHasMetric(sample, metricId) {
  const players = sample && sample.players;
  if (!players) return false;
  for (const pid in players) {
    const metrics = players[pid] && players[pid].metrics;
    const v = metrics ? metrics[metricId] : undefined;
    if (typeof v === "number" && isFinite(v)) return true;
  }
  return false;
}

/**
 * Whether any player has ever recorded a finite value for `metricId` across the
 * persisted samples. Fail-OPEN (returns true) when there is no history yet, so a
 * fresh game never hides everything before the first sample lands.
 * @param {string} metricId The sampled metric id.
 * @param {*} history The persisted history blob (ctx.history), or nullish.
 * @returns {boolean} True if data exists (or history is unavailable).
 */
export function metricHasData(metricId, history) {
  const samples = history && Array.isArray(history.samples) ? history.samples : null;
  if (!samples || !samples.length) return true;
  for (const s of samples) {
    if (sampleHasMetric(s, metricId)) return true;
  }
  return false;
}

/**
 * Age gate PLUS data-presence gate: drop metrics that no civ has ever recorded a
 * value for (e.g. Tourism before any is generated). Synthetic ids (custom
 * renderers with their own empty handling) and the currently-selected metric are
 * always kept, and everything is kept when history is unavailable.
 * @param {string[]} metrics Candidate metric ids in display order.
 * @param {*} ctx The view context (carries `history`).
 * @param {string} [keepId] A metric id to always retain (the active selection).
 * @returns {string[]} The visible metric ids.
 */
export function visibleMetrics(metrics, ctx, keepId) {
  const ageOk = visibleMetricsForAge(metrics);
  const history = ctx && ctx.history;
  if (!history || !Array.isArray(history.samples) || !history.samples.length) return ageOk;
  return ageOk.filter(
    (mid) => mid === keepId || SYNTHETIC_METRICS[mid] || metricHasData(mid, history)
  );
}


/**
 * Build and append the metric selector for `page` as a row of PILLS (the 3rd-level selector; the
 * page tab row above it stays as native tabs). One pill per visible metric; selecting one sets the
 * active
 * metric (persisted + re-rendered by the host).
 * @param {HTMLElement} host
 * @param {*} ctx
 * @param {{id:string,label:string,metrics?:string[]}} page
 * @param {string} activeMetric
 */
export function buildMetricTabRow(host, ctx, page, activeMetric) {
  // Age gate + data-presence auto-hide (empty metrics like Tourism-before-any drop out); the
  // active selection is always kept so its chart still renders (with an empty-state message).
  const metrics = visibleMetrics(page.metrics || [], ctx, activeMetric);
  // A page with a single metric (e.g. Age → the triumphs/legacy radar) needs no selector, a
  // one-pill row is pointless. Skip it; the lone metric still renders below.
  if (metrics.length <= 1) return;

  const items = metrics.map((mid) => {
    const ext = externalTabLabel(mid);
    if (ext) return { key: mid, label: ext };
    const exists = metricExists(mid);
    return {
      key: mid,
      label: t(exists ? "LOC_DEMOGRAPHICS_METRIC_" + mid.toUpperCase() : "LOC_DEMOGRAPHICS_NYI")
    };
  });

  // A top-level companion panel (e.g. Emigration) emits no page-tab row, so its section selector
  // (Graphs / Network / Civilizations / …) is the row directly under the view-tab bar. Render it
  // as native tabs there, section navigation, not the 3rd-level metric pills, so the in-section
  // toggles
  // (a group's member/view pill rows) read as a clear level below it.
  if (isTopLevelPanelPage(page.id)) {
    buildSectionTabBar(host, ctx, items, activeMetric);
    return;
  }

  const metricHost = document.createElement("div");
  metricHost.className = "demographics-tab-bar-host w-full";
  host.appendChild(metricHost);
  metricHost.appendChild(pillRow(items, activeMetric, (/** @type {string} */ id) => {
    if (typeof ctx.setActiveMetric === "function") ctx.setActiveMetric(id);
  }));
}

/**
 * Whether `pageId` is a companion panel shown as its own top-level view tab (Emigration). Such
 * pages have no page-tab row, so their section selector renders as a native tab bar instead of
 * pills.
 * @param {string} pageId The active page id.
 * @returns {boolean} True for a top-level companion panel.
 */
function isTopLevelPanelPage(pageId) {
  return EXTERNAL_PANELS.some((p) => p && p.topLevel && p.id === pageId);
}

/**
 * Build the section selector for a top-level panel page as a native `fxs-tab-bar` (the second row
 * of tabs, under the view-tab bar) instead of a pill row. Selecting a tab sets the active
 * metric/section.
 * @param {HTMLElement} host The view host.
 * @param {*} ctx Render context.
 * @param {{key:string,label:string}[]} items The section items (metric id + label).
 * @param {string} activeMetric The active section/metric id.
 */
function buildSectionTabBar(host, ctx, items, activeMetric) {
  const tabHost = document.createElement("div");
  tabHost.className = "demographics-page-tab-host w-full";
  host.appendChild(tabHost);

  const bar = document.createElement("fxs-tab-bar");
  bar.classList.add("demographics-page-tabs", "w-full", "font-title", "text-sm");
  bar.setAttribute("data-audio-group-ref", "audio-screen-unlocks");
  bar.setAttribute("tab-item-class", "font-title text-base");
  bar.setAttribute("tab-items", JSON.stringify(items.map((it) => ({ id: it.key, label: it.label }))));
  const idx = Math.max(0, items.findIndex((it) => it.key === activeMetric));
  bar.setAttribute("selected-tab-index", String(idx));
  bar.addEventListener("tab-selected", (event) => {
    const id = /** @type {*} */ (event)?.detail?.selectedItem?.id;
    if (!id || id === activeMetric) return;
    if (typeof ctx.setActiveMetric === "function") ctx.setActiveMetric(id);
  });
  tabHost.appendChild(bar);
}

/**
 * The localized display name for a metric, from the same `LOC_DEMOGRAPHICS_METRIC_<ID>`
 * key the metric tab uses. Falls back to the English descriptor only if the key
 * is unresolved (t() returns the key unchanged on a miss).
 * @param {string} id The metric id.
 * @param {*} metricObj The metric descriptor (for fallback text).
 * @returns {string} The localized name.
 */
function localizedMetricName(id, metricObj) {
  const key = "LOC_DEMOGRAPHICS_METRIC_" + String(id).toUpperCase();
  const localized = t(key);
  if (localized && localized !== key) return localized;
  return metricObj.title || metricObj.label || id;
}

/**
 * The chart TITLE for a real metric: an explicit `LOC_DEMOGRAPHICS_METRIC_<ID>_TITLE` override when
 * present (so the big title can read fuller than the short pill, e.g. pill "GDP" → title "Gross
 * Domestic Product (GDP)"), else the metric's display name (identical to the pill).
 * @param {string} id Metric id.
 * @param {*} metricObj Metric descriptor.
 * @returns {string} The chart title text.
 */
function metricChartTitle(id, metricObj) {
  const key = "LOC_DEMOGRAPHICS_METRIC_" + String(id).toUpperCase() + "_TITLE";
  const override = t(key);
  if (override && override !== key) return override;
  return localizedMetricName(id, metricObj);
}

/**
 * Build and append the chart title (and optional synthetic subtitle line).
 * @param {HTMLElement} host
 * @param {string} activeMetric
 * @param {*} metricObj
 * @param {*} synthMeta
 */
export function buildChartTitle(host, activeMetric, metricObj, synthMeta) {
  const title = document.createElement("div");
  title.className = "demographics-chart-title font-title text-base";
  if (synthMeta) {
    title.textContent = synthMeta.title;
  } else if (metricObj) {
    title.textContent = metricChartTitle(activeMetric, metricObj);
  } else {
    title.textContent = activeMetric;
  }
  // A metric's explanatory note rides as a title hover tooltip instead of a standalone on-page
  // caption: the Crises page description (CHART_TITLE_TOOLTIPS), else a registered metric's own
  // one-line `description` (e.g. the Emigration graphs). The strict id check avoids getMetric()'s
  // METRICS[0] fallback for an unknown id.
  if (CHART_TITLE_TOOLTIPS[activeMetric]) {
    title.title = t(CHART_TITLE_TOOLTIPS[activeMetric]);
  } else if (metricObj && metricObj.id === activeMetric && typeof metricObj.description === "string") {
    title.title = metricObj.description;
  }
  host.appendChild(title);
  appendChartSubtitle(host, activeMetric, synthMeta, metricObj);
}

/**
 * Append the optional subtitle line under the chart title: synthetic metrics carry their own
 * `subtitle`; registered metrics opt in with a `LOC_DEMOGRAPHICS_METRIC_<ID>_SUBTITLE` key, or, for
 * companion-registered metrics that use raw strings, not LOC keys (e.g. the Emigration graphs), a
 * plain `subtitle` string on the metric descriptor.
 * @param {HTMLElement} host The title host.
 * @param {string} activeMetric The active metric id.
 * @param {*} synthMeta The synthetic-metric meta, when the metric is synthetic.
 * @param {*} [metricObj] The metric descriptor (for a raw `subtitle` fallback).
 */
function appendChartSubtitle(host, activeMetric, synthMeta, metricObj) {
  let subtitle = "";
  if (synthMeta && synthMeta.subtitle) {
    subtitle = synthMeta.subtitle;
  } else if (!synthMeta) {
    const subKey = "LOC_DEMOGRAPHICS_METRIC_" + String(activeMetric).toUpperCase() + "_SUBTITLE";
    const localized = t(subKey);
    if (localized && localized !== subKey) subtitle = localized;
    // A companion metric (e.g. the Emigration graphs) supplies its definition as a raw `subtitle`
    // string. The strict id check avoids getMetric()'s METRICS[0] fallback for an unknown id.
    else if (metricObj && metricObj.id === activeMetric && typeof metricObj.subtitle === "string") {
      subtitle = metricObj.subtitle;
    }
  }
  if (!subtitle) return;
  const sub = document.createElement("div");
  sub.className = "demographics-chart-subtitle demographics-history-subtitle font-body text-sm";
  sub.textContent = subtitle;
  host.appendChild(sub);
}
