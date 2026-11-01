// history-archive-file.js
//
// The Hall of Fame's own SQLite file, attached to the config database. Keeping it out of the shared
// modSettings entry means other mods' settings reads no longer parse it, and mods that clear
// localStorage can't wipe it. See docs/archive-file-store.md.
//
// No engine call names the game's user folder, but the save list does: the newest local save's
// path is absolute and sits under it. A relative file name would land in the working folder,
// which on the Mac is inside the app bundle, where a Steam update can remove it.
//
// A failed ATTACH doesn't throw: Database.query returns [] and the error only reaches
// Database.log. So each step is confirmed through PRAGMA database_list or a read-back.

import { log, safe } from "/demographics/ui/history/core/history-log.js";
import { ARCHIVE_SCHEMA, isSlice } from "/demographics/ui/history/store/history-archive.js";

export const FILE_NAME = "demographics-halloffame.sqlite";
export const ALIAS = "demographics_hof";
export const QUERY_TIMEOUT_MS = 5000;
/** The game's own localStorage file, in the same user folder; read only, by key. */
export const SETTINGS_FILE_NAME = "LocalStorage.sqlite";
export const SETTINGS_ALIAS = "demographics_ls";

const DB = "config";
const RESULTS_EVENT = "FileListQueryResults";
const TABLE = ALIAS + ".HallOfFame";

const CREATE_SQL =
  `CREATE TABLE IF NOT EXISTS ${TABLE} (Id INTEGER PRIMARY KEY CHECK (Id = 1), Schema INTEGER NOT NULL, ` +
  "Payload TEXT NOT NULL, Backup TEXT, Updated INTEGER NOT NULL)";
// The previous payload moves to Backup only when the payload changes, so writing the same archive
// twice doesn't overwrite the backup with a copy of itself.
const WRITE_SQL =
  `INSERT INTO ${TABLE} (Id, Schema, Payload, Backup, Updated) VALUES (1, ?1, ?2, NULL, ?3) ` +
  "ON CONFLICT(Id) DO UPDATE SET " +
  "Backup = CASE WHEN HallOfFame.Payload = excluded.Payload THEN HallOfFame.Backup ELSE HallOfFame.Payload END, " +
  "Payload = excluded.Payload, Schema = excluded.Schema, Updated = excluded.Updated";
const READ_SQL = `SELECT Payload, Backup FROM ${TABLE} WHERE Id = 1`;

/** The user folder the archive file was opened in, for the settings file read. */
let openedFolder = /** @type {string|null} */ (null);

/**
 * One statement on the config database.
 * @param {string} sql
 * @param {...*} args Bound as ?1, ?2, ...
 * @returns {*} The rows, or null when the call threw or returned nothing.
 */
function query(sql, ...args) {
  return safe(() => Database.query(DB, sql, ...args), null);
}

/** @returns {boolean} */
function canQueryDatabase() {
  return typeof Database !== "undefined" && !!Database && typeof Database.query === "function";
}

/** @returns {boolean} */
function canQuerySaves() {
  return safe(
    () =>
      typeof GameStateStorage.querySaveGameList === "function" &&
      typeof engine.on === "function" &&
      SaveLocations.LOCAL_STORAGE !== undefined,
    false
  );
}

/**
 * The game's user folder, read off a save's path: everything up to its last `Saves` folder.
 * @param {*} savePath
 * @returns {string|null} The folder with its trailing separator, or null when the path isn't an absolute save path.
 */
export function folderOfSave(savePath) {
  if (typeof savePath !== "string") return null;
  const match = /^(.*[\\/])Saves[\\/]/.exec(savePath);
  if (!match) return null;
  const folder = match[1];
  return /^(?:[A-Za-z]:[\\/]|[\\/])/.test(folder) ? folder : null;
}

/**
 * The first user folder any of the listed saves gives.
 * @param {*} fileList The engine's FileListQueryResults list.
 * @returns {string|null}
 */
function folderOfList(fileList) {
  for (const file of safe(() => Array.from(fileList), [])) {
    const folder = folderOfSave(safe(() => file.path, null));
    if (folder) return folder;
  }
  return null;
}

function newestSaveQuery() {
  return {
    Location: SaveLocations.LOCAL_STORAGE,
    Type: SaveTypes.SINGLE_PLAYER,
    LocationOptions:
      SaveLocationCategories.AUTOSAVE |
      SaveLocationCategories.NORMAL |
      SaveLocationCategories.QUICKSAVE |
      SaveLocationOptions.MOST_RECENT_ONLY,
    ContentType: SaveFileTypes.GAME_STATE,
    ForceRefresh: true
  };
}

/**
 * Ask the save list for the newest local save and call back once with the user folder, or with
 * null when the call is missing, there is no local save, or no answer comes in time.
 * @param {(folder: string|null) => void} done
 * @param {number} [timeoutMs]
 */
