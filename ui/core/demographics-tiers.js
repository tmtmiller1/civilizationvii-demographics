// demographics-tiers.js
//
// UI complexity tiers. A single setting (`uiComplexity`) picks basic (core pages only), standard
// (default; every page, advanced tuning hidden) or analyst (everything, including the storage /
// sampling power-user controls). Reads fail safe to `standard`.

import { DemographicsSettings } from "/demographics/ui/core/demographics-settings.js";

export const TIER_BASIC = "basic";
export const TIER_STANDARD = "standard";
export const TIER_ANALYST = "analyst";

/** Ordered least → most complex (for the Options dropdown). */
export const TIER_ORDER = [TIER_BASIC, TIER_STANDARD, TIER_ANALYST];

/** @type {Record<string, number>} */
const TIER_RANK = { [TIER_BASIC]: 0, [TIER_STANDARD]: 1, [TIER_ANALYST]: 2 };

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
 * Whether the active tier is at least `tier` in complexity.
 * @param {string} tier
 * @returns {boolean}
 */
export function tierAtLeast(tier) {
  return TIER_RANK[getTier()] >= (TIER_RANK[tier] ?? 0);
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

/**
 * Whether the advanced camera (cinematic / flyby) options are shown: standard and up.
 * @returns {boolean}
 */
export function showCameraOptionsInTier() {
  return tierAtLeast(TIER_STANDARD);
}

/**
 * Whether the advanced storage / sampling tuning options are shown: analyst only.
 * @returns {boolean}
 */
export function showStorageOptionsInTier() {
  return tierAtLeast(TIER_ANALYST);
}
