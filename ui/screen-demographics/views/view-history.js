// view-history.js
//
// "Historical Data" view: a paginated metric tab bar, the chart, and the
// per-civ legend. Mirrors the layout of the V5 main historical-graphs
// panel — three metric pages plus the chart.js renderer.
//
// The page list keeps placeholders for metrics that aren't wired up yet
// (milpower, wonders); those render as disabled tabs labelled "Not yet
// implemented".

import { METRICS, getMetric } from "/demographics/ui/demographics-metrics.js";
import { safePlaySound, playActivate } from "/demographics/ui/demographics-audio.js";
import { makeClickable } from "/demographics/ui/demographics-a11y.js";
import { getPalette } from "/demographics/ui/demographics-palette.js";

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
 * A single time-range filter pill definition.
 * @typedef {Object} TimeFilterDef
 * @property {string} id Stable filter id ("25", "age", "all", ...).
 * @property {string} label Pill caption.
 * @property {boolean} [disabled] When true the pill renders greyed/non-clickable.
 */

/**
 * Inclusive turn window the chart clamps to, or null for the full domain.
 * @typedef {Object} TurnRange
 * @property {number} min First turn shown.
 * @property {number} max Last turn shown.
 */

/**
 * Options for {@link buildMetricInfoCaption}.
 * @typedef {Object} MetricInfoOpts
 * @property {string} triggerText Visible caption-trigger text.
 * @property {string} title Popover heading.
 * @property {string} bodyHtml Popover body as an HTML string.
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

const DBG = true;
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
function metricExists(id) {
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
 * Build and append the page-level tab bar (the row of metric-group tabs).
 * @param {HTMLElement} host The view host element.
 * @param {HistoryCtx} ctx Render context.
 * @param {string} activePage Resolved active page id.
 * @returns {void}
 */
function buildPageTabRow(host, ctx, activePage) {
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
    /* */
  }
}

/**
 * Build and append the metric tab bar for `page`.
 * @param {HTMLElement} host The view host element.
 * @param {HistoryCtx} ctx Render context.
 * @param {PageDef} page The active page.
 * @param {string} activeMetric Resolved active metric id.
 * @returns {void}
 */
