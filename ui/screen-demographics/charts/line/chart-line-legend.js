// chart-line-legend.js
//
// Custom HTML legend for the per-civ line chart (the canvas-drawn Chart.js
// legend is disabled) so each civ entry can carry a live leader portrait +
// colored dot. Clicking a row toggles that civ's visibility via
// opts.onToggleVisibility; "All" / "None" bulk-toggle via opts.onSetAllHidden.

import { buildLeaderIconGroup } from "/demographics/ui/screen-demographics/charts/line/chart-line-tooltip.js";
import { t } from "/demographics/ui/core/demographics-i18n.js";

/**
 * @param {HTMLElement} row
 * @param {Record<string, *>} dataset
 */
function applyLegendRowState(row, dataset) {
  if (dataset._muted || dataset.hidden) row.classList.add("is-hidden");
  if (dataset._focused) row.classList.add("is-focused");
  if (dataset._eliminated) row.classList.add("is-eliminated");
}

/**
 * @param {HTMLElement} row
 * @param {Record<string, *>} dataset
 * @param {*} opts
 */
function wireLegendRowToggle(row, dataset, opts) {
  const onToggle = opts && (opts.onToggleVisibility || opts.onToggleCiv);
  if (typeof onToggle !== "function" || !dataset.leaderType) return;
  row.addEventListener("click", () => onToggle(dataset.leaderType));
}

/**
 * @param {Record<string, *>} dataset
 * @param {*} opts
 */
function buildLegendRow(dataset, opts) {
  const row = document.createElement("div");
  row.className = "demographics-line-legend-row";
  applyLegendRowState(row, dataset);

  // Same portrait + colored dot the tooltip uses; dataset.borderColor is already the
  // lifted civ color (or dimmed when another civ is focused).
  row.appendChild(buildLeaderIconGroup(dataset, dataset.borderColor));

  const name = document.createElement("span");
  name.className = "demographics-line-legend-name";
  name.textContent = dataset.label || "";
  row.appendChild(name);

  // Legend rows toggle muted visibility state, so they work with the All/None
  // controls: after "None", clicking a row brings that civ back. (Line labels on
  // the chart still toggle focus via onToggleCiv.)
  wireLegendRowToggle(row, dataset, opts);
  return row;
}

function buildLegendTitle() {
  const title = document.createElement("div");
  title.className = "demographics-line-legend-title";
  title.textContent = t("LOC_DEMOGRAPHICS_LEGEND_TITLE");
  return title;
}

/**
 * Build the shared "All" / "None" bulk-select controls row (All shows every civ,
 * None hides them all). Exported so every chart's legend (line, radar, and so on)
 * renders the identical control block. No-op clicks when no callback is wired.
 * @param {string[]} keys The civ keys (leaderTypes) the buttons bulk-toggle.
 * @param {((hidden: boolean, keys: string[]) => void)|null|undefined} onSetAllHidden
 *   Bulk visibility callback: `(true, keys)` hides all, `(false, keys)` shows all.
 * @returns {HTMLElement}
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
 * @returns {HTMLElement}
 */
export function buildLineLegend(datasets, opts) {
  const legend = document.createElement("div");
  legend.className = "demographics-line-legend";
  legend.appendChild(buildLegendTitle());
  const keys = datasets.map((dataset) => dataset.leaderType).filter(Boolean);
  legend.appendChild(buildLegendControls(keys, opts && opts.onSetAllHidden));
  for (const dataset of datasets) legend.appendChild(buildLegendRow(dataset, opts));
  return legend;
}
