// history-toolbar.js
//
// Toolbar and tab-row builders for the "Historical Data" view: the page tab
// row, the per-page metric tab row, the chart title + per-metric captions, and
// the chart toolbar (per-metric viewer controls, focus-clear, time-units
// toggle, wonders toggle, and the Copy-as-CSV button group). The render
// orchestrator in view-history.js composes these in their fixed display order.

import { t } from "/demographics/ui/demographics-i18n.js";
import { makeClickable } from "/demographics/ui/demographics-a11y.js";
import { safePlaySound, playActivate } from "/demographics/ui/demographics-audio.js";
import { exportHistoryAsCsv } from "/demographics/ui/screen-demographics/views/history-csv.js";
import { PAGES, metricExists } from "/demographics/ui/screen-demographics/views/view-history.js";
import { getCurrentAgeType } from "/demographics/ui/sampler-collectors.js";
import { mergeWars } from "/demographics/ui/screen-demographics/chart-wars-merge.js";
import { nameMergedWars } from "/demographics/ui/screen-demographics/chart-wars-naming.js";

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
 * Options for {@link buildMetricInfoCaption}.
 * @typedef {Object} MetricInfoOpts
 * @property {string} triggerText Visible caption-trigger text.
 * @property {string} title Popover heading.
 * @property {string} bodyHtml Popover body as an HTML string.
 */

/**
 * Render context handed to the toolbar builders. Engine-boundary callbacks are
 * loose; only the members the toolbar reads are documented here.
 * @typedef {import("/demographics/ui/screen-demographics/views/view-history.js").HistoryCtx} HistoryCtx
 */

const DBG = false;
/**
 * Debug logger, no-op unless {@link DBG} is set.
 * @param {...*} a Values to log.
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.history-toolbar]", ...a);
}

/**
 * Build and append the page-level tab bar (the row of metric-group tabs).
 * @param {HTMLElement} host The view host element.
 * @param {HistoryCtx} ctx Render context.
 * @param {string} activePage Resolved active page id.
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
 * Handle a page-tab selection: ignore no-op selections, otherwise snap the
 * active metric to the new page's first metric (so the chart reflects the page
 * immediately) and record the page change.
 * @param {HistoryCtx} ctx Render context.
 * @param {string} activePage The previously-active page id.
 * @param {string|undefined} id The newly-selected page id.
 */
function onPageTabSelected(ctx, activePage, id) {
  if (!id || id === activePage) return;
  dlog("page-selected:", id);
  // Snap the activeMetric to the page's first metric so the chart
  // immediately reflects the new page rather than persisting the
  // previously-selected metric until the user touches the metric tabs.
  const targetPage = PAGES.find((p) => p.id === id);
  const firstMetric = targetPage?.metrics?.[0];
  if (firstMetric && typeof ctx.setActiveMetric === "function") {
    ctx.setActiveMetric(firstMetric);
  }
  if (typeof ctx.setActivePage === "function") ctx.setActivePage(id);
}

/**
 * Apply the desktop-only nav-help class hints to a tab bar. No-ops on mobile
 * or when the view-experience globals are unavailable.
 * @param {HTMLElement} metricBar The metric tab bar element.
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
    // UI.getViewExperience()/UIViewExperience can throw at the engine
    // boundary; skip the desktop-only nav-help class hints.
  }
}

/**
 * Metric ids that only exist in a specific Civ7 age, mapped to the age they
 * require. Treasure resources are an Exploration-age mechanic; Factory
 * resources are a Modern-age mechanic - their tabs are hidden in other ages.
 * @type {Record<string, string>}
 */
const AGE_GATED_METRICS = {
  resources_treasure: "AGE_EXPLORATION",
  resources_factory: "AGE_MODERN"
};

