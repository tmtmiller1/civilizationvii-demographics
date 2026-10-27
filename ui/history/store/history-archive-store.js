// history-archive-store.js
//
// Keeps the cross-game archive, and is the one place that decides where: in a SQLite file of its
// own (history-archive-file.js) when the game's user folder can be found and the file attached,
// otherwise in this mod's slice of the shared localStorage `modSettings` object, as 2.10.0 did.
// A slice still in modSettings is merged into the file and then removed from modSettings, only
// after the file reads back. See docs/archive-file-store.md.
//
// In modSettings a second top-level key is avoided because several mods clear localStorage
// whenever it holds more than one key. getItem() can return another key's value, so every read is
// untrusted: the store writes only a value it read that looks like a settings root, then reads
// back and marks the session "unverified" when its games are not there.

import { log, safe } from "/demographics/ui/history/core/history-log.js";
import {
  emptySlice,
  fitSlice,
  hideGame,
  isSlice,
  mergeSlices,
  pruneUnfinished,
  sliceTexts,
  upsert
} from "/demographics/ui/history/store/history-archive.js";
import { findUserFolder, openFile, readFile, writeFile } from "/demographics/ui/history/store/history-archive-file.js";
import { repairStore, storeRows } from "/demographics/ui/core/demographics-storage-repair.js";
import DemographicsSettings from "/demographics/ui/core/demographics-settings.js";

export const ROOT_KEY = "modSettings";
export const SLICE_ID = "demographics-halloffame";

/** @typedef {"ok"|"empty"|"foreign"|"unverified"|"unavailable"} ArchiveStatus */

/**
 * Where the archive is kept this session: "pending" until the save list answers, then "file", or
 * "settings" (modSettings) when the file can't be used.
 * @typedef {"pending"|"file"|"settings"} ArchiveBackend
 */

/** @type {{slice: ArchiveSlice, status: ArchiveStatus, loaded: boolean, backend: ArchiveBackend, session: number}} */
const state = { slice: emptySlice(), status: "empty", loaded: false, backend: "pending", session: 0 };

/**
 * Whether a parsed value is shaped like the shared settings root.
 * @param {*} value
 * @returns {boolean}
 */
export function looksLikeSettingsRoot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).every((k) => !!value[k] && typeof value[k] === "object" && !Array.isArray(value[k]));
}

/**
 * One raw read of the shared root.
 * @returns {string|null|undefined} The value, null when empty, undefined when getItem threw.
 */
function readRaw() {
  try {
    const raw = localStorage.getItem(ROOT_KEY);
    return typeof raw === "string" && raw.length > 0 ? raw : null;
  } catch (_) {
    // getItem can throw in some Coherent UI contexts; the caller must not treat that as empty.
    return undefined;
  }
}

/**
 * Whether an empty read means the shared key is absent: true when the store is empty or its key
 * list (key(i), which enumerates on a correct localStorage and is always null on 1.5.0) does not
 * hold the key. On 1.5.0 getItem never returns empty for a populated store, so an empty read there
 * is a transient failure.
 * @returns {boolean}
 */
function emptyReadIsAbsentKey() {
  const rows = storeRows();
  if (rows <= 0) return true;
  return safe(() => {
    for (let i = 0; i < rows; i += 1) {
      const key = localStorage.key(i);
      if (key === ROOT_KEY || key === null || key === undefined) return false;
    }
    return true;
  }, false);
}

/**
 * Read the shared root and classify it.
 * @returns {{root: Record<string, any>, status: ArchiveStatus}} The root (empty when unusable).
 */
export function readRoot() {
  if (typeof localStorage === "undefined") return { root: {}, status: "unavailable" };
  let raw = readRaw();
  // Coherent returns a transient empty value now and then; a populated second read proves it.
  if (raw === null) raw = readRaw();
  // A read that threw is not an empty store: siblings may be there and unreadable.
  if (raw === undefined) return { root: {}, status: "unavailable" };
  // An empty read of a populated store is that same flaky read twice unless the key list says
  // the shared key is genuinely absent; writing only our slice back would erase every other mod's
  // settings.
  if (!raw && !emptyReadIsAbsentKey()) return { root: {}, status: "unverified" };
  if (!raw) return { root: {}, status: "empty" };
  return classifyRoot(raw);
}

/**
 * Parse a raw shared root and decide whether this mod may write it back.
 * @param {string} raw
 * @returns {{root: Record<string, any>, status: ArchiveStatus}} The root (empty when unusable).
 */
