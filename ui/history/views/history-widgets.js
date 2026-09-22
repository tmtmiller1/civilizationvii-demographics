// history-widgets.js
//
// Shared building blocks for every view: the native fxs-tab-bar, pill rows, copper-ruled section
// cards, stat tiles, flexbox tables (GameFace has no CSS grid), civilization chips, leader
// portraits and empty states. Styling lives in styles/screen-demographics-history.css under the .dgh- prefix.

import { el, onActivate } from "/demographics/ui/history/core/history-dom.js";
import { t } from "/demographics/ui/history/core/history-text.js";

/**
 * A native tab bar.
 * @param {{id:string, label:string}[]} items Tabs (labels are LOC tags).
 * @param {string} selected Selected tab id.
 * @param {(id:string) => void} onSelect Called with the chosen id.
 * @param {string} [cls] Extra class.
 * @returns {HTMLElement} The fxs-tab-bar.
 */
export function tabBar(items, selected, onSelect, cls = "") {
  const bar = el("fxs-tab-bar", { cls: "dgh-tabs w-full font-title text-sm " + cls });
  bar.setAttribute("tab-item-class", "font-title text-base");
  bar.setAttribute("data-audio-group-ref", "audio-screen-unlocks");
  bar.setAttribute("tab-items", JSON.stringify(items));
  bar.setAttribute("selected-tab-index", String(Math.max(0, items.findIndex((i) => i.id === selected))));
  bar.addEventListener("tab-selected", (/** @type {any} */ ev) => {
    const id = ev?.detail?.selectedItem?.id;
    if (id && id !== selected) onSelect(id);
  });
  return bar;
}

/**
 * A row of toggle pills.
 * @param {{key:string, label:string}[]} items Choices (labels already localized).
 * @param {string} active Active key.
 * @param {(key:string) => void} onPick Called with a different key.
 * @param {string} [variant] "filter" for the flat boxed style.
 * @returns {HTMLElement} The row.
 */
export function pillRow(items, active, onPick, variant = "") {
  const row = el("div", { cls: "dgh-pill-row" + (variant ? " dgh-pill-row--" + variant : "") });
  for (const it of items) {
    const pill = el("div", { cls: "dgh-pill" + (it.key === active ? " is-active" : ""), text: it.label });
    onActivate(pill, () => { if (it.key !== active) onPick(it.key); });
    row.appendChild(pill);
  }
  return row;
}

/**
 * A copper-ruled section card.
 * @param {string} title Localized title ("" for none).
 * @param {Array<HTMLElement|null|false>} body Children.
 * @param {string} [cls] Extra class.
 * @returns {HTMLElement} The card.
 */
export function section(title, body, cls = "") {
  return el("div", { cls: "dgh-section " + cls }, [title ? el("div", { cls: "dgh-section-title", text: title }) : null, ...body]);
}

/**
 * A page's heading: its name, and one line saying what is on it. Every Hall of Fame page carries
 * one, so a page opened on its own (from the main menu) says what it is.
 * @param {string} title Localized title.
 * @param {string} [note] Localized one-line description.
 * @returns {HTMLElement} Heading.
 */
export function pageHead(title, note = "") {
  return el("div", { cls: "dgh-page-head" }, [
    el("div", { cls: "dgh-page-title", text: title }),
    note ? el("div", { cls: "dgh-page-note", text: note }) : null
  ]);
}

/**
 * A big-number tile.
 * @param {string} value Formatted value.
 * @param {string} label Localized label.
 * @returns {HTMLElement} The tile.
 */
export function statTile(value, label) {
  return el("div", { cls: "dgh-stat" }, [el("div", { cls: "dgh-stat-value", text: value }), el("div", { cls: "dgh-stat-label", text: label })]);
}

/**
 * @typedef {Object} Column
 * @property {string} label Localized header.
 * @property {string} [cls] Width/alignment class (dgh-col-grow, dgh-col-num, dgh-col-sm...).
 */

/**
 * A flexbox table.
 * @param {Column[]} columns Columns.
 * @param {Array<Array<string|HTMLElement>>} rows Cells (text or elements).
 * @param {{onRow?: (i:number) => void, highlight?: (i:number) => boolean}} [opts] Row behavior.
 * @returns {HTMLElement} The table.
 */
export function table(columns, rows, opts = {}) {
  const head = el("div", { cls: "dgh-tr dgh-thead" }, columns.map((c) => el("div", { cls: "dgh-td " + (c.cls || ""), text: c.label })));
  const body = rows.map((cells, i) => {
    const tr = el("div", { cls: "dgh-tr" + (opts.onRow ? " is-clickable" : "") + (opts.highlight?.(i) ? " is-mine" : "") });
    cells.forEach((cell, j) => tr.appendChild(cellEl(cell, columns[j]?.cls || "")));
    if (opts.onRow) onActivate(tr, () => opts.onRow?.(i));
    return tr;
  });
  return el("div", { cls: "dgh-table" }, [head, ...body]);
}

/**
 * One table cell.
 * @param {string|HTMLElement} cell Content.
 * @param {string} cls Column class.
 * @returns {HTMLElement} The cell.
 */
function cellEl(cell, cls) {
  if (typeof cell === "string") return el("div", { cls: "dgh-td " + cls, text: cell });
  return el("div", { cls: "dgh-td " + cls }, [cell]);
}

