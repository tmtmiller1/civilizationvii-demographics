import assert from "node:assert/strict";

import { loadEmpty, loadParsed, readRaw, rejectedKey } from "/demographics/ui/storage/storage-load.js";
import { emptyHistory, isValid, normalize } from "/demographics/ui/storage/storage-schema.js";
import {
  prepareHistoryForSave,
  serializePayload,
  writeSerializedPayload
} from "/demographics/ui/storage/storage-retention.js";

// The build under test reads schema 1 (every old save) and schema 2 (packed), and writes 2 in
// envelope 3. Schema 3 stands in for a future build; the "old build" is one whose isValid wants 1.
const VERSION = 2;
const ENVELOPE = 3;
const KEY = "json";
/** Unversioned slot: JSON garbage with no readable version. */
const REJECTED = rejectedKey(KEY);
/** Per-version slots: `<key>__rejected_v<N>`. */
const REJECTED_V1 = rejectedKey(KEY, 1);
const REJECTED_V2 = rejectedKey(KEY, 2);
const REJECTED_V3 = rejectedKey(KEY, 3);

/** An in-memory history; `version` 1 is what an old save holds, 2 what this build holds after a save. */
function mkHistory(seed = "seed-a", version = 1, turns = [1]) {
  return {
    version,
    seed,
    samples: turns.map((turn) => ({ turn, age: "AGE_ANTIQUITY" })),
    ageBoundaries: [],
    eliminated: {}
  };
}

/** What an old build (2.10.0 and before) writes: envelope 2 around an unpacked schema 1 history. */
const oldBuildText = (history) => JSON.stringify({ v: 2, data: history });
/** What a future build might write: envelope 3 around a schema 3 history this code can't read. */
const futureText = (seed, turns) =>
  JSON.stringify({ v: ENVELOPE, data: { version: 3, seed, samples: turns.map((turn) => ({ turn })) } });
/** The old build's validator. */
const oldIsValid = (h, _v) => !!(h && typeof h === "object" && h.version === 1 && Array.isArray(h.samples));

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
    version: VERSION,
    store: { pid: 1 },
    payloadKey: KEY,
    emptyHistory,
    isValid,
    normalize,
    preferMemWhenNewer: (parsed) => parsed,
    logDebug: () => {},
    logError: () => {},
    ...extra
  };
}

function mkEmptyOptions(store, extra = {}) {
  return {
    mem: null,
    seed: "seed-a",
    version: VERSION,
    store,
    payloadKey: KEY,
    emptyHistory,
    isValid,
    normalize,
    logDebug: () => {},
    logError: () => {},
    ...extra
  };
}

/** The storage module's save step: validate, restamp, cap, serialize, write. */
function saveLike(store, history) {
  const ok = prepareHistoryForSave(history, {
    version: VERSION,
    isValid,
    normalize,
    resolveEffectiveCap: () => ({ cap: Infinity, source: "test" }),
    logError: () => {}
  });
  assert.equal(ok, true, "prepareHistoryForSave accepts the history");
  return writeSerializedPayload(store, KEY, serializePayload(history), () => {});
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
  const store = mkStore();
  const raw = JSON.stringify({ version: 99, seed: "seed-a", samples: [] });
  const empty = loadParsed(mkOptions(raw, { store }));
  assert.equal(empty.version, VERSION, "invalid shape should reset to empty history");
  assert.equal(empty.samples.length, 0, "invalid shape reset should not keep samples");
  assert.equal(store.read(rejectedKey(KEY, 99)), raw, "the unreadable payload is parked under its version's slot");
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
  assert.equal(out.version, VERSION);
  assert.equal(out.seed, "seed-a", "seed mismatch reset should use current seed");
  assert.equal(out.samples.length, 0, "seed mismatch reset should return empty samples");
}

function testEnvelopeAndLegacyBothLoad() {
  const h = mkHistory("seed-a");
  const legacy = loadParsed(mkOptions(JSON.stringify(h)));
  assert.equal(legacy.samples.length, 1, "legacy raw payload should still load");

  const envelope = loadParsed(mkOptions(oldBuildText(h)));
  assert.equal(envelope.samples.length, 1, "enveloped payload should load");
  assert.equal(envelope.samples[0].turn, 1, "enveloped payload should preserve sample values");
}

