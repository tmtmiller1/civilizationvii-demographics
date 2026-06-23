// screen-demographics.js
//
// The modal panel. A top-level fxs-tab-bar selects between three views:
//   history    - Historical Data (default)  → view-history.js
//   rankings   - World Rankings             → view-settlements.js
//   relations  - Global Relations            → view-relations.js
// Settings live in the native Options screen (Mods → Demographics; see demographics-options.js); a
// toolbar button opens it.
//
// The Controls.define + fxs-tab-bar wiring follows vanilla
// screen-great-works.js (for the tabs) and wonders-screen-continued's
// wonders-screen.js (for the Controls.define call).

import Panel from "/core/ui/panel-support.js";
import * as ViewHistory from "/demographics/ui/screen-demographics/views/history/view-history.js";
import { buildHistoryContext } from "/demographics/ui/screen-demographics/screen/screen-history-context.js";
import { buildPolicyBanner } from "/demographics/ui/screen-demographics/views/history/history-captions.js";
import { viewTabVisibleInTier } from "/demographics/ui/core/demographics-tiers.js";
import {
  EXTERNAL_PANELS,
  migrationHubHasCompanion
} from "/demographics/ui/metrics/demographics-metrics.js";
import { publishEffectivePolicy } from "/demographics/ui/core/demographics-governance.js";

// The two heavy tabs (WorldRankingsAllCivs ~0.9k lines, Relations ~2.5k lines incl. the
// network graph) are imported on first open instead of statically, so they are
// never parsed for sessions that only use the default Historical Data view.
// Specifier per lazy view id, resolved + cached by _renderLazyView.
/** @type {Record<string, string>} */
const LAZY_VIEW_SPECIFIERS = {
  rankings: "/demographics/ui/screen-demographics/views/settlements/view-settlements.js",
  relations: "/demographics/ui/screen-demographics/views/relations/view-relations.js"
};

// Metrics whose chart renderer is loaded on demand (the heavy Conflicts charts,
// behind demographics-chart.js's ensureChartForMetric). Everything else renders
// synchronously from the statically-loaded barrel.
const LAZY_CHART_METRICS = new Set(["wars_gantt", "war_graphs"]);

// ── Local typedefs ──────────────────────────────────────────────────
// The settings/storage/sampler/chart modules are imported dynamically and
// only ever called duck-typed, so their handles stay loose (the engine /
// inter-module boundary). These aliases give the fields a name without
// pinning a structural shape.
/**
 * @typedef {*} SettingsModule The demographics-settings surface
 *   (`getSetting`/`setSetting`).
 */
/**
 * @typedef {*} StorageModule The demographics-storage singleton
 *   (`load`/`flush`).
 */
/**
 * @typedef {*} SamplerModule The demographics-sampler surface (`sampleNow`).
 */
/**
 * @typedef {*} ChartModule The demographics-chart surface.
 */
/**
 * @typedef {object} ViewTab A tab descriptor passed to `fxs-tab-bar`.
 * @property {string} id Tab identifier (also the active-view key).
 * @property {string} label Localization key for the tab label.
 */
const DBG = false;
/**
 * Debug logger, no-op unless {@link DBG} is set.
 * @param {...*} a Values to log.
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.screen]", ...a);
}
/**
 * Error logger; always emits.
 * @param {...*} a Values to log.
 */
function derr(...a) {
  console.error("[Demographics.screen]", ...a);
}

dlog("module evaluating");

/** The view tabs, in display order. The first entry is the default view. */
/** @type {ViewTab[]} */
const VIEW_TABS = [
  { id: "statistics", label: "LOC_DEMOGRAPHICS_TAB_STATISTICS" },
  { id: "migration", label: "LOC_DEMOGRAPHICS_TAB_MIGRATION" },
  { id: "geopolitics", label: "LOC_DEMOGRAPHICS_TAB_GEOPOLITICS" },
  { id: "rankings", label: "LOC_DEMOGRAPHICS_TAB_RANKINGS" }
];

