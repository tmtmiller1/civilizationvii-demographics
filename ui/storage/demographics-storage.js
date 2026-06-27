// demographics-storage.js
//
// Per-turn history time-series storage for the Demographics screen.
//
// Backend: the GameConfiguration key-value store (Configuration.editGame()
// .setValue / Configuration.getGame().getValue), which persists across quit/load
// AND the age transition. History is stamped with the game seed and self-resets
// on a new game. The old per-player Tutorial property bag is kept only as a
// read-only fallback, so history written by older builds migrates forward on the
// first load under this backend.
//
// A BeforeUnload flush writes the in-memory history before a UI reload (covers
// quit-to-menu and in-session age boundaries); per-turn saves cover the rest.

import { DemographicsSettings } from "/demographics/ui/core/demographics-settings.js";
import {
  ADAPTIVE_DEFAULTS_BY_SPEED,
  decimationDisabled,
  detectGameSpeedType,
  HARD_MAX_SAMPLES,
  resolveEffectiveCap
} from "/demographics/ui/storage/storage-cap.js";
import {
  emptyHistory,
  isValid,
  normalize,
  splitDecimationBuckets
} from "/demographics/ui/storage/storage-schema.js";
import {
  getConfigStore,
  getGlobalStore,
  getPlayerStore
} from "/demographics/ui/storage/storage-backend.js";
import {
  insertSnapshot,
  maybeDecimate,
  prepareHistoryForSave,
  serializePayload,
  writeStorePayload
} from "/demographics/ui/storage/storage-retention.js";
import { loadEmpty, loadParsed, readRaw } from "/demographics/ui/storage/storage-load.js";

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
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.storage]", ...a);
}
/**
 * Error logger; always emits.
 * @param {...*} a Values to log.
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
// Catalog scope + object/key names. Stable across all ages.
/** Hashing scope prefix; stable across all ages. */
const CATALOG_SCOPE = "demographics-history-v1";
/** Property-bag key under which the JSON payload is stored. */
const PAYLOAD_KEY = "json";

/**
 * Pick the persistence store: the GameConfiguration KV store as the PRIMARY
 * backend (durable across quit→load AND the age transition), with the old
 * Tutorial bag as a read-only fallback so history written by the previous
 * backend migrates forward on first load. Writes go to the config store only.
 * @param {{ catalogScope: string, derr: (...a: any[]) => void }} options Resolver options.
 * @returns {PersistStore | null} The store, or null when no backend is available.
 */
function pickPersistStore(options) {
  const config = getConfigStore(options);
  const legacy = getPlayerStore(options) || getGlobalStore(options);
  if (!config) return legacy;
  if (!legacy) return config;
  return {
    pid: config.pid,
    read: (key) => {
      const v = config.read(key);
      if (v !== null && v !== undefined && v !== "") return v;
      return legacy.read(key); // one-time migration from the old Tutorial bag
    },
    write: (key, val) => config.write(key, val)
  };
}
/**
 * Default persistence mode. With the GameConfiguration backend, history carries
 * across quit/load and the age transition under the default. `legacy_tutorial_bag`
 * additionally registers the BeforeAgeTransition flush (a no-op fallback retained
 * for older setups); opt in via the `persistenceMode` setting.
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

// ── History helpers ─────────────────────────────────────────────────

// ── Storage singleton ───────────────────────────────────────────────
/** Yield-derived metric ids used to detect a premature (economy-not-ready) sample. */
const YIELD_METRIC_IDS = ["gdp", "gpt", "crops", "production", "science", "culture"];

/**
 * Sum |yield-metric| across all players in a sample, flagging whether any
 * yield metric was present at all.
 * @param {*} s One sample.
 * @returns {{ total: number, seen: boolean }} The absolute yield total + seen flag.
 */
function sumSampleYields(s) {
  let total = 0;
  let seen = false;
  const players = s && s.players;
  if (!players) return { total, seen };
  for (const pid of Object.keys(players)) {
    const m = players[pid] && players[pid].metrics;
    if (!m) continue;
    for (const k of YIELD_METRIC_IDS) {
      if (typeof m[k] === "number") {
        total += Math.abs(m[k]);
        seen = true;
      }
    }
  }
  return { total, seen };
}

/**
 * Whether `s` is a premature age-boundary sample: the first sample of a NEW age
 * (age differs from `prev`) whose yields are all zero while `prev` (age-end) had
 * real yields - the artifact from sampling before the new age's economy spun up.
 * @param {*} s The candidate sample.
 * @param {*} prev The preceding sample, or null.
 * @returns {boolean} True when `s` should be dropped.
 */
