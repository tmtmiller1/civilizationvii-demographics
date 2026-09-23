// Render smoke test: every tab and every Hall of Fame page renders into a GameFace-like DOM stub
// without logging an error. the entry points catch exceptions (so a broken view never takes the screen
// down in game), which is exactly why this test fails on any console.error.
import assert from "node:assert/strict";
import { createFakeDocument } from "./_dom-stub.mjs";
import { installEchoLocale, buggyStorage, pstate, world } from "./_history-fixtures.mjs";

const { document } = createFakeDocument();
globalThis.document = document;
// A recording 2D context for the territory map's canvas.
const paints = { hexes: 0, towns: 0 };
const baseCreate = document.createElement.bind(document);
document.createElement = (tag) => {
  const node = baseCreate(tag);
  if (String(tag).toLowerCase() === "canvas") {
    let arcs = false;
    node.getContext = () => ({
      clearRect() {}, beginPath() { arcs = false; }, moveTo() {}, lineTo() {}, closePath() {}, stroke() {},
      arc() { arcs = true; }, fill() { if (arcs) paints.towns++; else paints.hexes++; }
    });
  }
  return node;
};
installEchoLocale();
const errors = [];
console.error = (...a) => errors.push(a.map(String).join(" "));

const { newCampaign, ensureAge, upsertPlayer, appendEvents, appendSample } = await import("/demographics/ui/history/store/history-campaign.js");
const { buildRecord } = await import("/demographics/ui/history/store/history-archive.js");

// A two-age campaign with every event kind.
const doc = newCampaign({ id: "live", seed: 1, now: 1, setup: { speed: "LOC_S", difficulty: "LOC_D", mapSize: "LOC_M", mapScript: "{base-standard}maps/continents-plus.js", startAge: "AGE_ANTIQUITY" }, local: 0 });
const idn = (leader, civ) => ({ leader, leaderName: "LOC_" + leader, civ, civName: "LOC_" + civ, color: "#abc", human: leader === "LEADER_A" });
ensureAge(doc, "AGE_ANTIQUITY", 1);
upsertPlayer(doc, 0, idn("LEADER_A", "CIV_ROME"), { age: "AGE_ANTIQUITY", turn: 1 });
upsertPlayer(doc, 1, idn("LEADER_B", "CIV_EGYPT"), { age: "AGE_ANTIQUITY", turn: 1 });
const kinds = ["found", "capture", "razed", "wonder", "war", "peace", "religion", "triumph", "met", "elim", "disaster", "crisis"];
appendEvents(doc, [{ t: 1, a: 0, k: "age", p: -1, x: "AGE_ANTIQUITY", n: "LOC_AGE_A", d: "4000 BCE" }, ...kinds.map((k, i) => ({ t: 2 + i, a: 0, k, p: 0, q: 1, n: "LOC_N", x: "X" })),
  { t: 5, a: 0, k: "wonder", p: 1, x: "W_R", n: "LOC_W_R" }, { t: 6, a: 0, k: "found", p: 1, n: "LOC_CITY_R" }]);
for (let t = 1; t <= 12; t++) {
  ensureAge(doc, "AGE_ANTIQUITY", t);
  appendSample(doc, world(t, { 0: pstate({ cities: { a: "A" }, population: t, popScaled: t * 1e5, mig: { i: t * 300, o: t * 100 } }), 1: pstate() }));
}
ensureAge(doc, "AGE_EXPLORATION", 1);
upsertPlayer(doc, 0, idn("LEADER_A", "CIV_NORMAN"), { age: "AGE_EXPLORATION", turn: 1 });
appendEvents(doc, [{ t: 1, a: 1, k: "age", p: -1, x: "AGE_EXPLORATION", n: "LOC_AGE_E" }, { t: 1, a: 1, k: "civ", p: 0, x: "CIV_NORMAN", n: "LOC_CIV_NORMAN" }, { t: 30, a: 1, k: "victory", p: 0, x: "VICTORY_X", n: "LOC_VX" }]);
ensureAge(doc, "AGE_EXPLORATION", 30);
doc.map = { w: 3, h: 2, terrain: "0x2.1x3.2x1", frames: [{ t: 2, a: 0, o: "0x2.-1x2.1x1.-2x1", c: [[0, 0], [4, 1]] }, { t: 20, a: 1, o: "0x3.-1x1.1x2", c: [[0, 0], [1, 0], [4, 1]] }] };
doc.last = world(30, { 0: pstate({ cities: { a: "A", b: "B" }, population: 20 }), 1: pstate() }, { age: "AGE_EXPLORATION" });
appendSample(doc, doc.last);
doc.outcome = { status: "victory", victory: "VICTORY_X", name: "LOC_VX", winner: 0, turn: 30 };

globalThis.Configuration = { getGame: () => ({ getValue: () => JSON.stringify(doc) }), getUser: () => ({ uiFontScale: 1 }) };
const past = { ...buildRecord(doc), id: "past", outcome: { status: "defeat", victory: "", name: "", winner: 1, turn: 90 } };
globalThis.localStorage = buggyStorage({ modSettings: JSON.stringify({ "demographics-halloffame": { __schema: 1, games: { past }, hidden: {} } }) });

const { render, renderHallOfFame } = await import("/demographics/ui/history/views/history-app.js");
const { viewState } = await import("/demographics/ui/history/views/history-state.js");

