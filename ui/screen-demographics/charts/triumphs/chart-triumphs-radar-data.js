// chart-triumphs-radar-data.js
//
// Data layer for the Legacy Path radar: the axis catalog plus the civ-map
// construction (a frozen per-age legacy snapshot, or the live current-age
// running max with a `player.Legacies` pull) and the per-civ scale/total math.
// DOM-free. The render + UI wiring lives in chart-triumphs-radar.js, which
// imports `loadRadarCivs` / `radarScaleMax` / `radarTriumphTotal` / `LEGACY_AXES`
// from here. Split out of chart-triumphs-radar.js to keep that module under the
// code-line cap.

import {
  PALETTE,
  civDroppedByPolicy
} from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";
import { inlineLabel } from "/demographics/ui/core/player-label.js";
import { tPlayerFallback } from "/demographics/ui/core/demographics-i18n.js";

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
export const LEGACY_AXES = [
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
  if (!src.leaderName) return tPlayerFallback(pid);
  return inlineLabel(src.leaderName, src.civName);
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
      name: tPlayerFallback(pidStr),
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
 * Remove policy-hidden civs in place (governance P0.1): unmet civs under the
 * spoiler guard, and every non-local civ under own-civ-only / disabled.
 * @param {Map<string, RadarCiv>} civs Radar civ map.
 * @param {Snapshot[]} samples Sample stream.
 */
function filterUnmetRadarCivs(civs, samples) {
  for (const pid of Array.from(civs.keys())) {
    if (civDroppedByPolicy(samples, pid)) civs.delete(pid);
  }
}

/**
 * Resolve the radar civ map from the active source (frozen snapshot or live
 * current-age data).
 * @param {ChartOptions|*} opts The render options.
 * @param {Snapshot[]} samples The sample stream.
 * @returns {Map<string, RadarCiv>} The civ map.
 */
export function loadRadarCivs(opts, samples) {
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
export function radarScaleMax(civs) {
  let scaleMax = 0;
  civs.forEach((c) => {
    for (const k of Object.keys(c.values)) {
      if (c.values[k] > scaleMax) scaleMax = c.values[k];
    }
  });
  return scaleMax <= 0 ? 1 : scaleMax;
}

/**
 * Sum a civ's six triumph-axis values, rounded.
 * @param {RadarCiv} c The civ.
 * @returns {number} The rounded total.
 */
export function radarTriumphTotal(c) {
  return Math.round(
    (c.values.triumphs_cultural || 0) +
      (c.values.triumphs_diplomatic || 0) +
      (c.values.triumphs_economic || 0) +
      (c.values.triumphs_scientific || 0) +
      (c.values.triumphs_militaristic || 0) +
      (c.values.triumphs_expansionist || 0)
  );
}
