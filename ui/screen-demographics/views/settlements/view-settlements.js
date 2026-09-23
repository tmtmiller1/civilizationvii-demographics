// view-settlements.js
//
// "World Rankings" hub. Three 2nd-order major tabs (native fxs-tab-bar):
//   civilizations - the per-civ All Civilizations matrix (ViewWorldRankingsAllCivs; from sampled
//                   history).
//   showcase      - an artistic Top-25 settlements board (podium + ranked list) by
//                   composite score, with clickable city dossiers.
//   table         - a dense, sortable settlements table with an All/Cities/Towns
//                   filter and a "category leaders" strip.
//
// The data tables are a live snapshot from settlements-data.js. "Settlement" is the
// primary unit since city<->town status flips across ages; City/Town is a filter.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { safePlaySound } from "/demographics/ui/core/demographics-audio.js";
import { div, fmt, iconEl } from "/demographics/ui/core/ui-helpers.js";
import { safeTextColor } from "/demographics/ui/core/civ-color-utils.js";
import {
  SETTLEMENT_OUTPUTS,
  buildSettlementBoard
} from "/demographics/ui/screen-demographics/settlements/settlements-data.js";
import {
  startInstant,
  launchCinematic
} from "/demographics/ui/screen-demographics/camera/city-camera-controller.js";
import * as ViewWorldRankingsAllCivs from "/demographics/ui/screen-demographics/views/worldrankings-allcivs/view-worldrankings-allcivs.js";
import { renderCivRankingPanel } from "/demographics/ui/screen-demographics/views/settlements/view-settlements-civranking.js";
import { renderShowcasePanel } from "/demographics/ui/screen-demographics/views/settlements/view-settlements-showcase.js";
import { renderTablePanel } from "/demographics/ui/screen-demographics/views/settlements/view-settlements-table.js";
import { annotateWonderYears } from "/demographics/ui/screen-demographics/settlements/settlements-wonder-years.js";
import { readAgeArchive } from "/demographics/ui/screen-demographics/settlements/settlements-age-archive.js";
import { renderHallOfFameTab } from "/demographics/ui/screen-demographics/views/settlements/settlements-halloffame.js";

const TOP_N = 25;

/**
 * Error logger (always emits).
 * @param {...*} a Values to log.
 */
function derr(...a) {
  console.error("[Demographics.settlements]", ...a);
}

/**
 * Mutable render state for the Settlements view.
 * @typedef {Object} SettleState
 * @property {*} settings Persisted-setting surface (getSetting/setSetting).
 * @property {*} [history] Sampled history (for the Civilizations/worldrankings-allcivs sub-tab).
 * @property {*} board The scored + ranked settlement board.
 * @property {HTMLElement} content The swappable content host.
 * @property {string} subTab Active sub-view ("showcase" | "table").
 * @property {string} filter Active table filter ("all" | "cities" | "towns").
 * @property {string} sortKey Active table sort key ("composite" | output id).
 * @property {string} showcaseAge Showcase board: "now", or an archived age type (session-only).
 * @property {*} [detail] The settlement whose detail dossier is open, or null.
 * @property {boolean} showUnmetNames When false (default), settlements owned by
 *   civs the local player has not met are shown with their identity (name +
 *   owner) obscured, while their stats still populate the rankings.
 */

/**
 * Read a persisted setting, defensively.
 * @param {*} settings The settings surface.
 * @param {string} key The setting key.
 * @param {*} fallback The default.
 * @returns {*} The stored value or the default.
 */
function getSetting(settings, key, fallback) {
  try {
    if (settings && typeof settings.getSetting === "function") return settings.getSetting(key, fallback);
  } catch (_) {
    // getSetting can throw; fall back.
  }
  return fallback;
}

/**
 * Persist a setting, defensively.
 * @param {*} settings The settings surface.
 * @param {string} key The setting key.
 * @param {*} value The value to store.
 */
function setSetting(settings, key, value) {
  try {
    if (settings && typeof settings.setSetting === "function") settings.setSetting(key, value);
  } catch (_) {
    // setSetting can throw; ignore (non-persisted is acceptable).
  }
}

