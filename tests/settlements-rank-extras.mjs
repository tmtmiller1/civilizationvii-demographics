// Covers: settlements-wonder-years.js, settlements-holy.js, settlements-age-archive.js,
//         view-settlements-showcase.js (medal rows, own-settlement outline, world-leader icons,
//         holy badge, wonder completion tooltip, end-of-age pills).
import assert from "node:assert/strict";
import { createFakeDocument } from "./_dom-stub.mjs";

const { document } = createFakeDocument();
globalThis.document = document;
globalThis.Locale = { compose: (k, ...a) => [String(k).replace(/^LOC_/, ""), ...a].join("|") };
globalThis.GameContext = { localPlayerID: 1 };
globalThis.Configuration = { getGame: () => ({ startSeed: "seed1" }) };
globalThis.UI = { getIconURL: (type) => "blp:" + type };
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k)
};

// ── Wonder completion years: only an observed completion is dated ─────────────
const { wonderCompletionYears, annotateWonderYears } = await import(
  "/demographics/ui/screen-demographics/settlements/settlements-wonder-years.js"
);
const history = {
  samples: [
    { gameYear: "3000 BCE", players: { 1: { wonderTypes: ["W_OLD"] }, 2: {} } },
    { gameYear: "2500 BCE", players: { 1: { wonderTypes: ["W_OLD"] }, 2: { wonderTypes: ["W_NEW"] } } },
    // W_NEW changes hands: 1 now holds it. A capture must not re-date it.
    { gameYear: "2000 BCE", players: { 1: { wonderTypes: ["W_OLD", "W_NEW"] }, 2: {} } },
    // Civ 3 first appears already holding W_LATE: predates its history, undated.
    { gameYear: "1500 BCE", players: { 3: { wonderTypes: ["W_LATE"] } } }
  ]
};
const years = wonderCompletionYears(history);
assert.equal(years.has("W_OLD"), false, "a wonder held on the civ's first sample is not dated");
assert.equal(years.get("W_NEW"), "2500 BCE", "an observed completion carries its sample year");
assert.equal(years.has("W_LATE"), false, "a civ's first sample only seeds");
assert.equal(wonderCompletionYears(null).size, 0);
const annotated = [{ wonders: [{ type: "W_NEW" }, { type: "W_OLD" }, null] }, {}];
annotateWonderYears(annotated, history);
assert.equal(annotated[0].wonders[0].year, "2500 BCE");
assert.equal(annotated[0].wonders[1].year, undefined);
annotateWonderYears(annotated, { samples: [] }); // no years → no-op

// ── Holy cities: matched by unique name only ──────────────────────────────────
const religion = (holyName, type) => ({
  getHolyCityName: () => holyName,
  getReligionType: () => type,
  getReligionName: () => ""
});
globalThis.GameInfo = {
  Religions: { lookup: (t) => (t === 7 ? { ReligionType: "RELIGION_BUDDHISM", Name: "LOC_BUDDHISM" } : null) },
  Ages: { lookup: (a) => ({ AGE_ANTIQUITY: { Name: "LOC_AGE_ANTIQUITY_NAME" } })[a] || null }
};
globalThis.Players = {
  getEverAlive: () => [
    { Religion: religion("Kyoto", 7) },
    { Religion: religion("", null) },
    { Religion: religion("Paris", 7) },
    {}
  ]
};
const { attachHolyCities } = await import("/demographics/ui/screen-demographics/settlements/settlements-holy.js");
const holyList = [{ name: "Kyoto" }, { name: "Paris" }, { name: "Paris" }, { name: "Rome" }];
attachHolyCities(holyList);
assert.deepEqual(holyList[0].holy, { religionName: "BUDDHISM", icon: "blp:RELIGION_BUDDHISM" });
assert.equal(holyList[1].holy, null, "a duplicate name never earns a guessed holy badge");
assert.equal(holyList[2].holy, null);
assert.equal(holyList[3].holy, null);
delete globalThis.Players;
const noPlayers = [{ name: "Kyoto" }];
attachHolyCities(noPlayers);
assert.equal(noPlayers[0].holy, null, "no Players global → no badges, no throw");

// ── End-of-age archive ─────────────────────────────────────────────────────────
globalThis.Game = { age: "AGE_EXPLORATION", turn: 5 };
GameInfo.Ages.lookup = (a) =>
  ({ AGE_ANTIQUITY: { Name: "LOC_AGE_ANTIQUITY_NAME" }, AGE_EXPLORATION: { AgeType: "AGE_EXPLORATION" } })[a] || null;
