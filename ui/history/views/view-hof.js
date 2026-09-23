// view-hof.js
//
// Hall of Fame: every campaign this computer has recorded. Tabs: Best Games (the landing page: the
// best playthroughs and the current game in context), Rankings, Leaders, Civilizations and Records;
// any game opens a detail page. Works both in game (the current
// campaign is included live) and at the main menu (archive only).

import { el, clear, onActivate } from "/demographics/ui/history/core/history-dom.js";
import { t, addSavedTexts } from "/demographics/ui/history/core/history-text.js";
import { allRecords, archiveStatus, archiveTexts, repairStorage } from "/demographics/ui/history/store/history-archive-store.js";
import { buildRecord, emptySlice, isRecord, upsert } from "/demographics/ui/history/store/history-archive.js";
import { visibleRecords } from "/demographics/ui/history/model/history-hof.js";
import { emptyState, pillRow, tabBar, textButton } from "/demographics/ui/history/views/history-widgets.js";
import { SHORT_GAME_TURNS } from "/demographics/ui/history/model/history-hof.js";
import { renderBest } from "/demographics/ui/history/views/view-hof-best.js";
import { viewState } from "/demographics/ui/history/views/history-state.js";
import { renderGames, renderDetail } from "/demographics/ui/history/views/view-hof-games.js";
import { renderLeaders, renderCivs, renderRecords } from "/demographics/ui/history/views/view-hof-people.js";
import DemographicsSettings from "/demographics/ui/core/demographics-settings.js";

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
 * @property {HTMLElement|null} [priorSectionBar] The previous render's section tab bar (own screen only).
 * @property {HTMLElement|null} [filterHost] The screen's title-line slot for the short-games filter
 *   (own screen only). When present the filter is mounted there instead of on the section row.
 */

