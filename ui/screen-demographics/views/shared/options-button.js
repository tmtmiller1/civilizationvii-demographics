// options-button.js
//
// The persistent "Options" button: opens the native game Options screen (Mods → Demographics),
// the single home for Demographics settings. Rendered at the right of the top-level view-tab row so
// it's
// available on EVERY Demographics tab/page, styled like the chart-toolbar buttons it replaced.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { makeClickable } from "/demographics/ui/core/demographics-a11y.js";
import { safePlaySound } from "/demographics/ui/core/demographics-audio.js";

/**
 * Build the "Options" button. Clicking it opens the native Options screen (Mods → Demographics)
 * via a lazily-imported ContextManager; opening is best-effort (a no-op if the import fails).
 * @returns {HTMLElement} The button element.
 */
export function buildOptionsButton() {
  const btn = document.createElement("div");
  btn.className = "demographics-chart-toolbar-btn font-body text-xs demographics-view-options-btn";
  btn.textContent = t("LOC_DEMOGRAPHICS_TAB_OPTIONS");
  btn.title = t("LOC_DEMOGRAPHICS_TAB_OPTIONS");
  makeClickable(btn, (/** @type {*} */ ev) => {
    ev?.stopPropagation?.();
    safePlaySound("data-audio-activate", "options");
    import("/core/ui/context-manager/context-manager.js")
      .then((m) => {
        const CM = /** @type {*} */ (m.default || m.ContextManager || m);
        CM.push("screen-options", { singleton: true, createMouseGuard: true });
      })
      .catch(() => {
        /* opening the options screen is best-effort */
      });
  });
  return btn;
}