/** Count descendant elements. */
const count = (n) => (n.children || []).reduce((s, c) => s + 1 + count(c), 0);
const texts = (n) => [n.textContent || "", ...(n.children || []).flatMap(texts)].join(" ");

function check(host, label) {
  assert.deepEqual(errors, [], label + " logged errors");
  assert.ok(count(host) > 5, label + " rendered content");
  assert.ok(!/undefined|NaN|\[object Object\]/.test(texts(host)), label + " shows no undefined/NaN");
  return host;
}

// History tab: both pages, through the lazy-view signature screen-demographics uses.
for (const tab of ["chronicle", "timeline", "lineage"]) {
  viewState.tab = tab;
  const host = document.createElement("div");
  render(host, { history: {}, settings: {} });
  check(host, "history:" + tab);
}

const findAll = (n, cls) => [...(n.className && String(n.className).split(/\s+/).includes(cls) ? [n] : []), ...(n.children || []).flatMap((c) => findAll(c, cls))];

// Regression guard for the standalone Hall of Fame's section tabs flashing to "Best" on every
// rerender (short-games filter, storage-repair buttons): a rerender is renderHallOfFame() on the
// still-populated host and must put the SAME fxs-tab-bar back; a section change rebuilds it.
{
  viewState.hofTab = "games";
  viewState.detail = null;
  const host = document.createElement("div");
  renderHallOfFame(host, { mode: "shell" });
  const bar1 = findAll(host, "dgh-subtabs")[0];
  assert.ok(bar1 && String(bar1.tagName).toLowerCase() === "fxs-tab-bar", "own screen: sections are a tab bar");
  renderHallOfFame(host, { mode: "shell" }); // what the filter toggle's rerender() does
  assert.equal(findAll(host, "dgh-subtabs")[0], bar1, "same section: the tab bar is the SAME element");
  assert.equal(findAll(host, "dgh-subtabs").length, 1, "kept once, not duplicated");
  viewState.hofTab = "civs";
  renderHallOfFame(host, { mode: "shell" });
  assert.notEqual(findAll(host, "dgh-subtabs")[0], bar1, "a section change rebuilds the bar");
  const inGame = document.createElement("div");
  viewState.hofTab = "games";
  renderHallOfFame(inGame, { mode: "game" });
  assert.equal(findAll(inGame, "dgh-subtabs").length, 0, "in game the sections are pills, untouched by this");
}

// Regression guard for the Chronicle's page tabs flashing to "Chronicle" on every pill click: a
// pill re-render is `render(host)` on the still-populated host, and it must put the SAME
// fxs-tab-bar back rather than build a new one (a fresh bar shows tab 0 for a frame). A page
// change must still rebuild it.
{
  viewState.tab = "chronicle";
  const host = document.createElement("div");
  render(host, { history: {}, settings: {} });
  const bar1 = findAll(host, "demographics-page-tabs")[0];
  assert.ok(bar1, "the history app renders its page tab bar");
  render(host); // what a Chronicle pill's rerender() does
  assert.equal(findAll(host, "demographics-page-tabs")[0], bar1, "same page: the tab bar is the SAME element");
  assert.equal(findAll(host, "demographics-page-tabs").length, 1, "kept once, not duplicated");
  assert.equal(findAll(host, "dgh-app").length, 1, "one app root");
  viewState.tab = "lineage";
  render(host);
  assert.notEqual(findAll(host, "demographics-page-tabs")[0], bar1, "a page change rebuilds the bar");
  viewState.tab = "chronicle";
}

// Hall of Fame: every tab, in game (live campaign included) and at the main menu. Every page names
// itself, so one opened on its own says what it is.
const PAGE_TITLES = {
  overview: "LOC_DEMOGRAPHICS_HIST_HOF_BEST", games: "LOC_DEMOGRAPHICS_HIST_HOF_RANKINGS",
  leaders: "LOC_DEMOGRAPHICS_HIST_HOF_LEADERS", civs: "LOC_DEMOGRAPHICS_HIST_HOF_CIVS",
  records: "LOC_DEMOGRAPHICS_HIST_HOF_RECORDS"
};
for (const hofTab of ["overview", "games", "leaders", "civs", "records"]) {
  viewState.hofTab = hofTab;
  for (const mode of ["game", "shell"]) {
    const host = document.createElement("div");
    renderHallOfFame(host, { mode });
    check(host, mode + ":" + hofTab);
    // Nothing in this fixture is a short unfinished game, so the filter renders nothing at all:
    // it is a control for a condition that is not present, and it used to occupy a row regardless.
    assert.equal(findAll(host, "dgh-hof-filter").length, 0, "no short-games filter with nothing to hide on " + hofTab + " (" + mode + ")");
    const head = findAll(host, "dgh-page-head")[0];
    assert.ok(head, "page heading on " + hofTab);
    assert.ok(texts(head).includes(PAGE_TITLES[hofTab]), "page title on " + hofTab);
    assert.ok(findAll(head, "dgh-page-note").length, "page note on " + hofTab);
  }
}

