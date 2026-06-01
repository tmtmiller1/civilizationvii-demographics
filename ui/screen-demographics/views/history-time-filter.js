// history-time-filter.js
//
// Time-range filtering for the "Historical Data" view: resolving a filter id to
// an inclusive {min, max} turn window, plus the pill row that lets the player
// pick a window. Cross-age filters are greyed out with a custom HTML tooltip
// (Coherent ignores native `title`).

import { t } from "/demographics/ui/demographics-i18n.js";
import { makeClickable } from "/demographics/ui/demographics-a11y.js";
import { playActivate } from "/demographics/ui/demographics-audio.js";

/**
 * A single time-range filter pill definition.
 * @typedef {Object} TimeFilterDef
 * @property {string} id Stable filter id ("25", "age", "all", ...).
 * @property {string} label Pill caption.
 * @property {boolean} [disabled] When true the pill renders greyed/non-clickable.
 */

/**
 * Inclusive turn window the chart clamps to, or null for the full domain.
 * @typedef {Object} TurnRange
 * @property {number} min First turn shown.
 * @property {number} max Last turn shown.
 */

const DBG = false;
/**
 * Debug logger, no-op unless {@link DBG} is set.
 * @param {...*} a Values to log.
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.history-time-filter]", ...a);
}

// ─── Time-range filter helpers ──────────────────────────────────────────────
// Each filter resolves to a {min, max} turn range that the chart clamps to.
// "all" returns null (chart uses its natural full domain).

/** @type {TimeFilterDef[]} */
export const TIME_FILTERS = [
  { id: "25", label: "25y" },
  { id: "50", label: "50y" },
  { id: "100", label: "100y" },
  { id: "300", label: "300y" },
  { id: "500", label: "500y" },
  { id: "1000", label: "1000y" },
  { id: "age", label: "LOC_DEMOGRAPHICS_FILTER_CURRENT_AGE" },
  { id: "age1", label: "LOC_DEMOGRAPHICS_FILTER_AGE1", disabled: true },
  { id: "age2", label: "LOC_DEMOGRAPHICS_FILTER_AGE2", disabled: true },
  { id: "age3", label: "LOC_DEMOGRAPHICS_FILTER_AGE3", disabled: true },
  { id: "all", label: "LOC_DEMOGRAPHICS_FILTER_ALL_TIME", disabled: true }
];

/**
 * Cross-age filter tooltip content. Structured so the renderer can lay it out
 * as proper HTML (clean sections, mixed-case headings) rather than a wall of
 * monospace text. One place to edit if/when the engine constraint changes.
 * @type {{ title: string, body: string }}
 */
const CROSS_AGE_DISABLED_TOOLTIP = {
  title: "LOC_DEMOGRAPHICS_TOOLTIP_CROSSAGE_TITLE",
  body: "LOC_DEMOGRAPHICS_TOOLTIP_CROSSAGE_BODY"
};

/**
 * Parse "2375 BCE" → -2375 ; "300 CE" → 300 ; "1450" (no era) → 1450.
 * @param {*} s The game-year string.
 * @returns {number|undefined} Signed year, or undefined when unparseable.
 */
function parseGameYear(s) {
  if (typeof s !== "string") return undefined;
  const m = s.match(/(-?\d+)\s*(BCE|BC|AD|CE)?/i);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  if (!isFinite(n)) return undefined;
  const era = (m[2] || "").toUpperCase();
  return era === "BCE" || era === "BC" ? -n : n;
}

/**
 * Build a turn → signed-year map from the history's samples.
 * @param {DemoHistory|undefined} history The persisted history blob.
 * @returns {Map<number, number>} Turn-to-year lookup.
 */
function buildTurnYearMap(history) {
  /** @type {Map<number, number>} */
  const m = new Map();
  const samps = history && Array.isArray(history.samples) ? history.samples : [];
  for (const s of samps) {
    if (s && typeof s.turn === "number" && typeof s.gameYear === "string") {
      const y = parseGameYear(s.gameYear);
      if (typeof y === "number") m.set(s.turn, y);
    }
  }
  return m;
}

/**
 * Resolve the start turn of the current age from the history's age boundaries,
 * or `firstTurn` when none are recorded.
 * @param {DemoHistory|undefined} history The persisted history blob.
 * @param {number} firstTurn First sampled turn (fallback).
 * @returns {number} Start turn of the current age.
 */
function currentAgeStartTurn(history, firstTurn) {
  const bounds =
    history && Array.isArray(history.ageBoundaries)
      ? history.ageBoundaries.slice().sort((a, b) => (a.turn || 0) - (b.turn || 0))
      : [];
  if (bounds.length === 0) return firstTurn;
  return bounds[bounds.length - 1].turn;
}

/**
 * Compute the turn window for a year-relative filter (25/50/100/...), clamped
 * so it never reaches back past the start of the current age.
 * @param {DemoHistory|undefined} history The persisted history blob.
 * @param {Snapshot[]} samps Sorted samples.
 * @param {number} span Year span requested.
 * @param {number} firstTurn First sampled turn.
 * @param {number} lastTurn Last sampled turn.
 * @returns {TurnRange|null} The window, or null when no year data exists.
 */
