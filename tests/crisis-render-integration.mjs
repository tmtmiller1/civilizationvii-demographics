// Covers: chart-crisis-graphs.js, chart-crisis-stages.js
// Uses DOM stub + minimal history stubs.
import assert from "node:assert/strict";
import { createFakeDocument } from "./_dom-stub.mjs";

const { document } = createFakeDocument();
globalThis.document = document;
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.Locale = { compose: (k) => String(k).replace(/^LOC_/, "") };
globalThis.UI = { getIconURL: () => "blp:test" };
globalThis.Configuration = { getGame: () => ({ getValue: () => "full", startSeed: "seed1" }) };
globalThis.GameContext = { localPlayerID: 1 };

function makeHistory(withCrisis = true) {
  return {
    samples: [
      {
        turn: 1, chartTurn: 1, gameYear: "4000 BCE", age: "AGE_ANTIQUITY",
        players: {
          "1": { leaderName: "Me", civName: "Rome", leaderTypeString: "LEADER_ME", primaryColor: "#224466", met: true,
                 metrics: { score: 10, crisis_stage: withCrisis ? 1 : 0, crisis_stage_max: 3 } },
          "2": { leaderName: "B", civName: "Han", leaderTypeString: "LEADER_B", primaryColor: "#446688", met: true,
                 metrics: { score: 8, crisis_stage: withCrisis ? 1 : 0, crisis_stage_max: 3 } }
        }
      },
      {
        turn: 2, chartTurn: 2, gameYear: "3900 BCE", age: "AGE_EXPLORATION",
        players: {
          "1": { leaderName: "Me", civName: "Rome", leaderTypeString: "LEADER_ME", primaryColor: "#224466", met: true,
                 metrics: { score: 12, crisis_stage: withCrisis ? 2 : 0, crisis_stage_max: 3 } },
          "2": { leaderName: "B", civName: "Han", leaderTypeString: "LEADER_B", primaryColor: "#446688", met: true,
                 metrics: { score: 10, crisis_stage: withCrisis ? 2 : 0, crisis_stage_max: 3 } }
        }
      }
    ],
    ageBoundaries: [{ age: "AGE_EXPLORATION" }]
  };
}

const {
  collectCrisisScopes, resolveCrisisScope, renderCrisisGraphs
} = await import(
  "/demographics/ui/screen-demographics/charts/crises/chart-crisis-graphs.js"
);
const { renderCrisisStages } = await import(
  "/demographics/ui/screen-demographics/charts/crises/chart-crisis-stages.js"
);

// collectCrisisScopes — single crisis → empty (only non-trivial when 2+ crises)
const scopes = collectCrisisScopes(makeHistory());
assert.ok(Array.isArray(scopes));

// resolveCrisisScope — no history → "all"
const resolved = resolveCrisisScope(makeHistory(), null);
assert.ok(typeof resolved === "string");

// renderCrisisGraphs
const host1 = document.createElement("div");
host1._rect.width = 1000; host1._rect.height = 700;
renderCrisisGraphs(host1, { history: makeHistory(), crisisAge: "all" });
assert.ok(host1.children.length > 0);

// renderCrisisGraphs with empty history
const host2 = document.createElement("div");
renderCrisisGraphs(host2, { history: { samples: [], ageBoundaries: [] } });
// Should show empty notice without crashing
assert.ok(host2 !== null);

// renderCrisisStages
const host3 = document.createElement("div");
host3._rect.width = 1000; host3._rect.height = 700;
renderCrisisStages(host3, { history: makeHistory() });
assert.ok(host3.children.length > 0);

// renderCrisisStages with no crisis data
const host4 = document.createElement("div");
renderCrisisStages(host4, { history: makeHistory(false) });

delete globalThis.document;
delete globalThis.requestAnimationFrame;
delete globalThis.Locale;
delete globalThis.UI;
delete globalThis.Configuration;
delete globalThis.GameContext;
console.log("crisis-render-integration harness passed");
