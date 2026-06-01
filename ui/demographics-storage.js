// demographics-storage.js
//
// Per-turn history time-series storage for the Demographics screen.
//
// IMPORTANT — cross-age persistence does NOT work in current builds.
// Empirical testing shows the per-player Tutorial property bag does not carry
// our payload across an age transition (the JS module heap is also reloaded at
// the boundary). Treat history as scoped to a single age/session. The backend
// is retained because it DOES survive within an age and across in-session UI
// reloads, and as a forward-compat hook if a future build carries per-player
// UI state across the age save.
//
// Backend: the per-local-player Tutorial property bag — the same surface the
// engine uses internally for legacy/triumph and civ-unlock tracking. We write
// only our own hashed sub-keys. The GLOBAL GameTutorial bag is wiped at age
// transition, so we prefer Players[localObserverID].Tutorial.setProperty,
// which at least persists within the current age/session.
//
// Persistence mode (see PERSISTENCE_MODE / the "persistenceMode" setting):
//   "within_age"          (default) — persist within the age/session only.
//   "legacy_tutorial_bag" (opt-in)  — additionally register the
//                          BeforeAgeTransition flush that attempts the cross-age
//                          carry-forward. Kept for power users / future builds;
//                          it does NOT preserve history across ages today.
//
// Flush hooks:
//   BeforeUnload         — UI module reload; covers in-session age boundaries
//                          and quit-to-menu (always installed).
//   BeforeAgeTransition  — only in "legacy_tutorial_bag" mode.

import { DemographicsSettings } from "/demographics/ui/demographics-settings.js";

// The shared global {History} typedef merges with the DOM lib's `History`
// interface (both are declared in global scope), which makes it unusable as a
// structural annotation here. Alias the same shape under a local name. Field
// shapes mirror the {History} interface in types/demographics.d.ts exactly.
/**
 * @typedef {object} StoredHistory
 * @property {number} version Persisted schema version.
 * @property {string | number} seed Game seed.
 * @property {Snapshot[]} samples Per-turn samples.
 * @property {AgeBoundary[]} ageBoundaries Age hand-off markers.
 * @property {Record<string, any>} eliminated Elimination bookkeeping.
 */

const DBG = false;
/**
 * Debug logger, no-op unless {@link DBG} is set.
 * @param {...*} a Values to log.
 * @returns {void}
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.storage]", ...a);
}
/**
 * Error logger; always emits.
 * @param {...*} a Values to log.
 * @returns {void}
 */
function derr(...a) {
  console.error("[Demographics.storage]", ...a);
}
/**
 * Run `fn`, returning its result, or `fallback` if it throws. Never throws.
 * @template T
 * @param {() => T} fn Thunk to invoke.
 * @param {T} fallback Value returned if `fn` throws.
 * @returns {T} The result of `fn`, or `fallback` on error.
 */
function safeCall(fn, fallback) {
  try {
    return fn();
  } catch (e) {
    derr("safeCall:", e);
    return fallback;
  }
}

// ── Schema ──────────────────────────────────────────────────────────
/** Persisted history schema version. */
const VERSION = 1;
/** Absolute ceiling on retained samples, regardless of user override. */
const HARD_MAX_SAMPLES = 50000;
// Catalog scope + object/key names. Stable across all ages.
/** Hashing scope prefix; stable across all ages. */
const CATALOG_SCOPE = "demographics-history-v1";
/** Property-bag key under which the JSON payload is stored. */
const PAYLOAD_KEY = "json";
/**
 * Default persistence mode. `within_age` persists within a single age/session
 * (the honest default — cross-age carry-forward does not work in current
 * builds). `legacy_tutorial_bag` additionally registers the BeforeAgeTransition
 * flush; opt in via the `persistenceMode` setting.
 */
const PERSISTENCE_MODE = "within_age";
/**
 * Resolve the active persistence mode from settings, defaulting to
 * {@link PERSISTENCE_MODE}.
 * @returns {string} `"within_age"` or `"legacy_tutorial_bag"`.
 */
function activePersistenceMode() {
  return safeCall(
    () => DemographicsSettings.getSetting("persistenceMode", PERSISTENCE_MODE),
    PERSISTENCE_MODE
  );
}

// ── Sample cap config (preserved from prior implementation) ─────────
/** @type {Record<string, number>} */
const ADAPTIVE_DEFAULTS_BY_SPEED = {
  GAMESPEED_QUICK: 500,
  GAMESPEED_STANDARD: 2000,
  GAMESPEED_EPIC: 3000,
  GAMESPEED_MARATHON: 5000
};
/** Sample cap used when the game speed can't be detected. */
const FALLBACK_DEFAULT = 2000;