function computeYearRelativeRange(history, samps, span, firstTurn, lastTurn) {
  const turnYear = buildTurnYearMap(history);
  if (turnYear.size === 0) return null;
  const latestYear = turnYear.get(lastTurn) ?? Array.from(turnYear.values()).pop();
  const cutoff = /** @type {number} */ (latestYear) - span;
  // Find the earliest turn whose year >= cutoff.
  let minTurn = lastTurn;
  for (const s of samps) {
    const y = turnYear.get(/** @type {number} */ (s.turn));
    if (typeof y === "number" && y >= cutoff) {
      minTurn = /** @type {number} */ (s.turn);
      break;
    }
  }
  // Don't reach back further than the start of the current age. If
  // the requested span pre-dates the latest age boundary, clamp the
  // range to "Current Age" (start-of-age → now) so the chart doesn't
  // mix in stale pre-age data the user didn't ask for.
  const ageStart = currentAgeStartTurn(history, firstTurn);
  if (minTurn < ageStart) minTurn = ageStart;
  return { min: minTurn, max: lastTurn };
}

/**
 * Compute the turn window for a named age filter ("age", "age1"..."age3")
 * from the history's age boundaries.
 * @param {DemoHistory|undefined} history The persisted history blob.
 * @param {string} filterId The age filter id.
 * @param {number} firstTurn First sampled turn.
 * @param {number} lastTurn Last sampled turn.
 * @returns {TurnRange|null} The window, or null for an unknown filter.
 */
function computeAgeRange(history, filterId, firstTurn, lastTurn) {
  // Age filters use history.ageBoundaries: [{turn, age}, ...]
  const bounds =
    history && Array.isArray(history.ageBoundaries)
      ? history.ageBoundaries.slice().sort((a, b) => (a.turn || 0) - (b.turn || 0))
      : [];
  /**
   * Resolve the [start, end] window for the age at boundary index `idx`.
   * @param {number} idx Zero-based age index.
   * @returns {TurnRange|null} The age's window, or null when `idx` < 0.
   */
  function ageRange(idx) {
    if (idx < 0) return null;
    const start = idx === 0 ? firstTurn : bounds[idx - 1]?.turn || firstTurn;
    // If this is the last known age, max = lastTurn; else next boundary - 1.
    const next = bounds[idx];
    const end = next ? next.turn - 1 : lastTurn;
    return { min: start, max: end };
  }
  if (filterId === "age1") return ageRange(0);
  if (filterId === "age2") return ageRange(1);
  if (filterId === "age3") return ageRange(2);
  if (filterId === "age") {
    // Current age: from the LAST recorded boundary turn → lastTurn.
    if (bounds.length === 0) return { min: firstTurn, max: lastTurn };
    const last = bounds[bounds.length - 1];
    return { min: last.turn, max: lastTurn };
  }
  return null;
}

/**
 * Resolve a filter id to an inclusive {min, max} turn range, or null for
 * "show everything".
 * @param {DemoHistory|undefined} history The persisted history blob.
 * @param {string} filterId The active filter id.
 * @returns {TurnRange|null} The clamped window, or null for the full domain.
 */
export function computeTurnRange(history, filterId) {
  if (!filterId || filterId === "all") return null;
  const samps = history && Array.isArray(history.samples) ? history.samples : [];
  if (samps.length === 0) return null;
  const lastTurn = /** @type {number} */ (samps[samps.length - 1].turn);
  const firstTurn = /** @type {number} */ (samps[0].turn);
  // Year-relative filters (25/50/100/300/500/1000 years).
  if (/^\d+$/.test(filterId)) {
    const span = parseInt(filterId, 10);
    return computeYearRelativeRange(history, samps, span, firstTurn, lastTurn);
  }
  return computeAgeRange(history, filterId, firstTurn, lastTurn);
}

/**
 * Nudge `tip` back into the viewport via a translate transform when any edge
 * overflows; clear the transform when it fits.
 * @param {HTMLElement} tip The tooltip element.
 */
function repositionTooltip(tip) {
  if (!tip.parentElement) return;
  const rect = tip.getBoundingClientRect();
  const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
  const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
  const dx = overflowShift(rect.left, rect.right, vw);
  const dy = overflowShift(rect.top, rect.bottom, vh);
  if (dx !== 0 || dy !== 0) {
    tip.style.transform = `translate(${dx}px, ${dy}px)`;
  } else {
    tip.style.transform = "";
  }
}

/**
 * Compute the translate delta along one axis that brings a [near, far] span
 * back inside the [0, extent] viewport, with an 8px margin. Far-edge overflow
 * takes precedence over near-edge.
 * @param {number} near Leading edge coordinate (left or top).
 * @param {number} far Trailing edge coordinate (right or bottom).
 * @param {number} extent Viewport size along this axis.
 * @returns {number} The shift in pixels (0 when it already fits).
 */
function overflowShift(near, far, extent) {
  if (far > extent) return extent - far - 8;
  if (near < 0) return -near + 8;
  return 0;
}

