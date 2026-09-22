// The archive store must never damage another mod's data, including under the Civilization VII
// 1.5.0 bug where localStorage.getItem returns the first key's value whatever key is asked for.
import assert from "node:assert/strict";
import { buggyStorage } from "./_history-fixtures.mjs";

const store = await import("/demographics/ui/history/store/history-archive-store.js");

/** A minimal valid record. */
const rec = (id, turns = 40) => ({
  v: 1, id, created: 1, updated: turns, local: 0, leader: "L", leaderName: "", color: "", civs: [],
  setup: {}, turns, ages: ["AGE_ANTIQUITY"], outcome: { status: "in_progress", victory: "", winner: -1, turn: 0 },
  stats: { triumphs: 0 }, rivals: [], highlights: [], spark: { tri: [], set: [] }
});

// 1. Empty store: a new modSettings root is created holding only our slice.
{
  store._resetForTests();
  globalThis.localStorage = buggyStorage();
  assert.ok(store.saveRecord(rec("a")));
  const root = JSON.parse(localStorage.dump().modSettings);
  assert.deepEqual(Object.keys(root), ["demographics-halloffame"]);
  assert.equal(store.archiveStatus(), "ok");
}

// 2. modSettings is the only key: other mods' slices are carried over untouched.
{
  store._resetForTests();
  const other = { demographics: { __schema: 1, activeView: "rankings" }, "bz-map-trix": { x: { y: 1 } } };
  globalThis.localStorage = buggyStorage({ modSettings: JSON.stringify(other) });
  assert.ok(store.saveRecord(rec("a")));
  const root = JSON.parse(localStorage.dump().modSettings);
  assert.deepEqual(root.demographics, other.demographics);
  assert.deepEqual(root["bz-map-trix"], other["bz-map-trix"]);
  assert.ok(root["demographics-halloffame"].games.a);
}

// 3. A foreign key sorts first (the aliasing bug): nothing is written anywhere.
{
  store._resetForTests();
  const chronicle = JSON.stringify({ v: 2, updated: 1784329667306, games: { x: {} } });
  const settings = JSON.stringify({ demographics: { a: 1 } });
  globalThis.localStorage = buggyStorage({ "!chronicle": chronicle, modSettings: settings });
  assert.equal(store.saveRecord(rec("a")), false);
  assert.equal(store.archiveStatus(), "foreign");
  assert.equal(localStorage.dump().modSettings, settings, "modSettings byte-identical");
  assert.equal(localStorage.dump()["!chronicle"], chronicle, "foreign key untouched");
  assert.ok(store.allRecords().some((r) => r.id === "a"), "the session still shows the game from memory");
}

// 4. A slice under our id that this mod did not write is never overwritten.
{
  store._resetForTests();
  const root = JSON.stringify({ "demographics-halloffame": { something: "else" } });
  globalThis.localStorage = buggyStorage({ modSettings: root });
  assert.equal(store.saveRecord(rec("a")), false);
  assert.equal(localStorage.dump().modSettings, root);
}

// 5. Unparseable value: refused.
{
  store._resetForTests();
  globalThis.localStorage = buggyStorage({ modSettings: "{not json" });
  assert.equal(store.saveRecord(rec("a")), false);
  assert.equal(localStorage.dump().modSettings, "{not json");
}

// 6. Records stored by an earlier session load back and merge with the progress rule.
{
  store._resetForTests();
  const slice = { __schema: 1, games: { a: rec("a", 90), b: rec("b") }, hidden: { z: 1 } };
  globalThis.localStorage = buggyStorage({ modSettings: JSON.stringify({ "demographics-halloffame": slice }) });
  assert.equal(store.allRecords().length, 2);
  store.saveRecord(rec("a", 50));
  assert.equal(store.allRecords().find((r) => r.id === "a").turns, 90, "stored progress kept");
  assert.ok(store.deleteRecord("b"));
  const back = JSON.parse(localStorage.dump().modSettings)["demographics-halloffame"];
  assert.equal(back.games.b, undefined);
  assert.ok(back.hidden.b && back.hidden.z);
}

// 7. No localStorage at all.
{
  store._resetForTests();
  delete globalThis.localStorage;
  assert.equal(store.saveRecord(rec("a")), false);
  assert.equal(store.archiveStatus(), "unavailable");
}

console.log("history-archive-store harness passed");