/**
 * Resolve a game-speed type string from a `Game.gameSpeed` hash via the
 * `GameInfo.GameSpeeds` lookup table.
 * @param {*} hash The `Game.gameSpeed` hash value.
 * @returns {string | null} The speed type string, or null.
 */
function gameSpeedTypeFromHash(hash) {
  if (
    hash !== undefined &&
    hash !== null &&
    typeof GameInfo !== "undefined" &&
    GameInfo.GameSpeeds &&
    typeof GameInfo.GameSpeeds.lookup === "function"
  ) {
    const row = GameInfo.GameSpeeds.lookup(hash);
    if (row && typeof row.GameSpeedType === "string") return row.GameSpeedType;
  }
  return null;
}

/**
 * Read the active game-speed type string off the (loosely typed) engine
 * globals, trying the direct field/getter first and falling back to a
 * `GameInfo.GameSpeeds` hash lookup.
 * @returns {string | null} The speed type (e.g. `"GAMESPEED_EPIC"`), or null.
 */
function lookupGameSpeedType() {
  if (typeof Game === "undefined") return null;
  const candidate =
    Game.gameSpeedType ||
    (typeof Game.getGameSpeedType === "function" ? Game.getGameSpeedType() : null);
  if (typeof candidate === "string" && candidate.length > 0) return candidate;
  return gameSpeedTypeFromHash(Game.gameSpeed);
}

/**
 * Detect the active game-speed type, never throwing.
 * @returns {string | null} The speed type string, or null if unavailable.
 */
function detectGameSpeedType() {
  return safeCall(() => lookupGameSpeedType(), null);
}

/**
 * Read the raw `sampleCapOverride` setting, defaulting to `"auto"` on error.
 * @returns {number | string} The override value, or `"auto"`.
 */
function readSampleCapOverride() {
  try {
    return DemographicsSettings.getSetting("sampleCapOverride", "auto");
  } catch (e) {
    derr("readSampleCapOverride:", e);
    return "auto";
  }
}

/**
 * Interpret a numeric sample-cap override into an {@link EffectiveCap}.
 * @param {number} override A finite, non-zero override count.
 * @returns {EffectiveCap} The resolved cap and its source label.
 */
function capFromNumber(override) {
  if (override < 0) return { cap: Infinity, source: "user:unlimited" };
  return { cap: Math.min(override, HARD_MAX_SAMPLES), source: "user:" + override };
}

/**
 * Interpret a non-"auto" string sample-cap override into an {@link EffectiveCap}.
 * @param {string} override The raw string override.
 * @returns {EffectiveCap | null} The resolved cap, or null if not a valid number.
 */
function capFromString(override) {
  const parsed = parseInt(override, 10);
  if (isFinite(parsed) && parsed !== 0) {
    return capFromNumber(parsed);
  }
  return null;
}

/**
 * Resolve the adaptive (game-speed-derived) sample cap.
 * @returns {EffectiveCap} The resolved cap and its source label.
 */
function adaptiveCap() {
  const speed = detectGameSpeedType();
  const adaptive = (speed && ADAPTIVE_DEFAULTS_BY_SPEED[speed]) || FALLBACK_DEFAULT;
  return { cap: adaptive, source: "auto:" + (speed || "fallback") };
}

/**
 * Resolve the effective sample cap from the user override, falling back to the
 * adaptive per-game-speed default.
 * @returns {EffectiveCap} The resolved cap and its source label.
 */
function resolveEffectiveCap() {
  const override = readSampleCapOverride();
  if (typeof override === "number" && isFinite(override) && override !== 0) {
    return capFromNumber(override);
  }
  if (typeof override === "string" && override !== "auto") {
    const fromString = capFromString(override);
    if (fromString) return fromString;
  }
  return adaptiveCap();
}

/**
 * Whether the user has disabled sample decimation.
 * @returns {boolean}
 */
function decimationDisabled() {
  try {
    return !!DemographicsSettings.getSetting("disableDecimation", false);
  } catch (e) {
    derr("decimationDisabled:", e);
    return false;
  }
}

// ── Hashing (matches engine SerialBase.makeHash) ────────────────────
/**
 * FNV-1a 32-bit hash, used as a fallback when `Database.makeHash` is absent.
 * @param {string} str Input string.
 * @returns {number} 32-bit unsigned hash.
 */
