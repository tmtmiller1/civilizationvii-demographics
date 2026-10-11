// chart-style.js
//
// Styling shared by every Chart.js chart (the line chart, the trends board and the scatter) so
// their axes, fonts and legends read identically. The canvas needs literal colors, not CSS vars.

import { localeFontFamily } from "/demographics/ui/core/demographics-i18n.js";

/** Axis labels and titles: the chart's HTML title color (--dg-text-secondary). */
export const AXIS_COLOR = "#e5d2ac";
export const GRID_COLOR = "rgba(133, 135, 140, 0.25)";
export const AXIS_BORDER_COLOR = "#85878C";

/**
 * The font family to draw chart text in: the chart's own font, else the Chart.js default, else
 * the locale's body font.
 * @param {*} [chart] A Chart.js instance, when drawing inside one.
 * @returns {string}
 */
export function chartFontFamily(chart) {
  return (
    chart?.options?.font?.family ||
    (typeof Chart !== "undefined" && Chart.defaults?.font?.family) ||
    localeFontFamily("body")
  );
}

/**
 * A Chart.js scale `title` block in the axis color.
 * @param {string} text
 * @returns {Record<string, *>}
 */
export function axisTitle(text) {
  return {
    display: !!text,
    text,
    color: AXIS_COLOR,
    font: { family: chartFontFamily(), size: 18, weight: "600" }
  };
}

/**
 * The civ-legend callbacks bound to a render's options.
 * @param {*} opts
 * @returns {Record<string, *>}
 */
export function civLegendOpts(opts) {
  return {
    hiddenCivs: opts.hiddenCivs,
    onToggleVisibility: (/** @type {string} */ key) => opts.onToggleCiv && opts.onToggleCiv(key),
    onSetAllHidden: (/** @type {boolean} */ hidden, /** @type {string[]} */ keys) =>
      opts.onSetAllHidden && opts.onSetAllHidden(hidden, keys)
  };
}