// Matrix row: v1 primary (any old save), no parked v2. Loads as it is; the first save writes v2 in envelope 3.
function testOldSaveLoadsAndFirstSaveWritesCurrent() {
  const v1Text = oldBuildText(mkHistory("seed-a", 1, [1, 2, 3]));
  const store = mkStore({ [KEY]: v1Text });
  const out = loadParsed(mkOptions(v1Text, { store }));
  assert.deepEqual(out.samples.map((s) => s.turn), [1, 2, 3], "the old save's samples load");
  assert.equal(out.version, 1, "a v1 history keeps its version until the first save");
  assert.equal(store.read(KEY), v1Text, "the load writes nothing");
  assert.equal(store.read(REJECTED_V1), null, "nothing is parked");
  assert.equal(store.read(REJECTED_V2), null, "nothing is parked");

  assert.equal(saveLike(store, out), true);
  assert.equal(out.version, VERSION, "the save restamps the mirror");
  const written = JSON.parse(store.read(KEY));
  assert.equal(written.v, ENVELOPE, "the first save writes envelope 3");
  assert.equal(written.data.version, VERSION, "the first save writes schema 2");
  assert.ok(Array.isArray(written.data.roster), "the written data is packed");
  assert.equal(store.read(REJECTED_V1), null, "a plain upgrade parks nothing");
}

// Matrix row: v2 primary. Unpacked and used; the raw (packed) length is what the load reports.
function testPackedPrimaryLoads() {
  const v2Text = serializePayload(mkHistory("seed-a", 2, [4, 5]));
  const store = mkStore({ [KEY]: v2Text });
  const debug = [];
  const out = loadParsed(mkOptions(v2Text, { store, logDebug: (...a) => debug.push(a.join(" ")) }));
  assert.equal(out.version, VERSION);
  assert.deepEqual(out.samples.map((s) => s.turn), [4, 5], "the packed payload unpacks to its samples");
  assert.equal(out.roster, undefined, "the in-memory history has no roster");
  assert.equal(out.mk, undefined, "the in-memory history has no metric key table");
  assert.ok(debug.some((l) => l.includes("bytes=" + v2Text.length)), "the load reports the packed length");
  assert.equal(store.read(KEY), v2Text, "the load writes nothing");
}

// A packed payload whose shape isn't one storage-pack.js writes parks under the v2 slot.
function testMalformedPackedParksUnderItsVersion() {
  const bad = JSON.stringify({
    v: ENVELOPE,
    data: { version: 2, seed: "seed-a", roster: [], mk: [], samples: "nope" }
  });
  const store = mkStore({ [KEY]: bad });
  const logged = [];
  const out = loadParsed(mkOptions(bad, { store, logError: (...a) => logged.push(a.join(" ")) }));
  assert.equal(out.samples.length, 0, "a malformed packed payload loads as empty");
  assert.equal(store.read(REJECTED_V2), bad, "and is parked under the v2 slot");
  assert.equal(store.read(REJECTED), null, "not under the unversioned slot");
  assert.ok(logged.some((l) => /malformed history/.test(l)), "the log says why");
}

// Downgrade protection: a payload from a future build is parked under its own slot, not lost.
function testNewerVersionParksAndSaveLeavesItAlone() {
  const newer = futureText("seed-a", [5]);
  const store = mkStore({ [KEY]: newer });
  const logged = [];
  const out = loadParsed(mkOptions(newer, { store, logError: (...a) => logged.push(a.join(" ")) }));
  assert.equal(out.version, VERSION, "newer-version payload should load as empty");
  assert.equal(out.samples.length, 0, "newer-version payload should not leak samples");
  assert.equal(store.read(KEY), newer, "load itself must not overwrite the primary key");
  assert.equal(store.read(REJECTED_V3), newer, "the v3 slot should hold the original text");
  assert.equal(store.read(REJECTED_V2), null, "the current version's slot is only read, never written here");
  assert.equal(store.read(REJECTED), null, "a versioned payload does not use the unversioned slot");
  assert.ok(logged.some((l) => /version 3 is not 2/.test(l) && /bytes=\d+/.test(l)), "logError names reason and bytes");

  // (b) A later save writes the primary key and leaves the parked payload alone.
  assert.equal(saveLike(store, mkHistory()), true);
  assert.notEqual(store.read(KEY), newer, "save should overwrite the primary key");
  assert.equal(store.read(REJECTED_V3), newer, "save should not touch the rejected slot");
}

