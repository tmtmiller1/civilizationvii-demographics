// view-options.js
//
// "Options" view: settings panel, history controls, session info.
//
// Checkbox pattern: lifted from vanilla panel-mini-map.js — see
// createShowMinimapCheckbox (around line 707) and createLayerCheckbox
// (around 725) for the canonical form. fxs-checkbox takes a `selected`
// attribute (stringified bool) and emits "component-value-changed"
// (ComponentValueChangeEventName
// defined in core/ui/component-support.js:713) with detail.value: boolean.

import {
  resolveEffectiveCap,
  detectGameSpeedType,
  HARD_MAX_SAMPLES
} from "/demographics/ui/demographics-storage.js";

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
 */

/**
 * History-storage surface used by the clear / reset-war buttons.
 * @typedef {Object} OptionsStorage
 * @property {() => void} [clear] Wipe all recorded samples.
 * @property {() => (DemoHistory|undefined)} [load] Load the persisted history.
 * @property {(history: DemoHistory) => void} [save] Persist the history.
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

const DBG = true;
/**
 * Debug logger, no-op unless {@link DBG} is set.
 * @param {...*} a Values to log.
 * @returns {void}
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
  // Audio cue group — Enhancements.md #1. fxs-button auto-emits primary
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
 * @returns {void}
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
  heading.textContent = "Options";
  return heading;
}

/**
 * Append the boolean-toggle rows to `wrap`, in their fixed display order.
 *
 * NOTE: Toggles intentionally DO NOT call ctx.requestReload(). Reload calls
 * renderActiveView() which clears the host and re-renders, which destroys the
 * in-flight checkbox element mid-event and makes the entire options view vanish
 * on click. Settings take effect on next open of History/Factbook — which is
 * fine, since nothing in the Options view itself depends on these toggles.
 *
 * The earlier "Show unmet civs in legend" toggle and this "Show real names for
 * unmet civs" toggle were confusing because both deal with unmet civs in
 * different ways. They now do clearly distinct things:
 *   showUnmetNames = false (default): unmet civs render as "Unmet
 *                                     Civilization" placeholder.
 *   showUnmetNames = true:            real leader + civ names shown for civs the
 *                                     local player hasn't met (spoiler mode).
 * The old `showUnmetCivs` toggle is removed — there's no useful behavior between
 * "hide entirely" and "show as placeholder", and hiding civs from the chart
 * entirely makes ranks misleading.
 * @param {HTMLElement} wrap The options container to append into.
 * @param {OptionsCtx} ctx Render context.
 * @returns {void}
 */
