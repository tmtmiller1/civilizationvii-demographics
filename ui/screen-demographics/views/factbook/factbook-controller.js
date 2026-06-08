import { t } from "/demographics/ui/core/demographics-i18n.js";
import { safePlaySound } from "/demographics/ui/core/demographics-audio.js";

import {
  buildCivColumn,
  buildGhostCivColumn,
  buildLabelColumn
} from "/demographics/ui/screen-demographics/views/factbook/factbook-render.js";

const DBG = false;
/**
 * Debug logger, no-op unless `DBG` is set.
 * @param {...*} a Values to log.
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.view-factbook]", ...a);
}

/**
 * @typedef {import("/demographics/ui/screen-demographics/views/factbook/factbook-profiles.js").
 *   CivProfile} CivProfile
 */

/**
 * @typedef {import("/demographics/ui/screen-demographics/views/factbook/factbook-profiles.js").
 *   FactbookCtx} FactbookCtx
 */

/**
 * Mutable state backing the interactive strip, threaded through the
 * module-scope render/toggle helpers.
 * @typedef {Object} StripState
 * @property {HTMLElement} strip The strip container to populate.
 * @property {Record<string, CivProfile>} profiles All civ profiles.
 * @property {string} localPid The local-column pid.
 * @property {string[]} otherPids Sorted non-local pids.
 * @property {FactbookCtx} ctx Render context.
 * @property {boolean} showUnmetNames When false, unmet civs are masked.
 * @property {Set<string>} hiddenCivs The currently hidden pid set.
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
 * @param {FactbookCtx} ctx Render context.
 * @returns {Set<string>} The persisted hidden pids (empty on any error).
 */
export function readHiddenCivs(ctx) {
  try {
    const raw = ctx.settings?.getSetting?.("factbookHiddenCivs", []);
    if (Array.isArray(raw)) return new Set(raw.map((v) => String(v)));
  } catch (_) {
    // settings.getSetting("factbookHiddenCivs") can throw at the storage
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
    st.ctx.settings?.setSetting?.("factbookHiddenCivs", Array.from(st.hiddenCivs));
  } catch (_) {
    // settings.setSetting("factbookHiddenCivs") persistence is best-effort;
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
  renderStrip(st);
}

/**
 * Clear all hidden civs, persist, and re-render the strip.
 * @param {StripState} st The strip state.
 */
export function resetHidden(st) {
  st.hiddenCivs.clear();
  saveHiddenCivs(st);
  renderStrip(st);
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
    col.querySelector(".demographics-factbook-civ-header")
  );
  if (header) {
    header.classList.add("demographics-factbook-civ-header-clickable");
    header.title = isHidden
      ? t("LOC_DEMOGRAPHICS_FACTBOOK_CLICK_SHOW")
      : t("LOC_DEMOGRAPHICS_FACTBOOK_CLICK_HIDE");
    header.addEventListener("click", () => {
      safePlaySound("data-audio-checkbox-press", "audio-screen-unlocks");
      dlog("factbook header click pid=" + pid, "wasHidden=" + isHidden);
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
  labelCol.classList.add("demographics-factbook-col-sticky");
  st.strip.appendChild(labelCol);

  // Column 2: local player (sticky-left, never hidable).
  const localCol = buildCivColumn(st.profiles[st.localPid], st.profiles, true, false);
  localCol.classList.add("demographics-factbook-col-sticky-2");
  st.strip.appendChild(localCol);
}

/**
 * Re-render the full strip: label column, local column, then visible and
 * hidden (ghost) civ columns. Visible columns stay adjacent to the local
 * column to make comparisons easier; hidden ones are pushed to the far right.
 * @param {StripState} st The strip state.
 */
export function renderStrip(st) {
  while (st.strip.firstChild) st.strip.removeChild(st.strip.firstChild);

  appendStickyColumns(st);

  // Columns 3+: visible civs first (preserve sort), then any hidden
  // ones pushed to the far right as thin "ghost" columns.
  const visiblePids = [];
  const hiddenPids = [];
  for (const pid of st.otherPids) {
    if (st.hiddenCivs.has(String(pid))) hiddenPids.push(pid);
    else visiblePids.push(pid);
  }
  const ordered = visiblePids.concat(hiddenPids);
  for (const pid of ordered) {
    st.strip.appendChild(buildOtherColumn(st, pid));
  }
}

/**
 * Mount the interactive factbook strip and return a controller exposing its
 * re-render entry point. Owns the per-civ visibility set, which persists in
 * `modSettings.demographics.factbookHiddenCivs` as an array of pid strings;
 * the local player is never hidden.
 * @param {HTMLElement} strip The strip container to populate.
 * @param {Record<string, CivProfile>} profiles All civ profiles.
 * @param {{ localPid: string, otherPids: string[] }} pids The local-column pid
 *   and the sorted non-local pids.
 * @param {FactbookCtx} ctx Render context.
 * @param {boolean} showUnmetNames When false, unmet civs are masked.
 * @returns {StripController} The mounted strip controller.
 */
export function mountFactbookStrip(strip, profiles, pids, ctx, showUnmetNames) {
  /** @type {StripState} */
  const st = {
    strip,
    profiles,
    localPid: pids.localPid,
    otherPids: pids.otherPids,
    ctx,
    showUnmetNames,
    hiddenCivs: readHiddenCivs(ctx)
  };
  renderStrip(st);
  return { render: () => renderStrip(st) };
}