function classifyRoot(raw) {
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    // Not JSON: another mod's bytes, never overwritten.
    return { root: {}, status: "foreign" };
  }
  if (!looksLikeSettingsRoot(parsed)) return { root: {}, status: "foreign" };
  const slice = parsed[SLICE_ID];
  if (slice !== undefined && !isSlice(slice)) return { root: {}, status: "foreign" };
  return { root: parsed, status: "ok" };
}

/**
 * Find the user folder and attach the archive file. The answer is async; until it comes the store
 * keeps to modSettings, and a store that loaded meanwhile takes the file in when it arrives.
 */
function beginFileStore() {
  state.session += 1;
  const session = state.session;
  state.backend = "pending";
  findUserFolder((folder) => {
    if (session !== state.session) return;
    if (!folder || !openFile(folder)) {
      useSettings("no archive file this session");
      return;
    }
    state.backend = "file";
    log.debug("archive file attached");
    if (state.loaded) loadFromFile(true);
  });
}

/**
 * Keep to modSettings for the rest of the session; the next page load tries the file again.
 * @param {string} why
 * @returns {false}
 */
function useSettings(why) {
  state.backend = "settings";
  log.debug("archive in modSettings:", why);
  return false;
}

/**
 * The slice modSettings still holds, when it can be read.
 * @returns {ArchiveSlice|null}
 */
function readLegacySlice() {
  const { root, status } = readRoot();
  return status === "ok" && root[SLICE_ID] ? root[SLICE_ID] : null;
}

/**
 * Read the file, and any slice still in modSettings, into memory. A slice found in modSettings is
 * moved to the file; `late` (the file arrived after the store loaded from modSettings) always
 * writes, so what this session saved there reaches the file too.
 * @param {boolean} late
 * @returns {boolean} False when the file holds nothing this version can read (the session then
 *   keeps to modSettings).
 */
function loadFromFile(late) {
  const file = readFile();
  if (!file.ok) return useSettings("the archive file holds nothing this version can read");
  if (file.slice) mergeSlices(state.slice, file.slice);
  const legacy = readLegacySlice();
  if (legacy) mergeSlices(state.slice, legacy);
  if (!late) state.status = file.found || legacy ? "ok" : "empty";
  pruneUnfinished(state.slice);
  if (legacy || late) moveToFile(!!legacy);
  return true;
}

/**
 * Write the archive to the file and, once it reads back, take the slice out of modSettings.
 * @param {boolean} hasLegacy Whether modSettings holds a slice to remove.
 */
function moveToFile(hasLegacy) {
  if (!writeArchiveFile() || !hasLegacy) return;
  // Left in place when this fails: the file is the source now, and a later load removes it.
  if (!dropLegacySlice()) log.error("archive file written; the old copy stays in modSettings for now");
}

/**
 * @returns {boolean} Whether the file now holds the in-memory archive. When it doesn't, the session
 *   keeps to modSettings.
 */
function writeArchiveFile() {
  fitSlice(state.slice);
  if (writeFile(state.slice)) {
    state.status = "ok";
    return true;
  }
  return useSettings("the archive file did not read back");
}

/**
 * Write modSettings back without this mod's archive slice, under the same rules as a save: only a
 * root that read "ok" is written, and it is read back.
 * @returns {boolean} Whether modSettings no longer holds the slice.
 */
function dropLegacySlice() {
  const { root, status } = readRoot();
  if (status !== "ok") return false;
  if (!(SLICE_ID in root)) return true;
  const next = { ...root };
  delete next[SLICE_ID];
  try {
    localStorage.setItem(ROOT_KEY, JSON.stringify(next));
  } catch (e) {
    log.error("modSettings write failed", e);
    return false;
  }
  const back = readRoot();
  return back.status === "ok" && !(SLICE_ID in back.root);
}

/**
 * Load the archive once per session, merging what storage holds into memory.
 * @returns {ArchiveSlice} The in-memory slice.
 */
export function loadArchive() {
  if (state.loaded) return state.slice;
  state.loaded = true;
  if (state.backend !== "file" || !loadFromFile(false)) loadFromSettings();
  log.debug("archive loaded", state.backend, state.status, Object.keys(state.slice.games).length);
  return state.slice;
}

function loadFromSettings() {
  const { root, status } = readRoot();
  state.status = status;
  if (status === "ok" && root[SLICE_ID]) mergeSlices(state.slice, root[SLICE_ID]);
  // Cleared in memory here so the screen matches the rule at once; storage catches up on the next write.
  const cleared = pruneUnfinished(state.slice);
  log.debug("archive cleared", cleared.length);
}

