import assert from "node:assert/strict";

import { createFakeDocument } from "./_dom-stub.mjs";

const savedDocument = globalThis.document;
const { document } = createFakeDocument();
globalThis.document = document;

const {
  groupEdgesByPair,
  appendEdgeGroup,
  appendSampleEdge
} = await import("/demographics/ui/screen-demographics/views/relations/relations-ring-svg-edges.js");

function testGroupEdgesByPair() {
  const positions = new Map([
    [1, { x: 10, y: 20 }],
    [2, { x: 90, y: 20 }]
  ]);
  const edges = [
    { a: 1, b: 2, filterKey: "alliance", color: "#00f" },
    { a: 2, b: 1, filterKey: "war", color: "#f00" },
    { a: 1, b: 3, filterKey: "trade", color: "#0f0" }
  ];
  const groups = groupEdgesByPair(edges, positions);
  assert.equal(groups.size, 1);
  const entries = Array.from(groups.values())[0];
  assert.equal(entries.length, 2);
}

function testAppendEdgeGroupAndRecords() {
  const svg = document.createElementNS("svg", "svg");
  const pa = { x: 10, y: 50 };
  const pb = { x: 90, y: 50 };
  const entries = [
    { e: { a: 1, b: 2, filterKey: "openborders", color: "#4488ff" }, pa, pb },
    { e: { a: 2, b: 1, filterKey: "suzerain", color: "#f3c34c", dashed: true }, pa, pb },
    { e: { a: 1, b: 2, filterKey: "trade", color: "#4dc6c6", directed: true }, pa, pb }
  ];
  const radii = new Map([
    [1, 4],
    [2, 5]
  ]);
  const records = [];

  appendEdgeGroup(svg, entries, new Set([99]), radii, records);

  assert.equal(records.length, 3);
  assert.equal(svg.children.length, entries.length);
  assert.ok(svg.children.every((n) => n.getAttribute("class") === "demographics-relations-edge"));
  assert.ok(records.every((r) => Array.isArray(r.pts) && r.pts.length > 5));
}

function testAppendSampleEdge() {
  const svg = document.createElementNS("svg", "svg");
  appendSampleEdge(svg, { color: "#ffffff", dash: "dotted", directed: false }, { x: 5, y: 5 }, { x: 95, y: 5 });
  appendSampleEdge(svg, { color: "#ffffff", directed: true }, { x: 5, y: 15 }, { x: 95, y: 15 });
  assert.ok(svg.children.length > 4);
}

function testDegenerateAndFallbackEdgePaths() {
  const positions = new Map([
    [1, { x: 10, y: 10 }],
    [2, { x: 10, y: 10 }],
    [3, { x: 10, y: 30 }]
  ]);

  const groups = groupEdgesByPair(
    [
      { a: 2, b: 1, filterKey: "war" },
      { a: 1, b: 2, filterKey: "alliance" },
      { a: 1, b: 3, filterKey: "trade" }
    ],
    positions
  );
  assert.equal(groups.size, 2, "reverse-order identical endpoints should still form one geometric group");

  const svg = document.createElementNS("svg", "svg");
  const zeroLenEntries = [
    { e: { a: 1, b: 2, filterKey: "open_borders" }, pa: positions.get(1), pb: positions.get(2) },
    { e: { a: 1, b: 2, filterKey: undefined, directed: true }, pa: positions.get(1), pb: positions.get(2) }
  ];
  appendEdgeGroup(svg, zeroLenEntries, null, undefined, undefined);
  assert.ok(svg.children.length >= 2, "degenerate zero-length entries should still render without throwing");

  const fallback = document.createElementNS("svg", "svg");
  appendSampleEdge(fallback, { dash: "dashed", directed: false }, { x: 20, y: 20 }, { x: 20, y: 20 });
  appendSampleEdge(fallback, { directed: true }, { x: 30, y: 30 }, { x: 30, y: 30 });
  appendSampleEdge(fallback, { dash: "", directed: false }, { x: 40, y: 40 }, { x: 60, y: 40 });
  assert.ok(fallback.children.length > 0, "sample edge should render with default color and zero-length fallback");
}

try {
  testGroupEdgesByPair();
  testAppendEdgeGroupAndRecords();
  testAppendSampleEdge();
    testDegenerateAndFallbackEdgePaths();
  console.log("relations-ring-svg-edges-branches harness passed");
} finally {
  globalThis.document = savedDocument;
}