// Leader and civilization cards: the bar is the win rate over finished games, each part named with
// its share, and unfinished games are left out of it.
{
  viewState.hofTab = "leaders";
  const host = document.createElement("div");
  renderHallOfFame(host, { mode: "shell" });
  const bar = findAll(host, "dgh-record-bar")[0];
  assert.ok(bar, "record bar");
  assert.ok(findAll(bar, "dgh-record-seg").length >= 1, "a segment per result");
  const legend = findAll(host, "dgh-record-legend")[0];
  const named = texts(legend);
  assert.ok(
    ["LOC_DEMOGRAPHICS_HIST_N_WON", "LOC_DEMOGRAPHICS_HIST_N_NOT_WON", "LOC_DEMOGRAPHICS_HIST_NO_FINISHED",
      "LOC_DEMOGRAPHICS_HIST_N_UNFINISHED"].some((k) => named.includes(k)),
    "every part of the bar is named"
  );
  assert.ok(named.includes("LOC_DEMOGRAPHICS_HIST_PERCENT"), "and given its share");
  assert.ok(texts(findAll(host, "dgh-person-rate")[0]).includes("LOC_DEMOGRAPHICS_HIST_STAT_WIN_RATE"), "the rate says what it is");
  const segs = findAll(host, "dgh-record-seg");
  const widths = segs.map((n) => Number(String(n.style.width || "").replace("%", "")));
  assert.ok(widths.every((w) => w > 0), "a segment only for a part that happened");
  for (const card of findAll(host, "dgh-person-card")) {
    const total = findAll(card, "dgh-record-seg").reduce((n, e) => n + Number(String(e.style.width || "0").replace("%", "")), 0);
    assert.ok(total === 0 || Math.abs(total - 100) < 0.01, "the bar is the finished games, whole (got " + total + ")");
  }
}
// The landing page: the best games on a podium, and the current game at its rank.
{
  viewState.hofTab = "overview";
  const land = document.createElement("div");
  renderHallOfFame(land, { mode: "game" });
  const fnd = (n, cls) => (String(n.className || "").split(/\s+/).includes(cls) ? n : (n.children || []).map((c) => fnd(c, cls)).find(Boolean));
  assert.ok(fnd(land, "dgh-podium"), "podium");
  assert.ok(fnd(land, "dgh-podium-card--1"), "first place");
  assert.ok(texts(land).includes("LOC_DEMOGRAPHICS_HIST_RANK_OF"), "the current game's rank");
  assert.ok(texts(land).includes("LOC_DEMOGRAPHICS_HIST_THIS_GAME"), "in game, the current game is the one being played");
  const menu = document.createElement("div");
  renderHallOfFame(menu, { mode: "shell" });
  assert.ok(texts(menu).includes("LOC_DEMOGRAPHICS_HIST_LATEST_GAME"), "at the main menu, the latest game");
}
// A Triumph in the highlights says what it was earned for and what it gave, from the words saved
// with the archive when the game was played.
{
  const { addSavedTexts, plainText } = await import("/demographics/ui/history/core/history-text.js");
  // The game marks its help text up; a plain panel shows none of it, so it is stripped when stored.
  assert.equal(plainText("Display [B]20 [icon:X][/B] [TIP:LOC_T]Relics[/TIP]."), "Display 20 Relics.");
  addSavedTexts({ DGH_LEGACY_WHY_X: "Earn 12 Codices.", DGH_LEGACY_WHAT_X: "Grants a Golden Age." });
  viewState.detail = "live";
  const host = document.createElement("div");
  renderHallOfFame(host, { mode: "game" });
  const shown = texts(host);
  assert.ok(shown.includes("Earn 12 Codices."), "what the Triumph was earned for");
  assert.ok(shown.includes("Grants a Golden Age."), "and what it gave");
  assert.ok(shown.includes("LOC_DEMOGRAPHICS_HIST_TRIUMPH_FOR"), "each line is labelled");
}

