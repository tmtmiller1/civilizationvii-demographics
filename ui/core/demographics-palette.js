// demographics-palette.js
//
// Color palette for mod-owned chrome. Civ primary colors (returned by
// UI.Player.getPrimaryColorValueAsString) are treated as identity
// markers and never overridden; this module only owns colors we invent
// ourselves - the rotating fallback when a civ has no primary, the
// attitude swatches in the relations ring, and the fallback bars in
// the conflicts gantt.
//
// The colorblind palette is Wong's eight-color CVD-safe set (Nature
// Methods 8, 441, 2011), which remains distinguishable under
// deuteranopia, protanopia, and tritanopia simulators.

import { DemographicsSettings } from "/demographics/ui/core/demographics-settings.js";

// Standard rotating palette (existing project colors).
const PALETTE_STANDARD = [
  "#e6a23c",
  "#7fb3e6",
  "#9ad17a",
  "#d97c7c",
  "#c9a2dc",
  "#f3c34c",
  "#5fb3b3",
  "#e67c7c",
  "#a0d0e0",
  "#dba268",
  "#7fcfa0",
  "#c8d97c"
];

// Wong palette - designed for CVD readability.
const PALETTE_COLORBLIND = [
  "#E69F00", // orange
  "#56B4E9", // sky blue
  "#009E73", // bluish green
  "#F0E442", // yellow
  "#0072B2", // blue
  "#D55E00", // vermillion
  "#CC79A7", // reddish purple
  "#999999", // gray
  // Wong has 8; pad with slight shifts for 4 more so 12-civ rings still
  // get distinct entries without recycling.
  "#A66A00",
  "#3B7FBA",
  "#006B4F",
  "#A88FB2"
];

// Attitude swatches - each must remain visually distinct from the
// per-filter colors shown in the same view (POLITICAL_FILTERS,
// ECONOMIC_FILTERS, CS_POLITICAL_FILTERS in view-relations.js). Two
// known collisions:
//   denounced = #ff7f1a  → hostile cannot be orange.
//   trade (was #3fbf3f)  → friendly stays green; trade moved to teal.
// Vivid attitude scale: a saturated diverging ramp from war (red) through the
// neutral stone to alliance (blue). The earlier pale pastels were too close in
// chroma/value to tell apart on the deep ring field, so these push saturation
// while keeping the semantics (war = red, friendly = green, alliance = blue, …)
// and a readable warm→cool ordering across the seven steps.
const ATTITUDE_STANDARD = {
  war: "#e8473b", // vivid red
  hostile: "#e87434", // orange-red (strong negative)
  unfriendly: "#eaa93b", // amber (caution)
  neutral: "#b9b1a0", // warm stone grey
  friendly: "#a6d24a", // lime green (positive)
  helpful: "#4fc56e", // green (warm positive)
  alliance: "#4ea6ec" // vivid blue (allied)
};

// CVD-safe attitude swatches: red→vermillion (the most universal "danger"
// signal stays warm-red but in a vermillion hue), green→bluish-green, etc.
// Preserves the warm vs. cool semantic split so a quick glance still reads
// "at war = dangerous" and "alliance = positive".
const ATTITUDE_COLORBLIND = {
  war: "#D55E00", // vermillion - still reads "warning"
  alliance: "#56B4E9", // sky blue - positive
  helpful: "#F0E442", // yellow - warm positive
  friendly: "#009E73", // bluish green - positive
  neutral: "#999999", // gray
  unfriendly: "#E69F00", // orange - caution
  hostile: "#CC79A7" // reddish purple - strong negative
};

// Generic semantic helpers used elsewhere (conflicts gantt fallback bar
// colors when no civ primary is available, etc.).
const SEMANTIC_STANDARD = {
  sideA_fallback: "#d97c7c",
  sideB_fallback: "#7fb3e6",
  ongoing_marker: "#e02020",
  closed_hatch: "#1c1408",
  accent_gold: "#f3c34c"
};
const SEMANTIC_COLORBLIND = {
  sideA_fallback: "#D55E00",
  sideB_fallback: "#56B4E9",
  ongoing_marker: "#D55E00",
  closed_hatch: "#1c1408",
  accent_gold: "#F0E442"
};

/**
 * Whether the user has enabled the CVD-safe (colorblind) palette.
 * @returns {boolean}
 */
function isColorblindMode() {
  try {
    return !!DemographicsSettings.getSetting("colorblindMode", false);
  } catch (_) {
    return false;
  }
}

/**
 * The rotating per-civ line palette (Wong CVD-safe set in colorblind mode).
 * @returns {string[]} Hex color strings.
 */
export function getPalette() {
  return isColorblindMode() ? PALETTE_COLORBLIND : PALETTE_STANDARD;
}

/**
 * Relationship-attitude swatches keyed by attitude name (war, alliance, …).
 * @returns {Record<string, string>} Attitude → hex color.
 */
export function getAttitudeColors() {
  return isColorblindMode() ? ATTITUDE_COLORBLIND : ATTITUDE_STANDARD;
}

/**
 * Generic semantic colors (gantt fallback bars, ongoing/closed markers, accent).
 * @returns {Record<string, string>} Semantic role → hex color.
 */
export function getSemantic() {
  return isColorblindMode() ? SEMANTIC_COLORBLIND : SEMANTIC_STANDARD;
}