/** A finite number, or 0. */
const numOr0 = (/** @type {*} */ v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
/** A plain object, or an empty one. */
const objOf = (/** @type {*} */ v) => /** @type {Record<string, any>} */ (v && typeof v === "object" && !Array.isArray(v) ? v : {});
/** An array, or an empty one. */
const arrOf = (/** @type {*} */ v) => (Array.isArray(v) ? v : []);

/**
 * A copy of a record with every part the views read present. isRecord() checks only the fields the
 * storage rules need, so each missing part gets its empty default here and reads as "none" instead
 * of blanking the panel.
 * @param {ArchiveRecord} r Record (passed isRecord).
 * @returns {ArchiveRecord} Normalised copy.
 */
export function normalizeRecord(r) {
  const stats = objOf(r.stats);
  const spark = objOf(r.spark);
  return /** @type {ArchiveRecord} */ ({
    ...r,
    stats: {
      ...stats,
      triumphs: numOr0(stats.triumphs), wonders: numOr0(stats.wonders),
      peakSettlements: numOr0(stats.peakSettlements), captured: numOr0(stats.captured)
    },
    spark: { ...spark, tri: arrOf(spark.tri) },
    rivals: arrOf(r.rivals),
    highlights: arrOf(r.highlights),
    ages: arrOf(r.ages),
    setup: objOf(r.setup)
  });
}

/**
 * Archive records plus the live campaign's current record, normalised for the views. A record a
 * later version of this mod wrote is left out: it is kept in storage but cannot be shown.
 * @param {CampaignDoc|null} live Live campaign.
 * @returns {ArchiveRecord[]} Records.
 */
export function hofRecords(live) {
  const slice = emptySlice();
  for (const r of allRecords()) if (isRecord(r)) upsert(slice, r);
  const cur = live ? buildRecord(live) : null;
  if (cur) slice.games[cur.id] = cur;
  return Object.values(slice.games).map(normalizeRecord);
}

/**
 * The Hall of Fame section selector: a tab bar on its own screen, a pill row inside Demographics.
 * @param {HofCtx} ctx Context.
 * @returns {HTMLElement} The selector.
 */
function sectionNav(ctx) {
  const pick = (/** @type {string} */ id) => { viewState.hofTab = id; ctx.rerender(); };
  if (!ctx.embedded) {
    // Put the previous render's bar back when the section did not change (see renderHallOfFame).
    // Its listener closes over the same host and reads the section it was built for, which is
    // still the current one, so it needs no rewiring. A section change builds a new bar.
    const prior = /** @type {*} */ (ctx.priorSectionBar);
    if (prior && prior.__forTab === viewState.hofTab) return prior;
    const bar = tabBar(HOF_TABS, viewState.hofTab, pick, "dgh-subtabs");
    /** @type {*} */ (bar).__forTab = viewState.hofTab;
    return bar;
  }
  return pillRow(HOF_TABS.map((x) => ({ key: x.id, label: t(x.label) })), viewState.hofTab, pick);
}

/**
 * How many records the short-games filter takes out, whichever way it is currently set. Counted
 * against the filter rather than against what the page shows, so the control and its note read the
 * same in both states and disappear together when there is nothing to hide.
 * @param {ArchiveRecord[]} all Every record.
 * @param {HofCtx} ctx Context.
 * @returns {number} The count.
 */
function hiddenCount(all, ctx) {
  return all.length - visibleRecords(all, { showShort: false, keep: ctx.live?.id }).length;
}

/**
 * The section selector and the short-games filter as one row: the sections centred, the filter's
 * note and button at the right. They were two stacked rows, which spent a second row of height on
 * one button and put the controls far from the tabs they qualify.
 * @param {ArchiveRecord[]} all Every record.
 * @param {HofCtx} ctx Context.
 * @returns {HTMLElement} The row.
 */
function navRow(all, ctx) {
  const nav = sectionNav(ctx);
  const filter = shortGamesFilter(all, ctx);
  if (!filter) return nav;
  // On its own screen the filter belongs on the title line, which every section shares; it is
  // mounted there by renderHof and the sections keep the whole row to themselves.
  if (ctx.filterHost) {
    ctx.filterHost.appendChild(filter);
    return nav;
  }
  const row = el("div", { cls: "dgh-hof-navrow" }, [nav, filter]);
  fitHofNavRow(row);
  return row;
}

/**
 * Decide, once the row is on screen, whether the filter can share the sections' line. The filter is
 * positioned out of flow so the sections stay centred on the whole row; when the sections are wide
 * enough to reach it (1280x720, where the type scale is boosted over the layout) the two would
 * overlap, so the row stacks instead. Measured after a frame: same-tick rects can be stale in
 * GameFace, the same reason the chart's edge clamp waits.
 * @param {HTMLElement} row The nav row.
 * @returns {void}
 */
function fitHofNavRow(row) {
  const run = () => {
    try {
      if (row.isConnected === false) return;
      const nav = row.querySelector(".dgh-pill-row") || row.querySelector(".dgh-tabs");
      const filter = row.querySelector(".dgh-hof-filter");
      if (!nav || !filter) return;
      row.classList.remove("is-stacked");
      const fr = filter.getBoundingClientRect();
      // The pills' own right edge, not their container's: the container spans the row.
      const last = nav.lastElementChild;
      const nr = (last || nav).getBoundingClientRect();
      if (!(fr.width > 0) || !(nr.width > 0)) return;
      if (nr.right > fr.left - 8) row.classList.add("is-stacked");
    } catch (_) {
      // Fitting is cosmetic; the un-stacked layout stands if the measurement throws.
    }
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else setTimeout(run, 16);
}

/**
 * The short-games filter, shown on every Hall of Fame page: unfinished games under SHORT_GAME_TURNS
 * are hidden by default as test loads, and the note says how many are hidden so an "empty" page
 * never hides that fact.
 *
 * ONE button, not a pair. "Hide short games" and "Show all games" were two pills with the active
 * one lit, which reads as two commands where there is only one choice; the button now names the
 * state the player is not in, so pressing it always does what it says. Nothing renders at all when
 * no record would be filtered.
 * @param {ArchiveRecord[]} all Every record.
 * @param {HofCtx} ctx Context.
 * @returns {HTMLElement|null} The filter, or null when there is nothing to hide.
 */
function shortGamesFilter(all, ctx) {
  const hidden = hiddenCount(all, ctx);
  if (hidden <= 0) return null;
  const showing = viewState.showShort;
  const toggle = el("div", { cls: "dgh-pill dgh-hof-filter-btn", text: t(showing ? "LOC_DEMOGRAPHICS_HIST_HIDE_SHORT" : "LOC_DEMOGRAPHICS_HIST_SHOW_SHORT") });
  onActivate(toggle, () => { viewState.showShort = !viewState.showShort; ctx.rerender(); });
  const note = showing
    ? null
    : el("div", { cls: "dgh-filter-note", text: t("LOC_DEMOGRAPHICS_HIST_SHORT_HIDDEN", hidden, SHORT_GAME_TURNS) });
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
  const settingsLine = settingsNote();
  if (s === "ok" || s === "empty") {
    // Nothing to say when storage is healthy. The old footer here ("Games are saved on this
    // computer. Each save file also keeps its own record.") restated what the page already shows:
    // the list itself when there are games, and LOC_DEMOGRAPHICS_HIST_EMPTY_HOF when there are
    // none. Its one substantive claim — that a record also lives in each save — only matters when
    // the archive cannot be read, and the UNREADABLE message below already carries it, next to the
    // repair the player can act on.
    const kids = [];
    if (settingsLine) kids.push(settingsLine);
    if (done) kids.push(done);
    if (!kids.length) return null;
    return kids.length > 1 ? el("div", { cls: "dgh-storage" }, kids) : kids[0];
  }
  const blocked = blockedNote(s, done, ctx);
  if (settingsLine) blocked.appendChild(settingsLine);
  return blocked;
}

/**
 * A line saying the mod's settings changed this session are not reaching storage, when that is so.
 * The settings module goes read-only for a session when the shared store returned another mod's
 * data, could not be read, or did not read back what was written; this is the one page players
 * look at for storage trouble, and the repair below fixes it.
 * @returns {HTMLElement|null} The note, or null while settings persist normally.
 */
function settingsNote() {
  let status = "ok";
  try {
    if (typeof DemographicsSettings.persistenceStatus === "function") status = DemographicsSettings.persistenceStatus();
  } catch (_) {
    // A settings double without the accessor reports as saved.
  }
  if (status === "ok") return null;
  const tag = status === "unavailable" ? "LOC_DEMOGRAPHICS_OPT_SETTINGS_NO_STORAGE" : "LOC_DEMOGRAPHICS_OPT_SETTINGS_NOT_SAVED";
  return el("div", { cls: "dgh-note dgh-note--warn dgh-note--settings", text: t(tag) });
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
  // The title-line slot lives outside this host, so it is emptied by hand: a game's page and an
  // archive with nothing to filter both leave it blank.
  if (ctx.filterHost) clear(ctx.filterHost);
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
  host.appendChild(all.length ? navRow(all, ctx) : sectionNav(ctx));
  const body = el("div", { cls: "dgh-view-body" });
  host.appendChild(body);
  if (!all.length) body.appendChild(emptyState(t("LOC_DEMOGRAPHICS_HIST_EMPTY_HOF")));
  else renderSection(body, records, all, ctx);
  const note = storageNote(ctx);
  if (note) host.appendChild(note);
}
