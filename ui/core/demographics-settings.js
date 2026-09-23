// demographics-settings.js
//
// Mod settings, namespaced under localStorage.modSettings.demographics. Only the
// single shared "modSettings" top-level key is ever written: many popular mods
// wipe ALL of localStorage when more than one top-level key exists, so a
// sibling key would erase every mod's settings. The in-memory bucket is
// authoritative and persistence is best-effort (without localStorage the
// session still works but settings don't survive a reload).
//
// API:
//   DemographicsSettings.getSettings()           → the mod's slice
//   DemographicsSettings.getSetting(key, dflt)   → any
//   DemographicsSettings.setSetting(key, value)  → also persists

/**
 * The known settings keys (mirroring {@link DEFAULTS}).
 * @typedef {Object} SettingsShape
 * @property {string} [activeMetric] Active metric id.
 * @property {string[]} [hiddenCivs] Hidden civ leaderType strings.
 * @property {boolean} [colorblindMode] CVD-safe palette toggle.
 * @property {string|number} [sampleCapOverride] History cap override.
 * @property {boolean} [disableDecimation] Skip per-Nth decimation pass.
 * @property {number} [sampleEveryNTurns] Turns between snapshot captures.
 * @property {boolean} [showWonderMarkers] Overlay wonder-count markers.
 * @property {boolean} [showWarMarkers] Overlay war onset markers on the Emigration refugees chart.
 * @property {boolean} [showDisasterMarkers] Overlay disaster onset markers on the Emigration
 * refugees chart.
 */

/**
 * The mod's own settings slice (the value stored under
 * `modSettings.demographics`). Known keys mirror {@link DEFAULTS}; arbitrary
 * extra keys may be present from forward-compat writes.
 * @typedef {SettingsShape & Record<string, *>} SettingsBucket
 */

/**
 * The top-level `modSettings` blob shared across all mods. Keyed by mod id;
 * this mod owns only the `demographics` slice and never touches siblings.
 * @typedef {Record<string, SettingsBucket>} SettingsRoot
 */

const DBG = false;
/**
 * Debug logger, no-op unless {@link DBG} is set.
 * @param {...*} a Values to log.
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.settings]", ...a);
}
/**
 * Error logger; always emits.
 * @param {...*} a Values to log.
 */
function derr(...a) {
  console.error("[Demographics.settings]", ...a);
}

const MOD_ID = "demographics";
const ROOT_KEY = "modSettings";
// Schema version stamped into the persisted slice (under SCHEMA_KEY), so a
// missing / malformed / wrong-version slice can be detected on load. SCHEMA_KEY
// is kept out of the in-memory settings keyspace (stripped on seed).
const SCHEMA_KEY = "__schema";
const SCHEMA_VERSION = 1;