function fnv1a(str) {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}
/**
 * Hash a key with the engine's `Database.makeHash`, falling back to {@link fnv1a}.
 * @param {string} s Input string.
 * @returns {number} 32-bit hash.
 */
function dbHash(s) {
  try {
    if (typeof Database !== "undefined" && typeof Database.makeHash === "function") {
      return Database.makeHash(s);
    }
  } catch (e) {
    derr("Database.makeHash threw:", e);
  }
  return fnv1a(s);
}

// ── History helpers ─────────────────────────────────────────────────
/**
 * Build an empty {@link History} stamped with the given seed.
 * @param {string | number} seed Game seed.
 * @returns {StoredHistory} A fresh, empty history.
 */
function emptyHistory(seed) {
  return {
    version: VERSION,
    seed: seed,
    samples: [],
    ageBoundaries: [],
    eliminated: {}
  };
}
/**
 * Whether a parsed value is a structurally valid {@link History}.
 * @param {*} h Candidate value.
 * @returns {boolean}
 */
function isValid(h) {
  return !!(h && typeof h === "object" && h.version === VERSION && Array.isArray(h.samples));
}
/**
 * Backfill optional {@link History} fields in place.
 * @param {StoredHistory | null | undefined} h History to normalize.
 * @returns {StoredHistory | null | undefined} The same value, normalized.
 */
function normalize(h) {
  if (!h) return h;
  if (!Array.isArray(h.ageBoundaries)) h.ageBoundaries = [];
  if (!h.eliminated || typeof h.eliminated !== "object") h.eliminated = {};
  return h;
}

// ── Per-player Tutorial accessor (the within-age persistence surface) ──
//
// Returns { read(key), write(key, val) } or null if the player isn't
// available yet. Re-resolves the player on every call: localObserverID
// can change at age transition while the post-transition shell is
// settling, and we don't want to cache a stale Player reference.
/**
 * Resolve the local player id, preferring the observer id, then the player id.
 * @returns {Pid} The local player id, or -1 if none is available.
 */
function resolveLocalPid() {
  return typeof GameContext.localObserverID !== "undefined" && GameContext.localObserverID >= 0
    ? GameContext.localObserverID
    : typeof GameContext.localPlayerID !== "undefined" && GameContext.localPlayerID >= 0
      ? GameContext.localPlayerID
      : -1;
}

/**
 * Resolve the per-player Tutorial property bag — the within-age persistence
 * tier (survives in-session reloads, not the age save). Re-resolves the player
 * on every call, since
 * `localObserverID` can change as a post-transition shell settles. Never throws.
 * @returns {PersistStore | null} A read/write handle, or null if unavailable.
 */
function getPlayerStore() {
  try {
    if (
      typeof GameContext === "undefined" ||
      typeof Players === "undefined" ||
      typeof Players.get !== "function"
    )
      return null;
    const pid = resolveLocalPid();
    if (pid < 0) return null;
    const p = Players.get(pid);
    if (
      !p ||
      !p.Tutorial ||
      typeof p.Tutorial.setProperty !== "function" ||
      typeof p.Tutorial.getProperty !== "function"
    )
      return null;
    return {
      pid: pid,
      read: (key) => p.Tutorial.getProperty(dbHash("_" + CATALOG_SCOPE + "__" + key)),
      write: (key, val) => p.Tutorial.setProperty(dbHash("_" + CATALOG_SCOPE + "__" + key), val)
    };
  } catch (e) {
    derr("getPlayerStore threw:", e);
    return null;
  }
}

// Fallback global tier — only used if the per-player store isn't yet
// available. Same hashing scheme as the per-player tier.
/**
 * Resolve the global `GameTutorial` property bag — the fallback tier used
 * before the per-player store is available. Same hashing scheme. Never throws.
 * @returns {PersistStore | null} A read/write handle, or null if unavailable.
 */
function getGlobalStore() {
  try {
    if (typeof GameTutorial === "undefined" || typeof GameTutorial.setProperty !== "function")
      return null;
    return {
      pid: -1,
      read: (key) => GameTutorial.getProperty(dbHash("_" + CATALOG_SCOPE + "__" + key)),
      write: (key, val) => GameTutorial.setProperty(dbHash("_" + CATALOG_SCOPE + "__" + key), val)
    };
  } catch (_) {
    // GameTutorial global can be absent / throw in the sandbox; report no global
    // store so the caller falls back accordingly.
    return null;
  }
}

