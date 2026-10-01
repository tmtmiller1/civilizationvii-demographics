// Covers the spoiler guard on every board/table renderer that is not built on the line-chart series
// (chart-boards.js, chart-settlement-boards.js, chart-quarters-board.js, chart-crisis-stages.js, the
// conflicts timeline + graphs + civ dropdown). Three civs: the local player (0), a met civ (1) and an
// unmet civ (2). With the guard on (the default) no text or tooltip may name the unmet civ or its
// cities; with it off the unmet civ must come back, which proves each check can actually fail.
import assert from "node:assert/strict";
import { createFakeDocument } from "./_dom-stub.mjs";

const { document } = createFakeDocument();
globalThis.document = document;
globalThis.window = { innerWidth: 1920, innerHeight: 1080, addEventListener: () => {} };
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.Locale = { compose: (k) => String(k).replace(/^LOC_/, "") };
globalThis.UI = { getIconURL: () => "blp:test" };
// No host ceiling by default: the local spoiler-guard setting alone decides the policy.
let hostCeiling = null;
globalThis.Configuration = { getGame: () => ({ getValue: () => hostCeiling, startSeed: "seed-spoiler" }) };
globalThis.Game = { turn: 3, getTurnDate: () => "3800 BCE" };
globalThis.GameContext = { localPlayerID: 0 };

const LOCAL = 0;
const MET = 1;
const UNMET = 2;
const NAMES = {
  [LOCAL]: { leader: "LocalLeader", civ: "LocalCiv", city: "LocalCity", color: "#a10000" },
  [MET]: { leader: "MetLeader", civ: "MetCiv", city: "MetCity", color: "#b20000" },
  [UNMET]: { leader: "UnmetLeader", civ: "UnmetCiv", city: "UnmetCity", color: "#c30000" }
};

function fakeCity(pid) {
  return {
    owner: pid,
    name: NAMES[pid].city,
    isTown: false,
    location: { x: pid, y: pid },
    id: { owner: pid, id: 1 },
    population: 12,
    urbanPopulation: 6,
    Religion: { majorityReligion: -1 },
    Yields: { getNetYield: () => 1 },
    Constructibles: { getNumWonders: () => 0, getIdsOfClass: () => [], getIds: () => [{ owner: pid, id: 7 }] }
  };
}

function fakePlayer(pid) {
  return {
    id: pid,
    isMajor: true,
    Religion: { getPantheons: () => ["BELIEF_" + pid] },
    Cities: { getCities: () => [fakeCity(pid)] },
    Diplomacy: { hasMet: (other) => other !== UNMET }
  };
}

const PLAYERS = [LOCAL, MET, UNMET].map(fakePlayer);
globalThis.Players = {
  getAlive: () => PLAYERS,
  getAliveIds: () => PLAYERS.map((p) => p.id),
  get: (id) => PLAYERS.find((p) => p.id === id) || null
};

// Each city holds one building on its own tile, so every civ has one quarter.
globalThis.Constructibles = {
  getByComponentID: (id) => ({ type: "BUILDING_" + id.owner, location: { x: id.owner, y: 9 } })
};

globalThis.GameInfo = {
  Beliefs: {
    lookup: (ref) => ({
      BeliefType: ref,
      BeliefClassType: "BELIEF_CLASS_PANTHEON",
      Name: "LOC_PANTHEON_OF_" + NAMES[Number(String(ref).slice(7))].civ,
      Description: "LOC_PANTHEON_DESC"
    })
  },
  Constructibles: { lookup: () => ({ ConstructibleClass: "BUILDING", Name: "LOC_BUILDING" }) },
  Religions: [],
  Civilizations: { lookup: () => ({ Name: "LOC_CIV" }) },
  Leaders: { lookup: () => ({ Name: "LOC_LEADER" }) },
  Types: { lookup: () => ({ Kind: "KIND_LEADER" }) },
  LandmarkReveals: []
};

function samplePlayer(pid, turn, met) {
  return {
    leaderName: NAMES[pid].leader,
    civName: NAMES[pid].civ,
    leaderTypeString: "LEADER_" + NAMES[pid].leader.toUpperCase(),
    primaryColor: NAMES[pid].color,
    met,
    wonderTypes: ["WONDER_" + pid],
    metrics: {
      score: 10 + pid, crisis_stage: turn, crisis_stage_max: 3, milpower: 100 - turn * pid,
      populationRaw: 30 - turn, crops: 10, production: 8, unitsLostCum: turn
    }
  };
}

