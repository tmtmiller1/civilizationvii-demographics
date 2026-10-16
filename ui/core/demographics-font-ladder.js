// demographics-font-ladder.js
//
// Owns the Demographics UI scale. The whole frame is laid out at the reference size and drawn
// through `transform: scale(s)` (applyVisualScale), so every resolution shows the same layout,
// uniformly scaled. The type scale (`--dg-fs-*`) is published as computed rem values from the
// player's Font Size setting, and `--dg-u` / `--dg-t` are the box and type units the stylesheets
// are written against. Those sit at 1rem while the transform is in use, so a per-metric adjustment
// on top of the uniform scale is one JS write away if it is ever wanted.
//
// Why a transform and not clamp(): the engine's root font-size is a constant 16.2px at every render
// resolution from 1280x720 to 3840x2160, so `rem` is a fixed pixel size and does not track
// resolution. The same layout takes ~1% of screen height at 1800p but ~2% at 720p, which is why the
// screen read as oversized at low resolutions. An earlier `clamp()` layer in the density stylesheet
// never did anything, because GameFace drops `clamp()` (`width: clamp(50px,20vw,120px)` computes to
// `auto`), and its constants assumed a ~60rem-tall viewport at every resolution; it is 44.4rem at
// 720p and 133.3rem at 2160p. What does work on 1.5.0: `calc(<number> * var(<length>))`, custom
// properties inherited through nesting, and live relayout when JS rewrites the property.
//
// Reference point: a 1800px-tall viewport (2880x1800), the resolution this UI is tuned against. At
// that height the scale is exactly 1 and every dimension matches the old fixed-rem values.

import { applyLocaleFontClass } from "/demographics/ui/core/demographics-i18n.js";

/** The viewport height (px) the UI is designed against; scale is exactly 1 here. */
export const REFERENCE_VIEWPORT_H = 1800;

/**
 * Readability floor for the visual scale. Scaling in proportion would put 18px body text at 9.9px
 * on a 720p screen (0.55), and the transform resamples rendered glyphs rather than re-rasterizing
 * them, so small text was both tiny and soft. 0.7 keeps body text at 12.6px CSS, the same floor the
 * earlier per-declaration scaling used, with a much milder resample. The inner layout is then short
 * of the reference below ~1260px of viewport height, and the density stylesheet's micro tier
 * compacts chrome and the podium cards to close that gap.
 */
export const MIN_VISUAL_SCALE = 0.7;

/** Headroom above the reference so 4K and larger do not render the screen as a small island. */
export const MAX_VISUAL_SCALE = 1.3;

/**
 * Type has a higher floor than the layout. At 720p with everything at 0.7, body text is 10.7px,
 * tab labels 9.8px and button labels 8.2px on screen, which is hard to read. When the visual scale
 * is below this, the type ladder (and --dg-t, the unit for boxes that hold text) is boosted by
 * MIN_TYPE_VISUAL / visualScale inside the frame, so text lands at this visual scale while padding,
 * gaps and avatars keep following the layout. 0.82 puts body text at ~12.6px.
 */
export const MIN_TYPE_VISUAL = 0.82;

/** Size-keyed steps (rem at the reference), published as `--dg-fs-<size x 100>`. */
export const FONT_LADDER = [0.65, 0.72, 0.78, 0.85, 0.95, 1, 1.05, 1.2, 1.4, 1.6, 1.85, 2.4];

/**
 * Named steps for the World Rankings matrix and the category-leader cards, whose sizes are chosen
 * per role rather than picked off the ladder.
 * @type {Record<string, number>}
 */
export const FONT_NAMED = {
  "--dg-fs-lead": 1.1,
  "--dg-fs-civ": 0.95,
  "--dg-fs-label": 1.05,
  "--dg-fs-value": 1.15,
  "--dg-fs-rank": 0.9,
  // Category-leader cards (top of World Rankings; also the All Settlements panel). Kept in line
  // with the table's scale so the strip doesn't read oversized.
  "--dg-fs-card-name": 0.9,
  "--dg-fs-card-sub": 0.78,
  "--dg-fs-card-val": 1.15,
  "--dg-fs-card-cat": 0.85
};

/**
 * The player's Font Size setting (`uiFontScale`: 0 XSmall … 4 XLarge) as a multiplier over the
 * engine's 18px base. Falls back to 1 whenever the setting cannot be read or is out of range.
 * @returns {number}
 */
