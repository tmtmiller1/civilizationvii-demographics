// board-ui.js
//
// Shared DOM/SVG primitives for the plain-render "board" charts. Identity is carried by a colored
// swatch / accent / bar-fill, never by text on a colored background; all text wears ink tokens on
// the dark surface, and civ colors are raised to a readable lightness via civ-color-utils.

import { preferReadableColor, safeTextColor } from "/demographics/ui/core/civ-color-utils.js";
import { t } from "/demographics/ui/core/demographics-i18n.js";
import { inlineLabel } from "/demographics/ui/core/player-label.js";
import { SVG_NS, svgEl } from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";

/**
 * Dark-surface design tokens for the boards. They are literals because they land in `border`
 * shorthands and SVG attributes, where GameFace does not resolve `var()`. Contrast figures are
 * against the darkest and lightest backgrounds a board sits on (the frame over the game).
 */
export const INK = "#EDE7D6";
/** Secondary labels and values; 7.0:1. */
export const INK_MUTED = "#BDAE8C";
/** Small captions and counts; 4.5:1, the WCAG AA floor for small text. */
export const INK_DIM = "#978A6E";
export const PANEL = "rgba(255,255,255,0.03)";
/** Card and row outlines: a quiet warm rule that separates without competing with the data. */
export const BORDER = "#4F4438";
export const GRID = "#3A342A";
export const TRACK = "rgba(255,255,255,0.06)";
/** Highlights and single-series bars; 7.2:1. */
export const ACCENT = "#CFAE54";
/** Stand-in for a missing civ or religion color: a neutral grey, 7.5:1. */
export const FALLBACK_COLOR = "#B6B5B5";

/**
 * A readable civ color (raised to the dark-surface lightness floor) from a
 * sample player's banner colors.
 * @param {*} player A sample player (primaryColor/secondaryColor), or nullish.
 * @returns {string} A readable CSS color.
 */
export function civColor(player) {
  const raw = player && (player.primaryColor || player.readable);
  const chosen = player ? preferReadableColor(player.primaryColor, player.secondaryColor) : raw;
  const safe = safeTextColor(chosen || raw);
  return typeof safe === "string" && safe ? safe : FALLBACK_COLOR;
}

/**
 * Raise any color to a readable lightness on the dark surface.
 * @param {string} color
 * @returns {string}
 */
export function readable(color) {
  const safe = safeTextColor(color);
  return typeof safe === "string" && safe ? safe : FALLBACK_COLOR;
}

/**
 * A styled div (optional class + text). The shared building block.
 * @param {string} style Inline style.
 * @param {string} [text]
 * @param {string} [cls] Class name.
 * @returns {HTMLElement}
 */
export function box(style, text, cls) {
  const div = document.createElement("div");
  div.setAttribute("style", style);
  if (cls) div.className = cls;
  if (text) div.textContent = text;
  return div;
}

/**
 * A small circled "+" badge that flags a row as click-to-expand. Sits before the row's label;
 * sized in `em` so it tracks the row font-size and inherits the row ink via `currentColor`.
 * @returns {HTMLElement} The badge span (leading, decorative).
 */
export function expandBadge() {
  const badge = document.createElement("span");
  badge.textContent = "+";
  badge.setAttribute("aria-hidden", "true");
  badge.setAttribute("style", "display:inline-flex;align-items:center;justify-content:center;"
    + "margin-right:0.35rem;width:1.05em;height:1.05em;border-radius:50%;"
    + "border:1px solid currentColor;font-size:0.72em;font-weight:bold;"
    + "line-height:1;vertical-align:middle;opacity:0.85;");
  return badge;
}

/**
 * A small colored identity swatch.
 * @param {string} color
 * @param {number} [size] Pixel size (default 12).
 * @returns {HTMLElement}
 */
export function swatch(color, size) {
  const side = ((size || 12) / 18).toFixed(3) + "rem";
  return box(
    "flex:0 0 auto;width:" + side + ";height:" + side + ";border-radius:0.167rem;" +
      "background:" + color + ";box-shadow:0 0 0 1px rgba(0,0,0,0.35)"
  );
}

/**
 * @param {string} text
 * @returns {HTMLElement} A section title in ink.
 */