function isPrematureBoundarySample(s, prev) {
  if (!prev || !s || !s.age || !prev.age || s.age === prev.age) return false;
  const cur = sumSampleYields(s);
  return cur.seen && cur.total === 0 && sumSampleYields(prev).total > 0;
}

/**
 * Drop premature age-boundary samples in place (GDP/yield false drop-to-zero).
 * The sampler no longer creates these; this also repairs saves recorded before
 * that fix. Safe: the all-zero-yields-at-an-age-start signature is unique to it.
 * @param {*} history The loaded history (mutated).
 */
function dropPrematureBoundarySamples(history) {
  /** @type {any[] | null} */
  const samples = history && Array.isArray(history.samples) ? history.samples : null;
  if (!samples || samples.length < 2) return;
  const kept = samples.filter(
    (s, i) => !isPrematureBoundarySample(s, i > 0 ? samples[i - 1] : null)
  );
  if (kept.length !== samples.length) {
    derr("dropped " + (samples.length - kept.length) + " premature age-boundary sample(s)");
    history.samples = kept;
  }
}

/**
 * History time-series storage, backed by the GameConfiguration KV store (with
 * the Tutorial bag as a read-only fallback). Persists across quit/load and age
 * transitions; see the file header.
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
    /** @type {(() => void) | null} BeforeUnload hook callback. */
    this._beforeUnloadHook = null;
    /** @type {(() => void) | null} BeforeAgeTransition hook callback. */
    this._beforeAgeTransitionHook = null;
  }

  /**
   * Whether the in-memory mirror is stamped with a KNOWN seed that differs from
   * the current game's — i.e. it belongs to a different game and must not be
   * reconciled into this one. False when either seed is the "unknown" sentinel.
   * @returns {boolean} True when _mem is for a different game.
   */
  _memIsForDifferentGame() {
    if (!this._mem || this._seed === "unknown") return false;
    const memSeed = this._mem.seed;
    if (memSeed === undefined || memSeed === null || memSeed === "unknown") return false;
    return String(memSeed) !== String(this._seed);
  }

  /**
   * Prefer the in-memory history when it has strictly more samples than the
   * persisted payload, then write it back to storage for convergence.
   * @param {StoredHistory} parsed Parsed persisted history.
   * @param {PersistStore} store Active persistence store.
   * @returns {StoredHistory} The authoritative history object.
   */
  _preferMemWhenNewer(parsed, store) {
    const memSamples = this._mem?.samples?.length || 0;
    // Never resurrect a DIFFERENT game's in-memory history: if _mem is stamped
    // with a seed that doesn't match the current game, prefer the freshly-parsed
    // (current-game) payload regardless of sample counts. Pairs with the seed
    // guard in loadParsed (storage-load.js) so neither the store payload nor the
    // _mem mirror can leak a prior game's data into a new one.
    if (this._memIsForDifferentGame()) return parsed;
    if (memSamples <= parsed.samples.length) return parsed;
    dlog(
      "load: persistent=" +
        parsed.samples.length +
        " < _mem=" +
        memSamples +
        " , preferring _mem"
    );
    try {
      const mem = this._mem;
      if (mem) store.write(PAYLOAD_KEY, serializePayload(mem));
    } catch (e) {
      derr("_loadParsed: recovery store.write threw:", e);
    }
    return /** @type {StoredHistory} */ (this._mem);
  }

  /**
   * Lazily resolve the game seed and install engine flush hooks. Idempotent.
   */
  _init() {
    if (this._initialized) {
      this._installEngineHooks();
      return;
    }
    this._refreshSeedFromConfiguration();
    this._initialized = true;
    this._installEngineHooks();
    dlog("init: seed=", this._seed, "scope=", CATALOG_SCOPE);
  }

  /**
   * Refresh the seed from the active game configuration, if available.
   */
  _refreshSeedFromConfiguration() {
    try {
      if (
        typeof Configuration !== "undefined" &&
        typeof Configuration.getGame === "function"
      ) {
        const gameConfig = Configuration.getGame();
        const seed =
          gameConfig &&
          (gameConfig.startSeed ?? gameConfig.gameSeed ?? gameConfig.mapSeed);
        if (seed !== undefined && seed !== null) this._seed = seed;
      }
    } catch (e) {
      derr("seed lookup threw:", e);
    }
  }

  /**
   * Install one-time flush hooks. `BeforeUnload` is always installed (covers
   * in-session age boundaries and quit-to-menu). `BeforeAgeTransition` - the
   * cross-age carry-forward attempt, which does not work in current builds - is
   * installed only in `legacy_tutorial_bag` mode. Idempotent.
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
        this._beforeAgeTransitionHook = flush;
        engine.on("BeforeAgeTransition", flush);
      } catch (_) {
        this._beforeAgeTransitionHook = null;
        // engine.on() can throw if the event name is unknown in this build; the
        // BeforeUnload hook below still covers most flush cases.
      }
    }
    try {
      this._beforeUnloadHook = flush;
      engine.on("BeforeUnload", flush);
    } catch (_) {
      this._beforeUnloadHook = null;
      // engine.on() can throw if the event name is unknown in this build; rely
      // on per-turn saves if neither flush hook installs.
    }
  }

  /**
   * Drain every storage-owned engine hook.
   */
  _teardown() {
    if (typeof engine !== "undefined" && typeof engine.off === "function") {
      try {
        if (this._beforeAgeTransitionHook) {
          engine.off("BeforeAgeTransition", this._beforeAgeTransitionHook);
        }
      } catch (e) {
        derr("teardown BeforeAgeTransition off threw:", e);
      }
      try {
        if (this._beforeUnloadHook) {
          engine.off("BeforeUnload", this._beforeUnloadHook);
        }
      } catch (e) {
        derr("teardown BeforeUnload off threw:", e);
      }
    }
    this._beforeAgeTransitionHook = null;
    this._beforeUnloadHook = null;
    this._hooksInstalled = false;
  }

  /**
   * Pick the best available persistence tier (per-player, else global).
   * @returns {PersistStore | null}
   */
  _pickStore() {
    const options = { catalogScope: CATALOG_SCOPE, derr };
    return pickPersistStore(options);
  }

  /**
   * Read the raw payload string from a store, swallowing read errors.
   * @param {PersistStore} store Store to read from.
   * @returns {string | null} The raw payload, or null on error/empty.
   */
  _readRaw(store) {
    return readRaw(store, PAYLOAD_KEY, derr);
  }

  /**
   * Handle the empty-persistent-tier case: recover from `_mem` if it holds
   * data (re-stamping it under the now-writable bag), else return an empty shell.
   * @param {PersistStore} store The (empty) store to recover into.
   * @returns {StoredHistory} The recovered or freshly empty history.
   */
  _loadEmpty(store) {
    return loadEmpty({
      mem: this._mem,
      seed: this._seed,
      version: VERSION,
      store,
      payloadKey: PAYLOAD_KEY,
      emptyHistory,
      dlog,
      derr
    });
  }

  /**
   * Parse and validate a raw payload, reconciling it against `_mem`.
   * @param {string} raw Raw payload string.
   * @param {PersistStore} store Store the payload came from.
   * @returns {StoredHistory} The reconciled history.
   */
  _loadParsed(raw, store) {
    return loadParsed({
      raw,
      mem: this._mem,
      seed: this._seed,
      version: VERSION,
      store,
      emptyHistory,
      isValid,
      normalize,
      preferMemWhenNewer: (parsed) => this._preferMemWhenNewer(parsed, store),
      dlog,
      derr
    });
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
      return this._mem || emptyHistory(this._seed, VERSION);
    }
    const raw = this._readRaw(store);
    if (raw == null || raw === "") {
      const result = this._loadEmpty(store);
      return result;
    }
    const result = this._loadParsed(raw, store);
    dropPrematureBoundarySamples(result);
    return result;
  }

  /**
   * Validate, cap, mirror, and persist a history blob.
   * @param {StoredHistory} history History to persist.
   * @returns {boolean} True if written to a store, false otherwise.
   */
  save(history) {
    this._init();
    if (!this._prepareForSave(history)) return false;
    this._mem = history;
    const store = this._pickStore();
    if (!store) {
      dlog("save: no store available; held in _mem (samples=" + history.samples.length + ")");
      return false;
    }
    return this._writeStorePayload(store, history);
  }

  /**
   * Validate + normalize + cap a history in place before persisting.
   * @param {StoredHistory} history History to prepare (mutated).
   * @returns {boolean} True when valid and ready to write.
   */
  _prepareForSave(history) {
    return prepareHistoryForSave(history, {
      version: VERSION,
      isValid,
      normalize,
      resolveEffectiveCap: () => resolveEffectiveCap(derr),
      derr
    });
  }

  /**
   * Serialize a history and write it to the store, swallowing errors.
   * @param {PersistStore} store The resolved store.
   * @param {StoredHistory} history History to write.
   * @returns {boolean} True on a successful write.
   */
  _writeStorePayload(store, history) {
    return writeStorePayload(store, PAYLOAD_KEY, history, derr);
  }

  /**
   * Insert (or dedupe-replace) a snapshot into a history's sample list, in place.
   * De-dupes by (age, localTurn) so repeat events on the same age-local turn
   * (notably per-pid PlayerAgeTransitionComplete bursts) don't pile up at one
   * chart X coord.
   * @param {StoredHistory} h Target history.
   * @param {Snapshot} snapshot Snapshot to insert.
   */
  _insertSnapshot(h, snapshot) {
    insertSnapshot(h, snapshot);
  }

  /**
   * Decimate older samples in place once the count exceeds a cap-derived
   * threshold, preserving the latest age and any age-boundary turns.
   * @param {StoredHistory} h Target history (mutated).
   * @param {EffectiveCap} eff The active effective cap.
   */
  _maybeDecimate(h, eff) {
    const summary = maybeDecimate(h, eff, {
      decimationDisabled: () => decimationDisabled(derr),
      splitDecimationBuckets
    });
    if (!summary.decimated) return;
    this._noteDecimation(h, eff, summary.keepEveryNth || 3);
    dlog(
      "decimated; before=" +
        summary.beforeCount +
        " after=" +
        summary.afterCount +
        " kept=" +
        summary.keptCount +
        " cap=" +
        eff.source
    );
  }

  /**
   * Fire the one-time, always-on downsampling notice (not gated by DBG) and
   * record the turn it first triggered. No-op after the first call. Users with
   * very long games should know late history is downsampled, not lost silently;
   * the Options panel mirrors this via {@link StorageImpl#decimationStatus}.
   * @param {StoredHistory} h The (already decimated) history.
   * @param {EffectiveCap} eff The active effective cap.
   * @param {number} keepEveryNth The keep-1-in-N decimation ratio.
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
  * @returns {{
  *   active: boolean,
  *   firstTurn: number,
  *   cap: number,
  *   capSource: string,
  *   disabled: boolean
  * }}
   *   `active` once downsampling has triggered; `firstTurn` is when; `cap` /
   *   `capSource` are the effective sample cap and where it came from;
   *   `disabled` reflects the user's "keep every sample" override.
   */
  decimationStatus() {
    const eff = resolveEffectiveCap(derr);
    return {
      active: this._decimationNotified,
      firstTurn: this._decimationTurn,
      cap: eff.cap,
      capSource: eff.source,
      disabled: decimationDisabled(derr)
    };
  }

  /**
   * Append a snapshot to the history (dedupe, decimate) and return it. Persists
   * by default; pass `{ persist: false }` to skip the write so the caller can
   * batch further mutations (e.g. war tracking) into a single save per turn. In
   * the deferred case the in-memory mirror is still updated, so `peek()` and a
   * later `save()` see the appended sample.
   * @param {Snapshot} snapshot Snapshot to append.
   * @param {{ persist?: boolean }} [opts] Append options.
   * @returns {StoredHistory} The updated history.
   */
  appendSample(snapshot, opts) {
    const h = this.load();

    this._insertSnapshot(h, snapshot);

    // Decimation (preserved from prior implementation).
    const eff = resolveEffectiveCap(derr);
    this._maybeDecimate(h, eff);

    if (!opts || opts.persist !== false) this.save(h);
    else this._mem = h;
    return h;
  }

  /**
   * Force-persist the in-memory mirror.
   */
  flush() {
    if (this._mem) this.save(this._mem);
  }

  /**
   * The in-memory history mirror (last loaded or saved), or null before the
   * first load. Lets a caller that just triggered a save (the war tracker runs
   * immediately after appendSample) reuse the fresh blob instead of re-reading
   * and re-parsing the whole store.
   * @returns {StoredHistory|null} The in-memory mirror, or null.
   */
  peek() {
    return this._mem;
  }

  /**
   * Reset the history to empty, both in memory and in the active store.
   */
  clear() {
    this._init();
    const empty = emptyHistory(this._seed, VERSION);
    this._mem = empty;
    const store = this._pickStore();
    if (store) {
      try {
        store.write(PAYLOAD_KEY, serializePayload(empty));
      } catch (e) {
        derr("clear: store.write threw:", e);
      }
    }
  }

  /**
   * Public teardown entry point for external lifecycle drains.
   */
  teardown() {
    this._teardown();
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
