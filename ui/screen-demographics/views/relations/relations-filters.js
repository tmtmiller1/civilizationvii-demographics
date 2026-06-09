// relations-filters.js
//
// Filter-pill DOM for the Global Relations view: the toggleable pill row, the
// per-pill swatch (which synthesizes dash patterns as solid sub-segments since
// Coherent's SVG renderer rejects `stroke-dasharray`), and the "All On / All
// Off" header. Split out of view-relations.js.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { getAttitudeColors } from "/demographics/ui/core/demographics-palette.js";
import {
  AGREEMENT_TYPES,
  CS_AGREEMENT_TYPES,
  diplomacyActionLabel,
  dlog,
  getRingPxPerUnit,
  LINE_DASH
} from "/demographics/ui/screen-demographics/views/relations/relations-shared.js";
import {
  appendSampleEdge
} from "/demographics/ui/screen-demographics/views/relations/relations-ring-svg-edges.js";
import { safePlaySound } from "/demographics/ui/core/demographics-audio.js";

/**
 * Per-topTab visual overrides for relation filters.
 * @type {Record<string, { color: string, dash: string|undefined }>}
 */
const CS_FILTER_OVERRIDES = {
  // CS-specific: suzerainty solid bright gold; CS trade gold (directed → solid +
  // chevrons, so the token is moot). Friendly/unfriendly inherit the shared
  // attitude palette (no override needed). `dash` values are style tokens.
  suzerain: { color: "#f0cf3c", dash: "" },
  trade: { color: "#f0c33c", dash: "dotted" }
};

/** @type {Record<string, string>} - vivid, to match the brightened yield palette. */
const FILTER_PILL_COLORS = {
  openborders: "#46c8d4", // bright cyan (passage)
  denounced: "#ef6a45", // bright coral (hostile act; dashed, vs solid war)
  trade: "#f0c33c", // trade routes = gold (vivid yield gold)
  suzerain: "#f0cf3c" // bright amber-gold
};
// Each individual agreement type contributes its own pill/line color so the
// legend swatch and the ring line match (applyCivEdgeOverrides reads this).
for (const _a of AGREEMENT_TYPES) FILTER_PILL_COLORS[_a.key] = _a.color;
// City-State agreement types (befriend / suzerain directives) likewise — their CS
// ring edges keep their builder color, so the pill swatch must use the same hue.
for (const _c of CS_AGREEMENT_TYPES) FILTER_PILL_COLORS[_c.key] = _c.color;

/**
 * Filter sub-tabs in display order.
 *   Politics & Relationship - diplomatic states/actions + how civs feel
 *                             (war, alliances, borders, the attitude scale).
 *   Agreements              - cooperative deals (research, trade, other endeavors).
 * @type {{ key: string, label: string }[]}
 */
export const FILTER_GROUPS = [
  { key: "politics", label: "LOC_DEMOGRAPHICS_RELATIONS_GROUP_POLITICS" },
  { key: "agreements", label: "LOC_DEMOGRAPHICS_RELATIONS_GROUP_AGREEMENTS" }
];

/**
 * Resolve the civ-tab filter definitions.
 * @returns {FilterDef[]} Ordered filter definitions.
 */
function civFilters() {
  return [
    { key: "war", label: t("LOC_DEMOGRAPHICS_RELATIONS_AT_WAR"), kind: "attitude", group: "politics" },
    { key: "alliance", label: t("LOC_DEMOGRAPHICS_RELATIONS_ALLIANCE"), kind: "attitude", group: "politics" },
    { key: "openborders", label: t("LOC_DEMOGRAPHICS_RELATIONS_OPEN_BORDERS"), kind: "political", group: "politics" },
    { key: "denounced", label: t("LOC_DEMOGRAPHICS_RELATIONS_DENOUNCED"), kind: "political", group: "politics", directed: true },
    { key: "helpful", label: t("LOC_DEMOGRAPHICS_RELATIONS_HELPFUL"), kind: "attitude", group: "politics" },
    { key: "friendly", label: t("LOC_DEMOGRAPHICS_RELATIONS_FRIENDLY"), kind: "attitude", group: "politics" },
    { key: "unfriendly", label: t("LOC_DEMOGRAPHICS_RELATIONS_UNFRIENDLY"), kind: "attitude", group: "politics" },
    { key: "hostile", label: t("LOC_DEMOGRAPHICS_RELATIONS_HOSTILE"), kind: "attitude", group: "politics" },
    // One filter per individual cooperative agreement type, each its own line.
    ...AGREEMENT_TYPES.map((a) => ({
      key: a.key,
      label: diplomacyActionLabel(a.action),
      kind: "agreement",
      group: "agreements"
    })),
    { key: "trade", label: t("LOC_DEMOGRAPHICS_RELATIONS_TRADE_ROUTES"), kind: "economic", group: "agreements", directed: true }
  ];
}

