// view-worldrankings-allcivs.js
//
// "All Civilizations" view: a spreadsheet-style matrix built from flex
// columns rather than an HTML <table>.
//
// Layout: each civ is a vertical column, each metric is a horizontal row.
//   Column 1: metric labels                  (sticky-left)
//   Column 2: local player's civ values      (sticky-left, gold border)
//   Column 3+: every other met civ, sorted by leader name
//
// Vanilla Civ7 uses zero <table> elements (a grep across
// Resources/Base/modules turns up no createElement("table") and no
// `<table` literals). Coherent's GameFace renders tables unreliably,
// hence flex.

import {
  buildCivProfiles,
  readBoolSetting,
  stripEliminatedCivs,
  stripUnmetDiplomacy,
  stripNonLocalCivs,
  pickLocalPid,
  sortOtherPids
} from "/demographics/ui/screen-demographics/views/worldrankings-allcivs/worldrankings-allcivs-profiles.js";
import {
  policyHidesUnmet,
  policyOwnCivOnly
} from "/demographics/ui/core/demographics-governance.js";
import {
  appendEmptyState,
  setMatrixNumberMode,
  matrixHasNumberModePairs
} from "/demographics/ui/screen-demographics/views/worldrankings-allcivs/worldrankings-allcivs-render.js";
import { mountWorldRankingsAllCivsStrip } from "/demographics/ui/screen-demographics/views/worldrankings-allcivs/worldrankings-allcivs-controller.js";
import { buildLeadersSection } from "/demographics/ui/screen-demographics/views/worldrankings-allcivs/worldrankings-allcivs-leaders.js";
import { renderCivTable } from "/demographics/ui/screen-demographics/views/worldrankings-allcivs/worldrankings-allcivs-table.js";
import { METRICS } from "/demographics/ui/metrics/demographics-metrics.js";
import { div } from "/demographics/ui/core/ui-helpers.js";
import { pillRow } from "/demographics/ui/screen-demographics/views/shared/view-pills.js";
import { t } from "/demographics/ui/core/demographics-i18n.js";
import { safePlaySound } from "/demographics/ui/core/demographics-audio.js";

const NUMBER_MODES = ["scaled", "civ"];

// ── Responsive matrix/table layout gate ───────────────────────────────────────
// The screen renders either the civs-as-rows SORTABLE TABLE (per player feedback
// wanting sortable yield columns back) or the civs-as-columns MATRIX (the v2.3.2
// rework that stays readable at 4K / large Interface Size). "auto" picks the table
// only when there is width for readable per-metric column headers; otherwise the
// matrix. A `worldRankingsAllCivsLayout` setting ("auto"|"table"|"matrix") pins it.
const LAYOUT_MODES = ["auto", "table", "matrix"];
// Readable floor per metric column, and the width the two sticky identity columns
// (rank + civilization) consume — both in rem so the test folds in resolution AND
// Interface Size (rem tracks the engine's scaled root font). Tune MIN_METRIC_COL_REM
// in-engine at 4K × XL Interface Size; when unsure raise it (favours the matrix).
const MIN_METRIC_COL_REM = 2.4;
const FIXED_COLS_REM = 3.6 + 13;
const VISIBLE_METRIC_COUNT = /** @type {*[]} */ (METRICS).filter(
  (m) => !m.worldRankingsAllCivsHidden
).length;

/**
 * Read the persisted layout override ("auto" | "table" | "matrix").
 * @param {WorldRankingsAllCivsCtx} ctx Render context.
 * @returns {string} The layout mode.
 */
function readLayoutSetting(ctx) {
  let m;
  try {
    m = ctx?.settings?.getSetting?.("worldRankingsAllCivsLayout", "auto");
  } catch (_) {
    m = "auto";
  }
  return LAYOUT_MODES.includes(m) ? m : "auto";
}

/**
 * Available width of `host` in rem, measured with a throwaway 10rem probe so it
 * tracks the engine's Interface-Size font scaling. Returns 0 when the width can't
 * be measured (first paint / detached) so the caller falls back to the matrix.
 * @param {HTMLElement} host The (cleared) view host.
 * @returns {number} Available width in rem, or 0.
 */
function availableRemWidth(host) {
  let w = 0;
  try {
    w = host.getBoundingClientRect().width;
  } catch (_) {
    w = 0;
  }
  if (!(w > 0)) return 0;
  const probe = document.createElement("div");
  probe.style.width = "10rem";
  host.appendChild(probe);
  let px = 0;
  try {
    px = probe.getBoundingClientRect().width;
  } catch (_) {
    px = 0;
  }
  host.removeChild(probe);
  const remPx = px > 0 ? px / 10 : 16;
  return w / remPx;
}

