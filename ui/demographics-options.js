// demographics-options.js
//
// Registers Demographics settings under the shared Mods category in the
// global Options screen.

import { CategoryType, OptionType, Options } from "/core/ui/options/model-options.js";
import DemographicsSettings from "/demographics/ui/core/demographics-settings.js";
import "/demographics/ui/mod-options.js";

const MAIN_GROUP = "demographics";

const COMPLEXITY_VALUES = ["basic", "standard", "analyst"];
const COMPLEXITY_ITEMS = [
  { label: "LOC_DEMOGRAPHICS_TIER_BASIC" },
  { label: "LOC_DEMOGRAPHICS_TIER_STANDARD" },
  { label: "LOC_DEMOGRAPHICS_TIER_ANALYST" }
];

// Reveal mode (formerly the Spoilers dropdown): "full" reveals a civ's back-history on first
// contact, "forward" tracks only from the meeting. Persisted as the legacy `backfillMetHistory`
// boolean. Each item carries the stored `value` for its index alongside its display `label`.
const REVEAL_ITEMS = [
  { value: true, label: "LOC_DEMOGRAPHICS_OPT_BACKFILL_MET_HISTORY" },
  { value: false, label: "LOC_DEMOGRAPHICS_OPT_TRACK_FROM_MEET" }
];

// Top-Cities fly-by length preset.
const FLYBY_ITEMS = [
  { value: "short", label: "LOC_DEMOGRAPHICS_OPT_FLYBY_PRESET_SHORT" },
  { value: "medium", label: "LOC_DEMOGRAPHICS_OPT_FLYBY_PRESET_MEDIUM" }
];

function getBool(/** @type {string} */ key, /** @type {*} */ fallback) {
  return !!DemographicsSettings.getSetting(key, fallback);
}

/**
 * Poke the open Demographics screen to re-render after an option change, so toggles take effect
 * live
 * (the screen installs `globalThis.DemographicsLiveRefresh` while open; no-op when it's closed).
 */
function notifyLiveRefresh() {
  try {
    /** @type {*} */ (globalThis).DemographicsLiveRefresh?.();
  } catch (_) {
    /* screen not open / hook absent */
  }
}

/**
 * Register a plain Demographics checkbox setting under Mods → Demographics.
 * @param {string} id The option id.
 * @param {string} key The DemographicsSettings key.
 * @param {boolean} dflt Default value.
 * @param {string} label LOC label key.
 */
function registerCheckbox(id, key, dflt, label) {
  Options.addOption({
    category: CategoryType.Mods,
    group: MAIN_GROUP,
    type: OptionType.Checkbox,
    id,
    initListener: (/** @type {*} */ info) => (info.currentValue = getBool(key, dflt)),
    updateListener: (/** @type {*} */ _info, /** @type {*} */ value) => {
      DemographicsSettings.setSetting(key, !!value);
      notifyLiveRefresh();
    },
    label
  });
}

/**
 * Register a Demographics dropdown setting whose selected index maps to `items[index].value`.
 * @param {string} id The option id.
 * @param {string} key The DemographicsSettings key.
 * @param {{value:*, label:string}[]} items Dropdown items (stored value + display label).
 * @param {*} dflt Default stored value.
 * @param {string} label LOC label key.
 */
function registerDropdown(id, key, items, dflt, label) {
  Options.addOption({
    category: CategoryType.Mods,
    group: MAIN_GROUP,
    type: OptionType.Dropdown,
    id,
    initListener: (/** @type {*} */ info) => {
      const idx = items.findIndex((it) => it.value === DemographicsSettings.getSetting(key, dflt));
      info.selectedItemIndex = idx >= 0 ? idx : 0;
    },
    updateListener: (/** @type {*} */ _info, /** @type {*} */ value) => {
      const idx = Number(value);
      if (Number.isInteger(idx) && idx >= 0 && idx < items.length) {
        DemographicsSettings.setSetting(key, items[idx].value);
      }
      notifyLiveRefresh();
    },
    label,
    dropdownItems: items.map((it) => ({ label: it.label }))
  });
}

function registerHideUnmet() {
  Options.addOption({
    category: CategoryType.Mods,
    group: MAIN_GROUP,
    type: OptionType.Checkbox,
    id: "demographics-hide-unmet-stats",
    initListener: (/** @type {*} */ info) => (info.currentValue = getBool("hideUnmetStats", true)),
    updateListener: (/** @type {*} */ _info, /** @type {*} */ value) => {
      const enabled = !!value;
      DemographicsSettings.setSettings({
        hideUnmetStats: enabled,
        showUnmetNames: !enabled
      });
      notifyLiveRefresh();
    },
    label: "LOC_DEMOGRAPHICS_OPT_HIDE_UNMET_STATS",
    description: "LOC_DEMOGRAPHICS_OPT_HIDE_UNMET_INFO"
  });
}

