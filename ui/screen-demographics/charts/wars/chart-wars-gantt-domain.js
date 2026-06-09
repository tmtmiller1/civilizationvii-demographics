// chart-wars-gantt-domain.js
//
// Domain and layout helpers for wars Gantt timeline.

import { majorsOnSide } from "/demographics/ui/screen-demographics/charts/wars/chart-wars-naming.js";

/**
 * Whether a war pits at least one major civ on each side.
 * @param {*} war War record.
 * @returns {boolean} True for major-vs-major wars.
 */
function isMajorVsMajor(war) {
  return majorsOnSide(war.sideACivs).length > 0 && majorsOnSide(war.sideBCivs).length > 0;
}

/**
 * The major-civ pids participating in one war.
 * @param {*} war War record.
 * @returns {number[]} Major participant pids.
 */
function majorPidsForWar(war) {
  return /** @type {number[]} */ ([])
    .concat(majorsOnSide(war.sideACivs), majorsOnSide(war.sideBCivs))
    .map((r) => {
      if (typeof r === "object" && r !== null && "pid" in r) {
        return Number(/** @type {{ pid: * }} */ (r).pid);
      }
      return Number(r);
    });
}

/**
 * Filter wars to major-vs-major engagements matching active filters.
 * @param {*[]} wars War list.
 * @param {boolean} showActiveOnly Hide concluded wars when true.
 * @param {number|null} filterPid Optional civ filter pid.
 * @returns {*[]} Filtered wars.
 */
export function filterGanttWars(wars, showActiveOnly, filterPid) {
  return wars.filter((war) => {
    if (showActiveOnly && typeof war.endTurn === "number") return false;
    if (!isMajorVsMajor(war)) return false;
    if (filterPid !== null && !majorPidsForWar(war).includes(Number(filterPid))) {
      return false;
    }
    return true;
  });
}

/**
 * Compute min start / max end turn across in-range wars.
 * @param {*[]} filtered Filtered wars.
 * @param {{ min: number, max: number }|null} turnRange Time-range filter.
 * @param {number} latestTurn Latest sampled turn.
 * @returns {{ xMin: number, xMax: number }} Raw span.
 */
function ganttWarSpan(filtered, turnRange, latestTurn) {
  let xMin = Infinity;
  let xMax = -Infinity;
  for (const war of filtered) {
    const start = war.startTurn;
    const end = typeof war.endTurn === "number" ? war.endTurn : latestTurn;
    if (turnRange && (end < turnRange.min || start > turnRange.max)) continue;
    if (start < xMin) xMin = start;
    if (end > xMax) xMax = end;
  }
  return { xMin, xMax };
}

/**
 * Extend right edge to include current turn and future tail room for ongoing wars.
 * @param {*[]} filtered Filtered wars.
 * @param {number} xMin Domain left edge.
 * @param {number} xMax Domain right edge.
 * @param {number} latestTurn Latest sampled turn.
 * @returns {number} Extended right edge.
 */
function extendDomainFuture(filtered, xMin, xMax, latestTurn) {
  let max = xMax;
  if (isFinite(latestTurn) && latestTurn > max) max = latestTurn;
  // Always leave trailing room on the all-time view so the timeline visibly
  // "trails off" past the latest event - giving the tail markers (final crisis
  // stage, age transition) space to the right of their lines, and making ongoing
  // wars (which get a touch more) read as still running.
  const ongoing = filtered.some((war) => typeof war.endTurn !== "number");
  const span = Math.max(1, max - xMin);
  const futurePad = Math.max(ongoing ? 6 : 3, Math.round(span * (ongoing ? 0.1 : 0.06)));
  return max + futurePad;
}

/**
 * Compute Gantt x-domain [xMin, xMax].
 * @param {*[]} filtered Filtered wars.
 * @param {{ min: number, max: number }|null} turnRange Optional turn-range filter.
 * @param {number} latestTurn Latest sampled turn.
 * @param {*[]} samples Sample stream fallback.
 * @returns {{ xMin: number, xMax: number }} Domain.
 */
export function computeGanttDomain(filtered, turnRange, latestTurn, samples) {
  const span = ganttWarSpan(filtered, turnRange, latestTurn);
  let xMin = span.xMin;
  let xMax = span.xMax;
  if (!isFinite(xMin)) xMin = samples[0]?.turn ?? 0;
  if (!isFinite(xMax)) xMax = latestTurn || xMin + 1;

  if (turnRange) {
    xMin = turnRange.min;
    xMax = turnRange.max;
  } else {
    xMax = extendDomainFuture(filtered, xMin, xMax, latestTurn);
  }
  if (xMin === xMax) xMax = xMin + 1;
  return { xMin, xMax };
}

const GANTT_MIN_PX_PER_TURN = 14;
const GANTT_PAD_LR = 120;
const GANTT_BAR_H = 24;
const GANTT_BAR_H_MAX = 64;
const GANTT_PER_STRIPE = 7;
const GANTT_ROW_GAP = 10;

/**
 * Compute natural pixel width for the Gantt canvas.
 * @param {number} viewportW Host viewport width.
 * @param {{ xMin: number, xMax: number }} dom Domain.
 * @returns {number} Canvas width.
 */
export function computeGanttWidth(viewportW, dom) {
  const span = Math.max(1, dom.xMax - dom.xMin);
  const naturalInner = span * GANTT_MIN_PX_PER_TURN;
  const innerW = Math.max(viewportW - GANTT_PAD_LR, naturalInner);
  return Math.round(innerW + GANTT_PAD_LR);
}

/**
 * Belligerent major count for one war.
 * @param {*} war War record.
 * @returns {number} Stripe count.
 */
function warStripeCount(war) {
  return Math.max(2, majorsOnSide(war.sideACivs).length + majorsOnSide(war.sideBCivs).length);
}

/**
 * Bar height for one war.
 * @param {*} war War record.
 * @returns {number} Height in px.
 */
function barHeightFor(war) {
  return Math.min(
    GANTT_BAR_H_MAX,
    GANTT_BAR_H + Math.max(0, warStripeCount(war) - 2) * GANTT_PER_STRIPE
  );
}

/**
 * Build layout metrics and mappers for Gantt rendering.
 * @param {number} width Canvas width.
 * @param {number} minHeight Minimum caller height.
 * @param {*[]} wars Filtered wars.
 * @param {{ xMin: number, xMax: number }} dom Domain.
 * @returns {{
 *   padL: number,
 *   padT: number,
 *   innerW: number,
 *   innerH: number,
 *   H: number,
 *   rowTops: number[],
 *   rowHeights: number[],
 *   barH: number,
 *   xOf: (t:number) => number
 * }} Layout.
 */
export function buildGanttLayout(width, minHeight, wars, dom) {
  const padL = 60;
  const padR = 60;
  const padT = 30;
  const padB = 64;

  const rowTops = [];
  const rowHeights = [];
  let accumY = padT + 6;
  for (const war of wars) {
    const h = barHeightFor(war);
    rowTops.push(accumY);
    rowHeights.push(h);
    accumY += h + GANTT_ROW_GAP;
  }

  const minInnerH = Math.max(120, accumY - padT - 6 + 16);
  const H = Math.max(minHeight, padT + minInnerH + padB);
  const innerW = width - padL - padR;
  const innerH = H - padT - padB;

  return {
    padL,
    padT,
    innerW,
    innerH,
    H,
    rowTops,
    rowHeights,
    barH: GANTT_BAR_H,
    xOf: (t) => padL + ((t - dom.xMin) / (dom.xMax - dom.xMin || 1)) * innerW
  };
}
