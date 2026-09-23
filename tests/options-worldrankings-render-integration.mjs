// Covers: view-worldrankings-allcivs.js, worldrankings-allcivs-render.js, worldrankings-allcivs-table.js
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

// ── view-worldrankings ───────────────────────────────────────────────
const { render: renderRankings } = await import(
  "/demographics/ui/screen-demographics/views/worldrankings-allcivs/view-worldrankings-allcivs.js"
);

const { buildCivColumn, buildLabelColumn, buildGhostCivColumn, formatMetricValue, METRIC_ICONS } = await import(
  "/demographics/ui/screen-demographics/views/worldrankings-allcivs/worldrankings-allcivs-render.js"
);

// formatMetricValue — use a concrete metric id (score) that exists in METRICS
assert.ok(typeof formatMetricValue("score", 100) === "string");
assert.ok(typeof formatMetricValue("score", 0) === "string");
assert.ok(typeof METRIC_ICONS === "object");

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

// ── responsive layout gate: table vs matrix ──────────────────────────
// The worldRankingsAllCivsLayout setting pins the branch; "auto" measures the
// host's available rem-width (the stub returns _rect.width, and a 10rem probe
// returns 160, so availableRem === width/16).
function renderWith(width, layout) {
  const settings = makeSettings();
  if (layout) settings.setSetting("worldRankingsAllCivsLayout", layout);
  const host = document.createElement("div");
  host._rect.width = width; host._rect.height = 900;
  renderRankings(host, { history, settings, requestReload: () => {} });
  return host;
}

// Explicit override wins regardless of width.
assert.ok(
  renderWith(1200, "table").querySelector(".demographics-civtable"),
  "layout=table renders the sortable civs-as-rows table"
);
assert.ok(
  renderWith(1200, "matrix").querySelector(".demographics-worldrankings-allcivs-strip"),
  "layout=matrix renders the civs-as-columns matrix"
);
// Auto: wide host → table, narrow host → matrix (the 4K-safe fallback).
assert.ok(
  renderWith(1600, "auto").querySelector(".demographics-civtable"),
  "auto layout picks the table when there is width for readable metric columns"
);
assert.ok(
  renderWith(300, "auto").querySelector(".demographics-worldrankings-allcivs-strip"),
  "auto layout falls back to the matrix on a narrow host"
);
// A local-player row is highlighted in the table branch (pid 1 = localPlayerID).
const localRow = renderWith(1600, "table").querySelector(".is-local");
assert.ok(localRow, "the local player's row is highlighted in the table");

// ── throw boundary: a throwing sub-renderer leaves the render-failed notice ──
// `history.samples` throwing stands in for any renderer throw below `render`;
// the host is cleared first, so without the boundary the panel would be blank.
// The sort/toggle rerender closures all call `render`, so they share it.
const origError = console.error;
let logged = 0;
console.error = () => {
  logged++;
};
const throwingHistory = {
  get samples() {
    throw new Error("samples boom");
  }
};
const failHost = document.createElement("div");
failHost._rect.width = 1200; failHost._rect.height = 900;
assert.doesNotThrow(() =>
  renderRankings(failHost, { history: throwingHistory, settings: makeSettings(), requestReload: () => {} })
);
const failNote = failHost.querySelector(".demographics-empty");
assert.ok(failNote, "a throwing sub-renderer appends the render-failed notice");
assert.equal(failNote.textContent, "DEMOGRAPHICS_EMPTY_CHART_RENDER_FAILED");
assert.equal(failHost.children.length, 1, "nothing but the notice is left in the cleared host");
assert.equal(logged, 1, "the throw is logged once");

