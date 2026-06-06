// relations-filters.js
//
// Filter-pill DOM for the Global Relations view: the toggleable pill row, the
// per-pill swatch (which synthesizes dash patterns as solid sub-segments since
// Coherent's SVG renderer rejects `stroke-dasharray`), and the "All On / All
// Off" header. Split out of view-relations.js.

import { t } from "/demographics/ui/demographics-i18n.js";
import { dlog, LINE_DASH } from "/demographics/ui/screen-demographics/views/relations-shared.js";
import { safePlaySound } from "/demographics/ui/demographics-audio.js";

/**
 * One filter-pill descriptor. `kind` groups attitude / political / economic
 * filters; visual fields are resolved per-tab before rendering.
 * @typedef {Object} FilterDef
 * @property {string} key Filter key (matches an {@link Edge}'s `filterKey`).
 * @property {string} [label] Display label.
 * @property {string} [kind] Grouping kind ("attitude"/"political"/"economic").
 * @property {string} [color] Swatch color.
 * @property {string|null} [_dashOverride] Per-tab dash-pattern override.
 */

/**
 * Wire hover-color in/out behavior on an "All On"/"All Off" link span.
 * @param {HTMLElement} el The link span.
 */
function wireAllToggleHover(el) {
  el.addEventListener("mouseenter", () => (el.style.color = "var(--ia-accent-gold,#f3c34c)"));
  el.addEventListener("mouseleave", () => (el.style.color = "var(--ia-text-secondary,#e5d2ac)"));
}

/**
 * Build the "All On · All Off" header row that flips every filter at once,
 * calling `onToggleAll(true|false)` so the outer view does a single repaint.
 * @param {(turnOn: boolean) => void} onToggleAll Bulk-toggle callback.
 * @returns {HTMLElement} The control row element.
 */
function buildAllToggleRow(onToggleAll) {
  const ctrlRow = document.createElement("div");
  ctrlRow.className = "demographics-relations-filter-ctrl-row";
  const allOn = document.createElement("span");
  allOn.textContent = t("LOC_DEMOGRAPHICS_RELATIONS_ALL_ON");
  allOn.className = "demographics-relations-all-toggle";
  wireAllToggleHover(allOn);
  allOn.addEventListener("click", (ev) => {
    ev?.stopPropagation?.();
    safePlaySound("data-audio-activate", "audio-panel-diplo-ribbon");
    onToggleAll(true);
  });
  const sep = document.createElement("span");
  sep.textContent = "·";
  sep.className = "demographics-relations-filter-sep";
  const allOff = document.createElement("span");
  allOff.textContent = t("LOC_DEMOGRAPHICS_RELATIONS_ALL_OFF");
  allOff.className = "demographics-relations-all-toggle";
  wireAllToggleHover(allOff);
  allOff.addEventListener("click", (ev) => {
    ev?.stopPropagation?.();
    safePlaySound("data-audio-activate", "audio-panel-diplo-ribbon");
    onToggleAll(false);
  });
  ctrlRow.appendChild(allOn);
  ctrlRow.appendChild(sep);
  ctrlRow.appendChild(allOff);
  return ctrlRow;
}

const SAMPLE_W = 84; // px - 75% bigger so dash patterns are very visible

/**
 * Append one solid sub-segment span to a swatch, used to synthesize dash
 * patterns (Coherent's SVG renderer rejects `stroke-dasharray`).
 * @param {HTMLElement} swatch The swatch container.
 * @param {string} color The segment color.
 * @param {number} leftPx Left offset, px.
 * @param {number} widthPx Segment width, px.
 */
function pushSwatchSeg(swatch, color, leftPx, widthPx) {
  const d = document.createElement("span");
  d.className = "demographics-relations-swatch-seg";
  // Offset, width, and color are per-segment dynamics; the rest of the
  // segment chrome lives in the .demographics-relations-swatch-seg rule.
  d.style.left = leftPx + "px";
  d.style.width = widthPx + "px";
  d.style.background = color;
  swatch.appendChild(d);
}

/**
 * Build a filter pill's mini sample-line swatch: a fixed-width inline element
 * showing the filter's color + dash texture as solid HTML sub-segments. (SVG
 * `<line>` children render blank in some Coherent builds.)
 * @param {FilterDef} f The filter descriptor.
 * @returns {HTMLElement} The swatch span.
 */
function buildFilterSwatch(f) {
  const swatch = document.createElement("span");
  swatch.className = "demographics-relations-swatch";
  // Width is derived from the SAMPLE_W constant (dynamic); the rest of the
  // swatch chrome lives in the .demographics-relations-swatch rule.
  swatch.style.width = SAMPLE_W + "px";
  const color = f.color || "#bfbfbf";
  // Honor per-tab dash override on the swatch so the legend visual
  // matches the actual ring edge (CS tab: trade=dotted, suzerain=dashed).
  const dashPattern =
    f._dashOverride !== undefined ? f._dashOverride || "" : LINE_DASH[f.key] || "";
  if (!dashPattern) {
    pushSwatchSeg(swatch, color, 0, SAMPLE_W);
    return swatch;
  }
  const parts = dashPattern
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((n) => !isNaN(n) && n > 0);
  const patternSum = parts.reduce((a, b) => a + b, 0) || 1;
  const scale = SAMPLE_W / (patternSum * 2);
  let t = 0;
  let segIdx = 0;
  while (t < SAMPLE_W) {
    const segLen = parts[segIdx % parts.length] * scale;
    const end = Math.min(t + segLen, SAMPLE_W);
    if (segIdx % 2 === 0 && end > t + 0.5) {
      pushSwatchSeg(swatch, color, t, end - t);
    }
    t = end;
    segIdx++;
  }
  return swatch;
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
  // the pattern that works for factbook headers and the new chart
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
 * Build the toggleable filter-pill row - visual vocabulary mirrors the History
 * view legend (pip + label, filled when active, hollow/dim when off). Uses a
 * plain `<div>` (not `<fxs-activatable>`) so click handling is direct.
 * @param {FilterDef[]} filters Filter descriptors to render.
 * @param {Set<string>} activeSet The active filter-key set.
 * @param {(key: string) => void} onToggle Per-pill toggle callback.
 * @param {(turnOn: boolean) => void} [onToggleAll] Bulk-toggle callback.
 * @returns {HTMLElement} The pill-row element.
 */
export function makeFilterPillRow(filters, activeSet, onToggle, onToggleAll) {
  // DOM SHAPE COPIED from view-history.js renderLegend(): each pill is
  // an `.demographics-legend-entry` with `.demographics-legend-pip` +
  // `.demographics-legend-swatch` + `.demographics-legend-name` spans.
  // We tag with `.demographics-relations-filter-row` so the CSS can flip
  // these from the vertical (legend) layout into a horizontal wrap row.
  const row = document.createElement("div");
  row.className = "demographics-relations-filter-row font-body text-xs";
  if (!filters || filters.length === 0) return row;

  // "All on" / "All off" header - flips every filter at once. Sits above
  // the per-filter pills as a small two-link row.
  if (typeof onToggleAll === "function") {
    row.appendChild(buildAllToggleRow(onToggleAll));
  }
  for (const f of filters) {
    row.appendChild(buildFilterPill(f, activeSet, onToggle));
  }
  return row;
}
