// view-hof.js
//
// Hall of Fame: every campaign this computer has recorded. Tabs: Best Games (the landing page: the
// best playthroughs and the current game in context), Rankings, Leaders, Civilizations and Records;
// any game opens a detail page. Works both in game (the current
// campaign is included live) and at the main menu (archive only).

import { el, clear } from "/demographics/ui/history/core/history-dom.js";
import { t, addSavedTexts } from "/demographics/ui/history/core/history-text.js";
import { allRecords, archiveStatus, archiveTexts } from "/demographics/ui/history/store/history-archive-store.js";
import { buildRecord, emptySlice, upsert } from "/demographics/ui/history/store/history-archive.js";
import { visibleRecords } from "/demographics/ui/history/model/history-hof.js";
import { emptyState, pillRow, tabBar } from "/demographics/ui/history/views/history-widgets.js";
import { renderBest } from "/demographics/ui/history/views/view-hof-best.js";
import { viewState } from "/demographics/ui/history/views/history-state.js";
import { renderGames, renderDetail } from "/demographics/ui/history/views/view-hof-games.js";
import { renderLeaders, renderCivs, renderRecords } from "/demographics/ui/history/views/view-hof-people.js";

export const HOF_TABS = [
  { id: "overview", label: "LOC_DEMOGRAPHICS_HIST_HOF_BEST" },
  { id: "games", label: "LOC_DEMOGRAPHICS_HIST_HOF_RANKINGS" },
  { id: "leaders", label: "LOC_DEMOGRAPHICS_HIST_HOF_LEADERS" },
  { id: "civs", label: "LOC_DEMOGRAPHICS_HIST_HOF_CIVS" },
  { id: "records", label: "LOC_DEMOGRAPHICS_HIST_HOF_RECORDS" }
];

/**
 * @typedef {Object} HofCtx
 * @property {CampaignDoc|null} live The campaign being played, if any.
 * @property {() => void} rerender Redraw callback.
 * @property {boolean} [embedded] Inside the Demographics screen, below two tab rows: the sections are a pill
 *   row (Demographics' third navigation level) rather than a third tab bar.
 */

/**
 * Archive records plus the live campaign's current record.
 * @param {CampaignDoc|null} live Live campaign.
 * @returns {ArchiveRecord[]} Records.
 */
export function hofRecords(live) {
  const slice = emptySlice();
  for (const r of allRecords()) upsert(slice, r);
  const cur = live ? buildRecord(live) : null;
  if (cur) slice.games[cur.id] = cur;
  return Object.values(slice.games);
}

/**
 * The Hall of Fame section selector: a tab bar on its own screen, a pill row inside Demographics.
 * @param {HofCtx} ctx Context.
 * @returns {HTMLElement} The selector.
 */
function sectionNav(ctx) {
  const pick = (/** @type {string} */ id) => { viewState.hofTab = id; ctx.rerender(); };
  if (!ctx.embedded) return tabBar(HOF_TABS, viewState.hofTab, pick, "dgh-subtabs");
  return pillRow(HOF_TABS.map((x) => ({ key: x.id, label: t(x.label) })), viewState.hofTab, pick);
}

/**
 * Footer describing whether the archive could be read this session.
 * @returns {HTMLElement|null} Note.
 */
function storageNote() {
  const s = archiveStatus();
  if (s === "ok" || s === "empty") return el("div", { cls: "dgh-note", text: t("LOC_DEMOGRAPHICS_HIST_STORAGE_OK") });
  // "foreign": the game handed back another mod's saved data instead of the shared settings (a game
  // storage bug: reads return the first key in sort order), so nothing is read or written.
  const tag = s === "foreign" ? "LOC_DEMOGRAPHICS_HIST_STORAGE_BLOCKED" : "LOC_DEMOGRAPHICS_HIST_STORAGE_UNREADABLE";
  return el("div", { cls: "dgh-note dgh-note--warn", text: t(tag) });
}

/**
 * Render the selected Hall of Fame section.
 * @param {HTMLElement} body Container.
 * @param {ArchiveRecord[]} records Visible records.
 * @param {ArchiveRecord[]} all Every record.
 * @param {HofCtx} ctx Context.
 */
function renderSection(body, records, all, ctx) {
  if (viewState.hofTab === "games") renderGames(body, records, all, ctx);
  else if (viewState.hofTab === "leaders") renderLeaders(body, records);
  else if (viewState.hofTab === "civs") renderCivs(body, records);
  else if (viewState.hofTab === "records") renderRecords(body, records, ctx);
  else renderBest(body, records, all, ctx);
}

/**
 * Render the Hall of Fame.
 * @param {HTMLElement} host Container.
 * @param {HofCtx} ctx Context.
 */
export function renderHof(host, ctx) {
  clear(host);
  const all = hofRecords(ctx.live);
  addSavedTexts(archiveTexts());
  for (const r of all) addSavedTexts(r.texts);
  const records = visibleRecords(all, { showShort: viewState.showShort, keep: ctx.live?.id });
  const detail = viewState.detail ? all.find((r) => r.id === viewState.detail) : null;
  if (detail) {
    renderDetail(host, detail, all, ctx);
    return;
  }
  viewState.detail = null;
  host.appendChild(sectionNav(ctx));
  const body = el("div", { cls: "dgh-view-body" });
  host.appendChild(body);
  if (!all.length) body.appendChild(emptyState(t("LOC_DEMOGRAPHICS_HIST_EMPTY_HOF")));
  else renderSection(body, records, all, ctx);
  const note = storageNote();
  if (note) host.appendChild(note);
}