globalThis.Players = { getAlive: () => [], get: () => ({ Diplomacy: { hasMet: (pid) => pid === 2 } }) };
const { recordSettlementAge, readAgeArchive } = await import(
  "/demographics/ui/screen-demographics/settlements/settlements-age-archive.js"
);
const hist = { samples: [] };
assert.equal(recordSettlementAge(hist, 5, "1500 CE"), false, "an empty board records nothing");
assert.equal(hist.settleAges, undefined);
assert.equal(recordSettlementAge(null, 5, "1500 CE"), false);
const rec = (name, pid) => ({ name, composite: 50, ranks: { composite: 1 }, outputs: {}, owner: { pid } });
hist.settleAges = {
  AGE_ANTIQUITY: { turn: 90, year: "400 CE", top: [rec("Rome", 2), rec("Ctesiphon", 3)] },
  AGE_EXPLORATION: { turn: 5, year: "1500 CE", top: [rec("Lisbon", 1)] },
  AGE_BROKEN: { turn: 1, year: "", top: [] }
};
const archive = readAgeArchive(hist);
assert.equal(archive.length, 1, "the live current age and empty entries are not archived ages");
assert.equal(archive[0].age, "AGE_ANTIQUITY");
assert.equal(archive[0].label, "AGE_ANTIQUITY_NAME");
assert.equal(archive[0].year, "400 CE");
assert.equal(archive[0].top[0].archived, true);
assert.equal(archive[0].top[0].location, null);
assert.equal(archive[0].top[0].owner.met, true, "met state is re-read at render");
assert.equal(archive[0].top[1].owner.met, false);
Game.age = undefined;
assert.deepEqual(readAgeArchive(hist), [], "unknown current age → nothing reads as final");
Game.age = "AGE_EXPLORATION";
assert.deepEqual(readAgeArchive(null), []);
assert.deepEqual(readAgeArchive({ settleAges: "junk" }), []);

// A live board is compacted onto the history under the CURRENT age, replacing the previous entry.
globalThis.GameContext.localPlayerID = 1;
Players.getAlive = () => [{
  id: 1, isMajor: true,
  Cities: { getCities: () => [{ name: "Lisbon", isTown: false, population: 12, location: { x: 3, y: 4 },
    Yields: { getNetYield: () => 5 }, Constructibles: { getIds: () => [], getNumWonders: () => 0 } }] }
}];
const liveHist = { samples: [], settleAges: { AGE_EXPLORATION: { turn: 1, year: "old", top: [] } } };
assert.equal(recordSettlementAge(liveHist, 6, "1510 CE"), true);
assert.equal(liveHist.settleAges.AGE_EXPLORATION.year, "1510 CE");
assert.equal(liveHist.settleAges.AGE_EXPLORATION.top.length, 1);
assert.equal(liveHist.settleAges.AGE_EXPLORATION.top[0].name, "Lisbon");
assert.equal(liveHist.settleAges.AGE_EXPLORATION.top[0].owner.pid, 1);
assert.equal(liveHist.settleAges.AGE_EXPLORATION.top[0].owner.met, undefined, "met is never frozen");
Players.getAlive = () => [];

// ── Showcase: medal rows, own outline, world-leader icons, holy badge, pills ──
const { renderShowcasePanel, rankedRowClass, isOwnSettlement } = await import(
  "/demographics/ui/screen-demographics/views/settlements/view-settlements-showcase.js"
);
const { SETTLEMENT_OUTPUTS } = await import("/demographics/ui/screen-demographics/settlements/settlements-data.js");
const firstCol = SETTLEMENT_OUTPUTS[0].id;
const secondCol = SETTLEMENT_OUTPUTS[1].id;
const live = (name, pid, place, extra) =>
  Object.assign(
    {
      name,
      composite: 90 - place,
      ranks: { composite: place },
      outputs: { [firstCol]: 10, [secondCol]: 0 },
      wonders: [],
      owner: { pid, leaderName: "L" + pid, civName: "C" + pid }
    },
    extra
  );
