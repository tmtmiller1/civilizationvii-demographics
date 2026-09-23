// The storage repair empties the shared localStorage store and writes this mod's slices back as the
// only row, so the shared settings key owns the one row the game can read. It destroys other keys'
// data, so every guard around it matters: it must refuse when there is nothing to write, report
// honestly when the engine refuses a step, and never claim success it did not verify by reading the
// store back. The engine behaviour modelled here (reads always return the first key by sort order,
// writes/removes/clear are correct) was watched in game on 2026-09-22.
import assert from "node:assert/strict";
import { buggyStorage } from "./_history-fixtures.mjs";

const repair = await import("/demographics/ui/core/demographics-storage-repair.js");
const store = await import("/demographics/ui/history/store/history-archive-store.js");

/** The contaminated store this machine actually has: a foreign archive sorts ahead of modSettings. */
const CHRONICLE = JSON.stringify({ v: 2, updated: 1784329667306, games: { x: { turns: 1 } } });
const contaminated = () =>
  buggyStorage({
    "!chronicle": CHRONICLE,
    "cd-probe-flips-v1": JSON.stringify({ v: 1, data: [] }),
    htlData: CHRONICLE,
    modSettings: JSON.stringify({ demographics: { __schema: 1, activeView: "rankings" } })
  });

/** A minimal valid archive record. */
const rec = (id, turns = 40) => ({
  v: 1, id, created: 1, updated: turns, local: 0, leader: "L", leaderName: "", color: "", civs: [],
  setup: {}, turns, ages: ["AGE_ANTIQUITY"], outcome: { status: "in_progress", victory: "", winner: -1, turn: 0 },
  stats: { triumphs: 0 }, rivals: [], highlights: [], spark: { tri: [], set: [] }
});

// ---------------------------------------------------------------- looksLikeSettingsRoot

// 1. Only an object whose every top-level value is an object can be the shared settings root.
{
  assert.equal(repair.looksLikeSettingsRoot({ a: {}, b: { c: 1 } }), true);
  assert.equal(repair.looksLikeSettingsRoot({ v: 2, games: {} }), false, "a number at the root is not a slice");
  assert.equal(repair.looksLikeSettingsRoot({}), false, "an empty object tells us nothing");
  assert.equal(repair.looksLikeSettingsRoot([{ a: 1 }]), false);
  assert.equal(repair.looksLikeSettingsRoot(null), false);
  assert.equal(repair.looksLikeSettingsRoot("{}"), false);
  assert.equal(repair.looksLikeSettingsRoot({ a: [] }), false, "an array is not a slice");
}

// ---------------------------------------------------------------- diagnose

// 2. No localStorage at all in this context.
{
  delete globalThis.localStorage;
  assert.deepEqual(repair.diagnose(), { state: "unavailable", rows: -1, bytes: 0 });
  assert.equal(repair.hasStore(), false);
  assert.equal(repair.storeRows(), -1);
}

// 3. Empty store, usable root, and the contaminated store the repair exists for.
{
  globalThis.localStorage = buggyStorage();
  assert.equal(repair.diagnose().state, "empty");

  const clean = JSON.stringify({ demographics: { a: 1 } });
  globalThis.localStorage = buggyStorage({ modSettings: clean });
  assert.deepEqual(repair.diagnose(), { state: "ok", rows: 1, bytes: clean.length });

  globalThis.localStorage = contaminated();
  const d = repair.diagnose();
  assert.equal(d.state, "foreign", "the first key's archive is not a settings root");
  assert.equal(d.rows, 4);
  assert.equal(d.bytes, CHRONICLE.length, "the read returned the first key, not modSettings");

  globalThis.localStorage = buggyStorage({ modSettings: "not json at all" });
  assert.equal(repair.diagnose().state, "foreign");
}

// ---------------------------------------------------------------- repairStore

// 4. Happy path: every other row goes, ours is the only one left, and it reads back.
{
  globalThis.localStorage = contaminated();
  const slices = { demographics: { __schema: 1 }, "demographics-halloffame": { __schema: 1, games: {}, hidden: {}, texts: {} } };
  const r = repair.repairStore(slices);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.error, "");
  assert.equal(r.rowsBefore, 4);
  assert.equal(r.rowsAfter, 1);
  assert.equal(r.removed, 3);
  const dump = localStorage.dump();
  assert.deepEqual(Object.keys(dump), ["modSettings"], "the shared key is the only row left");
  assert.deepEqual(JSON.parse(dump.modSettings), slices);
  assert.equal(repair.diagnose().state, "ok", "reads work once the shared key sorts first");
  assert.equal(r.bytes, dump.modSettings.length);
}

// 5. Refusals that must not touch the store.
{
  globalThis.localStorage = contaminated();
  const before = localStorage.dump();
  for (const bad of [undefined, null, {}, "x"]) {
    const r = repair.repairStore(/** @type {any} */ (bad));
    assert.equal(r.ok, false);
    assert.equal(r.error, "no-slices");
  }
  assert.deepEqual(localStorage.dump(), before, "a refused repair leaves every row alone");

  delete globalThis.localStorage;
  const r = repair.repairStore({ demographics: {} });
  assert.equal(r.ok, false);
  assert.equal(r.error, "no-store");
}

