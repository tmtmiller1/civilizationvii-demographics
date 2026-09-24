// Covers: view-settlements.js + view-settlements-civranking.js
//         view-settlements-showcase.js, view-settlements-table.js
import assert from "node:assert/strict";
import { createFakeDocument } from "./_dom-stub.mjs";

const { document } = createFakeDocument();
globalThis.document = document;
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.Locale = { compose: (k) => String(k).replace(/^LOC_/, "") };
globalThis.GameContext = { localPlayerID: 1 };
globalThis.Configuration = { getGame: () => ({ getValue: () => "full", startSeed: "seed1" }) };
globalThis.Audio = { playSound: () => {} };
globalThis.UI = { getIconURL: () => "blp:test" };
globalThis.Constructibles = { getAt: () => null };
globalThis.GameplayMap = { getPlotByIndex: () => null, getSize: () => ({ width: 60, height: 40 }) };

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

const { render: renderSettlements } = await import(
  "/demographics/ui/screen-demographics/views/settlements/view-settlements.js"
);

// Minimal ctx — settlementBoard will be empty (no engine Constructibles)
const ctx = {
  history: { samples: [] },
  settings: makeSettings(),
  requestReload: () => {}
};
const host = document.createElement("div");
host._rect.width = 1200; host._rect.height = 900;
renderSettlements(host, ctx);
assert.ok(host.children.length > 0);

// ── End-of-age archive: a record without outputs and a null entry render ──────
// The showcase output strip and leader icons dereference `outputs`; an archive
// record written by an older build (or trimmed by a repair) may carry none.
globalThis.Game = { age: "AGE_EXPLORATION", turn: 5 };
globalThis.GameInfo = { Ages: { lookup: (a) => ({ AgeType: a, Name: "LOC_" + a + "_NAME" }) } };
const archiveSettings = makeSettings();
archiveSettings.setSetting("settlementsSubTab", "showcase");
const archiveHost = document.createElement("div");
archiveHost._rect.width = 1200; archiveHost._rect.height = 900;
renderSettlements(archiveHost, {
  history: {
    samples: [],
    settleAges: {
      AGE_ANTIQUITY: {
        turn: 90,
        year: "400 CE",
        top: [null, { name: "Bare", composite: 42, populationEstimate: 12000, owner: { pid: 2, leaderName: "L2" } }]
      }
    }
  },
  settings: archiveSettings,
  requestReload: () => {}
});
const agePills = archiveHost.querySelectorAll(".demographics-chart-time-filter-pill");
assert.equal(agePills.length, 2, "Now + one archived age pill");
assert.doesNotThrow(() => agePills[1].dispatch("click"), "picking the archived age re-renders without a throw");
const archiveRows = archiveHost.querySelectorAll(".demographics-settle-list-row");
assert.equal(archiveRows.length, 1, "the null entry is dropped; the bare record renders");
assert.match(archiveRows[0].querySelector(".demographics-settle-list-name").textContent, /Bare/);
const outputVals = archiveRows[0].querySelectorAll(".demographics-settle-output-val");
assert.ok(outputVals.length > 0, "the output strip renders for a record without outputs");
assert.ok(outputVals.every((v) => v.textContent === "—"), "missing outputs read as dashes");
assert.equal(archiveHost.querySelector(".demographics-settle-empty"), null, "no fallback/empty state");
delete globalThis.Game;
delete globalThis.GameInfo;

// ── Throw boundary: a throwing sub-view leaves the render-failed notice ───────
// rerenderContent clears the content host before rendering, so a sub-view throw
// (here: readAgeArchive reading a history whose `settleAges` getter throws) used
// to leave an empty panel. Every handler (tab bar, pills, chips, sort headers)
// re-renders through rerenderContent, so one boundary covers them.
const origError = console.error;
let logged = 0;
console.error = () => {
  logged++;
};
globalThis.Game = { age: "AGE_EXPLORATION", turn: 5 };
globalThis.GameInfo = { Ages: { lookup: (a) => ({ AgeType: a }) } };
let samplesThrow = false;
const throwingHistory = {
  get samples() {
    if (samplesThrow) throw new Error("samples boom");
    return [];
  },
  get settleAges() {
    throw new Error("settleAges boom");
  }
};
const failSettings = makeSettings();
failSettings.setSetting("settlementsSubTab", "showcase");
const failHost = document.createElement("div");
failHost._rect.width = 1200; failHost._rect.height = 900;
assert.doesNotThrow(() => renderSettlements(failHost, { history: throwingHistory, settings: failSettings }));
const failContent = failHost.querySelector(".demographics-settle-content");
assert.equal(failContent.children.length, 1, "only the notice is left in the cleared content host");
assert.equal(failContent.children[0].textContent, "DEMOGRAPHICS_EMPTY_CHART_RENDER_FAILED");
assert.equal(logged, 1, "the throw is logged");
// The tab-bar handler path: switch to the All-Civ sub-view (its own render
// boundary catches the samples throw), then back to the showcase (settlements
// boundary again). Neither handler throws; both leave the notice.
samplesThrow = true;
const tabBar = failHost.querySelector("fxs-tab-bar");
assert.ok(tabBar, "the sub-tab bar is mounted");
assert.doesNotThrow(() => tabBar.dispatch("tab-selected", { detail: { selectedItem: { id: "civilizations" } } }));
assert.equal(failContent.querySelector(".demographics-empty")?.textContent, "DEMOGRAPHICS_EMPTY_CHART_RENDER_FAILED");
assert.doesNotThrow(() => tabBar.dispatch("tab-selected", { detail: { selectedItem: { id: "showcase" } } }));
assert.equal(failContent.children.length, 1);
assert.equal(failContent.children[0].textContent, "DEMOGRAPHICS_EMPTY_CHART_RENDER_FAILED");
assert.equal(logged, 3, "each sub-view throw is logged");
console.error = origError;
delete globalThis.Game;
delete globalThis.GameInfo;

delete globalThis.document;
delete globalThis.requestAnimationFrame;
delete globalThis.Locale;
delete globalThis.GameContext;
delete globalThis.Configuration;
delete globalThis.Audio;
delete globalThis.UI;
delete globalThis.Constructibles;
delete globalThis.GameplayMap;
delete globalThis.localStorage;
console.log("settlements-render-integration harness passed");
