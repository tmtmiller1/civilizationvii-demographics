// Covers: worldrankings-allcivs-table.js (the sortable civs-as-rows "table" branch
// of the responsive All Civilizations screen) — civ-primary identity cell, value-
// descending sort with nulls last, per-metric rank cell, local-row highlight,
// unmet masking, the sort + Rank/Value interactions, and the invalid-sort-key clamp.
import assert from "node:assert/strict";
import { createFakeDocument } from "./_dom-stub.mjs";

const { document } = createFakeDocument();
globalThis.document = document;
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.Locale = { compose: (k) => String(k).replace(/^LOC_/, "") };
globalThis.GameContext = { localPlayerID: 1 };
globalThis.Audio = { playSound: () => {} };

const { renderCivTable } = await import(
  "/demographics/ui/screen-demographics/views/worldrankings-allcivs/worldrankings-allcivs-table.js"
);

/**
 * Minimal settings surface that records setSetting calls.
 * @param {Record<string, *>} [initial] Seed values.
 */
function makeSettings(initial = {}) {
  const data = { ...initial };
  const calls = [];
  return {
    getSetting: (k, d) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : d),
    setSetting: (k, v) => { data[k] = v; calls.push([k, v]); },
    _calls: calls
  };
}

/** Build a civ profile fixture. `score` null → no `score` metric (sorts last). */
function prof(pid, civName, leaderName, score, extra = {}) {
  return {
    pid: String(pid),
    met: true,
    civName,
    leaderName,
    leaderTypeString: "LEADER_" + pid,
    primaryColor: "#224466",
    secondaryColor: "#aabbcc",
    civNames: civName ? [civName] : [],
    latest: typeof score === "number" ? { score } : {},
    ...extra
  };
}

function qa(root, cls) {
  return Array.from(root.querySelectorAll("." + cls));
}

// ── Group 1: sort order, civ-primary identity, rank cell, local highlight ──────
const profiles = {
  "1": prof(1, "Rome", "Trajan", 50), // local player
  "2": prof(2, "Han", "Wu", 100), // highest score → first
  "3": prof(3, "", "Solo", null) // civ-less + no score → last, primary falls back to leader
};

const host = document.createElement("div");
host._rect.width = 1600; host._rect.height = 900;
const settings = makeSettings();
let renders = 0;
renderCivTable(host, profiles, { settings }, true, () => { renders++; });

assert.ok(host.querySelector(".demographics-civtable"), "renders the sortable table");
const rows = qa(host, "demographics-settle-datarow");
assert.equal(rows.length, 3, "one row per civ");

// Sorted by score descending: Han(100), Rome(50), Solo(null last).
assert.equal(
  rows[0].querySelector(".demographics-settle-owner-leader").textContent,
  "Han",
  "identity cell is civilization-primary"
);
assert.equal(
  rows[0].querySelector(".demographics-settle-owner-civ").textContent,
  "Wu",
  "leader is the secondary identity line"
);
assert.equal(
  rows[0].querySelector(".demographics-settle-col-rank").textContent,
  "1",
  "rank cell shows the metric rank"
);

// Nulls last: the civ with no score sorts to the bottom; civ-less → primary is the
// leader and there is no secondary line.
assert.equal(
  rows[2].querySelector(".demographics-settle-owner-leader").textContent,
  "Solo",
  "civ-less profile falls back to the leader as primary"
);
assert.equal(
  rows[2].querySelector(".demographics-settle-owner-civ"),
  null,
  "no secondary line when there is no distinct civ name"
);

// Local player's row (pid 1 = Rome, at index 1 after Han) is highlighted.
assert.ok(rows[1].classList.contains("is-local"), "local player's row is highlighted");

// ── Group 2: clicking a metric header sorts + persists ────────────────────────
const header = host.querySelector(".demographics-settle-header");
const metricHeaders = qa(header, "demographics-civtable-metric");
assert.ok(metricHeaders.length > 1, "multiple sortable metric columns");
const before = renders;
metricHeaders[metricHeaders.length - 1].dispatch("click"); // last column ≠ default "score"
assert.ok(renders > before, "sort click re-renders");
assert.ok(
  settings._calls.some(([k]) => k === "worldRankingsAllCivsSortKey"),
  "sort key is persisted"
);

// ── Group 3: Rank/Value toggle persists the view mode ─────────────────────────
const toggle = host.querySelector(".demographics-civtable-toggle");
const chips = qa(toggle, "demographics-chart-time-filter-pill");
assert.equal(chips.length, 2, "rank + value chips");
const before2 = renders;
chips[1].dispatch("click"); // "value"
assert.ok(renders > before2, "toggle re-renders");
assert.ok(
  settings._calls.some(([k, v]) => k === "worldRankingsAllCivsViewMode" && v === "value"),
  "view mode is persisted"
);

// ── Group 4: unmet civ identity is masked when names are hidden ───────────────
const maskedProfiles = {
  "1": prof(1, "Rome", "Trajan", 50),
  "9": { ...prof(9, "Maya", "Pacal", 70), met: false }
};
const mHost = document.createElement("div");
mHost._rect.width = 1600; mHost._rect.height = 900;
renderCivTable(mHost, maskedProfiles, { settings: makeSettings() }, false, () => {});
const masked = qa(mHost, "demographics-settle-datarow").some((r) => {
  const p = r.querySelector(".demographics-settle-owner-leader");
  return p && p.textContent === "DEMOGRAPHICS_UNMET_CIV";
});
assert.ok(masked, "an unmet civ's identity is masked to the generic placeholder");

// ── Group 5: an invalid persisted sort key clamps without throwing ────────────
const cHost = document.createElement("div");
cHost._rect.width = 1600; cHost._rect.height = 900;
renderCivTable(
  cHost,
  profiles,
  { settings: makeSettings({ worldRankingsAllCivsSortKey: "not_a_metric" }) },
  true,
  () => {}
);
assert.ok(
  cHost.querySelector(".demographics-civtable"),
  "an invalid sort key falls back to a valid metric without throwing"
);

delete globalThis.document;
delete globalThis.requestAnimationFrame;
delete globalThis.Locale;
delete globalThis.GameContext;
delete globalThis.Audio;
console.log("worldrankings-table-branches harness passed");
