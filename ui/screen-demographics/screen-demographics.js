// screen-demographics.js
//
// The modal panel. A top-level fxs-tab-bar selects between four views:
//   history    — Historical Data (default)  → view-history.js
//   factbook   — World Factbook              → view-factbook.js
//   relations  — Global Relations            → view-relations.js
//   options    — Options                     → view-options.js
//
// The Controls.define + fxs-tab-bar wiring follows vanilla
// screen-great-works.js (for the tabs) and wonders-screen-continued's
// wonders-screen.js (for the Controls.define call).

import Panel from "/core/ui/panel-support.js";
import * as ViewHistory from "/demographics/ui/screen-demographics/views/view-history.js";
import * as ViewFactbook from "/demographics/ui/screen-demographics/views/view-factbook.js";
import * as ViewRelations from "/demographics/ui/screen-demographics/views/view-relations.js";
import * as ViewOptions from "/demographics/ui/screen-demographics/views/view-options.js";

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
/**
 * The history view's mutation callbacks. Each updates a state field, persists
 * it where applicable, and re-renders.
 * @typedef {object} HistoryCallbacks
 * @property {(id: string) => void} setActiveRadarAge Set the radar-chart age.
 * @property {(pid: Pid | null) => void} setWarsFilterPid Filter wars by player.
 * @property {(v: boolean) => void} setWarsShowCs Toggle city-states in wars.
 * @property {(v: boolean) => void} setWarsActiveOnly Toggle active-only wars.
 * @property {(pid: Pid | null) => void} setResourcesViewerPid Open resources.
 * @property {(pid: Pid | null) => void} setTriumphsViewerPid Open triumphs.
 * @property {(leaderKey: string) => void} toggleFocusCiv Toggle a focused civ.
 * @property {() => void} clearFocus Clear all focused civs.
 * @property {(id: string) => void} setActiveMetric Switch the active metric.
 * @property {(id: string) => void} setActivePage Switch the active page.
 * @property {(id: string) => void} setActiveTimeFilter Switch the time filter.
 * @property {(leaderKey: string) => void} toggleCiv Toggle a hidden civ.
 * @property {() => void} requestReload Reload history and re-render.
 */

const DBG = false;
/**
 * Debug logger, no-op unless {@link DBG} is set.
 * @param {...*} a Values to log.
 * @returns {void}
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.screen]", ...a);
}
/**
 * Error logger; always emits.
 * @param {...*} a Values to log.
 * @returns {void}
 */
function derr(...a) {
  console.error("[Demographics.screen]", ...a);
}

dlog("module evaluating");

/** The view tabs, in display order. The first entry is the default view. */
/** @type {ViewTab[]} */
const VIEW_TABS = [
  { id: "history", label: "LOC_DEMOGRAPHICS_TAB_HISTORY" },
  { id: "factbook", label: "LOC_DEMOGRAPHICS_TAB_FACTBOOK" },
  { id: "relations", label: "LOC_DEMOGRAPHICS_TAB_RELATIONS" },
  { id: "options", label: "LOC_DEMOGRAPHICS_TAB_OPTIONS" }
];

/** Filters disabled in the runtime (see CROSS_AGE_DISABLED_TOOLTIP). */
const DISABLED_FILTERS = new Set(["all", "age1", "age2", "age3"]);

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
 * history, factbook, relations, options, and about views. Restores its
 * view/metric/filter state from persisted settings on attach and persists
 * each change back through the settings module.
 */
