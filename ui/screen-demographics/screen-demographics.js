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
import * as ViewAbout from "/demographics/ui/screen-demographics/views/view-about.js";

const DBG = true;
function dlog(...a) {
  if (DBG) console.warn("[Demographics.screen]", ...a);
}
function derr(...a) {
  console.error("[Demographics.screen]", ...a);
}

dlog("module evaluating");

const VIEW_TABS = [
  { id: "history", label: "LOC_DEMOGRAPHICS_TAB_HISTORY" },
  { id: "factbook", label: "LOC_DEMOGRAPHICS_TAB_FACTBOOK" },
  { id: "relations", label: "LOC_DEMOGRAPHICS_TAB_RELATIONS" },
  { id: "options", label: "LOC_DEMOGRAPHICS_TAB_OPTIONS" },
  { id: "about", label: "LOC_DEMOGRAPHICS_TAB_ABOUT" }
];

function safeCall(fn, fb) {
  try {
    return fn();
  } catch (e) {
    derr("safeCall:", e);
    return fb;
  }
}

class ScreenDemographics extends Panel {
  activeView = "history";
  activeMetric = "score";
  activePage = "economy";
  activeTimeFilter = "age";
  activeRadarAge = "current";
  hiddenCivs = new Set();
  focusedCivs = new Set();
  resourcesViewerPid = null;
  triumphsViewerPid = null;
  warsFilterPid = null;
  warsShowCs = true;
  warsActiveOnly = false;
  history = { version: 1, seed: "unknown", samples: [] };
  storage = null;
  chartMod = null;
  sampler = null;
  settings = null;
  viewTabBar = null;
  viewTabBarListener = null;

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

