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

const DBG = true;
function dlog(...a) {
  if (DBG) console.warn("[Demographics.view-history]", ...a);
}
function derr(...a) {
  console.error("[Demographics.view-history]", ...a);
}

// Page definitions. Each page lists metric IDs in display order. IDs that
// don't exist in METRICS register as placeholder ("Not yet implemented").
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

// Synthetic "metrics" that route to a custom renderer instead of the
// standard line-chart pipeline. They live in PAGES.metrics like normal
// tab IDs but have no entry in METRICS; metricExists() must accept them
// or the page logic would fall through to the "Not yet implemented" stub.
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
function isSynthetic(id) {
  return Object.prototype.hasOwnProperty.call(SYNTHETIC_METRICS, id);
}
function metricExists(id) {
  return isSynthetic(id) || METRICS.some((m) => m.id === id);
}

function safeCall(fn, fb) {
  try {
    return fn();
  } catch (e) {
    derr("safeCall:", e);
    return fb;
  }
}

// PALETTE shared with legend so colors match the chart. Proxy so each index
// access reads getPalette() fresh — keeps colorblind-mode toggle live.
const PALETTE = new Proxy(
  {},
  {
    get(_t, k) {
      const p = getPalette();
      if (k === "length") return p.length;
      const i = Number(k);
      if (Number.isFinite(i)) return p[i];
      return p[k];
    }
  }
);

