// chart-triumphs-radar.js
//
// The Legacy Path radar (6-axis polar chart, one polygon per civ):
// renderLegacyRadar plus its private civ-loading, geometry, grid, and
// polygon-drawing helpers. Migrated verbatim from demographics-chart.js.

import { safePlaySound } from "/demographics/ui/core/demographics-audio.js";
import { t } from "/demographics/ui/core/demographics-i18n.js";
import {
  dlog,
  SVG_NS,
  PALETTE,
  svgEl,
  appendEmptyNotice,
  coerceKeySet,
  hideUnmetEnabled,
  isCivUnmet
} from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";

/**
 * @typedef {import(
 *   "/demographics/ui/screen-demographics/charts/line/chart-line.js"
 * ).ChartOptions} ChartOptions
 */

// Triumph radar - 6-axis polar chart, one polygon per civ. Reads
// triumphs_cultural / _diplomatic / _economic / _scientific / _militaristic
// / _expansionist counts (Test-of-Time Legacies system). For the CURRENT
// age, values are also live-pulled from `player.Legacies.isTriggered` so
// progress reflects the engine state right now, not just the latest sample.
// Labels are stored as LOC keys and translated at render time (see
// drawRadarSpokes), not baked at module load - so they reflect the active
// language even if the module loaded before Locale was ready.
const LEGACY_AXES = [
  {
    id: "triumphs_militaristic",
    labelKey: "LOC_DEMOGRAPHICS_ATTR_MILITARISTIC",
    angle: -Math.PI / 2
  }, // top
  { id: "triumphs_economic", labelKey: "LOC_DEMOGRAPHICS_ATTR_ECONOMIC", angle: -Math.PI / 6 }, // upper-right
  { id: "triumphs_diplomatic", labelKey: "LOC_DEMOGRAPHICS_ATTR_DIPLOMATIC", angle: Math.PI / 6 }, // lower-right
  { id: "triumphs_cultural", labelKey: "LOC_DEMOGRAPHICS_ATTR_CULTURAL", angle: Math.PI / 2 }, // bottom
  {
    id: "triumphs_scientific",
    labelKey: "LOC_DEMOGRAPHICS_ATTR_SCIENTIFIC",
    angle: (5 * Math.PI) / 6
  }, // lower-left
  {
    id: "triumphs_expansionist",
    labelKey: "LOC_DEMOGRAPHICS_ATTR_EXPANSIONIST",
    angle: (-5 * Math.PI) / 6
  } // upper-left
];

const RADAR_AXIS_KEYS = [
  "triumphs_militaristic",
  "triumphs_economic",
  "triumphs_diplomatic",
  "triumphs_cultural",
  "triumphs_scientific",
  "triumphs_expansionist"
];

/** @type {Record<string, string>} */
const RADAR_SUBTYPE_TO_AXIS = {
  LEGACY_CULTURAL: "triumphs_cultural",
  LEGACY_DIPLOMATIC: "triumphs_diplomatic",
  LEGACY_ECONOMIC: "triumphs_economic",
  LEGACY_SCIENTIFIC: "triumphs_scientific",
  LEGACY_MILITARISTIC: "triumphs_militaristic",
  LEGACY_EXPANSIONIST: "triumphs_expansionist"
};

/**
 * A civ entry in the legacy radar.
 * @typedef {Object} RadarCiv
 * @property {string} pid Player id key.
 * @property {string} leaderType Stable key.
 * @property {string} name Display name.
 * @property {string} color Polygon color.
 * @property {Record<string, number>} values Per-axis triumph counts.
 */

/**
 * A fresh per-axis values map initialized to zero.
 * @returns {Record<string, number>} The zeroed values map.
 */
function radarEmptyValues() {
  /** @type {Record<string, number>} */
  const v = {};
  for (const k of RADAR_AXIS_KEYS) v[k] = 0;
  return v;
}

/**
 * Compose a civ display name from leader/civ fields ("Leader (Civ)").
 * @param {*} src Source object carrying leaderName/civName.
 * @param {string} pid Player id key (for the fallback).
 * @returns {string} The display name.
 */
function radarCivName(src, pid) {
  if (!src.leaderName) return "Player " + pid;
  return src.civName ? src.leaderName + " (" + src.civName + ")" : src.leaderName;
}

/**
 * Read a snapshot row's per-axis triumph counts into a fresh zeroed values map.
 * @param {Record<string, *>} row The snapshot row.
 * @returns {Record<string, number>} The per-axis values.
 */
