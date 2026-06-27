// Covers: ui/core/ui-helpers.js, ui/core/demographics-contracts.js
// Both are pure (no engine globals needed).
import assert from "node:assert/strict";
import { createFakeDocument } from "./_dom-stub.mjs";

const { document } = createFakeDocument();
globalThis.document = document;

const { div, iconEl, fmt, fmtPop } = await import("/demographics/ui/core/ui-helpers.js");
const { verifyContracts, featureAvailable, logContractReport } = await import(
  "/demographics/ui/core/demographics-contracts.js"
);

// ui-helpers
assert.equal(typeof div("cls").className, "string");
assert.equal(div("cls").className, "cls");
assert.equal(div("cls", "hi").textContent, "hi");
assert.ok(iconEl("blp:icon", "ic").style.backgroundImage.includes("blp:icon"));
assert.equal(fmt(12.7), "13");
assert.equal(fmt(NaN), "—");
assert.equal(fmt("x"), "—");
assert.equal(fmtPop(0), "—");
assert.equal(fmtPop(-1), "—");
assert.equal(typeof fmtPop(1000), "string");

// contracts - all engine globals absent in Node, so every feature should be degraded
const report = verifyContracts();
assert.equal(typeof report.ok, "boolean");
assert.ok("byFeature" in report);
assert.equal(featureAvailable("unknown_feature"), true); // unknown treated as available
assert.equal(featureAvailable("core"), false); // Players/Game absent
assert.ok(typeof logContractReport(), "object");

delete globalThis.document;
console.log("ui-helpers-contracts-branches harness passed");