// Simulated old build (2.10.0: isValid wants exactly 1) opening a save this build wrote.
function testOldBuildParksPackedPayload() {
  const v2Text = serializePayload(mkHistory("seed-a", 2, [7, 8]));
  const store = mkStore({ [KEY]: v2Text });
  const logged = [];
  const onOld = loadParsed(
    mkOptions(v2Text, { store, version: 1, isValid: oldIsValid, logError: (...a) => logged.push(a.join(" ")) })
  );
  assert.equal(onOld.version, 1, "the old build gets an empty history of its own schema");
  assert.equal(onOld.samples.length, 0, "the old build sees no samples");
  assert.equal(store.read(REJECTED_V2), v2Text, "the old build parks the packed payload under the v2 slot");
  assert.equal(store.read(KEY), v2Text, "the old build's load leaves the primary alone");
  assert.ok(logged.some((l) => /version 2 is not 1/.test(l)), "the old build logs the version it refused");
}

// Downgrade then re-upgrade: each build parks the other's payload in its own slot; nothing is lost.
function testDowngradeUpgradeRoundTrip() {
  const v2Text = serializePayload(mkHistory("seed-a", 2, [7, 8]));
  const store = mkStore({ [KEY]: v2Text });

  // The old build loads: parks the v2 payload, gets an empty history, then writes its own v1 samples.
  const onOld = loadParsed(mkOptions(v2Text, { store, version: 1, isValid: oldIsValid }));
  assert.equal(onOld.samples.length, 0);
  assert.equal(store.read(REJECTED_V2), v2Text, "old build parks the v2 payload under the v2 slot");
  const v1Text = oldBuildText(mkHistory("seed-a", 1, [1]));
  store.write(KEY, v1Text);
  assert.equal(store.read(REJECTED_V2), v2Text, "old build's save leaves the v2 slot alone");

  // This build loads again: parks the v1 primary under the v1 slot, restores v2 from the v2 slot.
  const onNew = loadParsed(mkOptions(v1Text, { store }));
  assert.equal(onNew.version, VERSION, "this build restores its own parked payload");
  assert.deepEqual(onNew.samples.map((s) => s.turn), [7, 8], "the restored payload is unpacked");
  assert.equal(onNew.roster, undefined, "the restored history is the in-memory shape");
  assert.equal(store.read(KEY), v2Text, "primary now holds the v2 data again");
  assert.equal(store.read(REJECTED_V1), v1Text, "the v1 payload is parked in its own slot, not lost");
  assert.equal(store.read(REJECTED_V2), "", "the v2 slot is cleared after the restore");
}

// Matrix row: v1 primary with a parked v2 of another game. The v1 is used; the slot stays.
function testOldPrimaryWithForeignParkedCurrentIsKept() {
  const foreign = serializePayload(mkHistory("seed-other", 2, [7, 8]));
  const v1Text = oldBuildText(mkHistory("seed-a", 1, [1, 2]));
  const store = mkStore({ [KEY]: v1Text, [REJECTED_V2]: foreign });
  const out = loadParsed(mkOptions(v1Text, { store }));
  assert.deepEqual(out.samples.map((s) => s.turn), [1, 2], "the v1 primary is what loads");
  assert.equal(store.read(KEY), v1Text, "the primary is untouched");
  assert.equal(store.read(REJECTED_V2), foreign, "another game's parked payload stays parked");
  assert.equal(store.read(REJECTED_V1), null, "nothing is parked");
}

// Park happens before restore, so a restorable slot never causes the unusable primary to be lost.
function testUnusablePrimaryIsParkedEvenWhenRestoring() {
  const parked = serializePayload(mkHistory("seed-a", 2));
  const newer = futureText("seed-a", [9]);
  const store = mkStore({ [KEY]: newer, [REJECTED_V2]: parked });
  const out = loadParsed(mkOptions(newer, { store }));
  assert.equal(out.samples.length, 1, "the current-version slot is restored");
  assert.equal(store.read(REJECTED_V3), newer, "the newer primary was parked first");
  assert.equal(store.read(KEY), parked, "then the restored payload replaced it");
  assert.equal(store.read(REJECTED_V2), "");
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
  assert.equal(out.version, VERSION, "a fresh history carries the current schema");
  assert.equal(store.read(REJECTED), null, "an empty store must not create a rejected key");
  assert.equal(store.read(KEY), null, "an empty store must not create a primary key");
}