// The strip's hide/show-civ + reset re-renders bypass `render` (renderStrip owns
// them), so renderStrip has its own boundary: a profile that throws when read
// leaves the notice in the strip instead of an empty strip.
const { mountWorldRankingsAllCivsStrip } = await import(
  "/demographics/ui/screen-demographics/views/worldrankings-allcivs/worldrankings-allcivs-controller.js"
);
const { buildCivProfiles } = await import(
  "/demographics/ui/screen-demographics/views/worldrankings-allcivs/worldrankings-allcivs-profiles.js"
);
const badProfiles = buildCivProfiles(history);
Object.defineProperty(badProfiles, "2", {
  get() {
    throw new Error("profile boom");
  }
});
const strip = document.createElement("div");
let stripCtl = null;
assert.doesNotThrow(() => {
  stripCtl = mountWorldRankingsAllCivsStrip(
    strip, badProfiles, { localPid: "1", otherPids: ["2"] }, { settings: makeSettings() }, true
  );
});
assert.equal(strip.querySelector(".demographics-empty")?.textContent, "DEMOGRAPHICS_EMPTY_CHART_RENDER_FAILED");
assert.doesNotThrow(() => stripCtl.render(), "the strip re-render is guarded too");
assert.equal(strip.querySelectorAll(".demographics-empty").length, 1, "each re-render clears the prior notice");
assert.equal(logged, 3, "each strip throw is logged");
console.error = origError;

// ── Hiding one civ rebuilds ONLY that column ──────────────────────────────────
// Regression guard for the blinking portraits / metric icons: a hide/show toggle used to clear the
// whole strip, so every other civ's leader portrait and the label column's icons were destroyed
// and re-created (and flashed while their `blp:` backgrounds re-resolved).
const stripProfiles = {
  "1": { pid: "1", leaderName: "Me", civName: "Rome", leaderTypeString: "LEADER_ME", met: true, latest: { score: 10 } },
  "2": { pid: "2", leaderName: "B", civName: "Han", leaderTypeString: "LEADER_B", met: true, latest: { score: 8 } },
  "3": { pid: "3", leaderName: "C", civName: "Maya", leaderTypeString: "LEADER_C", met: true, latest: { score: 6 } },
  "4": { pid: "4", leaderName: "D", civName: "Egypt", leaderTypeString: "LEADER_D", met: true, latest: { score: 4 } }
};
const strip2 = document.createElement("div");
mountWorldRankingsAllCivsStrip(
  strip2, stripProfiles, { localPid: "1", otherPids: ["2", "3", "4"] }, { settings: makeSettings() }, true
);
const civCols = () => strip2.children.slice(2);
const labelColBefore = strip2.children[0];
const localColBefore = strip2.children[1];
const [col2, col3, col4] = civCols();
assert.equal(civCols().length, 3, "one column per non-local civ");
assert.equal(strip2.querySelector(".demographics-worldrankings-allcivs-reset-btn"), null, "nothing hidden yet");

// Hide the FIRST civ: its own column is replaced (full → ghost) and moves to the tail; the other
// two must be the same node objects, in the same order, and so must both sticky columns.
col2.querySelector(".demographics-worldrankings-allcivs-civ-header").dispatch("click");
assert.equal(strip2.children[0], labelColBefore, "the label column (metric icons) is never rebuilt");
assert.equal(strip2.children[1], localColBefore, "the local player's column is never rebuilt");
assert.deepEqual(civCols().slice(0, 2), [col3, col4], "the untouched civ columns keep their elements and order");
assert.notEqual(civCols()[2], col2, "the hidden civ's column is rebuilt as a ghost");
assert.equal(civCols().length, 3, "no column is lost or duplicated");
const resetBtn = strip2.querySelector(".demographics-worldrankings-allcivs-reset-btn");
assert.ok(resetBtn, "the label column gains a reset button in place");
assert.equal(
  strip2.querySelectorAll(".demographics-worldrankings-allcivs-reset-btn").length,
  1,
  "exactly one reset button (the sync replaces, never stacks)"
);

// Show it again via Reset: it returns to its sorted place, still without touching the others.
const ghost2 = civCols()[2];
resetBtn.dispatch("click");
assert.equal(strip2.children[0], labelColBefore, "reset does not rebuild the label column either");
assert.deepEqual(civCols().slice(1), [col3, col4], "the untouched columns survive the reset too");
assert.notEqual(civCols()[0], ghost2, "the restored civ's column is rebuilt as a full column");
assert.equal(civCols().length, 3, "no column is lost or duplicated");
assert.equal(strip2.querySelector(".demographics-worldrankings-allcivs-reset-btn"), null, "the button goes away");

delete globalThis.document;
delete globalThis.requestAnimationFrame;
delete globalThis.Locale;
delete globalThis.GameContext;
delete globalThis.Configuration;
delete globalThis.Audio;
delete globalThis.localStorage;
console.log("options-worldrankings-render-integration harness passed");