/**
 * Whether a settlement's identity should be obscured: "hide unmet players"
 * (showUnmetNames === false, the default) is active AND the owner is unmet.
 * Masks only when `met === false`, never on an unknown met state.
 * @param {SettleState} st The render state.
 * @param {*} s The settlement.
 * @returns {boolean} True when the settlement should be masked.
 */
function isMasked(st, s) {
  return !st.showUnmetNames && !!s && !!s.owner && s.owner.met === false;
}

/**
 * A masked owner identity: generic "Unmet" names, no portrait type, no banner
 * colors (so the civ's color can't be read off the accent).
 * @param {*} owner The real owner identity.
 * @returns {*} The masked owner.
 */
function maskOwner(owner) {
  return {
    pid: owner ? owner.pid : -1,
    leaderName: t("LOC_DEMOGRAPHICS_WORLDRANKINGS_ALLCIVS_UNMET_LEADER"),
    civName: t("LOC_DEMOGRAPHICS_UNMET_CIV"),
    leaderType: undefined,
    primary: undefined,
    secondary: undefined,
    readable: undefined,
    isMajor: false,
    met: false
  };
}

/**
 * A display clone of a settlement with its identity (name + owner) obscured and
 * every quantitative field intact. `masked` is stamped so builders can suppress
 * the "View on map" affordance.
 * @param {*} s The settlement.
 * @returns {*} The masked settlement.
 */
function maskSettlement(s) {
  return Object.assign({}, s, {
    name: t("LOC_DEMOGRAPHICS_SETTLEMENTS_UNMET_NAME"),
    owner: maskOwner(s.owner),
    masked: true
  });
}

/**
 * Resolve the display settlement for a render: the masked clone when the
 * "hide unmet players" option applies, otherwise the settlement unchanged.
 * @param {SettleState} st The render state.
 * @param {*} s The settlement.
 * @returns {*} The settlement to render.
 */
function displayOf(st, s) {
  return isMasked(st, s) ? maskSettlement(s) : s;
}

/**
 * Stop an event from bubbling (so a "View on map" click inside a card does not
 * also open the card's detail dossier).
 * @param {*} e The event.
 */
function stopEvent(e) {
  try {
    if (e && typeof e.stopPropagation === "function") e.stopPropagation();
  } catch (_) {
    // stopPropagation can be absent on synthetic events; ignore.
  }
}

/**
 * Build one camera action button (shared pin + label + active/disabled wiring).
 * A masked (unmet-owner) settlement renders greyed-out and inert with a tooltip
 * (moving the camera there would reveal an unmet city's location).
 * @param {boolean} active Whether the button is live.
 * @param {string} labelKey The label LOC key.
 * @param {() => void} onClick The activation handler.
 * @param {string} [disabledTipKey] Tooltip LOC key when disabled (defaults to the unmet reason).
 * @returns {HTMLElement} The button.
 */
function cameraButton(active, labelKey, onClick, disabledTipKey) {
  const btn = div("demographics-settle-mapbtn" + (active ? " demographics-settle-clickable" : " is-disabled"));
  btn.appendChild(div("demographics-settle-mapbtn-pin"));
  btn.appendChild(div("demographics-settle-mapbtn-label", t(labelKey)));
  if (active) {
    btn.addEventListener("click", (e) => {
      stopEvent(e);
      onClick();
    });
  } else {
    btn.setAttribute("data-tooltip-content", t(disabledTipKey || "LOC_DEMOGRAPHICS_SETTLEMENTS_MAP_UNMET_TOOLTIP"));
    btn.addEventListener("click", stopEvent);
  }
  return btn;
}

/**
 * Whether the camera (fly-to / fly-by) is forbidden for a settlement: its owner
 * is unmet, or its city center is still in fog. Independent of "hide unmet names".
 * @param {*} s The settlement.
 * @returns {boolean} True when the camera must stay disabled.
 */
function cameraForbidden(s) {
  return !!(s.owner && s.owner.met === false) || s.explored === false;
}

/**
 * The tooltip LOC key explaining WHY the camera is disabled for a settlement.
 * @param {*} s The settlement.
 * @returns {string} The tooltip LOC key.
 */
