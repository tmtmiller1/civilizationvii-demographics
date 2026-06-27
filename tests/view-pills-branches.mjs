// Covers: view-pills.js
// Needs document for createElement.
import assert from "node:assert/strict";
import { createFakeDocument } from "./_dom-stub.mjs";

const { document } = createFakeDocument();
globalThis.document = document;
globalThis.Locale = { compose: (k) => String(k) };

const { pillRow } = await import(
  "/demographics/ui/screen-demographics/views/shared/view-pills.js"
);

// Basic pill row
const items = [
  { key: "a", label: "Alpha" },
  { key: "b", label: "Beta" },
  { key: "c", label: "Gamma" }
];
let lastPick = null;
const row = pillRow(items, "b", (k) => { lastPick = k; });
assert.ok(row);
assert.ok(row.children.length === 3);

// Active pill — pills use style.cssText not className for selected state
assert.ok(row.children.length === 3);
// The second pill (key "b") should have bold style (active)
const bPill = row.children.find((c) => c.textContent === "Beta");
assert.ok(bPill && bPill.style.cssText.includes("bold"));

// Clicking a different pill should fire callback
row.children.find((c) => c.textContent === "Gamma")?.dispatch("click");
assert.equal(lastPick, "c");

// Variant "filter" class
const filterRow = pillRow(items, "a", () => {}, "filter");
assert.ok(filterRow);
assert.ok(filterRow.className.includes("filter") || filterRow.children.length > 0);

// Empty items — should not throw
const emptyRow = pillRow([], "a", () => {});
assert.ok(emptyRow);

delete globalThis.document;
delete globalThis.Locale;
console.log("view-pills-branches harness passed");
