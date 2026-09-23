// view-hof.js
//
// Hall of Fame: every campaign this computer has recorded. Tabs: Best Games (the landing page: the
// best playthroughs and the current game in context), Rankings, Leaders, Civilizations and Records;
// any game opens a detail page. Works both in game (the current
// campaign is included live) and at the main menu (archive only).

import { el, clear, onActivate } from "/demographics/ui/history/core/history-dom.js";
import { t, addSavedTexts } from "/demographics/ui/history/core/history-text.js";
import { allRecords, archiveStatus, archiveTexts, repairStorage } from "/demographics/ui/history/store/history-archive-store.js";
import { buildRecord, emptySlice, upsert } from "/demographics/ui/history/store/history-archive.js";
import { visibleRecords } from "/demographics/ui/history/model/history-hof.js";
import { emptyState, pillRow, tabBar, textButton } from "/demographics/ui/history/views/history-widgets.js";
import { SHORT_GAME_TURNS } from "/demographics/ui/history/model/history-hof.js";
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
 * The short-games filter, shown on every Hall of Fame page: unfinished games under SHORT_GAME_TURNS
 * are hidden by default as test loads, and this row says how many are hidden so an "empty" page
 * never hides that fact.
 * @param {ArchiveRecord[]} all Every record.
 * @param {ArchiveRecord[]} shown The records the page is showing.
 * @param {HofCtx} ctx Context.
 * @returns {HTMLElement} The row.
 */
function shortGamesFilter(all, shown, ctx) {
  const hidden = all.length - shown.length;
  const toggle = pillRow(
    [{ key: "hide", label: t("LOC_DEMOGRAPHICS_HIST_HIDE_SHORT") }, { key: "show", label: t("LOC_DEMOGRAPHICS_HIST_SHOW_SHORT") }],
    viewState.showShort ? "show" : "hide",
    (k) => { viewState.showShort = k === "show"; ctx.rerender(); },
    "filter"
  );
  const note = hidden > 0 && !viewState.showShort
    ? el("div", { cls: "dgh-filter-note", text: t("LOC_DEMOGRAPHICS_HIST_SHORT_HIDDEN", hidden, SHORT_GAME_TURNS) })
    : null;
  return el("div", { cls: "dgh-hof-filter" }, [note, toggle]);
}

/** The last repair run this session, so its outcome stays on screen after the redraw. */
let lastRepair = /** @type {import("/demographics/ui/core/demographics-storage-repair.js").RepairResult|null} */ (null);

/**
 * The repair button: the first click arms it and the second empties the shared store and writes this
 * mod's data back (other mods re-add theirs as they save). Two clicks, in a panel that spells out
 * what is deleted, because what it deletes is gone for good. Cancel disarms it.
 * @param {HofCtx} ctx Context.
 * @returns {HTMLElement} The action row.
 */
function repairActions(ctx) {
  let armed = false;
  const go = textButton("LOC_DEMOGRAPHICS_HIST_STORAGE_FIX_GO", () => {
    if (!armed) {
      armed = true;
      go.textContent = t("LOC_DEMOGRAPHICS_HIST_STORAGE_FIX_CONFIRM");
      go.classList.add("is-armed");
      return;
    }
    lastRepair = repairStorage();
    ctx.rerender();
  }, "dgh-button--danger dgh-repair-go");
  const cancel = textButton("LOC_DEMOGRAPHICS_HIST_STORAGE_FIX_CANCEL", () => ctx.rerender(), "dgh-repair-cancel");
  return el("div", { cls: "dgh-repair-actions" }, [go, cancel]);
}

/**
 * One labelled paragraph of the repair panel.
 * @param {string} headTag LOC tag of the label.
 * @param {string} bodyTag LOC tag of the text.
 * @returns {HTMLElement} The block.
 */
function repairPara(headTag, bodyTag) {
  return el("div", { cls: "dgh-repair-block" }, [
    el("div", { cls: "dgh-repair-h", text: t(headTag) }),
    el("div", { cls: "dgh-repair-p", text: t(bodyTag) })
  ]);
}

/**
 * The repair sheet: a title, why it is needed, what the button does, and the two-click button.
 * Starts folded; {@link wireToggle} opens it.
 * @param {HofCtx} ctx Context.
 * @returns {HTMLElement} The sheet.
 */
