import { t } from "/demographics/ui/core/demographics-i18n.js";
import { safePlaySound } from "/demographics/ui/core/demographics-audio.js";

import {
  appendRenderFailed,
  buildCivColumn,
  buildGhostCivColumn,
  buildLabelColumn,
  syncLabelResetButton
} from "/demographics/ui/screen-demographics/views/worldrankings-allcivs/worldrankings-allcivs-render.js";
import { makeLogger } from "/demographics/ui/core/demographics-log.js";

const log = makeLogger("view-worldrankings-allcivs");

/** @typedef {import("./worldrankings-allcivs-profiles.js").CivProfile} CivProfile */
/** @typedef {import("./worldrankings-allcivs-profiles.js").WorldRankingsAllCivsCtx} AllCivsCtx */

/**
 * Mutable state backing the interactive strip, threaded through the
 * module-scope render/toggle helpers.
 * @typedef {Object} StripState
 * @property {HTMLElement} strip The strip container to populate.
 * @property {Record<string, CivProfile>} profiles All civ profiles.
 * @property {string} localPid The local-column pid.
 * @property {string[]} otherPids Sorted non-local pids.
 * @property {AllCivsCtx} ctx Render context.
 * @property {boolean} showUnmetNames When false, unmet civs are masked.
 * @property {Set<string>} hiddenCivs The currently hidden pid set.
 * @property {Map<string, HTMLElement>} cols Live per-pid column elements, so a hide/show toggle
 *   rebuilds only the column whose shape changed. Rebuilding the whole strip re-created every
 *   other civ's leader portrait and the label column's metric icons, and each one blinked while
 *   its `blp:` background resolved again.
 * @property {HTMLElement|null} labelCol The label column (kept across toggles).
 * @property {number} head Count of leading sticky columns (label + local) before the civ columns.
 */

/**
 * Controller exposing the strip's re-render entry point.
 * @typedef {Object} StripController
 * @property {() => void} render Re-render the strip into its container.
 */

/**
 * Whether `pid` should be masked as unmet. Defensive: only mask when `met` is
 * EXPLICITLY false.
 * @param {StripState} state
 * @param {string} pid
 * @returns {boolean}
 */
export function stripIsUnmet(state, pid) {
  if (state.showUnmetNames) return false;
  if (pid === state.localPid) return false;
  const profile = state.profiles[pid];
  return !!(profile && profile.met === false);
}

/**
 * Read the persisted hidden-civ set, defensively, into a string `Set`.
 * @param {AllCivsCtx} ctx
 * @returns {Set<string>} Empty on any error.
 */
export function readHiddenCivs(ctx) {
  try {
    const raw = ctx.settings?.getSetting?.("worldRankingsAllCivsHiddenCivs", []);
    if (Array.isArray(raw)) return new Set(raw.map((v) => String(v)));
  } catch (_) {
    // settings.getSetting("worldRankingsAllCivsHiddenCivs") can throw at the storage
    // boundary; start with an empty hidden set.
  }
  return new Set();
}

/**
 * Persist the current hidden-civ set, defensively.
 * @param {StripState} state
 */
export function saveHiddenCivs(state) {
  try {
    state.ctx.settings?.setSetting?.("worldRankingsAllCivsHiddenCivs", Array.from(state.hiddenCivs));
  } catch (_) {
    // settings.setSetting("worldRankingsAllCivsHiddenCivs") persistence is best-effort;
    // state.hiddenCivs already holds the live set for this session.
  }
}

/**
 * Toggle one civ's hidden state, persist, and re-render the strip.
 * @param {StripState} state
 * @param {string} pid
 */
export function toggleCiv(state, pid) {
  const key = String(pid);
  if (state.hiddenCivs.has(key)) state.hiddenCivs.delete(key);
  else state.hiddenCivs.add(key);
  saveHiddenCivs(state);
  updateStripColumns(state, [key]);
}

/**
 * Clear all hidden civs, persist, and restore their columns.
 * @param {StripState} state
 */
export function resetHidden(state) {
  // Only the columns that were hidden change shape (ghost → full); the rest are left alone.
  const wasHidden = Array.from(state.hiddenCivs);
  state.hiddenCivs.clear();
  saveHiddenCivs(state);
  updateStripColumns(state, wasHidden);
}

/** @param {StripState} state */
function orderedOtherPids(state) {
  /** @type {string[]} */
  const visible = [];
  /** @type {string[]} */
  const hidden = [];
  for (const pid of state.otherPids) {
    if (state.hiddenCivs.has(String(pid))) hidden.push(String(pid));
    else visible.push(String(pid));
  }
  return visible.concat(hidden);
}

/**
 * Rebuild only the named columns (the ones whose full/ghost shape changed), move them to their
 * new places, and update the label column's reset button. Every untouched column keeps its
 * element, and therefore its already-resolved portrait, so nothing blinks. Falls back to a full
 * strip render if anything throws, so a failed update cannot leave a half-built strip.
 * @param {StripState} state
 * @param {string[]} pids The pids whose columns must be rebuilt.
 */
function updateStripColumns(state, pids) {
  try {
    const ordered = orderedOtherPids(state);
    for (const pid of pids) rebuildOneColumn(state, String(pid), ordered);
    reconcileStripOrder(state, ordered);
    if (state.labelCol) {
      syncLabelResetButton(state.labelCol, {
        hiddenCount: state.hiddenCivs.size,
        onReset: () => resetHidden(state)
      });
    }
  } catch (e) {
    log.error("strip column update failed, falling back to a full render:", e);
    renderStrip(state);
  }
}

