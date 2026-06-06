// chart-line-tooltip.js
//
// HTML-overlay tooltip for the per-civ line chart: ensures the tooltip DOM
// element, sorts data-points to match legend order, builds per-civ rows (leader
// portrait + colored dot + name + value), positions the tip near the cursor,
// and binds it all via the Chart.js `external` hook. Extracted from
// chart-line.js (remediation #26).
//
// Rows are built as real DOM nodes (not an innerHTML string) so the leader
// portrait can use a live <fxs-icon> element - the same element the Factbook
// and wars tooltip use. UI.getIconURL is NOT available in this custom screen,
// so the URL-background approach renders nothing here.

import { safeTextColor } from "/demographics/ui/civ-color-utils.js";

/**
 * Ensure the HTML-overlay line-chart tooltip element exists in `wrap`.
 * @param {HTMLElement} wrap The chart wrap.
 * @returns {HTMLElement} The tooltip element.
 */
function ensureChartTooltipEl(wrap) {
  let tip = /** @type {HTMLElement|null} */ (wrap.querySelector(".demographics-chart-tooltip"));
  if (!tip) {
    tip = document.createElement("div");
    tip.className =
      "demographics-chart-tooltip demographics-line-chart-tooltip demographics-tip-chrome";
    wrap.appendChild(tip);
  }
  return tip;
}

/**
 * Sort tooltip data points to match the chart/legend dataset order.
 * @param {*} tooltip The Chart.js tooltip model.
 * @param {*} chart The Chart instance.
 * @returns {*[]} The ordered data-point array.
 */
function sortTooltipDataPoints(tooltip, chart) {
  /** @type {*[]} */
  const dataPoints = tooltip.dataPoints ? tooltip.dataPoints.slice() : [];
  if (dataPoints.length && chart.data && chart.data.datasets) {
    const dsOrder = chart.data.datasets.map((/** @type {*} */ ds) => ds.label);
    dataPoints.sort((/** @type {*} */ a, /** @type {*} */ b) => {
      const ai = dsOrder.indexOf(a.dataset.label);
      const bi = dsOrder.indexOf(b.dataset.label);
      return ai - bi;
    });
  }
  return dataPoints;
}

/**
 * Build the round leader-portrait element for a dataset: a live <fxs-icon> when
 * a LEADER_* type is known (same element the Factbook uses), else null.
 * @param {Record<string, *>} ds The Chart.js dataset.
 * @returns {HTMLElement|null} The portrait wrapper, or null when no leader icon.
 */
function buildLeaderPortrait(ds) {
  // Use the canonical LEADER_* string (leaderTypeString), NOT the dataset's
  // `leaderType` series key - that key is the raw hash / "pid:<id>" and never
  // matches /^LEADER_/, so the portrait would always be skipped.
  const lt = ds.leaderTypeString;
  if (!(typeof lt === "string" && /^LEADER_/.test(lt))) return null;
  const wrap = document.createElement("div");
  wrap.className = "demographics-line-tip-portrait";
  const icon = document.createElement("fxs-icon");
  icon.className = "demographics-line-tip-portrait-icon";
  icon.setAttribute("data-icon-id", lt);
  icon.setAttribute("data-icon-context", "LEADER");
  wrap.appendChild(icon);
  return wrap;
}

/**
 * Build the icon group: the leader portrait (when available) next to the civ's
 * colored circle, mirroring the wars tooltip. The colored circle always shows.
 * @param {Record<string, *>} ds The Chart.js dataset.
 * @param {string} color The (lifted) row color.
 * @returns {HTMLElement} The icon-group element.
 */
export function buildLeaderIconGroup(ds, color) {
  const group = document.createElement("div");
  group.className = "demographics-line-tip-iconrow";
  const portrait = buildLeaderPortrait(ds);
  if (portrait) group.appendChild(portrait);
  const dot = document.createElement("div");
  dot.className = "demographics-line-tip-dot";
  dot.style.background = color;
  group.appendChild(dot);
  return group;
}

