// chart-line-tooltip.js
//
// HTML-overlay tooltip for the per-civ line chart, bound via the Chart.js
// `external` hook. Rows are built as real DOM nodes so the leader portrait can
// use a live <fxs-icon> element (UI.getIconURL is not available in this screen).

import { safeTextColor } from "/demographics/ui/core/civ-color-utils.js";

/** @param {HTMLElement} wrap */
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
 * @param {*} chart
 * @returns {*[]}
 */
function sortTooltipDataPoints(tooltip, chart) {
  /** @type {*[]} */
  const dataPoints = tooltip.dataPoints ? tooltip.dataPoints.slice() : [];
  if (dataPoints.length && chart.data && chart.data.datasets) {
    const datasetOrder = chart.data.datasets.map((/** @type {*} */ dataset) => dataset.label);
    dataPoints.sort((/** @type {*} */ a, /** @type {*} */ b) => {
      const aIdx = datasetOrder.indexOf(a.dataset.label);
      const bIdx = datasetOrder.indexOf(b.dataset.label);
      return aIdx - bIdx;
    });
  }
  return dataPoints;
}

/**
 * Build the round leader-portrait element for a dataset: a live <fxs-icon> when
 * a LEADER_* type is known (same element the WorldRankingsAllCivs uses), else null.
 * @param {Record<string, *>} dataset
 * @returns {HTMLElement|null} The portrait wrapper, or null when no leader icon.
 */
function buildLeaderPortrait(dataset) {
  // Use the canonical LEADER_* string (leaderTypeString), not the dataset's
  // `leaderType` series key: that key is the raw hash / "pid:<id>" and never
  // matches /^LEADER_/, so the portrait would always be skipped.
  const leaderType = dataset.leaderTypeString;
  if (!(typeof leaderType === "string" && /^LEADER_/.test(leaderType))) return null;
  const wrap = document.createElement("div");
  wrap.className = "demographics-line-tip-portrait";
  const icon = document.createElement("fxs-icon");
  icon.className = "demographics-line-tip-portrait-icon";
  icon.setAttribute("data-icon-id", leaderType);
  icon.setAttribute("data-icon-context", "LEADER");
  wrap.appendChild(icon);
  return wrap;
}

/**
 * Build the icon group: the leader portrait (when available) next to the civ's
 * colored circle, mirroring the wars tooltip. The colored circle always shows.
 * @param {Record<string, *>} dataset
 * @param {string} color The (lifted) row color.
 * @returns {HTMLElement}
 */
export function buildLeaderIconGroup(dataset, color) {
  const group = document.createElement("div");
  group.className = "demographics-line-tip-iconrow";
  const portrait = buildLeaderPortrait(dataset);
  if (portrait) group.appendChild(portrait);
  const dot = document.createElement("div");
  dot.className = "demographics-line-tip-dot";
  dot.style.background = color;
  group.appendChild(dot);
  return group;
}

/**
 * Append an optional source-attribution line to a tooltip row (for metrics that supply a
 * `tooltipAttribution` callback, e.g. the Emigration per-cause breakdown). No-op otherwise; a
 * callback throw is swallowed so a bad attribution can't break the tooltip.
 * @param {HTMLElement} row
 * @param {*} metricMeta May carry tooltipAttribution.
 * @param {*} dataset
 * @param {string} color The row's (lifted) text color.
 */
function appendAttribution(row, metricMeta, dataset, color) {
  if (!metricMeta || typeof metricMeta.tooltipAttribution !== "function") return;
  try {
    // Use `!= null` (not `||`): the local player is pid 0, which `||` would treat as falsy
    // and fall back to the civ name, breaking the attribution lookup for your own civ.
    const id = dataset.pidForContext != null ? dataset.pidForContext : dataset.label;
    const attribution = metricMeta.tooltipAttribution({ id });
    if (!attribution) return;
    const attributionEl = document.createElement("div");
    attributionEl.className = "demographics-line-tip-attribution";
    attributionEl.style.color = color;
    attributionEl.style.fontSize = "0.85em";
    attributionEl.style.marginTop = "2px";
    // Own line inside the (column) row; wrap within the box rather than running off the right edge.
    // (The companion CSS file isn't loaded, so these must be inline.)
    attributionEl.style.display = "block";
    attributionEl.style.whiteSpace = "normal";
    attributionEl.style.overflowWrap = "break-word";
    attributionEl.textContent = attribution;
    row.appendChild(attributionEl);
  } catch (_) {
    // ignore attribution errors
  }
}