function radarValuesFromRow(row) {
  const values = radarEmptyValues();
  for (const k of RADAR_AXIS_KEYS) {
    if (typeof row[k] === "number" && isFinite(row[k])) values[k] = row[k];
  }
  return values;
}

/**
 * Build the civ map from a frozen per-age legacy snapshot.
 * @param {Record<string, *>} snap The snapshot (pid → row).
 * @returns {Map<string, RadarCiv>} The civ map.
 */
function loadRadarCivsFromSnapshot(snap) {
  /** @type {Map<string, RadarCiv>} */
  const out = new Map();
  let idx = 0;
  for (const pid of Object.keys(snap || {})) {
    const row = snap[pid];
    if (!row || typeof row !== "object") continue;
    // Prefer the civ's stored banner color so a civ keeps the SAME color in the
    // frozen per-age view as in the live current-age view; palette is a fallback
    // (older snapshots saved before primaryColor was stored).
    const color =
      typeof row.primaryColor === "string" && row.primaryColor.length > 0
        ? row.primaryColor
        : PALETTE[idx++ % PALETTE.length];
    out.set(pid, {
      pid,
      leaderType: String(row.leaderType ?? "pid:" + pid),
      name: radarCivName(row, pid),
      color,
      values: radarValuesFromRow(row)
    });
  }
  return out;
}

/**
 * Build the civ map for the current age by folding sample max-values, then
 * overriding with a live `player.Legacies` pull.
 * @param {Snapshot[]} samples The sample stream.
 * @returns {Map<string, RadarCiv>} The civ map.
 */
function loadRadarCivsCurrent(samples) {
  /** @type {Map<string, RadarCiv>} */
  const civs = new Map();
  /** @type {string[]} */
  const pidOrder = [];
  // Walk samples for names + colors and as a fallback data source.
  samples.forEach((s) => {
    if (!s || !s.players) return;
    for (const pid of Object.keys(s.players)) {
      foldRadarSample(civs, pidOrder, pid, s.players[pid]);
    }
  });
  // LIVE pull via player.Legacies (Test of Time): tally triggered triumphs by
  // LegacySubtype for each alive major; overrides sample values when higher.
  liveRadarPull(civs, pidOrder);
  return civs;
}

/**
 * Fold one civ's sample into the radar civ map (create-on-first-seen, then
 * take the per-axis max - triumph counts are non-decreasing per age).
 * @param {Map<string, RadarCiv>} civs The civ map (mutated).
 * @param {string[]} pidOrder Insertion order (mutated, for palette).
 * @param {string} pid Player id key.
 * @param {CivSample|*} ps One civ's sample.
 */
function foldRadarSample(civs, pidOrder, pid, ps) {
  const m = ps?.metrics || {};
  let civ = civs.get(pid);
  if (!civ) {
    const color =
      typeof ps.primaryColor === "string" && ps.primaryColor.length > 0
        ? ps.primaryColor
        : PALETTE[pidOrder.length % PALETTE.length];
    civ = {
      pid,
      leaderType: String(ps.leaderType ?? "pid:" + pid),
      name: radarCivName(ps, pid),
      color,
      values: radarEmptyValues()
    };
    civs.set(pid, civ);
    pidOrder.push(pid);
  }
  // Take the MAX - triumph counts are non-decreasing per age.
  mergeMaxAxes(civ.values, m);
}

/**
 * Merge per-axis values into a target, keeping the max of each finite value.
 * @param {Record<string, number>} target The values to update (mutated).
 * @param {Record<string, *>} src The source values (numeric or not).
 */
function mergeMaxAxes(target, src) {
  for (const k of RADAR_AXIS_KEYS) {
    const v = src[k];
    if (typeof v === "number" && isFinite(v) && v > target[k]) {
      target[k] = v;
    }
  }
}

/**
 * Tally one alive major's triggered triumphs by axis from `player.Legacies`.
 * @param {*} pl The player's Legacies accessor.
 * @returns {Record<string, number>} The per-axis triggered counts.
 */
function tallyLiveTriumphs(pl) {
  const counts = radarEmptyValues();
  try {
    for (const row of GameInfo.Legacies) {
      if (!row || !row.LegacyType) continue;
      const axis = RADAR_SUBTYPE_TO_AXIS[row.LegacySubtype];
      if (!axis) continue;
      let triggered = false;
      try {
        triggered = !!pl.isTriggered?.(row.LegacyType);
      } catch (_) {
        // player.Legacies.isTriggered may throw for this row; treat as not triggered.
      }
      if (triggered) counts[axis]++;
    }
  } catch (_) {
    // GameInfo.Legacies may be absent or non-iterable; return the zeroed counts.
  }
  return counts;
}

