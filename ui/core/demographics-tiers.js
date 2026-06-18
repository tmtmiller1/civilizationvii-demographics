// demographics-tiers.js
//
// UI complexity tiers (combined design plan P1.5).
//
// The full feature set is dense. A single setting (`uiComplexity`) picks one of
// three display profiles that progressively disclose features:
//
//   basic    - core stat pages only (Economy / Power / Knowledge); the advanced
//              History pages (Age triumphs, Resources, Conflicts, Crises) and the
//              Relations network tab are hidden, and Options shows only the
//              essential controls.
//   standard - (default) every page and tab; advanced storage / sampling tuning
//              stays hidden so the common case isn't cluttered.
//   analyst  - everything, including the storage cap / decimation / sample-rate
//              power-user controls.
//
// Nothing is deleted , a higher tier reveals more. Reads fail safe to `standard`
// so a thrown/absent setting never hides core functionality.

import { DemographicsSettings } from "/demographics/ui/core/demographics-settings.js";

export const TIER_BASIC = "basic";
export const TIER_STANDARD = "standard";
export const TIER_ANALYST = "analyst";

/** Ordered least → most complex (for the Options dropdown). */
export const TIER_ORDER = [TIER_BASIC, TIER_STANDARD, TIER_ANALYST];

/** @type {Record<string, number>} */
const TIER_RANK = { [TIER_BASIC]: 0, [TIER_STANDARD]: 1, [TIER_ANALYST]: 2 };

// History pages shown at the BASIC tier. Everything else (age / resources /
// conflicts / crises) is an advanced page revealed at standard+.
const BASIC_PAGES = new Set(["economy", "power", "knowledge"]);

// Top-level view tabs hidden at the BASIC tier (the analyst-heavy network view).
const BASIC_HIDDEN_VIEWS = new Set(["relations"]);

/**
 * The active complexity tier, defaulting to `standard`. Fails safe to standard.
 * @returns {string} A tier id.
 */
export function getTier() {
  try {
    const v = DemographicsSettings.getSetting("uiComplexity", TIER_STANDARD);
    return Object.prototype.hasOwnProperty.call(TIER_RANK, v) ? v : TIER_STANDARD;
  } catch (_) {
    return TIER_STANDARD;
  }
}

/**
 * Whether the active tier is at least `tier` in complexity.
 * @param {string} tier The minimum tier id.
 * @returns {boolean} True when the active tier ranks >= `tier`.
 */
export function tierAtLeast(tier) {
  return TIER_RANK[getTier()] >= (TIER_RANK[tier] ?? 0);
}

/**
 * Whether a History page id is visible under the active tier.
 * @param {string} pageId The page id.
 * @returns {boolean} True when the page should be shown.
 */
export function pageVisibleInTier(pageId) {
  if (getTier() === TIER_BASIC) return BASIC_PAGES.has(pageId);
  return true;
}

/**
 * Whether a top-level view tab id is visible under the active tier.
 * @param {string} viewId The view id (history / rankings / relations / options).
 * @returns {boolean} True when the tab should be shown.
 */
export function viewTabVisibleInTier(viewId) {
  if (getTier() === TIER_BASIC) return !BASIC_HIDDEN_VIEWS.has(viewId);
  return true;
}

/**
 * Whether the advanced camera (cinematic / flyby) options are shown , standard+.
 * @returns {boolean} True at standard or analyst.
 */
export function showCameraOptionsInTier() {
  return tierAtLeast(TIER_STANDARD);
}

/**
 * Whether the advanced storage / sampling tuning options are shown , analyst only.
 * @returns {boolean} True at analyst.
 */
export function showStorageOptionsInTier() {
  return tierAtLeast(TIER_ANALYST);
}