function registerColorblind() {
  Options.addOption({
    category: CategoryType.Mods,
    group: MAIN_GROUP,
    type: OptionType.Checkbox,
    id: "demographics-colorblind-mode",
    initListener: (/** @type {*} */ info) => (info.currentValue = getBool("colorblindMode", false)),
    updateListener: (/** @type {*} */ _info, /** @type {*} */ value) => {
      DemographicsSettings.setSetting("colorblindMode", !!value);
      notifyLiveRefresh();
    },
    label: "LOC_DEMOGRAPHICS_OPT_COLORBLIND"
  });
}

function registerWonderMarkers() {
  Options.addOption({
    category: CategoryType.Mods,
    group: MAIN_GROUP,
    type: OptionType.Checkbox,
    id: "demographics-show-wonder-markers",
    initListener: (/** @type {*} */ info) => (info.currentValue = getBool("showWonderMarkers", true)),
    updateListener: (/** @type {*} */ _info, /** @type {*} */ value) => {
      DemographicsSettings.setSetting("showWonderMarkers", !!value);
      notifyLiveRefresh();
    },
    label: "LOC_DEMOGRAPHICS_OPT_SHOW_WONDER_MARKERS"
  });
}

function registerWarMarkers() {
  Options.addOption({
    category: CategoryType.Mods,
    group: MAIN_GROUP,
    type: OptionType.Checkbox,
    id: "demographics-show-war-markers",
    initListener: (/** @type {*} */ info) => (info.currentValue = getBool("showWarMarkers", true)),
    updateListener: (/** @type {*} */ _info, /** @type {*} */ value) => {
      DemographicsSettings.setSetting("showWarMarkers", !!value);
      notifyLiveRefresh();
    },
    label: "LOC_DEMOGRAPHICS_OPT_SHOW_WAR_MARKERS"
  });
}

function registerDisasterMarkers() {
  Options.addOption({
    category: CategoryType.Mods,
    group: MAIN_GROUP,
    type: OptionType.Checkbox,
    id: "demographics-show-disaster-markers",
    initListener: (/** @type {*} */ info) => (info.currentValue = getBool("showDisasterMarkers", true)),
    updateListener: (/** @type {*} */ _info, /** @type {*} */ value) => {
      DemographicsSettings.setSetting("showDisasterMarkers", !!value);
      notifyLiveRefresh();
    },
    label: "LOC_DEMOGRAPHICS_OPT_SHOW_DISASTER_MARKERS"
  });
}

function registerComplexity() {
  Options.addOption({
    category: CategoryType.Mods,
    group: MAIN_GROUP,
    type: OptionType.Dropdown,
    id: "demographics-ui-complexity",
    initListener: (/** @type {*} */ info) => {
      const current = String(DemographicsSettings.getSetting("uiComplexity", "standard"));
      const idx = COMPLEXITY_VALUES.indexOf(current);
      info.selectedItemIndex = idx >= 0 ? idx : 1;
    },
    updateListener: (/** @type {*} */ _info, /** @type {*} */ value) => {
      const idx = Number(value);
      if (!Number.isInteger(idx) || idx < 0 || idx >= COMPLEXITY_VALUES.length) return;
      DemographicsSettings.setSetting("uiComplexity", COMPLEXITY_VALUES[idx]);
      notifyLiveRefresh();
    },
    label: "LOC_DEMOGRAPHICS_OPT_COMPLEXITY",
    description: "LOC_DEMOGRAPHICS_TIER_STANDARD_DESC",
    dropdownItems: COMPLEXITY_ITEMS
  });
}

Options.addInitCallback(() => {
  registerHideUnmet();
  registerColorblind();
  registerWonderMarkers();
  registerWarMarkers();
  registerDisasterMarkers();
  registerComplexity();
  // Settings migrated from the (removed) in-screen Options tab, so all Demographics options live in
  // the one native location.
  registerDropdown("demographics-reveal-mode", "backfillMetHistory", REVEAL_ITEMS, true,
    "LOC_DEMOGRAPHICS_OPT_REVEAL_MODE");
  registerCheckbox("demographics-smooth-chart", "smoothChart", false, "LOC_DEMOGRAPHICS_OPT_SMOOTH");
  registerCheckbox("demographics-show-eliminated", "showEliminatedCivs", true,
    "LOC_DEMOGRAPHICS_OPT_SHOW_ELIMINATED_FULL");
  registerCheckbox("demographics-cinematic", "topCities.cinematicEnabled", true,
    "LOC_DEMOGRAPHICS_OPT_CINEMATIC");
  registerCheckbox("demographics-flyby", "topCities.flybyEnabled", true,
    "LOC_DEMOGRAPHICS_OPT_FLYBY");
  registerDropdown("demographics-flyby-preset", "topCities.flybyPreset", FLYBY_ITEMS, "medium",
    "LOC_DEMOGRAPHICS_OPT_FLYBY_PRESET");
  registerCheckbox("demographics-flyby-rotate", "topCities.flybyAllowRotate", true,
    "LOC_DEMOGRAPHICS_OPT_FLYBY_ROTATE");
});
