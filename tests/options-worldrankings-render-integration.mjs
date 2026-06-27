// Covers: view-options.js, view-options-actions.js, view-options-storage-controls.js
// view-worldrankings-allcivs.js, worldrankings-allcivs-render.js, worldrankings-allcivs-table.js
import assert from "node:assert/strict";
import { createFakeDocument } from "./_dom-stub.mjs";

const { document } = createFakeDocument();
globalThis.document = document;
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.Locale = { compose: (k) => String(k).replace(/^LOC_/, "") };
globalThis.GameContext = { localPlayerID: 1 };
globalThis.Configuration = { getGame: () => ({ getValue: () => "full", startSeed: "seed1" }) };
globalThis.Audio = { playSound: () => {} };

const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k)
};

function makeSettings() {
  const data = {};
  return {
    getSetting: (k, d) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : d),
    setSetting: (k, v) => { data[k] = v; }
  };
}

// ── view-options ────────────────────────────────────────────────────
const { render: renderOptions } = await import(
  "/demographics/ui/screen-demographics/views/options/view-options.js"
);

const optHost = document.createElement("div");
optHost._rect.width = 1100; optHost._rect.height = 900;
renderOptions(optHost, {
  settings: makeSettings(),
  history: { samples: [] },
  requestReload: () => {},
  clearHistory: () => {},
  exportCsv: () => {}
});
assert.ok(optHost.children.length > 0);

// ── view-worldrankings ───────────────────────────────────────────────
const { render: renderRankings } = await import(
  "/demographics/ui/screen-demographics/views/worldrankings-allcivs/view-worldrankings-allcivs.js"
);

const { buildCivColumn, buildLabelColumn, buildGhostCivColumn, buildHint, formatMetricValue, METRIC_ICONS } = await import(
  "/demographics/ui/screen-demographics/views/worldrankings-allcivs/worldrankings-allcivs-render.js"
);

// formatMetricValue — use a concrete metric id (score) that exists in METRICS
assert.ok(typeof formatMetricValue("score", 100) === "string");
assert.ok(typeof formatMetricValue("score", 0) === "string");
assert.ok(typeof METRIC_ICONS === "object");

// buildHint
const hint = buildHint();
assert.ok(hint);

const history = {
  samples: [
    {
      turn: 1,
      players: {
        "1": { leaderType: "LEADER_ME", leaderName: "Me", civName: "Rome", leaderTypeString: "LEADER_ME",
               primaryColor: "#224466", secondaryColor: "#aabbcc", met: true,
               metrics: { score: 10, gdp: 20 } },
        "2": { leaderType: "LEADER_B", leaderName: "B", civName: "Han", leaderTypeString: "LEADER_B",
               primaryColor: "#446688", secondaryColor: "#ccbbaa", met: true,
               metrics: { score: 8, gdp: 15 } }
      }
    }
  ]
};
const rankCtx = {
  history,
  settings: makeSettings(),
  requestReload: () => {}
};
const rankHost = document.createElement("div");
rankHost._rect.width = 1200; rankHost._rect.height = 900;
renderRankings(rankHost, rankCtx);
assert.ok(rankHost.children.length > 0);

delete globalThis.document;
delete globalThis.requestAnimationFrame;
delete globalThis.Locale;
delete globalThis.GameContext;
delete globalThis.Configuration;
delete globalThis.Audio;
delete globalThis.localStorage;
console.log("options-worldrankings-render-integration harness passed");
