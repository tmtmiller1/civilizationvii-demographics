// worldrankings-allcivs-table.js
//
// "All Civilizations" sortable table: civs are rows and every non-hidden metric
// is a column, with a Rank/Value toggle and click-to-sort metric headers. It is
// the "table" branch of the responsive hybrid in view-worldrankings-allcivs.js,
// chosen when there is enough width for readable metric-column headers.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { orderedNames } from "/demographics/ui/core/player-label.js";
import { buildNameLine, div, iconEl } from "/demographics/ui/core/ui-helpers.js";
import { safeTextColor } from "/demographics/ui/core/civ-color-utils.js";
import { safePlaySound } from "/demographics/ui/core/demographics-audio.js";
import { METRICS, localizedMetricName } from "/demographics/ui/metrics/demographics-metrics.js";
import {
  computeRanks,
  leadsMetric,
  pickLocalPid
} from "/demographics/ui/screen-demographics/views/worldrankings-allcivs/worldrankings-allcivs-profiles.js";
import {
  METRIC_ICONS,
  formatMetricValue
} from "/demographics/ui/screen-demographics/views/worldrankings-allcivs/worldrankings-allcivs-render.js";
import { setClass } from "/demographics/ui/screen-demographics/screen/dom-helpers.js";
import { buildSectionTitle } from "/demographics/ui/screen-demographics/views/shared/section-title.js";

const VIEW_MODES = ["rank", "value"];

/** @returns {*[]} Non-hidden metrics, in display order. */
function visibleMetrics() {
  return /** @type {*[]} */ (METRICS).filter((metric) => !metric.worldRankingsAllCivsHidden);
}

/**
 * @param {*} ctx
 * @param {string} key
 * @param {*} fallback
 */
function getSetting(ctx, key, fallback) {
  try {
    const value = ctx?.settings?.getSetting?.(key, fallback);
    return value === undefined || value === null ? fallback : value;
  } catch (_) {
    return fallback;
  }
}

/**
 * @param {*} ctx
 * @param {string} key
 * @param {*} value
 */
function setSetting(ctx, key, value) {
  try {
    ctx?.settings?.setSetting?.(key, value);
  } catch (_) {
    // best-effort persistence
  }
}

/**
 * @param {*} ctx
 * @returns {string}
 */
function readMode(ctx) {
  const mode = getSetting(ctx, "worldRankingsAllCivsViewMode", "rank");
  return VIEW_MODES.includes(mode) ? mode : "rank";
}

/**
 * @param {*} ctx
 * @param {*[]} metrics
 * @returns {string}
 */
function readSortKey(ctx, metrics) {
  const sortKey = getSetting(ctx, "worldRankingsAllCivsSortKey", "score");
  return metrics.some((metric) => metric.id === sortKey) ? sortKey : (metrics[0]?.id || "score");
}

/**
 * @param {*} profile
 * @param {boolean} showUnmetNames
 */
function isMasked(profile, showUnmetNames) {
  return !showUnmetNames && profile.met === false;
}

/**
 * @param {*} profile
 * @param {string} id
 */
function metricValue(profile, id) {
  const value = profile.latest?.[id];
  return typeof value === "number" && isFinite(value) ? value : null;
}

/**
 * @param {Record<string, *>} profiles
 * @param {string} sortKey
 */
function sortPids(profiles, sortKey) {
  return Object.keys(profiles).sort((a, b) => {
    const valueA = metricValue(profiles[a], sortKey);
    const valueB = metricValue(profiles[b], sortKey);
    if (valueA === null && valueB === null) return 0;
    if (valueA === null) return 1;
    if (valueB === null) return -1;
    return valueB - valueA;
  });
}

/**
 * @param {Record<string, *>} profiles
 * @param {*[]} metrics
 */
function buildRanksCache(profiles, metrics) {
  const cache = new Map();
  for (const metric of metrics) cache.set(metric.id, computeRanks(profiles, metric.id));
  return cache;
}

/**
 * @param {Map<string, *>} cache
 * @param {string} metricId
 * @param {string} pid
 */
function rankOf(cache, metricId, pid) {
  const rank = cache.get(metricId)?.ranks.get(pid);
  return typeof rank === "number" ? String(rank) : "—";
}

/**
 * The data row's class list: the shared World Rankings row look, a gold / silver /
 * bronze wash for places 1-3 in the ACTIVE sort (ties share a place), and the
 * local player's gold outline.
 * @param {Map<string, *>} cache
 * @param {string} sortKey
 * @param {string} pid
 * @param {boolean} isLocal
 * @returns {string}
 */
function dataRowClass(cache, sortKey, pid, isLocal) {
  let cls = "demographics-settle-row demographics-settle-datarow";
  const rank = cache.get(sortKey)?.ranks.get(pid);
  if (typeof rank === "number" && rank >= 1 && rank <= 3) cls += " demographics-settle-medalrow-" + rank;
  return isLocal ? cls + " is-local" : cls;
}