/**
 * Decide the layout for this render: the pinned setting, else the width test.
 * @param {HTMLElement} host The (cleared) view host.
 * @param {WorldRankingsAllCivsCtx} ctx Render context.
 * @returns {"table"|"matrix"} The chosen layout.
 */
function chooseLayout(host, ctx) {
  const mode = readLayoutSetting(ctx);
  if (mode === "table") return "table";
  if (mode === "matrix") return "matrix";
  const need = FIXED_COLS_REM + VISIBLE_METRIC_COUNT * MIN_METRIC_COL_REM;
  return availableRemWidth(host) >= need ? "table" : "matrix";
}

/**
 * Resolve the persisted Scaled/Civ number mode.
 * @param {WorldRankingsAllCivsCtx} ctx Render context.
 * @returns {string} "scaled" or "civ".
 */
function readNumberMode(ctx) {
  let m;
  try {
    m = ctx?.settings?.getSetting?.("worldRankingsAllCivsNumberMode", "scaled");
  } catch (_) {
    m = "scaled";
  }
  return NUMBER_MODES.includes(m) ? m : "scaled";
}

/**
 * Build the Scaled / Civ toggle. Swaps every paired row (Population and the
 * Emigration flows) between scaled-"people" and raw Civ-numbers in place, so
 * there's one row per metric instead of a duplicate per unit.
 * @param {string} mode Active mode.
 * @param {(mode: string) => void} onPick Change handler.
 * @returns {HTMLElement} The toggle row.
 */
function buildNumberModeToggle(mode, onPick) {
  const items = [
    { key: "scaled", label: t("LOC_DEMOGRAPHICS_WORLDRANKINGS_ALLCIVS_NUM_SCALED") },
    { key: "civ", label: t("LOC_DEMOGRAPHICS_WORLDRANKINGS_ALLCIVS_NUM_CIV") }
  ];
  return pillRow(items, mode, onPick, "filter");
}

/**
 * Apply the persisted Scaled/Civ mode and, when there are paired metrics, mount the
 * toggle into `host` (re-rendering the view on change).
 * @param {HTMLElement} host The view host.
 * @param {WorldRankingsAllCivsCtx} ctx Render context.
 * @param {() => void} rerender Re-render callback.
 */
function mountNumberModeToggle(host, ctx, rerender) {
  const mode = readNumberMode(ctx);
  setMatrixNumberMode(mode);
  if (!matrixHasNumberModePairs()) return;
  host.appendChild(
    buildNumberModeToggle(mode, (/** @type {string} */ m) => {
      if (m === mode) return;
      safePlaySound("data-audio-activate");
      try {
        ctx?.settings?.setSetting?.("worldRankingsAllCivsNumberMode", m);
      } catch (_) {
        // best-effort persistence
      }
      rerender();
    })
  );
}

const DBG = false;
/**
 * Debug logger, no-op unless `DBG` is set.
 * @param {...*} a Values to log.
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.view-worldrankings-allcivs]", ...a);
}

/**
 * Persisted-setting accessor surface read off the render context.
 * @typedef {Object} WorldRankingsAllCivsSettings
 * @property {(key: string, fallback?: *) => *} [getSetting] Read a setting.
 * @property {(key: string, value: *) => void} [setSetting] Write a setting.
 */

/**
 * Render context handed to `render`.
 * @typedef {Object} WorldRankingsAllCivsCtx
 * @property {DemoHistory} [history] The full persisted history blob.
 * @property {WorldRankingsAllCivsSettings} [settings] Persisted-setting accessor.
 * @property {(host: HTMLElement) => void} [afterRender] Optional hook run after
 *   every (re)render so an owner can re-attach chrome it placed in `host`.
 */

/**
 * Render the All Civilizations matrix into `host`. Clears the host, folds the
 * history into per-civ profiles, applies the `showEliminatedCivs` /
 * `showUnmetNames` settings, then mounts the interactive strip.
 * @param {HTMLElement} host The view host element (cleared and repopulated).
 * @param {WorldRankingsAllCivsCtx} ctx Render context (history + settings accessors).
 */
