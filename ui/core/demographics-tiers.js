// demographics-tiers.js
//
// UI complexity tiers. A single setting (`uiComplexity`) picks basic (core pages only) or standard
// (default; every page). Reads fail safe to `standard`, which is also how a saved "analyst" from
// earlier versions reads: that tier showed the same pages as standard.

import { DemographicsSettings } from "/demographics/ui/core/demographics-settings.js";

export const TIER_BASIC = "basic";
export const TIER_STANDARD = "standard";

/** Ordered least → most complex (for the Options dropdown). */
export const TIER_ORDER = [TIER_BASIC, TIER_STANDARD];

/** @type {Record<string, number>} */
const TIER_RANK = { [TIER_BASIC]: 0, [TIER_STANDARD]: 1 };

// basic-tier page visibility is per-page (`page.tier === "basic"`), see pageVisibleInTier; hub tabs
// are always visible

/**
 * The active complexity tier. Fails safe to standard.
 * @returns {string}
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
 * Whether a page is visible under the active tier. Gating is per-page via `page.tier`
 * (default standard); the basic tier shows only pages declared `tier: "basic"`.
 * @param {{tier?:string}|string} page The page descriptor (or a bare id for legacy callers).
 * @returns {boolean}
 */
export function pageVisibleInTier(page) {
  if (getTier() !== TIER_BASIC) return true;
  const tier = typeof page === "string" ? undefined : page && page.tier;
  return tier === TIER_BASIC;
}

/**
 * Whether a top-level hub tab is visible under the active tier. All four hubs are visible at every
 * tier (the basic tier hides advanced pages within a hub, not the hub itself).
 * @param {string} _viewId
 * @returns {boolean} Always true.
 */
export function viewTabVisibleInTier(_viewId) {
  return true;
}