/**
 * Filter a page's metric ids to those visible in the current age, dropping
 * age-gated metrics (treasure/factory) when the current age doesn't match. When
 * the age can't be resolved, age-gated metrics are hidden (they're meaningless
 * outside their age and have no data in any other).
 * @param {string[]} metrics The page's metric ids.
 * @returns {string[]} The metric ids to show as tabs this age.
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
 * @param {HTMLElement} host The view host element.
 * @param {HistoryCtx} ctx Render context.
 * @param {PageDef} page The active page.
 * @param {string} activeMetric Resolved active metric id.
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
      if (typeof ctx.setActiveMetric === "function") ctx.setActiveMetric(id); // still record selection so NYI shows
      return;
    }
    dlog("metric-selected:", id);
    if (typeof ctx.setActiveMetric === "function") ctx.setActiveMetric(id);
  });
  metricHost.appendChild(metricBar);
}

/**
 * Build and append the chart title (and an optional synthetic subtitle line).
 * @param {HTMLElement} host The view host element.
 * @param {string} activeMetric Active metric id.
 * @param {MetricDef|null} metricObj Resolved real metric definition, if any.
 * @param {SyntheticMeta|null} synthMeta Synthetic metric meta, if any.
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
  // Optional parenthetical subtitle on the line below - used by
  // synthetic metrics that carry a `subtitle` (e.g. Triumphs Over Time).
  if (synthMeta && synthMeta.subtitle) {
    const sub = document.createElement("div");
    sub.className = "demographics-chart-subtitle demographics-history-subtitle font-body text-sm";
    sub.textContent = synthMeta.subtitle;
    host.appendChild(sub);
  }
}

/**
 * Build the localized caption content for the GDP metric. Resolved per-render
 * so a language change between renders is reflected.
 * @returns {MetricInfoOpts} The GDP caption content.
 */
function gdpCaption() {
  return {
    triggerText: t("LOC_DEMOGRAPHICS_CAPTION_GDP_TRIGGER"),
    title: t("LOC_DEMOGRAPHICS_CAPTION_GDP_TITLE"),
    bodyHtml: t("LOC_DEMOGRAPHICS_CAPTION_GDP_BODY")
  };
}

/**
 * Build the localized caption content for the Diplomatic Approval metric.
 * Resolved per-render so a language change between renders is reflected.
 * @returns {MetricInfoOpts} The Approval caption content.
 */
function approvalCaption() {
  return {
    triggerText: t("LOC_DEMOGRAPHICS_CAPTION_APPROVAL_TRIGGER"),
    title: t("LOC_DEMOGRAPHICS_CAPTION_APPROVAL_TITLE"),
    bodyHtml: t("LOC_DEMOGRAPHICS_CAPTION_APPROVAL_BODY")
  };
}

/**
 * Append the per-metric explanation caption(s) for the active metric (GDP and
 * Diplomatic Approval carry rich formula popovers). No-op for other metrics.
 * @param {HTMLElement} host The view host element.
 * @param {string} activeMetric Active metric id.
 */
export function appendMetricCaptions(host, activeMetric) {
  if (activeMetric === "gdp") {
    host.appendChild(buildMetricInfoCaption(gdpCaption()));
  }
  if (activeMetric === "approval") {
    host.appendChild(buildMetricInfoCaption(approvalCaption()));
  }
}

/**
 * Build an "ⓘ …" caption trigger that opens a sticky popover with rich HTML
 * content on hover. Replaces the unreliable `title` attribute path - Coherent
 * GameFace doesn't surface native browser tooltips consistently, so we manage
 * a dedicated popover element ourselves.
 * @param {MetricInfoOpts} opts Trigger text, title, and body HTML.
 * @returns {HTMLElement} The caption wrapper element.
 */
