// options-button.js
//
// The persistent "Options" button: opens the native game Options screen (Mods → Demographics),
// the single home for Demographics settings. Rendered ONCE by screen-demographics.js in the frame
// header (top-right, at title level, left of the close button) so it is on every tab without costing
// a row; styled like the chart-toolbar buttons it replaced.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { makeClickable } from "/demographics/ui/core/demographics-a11y.js";
import { safePlaySound } from "/demographics/ui/core/demographics-audio.js";
import { toLocalPx } from "/demographics/ui/core/demographics-font-ladder.js";

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

/**
 * Put the header Options button on the title's line: vertically centred on the MEASURED title, at
 * the fixed right inset its stylesheet rule sets. Measured rather than a fixed top offset because
 * the title (an engine fxs-header with filigree) has no stable height across scales. Rects are
 * visual px while `top` is the frame's local px, hence the conversion. Safe to call repeatedly.
 * @param {HTMLElement|null|undefined} frame The screen's `.demographics-frame`.
 */
export function alignOptionsHeaderButton(frame) {
  try {
    const btn = /** @type {HTMLElement|null} */ (frame && (frame.querySelector(".demographics-header-right") || frame.querySelector(".demographics-options-header-btn")));
    const title = frame && frame.querySelector(".demographics-title");
    if (!frame || !btn || !title) return;
    const fr = frame.getBoundingClientRect();
    const tr = title.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    if (!(tr.height > 0) || !(br.height > 0)) return;
    btn.style.top = Math.round(toLocalPx((tr.top - fr.top) + tr.height / 2 - br.height / 2)) + "px";
  } catch (_) {
    // Alignment is cosmetic; the stylesheet's fallback top applies if measurement fails.
  }
}