// DEFAULTS is NOT an exhaustive schema: it seeds the in-memory bucket and backs
// `getSettings()`, but the authoritative default is the call-site fallback in
// `getSetting(key, dflt)`. Per-view state (active tab/page/metric, viewer pids,
// time filters) is intentionally absent here.
/** @type {SettingsBucket} */
const DEFAULTS = {
  activeMetric: "score",
  hiddenCivs: [], // array of leaderType strings
  // ─── Accessibility ─────────────────────────────────────────────────
  colorblindMode: false, // swap mod-owned colors to a CVD-safe palette
  // ─── Adaptive history storage cap ───
  // Max samples kept before decimating older history: "auto" = derive from
  // Game.gameSpeed; numeric value overrides; -1 = unlimited (never drops samples).
  sampleCapOverride: "auto",
  // When true, the per-Nth decimation pass is skipped entirely so every turn is
  // preserved; pairs with a generous (or unlimited) `sampleCapOverride`.
  disableDecimation: false,
  // ─── Polling rate ──────────────────────────────────────────────────
  // Turns between snapshot captures; 1 = every turn. Higher values trade chart
  // resolution for a smaller storage footprint and less work each turn-end.
  sampleEveryNTurns: 1,
  // ─── Wonder markers ─────────────────────────────────────────────────
  // Overlay a tiny wonder icon on each civ's line at every turn that
  // civ's wonders count incremented. Toggle from the Options tab.
  showWonderMarkers: true,
  // ─── War / disaster markers (Emigration refugees chart) ─────────────
  // Overlay war onsets and disaster onsets on the Emigration refugees
  // graph's timeline. Two independent toggles, like wonder markers.
  showWarMarkers: true,
  showDisasterMarkers: true,
  // ─── Spoiler guard ─────────────────────────────────────────────────
  // When true (default), diplomacy / influence / relations figures are
  // withheld for civilizations the local player has not met (the charts
  // show a gap, not a value). Turn off to record and show those too.
  hideUnmetStats: true,
  // ─── Analytics-visibility governance ─────
  // The local player's analytics policy, one of "disabled", "own-civ-only",
  // "met-civs-only", "full". A multiplayer host can cap it via a GameConfiguration
  // ceiling (demographics-governance.js); the effective policy is the more restrictive.
  analyticsPolicy: "met-civs-only",
  // ─── UI complexity tier ────────────────
  // Progressive-disclosure profile: "basic" (core stat pages only),
  // "standard" (all pages/tabs; advanced tuning hidden ; default), or
  // "analyst" (everything, including storage/sampling controls).
  uiComplexity: "standard",
  // ─── Met-history reveal mode (sub-option of hideUnmetStats) ─────────
  // What the line chart shows for a civ after you meet it, when hideUnmetStats
  // is on: true reveals the civ's entire history once met; false reveals only
  // data from first contact forward. Ignored when hideUnmetStats is off.
  backfillMetHistory: true
};

// ─── Settings schema + load-time validation/migration ──────────────────────
// SCHEMA declares the type (and clamp range) for each KNOWN setting so a
// malformed persisted value is repaired to its default on load. Keys absent
// from SCHEMA (per-view state, forward-compat writes) pass through untouched.
/** @type {Record<string, { type: string, min?: number, max?: number }>} */
const SCHEMA = {
  activeMetric: { type: "string" },
  hiddenCivs: { type: "string[]" },
  colorblindMode: { type: "boolean" },
  sampleCapOverride: { type: "capOverride" },
  disableDecimation: { type: "boolean" },
  sampleEveryNTurns: { type: "int", min: 1, max: 200 },
  showWonderMarkers: { type: "boolean" },
  showWarMarkers: { type: "boolean" },
  showDisasterMarkers: { type: "boolean" },
  hideUnmetStats: { type: "boolean" },
  analyticsPolicy: { type: "string" },
  uiComplexity: { type: "string" },
  backfillMetHistory: { type: "boolean" }
};

/**
 * Coerce a value to a clamped integer, or undefined when non-numeric.
 * @param {*} v The raw value.
 * @param {{ min?: number, max?: number }} spec The clamp spec.
 * @returns {number|undefined} The clamped int, or undefined when invalid.
 */
function coerceInt(v, spec) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return undefined;
  let i = Math.round(n);
  if (typeof spec.min === "number") i = Math.max(spec.min, i);
  if (typeof spec.max === "number") i = Math.min(spec.max, i);
  return i;
}

/**
 * Coerce the sample-cap override: "auto", or a finite number (-1 = unlimited).
 * @param {*} v The raw value.
 * @returns {string|number|undefined} The valid value, or undefined.
 */
