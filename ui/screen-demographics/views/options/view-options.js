// view-options.js
//
// "Options" view: settings panel, history controls, session info.
//
// Checkbox pattern: lifted from vanilla panel-mini-map.js - see
// createShowMinimapCheckbox / createLayerCheckbox for the canonical form.
// fxs-checkbox takes a `selected` attribute (stringified bool) and emits
// "component-value-changed" (ComponentValueChangeEventName, defined in
// core/ui/component-support.js) with detail.value: boolean.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import {
  appendStorageControlsPanel
} from "/demographics/ui/screen-demographics/views/options/view-options-storage-controls.js";
import {
  buildButtonRowPanel,
  buildSamplerRecoveryRowPanel
} from "/demographics/ui/screen-demographics/views/options/view-options-actions.js";

/**
 * Persisted-setting accessor surface read off the render context.
 * @typedef {Object} OptionsSettings
 * @property {(key: string, fallback?: *) => *} getSetting Read a setting.
 * @property {(key: string, value: *) => void} setSetting Write a setting.
 */

/**
 * One option in a dropdown's item list: an internal id plus its display label.
 * @typedef {Object} DropdownOption
 * @property {string} id Internal stable id used to read/write the setting.
 * @property {string} label Display label shown in the dropdown.
 */

/**
 * Live sampler surface used by the "Refresh sample now" button.
 * @typedef {Object} OptionsSampler
 * @property {() => void} [sampleNow] Force an immediate sample.
 * @property {() => boolean} [isSamplerDisabled] Whether kill-switch is active.
 * @property {() => boolean} [reenableSampler] Manually re-enable sampling.
 */

/**
 * History-storage surface used by the clear / reset-war buttons.
 * @typedef {Object} OptionsStorage
 * @property {() => void} [clear] Wipe all recorded samples.
 * @property {() => (DemoHistory|undefined)} [load] Load the persisted history.
 * @property {(history: DemoHistory) => void} [save] Persist the history.
 * @property {() => {
 *   active: boolean,
 *   firstTurn: number,
 *   cap: number,
 *   capSource: string,
 *   disabled: boolean
 * }} [decimationStatus]
 *   Current downsampling + cap state (read-only display).
 */

/**
 * Render context handed to {@link render}.
 * @typedef {Object} OptionsCtx
 * @property {OptionsSettings} settings Persisted-setting accessor.
 * @property {OptionsStorage} [storage] History-storage surface.
 * @property {OptionsSampler} [sampler] Live sampler surface.
 * @property {DemoHistory} [history] The full persisted history blob.
 * @property {() => void} [requestReload] Re-render the active view.
 */

const DBG = false;
/**
 * Debug logger, no-op unless {@link DBG} is set.
 * @param {...*} a Values to log.
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.view-options]", ...a);
}

/**
 * Build a labeled toggle row backed by an `fxs-checkbox` wired to a persisted
 * setting. On change the new boolean is written and `onChange` (if any) is run.
 * @param {string} label Row label text.
 * @param {string} key Setting key to read/write.
 * @param {boolean} dflt Default value when the setting is unset.
 * @param {OptionsSettings} settings Persisted-setting accessor.
 * @param {(value: boolean) => void} [onChange] Optional post-write callback.
 * @returns {HTMLElement} The toggle-row element.
 */
function makeToggle(label, key, dflt, settings, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "demographics-option-row";

  const cur = settings.getSetting(key, dflt);
  const cb = document.createElement("fxs-checkbox");
  cb.classList.add("demographics-option-checkbox", "mr-2");
  cb.setAttribute("selected", String(!!cur));
  cb.setAttribute("data-audio-group-ref", "options");
  cb.setAttribute("data-audio-focus-ref", "data-audio-checkbox-focus");

  const lbl = document.createElement("div");
  lbl.className = "demographics-option-label font-body text-sm";
  lbl.textContent = label;

  cb.addEventListener("component-value-changed", (event) => {
    const newValue = !!(/** @type {*} */ (event)?.detail?.value);
    settings.setSetting(key, newValue);
    dlog("toggle", key, "=", newValue);
    if (typeof onChange === "function") onChange(newValue);
  });

  wrap.appendChild(cb);
  wrap.appendChild(lbl);
  return wrap;
}