// ── Storage singleton ───────────────────────────────────────────────
/**
 * History time-series storage, backed by the per-player Tutorial property bag
 * (with the global bag as a fallback tier). Persistence is within-age only;
 * see the file header.
 */
class StorageImpl {
  constructor() {
    /** @type {StoredHistory | null} In-memory mirror of the latest history. */
    this._mem = null;
    /** @type {string | number} Game seed used to stamp fresh histories. */
    this._seed = "unknown";
    /** @type {boolean} Whether {@link StorageImpl#_init} has run. */
    this._initialized = false;
    /** @type {boolean} Whether engine flush hooks are installed. */
    this._hooksInstalled = false;
    /** @type {boolean} Whether the one-time decimation notice has fired. */
    this._decimationNotified = false;
    /** @type {number} Turn at which decimation first kicked in (-1 if never). */
    this._decimationTurn = -1;
  }

  /**
   * Lazily resolve the game seed and install engine flush hooks. Idempotent.
   * @returns {void}
   */
  _init() {
    if (this._initialized) return;
    try {
      if (typeof Configuration !== "undefined" && typeof Configuration.getGame === "function") {
        const g = Configuration.getGame();
        const s = g && (g.startSeed ?? g.gameSeed ?? g.mapSeed);
        if (s !== undefined && s !== null) this._seed = s;
      }
    } catch (e) {
      derr("seed lookup threw:", e);
    }
    this._initialized = true;
    this._installEngineHooks();
    dlog("init: seed=", this._seed, "scope=", CATALOG_SCOPE);
  }

  /**
   * Install one-time flush hooks. `BeforeUnload` is always installed (covers
   * in-session age boundaries and quit-to-menu). `BeforeAgeTransition` — the
   * cross-age carry-forward attempt, which does not work in current builds — is
   * installed only in `legacy_tutorial_bag` mode. Idempotent.
   * @returns {void}
   */
  _installEngineHooks() {
    if (this._hooksInstalled) return;
    if (typeof engine === "undefined" || typeof engine.on !== "function") return;
    this._hooksInstalled = true;
    /** @returns {void} */
    const flush = () => {
      try {
        if (this._mem) {
          dlog("flush: samples=" + this._mem.samples.length);
          this.save(this._mem);
        }
      } catch (e) {
        derr("flush hook threw:", e);
      }
    };
    if (activePersistenceMode() === "legacy_tutorial_bag") {
      try {
        engine.on("BeforeAgeTransition", flush);
      } catch (_) {
        // engine.on() can throw if the event name is unknown in this build; the
        // BeforeUnload hook below still covers most flush cases.
      }
    }
    try {
      engine.on("BeforeUnload", flush);
    } catch (_) {
      // engine.on() can throw if the event name is unknown in this build; rely
      // on per-turn saves if neither flush hook installs.
    }
  }

  /**
   * Pick the best available persistence tier (per-player, else global).
   * @returns {PersistStore | null}
   */
  _pickStore() {
    return getPlayerStore() || getGlobalStore();
  }

  /**
   * Read the raw payload string from a store, swallowing read errors.
   * @param {PersistStore} store Store to read from.
   * @returns {string | null} The raw payload, or null on error/empty.
   */
  _readRaw(store) {
    try {
      return store.read(PAYLOAD_KEY);
    } catch (e) {
      derr("store.read threw:", e);
      return null;
    }
  }

  /**
   * Handle the empty-persistent-tier case: recover from `_mem` if it holds
   * data (re-stamping it under the now-writable bag), else return an empty shell.
   * @param {PersistStore} store The (empty) store to recover into.
   * @returns {StoredHistory} The recovered or freshly empty history.
   */
  _loadEmpty(store) {
    // Cross-age recovery: if persistent tier is empty but our
    // in-memory mirror has data, treat _mem as truth and
    // re-stamp it under the (now writable) player bag.
    if (this._mem && this._mem.samples && this._mem.samples.length > 0) {
      dlog(
        "load: persistent empty, recovering from _mem (samples=" +
          this._mem.samples.length +
          " pid=" +
          store.pid +
          ")"
      );
      try {
        store.write(PAYLOAD_KEY, JSON.stringify(this._mem));
      } catch (e) {
        derr("_loadEmpty: recovery store.write threw:", e);
      }
      return this._mem;
    }
    dlog("load: no existing history (pid=" + store.pid + ")");
    return emptyHistory(this._seed);
  }

