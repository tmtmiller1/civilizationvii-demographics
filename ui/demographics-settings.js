// demographics-settings.js
//
// Mod settings, namespaced under localStorage.modSettings.demographics.
//
// Follows the ModSettingsSingleton convention from corpus mod 3666485798
// (wonders-screen-continued/code/mod-options-decorator.js, around lines
// 28–55). Hard invariant: only ever write the "modSettings" top-level
// key. Sibling keys break localStorage reads for every mod.
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

const DBG = true;
/**
 * Debug logger, no-op unless {@link DBG} is set.
 * @param {...*} a Values to log.
 * @returns {void}
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.settings]", ...a);
}
/**
 * Error logger; always emits.
 * @param {...*} a Values to log.
 * @returns {void}
 */
function derr(...a) {
  console.error("[Demographics.settings]", ...a);
}

const MOD_ID = "demographics";
const ROOT_KEY = "modSettings";

/** @type {SettingsBucket} */
const DEFAULTS = {
  activeMetric: "score",
  hiddenCivs: [], // array of leaderType strings
  // ─── Accessibility ─────────────────────────────────────────────────
  colorblindMode: false, // swap mod-owned colors to a CVD-safe palette
  // ─── Adaptive history storage cap (see Enhancements.md) ───
  // Overrides the max samples we keep before decimating older history.
  // "auto" = derive from Game.gameSpeed; numeric value overrides;
  // -1 = unlimited (never drops samples — power-user only).
  sampleCapOverride: "auto",
  // When true, the per-Nth decimation pass is skipped entirely — useful
  // for power users who want every single turn preserved. Pairs with a
  // generous (or unlimited) `sampleCapOverride` for the full-history
  // experience.
  disableDecimation: false,
  // ─── Polling rate ──────────────────────────────────────────────────
  // How often the sampler records a snapshot, measured in TURNS between
  // captures. 1 = every turn (default, finest detail). Higher values
  // trade chart resolution for smaller storage footprint and less work
  // each turn-end — useful on slow machines or marathon-speed games.
  sampleEveryNTurns: 1,
  // ─── Wonder markers ─────────────────────────────────────────────────
  // Overlay a tiny wonder icon on each civ's line at every turn that
  // civ's wonders count incremented. Toggle from the Options tab.
  showWonderMarkers: true
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

/**
 * Read and parse the top-level `modSettings` blob from storage.
 * @returns {SettingsRoot|null} The parsed root, `{}` on parse failure, or
 *   `null` when storage is unavailable.
 */
function readRoot() {
  if (!hasLocalStorage()) return null;
  return safeCall(() => {
    const raw = localStorage.getItem(ROOT_KEY);
    return raw ? JSON.parse(raw) : {};
  }, {});
}

/**
 * Persist the top-level `modSettings` blob. No-op when storage is unavailable.
 * @param {SettingsRoot} root The full root blob to serialize.
 * @returns {void}
 */
function writeRoot(root) {
  if (!hasLocalStorage()) return;
  safeCall(() => {
    // We only write our own key ("modSettings"). DO NOT wipe other
    // top-level keys — earlier versions did, which destroyed our own
    // data when Civ7 / other UI code wrote its own keys between our
    // setSetting calls (every other checkbox toggle would silently
    // reset back to default).
    localStorage.setItem(ROOT_KEY, JSON.stringify(root));
  });
}

/**
 * Migrate settings from the legacy `infoAddict` slice to `demographics` when
 * the user has old data but no new data yet. Mutates and re-persists `root`.
 * @param {SettingsRoot} root The parsed root blob to migrate in place.
 * @returns {void}
 */
function migrateLegacySlice(root) {
  // Backward-compat: this mod's persistence key was renamed from
  // "infoAddict" to "demographics". If the user has data under the
  // old key but nothing under the new one yet, copy it across so
  // history, settings, and war records carry over silently.
  const LEGACY_KEY = "infoAddict";
  if (
    root[LEGACY_KEY] &&
    typeof root[LEGACY_KEY] === "object" &&
    (!root[MOD_ID] || typeof root[MOD_ID] !== "object" || Object.keys(root[MOD_ID]).length === 0)
  ) {
    root[MOD_ID] = root[LEGACY_KEY];
    try {
      writeRoot(root);
    } catch (_) {
      /* */
    }
    dlog("migrated legacy settings from modSettings.infoAddict → modSettings.demographics");
  }
}

// Seed the memory bucket from localStorage ONCE at module load (when the
// storage is actually populated). After that, memoryBucket is the
// authoritative store — Coherent's localStorage gets wiped between reads
// in this UI context, so trusting round-trips through it loses settings
// every time a checkbox is toggled.
/** @returns {void} */ (function _seedMemoryFromStorage() {
  try {
    const root = readRoot();
    if (!root) return;
    migrateLegacySlice(root);
    if (root[MOD_ID] && typeof root[MOD_ID] === "object") {
      Object.assign(memoryBucket, root[MOD_ID]);
    }
  } catch (_) {
    /* */
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
    // survive a session reload — it does NOT round-trip reliably.
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
   * @returns {void}
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
      root[MOD_ID] = slice;
      writeRoot(root);
    }
    dlog("setSetting", key, "=", value);
  }
};

dlog("settings module loaded; hasLocalStorage=", hasLocalStorage());
export default DemographicsSettings;
