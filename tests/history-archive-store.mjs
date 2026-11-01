// The archive store must never damage another mod's data, including under the Civilization VII
// 1.5.0 bug where localStorage.getItem returns the first key's value whatever key is asked for.
import assert from "node:assert/strict";
import { archiveRecord, buggyStorage } from "./_history-fixtures.mjs";

const store = await import("/demographics/ui/history/store/history-archive-store.js");

// 1. Empty store: a new modSettings root is created holding only our slice.
{
  store._resetForTests();
  globalThis.localStorage = buggyStorage();
  assert.ok(store.saveRecord(archiveRecord("a")));
  const root = JSON.parse(localStorage.dump().modSettings);
  assert.deepEqual(Object.keys(root), ["demographics-halloffame"]);
  assert.equal(store.archiveStatus(), "ok");
}

// 2. modSettings is the only key: other mods' slices are carried over untouched.
{
  store._resetForTests();
  const other = { demographics: { __schema: 1, activeView: "rankings" }, "another-mod": { x: { y: 1 } } };
  globalThis.localStorage = buggyStorage({ modSettings: JSON.stringify(other) });
  assert.ok(store.saveRecord(archiveRecord("a")));
  const root = JSON.parse(localStorage.dump().modSettings);
  assert.deepEqual(root.demographics, other.demographics);
  assert.deepEqual(root["another-mod"], other["another-mod"]);
  assert.ok(root["demographics-halloffame"].games.a);
}

// 3. A foreign key sorts first (the aliasing bug): nothing is written anywhere.
{
  store._resetForTests();
  const foreignArchive = JSON.stringify({ v: 2, updated: 1784329667306, games: { x: {} } });
  const settings = JSON.stringify({ demographics: { a: 1 } });
  globalThis.localStorage = buggyStorage({ "!other-archive": foreignArchive, modSettings: settings });
  assert.equal(store.saveRecord(archiveRecord("a")), false);
  assert.equal(store.archiveStatus(), "foreign");
  assert.equal(localStorage.dump().modSettings, settings, "modSettings byte-identical");
  assert.equal(localStorage.dump()["!other-archive"], foreignArchive, "foreign key untouched");
  assert.ok(store.allRecords().some((r) => r.id === "a"), "the session still shows the game from memory");
}

// 4. A slice under our id that this mod did not write is never overwritten.
{
  store._resetForTests();
  const root = JSON.stringify({ "demographics-halloffame": { something: "else" } });
  globalThis.localStorage = buggyStorage({ modSettings: root });
  assert.equal(store.saveRecord(archiveRecord("a")), false);
  assert.equal(localStorage.dump().modSettings, root);
}

// 5. Unparseable value: refused.
{
  store._resetForTests();
  globalThis.localStorage = buggyStorage({ modSettings: "{not json" });
  assert.equal(store.saveRecord(archiveRecord("a")), false);
  assert.equal(localStorage.dump().modSettings, "{not json");
}

// 6. Records stored by an earlier session load back and merge with the progress rule.
{
  store._resetForTests();
  const slice = { __schema: 1, games: { a: archiveRecord("a", 90), b: archiveRecord("b") }, hidden: { z: 1 } };
  globalThis.localStorage = buggyStorage({ modSettings: JSON.stringify({ "demographics-halloffame": slice }) });
  assert.equal(store.allRecords().length, 2);
  store.saveRecord(archiveRecord("a", 50));
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
  assert.equal(store.saveRecord(archiveRecord("a")), false);
  assert.equal(store.archiveStatus(), "unavailable");
}

// 8. getItem throws while setItem works: that is not an empty store, so nothing is written.
{
  store._resetForTests();
  const base = buggyStorage({ modSettings: JSON.stringify({ "another-mod": { x: 1 } }) });
  globalThis.localStorage = Object.assign(Object.create(base), {
    getItem() {
      throw new Error("getItem unavailable");
    }
  });
  assert.equal(store.saveRecord(archiveRecord("a")), false);
  assert.equal(store.archiveStatus(), "unavailable");
  assert.equal(base.dump().modSettings, JSON.stringify({ "another-mod": { x: 1 } }), "siblings untouched");
}

// 9. Empty reads from a store that holds rows: refused rather than overwritten.
{
  store._resetForTests();
  const base = buggyStorage({ modSettings: JSON.stringify({ "another-mod": { x: 1 } }) });
  globalThis.localStorage = Object.assign(Object.create(base), { getItem: () => null });
  assert.equal(store.saveRecord(archiveRecord("a")), false);
  assert.equal(store.archiveStatus(), "unverified");
  assert.equal(base.dump().modSettings, JSON.stringify({ "another-mod": { x: 1 } }), "siblings untouched");
}

// 10. One transient empty read followed by a populated one: the populated read wins.
{
  store._resetForTests();
  const base = buggyStorage({ modSettings: JSON.stringify({ "another-mod": { x: 1 } }) });
  let calls = 0;
  globalThis.localStorage = Object.assign(Object.create(base), {
    getItem(k) {
      calls += 1;
      return calls === 1 ? null : base.getItem(k);
    }
  });
  assert.ok(store.saveRecord(archiveRecord("a")));
  const root = JSON.parse(base.dump().modSettings);
  assert.deepEqual(root["another-mod"], { x: 1 }, "sibling slice carried over after a flaky first read");
  assert.ok(root["demographics-halloffame"].games.a);
}