export function fontScale() {
  const PX = [16, 18, 20, 22, 24];
  try {
    const idx = typeof Configuration !== "undefined" ? Configuration.getUser?.()?.uiFontScale : undefined;
    return typeof idx === "number" && PX[idx] ? PX[idx] / 18 : 1;
  } catch (_) {
    return 1;
  }
}

/**
 * The whole-screen visual scale for the current viewport, relative to the reference height, bounded
 * by {@link MIN_VISUAL_SCALE} / {@link MAX_VISUAL_SCALE}. Returns 1 if the viewport cannot be read.
 * @returns {number}
 */
export function visualScale() {
  try {
    return scaleForHeight(document?.documentElement?.clientHeight);
  } catch (_) {
    return 1;
  }
}

/**
 * The visual scale for a viewport height, bounded by {@link MIN_VISUAL_SCALE} / {@link MAX_VISUAL_SCALE}.
 * 1 when the height is missing or not a positive number.
 * @param {*} height Viewport height in px.
 * @returns {number}
 */
export function scaleForHeight(height) {
  if (typeof height !== "number" || !Number.isFinite(height) || height <= 0) return 1;
  return Math.max(MIN_VISUAL_SCALE, Math.min(MAX_VISUAL_SCALE, height / REFERENCE_VIEWPORT_H));
}

/** The frame's share of the viewport, in vw / vh, before the scale is applied. */
const FRAME_VW = 96;
const FRAME_VH = 94;

/**
 * The frame's own (local) layout size for a viewport: what the pages are laid out in before the
 * transform draws them at the visual scale.
 * @param {number} width Viewport width in px.
 * @param {number} height Viewport height in px.
 * @returns {{ width: number, height: number, scale: number }}
 */
export function frameLayoutSize(width, height) {
  const scale = scaleForHeight(height);
  return { width: (width * FRAME_VW) / 100 / scale, height: (height * FRAME_VH) / 100 / scale, scale };
}

/**
 * Small-screen layout. Text has its own floor ({@link MIN_TYPE_VISUAL}), so below 1080p it can't shrink
 * with the screen, and the boards that share their width between many columns run out of room for
 * their words. Below this local frame width the frame carries the `dg-compact` class, and the density
 * stylesheet's small-screen block makes room: display names and headings step down a size, list
 * portraits and low-value columns drop, and column headings wrap to two lines. The value sits between
 * 1366x768 (1873 local px wide) and 1600x900 (2194).
 */
export const COMPACT_FRAME_WIDTH = 2000;

/**
 * Windows at least this large always get the full layout, so 1080p and up look exactly as they did
 * before the small-screen layout existed.
 */
export const FULL_LAYOUT_MIN_W = 1920;
export const FULL_LAYOUT_MIN_H = 1080;

/**
 * Whether a viewport gets the small-screen layout. Never true at or above 1920x1080.
 * @param {*} width Viewport width in px.
 * @param {*} height Viewport height in px.
 * @returns {boolean}
 */
export function isCompactViewport(width, height) {
  const isSize = (/** @type {*} */ v) => typeof v === "number" && Number.isFinite(v) && v > 0;
  if (!isSize(width) || !isSize(height)) return false;
  if (width >= FULL_LAYOUT_MIN_W && height >= FULL_LAYOUT_MIN_H) return false;
  return frameLayoutSize(width, height).width < COMPACT_FRAME_WIDTH;
}

/** The frame class the density stylesheet's small-screen block is keyed on. */
export const COMPACT_CLASS = "dg-compact";

// set by applyVisualScale; 1 until then
let _appliedVisualScale = 1;
// set by applyVisualScale; false until then
let _isCompact = false;

/**
 * Whether the screen is currently drawn with the small-screen layout (see {@link COMPACT_FRAME_WIDTH}).
 * @returns {boolean}
 */
export function isCompactLayout() {
  return _isCompact;
}

/**
 * Give a name that may be cut short on a small screen its full text as a tooltip. Only in the
 * small-screen layout, so larger screens keep the hover behavior they had.
 * @param {HTMLElement|null|undefined} el
 * @param {*} text
 * @returns {void}
 */
export function applyCompactTooltip(el, text) {
  if (!_isCompact || !el || typeof el.setAttribute !== "function") return;
  if (typeof text !== "string" || !text) return;
  el.setAttribute("data-tooltip-content", text);
}

/**
 * Read the viewport and set the small-screen state. Off when the viewport can't be read.
 * @returns {boolean}
 */
function readCompactViewport() {
  try {
    const root = document?.documentElement;
    return isCompactViewport(root?.clientWidth, root?.clientHeight);
  } catch (_) {
    return false;
  }
}