/**
 * Build an `fxs-button` wired to `handler` on both activation and click, with
 * the shared "options" audio group.
 * @param {string} label Button caption.
 * @param {(event: Event) => void} handler Activation/click handler.
 * @returns {HTMLElement} The button element.
 */
function makeButton(label, handler) {
  const btn = document.createElement("fxs-button");
  btn.setAttribute("caption", label);
  // Audio cue group - Enhancements.md #1. fxs-button auto-emits primary
  // button-press / activate sounds when given a group ref.
  btn.setAttribute("data-audio-group-ref", "options");
  btn.className = "demographics-option-button";
  btn.addEventListener("action-activate", handler);
  btn.addEventListener("click", handler);
  return btn;
}

/**
 * Remove every child of `host` so the view can be rebuilt from scratch.
 * @param {HTMLElement} host The view host element.
 */
function clearHost(host) {
  while (host.firstChild) host.removeChild(host.firstChild);
}

/**
 * Build the "Options" heading element.
 * @returns {HTMLElement} The heading element.
 */
function buildHeading() {
  const heading = document.createElement("div");
  heading.className = "demographics-options-heading font-title text-lg uppercase text-secondary";
  heading.textContent = t("LOC_DEMOGRAPHICS_OPTIONS_HEADING");
  return heading;
}

/**
 * Append the boolean-toggle rows to `wrap`, in their fixed display order.
 *
 * NOTE: Toggles intentionally DO NOT call ctx.requestReload(). Reload calls
 * renderActiveView() which clears the host and re-renders, which destroys the
 * in-flight checkbox element mid-event and makes the entire options view vanish
 * on click. Settings take effect on next open of History/Factbook - which is
 * fine, since nothing in the Options view itself depends on these toggles.
 *
 * The earlier "Show unmet civs in legend" toggle and this "Show real names for
 * unmet civs" toggle were confusing because both deal with unmet civs in
 * different ways. They now do clearly distinct things:
 *   showUnmetNames = false (default): unmet civs render as "Unmet
 *                                     Civilization" placeholder.
 *   showUnmetNames = true:            real leader + civ names shown for civs the
 *                                     local player hasn't met (spoiler mode).
 * The old `showUnmetCivs` toggle is removed - there's no useful behavior between
 * "hide entirely" and "show as placeholder", and hiding civs from the chart
 * entirely makes ranks misleading.
 * @param {HTMLElement} wrap The options container to append into.
 * @param {OptionsCtx} ctx Render context.
 */
function appendToggles(wrap, ctx) {
  wrap.appendChild(
    makeToggle(
      t("LOC_DEMOGRAPHICS_OPT_SHOW_UNMET_NAMES_SPOILER"),
      "showUnmetNames",
      false,
      ctx.settings
    )
  );
  wrap.appendChild(
    makeToggle(t("LOC_DEMOGRAPHICS_OPT_HIDE_UNMET_STATS"), "hideUnmetStats", true, ctx.settings)
  );
  // Sub-option of "Hide unmet civ stats": once you meet a civ, reveal its whole
  // history (back-fill, on) or only data from first contact forward (off).
  const backfillRow = makeToggle(
    t("LOC_DEMOGRAPHICS_OPT_BACKFILL_MET_HISTORY"),
    "backfillMetHistory",
    true,
    ctx.settings
  );
  backfillRow.classList.add("demographics-option-row-sub");
  wrap.appendChild(backfillRow);
  const backfillHint = document.createElement("div");
  backfillHint.className = "demographics-option-hint font-body text-xs";
  backfillHint.textContent = t("LOC_DEMOGRAPHICS_OPT_BACKFILL_MET_HISTORY_HINT");
  wrap.appendChild(backfillHint);
  wrap.appendChild(
    makeToggle(t("LOC_DEMOGRAPHICS_OPT_COLORBLIND"), "colorblindMode", false, ctx.settings, () =>
      ctx.requestReload?.()
    )
  );
  wrap.appendChild(
    makeToggle(t("LOC_DEMOGRAPHICS_OPT_SMOOTH"), "smoothChart", false, ctx.settings)
  );
  wrap.appendChild(
    makeToggle(
      t("LOC_DEMOGRAPHICS_OPT_SHOW_ELIMINATED_FULL"),
      "showEliminatedCivs",
      true,
      ctx.settings
    )
  );
  wrap.appendChild(
    makeToggle(
      t("LOC_DEMOGRAPHICS_OPT_SHOW_WONDER_MARKERS"),
      "showWonderMarkers",
      true,
      ctx.settings
    )
  );
}