  /**
   * Parse and validate a raw payload, reconciling it against `_mem`.
   * @param {string} raw Raw payload string.
   * @param {PersistStore} store Store the payload came from.
   * @returns {StoredHistory} The reconciled history.
   */
  _loadParsed(raw, store) {
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      derr("load: JSON parse failed, resetting:", e);
      return this._mem || emptyHistory(this._seed);
    }
    if (!isValid(parsed)) {
      derr("load: malformed history, resetting", parsed && parsed.version);
      return this._mem || emptyHistory(this._seed);
    }
    normalize(parsed);

    // Safety net: prefer _mem if it has strictly more samples than
    // what came back (rare, but covers a partial post-transition
    // read where the player bag hasn't fully rehydrated yet).
    if (this._mem && this._mem.samples && this._mem.samples.length > parsed.samples.length) {
      dlog(
        "load: persistent=" +
          parsed.samples.length +
          " < _mem=" +
          this._mem.samples.length +
          " — preferring _mem"
      );
      try {
        store.write(PAYLOAD_KEY, JSON.stringify(this._mem));
      } catch (e) {
        derr("_loadParsed: recovery store.write threw:", e);
      }
      return this._mem;
    }

    dlog(
      "load: ok pid=" +
        store.pid +
        " samples=" +
        parsed.samples.length +
        " ageBoundaries=" +
        parsed.ageBoundaries.length +
        " bytes=" +
        raw.length
    );
    return parsed;
  }

  /**
   * Load the history from persistence, reconciling against the in-memory mirror.
   * @returns {StoredHistory} The loaded (or recovered, or empty) history.
   */
  load() {
    this._init();
    const store = this._pickStore();
    if (!store) {
      // Player not yet available. Return _mem if we have it,
      // otherwise an empty shell. Subsequent loads will retry.
      dlog(
        "load: no store available yet (pre-player-init); _mem=" +
          (this._mem ? this._mem.samples.length : "null")
      );
      return this._mem || emptyHistory(this._seed);
    }
    const raw = this._readRaw(store);
    if (raw == null || raw === "") {
      return this._loadEmpty(store);
    }
    return this._loadParsed(raw, store);
  }

  /**
   * Validate, cap, mirror, and persist a history blob.
   * @param {StoredHistory} history History to persist.
   * @returns {boolean} True if written to a store, false otherwise.
   */
  save(history) {
    this._init();
    if (!isValid(history)) {
      derr("save: refusing to persist invalid history");
      return false;
    }
    normalize(history);
    const eff = resolveEffectiveCap();
    if (isFinite(eff.cap) && history.samples.length > eff.cap) {
      history.samples = history.samples.slice(-eff.cap);
    }
    this._mem = history;

    const store = this._pickStore();
    if (!store) {
      dlog("save: no store available; held in _mem (samples=" + history.samples.length + ")");
      return false;
    }
    let str;
    try {
      str = JSON.stringify(history);
    } catch (e) {
      derr("save: stringify threw:", e);
      return false;
    }
    try {
      store.write(PAYLOAD_KEY, str);
      return true;
    } catch (e) {
      derr("save: store.write threw:", e);
      return false;
    }
  }

  /**
   * Insert (or dedupe-replace) a snapshot into a history's sample list, in place.
   * De-dupes by (age, localTurn) so repeat events on the same age-local turn
   * (notably per-pid PlayerAgeTransitionComplete bursts) don't pile up at one
   * chart X coord.
   * @param {StoredHistory} h Target history.
   * @param {Snapshot} snapshot Snapshot to insert.
   * @returns {void}
   */
  _insertSnapshot(h, snapshot) {
    if (snapshot && typeof snapshot.localTurn === "number" && typeof snapshot.age === "string") {
      const i = h.samples.findIndex(
        (s) => s && s.age === snapshot.age && s.localTurn === snapshot.localTurn
      );
      if (i >= 0) h.samples[i] = snapshot;
      else h.samples.push(snapshot);
    } else if (snapshot && typeof snapshot.turn === "number") {
      const i = h.samples.findIndex((s) => s && s.turn === snapshot.turn && !s.age);
      if (i >= 0) h.samples[i] = snapshot;
      else h.samples.push(snapshot);
    } else {
      h.samples.push(snapshot);
    }
  }

  /**
   * Decimate older samples in place once the count exceeds a cap-derived
   * threshold, preserving the latest age and any age-boundary turns.
   * @param {StoredHistory} h Target history (mutated).
   * @param {EffectiveCap} eff The active effective cap.
   * @returns {void}
   */
  _maybeDecimate(h, eff) {
    const KEEP_EVERY_NTH = 3;
    if (!decimationDisabled() && isFinite(eff.cap)) {
      const decimateThreshold = Math.max(250, Math.floor(eff.cap * 0.25));
      if (h.samples.length > decimateThreshold) {
        const bounds = Array.isArray(h.ageBoundaries) ? h.ageBoundaries : [];
        const latestBoundary = bounds.length > 0 ? bounds[bounds.length - 1].turn : Infinity;
        /** @type {Set<number | undefined>} */
        const boundaryTurns = new Set(bounds.map((b) => b.turn));
        /** @type {Snapshot[]} */
        const before = [];
        /** @type {Snapshot[]} */
        const after = [];
        for (const s of h.samples) {
          if (/** @type {number} */ (s.turn) >= latestBoundary) after.push(s);
          else before.push(s);
        }
        const decimated = before.filter(
          (s, i) => i % KEEP_EVERY_NTH === 0 || boundaryTurns.has(s.turn)
        );
        h.samples = decimated.concat(after);
        this._noteDecimation(h, eff, KEEP_EVERY_NTH);
        dlog(
          "decimated; before=" +
            before.length +
            " after=" +
            after.length +
            " kept=" +
            decimated.length +
            " cap=" +
            eff.source
        );
      }
    }
  }

  /**
   * Fire the one-time, always-on downsampling notice (not gated by DBG) and
   * record the turn it first triggered. No-op after the first call. Users with
   * very long games should know late history is downsampled, not lost silently;
   * the Options panel mirrors this via {@link StorageImpl#decimationStatus}.
   * @param {StoredHistory} h The (already decimated) history.
   * @param {EffectiveCap} eff The active effective cap.
   * @param {number} keepEveryNth The keep-1-in-N decimation ratio.
   * @returns {void}
   */
  _noteDecimation(h, eff, keepEveryNth) {
    if (this._decimationNotified) return;
    this._decimationNotified = true;
    const last = h.samples[h.samples.length - 1];
    this._decimationTurn = last && typeof last.turn === "number" ? last.turn : -1;
    console.warn(
      "[Demographics.storage] History sample cap approached; older samples " +
        "downsampled (keeping 1 in " +
        keepEveryNth +
        ", age boundaries preserved) to fit cap " +
        eff.cap +
        " (" +
        eff.source +
        "). Raise it via the History sample-cap setting."
    );
  }

  /**
   * Current decimation + cap state, for read-only display in the Options panel.
   * @returns {{ active: boolean, firstTurn: number, cap: number, capSource: string, disabled: boolean }}
   *   `active` once downsampling has triggered; `firstTurn` is when; `cap` /
   *   `capSource` are the effective sample cap and where it came from;
   *   `disabled` reflects the user's "keep every sample" override.
   */
  decimationStatus() {
    const eff = resolveEffectiveCap();
    return {
      active: this._decimationNotified,
      firstTurn: this._decimationTurn,
      cap: eff.cap,
      capSource: eff.source,
      disabled: decimationDisabled()
    };
  }

  /**
   * Append a snapshot to the history (dedupe, decimate, persist) and return it.
   * @param {Snapshot} snapshot Snapshot to append.
   * @returns {StoredHistory} The updated history.
   */
  appendSample(snapshot) {
    const h = this.load();

    this._insertSnapshot(h, snapshot);

    // Decimation (preserved from prior implementation).
    const eff = resolveEffectiveCap();
    this._maybeDecimate(h, eff);

    this.save(h);
    return h;
  }

  /**
   * Force-persist the in-memory mirror.
   * @returns {void}
   */
  flush() {
    if (this._mem) this.save(this._mem);
  }

  /**
   * Reset the history to empty, both in memory and in the active store.
   * @returns {void}
   */
  clear() {
    this._init();
    const empty = emptyHistory(this._seed);
    this._mem = empty;
    const store = this._pickStore();
    if (store) {
      try {
        store.write(PAYLOAD_KEY, JSON.stringify(empty));
      } catch (e) {
        derr("clear: store.write threw:", e);
      }
    }
  }
}

/** The history storage singleton. */
const DemographicsStorage = new StorageImpl();
export default DemographicsStorage;
export {
  DemographicsStorage,
  resolveEffectiveCap,
  detectGameSpeedType,
  ADAPTIVE_DEFAULTS_BY_SPEED,
  HARD_MAX_SAMPLES
};
