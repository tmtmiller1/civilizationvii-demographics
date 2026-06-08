// view-settlements.js
//
// "World Rankings" hub. Three 2nd-order major tabs (native fxs-tab-bar):
//   civilizations - the per-civ World Factbook matrix (ViewFactbook; from sampled
//                   history).
//   showcase      - an artistic Top-25 settlements board (podium + ranked list) by
//                   composite score, with clickable city dossiers.
//   table         - a dense, sortable settlements table with an All/Cities/Towns
//                   filter and a "category leaders" strip.
//
// (The Town Advisor lives in its own top-level tab now; the data tables here are a
// LIVE snapshot from settlements-data.js. "Settlement" is the primary unit: the
// city<->town status flips across ages, so the combined list is the headline and
// City/Town is just a filter on current status.)

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { safePlaySound } from "/demographics/ui/core/demographics-audio.js";
import { div, fmt, iconEl } from "/demographics/ui/core/ui-helpers.js";
import {
  SETTLEMENT_OUTPUTS,
  buildSettlementBoard
} from "/demographics/ui/screen-demographics/settlements/settlements-data.js";
import {
  startInstant,
  launchCinematic
} from "/demographics/ui/screen-demographics/camera/city-camera-controller.js";
import * as ViewFactbook from "/demographics/ui/screen-demographics/views/factbook/view-factbook.js";
import { renderDetailPanel } from "/demographics/ui/screen-demographics/views/settlements/view-settlements-detail.js";
import { renderCivRankingPanel } from "/demographics/ui/screen-demographics/views/settlements/view-settlements-civranking.js";
import { renderShowcasePanel } from "/demographics/ui/screen-demographics/views/settlements/view-settlements-showcase.js";
import { renderTablePanel } from "/demographics/ui/screen-demographics/views/settlements/view-settlements-table.js";

const TOP_N = 25;

/**
 * Mutable render state for the Settlements view.
 * @typedef {Object} SettleState
 * @property {*} settings Persisted-setting surface (getSetting/setSetting).
 * @property {*} [history] Sampled history (for the Civilizations/factbook sub-tab).
 * @property {*} board The scored + ranked settlement board.
 * @property {HTMLElement} content The swappable content host.
 * @property {string} subTab Active sub-view ("showcase" | "table").
 * @property {string} filter Active table filter ("all" | "cities" | "towns").
 * @property {string} sortKey Active table sort key ("composite" | output id).
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
 * Whether a settlement's identity should be obscured: the "hide unmet players"
 * option (showUnmetNames === false, the default) is active AND the owner is a
 * civ the local player has not met. Defensive: only mask when `met === false`
 * (mirrors the factbook), never on an unknown/undefined met state.
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
    leaderName: t("LOC_DEMOGRAPHICS_FACTBOOK_UNMET_LEADER"),
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
 * A display clone of a settlement with its identity (name + owner) obscured,
 * keeping every quantitative field (score, yields, population, founded, trend,
 * wonders, ranks) intact. `masked` is stamped so builders can suppress the
 * "View on map" affordance (revealing an unmet city's location is a spoiler).
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
 * is a civ the local player has not met, OR the settlement's city center hasn't
 * been discovered yet (it's still in fog). Independent of the "hide unmet names"
 * option.
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
 * is turned off). Greyed-out for an unmet civ. Enriches the city's wonders with
 * their build years from history first, so the tour can caption each wonder.
 * @param {*} s The settlement.
 * @param {SettleState} st The render state.
 * @returns {HTMLElement|null} The button, or null.
 */
function buildCinematicButton(s, st) {
  if (getSetting(st.settings, "topCities.cinematicEnabled", true) !== true) return null;
  if (!cameraForbidden(s) && !s.location) return null;
  return cameraButton(!cameraForbidden(s) && !!s.location, "LOC_DEMOGRAPHICS_SETTLEMENTS_CINEMATIC_VIEW",
    () => launchCinematic(enrichWonders(s, st.history)), cameraDisabledTip(s));
}

/**
 * Build the camera action row: "View on map" + (default) "Cinematic". Null when
 * neither button applies.
 * @param {*} s The settlement.
 * @param {SettleState} st The render state.
 * @returns {HTMLElement|null} The button row, or null.
 */
function buildCameraButtons(s, st) {
  const row = div("demographics-settle-mapbtns");
  const map = buildMapButton(s);
  if (map) row.appendChild(map);
  const cine = buildCinematicButton(s, st);
  if (cine) row.appendChild(cine);
  return row.firstChild ? row : null;
}

/**
 * Build a map of wonder ConstructibleType → earliest game-year it appears for an
 * owner in the sampled history (its approximate build year).
 * @param {*} history The sampled history.
 * @param {number} pid The owner player id.
 * @returns {Map<string, string>} type → year.
 */
function wonderBuildYears(history, pid) {
  const out = new Map();
  const samples = history && Array.isArray(history.samples) ? history.samples : [];
  const key = String(pid);
  for (const smp of samples) foldSampleWonderYears(out, smp, key);
  return out;
}