/**
 * @param {StripState} state
 * @param {string} pid
 * @param {string[]} ordered
 */
function rebuildOneColumn(state, pid, ordered) {
  const prior = state.cols.get(pid);
  if (prior && prior.parentNode === state.strip) state.strip.removeChild(prior);
  const col = buildOtherColumn(state, pid);
  state.cols.set(pid, col);
  const at = ordered.indexOf(pid);
  const next = at >= 0 ? state.cols.get(ordered[at + 1]) : undefined;
  if (next && next.parentNode === state.strip) state.strip.insertBefore(col, next);
  else state.strip.appendChild(col);
}

/**
 * Put every civ column in `ordered`'s order, moving only the ones that are out of place. Moving
 * an element is not rebuilding it, so this cannot cause the blink a rebuild does.
 * @param {StripState} state
 * @param {string[]} ordered The target pid order.
 */
function reconcileStripOrder(state, ordered) {
  for (let i = 0; i < ordered.length; i++) {
    const column = state.cols.get(ordered[i]);
    if (!column) continue;
    const occupant = state.strip.children[state.head + i];
    if (occupant !== column) state.strip.insertBefore(column, occupant || null);
  }
}

/**
 * Build one non-local civ column (ghost or full) and wire its header click.
 * @param {StripState} state
 * @param {string} pid
 * @returns {HTMLElement}
 */
export function buildOtherColumn(state, pid) {
  const isHidden = state.hiddenCivs.has(String(pid));
  const headerOpts = {
    visible: !isHidden,
    onToggle: () => toggleCiv(state, pid)
  };
  const col = isHidden
    ? buildGhostCivColumn(state.profiles[pid], stripIsUnmet(state, pid), headerOpts)
    : buildCivColumn(state.profiles[pid], state.profiles, false, stripIsUnmet(state, pid), headerOpts);
  const header = /** @type {HTMLElement|null} */ (
    col.querySelector(".demographics-worldrankings-allcivs-civ-header")
  );
  if (header) {
    header.classList.add("demographics-worldrankings-allcivs-civ-header-clickable");
    header.title = isHidden
      ? t("LOC_DEMOGRAPHICS_WORLDRANKINGS_ALLCIVS_CLICK_SHOW")
      : t("LOC_DEMOGRAPHICS_WORLDRANKINGS_ALLCIVS_CLICK_HIDE");
    header.addEventListener("click", () => {
      safePlaySound("data-audio-checkbox-press", "audio-screen-unlocks");
      log.debug("worldrankings-allcivs header click pid=" + pid, "wasHidden=" + isHidden);
      toggleCiv(state, pid);
    });
  }
  return col;
}

/**
 * Append the label column (1) and sticky local-player column (2) to the strip.
 * @param {StripState} state
 */
export function appendStickyColumns(state) {
  // Column 1: metric labels (sticky-left).
  const labelCol = buildLabelColumn({
    hiddenCount: state.hiddenCivs.size,
    onReset: () => resetHidden(state)
  });
  labelCol.classList.add("demographics-worldrankings-allcivs-col-sticky");
  state.labelCol = labelCol;
  state.strip.appendChild(labelCol);

  // Column 2: local player (sticky-left, never hidable).
  const localCol = buildCivColumn(state.profiles[state.localPid], state.profiles, true, false);
  localCol.classList.add("demographics-worldrankings-allcivs-col-sticky-2");
  state.strip.appendChild(localCol);
  state.head = state.strip.children.length;
}

/**
 * Re-render the full strip: label column, local column, then visible civ columns
 * (adjacent to the local column) and hidden ghost columns at the far right. The
 * header clicks and reset button re-render through here, so it is their throw
 * boundary: a throwing column builder leaves the "render failed" notice.
 * @param {StripState} state
 */
export function renderStrip(state) {
  while (state.strip.firstChild) state.strip.removeChild(state.strip.firstChild);
  try {
    appendStripColumns(state);
  } catch (e) {
    appendRenderFailed(state.strip, "renderStrip", e);
  }
}

/** @param {StripState} state */
function appendStripColumns(state) {
  state.cols.clear();
  appendStickyColumns(state);

  // Columns 3+: visible civs first (preserve sort), then any hidden
  // ones pushed to the far right as thin "ghost" columns.
  for (const pid of orderedOtherPids(state)) {
    const col = buildOtherColumn(state, pid);
    state.cols.set(pid, col);
    state.strip.appendChild(col);
  }
}

/**
 * Mount the interactive worldrankings-allcivs strip and return a controller exposing its
 * re-render entry point. Owns the per-civ visibility set, which persists in
 * `modSettings.demographics.worldRankingsAllCivsHiddenCivs` as an array of pid strings;
 * the local player is never hidden.
 * @param {HTMLElement} strip
 * @param {Record<string, CivProfile>} profiles
 * @param {{ localPid: string, otherPids: string[] }} pids The local-column pid
 *   and the sorted non-local pids.
 * @param {AllCivsCtx} ctx
 * @param {boolean} showUnmetNames When false, unmet civs are masked.
 * @returns {StripController}
 */
export function mountWorldRankingsAllCivsStrip(strip, profiles, pids, ctx, showUnmetNames) {
  /** @type {StripState} */
  const state = {
    strip,
    profiles,
    localPid: pids.localPid,
    otherPids: pids.otherPids,
    ctx,
    showUnmetNames,
    hiddenCivs: readHiddenCivs(ctx),
    cols: new Map(),
    labelCol: null,
    head: 0
  };
  renderStrip(state);
  return { render: () => renderStrip(state) };
}