/**
 * Resolve the city-state-tab filter definitions.
 * @returns {FilterDef[]} Ordered filter definitions.
 */
function cityStateFilters() {
  return [
    { key: "suzerain", label: t("LOC_DEMOGRAPHICS_RELATIONS_SUZERAINTY"), kind: "political", group: "politics" },
    { key: "war", label: t("LOC_DEMOGRAPHICS_RELATIONS_AT_WAR"), kind: "attitude", group: "politics" },
    { key: "alliance", label: t("LOC_DEMOGRAPHICS_RELATIONS_ALLIANCE"), kind: "attitude", group: "politics" },
    { key: "helpful", label: t("LOC_DEMOGRAPHICS_RELATIONS_HELPFUL"), kind: "attitude", group: "politics" },
    { key: "friendly", label: t("LOC_DEMOGRAPHICS_RELATIONS_FRIENDLY"), kind: "attitude", group: "politics" },
    { key: "unfriendly", label: t("LOC_DEMOGRAPHICS_RELATIONS_UNFRIENDLY"), kind: "attitude", group: "politics" },
    { key: "hostile", label: t("LOC_DEMOGRAPHICS_RELATIONS_HOSTILE"), kind: "attitude", group: "politics" },
    // City-State cooperative agreements: befriending + suzerain benefit directives,
    // each its own line (mirrors the major-civ Agreements list).
    ...CS_AGREEMENT_TYPES.map((a) => ({
      key: a.key,
      label: diplomacyActionLabel(a.action),
      kind: "agreement",
      group: "agreements",
      directed: true
    })),
    { key: "trade", label: t("LOC_DEMOGRAPHICS_RELATIONS_TRADE_ROUTES"), kind: "economic", group: "agreements", directed: true }
  ];
}

/**
 * Resolve filter definitions for one top tab.
 * @param {string} topTab Either "civ" or "cs".
 * @returns {FilterDef[]} Ordered filter definitions.
 */
export function filtersForView(topTab) {
  return topTab === "civ" ? civFilters() : cityStateFilters();
}

/**
 * Resolve visual overrides for one filter key in one top tab.
 * @param {string} key Filter key.
 * @param {string} topTab Either "civ" or "cs".
 * @returns {{ color?: string, dash?: string }|null} Override descriptor.
 */
export function filterVisuals(key, topTab) {
  if (topTab === "cs" && CS_FILTER_OVERRIDES[key]) {
    return CS_FILTER_OVERRIDES[key];
  }
  return null;
}

/**
 * Resolve the swatch color for a filter key in a top tab.
 * @param {string} key Filter key.
 * @param {string} topTab Either "civ" or "cs".
 * @returns {string} Filter swatch color.
 */
export function pillColorFor(key, topTab) {
  const ov = filterVisuals(key, topTab);
  if (ov && ov.color) return ov.color;
  const attitudeColors = getAttitudeColors();
  if (attitudeColors[key]) return attitudeColors[key];
  return FILTER_PILL_COLORS[key] || "#bfbfbf";
}

/**
 * One filter-pill descriptor. `kind` groups attitude / political / economic
 * filters; visual fields are resolved per-tab before rendering.
 * @typedef {Object} FilterDef
 * @property {string} key Filter key (matches an {@link Edge}'s `filterKey`).
 * @property {string} [label] Display label.
 * @property {string} [kind] Grouping kind ("attitude"/"political"/"economic").
 * @property {string} [group] Section group key ("politics"/"reputation"/"agreements").
 * @property {boolean} [directed] Edges are directional (legend shows a chevron).
 * @property {string} [color] Swatch color.
 * @property {string|null} [_dashOverride] Per-tab dash-pattern override.
 */


