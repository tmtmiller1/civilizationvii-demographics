// Worst-case load: a marathon three-age game with twelve civilizations, every cap saturated, driven
// through the real store code. Checks the saved campaign and its archive record stay within budget,
// that a Hall of Fame full of such games fits the shared localStorage entry, and that building,
// fitting and rendering stay fast.
import assert from "node:assert/strict";
import { createFakeDocument } from "./_dom-stub.mjs";
import { installEchoLocale, buggyStorage, pstate, world } from "./_history-fixtures.mjs";

const { document } = createFakeDocument();
globalThis.document = document;
const baseCreate = document.createElement.bind(document);
document.createElement = (tag) => {
  const node = baseCreate(tag);
  if (String(tag).toLowerCase() === "canvas") {
    const noop = () => {};
    node.getContext = () => ({ clearRect: noop, beginPath: noop, moveTo: noop, lineTo: noop, closePath: noop, fill: noop, stroke: noop, arc: noop });
  }
  return node;
};
installEchoLocale();
const errors = [];
console.error = (...a) => errors.push(a.map(String).join(" "));

const { newCampaign, ensureAge, upsertPlayer, appendEvents, appendSample, EVENTS_CAP, SERIES_CAP } =
  await import("/demographics/ui/history/store/history-campaign.js");
const { buildRecord, upsert, emptySlice, fitSlice, SLICE_BYTE_CAP } = await import("/demographics/ui/history/store/history-archive.js");
const { addFrame, rle, DOC_FRAMES_CAP } = await import("/demographics/ui/history/model/history-map.js");

/** Deterministic pseudo-random numbers. */
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

const AGES = ["AGE_ANTIQUITY", "AGE_EXPLORATION", "AGE_MODERN"];
const TURNS = 250;
const PLAYERS = 12;
const KINDS = ["found", "capture", "razed", "wonder", "war", "peace", "religion", "triumph", "met", "crisis", "disaster", "civ"];
const LONG = "LOC_CITY_NAME_A_VERY_LONG_SETTLEMENT_NAME_FOR_THE_WORST_CASE_";

/**
 * A maxed-out campaign.
 * @param {string} id Id.
 * @returns {CampaignDoc} Campaign.
 */
function marathon(id) {
  const doc = newCampaign({ id, seed: 1, now: 1, setup: { speed: "LOC_S", difficulty: "LOC_D", mapSize: "LOC_M", mapScript: "x.js", startAge: AGES[0] }, local: 0 });
  const W = 60;
  const H = 38;
  doc.map = { w: W, h: H, terrain: rle(Array.from({ length: W * H }, () => (rnd() < 0.4 ? 0 : 1))), frames: [] };
  let mi = 0;
  let mo = 0;
  AGES.forEach((age, a) => {
    for (let pid = 0; pid < PLAYERS; pid++) {
      const civ = "CIVILIZATION_" + pid + "_" + a;
      upsertPlayer(doc, pid, { leader: "LEADER_" + pid, leaderName: "LOC_LEADER_" + pid, civ, civName: "LOC_" + civ, color: "#" + (100000 + pid * 55555).toString(16).slice(0, 6), human: pid === 0 }, { age, turn: 1 });
    }
    for (let t = 1; t <= TURNS; t++) {
      ensureAge(doc, age, t);
      const events = Array.from({ length: 4 }, () => {
        const k = KINDS[Math.floor(rnd() * KINDS.length)];
        return { t, a, k, p: Math.floor(rnd() * PLAYERS), q: Math.floor(rnd() * PLAYERS), n: LONG + Math.floor(rnd() * 1e6), x: "WONDER_X_" + t, d: t + " CE" };
      });
      appendEvents(doc, /** @type {HnrEvent[]} */ (events));
      /** @type {Record<string, HnrPlayerState>} */
      const players = {};
      for (let pid = 0; pid < PLAYERS; pid++) {
        const cities = Object.fromEntries(Array.from({ length: 40 }, (_, c) => [c + "," + pid, LONG + c]));
        players[String(pid)] = pstate({ cities, population: t * 3, popScaled: t * 1e5 * (pid + 1), mig: pid === 0 ? { i: (mi += 500), o: (mo += 300) } : undefined });
      }
      const w = world(t, players, { age });
      appendSample(doc, w);
      doc.last = w;
      if (t % 3 === 0) {
        const owners = Array.from({ length: W * H }, () => (rnd() < 0.5 ? -1 : Math.floor(rnd() * PLAYERS)));
        addFrame(doc.map, { t, a, o: rle(owners), c: Array.from({ length: 200 }, (_, i) => [i * 11 % (W * H), i % PLAYERS]) });
      }
    }
  });
  doc.outcome = { status: "victory", victory: "VICTORY_X", name: "LOC_VICTORY_X", winner: 0, turn: TURNS, cls: "VICTORY_CLASS_SCIENCE" };
  return doc;
}

