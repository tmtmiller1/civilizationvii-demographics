import assert from "node:assert/strict";

import { loadEmpty, loadParsed, readRaw, rejectedKey } from "/demographics/ui/storage/storage-load.js";
import { emptyHistory, isValid, normalize } from "/demographics/ui/storage/storage-schema.js";
import { serializePayload, writeStorePayload } from "/demographics/ui/storage/storage-retention.js";

const KEY = "json";
/** Unversioned slot: JSON garbage with no readable version. */
const REJECTED = rejectedKey(KEY);
/** Per-version slots: `<key>__rejected_v<N>`. */
const REJECTED_V1 = rejectedKey(KEY, 1);
const REJECTED_V2 = rejectedKey(KEY, 2);

function mkHistory(seed = "seed-a") {
  return {
    version: 1,
    seed,
    samples: [{ turn: 1, age: "AGE_ANTIQUITY" }],
    ageBoundaries: [],
    eliminated: {}
  };
}

/** Map-backed stand-in for the GameConfiguration store ({ pid, read, write }). */
function mkStore(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    pid: 1,
    map,
    read: (k) => (map.has(k) ? map.get(k) : null),
    write: (k, v) => map.set(k, v)
  };
}

function mkOptions(raw, extra = {}) {
  return {
    raw,
    mem: null,
    seed: "seed-a",
    version: 1,
    store: { pid: 1 },
    payloadKey: KEY,
    emptyHistory,
    isValid,
    normalize,
    preferMemWhenNewer: (parsed) => parsed,
    dlog: () => {},
    derr: () => {},
    ...extra
  };
}

function mkEmptyOptions(store, extra = {}) {
  return {
    mem: null,
    seed: "seed-a",
    version: 1,
    store,
    payloadKey: KEY,
    emptyHistory,
    isValid,
    normalize,
    dlog: () => {},
    derr: () => {},
    ...extra
  };
}

function testReadRawCatchesThrow() {
  const v = readRaw({ read: () => { throw new Error("boom"); } }, "json", () => {});
  assert.equal(v, null, "readRaw should swallow read errors");
}

function testLoadParsedHandlesMalformedJson() {
  const mem = mkHistory("seed-a");
  const out = loadParsed(mkOptions("{not-json", { mem }));
  assert.equal(out, mem, "malformed payload should recover from memory");
}

function testLoadParsedRejectsInvalidShape() {
  const empty = loadParsed(mkOptions(JSON.stringify({ version: 99, seed: "seed-a", samples: [] })));
  assert.equal(empty.version, 1, "invalid shape should reset to empty history");
  assert.equal(empty.samples.length, 0, "invalid shape reset should not keep samples");
}

function testLoadParsedRespectsSeedMismatchWithMatchingMem() {
  const mem = mkHistory("seed-a");
  const out = loadParsed(
    mkOptions(JSON.stringify({ version: 1, seed: "other-seed", samples: [] }), { mem })
  );
  assert.equal(out, mem, "seed mismatch should prefer in-memory history for current seed");
}

function testLoadParsedResetsOnSeedMismatchWithoutMem() {
  const out = loadParsed(mkOptions(JSON.stringify({ version: 1, seed: "other-seed", samples: [] })));
  assert.equal(out.version, 1);
  assert.equal(out.seed, "seed-a", "seed mismatch reset should use current seed");
  assert.equal(out.samples.length, 0, "seed mismatch reset should return empty samples");
}

function testEnvelopeAndLegacyBothLoad() {
  const h = mkHistory("seed-a");
  const legacy = loadParsed(mkOptions(JSON.stringify(h)));
  assert.equal(legacy.samples.length, 1, "legacy raw payload should still load");

  const envelope = loadParsed(mkOptions(JSON.stringify({ v: 2, data: h })));
  assert.equal(envelope.samples.length, 1, "enveloped payload should load");
  assert.equal(envelope.samples[0].turn, 1, "enveloped payload should preserve sample values");
}