export function sectionTitle(text) {
  return box(
    "padding:0.667rem 0.444rem 0.222rem;color:" + INK +
      ";font-size:var(--dg-fs-105);letter-spacing:0.04em;font-weight:700",
    text,
    "font-title"
  );
}

/**
 * Append a centered empty-state.
 * @param {HTMLElement} host
 * @param {string} text
 */
export function emptyState(host, text) {
  host.appendChild(
    box(
      "display:flex;align-items:center;justify-content:center;height:100%;min-height:8rem;" +
        "color:" + INK_MUTED + ";font-size:var(--dg-fs-105);text-align:center;padding:2rem",
      text,
      "font-body"
    )
  );
}

/**
 * A horizontal bar row: right-aligned label (ink), a recessive track
 * with a thin rounded-end fill (identity color), and a muted value. A hover
 * tooltip carries the full label+value.
 * @param {{label:string, value:number, max:number, color:string, right:string,
 *   labelWidth?:string}} opts
 * @returns {HTMLElement}
 */
export function barRow(opts) {
  const fillPercent = Math.max(0, Math.min(100, Math.round((opts.value / (opts.max || 1)) * 100)));
  const line = box("display:flex;align-items:center;gap:0.556rem;min-height:1.222rem");
  line.setAttribute("data-tooltip-content", opts.label + " — " + opts.right);
  line.appendChild(box(
    "flex:0 0 " + (opts.labelWidth || "10rem") + ";color:" + INK + ";font-size:var(--dg-fs-95);text-align:right;" +
      "white-space:nowrap;overflow:hidden;text-overflow:ellipsis", opts.label, "font-body"
  ));
  const track = box("flex:1 1 auto;height:0.778rem;background:" + TRACK + ";border-radius:0.389rem;overflow:hidden");
  track.appendChild(box(
    "height:100%;width:" + fillPercent + "%;background:" + opts.color + ";border-radius:0.389rem;min-width:0.111rem"
  ));
  line.appendChild(track);
  line.appendChild(box(
    "flex:0 0 5.5rem;color:" + INK_MUTED + ";font-size:var(--dg-fs-85);text-align:left", opts.right, "font-body"
  ));
  return line;
}

/**
 * A vertical stack container with padding, for a section's rows.
 * @returns {HTMLElement}
 */
export function stack() {
  return box("display:flex;flex-direction:column;gap:0.278rem;width:100%;padding:0.111rem 0.444rem 0.556rem");
}

/**
 * A civ-identity column header (accent swatch + name in ink + a count badge),
 * no text on a colored background.
 * @param {string} name
 * @param {string} color The readable civ color.
 * @param {number} count
 * @returns {HTMLElement}
 */
export function columnHeader(name, color, count) {
  const head = box(
    "display:flex;align-items:center;gap:0.444rem;padding:0.5rem 0.611rem;border-bottom:1px solid " + BORDER +
      ";border-left:0.222rem solid " + color + ";background:" + PANEL
  );
  head.appendChild(box("color:" + INK + ";font-weight:700;font-size:var(--dg-fs-95);flex:1 1 auto;" +
    "white-space:nowrap;overflow:hidden;text-overflow:ellipsis", name, "font-title"));
  head.appendChild(box(
    "flex:0 0 auto;color:" + INK_DIM + ";font-size:var(--dg-fs-85);background:rgba(0,0,0,0.25);" +
      "border-radius:0.5rem;padding:0.056rem 0.444rem", String(count)
  ));
  return head;
}

/**
 * A board column: an identity header + a list of item rows (all ink text). An item
 * may be a plain string (one ink line) or a `{title, sub}` object, which renders the
 * title in ink over a muted-ink sub-line (used for a pantheon name + its effect).
 * @param {string} name
 * @param {string} color The readable identity color.
 * @param {number} count
 * @param {(string | {title:string, sub?:string})[]} items
 * @returns {HTMLElement}
 */
export function boardColumn(name, color, count, items) {
  const col = box(
    "flex:0 0 auto;min-width:12rem;max-width:19rem;display:flex;flex-direction:column;" +
      "border:1px solid " + BORDER + ";border-radius:0.333rem;overflow:hidden;background:" + PANEL
  );
  col.appendChild(columnHeader(name, color, count));
  for (const item of items) col.appendChild(boardColumnItem(item));
  return col;
}