/**
 * Attach the cross-age "why is this disabled?" tooltip to a pill. Mirrors the
 * CSV info-icon pattern: an absolutely-positioned <div> child of the pill,
 * styled with the engine's tooltip chrome, toggled on mouseenter / mouseleave.
 * Coherent GameFace ignores the native `title` attribute, so we render the
 * structured CROSS_AGE_DISABLED_TOOLTIP content as proper HTML.
 * @param {HTMLElement} pill The disabled filter pill.
 */
function attachDisabledFilterTooltip(pill) {
  const tip = buildDisabledFilterTooltipEl();

  // Ensure tooltip never overflows the viewport
  tip.addEventListener("transitionend", () => repositionTooltip(tip));
  tip.addEventListener("mouseenter", () => repositionTooltip(tip));

  pill.appendChild(tip);
  pill.addEventListener("mouseenter", () => {
    tip.style.opacity = "1";
  });
  pill.addEventListener("mouseleave", () => {
    tip.style.opacity = "0";
  });
}

/**
 * Build the cross-age disabled-filter tooltip element (chrome + title + body),
 * initially transparent. Content from CROSS_AGE_DISABLED_TOOLTIP.
 * @returns {HTMLElement} The tooltip element.
 */
function buildDisabledFilterTooltipEl() {
  const content = CROSS_AGE_DISABLED_TOOLTIP;

  const tip = document.createElement("div");
  tip.className =
    "img-tooltip-border img-tooltip-bg demographics-history-tip demographics-history-tip-disabled-filter";

  const title = document.createElement("div");
  title.className = "demographics-history-tip-title";
  title.textContent = t(content.title);
  tip.appendChild(title);

  const body = document.createElement("div");
  body.className = "demographics-history-tip-body";
  body.innerHTML = t(content.body);
  tip.appendChild(body);

  return tip;
}

/**
 * Build a disabled (greyed, non-clickable) filter pill carrying the cross-age
 * tooltip. Clicks are swallowed so audio + selection never fire.
 * @param {TimeFilterDef} f The filter definition.
 * @returns {HTMLElement} The disabled pill element.
 */
function buildDisabledFilterPill(f) {
  const pill = document.createElement("div");
  pill.className = "demographics-chart-time-filter-pill";
  // Visual greying via color / border alpha rather than CSS
  // `opacity`. Opacity compounds onto children, which would
  // dim the disabled-filter tooltip below to the point of
  // illegibility; muting the foreground colors instead leaves
  // the tooltip free to render at full strength. See the
  // `.demographics-chart-time-filter-pill.is-disabled` rule.
  pill.classList.add("is-disabled");
  pill.textContent = t(f.label);
  attachDisabledFilterTooltip(pill);
  // Swallow clicks so audio + selection don't fire.
  pill.addEventListener("click", (ev) => {
    ev?.stopPropagation?.();
    ev?.preventDefault?.();
  });
  return pill;
}

/**
 * Build an enabled filter pill wired to `onSelect`, marked active when its id
 * matches `activeFilter`.
 * @param {TimeFilterDef} f The filter definition.
 * @param {string} activeFilter Currently active filter id.
 * @param {(id: string) => void} [onSelect] Selection callback.
 * @returns {HTMLElement} The pill element.
 */
function buildEnabledFilterPill(f, activeFilter, onSelect) {
  const pill = document.createElement("div");
  pill.className = "demographics-chart-time-filter-pill";
  if (f.id === activeFilter) pill.classList.add("is-active");
  const label = t(f.label);
  pill.textContent = label;
  pill.title = t("LOC_DEMOGRAPHICS_FILTER_PILL_TOOLTIP", label);
  makeClickable(pill, (ev) => {
    ev?.stopPropagation?.();
    playActivate();
    dlog("time-filter click id=" + f.id);
    if (typeof onSelect === "function") onSelect(f.id);
  });
  return pill;
}

/**
 * Build the pill row of time-range filter buttons. Same single-div pattern that
 * works in view-relations.js — class + textContent + click handler. Persists
 * the active filter via `onSelect` (round-trips through settings). Filters
 * flagged `disabled` render greyed and non-clickable with a custom HTML tooltip
 * (Coherent ignores native `title`).
 * @param {string} activeFilter Currently active filter id.
 * @param {(id: string) => void} onSelect Called with the chosen filter id.
 * @returns {HTMLElement} The filter-row element.
 */
export function buildTimeFilterRow(activeFilter, onSelect) {
  const row = document.createElement("div");
  // Row needs to be the positioning context for absolutely-placed
  // tooltips on disabled pills (the pill itself is a flex child and
  // its own bounds are too narrow for a multi-line tooltip) — see the
  // position:relative in the .demographics-chart-time-filter-row rule.
  row.className = "demographics-chart-time-filter-row font-body text-xs";
  for (const f of TIME_FILTERS) {
    const pill = f.disabled
      ? buildDisabledFilterPill(f)
      : buildEnabledFilterPill(f, activeFilter, onSelect);
    row.appendChild(pill);
  }
  return row;
}