/**
 * @param {*} profile
 * @param {*} metric
 * @param {string} mode
 * @param {Map<string, *>} cache
 */
function cellText(profile, metric, mode, cache) {
  if (mode === "rank") return rankOf(cache, metric.id, profile.pid);
  return formatMetricValue(metric, profile.latest?.[metric.id]);
}

/**
 * Build the Rank/Value toggle chip row. The chips are built once and registered in `ui`; their
 * active state is a class toggle in {@link applyCivTableState}, and the guard reads the LIVE mode
 * off `ui.state` (a captured one would go stale the moment the chip outlives a re-render).
 * @param {CivTableUi} ui
 * @param {(mode: string) => void} onChange
 * @returns {HTMLElement}
 */
function buildToggleRow(ui, onChange) {
  const row = div("demographics-settle-filters demographics-civtable-toggle");
  const opts = [
    ["rank", "LOC_DEMOGRAPHICS_WORLDRANKINGS_ALLCIVS_RANK"],
    ["value", "LOC_DEMOGRAPHICS_WORLDRANKINGS_ALLCIVS_VIEW_VALUE"]
  ];
  for (const [key, loc] of opts) {
    const chip = div("demographics-chart-time-filter-pill");
    chip.textContent = t(loc);
    chip.addEventListener("click", () => {
      if (ui.state.mode === key) return;
      safePlaySound("data-audio-activate");
      onChange(key);
    });
    ui.chips.set(key, chip);
    row.appendChild(chip);
  }
  return row;
}

/**
 * @param {string} cls
 * @param {string} label
 */
function fixedHeader(cls, label) {
  const cell = div("demographics-settle-th " + cls);
  cell.appendChild(div("demographics-settle-th-label", label));
  return cell;
}

/**
 * Build a sortable metric header cell (icon + label). Built once and registered in `ui`; its
 * sorted state is a class toggle in {@link applyCivTableState}.
 * @param {*} metric
 * @param {CivTableUi} ui
 * @param {(key: string) => void} onSort
 * @returns {HTMLElement}
 */
function buildMetricHeader(metric, ui, onSort) {
  const inner = div("demographics-settle-th-inner");
  const icon = METRIC_ICONS[metric.id];
  if (icon) inner.appendChild(iconEl(icon, "demographics-settle-yield-icon"));
  inner.appendChild(div("demographics-settle-th-label", localizedMetricName(metric)));
  const cell = div("demographics-settle-th demographics-civtable-metric");
  cell.appendChild(inner);
  cell.addEventListener("click", () => {
    if (ui.state.sortKey === metric.id) return;
    safePlaySound("data-audio-activate");
    onSort(metric.id);
  });
  ui.heads.set(metric.id, cell);
  return cell;
}

/**
 * @param {*[]} metrics
 * @param {CivTableUi} ui
 * @param {(key: string) => void} onSort
 */
function buildHeaderRow(metrics, ui, onSort) {
  const row = div("demographics-settle-row demographics-settle-header");
  row.appendChild(
    fixedHeader("demographics-settle-col-rank", t("LOC_DEMOGRAPHICS_WORLDRANKINGS_ALLCIVS_RANK"))
  );
  row.appendChild(
    fixedHeader("demographics-civtable-col-civ", t("LOC_DEMOGRAPHICS_SETTLEMENTS_COL_CIV"))
  );
  for (const metric of metrics) row.appendChild(buildMetricHeader(metric, ui, onSort));
  return row;
}

/**
 * Build the civ identity avatar with the All Settlements owner-avatar classes
 * (a civ-colored disc holding the leader portrait, or an initial-letter placeholder).
 * @param {*} profile
 * @param {boolean} masked Whether to mask the identity (force the placeholder).
 * @returns {HTMLElement}
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
 * @param {*} profile
 * @param {boolean} masked
 * @returns {HTMLElement}
 */
function civAvatarInitial(profile, masked) {
  const src = masked ? "?" : profile.civName || profile.leaderName || "?";
  const initial = src.trim().charAt(0).toUpperCase() || "?";
  const el = div("demographics-settle-avatar-initial", initial);
  if (!masked && profile.primaryColor) el.style.color = safeTextColor(profile.primaryColor);
  return el;
}

/**
 * Build the civilization identity cell using the same DOM/classes as the All
 * Settlements owner column: the prominent ".-owner-leader" class carries the
 * civ name and the smaller ".-owner-civ" carries the leader beneath it.
 * @param {*} profile
 * @param {boolean} masked
 * @returns {HTMLElement}
 */