/**
 * Override radar civ values with a live `player.Legacies` triumph pull for
 * every alive major (creating civ entries that lack samples).
 * @param {Map<string, RadarCiv>} civs The civ map (mutated).
 * @param {string[]} pidOrder Insertion order (mutated, for palette).
 */
function liveRadarPull(civs, pidOrder) {
  try {
    if (!legaciesApiAvailable()) return;
    for (const pid of Players.getAliveMajorIds()) {
      const pl = typeof Players.get === "function" ? Players.get(pid)?.Legacies : null;
      if (!pl) continue;
      mergeLiveMajorTriumphs(civs, pidOrder, pid, tallyLiveTriumphs(pl));
    }
  } catch (_) {
    // Players.getAliveMajorIds / Players.get may throw; skip the live override.
  }
}

/**
 * Whether the Test-of-Time Legacies + alive-majors API is available.
 * @returns {boolean} True when both GameInfo.Legacies and the player API exist.
 */
function legaciesApiAvailable() {
  return (
    typeof GameInfo !== "undefined" &&
    !!GameInfo.Legacies &&
    typeof Players !== "undefined" &&
    typeof Players.getAliveMajorIds === "function"
  );
}

/**
 * Merge one alive major's live triumph counts into the radar civ map,
 * creating the civ entry when it has no samples yet.
 * @param {Map<string, RadarCiv>} civs The civ map (mutated).
 * @param {string[]} pidOrder Insertion order (mutated, for palette).
 * @param {number} pid The major's pid.
 * @param {Record<string, number>} counts The per-axis triggered counts.
 */
function mergeLiveMajorTriumphs(civs, pidOrder, pid, counts) {
  // Ensure civ exists (alive majors may not have samples yet if the storage
  // was reset).
  const pidStr = String(pid);
  let civ = civs.get(pidStr);
  if (!civ) {
    civ = {
      pid: pidStr,
      leaderType: "pid:" + pidStr,
      name: "Player " + pidStr,
      color: PALETTE[pidOrder.length % PALETTE.length],
      values: radarEmptyValues()
    };
    civs.set(pidStr, civ);
    pidOrder.push(pidStr);
  }
  mergeMaxAxes(civ.values, counts);
}

/**
 * Resolve the baseline radar civ map from the selected age source.
 * @param {ChartOptions|*} opts Render options.
 * @param {Snapshot[]} samples Sample stream.
 * @returns {Map<string, RadarCiv>} Baseline civ map.
 */
function radarSourceCivs(opts, samples) {
  const snapshots =
    opts.history &&
    opts.history.legacySnapshots &&
    typeof opts.history.legacySnapshots === "object"
      ? opts.history.legacySnapshots
      : {};
  const ageSource = typeof opts.ageSource === "string" ? opts.ageSource : "current";
  if (ageSource !== "current" && snapshots[ageSource]) {
    return loadRadarCivsFromSnapshot(snapshots[ageSource]);
  }
  return loadRadarCivsCurrent(samples);
}

/**
 * Remove unmet civs in place when spoiler guard is enabled.
 * @param {Map<string, RadarCiv>} civs Radar civ map.
 * @param {Snapshot[]} samples Sample stream.
 */
function filterUnmetRadarCivs(civs, samples) {
  if (!hideUnmetEnabled()) return;
  for (const pid of Array.from(civs.keys())) {
    if (isCivUnmet(samples, pid)) civs.delete(pid);
  }
}

/**
 * Resolve the radar civ map from the active source (frozen snapshot or live
 * current-age data).
 * @param {ChartOptions|*} opts The render options.
 * @param {Snapshot[]} samples The sample stream.
 * @returns {Map<string, RadarCiv>} The civ map.
 */
function loadRadarCivs(opts, samples) {
  const civs = radarSourceCivs(opts, samples);
  // Spoiler guard: drop polygons for civs the local player has not met (default
  // on). The radar is a current-state snapshot, so an unmet civ is hidden whole.
  filterUnmetRadarCivs(civs, samples);
  return civs;
}