function buildMetricInfoCaption(opts) {
  const wrap = document.createElement("div");
  // Caption now lives between title and filter row - center on the full
  // host width (no asymmetric padding needed; nothing to align with).
  wrap.className = "demographics-metric-info demographics-history-metric-info";

  const trigger = document.createElement("div");
  trigger.className = "demographics-chart-caption-compact font-body text-xs";
  trigger.textContent = opts.triggerText;
  wrap.appendChild(trigger);

  const popover = document.createElement("div");
  popover.className = "demographics-metric-info-popover demographics-tip-chrome font-body text-xs";
  popover.style.display = "none";
  const title = document.createElement("div");
  title.className = "demographics-metric-info-title font-title text-sm";
  title.textContent = opts.title;
  popover.appendChild(title);
  const body = document.createElement("div");
  body.className = "demographics-metric-info-body";
  body.innerHTML = opts.bodyHtml;
  popover.appendChild(body);
  wrap.appendChild(popover);

  /** @type {ReturnType<typeof setTimeout>|null} */
  let hideTimer = null;
  /**
   * Show the popover and cancel any pending hide.
   */
  function show() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    popover.style.display = "block";
  }
  /**
   * Schedule the popover to hide after a short grace period.
   */
  function scheduleHide() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      popover.style.display = "none";
    }, 200);
  }
  trigger.addEventListener("mouseenter", show);
  trigger.addEventListener("mouseleave", scheduleHide);
  popover.addEventListener("mouseenter", show);
  popover.addEventListener("mouseleave", scheduleHide);
  return wrap;
}

/**
 * Append the radar-only toolbar controls: per-age snapshot pills plus a
 * Refresh affordance that re-pulls live legacy progress.
 * @param {HTMLElement} toolbar The toolbar element.
 * @param {HistoryCtx} ctx Render context.
 */
function appendRadarControls(toolbar, ctx) {
  const ageOpts = [
    { id: "current", label: t("LOC_DEMOGRAPHICS_RADAR_SNAPSHOT_CURRENT") },
    { id: "AGE_ANTIQUITY", label: t("LOC_DEMOGRAPHICS_RADAR_SNAPSHOT_AGE1") },
    { id: "AGE_EXPLORATION", label: t("LOC_DEMOGRAPHICS_RADAR_SNAPSHOT_AGE2") }
  ];
  const active = ctx.activeRadarAge || "current";
  const radarLabel = document.createElement("div");
  radarLabel.className = "demographics-chart-toolbar-label font-body text-xs";
  radarLabel.textContent = t("LOC_DEMOGRAPHICS_LABEL_SNAPSHOT");
  toolbar.appendChild(radarLabel);
  for (const opt of ageOpts) {
    // Only enable past-age buttons when we actually have that snapshot.
    const haveSnap =
      opt.id === "current" ||
      (ctx.history &&
        /** @type {*} */ (ctx.history).legacySnapshots &&
        /** @type {*} */ (ctx.history).legacySnapshots[opt.id]);
    const pill = document.createElement("div");
    pill.className = "demographics-chart-time-filter-pill";
    if (opt.id === active) pill.classList.add("is-active");
    if (!haveSnap) {
      pill.classList.add("demographics-history-pill-disabled");
      pill.title = t("LOC_DEMOGRAPHICS_RADAR_SNAPSHOT_NONE_TOOLTIP");
    } else {
      makeClickable(pill, (ev) => {
        ev?.stopPropagation?.();
        playActivate();
        if (typeof ctx.setActiveRadarAge === "function") ctx.setActiveRadarAge(opt.id);
      });
    }
    pill.textContent = opt.label;
    toolbar.appendChild(pill);
  }
  // Refresh affordance - re-renders the radar so the live
  // VictoryManager pull picks up changes that happened while the
  // panel was already open (a civ finishing a triumph, etc.).
  const refresh = document.createElement("div");
  refresh.className = "demographics-chart-toolbar-btn font-body text-xs";
  refresh.textContent = t("LOC_DEMOGRAPHICS_BTN_REFRESH");
  refresh.title = t("LOC_DEMOGRAPHICS_BTN_REFRESH_TOOLTIP");
  makeClickable(refresh, (ev) => {
    ev?.stopPropagation?.();
    playActivate();
    if (typeof ctx.requestReload === "function") ctx.requestReload();
  });
  toolbar.appendChild(refresh);
}

/**
 * Append the wars-view toolbar controls: a major-civ dropdown filter and an
 * ongoing-only toggle. Requires `chartMod.collectWarCivOptions`.
 * @param {HTMLElement} toolbar The toolbar element.
 * @param {HistoryCtx} ctx Render context.
 */
