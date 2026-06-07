// chart-wars-gantt.js
//
// The conflicts Gantt timeline (one bar per major-vs-major war):
// collectWarCivOptions + renderWarsGantt and their private filtering,
// layout, bar-drawing, war-naming, tooltip, and hover helpers (romanize,
// parseYear, casualty estimate, etc). Migrated verbatim from
// demographics-chart.js.

import { getSemantic } from "/demographics/ui/demographics-palette.js";
import { t } from "/demographics/ui/demographics-i18n.js";
import {
  dlog,
  SVG_NS,
  svgEl,
  historySamples,
  appendEmptyNotice,
  resolveTurnRange,
  getXAxisMode,
  nearestByTurn,
  buildStackTurnYears
} from "/demographics/ui/screen-demographics/chart-shared.js";
import {
  buildStackGridConfig,
  drawStackGrid,
  drawStackXTicks,
  mountStackAxisTitles,
  mountStackXTicks
} from "/demographics/ui/screen-demographics/chart-stack-grid.js";
import { mergeWars } from "/demographics/ui/screen-demographics/chart-wars-merge.js";
import {
  majorsOnSide,
  buildContinentMap,
  buildWarNameOverrides,
  warLabelText
} from "/demographics/ui/screen-demographics/chart-wars-naming.js";
import { renderWarTooltip } from "/demographics/ui/screen-demographics/chart-wars-tooltip.js";
import {
  CRISIS_STAGE_COLORS,
  CRISIS_STAGE_LABELS,
  crisisStageOnsets
} from "/demographics/ui/screen-demographics/crisis-stage-data.js";
import { flavorCrisisName, getGameSeed } from "/demographics/ui/screen-demographics/crisis-names.js";

// Wars Gantt - one horizontal bar per war, stacked vertically by start turn.
// X-axis = turn (with year ticks). Bars colored by the attacker's primary
// color; named with the ordinal-style label the sampler generates.



// Collect every civ pid that's appeared in any war (with display labels) so
// the conflicts page filter dropdown can list them.
/**
 * List every civ that has appeared in any war, sorted majors-first then by
 * label, for the conflicts-page filter dropdown.
 * @param {DemoHistory|*} history The history blob.
 * @returns {{ pid: *, isCS: boolean, label: string }[]} The civ options.
 */
export function collectWarCivOptions(history) {
  const wars = history && Array.isArray(history.wars) ? history.wars : [];
  const seen = new Map();
  for (const w of wars) {
    const allRosters = /** @type {any[]} */ ([]).concat(w.sideACivs || [], w.sideBCivs || []);
    for (const r of allRosters) {
      if (!r || seen.has(r.pid)) continue;
      seen.set(r.pid, {
        pid: r.pid,
        isCS: !!r.isCS,
        label: r.leader ? r.leader + ", " + r.civ : r.civ
      });
    }
  }
  return Array.from(seen.values()).sort((a, b) => {
    if (a.isCS !== b.isCS) return a.isCS ? 1 : -1;
    return a.label.localeCompare(b.label);
  });
}

/**
 * Whether a war pits at least one major civ on each side.
 * @param {*} w The war record.
 * @returns {boolean} True for a major-vs-major war.
 */
function isMajorVsMajor(w) {
  return majorsOnSide(w.sideACivs).length > 0 && majorsOnSide(w.sideBCivs).length > 0;
}

/**
 * The major-civ pids participating in a war.
 * @param {*} w The war record.
 * @returns {*[]} The major pids.
 */
function majorPidsForWar(w) {
  return /** @type {any[]} */ ([])
    .concat(majorsOnSide(w.sideACivs), majorsOnSide(w.sideBCivs))
    .map((r) => r.pid);
}

/**
 * Filter wars to the major-vs-major engagements matching the active filters.
 * @param {*[]} wars The (sorted) war list.
 * @param {boolean} showActiveOnly Hide concluded wars when true.
 * @param {number|null} filterPid Limit to a specific civ, or null.
 * @returns {*[]} The filtered wars.
 */
function filterGanttWars(wars, showActiveOnly, filterPid) {
  return wars.filter((w) => {
    if (showActiveOnly && typeof w.endTurn === "number") return false;
    // Drop any war that doesn't pit at least one major on each side.
    if (!isMajorVsMajor(w)) return false;
    if (filterPid !== null) {
      if (!majorPidsForWar(w).map(Number).includes(Number(filterPid))) return false;
    }
    return true;
  });
}

/**
 * Compute the Gantt x-domain [xMin, xMax] from the filtered wars, honoring an
 * explicit time-range override.
 * @param {*[]} filtered The filtered wars.
 * @param {{ min: number, max: number }|null} tr Time-range filter, or null.
 * @param {number} latestTurn The latest sampled turn.
 * @param {Snapshot[]} samples The sample stream (for fallback).
 * @returns {{ xMin: number, xMax: number }} The x-domain.
 */
