// Regression test for the shared-localStorage "cannibalization" bug: Demographics must NEVER drop
// another mod's slice of the shared `modSettings` blob, even when Coherent hands back a flaky-empty
// read or another mod left an unparseable value. Each scenario installs a fresh fake localStorage
// and re-imports the (cache-busted) settings singleton so its load-time seed runs against it.
import assert from "node:assert/strict";

const SIB = "sib-classic-leader-screens";

/**
 * A minimal localStorage double. `flakyEmptyOnce` makes the next `getItem(modSettings)` return null
 * once (simulating Coherent's transient wiped read) so we can prove the clobber guard re-reads.
 * @param {Record<string, string>} initial Initial key→raw-string entries.
 */
function makeLocalStorage(initial) {
  const store = new Map(Object.entries(initial));
  return {
    flakyEmptyOnce: false,
    /** @param {string} k */
    getItem(k) {
      if (this.flakyEmptyOnce && k === "modSettings") {
        this.flakyEmptyOnce = false;
        return null;
      }
      return store.has(k) ? store.get(k) : null;
    },
    /** @param {string} k @param {string} v */
    setItem(k, v) {
      store.set(k, v);
    },
    /** @param {string} k */
    removeItem(k) {
      store.delete(k);
    },
    /** @param {number} i */
    key(i) {
      return [...store.keys()][i] ?? null;
    },
    get length() {
      return store.size;
    }
  };
}

/** Fresh settings singleton bound to the given localStorage (cache-busted per scenario). @param {number} n */
async function loadSettings(n) {
  return (await import(`../ui/core/demographics-settings.js?clobber=${n}`)).default;
}

// ── Scenario 1: a normal write preserves the sibling slice and updates ours. ──────────────────────
let ls = makeLocalStorage({
  modSettings: JSON.stringify({ [SIB]: { enabled: true, magic: 42 }, demographics: { smoothChart: false } })
});
globalThis.localStorage = ls;
let settings = await loadSettings(1);
settings.setSetting("smoothChart", true);
let blob = JSON.parse(ls.getItem("modSettings"));
assert.deepEqual(blob[SIB], { enabled: true, magic: 42 }, "sibling slice must survive a normal write");
assert.equal(blob.demographics.smoothChart, true, "our slice must be updated");

// ── Scenario 2: a flaky-empty first read must NOT cause us to clobber the sibling. ────────────────
ls = makeLocalStorage({
  modSettings: JSON.stringify({ [SIB]: { enabled: true, magic: 7 }, demographics: { smoothChart: false } })
});
globalThis.localStorage = ls;
settings = await loadSettings(2);
ls.flakyEmptyOnce = true; // the NEXT modSettings read returns null, as Coherent sometimes does
settings.setSetting("smoothChart", true);
blob = JSON.parse(ls.getItem("modSettings"));
assert.deepEqual(blob[SIB], { enabled: true, magic: 7 }, "flaky read must not wipe the sibling slice");
assert.equal(blob.demographics.smoothChart, true, "our slice must still persist after a re-read");

// ── Scenario 3: an unparseable shared value must make us REFUSE to write (siblings preserved). ────
ls = makeLocalStorage({ modSettings: "{ this is not valid json" });
globalThis.localStorage = ls;
settings = await loadSettings(3);
settings.setSetting("smoothChart", true);
assert.equal(
  ls.getItem("modSettings"),
  "{ this is not valid json",
  "an unparseable shared blob must be left untouched, never overwritten"
);
assert.equal(settings.getSetting("smoothChart", false), true, "the value still lives in memory for this session");

// ── Scenario 4: a genuinely-empty store still lets us persist our slice (first run). ──────────────
ls = makeLocalStorage({});
globalThis.localStorage = ls;
settings = await loadSettings(4);
settings.setSetting("smoothChart", true);
blob = JSON.parse(ls.getItem("modSettings"));
assert.equal(blob.demographics.smoothChart, true, "first-run persistence must still work on an empty store");

// ── Scenario 5: a FOREIGN blob (valid JSON, but not a settings root) must not be written back. ───
// Coherent's getItem ignores the key and returns the FIRST key in the store, so a read of
// modSettings routinely hands back some other mod's archive. It parses fine, so the JSON check
// alone lets it through — and writing it back copies that archive into the shared settings key.
const FOREIGN = JSON.stringify({
  v: 2,
  updated: 1784329667306,
  games: { "SETUPHASH_-762842782": { fp: { seed: -762842782, setup: "SETUPHASH" }, ages: {} } }
});
ls = makeLocalStorage({ modSettings: FOREIGN });
globalThis.localStorage = ls;
settings = await loadSettings(5);
settings.setSetting("smoothChart", true);
assert.equal(
  ls.getItem("modSettings"),
  FOREIGN,
  "a foreign (non-settings-root) blob must be left byte-identical, never appended to or rewritten"
);
assert.equal(
  settings.getSetting("smoothChart", false),
  true,
  "the value still lives in memory for this session"
);

// A real settings root whose slices are objects must still persist normally.
ls = makeLocalStorage({ modSettings: JSON.stringify({ [SIB]: { enabled: true } }) });
globalThis.localStorage = ls;
settings = await loadSettings(6);
settings.setSetting("smoothChart", true);
blob = JSON.parse(ls.getItem("modSettings"));
assert.equal(blob.demographics.smoothChart, true, "a genuine settings root must still be writable");
assert.deepEqual(blob[SIB], { enabled: true }, "sibling slice preserved");