function buildCivCell(profile, masked) {
  const cell = div(
    "demographics-settle-td demographics-civtable-col-civ demographics-civtable-civ"
  );
  const owner = div("demographics-settle-owner");
  owner.appendChild(buildCivAvatar(profile, masked));
  const names = div("demographics-settle-owner-names");
  if (masked) {
    names.appendChild(
      div("demographics-settle-owner-leader", t("LOC_DEMOGRAPHICS_UNMET_CIV"))
    );
    names.appendChild(
      div("demographics-settle-owner-civ", t("LOC_DEMOGRAPHICS_WORLDRANKINGS_ALLCIVS_UNMET_LEADER"))
    );
  } else {
    const [primary, secondary] = orderedNames(profile.leaderName, profile.civName);
    names.appendChild(buildNameLine("demographics-settle-owner-leader", primary || "—"));
    if (secondary) names.appendChild(buildNameLine("demographics-settle-owner-civ", secondary));
  }
  owner.appendChild(names);
  cell.appendChild(owner);
  return cell;
}

/**
 * @param {*} profile
 * @param {*} metric
 * @param {{ mode: string, sortKey: string, cache: Map<string, *> }} opts
 */
function buildMetricCell(profile, metric, opts) {
  const lead = leadsMetric(opts.cache.get(metric.id), profile.pid);
  const cls =
    "demographics-settle-td demographics-civtable-metric" +
    (opts.sortKey === metric.id ? " is-sorted" : "") +
    (lead ? " is-leader" : "");
  const cell = div(cls, cellText(profile, metric, opts.mode, opts.cache));
  if (lead) {
    cell.setAttribute(
      "data-tooltip-content",
      t("LOC_DEMOGRAPHICS_SETTLEMENTS_WORLD_LEADER_TOOLTIP", localizedMetricName(metric))
    );
  }
  return cell;
}

/**
 * Build one civilization data row, returning the metric cells alongside it. Keeping the cells
 * addressable is what lets a Rank/Value switch rewrite their text in place instead of rebuilding
 * the row; the row holds the civ's leader portrait, which would otherwise re-resolve and blink.
 * @param {string} pid The profile's map key.
 * @param {*} profile
 * @param {{ mode: string, sortKey: string, metrics: *[], cache: Map<string, *>,
 *   showUnmetNames: boolean, localPid: string }} opts Row config.
 * @returns {CivTableRow}
 */
function buildDataRow(pid, profile, opts) {
  const { sortKey, metrics, cache, showUnmetNames, localPid } = opts;
  const masked = isMasked(profile, showUnmetNames);
  const el = div(dataRowClass(cache, sortKey, profile.pid, profile.pid === localPid));
  if (profile.primaryColor && !masked) {
    el.style.setProperty("border-left-color", profile.primaryColor);
  }
  el.appendChild(
    div("demographics-settle-td demographics-settle-col-rank", rankOf(cache, sortKey, profile.pid))
  );
  el.appendChild(buildCivCell(profile, masked));
  /** @type {HTMLElement[]} */
  const cells = [];
  for (const metric of metrics) {
    const cell = buildMetricCell(profile, metric, opts);
    cells.push(cell);
    el.appendChild(cell);
  }
  return { pid, el, cells };
}

/** @typedef {{ pid: string, el: HTMLElement, cells: HTMLElement[] }} CivTableRow */

/**
 * One rendered civ table: its scroll frame's table element, the metrics it columns, and its
 * current data rows. The header row (and the metric icons in it) lives in `table` and is never
 * rebuilt; only `rows` is swapped.
 * @typedef {{ table: HTMLElement, metrics: *[], rows: CivTableRow[] }} CivTableBlock
 */

/**
 * Live handles to the page's persistent chrome. Rebuilding that chrome is what made the filigree
 * section titles and the metric-column icons blink: a fresh element's `blp:` background resolves a
 * frame or more after it is inserted, so identical chrome visibly flashed on every Rank/Value or
 * sort click. Everything here is built once per render and only ever has classes toggled on it.
 * @typedef {{
 *   chips: Map<string, HTMLElement>,
 *   heads: Map<string, HTMLElement>,
 *   blocks: CivTableBlock[],
 *   state: { mode: string, sortKey: string },
 *   profiles: Record<string, *>,
 *   cache: Map<string, *>,
 *   showUnmetNames: boolean,
 *   localPid: string
 * }} CivTableUi
 */

/**
 * Push the live Rank/Value mode and sort key onto the existing DOM: chip + header state classes,
 * and each metric cell's text and sorted class. Nothing is created or destroyed, so this alone
 * serves a Rank/Value switch (which changes what every cell READS, not which rows exist).
 * @param {CivTableUi} ui
 */