/**
 * Append a "·" separator span to a control row.
 * @param {HTMLElement} row The row element.
 */
function appendCtrlSep(row) {
  const sep = document.createElement("span");
  sep.textContent = "·";
  sep.className = "demographics-relations-filter-sep";
  row.appendChild(sep);
}

/**
 * Build the "All · None" header row: All/None flip every (visible-group) filter
 * on/off, each firing a single outer repaint.
 * @param {(turnOn: boolean) => void} onToggleAll Bulk-toggle callback.
 * @returns {HTMLElement} The control row element.
 */
function buildAllToggleRow(onToggleAll) {
  const ctrlRow = document.createElement("div");
  ctrlRow.className = "demographics-relations-filter-ctrl-row";
  ctrlRow.appendChild(buildAllToggleLink("LOC_DEMOGRAPHICS_RELATIONS_FILTER_ALL", () => onToggleAll(true)));
  appendCtrlSep(ctrlRow);
  ctrlRow.appendChild(buildAllToggleLink("LOC_DEMOGRAPHICS_RELATIONS_FILTER_NONE", () => onToggleAll(false)));
  return ctrlRow;
}

/**
 * Build one clickable all-toggle link span.
 * @param {string} labelLoc Localization key.
 * @param {() => void} onClick Click callback.
 * @returns {HTMLElement} Link span.
 */