export function render(host, ctx) {
  while (host.firstChild) host.removeChild(host.firstChild);

  const profiles = prepareProfiles(ctx);
  const allPids = Object.keys(profiles);
  if (allPids.length === 0) {
    appendEmptyState(host);
    // afterRender runs on EVERY render (incl. the internal sort/toggle re-render
    // below, which clears `host`), so an owner can re-attach chrome it placed in
    // host — e.g. the Settlements Options toolbar, which a one-shot insert would
    // lose on the first sort. See view-settlements rerenderContent.
    if (typeof ctx.afterRender === "function") ctx.afterRender(host);
    return;
  }

  // Read "show unmet names" setting (Fix 4). When false, mask unmet civs.
  const showUnmetNames = readBoolSetting(ctx, "showUnmetNames", false);

  // Responsive branch: the sortable civs-as-rows table when there's width for it,
  // else the matrix. Both own the same `() => render(host, ctx)` sort/toggle
  // re-render, so afterRender fires on every re-render and the Settlements Options
  // toolbar re-attaches.
  if (chooseLayout(host, ctx) === "table") {
    dlog("rendering all-civilizations sortable table; civs=", allPids.length);
    renderCivTable(host, profiles, ctx, showUnmetNames, () => render(host, ctx));
  } else {
    dlog("rendering all-civilizations matrix; civs=", allPids.length);
    renderMatrix(host, profiles, allPids, ctx, showUnmetNames);
  }
  // Let the owner re-attach host chrome after each (re)render (see note above).
  if (typeof ctx.afterRender === "function") ctx.afterRender(host);
}

/**
 * Render the civs-as-columns matrix branch (the wide, resolution-robust layout).
 * @param {HTMLElement} host The view host.
 * @param {Record<string, *>} profiles Civ profile map.
 * @param {string[]} allPids All profile pids.
 * @param {WorldRankingsAllCivsCtx} ctx Render context.
 * @param {boolean} showUnmetNames Whether unmet identities are shown.
 */
function renderMatrix(host, profiles, allPids, ctx, showUnmetNames) {
  // Metrics-as-ROWS matrix (each metric is a row, each civ a column):
  //   Column 1: metric labels (sticky-left) — a WIDE horizontal column, so long
  //             localized names read at full size and never clip/shrink, unlike
  //             the civs-as-rows table where ~21 metric *columns* forced the
  //             header font down to nothing at 4K / low UI scale.
  //   Column 2: local player's civ values (sticky-left, gold border)
  //   Column 3+: every other met civ, sorted by leader name (hidable "ghost"
  //             columns pushed to the far right).
  // Each cell is rank-forward (big world-rank number) with a small value line, so
  // it shows rank AND value at once. The strip controller owns its own in-place
  // re-render for the hide/show-civ toggles.
  const localPid = pickLocalPid(profiles, allPids);
  const otherPids = sortOtherPids(profiles, allPids, localPid);

  // Category-leader cards on top (one per metric, the civ that leads it) — the same
  // "rank by category" strip the All Settlements panel shows.
  appendLeaders(host, profiles, showUnmetNames);
  // Scaled / Civ toggle: applies the number mode BEFORE the strip is built (the
  // strip reads it when laying out its metric rows) and re-renders on change so the
  // paired rows (Population, Emigration flows) swap in place.
  mountNumberModeToggle(host, ctx, () => render(host, ctx));
  mountMatrix(host, profiles, { localPid, otherPids }, ctx, showUnmetNames);
}

/**
 * Append the category-leaders section (no-op when there's nothing to lead).
 * @param {HTMLElement} host The view host.
 * @param {Record<string, *>} profiles Civ profile map.
 * @param {boolean} showUnmetNames Whether unmet identities are shown.
 */
function appendLeaders(host, profiles, showUnmetNames) {
  const leaders = buildLeadersSection(profiles, showUnmetNames);
  if (leaders) host.appendChild(leaders);
}

/**
 * Build the matrix wrapper + strip and mount the interactive columns into `host`.
 * @param {HTMLElement} host The view host.
 * @param {Record<string, *>} profiles Civ profile map.
 * @param {{ localPid: string, otherPids: string[] }} pids Local + sorted-other pids.
 * @param {WorldRankingsAllCivsCtx} ctx Render context.
 * @param {boolean} showUnmetNames Whether unmet identities are shown.
 */
function mountMatrix(host, profiles, pids, ctx, showUnmetNames) {
  const matrix = div("demographics-worldrankings-allcivs-matrix");
  const strip = div("demographics-worldrankings-allcivs-strip");
  matrix.appendChild(strip);
  host.appendChild(matrix);
  mountWorldRankingsAllCivsStrip(strip, profiles, pids, ctx, showUnmetNames);
}

/**
 * Build and post-process worldrankings-allcivs profiles from history/settings.
 * @param {WorldRankingsAllCivsCtx} ctx Render context.
 * @returns {Record<string, *>} Profile map.
 */
function prepareProfiles(ctx) {
  const profiles = buildCivProfiles(ctx.history);
  if (!readBoolSetting(ctx, "showEliminatedCivs", true)) {
    stripEliminatedCivs(profiles, ctx.history);
  }
  // Governance (P0.1): own-civ-only / disabled drops every non-local civ; the
  // unmet gate is now driven by the effective policy (so a host can force it).
  if (policyOwnCivOnly()) {
    stripNonLocalCivs(profiles);
  } else if (policyHidesUnmet()) {
    stripUnmetDiplomacy(profiles);
  }
  return profiles;
}