/**
 * Build the horizontal top line of a tooltip row: leader icon + civ name + value.
 * @param {*} dataset
 * @param {*} dataPoint One Chart.js tooltip data point.
 * @param {(value: number) => string} fmtY
 * @param {string} color The row's (lifted) text color.
 * @returns {HTMLElement}
 */
function buildTooltipTopLine(dataset, dataPoint, fmtY, color) {
  const top = document.createElement("div");
  top.style.display = "flex";
  top.style.alignItems = "center";
  top.style.gap = "0.45rem";
  top.appendChild(buildLeaderIconGroup(dataset, color));

  const label = document.createElement("span");
  label.className = "demographics-line-tip-name";
  label.textContent = dataset.label || "";
  top.appendChild(label);

  const valueEl = document.createElement("span");
  valueEl.className = "demographics-line-tip-val";
  valueEl.style.color = color;
  valueEl.textContent = fmtY(dataPoint.parsed.y);
  top.appendChild(valueEl);
  return top;
}

/**
 * Build one tooltip row: a vertical stack of the top line (icon + civ + value) and, below it, the
 * optional source-attribution line.
 * @param {*} dataPoint One Chart.js tooltip data point.
 * @param {(value: number) => string} fmtY
 * @param {*} [metricMeta] May carry a tooltipAttribution callback.
 * @returns {HTMLElement}
 */
function buildTooltipRow(dataPoint, fmtY, metricMeta) {
  const dataset = dataPoint.dataset;
  const rawColor = typeof dataset.borderColor === "string" ? dataset.borderColor : "#e5d2ac";
  // Lift dark civ colors (dark blue/purple) so the value column and the
  // colored dot stay readable on the dark tooltip background.
  const color = safeTextColor(rawColor);

  // Outer = vertical stack so the attribution sits on its own line below the civ row. (Relying on
  // flex-wrap is fragile in the GameFace CSS engine; an explicit column container holds up.)
  const row = document.createElement("div");
  row.className = "demographics-line-tip-row";
  row.style.flexDirection = "column";
  row.style.alignItems = "stretch";
  row.appendChild(buildTooltipTopLine(dataset, dataPoint, fmtY, color));
  appendAttribution(row, metricMeta, dataset, color);
  return row;
}

/**
 * @param {string} titleText
 * @returns {HTMLElement} The tooltip header (turn / year).
 */
function buildTooltipHeader(titleText) {
  const head = document.createElement("div");
  head.className = "demographics-line-tip-head";
  head.textContent = titleText;
  return head;
}

/** Gap between the cursor and the tooltip box, px. */
const CARET_GAP = 14;
/** Frames to wait for GameFace to lay the box out before giving up on a re-place. */
const SETTLE_FRAMES = 4;

/**
 * The size each tooltip box last measured. GameFace reports a freshly filled box as zero wide for a
 * frame or two, and a zero width makes the right-edge flip unreachable: a tooltip near the right of
 * the plot ran off the chart and was cut by its edge. The box is rebuilt on every move with nearly
 * the same rows, so its previous size is a close estimate until the real one arrives.
 * @type {WeakMap<HTMLElement, { w: number, h: number }>}
 */
const lastTipSize = new WeakMap();

/** @type {WeakMap<HTMLElement, number>} Bumped on every placement so a stale re-place is dropped. */
const placeToken = new WeakMap();

/**
 * @param {HTMLElement} tip
 * @returns {{ w: number, h: number } | null} The laid-out size, or null while GameFace reports 0.
 */
function measuredSize(tip) {
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  return w > 0 && h > 0 ? { w, h } : null;
}