/**
 * Status of the archive this session, for the Hall of Fame footer.
 * @returns {ArchiveStatus}
 */
export function archiveStatus() {
  return state.status;
}

/**
 * Persist the in-memory slice: to the file when it is in use, otherwise to the shared root if it can
 * be written safely. A file write that doesn't read back falls through to the shared root.
 * @returns {boolean}
 */
export function persistArchive() {
  if (state.backend === "file" && persistToFile()) return true;
  return persistToSettings();
}

function persistToFile() {
  const file = readFile();
  if (!file.ok) return useSettings("the archive file holds nothing this version can read");
  if (file.slice) mergeSlices(state.slice, file.slice);
  pruneUnfinished(state.slice);
  return writeArchiveFile();
}

function persistToSettings() {
  const { root, status } = readRoot();
  if (status !== "ok" && status !== "empty") {
    state.status = status;
    return false;
  }
  if (root[SLICE_ID]) mergeSlices(state.slice, root[SLICE_ID]);
  pruneUnfinished(state.slice);
  fitSlice(state.slice);
  const next = { ...root, [SLICE_ID]: state.slice };
  try {
    localStorage.setItem(ROOT_KEY, JSON.stringify(next));
  } catch (e) {
    log.error("archive write failed", e);
    return false;
  }
  return verifyWrite();
}

function verifyWrite() {
  const { root, status } = readRoot();
  const ids = Object.keys(state.slice.games);
  const back = status === "ok" ? root[SLICE_ID] : null;
  const ok = !!back && ids.every((id) => !!back.games[id]);
  state.status = ok ? "ok" : "unverified";
  return ok;
}

/**
 * Add or refresh one campaign's record and persist.
 * @param {ArchiveRecord} rec
 * @returns {boolean} Whether the stored archive now holds it.
 */
export function saveRecord(rec) {
  loadArchive();
  upsert(state.slice, rec);
  return persistArchive();
}

/**
 * Remove a game from the Hall of Fame (remembered, so its save does not restore it).
 * @param {string} id
 * @returns {boolean}
 */
export function deleteRecord(id) {
  loadArchive();
  hideGame(state.slice, id, Date.now());
  return persistArchive();
}

/**
 * Every visible record.
 * @returns {ArchiveRecord[]}
 */
export function allRecords() {
  return Object.values(loadArchive().games);
}

/**
 * The names the archive carries, so the main menu can read a game it cannot look up.
 * @returns {Record<string, string>} Tag -> text.
 */
export function archiveTexts() {
  return sliceTexts(loadArchive());
}

/**
 * Empty the shared store and write it back holding this mod's slices, so the shared settings key
 * owns the one readable row. Destroys every other key's stored bytes: only call it on an explicit
 * request from the player. With the archive in its own file, only the settings slice is written
 * back and the file is left alone; otherwise the in-memory archive is the source for the rewrite.
 * @returns {import("/demographics/ui/core/demographics-storage-repair.js").RepairResult}
 */
export function repairStorage() {
  loadArchive();
  const inFile = state.backend === "file";
  /** @type {Record<string, object>} */
  const slices = {};
  if (!inFile) {
    pruneUnfinished(state.slice);
    fitSlice(state.slice);
    slices[SLICE_ID] = state.slice;
  }
  const settings = safe(() => DemographicsSettings.sliceForStore(), null);
  if (settings && settings.id && settings.slice) slices[settings.id] = settings.slice;
  const result = repairStore(slices);
  if (result.ok) {
    if (!inFile) state.status = "ok";
    // The settings module may have gone read-only on the same broken store; it can write again.
    safe(() => DemographicsSettings.resetPersistenceStatus?.(), undefined);
    log.debug("storage repaired", result.rowsBefore, "->", result.rowsAfter);
  } else {
    // The store was emptied even when the write back failed, so nothing in it is readable now.
    // The file, when in use, still holds the archive.
    if (!inFile) state.status = result.error === "no-store" ? "unavailable" : "unverified";
    log.error("storage repair failed:", result.error);
  }
  return result;
}

/**
 * Test hook: reset session state and look for the archive file again with the current globals.
 */
export function _resetForTests() {
  state.slice = emptySlice();
  state.status = "empty";
  state.loaded = false;
  beginFileStore();
}

beginFileStore();
