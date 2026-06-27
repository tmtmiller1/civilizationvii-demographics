import assert from "node:assert/strict";

import { readRaw, loadParsed } from "/demographics/ui/storage/storage-load.js";
import { emptyHistory, isValid, normalize } from "/demographics/ui/storage/storage-schema.js";

function mkHistory(seed = "seed-a") {
  return {
    version: 1,
    seed,
    samples: [{ turn: 1, age: "AGE_ANTIQUITY" }],
    ageBoundaries: [],
    eliminated: {}
  };
}

function mkOptions(raw, extra = {}) {
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

testReadRawCatchesThrow();
testLoadParsedHandlesMalformedJson();
testLoadParsedRejectsInvalidShape();
testLoadParsedRespectsSeedMismatchWithMatchingMem();
testLoadParsedResetsOnSeedMismatchWithoutMem();
testEnvelopeAndLegacyBothLoad();

console.log("storage-load-branches harness passed");