/** Hub view ids that render through the (generalized) history machinery, scoped to the hub. */
const HUB_VIEWS = new Set(["statistics", "migration", "geopolitics"]);

/**
 * Run `fn`, returning its result, or `fb` if it throws. Never throws.
 * @template T
 * @param {() => T} fn Thunk to invoke.
 * @param {T} [fb] Value returned if `fn` throws.
 * @returns {T | undefined} The result of `fn`, or `fb` on error.
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
 * The Demographics modal: a top-level `fxs-tab-bar` that swaps between the
 * history, rankings, and relations views. Restores its
 * view/metric/filter state from persisted settings on attach and persists
 * each change back through the settings module.
 */
class ScreenDemographics extends Panel {
  /** @type {string} The active top-level view id (one of {@link VIEW_TABS}). */
  activeView = "statistics";
  /** @type {string} The active history metric id. */
  activeMetric = "score";
  /** @type {string} The active worldrankings-allcivs/history page id. */
  activePage = "economy";
  /** @type {string} The active time-window filter id. */
  activeTimeFilter = "all";
  /** @type {string} The active radar-chart age selection. */
  activeRadarAge = "current";
  /** @type {Set<string>} Leader keys the user has hidden from charts. */
  hiddenCivs = new Set();
  /** @type {Set<string>} Leader keys the user has focused (highlighted). */
  focusedCivs = new Set();
  /** @type {Pid | null} Player whose resources detail is open, if any. */
  resourcesViewerPid = null;
  /** @type {Pid | null} Player the wars Gantt is filtered to, if any. */
  warsFilterPid = null;
  /** @type {boolean} Whether the wars Gantt includes city-states. */
  warsShowCs = true;
  /** @type {boolean} Whether the wars Gantt shows only active wars. */
  warsActiveOnly = false;
  /** @type {number | null} Selected war (warUniqueID) for the War Graphs sub-tab. */
  warGraphsWarId = null;
  /** @type {string} Crisis Graphs scope ("latest" follows the newest crisis). */
  crisisGraphsAge = "latest";
  /** @type {DemoHistory} The loaded history time series. */
  history = { version: 1, seed: "unknown", samples: [], ageBoundaries: [], eliminated: {} };
  /** @type {StorageModule} The history storage singleton (loaded on attach). */
  storage = null;
  /** @type {ChartModule} The chart module (loaded on attach). */
  chartMod = null;
  /** @type {SamplerModule} The sampler module (loaded on attach). */
  sampler = null;
  /** @type {SettingsModule} The settings module (loaded on attach). */
  settings = null;
  /** @type {*} The view-selector `fxs-tab-bar` custom element (engine DOM). */
  viewTabBar = null;
  /** @type {*} The `tab-selected` listener bound on the tab bar. */
  viewTabBarListener = null;
  /** @type {Record<string, string>} Per-metric remembered time filters. */
  timeFiltersByMetric = {};

  /**
   * Panel lifecycle: configure audio cues before attach.
   */
  onInitialize() {
    dlog("onInitialize");
    super.onInitialize?.();
    // Audio cues - Enhancements.md #1.
    // Panel base class plays data-audio-showing on attach and
    // data-audio-hiding on close when these flags are true. The
    // group-ref scopes lookups to the audio-screen-unlocks bank,
    // which is tuned for stats / info viewing.
    this.enableOpenSound = true;
    this.enableCloseSound = true;
    try {
      if (this.Root && typeof this.Root.setAttribute === "function") {
        this.Root.setAttribute("data-audio-group-ref", "audio-screen-unlocks");
      }
    } catch (_) {
      // this.Root.setAttribute can be absent before the panel template mounts;
      // the audio cue is optional.
    }
  }

