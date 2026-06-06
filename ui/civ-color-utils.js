// civ-color-utils.js
//
// Shared color helpers for text rendered with civ-derived colors.
//
// Helpers keep civ-derived colors readable and distinct on the dark
// Demographics surfaces:
// - `preferReadableColor` picks the better of a civ's two banner colors,
//   swapping in the secondary when the primary is a dark grey/black that would
//   otherwise just become a dull grey (e.g. Alexander).
// - `safeTextColor` raises a single color to a minimum lightness so it reads on
//   the dark surface, preserving hue and saturation.
// - `deconflictColors` runs a global pass over the whole set of line colors so
//   no two civs share a near-identical color, falling back to arbitrary
//   well-separated colors when banner colors collide or aren't usable.
//
// Readability is gauged by HSL lightness, not raw luminance: a saturated pure
// red (luminance ~54) reads fine on a dark background, while a desaturated dark
// grey of the same luminance does not. Lightness + saturation capture that.

// Minimum HSL lightness a line color needs to read on the dark chart surface.
// A grey carries no hue to aid visibility, so it needs to be lighter than a
// saturated color; the floor slides from GREY (desaturated) to SATURATED.
const MIN_LIGHTNESS_GREY = 0.65;
const MIN_LIGHTNESS_SATURATED = 0.5;

// A primary banner color is worth replacing with the civ's secondary color when
// it is both dark and nearly colorless — a dark grey/black whose only readable
// form is a dull grey. Dark-but-saturated colors keep their hue when lifted, so
// they are not treated as grey.
const DARK_GREY_MAX_LIGHTNESS = 0.42;
const DARK_GREY_MAX_SATURATION = 0.3;

// Two line colors closer than this (weighted RGB "redmean" distance, range
// ~0-765) are treated as too similar to tell apart and one is reassigned.
const MIN_DISTINCT_DISTANCE = 80;
// How many golden-angle candidates to try when searching for a distinct
// arbitrary color before falling back to the best-separated one found.
const ARBITRARY_SCAN = 96;
// Golden-angle hue step (degrees) gives maximally-spread successive hues.
const GOLDEN_ANGLE = 137.508;
// Saturation / lightness for arbitrary colors: bright and readable on the dark
// chart background while staying clearly distinct from one another.
const ARBITRARY_SAT = 0.66;
const ARBITRARY_LIGHT = 0.58;

/**
 * Parse a `#RRGGBB`/`#AARRGGBB` or `rgb()/rgba()` color string into channels.
 * @param {string} input Color string.
 * @returns {{ r: number, g: number, b: number, alpha: string, src: "hex"|"rgba" } | null}
 *   Parsed channels or null.
 */
function parseColorChannels(input) {
  const hexMatch = input.match(/^#?([0-9a-fA-F]{6,8})$/);
  if (hexMatch) {
    const rgb = hexMatch[1].slice(-6);
    return {
      r: parseInt(rgb.slice(0, 2), 16),
      g: parseInt(rgb.slice(2, 4), 16),
      b: parseInt(rgb.slice(4, 6), 16),
      alpha: "",
      src: "hex"
    };
  }
  const rgbaMatch = input.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\)$/
  );
  if (!rgbaMatch) return null;
  return {
    r: parseInt(rgbaMatch[1], 10),
    g: parseInt(rgbaMatch[2], 10),
    b: parseInt(rgbaMatch[3], 10),
    alpha: rgbaMatch[4] !== undefined ? "," + rgbaMatch[4] : "",
    src: "rgba"
  };
}

/**
 * Format RGB channels as `#RRGGBB`.
 * @param {number} r Red channel.
 * @param {number} g Green channel.
 * @param {number} b Blue channel.
 * @returns {string} Hex color string.
 */
function toHexColor(r, g, b) {
  /** @param {number} n */
  const hex2 = (n) => n.toString(16).padStart(2, "0");
  return "#" + hex2(r) + hex2(g) + hex2(b);
}

/**
 * Convert RGB (0-255) to HSL.
 * @param {number} r Red channel.
 * @param {number} g Green channel.
 * @param {number} b Blue channel.
 * @returns {{ h: number, s: number, l: number }} Hue [0,360), sat/light [0,1].
 */
function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

/**
 * Convert HSL to RGB channels (0-255 integers).
 * @param {number} h Hue in degrees [0,360).
 * @param {number} s Saturation [0,1].
 * @param {number} l Lightness [0,1].
 * @returns {{ r: number, g: number, b: number }} RGB channels.
 */
