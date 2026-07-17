// view-history-state.js
//
// Active page/metric/filter state resolution for the Historical Data view.

import { pageVisibleInTier } from "/demographics/ui/core/demographics-tiers.js";

// Hub reorg: pages whose ids were retired/split. A persisted selection lands on the closest
// surviving page when its hub is the one being shown (else the first-visible clamp below takes
// over).
/** @type {Record<string, string>} */
const PAGE_ID_ALIASES = {
  knowledge: "power", science_culture: "power", age: "society",
  expansion: "settlements_land", construction: "settlements_land",
  resources: "economy", conflicts: "military", wars: "military"
};

/**
 * Resolve active page id within the given (hub-scoped) page list, defaulting to the first page
 * when invalid. Retired page ids are aliased first; then, under a UI complexity tier (P1.5), a page
 * hidden
 * by the active tier clamps to the first visible page so a downgrade never strands the view.
 * @param {*} ctx Render context.
 * @param {{ id: string, tier?: string }[]} pages Page list (already scoped to the active hub).
 * @returns {string} Valid, tier-visible page id.
 */
export function resolveActivePageState(ctx, pages) {
  const fallback = pages.length ? pages[0].id : "yields";
  let want = ctx.activePage || "";
  if (PAGE_ID_ALIASES[want]) want = PAGE_ID_ALIASES[want];
  let id = want && pages.some((p) => p.id === want) ? want : fallback;
  const def = pages.find((p) => p.id === id);
  if (def && !pageVisibleInTier(def)) {
    const firstVisible = pages.find((p) => pageVisibleInTier(p));
    id = firstVisible ? firstVisible.id : id;
  }
  return id;
}

/**
 * Resolve active metric id within a page, falling back to first renderable.
 * @param {*} ctx Render context.
 * @param {{ metrics?: string[] }} page Active page.
 * @param {(id: string) => boolean} metricExists Metric-existence predicate.
 * @returns {string} Valid metric id.
 */
export function resolveActiveMetricState(ctx, page, metricExists) {
  const metrics = page.metrics || [];
  let activeMetric = ctx.activeMetric || "";
  const activeInPage = metrics.includes(activeMetric) && metricExists(activeMetric);
  if (!activeInPage) {
    activeMetric = metrics.find(metricExists) || "score";
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