  /**
   * Panel lifecycle: wire the close button then lazily import the data
   * modules, restore state, build the tab bar, and render the active view.
   */
  onAttach() {
    dlog("onAttach");
    super.onAttach();
    // Mirror the (possibly persisted) analytics policy to GameConfiguration up front, so the
    // companion Emigration tabs read the player's live choice instead of the wiped localStorage.
    safeCall(() => publishEffectivePolicy());
    // Live-refresh hook: while this screen is open, a change to any Demographics option in the
    // native Options screen calls this to re-publish the policy + re-render, so toggles (e.g. Spoil
    // Guard) take effect immediately instead of needing a close/reopen. Cleared on detach.
    /** @type {*} */ (globalThis).DemographicsLiveRefresh =
      () => safeCall(() => this._liveRefresh());
    this._wireCloseButton();
    this._loadModulesThenRender();
  }

  /**
   * Re-publish the effective analytics policy and re-render the active view. Invoked by the global
   * live-refresh hook when an option changes while this screen is open.
   */
  _liveRefresh() {
    safeCall(() => publishEffectivePolicy());
    this.renderActiveView();
  }

  /**
   * Wire the template's close button to {@link ScreenDemographics#close}.
   */
  _wireCloseButton() {
    safeCall(() => {
      const closeBtn = this.Root.querySelector("[data-ia-close]");
      if (closeBtn) {
        closeBtn.addEventListener("action-activate", () => {
          dlog("close button activated");
          safeCall(() => this.close());
        });
      } else {
        derr("close button not found in template");
      }
    });
  }

  /**
   * Lazily import the storage/chart/sampler/settings modules, then restore
   * state, ensure a sample exists, and render. Errors are logged, not thrown.
   */
  _loadModulesThenRender() {
    Promise.all([
      import("/demographics/ui/storage/demographics-storage.js"),
      import("/demographics/ui/screen-demographics/screen/demographics-chart.js"),
      import("/demographics/ui/sampler/demographics-sampler.js"),
      import("/demographics/ui/core/demographics-settings.js")
    ])
      .then(([storageMod, chartMod, samplerMod, settingsMod]) => {
        this.chartMod = chartMod;
        this.sampler = samplerMod;
        this.settings = settingsMod.DemographicsSettings || settingsMod.default;
        this.storage = storageMod.default || storageMod.DemographicsStorage;

        safeCall(() => this._restoreState());
        safeCall(() => this._loadHistory());
        this._ensureInitialSample();

        this.buildTopTabs();
        this.renderActiveView();
      })
      .catch((e) => derr("module import REJECTED:", e));
  }

  /**
   * Restore the active view / metric / page / time-filter state from
   * persisted settings. Migrates the legacy scalar time filter into the
   * per-metric map.
   */
  _restoreState() {
    // Always OPEN to Global Statistics → Economy → Score, regardless of the last
    // session's location. (Within a session the user's navigation still persists
    // and updates these settings; we just ignore the stored values on each open.)
    this.activeView = "statistics";
    this.activeMetric = "score";
    this.activePage = "economy";
    this._restoreTimeFilters();
    this._restoreViewerPids();
    this._restoreConflictsState();
    this._restoreHiddenCivs();
    dlog(
      "restored: view=",
      this.activeView,
      "metric=",
      this.activeMetric,
      "page=",
      this.activePage,
      "hiddenCivs=",
      this.hiddenCivs.size
    );
  }

  /**
   * Restore the per-metric time-filter map and resolve the active filter.
   *
   * Each metric remembers its own last-chosen filter, defaulting to "age"
   * (Current Age) - except the wars Gantt, which defaults to "50" (a 50-year
   * window) so users land on a useful slice instead of a centuries-wide pile.
   * "all" (All Time) is the default window. The cross-age presets
   * ("age1"/"age2"/"age3") are honored and persist like any other filter, now
   * that history is retained across ages. The legacy scalar `activeTimeFilter`
   * is kept as the fallback so existing user settings migrate cleanly;
   * `resolveActiveFilterState` coerces any unknown id to "all" at render time.
   */
  _restoreTimeFilters() {
    const legacyFilter = this.settings.getSetting("activeTimeFilter", "all");
    const storedMap = this.settings.getSetting("timeFiltersByMetric", null);
    this.timeFiltersByMetric = storedMap && typeof storedMap === "object" ? storedMap : {};
    if (!this.timeFiltersByMetric.wars_gantt) {
      this.timeFiltersByMetric.wars_gantt = "50";
    }
    this.activeTimeFilter = this.timeFiltersByMetric[this.activeMetric] || legacyFilter;
  }