// (c) Re-upgrade: primary empty + a parked payload this code CAN use restores it.
function testRestoreFromRejectedWhenPrimaryEmpty() {
  const parked = serializePayload(mkHistory("seed-a", 2));
  const store = mkStore({ [KEY]: "", [REJECTED_V2]: parked });
  const out = loadEmpty(mkEmptyOptions(store));
  assert.equal(out.samples.length, 1, "parked v2 payload should be restored");
  assert.equal(out.samples[0].turn, 1);
  assert.equal(store.read(KEY), parked, "restored payload should be written back to the primary key");
  assert.equal(store.read(REJECTED_V2), "", "restore should clear the v2 slot");
}

function testRestoreFromRejectedWhenPrimaryUnusable() {
  const parked = serializePayload(mkHistory("seed-a", 2));
  const store = mkStore({ [KEY]: "{not-json", [REJECTED_V2]: parked });
  const out = loadParsed(mkOptions("{not-json", { store }));
  assert.equal(out.samples.length, 1, "a usable parked payload is restored over the unusable primary");
  assert.equal(store.read(REJECTED), "{not-json", "the garbage primary is parked first (unversioned slot)");
  assert.equal(store.read(KEY), parked, "restored payload replaces the unusable primary");
  assert.equal(store.read(REJECTED_V2), "", "restore should clear the v2 slot");
}

function testRejectedForOtherGameOrNewerVersionIsNotRestored() {
  const foreign = serializePayload(mkHistory("seed-other", 2));
  const storeA = mkStore({ [REJECTED_V2]: foreign });
  assert.equal(loadEmpty(mkEmptyOptions(storeA)).samples.length, 0, "another game's parked payload stays parked");
  assert.equal(storeA.read(REJECTED_V2), foreign);

  const newer = futureText("seed-a", [5]);
  const storeB = mkStore({ [REJECTED_V3]: newer });
  assert.equal(loadEmpty(mkEmptyOptions(storeB)).samples.length, 0, "a still-newer parked payload stays parked");
  assert.equal(storeB.read(REJECTED_V3), newer);
  assert.equal(storeB.read(KEY), null, "restore only reads the current version's slot");

  // A v1 slot left by an earlier downgrade is this build's own park of the old build's data; it is
  // not what this build restores from.
  const oldParked = oldBuildText(mkHistory("seed-a", 1));
  const storeC = mkStore({ [REJECTED_V1]: oldParked });
  assert.equal(loadEmpty(mkEmptyOptions(storeC)).samples.length, 0, "the v1 slot is not a restore source");
  assert.equal(storeC.read(REJECTED_V1), oldParked);
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
  assert.equal(JSON.parse(store.read(KEY)).v, ENVELOPE, "the recovery write is packed");
}

testReadRawCatchesThrow();
testLoadParsedHandlesMalformedJson();
testLoadParsedRejectsInvalidShape();
testLoadParsedRespectsSeedMismatchWithMatchingMem();
testLoadParsedResetsOnSeedMismatchWithoutMem();
testEnvelopeAndLegacyBothLoad();
testOldSaveLoadsAndFirstSaveWritesCurrent();
testPackedPrimaryLoads();
testMalformedPackedParksUnderItsVersion();
testNewerVersionParksAndSaveLeavesItAlone();
testOldBuildParksPackedPayload();
testDowngradeUpgradeRoundTrip();
testOldPrimaryWithForeignParkedCurrentIsKept();
testUnusablePrimaryIsParkedEvenWhenRestoring();
testGarbageParksToo();
testCleanFirstRunParksNothing();
testRestoreFromRejectedWhenPrimaryEmpty();
testRestoreFromRejectedWhenPrimaryUnusable();
testRejectedForOtherGameOrNewerVersionIsNotRestored();
testLoadEmptyDoesNotRecoverForeignMem();
testLoadEmptyRecoversMatchingMem();

console.log("storage-load harness passed");
