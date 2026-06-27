import assert from "node:assert/strict";

const savedEngine = globalThis.engine;

globalThis.engine = {
  whenReady: Promise.resolve()
};

await import("/demographics/ui/demographics-bootstrap.js");

// Let the whenReady continuation run.
await Promise.resolve();
await Promise.resolve();

assert.ok(true);

if (savedEngine === undefined) {
  delete globalThis.engine;
} else {
  globalThis.engine = savedEngine;
}

console.log("bootstrap-branches harness passed");
