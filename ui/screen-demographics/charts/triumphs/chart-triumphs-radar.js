// chart-triumphs-radar.js
//
// The Legacy Path radar render + UI wiring (6-axis polar chart, one polygon per
// civ): renderLegacyRadar plus its grid, polygon-drawing, and legend helpers.
// The data layer lives in chart-triumphs-radar-data.js.

import { safePlaySound } from "/demographics/ui/core/demographics-audio.js";
import { t } from "/demographics/ui/core/demographics-i18n.js";
import { buildLeaderIconGroup } from "/demographics/ui/screen-demographics/charts/line/chart-line-tooltip.js";
import { buildLegendControls } from "/demographics/ui/screen-demographics/charts/line/chart-line-legend.js";
import {
  log,
  SVG_NS,
  svgEl,
  appendEmptyNotice,
  coerceKeySet
} from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";
import {
  LEGACY_AXES,
  loadRadarCivs,
  radarScaleMax,
  radarTriumphTotal
} from "/demographics/ui/screen-demographics/charts/triumphs/chart-triumphs-radar-data.js";

/**
 * @typedef {import(
 *   "/demographics/ui/screen-demographics/charts/line/chart-line.js"
 * ).ChartOptions} ChartOptions
 */
/**
 * @typedef {import(
 *   "/demographics/ui/screen-demographics/charts/triumphs/chart-triumphs-radar-data.js"
 * ).RadarCiv} RadarCiv
 */

/**
 * Radar geometry derived from canvas dimensions.
 * @typedef {Object} RadarGeometry
 * @property {number} cx Center x.
 * @property {number} cy Center y.
 * @property {number} R Outer radius.
 * @property {number} innerR Inner pedestal radius.
 */

/**
 * @param {SVGElement} svg
 * @param {RadarGeometry} geo
 * @param {number} scaleMax
 */
function drawRadarGrid(svg, geo, scaleMax) {
  const { cx, cy, innerR } = geo;
  // Inner "pedestal" ring (base radius for 1-2 triumph silhouettes).
  svg.appendChild(
    svgEl("polygon", {
      points: LEGACY_AXES.map(
        (axis) => cx + Math.cos(axis.angle) * innerR + "," + (cy + Math.sin(axis.angle) * innerR)
      ).join(" "),
      fill: "none",
      stroke: "rgba(201, 162, 76, 0.55)",
      "stroke-width": "1.6"
    })
  );
  // Concentric guide rings, one per integer count up to scaleMax; thinner
  // stroke once past ~12 rings so the chart stays legible.
  const maxRings = Math.max(1, Math.ceil(scaleMax));
  const ringStrokeW = maxRings <= 12 ? 1 : maxRings <= 20 ? 0.8 : 0.6;
  for (let i = 1; i <= maxRings; i++) {
    drawRadarRing(svg, geo, i, maxRings, ringStrokeW);
  }
  drawRadarSpokes(svg, geo);
}

/**
 * @param {SVGElement} svg
 * @param {RadarGeometry} geo
 * @param {number} i The ring index (1-based count).
 * @param {number} maxRings
 * @param {number} ringStrokeW
 */
function drawRadarRing(svg, geo, i, maxRings, ringStrokeW) {
  const { cx, cy, R } = geo;
  const r = (R * i) / maxRings;
  const points = LEGACY_AXES.map(
    (axis) => cx + Math.cos(axis.angle) * r + "," + (cy + Math.sin(axis.angle) * r)
  ).join(" ");
  svg.appendChild(
    svgEl("polygon", {
      points,
      fill: "none",
      stroke: "rgba(201, 162, 76, 0.25)",
      "stroke-width": String(ringStrokeW)
    })
  );
  // Numeric label on the militaristic (top) axis, just inside the ring.
  const topAxis = LEGACY_AXES[0];
  const ringLabel = svgEl("text", {
    x: cx + Math.cos(topAxis.angle) * r + 8,
    y: cy + Math.sin(topAxis.angle) * r + 4,
    fill: "rgba(229, 210, 172, 0.65)",
    "font-size": "11",
    "font-weight": "600",
    "text-anchor": "start",
    "dominant-baseline": "middle",
    stroke: "rgba(20, 16, 10, 0.85)",
    "stroke-width": "2.5",
    "paint-order": "stroke"
  });
  ringLabel.textContent = String(i);
  svg.appendChild(ringLabel);
}

