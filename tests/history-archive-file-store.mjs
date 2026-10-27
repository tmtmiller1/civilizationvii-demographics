// The Hall of Fame in a SQLite file of its own: migration out of modSettings, the fallback to
// modSettings whenever the file can't be used, and repair in both modes. Database.query runs on
// node:sqlite, so ATTACH, ON CONFLICT and PRAGMA database_list behave as real SQLite.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { archiveRecord, buggyStorage } from "./_history-fixtures.mjs";

const fileModule = await import("/demographics/ui/history/store/history-archive-file.js");
const store = await import("/demographics/ui/history/store/history-archive-store.js");
const settingsModule = await import("/demographics/ui/core/demographics-settings.js");
const DemographicsSettings = /** @type {any} */ (settingsModule.default || settingsModule.DemographicsSettings);

const { FILE_NAME, folderOfSave, findUserFolder } = fileModule;
const SLICE_ID = "demographics-halloffame";

// ---- engine stand-ins ----------------------------------------------------------------------

/** @type {DatabaseSync|null} */
let db = null;
/** @type {Map<string, Function[]>} */
const listeners = new Map();
/** @type {{fail?: RegExp, readBack?: string}} */
let faults = {};

/** A new page: its own config connection, as the main menu and a game each get. */
function newPage() {
  if (db) db.close();
  db = new DatabaseSync(":memory:");
  faults = {};
  globalThis.Database = {
    query(name, sql, ...args) {
      if (name !== "config") return undefined;
      if (faults.fail && faults.fail.test(sql)) throw new Error("injected: " + sql.slice(0, 40));
      if (faults.readBack && /^SELECT Payload FROM/.test(sql)) return [{ Payload: faults.readBack }];
      try {
        // The engine binds ?1, ?2, ... by position; node:sqlite only binds a bare ? that way.
        return /** @type {DatabaseSync} */ (db).prepare(sql.replace(/\?\d+/g, "?")).all(...args);
      } catch (_) {
        // The engine logs a failed ATTACH and returns []; other failures come back empty-handed.
        return /^ATTACH/.test(sql) ? [] : null;
      }
    }
  };
}

function installEngine() {
  listeners.clear();
  globalThis.engine = {
    on: (name, fn) => listeners.set(name, [...(listeners.get(name) || []), fn]),
    off: (name, fn) => listeners.set(name, (listeners.get(name) || []).filter((f) => f !== fn))
  };
  globalThis.SaveLocations = { LOCAL_STORAGE: 1 };
  globalThis.SaveTypes = { SINGLE_PLAYER: 0 };
  globalThis.SaveFileTypes = { GAME_STATE: 0 };
  globalThis.SaveLocationCategories = { NORMAL: 1, QUICKSAVE: 2, AUTOSAVE: 4 };
  globalThis.SaveLocationOptions = { MOST_RECENT_ONLY: 128 };
}

/**
 * The save list answers a moment later with one save under `folder`, or with no saves.
 * @param {string|null} folder
 * @param {{delayMs?: number}} [opts]
 */
function saveListAnswers(folder, { delayMs = 0 } = {}) {
  let next = 40;
  globalThis.GameStateStorage = {
    querySaveGameList: () => {
      const id = next++;
      const list = folder ? [{ path: path.join(folder, "Saves", "Single", "auto", "AutoSave_0001.Civ7Save") }] : [];
      setTimeout(() => {
        for (const fn of listeners.get("FileListQueryResults") || []) fn(id, list);
      }, delayMs);
      return id;
    },
    closeFileListQuery: () => {}
  };
}

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

function userFolder() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dg-hof-file-")) + path.sep;
}

/**
 * A page load with the file store: new connection, the save list answering with `folder`.
 * @param {string|null} folder
 * @param {{delayMs?: number}} [opts]
 */
async function loadPage(folder, opts) {
  newPage();
  installEngine();
  saveListAnswers(folder, opts);
  store._resetForTests();
  if (!opts || !opts.delayMs) await tick();
}