/**
 * The maximum triumph value across all civs/axes (>=1).
 * @param {Map<string, RadarCiv>} civs The civ map.
 * @returns {number} The scale maximum.
 */
function radarScaleMax(civs) {
  let scaleMax = 0;
  civs.forEach((c) => {
    for (const k of Object.keys(c.values)) {
      if (c.values[k] > scaleMax) scaleMax = c.values[k];
    }
  });
  return scaleMax <= 0 ? 1 : scaleMax;
}

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
    const lbl = svgEl("text", {
      x: cx + Math.cos(a.angle) * (R + 22),
      y: cy + Math.sin(a.angle) * (R + 22),
      fill: "#f3c34c",
      "font-size": "18",
      "font-weight": "600",
      "text-anchor": "middle",
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
 * Sum a civ's six triumph-axis values, rounded.
 * @param {RadarCiv} c The civ.
 * @returns {number} The rounded total.
 */
function radarTriumphTotal(c) {
  return Math.round(
    (c.values.triumphs_cultural || 0) +
      (c.values.triumphs_diplomatic || 0) +
      (c.values.triumphs_economic || 0) +
      (c.values.triumphs_scientific || 0) +
      (c.values.triumphs_militaristic || 0) +
      (c.values.triumphs_expansionist || 0)
  );
}

/**
 * Build one radar legend entry (colored dot + civ name + Σ total), wiring its
 * click-to-toggle handler.
 * @param {RadarCiv} c The civ.
 * @param {boolean} isHidden Whether the civ is hidden.
 * @param {{ legendX: number, gy: number, W: number, H: number }} pos Placement.
 * @param {((leaderType: string) => void)|null} onToggle Toggle callback.
 * @returns {HTMLElement} The legend entry element.
 */
function buildRadarLegendEntry(c, isHidden, pos, onToggle) {
  const div = document.createElement("div");
  div.className = "demographics-chart-line-label demographics-radar-legend-label";
  if (isHidden) div.classList.add("is-hidden");
  // Per-civ geometry stays inline; cursor depends on whether toggle is wired.
  div.style.left = (pos.legendX / pos.W) * 100 + "%";
  div.style.top = (pos.gy / pos.H) * 100 + "%";
  div.style.cursor = onToggle ? "pointer" : "default";
  div.appendChild(buildRadarLegendDot(c, isHidden));
  div.appendChild(buildRadarLegendText(c));
  wireRadarLegendToggle(div, c, onToggle);
  return div;
}

/**
 * Build the radar legend color dot.
 * @param {RadarCiv} c The civ.
 * @param {boolean} isHidden Whether the civ is hidden.
 * @returns {HTMLElement} Dot element.
 */
function buildRadarLegendDot(c, isHidden) {
  const dot = document.createElement("span");
  dot.className = "demographics-chart-line-label-dot";
  if (isHidden) dot.classList.add("is-hollow");
  dot.style.backgroundColor = isHidden ? "transparent" : c.color;
  dot.style.borderColor = c.color;
  return dot;
}

/**
 * Build the radar legend text segment.
 * @param {RadarCiv} c The civ.
 * @returns {HTMLElement} Text element.
 */
function buildRadarLegendText(c) {
  const txt = document.createElement("span");
  txt.className = "demographics-chart-line-label-text";
  txt.textContent = c.name + " — Σ " + radarTriumphTotal(c);
  return txt;
}

/**
 * Wire click-to-toggle behavior for one legend entry.
 * @param {HTMLElement} div Legend entry element.
 * @param {RadarCiv} c The civ.
 * @param {((leaderType: string) => void)|null} onToggle Toggle callback.
 */
function wireRadarLegendToggle(div, c, onToggle) {
  if (!onToggle) return;
  div.addEventListener("click", (ev) => {
    ev.stopPropagation();
    safePlaySound("data-audio-select-press", "audio-screen-unlocks");
    onToggle(c.leaderType);
  });
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
    "aria-label": "Legacy Path radar"
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
 * Mount the radar side legend (one entry per civ) into the wrap.
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
  const { wrap, civs, hidden, opts, W, H } = params;
  const onToggle = typeof opts.onToggleCiv === "function" ? opts.onToggleCiv : null;
  let gy = 18;
  civs.forEach((c) => {
    const entry = buildRadarLegendEntry(
      c,
      hidden.has(c.leaderType),
      { legendX: 16, gy, W, H },
      onToggle
    );
    wrap.appendChild(entry);
    gy += 26;
  });
}