/**
 * @param {SVGElement} svg
 * @param {RadarGeometry} geo
 */
function drawRadarSpokes(svg, geo) {
  const { cx, cy, R } = geo;
  LEGACY_AXES.forEach((axis) => {
    svg.appendChild(
      svgEl("line", {
        x1: cx,
        y1: cy,
        x2: cx + Math.cos(axis.angle) * R,
        y2: cy + Math.sin(axis.angle) * R,
        stroke: "rgba(201, 162, 76, 0.45)",
        "stroke-width": "1"
      })
    );
    // Anchor side labels inward (right-side axis → "end", left-side → "start") so a
    // long localized path name grows toward the center instead of off the meet-fit
    // viewBox's left/right edge and getting clipped; top/bottom stay centered.
    const cosA = Math.cos(axis.angle);
    const anchor = cosA > 0.25 ? "end" : cosA < -0.25 ? "start" : "middle";
    const label = svgEl("text", {
      x: cx + cosA * (R + 22),
      y: cy + Math.sin(axis.angle) * (R + 22),
      fill: "#f3c34c",
      "font-size": "18",
      "font-weight": "600",
      "text-anchor": anchor,
      "dominant-baseline": "middle",
      stroke: "#1c1408",
      "stroke-width": "3",
      "paint-order": "stroke"
    });
    label.textContent = t(axis.labelKey);
    svg.appendChild(label);
  });
}

/**
 * A built radar polygon for one civ.
 * @typedef {Object} RadarPoly
 * @property {RadarCiv} civ The source civ.
 * @property {{ x: number, y: number, v: number }[]} points Per-axis vertices.
 * @property {{ x: number, y: number, v: number }[]} polyPts Drawn polygon vertices.
 * @property {number} area Shoelace area (for back-to-front sort).
 * @property {string} color Polygon color.
 */

/**
 * @param {RadarCiv} civ
 * @param {RadarGeometry} geo
 * @param {number} scaleMax
 */
function buildRadarPoly(civ, geo, scaleMax) {
  const { cx, cy, R, innerR } = geo;
  // Per-axis vertex positions for spokes + vertex dots.
  const points = LEGACY_AXES.map((axis) => {
    const value = civ.values[axis.id] || 0;
    const r = (value / scaleMax) * R;
    return { x: cx + Math.cos(axis.angle) * r, y: cy + Math.sin(axis.angle) * r, v: value };
  });
  // Populated-only polygon: connect only axes with value > 0 (3+); for 1-2
  // populated axes, empty axes fall back to the inner pedestal. 0 populated → no shape.
  const populated = points.map((pt, i) => ({ ...pt, i })).filter((pt) => pt.v > 0);
  /** @type {{ x: number, y: number, v: number }[]} */
  let polyPts;
  if (populated.length === 0) {
    polyPts = [];
  } else if (populated.length <= 2) {
    polyPts = LEGACY_AXES.map((axis, i) => {
      const pt = points[i];
      if (pt.v > 0) return pt;
      return { x: cx + Math.cos(axis.angle) * innerR, y: cy + Math.sin(axis.angle) * innerR, v: 0, i };
    });
  } else {
    polyPts = populated;
  }
  // Shoelace area on the drawn polygon; larger shapes sort behind smaller.
  let area = 0;
  if (polyPts.length >= 3) {
    for (let i = 0; i < polyPts.length; i++) {
      const j = (i + 1) % polyPts.length;
      area += polyPts[i].x * polyPts[j].y - polyPts[j].x * polyPts[i].y;
    }
    area = Math.abs(area) / 2;
  }
  return { civ, points, polyPts, area, color: civ.color };
}

/**
 * @param {SVGElement} svg
 * @param {RadarPoly[]} polys The polygons (already sorted back-to-front).
 * @param {RadarGeometry} geo
 */
function drawRadarPolys(svg, polys, geo) {
  // Fills, then spokes, then outlines, then vertex dots. Each pass runs over
  // every poly so later passes sit on top.
  for (const poly of polys) drawRadarPolyFill(svg, poly);
  for (const poly of polys) drawRadarPolySpokes(svg, poly, geo);
  for (const poly of polys) drawRadarPolyOutline(svg, poly);
  for (const poly of polys) drawRadarPolyDots(svg, poly);
}