/**
 * Set the tooltip's left/top for a caret: right of the cursor, or left of it when the box would
 * pass the wrap's right edge, then clamped inside the wrap.
 * @param {HTMLElement} tip
 * @param {{ x: number, y: number }} caret The cursor point, in wrap pixels.
 * @param {{ w: number, h: number }} size
 * @param {HTMLElement} wrap
 */
function placeTip(tip, caret, size, wrap) {
  const wrapW = wrap.clientWidth;
  const wrapH = wrap.clientHeight;
  let left = caret.x + CARET_GAP;
  if (left + size.w > wrapW) left = caret.x - size.w - CARET_GAP;
  left = Math.max(4, Math.min(left, wrapW - size.w - 4));
  let top = caret.y - 8;
  if (top + size.h > wrapH) top = wrapH - size.h - 4;
  if (top < 0) top = 4;
  tip.style.left = left + "px";
  tip.style.top = top + "px";
}

/**
 * Re-place the tooltip once GameFace has laid the new box out, and remember its size.
 * @param {HTMLElement} tip
 * @param {{ x: number, y: number }} caret
 * @param {HTMLElement} wrap
 */
function settleTip(tip, caret, wrap) {
  const token = (placeToken.get(tip) || 0) + 1;
  placeToken.set(tip, token);
  if (typeof requestAnimationFrame !== "function") return;
  let framesLeft = SETTLE_FRAMES;
  const retry = () => {
    if (placeToken.get(tip) !== token || tip.style.opacity === "0") return;
    const size = measuredSize(tip);
    if (size) {
      lastTipSize.set(tip, size);
      placeTip(tip, caret, size, wrap);
      return;
    }
    if (--framesLeft > 0) requestAnimationFrame(retry);
  };
  requestAnimationFrame(retry);
}

/**
 * Position the HTML tooltip next to the cursor, inside the wrap.
 * @param {HTMLElement} tip
 * @param {*} chart
 * @param {*} tooltip The Chart.js tooltip model.
 * @param {HTMLElement} wrap
 */
export function positionChartTooltip(tip, chart, tooltip, wrap) {
  // Chart.js gives caretX/Y in canvas pixels; the wrap holds both the canvas and the tooltip.
  const caret = { x: chart.canvas.offsetLeft + tooltip.caretX, y: chart.canvas.offsetTop + tooltip.caretY };
  // Bound the box to the chart area so a tall multi-civ tooltip can't run off the bottom; if it
  // would still exceed, let it scroll within itself rather than overflow.
  tip.style.maxHeight = Math.max(0, wrap.clientHeight - 8) + "px";
  tip.style.overflowY = "auto";
  const size = measuredSize(tip) || lastTipSize.get(tip) || { w: 0, h: 0 };
  placeTip(tip, caret, size, wrap);
  tip.style.opacity = "1";
  settleTip(tip, caret, wrap);
}

/**
 * Build the Chart.js `tooltip.external` handler bound to the axis formatters and metric metadata.
 * @param {(value: number) => string} fmtX
 * @param {(value: number) => string} fmtY
 * @param {*} [metricMeta]
 * @returns {(context: *) => void}
 */
export function makeTooltipExternal(fmtX, fmtY, metricMeta) {
  return function (context) {
    const { chart, tooltip } = context;
    // Chart.js can fire the external handler on a torn-down chart (canvas detached / null).
    const wrap = chart && chart.canvas ? chart.canvas.parentNode : null;
    if (!wrap || !tooltip) return;
    const tip = ensureChartTooltipEl(wrap);
    if (tooltip.opacity === 0) {
      tip.style.opacity = "0";
      return;
    }
    const titleText =
      tooltip.dataPoints && tooltip.dataPoints.length ? fmtX(tooltip.dataPoints[0].parsed.x) : "";
    // Body: one row per civ, with leader portrait + dot + name + value, sorted
    // to match chart/legend line order.
    const dataPoints = sortTooltipDataPoints(tooltip, chart);
    while (tip.firstChild) tip.removeChild(tip.firstChild);
    tip.appendChild(buildTooltipHeader(titleText));
    for (const dataPoint of dataPoints) tip.appendChild(buildTooltipRow(dataPoint, fmtY, metricMeta));
    positionChartTooltip(tip, chart, tooltip, wrap);
  };
}
