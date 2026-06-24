// demographics-options.js
//
// Registers Demographics settings under the shared Mods category in the
// global Options screen.

import { CategoryType, OptionType, Options } from "/core/ui/options/model-options.js";
import DemographicsSettings from "/demographics/ui/core/demographics-settings.js";
import "/demographics/ui/demographics-mod-options.js";

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
 * @param {{label:string, description?:string}} text LOC label key + optional tooltip key.
 */
function registerCheckbox(id, key, dflt, text) {
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
    label: text.label,
    ...(text.description ? { description: text.description } : {})
  });
}

/**
 * Register a Demographics dropdown setting whose selected index maps to `items[index].value`.
 * @param {string} id The option id.
 * @param {string} key The DemographicsSettings key.
 * @param {{value:*, label:string}[]} items Dropdown items (stored value + display label).
 * @param {*} dflt Default stored value.
 * @param {{label:string, description?:string}} text LOC label key + optional tooltip key.
 */
function registerDropdown(id, key, items, dflt, text) {
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
    label: text.label,
    ...(text.description ? { description: text.description } : {}),
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
    description: "LOC_DEMOGRAPHICS_OPT_COMPLEXITY_INFO",
    dropdownItems: COMPLEXITY_ITEMS
  });
}

Options.addInitCallback(() => {
  // Spoiler controls.
  registerHideUnmet();
  registerDropdown("demographics-reveal-mode", "backfillMetHistory", REVEAL_ITEMS, true, {
    label: "LOC_DEMOGRAPHICS_OPT_REVEAL_MODE",
    description: "LOC_DEMOGRAPHICS_OPT_REVEAL_MODE_INFO"
  });
  // Display.
  registerComplexity();
  registerCheckbox("demographics-colorblind-mode", "colorblindMode", false, {
    label: "LOC_DEMOGRAPHICS_OPT_COLORBLIND",
    description: "LOC_DEMOGRAPHICS_OPT_COLORBLIND_INFO"
  });
  registerCheckbox("demographics-smooth-chart", "smoothChart", false, {
    label: "LOC_DEMOGRAPHICS_OPT_SMOOTH",
    description: "LOC_DEMOGRAPHICS_OPT_SMOOTH_INFO"
  });
  registerCheckbox("demographics-show-eliminated", "showEliminatedCivs", true, {
    label: "LOC_DEMOGRAPHICS_OPT_SHOW_ELIMINATED_FULL",
    description: "LOC_DEMOGRAPHICS_OPT_SHOW_ELIMINATED_INFO"
  });
  // Chart markers.
  registerCheckbox("demographics-show-wonder-markers", "showWonderMarkers", true, {
    label: "LOC_DEMOGRAPHICS_OPT_SHOW_WONDER_MARKERS",
    description: "LOC_DEMOGRAPHICS_OPT_SHOW_WONDER_MARKERS_INFO"
  });
  registerCheckbox("demographics-show-war-markers", "showWarMarkers", true, {
    label: "LOC_DEMOGRAPHICS_OPT_SHOW_WAR_MARKERS",
    description: "LOC_DEMOGRAPHICS_OPT_SHOW_WAR_MARKERS_INFO"
  });
  registerCheckbox("demographics-show-disaster-markers", "showDisasterMarkers", true, {
    label: "LOC_DEMOGRAPHICS_OPT_SHOW_DISASTER_MARKERS",
    description: "LOC_DEMOGRAPHICS_OPT_SHOW_DISASTER_MARKERS_INFO"
  });
  // Top Cities camera.
  registerCheckbox("demographics-cinematic", "topCities.cinematicEnabled", true, {
    label: "LOC_DEMOGRAPHICS_OPT_CINEMATIC",
    description: "LOC_DEMOGRAPHICS_OPT_CINEMATIC_INFO"
  });
  registerCheckbox("demographics-flyby", "topCities.flybyEnabled", true, {
    label: "LOC_DEMOGRAPHICS_OPT_FLYBY",
    description: "LOC_DEMOGRAPHICS_OPT_FLYBY_INFO"
  });
  registerDropdown("demographics-flyby-preset", "topCities.flybyPreset", FLYBY_ITEMS, "medium", {
    label: "LOC_DEMOGRAPHICS_OPT_FLYBY_PRESET",
    description: "LOC_DEMOGRAPHICS_OPT_FLYBY_PRESET_INFO"
  });
  registerCheckbox("demographics-flyby-rotate", "topCities.flybyAllowRotate", true, {
    label: "LOC_DEMOGRAPHICS_OPT_FLYBY_ROTATE",
    description: "LOC_DEMOGRAPHICS_OPT_FLYBY_ROTATE_INFO"
  });
});