/**
 * @param {SVGElement} svg
 * @param {RadarPoly} poly
 */
function drawRadarPolyFill(svg, poly) {
  if (!poly.polyPts || poly.polyPts.length < 3) return;
  const outline = poly.polyPts.map((pt) => pt.x + "," + pt.y).join(" ");
  svg.appendChild(
    svgEl("polygon", { points: outline, fill: poly.color, "fill-opacity": "0.35", stroke: "none" })
  );
}

/**
 * @param {SVGElement} svg
 * @param {RadarPoly} poly
 * @param {RadarGeometry} geo
 */
function drawRadarPolySpokes(svg, poly, geo) {
  LEGACY_AXES.forEach((axis, idx) => {
    if ((poly.civ.values[axis.id] || 0) <= 0) return;
    svg.appendChild(
      svgEl("line", {
        x1: geo.cx,
        y1: geo.cy,
        x2: poly.points[idx].x,
        y2: poly.points[idx].y,
        stroke: poly.color,
        "stroke-width": "1.2",
        "stroke-opacity": "0.55"
      })
    );
  });
}

/**
 * @param {SVGElement} svg
 * @param {RadarPoly} poly
 */
function drawRadarPolyOutline(svg, poly) {
  if (!poly.polyPts || poly.polyPts.length < 2) return;
  const outline = poly.polyPts.map((pt) => pt.x + "," + pt.y).join(" ");
  svg.appendChild(
    svgEl("polygon", {
      points: outline,
      fill: "none",
      stroke: poly.color,
      "stroke-width": "2.2",
      "stroke-linejoin": "round",
      "stroke-opacity": "0.95"
    })
  );
}

/**
 * @param {SVGElement} svg
 * @param {RadarPoly} poly
 */
function drawRadarPolyDots(svg, poly) {
  LEGACY_AXES.forEach((axis, idx) => {
    if ((poly.civ.values[axis.id] || 0) <= 0) return;
    svg.appendChild(
      svgEl("circle", {
        cx: poly.points[idx].x,
        cy: poly.points[idx].y,
        r: "3.4",
        fill: poly.color,
        stroke: "#1c1408",
        "stroke-width": "0.8"
      })
    );
  });
}

/**
 * @param {RadarCiv} civ
 * @param {boolean} isHidden
 * @param {((leaderType: string) => void)|null} onToggle
 */
function buildRadarLegendRow(civ, isHidden, onToggle) {
  const row = document.createElement("div");
  row.className = "demographics-line-legend-row";
  if (isHidden) row.classList.add("is-hidden");
  // Same icon+dot group the line legend/tooltip use (no portrait, RadarCiv
  // carries no LEADER_* string, so buildLeaderIconGroup renders just the colored
  // dot, matching a portrait-less line legend row).
  row.appendChild(buildLeaderIconGroup({ leaderType: civ.leaderType }, civ.color));
  const name = document.createElement("span");
  name.className = "demographics-line-legend-name";
  // Civ name + its total triumph count in parens. (Avoid a "Σ" prefix here: that
  // glyph isn't in the Latin BodyFont and Coherent renders it as a missing-glyph
  // box "[]".)
  name.textContent = civ.name + " (" + radarTriumphTotal(civ) + ")";
  row.appendChild(name);
  if (onToggle) {
    row.addEventListener("click", (ev) => {
      ev.stopPropagation();
      safePlaySound("data-audio-select-press", "audio-screen-unlocks");
      onToggle(civ.leaderType);
    });
  }
  return row;
}

/**
 * Render the Legacy Path radar (6-axis polar chart, one polygon per civ) into
 * `host`. Reads triumph counts per attribute, optionally live-pulled from
 * `player.Legacies` for the current age.
 * @param {HTMLElement} host The view host element (cleared and repopulated).
 * @param {ChartOptions} [options] Render options (history, hiddenCivs,
 *   ageSource, onToggleCiv, width, height).
 * @returns {{ svg: SVGElement }|null} The mounted SVG handle, or `null`.
 */