viewState.detail = "past";
const detail = check((() => { const h = document.createElement("div"); renderHallOfFame(h, { mode: "shell" }); return h; })(), "detail");
assert.ok(texts(detail).includes("LOC_DEMOGRAPHICS_HIST_REMOVE_GAME"));
const find = (n, cls) => (n.className && String(n.className).split(/\s+/).includes(cls) ? n : (n.children || []).map((c) => find(c, cls)).find(Boolean));
// Removing a game sits behind the Options toggle, folded away by default.
const panel = find(detail, "dgh-options-panel");
assert.ok(panel && panel.classList.contains("is-hidden"), "remove is folded away");
assert.ok(texts(panel).includes("LOC_DEMOGRAPHICS_HIST_REMOVE_GAME"), "remove lives in the options panel");
assert.ok(!texts(find(detail, "dgh-toolbar")).includes("LOC_DEMOGRAPHICS_HIST_REMOVE_GAME"), "not beside Back");
find(detail, "dgh-options-toggle").dispatch("click");
assert.ok(!panel.classList.contains("is-hidden"), "the toggle opens the panel");
find(detail, "dgh-options-toggle").dispatch("click");
assert.ok(panel.classList.contains("is-hidden"), "and closes it");
// The territory map sits above the timeline; highlights run the page width, grouped by age.
const mapEl = find(detail, "dgh-map");
assert.ok(mapEl && find(mapEl, "dgh-map-canvas"), "territory map");
assert.ok(paints.hexes >= 6, "every cell painted (held cells twice: terrain, then tint)");
assert.ok(paints.hexes >= 6 && paints.towns >= 3, "cells and settlements painted");
assert.equal(findAll(mapEl, "dgh-map-legend-item").length, 2, "who holds land in the last frame");
const hl = find(detail, "dgh-hl-section");
assert.ok(hl && findAll(hl, "dgh-hl-age").length === 2 && findAll(hl, "dgh-hl-kind").length > 3, "highlights by age with kind tags");
assert.ok(texts(hl).includes("LOC_DEMOGRAPHICS_HIST_KIND_WONDER"));
// The timeline: lanes, turn ticks, controls that redraw in place.
const tlRoot = find(detail, "dgh-tl");
for (const lane of ["ages", "wars", "crises", "marks-wonders", "marks-triumphs", "marks-faith", "marks-conquests", "marks-fates", "founds", "disasters", "mig", "pops", "ruler"]) {
  assert.ok(find(tlRoot, "dgh-tl-lane--" + lane), "timeline lane " + lane);
}
assert.ok(findAll(tlRoot, "dgh-tl-tick--major").length >= 3, "labelled turn ticks");
assert.ok(findAll(tlRoot, "dgh-tl-grid").length >= 3, "turn guides through the lanes");
assert.ok(findAll(tlRoot, "dgh-tl-medal").every((m) => /url\('(blp:|fs:)/.test(m.style.backgroundImage)), "milestones show game icons");
assert.ok(findAll(tlRoot, "dgh-tl-disaster").every((m) => /url\('blp:/.test(m.style.backgroundImage)), "disasters show game icons");
// Every drawn item carries a tooltip, except the stems, curve, axis and guides.
const untipped = findAll(tlRoot, "dgh-tl-item").filter((n) => !n.getAttribute?.("data-tooltip-content"))
  .map((n) => String(n.className).split(/\s+/)[1])
  .filter((c) => !["dgh-tl-stem", "dgh-tl-curve-box", "dgh-tl-mig-axis"].includes(c) && !String(c).startsWith("dgh-tl-tick"));
assert.deepEqual([...new Set(untipped)], [], "items without a tooltip");
assert.ok(findAll(tlRoot, "dgh-tl-tick--major").every((n) => n.getAttribute("data-tooltip-content")), "turn ticks name their turn");
// Each milestone kind keeps its own lane.
for (const [lane, kind] of [["marks-wonders", "wonder"], ["marks-triumphs", "triumph"], ["marks-faith", "religion"]]) {
  assert.ok(findAll(find(tlRoot, "dgh-tl-lane--" + lane), "dgh-tl-medal").every((m) => m.classList.contains("dgh-tl-medal--" + kind)), lane);
}
// The civilization filter: just yours by default; picking a rival adds its deeds.
viewState.tlCivs = null;
const civRow = find(tlRoot, "dgh-tl-civs");
assert.ok(civRow, "civilization filter");
assert.equal(findAll(civRow, "dgh-tl-civ").length, 2, "you and the rival");
assert.ok(find(civRow, "dgh-tl-civ-quick").classList.contains("is-active"), "Only mine is the default");
assert.equal(findAll(tlRoot, "is-rival").length, 0, "no rival milestones by default");
findAll(civRow, "dgh-tl-civ")[1].dispatch("click");
assert.deepEqual(viewState.tlCivs, { key: "past", pids: [0, 1] });
assert.ok(findAll(tlRoot, "is-rival").length >= 1, "the rival's wonder joins the milestones");
findAll(find(tlRoot, "dgh-tl-civs"), "dgh-tl-civ-quick")[0].dispatch("click");
assert.deepEqual(viewState.tlCivs.pids, [0], "Only mine resets");
// The population lane follows the mouse.
const popLane = find(tlRoot, "dgh-tl-lane--pops");
popLane.getBoundingClientRect = () => ({ left: 0, width: 1000, top: 0, height: 40 });
popLane.dispatch("mousemove", { clientX: 500 });
const readout = find(popLane, "dgh-tl-hover");
assert.ok(!readout.classList.contains("is-hidden") && readout.style.left === "50.000%", "readout at the mouse");
assert.ok(texts(readout).includes("LOC_DEMOGRAPHICS_HIST_TL_TURN"), "names the turn");
popLane.dispatch("mouseleave", { clientX: 600, clientY: 20 });
assert.ok(!readout.classList.contains("is-hidden"), "crossing a child inside the lane keeps it");
popLane.dispatch("mouseleave", { clientX: 1200, clientY: 20 });
assert.ok(readout.classList.contains("is-hidden"), "leaving the lane hides it");
// Regression guard for blinking timeline art: a redraw must REUSE the items that carry engine
// art — milestone medallions, disaster gems and the age bands' civilization emblems. A freshly
// inserted element paints without its `blp:` texture for a frame or more, so re-creating an
// unchanged one makes it flash.
const artItems = () => {
  const out = new Map();
  for (const cls of ["dgh-tl-medal", "dgh-tl-disaster", "dgh-tl-band"]) {
    for (const n of findAll(tlRoot, cls)) out.set(cls + "|" + n.getAttribute("data-tooltip-content"), n);
  }
  return out;
};
const artCount = () => ["dgh-tl-medal", "dgh-tl-disaster", "dgh-tl-band"]
  .reduce((n, cls) => n + findAll(tlRoot, cls).length, 0);
const agePills = findAll(find(tlRoot, "dgh-tl-controls"), "dgh-pill");
assert.equal(agePills.length, 3 + 4, "All + two ages, and four zoom levels");

const beforeAge = artItems();
assert.ok(beforeAge.size > 0, "the timeline draws art-bearing items");
agePills[2].dispatch("click");
assert.equal(viewState.tlAge, "AGE_EXPLORATION");
assert.ok(find(tlRoot, "dgh-tl-lane--ages"), "redrawn for the age");
// An age window genuinely changes WHICH items show; the ones that show in both must be the same
// elements, and nothing may be duplicated or stranded.
const afterAge = artItems();
assert.equal(afterAge.size, artCount(), "no item is duplicated by the age change");
let reusedAcrossAge = 0;
for (const [k, node] of afterAge) {
  if (!beforeAge.has(k)) continue;
  assert.equal(node, beforeAge.get(k), "an item shown in both age windows is reused: " + k);
  reusedAcrossAge++;
}
assert.ok(reusedAcrossAge > 0, "some items survive the age change and keep their elements");

// Zoom changes only the canvas width and the ruler — every lane item is identical, so the redraw
// must not touch a single one of them.
const beforeZoom = artItems();
const beforeZoomCount = artCount();
findAll(find(tlRoot, "dgh-tl-controls"), "dgh-pill")[5].dispatch("click");
assert.equal(viewState.tlZoom, 4);
assert.equal(find(tlRoot, "dgh-tl-canvas").style.width, "400%");
const afterZoom = artItems();
assert.deepEqual([...afterZoom.keys()], [...beforeZoom.keys()], "zoom changes no lane item");
assert.equal(artCount(), beforeZoomCount, "no item is lost or duplicated by a zoom");
for (const [k, node] of afterZoom) {
  assert.equal(node, beforeZoom.get(k), "zoom reuses every art-bearing item: " + k);
}
assert.ok(
  findAll(tlRoot, "dgh-tl-medal").every((m) => /url\('(blp:|fs:)/.test(m.style.backgroundImage)),
  "reused medallions keep their icons"
);
find(tlRoot, "dgh-tl-play").dispatch("click");
assert.ok(find(tlRoot, "dgh-tl-cursor"), "playback places the cursor");
assert.ok(texts(find(tlRoot, "dgh-tl-caption")).includes("LOC_DEMOGRAPHICS_HIST_TL_TURN"), "caption names the turn");
find(tlRoot, "dgh-tl-play").dispatch("click");
viewState.tlAge = "all";
viewState.tlZoom = 1;
assert.ok(texts(detail).includes("LOC_DEMOGRAPHICS_HIST_TL_TITLE"), "the detail page carries the timeline");
assert.ok(!texts(detail).includes("LOC_DEMOGRAPHICS_HIST_TREND_TITLE"), "the old trend chart is gone");
viewState.detail = null;

// Chronicle filters and ordering.
viewState.tab = "chronicle";
for (const filter of ["mine", "settlements", "war", "world"]) {
  viewState.filter = filter;
  check((() => { const h = document.createElement("div"); render(h); return h; })(), "chronicle:" + filter);
}
viewState.age = "AGE_EXPLORATION";
viewState.newestFirst = false;
check((() => { const h = document.createElement("div"); render(h); return h; })(), "chronicle:age");

// No campaign and no archive: empty states, still no errors.
globalThis.Configuration = { getGame: () => ({ getValue: () => null }), getUser: () => ({}) };
const { live } = await import("/demographics/ui/history/capture/history-live.js");
live.doc = null;
const empty = document.createElement("div");
viewState.age = "all";
render(empty);
assert.deepEqual(errors, []);
assert.ok(texts(empty).includes("LOC_DEMOGRAPHICS_HIST_EMPTY_CHRONICLE"));

// A short unfinished game is hidden by default, the filter row says how many, and "show all" reveals it on any page.
{
  const store = await import("/demographics/ui/history/store/history-archive-store.js");
  store._resetForTests();
  globalThis.localStorage = buggyStorage();
  const shortDoc = newCampaign({ id: "short-1", seed: 1, now: 1, setup: {}, local: 0 });
  ensureAge(shortDoc, "AGE_ANTIQUITY", 1);
  upsertPlayer(shortDoc, 0, idn("LEADER_X", "CIV_X"), { age: "AGE_ANTIQUITY", turn: 1 });
  const short = buildRecord(shortDoc);
  short.turns = 1;
  store.saveRecord(short);
  viewState.detail = null; viewState.showShort = false;
  for (const hofTab of ["overview", "leaders", "records"]) {
    viewState.hofTab = hofTab;
    const h = document.createElement("div");
    renderHallOfFame(h, { mode: "shell" });
    assert.ok(texts(h).includes("LOC_DEMOGRAPHICS_HIST_SHORT_HIDDEN|1|20"), "hidden count shown on " + hofTab);
    // One row: the section pills and the filter together, the filter inside it.
    const row = findAll(h, "dgh-hof-navrow")[0];
    assert.ok(row, "sections and filter share a row on " + hofTab);
    assert.equal(findAll(row, "dgh-hof-filter").length, 1, "the filter is in that row on " + hofTab);
    // One button, naming the state the player is not in.
    const btns = findAll(h, "dgh-hof-filter-btn");
    assert.equal(btns.length, 1, "one filter button on " + hofTab);
    assert.equal(btns[0].textContent, "LOC_DEMOGRAPHICS_HIST_SHOW_SHORT", "it offers the other state on " + hofTab);
    const show = findAll(h, "dgh-pill").find((n) => n.textContent === "LOC_DEMOGRAPHICS_HIST_SHOW_SHORT");
    show.dispatch("click");
    assert.ok(!texts(h).includes("LOC_DEMOGRAPHICS_HIST_SHORT_HIDDEN"), "note gone once shown on " + hofTab);
    const h2 = document.createElement("div");
    renderHallOfFame(h2, { mode: "shell" });
    assert.equal(findAll(h2, "dgh-hof-filter-btn")[0].textContent, "LOC_DEMOGRAPHICS_HIST_HIDE_SHORT",
      "and offers the way back on " + hofTab);
    viewState.showShort = false;
  }
}

// Settings that stopped persisting this session: the Hall of Fame storage note carries a line about it,
// in both the healthy-archive and the blocked-archive layouts, and nothing while settings persist.
{
  const store = await import("/demographics/ui/history/store/history-archive-store.js");
  const settings = (await import("/demographics/ui/core/demographics-settings.js")).default;
  const savedStatus = settings.persistenceStatus;
  store._resetForTests();
  globalThis.localStorage = buggyStorage({ modSettings: JSON.stringify({ x: { y: 1 } }) });
  viewState.detail = null;
  viewState.hofTab = "overview";
  settings.persistenceStatus = () => "ok";
  let h = document.createElement("div");
  renderHallOfFame(h, { mode: "shell" });
  assert.ok(!texts(h).includes("LOC_DEMOGRAPHICS_OPT_SETTINGS_NOT_SAVED"), "no settings line while settings persist");
  settings.persistenceStatus = () => "unverified";
  h = document.createElement("div");
  renderHallOfFame(h, { mode: "shell" });
  assert.ok(texts(h).includes("LOC_DEMOGRAPHICS_OPT_SETTINGS_NOT_SAVED"), "read-only settings are named on the page");
  assert.ok(findAll(h, "dgh-note--settings").length, "as a warning note");
  settings.persistenceStatus = () => "unavailable";
  h = document.createElement("div");
  renderHallOfFame(h, { mode: "shell" });
  assert.ok(texts(h).includes("LOC_DEMOGRAPHICS_OPT_SETTINGS_NO_STORAGE"), "no storage at all has its own line");
  // Blocked archive layout keeps the line too.
  store._resetForTests();
  globalThis.localStorage = buggyStorage({ "!chronicle": JSON.stringify({ games: [1] }), modSettings: JSON.stringify({ x: 1 }) });
  settings.persistenceStatus = () => "foreign";
  h = document.createElement("div");
  renderHallOfFame(h, { mode: "shell" });
  assert.ok(texts(h).includes("LOC_DEMOGRAPHICS_HIST_STORAGE_BLOCKED_H"));
  assert.ok(texts(h).includes("LOC_DEMOGRAPHICS_OPT_SETTINGS_NOT_SAVED"), "settings line under the blocked banner");
  settings.persistenceStatus = savedStatus;
}

// Another mod's data in the way (a key sorting ahead of modSettings is read in its place): the note says so.
{
  const store = await import("/demographics/ui/history/store/history-archive-store.js");
  store._resetForTests();
  globalThis.localStorage = buggyStorage({ "!chronicle": JSON.stringify({ games: [1, 2, 3] }), modSettings: JSON.stringify({ x: 1 }) });
  const h = document.createElement("div");
  viewState.detail = null;
  viewState.hofTab = "overview";
  renderHallOfFame(h, { mode: "shell" });
  assert.ok(texts(h).includes("LOC_DEMOGRAPHICS_HIST_STORAGE_BLOCKED_H"), "blocked banner names the bug");
  assert.ok(findAll(h, "dgh-storage-banner").length, "it is a banner, not a footnote");
  assert.ok(!texts(h).includes("LOC_DEMOGRAPHICS_HIST_STORAGE_UNREADABLE"));

  // ... and the way out is offered: a fold-out holding a two-click repair.
  const toggle = findAll(h, "dgh-options-toggle")[0];
  assert.ok(toggle, "the blocked note offers storage options");
  const panel = findAll(h, "dgh-options-panel")[0];
  assert.ok(String(panel.className).includes("is-hidden"), "the repair starts folded away");
  toggle.dispatch("click");
  assert.ok(!String(panel.className).includes("is-hidden"), "the toggle opens it");

  // The panel spells out what the repair does, deletes and leaves alone before any button.
  const panelText = texts(panel);
  for (const tag of ["TITLE", "WHY_H", "WHY", "DOES_H", "DOES", "AGAIN"]) {
    assert.ok(panelText.includes("LOC_DEMOGRAPHICS_HIST_STORAGE_FIX_" + tag), "panel carries " + tag);
  }

  // Cancel closes the fold-out without touching anything.
  findAll(panel, "dgh-repair-cancel")[0].dispatch("click");
  assert.equal(localStorage.length, 2, "cancel changes nothing");
  assert.ok(String(findAll(h, "dgh-options-panel")[0].className).includes("is-hidden"), "cancel folds it away");
  findAll(h, "dgh-options-toggle")[0].dispatch("click");
  const panel2 = findAll(h, "dgh-options-panel")[0];

  // One click only arms the button - the store must still be untouched.
  const go = findAll(panel2, "dgh-repair-go")[0];
  assert.ok(go, "repair button");
  assert.equal(go.textContent, "LOC_DEMOGRAPHICS_HIST_STORAGE_FIX_GO");
  go.dispatch("click");
  assert.equal(localStorage.length, 2, "arming changes nothing");
  assert.ok(String(go.className).includes("is-armed"));
  assert.equal(go.textContent, "LOC_DEMOGRAPHICS_HIST_STORAGE_FIX_CONFIRM");

  // The second click repairs, and the footer says so.
  go.dispatch("click");
  assert.deepEqual(Object.keys(localStorage.dump()), ["modSettings"], "the shared key is the only row left");
  assert.ok(store.archiveStatus() === "ok");
  assert.deepEqual(errors, []);
  const after = texts(h);
  assert.ok(after.includes("LOC_DEMOGRAPHICS_HIST_STORAGE_FIX_OK"), "the outcome is reported");
  assert.ok(!after.includes("LOC_DEMOGRAPHICS_HIST_STORAGE_BLOCKED_H"), "the blocked banner is gone");
  assert.ok(!findAll(h, "dgh-options-toggle").length, "and so is the repair offer");
}

// A record that passes the storage gate but carries none of the optional parts (no figures, trend,
// rivals, highlights, ages or setup) renders every page and its own page, each part reading as
// "none"; a record a later version wrote is left out of every page and logs nothing.
const bare = {
  v: 1, id: "bare", created: 1, updated: 2, local: 0, leader: "LEADER_ZETA", leaderName: "", color: "#123",
  civs: [{ age: "AGE_ANTIQUITY", civ: "CIV_ZETA", name: "", from: 1 }], turns: 50,
  outcome: { status: "victory", victory: "VICTORY_X", name: "", winner: 0, turn: 50 }
};
{
  const store = await import("/demographics/ui/history/store/history-archive-store.js");
  const { hofRecords } = await import("/demographics/ui/history/views/view-hof.js");
  store._resetForTests();
  const future = { v: 2, id: "future", updated: 3, shape: "unknown" };
  globalThis.localStorage = buggyStorage({ modSettings: JSON.stringify({ "demographics-halloffame": { __schema: 1, games: { bare, future }, hidden: {} } }) });
  viewState.detail = null;
  viewState.showShort = false;
  for (const hofTab of ["overview", "games", "leaders", "civs", "records"]) {
    viewState.hofTab = hofTab;
    const h = document.createElement("div");
    renderHallOfFame(h, { mode: "shell" });
    check(h, "bare:" + hofTab);
    assert.ok(texts(h).includes("Zeta"), "the game is on " + hofTab);
  }
  assert.deepEqual(hofRecords(null).map((r) => r.id), ["bare"], "the later version's record is not listed");
  viewState.detail = "bare";
  const h = document.createElement("div");
  renderHallOfFame(h, { mode: "shell" });
  check(h, "bare:detail");
  const shown = texts(h);
  for (const tag of ["LOC_DEMOGRAPHICS_HIST_BACK_TO_HOF", "LOC_DEMOGRAPHICS_HIST_NO_RIVALS", "LOC_DEMOGRAPHICS_HIST_NO_HIGHLIGHTS"]) {
    assert.ok(shown.includes(tag), "detail carries " + tag);
  }
  viewState.detail = null;
}

// A game page that fails halfway still has its Back button, and the panel says it could not render
// instead of going blank; Back still works.
{
  const store = await import("/demographics/ui/history/store/history-archive-store.js");
  store._resetForTests();
  const broken = { ...bare, id: "broken", civs: [null] };
  globalThis.localStorage = buggyStorage({ modSettings: JSON.stringify({ "demographics-halloffame": { __schema: 1, games: { broken }, hidden: {} } }) });
  viewState.detail = "broken";
  const h = document.createElement("div");
  renderHallOfFame(h, { mode: "shell" });
  assert.equal(errors.length, 1, "logged once");
  assert.ok(/hall of fame render failed/.test(errors[0]));
  errors.length = 0;
  const shown = texts(h);
  assert.ok(shown.includes("LOC_DEMOGRAPHICS_HIST_BACK_TO_HOF"), "the way out is there");
  assert.ok(shown.includes("LOC_DEMOGRAPHICS_EMPTY_CHART_RENDER_FAILED"), "and the failure is on screen");
  find(h, "dgh-button--back").dispatch("click");
  assert.equal(viewState.detail, null, "Back leaves the page");
  errors.length = 0;
  viewState.hofTab = "overview";
}

// The History tab says so too when a page throws, instead of staying blank.
{
  live.doc = { ...doc, events: null };
  viewState.tab = "timeline";
  const h = document.createElement("div");
  render(h);
  assert.equal(errors.length, 1);
  assert.ok(/history render failed/.test(errors[0]));
  errors.length = 0;
  assert.ok(texts(h).includes("LOC_DEMOGRAPHICS_EMPTY_CHART_RENDER_FAILED"));
  live.doc = null;
  viewState.tab = "chronicle";
}

// Playback: a throw inside a tick stops the timer and relabels the button, instead of throwing
// again every 40 ms with the button still reading Pause.
{
  const { timelineGraphic } = await import("/demographics/ui/history/views/history-timeline-view.js");
  const { buildTimeline } = await import("/demographics/ui/history/model/history-timeline.js");
  const { castFromDoc } = await import("/demographics/ui/history/model/history-narrate.js");
  const savedSI = globalThis.setInterval;
  const savedCI = globalThis.clearInterval;
  let tickFn = null;
  const cleared = [];
  globalThis.setInterval = (fn) => { tickFn = fn; return 7; };
  globalThis.clearInterval = (id) => cleared.push(id);
  let seeks = 0;
  viewState.tlAge = "all";
  viewState.tlCivs = null;
  const root = timelineGraphic(buildTimeline(doc), castFromDoc(doc, "full"), { onSeek: () => { if (++seeks > 2) throw new Error("seek boom"); }, key: "tick" });
  assert.deepEqual(errors, [], "the graphic drew");
  find(root, "dgh-tl-play").dispatch("click");
  assert.equal(typeof tickFn, "function", "playing");
  assert.ok(texts(find(root, "dgh-tl-play")).includes("LOC_DEMOGRAPHICS_HIST_TL_PAUSE"));
  assert.doesNotThrow(() => tickFn());
  assert.deepEqual(cleared, [7], "the interval is cleared");
  assert.equal(errors.length, 1);
  assert.ok(/playback failed/.test(errors[0]));
  errors.length = 0;
  assert.ok(texts(find(root, "dgh-tl-play")).includes("LOC_DEMOGRAPHICS_HIST_TL_PLAY"), "the button reads Play again");
  // The other handlers outside the render try/catch log instead of throwing too.
  const lane = find(root, "dgh-tl-lane--pops");
  lane.getBoundingClientRect = () => { throw new Error("rect boom"); };
  assert.doesNotThrow(() => lane.dispatch("mousemove", { clientX: 5 }));
  const ruler = find(root, "dgh-tl-lane--ruler");
  ruler.getBoundingClientRect = () => { throw new Error("rect boom"); };
  assert.doesNotThrow(() => ruler.dispatch("click", { clientX: 5 }));
  assert.equal(errors.length, 2);
  errors.length = 0;
  globalThis.setInterval = savedSI;
  globalThis.clearInterval = savedCI;
}

// A redraw that fails (a zoom or age pill, the civilization filter) leaves a message in place of
// the graphic and never escapes the click handler.
{
  const { timelineGraphic } = await import("/demographics/ui/history/views/history-timeline-view.js");
  const { buildTimeline } = await import("/demographics/ui/history/model/history-timeline.js");
  const { castFromDoc } = await import("/demographics/ui/history/model/history-narrate.js");
  const cast = castFromDoc(doc, "full");
  let draws = 0;
  const flaky = { ...cast, civName: (...a) => { if (draws > 0) throw new Error("name boom"); return cast.civName(...a); } };
  const root = timelineGraphic(buildTimeline(doc), flaky, { key: "flaky" });
  assert.deepEqual(errors, []);
  draws++;
  const pills = findAll(find(root, "dgh-tl-controls"), "dgh-pill");
  assert.doesNotThrow(() => pills[pills.length - 1].dispatch("click"));
  assert.equal(errors.length, 1);
  assert.ok(/timeline draw failed/.test(errors[0]));
  errors.length = 0;
  assert.ok(texts(root).includes("LOC_DEMOGRAPHICS_EMPTY_CHART_RENDER_FAILED"), "the failure is on screen");
  viewState.tlZoom = 1;
  viewState.tlAge = "all";
}

// The main-menu screen's Escape handling survives a missing InputActionStatuses global: a press
// still steps back or closes, once, and never throws.
{
  const defs = {};
  globalThis.Controls = { define: (id, def) => { defs[id] = def; } };
  globalThis.engine = { on() {}, off() {} };
  const { SCREEN_ID } = await import("/demographics/ui/history/screen/history-open.js");
  await import("/demographics/ui/history/screen/screen-hall-of-fame.js");
  assert.deepEqual(errors, [], "the screen registered");
  const screen = new defs[SCREEN_ID].createInstance();
  let closed = 0;
  screen.close = () => closed++;
  const ev = (status, name) => ({ detail: { status, name }, stopPropagation() {}, preventDefault() {} });
  delete globalThis.InputActionStatuses;
  viewState.detail = "past";
  assert.doesNotThrow(() => screen._handleEngineInput(ev(2, "sys-menu")));
  assert.equal(viewState.detail, null, "Escape still steps back without the enum");
  screen._handleEngineInput(ev(2, "sys-menu"));
  assert.equal(closed, 0, "the same press's next event is folded into the first");
  screen._lastCancel = 0;
  screen._handleEngineInput(ev(2, "sys-menu"));
  assert.equal(closed, 1, "a later press closes");
  globalThis.InputActionStatuses = { FINISH: 2 };
  screen._handleEngineInput(ev(1, "sys-menu"));
  assert.equal(closed, 1, "with the enum, a press that has not finished is ignored");
  screen._handleEngineInput(ev(2, "keyboard-escape"));
  assert.equal(closed, 1, "and a non-cancel key is ignored");
  screen._handleEngineInput({ ...ev(2, "x"), isCancelInput: () => true });
  assert.equal(closed, 2);
  assert.doesNotThrow(() => screen._handleEngineInput(null));
  assert.deepEqual(errors, []);
  delete globalThis.InputActionStatuses;
}

console.log("history-render-integration harness passed");
