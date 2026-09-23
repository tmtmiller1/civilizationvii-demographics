// view-options-actions.js
//
// Action controls (refresh, clear, reset wars, sampler recovery) for Options.

import { t } from "/demographics/ui/core/demographics-i18n.js";

/**
 * @typedef {{
 *   makeButton: (label: string, handler: (event: Event) => void) => HTMLElement
 * }} ActionDeps
 */

/**
 * Force an immediate sample, then request a reload.
 * @param {*} ctx Render context.
 */
function refreshSampleNow(ctx) {
  try {
    if (ctx.sampler?.sampleNow) {
      ctx.sampler.sampleNow();
      ctx.requestReload?.();
    }
  } catch (_) {
    // Ignore sampler errors to keep the Options view mounted.
  }
}

/** Milliseconds an armed destructive button stays armed before it disarms itself. */
const ARM_TIMEOUT_MS = 6000;
/**
 * Milliseconds after arming during which a second activation is the SAME physical press: the
 * engine's fxs-button fires both `click` and `action-activate` for one click, and the Options
 * view's makeButton listens to both.
 */
const SAME_PRESS_MS = 350;

/**
 * Re-label a button built by the Options view's makeButton (an fxs-button carrying a `caption`
 * attribute) or a plain element (text content), so tests and the engine both read the new label.
 * @param {HTMLElement} btn The button.
 * @param {string} text The new label.
 */
function setButtonLabel(btn, text) {
  if (typeof btn.getAttribute === "function" && btn.getAttribute("caption") != null) {
    btn.setAttribute("caption", text);
    return;
  }
  btn.textContent = text;
}

/**
 * @typedef {object} ArmedSpec A two-click destructive button.
 * @property {string} labelKey LOC tag of the resting label.
 * @property {string} confirmKey LOC tag shown while armed (the second click performs).
 * @property {() => void} perform The destructive action.
 * @property {Set<() => void>} disarmers Registry of every disarm callback in the row, so pressing
 *   any other button disarms this one.
 */

/**
 * Build a destructive-action button that needs two clicks: the first re-labels the button with the
 * confirm text and adds `is-armed`; the second performs; any other button press, or a timeout,
 * disarms. GameFace has no native dialogs, so this is the only confirmation the player gets.
 * @param {ActionDeps} deps Action dependencies.
 * @param {ArmedSpec} spec The button spec.
 * @returns {HTMLElement} The button.
 */
function armedButton(deps, spec) {
  let armed = false;
  let armedAt = 0;
  let performedAt = 0;
  /** @type {*} */
  let timer = null;
  const label = t(spec.labelKey);
  /** @type {HTMLElement} */
  let btn;
  const disarm = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!armed) return;
    armed = false;
    setButtonLabel(btn, label);
    btn.classList.remove("is-armed");
  };
  btn = deps.makeButton(label, () => {
    const now = Date.now();
    // makeButton fires the handler for both `click` and `action-activate` of one press; the twin
    // of the confirming press must not re-arm the button right after the action ran.
    if (now - performedAt < SAME_PRESS_MS) return;
    for (const d of spec.disarmers) if (d !== disarm) d();
    if (!armed) {
      armed = true;
      armedAt = now;
      setButtonLabel(btn, t(spec.confirmKey));
      btn.classList.add("is-armed");
      timer = setTimeout(disarm, ARM_TIMEOUT_MS);
      return;
    }
    if (now - armedAt < SAME_PRESS_MS) return;
    disarm();
    performedAt = now;
    spec.perform();
  });
  spec.disarmers.add(disarm);
  return btn;
}

/**
 * Clear all persisted history (the armed "Clear history" button's second click).
 * @param {*} ctx Render context.
 */
function clearHistory(ctx) {
  try {
    ctx.storage?.clear?.();
    ctx.requestReload?.();
  } catch (_) {
    // Ignore storage boundary errors.
  }
}

/**
 * Clear only history.wars[] and save (the armed "Reset war history" button's second click).
 * @param {*} ctx Render context.
 */
function resetWarHistory(ctx) {
  try {
    const h = ctx.storage?.load?.();
    if (h) {
      /** @type {*} */ (h).wars = [];
      ctx.storage?.save?.(h);
      ctx.requestReload?.();
    }
  } catch (_) {
    // Ignore storage boundary errors.
  }
}

/**
 * Build kill-switch recovery controls when sampling is paused.
 * @param {*} ctx Render context.
 * @param {ActionDeps} deps Action dependencies.
 * @returns {HTMLElement} The paused-state row.
 */
export function buildSamplerRecoveryRowPanel(ctx, deps) {
  const row = document.createElement("div");
  row.className = "demographics-option-row";
  let paused = false;
  try {
    paused = !!ctx.sampler?.isSamplerDisabled?.();
  } catch (_) {
    // Render empty row when sampler status is unavailable.
  }
  if (!paused) return row;

  const label = document.createElement("div");
  label.className = "demographics-option-label font-body text-sm";
  label.style.marginRight = "0.6rem";
  label.textContent = t("LOC_DEMOGRAPHICS_OPT_SAMPLER_PAUSED");
  row.appendChild(label);

  const reenableBtn = deps.makeButton(t("LOC_DEMOGRAPHICS_OPT_SAMPLER_REENABLE"), () => {
    try {
      ctx.sampler?.reenableSampler?.();
      ctx.requestReload?.();
    } catch (_) {
      // Ignore sampler boundary errors.
    }
  });
  row.appendChild(reenableBtn);
  return row;
}

/**
 * Build the button row (refresh, clear history, reset war history).
 * @param {*} ctx Render context.
 * @param {ActionDeps} deps Action dependencies.
 * @returns {HTMLElement} The button-row element.
 */
export function buildButtonRowPanel(ctx, deps) {
  const btnRow = document.createElement("div");
  btnRow.className = "demographics-options-buttons";
  /** @type {Set<() => void>} */
  const disarmers = new Set();
  btnRow.appendChild(
    deps.makeButton(t("LOC_DEMOGRAPHICS_OPT_REFRESH"), () => {
      for (const d of disarmers) d();
      refreshSampleNow(ctx);
    })
  );
  btnRow.appendChild(armedButton(deps, {
    labelKey: "LOC_DEMOGRAPHICS_OPT_CLEAR",
    confirmKey: "LOC_DEMOGRAPHICS_CONFIRM_CLEAR_HISTORY",
    perform: () => clearHistory(ctx),
    disarmers
  }));
  btnRow.appendChild(armedButton(deps, {
    labelKey: "LOC_DEMOGRAPHICS_OPT_RESET_WARS",
    confirmKey: "LOC_DEMOGRAPHICS_OPT_RESET_WARS_ARMED",
    perform: () => resetWarHistory(ctx),
    disarmers
  }));
  return btnRow;
}
