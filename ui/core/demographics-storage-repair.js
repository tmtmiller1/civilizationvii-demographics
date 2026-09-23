// demographics-storage-repair.js
//
// Repairs the shared localStorage store when the game cannot read it.
//
// Civilization VII serves every localStorage read from the FIRST row of its store by key order
// (the engine dispatches reads down an index query instead of the key query that sits next to it).
// So whichever mod owns the first-sorting key is the only one whose settings load; every other mod
// reads that mod's data instead of its own. When another mod's data sits in that slot, this mod
// cannot read its settings or its Hall of Fame archive back, and it refuses to write - what it
// reads is not its own value, so a write would copy a stranger's blob into the shared key.
//
// The repair is the one move that restores reads for EVERY settings-style mod at once: empty the
// store, then write the shared `modSettings` key back as the only row, so the readable slot belongs
// to the key all of those mods share. Watched in game 2026-09-22 (storage-repair-probe): clear()
// and removeItem() both work, a rewritten `modSettings` reads back correctly and survives a
// restart, and reads break again the moment any mod writes a key that sorts ahead of it.
//
// What it costs is real and irreversible: every other top-level key's bytes are deleted. Exactly
// one of them was working - the key in the readable slot - and its owner loses data it was using.
// Everything else (other own-key rows, and whatever slice the shared key held) was unreadable by its
// owners already: each settings-style mod read row 1, bolted its slice onto THAT and wrote it back,
// so the shared key only ever held the last writer's slice and nobody could read it. After the repair
// those mods write their slices back into the shared key as they save, and reads are correct. The
// store cannot be enumerated (`localStorage.key(i)` returns null for every index), so there is no
// way to list what is there, delete one key blindly, or back the store up from inside the game.
// That is why this only ever runs on an explicit request.
//
// This module deliberately imports nothing from the mod: the callers pass in the slices to write.

export const ROOT_KEY = "modSettings";

/**
 * Whether localStorage is usable at all in this context.
 * @returns {boolean} True when present.
 */
export function hasStore() {
  try {
    return typeof localStorage !== "undefined" && !!localStorage;
  } catch (_) {
    return false;
  }
}

/**
 * Run an engine touch, returning the fallback when it throws.
 * @template T
 * @param {() => T} fn The call.
 * @param {T} fallback Value used when the call throws.
 * @returns {T} Result or fallback.
 */
function safe(fn, fallback) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (_) {
    return fallback;
  }
}

/**
 * A short reason string for a thrown value.
 * @param {*} e The thrown value.
 * @returns {string} Message text.
 */
function reason(e) {
  return String((e && e.message) || e);
}

/**
 * Whether a parsed value is shaped like the shared settings root: an object whose every top-level
 * value is itself an object (one slice per mod). Another mod's own store - an archive, a frame
 * dump, a bare string - fails this.
 * @param {*} v Parsed value.
 * @returns {boolean} True when it looks like the settings root.
 */
export function looksLikeSettingsRoot(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  if (!keys.length) return false;
  return keys.every((k) => !!v[k] && typeof v[k] === "object" && !Array.isArray(v[k]));
}

/**
 * How many rows the store holds. The count query is the engine's own `SELECT count(*)`, which is
 * accurate even though reads and enumeration are not.
 * @returns {number} Row count, or -1 when it cannot be read.
 */
export function storeRows() {
  if (!hasStore()) return -1;
  const n = safe(() => localStorage.length, -1);
  return typeof n === "number" ? n : -1;
}

/**
 * What the game hands back for the shared key, and whether it is usable. A settings root holding
 * no slice of ours is still "ok" - our slices simply have not been written yet; only a value that
 * cannot be a settings root at all is foreign.
 * @returns {{state: "ok"|"foreign"|"empty"|"unavailable", rows: number, bytes: number}} Diagnosis.
 */
