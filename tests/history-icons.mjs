// Timeline icons: own icon first, else the kind's; engine lookups only for wonders and religions.
import assert from "node:assert/strict";
import { markIcon, engineIcon, KIND_ICONS, DISASTER_ICONS } from "/demographics/ui/history/core/history-icons.js";
import { disasterFamily } from "/demographics/ui/history/views/history-timeline-lanes.js";

assert.equal(markIcon({ k: "wonder", i: "blp:wondericon_colosseum" }), "blp:wondericon_colosseum");
assert.equal(markIcon({ k: "wonder" }), KIND_ICONS.wonder, "a wonder without its own icon falls back");
assert.equal(markIcon({ k: "nonsense" }), "");
for (const k of ["victory", "wonder", "triumph", "religion", "capture", "lost", "elim", "crisis"]) {
  assert.match(KIND_ICONS[k], /^blp:ntf_/, k + " uses a game icon");
}
for (const t of ["RANDOM_EVENT_VOLCANO", "RANDOM_EVENT_FLOOD", "RANDOM_EVENT_BLIZZARD", "RANDOM_EVENT_DROUGHT", "RANDOM_EVENT_X"]) {
  assert.ok(DISASTER_ICONS[disasterFamily(t)], "every disaster family has an icon: " + t);
}

// No icon table (the main menu, tests): nothing resolved.
assert.equal(engineIcon("WONDER_PYRAMIDS", "wonder"), "");
const calls = [];
globalThis.UI = { getIconURL: (type, ctx) => { calls.push([type, ctx]); return type === "BAD" ? "not-a-path" : "blp:" + type.toLowerCase(); } };
assert.equal(engineIcon("WONDER_PYRAMIDS", "wonder"), "blp:wonder_pyramids");
assert.equal(engineIcon("RELIGION_ISLAM", "religion"), "blp:religion_islam");
assert.deepEqual(calls.at(-1), ["RELIGION_ISLAM", "PLAYER"], "religions use the player icon");
assert.equal(engineIcon("LEGACY_X", "triumph"), "", "other kinds use their fixed icon");
assert.equal(engineIcon("", "wonder"), "");
assert.equal(engineIcon("BAD", "wonder"), "", "only texture paths are kept");
globalThis.UI = { getIconURL: () => { throw new Error("stale"); } };
assert.equal(engineIcon("WONDER_PYRAMIDS", "wonder"), "", "a failing lookup falls back");
delete globalThis.UI;

console.log("history-icons harness passed");