/** @param {string} file */
function fileRow(file) {
  const raw = new DatabaseSync(file);
  try {
    return raw.prepare("SELECT Schema, Payload, Backup FROM HallOfFame WHERE Id = 1").get();
  } finally {
    raw.close();
  }
}

/** @param {string} file @param {string} payload @param {string|null} [backup] */
function seedFile(file, payload, backup = null) {
  const raw = new DatabaseSync(file);
  raw.exec("CREATE TABLE IF NOT EXISTS HallOfFame (Id INTEGER PRIMARY KEY CHECK (Id = 1), Schema INTEGER NOT NULL, " +
    "Payload TEXT NOT NULL, Backup TEXT, Updated INTEGER NOT NULL)");
  raw.prepare("INSERT OR REPLACE INTO HallOfFame VALUES (1, 1, ?, ?, 1)").run(payload, backup);
  raw.close();
}

/** @param {...string} ids */
function slice(...ids) {
  return { __schema: 1, games: Object.fromEntries(ids.map((id) => [id, archiveRecord(id)])), hidden: {}, texts: {} };
}

// Other mods' sections and Tower Settings Keeper's own entries, which migration must carry as they are.
const OTHERS = {
  demographics: { __schema: 1, activeView: "rankings" },
  "another-mod": { x: { y: [1, 2.5, "z"] } },
  __ls: { "some-mod-key": { v: "stored" } },
  "__settings-keeper": { v: 1, root: "modSettings", since: 1784329667306 }
};

/** @param {*} root @returns {Record<string, string>} Each section as text, our slice left out. */
function sectionsWithoutSlice(root) {
  const out = {};
  for (const [k, v] of Object.entries(root)) if (k !== SLICE_ID) out[k] = JSON.stringify(v);
  return out;
}

const ids = () => store.allRecords().map((r) => r.id).sort();
/** @param {string} folder */
const fileGames = (folder) =>
  Object.keys(JSON.parse(/** @type {*} */ (fileRow(folder + FILE_NAME)).Payload).games).sort();
const root = () => JSON.parse(localStorage.dump().modSettings);

// ---- folderOfSave ---------------------------------------------------------------------------

assert.equal(
  folderOfSave("/Users/x/Library/Application Support/Civilization VII/Saves/Single/auto/AutoSave_00_0001.Civ7Save"),
  "/Users/x/Library/Application Support/Civilization VII/"
);
assert.equal(
  folderOfSave("C:\\Users\\x\\AppData\\Local\\Firaxis Games\\Sid Meier's Civilization VII\\Saves\\Single\\a.Civ7Save"),
  "C:\\Users\\x\\AppData\\Local\\Firaxis Games\\Sid Meier's Civilization VII\\"
);
assert.equal(folderOfSave("/home/Saves/x/Civ/Saves/Single/a.Civ7Save"), "/home/Saves/x/Civ/", "the last Saves folder");
assert.equal(folderOfSave("Saves/Single/a.Civ7Save"), null, "a relative path is never used");
assert.equal(folderOfSave("relative/Saves/Single/a.Civ7Save"), null);
assert.equal(folderOfSave("/no/saves/folder/a.Civ7Save"), null);
assert.equal(folderOfSave(undefined), null);

// ---- findUserFolder -------------------------------------------------------------------------

{
  delete globalThis.GameStateStorage;
  /** @type {*} */ let got = "unset";
  findUserFolder((f) => (got = f));
  assert.equal(got, null, "no save API: answers at once with no folder");

  installEngine();
  globalThis.GameStateStorage = { querySaveGameList: () => 1, closeFileListQuery: () => {} };
  got = "unset";
  findUserFolder((f) => (got = f), 10);
  await tick(30);
  assert.equal(got, null, "no answer in time: no folder");
  assert.equal((listeners.get("FileListQueryResults") || []).length, 0, "the listener is removed");

  saveListAnswers(null);
  got = "unset";
  findUserFolder((f) => (got = f));
  await tick();
  assert.equal(got, null, "no local save: no folder");
}

// ---- migration ------------------------------------------------------------------------------

