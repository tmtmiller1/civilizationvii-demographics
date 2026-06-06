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
  // ─── Spoiler guard ─────────────────────────────────────────────────
  // When true (default), diplomacy / influence / relations figures are
  // withheld for civilizations the local player has not met (the charts
  // show a gap, not a value). Turn off to record and show those too.
  hideUnmetStats: true,
  // ─── Met-history reveal mode (sub-option of hideUnmetStats) ─────────
  // Controls what the line chart shows for a civ AFTER you meet it, when
  // hideUnmetStats is on:
  //   true  (default): back-fill - reveal the civ's ENTIRE history once met
  //                    (matches the radar / factbook current-state views).
  //   false:           reveal only data from the moment of first contact
  //                    forward; pre-contact history stays hidden.
  // Ignored when hideUnmetStats is off (everything shows regardless).
  backfillMetHistory: true
};

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
 * `modSettings` is a SHARED localStorage key — other mods and the engine write
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

// Seed the memory bucket from localStorage ONCE at module load (when the
// storage is actually populated). After that, memoryBucket is the
// authoritative store - Coherent's localStorage gets wiped between reads
// in this UI context, so trusting round-trips through it loses settings
// every time a checkbox is toggled.
/** @returns {void} */ (function _seedMemoryFromStorage() {
  try {
    const root = readRoot();
    if (!root) return;
    checkSliceIntegrity(root);
    if (root[MOD_ID] && typeof root[MOD_ID] === "object") {
      Object.assign(memoryBucket, root[MOD_ID]);
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
 *   setSetting(key: string, value: *): void
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
    memoryBucket[key] = value;
    // Best-effort persistence so settings survive a fresh load. If
    // Coherent wipes the key during this session, the in-memory bucket
    // still serves correct reads.
    if (hasLocalStorage()) {
      const root = readRoot() || {};
      const slice = { ...DEFAULTS, ...(root[MOD_ID] || {}) };
      slice[key] = value;
      slice[SCHEMA_KEY] = SCHEMA_VERSION;
      root[MOD_ID] = slice;
      writeRoot(root);
    }
    dlog("setSetting", key, "=", value);
  }
};

dlog("settings module loaded; hasLocalStorage=", hasLocalStorage());
export default DemographicsSettings;