function cameraDisabledTip(s) {
  if (s.owner && s.owner.met === false) return "LOC_DEMOGRAPHICS_SETTLEMENTS_MAP_UNMET_TOOLTIP";
  return "LOC_DEMOGRAPHICS_SETTLEMENTS_MAP_UNEXPLORED_TOOLTIP";
}

/**
 * The "View on map" button - an instant snap to the city. Greyed-out
 * for an unmet civ; null when there is no readable location to view.
 * @param {*} s The settlement.
 * @returns {HTMLElement|null} The button, or null.
 */
function buildMapButton(s) {
  if (!cameraForbidden(s) && !s.location) return null;
  return cameraButton(!cameraForbidden(s) && !!s.location, "LOC_DEMOGRAPHICS_SETTLEMENTS_VIEW_ON_MAP",
    () => startInstant(s), cameraDisabledTip(s));
}

/**
 * The dedicated "Cinematic" button (default on; hidden when the cinematic option
 * is turned off). Greyed-out for an unmet civ. The wonders already carry their
 * observed completion years (annotateWonderYears), so the tour can caption them.
 * @param {*} s The settlement.
 * @param {SettleState} st The render state.
 * @returns {HTMLElement|null} The button, or null.
 */
function buildCinematicButton(s, st) {
  if (getSetting(st.settings, "topCities.cinematicEnabled", true) !== true) return null;
  if (!cameraForbidden(s) && !s.location) return null;
  return cameraButton(!cameraForbidden(s) && !!s.location, "LOC_DEMOGRAPHICS_SETTLEMENTS_CINEMATIC_VIEW",
    () => launchCinematic(s), cameraDisabledTip(s));
}

/**
 * Build the camera action row: "View on map" + (default) "Cinematic". Null when
 * neither button applies, and always for an archived end-of-age record (the
 * settlement may have been razed or changed hands since).
 * @param {*} s The settlement.
 * @param {SettleState} st The render state.
 * @returns {HTMLElement|null} The button row, or null.
 */
function buildCameraButtons(s, st) {
  if (s.archived) return null;
  const row = div("demographics-settle-mapbtns");
  const map = buildMapButton(s);
  if (map) row.appendChild(map);
  const cine = buildCinematicButton(s, st);
  if (cine) row.appendChild(cine);
  return row.firstChild ? row : null;
}

/**
 * Build the owner avatar: a civ-colored disc holding the leader portrait, or an
 * initial-letter placeholder when no LEADER_* type resolves.
 * @param {*} owner The settlement owner identity.
 * @returns {HTMLElement} The avatar element.
 */
function buildOwnerAvatar(owner) {
  const wrap = div("demographics-settle-avatar");
  const bg = owner.readable || owner.primary;
  if (bg) wrap.style.backgroundColor = bg;
  if (owner.secondary) wrap.style.borderColor = owner.secondary;
  if (owner.leaderType) {
    const portrait = document.createElement("fxs-icon");
    portrait.setAttribute("data-icon-id", owner.leaderType);
    portrait.setAttribute("data-icon-context", "LEADER");
    portrait.className = "demographics-settle-portrait";
    wrap.appendChild(portrait);
  } else {
    const initial = (owner.leaderName || owner.civName || "?").trim().charAt(0).toUpperCase() || "?";
    const el = div("demographics-settle-avatar-initial", initial);
    if (bg) el.style.color = safeTextColor(bg);
    wrap.appendChild(el);
  }
  return wrap;
}

/**
 * Build the owner cell: avatar + leader/civ name.
 * @param {*} owner The settlement owner identity.
 * @returns {HTMLElement} The owner cell.
 */
function buildOwnerCell(owner) {
  const cell = div("demographics-settle-owner");
  cell.appendChild(buildOwnerAvatar(owner));
  const names = div("demographics-settle-owner-names");
  // Civilization-primary, leader-secondary: ".-owner-leader" carries the civ
  // name and ".-owner-civ" the leader. The leader line only shows when there is
  // a distinct civ name above it.
  const primary = owner.civName || owner.leaderName || "—";
  names.appendChild(div("demographics-settle-owner-leader", primary));
  if (owner.civName && owner.leaderName) {
    names.appendChild(div("demographics-settle-owner-civ", owner.leaderName));
  }
  cell.appendChild(names);
  return cell;
}

