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

const DBG = true;
function dlog(...a) {
  if (DBG) console.warn("[Demographics.settings]", ...a);
}
function derr(...a) {
  console.error("[Demographics.settings]", ...a);
}

const MOD_ID = "demographics";
const ROOT_KEY = "modSettings";

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

function safeCall(fn, fallback) {
  try {
    return fn();
  } catch (e) {
    derr("safeCall:", e);
    return fallback;
  }
}

function hasLocalStorage() {
  return safeCall(() => typeof localStorage !== "undefined" && localStorage !== null, false);
}

// In-memory fallback bucket.
let memoryBucket = { ...DEFAULTS };

function readRoot() {
  if (!hasLocalStorage()) return null;
  return safeCall(() => {
    const raw = localStorage.getItem(ROOT_KEY);
    return raw ? JSON.parse(raw) : {};
  }, {});
}

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

// Seed the memory bucket from localStorage ONCE at module load (when the
// storage is actually populated). After that, memoryBucket is the
// authoritative store — Coherent's localStorage gets wiped between reads
// in this UI context, so trusting round-trips through it loses settings
// every time a checkbox is toggled.
(function _seedMemoryFromStorage() {
  try {
    const root = readRoot();
    if (!root) return;
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
    if (root[MOD_ID] && typeof root[MOD_ID] === "object") {
      Object.assign(memoryBucket, root[MOD_ID]);
    }
  } catch (_) {
    /* */
  }
})();

export const DemographicsSettings = {
  getSettings() {
    // Authoritative source = memoryBucket. localStorage merely tries to
    // survive a session reload — it does NOT round-trip reliably.
    return { ...DEFAULTS, ...memoryBucket };
  },
  getSetting(key, dflt) {
    const s = this.getSettings();
    return key in s ? s[key] : dflt !== undefined ? dflt : DEFAULTS[key];
  },
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