export function renderLegacyRadar(host, options) {
  const setup = prepareRadarRender(host, options);
  if (!setup) return null;
  const { hostEl, opts, width, height, hidden, samples } = setup;
  if (samples.length === 0) {
    appendEmptyNotice(hostEl, t("LOC_DEMOGRAPHICS_EMPTY_NO_SAMPLES"));
    return null;
  }

  // Source: a frozen per-age snapshot, or the live current-age running max.
  const civs = loadRadarCivs(opts, samples);
  const scaleMax = radarScaleMax(civs);

  /** @type {RadarGeometry} */
  const geo = {
    cx: width / 2,
    cy: height / 2 + 10, // slight nudge down to leave room for title
    R: Math.min(width, height) * 0.42,
    innerR: Math.min(width, height) * 0.42 * 0.1
  };

  const { svg, visibleCount } = buildRadarSvg({
    civs,
    hidden,
    geo,
    scaleMax,
    width,
    height
  });

  // HTML wrap, so a click-to-toggle legend can sit beside the SVG.
  const wrap = document.createElement("div");
  wrap.className = "demographics-chart-wrap";
  wrap.appendChild(svg);
  mountRadarLegend({ wrap, civs, hidden, opts, width, height });

  hostEl.appendChild(wrap);
  log.debug("legacy radar mounted; civs=", civs.size, "visible=", visibleCount);
  return { svg };
}

/**
 * @param {HTMLElement} host
 * @param {ChartOptions|undefined} options
 */
function prepareRadarRender(host, options) {
  if (!host) return null;
  while (host.firstChild) host.removeChild(host.firstChild);
  const opts = options || {};
  const width = opts.width || 1400;
  const height = opts.height || 600;
  const hidden = coerceKeySet(opts.hiddenCivs);
  const samples = opts.history && Array.isArray(opts.history.samples) ? opts.history.samples : [];
  return { hostEl: host, opts, width, height, hidden, samples };
}

/**
 * @param {{
 *   civs: Map<string, RadarCiv>,
 *   hidden: Set<string>,
 *   geo: RadarGeometry,
 *   scaleMax: number,
 *   width: number,
 *   height: number
 * }} params
 */
function buildRadarSvg(params) {
  const { civs, hidden, geo, scaleMax, width, height } = params;
  const svg = svgEl("svg", {
    xmlns: SVG_NS,
    viewBox: `0 0 ${width} ${height}`,
    width: String(width),
    height: String(height),
    preserveAspectRatio: "xMidYMid meet",
    class: "demographics-chart-svg",
    "aria-label": t("LOC_DEMOGRAPHICS_ARIA_LEGACY_RADAR")
  });
  drawRadarGrid(svg, geo, scaleMax);
  // Build all polys, then draw back-to-front by area so darker fills don't
  // bury lighter ones.
  /** @type {RadarPoly[]} */
  const polys = [];
  let visibleCount = 0;
  civs.forEach((civ) => {
    if (hidden.has(civ.leaderType)) return;
    polys.push(buildRadarPoly(civ, geo, scaleMax));
    visibleCount++;
  });
  polys.sort((a, b) => b.area - a.area); // largest first → drawn behind
  drawRadarPolys(svg, polys, geo);
  return { svg, visibleCount };
}

/**
 * @param {{
 *   wrap: HTMLElement,
 *   civs: Map<string, RadarCiv>,
 *   hidden: Set<string>,
 *   opts: ChartOptions|*,
 *   width: number,
 *   height: number
 * }} params
 */
function mountRadarLegend(params) {
  const { wrap, civs, hidden, opts, height } = params;
  const onToggle = typeof opts.onToggleCiv === "function" ? opts.onToggleCiv : null;
  const legend = document.createElement("div");
  legend.className = "demographics-line-legend demographics-line-legend-overlay";
  legend.style.maxHeight = Math.max(80, (height || 600) - 64) + "px";
  const title = document.createElement("div");
  title.className = "demographics-line-legend-title";
  title.textContent = t("LOC_DEMOGRAPHICS_LEGEND_TITLE");
  legend.appendChild(title);
  // Same All/None bulk-select controls the line legend renders.
  const keys = [...civs.values()].map((civ) => civ.leaderType).filter(Boolean);
  legend.appendChild(buildLegendControls(keys, opts.onSetAllHidden));
  civs.forEach((civ) =>
    legend.appendChild(buildRadarLegendRow(civ, hidden.has(civ.leaderType), onToggle))
  );
  wrap.appendChild(legend);
}