  /**
   * Restore the resources / triumphs / radar-age viewer selections.
   */
  _restoreViewerPids() {
    const rvp = this.settings.getSetting("resourcesViewerPid", null);
    this.resourcesViewerPid = typeof rvp === "number" ? rvp : null;
    this.activeRadarAge = this.settings.getSetting("activeRadarAge", "current");
    this.crisisGraphsAge = this.settings.getSetting("crisisGraphsAge", "latest");
  }

  /**
   * Restore the wars-Gantt filter / city-state / active-only flags.
   */
  _restoreConflictsState() {
    const wfp = this.settings.getSetting("warsFilterPid", null);
    this.warsFilterPid = typeof wfp === "number" ? wfp : null;
    this.warsShowCs = this.settings.getSetting("warsShowCs", true) !== false;
    this.warsActiveOnly = !!this.settings.getSetting("warsActiveOnly", false);
    const wgw = this.settings.getSetting("warGraphsWarId", null);
    this.warGraphsWarId = typeof wgw === "number" ? wgw : null;
  }

  /**
   * Restore the hidden-civ set, coercing legacy numeric entries to strings.
   */
  _restoreHiddenCivs() {
    const hidden = this.settings.getSetting("hiddenCivs", []);
    // Stored values are strings (we normalize to String for the Set
    // key); older payloads may have numeric entries - coerce.
    this.hiddenCivs = new Set((Array.isArray(hidden) ? hidden : []).map((v) => String(v)));
  }

  /**
   * Load the history blob from storage into {@link ScreenDemographics#history}.
   */
  _loadHistory() {
    if (this.storage && typeof this.storage.load === "function") {
      this.history = this.storage.load() || this.history;
    }
    dlog("history loaded; sample count=", this.history.samples?.length || 0);
  }

  /**
   * If the history is empty, force an on-demand sample and reload it so the
   * first render shows data rather than an empty chart.
   */
  _ensureInitialSample() {
    if (!(this.history.samples?.length > 0) && this.sampler?.sampleNow) {
      dlog("history empty ; forcing on-demand sampleNow()");
      safeCall(() => {
        this.sampler.sampleNow();
        if (this.storage?.load) this.history = this.storage.load() || this.history;
        dlog("post-sampleNow sample count=", this.history.samples?.length || 0);
      });
    }
  }

  /**
   * Build the `fxs-tab-bar` view selector, wire its `tab-selected` listener,
   * and append it to the template host.
   */
  buildTopTabs() {
    const host = this.Root.querySelector(".demographics-view-tab-host");
    if (!host) {
      derr("view-tab-bar host missing");
      return;
    }
    const tabBar = this._makeViewTabBar();
    host.appendChild(tabBar);
    this.viewTabBar = tabBar;
    dlog("view tab bar built; active=", this.activeView);
  }

  /**
   * Create and configure the `fxs-tab-bar` view selector (items, selection, nav hints, listener).
   * @returns {HTMLElement} The configured tab bar.
   */
  _makeViewTabBar() {
    const tabBar = document.createElement("fxs-tab-bar");
    tabBar.classList.add("demographics-view-tabs", "w-full", "font-title", "text-sm");
    tabBar.setAttribute("data-audio-group-ref", "audio-screen-unlocks");
    tabBar.setAttribute("tab-item-class", "font-title text-base");
    const visibleTabs = this._visibleViewTabs();
    tabBar.setAttribute("tab-items", JSON.stringify(visibleTabs));
    const idx = Math.max(0, visibleTabs.findIndex((v) => v.id === this.activeView));
    tabBar.setAttribute("selected-tab-index", String(idx));
    this._applyTabBarNavHints(tabBar);
    this.viewTabBarListener = (/** @type {*} */ event) => this._onViewTabSelected(event);
    tabBar.addEventListener("tab-selected", this.viewTabBarListener);
    return tabBar;
  }