// 11. Another mod's key is the only row and key(i) enumerates: the shared key is genuinely absent,
//     so the archive creates it and leaves the other row alone.
{
  store._resetForTests();
  const data = new Map([["some-other-mod", JSON.stringify({ x: 1 })]]);
  globalThis.localStorage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    key: (i) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    }
  };
  assert.ok(store.saveRecord(archiveRecord("a")));
  assert.deepEqual(Object.keys(JSON.parse(data.get("modSettings"))), ["demographics-halloffame"]);
  assert.equal(data.get("some-other-mod"), JSON.stringify({ x: 1 }));
}

console.log("history-archive-store harness passed");

// 12. noteRecord only changes memory; flushArchive writes once and a second flush with nothing new
//     writes nothing; saveRecord still writes at once.
{
  store._resetForTests();
  const base = buggyStorage();
  let writes = 0;
  globalThis.localStorage = Object.assign(Object.create(base), {
    setItem(k, v) {
      writes += 1;
      return base.setItem(k, v);
    }
  });
  store.noteRecord(archiveRecord("a", 10));
  assert.equal(writes, 0, "noteRecord writes nothing");
  assert.equal(store.allRecords().find((r) => r.id === "a").turns, 10, "the view sees the record at once");
  assert.equal(store.flushArchive(), true);
  assert.equal(writes, 1, "flushArchive writes once");
  assert.equal(JSON.parse(base.dump().modSettings)["demographics-halloffame"].games.a.turns, 10);
  assert.equal(store.flushArchive(), true);
  assert.equal(writes, 1, "nothing new, nothing written");
  store.noteRecord(archiveRecord("a", 12));
  store.noteRecord(archiveRecord("b", 3));
  assert.equal(writes, 1, "two notes, still no write");
  assert.equal(store.flushArchive(), true);
  assert.equal(writes, 2, "one write carries both");
  assert.equal(store.saveRecord(archiveRecord("c")), true);
  assert.equal(writes, 3, "saveRecord writes at once");
  assert.equal(store.flushArchive(), true);
  assert.equal(writes, 3, "saveRecord left nothing pending");
}

// 13. A flush that fails keeps the record pending, so the next flush tries again.
{
  store._resetForTests();
  const foreign = JSON.stringify({ "!other": { a: 1 }, modSettings: "{}" });
  globalThis.localStorage = buggyStorage({ "!other-archive": foreign, modSettings: JSON.stringify({ x: { y: 1 } }) });
  store.noteRecord(archiveRecord("a"));
  assert.equal(store.flushArchive(), false, "a foreign store refuses the write");
  globalThis.localStorage = buggyStorage({ modSettings: JSON.stringify({ x: { y: 1 } }) });
  assert.equal(store.flushArchive(), true, "the pending record is written once the store reads fine");
  assert.ok(JSON.parse(localStorage.dump().modSettings)["demographics-halloffame"].games.a);
}

console.log("history-archive-store cadence cases passed");

// 14. writeFile with the slice already serialized writes the same row as writeFile without it, and
//     fitSliceText hands back the text of the slice as it stands after fitting.
{
  const fileModule = await import("/demographics/ui/history/store/history-archive-file.js");
  const { fitSliceText } = await import("/demographics/ui/history/store/history-archive.js");
  /** @type {any[][]} */
  const inserts = [];
  let payload = "";
  globalThis.Database = {
    query(_name, sql, ...args) {
      if (/^INSERT INTO/.test(sql)) {
        inserts.push(args);
        payload = args[1];
        return [];
      }
      if (/^SELECT Payload FROM/.test(sql)) return [{ Payload: payload }];
      return [];
    }
  };
  const slice = { __schema: 1, games: { a: archiveRecord("a") }, hidden: {}, texts: {} };
  assert.equal(fileModule.writeFile(slice), true);
  const { text, evicted } = fitSliceText(slice);
  assert.deepEqual(evicted, []);
  assert.equal(text, JSON.stringify(slice), "a slice within budget serializes once, unchanged");
  assert.equal(fileModule.writeFile(slice, text), true);
  assert.equal(inserts.length, 2);
  assert.equal(inserts[0][0], inserts[1][0], "same schema");
  assert.equal(inserts[0][1], inserts[1][1], "same payload with and without the text given");
  const games = Object.fromEntries([..."abcdefgh"].map((id) => [id, archiveRecord(id)]));
  const big = { __schema: 1, games, hidden: {}, texts: {} };
  const fitted = fitSliceText(big, 600);
  assert.ok(fitted.evicted.length > 0, "an over-budget slice loses games");
  assert.equal(fitted.text, JSON.stringify(big), "the text is the slice after fitting");
  delete globalThis.Database;
}

console.log("history-archive-store writeFile text case passed");
