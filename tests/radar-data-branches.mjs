// Covers: chart-triumphs-radar-data.js
// Pure data layer — no document/engine needed for exported utilities.
import assert from "node:assert/strict";

// GameContext stub for getLocalId inside palette helpers
globalThis.GameContext = { localPlayerID: 1 };

const {
  LEGACY_AXES, loadRadarCivs, radarScaleMax, radarTriumphTotal
} = await import(
  "/demographics/ui/screen-demographics/charts/triumphs/chart-triumphs-radar-data.js"
);

// LEGACY_AXES
assert.ok(Array.isArray(LEGACY_AXES));
assert.equal(LEGACY_AXES.length, 6);
assert.ok(LEGACY_AXES.every((a) => a.id && a.labelKey && typeof a.angle === "number"));

// loadRadarCivs — live path: no Players/Legacies, falls back to sample data
const history = {
  samples: [
    {
      turn: 1,
      players: {
        "1": {
          leaderTypeString: "LEADER_ME",
          primaryColor: "#224466",
          leaderName: "Me",
          civName: "Rome",
          met: true,
          metrics: {
            triumphs_militaristic: 2,
            triumphs_economic: 1,
            triumphs_diplomatic: 0,
            triumphs_cultural: 3,
            triumphs_scientific: 1,
            triumphs_expansionist: 0
          }
        },
        "2": {
          leaderTypeString: "LEADER_B",
          primaryColor: "#446688",
          leaderName: "B",
          civName: "Han",
          met: true,
          metrics: {
            triumphs_militaristic: 0,
            triumphs_economic: 2,
            triumphs_diplomatic: 1,
            triumphs_cultural: 0,
            triumphs_scientific: 2,
            triumphs_expansionist: 1
          }
        }
      }
    }
  ]
};

const civs = loadRadarCivs({ history, hiddenCivs: new Set(), ageSource: "current" }, history.samples);
assert.ok(civs instanceof Map);
assert.ok(civs.size >= 1);
const firstCiv = civs.values().next().value;
assert.ok(firstCiv.values);

const scaleMax = radarScaleMax(civs);
assert.ok(typeof scaleMax === "number" && scaleMax >= 1);

const total = radarTriumphTotal(firstCiv);
assert.ok(typeof total === "number" && total >= 0);

delete globalThis.GameContext;
console.log("radar-data-branches harness passed");
