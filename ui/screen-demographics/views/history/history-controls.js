// history-controls.js
// Toolbar controls for Historical Data view.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { makeClickable } from "/demographics/ui/core/demographics-a11y.js";
import { safePlaySound, playActivate } from "/demographics/ui/core/demographics-audio.js";
import { exportHistoryAsCsv } from "/demographics/ui/screen-demographics/views/history/history-csv.js";
import { warsCsv } from "/demographics/ui/screen-demographics/views/history/history-tables-csv.js";
import { copyTableAsCsv } from "/demographics/ui/core/demographics-csv.js";
import { mergeWars } from "/demographics/ui/screen-demographics/charts/wars/chart-wars-merge.js";
import { nameMergedWars } from "/demographics/ui/screen-demographics/charts/wars/chart-wars-naming.js";
import { buildOptionsButton } from "/demographics/ui/screen-demographics/views/shared/options-button.js";

const DBG = false;

/** @param {...*} a */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.history-controls]", ...a);
}

/**
 * @param {HTMLElement} toolbar
 * @param {*} ctx
 */
function appendRadarControls(toolbar, ctx) {
  // The snapshot SELECTOR pills now live in a centered filter row (buildRadarSnapshotRow), like the
  // time filters on other graphs; the toolbar keeps only the Refresh action.
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
 * Build the radar SNAPSHOT selector as a centered filter row (matching the time-filter row on other
 * graphs): a "Snapshot:" label + one pill per age snapshot. Replaces the old right-aligned toolbar
 * placement so the snapshot filters center like the year filters elsewhere.
 * @param {*} ctx Render context (carries activeRadarAge, history, setActiveRadarAge).
 * @returns {HTMLElement} The centered filter row.
 */
export function buildRadarSnapshotRow(ctx) {
  const row = document.createElement("div");
  row.className = "demographics-chart-time-filter-row font-body text-xs";
  const ageOpts = [
    { id: "current", label: t("LOC_DEMOGRAPHICS_RADAR_SNAPSHOT_CURRENT") },
    { id: "AGE_ANTIQUITY", label: t("LOC_DEMOGRAPHICS_RADAR_SNAPSHOT_AGE1") },
    { id: "AGE_EXPLORATION", label: t("LOC_DEMOGRAPHICS_RADAR_SNAPSHOT_AGE2") }
  ];
  const active = ctx.activeRadarAge || "current";
  const radarLabel = document.createElement("div");
  radarLabel.className = "demographics-chart-toolbar-label font-body text-xs";
  radarLabel.textContent = t("LOC_DEMOGRAPHICS_LABEL_SNAPSHOT");
  row.appendChild(radarLabel);
  for (const opt of ageOpts) row.appendChild(buildRadarSnapshotPill(opt, active, ctx));
  return row;
}

/**
 * Build one radar snapshot selector pill.
 * @param {{ id: string, label: string }} opt Snapshot option.
 * @param {string} active Active snapshot id.
 * @param {*} ctx Toolbar context.
 * @returns {HTMLElement} Pill element.
 */
function buildRadarSnapshotPill(opt, active, ctx) {
  const haveSnap =
    opt.id === "current" ||
    (ctx.history && ctx.history.legacySnapshots && ctx.history.legacySnapshots[opt.id]);
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
  return pill;
}

/**
 * @param {HTMLElement} toolbar
 * @param {*} ctx
 */
function appendWarsControls(toolbar, ctx) {
  const wopts = ctx.chartMod
    .collectWarCivOptions(ctx.history)
    .filter((/** @type {*} */ o) => !o.isCS);
  const allOpt = { pid: null, label: t("LOC_DEMOGRAPHICS_WARS_ALL_MAJORS"), isCS: false };
  const dropdownOpts = [allOpt].concat(wopts);
  toolbar.appendChild(buildToolbarLabel(t("LOC_DEMOGRAPHICS_LABEL_CIV")));
  toolbar.appendChild(buildWarsCivDropdown(dropdownOpts, ctx));
  toolbar.appendChild(buildWarsActiveOnlyPill(ctx));
}

/**
 * Build a standard toolbar label block.
 * @param {string} text Label text.
 * @returns {HTMLElement} Label element.
 */
function buildToolbarLabel(text) {
  const lbl = document.createElement("div");
  lbl.className = "demographics-chart-toolbar-label font-body text-xs";
  lbl.textContent = text;
  return lbl;
}

/**
 * Whether a wars dropdown option matches the current filter pid.
 * @param {{ pid: number|null, label?: string }} option One dropdown option.
 * @param {*} warsFilterPid Current filter pid.
 * @returns {boolean} True when this option is selected.
 */
function warsOptionMatchesFilter(option, warsFilterPid) {
  if (option.pid === null) return warsFilterPid == null;
  return Number(option.pid) === Number(warsFilterPid);
}

/**
 * Build the wars civ-filter dropdown.
 * @param {Array<{ pid: number|null, label: string }>} dropdownOpts Civ options.
 * @param {*} ctx Toolbar context.
 * @returns {HTMLElement} Dropdown element.
 */
function buildWarsCivDropdown(dropdownOpts, ctx) {
  const dd = document.createElement("fxs-dropdown");
  dd.classList.add("demographics-chart-viewer-dropdown");
  dd.setAttribute("data-audio-group-ref", "audio-screen-unlocks");
  dd.setAttribute("dropdown-items", JSON.stringify(dropdownOpts.map((o) => ({ label: o.label }))));
  let didx = dropdownOpts.findIndex((o) => warsOptionMatchesFilter(o, ctx.warsFilterPid));
  if (didx < 0) didx = 0;
  dd.setAttribute("selected-item-index", String(didx));
  dd.addEventListener("dropdown-selection-change", (event) => {
    const i = /** @type {*} */ (event)?.detail?.selectedIndex;
    if (typeof i !== "number" || i < 0 || i >= dropdownOpts.length) return;
    if (typeof ctx.setWarsFilterPid === "function") ctx.setWarsFilterPid(dropdownOpts[i].pid);
  });
  return dd;
}

/**
 * Build the wars active/all toggle pill.
 * @param {*} ctx Toolbar context.
 * @returns {HTMLElement} Pill element.
 */
function buildWarsActiveOnlyPill(ctx) {
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
  return activePill;
}

/**
 * @param {HTMLElement} toolbar
 * @param {Array<*>} opts
 * @param {*} currentPid
 * @param {(pid: number) => void} [setViewerPid]
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
 * @param {HTMLElement} toolbar
 * @param {*} ctx
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
 * Apply one step of x-axis mode rotation and request a chart reload.
 * @param {*} ctx Toolbar context.
 * @param {string[]} modes Ordered mode cycle.
 * @param {string} mode Current mode.
 */
function rotateTimeMode(ctx, modes, mode) {
  const next = modes[(modes.indexOf(mode) + 1) % modes.length];
  try {
    ctx.settings?.setSetting?.("xAxisMode", next);
  } catch (_) {
    // Best-effort persistence.
  }
  try {
    ctx.chartMod?.setXAxisMode?.(next);
  } catch (_) {
    // Optional module hook.
  }
  ctx.requestReload?.();
}

/**
 * @param {HTMLElement} toolbar
 * @param {*} ctx
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
    // Keep default mode.
  }
  if (!modes.includes(mode)) mode = "both";
  try {
    ctx.chartMod?.setXAxisMode?.(mode);
  } catch (_) {
    // Optional module hook.
  }
  const timeBtn = document.createElement("div");
  timeBtn.className = "demographics-chart-toolbar-btn font-body text-xs";
  timeBtn.textContent = labels[mode];
  timeBtn.title = t("LOC_DEMOGRAPHICS_BTN_TIME_TOOLTIP");
  makeClickable(timeBtn, (ev) => {
    ev?.stopPropagation?.();
    safePlaySound("data-audio-activate", "options");
    rotateTimeMode(ctx, modes, mode);
  });
  toolbar.appendChild(timeBtn);
}

/**
 * @param {HTMLElement} toolbar
 * @param {*} ctx
 * @param {string} activeMetric
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
  wondersBtn.textContent = wondersOn
    ? t("LOC_DEMOGRAPHICS_BTN_WONDERS_ON")
    : t("LOC_DEMOGRAPHICS_BTN_WONDERS_OFF");
  wondersBtn.title = wondersOn
    ? t("LOC_DEMOGRAPHICS_BTN_WONDERS_ON_TOOLTIP")
    : t("LOC_DEMOGRAPHICS_BTN_WONDERS_OFF_TOOLTIP");
  if (!wondersOn) wondersBtn.classList.add("demographics-history-wonders-off");
  makeClickable(wondersBtn, (ev) => {
    ev?.stopPropagation?.();
    safePlaySound("data-audio-activate", "options");
    try {
      const next = !ctx.settings?.getSetting?.("showWonderMarkers", true);
      ctx.settings?.setSetting?.("showWonderMarkers", next);
      dlog("wonders toggle clicked; new value=" + next);
    } catch (_) {
      // Best-effort persistence.
    }
    ctx.requestReload?.();
  });
  toolbar.appendChild(wondersBtn);
  dlog("wonders button mounted; activeMetric=" + activeMetric + " wondersOn=" + wondersOn);
}

/**
 * The Refugees graphs (Left/Arrived, both units), they carry the war/disaster event-marker toggles.
 */
const REFUGEE_METRICS = new Set([
  "emig_refugees", "emig_refugees_pts", "emig_refugees_in", "emig_refugees_in_pts"
]);

/**
 * Append one event-marker filter toggle (e.g. Wars / Disasters), mirroring the Wonders toggle:
 * reads a boolean setting (default ON), dims when off, flips + re-renders on click. The refugee
 * chart already gates its war/disaster markers on these same settings, this just surfaces them at
 * the top.
 * @param {HTMLElement} toolbar The toolbar.
 * @param {*} ctx Render context.
 * @param {string} key Setting key (showWarMarkers / showDisasterMarkers).
 * @param {string} label Button label.
 */
function appendMarkerToggle(toolbar, ctx, key, label) {
  let on = true;
  try {
    on = !!ctx.settings?.getSetting?.(key, true);
  } catch (_) {
    on = true;
  }
  const btn = document.createElement("div");
  btn.className = "demographics-chart-toolbar-btn font-body text-xs";
  btn.textContent = label;
  btn.title = label;
  if (!on) btn.classList.add("demographics-history-wonders-off");
  makeClickable(btn, (ev) => {
    ev?.stopPropagation?.();
    safePlaySound("data-audio-activate", "options");
    try {
      ctx.settings?.setSetting?.(key, !on);
    } catch (_) {
      /* best-effort persistence */
    }
    ctx.requestReload?.();
  });
  toolbar.appendChild(btn);
}

/**
 * Append the Wars + Disasters event-marker filter toggles for the Refugees graphs.
 * @param {HTMLElement} toolbar The toolbar.
 * @param {*} ctx Render context.
 */
function appendRefugeeMarkerToggles(toolbar, ctx) {
  appendMarkerToggle(toolbar, ctx, "showWarMarkers", t("LOC_DEMOGRAPHICS_BTN_WAR_MARKERS"));
  appendMarkerToggle(toolbar, ctx, "showDisasterMarkers", t("LOC_DEMOGRAPHICS_BTN_DISASTER_MARKERS"));
}

/** History pages whose data lives in history.wars (not the per-turn samples). */
const WARS_PAGES = new Set(["wars_gantt", "war_graphs"]);

/**
 * Run the CSV export appropriate to the active page: the war list on the
 * Conflicts pages, otherwise the full per-turn sample matrix (which underlies
 * every metric / resources / crisis chart).
 * @param {*} ctx Toolbar context (carries history).
 * @param {HTMLElement} host Host for the confirmation toast.
 * @param {string} activeMetric The active page's metric id.
 */
function runCsvExport(ctx, host, activeMetric) {
  if (WARS_PAGES.has(activeMetric)) {
    const { headers, rows } = warsCsv(ctx.history);
    copyTableAsCsv({ host, title: "Wars", headers, rows });
    return;
  }
  exportHistoryAsCsv(ctx.history, host);
}

/**
 * @param {HTMLElement} toolbar
 * @param {HTMLElement} host
 * @param {*} ctx
 * @param {string} activeMetric
 */
function appendCsvControls(toolbar, host, ctx, activeMetric) {
  const csvBtn = document.createElement("div");
  csvBtn.className = "demographics-chart-toolbar-btn font-body text-xs";
  csvBtn.textContent = t("LOC_DEMOGRAPHICS_BTN_COPY_CSV");
  csvBtn.title = t("LOC_DEMOGRAPHICS_BTN_COPY_CSV_TOOLTIP");
  makeClickable(csvBtn, (ev) => {
    ev?.stopPropagation?.();
    safePlaySound("data-audio-activate", "options");
    runCsvExport(ctx, host, activeMetric);
  });
  toolbar.appendChild(csvBtn);
}

/**
 * @param {HTMLElement} toolbar
 * @param {*} ctx
 * @param {string} activeMetric
 */
function appendMetricSpecificControls(toolbar, ctx, activeMetric) {
  if (activeMetric === "legacy_radar") appendRadarControls(toolbar, ctx);
  else if (activeMetric === "wars_gantt") appendWarsControlsIfReady(toolbar, ctx);
  // war_graphs: the "Pick war" dropdown moves to the LEFT bar (buildWarGraphsPicker), not the
  // toolbar.
  else if (activeMetric === "crisis_graphs") appendCrisisGraphsControls(toolbar, ctx);
  else if (activeMetric === "resources_stack") appendResourcesViewerIfReady(toolbar, ctx);
}

/**
 * Append the Crisis Graphs age-scope selector. The chart module reports the
 * available scopes ("All Ages" + one per crisis-bearing age) and returns an
 * empty list until a second crisis exists, so the dropdown only appears once
 * (e.g.) the Exploration crisis has begun.
 * @param {HTMLElement} toolbar The toolbar element.
 * @param {*} ctx Toolbar context.
 */
function appendCrisisGraphsControls(toolbar, ctx) {
  const chartMod = ctx.chartMod;
  if (!chartMod || typeof chartMod.collectCrisisScopes !== "function") return;
  const opts = chartMod.collectCrisisScopes(ctx.history);
  if (!opts.length) return;
  toolbar.appendChild(buildToolbarLabel(t("LOC_DEMOGRAPHICS_CRISIS_GRAPHS_SCOPE")));
  toolbar.appendChild(buildCrisisScopeDropdown(opts, ctx));
}

/**
 * Build the Crisis Graphs scope dropdown.
 * @param {Array<{ id: string, label: string }>} opts Scope options.
 * @param {*} ctx Toolbar context.
 * @returns {HTMLElement} Dropdown element.
 */
function buildCrisisScopeDropdown(opts, ctx) {
  const dd = document.createElement("fxs-dropdown");
  dd.classList.add("demographics-chart-viewer-dropdown");
  dd.setAttribute("data-audio-group-ref", "audio-screen-unlocks");
  dd.setAttribute("dropdown-items", JSON.stringify(opts.map((o) => ({ label: o.label }))));
  const active =
    typeof ctx.chartMod.resolveCrisisScope === "function"
      ? ctx.chartMod.resolveCrisisScope(ctx.history, ctx.crisisGraphsAge)
      : ctx.crisisGraphsAge;
  let didx = opts.findIndex((o) => o.id === active);
  if (didx < 0) didx = 0;
  dd.setAttribute("selected-item-index", String(didx));
  dd.addEventListener("dropdown-selection-change", (event) => {
    const i = /** @type {*} */ (event)?.detail?.selectedIndex;
    if (typeof i !== "number" || i < 0 || i >= opts.length) return;
    if (typeof ctx.setCrisisGraphsAge === "function") ctx.setCrisisGraphsAge(opts[i].id);
  });
  return dd;
}

/**
 * Build the War Graphs "Pick war" selector as a LEFT bar (a dropdown of every war), so it sits on
 * the far left of the controls row while the filters stay centered and the toolbar stays right.
 * @param {*} ctx Render context (carries history, warGraphsWarId, setWarGraphsWarId).
 * @returns {HTMLElement} The left-bar element.
 */
export function buildWarGraphsPicker(ctx) {
  const bar = document.createElement("div");
  bar.className = "demographics-chart-leftbar font-body text-xs";
  const h = ctx.history || {};
  const rawWars = Array.isArray(h.wars) ? h.wars : [];
  const samples = Array.isArray(h.samples) ? h.samples : [];
  const latest = samples.length ? samples[samples.length - 1].turn : 0;
  const wars = mergeWars(rawWars, latest);
  const names = nameMergedWars(wars, samples);
  const opts = wars
    .filter((w) => typeof w?.warUniqueID === "number")
    .map((w) => ({
      id: w.warUniqueID,
      label: names.get(w.warUniqueID) || w.name || "War #" + w.warUniqueID
    }))
    .reverse();
  bar.appendChild(buildToolbarLabel(t("LOC_DEMOGRAPHICS_WAR_GRAPHS_PICK")));
  if (opts.length) bar.appendChild(buildWarGraphsDropdown(opts, ctx));
  return bar;
}

/**
 * Build the war-graphs war picker dropdown.
 * @param {Array<{ id: number, label: string }>} opts War options.
 * @param {*} ctx Toolbar context.
 * @returns {HTMLElement} Dropdown element.
 */
function buildWarGraphsDropdown(opts, ctx) {
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
  return dd;
}

/**
 * @param {HTMLElement} toolbar
 * @param {*} ctx
 */
function appendWarsControlsIfReady(toolbar, ctx) {
  if (ctx.chartMod && typeof ctx.chartMod.collectWarCivOptions === "function") {
    appendWarsControls(toolbar, ctx);
  }
}

/**
 * @param {HTMLElement} toolbar
 * @param {*} ctx
 */
function appendResourcesViewerIfReady(toolbar, ctx) {
  if (ctx.chartMod && typeof ctx.chartMod.collectResourceCivOptions === "function") {
    const opts = ctx.chartMod.collectResourceCivOptions(ctx.history);
    appendViewerDropdown(toolbar, opts, ctx.resourcesViewerPid, ctx.setResourcesViewerPid);
  }
}

const TIME_TOGGLE_HIDDEN_FOR = new Set(["crisis_graphs"]);
// Wonder markers only draw on the standard per-civ line charts; hide the toggle
// on every synthetic view (radar, resources stack, the wars pages, crises) where
// it would do nothing.
const WONDERS_TOGGLE_HIDDEN_FOR = new Set([
  "crisis_stages",
  "crisis_graphs",
  "legacy_radar",
  "resources_stack",
  "wars_gantt",
  "war_graphs"
]);

/**
 * Build and append the chart toolbar.
 * @param {HTMLElement} host
 * @param {*} ctx
 * @param {string} activeMetric
 */
export function buildToolbar(host, ctx, activeMetric) {
  const toolbar = document.createElement("div");
  toolbar.className = "demographics-chart-toolbar";
  if (activeMetric === "wars_gantt") toolbar.classList.add("demographics-chart-toolbar-wars");

  appendMetricSpecificControls(toolbar, ctx, activeMetric);
  appendClearFocus(toolbar, ctx);
  if (!TIME_TOGGLE_HIDDEN_FOR.has(activeMetric)) appendTimeUnitsToggle(toolbar, ctx);
  if (!WONDERS_TOGGLE_HIDDEN_FOR.has(activeMetric)) appendWondersToggle(toolbar, ctx, activeMetric);
  if (REFUGEE_METRICS.has(activeMetric)) appendRefugeeMarkerToggles(toolbar, ctx);
  appendCsvControls(toolbar, host, ctx, activeMetric);
  toolbar.appendChild(buildOptionsButton());

  if (toolbar.children.length) host.appendChild(toolbar);
}