// 6. A value that cannot be stringified is caught before anything is deleted.
{
  globalThis.localStorage = contaminated();
  const circular = /** @type {any} */ ({ __schema: 1 });
  circular.self = circular;
  const r = repair.repairStore({ demographics: circular });
  assert.equal(r.ok, false);
  assert.ok(r.error.startsWith("stringify:"), r.error);
  assert.equal(localStorage.length, 4, "nothing was cleared");
}

// 7. The engine refuses to clear: report it, leave the store as it was.
{
  globalThis.localStorage = contaminated();
  localStorage.clear = () => { throw new Error("nope"); };
  const r = repair.repairStore({ demographics: { __schema: 1 } });
  assert.equal(r.ok, false);
  assert.ok(r.error.startsWith("clear:"), r.error);
  assert.equal(r.rowsBefore, 4);
  assert.equal(localStorage.length, 4);
}

// 8. The clear works but the write back does not: say so, and report the empty store.
{
  globalThis.localStorage = contaminated();
  localStorage.setItem = () => { throw new Error("quota"); };
  const r = repair.repairStore({ demographics: { __schema: 1 } });
  assert.equal(r.ok, false);
  assert.ok(r.error.startsWith("write:"), r.error);
  assert.equal(r.rowsAfter, 0);
  assert.equal(r.removed, -1, "removed is only counted when the repair got as far as writing");
}

// 9. A store that survives the clear (something re-seeds row 1): the readback catches it, no false
//    success. This is the shape of a mod writing its own first-sorting key again straight away.
{
  const stubborn = contaminated();
  const realClear = stubborn.clear;
  stubborn.clear = () => { realClear(); stubborn.setItem("!chronicle", CHRONICLE); };
  globalThis.localStorage = stubborn;
  const r = repair.repairStore({ demographics: { __schema: 1 } });
  assert.equal(r.ok, false);
  assert.equal(r.error, "readback-foreign");
}

// 10. The write lands but the readback has none of our slices: still not a success.
{
  const swapped = buggyStorage({ modSettings: JSON.stringify({ demographics: { a: 1 } }) });
  swapped.setItem = () => {};
  swapped.getItem = () => JSON.stringify({ "someone-else": { a: 1 } });
  globalThis.localStorage = swapped;
  const r = repair.repairStore({ "demographics-halloffame": { __schema: 1, games: {}, hidden: {}, texts: {} } });
  assert.equal(r.ok, false);
  assert.ok(r.error.startsWith("readback-missing:"), r.error);
}

// 11. Nothing at all comes back after the write.
{
  const mute = buggyStorage({ modSettings: "{}" });
  mute.setItem = () => {};
  mute.getItem = () => null;
  globalThis.localStorage = mute;
  const r = repair.repairStore({ demographics: { __schema: 1 } });
  assert.equal(r.ok, false);
  assert.equal(r.error, "readback-empty");
}

// 12. A readback that is not JSON.
{
  const junk = buggyStorage({ modSettings: "{}" });
  junk.setItem = () => {};
  junk.getItem = () => "<html>not json</html>";
  globalThis.localStorage = junk;
  const r = repair.repairStore({ demographics: { __schema: 1 } });
  assert.equal(r.ok, false);
  assert.equal(r.error, "readback-unparseable");
}

// ---------------------------------------------------------------- repairStorage (archive store)

// 13. The archive the session knows about survives the repair, and the settings slice goes with it.
{
  store._resetForTests();
  globalThis.localStorage = contaminated();
  assert.equal(store.saveRecord(rec("a")), false, "a contaminated store cannot be written");
  assert.equal(store.archiveStatus(), "foreign");

  const r = store.repairStorage();
  assert.equal(r.ok, true, r.error);
  assert.equal(store.archiveStatus(), "ok");
  const root = JSON.parse(localStorage.dump().modSettings);
  assert.ok(root["demographics-halloffame"].games.a, "the in-memory record was written back");
  assert.ok(root.demographics, "this session's settings were written back too");
  assert.deepEqual(Object.keys(localStorage.dump()), ["modSettings"]);
  assert.equal(store.allRecords().length, 1);

  // And the store works normally afterwards: a second record persists through the ordinary path.
  assert.equal(store.saveRecord(rec("b")), true);
  const after = JSON.parse(localStorage.dump().modSettings);
  assert.ok(after["demographics-halloffame"].games.b);
  assert.ok(after.demographics, "the ordinary write preserves the settings slice");
}

// 14. A repair that fails leaves the status honest rather than claiming the archive is stored.
{
  store._resetForTests();
  globalThis.localStorage = contaminated();
  store.saveRecord(rec("a"));
  localStorage.setItem = () => { throw new Error("quota"); };
  const r = store.repairStorage();
  assert.equal(r.ok, false);
  assert.equal(store.archiveStatus(), "unverified");
  assert.equal(store.allRecords().length, 1, "the session still knows its games");
}

// 15. No store at all: the repair says so and the status reflects it.
{
  store._resetForTests();
  delete globalThis.localStorage;
  const r = store.repairStorage();
  assert.equal(r.ok, false);
  assert.equal(r.error, "no-store");
  assert.equal(store.archiveStatus(), "unavailable");
}

console.log("storage-repair harness passed (15 cases)");