function appendWarsControls(toolbar, ctx) {
  // Filter to majors only - CSes never appear on this view.
  const wopts = /** @type {*} */ (ctx.chartMod)
    .collectWarCivOptions(ctx.history)
    .filter((/** @type {*} */ o) => !o.isCS);
  const allOpt = { pid: null, label: t("LOC_DEMOGRAPHICS_WARS_ALL_MAJORS"), isCS: false };
  const dropdownOpts = [allOpt].concat(wopts);
  const lbl = document.createElement("div");
  lbl.className = "demographics-chart-toolbar-label font-body text-xs";
  lbl.textContent = t("LOC_DEMOGRAPHICS_LABEL_CIV");
  toolbar.appendChild(lbl);
  const dd = document.createElement("fxs-dropdown");
  dd.classList.add("demographics-chart-viewer-dropdown");
  dd.setAttribute("data-audio-group-ref", "audio-screen-unlocks");
  dd.setAttribute("dropdown-items", JSON.stringify(dropdownOpts.map((o) => ({ label: o.label }))));
  let didx = dropdownOpts.findIndex(
    (o) =>
      (o.pid === null && ctx.warsFilterPid == null) ||
      (o.pid !== null && Number(o.pid) === Number(ctx.warsFilterPid))
  );
  if (didx < 0) didx = 0;
  dd.setAttribute("selected-item-index", String(didx));
  dd.addEventListener("dropdown-selection-change", (event) => {
    const i = /** @type {*} */ (event)?.detail?.selectedIndex;
    if (typeof i !== "number" || i < 0 || i >= dropdownOpts.length) return;
    if (typeof ctx.setWarsFilterPid === "function") {
      ctx.setWarsFilterPid(dropdownOpts[i].pid);
    }
  });
  toolbar.appendChild(dd);

  // Active-only toggle. (CS toggle removed - CS conflicts are never
  // shown on the conflicts view per user direction.)
  const activePill = document.createElement("div");
  activePill.className = "demographics-chart-time-filter-pill";
  if (ctx.warsActiveOnly) activePill.classList.add("is-active");
  activePill.textContent = ctx.warsActiveOnly
    ? t("LOC_DEMOGRAPHICS_WARS_ONGOING_ONLY")
    : t("LOC_DEMOGRAPHICS_WARS_ALL_WARS");
  makeClickable(activePill, (ev) => {
    ev?.stopPropagation?.();
    playActivate();
    if (typeof ctx.setWarsActiveOnly === "function") ctx.setWarsActiveOnly(!ctx.warsActiveOnly);
  });
  toolbar.appendChild(activePill);
}

/**
 * Append a single "Viewing:" civ-selector dropdown wired to `setViewerPid`.
 * Shared by the triumphs-stack and resources-stack toolbars. No-op when there
 * is fewer than two options to choose from.
 * @param {HTMLElement} toolbar The toolbar element.
 * @param {Array<*>} opts Civ options ({ pid, label }).
 * @param {Pid|undefined} currentPid Currently selected viewer pid.
 * @param {(pid: Pid) => void} [setViewerPid] Setter for the viewer pid.
 */
function appendViewerDropdown(toolbar, opts, currentPid, setViewerPid) {
  if (opts.length <= 1) return;
  const label = document.createElement("div");
  label.className = "demographics-chart-toolbar-label font-body text-xs";
  label.textContent = t("LOC_DEMOGRAPHICS_LABEL_VIEWING");
  toolbar.appendChild(label);
  const dd = document.createElement("fxs-dropdown");
  dd.classList.add("demographics-chart-viewer-dropdown");
  dd.setAttribute("data-audio-group-ref", "audio-screen-unlocks");
  dd.setAttribute("dropdown-items", JSON.stringify(opts.map((o) => ({ label: o.label }))));
  let idx = opts.findIndex((o) => Number(o.pid) === Number(currentPid));
  if (idx < 0) idx = 0;
  dd.setAttribute("selected-item-index", String(idx));
  dd.addEventListener("dropdown-selection-change", (event) => {
    const i = /** @type {*} */ (event)?.detail?.selectedIndex;
    if (typeof i !== "number" || i < 0 || i >= opts.length) return;
    if (typeof setViewerPid === "function") {
      setViewerPid(Number(opts[i].pid));
    }
  });
  toolbar.appendChild(dd);
}

