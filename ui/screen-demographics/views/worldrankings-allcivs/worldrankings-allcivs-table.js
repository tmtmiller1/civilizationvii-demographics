// worldrankings-allcivs-table.js
//
// "All Civilizations" sortable table: civs are rows and every non-hidden metric
// is a column, with a Rank/Value toggle and click-to-sort metric headers. It is
// the "table" branch of the responsive hybrid in view-worldrankings-allcivs.js,
// chosen when there is enough width for readable metric-column headers.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { orderedNames } from "/demographics/ui/core/player-label.js";
import { div, iconEl } from "/demographics/ui/core/ui-helpers.js";
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
 * The data row's class list: the shared World Rankings row look, a gold / silver /
 * bronze wash for places 1-3 in the ACTIVE sort (ties share a place), and the
 * local player's gold outline.
 * @param {Map<string, *>} cache Ranks cache.
 * @param {string} sortKey Active sort key.
 * @param {string} pid Player id.
 * @param {boolean} isLocal Whether this is the local player's row.
 * @returns {string} The class list.
 */
function dataRowClass(cache, sortKey, pid, isLocal) {
  let cls = "demographics-settle-row demographics-settle-datarow";
  const r = cache.get(sortKey)?.ranks.get(pid);
  if (typeof r === "number" && r >= 1 && r <= 3) cls += " demographics-settle-medalrow-" + r;
  return isLocal ? cls + " is-local" : cls;
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
 * Build the Rank/Value toggle chip row. The chips are built once and registered in `ui`; their
 * active state is a class toggle in {@link applyCivTableState}, and the guard reads the LIVE mode
 * off `ui.state` (a captured one would go stale the moment the chip outlives a re-render).
 * @param {CivTableUi} ui The page's chrome handles.
 * @param {(mode: string) => void} onChange Change handler.
 * @returns {HTMLElement} The chip row.
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
 * Build a sortable metric header cell (icon + label). Built once and registered in `ui`; its
 * sorted state is a class toggle in {@link applyCivTableState}.
 * @param {*} metric Metric def.
 * @param {CivTableUi} ui The page's chrome handles.
 * @param {(key: string) => void} onSort Sort handler.
 * @returns {HTMLElement} The header cell.
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
 * Build the table header row.
 * @param {*[]} metrics Visible metrics.
 * @param {CivTableUi} ui The page's chrome handles.
 * @param {(key: string) => void} onSort Sort handler.
 * @returns {HTMLElement} The header row.
 */
function buildHeaderRow(metrics, ui, onSort) {
  const row = div("demographics-settle-row demographics-settle-header");
  row.appendChild(fixedHeader("demographics-settle-col-rank", t("LOC_DEMOGRAPHICS_WORLDRANKINGS_ALLCIVS_RANK")));
  row.appendChild(
    fixedHeader("demographics-civtable-col-civ", t("LOC_DEMOGRAPHICS_SETTLEMENTS_COL_CIV"))
  );
  for (const m of metrics) row.appendChild(buildMetricHeader(m, ui, onSort));
  return row;
}

/**
 * Build the civ identity avatar with the All Settlements owner-avatar classes
 * (a civ-colored disc holding the leader portrait, or an initial-letter placeholder).
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
  if (masked) {
    names.appendChild(
      div("demographics-settle-owner-leader", t("LOC_DEMOGRAPHICS_UNMET_CIV"))
    );
    names.appendChild(
      div("demographics-settle-owner-civ", t("LOC_DEMOGRAPHICS_WORLDRANKINGS_ALLCIVS_UNMET_LEADER"))
    );
  } else {
    const [primary, secondary] = orderedNames(profile.leaderName, profile.civName);
    names.appendChild(div("demographics-settle-owner-leader", primary || "—"));
    if (secondary) names.appendChild(div("demographics-settle-owner-civ", secondary));
  }
  owner.appendChild(names);
  cell.appendChild(owner);
  return cell;
}

/**
 * Build one metric cell. The cell of the civ leading that metric carries the gold
 * leader wash and a "World leader in <metric>" tooltip.
 * @param {*} profile Civ profile.
 * @param {*} m Metric def.
 * @param {{ mode: string, sortKey: string, cache: Map<string, *> }} opts Row config.
 * @returns {HTMLElement} The cell.
 */
function buildMetricCell(profile, m, opts) {
  const lead = leadsMetric(opts.cache.get(m.id), profile.pid);
  const cls =
    "demographics-settle-td demographics-civtable-metric" +
    (opts.sortKey === m.id ? " is-sorted" : "") +
    (lead ? " is-leader" : "");
  const cell = div(cls, cellText(profile, m, opts.mode, opts.cache));
  if (lead) {
    cell.setAttribute(
      "data-tooltip-content",
      t("LOC_DEMOGRAPHICS_SETTLEMENTS_WORLD_LEADER_TOOLTIP", localizedMetricName(m))
    );
  }
  return cell;
}

/**
 * Build one civilization data row, returning the metric cells alongside it. Keeping the cells
 * addressable is what lets a Rank/Value switch rewrite their text in place instead of rebuilding
 * the row — the row holds the civ's leader portrait, which would otherwise re-resolve and blink.
 * @param {string} pid The profile's map key.
 * @param {*} profile Civ profile.
 * @param {{ mode: string, sortKey: string, metrics: *[], cache: Map<string, *>,
 *   showUnmetNames: boolean, localPid: string }} opts Row config.
 * @returns {CivTableRow} The row record.
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
  for (const m of metrics) {
    const cell = buildMetricCell(profile, m, opts);
    cells.push(cell);
    el.appendChild(cell);
  }
  return { pid, el, cells };
}

/** @typedef {{ pid: string, el: HTMLElement, cells: HTMLElement[] }} CivTableRow */

/**
 * One rendered civ table: its scroll frame's table element, the metrics it columns, and its
 * current data rows. The header row (and the metric icons in it) lives in `table` and is never
 * rebuilt — only `rows` is swapped.
 * @typedef {{ table: HTMLElement, metrics: *[], rows: CivTableRow[] }} CivTableBlock
 */

/**
 * Live handles to the page's persistent chrome. Rebuilding that chrome is what made the filigree
 * section titles and the metric-column icons blink: a fresh element's `blp:` background resolves a
 * frame or more after it is inserted, so identical chrome visibly flashed on every Rank/Value or
 * sort click. Everything here is built ONCE per render and only ever has classes toggled on it.
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
 * Toggle one class on an element without disturbing the rest of its class list (so a chrome
 * element is never rebuilt just to change its state).
 * @param {HTMLElement} el The element.
 * @param {string} cls The class to toggle.
 * @param {boolean} on Whether the class should be present.
 */
function setClass(el, cls, on) {
  if (on) el.classList.add(cls);
  else el.classList.remove(cls);
}

/**
 * Push the live Rank/Value mode and sort key onto the existing DOM: chip + header state classes,
 * and each metric cell's text and sorted class. Nothing is created or destroyed, so this alone
 * serves a Rank/Value switch (which changes what every cell READS, not which rows exist).
 * @param {CivTableUi} ui The page's chrome handles.
 */
function applyCivTableState(ui) {
  for (const [key, chip] of ui.chips) setClass(chip, "is-active", key === ui.state.mode);
  for (const [key, cell] of ui.heads) setClass(cell, "is-sorted", key === ui.state.sortKey);
  for (const block of ui.blocks) {
    for (const rec of block.rows) {
      const profile = ui.profiles[rec.pid];
      if (!profile) continue;
      for (let i = 0; i < block.metrics.length; i++) {
        const m = block.metrics[i];
        const cell = rec.cells[i];
        if (!cell) continue;
        cell.textContent = cellText(profile, m, ui.state.mode, ui.cache);
        setClass(cell, "is-sorted", m.id === ui.state.sortKey);
      }
    }
  }
}

/**
 * Swap every block's data rows into the current sort order. Only the rows are replaced — each
 * block's header row, its icons, and the filigree titles around it stay in the DOM untouched.
 * @param {CivTableUi} ui The page's chrome handles.
 */
function fillCivTableRows(ui) {
  const pids = sortPids(ui.profiles, ui.state.sortKey);
  for (const block of ui.blocks) {
    for (const rec of block.rows) {
      if (rec.el.parentNode === block.table) block.table.removeChild(rec.el);
    }
    block.rows.length = 0;
    for (const pid of pids) {
      const rec = buildDataRow(pid, ui.profiles[pid], {
        mode: ui.state.mode,
        sortKey: ui.state.sortKey,
        metrics: block.metrics,
        cache: ui.cache,
        showUnmetNames: ui.showUnmetNames,
        localPid: ui.localPid
      });
      block.rows.push(rec);
      block.table.appendChild(rec.el);
    }
  }
}

/**
 * Render the All Civilizations table into `host`. The chrome (toggle chips, filigree titles,
 * header rows) is built once here; a later Rank/Value or sort click updates it in place through
 * {@link applyCivTableState} / {@link fillCivTableRows} rather than re-rendering the page.
 * @param {HTMLElement} host View host (already cleared).
 * @param {Record<string, *>} profiles Civ profile map.
 * @param {*} ctx Render context (history + settings).
 * @param {boolean} showUnmetNames Whether unmet identities are shown.
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
    buildToggleRow(ui, (/** @type {string} */ m) => {
      setSetting(ctx, "worldRankingsAllCivsViewMode", m);
      ui.state.mode = m;
      // Rank/Value changes only what each cell reads — no reorder, no rebuild.
      applyCivTableState(ui);
    })
  );
  const onSort = (/** @type {string} */ k) => {
    setSetting(ctx, "worldRankingsAllCivsSortKey", k);
    ui.state.sortKey = k;
    fillCivTableRows(ui);
    applyCivTableState(ui);
  };
  // Two stacked tables instead of one ~40-column sheet: icon-bearing metrics
  // (rates and yields) first, text-only counts below under "Totals & Tallies".
  // One shared sort keeps a civ's rows lined up across the two.
  const iconMetrics = metrics.filter((m) => METRIC_ICONS[m.id]);
  const textMetrics = metrics.filter((m) => !METRIC_ICONS[m.id]);
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
 * @param {CivTableUi} ui The page's chrome handles.
 * @param {*[]} metrics The metrics (columns) this table shows.
 * @param {(key: string) => void} onSort Sort handler.
 * @returns {HTMLElement} The framed table.
 */
function mountCivTableBlock(ui, metrics, onSort) {
  const scroll = div("demographics-worldrankings-allcivs-matrix demographics-civtable-scroll");
  const table = div("demographics-settle-table demographics-civtable");
  table.appendChild(buildHeaderRow(metrics, ui, onSort));
  scroll.appendChild(table);
  ui.blocks.push({ table, metrics, rows: [] });
  return scroll;
}
