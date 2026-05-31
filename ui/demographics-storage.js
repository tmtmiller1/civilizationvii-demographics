// demographics-storage.js
//
// This would be Cross-age persistent storage for the history time series if
// that functionality were possible in the UI sandbox. Unfortunately, the
// necessary tools aren't available (yet? we can always hope)

// Backend is the per-local-player Tutorial property bag — the same
// surface used internally by the engine for legacy/triumph tracking and
// civ-unlock tracking (see triumph-tracking-manager.js and
// civ-unlock-tracking-manager.js under base-standard/ui-next/ and
// core/ui-next/ respectively).
//
// Why per-player and not GameTutorial:
//   GameTutorial.setProperty (the global bag) is wiped at age transition.
//   The engine's own tutorial-manager.js can afford this because each age
//   ships its own tutorial item bank and never needs cross-age state.
//
//   Players[localObserverID].Tutorial.setProperty survives because it
//   rides on the per-player serialized state that the age-transition
//   save carries forward. This is the engine's blessed cross-age path,
//   established in core/ui/utilities/utility-serialize.js
//   (SerialBase.internalWrite, around lines 37–44):
//       if (!this.player) GameTutorial.setProperty(hash, value);
//       else              this.player.Tutorial.setProperty(hash, value);
//
// Proactive flushes fire on:
//   BeforeAgeTransition  — engine emits this immediately before the
//                          transition save is captured
//   BeforeUnload         — UI module reload; covers age boundaries and
//                          quit-to-menu

import { DemographicsSettings } from "/demographics/ui/demographics-settings.js";

const DBG = true;
function dlog(...a) {
  if (DBG) console.warn("[Demographics.storage]", ...a);
}
function derr(...a) {
  console.error("[Demographics.storage]", ...a);
}
function safeCall(fn, fallback) {
  try {
    return fn();
  } catch (e) {
    derr("safeCall:", e);
    return fallback;
  }
}

// ── Schema ──────────────────────────────────────────────────────────
const VERSION = 1;
const HARD_MAX_SAMPLES = 50000;
// Catalog scope + object/key names. Stable across all ages.
const CATALOG_SCOPE = "demographics-history-v1";
const HISTORY_OBJECT = "history";
const PAYLOAD_KEY = "json";

// ── Sample cap config (preserved from prior implementation) ─────────
const ADAPTIVE_DEFAULTS_BY_SPEED = {
  GAMESPEED_QUICK: 500,
  GAMESPEED_STANDARD: 2000,
  GAMESPEED_EPIC: 3000,
  GAMESPEED_MARATHON: 5000
};
const FALLBACK_DEFAULT = 2000;

function detectGameSpeedType() {
  return safeCall(() => {
    if (typeof Game === "undefined") return null;
    const candidate =
      Game.gameSpeedType ||
      (typeof Game.getGameSpeedType === "function" ? Game.getGameSpeedType() : null);
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
    const hash = Game.gameSpeed;
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
  }, null);
}

function resolveEffectiveCap() {
  let override;
  try {
    override = DemographicsSettings.getSetting("sampleCapOverride", "auto");
  } catch (_) {
    override = "auto";
  }
  if (typeof override === "number" && isFinite(override) && override !== 0) {
    if (override < 0) return { cap: Infinity, source: "user:unlimited" };
    return { cap: Math.min(override, HARD_MAX_SAMPLES), source: "user:" + override };
  }
  if (typeof override === "string" && override !== "auto") {
    const parsed = parseInt(override, 10);
    if (isFinite(parsed) && parsed !== 0) {
      if (parsed < 0) return { cap: Infinity, source: "user:unlimited" };
      return { cap: Math.min(parsed, HARD_MAX_SAMPLES), source: "user:" + parsed };
    }
  }
  const speed = detectGameSpeedType();
  const adaptive = (speed && ADAPTIVE_DEFAULTS_BY_SPEED[speed]) || FALLBACK_DEFAULT;
  return { cap: adaptive, source: "auto:" + (speed || "fallback") };
}

function decimationDisabled() {
  try {
    return !!DemographicsSettings.getSetting("disableDecimation", false);
  } catch (_) {
    return false;
  }
}

// ── Hashing (matches engine SerialBase.makeHash) ────────────────────
function fnv1a(str) {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}
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
function emptyHistory(seed) {
  return {
    version: VERSION,
    seed: seed,
    samples: [],
    ageBoundaries: [],
    eliminated: {}
  };
}
function isValid(h) {
  return !!(h && typeof h === "object" && h.version === VERSION && Array.isArray(h.samples));
}
function normalize(h) {
  if (!h) return h;
  if (!Array.isArray(h.ageBoundaries)) h.ageBoundaries = [];
  if (!h.eliminated || typeof h.eliminated !== "object") h.eliminated = {};
  return h;
}

