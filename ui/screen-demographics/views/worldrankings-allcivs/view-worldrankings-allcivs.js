// view-worldrankings-allcivs.js
//
// "All Civilizations" view: a spreadsheet-style matrix built from flex
// columns rather than an HTML <table>.
//
// Layout: each civ is a vertical column, each metric is a horizontal row.
//   Column 1: metric labels                  (sticky-left)
//   Column 2: local player's civ values      (sticky-left, gold border)
//   Column 3+: every other met civ, sorted by leader name
//
// Vanilla Civ7 uses zero <table> elements (a grep across
// Resources/Base/modules turns up no createElement("table") and no
// `<table` literals). Coherent's GameFace renders tables unreliably,
// hence flex.

import {
  buildCivProfiles,
  readBoolSetting,
  stripEliminatedCivs,
  stripUnmetDiplomacy
} from "/demographics/ui/screen-demographics/views/worldrankings-allcivs/worldrankings-allcivs-profiles.js";
import {
  appendEmptyState
} from "/demographics/ui/screen-demographics/views/worldrankings-allcivs/worldrankings-allcivs-render.js";
import { renderCivTable } from "/demographics/ui/screen-demographics/views/worldrankings-allcivs/worldrankings-allcivs-table.js";

const DBG = false;
/**
 * Debug logger, no-op unless `DBG` is set.
 * @param {...*} a Values to log.
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.view-worldrankings-allcivs]", ...a);
}

/**
 * Persisted-setting accessor surface read off the render context.
 * @typedef {Object} WorldRankingsAllCivsSettings
 * @property {(key: string, fallback?: *) => *} [getSetting] Read a setting.
 * @property {(key: string, value: *) => void} [setSetting] Write a setting.
 */

/**
 * Render context handed to `render`.
 * @typedef {Object} WorldRankingsAllCivsCtx
 * @property {DemoHistory} [history] The full persisted history blob.
 * @property {WorldRankingsAllCivsSettings} [settings] Persisted-setting accessor.
 */

/**
 * Render the All Civilizations matrix into `host`. Clears the host, folds the
 * history into per-civ profiles, applies the `showEliminatedCivs` /
 * `showUnmetNames` settings, then mounts the interactive strip.
 * @param {HTMLElement} host The view host element (cleared and repopulated).
 * @param {WorldRankingsAllCivsCtx} ctx Render context (history + settings accessors).
 */
export function render(host, ctx) {
  while (host.firstChild) host.removeChild(host.firstChild);

  const profiles = prepareProfiles(ctx);
  const allPids = Object.keys(profiles);
  if (allPids.length === 0) {
    appendEmptyState(host);
    return;
  }

  // Read "show unmet names" setting (Fix 4). When false, mask unmet civs.
  const showUnmetNames = readBoolSetting(ctx, "showUnmetNames", false);

  dlog("rendering all-civilizations table; civs=", allPids.length);

  // Settlements-style sortable table (civs as rows, metrics as scrollable columns)
  // with a Rank/Value cell toggle. The rerender closure re-runs this render so a
  // toggle or sort change repaints from fresh profiles.
  renderCivTable(host, profiles, ctx, showUnmetNames, () => render(host, ctx));
}

/**
 * Build and post-process worldrankings-allcivs profiles from history/settings.
 * @param {WorldRankingsAllCivsCtx} ctx Render context.
 * @returns {Record<string, *>} Profile map.
 */
function prepareProfiles(ctx) {
  const profiles = buildCivProfiles(ctx.history);
  if (!readBoolSetting(ctx, "showEliminatedCivs", true)) {
    stripEliminatedCivs(profiles, ctx.history);
  }
  if (readBoolSetting(ctx, "hideUnmetStats", true)) {
    stripUnmetDiplomacy(profiles);
  }
  return profiles;
}
