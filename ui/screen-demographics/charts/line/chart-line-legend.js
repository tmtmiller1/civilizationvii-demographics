// chart-line-legend.js
//
// Custom HTML legend for the per-civ line chart. Rendered as a list beside the
// chart canvas (the canvas-drawn Chart.js legend is disabled) so each civ entry
// can carry a live <fxs-icon> leader portrait + colored dot - matching the
// hover tooltip exactly. Clicking a row toggles that civ's VISIBILITY via
// opts.onToggleVisibility (falling back to opts.onToggleCiv); the "All" / "None"
// controls bulk-toggle every civ via opts.onSetAllHidden.

import { buildLeaderIconGroup } from "/demographics/ui/screen-demographics/charts/line/chart-line-tooltip.js";
import { t } from "/demographics/ui/core/demographics-i18n.js";

/**
 * Apply row-state classes based on dataset visibility/focus state.
 * @param {HTMLElement} row Legend row element.
 * @param {Record<string, *>} ds Dataset payload.
 */
function applyLegendRowState(row, ds) {
  if (ds._muted || ds.hidden) row.classList.add("is-hidden");
  if (ds._focused) row.classList.add("is-focused");
  if (ds._eliminated) row.classList.add("is-eliminated");
}

/**
 * Wire click handling for one legend row.
 * @param {HTMLElement} row Legend row element.
 * @param {Record<string, *>} ds Dataset payload.
 * @param {*} opts Render options.
 */
function wireLegendRowToggle(row, ds, opts) {
  const cb = opts && (opts.onToggleVisibility || opts.onToggleCiv);
  if (typeof cb !== "function" || !ds.leaderType) return;
  row.addEventListener("click", () => cb(ds.leaderType));
}

/**
 * Build one legend row: leader portrait + colored dot + civ name, clickable to
 * toggle the civ. Reflects muted (legend-toggled off), focused, and eliminated
 * state.
 * @param {Record<string, *>} ds The Chart.js dataset.
 * @param {*} opts The render options (carries onToggleCiv).
 * @returns {HTMLElement} The legend row element.
 */
function buildLegendRow(ds, opts) {
  const row = document.createElement("div");
  row.className = "demographics-line-legend-row";
  applyLegendRowState(row, ds);

  // Same portrait + colored dot the tooltip uses; ds.borderColor is already the
  // lifted civ color (or dimmed when another civ is focused).
  row.appendChild(buildLeaderIconGroup(ds, ds.borderColor));

  const name = document.createElement("span");
  name.className = "demographics-line-legend-name";
  name.textContent = ds.label || "";
  row.appendChild(name);

  // Legend rows toggle muted visibility state, so they work with the All/None
  // controls - after "None", clicking a row brings that civ back. (Line labels on
  // the chart still toggle focus via onToggleCiv.)
  wireLegendRowToggle(row, ds, opts);
  return row;
}

/**
 * Build the legend's "Legend" title.
 * @returns {HTMLElement} The title element.
 */
function buildLegendTitle() {
  const title = document.createElement("div");
  title.className = "demographics-line-legend-title";
  title.textContent = t("LOC_DEMOGRAPHICS_LEGEND_TITLE");
  return title;
}

/**
 * Build the shared "All" / "None" bulk-select controls row (All shows every civ,
 * None hides them all). Exported so every chart's legend — line, radar, etc. —
 * renders the identical control block. No-op clicks when no callback is wired.
 * @param {string[]} keys The civ keys (leaderTypes) the buttons bulk-toggle.
 * @param {((hidden: boolean, keys: string[]) => void)|null|undefined} onSetAllHidden
 *   Bulk visibility callback: `(true, keys)` hides all, `(false, keys)` shows all.
 * @returns {HTMLElement} The controls row.
 */
export function buildLegendControls(keys, onSetAllHidden) {
  const row = document.createElement("div");
  row.className = "demographics-line-legend-controls";
  const all = document.createElement("div");
  all.className = "demographics-line-legend-btn";
  all.textContent = t("LOC_DEMOGRAPHICS_LEGEND_ALL");
  all.addEventListener("click", () => {
    if (typeof onSetAllHidden === "function") onSetAllHidden(false, keys);
  });
  const none = document.createElement("div");
  none.className = "demographics-line-legend-btn";
  none.textContent = t("LOC_DEMOGRAPHICS_LEGEND_NONE");
  none.addEventListener("click", () => {
    if (typeof onSetAllHidden === "function") onSetAllHidden(true, keys);
  });
  row.appendChild(all);
  row.appendChild(none);
  return row;
}

/**
 * Build the custom HTML legend: a "Legend" title, the All/None bulk controls,
 * then one clickable row per dataset (civ) with the leader portrait, colored
 * dot, and name.
 * @param {Record<string, *>[]} datasets The Chart.js datasets (chart order).
 * @param {*} opts The render options (carries onToggleCiv, onSetAllHidden).
 * @returns {HTMLElement} The legend container element.
 */
export function buildLineLegend(datasets, opts) {
  const legend = document.createElement("div");
  legend.className = "demographics-line-legend";
  legend.appendChild(buildLegendTitle());
  const keys = datasets.map((ds) => ds.leaderType).filter(Boolean);
  legend.appendChild(buildLegendControls(keys, opts && opts.onSetAllHidden));
  for (const ds of datasets) legend.appendChild(buildLegendRow(ds, opts));
  return legend;
}
