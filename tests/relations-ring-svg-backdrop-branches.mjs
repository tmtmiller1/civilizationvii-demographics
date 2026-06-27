import assert from "node:assert/strict";

import { createFakeDocument } from "./_dom-stub.mjs";

const savedDocument = globalThis.document;
const { document } = createFakeDocument();
globalThis.document = document;

const { appendRingBackdrop } = await import(
  "/demographics/ui/screen-demographics/views/relations/relations-ring-svg-backdrop.js"
);

try {
  const svg = document.createElementNS("svg", "svg");
  appendRingBackdrop(svg, { cx: 50, cy: 60, rx: 25, ry: 20 });
  assert.equal(svg.children.length, 1);
  const ring = svg.children[0];
  assert.equal(ring.tagName, "ELLIPSE");
  assert.equal(ring.getAttribute("cx"), "50");
  assert.equal(ring.getAttribute("ry"), "20");
  console.log("relations-ring-svg-backdrop-branches harness passed");
} finally {
  globalThis.document = savedDocument;
}
