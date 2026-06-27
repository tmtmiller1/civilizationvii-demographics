import assert from "node:assert/strict";

import { createFakeDocument } from "./_dom-stub.mjs";

const saved = {
  document: globalThis.document,
  window: globalThis.window,
  requestAnimationFrame: globalThis.requestAnimationFrame,
  setTimeout: globalThis.setTimeout,
  Locale: globalThis.Locale,
  Configuration: globalThis.Configuration,
  Game: globalThis.Game,
  GameContext: globalThis.GameContext,
  Players: globalThis.Players,
  UI: globalThis.UI,
  GameInfo: globalThis.GameInfo
};

const { document } = createFakeDocument();
globalThis.document = document;

globalThis.window = {
  innerWidth: 1920,
  innerHeight: 1080,
  addEventListener: () => {}
};
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.setTimeout = (fn) => {
  fn();
  return 0;
};

globalThis.Locale = {
  compose: (k) => String(k).replace(/^LOC_/, "")
};

globalThis.Configuration = {
  getGame: () => ({
    getValue: () => "full",
    startSeed: "seed-conflicts"
  })
};

globalThis.Game = {
  turn: 30,
  getTurnDate: () => "3000 BCE"
};

globalThis.GameContext = { localPlayerID: 1 };

globalThis.Players = {
  getAliveIds: () => [1, 2, 3],
  get: (id) => ({
    id,
    isMajor: id !== 3,
    isMinor: id === 3,
    Diplomacy: {
      hasMet: () => true
    }
  })
};

globalThis.UI = {
  getIconURL: () => "blp:test"
};

globalThis.GameInfo = {
  Civilizations: {
    lookup: () => ({ Name: "LOC_CIV" })
  },
  Leaders: {
    lookup: () => ({ Name: "LOC_LEADER" })
  },
  Types: {
    lookup: () => ({ Kind: "KIND_LEADER" })
  },
  LandmarkReveals: []
};

const { renderConflictsTimeline } = await import(
  "/demographics/ui/screen-demographics/charts/conflicts/chart-conflicts-timeline.js"
);
const { renderConflictsGraphs } = await import(
  "/demographics/ui/screen-demographics/charts/conflicts/chart-conflicts-graphs.js"
);

function buildHistory() {
  return {
    samples: [
      {
        turn: 1,
        chartTurn: 1,
        gameYear: "4000 BCE",
        age: "AGE_ANTIQUITY",
        players: {
          "1": { metrics: { milpower: 100, cityWarNetCum: 0, razedCum: 0, warLandCum: 0, populationRaw: 30, crops: 12, production: 10, warProdCum: 2, unitsLostCum: 0 } },
          "2": { metrics: { milpower: 95, cityWarNetCum: 0, razedCum: 0, warLandCum: 0, populationRaw: 28, crops: 11, production: 9, warProdCum: 1, unitsLostCum: 0 } }
        }
      },
      {
        turn: 2,
        chartTurn: 2,
        gameYear: "3900 BCE",
        age: "AGE_EXPLORATION",
        players: {
          "1": { metrics: { milpower: 90, milLostCum: 10, cityWarNetCum: 1, razedCum: 0, warLandCum: 2, populationRaw: 29, crops: 10, production: 8, warProdCum: 4, unitsLostCum: 1 } },
          "2": { metrics: { milpower: 80, milLostCum: 15, cityWarNetCum: -1, razedCum: 1, warLandCum: -2, populationRaw: 25, crops: 9, production: 7, warProdCum: 3, unitsLostCum: 2 } }
        }
      },
      {
        turn: 3,
        chartTurn: 3,
        gameYear: "3800 BCE",
        age: "AGE_EXPLORATION",
        players: {
          "1": { metrics: { milpower: 85, milLostCum: 18, cityWarNetCum: 1, razedCum: 1, warLandCum: 2, populationRaw: 28, crops: 9, production: 7, warProdCum: 6, unitsLostCum: 2 } },
          "2": { metrics: { milpower: 70, milLostCum: 28, cityWarNetCum: -1, razedCum: 2, warLandCum: -3, populationRaw: 22, crops: 8, production: 6, warProdCum: 4, unitsLostCum: 4 } }
        }
      }
    ],
    wars: [
      {
        warUniqueID: 500,
        name: "Great War",
        startTurn: 1,
        startChartTurn: 1,
        endTurn: 3,
        endChartTurn: 3,
        startYear: "4000 BCE",
        endYear: "3800 BCE",
        sideACivs: [
          { pid: 1, civ: "Rome", leader: "A", color: "#225588", isCS: false }
        ],
        sideBCivs: [
          { pid: 2, civ: "Han", leader: "B", color: "#884422", isCS: false }
        ]
      }
    ]
  };
}

function findByClass(root, cls) {
  const queue = [root];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (typeof cur.className === "string" && cur.className.split(/\s+/).includes(cls)) return cur;
    queue.push(...(cur.children || []));
  }
  return null;
}

function testConflictsRenderIntegration() {
  const history = buildHistory();

  const timelineHost = document.createElement("div");
  timelineHost._rect.width = 1300;
  timelineHost._rect.height = 800;
  const out = renderConflictsTimeline(timelineHost, {
    history,
    width: 1200,
    height: 700,
    turnRange: { min: 1, max: 3 },
    showCs: true,
    activeOnly: false,
    filterPid: null
  });
  assert.ok(out && out.svg, "timeline should return mounted svg handle");
  assert.ok(timelineHost.children.length > 0, "timeline host should receive chart markup");

  const graphsHost = document.createElement("div");
  graphsHost._rect.width = 1300;
  graphsHost._rect.height = 900;
  renderConflictsGraphs(graphsHost, { history, selectedWarId: 500 });
  assert.ok(findByClass(graphsHost, "demographics-war-graphs"), "war graphs panel should render");
  assert.ok(findByClass(graphsHost, "demographics-war-graphs-grid"), "war graphs grid should render");
}

try {
  testConflictsRenderIntegration();
  console.log("conflicts-render-integration harness passed");
} finally {
  globalThis.document = saved.document;
  globalThis.window = saved.window;
  globalThis.requestAnimationFrame = saved.requestAnimationFrame;
  globalThis.setTimeout = saved.setTimeout;
  globalThis.Locale = saved.Locale;
  globalThis.Configuration = saved.Configuration;
  globalThis.Game = saved.Game;
  globalThis.GameContext = saved.GameContext;
  globalThis.Players = saved.Players;
  globalThis.UI = saved.UI;
  globalThis.GameInfo = saved.GameInfo;
}
