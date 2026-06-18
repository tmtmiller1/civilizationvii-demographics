// history-tabs.js
// Page + metric tab rows and chart title for Historical Data view.

import { PAGES, metricExists } from "/demographics/ui/screen-demographics/views/history/view-history.js";
import { getCurrentAgeType } from "/demographics/ui/sampler/sampler-collectors-core.js";
import { t } from "/demographics/ui/core/demographics-i18n.js";
import { EXTERNAL_PANELS, PANEL_SUBTAB_SEP } from "/demographics/ui/metrics/demographics-metrics.js";
import { pageVisibleInTier } from "/demographics/ui/core/demographics-tiers.js";

// Short contextual descriptions for the advanced History pages (P1.5), shown as
// a caption under the page tab row so a newcomer knows what an advanced page is.
/** @type {Record<string, string>} */
const PAGE_DESCRIPTIONS = {
  age: "LOC_DEMOGRAPHICS_PAGE_DESC_AGE",
  resources: "LOC_DEMOGRAPHICS_PAGE_DESC_RESOURCES",
  conflicts: "LOC_DEMOGRAPHICS_PAGE_DESC_CONFLICTS",
  crises: "LOC_DEMOGRAPHICS_PAGE_DESC_CRISES"
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
  // UI complexity tiers (P1.5): only show pages the active tier discloses.
  const visiblePages = PAGES.filter((p) => pageVisibleInTier(p.id));
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

/**
 * @param {HTMLElement} metricBar
 */
function applyNavHelpClasses(metricBar) {
  try {
    if (
      typeof UI !== "undefined" &&
      typeof UI.getViewExperience === "function" &&
      typeof UIViewExperience !== "undefined" &&
      UI.getViewExperience() !== UIViewExperience.Mobile
    ) {
      metricBar.setAttribute("nav-help-right-class", "relative right-0");
      metricBar.setAttribute("nav-help-left-class", "relative left-0");
    }
  } catch (_) {
    // Engine boundary can throw; skip optional nav-help classes.
  }
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
function visibleMetricsForAge(metrics) {
  const age = getCurrentAgeType();
  return metrics.filter((mid) => {
    const requiredAge = AGE_GATED_METRICS[mid];
    return !requiredAge || requiredAge === age;
  });
}

/**
 * Build and append the metric tab bar for `page`.
 * @param {HTMLElement} host
 * @param {*} ctx
 * @param {{id:string,label:string,metrics:string[]}} page
 * @param {string} activeMetric
 */
export function buildMetricTabRow(host, ctx, page, activeMetric) {
  const metricHost = document.createElement("div");
  metricHost.className = "demographics-tab-bar-host w-full";
  host.appendChild(metricHost);

  const metricBar = document.createElement("fxs-tab-bar");
  metricBar.classList.add("demographics-tabs", "w-full", "font-title", "text-sm");
  metricBar.setAttribute("data-audio-group-ref", "audio-screen-unlocks");
  metricBar.setAttribute("tab-item-class", "font-title text-base");
  const metrics = visibleMetricsForAge(page.metrics);
  const metricTabs = metrics.map((mid) => {
    const ext = externalTabLabel(mid);
    if (ext) return { id: mid, label: ext };
    const exists = metricExists(mid);
    return {
      id: mid,
      label: exists ? "LOC_DEMOGRAPHICS_METRIC_" + mid.toUpperCase() : "LOC_DEMOGRAPHICS_NYI"
    };
  });
  metricBar.setAttribute("tab-items", JSON.stringify(metricTabs));

  const mIdx = Math.max(
    0,
    metrics.findIndex((m) => m === activeMetric)
  );
  metricBar.setAttribute("selected-tab-index", String(mIdx));
  applyNavHelpClasses(metricBar);
  metricBar.addEventListener("tab-selected", (event) => {
    const id = /** @type {*} */ (event)?.detail?.selectedItem?.id;
    if (!id || id === activeMetric) return;
    if (!metricExists(id)) {
      dlog("metric-selected but unimplemented:", id);
      if (typeof ctx.setActiveMetric === "function") ctx.setActiveMetric(id);
      return;
    }
    dlog("metric-selected:", id);
    if (typeof ctx.setActiveMetric === "function") ctx.setActiveMetric(id);
  });
  metricHost.appendChild(metricBar);
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
  host.appendChild(title);
  // Subtitle: synthetic metrics carry their own; registered metrics opt in with a
  // LOC_DEMOGRAPHICS_METRIC_<ID>_SUBTITLE key (a brief definition under the title).
  let subtitle = "";
  if (synthMeta && synthMeta.subtitle) {
    subtitle = synthMeta.subtitle;
  } else if (!synthMeta) {
    const subKey = "LOC_DEMOGRAPHICS_METRIC_" + String(activeMetric).toUpperCase() + "_SUBTITLE";
    const localized = t(subKey);
    if (localized && localized !== subKey) subtitle = localized;
  }
  if (subtitle) {
    const sub = document.createElement("div");
    sub.className = "demographics-chart-subtitle demographics-history-subtitle font-body text-sm";
    sub.textContent = subtitle;
    host.appendChild(sub);
  }
}
