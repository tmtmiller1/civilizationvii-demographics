// Covers: chart-resources.js, chart-triumphs-radar.js
// Uses DOM stub + fake Chart constructor.
import assert from "node:assert/strict";
import { createFakeDocument } from "./_dom-stub.mjs";

const { document } = createFakeDocument();
globalThis.document = document;
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.Locale = { compose: (k) => String(k).replace(/^LOC_/, "") };
globalThis.Configuration = { getGame: () => ({ getValue: () => "full", startSeed: "seed1" }) };
globalThis.GameContext = { localPlayerID: 1 };
globalThis.UI = { getIconURL: () => "blp:test" };

class FakeChart {
  static defaults = { font: { family: "BodyFont" } };
  constructor(_ctx, config) { this.config = config; this.chartArea = { left: 40, right: 760, top: 20, bottom: 380 }; this.width = 800; this.height = 400; this.scales = { x: { min: 1, max: 20, getPixelForValue: (v) => v * 20 }, y: { min: 0, max: 200, getPixelForValue: (v) => 380 - v } }; }
  update() {} destroy() {}
}
globalThis.Chart = FakeChart;

function makeHistory() {
  const players = {
    "1": {
      leaderName: "Me", civName: "Rome", leaderTypeString: "LEADER_ME",
      primaryColor: "#224466", met: true,
      metrics: {
        resources_total: 10, resources_bonus: 3, resources_empire: 2,
        resources_city: 2, resources_factory: 1, resources_treasure: 1, resources_stack: 8
      }
    },
    "2": {
      leaderName: "B", civName: "Han", leaderTypeString: "LEADER_B",
      primaryColor: "#446688", met: true,
      metrics: { resources_total: 8, resources_bonus: 2, resources_empire: 2,
                 resources_city: 2, resources_factory: 1, resources_treasure: 1 }
    }
  };
  return {
    samples: [
      { turn: 1, chartTurn: 1, gameYear: "4000 BCE", age: "AGE_ANTIQUITY", players },
      { turn: 2, chartTurn: 2, gameYear: "3900 BCE", age: "AGE_EXPLORATION", players }
    ],
    ageBoundaries: [{ age: "AGE_EXPLORATION" }]
  };
}

// ── chart-resources ──────────────────────────────────────────────────
const { collectResourceCivOptions, renderResourcesStack } = await import(
  "/demographics/ui/screen-demographics/charts/resources/chart-resources.js"
);

const opts = collectResourceCivOptions(makeHistory());
assert.ok(Array.isArray(opts));
assert.ok(opts.length >= 1);

const host1 = document.createElement("div");
host1._rect.width = 900; host1._rect.height = 500;
renderResourcesStack(host1, {
  history: makeHistory(),
  width: 860, height: 460,
  turnRange: { min: 1, max: 2 },
  viewerPid: 1
});
assert.ok(host1.children.length > 0);

// ── chart-triumphs-radar ─────────────────────────────────────────────
const { renderLegacyRadar } = await import(
  "/demographics/ui/screen-demographics/charts/triumphs/chart-triumphs-radar.js"
);

const host2 = document.createElement("div");
host2._rect.width = 900; host2._rect.height = 700;
const radarHistory = {
  samples: [
    {
      turn: 1, players: {
        "1": { leaderTypeString: "LEADER_ME", primaryColor: "#224466", leaderName: "Me", civName: "Rome", met: true,
               metrics: { triumphs_militaristic: 2, triumphs_economic: 1, triumphs_diplomatic: 0,
                          triumphs_cultural: 3, triumphs_scientific: 1, triumphs_expansionist: 0 } }
      }
    }
  ]
};
renderLegacyRadar(host2, {
  history: radarHistory,
  hiddenCivs: new Set(),
  width: 800, height: 600,
  ageSource: "current"
});
assert.ok(host2.children.length > 0);

delete globalThis.document;
delete globalThis.requestAnimationFrame;
delete globalThis.Locale;
delete globalThis.Configuration;
delete globalThis.GameContext;
delete globalThis.UI;
delete globalThis.Chart;
console.log("resources-radar-render-integration harness passed");
