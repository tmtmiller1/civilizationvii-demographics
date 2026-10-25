import assert from "node:assert/strict";

// The Hall of Fame keeps every finished game and the UNFINISHED_KEEP most recently played unfinished games;
// unfinished games under SHORT_GAME_TURNS turns are cleared once a newer game is recorded.

import {
  emptySlice,
  pruneUnfinished,
  UNFINISHED_KEEP,
  RECORD_VERSION
} from "/demographics/ui/history/store/history-archive.js";
import { SHORT_GAME_TURNS } from "/demographics/ui/history/model/history-hof.js";

assert.equal(UNFINISHED_KEEP, 20);
assert.equal(SHORT_GAME_TURNS, 20);

/** A record with just what the rule reads. */
function rec(id, { turns = 50, updated = 0, status = "in_progress", tags = [] } = {}) {
  return {
    v: RECORD_VERSION, id, leader: "LA", civs: [], ages: ["AGE_ANTIQUITY"], turns, updated,
    outcome: { status }, highlights: tags.map((n) => ({ n }))
  };
}

function sliceOf(records) {
  const slice = emptySlice();
  for (const r of records) slice.games[r.id] = r;
  return slice;
}

const ids = (slice) => Object.keys(slice.games).sort();

// Finished games stay; the newest game stays even when short; the other short ones go; 20 unfinished in all.
{
  const records = [];
  for (let i = 0; i < 3; i++) records.push(rec("won" + i, { turns: 300, updated: i, status: "victory" }));
  for (let i = 1; i <= 30; i++) records.push(rec("long" + i, { turns: 60, updated: 100 + i }));
  for (let i = 1; i <= 5; i++) records.push(rec("short" + i, { turns: 5, updated: 200 + i }));
  const slice = sliceOf(records);
  const cleared = pruneUnfinished(slice);
  const left = ids(slice);
  for (let i = 0; i < 3; i++) assert.ok(left.includes("won" + i), "finished games are kept");
  assert.ok(left.includes("short5"), "the game being played is kept, short or not");
  for (let i = 1; i <= 4; i++) assert.ok(!left.includes("short" + i), "older short games are cleared");
  const unfinished = left.filter((id) => !id.startsWith("won"));
  assert.equal(unfinished.length, 20, "20 unfinished games in all, the newest counted");
  for (let i = 12; i <= 30; i++) assert.ok(left.includes("long" + i), "the most recently played long games stay");
  for (let i = 1; i <= 11; i++) assert.ok(!left.includes("long" + i), "older long games are cleared");
  assert.equal(cleared.length, 15);
  assert.deepEqual(slice.hidden, {}, "cleared games aren't marked hidden, so their saves can bring them back");
}

// A game exactly at the line counts as long.
{
  const slice = sliceOf([
    rec("at", { turns: SHORT_GAME_TURNS, updated: 1 }),
    rec("under", { turns: SHORT_GAME_TURNS - 1, updated: 2 }),
    rec("now", { turns: 1, updated: 3 })
  ]);
  pruneUnfinished(slice);
  assert.deepEqual(ids(slice), ["at", "now"]);
}

// With a finished game newest, unfinished games are still capped at 20.
{
  const records = [rec("won", { turns: 200, updated: 999, status: "defeat" })];
  for (let i = 1; i <= 25; i++) records.push(rec("u" + i, { turns: 40, updated: i }));
  const slice = sliceOf(records);
  pruneUnfinished(slice);
  assert.equal(ids(slice).length, 21);
  assert.ok(!slice.games.u5 && slice.games.u6, "the five oldest unfinished games go");
}

// A record a later version wrote is never cleared; under the limit nothing changes.
{
  const newer = { v: RECORD_VERSION + 1, id: "future", updated: 0, outcome: { status: "in_progress" }, turns: 1 };
  const slice = sliceOf([rec("a", { updated: 1 }), rec("b", { turns: 3, updated: 2 })]);
  slice.games.future = newer;
  assert.deepEqual(pruneUnfinished(slice), []);
  assert.deepEqual(ids(slice), ["a", "b", "future"]);
}

// Names only a cleared game used go with it; shared names stay.
{
  const slice = sliceOf([
    rec("old", { turns: 4, updated: 1, tags: ["LOC_ONLY_OLD", "LOC_BOTH"] }),
    rec("now", { turns: 30, updated: 2, tags: ["LOC_BOTH"] })
  ]);
  slice.texts = { LOC_ONLY_OLD: "x", LOC_BOTH: "y" };
  pruneUnfinished(slice);
  assert.deepEqual(slice.texts, { LOC_BOTH: "y" });
}

// Through the store: the screen sees the rule on load, the next write stores it, and resuming a cleared game's
// save brings its entry back.
{
  const ROOT = "modSettings";
  const stored = emptySlice();
  for (let i = 1; i <= 30; i++) stored.games["g" + i] = rec("g" + i, { turns: 50, updated: i });
  for (let i = 1; i <= 10; i++) stored.games["t" + i] = rec("t" + i, { turns: 3, updated: 40 + i });
  let row = JSON.stringify({ "demographics-halloffame": stored, other: { keep: true } });
  globalThis.localStorage = {
    getItem: (k) => (k === ROOT ? row : null),
    setItem: (k, v) => { if (k === ROOT) row = v; },
    removeItem: () => {},
    get length() { return 1; },
    key: () => null
  };
  const store = await import("/demographics/ui/history/store/history-archive-store.js");
  store._resetForTests();
  const shown = store.allRecords().map((r) => r.id);
  assert.equal(shown.length, 20, "the screen shows 20 unfinished games on load");
  assert.ok(shown.includes("t10") && !shown.includes("t9"), "only the newest short game is shown");
  assert.equal(Object.keys(JSON.parse(row)["demographics-halloffame"].games).length, 40, "loading doesn't write");

  assert.ok(store.saveRecord(rec("fresh", { turns: 2, updated: 100 })));
  const after = JSON.parse(row);
  const keptIds = Object.keys(after["demographics-halloffame"].games);
  assert.equal(keptIds.length, 20, "the next write stores the rule");
  assert.ok(keptIds.includes("fresh") && !keptIds.includes("t10"), "a new game clears the short one before it");
  assert.deepEqual(after.other, { keep: true }, "other mods' settings are untouched");

  assert.ok(store.saveRecord(rec("g1", { turns: 51, updated: 200 })), "a cleared game's save is played again");
  assert.ok(Object.keys(JSON.parse(row)["demographics-halloffame"].games).includes("g1"), "and its entry is back");
  store._resetForTests();
  delete globalThis.localStorage;
}

console.log("hof-prune harness passed");