const board = [
  live("Kyoto", 1, 1, {
    ranks: { composite: 1, [firstCol]: 1, [secondCol]: 1 },
    holy: { religionName: "Buddhism", icon: "blp:RELIGION_BUDDHISM" },
    wonders: [{ type: "W_NEW", icon: "blp:w", nameKey: "LOC_W_NEW", year: "2500 BCE" }]
  }),
  live("Rome", 2, 2),
  live("Paris", 3, 3, { holy: { religionName: "Hidden", icon: "blp:x" }, masked: true }),
  live("Oslo", 1, 4)
];
const el = (tag = "div") => document.createElement(tag);
const mk = (cls, text) => {
  const d = el();
  d.className = cls || "";
  if (text != null) d.textContent = text;
  return d;
};
let rerenders = 0;
const deps = {
  topN: 25,
  safePlaySound: () => {},
  rerenderContent: () => {
    rerenders++;
  },
  displayOf: (_st, s) => s,
  buildLaurelMedal: () => mk("medal"),
  buildOwnerAvatar: () => mk("avatar"),
  buildOutputStrip: () => mk("strip"),
  buildTypeBadge: () => mk("type"),
  buildCameraButtons: () => null,
  buildSectionTitle: (k) => mk("title", k),
  buildListHeader: () => mk("head"),
  buildEmpty: () => mk("empty"),
  buildTrendGlyph: () => mk("trend")
};
const st = { board: { settlements: board }, content: el(), showcaseAge: "now" };
renderShowcasePanel(st, deps);
const rows = st.content.querySelectorAll(".demographics-settle-list-row");
assert.equal(rows.length, 4);
assert.ok(rows[0].classList.contains("demographics-settle-medalrow-1"));
assert.ok(rows[1].classList.contains("demographics-settle-medalrow-2"));
assert.ok(rows[2].classList.contains("demographics-settle-medalrow-3"));
assert.ok(!rows[3].className.includes("medalrow"), "place 4 has no medal tint");
assert.ok(rows[0].classList.contains("is-own") && rows[3].classList.contains("is-own"));
assert.ok(!rows[1].classList.contains("is-own"));
assert.ok(!rows[2].classList.contains("is-own"), "a masked settlement is never marked own");
const leads = rows[0].querySelectorAll(".demographics-settle-lead-icon");
assert.equal(leads.length, 1, "a rank-1 output with a zero value earns no leader icon");
assert.equal(rows[1].querySelector(".demographics-settle-lead-icons"), null);
const holy = rows[0].querySelector(".demographics-settle-badge-holy");
assert.ok(holy && holy.querySelector(".demographics-settle-holy-icon"));
assert.match(holy.getAttribute("data-tooltip-content"), /Buddhism/);
const maskedHoly = rows[2].querySelector(".demographics-settle-badge-holy");
assert.ok(maskedHoly, "a masked holy city keeps the badge");
assert.equal(maskedHoly.querySelector(".demographics-settle-holy-icon"), null, "…but not the religion icon");
assert.equal(maskedHoly.getAttribute("data-tooltip-content"), undefined, "…or the religion name");
assert.equal(rows[1].querySelector(".demographics-settle-badge-holy"), null);
const wonderTip = rows[0].querySelector(".demographics-settle-wonder-icon").getAttribute("data-tooltip-content");
assert.equal(wonderTip, "W_NEW · DEMOGRAPHICS_SETTLEMENTS_WONDER_BUILT|2500 BCE");
assert.equal(st.content.querySelector(".demographics-settle-age-pills"), null, "no archive → no pills");

// With an archived age: pills appear; picking it swaps the board and adds the note.
const archived = [{ age: "AGE_ANTIQUITY", label: "Antiquity", year: "400 CE",
  top: [live("Ctesiphon", 3, 1, { archived: true })] }];
const st2 = { board: { settlements: board }, content: el(), showcaseAge: "now" };
renderShowcasePanel(st2, { ...deps, archive: archived });
const pills = st2.content.querySelectorAll(".demographics-chart-time-filter-pill");
assert.equal(pills.length, 2);
assert.ok(pills[0].classList.contains("is-active"));
assert.equal(st2.content.querySelectorAll(".demographics-settle-list-row").length, 4);
pills[0].dispatch("click"); // already active → no rerender
assert.equal(rerenders, 0);
pills[1].dispatch("click");
assert.equal(st2.showcaseAge, "AGE_ANTIQUITY");
assert.equal(rerenders, 1);
const st3 = { board: { settlements: board }, content: el(), showcaseAge: "AGE_ANTIQUITY" };
let trendCalls = 0;
renderShowcasePanel(st3, { ...deps, archive: archived, buildTrendGlyph: () => (trendCalls++, mk("trend")) });
const archRows = st3.content.querySelectorAll(".demographics-settle-list-row");
assert.equal(archRows.length, 1);
assert.match(archRows[0].querySelector(".demographics-settle-list-name").textContent, /Ctesiphon/);
assert.match(st3.content.querySelector(".demographics-settle-age-note").textContent, /400 CE/);
// Podium + list both render the archived settlement; neither shows a live trend.
assert.equal(trendCalls, 0, "an archived record has no trend glyph");