function appendToggles(wrap, ctx) {
  wrap.appendChild(
    makeToggle(
      "Show real names for civilizations I haven't met (spoiler)",
      "showUnmetNames",
      false,
      ctx.settings
    )
  );
  wrap.appendChild(
    makeToggle(
      "Colorblind mode (high-contrast Wong palette for chart + relations colors)",
      "colorblindMode",
      false,
      ctx.settings,
      () => ctx.requestReload?.()
    )
  );
  wrap.appendChild(
    makeToggle("Smooth chart lines (3-turn moving average)", "smoothChart", false, ctx.settings)
  );
  wrap.appendChild(
    makeToggle(
      "Show eliminated civs in chart and factbook",
      "showEliminatedCivs",
      true,
      ctx.settings
    )
  );
  wrap.appendChild(
    makeToggle(
      "Show wonder-built markers on chart lines (small icon at the turn each civ completed a wonder)",
      "showWonderMarkers",
      true,
      ctx.settings
    )
  );
  wrap.appendChild(
    makeToggle(
      "Performance mode (buffer storage writes, throttle hover) " +
        "— recommended for long games or slower machines. " +
        "May lose up to 2 turns of history on crash.",
      "perfMode",
      false,
      ctx.settings
    )
  );
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
 * Build the history-sample-cap dropdown row.
 *
 * Game speed-aware default + user override + decimation toggle. Spec:
 * Enhancements.md "Adaptive History Storage Cap".
 * @param {OptionsCtx} ctx Render context.
 * @returns {HTMLElement} The cap dropdown-row element.
 */
function buildHistoryCapControl(ctx) {
  const capOpts = [
    { id: "auto", label: "Auto (game-speed default)" },
    { id: "1000", label: "1,000 samples" },
    { id: "2500", label: "2,500 samples" },
    { id: "5000", label: "5,000 samples" },
    { id: "10000", label: "10,000 samples ⚠ may slow performance" },
    { id: "-1", label: "Unlimited ⚠ very large saves, may slow performance" }
  ];
  const curCapRaw = ctx.settings.getSetting("sampleCapOverride", "auto");
  const curCapKey = typeof curCapRaw === "number" ? String(curCapRaw) : String(curCapRaw);
  let capIdx = capOpts.findIndex((o) => o.id === curCapKey);
  if (capIdx < 0) capIdx = 0;
  return buildDropdownRow("History sample cap:", capOpts, capIdx, (i) => {
    const chosen = capOpts[i].id;
    // Store as a number when numeric, "auto" otherwise. (-1 = unlimited.)
    if (chosen === "auto") ctx.settings.setSetting("sampleCapOverride", "auto");
    else ctx.settings.setSetting("sampleCapOverride", parseInt(chosen, 10));
    // Force a re-render of this view to refresh the "current effective" hint.
    ctx.requestReload?.();
  });
}

/**
 * Build the hint shown under the cap dropdown displaying the resolved effective
 * cap, detected game speed, and hard ceiling. Lets the user see what "Auto"
 * actually translates to for their game.
 * @returns {HTMLElement} The cap-hint element.
 */
function buildHistoryCapHint() {
  const hint = document.createElement("div");
  hint.className = "demographics-option-hint font-body text-xs";
  const eff = (() => {
    try {
      return resolveEffectiveCap();
    } catch (_) {
      return { cap: Infinity, source: "?" };
    }
  })();
  const speed = (() => {
    try {
      return detectGameSpeedType();
    } catch (_) {
      return null;
    }
  })();
  const speedLbl = speed ? speed.replace(/^GAMESPEED_/, "").toLowerCase() : "unknown";
  const capStr = isFinite(eff.cap) ? eff.cap.toLocaleString() : "unlimited";
  hint.textContent =
    "Current effective cap: " +
    capStr +
    "  ·  Game speed detected: " +
    speedLbl +
    "  ·  Hard ceiling: " +
    HARD_MAX_SAMPLES.toLocaleString();
  return hint;
}

/**
 * Build the polling-rate (turns between samples) dropdown row.
 *
 * Takes effect on the very next PlayerTurnActivated — no restart needed. The
 * sampler reads the setting fresh each turn and skips turns that aren't on
 * cadence.
 * @param {OptionsCtx} ctx Render context.
 * @returns {HTMLElement} The polling dropdown-row element.
 */
function buildPollingControl(ctx) {
  const pollOpts = [
    { id: "1", label: "Every turn (default)" },
    { id: "2", label: "Every 2 turns" },
    { id: "5", label: "Every 5 turns" },
    { id: "10", label: "Every 10 turns" },
    { id: "25", label: "Every 25 turns ⚠ coarse graphs" }
  ];
  const curPoll = String(ctx.settings.getSetting("sampleEveryNTurns", 1));
  let pollIdx = pollOpts.findIndex((o) => o.id === curPoll);
  if (pollIdx < 0) pollIdx = 0;
  return buildDropdownRow("Sample frequency:", pollOpts, pollIdx, (i) => {
    ctx.settings.setSetting("sampleEveryNTurns", parseInt(pollOpts[i].id, 10));
  });
}

/**
 * Build the hint shown under the polling-rate dropdown.
 * @returns {HTMLElement} The polling-hint element.
 */
function buildPollingHint() {
  const pollHint = document.createElement("div");
  pollHint.className = "demographics-option-hint font-body text-xs";
  pollHint.textContent =
    "Higher values record fewer points — useful for long marathon games. " +
    "Change applies on the next turn; existing samples are kept.";
  return pollHint;
}

/**
 * Append the adaptive-cap dropdown + hint, the disable-decimation toggle, and
 * the polling-rate dropdown + hint to `wrap`, in their fixed display order.
 * @param {HTMLElement} wrap The options container to append into.
 * @param {OptionsCtx} ctx Render context.
 * @returns {void}
 */
function appendStorageControls(wrap, ctx) {
  wrap.appendChild(buildHistoryCapControl(ctx));
  wrap.appendChild(buildHistoryCapHint());
  wrap.appendChild(
    makeToggle(
      "Disable downsampling (keep every turn's sample even after the cap is hit) " +
        "— power-user mode; pair with a high cap or Unlimited.",
      "disableDecimation",
      false,
      ctx.settings
    )
  );
  wrap.appendChild(buildPollingControl(ctx));
  wrap.appendChild(buildPollingHint());
}

/**
 * Force an immediate sample, then re-render the view. Defensive: swallows any
 * error from the sampler.
 * @param {OptionsCtx} ctx Render context.
 * @returns {void}
 */
function refreshSampleNow(ctx) {
  try {
    if (ctx.sampler?.sampleNow) {
      ctx.sampler.sampleNow();
      ctx.requestReload?.();
    }
  } catch (_) {
    /* */
  }
}

/**
 * Prompt the user to confirm a destructive action. Returns `true` when there is
 * no usable `window.confirm` (matching the original always-proceed behavior) or
 * when the user accepts the prompt.
 * @param {string} message The confirmation message.
 * @returns {boolean} True to proceed, false to cancel.
 */
function confirmAction(message) {
  if (typeof window !== "undefined" && typeof window.confirm === "function") {
    return !!window.confirm(message);
  }
  return true;
}

/**
 * Confirm, then wipe all recorded samples and re-render. Defensive: swallows
 * any error from storage.
 * @param {OptionsCtx} ctx Render context.
 * @returns {void}
 */
function clearHistory(ctx) {
  if (!confirmAction("Clear all recorded Demographics samples?")) return;
  try {
    ctx.storage?.clear?.();
    ctx.requestReload?.();
  } catch (_) {
    /* */
  }
}

/**
 * Confirm, then wipe only `history.wars[]` (keeps samples + boundaries) and
 * re-render. Useful when older war records are out-of-shape from a schema
 * change and are duplicating in the conflicts gantt. Defensive: swallows any
 * error from storage.
 * @param {OptionsCtx} ctx Render context.
 * @returns {void}
 */
function resetWarHistory(ctx) {
  if (!confirmAction("Clear all recorded wars? Sample history and other data will be kept."))
    return;
  try {
    const h = ctx.storage?.load?.();
    if (h) {
      /** @type {*} */ (h).wars = [];
      ctx.storage?.save?.(h);
      ctx.requestReload?.();
    }
  } catch (_) {
    /* */
  }
}

/**
 * Build the button row (refresh, clear history, reset war history).
 * @param {OptionsCtx} ctx Render context.
 * @returns {HTMLElement} The button-row element.
 */
function buildButtonRow(ctx) {
  const btnRow = document.createElement("div");
  btnRow.className = "demographics-options-buttons";
  btnRow.appendChild(makeButton("Refresh sample now", () => refreshSampleNow(ctx)));
  btnRow.appendChild(makeButton("Clear history", () => clearHistory(ctx)));
  btnRow.appendChild(makeButton("Reset war history", () => resetWarHistory(ctx)));
  return btnRow;
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
  info.textContent = "Samples: " + samples + "    Schema: v" + schema + "    Backend: " + backend;
  return info;
}

/**
 * Render the Options view into `host`: clears the host, then builds the heading,
 * toggle rows, adaptive-storage controls, action buttons, and session-info
 * footer in their fixed display order.
 * @param {HTMLElement} host The view host element (cleared and repopulated).
 * @param {OptionsCtx} ctx Render context (settings, storage, sampler, history,
 *   requestReload).
 * @returns {void}
 */
export function render(host, ctx) {
  clearHost(host);

  const wrap = document.createElement("div");
  wrap.className = "demographics-options font-body text-sm";
  host.appendChild(wrap);

  wrap.appendChild(buildHeading());
  appendToggles(wrap, ctx);
  appendStorageControls(wrap, ctx);
  wrap.appendChild(buildButtonRow(ctx));
  wrap.appendChild(buildSessionInfo(ctx));
}
