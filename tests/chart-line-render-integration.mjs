import assert from "node:assert/strict";

import { createFakeDocument } from "./_dom-stub.mjs";

const saved = {
  document: globalThis.document,
  window: globalThis.window,
  requestAnimationFrame: globalThis.requestAnimationFrame,
  Chart: globalThis.Chart,
  Configuration: globalThis.Configuration,
  GameContext: globalThis.GameContext,
  Game: globalThis.Game,
  UI: globalThis.UI,
  Locale: globalThis.Locale,
  GameInfo: globalThis.GameInfo,
  EmigrationData: globalThis.EmigrationData
};

const { document } = createFakeDocument();
globalThis.document = document;

globalThis.window = {
  innerWidth: 1920,
  innerHeight: 1080,
  addEventListener: () => {}
};
globalThis.requestAnimationFrame = (fn) => fn();

class FakeChart {
  static defaults = { font: { family: "BodyFont" } };
  constructor(ctx, config) {
    this.ctx = ctx;
    this.config = config;
    this.options = config.options || { scales: { x: {}, y: {} } };
    this.data = config.data || { datasets: [] };
    this.chartArea = { left: 40, right: 760, top: 20, bottom: 380 };
    this.width = 800;
    this.height = 400;
    this.scales = {
      x: { min: 1, max: 20, getPixelForValue: (v) => v * 20 },
      y: { min: 0, max: 200, getPixelForValue: (v) => 380 - v }
    };
    this.tooltip = { opacity: 0, dataPoints: [] };
  }
  update() {}
  destroy() {}
}
globalThis.Chart = FakeChart;

globalThis.Configuration = {
  getGame: () => ({ getValue: () => "full" })
};
globalThis.GameContext = { localPlayerID: 1 };
globalThis.Game = { turn: 2, getTurnDate: () => "3900 BCE" };

globalThis.UI = {
  getIconURL: (type) => "blp:" + type
};
globalThis.Locale = {
  compose: (s) => String(s).replace(/^LOC_/, "")
};
globalThis.GameInfo = {
  Constructibles: {
    lookup: (type) => ({ Name: "LOC_" + type + "_NAME", Description: "LOC_" + type + "_DESC" })
  }
};
globalThis.EmigrationData = {
  disasterEvents: () => [{ name: "Flood", year: "3900 BCE", turn: 2 }]
};

const { renderChart } = await import(
  "/demographics/ui/screen-demographics/charts/line/chart-line.js"
);

function buildHost() {
  const host = document.createElement("div");
  host._rect.width = 900;
  host._rect.height = 500;
  return host;
}

function testRenderChartIntegration() {
  const host = buildHost();
  const history = {
    ageBoundaries: [{ age: "AGE_EXPLORATION" }],
    samples: [
      {
        age: "AGE_ANTIQUITY",
        localTurn: 1,
        turn: 1,
        gameYear: "4000 BCE",
        players: {
          "1": { leaderName: "Me", civName: "Rome", leaderType: "LEADER_ME", leaderTypeString: "LEADER_ME", primaryColor: "#224466", met: true, metrics: { score: 10, emig_refugees: 2, settlement_cap_pct: 90 }, wonderTypes: ["BUILDING_PYRAMIDS"] },
          "2": { leaderName: "Them", civName: "Han", leaderType: "LEADER_THEM", leaderTypeString: "LEADER_THEM", primaryColor: "#446688", met: true, metrics: { score: 8, emig_refugees: 1, settlement_cap_pct: 100 }, wonderTypes: [] }
        }
      },
      {
        age: "AGE_EXPLORATION",
        localTurn: 1,
        turn: 2,
        gameYear: "3900 BCE",
        players: {
          "1": { leaderName: "Me", civName: "Rome", leaderType: "LEADER_ME", leaderTypeString: "LEADER_ME", primaryColor: "#224466", met: true, metrics: { score: 12, emig_refugees: 4, settlement_cap_pct: 110 }, wonderTypes: ["BUILDING_PYRAMIDS", "BUILDING_GARDENS"] },
          "2": { leaderName: "Them", civName: "Han", leaderType: "LEADER_THEM", leaderTypeString: "LEADER_THEM", primaryColor: "#446688", met: true, metrics: { score: 9, emig_refugees: 3, settlement_cap_pct: 95 }, wonderTypes: [] }
        }
      },
      {
        age: "AGE_EXPLORATION",
        localTurn: 2,
        turn: 3,
        gameYear: "3800 BCE",
        players: {
          "1": { leaderName: "Me", civName: "Rome", leaderType: "LEADER_ME", leaderTypeString: "LEADER_ME", primaryColor: "#224466", met: true, metrics: { score: 13, emig_refugees: 6, settlement_cap_pct: 120, crisis_stage: 2 }, wonderTypes: ["BUILDING_GARDENS"] },
          "2": { leaderName: "Them", civName: "Han", leaderType: "LEADER_THEM", leaderTypeString: "LEADER_THEM", primaryColor: "#446688", met: true, metrics: { score: 10, emig_refugees: 5, settlement_cap_pct: 97, crisis_stage: 2 }, wonderTypes: [] }
        },
        wars: []
      }
    ],
    wars: [{ name: "War One", startChartTurn: 2, startYear: "3900 BCE", startTurn: 2 }]
  };

  const out = renderChart(host, {
    history,
    metric: "emig_refugees",
    width: 860,
    height: 420,
    hiddenCivs: new Set(["LEADER_THEM"]),
    focusedCivs: new Set(["LEADER_ME"]),
    turnRange: { min: 1, max: 3 },
    onToggleCiv: () => {},
    onToggleVisibility: () => {},
    onSetAllHidden: () => {}
  });

  assert.ok(out && out.chart, "renderChart should mount a chart");
  assert.ok(host._demographicsChart, "host should retain chart handle");
  assert.ok(host.children.length > 0, "render should mount wrap/canvas/legend");

  // Re-render path should teardown prior chart and still succeed.
  const out2 = renderChart(host, { history, metric: "settlement_cap_pct", width: 860, height: 420 });
  assert.ok(out2 && out2.chart);
}

try {
  testRenderChartIntegration();
  console.log("chart-line-render-integration harness passed");
} finally {
  globalThis.document = saved.document;
  globalThis.window = saved.window;
  globalThis.requestAnimationFrame = saved.requestAnimationFrame;
  globalThis.Chart = saved.Chart;
  globalThis.Configuration = saved.Configuration;
  globalThis.GameContext = saved.GameContext;
  globalThis.Game = saved.Game;
  globalThis.UI = saved.UI;
  globalThis.Locale = saved.Locale;
  globalThis.GameInfo = saved.GameInfo;
  globalThis.EmigrationData = saved.EmigrationData;
}
