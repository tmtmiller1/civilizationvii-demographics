// board-ui.js
//
// Shared elegant DOM/SVG primitives for the plain-render "board" charts (Wonders,
// by-type, Religion, Atlas, and the analytics charts). Design rules, from the
// dataviz method:
//   - Identity is carried by a colored SWATCH / accent / bar-fill — never by
//     putting text on a colored background (which is unreadable on dark civ
//     colors). All text wears ink tokens on the dark surface.
//   - Civ colors are raised to a readable lightness for the dark surface via
//     civ-color-utils (safeTextColor ∘ preferReadableColor).
//   - Bars: recessive track, thin fill with a rounded data-end, value in muted
//     ink beside it, a hover tooltip on every mark.

import { preferReadableColor, safeTextColor } from "/demographics/ui/core/civ-color-utils.js";

/** Dark-surface design tokens (match the screen's parchment-on-dark theme). */
export const INK = "#EDE7D6";
export const INK_MUTED = "#B7A987";
export const INK_DIM = "#8C7F63";
export const SURFACE = "#16130E";
export const PANEL = "rgba(255,255,255,0.03)";
export const BORDER = "#4A4034";
export const GRID = "#3A342A";
export const TRACK = "rgba(255,255,255,0.06)";
export const ACCENT = "#C9A94E";

/**
 * A readable civ color (raised to the dark-surface lightness floor) from a
 * sample player's banner colors.
 * @param {*} ps A sample player (primaryColor/secondaryColor), or nullish.
 * @returns {string} A readable CSS color.
 */
export function civColor(ps) {
  const raw = ps && (ps.primaryColor || ps.readable);
  const chosen = ps ? preferReadableColor(ps.primaryColor, ps.secondaryColor) : raw;
  const safe = safeTextColor(chosen || raw);
  return typeof safe === "string" && safe ? safe : "#B0B0B0";
}

/** Raise any color to a readable lightness on the dark surface. @param {string} c @returns {string} */
export function readable(c) {
  const s = safeTextColor(c);
  return typeof s === "string" && s ? s : "#B0B0B0";
}

/**
 * A styled div (optional class + text). The shared building block.
 * @param {string} style Inline style.
 * @param {string} [text] Text content.
 * @param {string} [cls] Class name.
 * @returns {HTMLElement} The div.
 */
export function box(style, text, cls) {
  const d = document.createElement("div");
  d.setAttribute("style", style);
  if (cls) d.className = cls;
  if (text) d.textContent = text;
  return d;
}

/**
 * A small circled "+" badge that flags a row as click-to-expand (drill-down), so
 * the extra detail reads as discoverable before it's clicked. Sits before the
 * row's label; sized in `em` so it tracks the row font-size and inherits the row
 * ink via `currentColor`.
 * @returns {HTMLElement} The badge span (leading, decorative).
 */
export function expandBadge() {
  const s = document.createElement("span");
  s.textContent = "+";
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("style", "display:inline-flex;align-items:center;justify-content:center;"
    + "margin-right:0.35rem;width:1.05em;height:1.05em;border-radius:50%;"
    + "border:0.0555rem solid currentColor;font-size:0.72em;font-weight:bold;"
    + "line-height:1;vertical-align:middle;opacity:0.85;");
  return s;
}

/**
 * A small colored identity swatch.
 * @param {string} color The swatch color.
 * @param {number} [size] Pixel size (default 12).
 * @returns {HTMLElement} The swatch.
 */
export function swatch(color, size) {
  const s = size || 12;
  return box(
    "flex:0 0 auto;width:" + s + "px;height:" + s + "px;border-radius:3px;" +
      "background:" + color + ";box-shadow:0 0 0 1px rgba(0,0,0,0.35)"
  );
}

/** @param {string} text @returns {HTMLElement} A section title in ink. */
export function sectionTitle(text) {
  return box(
    "padding:12px 8px 4px;color:" + INK + ";font-size:1.05rem;letter-spacing:0.04em;font-weight:700",
    text,
    "font-title"
  );
}

/** @param {HTMLElement} host @param {string} text Append a centered empty-state. */
export function emptyState(host, text) {
  host.appendChild(
    box(
      "display:flex;align-items:center;justify-content:center;height:100%;min-height:8rem;" +
        "color:" + INK_MUTED + ";font-size:1.1rem;text-align:center;padding:2rem",
      text,
      "font-body"
    )
  );
}

/**
 * An elegant horizontal bar row: right-aligned label (ink), a recessive track
 * with a thin rounded-end fill (identity color), and a muted value. A hover
 * tooltip carries the full label+value.
 * @param {{label:string, value:number, max:number, color:string, right:string,
 *   labelWidth?:string}} o Row options.
 * @returns {HTMLElement} The row.
 */
export function barRow(o) {
  const pct = Math.max(0, Math.min(100, Math.round((o.value / (o.max || 1)) * 100)));
  const line = box("display:flex;align-items:center;gap:10px;min-height:22px");
  line.setAttribute("data-tooltip-content", o.label + " — " + o.right);
  line.appendChild(box(
    "flex:0 0 " + (o.labelWidth || "10rem") + ";color:" + INK + ";font-size:0.92rem;text-align:right;" +
      "white-space:nowrap;overflow:hidden;text-overflow:ellipsis", o.label, "font-body"
  ));
  const track = box("flex:1 1 auto;height:14px;background:" + TRACK + ";border-radius:7px;overflow:hidden");
  track.appendChild(box(
    "height:100%;width:" + pct + "%;background:" + o.color + ";border-radius:7px;min-width:2px"
  ));
  line.appendChild(track);
  line.appendChild(box(
    "flex:0 0 5.5rem;color:" + INK_MUTED + ";font-size:0.88rem;text-align:left", o.right, "font-body"
  ));
  return line;
}