/**
 * Append the "Clear Focus (N)" toolbar button when any civs are focused.
 * @param {HTMLElement} toolbar The toolbar element.
 * @param {HistoryCtx} ctx Render context.
 */
function appendClearFocus(toolbar, ctx) {
  if (!(ctx.focusedCivs && ctx.focusedCivs.size > 0)) return;
  const clear = document.createElement("div");
  clear.className = "demographics-chart-toolbar-btn font-body text-xs";
  clear.textContent = t("LOC_DEMOGRAPHICS_BTN_CLEAR_FOCUS", ctx.focusedCivs.size);
  clear.title = t("LOC_DEMOGRAPHICS_BTN_CLEAR_FOCUS_TOOLTIP");
  makeClickable(clear, (ev) => {
    ev?.stopPropagation?.();
    safePlaySound("data-audio-activate", "options");
    if (typeof ctx.clearFocus === "function") ctx.clearFocus();
  });
  toolbar.appendChild(clear);
}

/**
 * Append the X-axis time-units toggle. Cycles "Both" → "Turn" → "Year",
 * pushing the new mode into chartMod so every chart formats its X axis to
 * match on the next reload.
 * @param {HTMLElement} toolbar The toolbar element.
 * @param {HistoryCtx} ctx Render context.
 */
function appendTimeUnitsToggle(toolbar, ctx) {
  const modes = ["both", "turn", "year"];
  /** @type {Record<string, string>} */
  const labels = {
    both: t("LOC_DEMOGRAPHICS_BTN_TIME_BOTH"),
    turn: t("LOC_DEMOGRAPHICS_BTN_TIME_TURN"),
    year: t("LOC_DEMOGRAPHICS_BTN_TIME_YEAR")
  };
  let mode = "both";
  try {
    mode = ctx.settings?.getSetting?.("xAxisMode", "both") || "both";
  } catch (_) {
    // settings.getSetting("xAxisMode") can throw at the storage boundary;
    // keep the "both" default.
  }
  if (!modes.includes(mode)) mode = "both";
  try {
    ctx.chartMod?.setXAxisMode?.(mode);
  } catch (_) {
    // chartMod.setXAxisMode(mode) is an optional module hook that can throw;
    // the toggle still renders with its current label.
  }
  const timeBtn = document.createElement("div");
  timeBtn.className = "demographics-chart-toolbar-btn font-body text-xs";
  timeBtn.textContent = labels[mode];
  timeBtn.title = t("LOC_DEMOGRAPHICS_BTN_TIME_TOOLTIP");
  makeClickable(timeBtn, (ev) => {
    ev?.stopPropagation?.();
    safePlaySound("data-audio-activate", "options");
    const next = modes[(modes.indexOf(mode) + 1) % modes.length];
    try {
      ctx.settings?.setSetting?.("xAxisMode", next);
    } catch (_) {
      // settings.setSetting("xAxisMode") persistence is best-effort; the
      // reload below still applies `next` for this session.
    }
    try {
      ctx.chartMod?.setXAxisMode?.(next);
    } catch (_) {
      // chartMod.setXAxisMode(next) is an optional module hook that can throw;
      // the requestReload below re-applies the mode on next render.
    }
    ctx.requestReload?.();
  });
  toolbar.appendChild(timeBtn);
}

/**
 * Append the wonders-layer toggle (styled like "Export CSV"). ON = full
 * opacity, OFF = dimmed text so the active state reads at a glance.
 * @param {HTMLElement} toolbar The toolbar element.
 * @param {HistoryCtx} ctx Render context.
 * @param {string} activeMetric Active metric id (for the debug log only).
 */