export function findUserFolder(done, timeoutMs = QUERY_TIMEOUT_MS) {
  if (!canQuerySaves()) {
    done(null);
    return;
  }
  let settled = false;
  /** @type {*} */
  let queryId = null;
  /** @type {*} */
  let timer = null;
  /** @param {string|null} folder */
  const finish = (folder) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    safe(() => engine.off(RESULTS_EVENT, onResults), undefined);
    done(folder);
  };
  /** @param {*} id @param {*} fileList */
  const onResults = (id, fileList) => {
    if (queryId === null || id !== queryId) return;
    safe(() => GameStateStorage.closeFileListQuery(id), undefined);
    finish(folderOfList(fileList));
  };
  timer = setTimeout(() => finish(null), timeoutMs);
  safe(() => engine.on(RESULTS_EVENT, onResults), undefined);
  queryId = safe(() => GameStateStorage.querySaveGameList(newestSaveQuery()), null);
  if (queryId === null) finish(null);
}

/**
 * The file an alias is attached to on this page's connection.
 * @param {string} [alias]
 * @returns {string|null} The file, or null when the alias isn't attached.
 */
function attachedFile(alias = ALIAS) {
  const rows = query("PRAGMA database_list");
  for (const row of safe(() => Array.from(rows), [])) {
    if (row && row.name === alias) return String(row.file || "");
  }
  return null;
}

/**
 * Attach the archive file in `folder` (unless this page's connection already has it) and make sure
 * its table exists.
 * @param {string} folder The user folder, with its trailing separator.
 * @returns {boolean} Whether the file is attached and its table can be read.
 */
export function openFile(folder) {
  if (!canQueryDatabase() || !folder) return false;
  let file = attachedFile();
  // An attachment outlives a page reload on the same connection, and attaching the alias twice
  // fails, so the list is checked first.
  if (file === null) {
    query(`ATTACH DATABASE ?1 AS ${ALIAS}`, folder + FILE_NAME);
    file = attachedFile();
  }
  if (file === null || !file.endsWith(FILE_NAME)) {
    log.error("archive file not attached", folder + FILE_NAME);
    return false;
  }
  query(CREATE_SQL);
  const ok = Array.isArray(query(`SELECT count(*) AS n FROM ${TABLE}`));
  if (ok) openedFolder = folder;
  return ok;
}

/**
 * A read-only SQLite URI for a file. Read-only mode never creates the file when it isn't there,
 * where a plain ATTACH would leave an empty one behind.
 * @param {string} folder The user folder, with its trailing separator.
 * @param {string} name
 * @returns {string}
 */
export function readOnlyUri(folder, name) {
  const path = (folder + name).replace(/\\/g, "/").replace(/%/g, "%25").replace(/\?/g, "%3F").replace(/#/g, "%23");
  return "file:" + (/^[A-Za-z]:/.test(path) ? "///" : "") + path + "?mode=ro";
}

/**
 * The values stored on disk under a localStorage key, read from the game's own file by key. On
 * 1.5.0 `getItem` returns whichever key sorts first (docs/civ7-storage-bug.md); the file still holds
 * the right row, as the game last wrote it.
 * @param {string} key
 * @returns {string[]} The values (empty when the file can't be read).
 */
export function readStoredItem(key) {
  if (!canQueryDatabase() || !openedFolder) return [];
  if (attachedFile(SETTINGS_ALIAS) === null) {
    query(`ATTACH DATABASE ?1 AS ${SETTINGS_ALIAS}`, readOnlyUri(openedFolder, SETTINGS_FILE_NAME));
  }
  const file = attachedFile(SETTINGS_ALIAS);
  if (file === null) return [];
  const rows = file.endsWith(SETTINGS_FILE_NAME) ? query(`SELECT value FROM ${SETTINGS_ALIAS}."Values" WHERE key = ?1`, key) : null;
  query(`DETACH DATABASE ${SETTINGS_ALIAS}`);
  return safe(() => Array.from(rows || []), [])
    .map((row) => row && row.value)
    .filter((value) => typeof value === "string" && value.length > 0);
}

/**
 * @param {*} text
 * @returns {ArchiveSlice|null} The slice, or null when the text isn't one this version wrote.
 */
function parseSlice(text) {
  if (typeof text !== "string" || !text) return null;
  try {
    const value = JSON.parse(text);
    return isSlice(value) ? value : null;
  } catch (_) {
    // Not JSON: treated as no slice, and the caller tries the backup.
    return null;
  }
}

/**
 * Read the archive from the file. A payload this version can't read falls back to the backup.
 * @returns {{slice: ArchiveSlice|null, found: boolean, ok: boolean}} `found` when the file has a row;
 *   `ok` false when the read failed or the row holds nothing this version can read.
 */
export function readFile() {
  const rows = query(READ_SQL);
  if (!Array.isArray(rows)) return { slice: null, found: false, ok: false };
  if (!rows.length) return { slice: null, found: false, ok: true };
  const slice = parseSlice(rows[0].Payload) || parseSlice(rows[0].Backup);
  return { slice, found: true, ok: !!slice };
}

/**
 * Write the archive in one statement and read it back.
 * @param {ArchiveSlice} slice
 * @returns {boolean} Whether the file now holds exactly what was written.
 */
export function writeFile(slice) {
  const text = JSON.stringify(slice);
  // Seconds: the engine binds integers as 32-bit, and milliseconds overflow.
  query(WRITE_SQL, ARCHIVE_SCHEMA, text, Math.floor(Date.now() / 1000));
  const back = query(`SELECT Payload FROM ${TABLE} WHERE Id = 1`);
  return Array.isArray(back) && back.length === 1 && back[0].Payload === text;
}