/**
 * A vertical stack container with padding, for a section's rows.
 * @returns {HTMLElement} The stack.
 */
export function stack() {
  return box("display:flex;flex-direction:column;gap:5px;width:100%;padding:2px 8px 10px");
}

/**
 * A civ-identity column header (accent swatch + name in ink + a count badge) —
 * NO text on a colored background.
 * @param {string} name The civ label.
 * @param {string} color The readable civ color.
 * @param {number} count The item count badge.
 * @returns {HTMLElement} The header.
 */
export function columnHeader(name, color, count) {
  const head = box(
    "display:flex;align-items:center;gap:8px;padding:9px 11px;border-bottom:1px solid " + BORDER +
      ";border-left:4px solid " + color + ";background:" + PANEL
  );
  head.appendChild(box("color:" + INK + ";font-weight:700;font-size:0.95rem;flex:1 1 auto;" +
    "white-space:nowrap;overflow:hidden;text-overflow:ellipsis", name, "font-title"));
  head.appendChild(box(
    "flex:0 0 auto;color:" + INK_DIM + ";font-size:0.85rem;background:rgba(0,0,0,0.25);" +
      "border-radius:9px;padding:1px 8px", String(count)
  ));
  return head;
}

/**
 * A board column: an identity header + a list of item rows (all ink text). An item
 * may be a plain string (one ink line) or a `{title, sub}` object, which renders the
 * title in ink over a muted-ink sub-line (used for a pantheon name + its effect).
 * @param {string} name The header label.
 * @param {string} color The readable identity color.
 * @param {number} count The count badge.
 * @param {(string | {title:string, sub?:string})[]} items The item labels/entries.
 * @returns {HTMLElement} The column.
 */
export function boardColumn(name, color, count, items) {
  const col = box(
    "flex:0 0 auto;min-width:12rem;max-width:19rem;display:flex;flex-direction:column;" +
      "border:1px solid " + BORDER + ";border-radius:6px;overflow:hidden;background:" + PANEL
  );
  col.appendChild(columnHeader(name, color, count));
  for (const it of items) col.appendChild(boardColumnItem(it));
  return col;
}

/**
 * One board-column row: a plain string, or a `{title, sub}` pair (title in ink over a
 * muted sub-line).
 * @param {string | {title:string, sub?:string}} it The item.
 * @returns {HTMLElement} The row.
 */
function boardColumnItem(it) {
  const base = "padding:6px 12px;border-bottom:1px solid rgba(0,0,0,0.18)";
  if (typeof it === "string") {
    return box(base + ";color:" + INK + ";font-size:0.9rem", it, "font-body");
  }
  const cell = box(base);
  cell.appendChild(box("color:" + INK + ";font-size:0.9rem;font-weight:600", it.title, "font-body"));
  if (it.sub) {
    cell.appendChild(box(
      "color:" + INK_MUTED + ";font-size:0.8rem;line-height:1.3;margin-top:2px", it.sub, "font-body"
    ));
  }
  return cell;
}

/**
 * A container for board columns. By default a single horizontal scrolling row;
 * pass `wrap` to reflow the columns into multiple rows so they all fit on screen
 * (the container then scrolls vertically instead of horizontally).
 * @param {HTMLElement} host The board host.
 * @param {boolean} [wrap] When true, columns wrap onto multiple rows.
 * @returns {HTMLElement} The columns container.
 */
export function columnsRow(host, wrap) {
  const flow = wrap
    ? "flex-wrap:wrap;align-content:flex-start;overflow-y:auto;overflow-x:hidden"
    : "overflow:auto";
  const row = box("display:flex;gap:14px;align-items:flex-start;height:100%;padding:8px;" + flow);
  host.appendChild(row);
  return row;
}

/** SVG namespace. */
export const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Create an SVG element with attributes.
 * @param {string} name The tag name.
 * @param {Record<string, string|number>} attrs Attributes.
 * @returns {SVGElement} The element.
 */
export function svgEl(name, attrs) {
  const el = document.createElementNS(SVG_NS, name);
  for (const k in attrs) el.setAttribute(k, String(attrs[k]));
  return el;
}

/**
 * An SVG text label in a text ink token.
 * @param {number} x X. @param {number} y Y. @param {string} text The text.
 * @param {{anchor?:string, fill?:string, size?:number}} [o] Options.
 * @returns {SVGElement} The text element.
 */
export function svgText(x, y, text, o) {
  const t = svgEl("text", {
    x, y, fill: (o && o.fill) || INK_MUTED, "font-size": (o && o.size) || 14,
    "text-anchor": (o && o.anchor) || "start"
  });
  t.textContent = text;
  return t;
}

/**
 * A full-size scaling SVG root appended to `host`.
 * @param {HTMLElement} host The host. @param {number} w ViewBox width. @param {number} h ViewBox height.
 * @returns {SVGElement} The svg.
 */
export function svgRoot(host, w, h) {
  const svg = svgEl("svg", { viewBox: "0 0 " + w + " " + h, width: "100%", height: "100%" });
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  host.appendChild(svg);
  return svg;
}

/**
 * A legend row (swatch + label per entry), text in ink.
 * @param {{name:string, color:string}[]} entries The legend entries.
 * @returns {HTMLElement} The legend.
 */
export function legend(entries) {
  const wrap = box("display:flex;flex-wrap:wrap;gap:12px 18px;padding:10px 8px");
  for (const e of entries) {
    const item = box("display:flex;align-items:center;gap:7px");
    item.appendChild(swatch(e.color, 11));
    item.appendChild(box("color:" + INK + ";font-size:0.9rem", e.name, "font-body"));
    wrap.appendChild(item);
  }
  return wrap;
}
