// demographics-storage.js
//
// Per-turn history time-series storage for the Demographics screen.
//
// Backend: the GameConfiguration key-value store, which persists across
// quit/load and the age transition; history is stamped with the game seed and
// self-resets on a new game, and the per-player Tutorial property bag is a
// read-only fallback. A BeforeUnload flush writes the in-memory history before
// a UI reload; per-turn saves cover the rest.

import { DemographicsSettings } from "/demographics/ui/core/demographics-settings.js";
import { localizeStoredNames } from "/demographics/ui/storage/storage-display-names.js";
import {
  ADAPTIVE_DEFAULTS_BY_SPEED,
  decimationDisabled,
  detectGameSpeedType,
  HARD_MAX_SAMPLES,
  PAYLOAD_HARD_BYTES,
  PAYLOAD_SOFT_BYTES,
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
  serializeWithinBudget,
  writeSerializedPayload
} from "/demographics/ui/storage/storage-retention.js";
import { loadEmpty, loadParsed, readRaw } from "/demographics/ui/storage/storage-load.js";
import { makeLogger } from "/demographics/ui/core/demographics-log.js";

// The global {History} typedef merges with the DOM lib's `History` interface,
// so the same shape is aliased under a local name (mirrors types/demographics.d.ts).
/**
 * @typedef {object} StoredHistory
 * @property {number} version Persisted schema version.
 * @property {string | number} seed Game seed.
 * @property {Snapshot[]} samples Per-turn samples.
 * @property {AgeBoundary[]} ageBoundaries Age hand-off markers.
 * @property {Record<string, any>} eliminated Elimination bookkeeping.
 * @property {*} [settleTrace] Per-settlement founding stamps + population windows (settlements-trace.js).
 * @property {*} [settleAges] End-of-age top-settlement archive (settlements-age-archive.js).
 */

const log = makeLogger("storage");

/**
 * Run `fn`, returning its result, or `fallback` if it throws. Never throws.
 * @template T
 * @param {() => T} fn
 * @param {T} fallback Value returned if `fn` throws.
 * @returns {T} The result of `fn`, or `fallback` on error.
 */
function safeCall(fn, fallback) {
  try {
    return fn();
  } catch (e) {
    log.error("safeCall:", e);
    return fallback;
  }
}

// schema
/** Persisted history schema version. */
const VERSION = 1;
/** Hashing scope prefix; stable across all ages. */
const CATALOG_SCOPE = "demographics-history-v1";
/** Property-bag key under which the JSON payload is stored. */
const PAYLOAD_KEY = "json";

/**
 * Pick the persistence store: the GameConfiguration KV store as the primary
 * backend, with the Tutorial bag as a read-only fallback. Writes go to the config store only.
 * @param {{ catalogScope: string, logError: (...a: any[]) => void }} options Resolver options.
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
      const value = config.read(key);
      if (value !== null && value !== undefined && value !== "") return value;
      return legacy.read(key); // one-time migration from the old Tutorial bag
    },
    write: (key, val) => config.write(key, val)
  };
}
/**
 * Default persistence mode. `legacy_tutorial_bag` additionally registers the
 * BeforeAgeTransition flush; opt in via the `persistenceMode` setting.
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

// storage singleton
/** Yield-derived metric ids used to detect a premature (economy-not-ready) sample. */
const YIELD_METRIC_IDS = ["gdp", "gpt", "crops", "production", "science", "culture"];

/**
 * Sum |yield-metric| across all players in a sample, flagging whether any
 * yield metric was present at all.
 * @param {*} sample One sample.
 * @returns {{ total: number, seen: boolean }} The absolute yield total + seen flag.
 */
function sumSampleYields(sample) {
  let total = 0;
  let seen = false;
  const players = sample && sample.players;
  if (!players) return { total, seen };
  for (const pid of Object.keys(players)) {
    const metrics = players[pid] && players[pid].metrics;
    if (!metrics) continue;
    for (const metricId of YIELD_METRIC_IDS) {
      if (typeof metrics[metricId] === "number") {
        total += Math.abs(metrics[metricId]);
        seen = true;
      }
    }
  }
  return { total, seen };
}

