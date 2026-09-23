// demographics-font-ladder.js
//
// The single source of truth for the Demographics UI scale, in JavaScript. It owns:
//
//   1. The VISUAL scale (applyVisualScale): the whole frame is laid out at the reference size and
//      drawn through `transform: scale(s)`, so every resolution shows the same layout, uniformly
//      scaled. This is the resolution mechanism.
//   2. The type scale (`--dg-fs-*`), published as fully-computed rem values from the player's Font
//      Size setting.
//   3. `--dg-u` / `--dg-t`, the box and type length units the stylesheets are written against.
//      They are pinned to 1rem while the visual transform is in use; they remain so that a future
//      per-metric adjustment on top of the uniform scale is one JS write away.
//
// WHY A UNIT AND NOT clamp():
// The engine's root font-size is a CONSTANT (measured 16.2px at render resolutions from 1280x720 to
// 3840x2160, and across two different window sizes on 2026-09-23). So `rem` is effectively a fixed
// pixel size and does NOT track resolution: the same layout occupies ~1% of screen height at 1800p
// but ~2% at 720p, which is why the screen read as oversized at low resolutions. The previous fix
// for this was a `clamp()` layer in the density stylesheet; GameFace silently DROPS `clamp()`
// (measured: `width: clamp(50px,20vw,120px)` computes to `auto`), so that layer never did anything,
// and its constants were derived from a premise ("the viewport is ~60rem tall at every design
// resolution") that is false - it measures 44.4rem at 720p and 133.3rem at 2160p.
//
// What IS supported, all measured on 1.5.0: `calc(<number> * var(<length>))`, custom properties
// inherited through nesting, and live relayout when JS rewrites the property. So one published unit
// scales the whole screen and can be recomputed at any time.
//
// Reference point: a 1800px-tall viewport (2880x1800), the resolution this UI is tuned against.
// At that height the scale is exactly 1 and every dimension is byte-identical to the old fixed-rem
// values, so the reference experience is unchanged by design.

/** The viewport height (px) the UI is designed against; scale is exactly 1 here. */
export const REFERENCE_VIEWPORT_H = 1800;

/**
 * Readability floor for the visual scale. Scaling in proportion would put 18px body text at 9.9px
 * on a 720p screen (0.55), and the transform RESAMPLES rendered glyphs rather than re-rasterizing
 * them, so small text was both tiny and soft (watched 2026-09-23). 0.7 keeps body text at 12.6px
 * CSS, the same floor the earlier per-declaration scaling used, with a much milder resample. The
 * inner layout is then short of the reference below ~1260px of viewport height, and the density
 * stylesheet's micro tier compacts chrome and the podium cards to close that gap.
 */
export const MIN_VISUAL_SCALE = 0.7;

/** Headroom above the reference so 4K and larger do not render the screen as a small island. */
export const MAX_VISUAL_SCALE = 1.3;

/**
 * TYPE has a higher floor than the layout. Measured at 720p with everything at 0.7: body text 10.7px,
 * tab labels 9.8px, button labels 8.2px on screen - the player called it hard to read, correctly.
 * When the visual scale is below this, the type ladder (and --dg-t, the unit for boxes that hold
 * text) is boosted by MIN_TYPE_VISUAL / visualScale inside the frame, so text lands at this visual
 * scale while padding, gaps and avatars keep following the layout. 0.82 puts body text at ~12.6px.
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
 * @returns {number} The multiplier.
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
 * The whole-screen VISUAL scale for the current viewport, relative to the reference height, bounded
 * by {@link MIN_VISUAL_SCALE} / {@link MAX_VISUAL_SCALE}. Returns 1 if the viewport cannot be read.
 * @returns {number} The multiplier.
 */
export function visualScale() {
  try {
    const h = document?.documentElement?.clientHeight;
    if (!h || !Number.isFinite(h) || h <= 0) return 1;
    return Math.max(MIN_VISUAL_SCALE, Math.min(MAX_VISUAL_SCALE, h / REFERENCE_VIEWPORT_H));
  } catch (_) {
    return 1;
  }
}

/** The visual scale most recently applied by {@link applyVisualScale}; 1 until then. */
let _appliedVisualScale = 1;

/**
 * The scale the screen is currently drawn at. JS that converts a measured (visual) rect into a
 * LOCAL pixel size or position must divide by this: under `transform: scale(s)` getBoundingClientRect
 * reports visual pixels, but style.left / width / canvas sizes are in the frame's own, unscaled
 * coordinate space. Ratios of two visual measurements (a fraction along a lane) need no correction.
 * @returns {number} The applied visual scale.
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
 * all scale together, so the layout is the REFERENCE layout at every resolution. GameFace has no
 * `zoom`, and per-declaration CSS scaling proved unable to keep hundreds of independent metrics
 * and JS-positioned overlays consistent (measured 2026-09-23), so the transform is the mechanism.
 * @param {HTMLElement} frame The screen's frame element.
 * @returns {number} The scale applied.
 */
export function applyVisualScale(frame) {
  const s = visualScale();
  _appliedVisualScale = s;
  if (!frame || !frame.style) return s;
  const w = (96 / s).toFixed(4), h = (94 / s).toFixed(4);
  frame.style.width = w + "vw";
  frame.style.height = h + "vh";
  frame.style.maxWidth = w + "vw";
  frame.style.maxHeight = h + "vh";
  // Centre deterministically rather than relying on flex-overflow behaviour for an oversized child.
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
 * scale, which means a line of text occupies MORE of the frame's own pixels at a small resolution
 * than at the reference. JS that reserves space for text in the frame's coordinate space (a chart
 * band, a label gutter) has to multiply by this or it will reserve the reference's room and the
 * text will overrun it. 1 at the reference and above.
 * @returns {number} The multiplier.
 */
export function typeBoost() {
  return Math.max(1, MIN_TYPE_VISUAL / (_appliedVisualScale || 1));
}

/**
 * Publish the type scale and the box unit onto a screen root.
 * @param {HTMLElement} node The screen root.
 * @param {boolean} [named] Also publish {@link FONT_NAMED} (the in-game World Rankings pages).
 * @returns {void}
 */
export function publishFontLadder(node, named) {
  if (!node || !node.style || typeof node.style.setProperty !== "function") return;
  // The layout inside the frame is the REFERENCE layout: the visual transform (applyVisualScale)
  // carries all resolution adaptation, so the box unit and the type scale stay at exactly 1 here
  // and only the player's Font Size setting moves the ladder.
  // Type boost: keep text at MIN_TYPE_VISUAL on screen when the layout is drawn smaller than that.
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
