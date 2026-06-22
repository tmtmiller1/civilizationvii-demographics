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
  POLICY_ORDER,
  POLICY_DISABLED,
  POLICY_OWN,
  POLICY_MET,
  POLICY_FULL,
  localPolicy,
  setHostPolicy,
  publishEffectivePolicy,
  isMultiplayer,
  canSetHostPolicy
} from "/demographics/ui/core/demographics-governance.js";
import {
  TIER_ORDER,
  TIER_BASIC,
  TIER_STANDARD,
  getTier,
  showCameraOptionsInTier,
  showStorageOptionsInTier
} from "/demographics/ui/core/demographics-tiers.js";
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
 * Build an uppercase section subheading (the same style the camera section uses).
 * @param {string} text The heading text.
 * @returns {HTMLElement} The subheading element.
 */
function buildSubheading(text) {
  const h = document.createElement("div");
  h.className = "demographics-options-subheading font-title text-sm uppercase text-secondary";
  h.textContent = text;
  return h;
}

/**
 * Localized label for an analytics-governance policy id (P0.1).
 * @param {string} policy A policy id.
 * @returns {string} The display label.
 */
function policyOptionLabel(policy) {
  if (policy === POLICY_DISABLED) return t("LOC_DEMOGRAPHICS_POLICY_DISABLED");
  if (policy === POLICY_OWN) return t("LOC_DEMOGRAPHICS_POLICY_OWN");
  if (policy === POLICY_MET) return t("LOC_DEMOGRAPHICS_POLICY_MET");
  return t("LOC_DEMOGRAPHICS_POLICY_FULL");
}

/**
 * Apply a chosen analytics policy (P0.1): persist the local preference, keep the
 * legacy `hideUnmetStats` / `showUnmetNames` keys in lockstep so every existing
 * consumer keeps working, push the host ceiling in multiplayer when hosting, and
 * reload so the banner + views reflect the new policy immediately.
 * @param {OptionsCtx} ctx Render context.
 * @param {string} mode The chosen policy id.
 */
function applyAnalyticsPolicy(ctx, mode) {
  ctx.settings.setSetting("analyticsPolicy", mode);
  const hideUnmet = mode !== POLICY_FULL;
  ctx.settings.setSetting("hideUnmetStats", hideUnmet);
  ctx.settings.setSetting("showUnmetNames", !hideUnmet);
  if (isMultiplayer() && canSetHostPolicy()) setHostPolicy(mode);
  publishEffectivePolicy(); // mirror to GameConfiguration so the Emigration tabs see the change
  ctx.requestReload?.();
}

/**
 * Build the analytics-visibility policy dropdown (combined design plan P0.1):
 * how much comparative data the screen exposes. In multiplayer a host's choice
 * also writes the GameConfiguration ceiling for all players (a hint row notes
 * this); a non-host only constrains their own view. Subsumes the legacy spoiler
 * toggle, which it keeps in sync.
 * @param {OptionsCtx} ctx Render context.
 * @returns {HTMLElement} The policy-control element (dropdown row + optional hint).
 */
function buildAnalyticsPolicyControl(ctx) {
  const opts = POLICY_ORDER.map((id) => ({ id, label: policyOptionLabel(id) }));
  const cur = localPolicy();
  const idx = Math.max(0, POLICY_ORDER.indexOf(cur));
  const wrap = document.createElement("div");
  const row = buildDropdownRow(
    t("LOC_DEMOGRAPHICS_OPT_ANALYTICS_POLICY"),
    opts,
    idx,
    (i) => applyAnalyticsPolicy(ctx, POLICY_ORDER[i])
  );
  wrap.appendChild(row);
  if (isMultiplayer()) {
    const hint = document.createElement("div");
    hint.className = "demographics-option-hint font-body text-xs";
    hint.textContent = canSetHostPolicy()
      ? t("LOC_DEMOGRAPHICS_OPT_ANALYTICS_POLICY_HOST_HINT")
      : t("LOC_DEMOGRAPHICS_OPT_ANALYTICS_POLICY_CLIENT_HINT");
    wrap.appendChild(hint);
  }
  return wrap;
}

/**
 * Build the "on first contact" reveal-mode dropdown (a sub-row of the spoiler
 * toggle): reveal a civ's full back-history when met, or only track it forward
 * from first contact. Maps to the legacy `backfillMetHistory` boolean.
 * @param {OptionsCtx} ctx Render context.
 * @returns {HTMLElement} The dropdown-row element.
 */
