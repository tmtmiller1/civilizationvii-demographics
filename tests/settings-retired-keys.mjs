// Keys an older build wrote and nothing reads any more (`townTrendBuf`, `persistenceMode`) leave the
// stored slice on the first settings write, while any other unknown key in the slice survives.
import assert from "node:assert/strict";

/** @param {Record<string, string>} initial */
function makeLocalStorage(initial) {
  const store = new Map(Object.entries(initial));
  return {
    /** @param {string} k */
    getItem(k) {
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

const ls = makeLocalStorage({
  modSettings: JSON.stringify({
    "other-mod": { enabled: true },
    demographics: {
      smoothChart: false,
      townTrendBuf: { "3,4": [{ t: 1, pop: 2 }] },
      persistenceMode: "legacy_tutorial_bag",
      someFutureKey: { kept: true }
    }
  })
});
globalThis.localStorage = ls;
const settings = (await import("../ui/core/demographics-settings.js?retired=1")).default;

assert.equal(settings.getSetting("townTrendBuf", "absent"), "absent", "retired key never enters memory");
assert.equal(settings.getSetting("persistenceMode", "absent"), "absent", "retired key never enters memory");

settings.setSetting("smoothChart", true);
const root = JSON.parse(ls.getItem("modSettings"));
assert.deepEqual(root["other-mod"], { enabled: true }, "sibling slice untouched");
assert.equal(root.demographics.smoothChart, true);
assert.equal("townTrendBuf" in root.demographics, false, "townTrendBuf is gone after one write");
assert.equal("persistenceMode" in root.demographics, false, "persistenceMode is gone after one write");
assert.deepEqual(root.demographics.someFutureKey, { kept: true }, "an unknown key is kept");

// Writing a retired key on purpose does not bring it back either.
settings.setSettings({ townTrendBuf: { x: 1 }, activeView: "rankings" });
const again = JSON.parse(ls.getItem("modSettings"));
assert.equal("townTrendBuf" in again.demographics, false, "a retired key written by hand is dropped");
assert.equal(again.demographics.activeView, "rankings");

delete globalThis.localStorage;
console.log("settings-retired-keys harness passed");
