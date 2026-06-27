import assert from "node:assert/strict";

import { createFakeDocument } from "./_dom-stub.mjs";

const savedDocument = globalThis.document;
const { document } = createFakeDocument();
globalThis.document = document;

const { appendRingNode, nodeRadius } = await import(
  "/demographics/ui/screen-demographics/views/relations/relations-ring-svg-nodes.js"
);

function testNodeRadius() {
  assert.ok(nodeRadius(true, false, 1) > nodeRadius(false, false, 1));
  assert.ok(nodeRadius(false, true, 1) > 0);
}

function testAppendRingNodeMajorAndCs() {
  const svg = document.createElementNS("svg", "svg");
  const toggles = [];
  const portraits = [];
  const geo = {
    positions: new Map([
      [1, { x: 10, y: 10 }],
      [2, { x: 20, y: 20 }]
    ]),
    density: 1,
    cx: 50,
    cy: 50,
    viewBoxH: 100
  };

  const names = {
    1: { leaderName: "A", civName: "Rome", leaderTypeString: "LEADER_A", primaryColor: "#123456" },
    2: { isCityState: true, csName: "CS", csTypeIcon: "blp:cs", csTypeColor: "#aa33aa", primaryColor: "#445566" }
  };

  const ctx = {
    viewerPid: 1,
    selectedNodeIds: new Set([1]),
    focusNodes: null,
    onNodeToggle: (pid) => toggles.push(pid),
    portraitsToPlace: portraits
  };

  appendRingNode(svg, 1, geo, names, ctx);
  appendRingNode(svg, 2, geo, names, ctx);

  assert.equal(svg.children.length, 2);
  assert.ok(portraits.some((p) => p.kind === "leader"));
  assert.ok(portraits.some((p) => p.kind === "cs-icon"));
  assert.ok(portraits.some((p) => p.kind === "label"));

  svg.children[0].dispatch("click");
  assert.deepEqual(toggles, [1]);
}

function testAppendRingNodeFallbackPaths() {
  const svg = document.createElementNS("svg", "svg");
  const portraits = [];
  const geo = {
    positions: new Map([
      [10, { x: 12, y: 34 }],
      [11, { x: 21, y: 45 }],
      [12, { x: 33, y: 54 }]
    ]),
    density: 0,
    cx: 50,
    cy: 50,
    viewBoxH: 100
  };

  const names = {
    10: {
      leaderName: "",
      civName: "",
      primaryColor: "#000000"
    },
    11: {
      isCityState: true,
      csName: "",
      csTypeColor: "bad-color",
      primaryColor: "also-bad"
    },
    12: {
      isCityState: true,
      csName: "DiscCS",
      csTypeColor: "#336699",
      primaryColor: "#112233"
    }
  };

  const ctx = {
    viewerPid: 1,
    selectedNodeIds: new Set(),
    focusNodes: new Set([12]),
    onNodeToggle: undefined,
    portraitsToPlace: portraits
  };

  appendRingNode(svg, 99, geo, names, ctx);
  assert.equal(svg.children.length, 0, "missing position should skip node render");

  appendRingNode(svg, 10, geo, names, ctx);
  appendRingNode(svg, 11, geo, names, ctx);
  appendRingNode(svg, 12, geo, names, ctx);
  assert.equal(svg.children.length, 3);

  const major = svg.children[0];
  const majorCircle = major.children[0];
  assert.equal(majorCircle.tagName, "CIRCLE");
  assert.equal(majorCircle.getAttribute("r"), "8", "zero-density radius should fall back to default circle radius");
  assert.equal(majorCircle.getAttribute("stroke"), "#c9a24c");
  assert.equal(major.children[1].tagName, "TEXT", "major with no portrait should render fallback initial");
  assert.equal(major.children[1].textContent, "P");

  const csFallback = svg.children[1];
  const csFallbackCircle = csFallback.children[0];
  assert.equal(csFallbackCircle.getAttribute("stroke"), "#9aa8c8");
  assert.equal(csFallbackCircle.getAttribute("fill"), "rgba(154,168,200,0.18)");
  assert.equal(csFallback.getAttribute("opacity"), "0.18", "focus dim should fade non-neighbor node");

  const csDisc = svg.children[2];
  assert.equal(csDisc.children.length, 2, "city-state with color and no icon should render inner disc");
  assert.equal(csDisc.children[1].tagName, "CIRCLE");
  assert.equal(csDisc.children[1].getAttribute("fill"), "#336699");

  const labels = portraits.filter((p) => p.kind === "label");
  assert.equal(labels.length, 3);
  assert.ok(labels.some((p) => p.text === "P10"));
  assert.ok(labels.some((p) => p.text === "CS-11"));
  assert.ok(labels.some((p) => p.text === "DiscCS"));
  assert.equal(portraits.some((p) => p.kind === "leader"), false, "major with no leaderType should not queue portrait");
  assert.equal(portraits.some((p) => p.kind === "cs-icon"), false, "city-state with no icon should not queue icon portrait");
}

try {
  testNodeRadius();
  testAppendRingNodeMajorAndCs();
    testAppendRingNodeFallbackPaths();
  console.log("relations-ring-svg-nodes-branches harness passed");
} finally {
  globalThis.document = savedDocument;
}