/**
 * Fold one sample's wonder types into the earliest-year map.
 * @param {Map<string, string>} out type → earliest year (mutated).
 * @param {*} smp The sample.
 * @param {string} key The owner pid key.
 */
function foldSampleWonderYears(out, smp, key) {
  const ps = smp && smp.players ? smp.players[key] : null;
  const types = ps && Array.isArray(ps.wonderTypes) ? ps.wonderTypes : null;
  if (!types || !smp.gameYear) return;
  for (const ty of types) if (!out.has(ty)) out.set(ty, smp.gameYear);
}

/**
 * Annotate a settlement's wonders with their build years (from history) so the
 * cinematic can caption each wonder. Mutates + returns the settlement.
 * @param {*} s The settlement.
 * @param {*} history The sampled history.
 * @returns {*} The settlement.
 */
function enrichWonders(s, history) {
  const years = wonderBuildYears(history, s.owner && s.owner.pid);
  for (const w of Array.isArray(s.wonders) ? s.wonders : []) {
    if (w && w.type && !w.year && years.has(w.type)) w.year = years.get(w.type);
  }
  return s;
}

/**
 * Build the owner avatar: a civ-colored disc holding the leader portrait, or an
 * initial-letter placeholder when no LEADER_* type resolves.
 * @param {*} owner The settlement owner identity.
 * @returns {HTMLElement} The avatar element.
 */
function buildOwnerAvatar(owner) {
  const wrap = div("demographics-settle-avatar");
  if (owner.readable || owner.primary) wrap.style.backgroundColor = owner.readable || owner.primary;
  if (owner.secondary) wrap.style.borderColor = owner.secondary;
  if (owner.leaderType) {
    const portrait = document.createElement("fxs-icon");
    portrait.setAttribute("data-icon-id", owner.leaderType);
    portrait.setAttribute("data-icon-context", "LEADER");
    portrait.className = "demographics-settle-portrait";
    wrap.appendChild(portrait);
  } else {
    const initial = (owner.leaderName || owner.civName || "?").trim().charAt(0).toUpperCase() || "?";
    wrap.appendChild(div("demographics-settle-avatar-initial", initial));
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
  names.appendChild(div("demographics-settle-owner-leader", owner.leaderName || "—"));
  if (owner.civName) names.appendChild(div("demographics-settle-owner-civ", owner.civName));
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
  for (const col of SETTLEMENT_OUTPUTS) {
    const item = div("demographics-settle-output");
    item.appendChild(iconEl(col.icon, "demographics-settle-yield-icon"));
    item.appendChild(div("demographics-settle-output-val", fmt(s.outputs[col.id])));
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
    rerenderContent,
    displayOf,
    buildLaurelMedal,
    buildOwnerAvatar,
    buildOutputStrip,
    buildTypeBadge,
    buildCameraButtons,
    buildSectionTitle,
    buildListHeader,
    buildEmpty,
    buildTrendGlyph
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
    rerenderContent,
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
 * The sub-view tabs.
 * @type {Array<{ id: string, label: string }>}
 */
const SUBTABS = [
  { id: "civranking", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_TAB_CIVRANK" },
  { id: "civilizations", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_TAB_CIVS" },
  { id: "showcase", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_TAB_SHOWCASE" },
  { id: "table", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_TAB_TABLE" }
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

// ── City detail dossier (click a card) ───────────────────────────────────────

/**
 * Render the clicked city's detail dossier into the content host.
 * @param {SettleState} st The render state.
 */
function renderDetail(st) {
  if (!st.detail) {
    renderShowcase(st);
    return;
  }
  renderDetailPanel(st, {
    rerenderContent,
    buildOwnerAvatar,
    buildTypeBadge,
    buildTrendGlyph,
    buildCameraButtons
  });
}

/**
 * Clear and re-render the active sub-view into the content host.
 * @param {SettleState} st The render state.
 */
function rerenderContent(st) {
  while (st.content.firstChild) st.content.removeChild(st.content.firstChild);
  // A clicked city opens the detail dossier over the current content.
  if (st.detail) {
    renderDetail(st);
    return;
  }
  // Civilizations = the per-civ World Factbook matrix (built from sampled
  // history); the other two are the live settlement rankings.
  if (st.subTab === "civranking") {
    renderCivRanking(st);
  } else if (st.subTab === "civilizations") {
    ViewFactbook.render(st.content, { history: st.history, settings: st.settings });
  } else if (st.subTab === "table") renderTable(st);
  else renderShowcase(st);
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
    filter: getSetting(settings, "settlementsFilter", "all"),
    sortKey: getSetting(settings, "settlementsSortKey", "composite"),
    showUnmetNames: getSetting(settings, "showUnmetNames", false) === true
  };
  const wrap = div("demographics-settle-view");
  wrap.appendChild(buildSubTabs(st));
  wrap.appendChild(st.content);
  host.appendChild(wrap);
  rerenderContent(st);
}