function hslToRgbChannels(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) { r = c; g = x; } else if (hp < 2) { r = x; g = c; } else if (hp < 3) {
    g = c; b = x;
  } else if (hp < 4) { g = x; b = c; } else if (hp < 5) { r = x; b = c; } else { r = c; b = x; }
  const m = l - c / 2;
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  };
}

/**
 * Minimum readable HSL lightness for a color of the given saturation. Greys
 * need a higher floor than saturated colors.
 * @param {number} s Saturation [0,1].
 * @returns {number} Lightness floor [0,1].
 */
function minLightnessFor(s) {
  const t = Math.min(1, Math.max(0, s));
  return MIN_LIGHTNESS_GREY + (MIN_LIGHTNESS_SATURATED - MIN_LIGHTNESS_GREY) * t;
}

/**
 * Whether a parsed color is a dark, nearly-colorless grey/black — the case
 * where lifting yields a dull grey, so the civ's secondary color is preferred.
 * @param {{ r: number, g: number, b: number }} c Parsed channels.
 * @returns {boolean} True for dark greys/blacks.
 */
function isDarkGrey(c) {
  const { s, l } = rgbToHsl(c.r, c.g, c.b);
  return l < DARK_GREY_MAX_LIGHTNESS && s < DARK_GREY_MAX_SATURATION;
}

/**
 * Format RGB channels back into the same syntax the source color used,
 * preserving any rgba alpha suffix.
 * @param {number} r Red channel.
 * @param {number} g Green channel.
 * @param {number} b Blue channel.
 * @param {"hex"|"rgba"} src Source syntax.
 * @param {string} alpha Alpha suffix (e.g. ",0.5") or "".
 * @returns {string} Formatted color string.
 */
function formatColor(r, g, b, src, alpha) {
  if (src === "rgba" && alpha) {
    return "rgba(" + r + "," + g + "," + b + alpha + ")";
  }
  return toHexColor(r, g, b);
}

/**
 * Raise a civ color to the minimum readable lightness for the dark Demographics
 * surfaces, preserving its hue and saturation. Colors already light enough are
 * returned unchanged; a near-black grey becomes a light grey, a dark blue
 * becomes a clearly-visible blue, and so on.
 *
 * Pass-through behavior:
 * - Non-string / unparseable inputs are returned unchanged.
 * - Colors already at or above the lightness floor are returned unchanged.
 *
 * @param {*} civColor Civ color string.
 * @returns {*} Lifted color, or original input.
 */
export function safeTextColor(civColor) {
  if (typeof civColor !== "string") return civColor;
  const parsed = parseColorChannels(civColor);
  if (!parsed) return civColor;

  const { h, s, l } = rgbToHsl(parsed.r, parsed.g, parsed.b);
  const minL = minLightnessFor(s);
  if (l >= minL) return civColor;

  const { r, g, b } = hslToRgbChannels(h, s, minL);
  return formatColor(r, g, b, parsed.src, parsed.alpha);
}

/**
 * Choose the more readable of a civ's two banner colors for use as a line /
 * swatch color on the dark Demographics surfaces.
 *
 * The primary banner color is preferred (it's the color players associate with
 * the civ). Only when the primary is a dark grey/black — where lifting it would
 * produce a dull, identity-less grey — is the civ's secondary banner color used
 * instead, provided the secondary is itself a real (non-grey) color. Dark but
 * saturated primaries keep their hue when lifted and are left alone.
 *
 * The returned color is raw (not lifted); callers should still pass it through
 * {@link safeTextColor} so it reaches the readable lightness floor.
 *
 * @param {*} primaryColor Civ primary banner color string.
 * @param {*} secondaryColor Civ secondary banner color string.
 * @returns {*} The chosen color (primary unless the secondary reads better).
 */
export function preferReadableColor(primaryColor, secondaryColor) {
  if (typeof primaryColor !== "string" || primaryColor.length === 0) {
    return primaryColor;
  }
  const primary = parseColorChannels(primaryColor);
  // Keep the primary unless it is a dark, colorless grey/black.
  if (!primary || !isDarkGrey(primary)) {
    return primaryColor;
  }
  // Primary is a dark grey: prefer the secondary banner color when it carries a
  // real hue (i.e. is not itself a dark grey).
  if (typeof secondaryColor === "string" && secondaryColor.length > 0) {
    const secondary = parseColorChannels(secondaryColor);
    if (secondary && !isDarkGrey(secondary)) {
      return secondaryColor;
    }
  }
  // No better option; safeTextColor will lift the dark grey to a light grey.
  return primaryColor;
}