function buildAllToggleLink(labelLoc, onClick) {
  const link = document.createElement("span");
  link.textContent = t(labelLoc);
  link.className = "demographics-relations-all-toggle";
  link.addEventListener("click", (ev) => {
    ev?.stopPropagation?.();
    safePlaySound("data-audio-activate", "audio-panel-diplo-ribbon");
    onClick();
  });
  return link;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const SWATCH_PX_W = 116; // on-screen swatch width in px
const SWATCH_VB_H = 4; // swatch viewBox height in (ring) units

/**
 * Build a filter pill's sample-line swatch: a small SVG that draws the filter's
 * actual line (same color, dash synthesis, and direction chevron the ring uses)
 * AT THE RING'S MEASURED px-per-unit, so dash lengths + stroke width match the
 * ring lines exactly. The viewBox width is derived from that scale so a fixed-px
 * swatch shows the line at ring scale (a portion of an edge, same dash size).
 * @param {FilterDef} f The filter descriptor.
 * @returns {SVGElement} The swatch SVG.
 */
function buildFilterSwatch(f) {
  const pxu = getRingPxPerUnit() || 5; // fallback until the ring is first measured
  const vbW = SWATCH_PX_W / pxu;
  const svg = /** @type {SVGElement} */ (document.createElementNS(SVG_NS, "svg"));
  svg.setAttribute("viewBox", "0 0 " + vbW + " " + SWATCH_VB_H);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("class", "demographics-relations-swatch");
  svg.style.width = SWATCH_PX_W + "px";
  svg.style.height = SWATCH_VB_H * pxu + "px";
  const y = SWATCH_VB_H / 2;
  appendSampleEdge(
    svg,
    { color: f.color || "#bfbfbf", dash: resolveSwatchDashPattern(f), directed: f.directed },
    { x: 1, y },
    { x: vbW - 1, y }
  );
  return svg;
}

/**
 * Resolve the dash pattern used for a filter's legend swatch.
 * @param {FilterDef} f The filter descriptor.
 * @returns {string} Dash pattern string, empty for solid lines.
 */
function resolveSwatchDashPattern(f) {
  return f._dashOverride !== undefined ? f._dashOverride || "" : LINE_DASH[f.key] || "";
}

/**
 * Attach the de-bounced click / action-activate / mousedown handlers to a
 * filter pill. Coherent may dispatch BOTH `click` and `action-activate` for
 * one activation; a 50ms window guards against the double-toggle.
 * @param {HTMLElement} pill The pill element.
 * @param {FilterDef} f The filter descriptor.
 * @param {boolean} active The pill's active state at build time.
 * @param {(key: string) => void} onToggle Toggle callback.
 */
function wireFilterPill(pill, f, active, onToggle) {
  let lastFired = 0;
  /**
   * Build a de-bounced event handler for one event name.
   * @param {string} evName The event name (for logging).
   * @returns {(ev: *) => void} The handler.
   */
  const fire = (evName) => (ev) => {
    if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
    const now =
      typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    if (now - lastFired < 50) {
      dlog("filter pill " + evName + " key=" + f.key, "SKIPPED (dedup)");
      return;
    }
    lastFired = now;
    safePlaySound("data-audio-activate", "audio-panel-diplo-ribbon");
    dlog("filter pill " + evName + " key=" + f.key, "wasActive=" + active);
    onToggle(f.key);
  };
  pill.addEventListener("click", fire("click"));
  pill.addEventListener("action-activate", fire("action-activate"));
  pill.addEventListener("mousedown", (_ev) => {
    dlog("filter pill MOUSEDOWN key=" + f.key);
  });
}

/**
 * Build a single filter pill (swatch + label) wired to `onToggle`.
 * @param {FilterDef} f The filter descriptor.
 * @param {Set<string>} activeSet The active filter-key set.
 * @param {(key: string) => void} onToggle Toggle callback.
 * @returns {HTMLElement} The pill element.
 */
function buildFilterPill(f, activeSet, onToggle) {
  const active = activeSet.has(f.key);
  const label = typeof f.label === "string" && f.label.length > 0 ? f.label : "(" + f.key + ")";
  dlog(
    "filter pill build key=" + f.key,
    "label='" + label + "'",
    "color=" + f.color,
    "active=" + active
  );

  // Single-element pill: <div> with textContent. Nested children
  // (pip <span/div> + label <span/div>) were rendering empty in
  // Coherent for reasons we couldn't pin down. Putting the whole
  // label - disc glyph + text - into the pill's textContent matches
  // the pattern that works for worldrankings-allcivs headers and the new chart
  // line labels.
  const pill = document.createElement("div");
  pill.className = "demographics-relations-filter-pill font-body text-sm";
  if (!active) pill.classList.add("is-hidden");
  else pill.classList.add("is-active");
  pill.title = active
    ? t("LOC_DEMOGRAPHICS_RELATIONS_FILTER_HIDE_TOOLTIP", label)
    : t("LOC_DEMOGRAPHICS_RELATIONS_FILTER_SHOW_TOOLTIP", label);

  // ── Mini sample line: an inline element showing exactly what this
  // filter's edges look like on the ring. The "swatch" is a tiny
  // horizontal line drawn in the filter's color, with the SAME dash
  // pattern (rendered as multiple solid sub-segments - Coherent's
  // SVG renderer rejects stroke-dasharray). This is the actual
  // legend mapping color+texture → filter type.
  pill.appendChild(buildFilterSwatch(f));
  const lbl = document.createElement("span");
  lbl.textContent = label;
  pill.appendChild(lbl);

  wireFilterPill(pill, f, active, onToggle);
  return pill;
}

/**
 * Build the toggleable filter-pill row for the ACTIVE sub-group's filters (the
 * Politics / Reputation / Agreements grouping is now a sub-tab selector, so the
 * caller passes only the visible group's filters). The "All On / All Off" header
 * flips just those.
 * @param {FilterDef[]} filters Filter descriptors to render (one group's worth).
 * @param {Set<string>} activeSet The active filter-key set.
 * @param {(key: string) => void} onToggle Per-pill toggle callback.
 * @param {(turnOn: boolean) => void} [onToggleAll] Bulk-toggle callback (this group).
 * @returns {HTMLElement} The pill-row element.
 */
export function makeFilterPillRow(filters, activeSet, onToggle, onToggleAll) {
  const row = document.createElement("div");
  row.className = "demographics-relations-filter-row font-body text-xs";
  if (!filters || filters.length === 0) return row;

  if (typeof onToggleAll === "function") {
    row.appendChild(buildAllToggleRow(onToggleAll));
  }
  for (const f of filters) {
    row.appendChild(buildFilterPill(f, activeSet, onToggle));
  }
  return row;
}