  /**
   * The view tabs visible under the active UI complexity tier (P1.5), clamping
   * the active view to a visible one (the Relations tab is hidden at Basic).
   * @returns {ViewTab[]} The visible tab descriptors.
   */
  _visibleViewTabs() {
    const base = VIEW_TABS.filter((v) => viewTabVisibleInTier(v.id));
    // The Migration hub exists only to host the Emigration companion (its sole native page,
    // Population, moves to the Society page when standalone — see placePopulationAnchor). So
    // hide the tab entirely when Emigration isn't active, and when it IS, label it "Emigration"
    // so the player can tell the companion mod loaded.
    const hasEmigration = migrationHubHasCompanion();
    // Companion mods can also contribute a top-level view tab (a legacy `topLevel` registerPanel,
    // e.g. an un-updated Emigration). Insert those right after Migration so they read as
    // migration-adjacent, in registration order.
    const ext = this._topLevelPanelTabs();
    /** @type {ViewTab[]} */
    const visibleTabs = [];
    for (const v of base) {
      if (v.id === "migration") {
        if (!hasEmigration) continue;
        visibleTabs.push({ id: v.id, label: "LOC_DEMOGRAPHICS_TAB_EMIGRATION" });
        visibleTabs.push(...ext);
        continue;
      }
      visibleTabs.push(v);
    }
    // Legacy safety: a top-level companion tab with the Migration hub hidden — still surface it.
    if (!hasEmigration && ext.length) visibleTabs.push(...ext);
    if (!visibleTabs.some((v) => v.id === this.activeView)) this.activeView = "statistics";
    return visibleTabs;
  }

  /**
   * Companion top-level panel view tabs (e.g. Emigration), from the registered external panels
   * flagged `topLevel`. Empty when no such companion is installed.
   * @returns {ViewTab[]} Tab descriptors.
   */
  _topLevelPanelTabs() {
    return EXTERNAL_PANELS
      .filter((p) => p && p.topLevel)
      .map((p) => ({ id: p.id, label: p.pageLabel || p.title || p.id }));
  }

  /**
   * Apply nav-help class hints to the tab bar on non-mobile experiences.
   * @param {HTMLElement} tabBar The tab-bar element to annotate.
   */
  _applyTabBarNavHints(tabBar) {
    try {
      if (
        typeof UI !== "undefined" &&
        typeof UI.getViewExperience === "function" &&
        typeof UIViewExperience !== "undefined" &&
        UI.getViewExperience() !== UIViewExperience.Mobile
      ) {
        tabBar.setAttribute("nav-help-right-class", "relative right-0");
        tabBar.setAttribute("nav-help-left-class", "relative left-0");
      }
    } catch (_) {
      // UI.getViewExperience / UIViewExperience are absent in headless
      // contexts; nav hints are cosmetic.
    }
  }

  /**
   * Handle a `tab-selected` event: switch the active view, persist it, and
   * re-render. Ignores re-selection of the current view.
   * @param {*} event The `tab-selected` CustomEvent.
   */
  _onViewTabSelected(event) {
    const id = event?.detail?.selectedItem?.id;
    if (!id || id === this.activeView) return;
    dlog("view-tab-selected:", id);
    this.activeView = id;
    // Open the new hub on its FIRST page + first metric/member, not a stale prior selection, so
    // e.g. Migration always lands on "Population & Migration" → Population. (Resets in-memory; the
    // resolver picks the first visible page/metric.)
    this.activePage = "";
    this.activeMetric = "";
    safeCall(() => ViewHistory.resetGroupSelections());
    // Rankings always opens on its first sub-tab (Civilization Ranking), not a stale prior sub-tab.
    if (id === "rankings") safeCall(() => this.settings.setSetting("settlementsSubTab", "civranking"));
    safeCall(() => this.settings.setSetting("activeView", id));
    this.renderActiveView();
  }

