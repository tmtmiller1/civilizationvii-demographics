// chart-conflicts-timeline-overlays.js
//
// HTML overlays for the Conflicts Gantt timeline: the absolutely-positioned
// labels mounted ON TOP of the SVG (crisis pills, war-name boxes, x-ticks, axis
// titles, the "Present" marker, age chips). Extracted from chart-conflicts-timeline.js
// so that file keeps the SVG drawing + data prep while label rendering lives here —
// the same sibling pattern as chart-wars-gantt-bars / -domain / -interactions.
//
// mountGanttOverlays() is the single entry point; the per-overlay mounters below
// are internal. % positions are pixel-derived (canvas scales the SVG + overlays
// together) so they stay aligned at any size.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { getXAxisMode } from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";
import {
  mountStackAxisTitles,
  mountStackXTicks
} from "/demographics/ui/screen-demographics/charts/shared/chart-stack-grid.js";
import {
  buildContinentMap,
  buildWarNameOverrides,
  conflictLabelText
} from "/demographics/ui/screen-demographics/charts/wars/chart-wars-naming.js";
import {
  CRISIS_STAGE_COLORS,
  CRISIS_STAGE_LABELS
} from "/demographics/ui/screen-demographics/charts/crises/crisis-stage-data.js";
import { flavorCrisisName } from "/demographics/ui/screen-demographics/charts/crises/crisis-names.js";

/**
 * Mount the crisis stage-onset HTML labels atop each overlay line: a two-line
 * pill (stage label in the stage color, crisis name below), staggered down so
 * adjacent onsets don't collide. Mirrors the historical charts' marker labels.
 * @param {HTMLElement} wrap The chart canvas.
 * @param {{ stage: number, turn: number, sample: Snapshot }[]} onsets The crisis onsets.
 * @param {{ L: *, dom: { xMin: number, xMax: number }, seed: string,
 *   W: number, H: number }} ctx Layout, x-domain, seed and canvas dimensions.
 */
function mountCrisisLabels(wrap, onsets, ctx) {
  const { L, dom, seed, W, H } = ctx;
  (onsets || []).forEach((o, i) => {
    if (o.turn < dom.xMin || o.turn > dom.xMax) return;
    const idx = Math.max(0, Math.min(3, o.stage - 1));
    const x = L.xOf(o.turn);
    const div = document.createElement("div");
    div.className = "demographics-wars-crisis-label";
    // Per-marker geometry stays dynamic; stagger each label down to reduce overlap.
    div.style.left = (x / W) * 100 + "%";
    div.style.top = ((L.padT + 2 + (i % 3) * 30) / H) * 100 + "%";
    const stage = document.createElement("div");
    stage.className = "demographics-wars-crisis-label-stage";
    stage.style.color = CRISIS_STAGE_COLORS[idx];
    stage.textContent = t(CRISIS_STAGE_LABELS[idx]);
    div.appendChild(stage);
    const name = document.createElement("div");
    name.className = "demographics-wars-crisis-label-name";
    name.textContent = flavorCrisisName(o.sample, o.stage, seed);
    div.appendChild(name);
    wrap.appendChild(div);
  });
}

/**
 * Mount one war-name label: the FULL name in a neutral box (never truncated),
 * anchored at the bar's left edge - or, for a bar in the right third of the
 * chart, with its right edge at the bar end so a long name grows left and isn't
 * clipped by the canvas edge.
 * @param {HTMLElement} wrap The chart canvas.
 * @param {*} rect The bar hit-test rect.
 * @param {{ nameOverride: Map<*, string>, turnYearMap: Map<number, string>,
 *   latestTurn: number, W: number, H: number }} env Shared inputs.
 */
function mountOneWarLabel(wrap, rect, env) {
  const { nameOverride, turnYearMap, latestTurn, W, H } = env;
  const { war, x, y, h } = rect;
  const xRight = x + (rect.hitW ?? rect.w);
  const label = conflictLabelText(war, nameOverride, turnYearMap, latestTurn);
  const div = document.createElement("div");
  div.className = "demographics-chart-war-label demographics-wars-label";
  // Per-bar geometry stays dynamic (pixel-derived percentages).
  div.style.top = ((y + h / 2) / H) * 100 + "%";
  if (x <= W * 0.66) {
    div.style.left = (x / W) * 100 + "%";
  } else {
    div.classList.add("demographics-wars-label-anchor-right");
    div.style.left = (xRight / W) * 100 + "%";
  }
  // The name sits in a neutral box so it stays readable over any banner color.
  const box = document.createElement("span");
  box.className = "demographics-wars-label-box";
  box.textContent = label;
  div.appendChild(box);
  wrap.appendChild(div);
}

/**
 * Mount the per-bar war-name labels into the canvas.
 * @param {HTMLElement} wrap The chart canvas.
 * @param {*[]} barRects The bar rects.
 * @param {{ nameOverride: Map<*, string>, turnYearMap: Map<number, string>,
 *   latestTurn: number, W: number, H: number }} env war naming, year map, latest
 *   turn and canvas dimensions (passed straight through to mountOneWarLabel).
 */