function coerceCapOverride(v) {
  if (v === "auto") return "auto";
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** @type {Record<string, (v: *, spec: *) => *>} */
const TYPE_VALIDATORS = {
  boolean: (v) => (typeof v === "boolean" ? v : undefined),
  string: (v) => (typeof v === "string" ? v : undefined),
  "string[]": (v) => (Array.isArray(v) && v.every((x) => typeof x === "string") ? v : undefined),
  int: (v, spec) => coerceInt(v, spec),
  capOverride: (v) => coerceCapOverride(v)
};

/**
 * Validate + repair a settings bucket in place against {@link SCHEMA}: every
 * known key is type-checked / clamped, and reset to its default when invalid.
 * Unknown keys are left untouched. Mutates and returns `bucket`.
 * @param {SettingsBucket} bucket The bucket to repair.
 * @returns {SettingsBucket} The repaired bucket.
 */
function repairBucket(bucket) {
  for (const key of Object.keys(SCHEMA)) {
    if (!(key in bucket)) continue;
    const validate = TYPE_VALIDATORS[SCHEMA[key].type];
    const repaired = validate ? validate(bucket[key], SCHEMA[key]) : bucket[key];
    if (repaired === undefined) {
      derr("settings: '" + key + "' invalid (" + typeof bucket[key] + "); reset to default");
      bucket[key] = DEFAULTS[key];
    } else {
      bucket[key] = repaired;
    }
  }
  return bucket;
}

// Migration map: MIGRATIONS[n] upgrades a slice from schema version n to n+1.
// Empty today (SCHEMA_VERSION === 1, no prior shipped schema); the machinery is
// in place so a future bump only needs to add an entry.
/** @type {Record<number, (slice: SettingsBucket) => SettingsBucket>} */
const MIGRATIONS = {};

/**
 * Upgrade a persisted slice from its stamped schema version to the current one,
 * running each registered migration in order, then re-stamp the version.
 * @param {SettingsBucket} slice The persisted slice (mutated).
 * @returns {SettingsBucket} The migrated slice.
 */
function migrateSlice(slice) {
  let from = typeof slice[SCHEMA_KEY] === "number" ? slice[SCHEMA_KEY] : 0;
  // A slice stamped by a NEWER build is left as it is: its keys are read but the
  // stamp is not lowered, so the newer build does not re-run migrations.
  if (from > SCHEMA_VERSION) return slice;
  while (from < SCHEMA_VERSION) {
    const migrate = MIGRATIONS[from];
    if (typeof migrate === "function") slice = migrate(slice) || slice;
    from += 1;
  }
  slice[SCHEMA_KEY] = SCHEMA_VERSION;
  return slice;
}

/**
 * Normalize a persisted settings slice through migration + repair.
 * @param {SettingsBucket} slice The raw persisted slice.
 * @returns {SettingsBucket} The normalized slice.
 */
function normalizeSlice(slice) {
  const migrated = migrateSlice({ ...slice });
  return repairBucket(migrated);
}

/**
 * The slice as it should be stored: normalized, then stripped of every key that still equals the
 * shipped default, so a later change to a default reaches every store. Keys absent from DEFAULTS
 * are per-view state and always persist; reads overlay DEFAULTS over the partial slice.
 * @param {SettingsBucket} bucket Stored slice merged with whatever is being written.
 * @returns {SettingsBucket} The slice to store, stamped with the schema version.
 */
function sliceToPersist(bucket) {
  const merged = normalizeSlice(bucket);
  /** @type {SettingsBucket} */
  const slice = {};
  for (const k of Object.keys(merged)) {
    if (k === SCHEMA_KEY) continue;
    const matchesDefault = k in DEFAULTS && JSON.stringify(merged[k]) === JSON.stringify(DEFAULTS[k]);
    if (!matchesDefault) slice[k] = merged[k];
  }
  const stamped = merged[SCHEMA_KEY];
  slice[SCHEMA_KEY] =
    typeof stamped === "number" && stamped > SCHEMA_VERSION ? stamped : SCHEMA_VERSION;
  return slice;
}

/**
 * Run `fn`, returning its result; on any throw, log and return `fallback`.
 * @template T
 * @param {() => T} fn Function to invoke.
 * @param {T} [fallback] Value to return if `fn` throws.
 * @returns {T} The result of `fn`, or `fallback` on error.
 */
function safeCall(fn, fallback) {
  try {
    return fn();
  } catch (e) {
    derr("safeCall:", e);
    return /** @type {T} */ (fallback);
  }
}

/**
 * Whether a usable `localStorage` is present in this UI context.
 * @returns {boolean}
 */
function hasLocalStorage() {
  return safeCall(() => typeof localStorage !== "undefined" && localStorage !== null, false);
}

/** In-memory fallback bucket. @type {SettingsBucket} */
let memoryBucket = { ...DEFAULTS };

let _rootParseWarned = false;
/**
 * Read and parse the top-level `modSettings` blob from storage. Other mods and
 * the engine write this shared key too and can leave non-JSON in it; a failed
 * parse is harmless (the in-memory bucket serves reads) and warns at most once per session.
 * @returns {SettingsRoot|null} The parsed root, `{}` on parse failure or empty,
 *   or `null` when storage is unavailable.
 */
function readRoot() {
  if (!hasLocalStorage()) return null;
  let raw = null;
  try {
    raw = localStorage.getItem(ROOT_KEY);
  } catch (_e) {
    // localStorage.getItem itself can throw in some Coherent UI contexts.
    return {};
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (_e) {
    if (!_rootParseWarned) {
      _rootParseWarned = true;
      derr(
        "shared '" +
          ROOT_KEY +
          "' localStorage value is not valid JSON (likely written by another " +
          "mod or the engine); using in-memory settings for this session. " +
          "Further parse failures are silenced."
      );
    }
    return {};
  }
}

/**
 * Persist the top-level `modSettings` blob. No-op when storage is unavailable.
 * @param {SettingsRoot} root The full root blob to serialize.
 */
function writeRoot(root) {
  if (!hasLocalStorage()) return;
  const written = safeCall(() => {
    // Only write our own key ("modSettings"); never wipe other top-level keys,
    // which Civ7 / other UI code writes between our setSetting calls.
    localStorage.setItem(ROOT_KEY, JSON.stringify(root));
    return true;
  }, false);
  if (!written) {
    disablePersistence("localStorage.setItem threw", "unavailable");
    return;
  }
  verifyWrite();
}

/**
 * Read back after a write and require our slice to be there with its schema stamp. Under the
 * first-key bug a read-back returns some other key's value; persisting further would only copy
 * that value into the shared root again on every toggle, so the session goes read-only instead.
 * @returns {void}
 */
function verifyWrite() {
  let raw = readRawRoot();
  // The same transient empty read that the write path tolerates: re-read once before judging.
  if (!raw) raw = readRawRoot();
  if (raw === READ_THREW) {
    disablePersistence("read-back after write threw", "unverified");
    return;
  }
  let back = null;
  try {
    back = raw ? JSON.parse(raw) : null;
  } catch (_e) {
    // Not JSON: the store handed back something we did not write.
    back = null;
  }
  const slice = back && typeof back === "object" ? back[MOD_ID] : null;
  const stamp = slice && typeof slice === "object" ? slice[SCHEMA_KEY] : undefined;
  if (typeof stamp !== "number") disablePersistence("read-back did not return our slice", "unverified");
}

/**
 * Whether a parsed value actually looks like the shared settings root: an object
 * whose every top-level value is itself an object (one slice per mod id).
 * Coherent's `localStorage.getItem()` returns the value of the FIRST key in the
 * store regardless of the key asked for, so a read of `modSettings` can hand back
 * another mod's (valid-JSON) blob; writing that back would copy it into the shared
 * key. Foreign blobs carry top-level scalars, so this is a cheap discriminator.
 * @param {*} parsed The parsed `modSettings` value.
 * @returns {boolean} True when it is shaped like a settings root.
 */
function looksLikeSettingsRoot(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  return Object.keys(parsed).every((k) => {
    const v = parsed[k];
    return !!v && typeof v === "object" && !Array.isArray(v);
  });
}

let _foreignRootWarned = false;
let _clobberGuardWarned = false;

/** Sentinel for "getItem threw", distinct from an empty read. */
const READ_THREW = Symbol("read-threw");

/**
 * Raw read of the shared root, telling a throw apart from an empty store.
 * @returns {string|null|typeof READ_THREW} The raw value, null when empty, READ_THREW on throw.
 */
function readRawRoot() {
  try {
    const v = localStorage.getItem(ROOT_KEY);
    return typeof v === "string" ? v : null;
  } catch (_e) {
    // getItem can throw in some Coherent UI contexts; the caller must not treat this as empty.
    return READ_THREW;
  }
}

/**
 * How many rows the store holds; the engine's count is accurate even when reads are not.
 * @returns {number} Row count, or -1 when unknown.
 */
function storeRowCount() {
  const n = safeCall(() => localStorage.length, -1);
  return typeof n === "number" ? n : -1;
}

/**
 * Whether an empty read of the shared root can be trusted as "the key is absent". On an engine
 * whose key(i) enumerates (a correct localStorage), the key list answers it. On 1.5.0 key(i) is
 * always null and getItem returns the first row's value whatever key is asked, so an empty read of
 * a populated store there can only be a transient failure: not trusted.
 * @returns {boolean} True when the empty read means the key is genuinely absent.
 */
function emptyReadIsAbsentKey() {
  const rows = storeRowCount();
  if (rows <= 0) return true;
  return safeCall(() => {
    for (let i = 0; i < rows; i += 1) {
      const k = localStorage.key(i);
      if (k === ROOT_KEY) return false;
      if (k === null || k === undefined) return false; // cannot enumerate: 1.5.0 behaviour
    }
    return true;
  }, false);
}

/** @typedef {"ok"|"unverified"|"unavailable"|"foreign"|"unparseable"|"read-failed"} PersistStatus */

/** Why persistence is off for the rest of this session, or null while it is on. */
let _persistDisabled = /** @type {string|null} */ (null);
/** @type {PersistStatus} */
let _persistStatus = "ok";

/**
 * Stop persisting for the rest of the session and say why, once.
 * @param {string} reason Short reason for the log line.
 * @param {PersistStatus} [status] Status to report to the Options footer.
 * @returns {{root: SettingsRoot, safe: boolean}} A refused write.
 */
function disablePersistence(reason, status = "read-failed") {
  if (!_persistDisabled) {
    _persistDisabled = reason;
    _persistStatus = status;
    derr(
      "persistence disabled for this session (" +
        reason +
        "); settings are kept in memory so no other mod's data is overwritten."
    );
  }
  return { root: {}, safe: false };
}
/**
 * Read the shared `modSettings` blob in preparation for a WRITE, with a hard
 * guarantee that we never destroy sibling mods' slices. Coherent can hand back
 * a transient empty read and another mod can leave non-JSON, so an empty first
 * read is re-read once, a present-but-unparseable value refuses the write, and
 * only a value empty both times yields a fresh `{}`.
 * @returns {{root: SettingsRoot, safe: boolean}} The current root and whether a
 *   write may proceed. When `safe` is false the caller must not persist.
 */
function readRootForWrite() {
  if (!hasLocalStorage()) return { root: {}, safe: false };
  if (_persistDisabled) return { root: {}, safe: false };
  const raw = readRawForWrite();
  if (raw === READ_THREW) return disablePersistence("localStorage.getItem threw");
  // An empty read of a populated store that cannot be enumerated is the same flaky read twice over.
  if (!raw && !emptyReadIsAbsentKey()) return disablePersistence("empty read of a populated store");
  if (!raw) return { root: {}, safe: true }; // genuinely first-run / empty store
  const parsed = parseRootForWrite(raw);
  if (parsed === null) return { root: {}, safe: false };
  // The read may be some other mod's blob rather than the settings root (see
  // looksLikeSettingsRoot). Writing it back would copy that blob into the shared
  // key, so refuse to persist this session instead.
  if (!looksLikeSettingsRoot(parsed)) {
    if (!_foreignRootWarned) {
      _foreignRootWarned = true;
      derr(
        "read of '" +
          ROOT_KEY +
          "' returned a value that is not a settings root (Coherent's getItem " +
          "returns the first key in the store, not the key requested); skipping " +
          "persistence this session rather than copying it back. Using in-memory values."
      );
    }
    return disablePersistence("shared root belongs to another mod", "foreign");
  }
  return { root: /** @type {SettingsRoot} */ (parsed), safe: true };
}

/**
 * The raw shared root for a write: read twice, because Coherent returns a transient empty value
 * now and then and a populated second read proves the first was flaky.
 * @returns {string|null|typeof READ_THREW} Raw value, null when empty both times, READ_THREW on throw.
 */
function readRawForWrite() {
  let raw = readRawRoot();
  if (!raw) raw = readRawRoot();
  return raw;
}

/**
 * Parse the raw shared root for a write; a value that is present but unusable disables persistence
 * for the session, because overwriting it would destroy other mods' settings.
 * @param {string} raw The raw value.
 * @returns {*|null} The parsed object, or null when persistence was refused.
 */
function parseRootForWrite(raw) {
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (_e) {
    // Siblings are present but unparseable — overwriting would destroy them.
    if (!_clobberGuardWarned) {
      _clobberGuardWarned = true;
      derr(
        "shared '" +
          ROOT_KEY +
          "' is present but not valid JSON; skipping persistence this session so " +
          "another mod's settings are never overwritten. Using in-memory values."
      );
    }
    disablePersistence("shared root is not valid JSON", "unparseable");
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    disablePersistence("shared root is not an object", "unparseable");
    return null;
  }
  return parsed;
}

let _integrityWarned = false;
/**
 * One-time heads-up if our persisted slice came back missing while other mods'
 * keys are present, malformed, or stamped with a different schema version.
 * Informational only: the in-memory bucket serves reads regardless.
 * @param {SettingsRoot} root The parsed modSettings root.
 */
function checkSliceIntegrity(root) {
  if (_integrityWarned) return;
  const slice = root[MOD_ID];
  const otherKeys = Object.keys(root).filter((k) => k !== MOD_ID).length;
  let problem = null;
  if (slice === undefined || slice === null) {
    if (otherKeys > 0) {
      problem =
        "missing while other mods' settings are present (a sibling mod may have " +
        "overwritten the shared modSettings key)";
    }
  } else if (typeof slice !== "object" || Array.isArray(slice)) {
    problem = "malformed (not an object)";
  } else if (typeof slice[SCHEMA_KEY] === "number" && slice[SCHEMA_KEY] > SCHEMA_VERSION) {
    _integrityWarned = true;
    console.warn(
      "[Demographics.settings] Persisted settings slice is from schema v" +
        slice[SCHEMA_KEY] +
        " (this build is v" +
        SCHEMA_VERSION +
        "); known keys are used, the stamp is kept for the newer build."
    );
    return;
  }
  if (problem) {
    _integrityWarned = true;
    console.warn(
      "[Demographics.settings] Persisted settings slice " +
        problem +
        "; falling back to defaults / in-memory values for this session."
    );
  }
}

// The ModOptions ecosystem treats "more than one top-level localStorage key" as
// corruption and WIPES the whole store, so any demographics-owned stray
// top-level key is purged on load (a restored save/backup could reintroduce one).
const STRAY_KEY_RE = /^_*demographics[_-]/i;
/**
 * Remove demographics-owned stray top-level localStorage keys (anything matching
 * {@link STRAY_KEY_RE} other than the shared `modSettings` root). Defensive: a
 * single bad key here breaks every ModOptions-based mod's load.
 * @returns {void}
 */
function purgeStrayTopLevelKeys() {
  if (!hasLocalStorage()) return;
  safeCall(() => {
    /** @type {string[]} */
    const stray = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (typeof k === "string" && k !== ROOT_KEY && STRAY_KEY_RE.test(k)) stray.push(k);
    }
    for (const k of stray) {
      localStorage.removeItem(k);
      derr("purged stray demographics localStorage key: " + k);
    }
  });
}

// Seed the memory bucket from localStorage ONCE at module load. After that,
// memoryBucket is the authoritative store: Coherent's localStorage does not
// round-trip reliably in this UI context.
/** @returns {void} */ (function _seedMemoryFromStorage() {
  try {
    purgeStrayTopLevelKeys();
    const root = readRoot();
    if (!root) return;
    checkSliceIntegrity(root);
    if (root[MOD_ID] && typeof root[MOD_ID] === "object" && !Array.isArray(root[MOD_ID])) {
      const normalized = normalizeSlice(/** @type {SettingsBucket} */ (root[MOD_ID]));
      Object.assign(memoryBucket, normalized);
      delete memoryBucket[SCHEMA_KEY]; // keep the schema marker out of the settings keyspace
    }
  } catch (e) {
    derr("_seedMemoryFromStorage:", e);
  }
})();

/**
 * Singleton accessor for the mod's namespaced settings slice. Reads are served
 * from an authoritative in-memory bucket; writes are mirrored best-effort to
 * `localStorage.modSettings.demographics` so they survive a session reload.
 * @type {{
 *   getSettings(): SettingsBucket,
 *   getSetting(key: string, dflt?: *): *,
 *   setSetting(key: string, value: *): void,
 *   setSettings(entries: Record<string, *>): void,
 *   sliceForStore(): {id: string, slice: SettingsBucket},
 *   persistenceStatus(): PersistStatus,
 *   resetPersistenceStatus(): void
 * }}
 */
export const DemographicsSettings = {
  /**
   * The full effective settings slice (defaults overlaid with stored values).
   * @returns {SettingsBucket} A fresh merged copy.
   */
  getSettings() {
    // Authoritative source = memoryBucket. localStorage merely tries to
    // survive a session reload - it does NOT round-trip reliably.
    return { ...DEFAULTS, ...memoryBucket };
  },
  /**
   * Read one setting by key, falling back to `dflt` then the baked default.
   * @param {string} key Setting key.
   * @param {*} [dflt] Caller-supplied fallback when the key is absent.
   * @returns {*} The setting value.
   */
  getSetting(key, dflt) {
    const s = this.getSettings();
    return key in s ? s[key] : dflt !== undefined ? dflt : DEFAULTS[key];
  },
  /**
   * Set one setting, updating the in-memory bucket and best-effort persisting.
   * @param {string} key Setting key.
   * @param {*} value New value.
   */
  setSetting(key, value) {
    this.setSettings({ [key]: value });
  },
  /**
   * Set several settings in ONE shared-store read+write, so per-turn batch
   * writers parse + stringify the `modSettings` blob once per turn instead of
   * once per key. Behaves like {@link setSetting} otherwise.
   * @param {Record<string, *>} entries Key→value map to apply.
   */
  setSettings(entries) {
    if (!entries || typeof entries !== "object") return;
    Object.assign(memoryBucket, entries);
    // Best-effort persistence so settings survive a fresh load. If
    // Coherent wipes the key during this session, the in-memory bucket
    // still serves correct reads.
    if (hasLocalStorage()) {
      // Read the FULL shared blob through the clobber guard: it preserves every
      // sibling mod's slice and refuses to write when the current value can't be
      // safely round-tripped, so we can only ever add/update our OWN slice.
      const { root, safe } = readRootForWrite();
      if (safe) {
        // Merge our stored slice with the new entries; sliceToPersist keeps only real overrides.
        const cur = root[MOD_ID];
        const base = cur && typeof cur === "object" && !Array.isArray(cur) ? cur : {};
        root[MOD_ID] = sliceToPersist({ ...base, ...entries });
        writeRoot(root);
      }
    }
    dlog("setSettings", Object.keys(entries).join(","));
  },
  /**
   * This mod's slice as it would be stored, for a caller that is writing the shared root itself.
   * The storage repair uses it: after the store is emptied, the session's settings are written back
   * from the authoritative in-memory bucket rather than from the unreadable store.
   * @returns {{id: string, slice: SettingsBucket}} Slice id and contents.
   */
  sliceForStore() {
    return { id: MOD_ID, slice: sliceToPersist({ ...memoryBucket }) };
  },
  /**
   * Whether settings changed this session are reaching storage, and why not when they are not.
   * "ok" until a write is refused or fails read-back; the Options footer shows the rest.
   * @returns {PersistStatus} The status.
   */
  persistenceStatus() {
    if (!hasLocalStorage()) return "unavailable";
    return _persistStatus;
  },
  /**
   * Clear the session's persistence block (the storage repair rewrote the store, so the reason is
   * gone). Only the repair should call this.
   * @returns {void}
   */
  resetPersistenceStatus() {
    _persistDisabled = null;
    _persistStatus = "ok";
  }
};

dlog("settings module loaded; hasLocalStorage=", hasLocalStorage());
export default DemographicsSettings;
