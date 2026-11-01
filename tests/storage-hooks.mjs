import assert from "node:assert/strict";

// The storage singleton installs one engine flush hook, BeforeUnload, and teardown removes exactly
// that one. The hidden persistence mode that used to add a BeforeAgeTransition hook is retired.

const { DemographicsStorage } = await import("/demographics/ui/storage/demographics-storage.js");

const on = [];
const off = [];
globalThis.engine = {
  on: (name, fn) => on.push({ name, fn }),
  off: (name, fn) => off.push({ name, fn })
};
globalThis.Configuration = {
  getGame: () => ({ startSeed: "seed-hooks", getValue: () => null }),
  editGame: () => ({ setValue: () => {} })
};
globalThis.Database = { makeHash: (s) => s };

DemographicsStorage.load();
DemographicsStorage.load();
assert.deepEqual(
  on.map((h) => h.name),
  ["BeforeUnload"],
  "exactly one engine hook, BeforeUnload, and only once across loads"
);

DemographicsStorage.teardown();
assert.equal(off.length, 1, "teardown removes one hook");
assert.equal(off[0].name, "BeforeUnload");
assert.equal(off[0].fn, on[0].fn, "the hook removed is the one installed");

DemographicsStorage.load();
assert.equal(on.length, 2, "after teardown the next load installs the hook again");
assert.equal(on[1].name, "BeforeUnload");

console.log("storage-hooks harness passed");
