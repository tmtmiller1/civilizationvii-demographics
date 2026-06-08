// view-history-state.js
//
// Active page/metric/filter state resolution for the Historical Data view.

/**
 * Resolve active page id, defaulting to economy when invalid.
 * @param {*} ctx Render context.
 * @param {{ id: string }[]} pages Page list.
 * @returns {string} Valid page id.
 */
export function resolveActivePageState(ctx, pages) {
  return ctx.activePage && pages.some((p) => p.id === ctx.activePage)
    ? ctx.activePage
    : "economy";
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
