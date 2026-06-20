// history-tabs.js
// Page + metric tab rows and chart title for Historical Data view.

import { PAGES, metricExists } from "/demographics/ui/screen-demographics/views/history/view-history.js";
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
  age: "LOC_DEMOGRAPHICS_PAGE_DESC_AGE",
  resources: "LOC_DEMOGRAPHICS_PAGE_DESC_RESOURCES",
  conflicts: "LOC_DEMOGRAPHICS_PAGE_DESC_CONFLICTS"
  // crises: deliberately omitted — its description rides as a hover tooltip on the chart title instead
  // of a standalone on-page note (see CHART_TITLE_TOOLTIPS / buildChartTitle).
};

// Metrics whose chart title carries a hover tooltip (in place of a standalone page-description note).
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
 */
export function buildPageTabRow(host, ctx, activePage) {
  const pageHost = document.createElement("div");
  pageHost.className = "demographics-page-tab-host w-full";
  host.appendChild(pageHost);

  const pageBar = document.createElement("fxs-tab-bar");
  pageBar.classList.add("demographics-page-tabs", "w-full", "font-title", "text-sm");
  pageBar.setAttribute("data-audio-group-ref", "audio-screen-unlocks");
  pageBar.setAttribute("tab-item-class", "font-title text-base");
  // UI complexity tiers (P1.5): only show pages the active tier discloses. Also drop any companion
  // panel marked `topLevel` - it has its own top-level view tab, so it must not appear as a page here.
  const topLevelIds = new Set(EXTERNAL_PANELS.filter((p) => p && p.topLevel).map((p) => p.id));
  const visiblePages = PAGES.filter((p) => pageVisibleInTier(p.id) && !topLevelIds.has(p.id));
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

/** @type {Record<string, string>} */
const AGE_GATED_METRICS = {
  resources_treasure: "AGE_EXPLORATION",
  resources_factory: "AGE_MODERN"
};

/**
 * @param {string[]} metrics
 * @returns {string[]}
 */
export function visibleMetricsForAge(metrics) {
  const age = getCurrentAgeType();
  return metrics.filter((mid) => {
    const requiredAge = AGE_GATED_METRICS[mid];
    return !requiredAge || requiredAge === age;
  });
}

/**
 * Build and append the metric selector for `page` as a row of PILLS (the 3rd-level selector; the page
 * tab row above it stays as native tabs). One pill per visible metric; selecting one sets the active
 * metric (persisted + re-rendered by the host).
 * @param {HTMLElement} host
 * @param {*} ctx
 * @param {{id:string,label:string,metrics:string[]}} page
 * @param {string} activeMetric
 */
export function buildMetricTabRow(host, ctx, page, activeMetric) {
  const metrics = visibleMetricsForAge(page.metrics);
  // A page with a single metric (e.g. Age → the triumphs/legacy radar) needs no selector — a one-pill
  // row is pointless. Skip it; the lone metric still renders below.
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
  // (Graphs / Network / Civilizations / …) is the row directly under the view-tab bar. Render it as
  // native tabs there — section navigation, not the 3rd-level metric pills — so the in-section toggles
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
 * Whether `pageId` is a companion panel shown as its own top-level view tab (Emigration). Such pages
 * have no page-tab row, so their section selector renders as a native tab bar instead of pills.
 * @param {string} pageId The active page id.
 * @returns {boolean} True for a top-level companion panel.
 */
function isTopLevelPanelPage(pageId) {
  return EXTERNAL_PANELS.some((p) => p && p.topLevel && p.id === pageId);
}

/**
 * Build the section selector for a top-level panel page as a native `fxs-tab-bar` (the second row of
 * tabs, under the view-tab bar) instead of a pill row. Selecting a tab sets the active metric/section.
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
    title.textContent = localizedMetricName(activeMetric, metricObj);
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
 * `subtitle`; registered metrics opt in with a `LOC_DEMOGRAPHICS_METRIC_<ID>_SUBTITLE` key, or — for
 * companion-registered metrics that use raw strings, not LOC keys (e.g. the Emigration graphs) — a
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