function applyCivTableState(ui) {
  for (const [key, chip] of ui.chips) setClass(chip, "is-active", key === ui.state.mode);
  for (const [key, cell] of ui.heads) setClass(cell, "is-sorted", key === ui.state.sortKey);
  for (const block of ui.blocks) {
    for (const row of block.rows) {
      const profile = ui.profiles[row.pid];
      if (!profile) continue;
      for (let i = 0; i < block.metrics.length; i++) {
        const metric = block.metrics[i];
        const cell = row.cells[i];
        if (!cell) continue;
        cell.textContent = cellText(profile, metric, ui.state.mode, ui.cache);
        setClass(cell, "is-sorted", metric.id === ui.state.sortKey);
      }
    }
  }
}

/**
 * Swap every block's data rows into the current sort order. Only the rows are replaced; each
 * block's header row, its icons, and the filigree titles around it stay in the DOM untouched.
 * @param {CivTableUi} ui
 */
function fillCivTableRows(ui) {
  const pids = sortPids(ui.profiles, ui.state.sortKey);
  for (const block of ui.blocks) {
    for (const row of block.rows) {
      if (row.el.parentNode === block.table) block.table.removeChild(row.el);
    }
    block.rows.length = 0;
    for (const pid of pids) {
      const row = buildDataRow(pid, ui.profiles[pid], {
        mode: ui.state.mode,
        sortKey: ui.state.sortKey,
        metrics: block.metrics,
        cache: ui.cache,
        showUnmetNames: ui.showUnmetNames,
        localPid: ui.localPid
      });
      block.rows.push(row);
      block.table.appendChild(row.el);
    }
  }
}

/**
 * Render the All Civilizations table into `host`. The chrome (toggle chips, filigree titles,
 * header rows) is built once here; a later Rank/Value or sort click updates it in place through
 * {@link applyCivTableState} / {@link fillCivTableRows} rather than re-rendering the page.
 * @param {HTMLElement} host View host (already cleared).
 * @param {Record<string, *>} profiles
 * @param {*} ctx Render context (history + settings).
 * @param {boolean} showUnmetNames
 */
export function renderCivTable(host, profiles, ctx, showUnmetNames) {
  const metrics = visibleMetrics();
  /** @type {CivTableUi} */
  const ui = {
    chips: new Map(),
    heads: new Map(),
    blocks: [],
    state: { mode: readMode(ctx), sortKey: readSortKey(ctx, metrics) },
    profiles,
    cache: buildRanksCache(profiles, metrics),
    showUnmetNames,
    localPid: pickLocalPid(profiles, Object.keys(profiles))
  };

  host.appendChild(
    buildToggleRow(ui, (/** @type {string} */ nextMode) => {
      setSetting(ctx, "worldRankingsAllCivsViewMode", nextMode);
      ui.state.mode = nextMode;
      // Rank/Value changes only what each cell reads: no reorder, no rebuild.
      applyCivTableState(ui);
    })
  );
  const onSort = (/** @type {string} */ nextSortKey) => {
    setSetting(ctx, "worldRankingsAllCivsSortKey", nextSortKey);
    ui.state.sortKey = nextSortKey;
    fillCivTableRows(ui);
    applyCivTableState(ui);
  };
  // Two stacked tables instead of one ~40-column sheet: icon-bearing metrics
  // (rates and yields) first, text-only counts below under "Totals & Tallies".
  // One shared sort keeps a civ's rows lined up across the two.
  const iconMetrics = metrics.filter((metric) => METRIC_ICONS[metric.id]);
  const textMetrics = metrics.filter((metric) => !METRIC_ICONS[metric.id]);
  host.appendChild(buildSectionTitle("LOC_DEMOGRAPHICS_SETTLEMENTS_TAB_CIVS"));
  host.appendChild(mountCivTableBlock(ui, iconMetrics, onSort));
  if (textMetrics.length) {
    host.appendChild(buildSectionTitle("LOC_DEMOGRAPHICS_WORLDRANKINGS_ALLCIVS_TOTALS_TITLE"));
    host.appendChild(mountCivTableBlock(ui, textMetrics, onSort));
  }
  fillCivTableRows(ui);
  applyCivTableState(ui);
}

/**
 * Build one sortable civ table (header row only) for a subset of metrics, wrapped in its scroll
 * frame, and register it as a block so {@link fillCivTableRows} can fill and refill its rows.
 * Every block shares the sort, the ranks cache and the local-player highlight.
 * @param {CivTableUi} ui
 * @param {*[]} metrics The metrics (columns) this table shows.
 * @param {(key: string) => void} onSort
 * @returns {HTMLElement}
 */
function mountCivTableBlock(ui, metrics, onSort) {
  const scroll = div("demographics-worldrankings-allcivs-matrix demographics-civtable-scroll");
  const table = div("demographics-settle-table demographics-civtable");
  table.appendChild(buildHeaderRow(metrics, ui, onSort));
  scroll.appendChild(table);
  ui.blocks.push({ table, metrics, rows: [] });
  return scroll;
}