/**
 * Build the City/Town status badge.
 * @param {boolean} isTown Whether the settlement is currently a town.
 * @returns {HTMLElement} The badge element.
 */
function buildTypeBadge(isTown) {
  const key = isTown ? "LOC_DEMOGRAPHICS_SETTLEMENTS_TOWN" : "LOC_DEMOGRAPHICS_SETTLEMENTS_CITY";
  const badge = div(
    "demographics-settle-badge " + (isTown ? "demographics-settle-badge-town" : "demographics-settle-badge-city"),
    t(key)
  );
  return badge;
}

// ── Showcase (artistic Top-25 overall) ──────────────────────────────────────

/**
 * A CSS-drawn population-trend glyph (up/down/flat) - no unicode (avoids tofu).
 * @param {*} trend The settlement trend ({dir}) or null.
 * @returns {HTMLElement} The glyph element.
 */
function buildTrendGlyph(trend) {
  const dir = trend && typeof trend.dir === "number" ? trend.dir : 0;
  const cls = dir > 0 ? "up" : dir < 0 ? "down" : "flat";
  const g = div("demographics-settle-trend demographics-settle-trend-" + cls);
  return g;
}


/**
 * Engine laurel-wreath icons for the podium places (gold / silver / bronze).
 * @type {Record<number, string>}
 */
const LAUREL_ICONS = {
  1: "blp:popup_gold_laurels",
  2: "blp:popup_silver_laurels",
  3: "blp:popup_bronze_laurels"
};

/**
 * Build a podium medal: the place number framed by a gold/silver/bronze
 * laurel-wreath (repurposing the engine's victory-popup laurels).
 * @param {number} place The 1-based podium place.
 * @returns {HTMLElement} The medal element.
 */
function buildLaurelMedal(place) {
  const medal = div("demographics-settle-medal demographics-settle-medal-" + place);
  medal.style.backgroundImage = "url('" + (LAUREL_ICONS[place] || "blp:popup_laurels") + "')";
  medal.appendChild(div("demographics-settle-medal-num", String(place)));
  return medal;
}

/**
 * Build a compact icon+value strip of every output for a settlement.
 * @param {*} s The settlement.
 * @returns {HTMLElement} The strip element.
 */
function buildOutputStrip(s) {
  const strip = div("demographics-settle-outputs");
  // An archived record from an older build may carry no outputs map.
  const o = s.outputs || {};
  for (const col of SETTLEMENT_OUTPUTS) {
    const item = div("demographics-settle-output");
    item.appendChild(iconEl(col.icon, "demographics-settle-yield-icon"));
    item.appendChild(div("demographics-settle-output-val", fmt(o[col.id])));
    strip.appendChild(item);
  }
  return strip;
}


/**
 * Build the showcase list's column-label header row.
 * @param {string} [nameKey] LOC key for the name column (defaults to "Settlement").
 * @returns {HTMLElement} The header row.
 */
function buildListHeader(nameKey) {
  const head = div("demographics-settle-list-head");
  head.appendChild(div("demographics-settle-head-rank", t("LOC_DEMOGRAPHICS_SETTLEMENTS_COL_RANK")));
  head.appendChild(div("demographics-settle-head-spacer"));
  head.appendChild(div("demographics-settle-head-name", t(nameKey || "LOC_DEMOGRAPHICS_SETTLEMENTS_COL_NAME")));
  head.appendChild(div("demographics-settle-head-score", t("LOC_DEMOGRAPHICS_SETTLEMENTS_COL_SCORE")));
  return head;
}

/**
 * Render the artistic Top-25 showcase: the top-3 podium, then the full ranked
 * list (1-25, so the top 3 also appear in the graphed list), with a red "Top 10"
 * divider between ranks 10 and 11.
 * @param {SettleState} st The render state.
 */
function renderShowcase(st) {
  renderShowcasePanel(st, {
    topN: TOP_N,
    safePlaySound,
    displayOf,
    buildLaurelMedal,
    buildOwnerAvatar,
    buildOutputStrip,
    buildTypeBadge,
    buildCameraButtons,
    buildSectionTitle,
    buildListHeader,
    buildEmpty,
    buildTrendGlyph,
    archive: readAgeArchive(st.history)
  });
}