function appendWondersToggle(toolbar, ctx, activeMetric) {
  const wondersOn = (() => {
    try {
      return !!ctx.settings?.getSetting?.("showWonderMarkers", true);
    } catch (_) {
      // settings.getSetting("showWonderMarkers") can throw at the storage
      // boundary; default to ON.
      return true;
    }
  })();
  const wondersBtn = document.createElement("div");
  wondersBtn.className = "demographics-chart-toolbar-btn font-body text-xs";
  // No ✓ glyph - Civ7's font set doesn't include U+2713 and renders
  // it as a missing-glyph "[]" box. Plain "ON"/"OFF" is unambiguous.
  wondersBtn.textContent = wondersOn
    ? t("LOC_DEMOGRAPHICS_BTN_WONDERS_ON")
    : t("LOC_DEMOGRAPHICS_BTN_WONDERS_OFF");
  wondersBtn.title = wondersOn
    ? t("LOC_DEMOGRAPHICS_BTN_WONDERS_ON_TOOLTIP")
    : t("LOC_DEMOGRAPHICS_BTN_WONDERS_OFF_TOOLTIP");
  if (!wondersOn) {
    // OFF state - desaturated text color is the "off" signal; the
    // "Wonders: OFF" label itself already says it explicitly.
    wondersBtn.classList.add("demographics-history-wonders-off");
  }
  makeClickable(wondersBtn, (ev) => {
    ev?.stopPropagation?.();
    safePlaySound("data-audio-activate", "options");
    try {
      const next = !ctx.settings?.getSetting?.("showWonderMarkers", true);
      ctx.settings?.setSetting?.("showWonderMarkers", next);
      dlog("wonders toggle clicked; new value=" + next);
    } catch (_) {
      // settings.getSetting/setSetting("showWonderMarkers") can throw at the
      // storage boundary; the requestReload below still re-reads the setting.
    }
    ctx.requestReload?.();
  });
  toolbar.appendChild(wondersBtn);
  dlog("wonders button mounted; activeMetric=" + activeMetric + " wondersOn=" + wondersOn);
}

/**
 * Build the absolutely-positioned CSV info tooltip popover (engine tooltip
 * chrome + rich HTML body). Coherent doesn't reliably render multi-line native
 * `title` attrs, and `\n` shows as a single space, so we manage our own.
 * @returns {HTMLElement} The tooltip element (initially hidden).
 */
function buildCsvInfoTooltip() {
  const tip = document.createElement("div");
  tip.className =
    "demographics-tip-chrome demographics-history-tip demographics-history-tip-csv";
  const HDR =
    "color:rgb(236,224,198);font-family:TitilliumWeb, sans-serif;" +
    "font-weight:700;text-transform:uppercase;letter-spacing:0.04em;" +
    "font-size:1.02rem;margin-bottom:0.65rem;padding-bottom:0.4rem;" +
    "border-bottom:1px solid rgba(204,188,163,0.2);";
  tip.innerHTML =
    `<div style="${HDR}">` +
    t("LOC_DEMOGRAPHICS_BTN_COPY_CSV") +
    `</div>` +
    t("LOC_DEMOGRAPHICS_TOOLTIP_CSV_BODY");
  return tip;
}

/**
 * Build the CSV info icon - a native info BLP with a custom hover popover
 * (Coherent doesn't reliably render multi-line native `title` attrs).
 * @returns {HTMLElement} The info-icon element.
 */
function buildCsvInfoIcon() {
  const el = document.createElement("div");
  el.className = "demographics-chart-toolbar-info demographics-history-csv-info-icon";
  // Custom HTML tooltip - Coherent doesn't reliably render multi-line
  // native `title` attrs, and `\n` shows as a single space. Inject our
  // own absolute-positioned tooltip with the engine's tooltip chrome.
  const tip = buildCsvInfoTooltip();
  el.appendChild(tip);
  el.addEventListener("mouseenter", () => {
    tip.style.opacity = "1";
    el.style.opacity = "1";
  });
  el.addEventListener("mouseleave", () => {
    tip.style.opacity = "0";
    el.style.opacity = "0.75";
  });
  return el;
}