/**
 * Weighted RGB ("redmean") distance between two parsed colors — a cheap
 * perceptual approximation good enough to flag "too similar" line colors.
 * @param {{ r: number, g: number, b: number }} a First color.
 * @param {{ r: number, g: number, b: number }} b Second color.
 * @returns {number} Distance (0 = identical, larger = more different).
 */
function channelDistance(a, b) {
  const rmean = (a.r + b.r) / 2;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(
    (2 + rmean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rmean) / 256) * db * db
  );
}

/**
 * Perceptual distance between two color strings. Unparseable inputs are treated
 * as maximally distinct (Infinity) so they never trip the similarity check.
 * @param {*} colorA First color string.
 * @param {*} colorB Second color string.
 * @returns {number} Distance, or Infinity if either is unparseable.
 */
export function colorDistance(colorA, colorB) {
  const a = parseColorChannels(typeof colorA === "string" ? colorA : "");
  const b = parseColorChannels(typeof colorB === "string" ? colorB : "");
  if (!a || !b) return Infinity;
  return channelDistance(a, b);
}

/**
 * An arbitrary, deterministic, readable color for a given index. Successive
 * indices are spread by the golden angle so neighbours are maximally distinct.
 * Used as the last-resort line color when banner colors collide or can't be
 * used.
 * @param {number} index Sequence index (0, 1, 2, …).
 * @returns {string} Hex color.
 */
export function arbitraryColor(index) {
  const hue = ((index * GOLDEN_ANGLE) % 360 + 360) % 360;
  const { r, g, b } = hslToRgbChannels(hue, ARBITRARY_SAT, ARBITRARY_LIGHT);
  return toHexColor(r, g, b);
}

/**
 * Minimum distance from a parsed color to any already-accepted color.
 * @param {{ r: number, g: number, b: number }} c Candidate color.
 * @param {Array<{ r: number, g: number, b: number }>} accepted Accepted colors.
 * @returns {number} Smallest distance (Infinity when none accepted yet).
 */
function minDistanceTo(c, accepted) {
  let min = Infinity;
  for (const a of accepted) {
    const d = channelDistance(c, a);
    if (d < min) min = d;
  }
  return min;
}

/**
 * Search the arbitrary palette for a color well-separated from all accepted
 * colors. Returns the first candidate that clears the threshold, or the
 * best-separated one found within the scan budget.
 * @param {Array<{ r: number, g: number, b: number }>} accepted Accepted colors.
 * @param {number} startIdx First arbitrary index to try.
 * @returns {{ color: string, parsed: { r: number, g: number, b: number }, nextIdx: number }}
 *   The chosen color, its channels, and the next unused arbitrary index.
 */
function pickArbitraryDistinct(accepted, startIdx) {
  let idx = startIdx;
  let best = arbitraryColor(idx);
  let bestParsed = /** @type {*} */ (parseColorChannels(best));
  let bestDist = minDistanceTo(bestParsed, accepted);
  idx++;
  while (bestDist < MIN_DISTINCT_DISTANCE && idx - startIdx < ARBITRARY_SCAN) {
    const cand = arbitraryColor(idx);
    const cp = parseColorChannels(cand);
    idx++;
    const dist = minDistanceTo(/** @type {*} */ (cp), accepted);
    if (dist > bestDist) {
      best = cand;
      bestParsed = /** @type {*} */ (cp);
      bestDist = dist;
    }
  }
  return { color: best, parsed: bestParsed, nextIdx: idx };
}

/**
 * Global pass over a set of desired line colors (in priority order) that keeps
 * every color visually distinct. Each color is kept when it is far enough from
 * all earlier-accepted colors; otherwise it is replaced with an arbitrary,
 * well-separated color (see {@link arbitraryColor}). Earlier entries win, so
 * higher-priority civs keep their true banner color and only collisions move.
 * @param {string[]} colors Desired display colors, in priority order.
 * @returns {string[]} Final colors, same length/order, all mutually distinct.
 */
export function deconflictColors(colors) {
  /** @type {Array<{ r: number, g: number, b: number }>} */
  const accepted = [];
  const out = [];
  let arbitraryIdx = 0;
  for (const desired of colors) {
    let chosen = desired;
    /** @type {{ r: number, g: number, b: number } | null} */
    let parsed = parseColorChannels(typeof desired === "string" ? desired : "");
    if (!parsed || minDistanceTo(parsed, accepted) < MIN_DISTINCT_DISTANCE) {
      const pick = pickArbitraryDistinct(accepted, arbitraryIdx);
      chosen = pick.color;
      parsed = pick.parsed;
      arbitraryIdx = pick.nextIdx;
    }
    out.push(chosen);
    if (parsed) accepted.push(parsed);
  }
  return out;
}
