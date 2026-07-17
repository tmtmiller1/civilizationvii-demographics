// worldrankings-allcivs-leaders.js
//
// The "category leaders" strip shown ABOVE the All Civilizations matrix: one card
// per metric naming the civilization that leads it (metric icon + leading value +
// leader/civ identity). It reuses the EXACT `.demographics-settle-leader-*` styling
// as the All Settlements "rank by category" panel, so the two read identically.

import { div, iconEl } from "/demographics/ui/core/ui-helpers.js";
import { safeTextColor } from "/demographics/ui/core/civ-color-utils.js";
import { orderedNames } from "/demographics/ui/core/player-label.js";
import { t } from "/demographics/ui/core/demographics-i18n.js";
import { METRICS, localizedMetricName } from "/demographics/ui/metrics/demographics-metrics.js";
import {
  METRIC_ICONS,
  formatMetricValue
} from "/demographics/ui/screen-demographics/views/worldrankings-allcivs/worldrankings-allcivs-render.js";

/** @returns {*[]} Non-hidden metrics (the scaled/canonical set), in display order. */
function visibleMetrics() {
  return /** @type {*[]} */ (METRICS).filter((m) => !m.worldRankingsAllCivsHidden);
}

/**
 * Whether to mask this civ's identity (unmet + names hidden).
 * @param {*} profile Civ profile.
 * @param {boolean} showUnmetNames Whether unmet names are shown.
 * @returns {boolean} True when masked.
 */
function isMasked(profile, showUnmetNames) {
  return !showUnmetNames && profile.met === false;
}

/**
 * Latest finite metric value, or null.
 * @param {*} profile Civ profile.
 * @param {string} id Metric id.
 * @returns {number|null} The value or null.
 */
function metricValue(profile, id) {
  const v = profile.latest?.[id];
  return typeof v === "number" && isFinite(v) ? v : null;
}

/**
 * The pid leading a metric (highest value), or null.
 * @param {Record<string, *>} profiles Profile map.
 * @param {string} metricId Metric id.
 * @returns {string|null} The leading pid.
 */
function bestPidFor(profiles, metricId) {
  let best = null;
  let bestV = -Infinity;
  for (const pid of Object.keys(profiles)) {
    const v = metricValue(profiles[pid], metricId);
    if (v !== null && v > bestV) {
      bestV = v;
      best = pid;
    }
  }
  return best;
}

/**
 * Build the civ identity avatar using the EXACT All Settlements owner-avatar
 * classes/colors (a civ-colored disc holding the LEADER portrait, or an
 * initial-letter placeholder).
 * @param {*} profile Civ profile.
 * @param {boolean} masked Whether to mask the identity (force the placeholder).
 * @returns {HTMLElement} The avatar element.
 */
function buildCivAvatar(profile, masked) {
  const wrap = div("demographics-settle-avatar");
  if (!masked && profile.primaryColor) wrap.style.backgroundColor = profile.primaryColor;
  if (!masked && profile.secondaryColor) wrap.style.borderColor = profile.secondaryColor;
  const leaderType = masked ? undefined : profile.leaderTypeString;
  if (leaderType && /^LEADER_/.test(leaderType)) {
    const portrait = document.createElement("fxs-icon");
    portrait.setAttribute("data-icon-id", leaderType);
    portrait.setAttribute("data-icon-context", "LEADER");
    portrait.className = "demographics-settle-portrait";
    wrap.appendChild(portrait);
  } else {
    wrap.appendChild(civAvatarInitial(profile, masked));
  }
  return wrap;
}

/**
 * Build the initial-letter avatar placeholder (matches the All Settlements one).
 * @param {*} profile Civ profile.
 * @param {boolean} masked Whether the identity is masked.
 * @returns {HTMLElement} The placeholder element.
 */
function civAvatarInitial(profile, masked) {
  const src = masked ? "?" : profile.leaderName || profile.civName || "?";
  const initial = src.trim().charAt(0).toUpperCase() || "?";
  const el = div("demographics-settle-avatar-initial", initial);
  if (!masked && profile.primaryColor) el.style.color = safeTextColor(profile.primaryColor);
  return el;
}

/**
 * Build a filigree section title (matches the settlements section headers).
 * @param {string} key Localization key for the title.
 * @returns {HTMLElement} The section title.
 */
function buildSectionTitle(key) {
  const wrap = div("demographics-settle-section-title");
  wrap.appendChild(iconEl("blp:header_filigree", "demographics-settle-section-fil"));
  wrap.appendChild(div("demographics-settle-section-title-text font-title", t(key)));
  wrap.appendChild(
    iconEl("blp:header_filigree", "demographics-settle-section-fil demographics-settle-section-fil-r")
  );
  return wrap;
}

/**
 * Build one "category leader" card (metric icon + leading value + leading civ).
 * @param {*} metric Metric def.
 * @param {*} profile Leading civ profile.
 * @param {boolean} showUnmetNames Whether unmet identities are shown.
 * @returns {HTMLElement} The leader card.
 */
function buildLeaderCard(metric, profile, showUnmetNames) {
  const masked = isMasked(profile, showUnmetNames);
  const card = div("demographics-settle-leader-card");
  // Identity FIRST: leader portrait + civ name on top, leader just beneath it; the
  // metric icon + value and the "#1 <metric>" label follow below.
  const [primary, secondary] = orderedNames(profile.leaderName, profile.civName);
  const name = masked ? t("LOC_DEMOGRAPHICS_UNMET_CIV") : primary || "—";
  const id = div("demographics-settle-leader-id");
  id.appendChild(buildCivAvatar(profile, masked));
  const names = div("demographics-settle-leader-idnames");
  names.appendChild(div("demographics-settle-leader-name", name));
  names.appendChild(div("demographics-settle-leader-val", masked ? "" : secondary));
  id.appendChild(names);
  card.appendChild(id);
  const head = div("demographics-settle-leader-head");
  const icon = METRIC_ICONS[metric.id];
  if (icon) head.appendChild(iconEl(icon, "demographics-settle-leader-icon"));
  head.appendChild(
    div("demographics-settle-leader-headval", formatMetricValue(metric, profile.latest?.[metric.id]))
  );
  card.appendChild(head);
  card.appendChild(
    div("demographics-settle-leader-cat", t("LOC_DEMOGRAPHICS_SETTLEMENTS_BEST_IN", localizedMetricName(metric)))
  );
  return card;
}

/**
 * Build the category-leaders section (filigree title + one card per metric for the
 * civ leading it), for mounting above the All Civilizations matrix. Returns null
 * when no card can be built (no profiles / no metric data).
 * @param {Record<string, *>} profiles Civ profile map.
 * @param {boolean} showUnmetNames Whether unmet identities are shown.
 * @returns {HTMLElement|null} The section element, or null when empty.
 */
export function buildLeadersSection(profiles, showUnmetNames) {
  const strip = div("demographics-settle-leaders");
  for (const m of visibleMetrics()) {
    const pid = bestPidFor(profiles, m.id);
    if (pid) strip.appendChild(buildLeaderCard(m, profiles[pid], showUnmetNames));
  }
  if (!strip.firstChild) return null;
  const wrap = div("demographics-worldrankings-allcivs-leaders-section");
  wrap.appendChild(buildSectionTitle("LOC_DEMOGRAPHICS_SETTLEMENTS_LEADERS_TITLE"));
  wrap.appendChild(strip);
  return wrap;
}