function makeHistory() {
  const samples = [1, 2, 3].map((turn) => ({
    turn, chartTurn: turn, gameYear: 4100 - turn * 100 + " BCE", age: "AGE_ANTIQUITY",
    players: {
      [LOCAL]: samplePlayer(LOCAL, turn, true),
      [MET]: samplePlayer(MET, turn, true),
      [UNMET]: samplePlayer(UNMET, turn, false)
    }
  }));
  const roster = (pid) => ({ pid, civ: NAMES[pid].civ, leader: NAMES[pid].leader, color: "#884422", isCS: false });
  const war = (id, a, b) => ({
    warUniqueID: id, name: NAMES[a].civ + " vs " + NAMES[b].civ,
    startTurn: 1, startChartTurn: 1, endTurn: 3, endChartTurn: 3,
    startYear: "4000 BCE", endYear: "3800 BCE",
    sideACivs: [roster(a)], sideBCivs: [roster(b)],
    declaredBy: { civ: NAMES[a].civ, leader: NAMES[a].leader, isCS: false }
  });
  return {
    samples,
    ageBoundaries: [],
    // One war the player can see (local vs met), one between the met civ and the unmet civ.
    wars: [war(500, LOCAL, MET), war(501, MET, UNMET)]
  };
}

/** Every string a player could read off the tree: text, tooltips, titles. */
function allText(node, out = []) {
  if (!node) return out;
  if (node.textContent) out.push(String(node.textContent));
  if (node.title) out.push(String(node.title));
  if (node.attributes instanceof Map) for (const v of node.attributes.values()) out.push(String(v));
  for (const c of node.children || []) allText(c, out);
  return out.join("\n");
}

function freshHost() {
  const host = document.createElement("div");
  host._rect.width = 1300;
  host._rect.height = 900;
  return host;
}

const boards = await import("/demographics/ui/screen-demographics/charts/boards/chart-boards.js");
const { renderConstructiblesBoard } = await import(
  "/demographics/ui/screen-demographics/charts/boards/chart-settlement-boards.js"
);
const { renderQuartersBoard } = await import("/demographics/ui/screen-demographics/charts/boards/chart-quarters-board.js");
const { renderCrisisStages } = await import("/demographics/ui/screen-demographics/charts/crises/chart-crisis-stages.js");
const { renderConflictsTimeline, collectWarCivOptions } = await import(
  "/demographics/ui/screen-demographics/charts/conflicts/chart-conflicts-timeline.js"
);
const { renderConflictsGraphs } = await import(
  "/demographics/ui/screen-demographics/charts/conflicts/chart-conflicts-graphs.js"
);
const { DemographicsSettings } = await import("/demographics/ui/core/demographics-settings.js");

/** Surface name → a function returning the readable text it renders. */
const SURFACES = {
  pantheons: () => {
    const h = freshHost();
    boards.renderReligionPantheons(h, { history: makeHistory() });
    return allText(h);
  },
  wondersBoard: () => {
    const h = freshHost();
    boards.renderWondersBoard(h, { history: makeHistory() });
    return allText(h);
  },
  wonderRaces: () => {
    const h = freshHost();
    boards.renderWonderRaces(h, { history: makeHistory() });
    return allText(h);
  },
  mostUrbanized: () => {
    const h = freshHost();
    boards.renderSettlementsAtlas(h, {});
    return allText(h);
  },
  buildingsBoard: () => {
    const h = freshHost();
    renderConstructiblesBoard(h, { field: "population" });
    return allText(h);
  },
  quartersBoard: () => {
    const h = freshHost();
    renderQuartersBoard(h, {});
    return allText(h);
  },
  crisisStages: () => {
    const h = freshHost();
    renderCrisisStages(h, { history: makeHistory() });
    return allText(h);
  },
  warTimeline: () => {
    const h = freshHost();
    renderConflictsTimeline(h, { history: makeHistory(), width: 1200, height: 700, showCs: true });
    return allText(h);
  },
  warCivOptions: () => collectWarCivOptions(makeHistory()).map((o) => o.label).join("\n"),
  warGraphs: () => {
    const text = [];
    for (const id of [500, 501]) {
      const h = freshHost();
      renderConflictsGraphs(h, { history: makeHistory(), selectedWarId: id });
      text.push(allText(h));
    }
    return text.join("\n");
  }
};