// 1. The slice in modSettings only: it moves to the file, every other section stays as it was.
{
  const folder = userFolder();
  globalThis.localStorage = buggyStorage({ modSettings: JSON.stringify({ ...OTHERS, [SLICE_ID]: slice("a", "b") }) });
  const before = sectionsWithoutSlice(root());
  await loadPage(folder);
  assert.deepEqual(ids(), ["a", "b"]);
  assert.equal(store.archiveStatus(), "ok");
  const row = /** @type {*} */ (fileRow(folder + FILE_NAME));
  assert.deepEqual(Object.keys(JSON.parse(row.Payload).games).sort(), ["a", "b"]);
  assert.equal(row.Schema, 1);
  assert.ok(!(SLICE_ID in root()), "the slice left modSettings");
  assert.deepEqual(sectionsWithoutSlice(root()), before, "other mods and the keeper's entries byte for byte");
  assert.deepEqual(Object.keys(root()), Object.keys(OTHERS), "and in the same order");
}

// 2. The file only: read from it, modSettings untouched.
{
  const folder = userFolder();
  seedFile(folder + FILE_NAME, JSON.stringify(slice("f")));
  const settings = JSON.stringify(OTHERS);
  globalThis.localStorage = buggyStorage({ modSettings: settings });
  await loadPage(folder);
  assert.deepEqual(ids(), ["f"]);
  assert.equal(store.archiveStatus(), "ok");
  assert.equal(localStorage.dump().modSettings, settings, "modSettings byte-identical");
}

// 3. Both (a player who went back to 2.10.0 and returned): merged, and the slice leaves modSettings.
{
  const folder = userFolder();
  seedFile(folder + FILE_NAME, JSON.stringify(slice("f", "shared")));
  const both = { ...OTHERS, [SLICE_ID]: slice("m", "shared") };
  globalThis.localStorage = buggyStorage({ modSettings: JSON.stringify(both) });
  await loadPage(folder);
  assert.deepEqual(ids(), ["f", "m", "shared"]);
  const row = /** @type {*} */ (fileRow(folder + FILE_NAME));
  assert.deepEqual(Object.keys(JSON.parse(row.Payload).games).sort(), ["f", "m", "shared"]);
  assert.ok(JSON.parse(row.Backup).games.f, "the earlier payload is the backup");
  assert.ok(!(SLICE_ID in root()));
}

// 4. Neither: empty, nothing written anywhere.
{
  const folder = userFolder();
  const settings = JSON.stringify(OTHERS);
  globalThis.localStorage = buggyStorage({ modSettings: settings });
  await loadPage(folder);
  assert.deepEqual(ids(), []);
  assert.equal(store.archiveStatus(), "empty");
  assert.equal(localStorage.dump().modSettings, settings);
  assert.equal(fileRow(folder + FILE_NAME), undefined, "the file has its table and no row yet");
}

// 5. Stopped between the file write and the modSettings removal: the slice is in both, nothing is
// lost, and the next load finishes the move.
{
  const folder = userFolder();
  const storage = buggyStorage({ modSettings: JSON.stringify({ ...OTHERS, [SLICE_ID]: slice("a", "b") }) });
  const setItem = storage.setItem;
  storage.setItem = () => {
    throw new Error("the game closed");
  };
  globalThis.localStorage = storage;
  await loadPage(folder);
  assert.deepEqual(ids(), ["a", "b"]);
  assert.ok(root()[SLICE_ID].games.a, "still in modSettings");
  assert.ok(JSON.parse(/** @type {*} */ (fileRow(folder + FILE_NAME)).Payload).games.a, "and in the file");

  storage.setItem = setItem;
  await loadPage(folder);
  assert.deepEqual(ids(), ["a", "b"]);
  assert.ok(!(SLICE_ID in root()), "the next load moved it");
  assert.deepEqual(sectionsWithoutSlice(root()), sectionsWithoutSlice(OTHERS));
}

