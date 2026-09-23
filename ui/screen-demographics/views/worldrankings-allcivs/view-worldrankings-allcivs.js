// view-worldrankings-allcivs.js
//
// "All Civilizations" view: a spreadsheet-style matrix (civs as columns, metrics as rows) built
// from flex columns rather than an HTML <table>, which Coherent's GameFace renders unreliably.

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
  appendRenderFailed,
  setMatrixNumberMode,
  matrixHasNumberModePairs
} from "/demographics/ui/screen-demographics/views/worldrankings-allcivs/worldrankings-allcivs-render.js";
import { mountWorldRankingsAllCivsStrip } from "/demographics/ui/screen-demographics/views/worldrankings-allcivs/worldrankings-allcivs-controller.js";
import { renderCivTable } from "/demographics/ui/screen-demographics/views/worldrankings-allcivs/worldrankings-allcivs-table.js";
import { METRICS } from "/demographics/ui/metrics/demographics-metrics.js";
import { div } from "/demographics/ui/core/ui-helpers.js";
import { pillRow } from "/demographics/ui/screen-demographics/views/shared/view-pills.js";
import { t } from "/demographics/ui/core/demographics-i18n.js";
import { safePlaySound } from "/demographics/ui/core/demographics-audio.js";

const NUMBER_MODES = ["scaled", "civ"];

// ── Responsive matrix/table layout gate ───────────────────────────────────────
// The screen renders either the civs-as-rows sortable table or the civs-as-columns matrix.
// "auto" picks the table only when there is width for readable per-metric column headers; a
// `worldRankingsAllCivsLayout` setting ("auto"|"table"|"matrix") pins it.
const LAYOUT_MODES = ["auto", "table", "matrix"];
// Readable floor per metric column, and the width the two sticky identity columns consume, both
// in rem so the test folds in resolution and Interface Size. When unsure raise MIN_METRIC_COL_REM.
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
 * Render the All Civilizations view into `host`: clears the host, folds the history into
 * per-civ profiles, applies the display settings, then mounts the table or matrix. Every
 * sort/toggle re-render goes through here, so a throwing sub-renderer leaves a visible
 * "render failed" notice instead of an empty host.
 * @param {HTMLElement} host The view host element (cleared and repopulated).
 * @param {WorldRankingsAllCivsCtx} ctx Render context (history + settings accessors).
 */
export function render(host, ctx) {
  while (host.firstChild) host.removeChild(host.firstChild);
  try {
    renderBody(host, ctx);
  } catch (e) {
    appendRenderFailed(host, "render", e);
  }
}

/**
 * The unguarded render body (see `render`).
 * @param {HTMLElement} host The cleared view host element.
 * @param {WorldRankingsAllCivsCtx} ctx Render context.
 */
function renderBody(host, ctx) {
  const profiles = prepareProfiles(ctx);
  const allPids = Object.keys(profiles);
  if (allPids.length === 0) {
    appendEmptyState(host);
    // afterRender runs on every full render (which clears `host`), so an owner can re-attach
    // chrome it placed in host (the Settlements Options toolbar).
    if (typeof ctx.afterRender === "function") ctx.afterRender(host);
    return;
  }

  // When false, mask unmet civs.
  const showUnmetNames = readBoolSetting(ctx, "showUnmetNames", false);

  // Responsive branch: the sortable civs-as-rows table when there's width for it, else the
  // matrix. The table updates itself in place for sorts and the Rank/Value toggle; the matrix's
  // Scaled/Civ toggle still comes back through `render` (it changes which metric rows exist).
  if (chooseLayout(host, ctx) === "table") {
    dlog("rendering all-civilizations sortable table; civs=", allPids.length);
    // The table owns its own in-place updates for the Rank/Value toggle and the sort headers, so
    // neither goes back through `render` (which would clear the host and re-create the chrome).
    renderCivTable(host, profiles, ctx, showUnmetNames);
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
  // Metrics-as-rows matrix: column 1 metric labels (sticky-left), column 2 the local player's
  // values (sticky-left, gold border), then every other met civ with hidden "ghost" columns
  // pushed to the far right. The strip controller owns its own in-place re-render for the
  // hide/show-civ toggles.
  const localPid = pickLocalPid(profiles, allPids);
  const otherPids = sortOtherPids(profiles, allPids, localPid);

  // Scaled / Civ toggle: applies the number mode BEFORE the strip is built (the
  // strip reads it when laying out its metric rows) and re-renders on change so the
  // paired rows (Population, Emigration flows) swap in place.
  mountNumberModeToggle(host, ctx, () => render(host, ctx));
  mountMatrix(host, profiles, { localPid, otherPids }, ctx, showUnmetNames);
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
  // Own-civ-only / disabled drops every non-local civ; the unmet gate is driven by the effective
  // policy (so a host can force it).
  if (policyOwnCivOnly()) {
    stripNonLocalCivs(profiles);
  } else if (policyHidesUnmet()) {
    stripUnmetDiplomacy(profiles);
  }
  return profiles;
}