function computeGanttDomain(filtered, tr, latestTurn, samples) {
  const span = ganttWarSpan(filtered, tr, latestTurn);
  let xMin = span.xMin;
  let xMax = span.xMax;
  if (!isFinite(xMin)) xMin = samples[0]?.turn ?? 0;
  if (!isFinite(xMax)) xMax = latestTurn || xMin + 1;
  if (tr) {
    xMin = tr.min;
    xMax = tr.max;
  } else {
    xMax = extendDomainFuture(filtered, xMin, xMax, latestTurn);
  }
  if (xMin === xMax) xMax = xMin + 1;
  return { xMin, xMax };
}

/**
 * Extend the domain's right edge: always keep the current turn in view, and when
 * a war is still ongoing reserve a stretch of unplayed future turns to the right
 * so its fading "tail" has somewhere to go.
 * @param {*[]} filtered The filtered wars.
 * @param {number} xMin The domain left.
 * @param {number} xMax The raw domain right.
 * @param {number} latestTurn The latest sampled turn.
 * @returns {number} The extended right edge.
 */
function extendDomainFuture(filtered, xMin, xMax, latestTurn) {
  let max = xMax;
  if (isFinite(latestTurn) && latestTurn > max) max = latestTurn;
  if (filtered.some((w) => typeof w.endTurn !== "number")) {
    const futurePad = Math.max(4, Math.round((max - xMin) * 0.08));
    max = (isFinite(latestTurn) ? latestTurn : max) + futurePad;
  }
  return max;
}

// Min horizontal pixels per turn so short wars and dense timelines stay legible;
// the chart grows past the viewport (and scrolls) when the span is long.
const GANTT_MIN_PX_PER_TURN = 14;
// padL (60) + padR (60) from buildGanttLayout - kept in sync here so the natural
// width and the layout's plot rect agree.
const GANTT_PAD_LR = 120;

/**
 * Compute the Gantt's natural pixel width: the larger of the viewport width and
 * the turn span at GANTT_MIN_PX_PER_TURN, so a long timeline scrolls instead of
 * cramming every turn into the viewport.
 * @param {number} viewportW The measured host width.
 * @param {{ xMin: number, xMax: number }} dom The x-domain.
 * @returns {number} The canvas width in pixels.
 */
function computeGanttWidth(viewportW, dom) {
  const span = Math.max(1, dom.xMax - dom.xMin);
  const naturalInner = span * GANTT_MIN_PX_PER_TURN;
  const innerW = Math.max(viewportW - GANTT_PAD_LR, naturalInner);
  return Math.round(innerW + GANTT_PAD_LR);
}

/**
 * Compute the min start / max end turn across the in-range wars.
 * @param {*[]} filtered The filtered wars.
 * @param {{ min: number, max: number }|null} tr Time-range filter, or null.
 * @param {number} latestTurn The latest sampled turn.
 * @returns {{ xMin: number, xMax: number }} The raw span (may be infinite).
 */
function ganttWarSpan(filtered, tr, latestTurn) {
  let xMin = Infinity,
    xMax = -Infinity;
  for (const w of filtered) {
    const s = w.startTurn;
    const e = typeof w.endTurn === "number" ? w.endTurn : latestTurn;
    if (tr && (e < tr.min || s > tr.max)) continue;
    if (s < xMin) xMin = s;
    if (e > xMax) xMax = e;
  }
  return { xMin, xMax };
}

/**
 * Gantt layout + plot mappers.
 * @typedef {Object} GanttLayout
 * @property {number} padL Left pad.
 * @property {number} padT Top pad.
 * @property {number} innerW Plot width.
 * @property {number} innerH Plot height.
 * @property {number} H Final canvas height.
 * @property {number[]} rowTops Per-war row top offsets.
 * @property {number[]} rowHeights Per-war bar heights (scale with belligerents).
 * @property {number} barH Base bar height.
 * @property {(t: number) => number} xOf Turn → pixel x.
 */

const GANTT_BAR_H = 24; // base bar height (2-civ war; label fits inside)
const GANTT_BAR_H_MAX = 64; // cap so a world war doesn't dominate the page
const GANTT_PER_STRIPE = 7; // extra height per belligerent beyond the first two
const GANTT_ROW_GAP = 10; // gap between wars

/**
 * The belligerent (major) count of a war, used for stripe count + bar height.
 * @param {*} w A war record.
 * @returns {number} The belligerent count (>= 2).
 */
function warStripeCount(w) {
  return Math.max(2, majorsOnSide(w.sideACivs).length + majorsOnSide(w.sideBCivs).length);
}

/**
 * A war's bar height: taller for more belligerents so each civ's color stripe
 * stays legible (a merged multi-front war reads as one fatter, multi-color bar).
 * @param {*} w A war record.
 * @returns {number} The bar height in px.
 */
function barHeightFor(w) {
  return Math.min(GANTT_BAR_H_MAX, GANTT_BAR_H + Math.max(0, warStripeCount(w) - 2) * GANTT_PER_STRIPE);
}

/**
 * Build the Gantt layout: per-war row offsets + heights, final height, plot
 * rect, x-mapper.
 * @param {number} W Canvas width.
 * @param {number} H0 Caller height floor.
 * @param {*[]} wars The filtered wars (one row each).
 * @param {{ xMin: number, xMax: number }} dom The x-domain.
 * @returns {GanttLayout} The layout.
 */
