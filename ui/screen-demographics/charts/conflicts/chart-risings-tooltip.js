// chart-risings-tooltip.js
//
// The hover tooltip for a Partisans rising on the Conflicts timeline. It reuses the war tooltip's
// element and head styling (title, dates, status pill) and swaps the cost table for the rising's
// own lines: who held the settlement, why the people rose and how it ended.

import { localYear, t, turnLabel } from "/demographics/ui/core/demographics-i18n.js";
import { getXAxisMode, nearestByTurn } from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";

/**
 * A chart turn in the axis's current time format: "T-40", "1200 BCE" or "1200 BCE (T-40)".
 * @param {number} turn Chart turn.
 * @param {string|undefined} year Year saved with the rising, if any.
 * @param {Map<number, string>} turnYearMap chart turn → year, for risings saved without one.
 * @param {string} [mode] "turn", "year" or "both"; the shared axis mode when omitted.
 * @returns {string}
 */
export function formatAxisPoint(turn, year, turnYearMap, mode) {
  const axis = mode || getXAxisMode();
  const rawYear = year || (turnYearMap && turnYearMap.size ? nearestByTurn(turnYearMap, turn) : null);
  const yearText = rawYear ? localYear(rawYear) : "";
  const turnText = turnLabel(turn);
  if (axis === "turn" || !yearText) return turnText;
  if (axis === "year") return yearText;
  return yearText + " (" + turnText + ")";
}

/**
 * The tooltip's lines for one rising row, as plain data.
 * @param {*} row A rising row (chart-risings-data.js).
 * @param {{ turnYearMap: Map<number, string>, latestTurn: number }} ctx
 * @param {string} [mode] Axis mode override (tests).
 * @returns {{ title: string, dates: string, ongoing: boolean, status: string, owner: string,
 *   cause: string, outcome: string }}
 */
export function buildRisingTooltipModel(row, ctx, mode) {
  const ongoing = typeof row.endTurn !== "number";
  const end = ongoing ? ctx.latestTurn : row.endTurn;
  const startText = formatAxisPoint(row.startTurn, row.startYear, ctx.turnYearMap, mode);
  const endText = ongoing ? t("LOC_DEMOGRAPHICS_WARS_ONGOING") : formatAxisPoint(end, row.endYear, ctx.turnYearMap, mode);
  const turns = Math.max(0, (isFinite(end) ? end : row.startTurn) - row.startTurn);
  return {
    title: row.title,
    dates: startText + " → " + endText + " · " + t("LOC_DEMOGRAPHICS_WARS_DURATION_TURNS", turns),
    ongoing,
    status: ongoing ? t("LOC_DEMOGRAPHICS_WARS_STATUS_ONGOING") : t("LOC_DEMOGRAPHICS_WARS_STATUS_CONCLUDED"),
    owner: t("LOC_DEMOGRAPHICS_RISING_HELD_BY", row.owner),
    cause: row.cause,
    outcome: row.outcome
  };
}

/**
 * @param {HTMLElement} parent
 * @param {string} className
 * @param {string} text
 */
function appendLine(parent, className, text) {
  if (!text) return;
  const div = document.createElement("div");
  div.className = className;
  div.textContent = text;
  parent.appendChild(div);
}

/**
 * Fill the shared Gantt tooltip element for a rising row.
 * @param {HTMLElement} tooltip Cleared and repopulated.
 * @param {*} row
 * @param {*} ctx Shared Gantt context (turnYearMap, latestTurn).
 */
export function renderRisingTooltip(tooltip, row, ctx) {
  const model = buildRisingTooltipModel(row, ctx);
  while (tooltip.firstChild) tooltip.removeChild(tooltip.firstChild);
  const head = document.createElement("div");
  head.className = "demographics-wars-tooltip-head";
  appendLine(head, "demographics-wars-tooltip-title", model.title);
  appendLine(head, "demographics-wars-tooltip-subtitle", model.dates);
  const pill = document.createElement("span");
  pill.className = "demographics-wars-tooltip-status " + (model.ongoing ? "is-ongoing" : "is-concluded");
  pill.textContent = model.status;
  head.appendChild(pill);
  tooltip.appendChild(head);
  appendLine(tooltip, "demographics-wars-tooltip-declared", model.owner);
  const divider = document.createElement("div");
  divider.className = "demographics-wars-tooltip-divider";
  tooltip.appendChild(divider);
  appendLine(tooltip, "demographics-rising-tooltip-line", model.cause);
  appendLine(tooltip, "demographics-rising-tooltip-line is-outcome", model.outcome);
}
