// history-tabs.js
// Page + metric tab rows and chart title for Historical Data view.

import { PAGES, metricExists } from "/demographics/ui/screen-demographics/views/view-history.js";
import { getCurrentAgeType } from "/demographics/ui/sampler-collectors.js";

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
  const pageTabs = PAGES.map((p) => ({ id: p.id, label: p.label }));
  pageBar.setAttribute("tab-items", JSON.stringify(pageTabs));
  const pageIdx = Math.max(
    0,
    PAGES.findIndex((p) => p.id === activePage)
  );
  pageBar.setAttribute("selected-tab-index", String(pageIdx));
  pageBar.addEventListener("tab-selected", (event) => {
    const id = /** @type {*} */ (event)?.detail?.selectedItem?.id;
    onPageTabSelected(ctx, activePage, id);
  });
  pageHost.appendChild(pageBar);
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
    title.textContent = metricObj.title || metricObj.label || activeMetric;
  } else {
    title.textContent = activeMetric;
  }
  host.appendChild(title);
  if (synthMeta && synthMeta.subtitle) {
    const sub = document.createElement("div");
    sub.className = "demographics-chart-subtitle demographics-history-subtitle font-body text-sm";
    sub.textContent = synthMeta.subtitle;
    host.appendChild(sub);
  }
}