// Names, the leader type (portraits are keyed by it) and the banner color (war-bar stripes use it).
const UNMET_MARKERS = [
  NAMES[UNMET].civ, NAMES[UNMET].leader, NAMES[UNMET].city,
  "LEADER_" + NAMES[UNMET].leader.toUpperCase(), NAMES[UNMET].color
];

function leaks(text) {
  return UNMET_MARKERS.filter((m) => text.includes(m));
}

// Guard ON (default): nothing may name the unmet civ.
DemographicsSettings.setSetting("hideUnmetStats", true);
const leaking = [];
for (const [name, render] of Object.entries(SURFACES)) {
  const found = leaks(render());
  if (found.length) leaking.push(name + " → " + found.join(", "));
}
assert.deepEqual(leaking, [], "spoiler guard ON, unmet civ shown on:\n  " + leaking.join("\n  "));

// The met civ's own war stays visible, and the timeline is not emptied by the gate.
assert.ok(SURFACES.warTimeline().includes(NAMES[MET].color), "the local player's war with a met civ stays on the timeline");
assert.ok(SURFACES.pantheons().includes(NAMES[MET].civ), "a met civ's pantheon is still listed");

// Guard OFF: every surface must show the unmet civ again (proves each check above can fail).
DemographicsSettings.setSetting("hideUnmetStats", false);
const hidden = [];
for (const [name, render] of Object.entries(SURFACES)) {
  if (!leaks(render()).length) hidden.push(name);
}
assert.deepEqual(hidden, [], "spoiler guard OFF, unmet civ still hidden on: " + hidden.join(", "));

DemographicsSettings.setSetting("hideUnmetStats", true);

// ── policyVisibleWars details ────────────────────────────────────────────────
const { policyVisibleWars } = await import("/demographics/ui/screen-demographics/charts/wars/chart-wars-merge.js");
const roster = (pid, isCS = false) => ({ pid, civ: NAMES[pid] ? NAMES[pid].civ : "CS", isCS });
const samples = makeHistory().samples;

// Local + unmet ally against the met civ: the war stays, the unmet ally and the stale name go.
const coalition = {
  warUniqueID: 900, name: "UnmetCiv's War", sideA: [LOCAL, UNMET], sideB: [MET], participants: [LOCAL, UNMET, MET],
  sideACivs: [roster(LOCAL), roster(UNMET)], sideBCivs: [roster(MET), roster(77, true)],
  declaredBy: { pid: UNMET, civ: NAMES[UNMET].civ }
};
const [kept] = policyVisibleWars([coalition], samples);
assert.deepEqual(kept.sideACivs.map((e) => e.pid), [LOCAL], "the unmet ally leaves the roster");
assert.deepEqual(kept.sideBCivs.map((e) => e.pid), [MET, 77], "city-state allies are not civs and stay");
assert.deepEqual(kept.participants, [LOCAL, MET], "the pid lists drop the hidden civ too");
assert.equal(kept.name, undefined, "a persisted name that may name the hidden civ is cleared");
assert.equal(kept.declaredBy, null, "a hidden declarer is cleared");
assert.equal(coalition.sideACivs.length, 2, "the persisted record is not mutated");

// A war with nothing hidden passes through as the same object.
const open = { warUniqueID: 901, sideACivs: [roster(LOCAL)], sideBCivs: [roster(MET)], name: "Open" };
assert.equal(policyVisibleWars([null, open], samples)[0], open, "untouched wars are returned as-is, nulls dropped");

// A city-state-only side does not count as losing its majors.
const csWar = { warUniqueID: 902, sideACivs: [roster(77, true)], sideBCivs: [roster(MET), roster(UNMET)] };
assert.equal(policyVisibleWars([csWar], samples).length, 1, "a city-state side without majors is not a lost side");

// Legacy scalar records: a hidden side drops the war.
assert.equal(policyVisibleWars([{ warUniqueID: 903, aPid: MET, bPid: UNMET }], samples).length, 0);

// Host ceiling own-civ-only: every other civ is hidden, so no war with an opponent survives,
// and the boards keep only the local civ.
hostCeiling = "own-civ-only";
assert.equal(policyVisibleWars([open], samples).length, 0, "own-civ-only hides the opponent");
const ownPantheons = SURFACES.pantheons();
assert.ok(ownPantheons.includes(NAMES[LOCAL].civ) && !ownPantheons.includes(NAMES[MET].civ),
  "own-civ-only keeps only the local civ's pantheon");
hostCeiling = null;

console.log("spoiler-guard-boards harness passed");