// ── Scenario 7: getItem throws while setItem works. That is NOT an empty store. ──────────────────
ls = makeLocalStorage({ modSettings: JSON.stringify({ [SIB]: { enabled: true } }) });
const throwing = Object.assign(Object.create(ls), {
  getItem() {
    throw new Error("getItem unavailable in this context");
  }
});
globalThis.localStorage = throwing;
settings = await loadSettings(7);
settings.setSetting("smoothChart", true);
assert.equal(ls.getItem("modSettings"), JSON.stringify({ [SIB]: { enabled: true } }), "a throwing read must not lead to a write");
assert.equal(settings.persistenceStatus(), "read-failed", "the Options footer learns why");
assert.equal(settings.getSetting("smoothChart", false), true, "memory still serves the value");

// ── Scenario 8: empty reads from a store that holds rows: refused, not overwritten. ───────────────
ls = makeLocalStorage({ modSettings: JSON.stringify({ [SIB]: { enabled: true } }) });
globalThis.localStorage = Object.assign(Object.create(ls), { getItem: () => null });
settings = await loadSettings(8);
settings.setSetting("smoothChart", true);
assert.equal(ls.getItem("modSettings"), JSON.stringify({ [SIB]: { enabled: true } }), "rows present + empty read = no write");
assert.equal(settings.persistenceStatus(), "read-failed");

// ── Scenario 9: the store answers correctly until our write lands, then the read-back returns
//    another key's value (a first-sorting key appeared, or the first-key bug): one write, then the
//    session goes read-only instead of copying the foreign value on every later toggle. ───────────
{
  const rows = new Map([["modSettings", JSON.stringify({ [SIB]: { enabled: true } })]]);
  let writes = 0;
  globalThis.localStorage = {
    getItem: (k) => (writes > 0 ? FOREIGN : (rows.get(k) ?? null)),
    setItem: (k, v) => {
      writes += 1;
      rows.set(k, String(v));
    },
    removeItem: (k) => void rows.delete(k),
    key: () => null,
    get length() {
      return rows.size;
    }
  };
  settings = await loadSettings(9);
  settings.setSetting("smoothChart", true);
  settings.setSetting("smoothChart", false);
  settings.setSetting("smoothChart", true);
  assert.equal(writes, 1, "exactly one write before the failed read-back turns persistence off");
  assert.equal(settings.persistenceStatus(), "unverified");
  const written = JSON.parse(rows.get("modSettings"));
  assert.deepEqual(written[SIB], { enabled: true }, "the one write still carried the sibling slice");
}

// ── Scenario 10: a slice stamped by a NEWER build keeps its stamp. ────────────────────────────────
ls = makeLocalStorage({ modSettings: JSON.stringify({ demographics: { __schema: 2, futureKey: "x", smoothChart: false } }) });
globalThis.localStorage = ls;
settings = await loadSettings(10);
settings.setSetting("smoothChart", true);
blob = JSON.parse(ls.getItem("modSettings"));
assert.equal(blob.demographics.__schema, 2, "a newer schema stamp is never lowered");
assert.equal(blob.demographics.futureKey, "x", "unknown keys from the newer build are preserved");
assert.equal(blob.demographics.smoothChart, true);

// ── Scenario 11: an array under our id is not a slice; it is ignored, not spread into keys. ───────
ls = makeLocalStorage({ modSettings: JSON.stringify({ demographics: ["a", "b"], [SIB]: { enabled: true } }) });
globalThis.localStorage = ls;
settings = await loadSettings(11);
assert.equal(settings.getSetting("0", "none"), "none", "array entries never become settings keys");
assert.equal(settings.persistenceStatus(), "ok");

// ── Scenario 12: another mod's key is the only row and the store ENUMERATES (a correct engine): the
//    empty read is a genuinely absent key, so the first write goes through. ──────────────────────
ls = makeLocalStorage({ "some-other-mod": JSON.stringify({ x: 1 }) });
globalThis.localStorage = ls;
settings = await loadSettings(12);
settings.setSetting("smoothChart", true);
assert.ok(ls.getItem("modSettings"), "a legitimately absent key on an enumerable store is created");
assert.equal(ls.getItem("some-other-mod"), JSON.stringify({ x: 1 }), "the other row is untouched");
assert.equal(settings.persistenceStatus(), "ok");

// ── Scenario 13: same rows but key(i) is null (1.5.0 cannot enumerate) and the read is empty: that
//    read cannot be trusted, so nothing is written. ─────────────────────────────────────────────
ls = makeLocalStorage({ "some-other-mod": JSON.stringify({ x: 1 }) });
globalThis.localStorage = Object.assign(Object.create(ls), { key: () => null, getItem: () => null });
settings = await loadSettings(13);
settings.setSetting("smoothChart", true);
assert.equal(ls.getItem("modSettings"), null, "no write on an unenumerable populated store");
assert.equal(settings.persistenceStatus(), "read-failed");

// ── Scenario 14: an array under our id is not a settings slice; the root is refused (foreign) and
//    left byte-identical rather than having the array spread into numeric keys. ──────────────────
const ARRAY_ROOT = JSON.stringify({ demographics: ["a", "b"] });
ls = makeLocalStorage({ modSettings: ARRAY_ROOT });
globalThis.localStorage = ls;
settings = await loadSettings(14);
settings.setSetting("smoothChart", true);
assert.equal(ls.getItem("modSettings"), ARRAY_ROOT, "an array slice is never spread or rewritten");
assert.equal(settings.persistenceStatus(), "foreign");
assert.equal(settings.getSetting("smoothChart", false), true, "memory still serves the value");

delete globalThis.localStorage;
console.log("settings-clobber harness passed (sibling slices preserved across flaky / unparseable / empty / foreign / throwing reads; read-back verified; newer schema kept)");
