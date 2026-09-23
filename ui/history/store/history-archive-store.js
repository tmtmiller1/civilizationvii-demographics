// history-archive-store.js
//
// Keeps the cross-game archive in this mod's slice of the shared localStorage `modSettings` object,
// the convention ModOptions-style mods use (one sub-object per mod). A second top-level key is
// avoided on purpose: several popular mods clear localStorage whenever it holds more than one key.
//
// Coherent GameFace in Civilization VII 1.5.0 can return another key's value from getItem(). The
// store therefore treats every read as untrusted:
// - it writes only when the value read looks like a settings root (every top-level value is an
//   object) and any slice already under our id is one this mod wrote;
// - it never writes a value it did not read, so other mods' slices are carried over byte for byte;
// - after writing it reads back and marks the session "unverified" when its games are not there.
// The in-memory slice is authoritative for the session. Each save also carries its own campaign,
// so a record the archive loses is restored the next time that save is played.

import { dlog, derr, safe } from "/demographics/ui/history/core/history-log.js";
import { emptySlice, fitSlice, isSlice, mergeSlices, upsert, hideGame, sliceTexts } from "/demographics/ui/history/store/history-archive.js";
import { repairStore } from "/demographics/ui/core/demographics-storage-repair.js";
import DemographicsSettings from "/demographics/ui/core/demographics-settings.js";

export const ROOT_KEY = "modSettings";
export const SLICE_ID = "demographics-halloffame";

/** @typedef {"ok"|"empty"|"foreign"|"unverified"|"unavailable"} ArchiveStatus */

/** @type {{slice: ArchiveSlice, status: ArchiveStatus, loaded: boolean}} */
const state = { slice: emptySlice(), status: "empty", loaded: false };

/**
 * Whether a parsed value is shaped like the shared settings root.
 * @param {*} v Parsed value.
 * @returns {boolean} True when every top-level value is a plain object.
 */
export function looksLikeSettingsRoot(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.keys(v).every((k) => !!v[k] && typeof v[k] === "object" && !Array.isArray(v[k]));
}

/**
 * Read the shared root and classify it.
 * @returns {{root: Record<string, any>, status: ArchiveStatus}} The root (empty when unusable).
 */
export function readRoot() {
  if (typeof localStorage === "undefined") return { root: {}, status: "unavailable" };
  const raw = safe(() => localStorage.getItem(ROOT_KEY), null);
  if (!raw) return { root: {}, status: "empty" };
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    return { root: {}, status: "foreign" };
  }
  if (!looksLikeSettingsRoot(parsed)) return { root: {}, status: "foreign" };
  const slice = parsed[SLICE_ID];
  if (slice !== undefined && !isSlice(slice)) return { root: {}, status: "foreign" };
  return { root: parsed, status: "ok" };
}

/**
 * Load the archive once per session, merging what storage holds into memory.
 * @returns {ArchiveSlice} The in-memory slice.
 */
export function loadArchive() {
  if (state.loaded) return state.slice;
  state.loaded = true;
  const { root, status } = readRoot();
  state.status = status;
  if (status === "ok" && root[SLICE_ID]) mergeSlices(state.slice, root[SLICE_ID]);
  dlog("archive loaded", status, Object.keys(state.slice.games).length);
  return state.slice;
}

/**
 * Status of the archive this session, for the Hall of Fame footer.
 * @returns {ArchiveStatus} Status.
 */
export function archiveStatus() {
  return state.status;
}

/**
 * Persist the in-memory slice, if the shared root can be written safely.
 * @returns {boolean} True when written and read back.
 */
export function persistArchive() {
  const { root, status } = readRoot();
  if (status !== "ok" && status !== "empty") {
    state.status = status;
    return false;
  }
  if (root[SLICE_ID]) mergeSlices(state.slice, root[SLICE_ID]);
  fitSlice(state.slice);
  const next = { ...root, [SLICE_ID]: state.slice };
  try {
    localStorage.setItem(ROOT_KEY, JSON.stringify(next));
  } catch (e) {
    derr("archive write failed", e);
    return false;
  }
  return verifyWrite();
}

/**
 * Read back after a write and confirm our games are present.
 * @returns {boolean} True when verified.
 */
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
 * @param {ArchiveRecord} rec The record.
 * @returns {boolean} True when the stored archive now holds it.
 */
export function saveRecord(rec) {
  loadArchive();
  upsert(state.slice, rec);
  return persistArchive();
}

/**
 * Remove a game from the Hall of Fame (remembered, so its save does not restore it).
 * @param {string} id Campaign id.
 * @returns {boolean} True when persisted.
 */
export function deleteRecord(id) {
  loadArchive();
  hideGame(state.slice, id, Date.now());
  return persistArchive();
}

/**
 * Every visible record.
 * @returns {ArchiveRecord[]} Records.
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
 * owns the one readable row; other mods add their slices back to it as they save. Destroys every
 * other key's stored bytes (one mod's working data, the rest already unreadable): only call it on an
 * explicit request from the player, after telling them what is lost. The in-memory archive is the
 * source for the rewrite, so the games this session knows about are kept.
 *
 * The repair holds until some mod writes a key that sorts ahead of `modSettings` - then reads break
 * again and this can be run again.
 * @returns {import("/demographics/ui/core/demographics-storage-repair.js").RepairResult} Outcome.
 */
export function repairStorage() {
  loadArchive();
  fitSlice(state.slice);
  const settings = safe(() => DemographicsSettings.sliceForStore(), null);
  /** @type {Record<string, object>} */
  const slices = { [SLICE_ID]: state.slice };
  if (settings && settings.id && settings.slice) slices[settings.id] = settings.slice;
  const result = repairStore(slices);
  if (result.ok) {
    state.status = "ok";
    dlog("storage repaired", result.rowsBefore, "->", result.rowsAfter);
  } else {
    // The store was emptied even when the write back failed, so nothing here is readable now.
    state.status = result.error === "no-store" ? "unavailable" : "unverified";
    derr("storage repair failed:", result.error);
  }
  return result;
}

/**
 * Test hook: reset session state.
 */
export function _resetForTests() {
  state.slice = emptySlice();
  state.status = "empty";
  state.loaded = false;
}
