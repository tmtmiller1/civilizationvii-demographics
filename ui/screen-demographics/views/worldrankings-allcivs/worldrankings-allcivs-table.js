// worldrankings-allcivs-table.js
//
// "All Civilizations" sortable table. Civs are ROWS and every (non-hidden) metric
// is a column, inside a horizontal scroller , the All Settlements table styling,
// made wide. A Rank/Value toggle switches what each metric cell shows; clicking a
// metric header sorts the civilizations by that metric. Rank + Civilization
// columns are sticky-left so identity stays visible while scrolling the metrics.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { div, iconEl } from "/demographics/ui/core/ui-helpers.js";
import { safePlaySound } from "/demographics/ui/core/demographics-audio.js";
import { METRICS } from "/demographics/ui/metrics/demographics-metrics.js";
import { computeRanks } from "/demographics/ui/screen-demographics/views/worldrankings-allcivs/worldrankings-allcivs-profiles.js";
import {
  METRIC_ICONS,
  buildHint,
  formatMetricValue
} from "/demographics/ui/screen-demographics/views/worldrankings-allcivs/worldrankings-allcivs-render.js";

const VIEW_MODES = ["rank", "value"];

/** @returns {*[]} Non-hidden metrics, in display order. */
function visibleMetrics() {
  return /** @type {*[]} */ (METRICS).filter((m) => !m.worldRankingsAllCivsHidden);
}

/**
 * Read a persisted setting defensively.
 * @param {*} ctx Render context.
 * @param {string} key Setting key.
 * @param {*} fb Fallback.
 * @returns {*} The stored value or fallback.
 */
function getSetting(ctx, key, fb) {
  try {
    const v = ctx?.settings?.getSetting?.(key, fb);
    return v === undefined || v === null ? fb : v;
  } catch (_) {
    return fb;
  }
}

/**
 * Write a persisted setting (best-effort).
 * @param {*} ctx Render context.
 * @param {string} key Setting key.
 * @param {*} value Value to store.
 */
function setSetting(ctx, key, value) {
  try {
    ctx?.settings?.setSetting?.(key, value);
  } catch (_) {
    // best-effort persistence
  }
}

/**
 * Resolve the active view mode ("rank"/"value").
 * @param {*} ctx Render context.
 * @returns {string} The mode.
 */
function readMode(ctx) {
  const m = getSetting(ctx, "worldRankingsAllCivsViewMode", "rank");
  return VIEW_MODES.includes(m) ? m : "rank";
}

/**
 * Resolve the active sort metric id, validated against the visible metrics.
 * @param {*} ctx Render context.
 * @param {*[]} metrics Visible metrics.
 * @returns {string} The sort key.
 */
function readSortKey(ctx, metrics) {
  const k = getSetting(ctx, "worldRankingsAllCivsSortKey", "score");
  return metrics.some((m) => m.id === k) ? k : (metrics[0]?.id || "score");
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
 * Sort pids by a metric value, descending; civs missing the value sort last.
 * @param {Record<string, *>} profiles Profile map.
 * @param {string} sortKey Metric id to sort by.
 * @returns {string[]} Sorted pids.
 */
function sortPids(profiles, sortKey) {
  return Object.keys(profiles).sort((a, b) => {
    const va = metricValue(profiles[a], sortKey);
    const vb = metricValue(profiles[b], sortKey);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return vb - va;
  });
}

/**
 * Precompute per-metric ranks (pid -> rank).
 * @param {Record<string, *>} profiles Profile map.
 * @param {*[]} metrics Visible metrics.
 * @returns {Map<string, *>} metricId -> { ranks, total }.
 */
function buildRanksCache(profiles, metrics) {
  const cache = new Map();
  for (const m of metrics) cache.set(m.id, computeRanks(profiles, m.id));
  return cache;
}

/**
 * Rank of a pid for a metric, as a display string ("—" when unranked).
 * @param {Map<string, *>} cache Ranks cache.
 * @param {string} metricId Metric id.
 * @param {string} pid Player id.
 * @returns {string} The rank text.
 */
function rankOf(cache, metricId, pid) {
  const r = cache.get(metricId)?.ranks.get(pid);
  return typeof r === "number" ? String(r) : "—";
}

/**
 * The metric cell's text for the current view mode.
 * @param {*} profile Civ profile.
 * @param {*} metric Metric def.
 * @param {string} mode View mode.
 * @param {Map<string, *>} cache Ranks cache.
 * @returns {string} The cell text.
 */
function cellText(profile, metric, mode, cache) {
  if (mode === "rank") return rankOf(cache, metric.id, profile.pid);
  return formatMetricValue(metric, profile.latest?.[metric.id]);
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
  const name = masked ? t("LOC_DEMOGRAPHICS_UNMET_CIV") : profile.civName || profile.leaderName || "—";
  const id = div("demographics-settle-leader-id");
  id.appendChild(buildCivAvatar(profile, masked));
  const names = div("demographics-settle-leader-idnames");
  names.appendChild(div("demographics-settle-leader-name", name));
  names.appendChild(div("demographics-settle-leader-val", masked ? "" : profile.leaderName || ""));
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
    div("demographics-settle-leader-cat", t("LOC_DEMOGRAPHICS_SETTLEMENTS_BEST_IN", metric.label))
  );
  return card;
}