class ScreenDemographics extends Panel {
  /** @type {string} The active top-level view id (one of {@link VIEW_TABS}). */
  activeView = "history";
  /** @type {string} The active history metric id. */
  activeMetric = "score";
  /** @type {string} The active factbook/history page id. */
  activePage = "economy";
  /** @type {string} The active time-window filter id. */
  activeTimeFilter = "age";
  /** @type {string} The active radar-chart age selection. */
  activeRadarAge = "current";
  /** @type {Set<string>} Leader keys the user has hidden from charts. */
  hiddenCivs = new Set();
  /** @type {Set<string>} Leader keys the user has focused (highlighted). */
  focusedCivs = new Set();
  /** @type {Pid | null} Player whose resources detail is open, if any. */
  resourcesViewerPid = null;
  /** @type {Pid | null} Player whose triumphs detail is open, if any. */
  triumphsViewerPid = null;
  /** @type {Pid | null} Player the wars Gantt is filtered to, if any. */
  warsFilterPid = null;
  /** @type {boolean} Whether the wars Gantt includes city-states. */
  warsShowCs = true;
  /** @type {boolean} Whether the wars Gantt shows only active wars. */
  warsActiveOnly = false;
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
   * @returns {void}
   */
  onInitialize() {
    dlog("onInitialize");
    super.onInitialize?.();
    // Audio cues — Enhancements.md #1.
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
      /* */
    }
  }

  /**
   * Panel lifecycle: wire the close button then lazily import the data
   * modules, restore state, build the tab bar, and render the active view.
   * @returns {void}
   */
  onAttach() {
    dlog("onAttach");
    super.onAttach();
    this._wireCloseButton();
    this._loadModulesThenRender();
  }

  /**
   * Wire the template's close button to {@link ScreenDemographics#close}.
   * @returns {void}
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
   * @returns {void}
   */
  _loadModulesThenRender() {
    Promise.all([
      import("/demographics/ui/demographics-storage.js"),
      import("/demographics/ui/screen-demographics/demographics-chart.js"),
      import("/demographics/ui/demographics-sampler.js"),
      import("/demographics/ui/demographics-settings.js")
    ])
      .then(([storageMod, chartMod, samplerMod, settingsMod]) => {
        this.chartMod = chartMod;
        this.sampler = samplerMod;
        this.settings = settingsMod.DemographicsSettings || settingsMod.default;
        this.storage = storageMod.default || storageMod.DemographicsStorage;

        safeCall(() => this._restoreState());
        safeCall(() => this._loadHistory());
        this._ensureInitialSample();

        this.buildViewTabBar();
        this.renderActiveView();
      })
      .catch((e) => derr("module import REJECTED:", e));
  }

  /**
   * Restore the active view / metric / page / time-filter state from
   * persisted settings. Coerces away now-disabled filters and migrates the
   * legacy scalar time filter into the per-metric map.
   * @returns {void}
   */
  _restoreState() {
    this.activeView = this.settings.getSetting("activeView", "history");
    if (!VIEW_TABS.some((v) => v.id === this.activeView)) this.activeView = "history";
    this.activeMetric = this.settings.getSetting("activeMetric", "score");
    this.activePage = this.settings.getSetting("activePage", "economy");
    this._restoreTimeFilters();
    this._restoreViewerPids();
    this._restoreWarsState();
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
   * (Current Age) — except the wars Gantt, which defaults to "50" (a 50-year
   * window) so users land on a useful slice instead of a centuries-wide pile.
   * The cross-age filters ("all", "age1"/"age2"/"age3") are disabled in the
   * runtime. The legacy scalar `activeTimeFilter` is kept as the fallback so
   * existing user settings migrate cleanly; a now-disabled value coerces to
   * "age".
   * @returns {void}
   */
  _restoreTimeFilters() {
    const legacyFilter = this.settings.getSetting("activeTimeFilter", "age");
    const storedMap = this.settings.getSetting("timeFiltersByMetric", null);
    this.timeFiltersByMetric = storedMap && typeof storedMap === "object" ? storedMap : {};
    // Migrate any persisted disabled selections to "age".
    for (const k of Object.keys(this.timeFiltersByMetric)) {
      if (DISABLED_FILTERS.has(this.timeFiltersByMetric[k])) {
        this.timeFiltersByMetric[k] = "age";
      }
    }
    if (!this.timeFiltersByMetric.wars_gantt) {
      this.timeFiltersByMetric.wars_gantt = "50";
    }
    const resolvedLegacy = DISABLED_FILTERS.has(legacyFilter) ? "age" : legacyFilter;
    this.activeTimeFilter = this.timeFiltersByMetric[this.activeMetric] || resolvedLegacy;
  }

  /**
   * Restore the resources / triumphs / radar-age viewer selections.
   * @returns {void}
   */
  _restoreViewerPids() {
    const rvp = this.settings.getSetting("resourcesViewerPid", null);
    this.resourcesViewerPid = typeof rvp === "number" ? rvp : null;
    const tvp = this.settings.getSetting("triumphsViewerPid", null);
    this.triumphsViewerPid = typeof tvp === "number" ? tvp : null;
    this.activeRadarAge = this.settings.getSetting("activeRadarAge", "current");
  }

  /**
   * Restore the wars-Gantt filter / city-state / active-only flags.
   * @returns {void}
   */
  _restoreWarsState() {
    const wfp = this.settings.getSetting("warsFilterPid", null);
    this.warsFilterPid = typeof wfp === "number" ? wfp : null;
    this.warsShowCs = this.settings.getSetting("warsShowCs", true) !== false;
    this.warsActiveOnly = !!this.settings.getSetting("warsActiveOnly", false);
  }

  /**
   * Restore the hidden-civ set, coercing legacy numeric entries to strings.
   * @returns {void}
   */
  _restoreHiddenCivs() {
    const hidden = this.settings.getSetting("hiddenCivs", []);
    // Stored values are strings (we normalize to String for the Set
    // key); older payloads may have numeric entries — coerce.
    this.hiddenCivs = new Set((Array.isArray(hidden) ? hidden : []).map((v) => String(v)));
  }

  /**
   * Load the history blob from storage into {@link ScreenDemographics#history}.
   * @returns {void}
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
   * @returns {void}
   */
  _ensureInitialSample() {
    if (!(this.history.samples?.length > 0) && this.sampler?.sampleNow) {
      dlog("history empty — forcing on-demand sampleNow()");
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
   * @returns {void}
   */
  buildViewTabBar() {
    const host = this.Root.querySelector(".demographics-view-tab-host");
    if (!host) {
      derr("view-tab-bar host missing");
      return;
    }
    const tabBar = document.createElement("fxs-tab-bar");
    tabBar.classList.add("demographics-view-tabs", "w-full", "font-title", "text-sm");
    tabBar.setAttribute("data-audio-group-ref", "audio-screen-unlocks");
    tabBar.setAttribute("tab-item-class", "font-title text-base");
    tabBar.setAttribute("tab-items", JSON.stringify(VIEW_TABS));
    const idx = Math.max(
      0,
      VIEW_TABS.findIndex((v) => v.id === this.activeView)
    );
    tabBar.setAttribute("selected-tab-index", String(idx));
    this._applyTabBarNavHints(tabBar);
    this.viewTabBarListener = (/** @type {*} */ event) => this._onViewTabSelected(event);
    tabBar.addEventListener("tab-selected", this.viewTabBarListener);
    host.appendChild(tabBar);
    this.viewTabBar = tabBar;
    dlog("view tab bar built; active=", this.activeView, "index=", idx);
  }

  /**
   * Apply nav-help class hints to the tab bar on non-mobile experiences.
   * @param {HTMLElement} tabBar The tab-bar element to annotate.
   * @returns {void}
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
      /* */
    }
  }

  /**
   * Handle a `tab-selected` event: switch the active view, persist it, and
   * re-render. Ignores re-selection of the current view.
   * @param {*} event The `tab-selected` CustomEvent.
   * @returns {void}
   */
  _onViewTabSelected(event) {
    const id = event?.detail?.selectedItem?.id;
    if (!id || id === this.activeView) return;
    dlog("view-tab-selected:", id);
    this.activeView = id;
    safeCall(() => this.settings.setSetting("activeView", id));
    this.renderActiveView();
  }

  /**
   * Reload the history from storage (if available) and re-render the view.
   * Wired into views as their `requestReload` callback.
   * @returns {void}
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
   * @returns {void}
   */
  renderActiveView() {
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
   * Render the active view into `host`, dispatching on `activeView`.
   * @param {HTMLElement} host The cleared view-host element.
   * @returns {void}
   */
  _dispatchView(host) {
    switch (this.activeView) {
      case "factbook":
        ViewFactbook.render(host, { history: this.history, settings: this.settings });
        break;
      case "relations":
        ViewRelations.render(host, { history: this.history, settings: this.settings });
        break;
      case "options":
        ViewOptions.render(host, {
          settings: this.settings,
          storage: this.storage,
          sampler: this.sampler,
          history: this.history,
          requestReload: () => this._reload()
        });
        break;
      case "history":
      default:
        ViewHistory.render(host, this._buildHistoryContext());
        break;
    }
  }

  /**
   * Build the context object passed to the history view, including all of its
   * state values and the callbacks that mutate-then-persist-then-rerender.
   * @returns {*} The history view render context.
   */
  _buildHistoryContext() {
    return {
      history: this.history,
      activeMetric: this.activeMetric,
      activePage: this.activePage,
      activeTimeFilter: this.activeTimeFilter,
      hiddenCivs: this.hiddenCivs,
      focusedCivs: this.focusedCivs,
      resourcesViewerPid: this.resourcesViewerPid,
      triumphsViewerPid: this.triumphsViewerPid,
      chartMod: this.chartMod,
      settings: this.settings,
      storage: this.storage,
      activeRadarAge: this.activeRadarAge,
      warsFilterPid: this.warsFilterPid,
      warsShowCs: this.warsShowCs,
      warsActiveOnly: this.warsActiveOnly,
      ...this._buildHistoryCallbacks()
    };
  }

  /**
   * Build the history view's mutation callbacks. Each updates a state field,
   * persists it where applicable, and re-renders.
   * @returns {HistoryCallbacks} The callback bag merged into the history context.
   */
  _buildHistoryCallbacks() {
    return {
      setActiveRadarAge: (id) => this._setAndPersist("activeRadarAge", "activeRadarAge", id),
      setWarsFilterPid: (pid) => this._setAndPersist("warsFilterPid", "warsFilterPid", pid),
      setWarsShowCs: (v) => this._setAndPersist("warsShowCs", "warsShowCs", !!v),
      setWarsActiveOnly: (v) => this._setAndPersist("warsActiveOnly", "warsActiveOnly", !!v),
      setResourcesViewerPid: (pid) =>
        this._setAndPersist("resourcesViewerPid", "resourcesViewerPid", pid),
      setTriumphsViewerPid: (pid) =>
        this._setAndPersist("triumphsViewerPid", "triumphsViewerPid", pid),
      toggleFocusCiv: (leaderKey) => this._toggleFocusCiv(leaderKey),
      clearFocus: () => this._clearFocus(),
      setActiveMetric: (id) => this._setActiveMetric(id),
      setActivePage: (id) => this._setAndPersist("activePage", "activePage", id),
      setActiveTimeFilter: (id) => this._setActiveTimeFilter(id),
      toggleCiv: (leaderKey) => this.toggleCiv(leaderKey),
      requestReload: () => this._reload()
    };
  }

  /**
   * Set a state field, persist the value under a settings key, and re-render.
   * @param {string} field The instance field name to assign.
   * @param {string} settingKey The settings key to persist under.
   * @param {*} value The new value.
   * @returns {void}
   */
  _setAndPersist(field, settingKey, value) {
    /** @type {*} */ (this)[field] = value;
    safeCall(() => this.settings.setSetting(settingKey, value));
    this.renderActiveView();
  }

  /**
   * Toggle a leader key in the focused-civs set and re-render.
   * @param {string} leaderKey The leader key to toggle.
   * @returns {void}
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
   * @returns {void}
   */
  _clearFocus() {
    this.focusedCivs.clear();
    this.renderActiveView();
  }

  /**
   * Switch the active metric, persist it, reset the time filter to the
   * metric's default, and re-render.
   *
   * Switching metric resets to that metric's unique default, NOT whatever
   * filter the user last selected for it. Per-metric memory was confusing —
   * users expect each graph to start from a known state. "age" (Current Age)
   * is the widest non-disabled filter, so it's the safest default across every
   * metric — including wars_gantt, where narrower windows hide wars that
   * happened earlier in the age.
   * @param {string} id The metric id to activate.
   * @returns {void}
   */
  _setActiveMetric(id) {
    this.activeMetric = id;
    safeCall(() => this.settings.setSetting("activeMetric", id));
    this.activeTimeFilter = "age";
    this.renderActiveView();
  }

  /**
   * Set the active time filter, persisting BOTH the per-metric map and the
   * legacy scalar so older settings consumers keep working, then re-render.
   * @param {string} id The time-filter id to activate.
   * @returns {void}
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
   * @returns {void}
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
   * Panel lifecycle: detach the tab-bar listener and flush buffered storage
   * writes so closing the panel saves all in-flight samples.
   * @returns {void}
   */
  onDetach() {
    dlog("onDetach");
    if (this.viewTabBar && this.viewTabBarListener) {
      safeCall(() => this.viewTabBar.removeEventListener("tab-selected", this.viewTabBarListener));
    }
    // Flush any buffered storage writes (perf-mode) so closing the
    // panel — or the player tabbing away — saves all in-flight samples.
    safeCall(() => {
      if (this.storage && typeof this.storage.flush === "function") this.storage.flush();
    });
    super.onDetach();
  }

  /**
   * Close the panel.
   * @returns {void}
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
      description: "Demographics — multi-view stats panel.",
      styles: ["fs://game/demographics/ui/screen-demographics/screen-demographics.css"],
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