// ── Per-player Tutorial accessor (the cross-age-surviving surface) ──
//
// Returns { read(key), write(key, val) } or null if the player isn't
// available yet. Re-resolves the player on every call: localObserverID
// can change at age transition while the post-transition shell is
// settling, and we don't want to cache a stale Player reference.
function getPlayerStore() {
  try {
    if (
      typeof GameContext === "undefined" ||
      typeof Players === "undefined" ||
      typeof Players.get !== "function"
    )
      return null;
    const pid =
      typeof GameContext.localObserverID !== "undefined" && GameContext.localObserverID >= 0
        ? GameContext.localObserverID
        : typeof GameContext.localPlayerID !== "undefined" && GameContext.localPlayerID >= 0
          ? GameContext.localPlayerID
          : -1;
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

// Fallback global tier — only used if per-player store isn't yet
// available. Same hashing scheme so we can also try to migrate any
// legacy data written under the old GameTutorial-based code.
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
    return null;
  }
}

// ── Storage singleton ───────────────────────────────────────────────
class StorageImpl {
  constructor() {
    this._mem = null;
    this._seed = "unknown";
    this._initialized = false;
    this._hooksInstalled = false;
    this._pendingWrites = 0;
  }

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

  _installEngineHooks() {
    if (this._hooksInstalled) return;
    if (typeof engine === "undefined" || typeof engine.on !== "function") return;
    this._hooksInstalled = true;
    const flush = () => {
      try {
        if (this._mem) {
          dlog("flush: BeforeAgeTransition/BeforeUnload — samples=" + this._mem.samples.length);
          this.save(this._mem);
        }
      } catch (e) {
        derr("flush hook threw:", e);
      }
    };
    try {
      engine.on("BeforeAgeTransition", flush);
    } catch (_) {}
    try {
      engine.on("BeforeUnload", flush);
    } catch (_) {}
  }

  _pickStore() {
    return getPlayerStore() || getGlobalStore();
  }

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
    let raw = null;
    try {
      raw = store.read(PAYLOAD_KEY);
    } catch (e) {
      derr("store.read threw:", e);
    }

    if (raw == null || raw === "") {
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
        } catch (_) {}
        return this._mem;
      }
      dlog("load: no existing history (pid=" + store.pid + ")");
      return emptyHistory(this._seed);
    }

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
      } catch (_) {}
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

  appendSample(snapshot) {
    const h = this.load();

    // De-dupe by (age, localTurn) so repeat events on the same
    // age-local turn (notably per-pid PlayerAgeTransitionComplete
    // bursts) don't pile up at one chart X coord.
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

    // Decimation (preserved from prior implementation).
    const eff = resolveEffectiveCap();
    const KEEP_EVERY_NTH = 3;
    if (!decimationDisabled() && isFinite(eff.cap)) {
      const decimateThreshold = Math.max(250, Math.floor(eff.cap * 0.25));
      if (h.samples.length > decimateThreshold) {
        const bounds = Array.isArray(h.ageBoundaries) ? h.ageBoundaries : [];
        const latestBoundary = bounds.length > 0 ? bounds[bounds.length - 1].turn : Infinity;
        const boundaryTurns = new Set(bounds.map((b) => b.turn));
        const before = [];
        const after = [];
        for (const s of h.samples) {
          if (s.turn >= latestBoundary) after.push(s);
          else before.push(s);
        }
        const decimated = before.filter(
          (s, i) => i % KEEP_EVERY_NTH === 0 || boundaryTurns.has(s.turn)
        );
        h.samples = decimated.concat(after);
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

    // perfMode: buffer writes across N turns to reduce stringify load.
    const BUFFER_TURNS = 3;
    const perfMode = (() => {
      try {
        if (
          typeof DemographicsSettings !== "undefined" &&
          typeof DemographicsSettings.getSetting === "function"
        ) {
          return !!DemographicsSettings.getSetting("perfMode", false);
        }
      } catch (_) {}
      return false;
    })();
    if (perfMode) {
      this._mem = h;
      this._pendingWrites += 1;
      if (this._pendingWrites >= BUFFER_TURNS) {
        this.save(h);
        this._pendingWrites = 0;
      }
    } else {
      this.save(h);
    }
    return h;
  }

  flush() {
    if (this._mem) {
      this.save(this._mem);
      this._pendingWrites = 0;
    }
  }

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

const DemographicsStorage = new StorageImpl();
export default DemographicsStorage;
export {
  DemographicsStorage,
  resolveEffectiveCap,
  detectGameSpeedType,
  ADAPTIVE_DEFAULTS_BY_SPEED,
  HARD_MAX_SAMPLES
};