/**
 * The scale the screen is currently drawn at. JS that converts a measured (visual) rect into a
 * local pixel size or position must divide by this: under `transform: scale(s)` getBoundingClientRect
 * reports visual pixels, but style.left / width / canvas sizes are in the frame's own, unscaled
 * coordinate space. Ratios of two visual measurements (a fraction along a lane) need no correction.
 * @returns {number}
 */
export function appliedVisualScale() {
  return _appliedVisualScale;
}

/**
 * Convert a visual pixel measurement to the frame's local pixels.
 * @param {number} px Visual pixels (from getBoundingClientRect or clientX/Y).
 * @returns {number} Local pixels.
 */
export function toLocalPx(px) {
  return px / (_appliedVisualScale || 1);
}

/**
 * Draw the whole screen as one uniformly scaled unit: lay the frame out as if the viewport were
 * 1/s its size, then shrink (or grow) it visually by s. Text, padding, chart, legend and overlays
 * all scale together, so the layout is the reference layout at every resolution. GameFace has no
 * `zoom`, and per-declaration CSS scaling could not keep hundreds of independent metrics and
 * JS-positioned overlays consistent, so the transform is the mechanism. Also sets the small-screen
 * class ({@link COMPACT_CLASS}) on the frame when {@link isCompactViewport} says so.
 * @param {HTMLElement} frame
 * @returns {number} The scale applied.
 */
export function applyVisualScale(frame) {
  const s = visualScale();
  _appliedVisualScale = s;
  _isCompact = readCompactViewport();
  if (!frame || !frame.style) return s;
  if (frame.classList) {
    if (_isCompact) frame.classList.add(COMPACT_CLASS);
    else frame.classList.remove(COMPACT_CLASS);
  }
  const w = (FRAME_VW / s).toFixed(4), h = (FRAME_VH / s).toFixed(4);
  frame.style.width = w + "vw";
  frame.style.height = h + "vh";
  frame.style.maxWidth = w + "vw";
  frame.style.maxHeight = h + "vh";
  // Center deterministically rather than relying on flex-overflow behavior for an oversized child.
  frame.style.position = "absolute";
  frame.style.left = "50%";
  frame.style.top = "50%";
  frame.style.transformOrigin = "center center";
  frame.style.transform = "translate(-50%, -50%) scale(" + s.toFixed(4) + ")";
  frame.style.setProperty("--dg-visual-scale", s.toFixed(4));
  return s;
}

/**
 * How much larger text is than the layout it sits in. Below {@link MIN_TYPE_VISUAL} the type ladder
 * is boosted so text stays readable while padding, gaps and avatars keep following the visual
 * scale, which means a line of text occupies more of the frame's own pixels at a small resolution
 * than at the reference. JS that reserves space for text in the frame's coordinate space (a chart
 * band, a label gutter) has to multiply by this or it will reserve the reference's room and the
 * text will overrun it. 1 at the reference and above.
 * @returns {number}
 */
export function typeBoost() {
  return Math.max(1, MIN_TYPE_VISUAL / (_appliedVisualScale || 1));
}

/**
 * Publish the type scale and the box unit onto a screen root.
 * @param {HTMLElement} node
 * @param {boolean} [named] Also publish {@link FONT_NAMED} (the in-game World Rankings pages).
 * @returns {void}
 */
export function publishFontLadder(node, named) {
  // Font family follows the locale too: the stylesheets switch to the CJK list on this class.
  applyLocaleFontClass();
  if (!node || !node.style || typeof node.style.setProperty !== "function") return;
  // The visual transform (applyVisualScale) carries all resolution adaptation, so the box unit
  // stays at exactly 1 here and only the player's Font Size setting moves the ladder, plus the
  // type boost that keeps text at MIN_TYPE_VISUAL on screen when the layout is drawn smaller.
  const boost = typeBoost();
  const scale = fontScale() * boost;
  node.style.setProperty("--dg-u", "1rem");
  node.style.setProperty("--dg-t", boost.toFixed(4) + "rem");
  node.style.setProperty("--dg-ui-scale", "1");
  node.style.setProperty("--dg-type-scale", boost.toFixed(4));

  for (const v of FONT_LADDER) {
    node.style.setProperty("--dg-fs-" + Math.round(v * 100), (v * scale).toFixed(4) + "rem");
  }
  if (!named) return;
  for (const name of Object.keys(FONT_NAMED)) {
    node.style.setProperty(name, (FONT_NAMED[name] * scale).toFixed(4) + "rem");
  }
}
