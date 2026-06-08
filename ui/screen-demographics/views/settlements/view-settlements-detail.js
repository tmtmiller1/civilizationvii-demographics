// view-settlements-detail.js
//
// City detail dossier rendering for the Settlements view.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { safePlaySound } from "/demographics/ui/core/demographics-audio.js";
import { div, fmt, fmtPop, iconEl } from "/demographics/ui/core/ui-helpers.js";
import {
  SETTLEMENT_OUTPUTS
} from "/demographics/ui/screen-demographics/settlements/settlements-data.js";

/**
 * @typedef {{
 *   rerenderContent: (st: *) => void,
 *   buildOwnerAvatar: (owner: *) => HTMLElement,
 *   buildTypeBadge: (isTown: boolean) => HTMLElement,
 *   buildTrendGlyph: (trend: *) => HTMLElement,
 *   buildCameraButtons: (s: *, st: *) => (HTMLElement|null)
 * }} DetailDeps
 */

/**
 * Build a labelled stat chip (optionally with a trailing glyph).
 * @param {string} label The label.
 * @param {string} value The value text.
 * @param {HTMLElement} [glyph] Optional trailing element (e.g. trend).
 * @returns {HTMLElement} The chip.
 */
function buildStatChip(label, value, glyph) {
  const chip = div("demographics-settle-statchip");
  chip.appendChild(div("demographics-settle-statchip-label", label));
  const v = div("demographics-settle-statchip-value", value);
  if (glyph) v.appendChild(glyph);
  chip.appendChild(v);
  return chip;
}

/**
 * The founded value for the dossier ("~year" when approximate, else year, else
 * unknown).
 * @param {*} s The settlement.
 * @returns {string} The founded value.
 */
function foundedValue(s) {
  const f = s.founded;
  if (!f || !f.year) return t("LOC_DEMOGRAPHICS_SETTLEMENTS_FOUNDED_UNKNOWN");
  return f.exact ? f.year : "~" + f.year;
}

/**
 * Build the dossier header: owner avatar + name + badges + rank/score.
 * @param {*} s The settlement.
 * @param {DetailDeps} deps Detail helper callbacks.
 * @returns {HTMLElement} The header.
 */
function buildDetailHeader(s, deps) {
  const header = div("demographics-settle-detail-header");
  if (s.owner.readable || s.owner.primary) {
    header.style.borderColor = s.owner.readable || s.owner.primary;
  }
  header.appendChild(deps.buildOwnerAvatar(s.owner));
  const ht = div("demographics-settle-detail-htext");
  ht.appendChild(div("demographics-settle-detail-name", s.name));
  ht.appendChild(div("demographics-settle-detail-sub", s.owner.leaderName || s.owner.civName || ""));
  const badges = div("demographics-settle-detail-badges");
  badges.appendChild(deps.buildTypeBadge(s.isTown));
  if (s.isCapital) {
    badges.appendChild(
      div(
        "demographics-settle-badge demographics-settle-badge-city",
        t("LOC_DEMOGRAPHICS_SETTLEMENTS_CAPITAL")
      )
    );
  }
  ht.appendChild(badges);
  header.appendChild(ht);
  const rank = div("demographics-settle-detail-rank");
  rank.appendChild(div("demographics-settle-detail-rank-num", "#" + (s.ranks.composite || "—")));
  rank.appendChild(div("demographics-settle-detail-score", fmt(s.composite)));
  header.appendChild(rank);
  return header;
}

/**
 * Build the dossier stat chips (population + trend, founded).
 * @param {*} s The settlement.
 * @param {DetailDeps} deps Detail helper callbacks.
 * @returns {HTMLElement} The stats row.
 */
function buildDetailStats(s, deps) {
  const stats = div("demographics-settle-detail-stats");
  stats.appendChild(
    buildStatChip(
      t("LOC_DEMOGRAPHICS_SETTLEMENTS_COL_POP"),
      fmtPop(s.populationEstimate),
      deps.buildTrendGlyph(s.trend)
    )
  );
  stats.appendChild(
    buildStatChip(t("LOC_DEMOGRAPHICS_SETTLEMENTS_FOUNDED_LABEL"), foundedValue(s))
  );
  return stats;
}

/**
 * Build the dossier per-yield grid (icon + value, native tooltip).
 * @param {*} s The settlement.
 * @returns {HTMLElement} The yields grid.
 */
function buildDetailYields(s) {
  const yields = div("demographics-settle-detail-yields");
  for (const col of SETTLEMENT_OUTPUTS) {
    const item = div("demographics-settle-detail-yield");
    const ic = iconEl(col.icon, "demographics-settle-yield-icon");
    ic.setAttribute("data-tooltip-content", t(col.label));
    item.appendChild(ic);
    item.appendChild(div("demographics-settle-detail-yield-val", fmt(s.outputs[col.id])));
    yields.appendChild(item);
  }
  return yields;
}

/**
 * Build the dossier wonders gallery (icon + name), or a "no wonders" note.
 * @param {*} s The settlement.
 * @returns {HTMLElement} The wonders section.
 */
function buildDetailWonders(s) {
  const section = div("demographics-settle-detail-wonders");
  section.appendChild(
    div(
      "demographics-settle-detail-section-title",
      t("LOC_DEMOGRAPHICS_SETTLEMENTS_WONDERS_TITLE")
    )
  );
  const wonders = Array.isArray(s.wonders) ? s.wonders : [];
  if (!wonders.length) {
    section.appendChild(
      div("demographics-settle-detail-nowonders", t("LOC_DEMOGRAPHICS_SETTLEMENTS_NO_WONDERS"))
    );
    return section;
  }
  const grid = div("demographics-settle-detail-wonder-grid");
  for (const w of wonders) {
    const wc = div("demographics-settle-detail-wonder");
    if (w.icon) wc.appendChild(iconEl(w.icon, "demographics-settle-wonder-icon"));
    wc.appendChild(div("demographics-settle-detail-wonder-name", w.nameKey ? t(w.nameKey) : ""));
    grid.appendChild(wc);
  }
  section.appendChild(grid);
  return section;
}

/**
 * Render the clicked city's detail dossier into the content host.
 * @param {*} st The render state.
 * @param {DetailDeps} deps Detail helper callbacks.
 */
export function renderDetailPanel(st, deps) {
  const s = st.detail;
  if (!s) {
    return;
  }
  const panel = div("demographics-settle-detail");
  const back = div("demographics-settle-back demographics-settle-clickable");
  back.textContent = t("LOC_DEMOGRAPHICS_SETTLEMENTS_BACK");
  back.addEventListener("click", () => {
    st.detail = null;
    safePlaySound("data-audio-activate");
    deps.rerenderContent(st);
  });
  panel.appendChild(back);
  panel.appendChild(buildDetailHeader(s, deps));
  const cams = deps.buildCameraButtons(s, st);
  if (cams) panel.appendChild(cams);
  panel.appendChild(buildDetailStats(s, deps));
  panel.appendChild(buildDetailYields(s));
  panel.appendChild(buildDetailWonders(s));
  st.content.appendChild(panel);
}