/**
 * Append the "Copy as CSV" button grouped with its info icon (explicit
 * inline-flex group guarantees the icon sits to the right of the button).
 * @param {HTMLElement} toolbar The toolbar element.
 * @param {HTMLElement} host The view host element (for the export toast).
 * @param {HistoryCtx} ctx Render context.
 */
function appendCsvControls(toolbar, host, ctx) {
  // Build the CSV info icon - appended AFTER the CSV button below so it
  // sits to the right. We construct it here and keep a ref to mount last.
  const csvInfo = buildCsvInfoIcon();

  const csvBtn = document.createElement("div");
  csvBtn.className = "demographics-chart-toolbar-btn font-body text-xs";
  csvBtn.textContent = t("LOC_DEMOGRAPHICS_BTN_COPY_CSV");
  csvBtn.title = t("LOC_DEMOGRAPHICS_BTN_COPY_CSV_TOOLTIP");
  makeClickable(csvBtn, (ev) => {
    ev?.stopPropagation?.();
    safePlaySound("data-audio-activate", "options");
    exportHistoryAsCsv(ctx.history, host);
  });
  // Wrap CSV + info icon as a single inline-flex group so the icon is
  // guaranteed to render to the RIGHT of "Export CSV" regardless of the
  // toolbar's justification or gap behavior (Coherent's flex layout has
  // surprised us before - explicit grouping removes the ambiguity).
  const csvGroup = document.createElement("div");
  csvGroup.className = "demographics-history-csv-group";
  csvGroup.appendChild(csvBtn);
  csvGroup.appendChild(csvInfo);
  toolbar.appendChild(csvGroup);
}

/**
 * Append the toolbar controls specific to the active metric: the radar
 * snapshot pills, wars dropdown, or a triumphs/resources viewer dropdown.
 * No-op for metrics with no dedicated controls.
 * @param {HTMLElement} toolbar The toolbar element.
 * @param {HistoryCtx} ctx Render context.
 * @param {string} activeMetric Active metric id.
 */
function appendMetricSpecificControls(toolbar, ctx, activeMetric) {
  if (activeMetric === "legacy_radar") appendRadarControls(toolbar, ctx);
  else if (activeMetric === "wars_gantt") appendWarsControlsIfReady(toolbar, ctx);
  else if (activeMetric === "war_graphs") appendWarGraphsControls(toolbar, ctx);
  else if (activeMetric === "resources_stack") appendResourcesViewerIfReady(toolbar, ctx);
}

/**
 * Append the War Graphs control: a dropdown to pick which war to graph. Lists
 * tracked wars newest-first by display name; selection persists via ctx.
 * @param {HTMLElement} toolbar The toolbar element.
 * @param {HistoryCtx} ctx Render context.
 */
function appendWarGraphsControls(toolbar, ctx) {
  const h = /** @type {*} */ (ctx.history) || {};
  const rawWars = Array.isArray(h.wars) ? h.wars : [];
  const samples = Array.isArray(h.samples) ? h.samples : [];
  const latest = samples.length ? samples[samples.length - 1].turn : 0;
  // Collapse multi-front wars so the picker matches the timeline + graphs, and
  // use the SAME fancy names (regional/great/world + ordinals) as the timeline.
  const wars = mergeWars(rawWars, latest);
  const names = nameMergedWars(wars, samples);
  /** @type {{ id: number, label: string }[]} */
  const opts = wars
    .filter((/** @type {*} */ w) => typeof w?.warUniqueID === "number")
    .map((/** @type {*} */ w) => ({
      id: w.warUniqueID,
      label: names.get(w.warUniqueID) || w.name || "War #" + w.warUniqueID
    }))
    .reverse();
  const lbl = document.createElement("div");
  lbl.className = "demographics-chart-toolbar-label font-body text-xs";
  lbl.textContent = t("LOC_DEMOGRAPHICS_WAR_GRAPHS_PICK");
  toolbar.appendChild(lbl);
  if (!opts.length) return;
  const dd = document.createElement("fxs-dropdown");
  dd.classList.add("demographics-chart-viewer-dropdown");
  dd.setAttribute("data-audio-group-ref", "audio-screen-unlocks");
  dd.setAttribute("dropdown-items", JSON.stringify(opts.map((o) => ({ label: o.label }))));
  let didx = opts.findIndex((o) => Number(o.id) === Number(ctx.warGraphsWarId));
  if (didx < 0) didx = 0;
  dd.setAttribute("selected-item-index", String(didx));
  dd.addEventListener("dropdown-selection-change", (event) => {
    const i = /** @type {*} */ (event)?.detail?.selectedIndex;
    if (typeof i !== "number" || i < 0 || i >= opts.length) return;
    if (typeof ctx.setWarGraphsWarId === "function") ctx.setWarGraphsWarId(opts[i].id);
  });
  toolbar.appendChild(dd);
}

