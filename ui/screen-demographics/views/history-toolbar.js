// history-toolbar.js
//
// Toolbar and tab-row builders for the "Historical Data" view: the page tab
// row, the per-page metric tab row, the chart title + per-metric captions, and
// the chart toolbar (per-metric viewer controls, focus-clear, time-units
// toggle, wonders toggle, and the Copy-as-CSV button group). The render
// orchestrator in view-history.js composes these in their fixed display order.

import { makeClickable } from "/demographics/ui/demographics-a11y.js";
import { safePlaySound, playActivate } from "/demographics/ui/demographics-audio.js";
import { exportHistoryAsCsv } from "/demographics/ui/screen-demographics/views/history-csv.js";
import { PAGES, metricExists } from "/demographics/ui/screen-demographics/views/view-history.js";
import { getCurrentAgeType } from "/demographics/ui/sampler-collectors.js";

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
 * @returns {void}
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.history-toolbar]", ...a);
}

/**
 * Build and append the page-level tab bar (the row of metric-group tabs).
 * @param {HTMLElement} host The view host element.
 * @param {HistoryCtx} ctx Render context.
 * @param {string} activePage Resolved active page id.
 * @returns {void}
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
 * @returns {void}
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
 * @returns {void}
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
 * resources are a Modern-age mechanic — their tabs are hidden in other ages.
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
 * @returns {void}
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
 * @returns {void}
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
  // Optional parenthetical subtitle on the line below — used by
  // synthetic metrics that carry a `subtitle` (e.g. Triumphs Over Time).
  if (synthMeta && synthMeta.subtitle) {
    const sub = document.createElement("div");
    sub.className = "demographics-chart-subtitle demographics-history-subtitle font-body text-sm";
    sub.textContent = synthMeta.subtitle;
    host.appendChild(sub);
  }
}

/**
 * Caption content for the GDP metric.
 * @type {MetricInfoOpts}
 */
const GDP_CAPTION = {
  triggerText: "ⓘ GDP = Σ weighted yields × turn × 1M  ·  hover for explanation",
  title: "Gross Domestic Product",
  bodyHtml:
    "<p>A pseudo-realistic value combining a civilization's per-turn yields, " +
    "weighted by how much each yield contributes to a real economy.</p>" +
    "<p><b>Formula:</b> Σ (yield × weight) × turn × 1,000,000</p>" +
    "<p><b>Weights</b> (per yield point):</p>" +
    "<ul>" +
    "<li><b>Gold</b> — 1.0 (currency = direct trade)</li>" +
    "<li><b>Production</b> — 1.0 (industrial output)</li>" +
    "<li><b>Science</b> — 1.2 (innovation compounds over time)</li>" +
    "<li><b>Culture</b> — 1.2 (soft power & tourism)</li>" +
    "<li><b>Food</b> — 0.5 (subsistence; only the surplus is GDP-like)</li>" +
    "<li><b>Influence</b> — 1.5 (diplomatic / treaty leverage)</li>" +
    "</ul>" +
    "<p><b>Why multiply by turn?</b> Real economies compound: a civ at turn 200 " +
    "with the same per-turn yields as a civ at turn 50 represents 4× the " +
    "accumulated economic mass.</p>" +
    "<p><i>Presentational only — never affects game state.</i></p>"
};

/**
 * Caption content for the Diplomatic Approval metric.
 * @type {MetricInfoOpts}
 */
