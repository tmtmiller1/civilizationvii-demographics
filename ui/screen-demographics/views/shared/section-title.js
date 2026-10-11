// section-title.js
//
// The filigree section title shared by the Settlements and World Rankings views.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { div, iconEl } from "/demographics/ui/core/ui-helpers.js";

/**
 * Build a stylized section title with flanking filigree (mimics the elaborate Civ VII menu
 * headers).
 * @param {string} key The title LOC key.
 * @returns {HTMLElement}
 */
export function buildSectionTitle(key) {
  const wrap = div("demographics-settle-section-title");
  // Both flourishes stay in the DOM: the ranking-list heading lays them out LEFT and RIGHT of the
  // title (symmetric), while the podium column stacks them ABOVE and BELOW. The podium's top one is
  // hidden in CSS (.demographics-settle-split-left ... :first-child) - it spent a row over both
  // "Greatest" headings for no information.
  wrap.appendChild(iconEl("blp:header_filigree", "demographics-settle-section-fil"));
  wrap.appendChild(div("demographics-settle-section-title-text font-title", t(key)));
  wrap.appendChild(
    iconEl("blp:header_filigree", "demographics-settle-section-fil demographics-settle-section-fil-r")
  );
  return wrap;
}