// Downgrade protection: a payload from a newer mod version is parked, not lost.
function testNewerVersionParksAndSaveLeavesItAlone() {
  const newer = JSON.stringify({ v: 2, data: { version: 2, seed: "seed-a", samples: [{ turn: 5 }] } });
  const store = mkStore({ [KEY]: newer });
  const logged = [];
  const out = loadParsed(mkOptions(newer, { store, derr: (...a) => logged.push(a.join(" ")) }));
  assert.equal(out.version, 1, "newer-version payload should load as empty");
  assert.equal(out.samples.length, 0, "newer-version payload should not leak samples");
  assert.equal(store.read(KEY), newer, "load itself must not overwrite the primary key");
  assert.equal(store.read(REJECTED_V2), newer, "the v2 slot should hold the original text");
  assert.equal(store.read(REJECTED), null, "a versioned payload does not use the unversioned slot");
  assert.ok(logged.some((l) => /version 2 is not 1/.test(l) && /bytes=\d+/.test(l)), "derr names reason and bytes");

  // (b) A later save writes the primary key and leaves the parked payload alone.
  assert.equal(writeStorePayload(store, KEY, mkHistory(), () => {}), true);
  assert.notEqual(store.read(KEY), newer, "save should overwrite the primary key");
  assert.equal(store.read(REJECTED_V2), newer, "save should not touch the rejected slot");
}

// Downgrade then re-upgrade: each build parks the other's payload in its own slot; nothing is lost.
function testDowngradeUpgradeRoundTrip() {
  const v2Data = { version: 2, seed: "seed-a", samples: [{ turn: 7 }, { turn: 8 }], ageBoundaries: [], eliminated: {} };
  const v2Text = serializePayload(v2Data);
  const store = mkStore({ [KEY]: v2Text });

  // Build v1 loads: parks the v2 payload, gets an empty history, then saves its own v1 samples.
  const onV1 = loadParsed(mkOptions(v2Text, { store, version: 1 }));
  assert.equal(onV1.samples.length, 0);
  assert.equal(store.read(REJECTED_V2), v2Text, "v1 build parks the v2 payload under the v2 slot");
  assert.equal(store.read(KEY), v2Text, "v1 build's load leaves the primary alone");
  const v1Data = mkHistory("seed-a");
  assert.equal(writeStorePayload(store, KEY, v1Data, () => {}), true);
  const v1Text = store.read(KEY);
  assert.equal(store.read(REJECTED_V2), v2Text, "v1 build's save leaves the v2 slot alone");

  // Build v2 loads: parks the v1 primary under the v1 slot, restores v2 from the v2 slot.
  const onV2 = loadParsed(mkOptions(v1Text, { store, version: 2 }));
  assert.equal(onV2.version, 2, "v2 build restores its own parked payload");
  assert.deepEqual(onV2.samples.map((s) => s.turn), [7, 8]);
  assert.equal(store.read(KEY), v2Text, "primary now holds the v2 data again");
  assert.equal(store.read(REJECTED_V1), v1Text, "the v1 payload is parked in its own slot, not lost");
  assert.equal(store.read(REJECTED_V2), "", "the v2 slot is cleared after the restore");
}

// Park happens BEFORE restore, so a restorable slot never causes the unusable primary to be lost.
function testUnusablePrimaryIsParkedEvenWhenRestoring() {
  const parked = serializePayload(mkHistory("seed-a"));
  const newer = JSON.stringify({ v: 2, data: { version: 3, seed: "seed-a", samples: [{ turn: 9 }] } });
  const store = mkStore({ [KEY]: newer, [REJECTED_V1]: parked });
  const out = loadParsed(mkOptions(newer, { store }));
  assert.equal(out.samples.length, 1, "the current-version slot is restored");
  assert.equal(store.read(rejectedKey(KEY, 3)), newer, "the newer primary was parked first");
  assert.equal(store.read(KEY), parked, "then the restored payload replaced it");
  assert.equal(store.read(REJECTED_V1), "");
}

function testGarbageParksToo() {
  const store = mkStore({ [KEY]: "{not-json" });
  const out = loadParsed(mkOptions("{not-json", { store }));
  assert.equal(out.samples.length, 0);
  assert.equal(store.read(REJECTED), "{not-json", "garbage text should be parked too");
  assert.equal(store.read(KEY), "{not-json", "garbage load must not rewrite the primary key");
}