// 6. With the file in use, saves and deletes land in the file, modSettings isn't read or written,
// and a delete stays deleted after a reload.
{
  const folder = userFolder();
  const settings = JSON.stringify(OTHERS);
  globalThis.localStorage = buggyStorage({ modSettings: settings });
  await loadPage(folder);
  assert.ok(store.saveRecord(archiveRecord("new")));
  assert.ok(store.saveRecord(archiveRecord("gone")));
  assert.ok(store.deleteRecord("gone"));
  assert.equal(localStorage.dump().modSettings, settings, "modSettings byte-identical");
  await loadPage(folder);
  assert.deepEqual(ids(), ["new"]);
  const payload = JSON.parse(/** @type {*} */ (fileRow(folder + FILE_NAME)).Payload);
  assert.ok(payload.hidden.gone, "the delete is remembered");
}

// 7. A page reload on the same connection finds the file already attached and uses it.
{
  const folder = userFolder();
  globalThis.localStorage = buggyStorage({ modSettings: JSON.stringify(OTHERS) });
  await loadPage(folder);
  assert.ok(store.saveRecord(archiveRecord("a")));
  saveListAnswers(folder);
  store._resetForTests();
  await tick();
  assert.deepEqual(ids(), ["a"]);
  assert.ok(store.saveRecord(archiveRecord("b")));
  assert.deepEqual(fileGames(folder), ["a", "b"]);
}

// 8. The save list answers after the store loaded: it starts on modSettings, then moves everything
// it holds, including what this session saved meanwhile, to the file.
{
  const folder = userFolder();
  globalThis.localStorage = buggyStorage({ modSettings: JSON.stringify({ ...OTHERS, [SLICE_ID]: slice("a") }) });
  await loadPage(folder, { delayMs: 20 });
  assert.deepEqual(ids(), ["a"], "loaded from modSettings while waiting");
  assert.ok(store.saveRecord(archiveRecord("early")));
  assert.ok(root()[SLICE_ID].games.early, "saved to modSettings while waiting");
  await tick(40);
  assert.deepEqual(fileGames(folder), ["a", "early"]);
  assert.ok(!(SLICE_ID in root()));
  assert.deepEqual(ids(), ["a", "early"]);
}

// ---- fallback to modSettings ----------------------------------------------------------------

/**
 * With the file unusable, saving works exactly as in 2.10.0.
 * @param {string} label
 */
function assertWorksFromSettings(label) {
  assert.deepEqual(ids(), ["a"], label + ": games read from modSettings");
  assert.ok(store.saveRecord(archiveRecord("b")), label + ": a save lands");
  assert.deepEqual(Object.keys(root()[SLICE_ID].games).sort(), ["a", "b"], label + ": in modSettings");
  assert.equal(store.archiveStatus(), "ok", label);
}

// 9. ATTACH throws.
{
  const folder = userFolder();
  globalThis.localStorage = buggyStorage({ modSettings: JSON.stringify({ ...OTHERS, [SLICE_ID]: slice("a") }) });
  newPage();
  installEngine();
  saveListAnswers(folder);
  faults.fail = /^ATTACH/;
  store._resetForTests();
  await tick();
  assertWorksFromSettings("attach throws");
  assert.ok(!fs.existsSync(folder + FILE_NAME));
}

// 10. ATTACH fails quietly (an unwritable folder): the engine returns [] and logs.
{
  globalThis.localStorage = buggyStorage({ modSettings: JSON.stringify({ ...OTHERS, [SLICE_ID]: slice("a") }) });
  await loadPage("/no/such/dir/");
  assertWorksFromSettings("attach fails quietly");
}

// 11. The write throws: the slice stays in modSettings.
{
  const folder = userFolder();
  const before = JSON.stringify({ ...OTHERS, [SLICE_ID]: slice("a") });
  globalThis.localStorage = buggyStorage({ modSettings: before });
  newPage();
  installEngine();
  saveListAnswers(folder);
  faults.fail = /^INSERT INTO demographics_hof/;
  store._resetForTests();
  await tick();
  store.loadArchive();
  assert.equal(localStorage.dump().modSettings, before, "nothing removed before the file reads back");
  assertWorksFromSettings("write throws");
}