  /**
   * Reload the history from storage (if available) and re-render the view.
   * Wired into views as their `requestReload` callback.
   */
  _reload() {
    safeCall(() => {
      if (this.storage?.load) this.history = this.storage.load() || this.history;
    });
    this.renderActiveView();
  }

  /**
   * Clear the view host and render the view selected by `activeView`. View
   * render errors are logged, not thrown.
   */
  renderActiveView() {
    // The Historical Data view and companion top-level panels render the policy banner INSIDE the
    // view (at the bottom); every other view (Rankings / Relations) shows it via the banner-host,
    // which now sits BELOW the view host so it lands at the bottom too. Either way the banner-host
    // is cleared so a stale banner never lingers across view switches.
    const usesHistoryRender = HUB_VIEWS.has(this.activeView)
      || this._topLevelPanelTabs().some((v) => v.id === this.activeView);
    safeCall(() => this._renderPolicyBanner(usesHistoryRender));
    const host = this.Root.querySelector(".demographics-view-host");
    if (!host) {
      derr("view-host missing");
      return;
    }
    while (host.firstChild) host.removeChild(host.firstChild);

    try {
      this._dispatchView(host);
    } catch (e) {
      derr("renderActiveView threw:", e);
    }
  }

  /**
   * Render (or clear) the analytics-governance policy banner above the view host
   * (combined design plan P0.1). Shown whenever the effective policy withholds
   * data, so every player can see the comparative analytics are constrained -
   * and whether the multiplayer host (not just their own preference) is the
   * binding constraint. Re-evaluated on every view render.
   */
  /**
   * Render (or clear) the analytics-governance policy banner in the screen-level banner host.
   * @param {boolean} [renderedInView] When true the active view renders the banner itself (below
   *   its sub-tabs), so this only clears the host to avoid a duplicate.
   */
  _renderPolicyBanner(renderedInView) {
    const banhost = this.Root.querySelector(".demographics-policy-banner-host");
    if (!banhost) return;
    while (banhost.firstChild) banhost.removeChild(banhost.firstChild);
    if (renderedInView) return;
    const banner = buildPolicyBanner();
    if (banner) banhost.appendChild(banner);
  }

  /**
   * Render the active view into `host`, dispatching on `activeView`.
   * @param {HTMLElement} host The cleared view-host element.
   */
  _dispatchView(host) {
    // A companion top-level panel (e.g. a legacy Emigration): render the history machinery pinned
    // to that panel's page (its sub-tabs + native charts), with no page-tab row.
    if (this._topLevelPanelTabs().some((v) => v.id === this.activeView)) {
      this._renderHistoricalDataView(host, { onlyPage: this.activeView });
      return;
    }
    // Rankings is its own (settlements) view; the three metric hubs render the history machinery
    // scoped to the hub's pages.
    if (this.activeView === "rankings") {
      this._renderLazyView(host, this.activeView);
      return;
    }
    this._renderHistoricalDataView(host, { hub: HUB_VIEWS.has(this.activeView) ? this.activeView : "statistics" });
  }

  /**
   * Render a lazily-imported tab (WorldRankingsAllCivs / Relations), importing its module on
   * first open and caching it. The host was already cleared by renderActiveView,
   * so it stays empty for the (local, fast) import; the render is skipped if the
   * user switched tabs before it resolved, and re-clears defensively first.
   * @param {HTMLElement} host The cleared view-host element.
   * @param {string} id The active view id ("worldrankings-allcivs" | "relations").
   */
  _renderLazyView(host, id) {
    const args = { history: this.history, settings: this.settings };
    const cache =
      this._lazyViews || (this._lazyViews = /** @type {Record<string, *>} */ ({}));
    const cached = cache[id];
    if (cached) {
      cached.render(host, args);
      return;
    }
    import(LAZY_VIEW_SPECIFIERS[id])
      .then((mod) => {
        cache[id] = mod;
        if (this.activeView !== id) return; // user navigated away while loading
        while (host.firstChild) host.removeChild(host.firstChild);
        mod.render(host, { history: this.history, settings: this.settings });
      })
      .catch((/** @type {*} */ e) => derr("lazy view load failed:", id, e));
  }

