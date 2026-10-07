// settings-keeper.js - Tower Settings Keeper: a working localStorage on top of the one row the game can read.
//
// Civilization VII's localStorage.getItem() ignores its key and returns the first row of the store in key order;
// key(i) is always null. Writes, removeItem(), clear() and length are correct. So a mod can only read back what it
// stored if its key happens to sort first, and the usual "read my key, change it, write it back" copies the first
// row's data over its own. Mod settings vanish between launches because of it.
//
// The keeper keeps exactly ONE real row it owns, "modSettings", and runs every localStorage call through it:
//   - getItem/setItem/removeItem on any other key read and write root.__ls[key] inside that row;
//   - "modSettings" itself is passed through minus the keeper's own fields, so mods that keep a slice per mod id in
//     it work unchanged, and their write-back keeps every other key intact;
//   - length reports 1, so the "clear() when length > 1" guard many mods carry never fires; key(i) stays null as the
//     engine has it, so a loop that lists keys to remove them stays the no-op it has always been;
//   - clear() empties the store and rewrites the root with the other mods' keys kept.
// At start it makes sure its root IS row 1. Rows that sort before it and can be named (by content, see
// KNOWN_KEYS below) are removed and folded into the root: their bytes move, nothing is lost. A row it cannot name is
// never touched: the keeper then writes its root under "\u0001", the lowest key the engine stores, copies any
// mod slices the row holds, and keeps the row's full text in the root for recovery. Reads work from then on.
//
// One file on purpose: a script with no imports runs as early as the loader runs any script, and the keeper wants to
// be first. The core (install) is pure and exported for the tests; the self-install at the end only runs where the
// engine's localStorage exists. install() patches the object it is given, so a mod that captured a reference to
// localStorage before this ran still goes through the keeper.

export const ROOT_KEY = "modSettings";
export const FALLBACK_ROOT_KEY = "\u0001";
export const VIRTUAL_KEY = "__ls";
export const MARK_KEY = "__settings-keeper";
export const BLOCKED_KEY = "__blocked";
export const VERSION = 1; // layout of the keeper's mark
export const BUILD = 110; // this file's build; a newer copy replaces an older installed one
const INTERNAL = [VIRTUAL_KEY, MARK_KEY, BLOCKED_KEY];
const MAX_FOLD_STEPS = 32;
const BLOCKED_COPY_LIMIT = 2 * 1024 * 1024;

/** @returns {boolean} Whether v is a plain object (not null, not an array). */
export function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** @returns {boolean} A settings root: a plain object whose every top-level value is an object (one slice per mod). */
export function looksLikeRoot(o) {
  if (!isPlainObject(o)) return false;
  if (o[MARK_KEY]) return true;
  return Object.keys(o).every((k) => isPlainObject(o[k]));
}

