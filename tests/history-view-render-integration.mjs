import assert from "node:assert/strict";

import { createFakeDocument } from "./_dom-stub.mjs";

const saved = {
  document: globalThis.document,
  window: globalThis.window,
  requestAnimationFrame: globalThis.requestAnimationFrame,
  setTimeout: globalThis.setTimeout,
  Locale: globalThis.Locale,
  localStorage: globalThis.localStorage,
  Game: globalThis.Game,
  GameInfo: globalThis.GameInfo,
  UI: globalThis.UI,
  Audio: globalThis.Audio,
  Configuration: globalThis.Configuration,
  GameContext: globalThis.GameContext
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
  compose: (k, ...args) => {
    if (args.length === 0) return String(k).replace(/^LOC_/, "");
    return String(k).replace(/^LOC_/, "") + " " + args.join(" ");
  }
};

const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k)
};

globalThis.Game = {
  turn: 20,
  age: 1,
  getTurnDate: () => "1500 BCE"
};

globalThis.GameInfo = {
  Ages: {
    lookup: () => ({ AgeType: "AGE_EXPLORATION" })
  },
  LeaderTraits: [],
  Civilizations: {
    lookup: () => ({ Name: "LOC_CIV_NAME" })
  }
};

globalThis.UI = {
  getIconURL: () => "blp:test"
};

globalThis.Audio = {
  playSound: () => {}
};

globalThis.Configuration = {
  getGame: () => ({
    getValue: () => "full",
    startSeed: "seed-history"
  })
};

globalThis.GameContext = { localPlayerID: 1 };

const { render } = await import(
  "/demographics/ui/screen-demographics/views/history/view-history.js"
);

function findByClass(root, cls) {
  const queue = [root];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (typeof cur.className === "string" && cur.className.split(/\s+/).includes(cls)) return cur;
    queue.push(...(cur.children || []));
  }
  return null;
}

function makeCtx() {
  const state = {
    activePage: "economy",
    activeMetric: "gdp",
    activeTimeFilter: "all",
    activeRadarAge: "current",
    hiddenCivs: new Set(),
    focusedCivs: new Set(),
    warsFilterPid: null,
    warsActiveOnly: false,
    warGraphsWarId: null,
    crisisGraphsAge: "all",
    resourcesViewerPid: 1,
    xAxisMode: "both",
    showWonderMarkers: true,
    showWarMarkers: true,
    showDisasterMarkers: true,
    history: {
      samples: [
        {
          turn: 1,
          chartTurn: 1,
          gameYear: "4000 BCE",
          age: "AGE_ANTIQUITY",
          players: {
            "1": { leaderName: "Me", civName: "Rome", leaderTypeString: "LEADER_ME", primaryColor: "#224466", met: true, metrics: { gdp: 12, score: 10, emig_refugees: 1 } },
            "2": { leaderName: "Them", civName: "Han", leaderTypeString: "LEADER_THEM", primaryColor: "#446688", met: true, metrics: { gdp: 9, score: 8, emig_refugees: 0 } }
          }
        },
        {
          turn: 2,
          chartTurn: 2,
          gameYear: "3900 BCE",
          age: "AGE_EXPLORATION",
          players: {
            "1": { leaderName: "Me", civName: "Rome", leaderTypeString: "LEADER_ME", primaryColor: "#224466", met: true, metrics: { gdp: 14, score: 11, emig_refugees: 2, crisis_stage: 1 } },
            "2": { leaderName: "Them", civName: "Han", leaderTypeString: "LEADER_THEM", primaryColor: "#446688", met: true, metrics: { gdp: 10, score: 9, emig_refugees: 1, crisis_stage: 1 } }
          }
        },
        {
          turn: 3,
          chartTurn: 3,
          gameYear: "3800 BCE",
          age: "AGE_EXPLORATION",
          players: {
            "1": { leaderName: "Me", civName: "Rome", leaderTypeString: "LEADER_ME", primaryColor: "#224466", met: true, metrics: { gdp: 15, score: 12, emig_refugees: 3, crisis_stage: 2 } },
            "2": { leaderName: "Them", civName: "Han", leaderTypeString: "LEADER_THEM", primaryColor: "#446688", met: true, metrics: { gdp: 11, score: 10, emig_refugees: 2, crisis_stage: 2 } }
          }
        }
      ],
      wars: [
        {
          warUniqueID: 101,
          name: "War Alpha",
          startTurn: 1,
          endTurn: 3,
          startChartTurn: 1,
          endChartTurn: 3,
          sideACivs: [{ pid: 1, civ: "Rome", color: "#224466", isCS: false }],
          sideBCivs: [{ pid: 2, civ: "Han", color: "#446688", isCS: false }]
        }
      ],
      ageBoundaries: [{ age: "AGE_EXPLORATION" }],
      legacySnapshots: {
        AGE_ANTIQUITY: {},
        AGE_EXPLORATION: {}
      }
    },
    chartMod: {
      renderChart: (host) => {
        const marker = document.createElement("div");
        marker.className = "chart-marker-standard";
        host.appendChild(marker);
      },
      renderLegacyRadar: (host) => {
        const marker = document.createElement("div");
        marker.className = "chart-marker-radar";
        host.appendChild(marker);
      },
      renderConflictsTimeline: (host) => {
        const marker = document.createElement("div");
        marker.className = "chart-marker-wars";
        host.appendChild(marker);
      },
      renderConflictsGraphs: (host) => {
        const marker = document.createElement("div");
        marker.className = "chart-marker-wargraphs";
        host.appendChild(marker);
      },
      collectWarCivOptions: () => [
        { pid: 1, label: "Rome", isCS: false },
        { pid: 2, label: "Han", isCS: false }
      ],
      setXAxisMode: () => {}
    },
    settings: {
      getSetting: (k, d) => (Object.prototype.hasOwnProperty.call(state, k) ? state[k] : d),
      setSetting: (k, v) => {
        state[k] = v;
      }
    },
    setActiveMetric: (id) => {
      state.activeMetric = id;
    },
    setActivePage: (id) => {
      state.activePage = id;
    },
    setActiveTimeFilter: (id) => {
      state.activeTimeFilter = id;
    },
    setActiveRadarAge: (id) => {
      state.activeRadarAge = id;
    },
    setWarsFilterPid: (pid) => {
      state.warsFilterPid = pid;
    },
    setWarGraphsWarId: (id) => {
      state.warGraphsWarId = id;
    },
    setCrisisGraphsAge: (id) => {
      state.crisisGraphsAge = id;
    },
    setWarsActiveOnly: (v) => {
      state.warsActiveOnly = v;
    },
    setResourcesViewerPid: (pid) => {
      state.resourcesViewerPid = pid;
    },
    toggleCiv: () => {},
    setAllCivsHidden: () => {},
    toggleFocusCiv: () => {},
    clearFocus: () => {
      state.focusedCivs.clear();
    },
    requestReload: () => {}
  };

  return state;
}