/**
 * Build one tooltip row element (icon group + civ label + value).
 * @param {*} dp One Chart.js tooltip data point.
 * @param {(v: number) => string} fmtY Y-value formatter.
 * @returns {HTMLElement} The row element.
 */
function buildTooltipRow(dp, fmtY) {
  const ds = dp.dataset;
  const rawColor = typeof ds.borderColor === "string" ? ds.borderColor : "#e5d2ac";
  // Lift dark civ colors (dark blue/purple) so the value column and the
  // colored dot stay readable on the dark tooltip background.
  const color = safeTextColor(rawColor);

  const row = document.createElement("div");
  row.className = "demographics-line-tip-row";
  row.appendChild(buildLeaderIconGroup(ds, color));

  const label = document.createElement("span");
  label.className = "demographics-line-tip-name";
  label.textContent = ds.label || "";
  row.appendChild(label);

  const val = document.createElement("span");
  val.className = "demographics-line-tip-val";
  val.style.color = color;
  val.textContent = fmtY(dp.parsed.y);
  row.appendChild(val);
  return row;
}

/**
 * Build the tooltip header (turn / year).
 * @param {string} titleText The header text.
 * @returns {HTMLElement} The header element.
 */
function buildTooltipHeader(titleText) {
  const head = document.createElement("div");
  head.className = "demographics-line-tip-head";
  head.textContent = titleText;
  return head;
}

/**
 * Position the HTML tooltip near the cursor, clamped inside the wrap.
 * @param {HTMLElement} tip The tooltip element.
 * @param {*} chart The Chart instance.
 * @param {*} tooltip The Chart.js tooltip model.
 * @param {HTMLElement} wrap The chart wrap.
 */
function positionChartTooltip(tip, chart, tooltip, wrap) {
  // Position next to the cursor. Chart.js gives caretX/Y in canvas pixels -
  // relative to the parent wrap that contains both canvas+tooltip.
  const offsetLeft = chart.canvas.offsetLeft;
  const offsetTop = chart.canvas.offsetTop;
  let left = offsetLeft + tooltip.caretX + 14;
  let top = offsetTop + tooltip.caretY - 8;
  // Clamp so it doesn't escape the wrap.
  const wrapW = wrap.clientWidth,
    wrapH = wrap.clientHeight;
  const tipW = tip.offsetWidth,
    tipH = tip.offsetHeight;
  if (left + tipW > wrapW) left = offsetLeft + tooltip.caretX - tipW - 14;
  if (top + tipH > wrapH) top = wrapH - tipH - 4;
  if (top < 0) top = 4;
  tip.style.left = left + "px";
  tip.style.top = top + "px";
  tip.style.opacity = "1";
}

/**
 * Build the Chart.js `tooltip.external` handler bound to the axis formatters.
 * @param {(v: number) => string} fmtX X-value formatter.
 * @param {(v: number) => string} fmtY Y-value formatter.
 * @returns {(context: *) => void} The external tooltip handler.
 */
export function makeTooltipExternal(fmtX, fmtY) {
  return function (context) {
    const { chart, tooltip } = context;
    const wrap = chart.canvas.parentNode;
    const tip = ensureChartTooltipEl(wrap);
    if (tooltip.opacity === 0) {
      tip.style.opacity = "0";
      return;
    }
    // Header: turn / year.
    const titleText =
      tooltip.dataPoints && tooltip.dataPoints.length ? fmtX(tooltip.dataPoints[0].parsed.x) : "";
    // Body: one row per civ, with leader portrait + dot + name + value, sorted
    // to match chart/legend line order.
    const dataPoints = sortTooltipDataPoints(tooltip, chart);
    while (tip.firstChild) tip.removeChild(tip.firstChild);
    tip.appendChild(buildTooltipHeader(titleText));
    for (const dp of dataPoints) tip.appendChild(buildTooltipRow(dp, fmtY));
    positionChartTooltip(tip, chart, tooltip, wrap);
  };
}