function buildMetricTabRow(host, ctx, page, activeMetric) {
  const metricHost = document.createElement("div");
  metricHost.className = "demographics-tab-bar-host w-full";
  host.appendChild(metricHost);

  const metricBar = document.createElement("fxs-tab-bar");
  metricBar.classList.add("demographics-tabs", "w-full", "font-title", "text-sm");
  metricBar.setAttribute("data-audio-group-ref", "audio-screen-unlocks");
  metricBar.setAttribute("tab-item-class", "font-title text-base");
  const metricTabs = page.metrics.map((mid) => {
    const exists = metricExists(mid);
    return {
      id: mid,
      label: exists ? "LOC_DEMOGRAPHICS_METRIC_" + mid.toUpperCase() : "LOC_DEMOGRAPHICS_NYI"
    };
  });
  metricBar.setAttribute("tab-items", JSON.stringify(metricTabs));

  const mIdx = Math.max(
    0,
    page.metrics.findIndex((m) => m === activeMetric)
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
function buildChartTitle(host, activeMetric, metricObj, synthMeta) {
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
    sub.className = "demographics-chart-subtitle font-body text-sm";
    sub.textContent = synthMeta.subtitle;
    sub.style.cssText =
      "text-align:center;color:#c2c4cc;" +
      "font-style:italic;margin-top:-0.15rem;margin-bottom:0.35rem;" +
      "letter-spacing:0.04em;";
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
function appendMetricCaptions(host, activeMetric) {
  if (activeMetric === "gdp") {
    host.appendChild(buildMetricInfoCaption(GDP_CAPTION));
  }
  if (activeMetric === "approval") {
    host.appendChild(buildMetricInfoCaption(APPROVAL_CAPTION));
  }
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
      pill.style.opacity = "0.4";
      pill.style.cursor = "not-allowed";
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
  } catch (_) {}
  if (!modes.includes(mode)) mode = "both";
  try {
    ctx.chartMod?.setXAxisMode?.(mode);
  } catch (_) {}
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
    } catch (_) {}
    try {
      ctx.chartMod?.setXAxisMode?.(next);
    } catch (_) {}
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
    wondersBtn.style.color = "#c0a875";
  }
  makeClickable(wondersBtn, (ev) => {
    ev?.stopPropagation?.();
    safePlaySound("data-audio-activate", "options");
    try {
      const next = !ctx.settings?.getSetting?.("showWonderMarkers", true);
      ctx.settings?.setSetting?.("showWonderMarkers", next);
      dlog("wonders toggle clicked; new value=" + next);
    } catch (_) {
      /* */
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
  tip.className = "img-tooltip-border img-tooltip-bg";
  tip.style.cssText = [
    "position:absolute",
    "right:0",
    "top:1.9rem",
    "width:36rem",
    "max-width:92vw",
    "padding:1.1rem 1.3rem 1.1rem",
    "font-family:BodyFont, sans-serif",
    "font-size:0.95rem",
    "line-height:1.5",
    "color:#d6d8dc",
    "text-align:left",
    "white-space:normal",
    "word-wrap:break-word",
    "overflow-wrap:break-word",
    "pointer-events:none",
    "opacity:0",
    "transition:opacity 0.1s",
    "z-index:50",
    "box-sizing:border-box"
  ].join(";");
  const HDR =
    "color:#f3c34c;font-family:TitleFont, BodyFont, sans-serif;" +
    "font-weight:700;text-transform:uppercase;letter-spacing:0.08em;" +
    "font-size:1.05rem;margin-bottom:0.65rem;padding-bottom:0.4rem;" +
    "border-bottom:1px solid rgba(201,162,76,0.55);";
  tip.innerHTML =
    `<div style="${HDR}">Copy as CSV</div>` +
    `<p style="margin:0 0 0.6rem;">Copies every sampled turn for every civ to your clipboard. Paste into Excel, Sheets, or save as <code>.csv</code>. Civ&nbsp;7's UI sandbox has no file-write API, so the clipboard is the only hand-off.</p>` +
    `<p style="margin:0;color:#f3c34c;font-weight:700;">See "About" Tab for more information</p>`;
  return tip;
}

/**
 * Build the CSV info icon — a native info BLP with a custom hover popover
 * (Coherent doesn't reliably render multi-line native `title` attrs).
 * @returns {HTMLElement} The info-icon element.
 */
function buildCsvInfoIcon() {
  const el = document.createElement("div");
  el.className = "demographics-chart-toolbar-info";
  el.style.cssText = [
    "display:block",
    "flex:0 0 1.3rem",
    "width:1.3rem",
    "height:1.3rem",
    // Native info BLP — same icon Civ7 uses for tooltips / civilopedia.
    "background-image:url('blp:icon_info')",
    "background-size:contain",
    "background-position:center",
    "background-repeat:no-repeat",
    "cursor:help",
    "user-select:none",
    "position:relative",
    "opacity:0.75",
    "transition:opacity 0.12s"
  ].join(";");
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
  csvGroup.style.cssText = [
    "display:flex",
    "flex-direction:row",
    "flex-wrap:nowrap",
    "align-items:center",
    "gap:0.35rem",
    "flex:0 0 auto"
  ].join(";");
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
function buildToolbar(host, ctx, activeMetric) {
  const toolbar = document.createElement("div");
  toolbar.className = "demographics-chart-toolbar";

  appendMetricSpecificControls(toolbar, ctx, activeMetric);
  appendClearFocus(toolbar, ctx);
  appendTimeUnitsToggle(toolbar, ctx);
  appendWondersToggle(toolbar, ctx, activeMetric);
  appendCsvControls(toolbar, host, ctx);

  host.appendChild(toolbar);
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
  wrap.className = "demographics-metric-info";
  wrap.style.position = "relative";
  wrap.style.textAlign = "center";
  // Caption now lives between title and filter row — center on the full
  // host width (no asymmetric padding needed; nothing to align with).
  wrap.style.margin = "0.1rem 0 0.25rem 0";

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

// ─── Time-range filter helpers ──────────────────────────────────────────────
// Each filter resolves to a {min, max} turn range that the chart clamps to.
// "all" returns null (chart uses its natural full domain).

/** @type {TimeFilterDef[]} */
const TIME_FILTERS = [
  { id: "25", label: "25y" },
  { id: "50", label: "50y" },
  { id: "100", label: "100y" },
  { id: "300", label: "300y" },
  { id: "500", label: "500y" },
  { id: "1000", label: "1000y" },
  { id: "age", label: "Current Age" },
  { id: "age1", label: "1st Age", disabled: true },
  { id: "age2", label: "2nd Age", disabled: true },
  { id: "age3", label: "3rd Age", disabled: true },
  { id: "all", label: "All Time", disabled: true }
];

/**
 * Cross-age filter tooltip content. Structured so the renderer can lay it out
 * as proper HTML (clean sections, mixed-case headings) rather than a wall of
 * monospace text. One place to edit if/when the engine constraint changes.
 * @type {{ title: string, body: string }}
 */
const CROSS_AGE_DISABLED_TOOLTIP = {
  title: "Cross-Age Graphs Unavailable",
  body:
    '<p style="margin:0 0 0.6rem;">A single graph spanning <b style="color:#f3e7c4;">Antiquity, Exploration, and Modern</b> isn\'t possible. Civ&nbsp;7 wipes every storage channel a mod could use to carry sampled history across an age transition, so each age can only graph its own data. Use <b style="color:#f3e7c4;">Current&nbsp;Age</b> or any year-range filter instead.</p>' +
    '<p style="margin:0;color:#f3c34c;font-weight:700;">See "About" Tab for more information</p>'
};

/**
 * Parse "2375 BCE" → -2375 ; "300 CE" → 300 ; "1450" (no era) → 1450.
 * @param {*} s The game-year string.
 * @returns {number|undefined} Signed year, or undefined when unparseable.
 */
function parseGameYear(s) {
  if (typeof s !== "string") return undefined;
  const m = s.match(/(-?\d+)\s*(BCE|BC|AD|CE)?/i);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  if (!isFinite(n)) return undefined;
  const era = (m[2] || "").toUpperCase();
  return era === "BCE" || era === "BC" ? -n : n;
}

/**
 * Build a turn → signed-year map from the history's samples.
 * @param {DemoHistory|undefined} history The persisted history blob.
 * @returns {Map<number, number>} Turn-to-year lookup.
 */
function buildTurnYearMap(history) {
  /** @type {Map<number, number>} */
  const m = new Map();
  const samps = history && Array.isArray(history.samples) ? history.samples : [];
  for (const s of samps) {
    if (s && typeof s.turn === "number" && typeof s.gameYear === "string") {
      const y = parseGameYear(s.gameYear);
      if (typeof y === "number") m.set(s.turn, y);
    }
  }
  return m;
}

/**
 * Resolve the start turn of the current age from the history's age boundaries,
 * or `firstTurn` when none are recorded.
 * @param {DemoHistory|undefined} history The persisted history blob.
 * @param {number} firstTurn First sampled turn (fallback).
 * @returns {number} Start turn of the current age.
 */
function currentAgeStartTurn(history, firstTurn) {
  const bounds =
    history && Array.isArray(history.ageBoundaries)
      ? history.ageBoundaries.slice().sort((a, b) => (a.turn || 0) - (b.turn || 0))
      : [];
  if (bounds.length === 0) return firstTurn;
  return bounds[bounds.length - 1].turn;
}

/**
 * Compute the turn window for a year-relative filter (25/50/100/...), clamped
 * so it never reaches back past the start of the current age.
 * @param {DemoHistory|undefined} history The persisted history blob.
 * @param {Snapshot[]} samps Sorted samples.
 * @param {number} span Year span requested.
 * @param {number} firstTurn First sampled turn.
 * @param {number} lastTurn Last sampled turn.
 * @returns {TurnRange|null} The window, or null when no year data exists.
 */
function computeYearRelativeRange(history, samps, span, firstTurn, lastTurn) {
  const turnYear = buildTurnYearMap(history);
  if (turnYear.size === 0) return null;
  const latestYear = turnYear.get(lastTurn) ?? Array.from(turnYear.values()).pop();
  const cutoff = /** @type {number} */ (latestYear) - span;
  // Find the earliest turn whose year >= cutoff.
  let minTurn = lastTurn;
  for (const s of samps) {
    const y = turnYear.get(/** @type {number} */ (s.turn));
    if (typeof y === "number" && y >= cutoff) {
      minTurn = /** @type {number} */ (s.turn);
      break;
    }
  }
  // Don't reach back further than the start of the current age. If
  // the requested span pre-dates the latest age boundary, clamp the
  // range to "Current Age" (start-of-age → now) so the chart doesn't
  // mix in stale pre-age data the user didn't ask for.
  const ageStart = currentAgeStartTurn(history, firstTurn);
  if (minTurn < ageStart) minTurn = ageStart;
  return { min: minTurn, max: lastTurn };
}

/**
 * Compute the turn window for a named age filter ("age", "age1"..."age3")
 * from the history's age boundaries.
 * @param {DemoHistory|undefined} history The persisted history blob.
 * @param {string} filterId The age filter id.
 * @param {number} firstTurn First sampled turn.
 * @param {number} lastTurn Last sampled turn.
 * @returns {TurnRange|null} The window, or null for an unknown filter.
 */
function computeAgeRange(history, filterId, firstTurn, lastTurn) {
  // Age filters use history.ageBoundaries: [{turn, age}, ...]
  const bounds =
    history && Array.isArray(history.ageBoundaries)
      ? history.ageBoundaries.slice().sort((a, b) => (a.turn || 0) - (b.turn || 0))
      : [];
  /**
   * Resolve the [start, end] window for the age at boundary index `idx`.
   * @param {number} idx Zero-based age index.
   * @returns {TurnRange|null} The age's window, or null when `idx` < 0.
   */
  function ageRange(idx) {
    if (idx < 0) return null;
    const start = idx === 0 ? firstTurn : bounds[idx - 1]?.turn || firstTurn;
    // If this is the last known age, max = lastTurn; else next boundary - 1.
    const next = bounds[idx];
    const end = next ? next.turn - 1 : lastTurn;
    return { min: start, max: end };
  }
  if (filterId === "age1") return ageRange(0);
  if (filterId === "age2") return ageRange(1);
  if (filterId === "age3") return ageRange(2);
  if (filterId === "age") {
    // Current age: from the LAST recorded boundary turn → lastTurn.
    if (bounds.length === 0) return { min: firstTurn, max: lastTurn };
    const last = bounds[bounds.length - 1];
    return { min: last.turn, max: lastTurn };
  }
  return null;
}

/**
 * Resolve a filter id to an inclusive {min, max} turn range, or null for
 * "show everything".
 * @param {DemoHistory|undefined} history The persisted history blob.
 * @param {string} filterId The active filter id.
 * @returns {TurnRange|null} The clamped window, or null for the full domain.
 */
export function computeTurnRange(history, filterId) {
  if (!filterId || filterId === "all") return null;
  const samps = history && Array.isArray(history.samples) ? history.samples : [];
  if (samps.length === 0) return null;
  const lastTurn = /** @type {number} */ (samps[samps.length - 1].turn);
  const firstTurn = /** @type {number} */ (samps[0].turn);
  // Year-relative filters (25/50/100/300/500/1000 years).
  if (/^\d+$/.test(filterId)) {
    const span = parseInt(filterId, 10);
    return computeYearRelativeRange(history, samps, span, firstTurn, lastTurn);
  }
  return computeAgeRange(history, filterId, firstTurn, lastTurn);
}

/**
 * Nudge `tip` back into the viewport via a translate transform when any edge
 * overflows; clear the transform when it fits.
 * @param {HTMLElement} tip The tooltip element.
 * @returns {void}
 */
function repositionTooltip(tip) {
  if (!tip.parentElement) return;
  const rect = tip.getBoundingClientRect();
  const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
  const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
  const dx = overflowShift(rect.left, rect.right, vw);
  const dy = overflowShift(rect.top, rect.bottom, vh);
  if (dx !== 0 || dy !== 0) {
    tip.style.transform = `translate(${dx}px, ${dy}px)`;
  } else {
    tip.style.transform = "";
  }
}

/**
 * Compute the translate delta along one axis that brings a [near, far] span
 * back inside the [0, extent] viewport, with an 8px margin. Far-edge overflow
 * takes precedence over near-edge.
 * @param {number} near Leading edge coordinate (left or top).
 * @param {number} far Trailing edge coordinate (right or bottom).
 * @param {number} extent Viewport size along this axis.
 * @returns {number} The shift in pixels (0 when it already fits).
 */
function overflowShift(near, far, extent) {
  if (far > extent) return extent - far - 8;
  if (near < 0) return -near + 8;
  return 0;
}

/**
 * Attach the cross-age "why is this disabled?" tooltip to a pill. Mirrors the
 * CSV info-icon pattern: an absolutely-positioned <div> child of the pill,
 * styled with the engine's tooltip chrome, toggled on mouseenter / mouseleave.
 * Coherent GameFace ignores the native `title` attribute, so we render the
 * structured CROSS_AGE_DISABLED_TOOLTIP content as proper HTML.
 * @param {HTMLElement} pill The disabled filter pill.
 * @returns {void}
 */
function attachDisabledFilterTooltip(pill) {
  const tip = buildDisabledFilterTooltipEl();

  // Ensure tooltip never overflows the viewport
  tip.addEventListener("transitionend", () => repositionTooltip(tip));
  tip.addEventListener("mouseenter", () => repositionTooltip(tip));

  pill.appendChild(tip);
  pill.addEventListener("mouseenter", () => {
    tip.style.opacity = "1";
  });
  pill.addEventListener("mouseleave", () => {
    tip.style.opacity = "0";
  });
}

/**
 * Build the cross-age disabled-filter tooltip element (chrome + title + body),
 * initially transparent. Content from CROSS_AGE_DISABLED_TOOLTIP.
 * @returns {HTMLElement} The tooltip element.
 */
function buildDisabledFilterTooltipEl() {
  const t = CROSS_AGE_DISABLED_TOOLTIP;

  const tip = document.createElement("div");
  tip.className = "img-tooltip-border img-tooltip-bg";
  tip.style.cssText = [
    "position:absolute",
    "left:0",
    "top:1.9rem",
    "width:38rem",
    "max-width:92vw",
    "padding:1.1rem 1.3rem 1.1rem",
    "font-family:BodyFont, sans-serif",
    "font-size:0.95rem",
    "line-height:1.5",
    "color:#d6d8dc",
    "text-align:left",
    "white-space:normal",
    "word-wrap:break-word",
    "overflow-wrap:break-word",
    "pointer-events:none",
    "opacity:0",
    "transition:opacity 0.1s",
    "z-index:50",
    "box-sizing:border-box"
  ].join(";");

  const title = document.createElement("div");
  title.style.cssText = [
    "color:#f3c34c",
    "font-family:TitleFont, BodyFont, sans-serif",
    "font-weight:700",
    "font-size:1.05rem",
    "letter-spacing:0.08em",
    "text-transform:uppercase",
    "margin-bottom:0.65rem",
    "padding-bottom:0.4rem",
    "border-bottom:1px solid rgba(201,162,76,0.55)"
  ].join(";");
  title.textContent = t.title;
  tip.appendChild(title);

  const body = document.createElement("div");
  body.style.cssText = "color:#d6d8dc;";
  body.innerHTML = t.body;
  tip.appendChild(body);

  return tip;
}

/**
 * Build a disabled (greyed, non-clickable) filter pill carrying the cross-age
 * tooltip. Clicks are swallowed so audio + selection never fire.
 * @param {TimeFilterDef} f The filter definition.
 * @returns {HTMLElement} The disabled pill element.
 */
function buildDisabledFilterPill(f) {
  const pill = document.createElement("div");
  pill.className = "demographics-chart-time-filter-pill";
  pill.classList.add("is-disabled");
  // Visual greying via color / border alpha rather than CSS
  // `opacity`. Opacity compounds onto children, which would
  // dim the disabled-filter tooltip below to the point of
  // illegibility; muting the foreground colors instead leaves
  // the tooltip free to render at full strength.
  pill.style.color = "rgba(194, 196, 204, 0.45)";
  pill.style.borderColor = "rgba(168, 132, 90, 0.25)";
  pill.style.background = "rgba(20, 16, 10, 0.35)";
  pill.style.cursor = "not-allowed";
  pill.style.pointerEvents = "auto"; // keep tooltip on hover
  pill.style.position = "relative";
  pill.textContent = f.label;
  attachDisabledFilterTooltip(pill);
  // Swallow clicks so audio + selection don't fire.
  pill.addEventListener("click", (ev) => {
    ev?.stopPropagation?.();
    ev?.preventDefault?.();
  });
  return pill;
}

/**
 * Build an enabled filter pill wired to `onSelect`, marked active when its id
 * matches `activeFilter`.
 * @param {TimeFilterDef} f The filter definition.
 * @param {string} activeFilter Currently active filter id.
 * @param {(id: string) => void} [onSelect] Selection callback.
 * @returns {HTMLElement} The pill element.
 */
function buildEnabledFilterPill(f, activeFilter, onSelect) {
  const pill = document.createElement("div");
  pill.className = "demographics-chart-time-filter-pill";
  if (f.id === activeFilter) pill.classList.add("is-active");
  pill.textContent = f.label;
  pill.title = f.label + " filter";
  makeClickable(pill, (ev) => {
    ev?.stopPropagation?.();
    playActivate();
    dlog("time-filter click id=" + f.id);
    if (typeof onSelect === "function") onSelect(f.id);
  });
  return pill;
}

/**
 * Build the pill row of time-range filter buttons. Same single-div pattern that
 * works in view-relations.js — class + textContent + click handler. Persists
 * the active filter via `onSelect` (round-trips through settings). Filters
 * flagged `disabled` render greyed and non-clickable with a custom HTML tooltip
 * (Coherent ignores native `title`).
 * @param {string} activeFilter Currently active filter id.
 * @param {(id: string) => void} onSelect Called with the chosen filter id.
 * @returns {HTMLElement} The filter-row element.
 */
export function buildTimeFilterRow(activeFilter, onSelect) {
  const row = document.createElement("div");
  row.className = "demographics-chart-time-filter-row font-body text-xs";
  // Row needs to be the positioning context for absolutely-placed
  // tooltips on disabled pills (the pill itself is a flex child and
  // its own bounds are too narrow for a multi-line tooltip).
  row.style.position = "relative";
  for (const f of TIME_FILTERS) {
    const pill = f.disabled
      ? buildDisabledFilterPill(f)
      : buildEnabledFilterPill(f, activeFilter, onSelect);
    row.appendChild(pill);
  }
  return row;
}

// ─── CSV export ─────────────────────────────────────────────────────────────
// Dumps history.samples to a flat CSV with one row per (turn, pid) and one
// column per metric. Coherent GameFace doesn't expose `URL.createObjectURL`
// or `<a download>`, so we route through the engine's `UI.setClipboardText`
// (cite: base-standard/ui-next/screens/pause-menu/pause-menu-model.js:258,
//  269 — the pause menu uses this for the map seed). When clipboard isn't
// available, we fall back to writing the CSV to UI.log so it's still
// recoverable.
//
// Either path now ends with a VISIBLE toast on the screen so the user sees
// confirmation — the previous version succeeded silently and looked broken.

/**
 * Show a transient toast in `host`, auto-removing after 4s. Replaces any prior
 * toast first.
 * @param {HTMLElement} host The view host element.
 * @param {string} message Toast text.
 * @param {boolean} success Green (success) vs orange (failure) styling.
 * @returns {void}
 */
function showCsvToast(host, message, success) {
  // Remove any prior toast first.
  try {
    const old = host.querySelector(".demographics-csv-toast");
    if (old) old.remove();
  } catch (_) {
    /* */
  }
  const toast = document.createElement("div");
  toast.className = "demographics-csv-toast";
  toast.style.cssText = [
    "position:fixed",
    "top:6rem",
    "left:50%",
    "transform:translateX(-50%)",
    "z-index:200",
    "padding:0.6rem 1.1rem",
    "border-radius:0.25rem",
    "border:1px solid " + (success ? "rgba(73,209,130,0.7)" : "rgba(213,94,0,0.7)"),
    "background:rgba(20, 16, 10, 0.92)",
    "color:" + (success ? "#49d182" : "#D55E00"),
    "font-family:TitleFont, BodyFont, sans-serif",
    "font-size:0.9rem",
    "font-weight:700",
    "text-transform:uppercase",
    "letter-spacing:0.08em",
    "box-shadow:0 0 1rem rgba(0,0,0,0.6)",
    "pointer-events:none"
  ].join(";");
  toast.textContent = message;
  host.appendChild(toast);
  setTimeout(() => {
    try {
      toast.remove();
    } catch (_) {}
  }, 4000);
}

/**
 * Columns ordered SEMANTICALLY by category so related metrics sit next to each
 * other in a spreadsheet (was alphabetical — score next to settlements made no
 * sense). Identity first, then highest-level signal (score), economy, yields,
 * military, science/culture, infrastructure, triumphs, resources, age systems.
 * Anything uncategorised falls into a tail bucket so new metrics are never
 * silently dropped.
 * @type {Record<string, string[]>}
 */
const CSV_CATEGORY_ORDER = {
  score: ["score"],
  economy: ["gdp", "gold", "gpt", "trade", "deals"],
  yields: ["production", "crops", "culture_yield", "science_yield", "influence", "hpt", "approval"],
  military: ["milpower"],
  knowledge: ["techs", "civics", "wonders"],
  empire: ["population", "land", "settlements", "settlement_cap_pct"],
  triumphs: [
    "triumphs_cultural",
    "triumphs_diplomatic",
    "triumphs_economic",
    "triumphs_expansionist",
    "triumphs_militaristic",
    "triumphs_scientific"
  ],
  resources: [
    "resources_total",
    "resources_empire",
    "resources_city",
    "resources_factory",
    "resources_bonus",
    "resources_treasure"
  ],
  age: ["age_progress", "crisis_stage"]
};

/**
 * Collect every metric id seen across all samples so the column set is stable.
 * @param {DemoHistory} history The persisted history blob.
 * @returns {Set<string>} The set of metric ids.
 */
function collectMetricKeys(history) {
  /** @type {Set<string>} */
  const metricKeys = new Set();
  for (const s of history.samples) {
    if (!s?.players) continue;
    for (const pid of Object.keys(s.players)) {
      const m = s.players[pid]?.metrics;
      if (!m) continue;
      for (const k of Object.keys(m)) metricKeys.add(k);
    }
  }
  return metricKeys;
}

/**
 * Order the seen metric keys by category, then append any uncategorised keys
 * alphabetically so newly-introduced metrics survive.
 * @param {Set<string>} metricKeys The set of seen metric ids.
 * @returns {string[]} The ordered metric column list.
 */
function orderMetricColumns(metricKeys) {
  /** @type {string[]} */
  const orderedMetricCols = [];
  /** @type {Set<string>} */
  const seen = new Set();
  for (const cat of Object.keys(CSV_CATEGORY_ORDER)) {
    for (const k of CSV_CATEGORY_ORDER[cat]) {
      if (metricKeys.has(k) && !seen.has(k)) {
        orderedMetricCols.push(k);
        seen.add(k);
      }
    }
  }
  // Tail: anything in metricKeys that the category map didn't claim,
  // appended in alphabetical order so newly-introduced metrics survive.
  for (const k of Array.from(metricKeys).sort()) {
    if (!seen.has(k)) {
      orderedMetricCols.push(k);
      seen.add(k);
    }
  }
  return orderedMetricCols;
}

/**
 * Quote a CSV cell when it contains a comma, quote, or newline.
 * @param {*} v The cell value.
 * @returns {string} The CSV-safe cell.
 */
function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/**
 * Format a number to remove floating-point noise. Integers stay integer; floats
 * round to 2 decimals; values ≥1000 round to integers (drops 50+% of file size
 * and makes the data readable in a spreadsheet).
 * @param {*} v The numeric value.
 * @returns {string} The formatted number, or "" for non-finite input.
 */
function fmtNum(v) {
  if (typeof v !== "number" || !isFinite(v)) return "";
  if (Number.isInteger(v)) return String(v);
  if (Math.abs(v) >= 1000) return String(Math.round(v));
  return String(Math.round(v * 100) / 100);
}

/**
 * Build & DEDUPLICATE CSV rows by (turn, pid). The sampler can fire twice per
 * turn under certain engine event ordering; last-write-wins so the latest
 * snapshot for each (turn, pid) is preserved.
 * @param {DemoHistory} history The persisted history blob.
 * @param {string[]} metricCols Ordered metric column ids.
 * @returns {Map<string, string[]>} Map of "turn:pid" → cell array.
 */
function buildCsvRowMap(history, metricCols) {
  /** @type {Map<string, string[]>} */
  const rowByKey = new Map();
  for (const s of history.samples) {
    if (!s?.players) continue;
    for (const pid of Object.keys(s.players)) {
      const cells = buildCsvRowCells(s, pid, s.players[pid], metricCols);
      rowByKey.set(s.turn + ":" + pid, cells);
    }
  }
  return rowByKey;
}

/**
 * Build the ordered cell array for one (turn, pid) CSV row: the seven identity
 * columns followed by one formatted value per metric column.
 * @param {Snapshot} s The sample row.
 * @param {string} pid The player id key.
 * @param {CivSample} ps The per-civ sample.
 * @param {string[]} metricCols Ordered metric column ids.
 * @returns {string[]} The row's cell array.
 */
function buildCsvRowCells(s, pid, ps, metricCols) {
  const cells = [
    csvCell(s.turn),
    csvCell(s.gameYear || ""),
    csvCell(pid),
    csvCell(ps.leaderName || ""),
    csvCell(ps.civName || ""),
    csvCell(ps.civTypeString || ""),
    csvCell(ps.met)
  ];
  for (const k of metricCols) {
    cells.push(fmtNum(ps.metrics?.[k]));
  }
  return cells;
}

/**
 * Read the current game's speed / map / age for the CSV provenance header.
 * Each lookup is best-effort and defaults to "unknown".
 * @returns {{ gameSpeed: string, mapType: string, currentAge: string }} Context.
 */
function readCsvGameContext() {
  return {
    gameSpeed: readGameSpeedLabel(),
    mapType: readMapTypeLabel(),
    currentAge: readCurrentAgeLabel()
  };
}

/**
 * Best-effort read of the current game-speed label for the CSV header.
 * @returns {string} The lowercased speed type, or "unknown".
 */
function readGameSpeedLabel() {
  try {
    if (typeof Configuration === "undefined" || !Configuration.getGame) return "unknown";
    const speedHash = Configuration.getGame()?.getValue?.("GameSpeed");
    return gameSpeedLabelFor(speedHash);
  } catch (_) {
    return "unknown";
  }
}

/**
 * Resolve a GameSpeed hash to its lowercased speed-type label via GameInfo.
 * @param {*} speedHash The GameSpeed config hash.
 * @returns {string} The lowercased speed type, or "unknown".
 */
function gameSpeedLabelFor(speedHash) {
  if (speedHash == null || typeof GameInfo === "undefined") return "unknown";
  const row = GameInfo.GameSpeeds?.lookup?.(speedHash);
  if (row?.GameSpeedType) return row.GameSpeedType.replace(/^GAMESPEED_/, "").toLowerCase();
  return "unknown";
}

/**
 * Best-effort read of the current map-script label for the CSV header.
 * @returns {string} The map script string, or "unknown".
 */
function readMapTypeLabel() {
  try {
    if (typeof Configuration !== "undefined" && Configuration.getMap) {
      const m = Configuration.getMap();
      const ms = m?.mapScript;
      if (typeof ms === "string") return ms;
    }
  } catch (_) {
    /* */
  }
  return "unknown";
}

/**
 * Best-effort read of the current age label for the CSV header.
 * @returns {string} The lowercased age type, or "unknown".
 */
function readCurrentAgeLabel() {
  try {
    if (typeof Game !== "undefined" && Game.age != null) {
      const ageRow = GameInfo.Ages?.lookup?.(Game.age);
      if (ageRow?.AgeType) return ageRow.AgeType.replace(/^AGE_/, "").toLowerCase();
    }
  } catch (_) {
    /* */
  }
  return "unknown";
}

/**
 * Build the `#`-prefixed metadata header lines (provenance + game context) that
 * lead the CSV. Most importers honor `#` lines as comments.
 * @param {DemoHistory} history The persisted history blob.
 * @param {Map<string, string[]>} rowByKey Built row map (for counts).
 * @param {string[]} metricCols Ordered metric column ids.
 * @returns {string[]} The metadata header lines (excluding the column header).
 */
function buildCsvMetaHeader(history, rowByKey, metricCols) {
  const metaTime = new Date().toISOString();
  const lastSample = history.samples[history.samples.length - 1];
  const firstSample = history.samples[0];
  const turnsCovered = (lastSample?.turn || 0) - (firstSample?.turn || 0) + 1;
  const { gameSpeed, mapType, currentAge } = readCsvGameContext();
  const civCount = Array.from(rowByKey.keys()).reduce(
    (s, k) => s.add(k.split(":")[1]),
    /** @type {Set<string>} */ (new Set())
  ).size;
  /** @type {string[]} */
  const lines = [];
  // Lead the file with a UTF-8 BOM so Excel on Windows/macOS auto-detects
  // the encoding — without it, "Hawai'i" / "José" / "Sayyida" import as
  // mojibake. Standard byte sequence: U+FEFF (3 UTF-8 bytes).
  lines.push("﻿# === Demographics CSV export ===");
  lines.push("# Mod: Demographics v1.0.0");
  lines.push("# Exported: " + metaTime);
  lines.push("# Game speed: " + gameSpeed + " · Map: " + mapType + " · Current age: " + currentAge);
  lines.push(
    "# Coverage: turns " +
      (firstSample?.turn || 0) +
      "→" +
      (lastSample?.turn || 0) +
      " (" +
      turnsCovered +
      " turns)" +
      " · " +
      civCount +
      " civilizations · " +
      rowByKey.size +
      " rows · " +
      metricCols.length +
      " metrics"
  );
  lines.push("# Format: integers exact, floats <1000 → 2 dp, ≥1000 → integer");
  lines.push("# Sorting: deduplicated by (turn, pid); sorted ascending");
  lines.push(
    "# Columns grouped by category: identity → score → economy → yields → military → knowledge → empire → triumphs → resources → age"
  );
  lines.push("#");
  return lines;
}

/**
 * Write `csv` to the clipboard via the engine's `UI.setClipboardText`, gated by
 * `UI.isClipboardAvailable()` where present (cite: pause-menu-model.js:268).
 * @param {string} csv The full CSV text.
 * @returns {boolean} True when the clipboard write succeeded.
 */
function writeCsvToClipboard(csv) {
  let clipboardOk = false;
  try {
    if (
      typeof UI !== "undefined" &&
      typeof UI.isClipboardAvailable === "function" &&
      UI.isClipboardAvailable() &&
      typeof UI.setClipboardText === "function"
    ) {
      UI.setClipboardText(csv);
      clipboardOk = true;
    } else if (typeof UI !== "undefined" && typeof UI.setClipboardText === "function") {
      // Older Civ7 builds didn't ship isClipboardAvailable() — try anyway.
      UI.setClipboardText(csv);
      clipboardOk = true;
    }
  } catch (e) {
    derr("CSV export: clipboard write threw:", /** @type {*} */ (e)?.message);
  }
  return clipboardOk;
}

/**
 * Export `history.samples` to a flat CSV (one row per turn/pid, one column per
 * metric) and hand it to the player via the clipboard, with a UI.log fallback
 * and a visible confirmation toast. No-op (with a toast) when there are no
 * samples; refuses oversized exports that would crash the clipboard bridge.
 * @param {DemoHistory|undefined} history The persisted history blob.
 * @param {HTMLElement} [host] Host for the confirmation toast.
 * @returns {void}
 */
export function exportHistoryAsCsv(history, host) {
  if (!history || !Array.isArray(history.samples) || history.samples.length === 0) {
    dlog("CSV export: no samples to write");
    if (host) showCsvToast(host, "No samples yet — play a turn first.", false);
    return;
  }
  const { csv, lines, headers } = buildCsvDocument(history);

  // ── Size guard ──────────────────────────────────────────────────────
  // Above ~5 MB the clipboard write can fail silently and the log dump
  // stalls the engine for several seconds. Above ~15 MB we've seen the
  // Coherent IPC bridge actually drop the call. Tiered handling:
  //   < 2 MB  → normal flow, clipboard + log
  //   2-8 MB  → clipboard yes, log summary only (no full dump)
  //   > 8 MB  → refuse, tell user to lower sample cap + retry
  const sizeMB = (csv.length / (1024 * 1024)).toFixed(1);
  if (csv.length > CSV_HARD_LIMIT) {
    refuseOversizedCsv(host, sizeMB);
    return;
  }

  // Step 1: try clipboard. UI.isClipboardAvailable() is the canonical gate
  // (cite: pause-menu-model.js:268).
  const clipboardOk = writeCsvToClipboard(csv);

  // Step 2: dump to UI.log as a recoverable fallback.
  logCsvDump(csv, lines.length, sizeMB, clipboardOk);

  // Step 3: visible toast confirmation.
  showCsvResultToast(host, csv, lines.length, headers.length, sizeMB, clipboardOk);

  dlog(
    "CSV export complete; clipboard=" +
      clipboardOk +
      " rows=" +
      lines.length +
      " chars=" +
      csv.length
  );
}

/** Soft size threshold above which the full CSV log dump is skipped. */
const CSV_SOFT_LIMIT = 2 * 1024 * 1024;
/** Hard size threshold above which the export is refused outright. */
const CSV_HARD_LIMIT = 8 * 1024 * 1024;

/**
 * Build the full CSV document for `history`: collect + order columns, build the
 * deduplicated rows, prepend the metadata header, and join into one string.
 * @param {DemoHistory} history The persisted history blob.
 * @returns {{ csv: string, lines: string[], headers: string[] }} The CSV text,
 *   its line array, and the column-header array.
 */
function buildCsvDocument(history) {
  // Collect every metric ID we've ever seen so columns are stable.
  const metricKeys = collectMetricKeys(history);
  const metricCols = orderMetricColumns(metricKeys);
  const headers = [
    "turn",
    "gameYear",
    "pid",
    "leaderName",
    "civName",
    "civType",
    "met",
    ...metricCols
  ];
  const rowByKey = buildCsvRowMap(history, metricCols);
  // Emit sorted by (turn ASC, pid ASC) for predictable spreadsheet order.
  const sortedKeys = Array.from(rowByKey.keys()).sort((a, b) => {
    const [ta, pa] = a.split(":").map(Number);
    const [tb, pb] = b.split(":").map(Number);
    return ta - tb || pa - pb;
  });
  // ── Metadata header ─────────────────────────────────────────────────
  // `#`-prefixed lines — most importers honor them as comments (Excel
  // skips-on-import; Sheets reads as text; Pandas via comment='#').
  // Provenance + game context so an exported file remains analyzable
  // months later without remembering the game state.
  const lines = buildCsvMetaHeader(history, rowByKey, metricCols);
  lines.push(headers.join(","));
  for (const k of sortedKeys) lines.push(/** @type {string[]} */ (rowByKey.get(k)).join(","));
  const csv = lines.join("\n");
  return { csv, lines, headers };
}

/**
 * Log and toast a refusal for a CSV that exceeds the hard size limit.
 * @param {HTMLElement|undefined} host Host for the toast.
 * @param {string} sizeMB Formatted CSV size in MB.
 * @returns {void}
 */
function refuseOversizedCsv(host, sizeMB) {
  console.error(
    "[Demographics.csv-export] export ABORTED at " +
      sizeMB +
      " MB (> 8 MB hard limit). " +
      "Lower the sample cap in Options (e.g. 5000) and retry."
  );
  if (host) {
    showCsvToast(
      host,
      "CSV too large (" +
        sizeMB +
        " MB) · would crash clipboard. " +
        "Lower sample cap in Options and retry.",
      false
    );
  }
}

/**
 * Dump the CSV to UI.log as a recoverable fallback — full dump under the soft
 * limit, summary line above it (so the log writer isn't stalled).
 * @param {string} csv The full CSV text.
 * @param {number} lineCount Total CSV line count.
 * @param {string} sizeMB Formatted CSV size in MB.
 * @param {boolean} clipboardOk Whether the clipboard write succeeded.
 * @returns {void}
 */
function logCsvDump(csv, lineCount, sizeMB, clipboardOk) {
  if (csv.length <= CSV_SOFT_LIMIT) {
    console.warn(
      "[Demographics.csv-export] BEGIN_DEMOGRAPHICS_CSV " +
        lineCount +
        " rows, " +
        csv.length +
        " chars"
    );
    console.warn(csv);
    console.warn("[Demographics.csv-export] END_DEMOGRAPHICS_CSV");
  } else {
    console.warn(
      "[Demographics.csv-export] CSV is large (" +
        sizeMB +
        " MB · " +
        lineCount +
        " rows) — skipping full log dump." +
        " Clipboard write was " +
        (clipboardOk ? "OK" : "FAILED") +
        "."
    );
  }
}

/**
 * Show the success / fallback toast for a completed CSV export. Accounts for
 * the 9-line meta header + the single column-header row when reporting the
 * data-row count.
 * @param {HTMLElement|undefined} host Host for the toast.
 * @param {string} csv The full CSV text (for the size tag).
 * @param {number} lineCount Total CSV line count.
 * @param {number} colCount Column count.
 * @param {string} sizeMB Formatted CSV size in MB.
 * @param {boolean} clipboardOk Whether the clipboard write succeeded.
 * @returns {void}
 */
function showCsvResultToast(host, csv, lineCount, colCount, sizeMB, clipboardOk) {
  const META_LINES = 9; // keep in sync with metadata-header push count above
  const dataRows = lineCount - META_LINES - 1;
  const sizeTag = csv.length >= CSV_SOFT_LIMIT ? " · " + sizeMB + " MB" : "";
  if (!host) return;
  if (clipboardOk) {
    showCsvToast(
      host,
      "Copied · " +
        dataRows +
        " rows × " +
        colCount +
        " cols" +
        sizeTag +
        " · paste into Excel / Sheets / a .csv file",
      true
    );
  } else {
    showCsvToast(host, "Clipboard unavailable · wrote CSV to UI.log (see logs folder)", false);
  }
}
