import assert from "node:assert/strict";

import { loadEmpty, loadParsed } from "/demographics/ui/storage/storage-load.js";
import { emptyHistory, isValid, normalize } from "/demographics/ui/storage/storage-schema.js";

/** The current history schema (packed on disk) and the envelope it is written in. */
const VERSION = 2;
const ENVELOPE = 3;

function mkHistory(version = 1) {
  return {
    version,
    seed: "seed-a",
    samples: [{ turn: 1, age: "AGE_ANTIQUITY" }],
    ageBoundaries: [],
    eliminated: {}
  };
}

function parseWrittenEnvelope(raw) {
  const parsed = JSON.parse(raw);
  assert.equal(parsed.v, ENVELOPE, "payload should be wrapped in the current envelope");
  assert.ok(parsed.data && typeof parsed.data === "object", "envelope should include data object");
  return parsed.data;
}

function commonLoadOptions(raw) {
  return {
    raw,
    mem: null,
    seed: "seed-a",
    version: VERSION,
    store: { pid: 1 },
    emptyHistory,
    isValid,
    normalize,
    preferMemWhenNewer: (parsed) => parsed,
    logDebug: () => {},
    logError: () => {}
  };
}

function testLegacyPayloadStillLoads() {
  const history = mkHistory();
  const parsed = loadParsed(commonLoadOptions(JSON.stringify(history)));
  assert.equal(parsed.version, 1, "a schema 1 payload loads as it is; the first save restamps it");
  assert.equal(parsed.samples.length, 1, "legacy payload samples should be preserved");
}

function testEnvelopePayloadLoads() {
  const history = mkHistory();
  const raw = JSON.stringify({ v: 2, data: history });
  const parsed = loadParsed(commonLoadOptions(raw));
  assert.equal(parsed.version, 1, "an envelope 2 payload loads its inner schema 1 history");
  assert.equal(parsed.samples[0].turn, 1, "envelope payload should preserve sample values");
}

function testLoadEmptyRecoveryWritesEnvelope() {
  const mem = mkHistory();
  /** @type {string | null} */
  let written = null;
  const recovered = loadEmpty({
    mem,
    seed: "seed-a",
    version: VERSION,
    store: {
      pid: 1,
      write: (_key, value) => {
        written = value;
      }
    },
    payloadKey: "json",
    emptyHistory,
    logDebug: () => {},
    logError: () => {}
  });

  assert.equal(recovered.samples.length, 1, "recovery should return in-memory history");
  assert.ok(written, "recovery should write to store");
  const restored = parseWrittenEnvelope(written || "{}");
  assert.equal(restored.version, VERSION, "the recovery write is packed at the current schema");
  assert.equal(restored.seed, "seed-a", "the recovery write carries the history's seed");
}

function testEmptyHistoryCarriesSeed() {
  // The different-game guards compare this stamp against the live seed; a fresh
  // history without it could never be told apart from another game's.
  const empty = emptyHistory("seed-z", VERSION);
  assert.equal(empty.seed, "seed-z", "emptyHistory should stamp the game seed");
  assert.equal(empty.version, VERSION);
  assert.ok(isValid(empty, VERSION), "an empty history should validate");
}

function testIsValidAcceptsCurrentAndSchemaOne() {
  assert.ok(isValid(mkHistory(2), VERSION), "the current schema validates");
  assert.ok(isValid(mkHistory(1), VERSION), "schema 1 (any old save) validates");
  assert.equal(isValid(mkHistory(3), VERSION), false, "a future schema does not validate");
  assert.equal(isValid(mkHistory(0), VERSION), false, "schema 0 does not validate");
  assert.equal(isValid({ version: 2, seed: "seed-a" }, VERSION), false, "samples must be an array");
  assert.equal(isValid(null, VERSION), false);
  // The simulated old build (2.10.0) wants exactly 1; it never sees 2 as valid.
  assert.equal(isValid(mkHistory(2), 1), false, "an old build does not accept the current schema");
}

function testNormalizeLeavesVersionAlone() {
  for (const v of [1, 2, 3]) {
    const h = { version: v, seed: "seed-a", samples: [] };
    normalize(h);
    assert.equal(h.version, v, "normalize must not change version " + v);
    assert.deepEqual(h.ageBoundaries, [], "normalize fills ageBoundaries");
    assert.deepEqual(h.eliminated, {}, "normalize fills eliminated");
  }
}

testLegacyPayloadStillLoads();
testEnvelopePayloadLoads();
testLoadEmptyRecoveryWritesEnvelope();
testEmptyHistoryCarriesSeed();
testIsValidAcceptsCurrentAndSchemaOne();
testNormalizeLeavesVersionAlone();

console.log("storage-schema harness passed");