function buildRevealModeControl(ctx) {
  const opts = [
    { id: "full", label: t("LOC_DEMOGRAPHICS_OPT_BACKFILL_MET_HISTORY") },
    { id: "forward", label: t("LOC_DEMOGRAPHICS_OPT_TRACK_FROM_MEET") }
  ];
  const backfill = ctx.settings.getSetting("backfillMetHistory", true) !== false;
  const row = buildDropdownRow(
    t("LOC_DEMOGRAPHICS_OPT_REVEAL_MODE"),
    opts,
    backfill ? 0 : 1,
    (i) => ctx.settings.setSetting("backfillMetHistory", i === 0)
  );
  row.classList.add("demographics-option-row-sub");
  return row;
}

/**
 * Append the toggle/option rows to `wrap`, grouped under section subheadings.
 *
 * NOTE: Toggles intentionally DO NOT call ctx.requestReload() (except colorblind,
 * which needs an immediate repaint). Reload clears + re-renders the host, which
 * would destroy the in-flight checkbox mid-event; other settings take effect on
 * the next open of History/Rankings.
 *
 * "Spoilers": one control hides ALL info (names + diplomacy/relations stats) for
 * civilizations the local player hasn't met. It writes the two legacy keys in
 * lockstep - `hideUnmetStats = value`, `showUnmetNames = !value` - so every
 * existing consumer of those keys keeps working without a schema migration. The
 * nested dropdown picks what happens once a civ IS met (full back-history vs
 * forward-only tracking).
 * @param {HTMLElement} wrap The options container to append into.
 * @param {OptionsCtx} ctx Render context.
 */
function appendToggles(wrap, ctx) {
  wrap.appendChild(buildSubheading(t("LOC_DEMOGRAPHICS_OPT_SPOILERS_HEADING")));
  wrap.appendChild(buildAnalyticsPolicyControl(ctx));
  wrap.appendChild(buildRevealModeControl(ctx));

  wrap.appendChild(buildSubheading(t("LOC_DEMOGRAPHICS_OPT_DISPLAY_HEADING")));
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
  wrap.appendChild(buildSubheading(t("LOC_DEMOGRAPHICS_OPT_CAMERA_HEADING")));
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
  appendInterfaceTier(wrap, ctx);
  appendToggles(wrap, ctx);
  // UI complexity tiers (P1.5): progressive disclosure of advanced control groups.
  if (showCameraOptionsInTier()) appendCameraOptions(wrap, ctx);
  if (showStorageOptionsInTier()) appendStorageControls(wrap, ctx);
  wrap.appendChild(buildSamplerRecoveryRow(ctx));
  wrap.appendChild(buildButtonRow(ctx));
  wrap.appendChild(buildSessionInfo(ctx));
}

/**
 * Localized label for a UI complexity tier id (P1.5).
 * @param {string} tier A tier id.
 * @returns {string} The display label.
 */
function tierOptionLabel(tier) {
  if (tier === TIER_BASIC) return t("LOC_DEMOGRAPHICS_TIER_BASIC");
  if (tier === TIER_STANDARD) return t("LOC_DEMOGRAPHICS_TIER_STANDARD");
  return t("LOC_DEMOGRAPHICS_TIER_ANALYST");
}

/**
 * Localized one-line description for a UI complexity tier id (P1.5).
 * @param {string} tier A tier id.
 * @returns {string} The description.
 */
function tierDescription(tier) {
  if (tier === TIER_BASIC) return t("LOC_DEMOGRAPHICS_TIER_BASIC_DESC");
  if (tier === TIER_STANDARD) return t("LOC_DEMOGRAPHICS_TIER_STANDARD_DESC");
  return t("LOC_DEMOGRAPHICS_TIER_ANALYST_DESC");
}

/**
 * Append the "Interface" section: the UI complexity tier dropdown plus a live
 * description of the chosen tier (P1.5). Changing it reloads so the disclosed
 * pages / tabs / controls update immediately.
 * @param {HTMLElement} wrap The options container to append into.
 * @param {OptionsCtx} ctx Render context.
 */
function appendInterfaceTier(wrap, ctx) {
  wrap.appendChild(buildSubheading(t("LOC_DEMOGRAPHICS_OPT_INTERFACE_HEADING")));
  const opts = TIER_ORDER.map((id) => ({ id, label: tierOptionLabel(id) }));
  const cur = getTier();
  const idx = Math.max(0, TIER_ORDER.indexOf(cur));
  const desc = document.createElement("div");
  desc.className = "demographics-option-hint font-body text-xs";
  desc.textContent = tierDescription(cur);
  const row = buildDropdownRow(t("LOC_DEMOGRAPHICS_OPT_COMPLEXITY"), opts, idx, (i) => {
    ctx.settings.setSetting("uiComplexity", TIER_ORDER[i]);
    ctx.requestReload?.();
  });
  wrap.appendChild(row);
  wrap.appendChild(desc);
}