function buildGanttLayout(W, H0, wars, dom) {
  const padL = 60,
    padR = 60,
    padT = 30,
    padB = 64;
  // Pre-compute Y offsets so we can size H upfront - per-war (variable) heights.
  const rowTops = [];
  const rowHeights = [];
  let accumY = padT + 6;
  for (const w of wars) {
    const h = barHeightFor(w);
    rowTops.push(accumY);
    rowHeights.push(h);
    accumY += h + GANTT_ROW_GAP;
  }
  const minInnerH = Math.max(120, accumY - padT - 6 + 16);
  const H = Math.max(H0, padT + minInnerH + padB);
  const innerW = W - padL - padR;
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

/**
 * Look up the latest sampled primary color for a pid, with a neutral fallback.
 * @param {Snapshot[]} samples The sample stream.
 * @param {*} pid Player id key.
 * @returns {string} The hex/css color.
 */
function currentPrimaryColor(samples, pid) {
  for (let i = samples.length - 1; i >= 0; i--) {
    const ps = samples[i]?.players?.[pid];
    if (ps && typeof ps.primaryColor === "string" && ps.primaryColor.length > 0) {
      return ps.primaryColor;
    }
  }
  return "#9aa8c8";
}

/**
 * Resolve one war-bar stripe's fill: the participant's latest sampled primary
 * color, else its roster color, else a side-based fallback.
 * @param {*} c The stripe (participant or fallback) record.
 * @param {number} idx The stripe index.
 * @param {Snapshot[]} samples The sample stream.
 * @param {*} sem The semantic palette.
 * @returns {string} The fill color.
 */
function resolveStripeFill(c, idx, samples, sem) {
  return (
    (typeof c.pid === "number" && currentPrimaryColor(samples, c.pid)) ||
    c.color ||
    (idx % 2 === 0 ? sem.sideA_fallback : sem.sideB_fallback)
  );
}

/**
 * Draw the Gantt background, year grid + ticks. Returns the tick positions for
 * HTML overlays.
 * @param {SVGElement} svg The chart SVG.
 * @param {GanttLayout} L The layout.
 * @param {{ xMin: number, xMax: number }} dom The x-domain.
 * @param {Map<number, string>} turnYearMap chart-turn → year map.
 * @returns {{ t: number, x: number, year: string|null }[]} The tick positions.
 */
function drawGanttGrid(svg, L, dom, turnYearMap) {
  // Scale tick count to the (possibly very wide, scrollable) plot so a long
  // timeline keeps a readable year cadence instead of just 6 sparse ticks.
  const cfg = buildStackGridConfig({
    plotFill: "rgba(18, 20, 24, 0.85)",
    xTickStroke: "#E5E5E5",
    xTicks: Math.max(6, Math.min(40, Math.round(L.innerW / 160))),
    drawYGrid: false,
    drawYLabels: false,
    drawXVerticalGrid: true,
    xVerticalGridStroke: "rgba(133, 135, 140, 0.35)"
  });
  drawStackGrid(svg, { ...L, yOf: () => 0 }, 1, cfg, svgEl);
  return drawStackXTicks(svg, L, dom, turnYearMap, cfg, nearestByTurn, svgEl);
}

/**
 * One war bar's hit-test rectangle.
 * @typedef {Object} BarRect
 * @property {*} war The war record.
 * @property {number} x Bar left.
 * @property {number} y Bar top.
 * @property {number} w Bar width.
 * @property {number} h Bar height.
 * @property {number} x2 Bar right.
 * @property {boolean} isClosed Whether the war concluded.
 * @property {number} [hitW] Hit-test width (includes an ongoing war's future tail).
 */

/**
 * Draw one war bar (per-civ stripes, hairlines, outline, end marker) and
 * return its hit-test rect.
 * @param {SVGElement} svg The chart SVG.
 * @param {*} w The war record.
 * @param {GanttLayout} L The layout.
 * @param {{ xMin: number, xMax: number }} dom The x-domain.
 * @param {number} baseY The bar's top offset.
 * @param {number} barH The bar's height (scales with belligerent count).
 * @param {number} latestTurn The latest sampled turn.
 * @param {Snapshot[]} samples The sample stream (for colors).
 * @returns {BarRect} The bar hit-test rect.
 */
function drawWarBar(svg, w, L, dom, baseY, barH, latestTurn, samples) {
  const sTurn = w.startTurn;
  const isClosed = typeof w.endTurn === "number";
  const eTurn = isClosed ? w.endTurn : latestTurn;
  const x1 = L.xOf(Math.max(sTurn, dom.xMin));
  const x2 = L.xOf(Math.min(eTurn, dom.xMax));
  const sem = getSemantic();
  // Build the full participant list (sideA first, then sideB) so the bar is
  // striped one band per civ. Side ordering preserved so allies sit together.
  const participants = /** @type {any[]} */ ([]).concat(
    majorsOnSide(w.sideACivs),
    majorsOnSide(w.sideBCivs)
  );
  const stripes =
    participants.length > 0
      ? participants
      : [
          { pid: null, color: sem.sideA_fallback },
          { pid: null, color: sem.sideB_fallback }
        ];
  const barW = Math.max(2, x2 - x1);
  drawWarBarStripes(svg, { stripes, samples, sem, x1, baseY, barW, barH, isClosed });
  // Single outline around the (solid, played) part of the bar.
  svg.appendChild(
    svgEl("rect", {
      x: x1,
      y: baseY,
      width: barW,
      height: barH,
      fill: "none",
      stroke: "#1c1408",
      "stroke-width": "1"
    })
  );
  // Ongoing wars get a "future tail" fading the colors into grey across the
  // not-yet-played turns; the hit-test rect extends over it so the tail is
  // hoverable. Concluded wars get the usual end-cap.
  let hitW = barW;
  if (!isClosed) {
    const xTail = L.xOf(dom.xMax);
    drawWarBarTail(svg, { stripes, samples, sem, xStart: x2, xEnd: xTail, baseY, barH });
    hitW = Math.max(barW, xTail - x1);
  } else {
    drawWarBarEndMarker(svg, isClosed, x2, baseY, barH, sem);
  }
  // `w` is the SOLID (played) width - what labels measure against; `hitW`
  // includes the future tail so hovering the faded region still hits the war.
  return { war: w, x: x1, y: baseY, w: barW, h: barH, x2, isClosed, hitW };
}

/**
 * Append a horizontal SVG gradient (opaque `color` -> transparent) for a tail
 * stripe, so the color fades smoothly with no banding at any scale.
 * @param {SVGElement} svg The chart SVG.
 * @param {string} id The gradient element id (referenced via url(#id)).
 * @param {string} color The stripe color.
 */
function appendTailGradient(svg, id, color) {
  const grad = svgEl("linearGradient", { id, x1: "0", y1: "0", x2: "1", y2: "0" });
  grad.appendChild(svgEl("stop", { offset: "0", "stop-color": color, "stop-opacity": "0.92" }));
  grad.appendChild(svgEl("stop", { offset: "1", "stop-color": color, "stop-opacity": "0" }));
  svg.appendChild(grad);
}

/**
 * Draw an ongoing war's "future tail": a grey underlay across the unplayed turns
 * overlaid with each civ's stripe color fading smoothly (via a per-stripe
 * gradient) into the grey - signaling those turns aren't played yet and the war
 * isn't over.
 * @param {SVGElement} svg The chart SVG.
 * @param {Object} args Tail-drawing inputs.
 * @param {*[]} args.stripes The participant stripes.
 * @param {Snapshot[]} args.samples The sample stream (for colors).
 * @param {*} args.sem The semantic palette.
 * @param {number} args.xStart The tail's left x (the current turn).
 * @param {number} args.xEnd The tail's right x (the future horizon).
 * @param {number} args.baseY The bar top.
 * @param {number} args.barH The bar height.
 */
function drawWarBarTail(svg, args) {
  const { stripes, samples, sem, xStart, xEnd, baseY, barH } = args;
  const tailW = xEnd - xStart;
  if (tailW <= 1) return;
  // Grey underlay the colors fade into - also the graceful fallback: if SVG
  // gradients aren't honored, a solid grey tail still reads as "unplayed".
  svg.appendChild(
    svgEl("rect", {
      x: xStart,
      y: baseY,
      width: tailW,
      height: barH,
      fill: "#3a3d44",
      "fill-opacity": "0.5"
    })
  );
  const stripeH = barH / stripes.length;
  stripes.forEach((c, idx) => {
    const fill = resolveStripeFill(c, idx, samples, sem);
    const gradId = "demo-wartail-" + Math.round(baseY) + "-" + idx;
    appendTailGradient(svg, gradId, fill);
    svg.appendChild(
      svgEl("rect", {
        x: xStart,
        y: baseY + idx * stripeH,
        width: tailW,
        height: stripeH,
        fill: "url(#" + gradId + ")"
      })
    );
  });
}

/**
 * Draw the vertical "current turn" marker: a dashed red line across the plot at
 * the latest sampled turn (where the solid bars end and the future tails begin).
 * @param {SVGElement} svg The chart SVG.
 * @param {GanttLayout} L The layout.
 * @param {{ xMin: number, xMax: number }} dom The x-domain.
 * @param {number} latestTurn The latest sampled turn.
 */
function drawCurrentTurnLine(svg, L, dom, latestTurn) {
  if (!isFinite(latestTurn) || latestTurn < dom.xMin || latestTurn > dom.xMax) return;
  const x = L.xOf(latestTurn);
  svg.appendChild(
    svgEl("line", {
      x1: x,
      x2: x,
      y1: L.padT,
      y2: L.padT + L.innerH,
      stroke: "#e8453c",
      "stroke-width": "2",
      "stroke-dasharray": "5 3"
    })
  );
}

/**
 * Draw the crisis stage-onset overlay lines: a dashed vertical line at each
 * onset turn, colored by stage - the same markers the historical line charts
 * draw. (Labels are mounted as HTML overlays; see mountCrisisLabels.)
 * @param {SVGElement} svg The chart SVG.
 * @param {GanttLayout} L The layout.
 * @param {{ xMin: number, xMax: number }} dom The x-domain.
 * @param {{ stage: number, turn: number, sample: Snapshot }[]} onsets The crisis onsets.
 */
function drawCrisisMarkers(svg, L, dom, onsets) {
  for (const o of onsets || []) {
    if (o.turn < dom.xMin || o.turn > dom.xMax) continue;
    const x = L.xOf(o.turn);
    const color = CRISIS_STAGE_COLORS[Math.max(0, Math.min(3, o.stage - 1))];
    svg.appendChild(
      svgEl("line", {
        x1: x,
        x2: x,
        y1: L.padT,
        y2: L.padT + L.innerH,
        stroke: color,
        "stroke-width": "1.4",
        "stroke-dasharray": "4 3",
        "stroke-opacity": "0.85"
      })
    );
  }
}

/**
 * Mount the crisis stage-onset HTML labels atop each overlay line: a two-line
 * pill (stage label in the stage color, crisis name below), staggered down so
 * adjacent onsets don't collide. Mirrors the historical charts' marker labels.
 * @param {HTMLElement} wrap The chart canvas.
 * @param {GanttLayout} L The layout.
 * @param {{ xMin: number, xMax: number }} dom The x-domain.
 * @param {{ stage: number, turn: number, sample: Snapshot }[]} onsets The crisis onsets.
 * @param {string} seed The game seed (for the flavor crisis name).
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 */
function mountCrisisLabels(wrap, L, dom, onsets, seed, W, H) {
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
 * Draw a war bar's per-civ color stripes plus the hairlines between them.
 * @param {SVGElement} svg The chart SVG.
 * @param {Object} args Stripe-drawing inputs.
 * @param {*[]} args.stripes The participant stripes.
 * @param {Snapshot[]} args.samples The sample stream (for colors).
 * @param {*} args.sem The semantic palette.
 * @param {number} args.x1 Bar left x.
 * @param {number} args.baseY Bar top y.
 * @param {number} args.barW Bar width.
 * @param {number} args.barH Bar height.
 * @param {boolean} args.isClosed Whether the war concluded.
 */
function drawWarBarStripes(svg, args) {
  const { stripes, samples, sem, x1, baseY, barW, barH, isClosed } = args;
  const stripeH = barH / stripes.length;
  // One colored stripe per participating civ - height = BAR_H / N.
  stripes.forEach((c, idx) => {
    const fill = resolveStripeFill(c, idx, samples, sem);
    svg.appendChild(
      svgEl("rect", {
        x: x1,
        y: baseY + idx * stripeH,
        width: barW,
        height: stripeH,
        fill,
        "fill-opacity": isClosed ? "0.85" : "1"
      })
    );
  });
  // Thin hairlines between adjacent stripes so 3+ civ wars don't blur.
  for (let s = 1; s < stripes.length; s++) {
    svg.appendChild(
      svgEl("line", {
        x1: x1,
        x2: x1 + barW,
        y1: baseY + s * stripeH,
        y2: baseY + s * stripeH,
        stroke: "rgba(28, 20, 8, 0.55)",
        "stroke-width": "0.7"
      })
    );
  }
}

/**
 * Draw a war bar's right-edge marker: a hatch (concluded) or a circle (ongoing).
 * @param {SVGElement} svg The chart SVG.
 * @param {boolean} isClosed Whether the war concluded.
 * @param {number} x2 Bar right x.
 * @param {number} baseY Bar top.
 * @param {number} barH Bar height.
 * @param {*} sem The semantic palette.
 */
function drawWarBarEndMarker(svg, isClosed, x2, baseY, barH, sem) {
  if (isClosed) {
    svg.appendChild(
      svgEl("line", {
        x1: x2,
        x2: x2,
        y1: baseY,
        y2: baseY + barH,
        stroke: "#1c1408",
        "stroke-width": "2"
      })
    );
  } else {
    svg.appendChild(
      svgEl("circle", {
        cx: x2,
        cy: baseY + barH / 2,
        r: 5,
        fill: sem.ongoing_marker,
        stroke: "#1c1408",
        "stroke-width": "0.5"
      })
    );
  }
}

/**
 * Draw every filtered war's bar, returning the hit-test rects.
 * @param {SVGElement} svg The chart SVG.
 * @param {*[]} filtered The filtered wars.
 * @param {GanttLayout} L The layout.
 * @param {{ xMin: number, xMax: number }} dom The x-domain.
 * @param {{ min: number, max: number }|null} tr Time-range filter, or null.
 * @param {number} latestTurn The latest sampled turn.
 * @param {Snapshot[]} samples The sample stream.
 * @returns {BarRect[]} The bar hit-test rects.
 */
function drawWarBars(svg, filtered, L, dom, tr, latestTurn, samples) {
  /** @type {BarRect[]} */
  const barRects = [];
  for (let i = 0; i < filtered.length; i++) {
    const w = filtered[i];
    const eTurn = typeof w.endTurn === "number" ? w.endTurn : latestTurn;
    if (tr && (eTurn < tr.min || w.startTurn > tr.max)) continue;
    barRects.push(drawWarBar(svg, w, L, dom, L.rowTops[i], L.rowHeights[i], latestTurn, samples));
  }
  return barRects;
}


/**
 * Mount one war-name label: the FULL name in a neutral box (never truncated),
 * anchored at the bar's left edge - or, for a bar in the right third of the
 * chart, with its right edge at the bar end so a long name grows left and isn't
 * clipped by the canvas edge.
 * @param {HTMLElement} wrap The chart canvas.
 * @param {BarRect} rect The bar hit-test rect.
 * @param {{ nameOverride: Map<*, string>, turnYearMap: Map<number, string>, latestTurn: number, W: number, H: number }} env Shared inputs.
 */
function mountOneWarLabel(wrap, rect, env) {
  const { nameOverride, turnYearMap, latestTurn, W, H } = env;
  const { war, x, y, h } = rect;
  const xRight = x + (rect.hitW ?? rect.w);
  const label = warLabelText(war, nameOverride, turnYearMap, latestTurn);
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
 * @param {BarRect[]} barRects The bar rects.
 * @param {Map<*, string>} nameOverride war → display label.
 * @param {Map<number, string>} turnYearMap chart-turn → year map.
 * @param {number} latestTurn The latest sampled turn.
 * @param {number} W Canvas width.
 * @param {number} H Canvas height.
 */
function mountWarLabels(wrap, barRects, nameOverride, turnYearMap, latestTurn, W, H) {
  const env = { nameOverride, turnYearMap, latestTurn, W, H };
  for (const rect of barRects) mountOneWarLabel(wrap, rect, env);
}

/**
 * Mount the Gantt X-tick HTML labels (year and/or turn per axis mode).
 * @param {HTMLElement} wrap The chart wrap.
 * @param {{ t: number, x: number, year: string|null }[]} tickPositions Ticks.
 * @param {GanttLayout} L The layout.
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
 * @param {GanttLayout} L The layout.
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
 * Mount the "Now" label atop the current-turn (red) line, when that turn is in
 * range.
 * @param {HTMLElement} wrap The chart canvas.
 * @param {GanttLayout} L The layout.
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
 * Create the shared Gantt hover-tooltip element (hidden, absolute).
 * @returns {HTMLElement} The tooltip element.
 */
function createGanttTooltip() {
  const tooltip = document.createElement("div");
  tooltip.className = "demographics-chart-hover-tooltip demographics-wars-tooltip";
  // Hidden until a bar is hovered - visibility is toggled live by the hover
  // wiring, so it stays inline.
  tooltip.style.display = "none";
  return tooltip;
}

/**
 * Hit-test a point (in SVG coords) against the war bar rects.
 * @param {BarRect[]} barRects The bar rects.
 * @param {number} svgX The SVG-space x.
 * @param {number} svgY The SVG-space y.
 * @returns {*} The war under the point, or `null`.
 */
function hitTestBars(barRects, svgX, svgY) {
  for (const r of barRects) {
    const w = r.hitW ?? r.w;
    if (svgX >= r.x && svgX <= r.x + w && svgY >= r.y && svgY <= r.y + r.h) return r.war;
  }
  return null;
}

// Visual scale applied to the tooltip in CSS (.demographics-wars-tooltip); used
// here so the right-edge flip accounts for the enlarged width. Keep in sync.
const TOOLTIP_SCALE = 1.12;

/**
 * Wire the Gantt's mousemove/leave hover tooltip behavior.
 * @param {Object} args Wiring inputs.
 * @param {HTMLElement} args.wrap The chart wrap.
 * @param {SVGElement} args.svg The chart SVG.
 * @param {HTMLElement} args.tooltip The tooltip element.
 * @param {BarRect[]} args.barRects The bar rects.
 * @param {Object} args.ctx Shared Gantt context (for tooltip rendering).
 * @param {number} args.W Canvas width.
 * @param {number} args.H Canvas height.
 */
function wireGanttHover(args) {
  const { wrap, svg, tooltip, barRects, ctx, W, H } = args;
  // The war currently rendered in the tooltip. We only REBUILD its DOM when the
  // hovered war changes - rebuilding every mousemove re-created the <fxs-icon>
  // leader portraits each frame, which made the faces flicker while scrolling.
  let shownWar = /** @type {*} */ (null);
  wrap.addEventListener("mousemove", (ev) => {
    const rect = svg.getBoundingClientRect();
    if (!rect || rect.width === 0) {
      tooltip.style.display = "none";
      shownWar = null;
      return;
    }
    const sx = ((ev.clientX - rect.left) / rect.width) * W;
    const sy = ((ev.clientY - rect.top) / rect.height) * H;
    const w = hitTestBars(barRects, sx, sy);
    if (!w) {
      tooltip.style.display = "none";
      shownWar = null;
      return;
    }
    if (w !== shownWar) {
      // Show FIRST so the freshly-built <fxs-icon> leader portraits initialize in
      // a laid-out element - custom-element icons don't render while an ancestor
      // is display:none (the Factbook builds its portraits while already visible).
      tooltip.style.display = "block";
      renderWarTooltip(tooltip, w, ctx);
      shownWar = w;
    }
    // Reposition every move (cheap). The tooltip lives in the (scrollable)
    // canvas, whose box equals the SVG's, so position relative to that rect.
    const localX = ev.clientX - rect.left;
    let left = localX + 14;
    // A wide popup (many civs) would clip off the right of the visible window -
    // flip it to the LEFT of the cursor when it won't fit to the right. offsetWidth
    // is the UNSCALED layout width, so multiply by the CSS scale for the real span.
    const tw = tooltip.offsetWidth * TOOLTIP_SCALE;
    const visRight = wrap.scrollLeft + wrap.clientWidth - 8;
    if (left + tw > visRight) {
      left = Math.max(wrap.scrollLeft + 8, localX - 14 - tw);
    }
    tooltip.style.left = left + "px";
    tooltip.style.top = ev.clientY - rect.top + 14 + "px";
  });
  wrap.addEventListener("mouseleave", () => {
    tooltip.style.display = "none";
    shownWar = null;
  });
}

/**
 * Options accepted by {@link renderWarsGantt}.
 * @typedef {Object} GanttOptions
 * @property {DemoHistory|*} [history] The history blob (wars + samples).
 * @property {number} [width] Canvas width.
 * @property {number} [height] Canvas height floor.
 * @property {number} [filterPid] Limit to a specific civ.
 * @property {boolean} [activeOnly] Hide concluded wars.
 * @property {{ min: number, max: number }} [turnRange] Time-range filter.
 */

/**
 * Render the conflicts Gantt timeline (one bar per major-vs-major war) into
 * `host`, with per-civ stripes, in-bar labels, and a hover tooltip.
 * @param {HTMLElement} host The view host element (cleared and repopulated).
 * @param {GanttOptions} [options] Render options.
 * @returns {{ svg: SVGElement }|null} The mounted SVG handle, or `null`.
 */
export function renderWarsGantt(host, options) {
  if (!host) return null;
  while (host.firstChild) host.removeChild(host.firstChild);
  const opts = options || {};
  const viewportW = opts.width || 1400;
  const prep = prepareGanttData(host, opts);
  if (!prep) return null;
  const { wars, merged, filtered, latestTurn, samples, filterPid, showActiveOnly } = prep;

  const tr = resolveTurnRange(opts);
  const dom = computeGanttDomain(filtered, tr, latestTurn, samples);
  // Natural pixel width from the turn span (>= viewport); the chart scrolls
  // horizontally when the timeline is longer than the viewport.
  const W = computeGanttWidth(viewportW, dom);
  const L = buildGanttLayout(W, opts.height || 600, filtered, dom);
  const H = L.H;
  const turnYearMap = buildStackTurnYears(samples);
  // Crisis stage-onset overlay (same markers the historical line charts draw).
  const crisisOnsets = crisisStageOnsets(samples);
  const crisisSeed = getGameSeed();
  const env = { turnYearMap, latestTurn, samples, W, H, dom, crisisOnsets, crisisSeed };

  const { svg, barRects, tickPositions } = buildGanttSvg(filtered, L, dom, tr, env);
  const wrap = mountGanttWrap(svg, { merged, barRects, tickPositions, L, ...env });

  host.appendChild(wrap);
  dlog(
    "wars gantt mounted; wars=",
    wars.length,
    "filtered=" + filtered.length,
    "filterPid=" + filterPid,
    "activeOnly=" + showActiveOnly
  );
  return { svg };
}


/**
 * Prepared Gantt data: the sorted wars, the filtered subset, and filter flags.
 * @typedef {Object} GanttPrep
 * @property {*[]} wars The sorted war list.
 * @property {*[]} merged The full merged war set (for naming).
 * @property {*[]} filtered The filtered subset.
 * @property {number} latestTurn The latest sampled turn.
 * @property {Snapshot[]} samples The sample stream.
 * @property {number|null} filterPid Active civ filter, or null.
 * @property {boolean} showActiveOnly Whether concluded wars are hidden.
 */

/**
 * Read + sort + filter the wars; render the appropriate empty notice and
 * return `null` when there's nothing to draw.
 * @param {HTMLElement} host The view host (for empty notices).
 * @param {GanttOptions} opts The render options.
 * @returns {GanttPrep|null} The prepared data, or `null`.
 */
function prepareGanttData(host, opts) {
  /** @type {any[]} */
  const wars = opts.history && Array.isArray(opts.history.wars) ? opts.history.wars.slice() : [];
  const samples = historySamples(opts.history);
  if (wars.length === 0) {
    appendEmptyNotice(host, t("LOC_DEMOGRAPHICS_EMPTY_NO_WARS"));
    return null;
  }
  const latestTurn = samples.length > 0 ? (samples[samples.length - 1].turn ?? 0) : 0;
  // Collapse concurrent, overlapping wars that share a belligerent into single
  // multi-front wars before anything else, so the whole view (bars, tooltip,
  // naming) sees one war per front-group.
  const merged = mergeWars(wars, latestTurn);
  merged.sort((a, b) => (a.startTurn || 0) - (b.startTurn || 0));
  // Filter pipeline: city states are dropped - this is a major-civ engagement
  // timeline. Coalition wars between two majors still show, but only major
  // civs are rendered as bars.
  const filterPid = typeof opts.filterPid === "number" ? opts.filterPid : null;
  const showActiveOnly = !!opts.activeOnly;
  const filtered = filterGanttWars(merged, showActiveOnly, filterPid);
  if (filtered.length === 0) {
    appendEmptyNotice(host, t("LOC_DEMOGRAPHICS_EMPTY_NO_WARS_MATCH"));
    return null;
  }
  return { wars, merged, filtered, latestTurn, samples, filterPid, showActiveOnly };
}

/**
 * Build the Gantt SVG (background grid + ticks + war bars).
 * @param {*[]} filtered The filtered wars.
 * @param {GanttLayout} L The layout.
 * @param {{ xMin: number, xMax: number }} dom The x-domain.
 * @param {{ min: number, max: number }|null} tr Time-range filter, or null.
 * @param {*} env Shared environment (turnYearMap, latestTurn, samples, W, H).
 * @returns {{ svg: SVGElement, barRects: BarRect[], tickPositions: { t: number, x: number, year: string|null }[] }}
 *   The SVG, bar rects, and x-tick positions.
 */
function buildGanttSvg(filtered, L, dom, tr, env) {
  const { turnYearMap, latestTurn, samples, W, H } = env;
  const svg = svgEl("svg", {
    xmlns: SVG_NS,
    viewBox: `0 0 ${W} ${H}`,
    width: String(W),
    height: String(H),
    preserveAspectRatio: "none",
    class: "demographics-chart-svg",
    "aria-label": "Conflicts timeline"
  });
  const tickPositions = drawGanttGrid(svg, L, dom, turnYearMap);
  const barRects = drawWarBars(svg, filtered, L, dom, tr, latestTurn, samples);
  drawCrisisMarkers(svg, L, dom, env.crisisOnsets);
  drawCurrentTurnLine(svg, L, dom, latestTurn);
  return { svg, barRects, tickPositions };
}

/**
 * Build the Gantt wrap and mount all HTML overlays (x-ticks, axis titles,
 * war labels) plus the hover tooltip.
 * @param {SVGElement} svg The chart SVG.
 * @param {Object} env Shared environment.
 * @param {*[]} env.merged The full merged war set (for naming).
 * @param {BarRect[]} env.barRects The bar rects.
 * @param {{ t: number, x: number, year: string|null }[]} env.tickPositions Ticks.
 * @param {GanttLayout} env.L The layout.
 * @param {Map<number, string>} env.turnYearMap chart-turn → year map.
 * @param {number} env.latestTurn The latest sampled turn.
 * @param {Snapshot[]} env.samples The sample stream.
 * @param {number} env.W Canvas width.
 * @param {number} env.H Canvas height.
 * @param {{ xMin: number, xMax: number }} env.dom The x-domain.
 * @param {{ stage: number, turn: number, sample: Snapshot }[]} env.crisisOnsets Crisis onsets.
 * @param {string} env.crisisSeed The game seed (for crisis names).
 * @returns {HTMLElement} The chart wrap.
 */
function mountGanttWrap(svg, env) {
  const { merged, barRects, tickPositions, L, turnYearMap, latestTurn, samples, W, H } = env;
  const { dom, crisisOnsets, crisisSeed } = env;
  const wrap = document.createElement("div");
  wrap.className = "demographics-chart-wrap demographics-wars-wrap";
  // Inner canvas: fills the viewport (width/height 100% in CSS) but is forced to
  // at least the chart's NATURAL pixel extent via min-width/min-height, so it
  // stretches to fill when the timeline is small and scrolls when it's large.
  // The SVG (viewBox W x H, preserveAspectRatio none) and the %-positioned
  // overlays both scale with the canvas, so they stay aligned either way.
  const canvas = document.createElement("div");
  canvas.className = "demographics-wars-canvas";
  canvas.style.minWidth = W + "px";
  canvas.style.minHeight = H + "px";
  canvas.appendChild(svg);
  wrap.appendChild(canvas);

  mountGanttXTicks(canvas, tickPositions, L, W, H);
  mountGanttAxisTitles(canvas, L, W, H);
  mountCurrentTurnLabel(canvas, L, latestTurn, W, H);
  mountCrisisLabels(canvas, L, dom, crisisOnsets, crisisSeed, W, H);

  // Name over the FULL merged set (not just the filtered subset) so the names -
  // including recurrence ordinals + world-war numbering - match the War Graphs
  // picker and header, which name the same full set.
  const continentMap = buildContinentMap(samples);
  const nameOverride = buildWarNameOverrides(merged, turnYearMap, latestTurn, continentMap);
  mountWarLabels(canvas, barRects, nameOverride, turnYearMap, latestTurn, W, H);

  // Hover tooltip - custom callout replacing the unreliable `title` attribute.
  const tooltip = createGanttTooltip();
  canvas.appendChild(tooltip);
  const ctx = { nameOverride, turnYearMap, latestTurn, samples };
  wireGanttHover({ wrap, svg, tooltip, barRects, ctx, W, H });
  return wrap;
}