/**
 * Build the category-leaders strip (one card per metric, leading civ).
 * @param {Record<string, *>} profiles Profile map.
 * @param {*[]} metrics Visible metrics.
 * @param {boolean} showUnmetNames Whether unmet identities are shown.
 * @returns {HTMLElement} The strip.
 */
function buildLeadersStrip(profiles, metrics, showUnmetNames) {
  const strip = div("demographics-settle-leaders");
  for (const m of metrics) {
    const pid = bestPidFor(profiles, m.id);
    if (pid) strip.appendChild(buildLeaderCard(m, profiles[pid], showUnmetNames));
  }
  return strip;
}

/**
 * Build the Rank/Value toggle chip row.
 * @param {string} mode Current mode.
 * @param {(mode: string) => void} onChange Change handler.
 * @returns {HTMLElement} The chip row.
 */
function buildToggleRow(mode, onChange) {
  const row = div("demographics-settle-filters demographics-civtable-toggle");
  const opts = [
    ["rank", "LOC_DEMOGRAPHICS_WORLDRANKINGS_ALLCIVS_RANK"],
    ["value", "LOC_DEMOGRAPHICS_WORLDRANKINGS_ALLCIVS_VIEW_VALUE"]
  ];
  for (const [key, loc] of opts) {
    const chip = div("demographics-chart-time-filter-pill" + (mode === key ? " is-active" : ""));
    chip.textContent = t(loc);
    chip.addEventListener("click", () => {
      if (mode === key) return;
      safePlaySound("data-audio-activate");
      onChange(key);
    });
    row.appendChild(chip);
  }
  return row;
}

/**
 * Build a non-sortable fixed header cell.
 * @param {string} cls Column class.
 * @param {string} label Header label.
 * @returns {HTMLElement} The header cell.
 */
function fixedHeader(cls, label) {
  const cell = div("demographics-settle-th " + cls);
  cell.appendChild(div("demographics-settle-th-label", label));
  return cell;
}

/**
 * Build a sortable metric header cell (icon + label).
 * @param {*} metric Metric def.
 * @param {string} sortKey Active sort key.
 * @param {(key: string) => void} onSort Sort handler.
 * @returns {HTMLElement} The header cell.
 */
function buildMetricHeader(metric, sortKey, onSort) {
  const inner = div("demographics-settle-th-inner");
  const icon = METRIC_ICONS[metric.id];
  if (icon) inner.appendChild(iconEl(icon, "demographics-settle-yield-icon"));
  inner.appendChild(div("demographics-settle-th-label", metric.label));
  const cell = div(
    "demographics-settle-th demographics-civtable-metric" +
      (sortKey === metric.id ? " is-sorted" : "")
  );
  cell.appendChild(inner);
  cell.addEventListener("click", () => {
    if (sortKey === metric.id) return;
    safePlaySound("data-audio-activate");
    onSort(metric.id);
  });
  return cell;
}

/**
 * Build the table header row.
 * @param {*[]} metrics Visible metrics.
 * @param {string} sortKey Active sort key.
 * @param {(key: string) => void} onSort Sort handler.
 * @returns {HTMLElement} The header row.
 */
function buildHeaderRow(metrics, sortKey, onSort) {
  const row = div("demographics-settle-row demographics-settle-header");
  row.appendChild(fixedHeader("demographics-settle-col-rank", t("LOC_DEMOGRAPHICS_WORLDRANKINGS_ALLCIVS_RANK")));
  row.appendChild(
    fixedHeader("demographics-civtable-col-civ", t("LOC_DEMOGRAPHICS_SETTLEMENTS_COL_CIV"))
  );
  for (const m of metrics) row.appendChild(buildMetricHeader(m, sortKey, onSort));
  return row;
}

