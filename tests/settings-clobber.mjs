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

delete globalThis.localStorage;
console.log("settings-clobber harness passed (sibling slices preserved across flaky / unparseable / empty / foreign reads)");
