import { t } from "/demographics/ui/core/demographics-i18n.js";
import { safePlaySound } from "/demographics/ui/core/demographics-audio.js";

import {
  appendRenderFailed,
  buildCivColumn,
  buildGhostCivColumn,
  buildLabelColumn,
  syncLabelResetButton
} from "/demographics/ui/screen-demographics/views/worldrankings-allcivs/worldrankings-allcivs-render.js";

const DBG = false;
/**
 * Debug logger, no-op unless `DBG` is set.
 * @param {...*} a Values to log.
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.view-worldrankings-allcivs]", ...a);
}

/**
 * Error logger (always emits).
 * @param {...*} a Values to log.
 */
function derr(...a) {
  console.error("[Demographics.view-worldrankings-allcivs]", ...a);
}

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
 *   rebuilds ONLY the column whose shape changed. Rebuilding the whole strip re-created every
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
 * @param {StripState} st The strip state.
 * @param {string} pid Player id to test.
 * @returns {boolean} True when the civ should be masked.
 */
export function stripIsUnmet(st, pid) {
  if (st.showUnmetNames) return false;
  if (pid === st.localPid) return false;
  const p = st.profiles[pid];
  return !!(p && p.met === false);
}

/**
 * Read the persisted hidden-civ set, defensively, into a string `Set`.
 * @param {AllCivsCtx} ctx Render context.
 * @returns {Set<string>} The persisted hidden pids (empty on any error).
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
 * @param {StripState} st The strip state.
 */
export function saveHiddenCivs(st) {
  try {
    st.ctx.settings?.setSetting?.("worldRankingsAllCivsHiddenCivs", Array.from(st.hiddenCivs));
  } catch (_) {
    // settings.setSetting("worldRankingsAllCivsHiddenCivs") persistence is best-effort;
    // st.hiddenCivs already holds the live set for this session.
  }
}

/**
 * Toggle one civ's hidden state, persist, and re-render the strip.
 * @param {StripState} st The strip state.
 * @param {string} pid Player id to toggle.
 */
export function toggleCiv(st, pid) {
  const k = String(pid);
  if (st.hiddenCivs.has(k)) st.hiddenCivs.delete(k);
  else st.hiddenCivs.add(k);
  saveHiddenCivs(st);
  updateStripColumns(st, [k]);
}

/**
 * Clear all hidden civs, persist, and restore their columns.
 * @param {StripState} st The strip state.
 */
export function resetHidden(st) {
  // Only the columns that were hidden change shape (ghost → full); the rest are left alone.
  const wasHidden = Array.from(st.hiddenCivs);
  st.hiddenCivs.clear();
  saveHiddenCivs(st);
  updateStripColumns(st, wasHidden);
}

/**
 * The non-local pids in display order: visible civs first (in the sorted order), then the hidden
 * ones as thin "ghost" columns at the far right.
 * @param {StripState} st The strip state.
 * @returns {string[]} The ordered pids.
 */
function orderedOtherPids(st) {
  /** @type {string[]} */
  const visible = [];
  /** @type {string[]} */
  const hidden = [];
  for (const pid of st.otherPids) {
    if (st.hiddenCivs.has(String(pid))) hidden.push(String(pid));
    else visible.push(String(pid));
  }
  return visible.concat(hidden);
}

/**
 * Rebuild ONLY the named columns (the ones whose full/ghost shape changed), move them to their
 * new places, and update the label column's reset button. Every untouched column keeps its
 * element — and therefore its already-resolved portrait — so nothing blinks. Falls back to a full
 * strip render if anything throws, so a failed update cannot leave a half-built strip.
 * @param {StripState} st The strip state.
 * @param {string[]} pids The pids whose columns must be rebuilt.
 */
function updateStripColumns(st, pids) {
  try {
    const ordered = orderedOtherPids(st);
    for (const pid of pids) rebuildOneColumn(st, String(pid), ordered);
    reconcileStripOrder(st, ordered);
    if (st.labelCol) {
      syncLabelResetButton(st.labelCol, {
        hiddenCount: st.hiddenCivs.size,
        onReset: () => resetHidden(st)
      });
    }
  } catch (e) {
    derr("strip column update failed, falling back to a full render:", e);
    renderStrip(st);
  }
}

/**
 * Replace one civ's column with a freshly built one at its new position.
 * @param {StripState} st The strip state.
 * @param {string} pid The pid to rebuild.
 * @param {string[]} ordered The target pid order.
 */