// ── Civilization ranking (showcase-style: cumulative score per civ) ──────────

/**
 * Render the Civilization Ranking sub-view: a podium + ranked list of major
 * civs by cumulative settlement score (mirrors the Top-25 settlements showcase).
 * @param {SettleState} st The render state.
 */
function renderCivRanking(st) {
  renderCivRankingPanel(st, {
    buildEmpty,
    buildSectionTitle,
    buildListHeader,
    buildOwnerAvatar,
    buildOutputStrip,
    buildLaurelMedal,
    buildCameraButtons,
    maskOwner
  });
}

// ── Detail table (filter + sortable + category leaders) ──────────────────────

/**
 * Build a stylized section title with flanking filigree (mimics the elaborate
 * Civ VII menu headers).
 * @param {string} key The title LOC key.
 * @returns {HTMLElement} The section-title element.
 */
function buildSectionTitle(key) {
  const wrap = div("demographics-settle-section-title");
  // Both flourishes stay in the DOM: the ranking-list heading lays them out LEFT and RIGHT of the
  // title (symmetric), while the podium column stacks them ABOVE and BELOW. The podium's top one is
  // hidden in CSS (.demographics-settle-split-left ... :first-child) - it spent a row over both
  // "Greatest" headings for no information.
  wrap.appendChild(iconEl("blp:header_filigree", "demographics-settle-section-fil"));
  wrap.appendChild(div("demographics-settle-section-title-text font-title", t(key)));
  wrap.appendChild(iconEl("blp:header_filigree", "demographics-settle-section-fil demographics-settle-section-fil-r"));
  return wrap;
}

/**
 * Render the detail table (filter + leaders strip + sortable rows).
 * @param {SettleState} st The render state.
 */
function renderTable(st) {
  renderTablePanel(st, {
    topN: TOP_N,
    setSetting,
    safePlaySound,
    displayOf,
    buildOwnerCell,
    buildTypeBadge,
    buildSectionTitle,
    buildEmpty
  });
}

// ── Shell ────────────────────────────────────────────────────────────────────

/**
 * Build the empty-state placeholder.
 * @returns {HTMLElement} The placeholder.
 */
function buildEmpty() {
  return div("demographics-settle-empty", t("LOC_DEMOGRAPHICS_SETTLEMENTS_EMPTY"));
}

/**
 * Build the "render failed" placeholder shown when a sub-view throws.
 * @returns {HTMLElement} The placeholder.
 */
function buildRenderFailed() {
  return div("demographics-settle-empty", t("LOC_DEMOGRAPHICS_EMPTY_CHART_RENDER_FAILED"));
}

/**
 * The sub-view tabs.
 * @type {Array<{ id: string, label: string }>}
 */
