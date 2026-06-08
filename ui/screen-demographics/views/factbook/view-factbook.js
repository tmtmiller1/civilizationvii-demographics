// view-factbook.js
//
// "World Factbook" view: a spreadsheet-style matrix built from flex
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
  pickLocalPid,
  readBoolSetting,
  sortOtherPids,
  stripEliminatedCivs,
  stripUnmetDiplomacy
} from "/demographics/ui/screen-demographics/views/factbook/factbook-profiles.js";
import {
  appendEmptyState,
  buildHint
} from "/demographics/ui/screen-demographics/views/factbook/factbook-render.js";
import { mountFactbookStrip } from "/demographics/ui/screen-demographics/views/factbook/factbook-controller.js";

const DBG = false;
/**
 * Debug logger, no-op unless `DBG` is set.
 * @param {...*} a Values to log.
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.view-factbook]", ...a);
}

/**
 * Persisted-setting accessor surface read off the render context.
 * @typedef {Object} FactbookSettings
 * @property {(key: string, fallback?: *) => *} [getSetting] Read a setting.
 * @property {(key: string, value: *) => void} [setSetting] Write a setting.
 */

/**
 * Render context handed to `render`.
 * @typedef {Object} FactbookCtx
 * @property {DemoHistory} [history] The full persisted history blob.
 * @property {FactbookSettings} [settings] Persisted-setting accessor.
 */

/**
 * Render the World Factbook matrix into `host`. Clears the host, folds the
 * history into per-civ profiles, applies the `showEliminatedCivs` /
 * `showUnmetNames` settings, then mounts the interactive strip.
 * @param {HTMLElement} host The view host element (cleared and repopulated).
 * @param {FactbookCtx} ctx Render context (history + settings accessors).
 */
export function render(host, ctx) {
  while (host.firstChild) host.removeChild(host.firstChild);

  const profiles = prepareProfiles(ctx);
  const allPids = Object.keys(profiles);
  if (allPids.length === 0) {
    appendEmptyState(host);
    return;
  }

  const localPid = pickLocalPid(profiles, allPids);
  const otherPids = sortOtherPids(profiles, allPids, localPid);

  // Read "show unmet names" setting (Fix 4). When false, mask unmet civs.
  const showUnmetNames = readBoolSetting(ctx, "showUnmetNames", false);

  dlog("rendering factbook; local=", localPid, "others=", otherPids.length);

  host.appendChild(buildHint());
  const strip = buildFactbookStripShell(host);
  mountFactbookStrip(strip, profiles, { localPid, otherPids }, ctx, showUnmetNames);
}

/**
 * Build and post-process factbook profiles from history/settings.
 * @param {FactbookCtx} ctx Render context.
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

/**
 * Build the scroll shell and return the strip element.
 * @param {HTMLElement} host The root host.
 * @returns {HTMLElement} The strip container.
 */
function buildFactbookStripShell(host) {
  const scrollWrap = document.createElement("div");
  scrollWrap.className = "demographics-factbook-matrix";
  host.appendChild(scrollWrap);

  const strip = document.createElement("div");
  strip.className = "demographics-factbook-strip";
  scrollWrap.appendChild(strip);
  return strip;
}