/**
 * Append the wars controls when `chartMod.collectWarCivOptions` is available.
 * @param {HTMLElement} toolbar The toolbar element.
 * @param {HistoryCtx} ctx Render context.
 */
function appendWarsControlsIfReady(toolbar, ctx) {
  if (ctx.chartMod && typeof ctx.chartMod.collectWarCivOptions === "function") {
    appendWarsControls(toolbar, ctx);
  }
}

/**
 * Append the resources viewer dropdown when `chartMod.collectResourceCivOptions`
 * is available.
 * @param {HTMLElement} toolbar The toolbar element.
 * @param {HistoryCtx} ctx Render context.
 */
function appendResourcesViewerIfReady(toolbar, ctx) {
  if (ctx.chartMod && typeof ctx.chartMod.collectResourceCivOptions === "function") {
    const opts = ctx.chartMod.collectResourceCivOptions(ctx.history);
    appendViewerDropdown(toolbar, opts, ctx.resourcesViewerPid, ctx.setResourcesViewerPid);
  }
}

/** Metrics whose views don't use the X-axis time-units toggle. */
const TIME_TOGGLE_HIDDEN_FOR = new Set(["crisis_graphs"]);

/** Metrics whose views don't use the wonders-layer toggle. */
const WONDERS_TOGGLE_HIDDEN_FOR = new Set(["crisis_stages", "crisis_graphs"]);

/**
 * Build and append the chart toolbar: per-metric viewer controls, focus-clear,
 * time-units toggle, wonders toggle, and the CSV button group.
 * @param {HTMLElement} host The view host element.
 * @param {HistoryCtx} ctx Render context.
 * @param {string} activeMetric Active metric id.
 */
export function buildToolbar(host, ctx, activeMetric) {
  const toolbar = document.createElement("div");
  toolbar.className = "demographics-chart-toolbar";
  // The wars view shows the age-filter pill row directly above this toolbar;
  // add breathing room between the filters and the wars dropdown.
  if (activeMetric === "wars_gantt") toolbar.classList.add("demographics-chart-toolbar-wars");

  appendMetricSpecificControls(toolbar, ctx, activeMetric);
  appendClearFocus(toolbar, ctx);
  // The time-units toggle and wonders toggle apply to different views; the
  // Crisis Stages tables use the time-units toggle (it sets the crisis span
  // units) but not the wonders layer.
  if (!TIME_TOGGLE_HIDDEN_FOR.has(activeMetric)) appendTimeUnitsToggle(toolbar, ctx);
  if (!WONDERS_TOGGLE_HIDDEN_FOR.has(activeMetric)) appendWondersToggle(toolbar, ctx, activeMetric);
  // Copy-as-CSV: top-right (gold pill), consistent on every tab it appears on.
  appendCsvControls(toolbar, host, ctx);

  // Skip an empty toolbar (e.g. Crisis Impact, which hosts its own controls) so
  // it doesn't leave a blank row above the chart.
  if (toolbar.children.length) host.appendChild(toolbar);
}