  /**
   * Render the Historical Data view. Common metrics render synchronously from
   * the statically-loaded chart barrel; the heavy Conflicts metrics first
   * ensure their on-demand chart module is imported, then render once. The
   * re-render is skipped if the user navigated away while the import was in
   * flight.
   * @param {HTMLElement} host The cleared view-host element.
   * @param {{hub?:string, onlyPage?:string}} [opts] `hub` scopes the page row to one hub;
   *   `onlyPage` pins a single companion page (no page-tab row). Omit both for the legacy
   *   all-pages view.
   */
  _renderHistoricalDataView(host, opts) {
    const onlyPage = opts && opts.onlyPage;
    const metric = this.activeMetric;
    // The lazy-chart path applies to the hub views' heavy Wars/Crises metrics; a pinned companion
    // page renders synchronously.
    if (
      !onlyPage &&
      this.chartMod &&
      typeof this.chartMod.ensureChartForMetric === "function" &&
      LAZY_CHART_METRICS.has(metric)
    ) {
      this.chartMod
        .ensureChartForMetric(metric)
        .then(() => {
          if (!HUB_VIEWS.has(this.activeView) || this.activeMetric !== metric) return;
          while (host.firstChild) host.removeChild(host.firstChild);
          ViewHistory.render(host, buildHistoryContext(this), opts);
        })
        .catch((/** @type {*} */ e) => derr("lazy chart load failed:", metric, e));
      return;
    }
    ViewHistory.render(host, buildHistoryContext(this), opts);
  }

  /**
   * Set a state field, persist the value under a settings key, and re-render.
   * @param {string} field The instance field name to assign.
   * @param {string} settingKey The settings key to persist under.
   * @param {*} value The new value.
   */
  _setAndPersist(field, settingKey, value) {
    /** @type {*} */ (this)[field] = value;
    safeCall(() => this.settings.setSetting(settingKey, value));
    this.renderActiveView();
  }

  /**
   * Toggle a leader key in the focused-civs set and re-render.
   * @param {string} leaderKey The leader key to toggle.
   */
  _toggleFocusCiv(leaderKey) {
    if (!leaderKey) return;
    const k = String(leaderKey);
    if (this.focusedCivs.has(k)) this.focusedCivs.delete(k);
    else this.focusedCivs.add(k);
    this.renderActiveView();
  }

  /**
   * Clear all focused civs and re-render.
   */
  _clearFocus() {
    this.focusedCivs.clear();
    this.renderActiveView();
  }

  /**
   * Switch the active metric, persist it, reset the time filter to the
   * metric's default, and re-render.
   *
   * Switching metric resets to a fixed default, NOT whatever filter the user
   * last selected for it. Per-metric memory was confusing - users expect each
   * graph to start from a known state. "all" (All Time) is that default, so
   * every graph opens on its full cross-age history.
   * @param {string} id The metric id to activate.
   */
  _setActiveMetric(id) {
    this.activeMetric = id;
    safeCall(() => this.settings.setSetting("activeMetric", id));
    this.activeTimeFilter = "all";
    this.renderActiveView();
  }

  /**
   * Set the active time filter, persisting BOTH the per-metric map and the
   * legacy scalar so older settings consumers keep working, then re-render.
   * @param {string} id The time-filter id to activate.
   */
  _setActiveTimeFilter(id) {
    this.activeTimeFilter = id;
    if (!this.timeFiltersByMetric) this.timeFiltersByMetric = {};
    this.timeFiltersByMetric[this.activeMetric] = id;
    safeCall(() => this.settings.setSetting("activeTimeFilter", id));
    safeCall(() => this.settings.setSetting("timeFiltersByMetric", this.timeFiltersByMetric));
    this.renderActiveView();
  }