function testCleanFirstRunParksNothing() {
  const store = mkStore();
  const out = loadEmpty(mkEmptyOptions(store));
  assert.equal(out.samples.length, 0);
  assert.equal(store.read(REJECTED), null, "an empty store must not create a rejected key");
  assert.equal(store.read(KEY), null, "an empty store must not create a primary key");
}

// (c) Re-upgrade: primary empty + a parked payload this code CAN use restores it.
function testRestoreFromRejectedWhenPrimaryEmpty() {
  const parked = serializePayload(mkHistory("seed-a"));
  const store = mkStore({ [KEY]: "", [REJECTED_V1]: parked });
  const out = loadEmpty(mkEmptyOptions(store));
  assert.equal(out.samples.length, 1, "parked v1 payload should be restored");
  assert.equal(out.samples[0].turn, 1);
  assert.equal(store.read(KEY), parked, "restored payload should be written back to the primary key");
  assert.equal(store.read(REJECTED_V1), "", "restore should clear the v1 slot");
}

function testRestoreFromRejectedWhenPrimaryUnusable() {
  const parked = serializePayload(mkHistory("seed-a"));
  const store = mkStore({ [KEY]: "{not-json", [REJECTED_V1]: parked });
  const out = loadParsed(mkOptions("{not-json", { store }));
  assert.equal(out.samples.length, 1, "a usable parked payload is restored over the unusable primary");
  assert.equal(store.read(REJECTED), "{not-json", "the garbage primary is parked first (unversioned slot)");
  assert.equal(store.read(KEY), parked, "restored payload replaces the unusable primary");
  assert.equal(store.read(REJECTED_V1), "", "restore should clear the v1 slot");
}

function testRejectedForOtherGameOrNewerVersionIsNotRestored() {
  const foreign = serializePayload(mkHistory("seed-other"));
  const storeA = mkStore({ [REJECTED_V1]: foreign });
  assert.equal(loadEmpty(mkEmptyOptions(storeA)).samples.length, 0, "another game's parked payload stays parked");
  assert.equal(storeA.read(REJECTED_V1), foreign);

  const newer = JSON.stringify({ v: 2, data: { version: 2, seed: "seed-a", samples: [{ turn: 5 }] } });
  const storeB = mkStore({ [REJECTED_V2]: newer });
  assert.equal(loadEmpty(mkEmptyOptions(storeB)).samples.length, 0, "a still-newer parked payload stays parked");
  assert.equal(storeB.read(REJECTED_V2), newer);
  assert.equal(storeB.read(KEY), null, "restore only reads the current version's slot");
}

// Empty-store recovery applies the same different-game guard as the parsed path.
function testLoadEmptyDoesNotRecoverForeignMem() {
  const store = mkStore();
  const out = loadEmpty(mkEmptyOptions(store, { mem: mkHistory("seed-other") }));
  assert.equal(out.seed, "seed-a", "foreign mem should yield a fresh history for the current seed");
  assert.equal(out.samples.length, 0);
  assert.equal(store.read(KEY), null, "foreign mem must not be written into the empty store");
}

function testLoadEmptyRecoversMatchingMem() {
  const store = mkStore();
  const mem = mkHistory("seed-a");
  const out = loadEmpty(mkEmptyOptions(store, { mem }));
  assert.equal(out, mem, "matching mem should be recovered");
  assert.equal(store.read(KEY), serializePayload(mem), "matching mem should be written into the empty store");
}

testReadRawCatchesThrow();
testLoadParsedHandlesMalformedJson();
testLoadParsedRejectsInvalidShape();
testLoadParsedRespectsSeedMismatchWithMatchingMem();
testLoadParsedResetsOnSeedMismatchWithoutMem();
testEnvelopeAndLegacyBothLoad();
testNewerVersionParksAndSaveLeavesItAlone();
testDowngradeUpgradeRoundTrip();
testUnusablePrimaryIsParkedEvenWhenRestoring();
testGarbageParksToo();
testCleanFirstRunParksNothing();
testRestoreFromRejectedWhenPrimaryEmpty();
testRestoreFromRejectedWhenPrimaryUnusable();
testRejectedForOtherGameOrNewerVersionIsNotRestored();
testLoadEmptyDoesNotRecoverForeignMem();
testLoadEmptyRecoversMatchingMem();

console.log("storage-load-branches harness passed");