/**
 * Build the civ identity avatar using the EXACT All Settlements owner-avatar
 * classes/colors (a civ-colored 3.6rem disc holding the LEADER portrait, or an
 * initial-letter placeholder), so this column renders identically to the All
 * Settlements owner column.
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
  return div("demographics-settle-avatar-initial", initial);
}

/**
 * Build the civilization identity cell using the EXACT same DOM/classes as the
 * All Settlements owner column (`.demographics-settle-owner` → avatar + names),
 * so the two tables' leader columns look and lay out identically.
 * @param {*} profile Civ profile.
 * @param {boolean} masked Whether to mask the identity.
 * @returns {HTMLElement} The civ cell.
 */
function buildCivCell(profile, masked) {
  const cell = div(
    "demographics-settle-td demographics-civtable-col-civ demographics-civtable-civ"
  );
  const owner = div("demographics-settle-owner");
  owner.appendChild(buildCivAvatar(profile, masked));
  const names = div("demographics-settle-owner-names");
  const leaderName = masked
    ? t("LOC_DEMOGRAPHICS_WORLDRANKINGS_ALLCIVS_UNMET_LEADER")
    : profile.leaderName || "—";
  names.appendChild(div("demographics-settle-owner-leader", leaderName));
  const civName = masked ? t("LOC_DEMOGRAPHICS_UNMET_CIV") : profile.civName;
  if (civName) names.appendChild(div("demographics-settle-owner-civ", civName));
  owner.appendChild(names);
  cell.appendChild(owner);
  return cell;
}

/**
 * Build one civilization data row.
 * @param {*} profile Civ profile.
 * @param {{ mode: string, sortKey: string, metrics: *[], cache: Map<string, *>,
 *   showUnmetNames: boolean }} opts Row config.
 * @returns {HTMLElement} The row.
 */
function buildDataRow(profile, opts) {
  const { mode, sortKey, metrics, cache, showUnmetNames } = opts;
  const masked = isMasked(profile, showUnmetNames);
  const row = div("demographics-settle-row demographics-settle-datarow");
  if (profile.primaryColor && !masked) {
    row.style.setProperty("border-left-color", profile.primaryColor);
  }
  row.appendChild(
    div("demographics-settle-td demographics-settle-col-rank", rankOf(cache, sortKey, profile.pid))
  );
  row.appendChild(buildCivCell(profile, masked));
  for (const m of metrics) {
    const cls =
      "demographics-settle-td demographics-civtable-metric" +
      (sortKey === m.id ? " is-sorted" : "");
    row.appendChild(div(cls, cellText(profile, m, mode, cache)));
  }
  return row;
}

/**
 * Render the All Civilizations table into `host`.
 * @param {HTMLElement} host View host (already cleared).
 * @param {Record<string, *>} profiles Civ profile map.
 * @param {*} ctx Render context (history + settings).
 * @param {boolean} showUnmetNames Whether unmet identities are shown.
 * @param {() => void} rerender Re-render callback (for toggle / sort changes).
 */
export function renderCivTable(host, profiles, ctx, showUnmetNames, rerender) {
  const metrics = visibleMetrics();
  const mode = readMode(ctx);
  const sortKey = readSortKey(ctx, metrics);
  const cache = buildRanksCache(profiles, metrics);

  host.appendChild(buildHint());
  host.appendChild(
    buildToggleRow(mode, (/** @type {string} */ m) => {
      setSetting(ctx, "worldRankingsAllCivsViewMode", m);
      rerender();
    })
  );
  host.appendChild(buildSectionTitle("LOC_DEMOGRAPHICS_SETTLEMENTS_LEADERS_TITLE"));
  host.appendChild(buildLeadersStrip(profiles, metrics, showUnmetNames));
  host.appendChild(buildSectionTitle("LOC_DEMOGRAPHICS_SETTLEMENTS_TAB_CIVS"));
  const onSort = (/** @type {string} */ k) => {
    setSetting(ctx, "worldRankingsAllCivsSortKey", k);
    rerender();
  };
  const scroll = div("demographics-worldrankings-allcivs-matrix demographics-civtable-scroll");
  const table = div("demographics-settle-table demographics-civtable");
  table.appendChild(buildHeaderRow(metrics, sortKey, onSort));
  for (const pid of sortPids(profiles, sortKey)) {
    table.appendChild(
      buildDataRow(profiles[pid], { mode, sortKey, metrics, cache, showUnmetNames })
    );
  }
  scroll.appendChild(table);
  host.appendChild(scroll);
}