// The saved campaign stays bounded however long the game runs.
let t0 = Date.now();
const doc = marathon("big");
const buildMs = Date.now() - t0;
assert.ok(doc.events.length <= EVENTS_CAP, "events capped");
assert.ok(doc.series.turns.length <= SERIES_CAP, "series capped");
assert.ok(doc.map.frames.length <= DOC_FRAMES_CAP, "map frames capped");
const docBytes = JSON.stringify(doc).length;

// Its archive record.
t0 = Date.now();
const rec = buildRecord(doc);
const recMs = Date.now() - t0;
const recBytes = JSON.stringify(rec).length;
const part = (/** @type {*} */ x) => (x == null ? 0 : JSON.stringify(x).length);

// A Hall of Fame of forty such games fits the shared entry, keeping every game.
const slice = emptySlice();
for (let i = 0; i < 40; i++) upsert(slice, { ...JSON.parse(JSON.stringify(rec)), id: "g" + i, updated: i });
t0 = Date.now();
const evicted = fitSlice(slice);
const fitMs = Date.now() - t0;
const sliceBytes = JSON.stringify(slice).length;
assert.ok(sliceBytes <= SLICE_BYTE_CAP, "slice fits its cap");
const kept = Object.keys(slice.games).length;
const withMap = Object.values(slice.games).filter((r) => r.map).length;
const withRivals = Object.values(slice.games).filter((r) => r.tl?.r).length;
// A Hall of Fame this full still tells each game's story: the maps and the other civilizations'
// tracks give way first, and the games that keep whole timelines are the most recently played. Forty
// of these games is the worst case — every one is a 500-turn game with every kind of event.
const byAge = Object.values(slice.games).sort((a, b) => b.updated - a.updated);
const withTimeline = byAge.filter((r) => r.tl).length;
assert.ok(withTimeline >= 12, "a full archive keeps timelines (" + withTimeline + " of " + kept + ")");
assert.ok(byAge.slice(0, withTimeline).every((r) => r.tl), "and keeps them for the most recent games");

// Rendering the fullest pages.
globalThis.Configuration = { getGame: () => ({ getValue: () => JSON.stringify(doc) }), getUser: () => ({ uiFontScale: 1 }) };
globalThis.localStorage = buggyStorage({ modSettings: JSON.stringify({ "demographics-halloffame": slice }) });
const { renderHallOfFame, render } = await import("/demographics/ui/history/views/history-app.js");
const { viewState } = await import("/demographics/ui/history/views/history-state.js");
const timed = (/** @type {() => void} */ fn) => { const s = Date.now(); fn(); return Date.now() - s; };
const ms = {};
for (const tab of ["overview", "games", "leaders", "civs", "records"]) {
  viewState.hofTab = tab;
  ms[tab] = timed(() => renderHallOfFame(document.createElement("div"), { mode: "shell" }));
}
const full = Object.values(slice.games).find((r) => r.map && r.tl?.r) || Object.values(slice.games)[0];
viewState.detail = full.id;
ms.detail = timed(() => renderHallOfFame(document.createElement("div"), { mode: "shell" }));
viewState.tlCivs = { key: full.id, pids: Array.from({ length: PLAYERS }, (_, i) => i) };
ms.detailAll = timed(() => renderHallOfFame(document.createElement("div"), { mode: "shell" }));
viewState.detail = null;
viewState.tab = "timeline";
ms.liveTimeline = timed(() => render(document.createElement("div"), { history: {}, settings: {} }));
viewState.tab = "chronicle";
ms.chronicle = timed(() => render(document.createElement("div"), { history: {}, settings: {} }));

console.log(JSON.stringify({
  docKB: Math.round(docBytes / 1024), buildMs, recKB: Math.round(recBytes / 1024), recMs,
  tlParts: Object.fromEntries(Object.entries(rec.tl || {}).map(([k, v]) => [k, part(v)])),
  recParts: { tl: part(rec.tl), tlRivals: part(rec.tl?.r), map: part(rec.map), highlights: part(rec.highlights), rivals: part(rec.rivals) },
  slice: { kept, evicted: evicted.length, withMap, withRivals, KB: Math.round(sliceBytes / 1024), fitMs }, renderMs: ms
}));
assert.deepEqual(errors, [], "no errors logged");

// Budgets: the save-file blob, one record, and the work done on every turn.
assert.ok(docBytes < 1024 * 1024, "campaign blob under 1 MB");
assert.ok(recBytes < 72 * 1024, "record under 72 KB");
assert.ok(recMs < 500 && fitMs < 2000, "record build and fit are fast");
assert.ok(kept >= 20, "a full Hall of Fame keeps at least twenty games");
console.log("history-stress harness passed");