const APPROVAL_CAPTION = {
  triggerText: "ⓘ Diplomatic Approval = Σ relationship-weighted scores  ·  hover for explanation",
  title: "Diplomatic Approval — international reputation",
  bodyHtml:
    "<p>A signed aggregate of how every other civilization currently feels " +
    "about you. Goes <b>up</b> when you have allies and friends; goes " +
    "<b>down</b> when you're surrounded by hostiles or at war.</p>" +
    "<p><b>Per-major-civ contribution</b> (based on the relationship enum the " +
    "diplomacy screen shows):</p>" +
    "<ul>" +
    "<li><b>Alliance</b> — +5</li>" +
    "<li><b>Helpful</b> — +3</li>" +
    "<li><b>Friendly</b> — +2</li>" +
    "<li><b>Neutral</b> — 0</li>" +
    "<li><b>Unfriendly</b> — −2</li>" +
    "<li><b>Hostile</b> — −3</li>" +
    "<li><b>At War</b> — −5</li>" +
    "</ul>" +
    "<p><b>City-state contribution:</b> +2 per CS where you are suzerain, " +
    "dampened by 0.3× (so CS-heavy strategies don't dwarf major-civ relations).</p>" +
    "<p><b>Score = Σ(major weights) + 0.3 × Σ(suzerain bonuses)</b></p>" +
    "<p><i>Sampled each turn from each civ's perspective on the local player. " +
    "Presentational only.</i></p>"
};

/**
 * Append the per-metric explanation caption(s) for the active metric (GDP and
 * Diplomatic Approval carry rich formula popovers). No-op for other metrics.
 * @param {HTMLElement} host The view host element.
 * @param {string} activeMetric Active metric id.
 * @returns {void}
 */
export function appendMetricCaptions(host, activeMetric) {
  if (activeMetric === "gdp") {
    host.appendChild(buildMetricInfoCaption(GDP_CAPTION));
  }
  if (activeMetric === "approval") {
    host.appendChild(buildMetricInfoCaption(APPROVAL_CAPTION));
  }
}

/**
 * Build an "ⓘ …" caption trigger that opens a sticky popover with rich HTML
 * content on hover. Replaces the unreliable `title` attribute path — Coherent
 * GameFace doesn't surface native browser tooltips consistently, so we manage
 * a dedicated popover element ourselves.
 * @param {MetricInfoOpts} opts Trigger text, title, and body HTML.
 * @returns {HTMLElement} The caption wrapper element.
 */