  onAttach() {
    dlog("onAttach");
    super.onAttach();

    safeCall(() => {
      const closeBtn = this.Root.querySelector("[data-ia-close]");
      if (closeBtn) {
        closeBtn.addEventListener("action-activate", () => {
          dlog("close button activated");
          safeCall(() => this.close(), null);
        });
      } else {
        derr("close button not found in template");
      }
    });

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

        safeCall(() => {
          this.activeView = this.settings.getSetting("activeView", "history");
          if (!VIEW_TABS.some((v) => v.id === this.activeView)) this.activeView = "history";
          this.activeMetric = this.settings.getSetting("activeMetric", "score");
          this.activePage = this.settings.getSetting("activePage", "economy");
          // Per-metric time-filter map. Each metric remembers its own
          // last-chosen filter, defaulting to "age" (Current Age) —
          // except the wars Gantt, which defaults to "50" (50-year
          // window) so users land on a useful slice instead of a
          // centuries-wide pile. The cross-age filters ("all",
          // "age1"/"age2"/"age3") are disabled in the runtime (see
          // CROSS_AGE_DISABLED_TOOLTIP in view-history.js). The
          // legacy scalar `activeTimeFilter` is kept as the fallback
          // so existing user settings migrate cleanly; if it
          // resolves to a now-disabled filter we coerce it to "age".
          const DISABLED_FILTERS = new Set(["all", "age1", "age2", "age3"]);
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
          const rvp = this.settings.getSetting("resourcesViewerPid", null);
          this.resourcesViewerPid = typeof rvp === "number" ? rvp : null;
          const tvp = this.settings.getSetting("triumphsViewerPid", null);
          this.triumphsViewerPid = typeof tvp === "number" ? tvp : null;
          this.activeRadarAge = this.settings.getSetting("activeRadarAge", "current");
          const wfp = this.settings.getSetting("warsFilterPid", null);
          this.warsFilterPid = typeof wfp === "number" ? wfp : null;
          this.warsShowCs = this.settings.getSetting("warsShowCs", true) !== false;
          this.warsActiveOnly = !!this.settings.getSetting("warsActiveOnly", false);
          const hidden = this.settings.getSetting("hiddenCivs", []);
          // Stored values are strings (we normalize to String for the Set
          // key); older payloads may have numeric entries — coerce.
          this.hiddenCivs = new Set((Array.isArray(hidden) ? hidden : []).map((v) => String(v)));
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
        });

        safeCall(() => {
          if (this.storage && typeof this.storage.load === "function") {
            this.history = this.storage.load() || this.history;
          }
          dlog("history loaded; sample count=", this.history.samples?.length || 0);
        });

        if (!(this.history.samples?.length > 0) && this.sampler?.sampleNow) {
          dlog("history empty — forcing on-demand sampleNow()");
          safeCall(() => {
            this.sampler.sampleNow();
            if (this.storage?.load) this.history = this.storage.load() || this.history;
            dlog("post-sampleNow sample count=", this.history.samples?.length || 0);
          });
        }

        this.buildViewTabBar();
        this.renderActiveView();
      })
      .catch((e) => derr("module import REJECTED:", e));
  }

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
    this.viewTabBarListener = (event) => {
      const id = event?.detail?.selectedItem?.id;
      if (!id || id === this.activeView) return;
      dlog("view-tab-selected:", id);
      this.activeView = id;
      safeCall(() => this.settings.setSetting("activeView", id));
      this.renderActiveView();
    };
    tabBar.addEventListener("tab-selected", this.viewTabBarListener);
    host.appendChild(tabBar);
    this.viewTabBar = tabBar;
    dlog("view tab bar built; active=", this.activeView, "index=", idx);
  }

  renderActiveView() {
    const host = this.Root.querySelector(".demographics-view-host");
    if (!host) {
      derr("view-host missing");
      return;
    }
    while (host.firstChild) host.removeChild(host.firstChild);

    const reload = () => {
      safeCall(() => {
        if (this.storage?.load) this.history = this.storage.load() || this.history;
      });
      this.renderActiveView();
    };

    try {
      switch (this.activeView) {
        case "factbook":
          ViewFactbook.render(host, {
            history: this.history,
            settings: this.settings
          });
          break;
        case "relations":
          ViewRelations.render(host, {
            history: this.history,
            settings: this.settings
          });
          break;
        case "options":
          ViewOptions.render(host, {
            settings: this.settings,
            storage: this.storage,
            sampler: this.sampler,
            history: this.history,
            requestReload: reload
          });
          break;
        case "about":
          ViewAbout.render(host, {});
          break;
        case "history":
        default:
          ViewHistory.render(host, {
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
            setActiveRadarAge: (id) => {
              this.activeRadarAge = id;
              safeCall(() => this.settings.setSetting("activeRadarAge", id));
              this.renderActiveView();
            },
            warsFilterPid: this.warsFilterPid,
            warsShowCs: this.warsShowCs,
            warsActiveOnly: this.warsActiveOnly,
            setWarsFilterPid: (pid) => {
              this.warsFilterPid = pid;
              safeCall(() => this.settings.setSetting("warsFilterPid", pid));
              this.renderActiveView();
            },
            setWarsShowCs: (v) => {
              this.warsShowCs = !!v;
              safeCall(() => this.settings.setSetting("warsShowCs", !!v));
              this.renderActiveView();
            },
            setWarsActiveOnly: (v) => {
              this.warsActiveOnly = !!v;
              safeCall(() => this.settings.setSetting("warsActiveOnly", !!v));
              this.renderActiveView();
            },
            setResourcesViewerPid: (pid) => {
              this.resourcesViewerPid = pid;
              safeCall(() => this.settings.setSetting("resourcesViewerPid", pid));
              this.renderActiveView();
            },
            setTriumphsViewerPid: (pid) => {
              this.triumphsViewerPid = pid;
              safeCall(() => this.settings.setSetting("triumphsViewerPid", pid));
              this.renderActiveView();
            },
            toggleFocusCiv: (leaderKey) => {
              if (!leaderKey) return;
              const k = String(leaderKey);
              if (this.focusedCivs.has(k)) this.focusedCivs.delete(k);
              else this.focusedCivs.add(k);
              this.renderActiveView();
            },
            clearFocus: () => {
              this.focusedCivs.clear();
              this.renderActiveView();
            },
            setActiveMetric: (id) => {
              this.activeMetric = id;
              safeCall(() => this.settings.setSetting("activeMetric", id));
              // Switching metric → reset to that metric's
              // unique default, NOT whatever filter the user
              // last selected for it. Per-metric memory was
              // confusing — users expect each graph to start
              // from a known state. "age" (Current Age) is
              // the widest non-disabled filter, so it's the
              // safest default across every metric — including
              // wars_gantt, where narrower windows hide wars
              // that happened earlier in the age.
              this.activeTimeFilter = "age";
              this.renderActiveView();
            },
            setActivePage: (id) => {
              this.activePage = id;
              safeCall(() => this.settings.setSetting("activePage", id));
              this.renderActiveView();
            },
            setActiveTimeFilter: (id) => {
              this.activeTimeFilter = id;
              // Persist BOTH the per-metric map and the legacy
              // scalar so older settings consumers keep working.
              if (!this.timeFiltersByMetric) this.timeFiltersByMetric = {};
              this.timeFiltersByMetric[this.activeMetric] = id;
              safeCall(() => this.settings.setSetting("activeTimeFilter", id));
              safeCall(() =>
                this.settings.setSetting("timeFiltersByMetric", this.timeFiltersByMetric)
              );
              this.renderActiveView();
            },
            toggleCiv: (leaderKey) => this.toggleCiv(leaderKey),
            requestReload: reload
          });
          break;
      }
    } catch (e) {
      derr("renderActiveView threw:", e);
    }
  }

  toggleCiv(leaderKey) {
    if (!leaderKey) return;
    const k = String(leaderKey);
    if (this.hiddenCivs.has(k)) this.hiddenCivs.delete(k);
    else this.hiddenCivs.add(k);
    dlog("toggle civ:", k, "hidden now:", this.hiddenCivs.has(k));
    safeCall(() => this.settings.setSetting("hiddenCivs", Array.from(this.hiddenCivs)));
    this.renderActiveView();
  }

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
