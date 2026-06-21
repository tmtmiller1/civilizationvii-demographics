// demographics-settings.js
//
// Mod settings, namespaced under localStorage.modSettings.demographics.
//
// Follows the ModSettingsSingleton convention from corpus mod 3666485798
// (wonders-screen-continued/code/mod-options-decorator.js, around lines
// 28–55). Hard invariant: only ever write the SINGLE "modSettings" top-level
// key, and never add a dedicated/sibling key.
//
// Why a dedicated key is NOT an option: many popular mods (3640416186,
// 3507072814, 3506956202, 3666485798, 3548476215, 3684206095, …) ship active
// load-time code of the form:
//     if (localStorage.length > 1) { localStorage.clear(); }
// i.e. if more than ONE top-level key exists they wipe ALL of localStorage.
// So writing a second key here would make localStorage.length === 2 and cause
// the next such mod to load to erase every mod's settings, ours included. The
// shared "modSettings" blob (keyed by mod id) is the only safe surface; treat
// the in-memory bucket as authoritative and persist best-effort.
//
// API:
//   DemographicsSettings.getSettings()           → the mod's slice
//   DemographicsSettings.getSetting(key, dflt)   → any
//   DemographicsSettings.setSetting(key, value)  → also persists
//
// Falls back to an in-memory object if localStorage is unavailable
// (sandboxed UI context); the session remains functional but settings
// don't survive a reload.

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
 * @property {boolean} [showWarMarkers] Overlay war/disaster onset markers on the Emigration refugees chart.
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

// NOTE: DEFAULTS is NOT an exhaustive schema. It seeds the in-memory bucket and
// backs `getSettings()`, but the authoritative default for any setting is the
// fallback passed at the call site - `getSetting(key, dflt)`. Many settings
// (per-view state: active tab/page/metric, viewer pids, time filters, etc.) are
// intentionally absent here and resolved by their call sites. Add a key here
// only when you want it in the baseline bucket; otherwise the call-site default
// is sufficient and authoritative.
/** @type {SettingsBucket} */
const DEFAULTS = {
  activeMetric: "score",
  hiddenCivs: [], // array of leaderType strings
  // ─── Accessibility ─────────────────────────────────────────────────
  colorblindMode: false, // swap mod-owned colors to a CVD-safe palette
  // ─── Adaptive history storage cap (see Enhancements.md) ───
  // Overrides the max samples we keep before decimating older history.
  // "auto" = derive from Game.gameSpeed; numeric value overrides;
  // -1 = unlimited (never drops samples - power-user only).
  sampleCapOverride: "auto",
  // When true, the per-Nth decimation pass is skipped entirely - useful
  // for power users who want every single turn preserved. Pairs with a
  // generous (or unlimited) `sampleCapOverride` for the full-history
  // experience.
  disableDecimation: false,
  // ─── Polling rate ──────────────────────────────────────────────────
  // How often the sampler records a snapshot, measured in TURNS between
  // captures. 1 = every turn (default, finest detail). Higher values
  // trade chart resolution for smaller storage footprint and less work
  // each turn-end - useful on slow machines or marathon-speed games.
  sampleEveryNTurns: 1,
  // ─── Wonder markers ─────────────────────────────────────────────────
  // Overlay a tiny wonder icon on each civ's line at every turn that
  // civ's wonders count incremented. Toggle from the Options tab.
  showWonderMarkers: true,
  // ─── War / disaster markers (Emigration refugees chart) ─────────────
  // Overlay each war + notable disaster onset on the Emigration refugees
  // graph's timeline. Toggle from the Options tab, like wonder markers.
  showWarMarkers: true,
  // ─── Spoiler guard ─────────────────────────────────────────────────
  // When true (default), diplomacy / influence / relations figures are
  // withheld for civilizations the local player has not met (the charts
  // show a gap, not a value). Turn off to record and show those too.
  hideUnmetStats: true,
  // ─── Analytics-visibility governance (combined design plan P0.1) ─────
  // The local player's preferred analytics policy. A multiplayer HOST can cap
  // this via a GameConfiguration ceiling (see demographics-governance.js); the
  // effective policy is the more restrictive of the two. When unset, it derives
  // from the legacy hideUnmetStats toggle. One of: "disabled", "own-civ-only",
  // "met-civs-only", "full".
  analyticsPolicy: "met-civs-only",
  // ─── UI complexity tier (combined design plan P1.5) ────────────────
  // Progressive-disclosure profile: "basic" (core stat pages only),
  // "standard" (all pages/tabs; advanced tuning hidden ; default), or
  // "analyst" (everything, including storage/sampling controls).
  uiComplexity: "standard",
  // ─── Met-history reveal mode (sub-option of hideUnmetStats) ─────────
  // Controls what the line chart shows for a civ AFTER you meet it, when
  // hideUnmetStats is on:
  //   true  (default): back-fill - reveal the civ's ENTIRE history once met
  //                    (matches the radar / worldrankings-allcivs current-state views).
  //   false:           reveal only data from the moment of first contact
  //                    forward; pre-contact history stays hidden.
  // Ignored when hideUnmetStats is off (everything shows regardless).
  backfillMetHistory: true
};