function repairPanel(ctx) {
  return el("div", { cls: "dgh-options-panel dgh-repair is-hidden" }, [
    el("div", { cls: "dgh-repair-title", text: t("LOC_DEMOGRAPHICS_HIST_STORAGE_FIX_TITLE") }),
    repairPara("LOC_DEMOGRAPHICS_HIST_STORAGE_FIX_WHY_H", "LOC_DEMOGRAPHICS_HIST_STORAGE_FIX_WHY"),
    repairPara("LOC_DEMOGRAPHICS_HIST_STORAGE_FIX_DOES_H", "LOC_DEMOGRAPHICS_HIST_STORAGE_FIX_DOES"),
    el("div", { cls: "dgh-repair-again", text: t("LOC_DEMOGRAPHICS_HIST_STORAGE_FIX_AGAIN") }),
    repairActions(ctx)
  ]);
}

/**
 * Make an element open and close the repair sheet.
 * @param {HTMLElement} trigger The element to click.
 * @param {HTMLElement} panel The sheet.
 */
function wireToggle(trigger, panel) {
  trigger.classList.add("dgh-options-toggle");
  onActivate(trigger, () => {
    const open = panel.classList.contains("is-hidden");
    if (open) { panel.classList.remove("is-hidden"); trigger.classList.add("is-open"); }
    else { panel.classList.add("is-hidden"); trigger.classList.remove("is-open"); }
  });
}

/**
 * The blocked banner, which is itself the button that opens the repair sheet: the headline names
 * the game bug and the second line says a workaround is one click away.
 * @returns {HTMLElement} The banner.
 */
function blockedBanner() {
  return el("div", { cls: "dgh-storage-banner dgh-storage-banner--button" }, [
    el("div", { cls: "dgh-storage-banner-h", text: t("LOC_DEMOGRAPHICS_HIST_STORAGE_BLOCKED_H") }),
    el("div", { cls: "dgh-storage-banner-cta", text: t("LOC_DEMOGRAPHICS_HIST_STORAGE_FIX") })
  ]);
}

/**
 * What the last repair did, once one has been run this session.
 * @returns {HTMLElement|null} Note, or null when none has run.
 */
function repairOutcomeNote() {
  if (!lastRepair) return null;
  return el("div", {
    cls: "dgh-note " + (lastRepair.ok ? "" : "dgh-note--warn"),
    text: t(lastRepair.ok ? "LOC_DEMOGRAPHICS_HIST_STORAGE_FIX_OK" : "LOC_DEMOGRAPHICS_HIST_STORAGE_FIX_FAIL")
  });
}

/**
 * The footer when the archive could NOT be read: what is wrong, what the last repair did, and -
 * when a repair could help - the way out.
 * @param {string} status Archive status.
 * @param {HTMLElement|null} done Outcome of the last repair, if any.
 * @param {HofCtx} ctx Context.
 * @returns {HTMLElement} Note.
 */
function blockedNote(status, done, ctx) {
  // "foreign": the game handed back another mod's saved data instead of the shared settings (a game
  // storage bug: reads return the first key in sort order), so nothing is read or written.
  // "unavailable" means this context has no storage at all, which no repair can change.
  const panel = status === "unavailable" ? null : repairPanel(ctx);
  let trigger;
  if (status === "foreign") trigger = blockedBanner();
  else trigger = el("div", { cls: "dgh-note dgh-note--warn", text: t("LOC_DEMOGRAPHICS_HIST_STORAGE_UNREADABLE") });
  const kids = [trigger];
  if (done) kids.push(done);
  if (panel) {
    if (status === "foreign") wireToggle(trigger, panel);
    else {
      const b = textButton("LOC_DEMOGRAPHICS_HIST_STORAGE_FIX", () => {}, "dgh-repair-toggle");
      wireToggle(b, panel);
      kids.push(b);
    }
    kids.push(el("div", { cls: "dgh-options" }, [panel]));
  }
  return el("div", { cls: "dgh-storage" }, kids);
}

/**
 * Footer describing whether the archive could be read this session, and - when it could not - the
 * way out.
 * @param {HofCtx} ctx Context.
 * @returns {HTMLElement|null} Note.
 */
function storageNote(ctx) {
  const s = archiveStatus();
  const done = repairOutcomeNote();
  if (s === "ok" || s === "empty") {
    const ok = el("div", { cls: "dgh-note", text: t("LOC_DEMOGRAPHICS_HIST_STORAGE_OK") });
    return done ? el("div", { cls: "dgh-storage" }, [ok, done]) : ok;
  }
  return blockedNote(s, done, ctx);
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
  if (all.length) host.appendChild(shortGamesFilter(all, records, ctx));
  const body = el("div", { cls: "dgh-view-body" });
  host.appendChild(body);
  if (!all.length) body.appendChild(emptyState(t("LOC_DEMOGRAPHICS_HIST_EMPTY_HOF")));
  else renderSection(body, records, all, ctx);
  const note = storageNote(ctx);
  if (note) host.appendChild(note);
}