export function render(host, ctx) {
  // ctx = { history, activeMetric, activePage, hiddenCivs, chartMod, settings,
  //         setActiveMetric, setActivePage, toggleCiv }
  while (host.firstChild) host.removeChild(host.firstChild);

  // ── Page tab row ────────────────────────────────────────────────────
  const pageHost = document.createElement("div");
  pageHost.className = "demographics-page-tab-host w-full";
  host.appendChild(pageHost);

  const pageBar = document.createElement("fxs-tab-bar");
  pageBar.classList.add("demographics-page-tabs", "w-full", "font-title", "text-sm");
  pageBar.setAttribute("data-audio-group-ref", "audio-screen-unlocks");
  pageBar.setAttribute("tab-item-class", "font-title text-base");
  const pageTabs = PAGES.map((p) => ({ id: p.id, label: p.label }));
  pageBar.setAttribute("tab-items", JSON.stringify(pageTabs));
  const activePage =
    ctx.activePage && PAGES.some((p) => p.id === ctx.activePage) ? ctx.activePage : "economy";
  const pageIdx = Math.max(
    0,
    PAGES.findIndex((p) => p.id === activePage)
  );
  pageBar.setAttribute("selected-tab-index", String(pageIdx));
  pageBar.addEventListener("tab-selected", (event) => {
    const id = event?.detail?.selectedItem?.id;
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
    ctx.setActivePage(id);
  });
  pageHost.appendChild(pageBar);

  // ── Metric tab row (for the active page) ───────────────────────────
  const metricHost = document.createElement("div");
  metricHost.className = "demographics-tab-bar-host w-full";
  host.appendChild(metricHost);

  const page = PAGES.find((p) => p.id === activePage) || PAGES[0];
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

  // Active metric: only valid if it's in this page AND exists.
  let activeMetric = ctx.activeMetric;
  const activeInPage = page.metrics.includes(activeMetric) && metricExists(activeMetric);
  if (!activeInPage) {
    activeMetric = page.metrics.find(metricExists) || "score";
  }
  const mIdx = Math.max(
    0,
    page.metrics.findIndex((m) => m === activeMetric)
  );
  metricBar.setAttribute("selected-tab-index", String(mIdx));
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
  metricBar.addEventListener("tab-selected", (event) => {
    const id = event?.detail?.selectedItem?.id;
    if (!id || id === activeMetric) return;
    if (!metricExists(id)) {
      dlog("metric-selected but unimplemented:", id);
      ctx.setActiveMetric(id); // still record selection so NYI shows
      return;
    }
    dlog("metric-selected:", id);
    ctx.setActiveMetric(id);
  });
  metricHost.appendChild(metricBar);

  // ── Chart title (full descriptive name above the plot) ────────────
  const metricObj = (() => {
    try {
      return getMetric(activeMetric);
    } catch (_) {
      return null;
    }
  })();
  const synthMeta = isSynthetic(activeMetric) ? SYNTHETIC_METRICS[activeMetric] : null;
  {
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

  // ── Per-metric explanation caption (moved ABOVE the filter row so the
  //    page reads top-down as: title → caption → filters → chart). ──
  if (activeMetric === "gdp") {
    host.appendChild(
      buildMetricInfoCaption({
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
      })
    );
  }
  if (activeMetric === "approval") {
    host.appendChild(
      buildMetricInfoCaption({
        triggerText:
          "ⓘ Diplomatic Approval = Σ relationship-weighted scores  ·  hover for explanation",
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
      })
    );
  }

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
  let activeFilter = ctx.activeTimeFilter || "age";
  // Belt-and-suspenders: if anything upstream passed us a disabled
  // cross-age filter (stale state, manual settings edit, etc.) fall
  // back to the current-age window so the chart renders something.
  if (["all", "age1", "age2", "age3"].includes(activeFilter)) activeFilter = "age";
  const _activeDef = TIME_FILTERS.find((f) => f.id === activeFilter);
  if (!_activeDef || _activeDef.disabled) activeFilter = "age";
  const turnRange = computeTurnRange(ctx.history, activeFilter);
  const TIME_FILTER_HIDDEN_FOR = new Set(["legacy_radar"]);
  if (!TIME_FILTER_HIDDEN_FOR.has(activeMetric)) {
    const filterRow = buildTimeFilterRow(activeFilter, (id) => {
      if (typeof ctx.setActiveTimeFilter === "function") ctx.setActiveTimeFilter(id);
    });
    host.appendChild(filterRow);
  }

  // ── Toolbar: viewer dropdown (resources only), focus-clear, CSV ──
  const toolbar = document.createElement("div");
  toolbar.className = "demographics-chart-toolbar";

  if (activeMetric === "legacy_radar") {
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
        (ctx.history && ctx.history.legacySnapshots && ctx.history.legacySnapshots[opt.id]);
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

  if (
    activeMetric === "wars_gantt" &&
    ctx.chartMod &&
    typeof ctx.chartMod.collectWarCivOptions === "function"
  ) {
    // Filter to majors only — CSes never appear on this view.
    const wopts = ctx.chartMod.collectWarCivOptions(ctx.history).filter((o) => !o.isCS);
    const allOpt = { pid: null, label: "All major civilizations", isCS: false };
    const dropdownOpts = [allOpt].concat(wopts);
    const lbl = document.createElement("div");
    lbl.className = "demographics-chart-toolbar-label font-body text-xs";
    lbl.textContent = "Civ:";
    toolbar.appendChild(lbl);
    const dd = document.createElement("fxs-dropdown");
    dd.classList.add("demographics-chart-viewer-dropdown");
    dd.setAttribute("data-audio-group-ref", "audio-screen-unlocks");
    dd.setAttribute(
      "dropdown-items",
      JSON.stringify(dropdownOpts.map((o) => ({ label: o.label })))
    );
    let didx = dropdownOpts.findIndex(
      (o) =>
        (o.pid === null && ctx.warsFilterPid == null) ||
        (o.pid !== null && Number(o.pid) === Number(ctx.warsFilterPid))
    );
    if (didx < 0) didx = 0;
    dd.setAttribute("selected-item-index", String(didx));
    dd.addEventListener("dropdown-selection-change", (event) => {
      const i = event?.detail?.selectedIndex;
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

  if (
    activeMetric === "triumphs_stack" &&
    ctx.chartMod &&
    typeof ctx.chartMod.collectTriumphCivOptions === "function"
  ) {
    const opts = ctx.chartMod.collectTriumphCivOptions(ctx.history);
    if (opts.length > 1) {
      const label = document.createElement("div");
      label.className = "demographics-chart-toolbar-label font-body text-xs";
      label.textContent = "Viewing:";
      toolbar.appendChild(label);
      const dd = document.createElement("fxs-dropdown");
      dd.classList.add("demographics-chart-viewer-dropdown");
      dd.setAttribute("data-audio-group-ref", "audio-screen-unlocks");
      dd.setAttribute("dropdown-items", JSON.stringify(opts.map((o) => ({ label: o.label }))));
      let idx = opts.findIndex((o) => Number(o.pid) === Number(ctx.triumphsViewerPid));
      if (idx < 0) idx = 0;
      dd.setAttribute("selected-item-index", String(idx));
      dd.addEventListener("dropdown-selection-change", (event) => {
        const i = event?.detail?.selectedIndex;
        if (typeof i !== "number" || i < 0 || i >= opts.length) return;
        if (typeof ctx.setTriumphsViewerPid === "function") {
          ctx.setTriumphsViewerPid(Number(opts[i].pid));
        }
      });
      toolbar.appendChild(dd);
    }
  }

  if (
    activeMetric === "resources_stack" &&
    ctx.chartMod &&
    typeof ctx.chartMod.collectResourceCivOptions === "function"
  ) {
    const opts = ctx.chartMod.collectResourceCivOptions(ctx.history);
    if (opts.length > 1) {
      const label = document.createElement("div");
      label.className = "demographics-chart-toolbar-label font-body text-xs";
      label.textContent = "Viewing:";
      toolbar.appendChild(label);
      const dd = document.createElement("fxs-dropdown");
      dd.classList.add("demographics-chart-viewer-dropdown");
      dd.setAttribute("data-audio-group-ref", "audio-screen-unlocks");
      dd.setAttribute("dropdown-items", JSON.stringify(opts.map((o) => ({ label: o.label }))));
      let idx = opts.findIndex((o) => Number(o.pid) === Number(ctx.resourcesViewerPid));
      if (idx < 0) idx = 0;
      dd.setAttribute("selected-item-index", String(idx));
      dd.addEventListener("dropdown-selection-change", (event) => {
        const i = event?.detail?.selectedIndex;
        if (typeof i !== "number" || i < 0 || i >= opts.length) return;
        if (typeof ctx.setResourcesViewerPid === "function") {
          ctx.setResourcesViewerPid(Number(opts[i].pid));
        }
      });
      toolbar.appendChild(dd);
    }
  }

  if (ctx.focusedCivs && ctx.focusedCivs.size > 0) {
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

  // ── Time-units toggle. Cycles "Both" → "Turn" → "Year". Pushes the
  // new value into chartMod so every history chart (line + stacks + gantt)
  // formats its X axis to match on the next reload.
  {
    const modes = ["both", "turn", "year"];
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

  // ── Wonders-layer toggle. Styled identically to "Export CSV" — same
  // toolbar-btn class, same gold-on-parchment look. ON state = full
  // opacity, OFF state = dimmed so the user can read at-a-glance whether
  // the layer is active.
  {
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

  // Build the CSV info icon — appended AFTER the CSV button below so it
  // sits to the right. We construct it here and keep a ref to mount last.
  const csvInfo = (() => {
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
  })();

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

  host.appendChild(toolbar);

  // ── Chart host ─────────────────────────────────────────────────────
  const chartHost = document.createElement("div");
  chartHost.className = "demographics-chart-host relative flex flex-col items-center";
  host.appendChild(chartHost);

  if (!metricExists(activeMetric)) {
    // Placeholder for unimplemented metric.
    const ph = document.createElement("div");
    ph.className = "demographics-nyi font-body text-base";
    ph.textContent = "Not yet implemented — coming in a future iteration.";
    chartHost.appendChild(ph);
  } else {
    // Defer to the next tick so flex layout completes and we can read
    // the chart-host's real width/height (otherwise rect is 0×0 on
    // first attach and we'd fall back to the static 1600×600 defaults
    // that don't fill the screen).
    const doRender = () =>
      safeCall(() => {
        const hostRect = chartHost.getBoundingClientRect?.();
        const width = Math.max(960, Math.min(2800, Math.round(hostRect?.width || 1600)));
        const height = Math.max(360, Math.min(1400, Math.round(hostRect?.height || 600)));
        dlog("chart render size=" + width + "x" + height, "activeMetric=" + activeMetric);
        // Route to the appropriate renderer for synthetic page-level
        // views; otherwise fall through to the standard line chart.
        if (
          activeMetric === "legacy_radar" &&
          typeof ctx.chartMod.renderLegacyRadar === "function"
        ) {
          ctx.chartMod.renderLegacyRadar(chartHost, {
            history: ctx.history,
            hiddenCivs: ctx.hiddenCivs,
            width,
            height,
            ageSource: ctx.activeRadarAge || "current",
            onToggleCiv: (leaderKey) => ctx.toggleCiv(leaderKey)
          });
          return;
        }
        if (
          activeMetric === "triumphs_stack" &&
          typeof ctx.chartMod.renderTriumphStack === "function"
        ) {
          ctx.chartMod.renderTriumphStack(chartHost, {
            history: ctx.history,
            width,
            height,
            turnRange,
            viewerPid: ctx.triumphsViewerPid
          });
          return;
        }
        if (
          activeMetric === "resources_stack" &&
          typeof ctx.chartMod.renderResourcesStack === "function"
        ) {
          ctx.chartMod.renderResourcesStack(chartHost, {
            history: ctx.history,
            width,
            height,
            turnRange,
            viewerPid: ctx.resourcesViewerPid
          });
          return;
        }
        if (activeMetric === "wars_gantt" && typeof ctx.chartMod.renderWarsGantt === "function") {
          // Wars timeline shows EVERY war regardless of the line-chart
          // time filter. Clamping to "current age" silently hid wars
          // from earlier ages and produced an empty chart for mid- and
          // late-game saves.
          ctx.chartMod.renderWarsGantt(chartHost, {
            history: ctx.history,
            width,
            height,
            turnRange: null,
            filterPid: ctx.warsFilterPid,
            showCs: ctx.warsShowCs !== false,
            activeOnly: ctx.warsActiveOnly
          });
          return;
        }
        ctx.chartMod.renderChart(chartHost, {
          history: ctx.history,
          metric: activeMetric,
          hiddenCivs: ctx.hiddenCivs,
          focusedCivs: ctx.focusedCivs,
          width,
          height,
          turnRange,
          onToggleCiv: (leaderKey) => {
            // Repurposed: clicking a line label toggles FOCUS on
            // that civ (head-to-head view) rather than hiding.
            if (typeof ctx.toggleFocusCiv === "function") ctx.toggleFocusCiv(leaderKey);
            else ctx.toggleCiv(leaderKey);
          }
        });
      });
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(doRender);
    } else {
      setTimeout(doRender, 0);
    }
  }

  // Line labels on the right edge of the chart now serve as the legend
  // (clickable to hide; hidden civs appear as faded labels below the
  // plot area, clickable to restore). The bottom legend list was
  // removed to simplify the UI.
  // Per-metric explanation captions are appended ABOVE the chart (after
  // the title) — see the earlier block in this function. Kept the
  // bottom-of-chart block free of duplicates.
}

// Build an "ⓘ …" caption trigger that opens a sticky popover with rich
// HTML content on hover. Replaces the unreliable `title` attribute path —
// Coherent GameFace doesn't surface native browser tooltips consistently,
// so we manage a dedicated popover element ourselves.
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

  let hideTimer = null;
  function show() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    popover.style.display = "block";
  }
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

function renderLegend(host, ctx, activeMetric) {
  const samples = ctx.history?.samples || [];
  if (samples.length === 0) return;

  // Read the global "show unmet names" toggle (Fix 4). Default false.
  let showUnmetNames = false;
  try {
    showUnmetNames = !!ctx.settings?.getSetting?.("showUnmetNames", false);
  } catch (_) {
    showUnmetNames = false;
  }

  // LOCAL pid for met-status comparison (chart legend filters from local
  // player's perspective).
  let localPid;
  try {
    if (typeof GameContext !== "undefined" && GameContext != null) {
      if (typeof GameContext.localPlayerID === "number") localPid = GameContext.localPlayerID;
      else if (typeof GameContext.localObserverID === "number")
        localPid = GameContext.localObserverID;
    }
  } catch (_) {
    /* */
  }

  const pidOrder = [];
  const pidInfo = {};
  for (const s of samples) {
    if (!s?.players) continue;
    for (const pid of Object.keys(s.players)) {
      const ps = s.players[pid];
      if (!pidInfo[pid]) {
        pidOrder.push(pid);
        pidInfo[pid] = {
          leaderKey: String(ps?.leaderType ?? "pid:" + pid),
          leaderName: undefined,
          civNames: [], // ordered, unique
          lastValue: undefined,
          met: undefined // latest met flag from snapshot
        };
      }
      if (typeof ps?.leaderName === "string" && ps.leaderName.length > 0) {
        pidInfo[pid].leaderName = ps.leaderName;
      }
      if (typeof ps?.civName === "string" && ps.civName.length > 0) {
        const arr = pidInfo[pid].civNames;
        if (!arr.includes(ps.civName)) arr.push(ps.civName);
      }
      if (typeof ps?.met === "boolean") pidInfo[pid].met = ps.met;
      const v = ps?.metrics?.[activeMetric];
      if (typeof v === "number" && isFinite(v)) pidInfo[pid].lastValue = v;
    }
  }
  const fmt = (() => {
    try {
      const m = getMetric(activeMetric);
      if (m && typeof m.format === "function") return m.format;
    } catch (_) {
      /* */
    }
    return (n) => String(Math.round(n));
  })();

  const legend = document.createElement("div");
  legend.className = "demographics-legend font-body text-xs";
  pidOrder.forEach((pid, idx) => {
    const info = pidInfo[pid];
    const color = PALETTE[idx % PALETTE.length];
    // Live render-time fallback for leader name. The chart's
    // buildSeriesFromHistory does the same — but the legend was
    // sometimes ending up with `info.leaderName` undefined and
    // legacyLeaderName falling back to "Player N" or a hash. Always
    // try `player.name` directly first.
    let leaderOnly = info.leaderName;
    if (!leaderOnly) {
      try {
        // Try BOTH pid forms — the snapshot stores pid as a string
        // key (Object.keys), and Players.get expects a number.
        // Older code only tried Number(pid) which silently returned
        // null when pid was already numeric. Belt-and-braces.
        const getP = typeof Players?.get === "function" ? Players.get.bind(Players) : null;
        let p = null;
        if (getP) {
          try {
            p = getP(Number(pid));
          } catch (_) {
            p = null;
          }
          if (!p) {
            try {
              p = getP(pid);
            } catch (_) {
              p = null;
            }
          }
        }
        if (p?.name) {
          leaderOnly = typeof Locale?.compose === "function" ? Locale.compose(p.name) : p.name;
        }
      } catch (_) {
        /* */
      }
    }
    if (!leaderOnly) leaderOnly = legacyLeaderName(info.leaderKey, pid);
    // Format matches chart.js displayName(): no civ → leader only;
    // one civ → "Leader (Civ)"; many civs → "Leader (Old → New)".
    // Live-resolve fallback: if the history snapshot doesn't carry a
    // civName (older samples pre-$hash fix), try `player.civilizationName`
    // directly at render time so the legend never silently drops the civ.
    let civs = info.civNames || [];
    if (civs.length === 0) {
      try {
        const p = typeof Players?.get === "function" ? Players.get(Number(pid)) : null;
        const live = p?.civilizationName;
        if (typeof live === "string" && live.length > 0) {
          const composed = typeof Locale?.compose === "function" ? Locale.compose(live) : live;
          if (composed && composed.length > 0) civs = [composed];
        }
      } catch (_) {
        /* */
      }
    }
    // Apply "Unmet Civilization" mask if the local player hasn't met this
    // pid and the setting is off. Defensive: if `met` is undefined or the
    // pid IS the local player, treat as met.
    const isLocal = localPid !== undefined && Number(pid) === Number(localPid);
    const metFlag = info.met === undefined ? true : info.met;
    // Split the rendered DOM into three text spans (leader, civ-in-
    // parens, value). Previously the entire string lived in a single
    // `.demographics-legend-name` span and the user reported the leader
    // name not appearing. By splitting we make it unambiguous which
    // span holds which piece of text.
    let leaderText;
    let civText = "";
    if (!showUnmetNames && !isLocal && metFlag === false) {
      leaderText = "Unmet Civilization";
    } else {
      leaderText = leaderOnly;
      if (civs.length === 1) civText = "(" + civs[0] + ")";
      else if (civs.length > 1) civText = "(" + civs.join(" → ") + ")";
    }
    const valText = info.lastValue !== undefined ? fmt(info.lastValue) : "—";
    dlog(
      "legend pid=" + pid,
      "leader='" + leaderText + "'",
      "civ='" + civText + "'",
      "value='" + valText + "'",
      "met=" + metFlag
    );
    const entry = document.createElement("div");
    entry.className = "demographics-legend-entry";
    const isHidden = ctx.hiddenCivs.has(info.leaderKey);
    if (isHidden) entry.classList.add("is-hidden");

    const pip = document.createElement("div");
    pip.className = "demographics-legend-pip";
    pip.style.backgroundColor = color;
    pip.style.borderColor = color;
    entry.appendChild(pip);

    // Match the factbook header pattern (which renders correctly):
    // a plain div with className + textContent. No innerHTML, no inline
    // flex/overflow — those were collapsing the text to zero width.
    const labelStr = civText ? leaderText + " " + civText : leaderText;
    const leaderEl = document.createElement("div");
    leaderEl.className = "demographics-legend-leader font-title text-sm";
    leaderEl.textContent = labelStr;
    entry.appendChild(leaderEl);

    const valEl = document.createElement("div");
    valEl.className = "demographics-legend-value font-body text-sm";
    valEl.textContent = valText;
    entry.appendChild(valEl);

    dlog(
      "legend DOM built pid=" + pid,
      "labelStr='" + labelStr + "'",
      "leaderEl.textContent='" + leaderEl.textContent + "'"
    );

    entry.addEventListener("click", () => ctx.toggleCiv(info.leaderKey));
    entry.addEventListener("action-activate", () => ctx.toggleCiv(info.leaderKey));

    legend.appendChild(entry);
  });
  host.appendChild(legend);
}

// Fallback used when a snapshot predates the leaderName fix.
function legacyLeaderName(leaderKey, pid) {
  if (!leaderKey) return "Player " + pid;
  try {
    if (typeof GameInfo !== "undefined" && GameInfo.Leaders?.lookup) {
      const row = GameInfo.Leaders.lookup(leaderKey);
      if (row?.Name) {
        if (typeof Locale !== "undefined" && Locale.compose) {
          try {
            return Locale.compose(row.Name);
          } catch (_) {
            /* */
          }
        }
        return row.Name;
      }
    }
  } catch (_) {
    /* */
  }
  const s = String(leaderKey);
  // Don't render a bare digit string as the name.
  if (/^-?\d+$/.test(s)) return "Player " + pid;
  return s.replace(/^LEADER_/, "").replace(/_/g, " ");
}

// ─── Time-range filter helpers ──────────────────────────────────────────────
// Each filter resolves to a {min, max} turn range that the chart clamps to.
// "all" returns null (chart uses its natural full domain).

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

// Cross-age filter tooltip content. Structured so the renderer can lay
// it out as proper HTML (clean sections, mixed-case headings, two-column
// channel table) rather than a wall of monospace text. One place to edit
// if/when the underlying engine constraint changes.
const CROSS_AGE_DISABLED_TOOLTIP = {
  title: "Cross-Age Graphs Unavailable",
  body:
    '<p style="margin:0 0 0.6rem;">A single graph spanning <b style="color:#f3e7c4;">Antiquity, Exploration, and Modern</b> isn\'t possible. Civ&nbsp;7 wipes every storage channel a mod could use to carry sampled history across an age transition, so each age can only graph its own data. Use <b style="color:#f3e7c4;">Current&nbsp;Age</b> or any year-range filter instead.</p>' +
    '<p style="margin:0;color:#f3c34c;font-weight:700;">See "About" Tab for more information</p>'
};

// Parse "2375 BCE" → -2375 ; "300 CE" → 300 ; "1450" (no era) → 1450.
function parseGameYear(s) {
  if (typeof s !== "string") return undefined;
  const m = s.match(/(-?\d+)\s*(BCE|BC|AD|CE)?/i);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  if (!isFinite(n)) return undefined;
  const era = (m[2] || "").toUpperCase();
  return era === "BCE" || era === "BC" ? -n : n;
}

function buildTurnYearMap(history) {
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

// Returns {min, max} turn range, or null for "show everything".
export function computeTurnRange(history, filterId) {
  if (!filterId || filterId === "all") return null;
  const samps = history && Array.isArray(history.samples) ? history.samples : [];
  if (samps.length === 0) return null;
  const lastTurn = samps[samps.length - 1].turn;
  const firstTurn = samps[0].turn;
  // Year-relative filters (25/50/100/300/500/1000 years).
  if (/^\d+$/.test(filterId)) {
    const span = parseInt(filterId, 10);
    const turnYear = buildTurnYearMap(history);
    if (turnYear.size === 0) return null;
    const latestYear = turnYear.get(lastTurn) ?? Array.from(turnYear.values()).pop();
    const cutoff = latestYear - span;
    // Find the earliest turn whose year >= cutoff.
    let minTurn = lastTurn;
    for (const s of samps) {
      const y = turnYear.get(s.turn);
      if (typeof y === "number" && y >= cutoff) {
        minTurn = s.turn;
        break;
      }
    }
    // Don't reach back further than the start of the current age. If
    // the requested span pre-dates the latest age boundary, clamp the
    // range to "Current Age" (start-of-age → now) so the chart doesn't
    // mix in stale pre-age data the user didn't ask for.
    const currentAgeStart = (() => {
      const bounds =
        history && Array.isArray(history.ageBoundaries)
          ? history.ageBoundaries.slice().sort((a, b) => (a.turn || 0) - (b.turn || 0))
          : [];
      if (bounds.length === 0) return firstTurn;
      return bounds[bounds.length - 1].turn;
    })();
    if (minTurn < currentAgeStart) minTurn = currentAgeStart;
    return { min: minTurn, max: lastTurn };
  }
  // Age filters use history.ageBoundaries: [{turn, age}, ...]
  const bounds =
    history && Array.isArray(history.ageBoundaries)
      ? history.ageBoundaries.slice().sort((a, b) => (a.turn || 0) - (b.turn || 0))
      : [];
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

// Attach the cross-age "why is this disabled?" tooltip to a pill. Mirrors
// the CSV info-icon pattern: an absolutely-positioned <div> child of the
// pill, styled with the engine's tooltip chrome, toggled on mouseenter /
// mouseleave. Coherent GameFace ignores the native `title` attribute, so
// we render the structured content from CROSS_AGE_DISABLED_TOOLTIP as
// proper HTML — paragraphs, a two-column channel table, a numbered list
// — rather than a wall of monospace text.
function attachDisabledFilterTooltip(pill) {
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

  // Ensure tooltip never overflows the viewport
  function repositionTooltip() {
    if (!tip.parentElement) return;
    const rect = tip.getBoundingClientRect();
    const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
    let dx = 0,
      dy = 0;
    if (rect.right > vw) dx = vw - rect.right - 8;
    if (rect.left < 0) dx = -rect.left + 8;
    if (rect.bottom > vh) dy = vh - rect.bottom - 8;
    if (rect.top < 0) dy = -rect.top + 8;
    if (dx !== 0 || dy !== 0) {
      tip.style.transform = `translate(${dx}px, ${dy}px)`;
    } else {
      tip.style.transform = "";
    }
  }

  tip.addEventListener("transitionend", repositionTooltip);
  tip.addEventListener("mouseenter", repositionTooltip);

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

  pill.appendChild(tip);
  pill.addEventListener("mouseenter", () => {
    tip.style.opacity = "1";
  });
  pill.addEventListener("mouseleave", () => {
    tip.style.opacity = "0";
  });
}

// Pill row of filter buttons. Same single-div pattern that works in
// view-relations.js — class + textContent + click handler. Persists the
// active filter via ctx.setActiveTimeFilter (round-trips through settings).
//
// Filters flagged `disabled:true` in TIME_FILTERS render greyed and
// non-clickable. Coherent GameFace does not surface the native `title`
// attribute, so we attach a custom HTML tooltip (same pattern as the CSV
// info icon above) carrying CROSS_AGE_DISABLED_TOOLTIP on hover.
export function buildTimeFilterRow(activeFilter, onSelect) {
  const row = document.createElement("div");
  row.className = "demographics-chart-time-filter-row font-body text-xs";
  // Row needs to be the positioning context for absolutely-placed
  // tooltips on disabled pills (the pill itself is a flex child and
  // its own bounds are too narrow for a multi-line tooltip).
  row.style.position = "relative";
  for (const f of TIME_FILTERS) {
    const pill = document.createElement("div");
    pill.className = "demographics-chart-time-filter-pill";
    if (f.disabled) {
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
      row.appendChild(pill);
      continue;
    }
    if (f.id === activeFilter) pill.classList.add("is-active");
    pill.textContent = f.label;
    pill.title = f.label + " filter";
    makeClickable(pill, (ev) => {
      ev?.stopPropagation?.();
      playActivate();
      dlog("time-filter click id=" + f.id);
      if (typeof onSelect === "function") onSelect(f.id);
    });
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

export function exportHistoryAsCsv(history, host) {
  if (!history || !Array.isArray(history.samples) || history.samples.length === 0) {
    dlog("CSV export: no samples to write");
    if (host) showCsvToast(host, "No samples yet — play a turn first.", false);
    return;
  }
  // Collect every metric ID we've ever seen so columns are stable.
  const metricKeys = new Set();
  for (const s of history.samples) {
    if (!s?.players) continue;
    for (const pid of Object.keys(s.players)) {
      const m = s.players[pid]?.metrics;
      if (!m) continue;
      for (const k of Object.keys(m)) metricKeys.add(k);
    }
  }
  // Columns ordered SEMANTICALLY by category so related metrics sit
  // next to each other in a spreadsheet (was alphabetical — score next
  // to settlements made no sense). Identity first, then highest-level
  // signal (score), economy, yields, military, science/culture,
  // infrastructure, triumphs, resources, age systems. Anything we don't
  // categorise falls into a tail "other" bucket so newly-added metrics
  // never get silently dropped.
  const CATEGORY_ORDER = {
    score: ["score"],
    economy: ["gdp", "gold", "gpt", "trade", "deals"],
    yields: [
      "production",
      "crops",
      "culture_yield",
      "science_yield",
      "influence",
      "hpt",
      "approval"
    ],
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
  const orderedMetricCols = [];
  const seen = new Set();
  for (const cat of Object.keys(CATEGORY_ORDER)) {
    for (const k of CATEGORY_ORDER[cat]) {
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
  const metricCols = orderedMetricCols;
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
  function csvCell(v) {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  // Format numbers to remove floating-point noise. Integers stay integer;
  // floats round to 2 decimals; very large numbers (GDP, score×1M) stay
  // raw integers but without the spurious .00000001 tail. Drops 50+%
  // of file size and makes the data actually readable in a spreadsheet.
  function fmtNum(v) {
    if (typeof v !== "number" || !isFinite(v)) return "";
    if (Number.isInteger(v)) return String(v);
    if (Math.abs(v) >= 1000) return String(Math.round(v));
    return String(Math.round(v * 100) / 100);
  }
  // Build & DEDUPLICATE rows by (turn, pid). The user's export showed
  // duplicate rows at turns 7, 9, 12, 16 — the sampler can fire twice
  // per turn under certain engine event ordering. Last-write-wins so
  // the latest snapshot for each (turn, pid) is preserved.
  const rowByKey = new Map();
  for (const s of history.samples) {
    if (!s?.players) continue;
    for (const pid of Object.keys(s.players)) {
      const ps = s.players[pid];
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
      rowByKey.set(s.turn + ":" + pid, cells);
    }
  }
  // Emit sorted by (turn ASC, pid ASC) for predictable spreadsheet order.
  const sortedKeys = Array.from(rowByKey.keys()).sort((a, b) => {
    const [ta, pa] = a.split(":").map(Number);
    const [tb, pb] = b.split(":").map(Number);
    return ta - tb || pa - pb;
  });
  const lines = [];
  // ── Metadata header ─────────────────────────────────────────────────
  // `#`-prefixed lines — most importers honor them as comments (Excel
  // skips-on-import; Sheets reads as text; Pandas via comment='#').
  // Provenance + game context so an exported file remains analyzable
  // months later without remembering the game state.
  const metaTime = new Date().toISOString();
  const lastSample = history.samples[history.samples.length - 1];
  const firstSample = history.samples[0];
  const turnsCovered = (lastSample?.turn || 0) - (firstSample?.turn || 0) + 1;
  let gameSpeed = "unknown",
    mapType = "unknown",
    currentAge = "unknown";
  try {
    if (typeof Configuration !== "undefined" && Configuration.getGame) {
      const cfg = Configuration.getGame();
      const speedHash = cfg?.getValue?.("GameSpeed");
      if (speedHash != null && typeof GameInfo !== "undefined") {
        const row = GameInfo.GameSpeeds?.lookup?.(speedHash);
        if (row?.GameSpeedType) {
          gameSpeed = row.GameSpeedType.replace(/^GAMESPEED_/, "").toLowerCase();
        }
      }
    }
  } catch (_) {
    /* */
  }
  try {
    if (typeof Configuration !== "undefined" && Configuration.getMap) {
      const m = Configuration.getMap();
      const ms = m?.mapScript;
      if (typeof ms === "string") mapType = ms;
    }
  } catch (_) {
    /* */
  }
  try {
    if (typeof Game !== "undefined" && Game.age != null) {
      const ageRow = GameInfo.Ages?.lookup?.(Game.age);
      if (ageRow?.AgeType) currentAge = ageRow.AgeType.replace(/^AGE_/, "").toLowerCase();
    }
  } catch (_) {
    /* */
  }
  const civCount = Array.from(rowByKey.keys()).reduce(
    (s, k) => s.add(k.split(":")[1]),
    new Set()
  ).size;
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
  lines.push(headers.join(","));
  for (const k of sortedKeys) lines.push(rowByKey.get(k).join(","));
  const csv = lines.join("\n");

  // ── Size guard ──────────────────────────────────────────────────────
  // Above ~5 MB the clipboard write can fail silently and the log dump
  // stalls the engine for several seconds. Above ~15 MB we've seen the
  // Coherent IPC bridge actually drop the call. Tiered handling:
  //   < 2 MB  → normal flow, clipboard + log
  //   2-8 MB  → clipboard yes, log summary only (no full dump)
  //   > 8 MB  → refuse, tell user to lower sample cap + retry
  const SOFT_LIMIT = 2 * 1024 * 1024;
  const HARD_LIMIT = 8 * 1024 * 1024;
  const sizeMB = (csv.length / (1024 * 1024)).toFixed(1);
  if (csv.length > HARD_LIMIT) {
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
    return;
  }

  // Step 1: try clipboard. UI.isClipboardAvailable() is the canonical gate
  // (cite: pause-menu-model.js:268).
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
    derr("CSV export: clipboard write threw:", e?.message);
  }

  // Step 2: dump to UI.log as a recoverable fallback — BUT only when the
  // CSV is small enough that the log write won't stall the engine. Above
  // SOFT_LIMIT we log a summary so the user can still verify the export
  // happened without freezing the log writer.
  if (csv.length <= SOFT_LIMIT) {
    console.warn(
      "[Demographics.csv-export] BEGIN_DEMOGRAPHICS_CSV " +
        lines.length +
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
        lines.length +
        " rows) — skipping full log dump." +
        " Clipboard write was " +
        (clipboardOk ? "OK" : "FAILED") +
        "."
    );
  }

  // Step 3: visible toast. Account for our 9-line meta header + the
  // single header row when reporting the data-row count to the user.
  const META_LINES = 9; // keep in sync with metadata-header push count above
  const dataRows = lines.length - META_LINES - 1;
  const sizeTag = csv.length >= SOFT_LIMIT ? " · " + sizeMB + " MB" : "";
  if (host) {
    if (clipboardOk) {
      showCsvToast(
        host,
        "Copied · " +
          dataRows +
          " rows × " +
          headers.length +
          " cols" +
          sizeTag +
          " · paste into Excel / Sheets / a .csv file",
        true
      );
    } else {
      showCsvToast(host, "Clipboard unavailable · wrote CSV to UI.log (see logs folder)", false);
    }
  }
  dlog(
    "CSV export complete; clipboard=" +
      clipboardOk +
      " rows=" +
      lines.length +
      " chars=" +
      csv.length
  );
}