function buildMetricInfoCaption(opts) {
  const wrap = document.createElement("div");
  // Caption now lives between title and filter row — center on the full
  // host width (no asymmetric padding needed; nothing to align with).
  wrap.className = "demographics-metric-info demographics-history-metric-info";

  const trigger = document.createElement("div");
  trigger.className = "demographics-chart-caption-compact font-body text-xs";
  trigger.textContent = opts.triggerText;
  wrap.appendChild(trigger);

  const popover = document.createElement("div");
  popover.className = "demographics-metric-info-popover font-body text-xs";
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
   * @returns {void}
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
   * @returns {void}
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
 * @returns {void}
 */
function appendRadarControls(toolbar, ctx) {
  const ageOpts = [
    { id: "current", label: "Current" },
    { id: "AGE_ANTIQUITY", label: "End of 1st Age" },
    { id: "AGE_EXPLORATION", label: "End of 2nd Age" }
  ];
  const active = ctx.activeRadarAge || "current";
  const radarLabel = document.createElement("div");
  radarLabel.className = "demographics-chart-toolbar-label font-body text-xs";
  radarLabel.textContent = "Snapshot:";
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
      pill.title = "No snapshot yet — the age hasn't ended.";
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
  // Refresh affordance — re-renders the radar so the live
  // VictoryManager pull picks up changes that happened while the
  // panel was already open (a civ finishing a triumph, etc.).
  const refresh = document.createElement("div");
  refresh.className = "demographics-chart-toolbar-btn font-body text-xs";
  refresh.textContent = "↻ Refresh";
  refresh.title = "Re-pull legacy progress from VictoryManager.getVictoryProgress()";
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
 * @returns {void}
 */
function appendWarsControls(toolbar, ctx) {
  // Filter to majors only — CSes never appear on this view.
  const wopts = /** @type {*} */ (ctx.chartMod)
    .collectWarCivOptions(ctx.history)
    .filter((/** @type {*} */ o) => !o.isCS);
  const allOpt = { pid: null, label: "All major civilizations", isCS: false };
  const dropdownOpts = [allOpt].concat(wopts);
  const lbl = document.createElement("div");
  lbl.className = "demographics-chart-toolbar-label font-body text-xs";
  lbl.textContent = "Civ:";
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

  // Active-only toggle. (CS toggle removed — CS conflicts are never
  // shown on the conflicts view per user direction.)
  const activePill = document.createElement("div");
  activePill.className = "demographics-chart-time-filter-pill";
  if (ctx.warsActiveOnly) activePill.classList.add("is-active");
  activePill.textContent = ctx.warsActiveOnly ? "Ongoing only" : "All wars";
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
 * @returns {void}
 */
function appendViewerDropdown(toolbar, opts, currentPid, setViewerPid) {
  if (opts.length <= 1) return;
  const label = document.createElement("div");
  label.className = "demographics-chart-toolbar-label font-body text-xs";
  label.textContent = "Viewing:";
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
 * @returns {void}
 */
function appendClearFocus(toolbar, ctx) {
  if (!(ctx.focusedCivs && ctx.focusedCivs.size > 0)) return;
  const clear = document.createElement("div");
  clear.className = "demographics-chart-toolbar-btn font-body text-xs";
  clear.textContent = "Clear Focus (" + ctx.focusedCivs.size + ")";
  clear.title = "Show all civs at full opacity";
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
 * @returns {void}
 */
function appendTimeUnitsToggle(toolbar, ctx) {
  const modes = ["both", "turn", "year"];
  /** @type {Record<string, string>} */
  const labels = { both: "Time: Both", turn: "Time: Turn", year: "Time: Year" };
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
  timeBtn.title = "Toggle X-axis time units between turn number, in-game year, or both";
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
 * @returns {void}
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
  // No ✓ glyph — Civ7's font set doesn't include U+2713 and renders
  // it as a missing-glyph "[]" box. Plain "ON"/"OFF" is unambiguous.
  wondersBtn.textContent = wondersOn ? "Wonders: ON" : "Wonders: OFF";
  wondersBtn.title = wondersOn
    ? "Hide wonder-built markers on chart lines"
    : "Show wonder-built markers on chart lines (icon at the turn each civ completed a wonder)";
  if (!wondersOn) {
    // OFF state — desaturated text color is the "off" signal; the
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
    "img-tooltip-border img-tooltip-bg demographics-history-tip demographics-history-tip-csv";
  const HDR =
    "color:#f3c34c;font-family:TitleFont, BodyFont, sans-serif;" +
    "font-weight:700;text-transform:uppercase;letter-spacing:0.08em;" +
    "font-size:1.05rem;margin-bottom:0.65rem;padding-bottom:0.4rem;" +
    "border-bottom:1px solid rgba(201,162,76,0.55);";
  tip.innerHTML =
    `<div style="${HDR}">Copy as CSV</div>` +
    `<p style="margin:0;">Copies every sampled turn for every civ to your clipboard. Paste into Excel, Sheets, or save as <code>.csv</code>. Civ&nbsp;7's UI sandbox has no file-write API, so the clipboard is the only hand-off.</p>`;
  return tip;
}

/**
 * Build the CSV info icon — a native info BLP with a custom hover popover
 * (Coherent doesn't reliably render multi-line native `title` attrs).
 * @returns {HTMLElement} The info-icon element.
 */
function buildCsvInfoIcon() {
  const el = document.createElement("div");
  el.className = "demographics-chart-toolbar-info demographics-history-csv-info-icon";
  // Custom HTML tooltip — Coherent doesn't reliably render multi-line
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
 * @returns {void}
 */
function appendCsvControls(toolbar, host, ctx) {
  // Build the CSV info icon — appended AFTER the CSV button below so it
  // sits to the right. We construct it here and keep a ref to mount last.
  const csvInfo = buildCsvInfoIcon();

  const csvBtn = document.createElement("div");
  csvBtn.className = "demographics-chart-toolbar-btn font-body text-xs";
  csvBtn.textContent = "Copy as CSV";
  csvBtn.title =
    "Copy all sampled history to the clipboard as CSV — paste into Excel, Google Sheets, or a .csv file";
  makeClickable(csvBtn, (ev) => {
    ev?.stopPropagation?.();
    safePlaySound("data-audio-activate", "options");
    exportHistoryAsCsv(ctx.history, host);
  });
  // Wrap CSV + info icon as a single inline-flex group so the icon is
  // guaranteed to render to the RIGHT of "Export CSV" regardless of the
  // toolbar's justification or gap behavior (Coherent's flex layout has
  // surprised us before — explicit grouping removes the ambiguity).
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
 * @returns {void}
 */
function appendMetricSpecificControls(toolbar, ctx, activeMetric) {
  if (activeMetric === "legacy_radar") appendRadarControls(toolbar, ctx);
  else if (activeMetric === "wars_gantt") appendWarsControlsIfReady(toolbar, ctx);
  else if (activeMetric === "triumphs_stack") appendTriumphsViewerIfReady(toolbar, ctx);
  else if (activeMetric === "resources_stack") appendResourcesViewerIfReady(toolbar, ctx);
}

/**
 * Append the wars controls when `chartMod.collectWarCivOptions` is available.
 * @param {HTMLElement} toolbar The toolbar element.
 * @param {HistoryCtx} ctx Render context.
 * @returns {void}
 */
function appendWarsControlsIfReady(toolbar, ctx) {
  if (ctx.chartMod && typeof ctx.chartMod.collectWarCivOptions === "function") {
    appendWarsControls(toolbar, ctx);
  }
}

/**
 * Append the triumphs viewer dropdown when `chartMod.collectTriumphCivOptions`
 * is available.
 * @param {HTMLElement} toolbar The toolbar element.
 * @param {HistoryCtx} ctx Render context.
 * @returns {void}
 */
function appendTriumphsViewerIfReady(toolbar, ctx) {
  if (ctx.chartMod && typeof ctx.chartMod.collectTriumphCivOptions === "function") {
    const opts = ctx.chartMod.collectTriumphCivOptions(ctx.history);
    appendViewerDropdown(toolbar, opts, ctx.triumphsViewerPid, ctx.setTriumphsViewerPid);
  }
}

/**
 * Append the resources viewer dropdown when `chartMod.collectResourceCivOptions`
 * is available.
 * @param {HTMLElement} toolbar The toolbar element.
 * @param {HistoryCtx} ctx Render context.
 * @returns {void}
 */
function appendResourcesViewerIfReady(toolbar, ctx) {
  if (ctx.chartMod && typeof ctx.chartMod.collectResourceCivOptions === "function") {
    const opts = ctx.chartMod.collectResourceCivOptions(ctx.history);
    appendViewerDropdown(toolbar, opts, ctx.resourcesViewerPid, ctx.setResourcesViewerPid);
  }
}

/**
 * Build and append the chart toolbar: per-metric viewer controls, focus-clear,
 * time-units toggle, wonders toggle, and the CSV button group.
 * @param {HTMLElement} host The view host element.
 * @param {HistoryCtx} ctx Render context.
 * @param {string} activeMetric Active metric id.
 * @returns {void}
 */
export function buildToolbar(host, ctx, activeMetric) {
  const toolbar = document.createElement("div");
  toolbar.className = "demographics-chart-toolbar";

  appendMetricSpecificControls(toolbar, ctx, activeMetric);
  appendClearFocus(toolbar, ctx);
  appendTimeUnitsToggle(toolbar, ctx);
  appendWondersToggle(toolbar, ctx, activeMetric);
  appendCsvControls(toolbar, host, ctx);

  host.appendChild(toolbar);
}