const SUBTABS = [
  { id: "civranking", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_TAB_CIVRANK" },
  { id: "civilizations", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_TAB_CIVS" },
  { id: "showcase", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_TAB_SHOWCASE" },
  { id: "table", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_TAB_TABLE" },
  { id: "halloffame", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_TAB_HOF" }
];

/**
 * Build the sub-view selector as a native fxs-tab-bar - a 2nd-order major tab
 * bar styled like the Historical Data page tabs (rather than minor pills), so
 * Top 25 / All Settlements / Town Advisor read as co-equal major tabs.
 * @param {SettleState} st The render state.
 * @returns {HTMLElement} The tab-bar host.
 */
function buildSubTabs(st) {
  const host = div("demographics-settle-tabhost demographics-page-tab-host w-full");
  const bar = document.createElement("fxs-tab-bar");
  bar.classList.add("demographics-page-tabs", "w-full", "font-title", "text-sm");
  bar.setAttribute("data-audio-group-ref", "audio-screen-unlocks");
  bar.setAttribute("tab-item-class", "font-title text-base");
  bar.setAttribute("tab-items", JSON.stringify(SUBTABS.map((s) => ({ id: s.id, label: s.label }))));
  const idx = Math.max(0, SUBTABS.findIndex((s) => s.id === st.subTab));
  bar.setAttribute("selected-tab-index", String(idx));
  bar.addEventListener("tab-selected", (event) => {
    const id = /** @type {*} */ (event)?.detail?.selectedItem?.id;
    if (!id || (id === st.subTab && !st.detail)) return;
    st.subTab = id;
    st.detail = null; // leaving any open city dossier when switching sub-tabs
    setSetting(st.settings, "settlementsSubTab", id);
    rerenderContent(st);
  });
  host.appendChild(bar);
  return host;
}

/**
 * Clear and re-render the active sub-view into the content host. Every handler
 * re-renders through this boundary, so a throwing sub-view leaves a visible
 * "render failed" notice instead of a blank panel.
 * @param {SettleState} st The render state.
 */
function rerenderContent(st) {
  while (st.content.firstChild) st.content.removeChild(st.content.firstChild);
  try {
    renderSubView(st);
  } catch (e) {
    derr("sub-view render threw (subTab=" + st.subTab + "):", e);
    st.content.appendChild(buildRenderFailed());
  }
}

/**
 * Render the active sub-view into the (already cleared) content host.
 * @param {SettleState} st The render state.
 */
function renderSubView(st) {
  if (st.subTab === "halloffame") return renderHallOfFameTab(st.content);
  // Civilizations = the per-civ All Civilizations matrix (built from sampled
  // history); the other two are the live settlement rankings. (The old per-city
  // detail dossier was folded into the Top-25 rows , no separate view.)
  if (st.subTab === "civranking") {
    renderCivRanking(st);
  } else if (st.subTab === "civilizations") {
    // The All-Civ view clears st.content on a FULL render only; its sort and Rank/Value
    // updates happen in place, so afterRender fires on entry rather than on every click.
    ViewWorldRankingsAllCivs.render(st.content, {
      history: st.history,
      settings: st.settings,
      afterRender: () => insertOptionsToolbar(st)
    });
  } else if (st.subTab === "table") renderTable(st);
  else renderShowcase(st);
  insertOptionsToolbar(st);
}

/**
 * Insert the Options button (a right-aligned `.demographics-chart-toolbar`) directly below the
 * `.demographics-settle-filters` pill row, or at the top of the content when there is none.
 * @param {SettleState} st The render state.
 */
function insertOptionsToolbar(st) {
  try {
    // Idempotent: drop any existing toolbar first so repeat calls (e.g. the
    // All-Civ view's afterRender on each internal sort/toggle) never stack copies.
    // The Options button lives in the frame header now (screen-demographics.js); this view no
    // longer adds a toolbar row for it. Kept as a cleanup so no stale row from an older render
    // survives a re-render.
    const prior = st.content.querySelector(".demographics-chart-toolbar");
    if (prior) prior.remove();
  } catch (e) {
    // querySelector/remove/insertBefore can throw on a detached host (see
    // history-csv.js showCsvToast); the content renders without its Options
    // button rather than blanking.
    derr("insertOptionsToolbar threw:", e);
  }
}

/**
 * Render the Settlements view.
 * @param {HTMLElement} host The view host element.
 * @param {*} ctx Render context ({ settings }).
 */
export function render(host, ctx) {
  const settings = ctx?.settings;
  let subTab = getSetting(settings, "settlementsSubTab", "civranking");
  // Coerce a stale/removed sub-tab (e.g. the removed "towns"/"advisor") to the
  // default Civilization Ranking view.
  if (!SUBTABS.some((s) => s.id === subTab)) subTab = "civranking";
  /** @type {SettleState} */
  const st = {
    settings,
    history: ctx?.history,
    board: buildSettlementBoard(),
    content: div("demographics-settle-content"),
    subTab,
    // The settlement ranking always opens on the All filter (not the last-used
    // Cities/Towns); switching chips still works for the rest of the session.
    filter: "all",
    sortKey: getSetting(settings, "settlementsSortKey", "composite"),
    showcaseAge: "now",
    showUnmetNames: getSetting(settings, "showUnmetNames", false) === true
  };
  annotateWonderYears(st.board.settlements, st.history);
  const wrap = div("demographics-settle-view");
  wrap.appendChild(buildSubTabs(st));
  wrap.appendChild(st.content);
  host.appendChild(wrap);
  rerenderContent(st);
}