// ── Civilization Ranking: medal rows, own outline, civ-level world-leader icons ──
const { renderCivRankingPanel } = await import(
  "/demographics/ui/screen-demographics/views/settlements/view-settlements-civranking.js"
);
const yieldCols = SETTLEMENT_OUTPUTS.filter((c) => c.composite && c.yt);
const civSettle = (pid, out, isMajor = true) => ({
  owner: { pid, isMajor, leaderName: "L" + pid, civName: "C" + pid, met: true },
  populationEstimate: 1000, outputs: out
});
const civBoard = [
  Object.assign(civSettle(1, { [yieldCols[0].id]: 50, [yieldCols[1].id]: 5 }), { isCapital: true, name: "Lisbon" }),
  civSettle(2, { [yieldCols[0].id]: 10, [yieldCols[1].id]: 30 }),
  civSettle(3, { [yieldCols[0].id]: 5 }),
  civSettle(4, { [yieldCols[0].id]: 1 }),
  civSettle(9, { [yieldCols[0].id]: 999 }, false) // a city-state never enters the civ board
];
const civSt = { board: { settlements: civBoard }, content: el(), showUnmetNames: true };
renderCivRankingPanel(civSt, {
  buildEmpty: () => mk("empty"), buildSectionTitle: (k) => mk("title", k), buildListHeader: () => mk("head"),
  buildOwnerAvatar: () => mk("avatar"), buildOutputStrip: () => mk("strip"), buildLaurelMedal: () => mk("medal"),
  buildCameraButtons: (s) => mk("cams", s.name),
  maskOwner: (o) => o
});
// Podium cards follow the Top 25 card line for line: capital line + the capital's camera buttons.
const civCards = civSt.content.querySelectorAll(".demographics-settle-podium-card");
assert.equal(civCards.length, 3);
assert.equal(civCards[0].querySelector(".demographics-settle-podium-civ").textContent,
  "DEMOGRAPHICS_SETTLEMENTS_CAPITAL_OF|Lisbon");
assert.equal(civCards[0].querySelector(".cams").textContent, "Lisbon", "camera buttons target the capital");
assert.equal(civCards[1].querySelector(".demographics-settle-podium-civ"), null, "no capital → no capital line");
assert.equal(civCards[1].querySelector(".cams"), null, "no capital → no camera buttons");
const civRows = civSt.content.querySelectorAll(".demographics-settle-list-row");
assert.equal(civRows.length, 4, "major civs only");
assert.ok(civRows[0].classList.contains("demographics-settle-medalrow-1"));
assert.ok(civRows[2].classList.contains("demographics-settle-medalrow-3"));
assert.ok(!civRows[3].className.includes("medalrow"));
GameContext.localPlayerID = 1;
assert.ok(civRows[0].classList.contains("is-own"), "the local civ's row is outlined");
assert.ok(!civRows[1].classList.contains("is-own"));
assert.equal(civRows[0].querySelectorAll(".demographics-settle-lead-icon").length, 1, "civ 1 leads output 0");
assert.equal(civRows[1].querySelectorAll(".demographics-settle-lead-icon").length, 1, "civ 2 leads output 1");
assert.equal(civRows[2].querySelector(".demographics-settle-lead-icons"), null);

// ── Settlement Rank by Yield: leaders marked in the table, no strip ──────────────
const { renderTablePanel } = await import(
  "/demographics/ui/screen-demographics/views/settlements/view-settlements-table.js"
);
const c0 = SETTLEMENT_OUTPUTS[0].id, c1 = SETTLEMENT_OUTPUTS[1].id;
const tRow = (name, a, b) => ({ name, composite: a, ranks: {}, outputs: { [c0]: a, [c1]: b }, owner: { pid: 7 } });
const tSt = { board: { settlements: [tRow("A", 9, 0), tRow("B", 5, 0), tRow("C", 5, 0)] }, content: el(),
  filter: "all", sortKey: "composite", settings: {} };
renderTablePanel(tSt, { topN: 25, setSetting: () => {}, safePlaySound: () => {}, rerenderContent: () => {},
  displayOf: (_st, x) => x, buildOwnerCell: () => mk("owner"), buildTypeBadge: () => mk("type"),
  buildSectionTitle: (k) => mk("title", k), buildEmpty: () => mk("empty") });
assert.equal(tSt.content.querySelector(".demographics-settle-leaders"), null, "no leader-card strip");
const tLeads = tSt.content.querySelectorAll(".demographics-settle-td.is-leader");
assert.equal(tLeads.length, 1, "column 0 has one leader; column 1 (all zero) has none");
assert.ok(tLeads[0].className.includes("demographics-settle-col-" + c0));
assert.equal(tLeads[0].textContent, "9");

// ── rankedRowClass / isOwnSettlement edges ──────────────────────────────────────
assert.equal(rankedRowClass("r", { owner: { pid: 9 } }, 0), "r");
assert.equal(isOwnSettlement(null), false);
delete globalThis.GameContext;
assert.equal(isOwnSettlement({ owner: { pid: 1 } }), false, "no GameContext → never own");

for (const k of ["document", "Locale", "Configuration", "UI", "localStorage", "GameInfo", "Players", "Game"]) {
  delete globalThis[k];
}
console.log("settlements-rank-extras harness passed");