// 12. The read-back differs.
{
  const folder = userFolder();
  const before = JSON.stringify({ ...OTHERS, [SLICE_ID]: slice("a") });
  globalThis.localStorage = buggyStorage({ modSettings: before });
  newPage();
  installEngine();
  saveListAnswers(folder);
  store._resetForTests();
  faults.readBack = "something else";
  await tick();
  store.loadArchive();
  assert.equal(localStorage.dump().modSettings, before);
  assertWorksFromSettings("read-back differs");
}

// 13. A write that fails later in the session falls through to modSettings at once.
{
  const folder = userFolder();
  globalThis.localStorage = buggyStorage({ modSettings: JSON.stringify(OTHERS) });
  await loadPage(folder);
  assert.ok(store.saveRecord(archiveRecord("a")));
  faults.fail = /^INSERT INTO demographics_hof/;
  assert.ok(store.saveRecord(archiveRecord("b")));
  const games = Object.keys(root()[SLICE_ID].games).sort();
  assert.deepEqual(games, ["a", "b"], "the whole archive went to modSettings");
}

// 14. Bad JSON in the payload: the backup is used; with both bad, modSettings, and the file is left alone.
{
  const folder = userFolder();
  seedFile(folder + FILE_NAME, "{not json", JSON.stringify(slice("from-backup")));
  globalThis.localStorage = buggyStorage({ modSettings: JSON.stringify(OTHERS) });
  await loadPage(folder);
  assert.deepEqual(ids(), ["from-backup"]);

  const folder2 = userFolder();
  seedFile(folder2 + FILE_NAME, "{not json", JSON.stringify({ __schema: 2, games: {}, hidden: {} }));
  globalThis.localStorage = buggyStorage({ modSettings: JSON.stringify({ ...OTHERS, [SLICE_ID]: slice("a") }) });
  await loadPage(folder2);
  assertWorksFromSettings("payload and backup unreadable");
  assert.equal(/** @type {*} */ (fileRow(folder2 + FILE_NAME)).Payload, "{not json", "the file isn't overwritten");
}

// 15. No local save: modSettings, as 2.10.0.
{
  globalThis.localStorage = buggyStorage({ modSettings: JSON.stringify({ ...OTHERS, [SLICE_ID]: slice("a") }) });
  await loadPage(null);
  assertWorksFromSettings("no local save");
}

// ---- repairStorage --------------------------------------------------------------------------

{
  const savedSlice = DemographicsSettings.sliceForStore;
  DemographicsSettings.sliceForStore = () => ({ id: "demographics", slice: { __schema: 1, activeView: "rankings" } });

  // With the file in use: only the settings go back into the store, and the file is left alone.
  const folder = userFolder();
  globalThis.localStorage = buggyStorage({ "!foreign": "{}", modSettings: JSON.stringify(OTHERS) });
  await loadPage(folder);
  assert.ok(store.saveRecord(archiveRecord("a")));
  const fileBefore = /** @type {*} */ (fileRow(folder + FILE_NAME)).Payload;
  assert.ok(store.repairStorage().ok);
  assert.deepEqual(Object.keys(localStorage.dump()), ["modSettings"]);
  assert.deepEqual(Object.keys(root()), ["demographics"], "only the settings slice");
  assert.equal(/** @type {*} */ (fileRow(folder + FILE_NAME)).Payload, fileBefore);
  assert.equal(store.archiveStatus(), "ok");

  // With modSettings in use: the archive goes back in with the settings, as today.
  globalThis.localStorage = buggyStorage({ modSettings: JSON.stringify({ [SLICE_ID]: slice("a") }) });
  await loadPage(null);
  assert.ok(store.repairStorage().ok);
  assert.deepEqual(Object.keys(root()).sort(), ["demographics", SLICE_ID]);
  assert.ok(root()[SLICE_ID].games.a);

  DemographicsSettings.sliceForStore = savedSlice;
}

if (db) db.close();