/**
 * Append the Top Cities camera section: the pseudo-cinematic toggle (on by
 * default; drives the "Cinematic view" button) and the experimental flyby
 * controls (toggle + length preset + subtle rotate). The flyby is on by
 * default and can be disabled here; the rotate/preset rows are visually
 * sub-rows of the flyby toggle. Settings live under the `topCities.*` namespace
 * inside the existing Demographics settings slice.
 * @param {HTMLElement} wrap The options container to append into.
 * @param {OptionsCtx} ctx Render context.
 */
function appendCameraOptions(wrap, ctx) {
  const heading = document.createElement("div");
  heading.className = "demographics-options-subheading font-title text-sm uppercase text-secondary";
  heading.textContent = t("LOC_DEMOGRAPHICS_OPT_CAMERA_HEADING");
  wrap.appendChild(heading);
  wrap.appendChild(
    makeToggle(t("LOC_DEMOGRAPHICS_OPT_CINEMATIC"), "topCities.cinematicEnabled", true, ctx.settings)
  );
  wrap.appendChild(
    makeToggle(t("LOC_DEMOGRAPHICS_OPT_FLYBY"), "topCities.flybyEnabled", true, ctx.settings)
  );
  wrap.appendChild(buildFlybyPresetControl(ctx));
  const rotateRow = makeToggle(
    t("LOC_DEMOGRAPHICS_OPT_FLYBY_ROTATE"),
    "topCities.flybyAllowRotate",
    true,
    ctx.settings
  );
  rotateRow.classList.add("demographics-option-row-sub");
  wrap.appendChild(rotateRow);
}

/**
 * Build the flyby-length preset dropdown (Short / Medium), persisting the
 * preset id under `topCities.flybyPreset`.
 * @param {OptionsCtx} ctx Render context.
 * @returns {HTMLElement} The dropdown-row element.
 */
function buildFlybyPresetControl(ctx) {
  const opts = [
    { id: "short", label: t("LOC_DEMOGRAPHICS_OPT_FLYBY_PRESET_SHORT") },
    { id: "medium", label: t("LOC_DEMOGRAPHICS_OPT_FLYBY_PRESET_MEDIUM") }
  ];
  const cur = ctx.settings.getSetting("topCities.flybyPreset", "short");
  const idx = Math.max(0, opts.findIndex((o) => o.id === cur));
  const row = buildDropdownRow(t("LOC_DEMOGRAPHICS_OPT_FLYBY_PRESET"), opts, idx, (i) => {
    ctx.settings.setSetting("topCities.flybyPreset", opts[i].id);
  });
  row.classList.add("demographics-option-row-sub");
  return row;
}

/**
 * Build a labeled `fxs-dropdown` row: a label cell plus the dropdown, with the
 * shared "options" audio group and a wired selection-change handler.
 * @param {string} labelText Row label text.
 * @param {DropdownOption[]} opts The dropdown options.
 * @param {number} selectedIdx Initially selected item index.
 * @param {(index: number) => void} onSelect Selection-change callback.
 * @returns {HTMLElement} The dropdown-row element.
 */