function parse(text) {
  if (typeof text !== "string" || !text.length) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function safeMatch(entry, obj, text) {
  try {
    return typeof entry.match === "function" && entry.match(obj, text) === true;
  } catch (_) {
    return false;
  }
}

function withoutInternals(o) {
  const out = {};
  for (const k of Object.keys(o)) if (!INTERNAL.includes(k)) out[k] = o[k];
  return out;
}

/**
 * The engine's own methods, captured before anything is patched. The methods live on Storage.prototype in the game
 * and on the object itself in tests; length is a prototype getter in the game.
 */
function captureEngine(ls) {
  const proto = Object.getPrototypeOf(ls) || {};
  const pick = (n) => (typeof proto[n] === "function" ? proto[n] : ls[n]);
  const fn = { getItem: pick("getItem"), setItem: pick("setItem"), removeItem: pick("removeItem"), clear: pick("clear") };
  for (const n of Object.keys(fn)) if (typeof fn[n] !== "function") throw new Error("localStorage has no " + n);
  const lenDesc = Object.getOwnPropertyDescriptor(proto, "length");
  const lenGet = lenDesc && typeof lenDesc.get === "function" ? lenDesc.get : null;
  return {
    get: (k) => fn.getItem.call(ls, k),
    set: (k, v) => fn.setItem.call(ls, k, v),
    remove: (k) => fn.removeItem.call(ls, k),
    clear: () => fn.clear.call(ls),
    length: () => (lenGet ? lenGet.call(ls) : ls.length),
    canShadowLength: !!lenGet
  };
}

class Keeper {
  constructor(ls, opts) {
    this.ls = ls;
    this.log = typeof opts.log === "function" ? opts.log : () => {};
    this.known = Array.isArray(opts.knownKeys) ? opts.knownKeys : [];
    this.now = typeof opts.now === "function" ? opts.now : () => Date.now();
    this.engine = captureEngine(ls);
    this.rootKey = ROOT_KEY;
    this.cacheText = null;
    this.cacheRoot = null;
    this.cachePublic = null;
    this.foreign = false;
    this.blocked = false;
    this.folded = [];
    this.sync = true; // start-up writes go straight to the engine; after patch() they are coalesced per task
    this.pending = null;
  }

  // ---- the real row ---------------------------------------------------------------------------------------------

  /**
   * Row 1 as the keeper's root, parsed and cached by text. The root always carries the keeper's mark; a row 1
   * without it is another mod's row written raw since start-up, and the keeper refuses to build on it (reads null,
   * writes refused) rather than copy it over the root. The next launch's start-up scan deals with it.
   */
  readRoot() {
    if (this.pending) return this.pending;
    let text = null;
    try {
      text = this.engine.get(this.rootKey);
      if (!text) text = this.engine.get(this.rootKey);
    } catch (e) {
      this.log("error", "read failed: " + e);
      this.foreign = true;
      return null;
    }
    if (!text) return this.setCache(null, {});
    if (text === this.cacheText) return this.cacheRoot;
    const obj = parse(text);
    if (isPlainObject(obj) && isPlainObject(obj[MARK_KEY])) return this.setCache(text, obj);
    if (!this.foreign) this.log("error", "row 1 is not the keeper's root; reads empty and writes refused until the next launch");
    this.foreign = true;
    return null;
  }

  setCache(text, root) {
    this.cacheText = text;
    this.cacheRoot = root;
    this.cachePublic = null;
    this.foreign = false;
    return root;
  }

  /** The public part of the root as JSON, or null when there are no slices; cached until the row changes. */
  publicText(root) {
    if (this.cachePublic === null) {
      const view = withoutInternals(root);
      this.cachePublic = Object.keys(view).length ? JSON.stringify(view) : "";
    }
    return this.cachePublic || null;
  }

  /**
   * Serialising a root of several hundred KB costs milliseconds, so after start-up a write only updates the root in
   * hand and queues one engine write for the end of the current task: a burst of writes (a chunked backup) costs one
   * serialisation, and reads in between see the new values. Nothing else can run before the queued write lands.
   */
  writeRoot(root) {
    if (!isPlainObject(root[MARK_KEY])) root[MARK_KEY] = { v: VERSION, root: this.rootKey, since: this.now() };
    else root[MARK_KEY].root = this.rootKey;
    if (this.sync) return this.flushRoot(root);
    const queued = !!this.pending;
    this.pending = root;
    this.cachePublic = null;
    if (!queued) Promise.resolve().then(() => this.flush());
  }

  flush() {
    const root = this.pending;
    if (!root) return;
    this.pending = null;
    this.flushRoot(root);
  }

  flushRoot(root) {
    const text = JSON.stringify(root);
    this.engine.set(this.rootKey, text);
    this.setCache(text, root);
  }

  /** Whether row 1 (whose text is given) is stored under `key`: rewriting it with its own text leaves length as is. */
  probeIs(key, text) {
    const before = this.engine.length();
    this.engine.set(key, text);
    if (this.engine.length() === before) return true;
    this.engine.remove(key);
    return false;
  }

  // ---- start-up: make the root row 1 --------------------------------------------------------------------------

  identify(obj, text) {
    for (const k of this.known) if (safeMatch(k, obj, text) && this.probeIs(k.key, text)) return k.key;
    return null;
  }

  finishFold() {
    if (!this.folded.length) return;
    const root = this.readRoot() || {};
    const virt = isPlainObject(root[VIRTUAL_KEY]) ? root[VIRTUAL_KEY] : {};
    for (const [k, v] of this.folded) virt[k] = v;
    root[VIRTUAL_KEY] = virt;
    this.writeRoot(root);
    this.log("warn", "folded " + this.folded.map(([k]) => k).join(", ") + " into the root");
  }

  /** Row 1 cannot be named: write the root under the lowest key and copy what the row holds, never touching it. */
  blockedMode(text) {
    this.blocked = true;
    this.rootKey = FALLBACK_ROOT_KEY;
    const root = this.rootFromUnnamed(text);
    this.writeRoot(root);
    const copied = Object.keys(root).length - 2;
    this.log("error", "row 1 (" + text.length + " bytes) could not be named and " + (this.engine.length() - 1) +
      " more rows hide behind it; root written under the lowest key, " + copied + " slices copied, the row kept as a copy");
  }

  /** One fold step: true when the root is row 1, false when stopped in blocked mode, null to go on. */
  foldStep() {
    const text = this.engine.get(ROOT_KEY);
    if (text == null) return true;
    const obj = parse(text);
    if (this.adoptMarked(obj, text)) return true;
    const k = this.identify(obj, text);
    if (k) {
      this.folded.push([k, text]);
      this.engine.remove(k);
      this.log("warn", "moved row " + JSON.stringify(k) + " (" + text.length + " bytes) out of the way");
      return null;
    }
    // an unmarked settings root is only probed when nothing can be hidden behind it
    if (looksLikeRoot(obj) && this.engine.length() === 1 && this.probeIs(ROOT_KEY, text)) return this.adopt(ROOT_KEY);
    // a lone row that cannot be named has nothing behind it: its text is in hand, so the store can be rebuilt
    if (this.engine.length() === 1) {
      this.collapseLoneRow(text);
      return true;
    }
    this.blockedMode(text);
    return false;
  }

  /** The only row left cannot be named: keep its slices and its text in a normal root, drop the nameless row. */
  collapseLoneRow(text) {
    this.engine.clear();
    this.rootKey = ROOT_KEY;
    this.blocked = false;
    this.writeRoot(this.rootFromUnnamed(text));
    this.log("warn", "the one row left (" + text.length + " bytes) could not be named; its slices and text were kept " +
      "and the store rebuilt as modSettings");
  }

  /** A root built from an unnamed row: its object-valued entries as slices, its text under __blocked. */
  rootFromUnnamed(text) {
    const obj = parse(text);
    const root = isPlainObject(obj) ? withoutInternals(obj) : {};
    for (const k of Object.keys(root)) if (!isPlainObject(root[k])) delete root[k];
    const virt = isPlainObject(obj) && isPlainObject(obj[VIRTUAL_KEY]) ? Object.assign({}, obj[VIRTUAL_KEY]) : {};
    for (const [k, v] of this.folded) virt[k] = v;
    root[VIRTUAL_KEY] = virt;
    root[BLOCKED_KEY] = { at: this.now(), bytes: text.length, value: text.slice(0, BLOCKED_COPY_LIMIT) };
    return root;
  }

  /** Row 1 carries the keeper's mark: confirm its key and adopt it. */
  adoptMarked(obj, text) {
    const mark = isPlainObject(obj) ? obj[MARK_KEY] : null;
    if (!isPlainObject(mark)) return false;
    const rk = mark.root === FALLBACK_ROOT_KEY ? FALLBACK_ROOT_KEY : ROOT_KEY;
    return this.probeIs(rk, text) ? this.adopt(rk) : false;
  }

  adopt(rootKey) {
    this.rootKey = rootKey;
    this.blocked = rootKey === FALLBACK_ROOT_KEY;
    const root = this.readRootAny();
    if (root && !isPlainObject(root[MARK_KEY])) this.writeRoot(root);
    return true;
  }

  /** Row 1 parsed without the mark requirement; start-up only. */
  readRootAny() {
    const obj = parse(this.engine.get(this.rootKey));
    return isPlainObject(obj) ? obj : null;
  }

  locate() {
    if (this.engine.length() === 0) return;
    for (let i = 0; i < MAX_FOLD_STEPS; i++) {
      const r = this.foldStep();
      if (r === true) {
        this.finishFold();
        if (this.blocked) this.tryToLeaveBlockedMode();
        this.tidy();
        return;
      }
      if (r === false) return;
    }
    this.blockedMode(this.engine.get(ROOT_KEY) || "");
  }

  /**
   * In fallback mode the rows behind the root are the ones that could not be named last time. Lift the root (its
   * text is in hand), look at what is behind it with the current key list, and if everything can be named or the
   * way is clear, move back to "modSettings": the slices found there are kept, the fallback root's newer slices win.
   */
  tryToLeaveBlockedMode() {
    const ours = this.engine.get(FALLBACK_ROOT_KEY);
    const ourRoot = parse(ours);
    if (!ours || !isPlainObject(ourRoot)) return;
    this.engine.remove(FALLBACK_ROOT_KEY);
    const way = this.peelBehind();
    if (!way.clear) {
      this.engine.set(FALLBACK_ROOT_KEY, ours);
      for (const [k, v] of way.pulled) this.setVirtual(k, v);
      return;
    }
    this.migrateToRoot(ourRoot, way);
  }

  /** Name and lift the rows behind a lifted fallback root. clear: the way to "modSettings" is open. */
  peelBehind() {
    const pulled = [];
    for (let i = 0; i < MAX_FOLD_STEPS; i++) {
      const text = this.engine.get(ROOT_KEY);
      if (text == null) return { clear: true, pulled, behind: null };
      const obj = parse(text);
      const k = this.identify(obj, text);
      if (k) {
        pulled.push([k, text]);
        this.engine.remove(k);
        continue;
      }
      if (this.engine.length() !== 1) return { clear: false, pulled, behind: null };
      if (looksLikeRoot(obj) && this.probeIs(ROOT_KEY, text)) return { clear: true, pulled, behind: obj };
      this.engine.clear();
      return { clear: true, pulled, behind: this.rootFromUnnamed(text) };
    }
    return { clear: false, pulled, behind: null };
  }

  migrateToRoot(ourRoot, way) {
    this.rootKey = ROOT_KEY;
    this.blocked = false;
    const behind = way.behind;
    const merged = behind ? withoutInternals(behind) : {};
    Object.assign(merged, withoutInternals(ourRoot));
    const behindVirt = behind && isPlainObject(behind[VIRTUAL_KEY]) ? behind[VIRTUAL_KEY] : {};
    const virt = Object.assign({}, behindVirt, ourRoot[VIRTUAL_KEY] || {});
    for (const [k, v] of way.pulled) virt[k] = v;
    merged[VIRTUAL_KEY] = virt;
    merged[MARK_KEY] = { v: VERSION, root: ROOT_KEY, since: this.now() };
    this.writeRoot(merged);
    const moved = way.pulled.length ? ", moved " + way.pulled.map(([k]) => k).join(", ") : "";
    this.log("warn", "left fallback mode: root is modSettings again" + moved);
  }

  /**
   * Housekeeping once the root is row 1: a kept copy of an unnamed row whose key is known by now moves under
   * that key; raw rows hiding behind the root for keys the root already holds (older, unreadable by anyone) are
   * removed, so the real store is one row and the "clear() when length > 1" helpers stay quiet even if the keeper
   * is removed later. removeItem is keyed, so this reads nothing.
   */
  tidy() {
    const root = this.readRootAny();
    if (!root) return;
    if (this.reclaimBlocked(root)) this.writeRoot(root);
    if (this.engine.length() > 1 && !this.blocked) this.dropStaleRows(root);
  }

  /** @returns {boolean} Whether the kept copy of an unnamed row was moved under a key known by now. */
  reclaimBlocked(root) {
    const blocked = root[BLOCKED_KEY];
    if (!isPlainObject(blocked) || typeof blocked.value !== "string") return false;
    const obj = parse(blocked.value);
    const hits = this.known.filter((e) => safeMatch(e, obj, blocked.value));
    const virt = isPlainObject(root[VIRTUAL_KEY]) ? root[VIRTUAL_KEY] : (root[VIRTUAL_KEY] = {});
    // a mod whose data is already held is not missing anything: the copy is a stray duplicate, not its lost row
    if (!hits.length || hits.some((e) => virt[e.key] !== undefined)) return false;
    const hit = hits[0];
    virt[hit.key] = blocked.value;
    delete root[BLOCKED_KEY];
    this.log("warn", "the kept copy of an unnamed row is " + JSON.stringify(hit.key) + " now; moved under that key");
    return true;
  }

  dropStaleRows(root) {
    const held = isPlainObject(root[VIRTUAL_KEY]) ? Object.keys(root[VIRTUAL_KEY]) : [];
    const before = this.engine.length();
    for (const k of held) if (!this.isRootName(k)) this.engine.remove(k);
    const gone = before - this.engine.length();
    if (gone) this.log("warn", "removed " + gone + " stale row(s) hiding behind the root");
    const left = this.engine.length() - 1;
    if (left > 0) this.log("warn", left + " unreadable row(s) of unknown keys remain behind the root");
  }

  /** Write one virtual key through the normal path (start-up helper). */
  setVirtual(k, v) {
    this.setCache(null, null);
    this.setItem(k, v);
  }

  // ---- the virtual store ------------------------------------------------------------------------------------------

  isRootName(k) {
    return k === ROOT_KEY || k === this.rootKey;
  }

  getItem(k) {
    const key = String(k);
    const root = this.readRoot();
    if (!root) return null;
    if (this.isRootName(key)) return this.publicText(root);
    const virt = root[VIRTUAL_KEY];
    const v = isPlainObject(virt) ? virt[key] : undefined;
    return typeof v === "string" ? v : null;
  }

  setItem(k, v) {
    const key = String(k);
    const text = String(v);
    const root = this.readRoot();
    if (!root) return this.log("error", "write of " + JSON.stringify(key) + " refused: store unreadable");
    if (this.isRootName(key)) return this.setRoot(root, text);
    const virt = isPlainObject(root[VIRTUAL_KEY]) ? root[VIRTUAL_KEY] : {};
    virt[key] = text;
    root[VIRTUAL_KEY] = virt;
    this.writeRoot(root);
  }

  /** A write of "modSettings": the public slices are replaced, the keeper's fields carried over. */
  setRoot(root, text) {
    const parsed = parse(text);
    if (!isPlainObject(parsed)) return this.log("error", "write of modSettings refused: not a JSON object");
    const next = withoutInternals(parsed);
    for (const ik of INTERNAL) if (root[ik] !== undefined) next[ik] = root[ik];
    this.writeRoot(next);
  }

  removeItem(k) {
    const key = String(k);
    const root = this.readRoot();
    if (!root) return;
    if (this.isRootName(key)) {
      const next = {};
      for (const ik of INTERNAL) if (root[ik] !== undefined) next[ik] = root[ik];
      this.writeRoot(next);
      return;
    }
    if (isPlainObject(root[VIRTUAL_KEY]) && key in root[VIRTUAL_KEY]) {
      delete root[VIRTUAL_KEY][key];
      this.writeRoot(root);
    }
  }

  /**
   * The player's way out of fallback mode: drop the rows that could not be named, keep everything the keeper holds
   * (every slice and every key), and write it all back as the one normal row.
   * @returns {{removedRows: number, keptSlices: number, keptKeys: number}}
   */
  rebuild() {
    const root = this.readRoot() || {}; // includes a write still queued for this task
    this.pending = null;
    const removedRows = Math.max(0, this.engine.length() - 1);
    this.engine.clear();
    this.setCache(null, null);
    this.blocked = false;
    this.rootKey = ROOT_KEY;
    const kept = Object.assign({}, root);
    delete kept[MARK_KEY];
    this.flushRoot(kept);
    const keptSlices = Object.keys(withoutInternals(kept)).length;
    const keptKeys = isPlainObject(kept[VIRTUAL_KEY]) ? Object.keys(kept[VIRTUAL_KEY]).length : 0;
    this.log("warn", "rebuilt: " + removedRows + " unnamed row(s) dropped, " + keptSlices + " slices and " + keptKeys + " keys kept");
    return { removedRows, keptSlices, keptKeys };
  }

  /** Empties the real store and rewrites the root with the other mods' keys kept; also leaves blocked mode. */
  clear() {
    const root = this.readRoot(); // includes a write still queued for this task
    this.pending = null;
    const virt = root && isPlainObject(root[VIRTUAL_KEY]) ? root[VIRTUAL_KEY] : {};
    this.engine.clear();
    this.setCache(null, null);
    this.blocked = false;
    this.rootKey = ROOT_KEY;
    const next = {};
    if (Object.keys(virt).length) next[VIRTUAL_KEY] = virt;
    this.writeRoot(next);
    this.log("warn", "store cleared; root rewritten with " + Object.keys(virt).length + " kept keys");
  }

  /** Always null, exactly as the engine answers: a "list every key and remove it" loop stays the no-op it has been. */
  key(_i) {
    return null;
  }

  length() {
    return this.engine.length() > 0 ? 1 : 0;
  }

  // ---- patch -----------------------------------------------------------------------------------------------------

  status() {
    this.flush();
    const root = this.readRoot();
    const virt = root && isPlainObject(root[VIRTUAL_KEY]) ? Object.keys(root[VIRTUAL_KEY]) : [];
    return {
      version: VERSION,
      rootKey: this.rootKey,
      blocked: this.blocked,
      foreign: this.foreign,
      rows: this.engine.length(),
      lengthShadowed: this.engine.canShadowLength,
      folded: this.folded.map(([k]) => k),
      virtualKeys: virt,
      slices: root ? Object.keys(withoutInternals(root)) : [],
      blockedBytes: root && root[BLOCKED_KEY] ? root[BLOCKED_KEY].bytes : 0
    };
  }

  patch() {
    const ls = this.ls;
    const def = (n, value) =>
      Object.defineProperty(ls, n, { value, writable: true, configurable: true, enumerable: false });
    for (const n of ["getItem", "setItem", "removeItem", "clear", "key"]) def(n, this[n].bind(this));
    if (this.engine.canShadowLength) {
      Object.defineProperty(ls, "length", { get: () => this.length(), configurable: true, enumerable: false });
    }
    const api = {
      build: BUILD, status: () => this.status(), uninstall: () => this.uninstall(), engine: this.engine,
      rootKey: () => this.rootKey, flush: () => this.flush(), rebuild: () => this.rebuild()
    };
    def("__settingsKeeper", api);
    this.sync = false;
    return api;
  }

  uninstall() {
    this.flush();
    this.sync = true;
    for (const n of ["getItem", "setItem", "removeItem", "clear", "key", "length", "__settingsKeeper"]) delete this.ls[n];
  }
}

/**
 * Install the keeper on a Storage-like object. Idempotent: a second call returns the first keeper.
 * @param {Storage} ls The engine's localStorage.
 * @param {{log?: Function, knownKeys?: Array<{key: string, match: Function}>, now?: Function}} [opts]
 * @returns {object|null} The keeper's API, or null when there is nothing to patch.
 */
export function install(ls, opts = {}) {
  if (!ls) return null;
  const current = ls.__settingsKeeper;
  if (current) {
    // several mods may carry this file; the newest build wins, an older one hands over after landing its writes
    if (!(typeof current.build === "number" && current.build < BUILD)) return current;
    if (typeof current.flush === "function") current.flush();
    if (typeof current.uninstall === "function") current.uninstall();
  }
  const keeper = new Keeper(ls, opts);
  keeper.locate();
  return keeper.patch();
}

// ---- keys other mods write on their own, with a content check for each -------------------------------------------
// At start the keeper may find a foreign row sorting before "modSettings". It can only move that row if it knows the
// row's key (removeItem is keyed; nothing enumerates). Each entry names a key and a strict check of the row's parsed
// content; only when the check passes is the key tried, because trying a key the row does not belong to would
// overwrite a hidden row of that name. Keys whose content cannot be recognised are left out on purpose: an
// unrecognised row puts the keeper into its fallback mode rather than risk another mod's data. Where two keys share a
// shape, the one that sorts first is listed first, since it would be row 1.

const obj = (o) => !!o && typeof o === "object" && !Array.isArray(o);

/** ozq Chronicle's own store (pre-0.31) and History & Rankings' store hold the same {v, updated, games} archive. */
const archive = (o) => obj(o) && typeof o.v === "number" && "updated" in o && obj(o.games);

/** AutoMissionary's settings: flat booleans. */
const autoMissionary = (o) => obj(o) && "autoSpread" in o && "targetCityStates" in o && "ignoreAsleep" in o;

export const KNOWN_KEYS = [
  { key: "!chronicle", match: archive },
  { key: "AutoMissionary.settings.v1", match: autoMissionary },
  { key: "AutoMissionary.settings.v2", match: autoMissionary },
  { key: "htlData", match: archive },
  { key: "tmt-compact-policy-cards", match: (o) => obj(o) && obj(o._settings) && Object.keys(o).every((k) => k === "_settings" || obj(o[k])) }
];

// ---- self-install: main menu and game alike -----------------------------------------------------------------------
// The mod loader does not promise script order, so a mod that reads localStorage at module load before this ran saw
// the engine's answer once; every call after this goes through the keeper, including calls on a reference captured
// earlier, because the object is patched in place rather than replaced.
const TAG = "[settings-keeper]";

function log(level, msg) {
  try {
    (level === "error" ? console.error : console.warn)(TAG + " " + msg);
  } catch (_) {
    /* no console */
  }
}

try {
  const ls = typeof localStorage !== "undefined" ? localStorage : null;
  const api = install(ls, { log, knownKeys: KNOWN_KEYS });
  if (!api) log("error", "no localStorage in this context");
  else {
    const s = api.status();
    log("warn", "ready: root " + JSON.stringify(s.rootKey) + ", rows " + s.rows + ", slices " + s.slices.length +
      ", keys kept " + s.virtualKeys.length + (s.folded.length ? ", moved " + s.folded.join(", ") : "") +
      (s.blocked ? ", BLOCKED by an unnamed row of " + s.blockedBytes + " bytes" : "") + (s.lengthShadowed ? "" : ", length not shadowed"));
    try {
      window.SettingsKeeper = api;
    } catch (_) {
      /* no window */
    }
  }
} catch (e) {
  log("error", "install failed: " + e);
}
