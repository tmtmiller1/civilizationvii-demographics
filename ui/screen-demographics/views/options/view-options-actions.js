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

/**
 * Confirm a destructive action.
 * @param {string} message Confirmation message.
 * @returns {boolean} True to proceed, false to cancel.
 */
function confirmAction(message) {
  if (typeof window !== "undefined" && typeof window.confirm === "function") {
    return !!window.confirm(message);
  }
  return true;
}

/**
 * Confirm, then clear all persisted history.
 * @param {*} ctx Render context.
 */
function clearHistory(ctx) {
  if (!confirmAction(t("LOC_DEMOGRAPHICS_CONFIRM_CLEAR_HISTORY"))) return;
  try {
    ctx.storage?.clear?.();
    ctx.requestReload?.();
  } catch (_) {
    // Ignore storage boundary errors.
  }
}

/**
 * Confirm, then clear only history.wars[] and save.
 * @param {*} ctx Render context.
 */
function resetWarHistory(ctx) {
  if (!confirmAction(t("LOC_DEMOGRAPHICS_CONFIRM_RESET_WARS"))) return;
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
  btnRow.appendChild(
    deps.makeButton(t("LOC_DEMOGRAPHICS_OPT_REFRESH"), () => refreshSampleNow(ctx))
  );
  btnRow.appendChild(
    deps.makeButton(t("LOC_DEMOGRAPHICS_OPT_CLEAR"), () => clearHistory(ctx))
  );
  btnRow.appendChild(
    deps.makeButton(t("LOC_DEMOGRAPHICS_OPT_RESET_WARS"), () => resetWarHistory(ctx))
  );
  return btnRow;
}