function buildDropdownRow(labelText, opts, selectedIdx, onSelect) {
  const row = document.createElement("div");
  row.className = "demographics-option-row";
  const lbl = document.createElement("div");
  lbl.className = "demographics-option-label font-body text-sm";
  lbl.textContent = labelText;
  lbl.style.marginRight = "0.6rem";
  row.appendChild(lbl);

  const dd = document.createElement("fxs-dropdown");
  dd.classList.add("demographics-option-dropdown");
  dd.setAttribute("data-audio-group-ref", "options");
  dd.setAttribute("dropdown-items", JSON.stringify(opts.map((o) => ({ label: o.label }))));
  dd.setAttribute("selected-item-index", String(selectedIdx));
  dd.addEventListener("dropdown-selection-change", (event) => {
    const i = /** @type {*} */ (event)?.detail?.selectedIndex;
    if (typeof i !== "number" || i < 0 || i >= opts.length) return;
    onSelect(i);
  });
  row.appendChild(dd);
  return row;
}

/**
 * Append the adaptive-cap dropdown + hint, the disable-decimation toggle, and
 * the polling-rate dropdown + hint to `wrap`, in their fixed display order.
 * @param {HTMLElement} wrap The options container to append into.
 * @param {OptionsCtx} ctx Render context.
 */
function appendStorageControls(wrap, ctx) {
  appendStorageControlsPanel(wrap, ctx, {
    makeToggle,
    buildDropdownRow
  });
}

/**
 * Build kill-switch recovery controls when sampling is paused.
 * @param {OptionsCtx} ctx Render context.
 * @returns {HTMLElement} The paused-state row (empty when sampler is active).
 */
function buildSamplerRecoveryRow(ctx) {
  return buildSamplerRecoveryRowPanel(ctx, { makeButton });
}

/**
 * Build the button row (refresh, clear history, reset war history).
 * @param {OptionsCtx} ctx Render context.
 * @returns {HTMLElement} The button-row element.
 */
function buildButtonRow(ctx) {
  return buildButtonRowPanel(ctx, { makeButton });
}

/**
 * Build the session-info footer line (sample count, schema version, backend).
 * @param {OptionsCtx} ctx Render context.
 * @returns {HTMLElement} The session-info element.
 */
function buildSessionInfo(ctx) {
  const info = document.createElement("div");
  info.className = "demographics-session-info font-body text-xs";
  const samples = ctx.history?.samples?.length || 0;
  const schema = ctx.history?.version ?? "?";
  const backend =
    typeof GameTutorial !== "undefined" && typeof GameTutorial.setProperty === "function"
      ? "GameTutorial"
      : "in-memory";
  info.textContent = t("LOC_DEMOGRAPHICS_OPT_SESSION_INFO", samples, schema, backend);
  return info;
}

/**
 * Render the Options view into `host`: clears the host, then builds the heading,
 * toggle rows, adaptive-storage controls, action buttons, and session-info
 * footer in their fixed display order.
 * @param {HTMLElement} host The view host element (cleared and repopulated).
 * @param {OptionsCtx} ctx Render context (settings, storage, sampler, history,
 *   requestReload).
 */
export function render(host, ctx) {
  clearHost(host);

  const wrap = document.createElement("div");
  wrap.className = "demographics-options font-body text-sm";
  host.appendChild(wrap);

  wrap.appendChild(buildHeading());
  appendToggles(wrap, ctx);
  appendCameraOptions(wrap, ctx);
  appendStorageControls(wrap, ctx);
  wrap.appendChild(buildSamplerRecoveryRow(ctx));
  wrap.appendChild(buildButtonRow(ctx));
  wrap.appendChild(buildSessionInfo(ctx));
}