function mountConflictLabels(wrap, barRects, env) {
  for (const rect of barRects) mountOneWarLabel(wrap, rect, env);
}

/**
 * Mount the Gantt X-tick HTML labels (year and/or turn per axis mode).
 * @param {HTMLElement} wrap The chart wrap.
 * @param {{ t: number, x: number, year: string|null }[]} tickPositions Ticks.
 * @param {*} L The layout.
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 */
function mountGanttXTicks(wrap, tickPositions, L, W, H) {
  mountStackXTicks(wrap, tickPositions.map((tick) => ({
    t: tick.t,
    x: tick.x,
    year: tick.year,
    labelY: L.padT + L.innerH + 8
  })), {
    W,
    H,
    mode: /** @type {"turn"|"year"|"both"} */ (getXAxisMode()),
    className: "demographics-chart-x-tick demographics-wars-x-tick",
    turnParenWhenBoth: true
  });
}

/**
 * Mount the Gantt axis titles.
 * @param {HTMLElement} wrap The chart wrap.
 * @param {*} L The layout.
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 */
function mountGanttAxisTitles(wrap, L, W, H) {
  mountStackAxisTitles(wrap, {
    L,
    W,
    H,
    xClassName:
      "demographics-chart-axis-title demographics-chart-axis-x demographics-wars-axis-title demographics-wars-axis-x",
    yClassName:
      "demographics-chart-axis-title demographics-chart-axis-y demographics-wars-axis-title demographics-wars-axis-y",
    xText: t("LOC_DEMOGRAPHICS_AXIS_TIME"),
    yText: t("LOC_DEMOGRAPHICS_AXIS_CONFLICTS")
  });
}

/**
 * Mount the "Present" label atop the current-turn (yellow) line, when that turn
 * is in range.
 * @param {HTMLElement} wrap The chart canvas.
 * @param {*} L The layout.
 * @param {number} latestTurn The latest sampled turn.
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 */
function mountCurrentTurnLabel(wrap, L, latestTurn, W, H) {
  if (!isFinite(latestTurn)) return;
  const x = L.xOf(latestTurn);
  if (x < L.padL || x > L.padL + L.innerW) return;
  const div = document.createElement("div");
  div.className = "demographics-wars-now-label";
  // Per-marker position stays dynamic (pixel-derived percentages).
  div.style.left = (x / W) * 100 + "%";
  div.style.top = (L.padT / H) * 100 + "%";
  div.textContent = t("LOC_DEMOGRAPHICS_WARS_NOW", latestTurn);
  wrap.appendChild(div);
}

/**
 * Mount the age-transition HTML labels (purple chip) at the bottom of each age
 * line - mirroring the line charts, kept low so they never clash with the crisis
 * labels stacked from the top.
 * @param {HTMLElement} wrap The chart wrap.
 * @param {{ turn: number, label: string }[]} markers Age markers.
 * @param {{ L: *, dom: { xMin: number, xMax: number }, W: number,
 *   H: number }} ctx Layout, x-domain and canvas dimensions.
 */
function mountGanttAgeLabels(wrap, markers, ctx) {
  const { L, dom, W, H } = ctx;
  for (const m of markers || []) {
    if (m.turn < dom.xMin || m.turn > dom.xMax) continue;
    const x = L.xOf(m.turn);
    const div = document.createElement("div");
    div.className = "demographics-wars-age-label";
    div.style.left = (x / W) * 100 + "%";
    div.style.top = ((L.padT + L.innerH - 24) / H) * 100 + "%";
    div.textContent = m.label;
    wrap.appendChild(div);
  }
}

/**
 * Mount the chart's HTML overlays onto the canvas: x-ticks, axis titles, the
 * current-turn label, crisis + age markers, and the per-bar war-name labels.
 * @param {HTMLElement} canvas The inner chart canvas.
 * @param {*} env The shared environment (see mountGanttWrap in chart-conflicts-timeline.js).
 * @returns {Map<*, string>} The war → display-name map (reused by the hover ctx).
 */
export function mountGanttOverlays(canvas, env) {
  const { tickPositions, L, W, H, latestTurn, crisisOnsets, dom, crisisSeed } = env;
  const { ageMarkers, merged, turnYearMap, samples, barRects } = env;
  mountGanttXTicks(canvas, tickPositions, L, W, H);
  mountGanttAxisTitles(canvas, L, W, H);
  mountCurrentTurnLabel(canvas, L, latestTurn, W, H);
  mountCrisisLabels(canvas, crisisOnsets, { L, dom, seed: crisisSeed, W, H });
  mountGanttAgeLabels(canvas, ageMarkers, { L, dom, W, H });

  // Name over the FULL merged set (not just the filtered subset) so the names -
  // including recurrence ordinals + world-war numbering - match the War Graphs
  // picker and header, which name the same full set.
  const continentMap = buildContinentMap(samples);
  const nameOverride = buildWarNameOverrides(merged, turnYearMap, latestTurn, continentMap);
  mountConflictLabels(canvas, barRects, { nameOverride, turnYearMap, latestTurn, W, H });
  return nameOverride;
}