export function diagnose() {
  if (!hasStore()) return { state: "unavailable", rows: -1, bytes: 0 };
  const rows = storeRows();
  const raw = safe(() => localStorage.getItem(ROOT_KEY), null);
  if (!raw) return { state: "empty", rows, bytes: 0 };
  const bytes = String(raw).length;
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    return { state: "foreign", rows, bytes };
  }
  return { state: looksLikeSettingsRoot(parsed) ? "ok" : "foreign", rows, bytes };
}

/**
 * @typedef {Object} RepairResult
 * @property {boolean} ok Whether the store now reads back what was written.
 * @property {number} rowsBefore Rows in the store before the repair (-1 when unknown).
 * @property {number} rowsAfter Rows after (-1 when unknown).
 * @property {number} removed How many other rows the repair deleted (-1 when unknown).
 * @property {number} bytes Bytes written.
 * @property {string} error Empty when it worked.
 */

/**
 * Why this repair must not run at all.
 * @param {*} slices Slice id -> slice.
 * @returns {string} Refusal reason, or "" when the repair may go ahead.
 */
function refusal(slices) {
  if (!hasStore()) return "no-store";
  if (!slices || typeof slices !== "object" || !Object.keys(slices).length) return "no-slices";
  return "";
}

/**
 * Serialize the slices before anything is deleted, so a value that cannot be stored never costs
 * the player the store.
 * @param {Record<string, object>} slices Slice id -> slice.
 * @returns {{text: string, error: string}} The payload, or why there is none.
 */
function serialize(slices) {
  try {
    return { text: JSON.stringify(slices), error: "" };
  } catch (e) {
    return { text: "", error: "stringify: " + reason(e) };
  }
}

/**
 * Empty the store and write the payload as its only row.
 * @param {string} text The payload.
 * @returns {string} Error, or "" when both steps went through.
 */
function replaceStore(text) {
  try {
    localStorage.clear();
  } catch (e) {
    return "clear: " + reason(e);
  }
  try {
    localStorage.setItem(ROOT_KEY, text);
  } catch (e) {
    // The store is empty now; that is still an improvement on unreadable, and the next settings
    // write will fill it.
    return "write: " + reason(e);
  }
  return "";
}

/**
 * Read the store back and confirm it now hands over what was just written. Nothing here is
 * believed on the strength of the write alone: the engine bug is in reads, so only a read proves
 * the repair.
 * @param {string[]} sliceIds Slice ids that must be present.
 * @returns {string} Error, or "" when the readback is ours.
 */
function verifyRoot(sliceIds) {
  const back = safe(() => localStorage.getItem(ROOT_KEY), null);
  if (!back) return "readback-empty";
  let parsed = null;
  try {
    parsed = JSON.parse(String(back));
  } catch (_) {
    return "readback-unparseable";
  }
  if (!looksLikeSettingsRoot(parsed)) return "readback-foreign";
  const missing = sliceIds.filter((id) => parsed[id] === undefined);
  return missing.length ? "readback-missing:" + missing.join(",") : "";
}

/**
 * Empty the store and write the shared root back with only these slices in it, so the shared key
 * owns the one readable slot. Destroys every other key's data - callers must have consent.
 * @param {Record<string, object>} slices Slice id -> slice, written under {@link ROOT_KEY}.
 * @returns {RepairResult} What happened, from reading the store back afterwards.
 */
export function repairStore(slices) {
  /** @type {RepairResult} */
  const out = { ok: false, rowsBefore: -1, rowsAfter: -1, removed: -1, bytes: 0, error: refusal(slices) };
  if (out.error) return out;
  const payload = serialize(slices);
  out.bytes = payload.text.length;
  out.error = payload.error;
  if (out.error) return out;
  out.rowsBefore = storeRows();
  out.error = replaceStore(payload.text);
  out.rowsAfter = storeRows();
  if (out.error) return out;
  if (out.rowsBefore >= 0 && out.rowsAfter >= 0) out.removed = Math.max(0, out.rowsBefore - out.rowsAfter);
  out.error = verifyRoot(Object.keys(slices));
  out.ok = !out.error;
  return out;
}