function testHistoryRenderIntegration() {
  const host = document.createElement("div");
  host._rect.width = 1200;
  host._rect.height = 900;

  const ctx = makeCtx();

  render(host, ctx, { hub: "statistics" });
  assert.ok(findByClass(host, "demographics-chart-host"), "chart host should render for statistics");

  ctx.activePage = "wars";
  ctx.activeMetric = "wars_gantt";
  render(host, ctx, { hub: "geopolitics" });
  assert.ok(findByClass(host, "chart-marker-wars"), "wars synthetic renderer should run");

  ctx.activePage = "wars";
  ctx.activeMetric = "war_graphs";
  render(host, ctx, { hub: "geopolitics" });
  assert.ok(findByClass(host, "chart-marker-wargraphs"), "war graphs synthetic renderer should run");

  ctx.activePage = "age";
  ctx.activeMetric = "legacy_radar";
  render(host, ctx, { hub: "statistics" });
  assert.ok(findByClass(host, "chart-marker-radar"), "radar synthetic renderer should run");

  ctx.activePage = "economy";
  ctx.activeMetric = "emig_refugees";
  render(host, ctx, { hub: "statistics" });
  assert.ok(findByClass(host, "chart-marker-standard"), "standard line renderer should run");
}

try {
  testHistoryRenderIntegration();
  console.log("history-view-render-integration harness passed");
} finally {
  globalThis.document = saved.document;
  globalThis.window = saved.window;
  globalThis.requestAnimationFrame = saved.requestAnimationFrame;
  globalThis.setTimeout = saved.setTimeout;
  globalThis.Locale = saved.Locale;
  globalThis.localStorage = saved.localStorage;
  globalThis.Game = saved.Game;
  globalThis.GameInfo = saved.GameInfo;
  globalThis.UI = saved.UI;
  globalThis.Audio = saved.Audio;
  globalThis.Configuration = saved.Configuration;
  globalThis.GameContext = saved.GameContext;
}