/**
 * A civilization (or leader) name with its color swatch, and the civilization's emblem when its
 * type is given.
 * @param {string} name Localized name.
 * @param {string} color CSS color.
 * @param {string} [civType] e.g. "CIVILIZATION_ROME".
 * @returns {HTMLElement} The chip.
 */
export function civChip(name, color, civType = "") {
  return el("div", { cls: "dgh-civ" }, [
    el("div", { cls: "dgh-civ-dot", style: { backgroundColor: color || "#85878c" } }),
    civType ? civIcon(civType) : null,
    el("div", { cls: "dgh-civ-name", text: name })
  ]);
}

/**
 * The civilizations a leader led, in order, each with its emblem: "[emblem] Rome → [emblem] Normans".
 * @param {HnrCivSpan[]} civs Spans, oldest first.
 * @param {(span: HnrCivSpan) => string} nameOf Localized name of a span.
 * @param {string} [cls] Extra class (size variant).
 * @returns {HTMLElement} The progression.
 */
export function civProgression(civs, nameOf, cls = "") {
  const row = el("div", { cls: "dgh-progression " + cls });
  civs.forEach((c, i) => {
    if (i > 0) row.appendChild(el("div", { cls: "dgh-progression-arrow", text: "→" }));
    row.appendChild(el("div", { cls: "dgh-progression-step" }, [
      civIcon(c.civ, "dgh-civ-icon dgh-progression-icon"),
      el("div", { cls: "dgh-progression-name", text: nameOf(c) })
    ]));
  });
  return row;
}

/**
 * An engine-drawn icon.
 * @param {string} id Icon id (a leader, civilization or victory class type).
 * @param {string} cls Classes.
 * @param {string} [context] Icon context (e.g. "LEADER").
 * @returns {HTMLElement} The icon.
 */
function engineIcon(id, cls, context = "") {
  const icon = el("fxs-icon", { cls });
  icon.setAttribute("data-icon-id", id);
  if (context) icon.setAttribute("data-icon-context", context);
  return icon;
}

/**
 * A civilization's emblem.
 * @param {string} civType e.g. "CIVILIZATION_ROME".
 * @param {string} [cls] Size class.
 * @returns {HTMLElement} The icon.
 */
export function civIcon(civType, cls = "dgh-civ-icon") {
  return engineIcon(civType, cls);
}

/**
 * Laurel images of the four legacy victory classes (the DEFAULT icons in base-standard's
 * victory-icons.xml). Referenced by file because that icon set is loaded in game only, and the
 * Hall of Fame also shows at the main menu.
 */
const VICTORY_ICON_FILES = /** @type {Record<string, string>} */ ({
  VICTORY_CLASS_SCIENCE: "fs://game/leg_pro_sci_laurel_glow.png",
  VICTORY_CLASS_CULTURE: "fs://game/leg_pro_cul_laurel_glow.png",
  VICTORY_CLASS_MILITARY: "fs://game/leg_pro_mil_laurel_glow.png",
  VICTORY_CLASS_ECONOMIC: "fs://game/leg_pro_eco_laurel_glow.png"
});

/**
 * The icon of a victory class, or a gold victory mark for classes without one (Domination, Score).
 * @param {string} victoryClass e.g. "VICTORY_CLASS_SCIENCE".
 * @param {string} [cls] Size class.
 * @returns {HTMLElement} The icon.
 */
export function victoryIcon(victoryClass, cls = "dgh-victory-icon") {
  const file = VICTORY_ICON_FILES[victoryClass];
  if (!file) return el("div", { cls: "dgh-mark dgh-mark--win" });
  return el("div", { cls, style: { backgroundImage: "url('" + file + "')" } });
}

/**
 * A small marker for a game's result: the victory's icon, a red disc for a defeat, a hollow ring
 * for a game in progress, a grey disc for a game that ended without a recorded winner.
 * @param {HnrOutcome} outcome The outcome.
 * @returns {HTMLElement} The marker.
 */
export function outcomeMark(outcome) {
  if (outcome.status === "victory") return victoryIcon(outcome.cls || "", "dgh-victory-icon dgh-mark");
  const kind = outcome.status === "in_progress" ? "open" : outcome.status === "defeat" ? "loss" : "ended";
  return el("div", { cls: "dgh-mark dgh-mark--" + kind });
}

/**
 * A leader portrait drawn by the engine's icon component.
 * @param {string} leaderType e.g. "LEADER_AUGUSTUS".
 * @param {string} [cls] Size class.
 * @returns {HTMLElement} The icon.
 */
export function leaderIcon(leaderType, cls = "dgh-leader-icon") {
  return engineIcon(leaderType || "LEADER_UNKNOWN", cls, "LEADER");
}

/**
 * A centered message for views with nothing to show.
 * @param {string} text Localized message.
 * @returns {HTMLElement} The element.
 */
export function emptyState(text) {
  return el("div", { cls: "dgh-empty", text });
}

/**
 * A text button styled like the engine's small buttons.
 * @param {string} label LOC tag or text.
 * @param {() => void} fn Handler.
 * @param {string} [cls] Extra class.
 * @returns {HTMLElement} The button.
 */
export function textButton(label, fn, cls = "") {
  const b = el("div", { cls: "dgh-button " + cls, text: t(label) });
  onActivate(b, fn);
  return b;
}
