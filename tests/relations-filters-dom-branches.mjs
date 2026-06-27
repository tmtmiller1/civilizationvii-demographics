import assert from "node:assert/strict";

import { createFakeDocument } from "./_dom-stub.mjs";

const savedDocument = globalThis.document;
const savedPerformance = globalThis.performance;

const { document } = createFakeDocument();
globalThis.document = document;
globalThis.performance = { now: () => 1000 };

const { makeFilterPillRow } = await import(
  "/demographics/ui/screen-demographics/views/relations/relations-filters.js"
);

function testEmptyFilters() {
  const row = makeFilterPillRow([], new Set(), () => {});
  assert.equal(row.children.length, 0);
}

function testPillRowDomAndCallbacks() {
  const toggled = [];
  const allCalls = [];
  const filters = [
    { key: "war", label: "War", color: "#f00", directed: false },
    { key: "trade", label: "Trade", color: "#0f0", directed: true, _dashOverride: "dotted" }
  ];

  const row = makeFilterPillRow(
    filters,
    new Set(["war"]),
    (k) => toggled.push(k),
    (on) => allCalls.push(on)
  );

  assert.equal(row.children.length, 3, "controls + 2 pills");

  const controls = row.children[0];
  assert.equal(controls.children.length, 3, "all + sep + none");
  controls.children[0].dispatch("click");
  controls.children[2].dispatch("click");
  assert.deepEqual(allCalls, [true, false]);

  const activePill = row.children[1];
  const hiddenPill = row.children[2];
  assert.ok(activePill.classList.contains("is-active"));
  assert.ok(hiddenPill.classList.contains("is-hidden"));
  assert.equal(activePill.children[0].tagName, "SVG");

  hiddenPill.dispatch("click");
  hiddenPill.dispatch("action-activate");
  assert.deepEqual(toggled, ["trade"], "dedupe should suppress double-fire");
}

try {
  testEmptyFilters();
  testPillRowDomAndCallbacks();
  console.log("relations-filters-dom-branches harness passed");
} finally {
  globalThis.document = savedDocument;
  globalThis.performance = savedPerformance;
}
