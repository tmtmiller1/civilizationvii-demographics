// view-history-state.js
//
// Active page/metric/filter state resolution for the Historical Data view.

import { pageVisibleInTier } from "/demographics/ui/core/demographics-tiers.js";

/**
 * Resolve active page id, defaulting to economy when invalid. Under a UI
 * complexity tier (P1.5) a page hidden by the active tier clamps to the first
 * visible page so a tier downgrade never strands the view on a hidden page.
 * @param {*} ctx Render context.
 * @param {{ id: string }[]} pages Page list.
 * @returns {string} Valid, tier-visible page id.
 */
export function resolveActivePageState(ctx, pages) {
  let id =
    ctx.activePage && pages.some((p) => p.id === ctx.activePage) ? ctx.activePage : "economy";
  if (!pageVisibleInTier(id)) {
    const firstVisible = pages.find((p) => pageVisibleInTier(p.id));
    id = firstVisible ? firstVisible.id : id;
  }
  return id;
}

/**
 * Resolve active metric id within a page, falling back to first renderable.
 * @param {*} ctx Render context.
 * @param {{ metrics: string[] }} page Active page.
 * @param {(id: string) => boolean} metricExists Metric-existence predicate.
 * @returns {string} Valid metric id.
 */
export function resolveActiveMetricState(ctx, page, metricExists) {
  let activeMetric = ctx.activeMetric || "";
  const activeInPage = page.metrics.includes(activeMetric) && metricExists(activeMetric);
  if (!activeInPage) {
    activeMetric = page.metrics.find(metricExists) || "score";
  }
  return activeMetric;
}

/**
 * Resolve active time filter. Cross-age filters (all/age1/age2/age3) are enabled
 * now that history persists across ages (GameConfiguration backend), so they are
 * honored rather than coerced to "age". Default to "all" (full cross-age history);
 * fall back to "all" only when the persisted id is unknown/disabled.
 * @param {*} ctx Render context.
 * @param {{ id: string, disabled?: boolean }[]} filters Time filter list.
 * @returns {string} Valid enabled filter id.
 */
export function resolveActiveFilterState(ctx, filters) {
  let activeFilter = ctx.activeTimeFilter || "all";
  const activeDef = filters.find((f) => f.id === activeFilter);
  if (!activeDef || activeDef.disabled) activeFilter = "all";
  return activeFilter;
}
