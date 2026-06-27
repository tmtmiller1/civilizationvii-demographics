import assert from "node:assert/strict";

import { loadEmpty, loadParsed } from "/demographics/ui/storage/storage-load.js";
import { emptyHistory, isValid, normalize } from "/demographics/ui/storage/storage-schema.js";
import { writeStorePayload } from "/demographics/ui/storage/storage-retention.js";

function mkHistory() {
  return {
    version: 1,
    seed: "seed-a",
    samples: [{ turn: 1, age: "AGE_ANTIQUITY" }],
    ageBoundaries: [],
    eliminated: {}
  };
}

function parseWrittenEnvelope(raw) {
  const parsed = JSON.parse(raw);
  assert.equal(parsed.v, 2, "payload should be wrapped in schema envelope");
  assert.ok(parsed.data && typeof parsed.data === "object", "envelope should include data object");
  return parsed.data;
}

function commonLoadOptions(raw) {
  return {
    raw,
    mem: null,
    seed: "seed-a",
    version: 1,
    store: { pid: 1 },
    emptyHistory,
    isValid,
    normalize,
    preferMemWhenNewer: (parsed) => parsed,
    dlog: () => {},
    derr: () => {}
  };
}

function testLegacyPayloadStillLoads() {
  const history = mkHistory();
  const parsed = loadParsed(commonLoadOptions(JSON.stringify(history)));
  assert.equal(parsed.version, 1, "legacy payload should load");
  assert.equal(parsed.samples.length, 1, "legacy payload samples should be preserved");
}

function testEnvelopePayloadLoads() {
  const history = mkHistory();
  const raw = JSON.stringify({ v: 2, data: history });
  const parsed = loadParsed(commonLoadOptions(raw));
  assert.equal(parsed.version, 1, "envelope payload should load inner history");
  assert.equal(parsed.samples[0].turn, 1, "envelope payload should preserve sample values");
}

function testLoadEmptyRecoveryWritesEnvelope() {
  const mem = mkHistory();
  /** @type {string | null} */
  let written = null;
  const recovered = loadEmpty({
    mem,
    seed: "seed-a",
    version: 1,
    store: {
      pid: 1,
      write: (_key, value) => {
        written = value;
      }
    },
    payloadKey: "json",
    emptyHistory,
    dlog: () => {},
    derr: () => {}
  });

  assert.equal(recovered.samples.length, 1, "recovery should return in-memory history");
  assert.ok(written, "recovery should write to store");
  const restored = parseWrittenEnvelope(written || "{}");
  assert.equal(restored.version, 1, "recovery write should preserve history payload");
}

function testWriteStorePayloadWritesEnvelope() {
  const history = mkHistory();
  /** @type {string | null} */
  let written = null;
  const ok = writeStorePayload(
    {
      write: (_key, value) => {
        written = value;
      }
    },
    "json",
    history,
    () => {}
  );

  assert.equal(ok, true, "writeStorePayload should report success");
  assert.ok(written, "writeStorePayload should write data");
  const payload = parseWrittenEnvelope(written || "{}");
  assert.equal(payload.seed, "seed-a", "envelope data should include history content");
}

testLegacyPayloadStillLoads();
testEnvelopePayloadLoads();
testLoadEmptyRecoveryWritesEnvelope();
testWriteStorePayloadWritesEnvelope();

console.log("storage-schema harness passed");