/**
 * One board-column row: a plain string, or a `{title, sub}` pair (title in ink over a
 * muted sub-line).
 * @param {string | {title:string, sub?:string}} item
 * @returns {HTMLElement}
 */
function boardColumnItem(item) {
  const base = "padding:0.333rem 0.667rem;border-bottom:1px solid rgba(0,0,0,0.18)";
  if (typeof item === "string") {
    return box(base + ";color:" + INK + ";font-size:var(--dg-fs-85)", item, "font-body");
  }
  const cell = box(base);
  cell.appendChild(box("color:" + INK + ";font-size:var(--dg-fs-85);font-weight:600", item.title, "font-body"));
  if (item.sub) {
    cell.appendChild(box(
      "color:" + INK_MUTED + ";font-size:var(--dg-fs-78);line-height:1.3;margin-top:0.111rem", item.sub, "font-body"
    ));
  }
  return cell;
}

/**
 * A container for board columns. By default a single horizontal scrolling row;
 * pass `wrap` to reflow the columns into multiple rows so they all fit on screen
 * (the container then scrolls vertically instead of horizontally).
 * @param {HTMLElement} host
 * @param {boolean} [wrap] When true, columns wrap onto multiple rows.
 * @returns {HTMLElement}
 */
export function columnsRow(host, wrap) {
  const flow = wrap
    ? "flex-wrap:wrap;align-content:flex-start;overflow-y:auto;overflow-x:hidden"
    : "overflow:auto";
  const row = box("display:flex;gap:0.778rem 0.778rem;align-items:flex-start;height:100%;padding:0.444rem;" + flow);
  host.appendChild(row);
  return row;
}

/** SVG namespace. */
export { SVG_NS, svgEl };

/**
 * An SVG text label in a text ink token.
 * @param {number} x
 * @param {number} y
 * @param {string} text
 * @param {{anchor?:string, fill?:string, size?:number}} [opts]
 * @returns {SVGElement}
 */
export function svgText(x, y, text, opts) {
  const label = svgEl("text", {
    x,
    y,
    fill: (opts && opts.fill) || INK_MUTED,
    "font-size": (opts && opts.size) || 14,
    "text-anchor": (opts && opts.anchor) || "start"
  });
  label.textContent = text;
  return label;
}

/**
 * A full-size scaling SVG root appended to `host`.
 * @param {HTMLElement} host
 * @param {number} w ViewBox width.
 * @param {number} h ViewBox height.
 * @returns {SVGElement}
 */
export function svgRoot(host, w, h) {
  const svg = svgEl("svg", { viewBox: "0 0 " + w + " " + h, width: "100%", height: "100%" });
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  host.appendChild(svg);
  return svg;
}

/**
 * A legend row (swatch + label per entry), text in ink.
 * @param {{name:string, color:string}[]} entries
 * @returns {HTMLElement}
 */
export function legend(entries) {
  const wrap = box("display:flex;flex-wrap:wrap;gap:0.667rem 1rem;padding:0.556rem 0.444rem");
  for (const entry of entries) {
    const item = box("display:flex;align-items:center;gap:0.389rem");
    item.appendChild(swatch(entry.color, 11));
    item.appendChild(box("color:" + INK + ";font-size:var(--dg-fs-85)", entry.name, "font-body"));
    wrap.appendChild(item);
  }
  return wrap;
}

/**
 * @param {*} owner A settlement board owner.
 * @returns {string} A stable civ key.
 */
export function ownerKey(owner) {
  if (!owner) return "?";
  return owner.leaderType || ("pid:" + owner.pid);
}

/**
 * @param {*} owner A settlement board owner.
 * @returns {string} The civ label (honors the Civ/Leader order).
 */
export function ownerLabel(owner) {
  if (!owner) return "—";
  if (owner.leaderName) return inlineLabel(owner.leaderName, owner.civName);
  return owner.civName || t("LOC_DEMOGRAPHICS_BOARD_PLAYER_GENERIC");
}

/**
 * @param {*} owner A settlement board owner.
 * @returns {string} A readable civ color.
 */
export function ownerColor(owner) {
  return readable((owner && (owner.readable || owner.primary)) || FALLBACK_COLOR);
}