/**
 * Whether `s` is a premature age-boundary sample: the first sample of a new age
 * (age differs from `prev`) whose yields are all zero while `prev` (age-end) had
 * real yields: the artifact from sampling before the new age's economy spun up.
 * @param {*} sample The candidate sample.
 * @param {*} prev The preceding sample, or null.
 * @returns {boolean} True when `s` should be dropped.
 */
function isPrematureBoundarySample(sample, prev) {
  if (!prev || !sample || !sample.age || !prev.age || sample.age === prev.age) return false;
  const cur = sumSampleYields(sample);
  return cur.seen && cur.total === 0 && sumSampleYields(prev).total > 0;
}

/**
 * Drop premature age-boundary samples in place (GDP/yield false drop-to-zero).
 * Safe: the all-zero-yields-at-an-age-start signature is unique to it.
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
    log.error("dropped " + (samples.length - kept.length) + " premature age-boundary sample(s)");
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
    /** @type {number} Byte length of the last payload serialized (save) or read (load). */
    this._lastPayloadBytes = 0;
    /** @type {boolean} Whether the once-per-session soft byte-budget notice has fired. */
    this._payloadSoftNotified = false;
    /** @type {(() => void) | null} BeforeUnload hook callback. */
    this._beforeUnloadHook = null;
    /** @type {(() => void) | null} BeforeAgeTransition hook callback. */
    this._beforeAgeTransitionHook = null;
  }

  /**
   * Whether the in-memory mirror is stamped with a known seed that differs from
   * the current game's, so it must not be reconciled into this one. False when
   * either seed is the "unknown" sentinel.
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
    // Never resurrect a different game's in-memory history: prefer the
    // freshly-parsed payload regardless of sample counts (pairs with the seed
    // guard in storage-load.js loadParsed).
    if (this._memIsForDifferentGame()) return parsed;
    if (memSamples <= parsed.samples.length) return parsed;
    log.debug(
      "load: persistent=" +
        parsed.samples.length +
        " < _mem=" +
        memSamples +
        ", preferring _mem"
    );
    try {
      const mem = this._mem;
      if (mem) store.write(PAYLOAD_KEY, serializePayload(mem));
    } catch (e) {
      log.error("_loadParsed: recovery store.write threw:", e);
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
    log.debug("init: seed=", this._seed, "scope=", CATALOG_SCOPE);
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
      log.error("seed lookup threw:", e);
    }
  }

  /**
   * Install one-time flush hooks. `BeforeUnload` is always installed;
   * `BeforeAgeTransition` only in `legacy_tutorial_bag` mode. Idempotent.
   */
  _installEngineHooks() {
    if (this._hooksInstalled) return;
    if (typeof engine === "undefined" || typeof engine.on !== "function") return;
    this._hooksInstalled = true;
    /** @returns {void} */
    const flush = () => {
      try {
        if (this._mem) {
          log.debug("flush: samples=" + this._mem.samples.length);
          this.save(this._mem);
        }
      } catch (e) {
        log.error("flush hook threw:", e);
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
        log.error("teardown BeforeAgeTransition off threw:", e);
      }
      try {
        if (this._beforeUnloadHook) {
          engine.off("BeforeUnload", this._beforeUnloadHook);
        }
      } catch (e) {
        log.error("teardown BeforeUnload off threw:", e);
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
    const options = { catalogScope: CATALOG_SCOPE, logError: log.error };
    return pickPersistStore(options);
  }

  /**
   * Read the raw payload string from a store, swallowing read errors.
   * @param {PersistStore} store Store to read from.
   * @returns {string | null} The raw payload, or null on error/empty.
   */
  _readRaw(store) {
    return readRaw(store, PAYLOAD_KEY, log.error);
  }

  /**
   * Handle the empty-persistent-tier case: recover from `_mem` if it holds
   * data for this game, else restore a parked payload, else return an empty shell.
   * @param {PersistStore} store The (empty) store to recover into.
   * @returns {StoredHistory} The recovered, restored, or freshly empty history.
   */
  _loadEmpty(store) {
    return loadEmpty({
      mem: this._mem,
      seed: this._seed,
      version: VERSION,
      store,
      payloadKey: PAYLOAD_KEY,
      emptyHistory,
      isValid,
      normalize,
      logDebug: log.debug,
      logError: log.error
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
      payloadKey: PAYLOAD_KEY,
      emptyHistory,
      isValid,
      normalize,
      preferMemWhenNewer: (parsed) => this._preferMemWhenNewer(parsed, store),
      logDebug: log.debug,
      logError: log.error
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
      log.debug(
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
    this._lastPayloadBytes = raw.length;
    const result = this._loadParsed(raw, store);
    dropPrematureBoundarySamples(result);
    return localizeStoredNames(result);
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
      log.debug("save: no store available; held in _mem (samples=" + history.samples.length + ")");
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
      resolveEffectiveCap: () => resolveEffectiveCap(log.error),
      logError: log.error
    });
  }

  /**
   * Serialize a history (tightening it while over the soft byte budget) and
   * write it to the store, swallowing errors. An over-budget payload is still
   * written: the current game is never dropped, only logged about.
   * @param {PersistStore} store The resolved store.
   * @param {StoredHistory} history History to write (samples mutated when shrunk).
   * @returns {boolean} True on a successful write.
   */
  _writeStorePayload(store, history) {
    const serialized = this._serializeWithinBudget(history);
    if (serialized === null) return false;
    return writeSerializedPayload(store, PAYLOAD_KEY, serialized, log.error);
  }

  /**
   * Serialize a history under the soft byte budget where possible, recording the
   * final length and emitting the budget notices.
   * @param {StoredHistory} history History to serialize (samples mutated when shrunk).
   * @returns {string | null} The serialized payload, or null when stringify threw.
   */
  _serializeWithinBudget(history) {
    let result;
    try {
      result = serializeWithinBudget(history, {
        cap: resolveEffectiveCap(log.error).cap,
        softBytes: PAYLOAD_SOFT_BYTES,
        tighten: (h, cap) => this._tightenToCap(h, cap)
      });
    } catch (e) {
      log.error("save: stringify threw:", e);
      return null;
    }
    this._lastPayloadBytes = result.serialized.length;
    this._notePayloadBytes(result.initialBytes, result.serialized.length, result.attempts);
    return result.serialized;
  }

  /**
   * Re-run the decimation/cap step against a tighter cap, for the byte budget.
   * The user's "keep every sample" override is bypassed on purpose: the budget
   * protects the save itself.
   * @param {StoredHistory} history Target history (mutated).
   * @param {number} cap The tightened sample cap.
   */
  _tightenToCap(history, cap) {
    const eff = { cap, source: "bytes:" + cap };
    this._maybeDecimate(history, eff, { decimationDisabled: () => false, splitDecimationBuckets });
    if (history.samples.length > cap) history.samples = history.samples.slice(-cap);
  }

  /**
   * Log the byte-budget state of a serialized payload: once per session when the
   * soft budget was crossed, on every save while the hard budget is exceeded.
   * @param {number} initialBytes Length before any tightening pass.
   * @param {number} finalBytes Length actually written.
   * @param {number} attempts Tightening passes run.
   */
  _notePayloadBytes(initialBytes, finalBytes, attempts) {
    if (initialBytes > PAYLOAD_SOFT_BYTES && !this._payloadSoftNotified) {
      this._payloadSoftNotified = true;
      log.error(
        "save: payload " + initialBytes + " bytes exceeds the soft budget " + PAYLOAD_SOFT_BYTES +
          "; tightened to " + finalBytes + " bytes in " + attempts + " pass(es)"
      );
    }
    if (finalBytes > PAYLOAD_HARD_BYTES) {
      log.error(
        "save: payload " + finalBytes + " bytes still exceeds the hard budget " + PAYLOAD_HARD_BYTES +
          " after " + attempts + " pass(es); writing anyway"
      );
    }
  }

  /**
   * Insert (or dedupe-replace) a snapshot into a history's sample list, in place.
   * De-dupes by (age, localTurn) so repeat events on the same age-local turn
   * (notably per-pid PlayerAgeTransitionComplete bursts) don't pile up at one
   * chart X coord.
   * @param {StoredHistory} history Target history.
   * @param {Snapshot} snapshot Snapshot to insert.
   */
  _insertSnapshot(history, snapshot) {
    insertSnapshot(history, snapshot);
  }

  /**
   * Decimate older samples in place once the count exceeds a cap-derived
   * threshold, preserving the latest age and any age-boundary turns.
   * @param {StoredHistory} history Target history (mutated).
   * @param {EffectiveCap} eff The active effective cap.
   * @param {Parameters<typeof maybeDecimate>[2]} [deps] Decimation dependencies
   *   (default: the user's decimation setting + the schema bucket split).
   */
  _maybeDecimate(history, eff, deps) {
    const summary = maybeDecimate(
      history,
      eff,
      deps || { decimationDisabled: () => decimationDisabled(log.error), splitDecimationBuckets }
    );
    if (!summary.decimated) return;
    this._noteDecimation(history, eff, summary.keepEveryNth || 3);
    log.debug(
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
   * Fire the one-time, always-on downsampling notice (not behind the debug switch) and
   * record the turn it first triggered; the Options panel mirrors this via
   * {@link StorageImpl#decimationStatus}.
   * @param {StoredHistory} history The (already decimated) history.
   * @param {EffectiveCap} eff The active effective cap.
   * @param {number} keepEveryNth The keep-1-in-N decimation ratio.
   */
  _noteDecimation(history, eff, keepEveryNth) {
    if (this._decimationNotified) return;
    this._decimationNotified = true;
    const last = history.samples[history.samples.length - 1];
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
  *   disabled: boolean,
  *   payloadBytes: number
  * }}
   *   `active` once downsampling has triggered; `firstTurn` is when; `cap` /
   *   `capSource` are the effective sample cap and where it came from;
   *   `disabled` reflects the user's "keep every sample" override;
   *   `payloadBytes` is the length of the last payload serialized or read.
   */
  decimationStatus() {
    const eff = resolveEffectiveCap(log.error);
    return {
      active: this._decimationNotified,
      firstTurn: this._decimationTurn,
      cap: eff.cap,
      capSource: eff.source,
      disabled: decimationDisabled(log.error),
      payloadBytes: this._lastPayloadBytes
    };
  }

  /**
   * Append a snapshot to the history (dedupe, decimate) and return it. Persists
   * by default; `{ persist: false }` skips the write so the caller can batch
   * further mutations into one save per turn (the in-memory mirror is still updated).
   * @param {Snapshot} snapshot Snapshot to append.
   * @param {{ persist?: boolean }} [opts] Append options.
   * @returns {StoredHistory} The updated history.
   */
  appendSample(snapshot, opts) {
    const history = this.load();

    this._insertSnapshot(history, snapshot);

    const eff = resolveEffectiveCap(log.error);
    this._maybeDecimate(history, eff);

    if (!opts || opts.persist !== false) this.save(history);
    else this._mem = history;
    return history;
  }

  /**
   * Force-persist the in-memory mirror.
   */
  flush() {
    if (this._mem) this.save(this._mem);
  }

  /**
   * The in-memory history mirror (last loaded or saved), or null before the
   * first load. Lets a caller that just triggered a save reuse the fresh blob
   * instead of re-parsing the whole store.
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
        log.error("clear: store.write threw:", e);
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