function rebuildOneColumn(st, pid, ordered) {
  const prior = st.cols.get(pid);
  if (prior && prior.parentNode === st.strip) st.strip.removeChild(prior);
  const col = buildOtherColumn(st, pid);
  st.cols.set(pid, col);
  const at = ordered.indexOf(pid);
  const next = at >= 0 ? st.cols.get(ordered[at + 1]) : undefined;
  if (next && next.parentNode === st.strip) st.strip.insertBefore(col, next);
  else st.strip.appendChild(col);
}

/**
 * Put every civ column in `ordered`'s order, moving only the ones that are out of place. Moving
 * an element is not rebuilding it, so this cannot cause the blink a rebuild does.
 * @param {StripState} st The strip state.
 * @param {string[]} ordered The target pid order.
 */
function reconcileStripOrder(st, ordered) {
  for (let i = 0; i < ordered.length; i++) {
    const want = st.cols.get(ordered[i]);
    if (!want) continue;
    const at = st.strip.children[st.head + i];
    if (at !== want) st.strip.insertBefore(want, at || null);
  }
}

/**
 * Build one non-local civ column (ghost or full) and wire its header click.
 * @param {StripState} st The strip state.
 * @param {string} pid Player id for the column.
 * @returns {HTMLElement} The column element.
 */
export function buildOtherColumn(st, pid) {
  const isHidden = st.hiddenCivs.has(String(pid));
  const headerOpts = {
    visible: !isHidden,
    onToggle: () => toggleCiv(st, pid)
  };
  const col = isHidden
    ? buildGhostCivColumn(st.profiles[pid], stripIsUnmet(st, pid), headerOpts)
    : buildCivColumn(st.profiles[pid], st.profiles, false, stripIsUnmet(st, pid), headerOpts);
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
      dlog("worldrankings-allcivs header click pid=" + pid, "wasHidden=" + isHidden);
      toggleCiv(st, pid);
    });
  }
  return col;
}

/**
 * Append the label column (1) and sticky local-player column (2) to the strip.
 * @param {StripState} st The strip state.
 */
export function appendStickyColumns(st) {
  // Column 1: metric labels (sticky-left).
  const labelCol = buildLabelColumn({
    hiddenCount: st.hiddenCivs.size,
    onReset: () => resetHidden(st)
  });
  labelCol.classList.add("demographics-worldrankings-allcivs-col-sticky");
  st.labelCol = labelCol;
  st.strip.appendChild(labelCol);

  // Column 2: local player (sticky-left, never hidable).
  const localCol = buildCivColumn(st.profiles[st.localPid], st.profiles, true, false);
  localCol.classList.add("demographics-worldrankings-allcivs-col-sticky-2");
  st.strip.appendChild(localCol);
  st.head = st.strip.children.length;
}

/**
 * Re-render the full strip: label column, local column, then visible civ columns
 * (adjacent to the local column) and hidden ghost columns at the far right. The
 * header clicks and reset button re-render through here, so it is their throw
 * boundary: a throwing column builder leaves the "render failed" notice.
 * @param {StripState} st The strip state.
 */
export function renderStrip(st) {
  while (st.strip.firstChild) st.strip.removeChild(st.strip.firstChild);
  try {
    appendStripColumns(st);
  } catch (e) {
    appendRenderFailed(st.strip, "renderStrip", e);
  }
}

/**
 * Append every strip column to the (already cleared) strip (see `renderStrip`).
 * @param {StripState} st The strip state.
 */
function appendStripColumns(st) {
  st.cols.clear();
  appendStickyColumns(st);

  // Columns 3+: visible civs first (preserve sort), then any hidden
  // ones pushed to the far right as thin "ghost" columns.
  for (const pid of orderedOtherPids(st)) {
    const col = buildOtherColumn(st, pid);
    st.cols.set(pid, col);
    st.strip.appendChild(col);
  }
}

/**
 * Mount the interactive worldrankings-allcivs strip and return a controller exposing its
 * re-render entry point. Owns the per-civ visibility set, which persists in
 * `modSettings.demographics.worldRankingsAllCivsHiddenCivs` as an array of pid strings;
 * the local player is never hidden.
 * @param {HTMLElement} strip The strip container to populate.
 * @param {Record<string, CivProfile>} profiles All civ profiles.
 * @param {{ localPid: string, otherPids: string[] }} pids The local-column pid
 *   and the sorted non-local pids.
 * @param {AllCivsCtx} ctx Render context.
 * @param {boolean} showUnmetNames When false, unmet civs are masked.
 * @returns {StripController} The mounted strip controller.
 */
export function mountWorldRankingsAllCivsStrip(strip, profiles, pids, ctx, showUnmetNames) {
  /** @type {StripState} */
  const st = {
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
  renderStrip(st);
  return { render: () => renderStrip(st) };
}