// ─── Settings schema + load-time validation/migration ──────────────────────
// SCHEMA declares the type (and clamp range) for each KNOWN setting so a
// malformed persisted value (wrong type, out-of-range, or garbage left in the
// shared modSettings key by another mod) is repaired to its default on load
// rather than poisoning the session. Keys absent from SCHEMA (per-view state,
// forward-compat writes) pass through untouched.
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
 * Read and parse the top-level `modSettings` blob from storage.
 *
 * `modSettings` is a SHARED localStorage key - other mods and the engine write
 * to it too, and can leave a value that isn't valid JSON (or Coherent can hand
 * back a wiped/garbage read). Our settings are served from the authoritative
 * in-memory bucket, so a failed parse here is harmless. We warn at most ONCE per
 * session instead of letting the generic `safeCall` log on every `setSetting`,
 * which previously spammed the log on every checkbox toggle.
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
  safeCall(() => {
    // We only write our own key ("modSettings"). DO NOT wipe other
    // top-level keys - earlier versions did, which destroyed our own
    // data when Civ7 / other UI code wrote its own keys between our
    // setSetting calls (every other checkbox toggle would silently
    // reset back to default).
    localStorage.setItem(ROOT_KEY, JSON.stringify(root));
  });
}

let _integrityWarned = false;
/**
 * One-time heads-up if our persisted slice came back missing while OTHER mods'
 * keys are present in the shared `modSettings` blob (a sibling may have
 * overwritten the whole key), or malformed, or stamped with a different schema
 * version. localStorage is only authoritative at load here - the in-memory
 * bucket serves reads regardless - so this is informational, not a failure.
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
  } else if (typeof slice !== "object") {
    problem = "malformed (not an object)";
  } else if (slice[SCHEMA_KEY] !== undefined && slice[SCHEMA_KEY] !== SCHEMA_VERSION) {
    problem = "from schema v" + slice[SCHEMA_KEY] + " (expected v" + SCHEMA_VERSION + ")";
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

// localStorage is SHARED across every Civ VII mod, and the ModOptions ecosystem
// treats "more than one top-level key" (or any non-JSON value) as corruption and
// WIPES the whole store - taking every other mod's settings with it. An older
// experimental demographics build left stray top-level keys behind
// (demographics_history_v4, __demographics_sentinel_*, __demographics_freeze_test__);
// current code persists history via the Tutorial bag and only ever writes the
// shared `modSettings` key. This purge removes any such demographics-owned stray
// key on load so a restored save/backup can never re-poison the shared store.
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

// Seed the memory bucket from localStorage ONCE at module load (when the
// storage is actually populated). After that, memoryBucket is the
// authoritative store - Coherent's localStorage gets wiped between reads
// in this UI context, so trusting round-trips through it loses settings
// every time a checkbox is toggled.
/** @returns {void} */ (function _seedMemoryFromStorage() {
  try {
    purgeStrayTopLevelKeys();
    const root = readRoot();
    if (!root) return;
    checkSliceIntegrity(root);
    if (root[MOD_ID] && typeof root[MOD_ID] === "object") {
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
 *   setSettings(entries: Record<string, *>): void
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
   * Set several settings in ONE shared-store read+write. The per-turn aux
   * recorders (settlement/town traces) batch their writes through this so the
   * whole `modSettings` blob is parsed + stringified once per turn instead of
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
      const root = readRoot() || {};
      const slice = normalizeSlice({ ...DEFAULTS, ...(root[MOD_ID] || {}) });
      Object.assign(slice, entries);
      slice[SCHEMA_KEY] = SCHEMA_VERSION;
      root[MOD_ID] = slice;
      writeRoot(root);
    }
    dlog("setSettings", Object.keys(entries).join(","));
  }
};

dlog("settings module loaded; hasLocalStorage=", hasLocalStorage());
export default DemographicsSettings;
