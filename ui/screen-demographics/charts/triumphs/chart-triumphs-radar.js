// chart-triumphs-radar.js
//
// The Legacy Path radar render + UI wiring (6-axis polar chart, one polygon per
// civ): renderLegacyRadar plus its grid, polygon-drawing, and legend helpers.
// The data layer (axis catalog + civ-map construction) lives in
// chart-triumphs-radar-data.js, which this module imports.

import { safePlaySound } from "/demographics/ui/core/demographics-audio.js";
import { t } from "/demographics/ui/core/demographics-i18n.js";
import { buildLeaderIconGroup } from "/demographics/ui/screen-demographics/charts/line/chart-line-tooltip.js";
import {
  dlog,
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
 * Draw the inner pedestal ring + concentric count rings (with labels) and the
 * axis spokes + labels into the SVG.
 * @param {SVGElement} svg The radar SVG.
 * @param {RadarGeometry} geo The radar geometry.
 * @param {number} scaleMax The scale maximum.
 */
function drawRadarGrid(svg, geo, scaleMax) {
  const { cx, cy, innerR } = geo;
  // Inner "pedestal" ring (base radius for 1-2 triumph silhouettes).
  svg.appendChild(
    svgEl("polygon", {
      points: LEGACY_AXES.map(
        (a) => cx + Math.cos(a.angle) * innerR + "," + (cy + Math.sin(a.angle) * innerR)
      ).join(" "),
      fill: "none",
      stroke: "rgba(201, 162, 76, 0.55)",
      "stroke-width": "1.6"
    })
  );
  // Concentric guide rings - one per integer count up to scaleMax; thinner
  // stroke once past ~12 rings so the chart stays legible.
  const maxRings = Math.max(1, Math.ceil(scaleMax));
  const ringStrokeW = maxRings <= 12 ? 1 : maxRings <= 20 ? 0.8 : 0.6;
  for (let i = 1; i <= maxRings; i++) {
    drawRadarRing(svg, geo, i, maxRings, ringStrokeW);
  }
  drawRadarSpokes(svg, geo);
}

/**
 * Draw one concentric count ring + its numeric label (top spoke).
 * @param {SVGElement} svg The radar SVG.
 * @param {RadarGeometry} geo The radar geometry.
 * @param {number} i The ring index (1-based count).
 * @param {number} maxRings The total ring count.
 * @param {number} ringStrokeW The ring stroke width.
 */
function drawRadarRing(svg, geo, i, maxRings, ringStrokeW) {
  const { cx, cy, R } = geo;
  const r = (R * i) / maxRings;
  const pts = LEGACY_AXES.map(
    (a) => cx + Math.cos(a.angle) * r + "," + (cy + Math.sin(a.angle) * r)
  ).join(" ");
  svg.appendChild(
    svgEl("polygon", {
      points: pts,
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
 * Draw the axis spokes (center → rim) and the axis labels.
 * @param {SVGElement} svg The radar SVG.
 * @param {RadarGeometry} geo The radar geometry.
 */
function drawRadarSpokes(svg, geo) {
  const { cx, cy, R } = geo;
  LEGACY_AXES.forEach((a) => {
    svg.appendChild(
      svgEl("line", {
        x1: cx,
        y1: cy,
        x2: cx + Math.cos(a.angle) * R,
        y2: cy + Math.sin(a.angle) * R,
        stroke: "rgba(201, 162, 76, 0.45)",
        "stroke-width": "1"
      })
    );
    // Anchor side labels INWARD (right-side axis → "end", left-side → "start") so a
    // long localized path name grows toward the center instead of off the meet-fit
    // viewBox's left/right edge and getting clipped; top/bottom stay centered.
    const cosA = Math.cos(a.angle);
    const anchor = cosA > 0.25 ? "end" : cosA < -0.25 ? "start" : "middle";
    const lbl = svgEl("text", {
      x: cx + cosA * (R + 22),
      y: cy + Math.sin(a.angle) * (R + 22),
      fill: "#f3c34c",
      "font-size": "18",
      "font-weight": "600",
      "text-anchor": anchor,
      "dominant-baseline": "middle",
      stroke: "#1c1408",
      "stroke-width": "3",
      "paint-order": "stroke"
    });
    lbl.textContent = t(a.labelKey);
    svg.appendChild(lbl);
  });
}

/**
 * A built radar polygon for one civ.
 * @typedef {Object} RadarPoly
 * @property {RadarCiv} c The source civ.
 * @property {{ x: number, y: number, v: number }[]} points Per-axis vertices.
 * @property {{ x: number, y: number, v: number }[]} polyPts Drawn polygon vertices.
 * @property {number} area Shoelace area (for back-to-front sort).
 * @property {string} color Polygon color.
 */

/**
 * Build the drawable polygon for one civ (per-axis vertices + the populated-
 * only polygon path + its shoelace area).
 * @param {RadarCiv} c The civ.
 * @param {RadarGeometry} geo The radar geometry.
 * @param {number} scaleMax The scale maximum.
 * @returns {RadarPoly} The built polygon.
 */
function buildRadarPoly(c, geo, scaleMax) {
  const { cx, cy, R, innerR } = geo;
  // Per-axis vertex positions for spokes + vertex dots.
  const points = LEGACY_AXES.map((a) => {
    const v = c.values[a.id] || 0;
    const r = (v / scaleMax) * R;
    return { x: cx + Math.cos(a.angle) * r, y: cy + Math.sin(a.angle) * r, v };
  });
  // Populated-only polygon: connect ONLY axes with value > 0 (3+), so the
  // shaded area runs directly between populated vertices. For 1-2 populated
  // axes, fall back to the inner pedestal on empty axes to form a small
  // targeted diamond. 0 populated → no shape.
  const populated = points.map((pt, i) => ({ ...pt, i })).filter((pt) => pt.v > 0);
  /** @type {{ x: number, y: number, v: number }[]} */
  let polyPts;
  if (populated.length === 0) {
    polyPts = [];
  } else if (populated.length <= 2) {
    polyPts = LEGACY_AXES.map((a, i) => {
      const pt = points[i];
      if (pt.v > 0) return pt;
      return { x: cx + Math.cos(a.angle) * innerR, y: cy + Math.sin(a.angle) * innerR, v: 0, i };
    });
  } else {
    polyPts = populated;
  }
  // Shoelace area on the drawn polygon - larger shapes sort behind smaller.
  let area = 0;
  if (polyPts.length >= 3) {
    for (let i = 0; i < polyPts.length; i++) {
      const j = (i + 1) % polyPts.length;
      area += polyPts[i].x * polyPts[j].y - polyPts[j].x * polyPts[i].y;
    }
    area = Math.abs(area) / 2;
  }
  return { c, points, polyPts, area, color: c.color };
}

/**
 * Draw all four civ-polygon passes (fills, spokes, outlines, vertex dots).
 * @param {SVGElement} svg The radar SVG.
 * @param {RadarPoly[]} polys The polygons (already sorted back-to-front).
 * @param {RadarGeometry} geo The radar geometry.
 */
function drawRadarPolys(svg, polys, geo) {
  // Pass 1 - translucent fills; Pass 2 - spokes; Pass 3 - outlines; Pass 4 -
  // vertex dots. Each pass runs over every poly so later passes sit on top.
  for (const p of polys) drawRadarPolyFill(svg, p);
  for (const p of polys) drawRadarPolySpokes(svg, p, geo);
  for (const p of polys) drawRadarPolyOutline(svg, p);
  for (const p of polys) drawRadarPolyDots(svg, p);
}

/**
 * Draw one polygon's translucent fill (skipped for < 3 vertices).
 * @param {SVGElement} svg The radar SVG.
 * @param {RadarPoly} p The polygon.
 */
function drawRadarPolyFill(svg, p) {
  if (!p.polyPts || p.polyPts.length < 3) return;
  const pts = p.polyPts.map((pt) => pt.x + "," + pt.y).join(" ");
  svg.appendChild(
    svgEl("polygon", { points: pts, fill: p.color, "fill-opacity": "0.35", stroke: "none" })
  );
}

/**
 * Draw one polygon's spokes (center → each populated vertex).
 * @param {SVGElement} svg The radar SVG.
 * @param {RadarPoly} p The polygon.
 * @param {RadarGeometry} geo The radar geometry.
 */
function drawRadarPolySpokes(svg, p, geo) {
  LEGACY_AXES.forEach((a, idx) => {
    if ((p.c.values[a.id] || 0) <= 0) return;
    svg.appendChild(
      svgEl("line", {
        x1: geo.cx,
        y1: geo.cy,
        x2: p.points[idx].x,
        y2: p.points[idx].y,
        stroke: p.color,
        "stroke-width": "1.2",
        "stroke-opacity": "0.55"
      })
    );
  });
}

/**
 * Draw one polygon's outline (skipped for < 2 vertices).
 * @param {SVGElement} svg The radar SVG.
 * @param {RadarPoly} p The polygon.
 */
function drawRadarPolyOutline(svg, p) {
  if (!p.polyPts || p.polyPts.length < 2) return;
  const pts = p.polyPts.map((pt) => pt.x + "," + pt.y).join(" ");
  svg.appendChild(
    svgEl("polygon", {
      points: pts,
      fill: "none",
      stroke: p.color,
      "stroke-width": "2.2",
      "stroke-linejoin": "round",
      "stroke-opacity": "0.95"
    })
  );
}

/**
 * Draw one polygon's vertex dots on populated axes.
 * @param {SVGElement} svg The radar SVG.
 * @param {RadarPoly} p The polygon.
 */
function drawRadarPolyDots(svg, p) {
  LEGACY_AXES.forEach((a, idx) => {
    if ((p.c.values[a.id] || 0) <= 0) return;
    svg.appendChild(
      svgEl("circle", {
        cx: p.points[idx].x,
        cy: p.points[idx].y,
        r: "3.4",
        fill: p.color,
        stroke: "#1c1408",
        "stroke-width": "0.8"
      })
    );
  });
}

/**
 * Build one radar legend row, styled exactly like the line-chart legend rows
 * (colored dot + civ name), with the radar's per-civ total triumph count appended.
 * Clicking toggles the civ via `onToggle`.
 * @param {RadarCiv} c The civ.
 * @param {boolean} isHidden Whether the civ is hidden.
 * @param {((leaderType: string) => void)|null} onToggle Toggle callback.
 * @returns {HTMLElement} The legend row element.
 */
function buildRadarLegendRow(c, isHidden, onToggle) {
  const row = document.createElement("div");
  row.className = "demographics-line-legend-row";
  if (isHidden) row.classList.add("is-hidden");
  // Same icon+dot group the line legend/tooltip use (no portrait, RadarCiv
  // carries no LEADER_* string, so buildLeaderIconGroup renders just the colored
  // dot, matching a portrait-less line legend row).
  row.appendChild(buildLeaderIconGroup({ leaderType: c.leaderType }, c.color));
  const name = document.createElement("span");
  name.className = "demographics-line-legend-name";
  // Civ name + its total triumph count in parens. (Avoid a "Σ" prefix here: that
  // glyph isn't in the Latin BodyFont and Coherent renders it as a missing-glyph
  // box "[]".)
  name.textContent = c.name + " (" + radarTriumphTotal(c) + ")";
  row.appendChild(name);
  if (onToggle) {
    row.addEventListener("click", (ev) => {
      ev.stopPropagation();
      safePlaySound("data-audio-select-press", "audio-screen-unlocks");
      onToggle(c.leaderType);
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
  const { hostEl, opts, W, H, hidden, samples } = setup;
  if (samples.length === 0) {
    appendEmptyNotice(hostEl, t("LOC_DEMOGRAPHICS_EMPTY_NO_SAMPLES"));
    return null;
  }

  // Source: a frozen per-age snapshot, or the live current-age running max.
  const civs = loadRadarCivs(opts, samples);
  const scaleMax = radarScaleMax(civs);

  /** @type {RadarGeometry} */
  const geo = {
    cx: W / 2,
    cy: H / 2 + 10, // slight nudge down to leave room for title
    R: Math.min(W, H) * 0.42,
    innerR: Math.min(W, H) * 0.42 * 0.1
  };

  const { svg, visibleCount } = buildRadarSvg({
    civs,
    hidden,
    geo,
    scaleMax,
    W,
    H
  });

  // HTML wrap so we can put a side legend with click-to-toggle.
  const wrap = document.createElement("div");
  wrap.className = "demographics-chart-wrap";
  wrap.appendChild(svg);
  mountRadarLegend({ wrap, civs, hidden, opts, W, H });

  hostEl.appendChild(wrap);
  dlog("legacy radar mounted; civs=", civs.size, "visible=", visibleCount);
  return { svg };
}

/**
 * Prepare host + options for a radar render pass.
 * @param {HTMLElement} host The view host element.
 * @param {ChartOptions|undefined} options Render options.
 * @returns {{
 *   hostEl: HTMLElement,
 *   opts: ChartOptions,
 *   W: number,
 *   H: number,
 *   hidden: Set<string>,
 *   samples: *[],
 * }|null} Prepared render context.
 */
function prepareRadarRender(host, options) {
  if (!host) return null;
  while (host.firstChild) host.removeChild(host.firstChild);
  const opts = options || {};
  const W = opts.width || 1400;
  const H = opts.height || 600;
  const hidden = coerceKeySet(opts.hiddenCivs);
  const samples = opts.history && Array.isArray(opts.history.samples) ? opts.history.samples : [];
  return { hostEl: host, opts, W, H, hidden, samples };
}

/**
 * Build the radar SVG: grid + every visible civ polygon (back-to-front).
 * @param {{
 *   civs: Map<string, RadarCiv>,
 *   hidden: Set<string>,
 *   geo: RadarGeometry,
 *   scaleMax: number,
 *   W: number,
 *   H: number
 * }} params Radar build inputs.
 * @returns {{ svg: SVGElement, visibleCount: number }} The SVG + visible count.
 */
function buildRadarSvg(params) {
  const { civs, hidden, geo, scaleMax, W, H } = params;
  const svg = svgEl("svg", {
    xmlns: SVG_NS,
    viewBox: `0 0 ${W} ${H}`,
    width: String(W),
    height: String(H),
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
  civs.forEach((c) => {
    if (hidden.has(c.leaderType)) return;
    polys.push(buildRadarPoly(c, geo, scaleMax));
    visibleCount++;
  });
  polys.sort((a, b) => b.area - a.area); // largest first → drawn behind
  drawRadarPolys(svg, polys, geo);
  return { svg, visibleCount };
}

/**
 * Mount the radar legend into the wrap, a `.demographics-line-legend` overlay
 * box (top-left of the plot) with a "Legend" title and one clickable row per
 * civ, matching the line/other charts' legend.
 * @param {{
 *   wrap: HTMLElement,
 *   civs: Map<string, RadarCiv>,
 *   hidden: Set<string>,
 *   opts: ChartOptions|*,
 *   W: number,
 *   H: number
 * }} params Legend mount inputs.
 */
function mountRadarLegend(params) {
  const { wrap, civs, hidden, opts, H } = params;
  const onToggle = typeof opts.onToggleCiv === "function" ? opts.onToggleCiv : null;
  const legend = document.createElement("div");
  legend.className = "demographics-line-legend demographics-line-legend-overlay";
  legend.style.maxHeight = Math.max(80, (H || 600) - 64) + "px";
  const title = document.createElement("div");
  title.className = "demographics-line-legend-title";
  title.textContent = t("LOC_DEMOGRAPHICS_LEGEND_TITLE") || "Legend";
  legend.appendChild(title);
  civs.forEach((c) =>
    legend.appendChild(buildRadarLegendRow(c, hidden.has(c.leaderType), onToggle))
  );
  wrap.appendChild(legend);
}