  /**
   * Toggle a leader key in the hidden-civs set, persist the set, and re-render.
   * @param {string} leaderKey The leader key to toggle.
   */
  toggleCiv(leaderKey) {
    if (!leaderKey) return;
    const k = String(leaderKey);
    if (this.hiddenCivs.has(k)) this.hiddenCivs.delete(k);
    else this.hiddenCivs.add(k);
    dlog("toggle civ:", k, "hidden now:", this.hiddenCivs.has(k));
    safeCall(() => this.settings.setSetting("hiddenCivs", Array.from(this.hiddenCivs)));
    this.renderActiveView();
  }

  /**
   * Show or hide every civ at once (the legend's All/None controls): All clears
   * the hidden set; None hides all the given leader keys. Persists + re-renders.
   * @param {boolean} hide True to hide all `keys`, false to show all civs.
   * @param {string[]} keys The leader keys to hide (None mode).
   */
  setAllCivsHidden(hide, keys) {
    if (hide) {
      for (const k of keys || []) this.hiddenCivs.add(String(k));
    } else {
      this.hiddenCivs.clear();
    }
    safeCall(() => this.settings.setSetting("hiddenCivs", Array.from(this.hiddenCivs)));
    this.renderActiveView();
  }

  /**
   * Panel lifecycle: detach the tab-bar listener and flush buffered storage
   * writes so closing the panel saves all in-flight samples.
   */
  onDetach() {
    dlog("onDetach");
    // stop options from poking a closed screen
    /** @type {*} */ (globalThis).DemographicsLiveRefresh = null;
    if (this.viewTabBar && this.viewTabBarListener) {
      safeCall(() => this.viewTabBar.removeEventListener("tab-selected", this.viewTabBarListener));
    }
    // Flush any buffered storage writes (perf-mode) so closing the
    // panel - or the player tabbing away - saves all in-flight samples.
    safeCall(() => {
      if (this.storage && typeof this.storage.flush === "function") this.storage.flush();
    });
    super.onDetach();
  }

  /**
   * Panel lifecycle: another context was pushed ON TOP of us (e.g. the native Options screen,
   * opened from the Options button). Our window is `position:fixed; z-index:90` to float above
   * queued dock popups, which would also float it above that pushed screen, so drop our stacking
   * while we're not the focused context, letting the screen on top show and be usable. Restored in
   * onReceiveFocus.
   */
  onLoseFocus() {
    this.Root.classList.add("demographics-screen-obscured");
    super.onLoseFocus();
  }

  /**
   * Panel lifecycle: the context on top of us was popped (e.g. the Options screen closed) and we're
   * the focused context again, restore our stacking so we float above queued popups as before.
   */
  onReceiveFocus() {
    this.Root.classList.remove("demographics-screen-obscured");
    super.onReceiveFocus();
  }

  /**
   * Close the panel.
   */
  close() {
    dlog("close()");
    super.close?.();
  }
}

try {
  if (typeof Controls !== "undefined" && typeof Controls.define === "function") {
    dlog("about to call Controls.define('screen-demographics', ...)");
    Controls.define("screen-demographics", {
      createInstance: ScreenDemographics,
      description: "Demographics , multi-view stats panel.",
      // GameFace honors only the FIRST CSS @import, so load each split stylesheet
      // here (cascade order preserved) instead of @import-chaining them through
      // screen-demographics.css.
      styles: [
        "fs://game/demographics/ui/screen-demographics/styles/screen-demographics-base.css",
        "fs://game/demographics/ui/screen-demographics/styles/screen-demographics-worldrankings-allcivs.css",
        "fs://game/demographics/ui/screen-demographics/styles/screen-demographics-relations-options.css",
        "fs://game/demographics/ui/screen-demographics/styles/screen-demographics-conflicts-history.css",
        "fs://game/demographics/ui/screen-demographics/styles/screen-demographics-settlements.css"
      ],
      content: ["fs://game/demographics/ui/screen-demographics/screen-demographics.html"],
      attributes: [],
      classNames: ["demographics-screen", "w-full", "h-full"]
    });
    dlog("Controls.define returned");
  } else {
    derr("Controls.define unavailable");
  }
} catch (e) {
  derr("Controls.define THREW:", e);
}
