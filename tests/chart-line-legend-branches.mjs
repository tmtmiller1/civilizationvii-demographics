import assert from "node:assert/strict";

import { createFakeDocument } from "./_dom-stub.mjs";

const savedDocument = globalThis.document;
const { document } = createFakeDocument();
globalThis.document = document;

const { buildLineLegend } = await import(
  "/demographics/ui/screen-demographics/charts/line/chart-line-legend.js"
);

function testLegendRowsAndControls() {
  const toggles = [];
  const bulk = [];
  const datasets = [
    {
      label: "Leader A",
      leaderType: "LEADER_A",
      leaderTypeString: "LEADER_A",
      borderColor: "#123456",
      _focused: true
    },
    {
      label: "Leader B",
      leaderType: "LEADER_B",
      leaderTypeString: "LEADER_B",
      borderColor: "#654321",
      _muted: true,
      _eliminated: true
    }
  ];

  const legend = buildLineLegend(datasets, {
    onToggleVisibility: (k) => toggles.push(k),
    onSetAllHidden: (hide, keys) => bulk.push({ hide, keys })
  });

  assert.equal(legend.children.length, 4, "title + controls + two rows");

  const controls = legend.children[1];
  controls.children[0].dispatch("click");
  controls.children[1].dispatch("click");
  assert.deepEqual(bulk, [
    { hide: false, keys: ["LEADER_A", "LEADER_B"] },
    { hide: true, keys: ["LEADER_A", "LEADER_B"] }
  ]);

  const rowA = legend.children[2];
  const rowB = legend.children[3];
  assert.ok(rowA.classList.contains("is-focused"));
  assert.ok(rowB.classList.contains("is-hidden"));
  assert.ok(rowB.classList.contains("is-eliminated"));

  rowA.dispatch("click");
  rowB.dispatch("click");
  assert.deepEqual(toggles, ["LEADER_A", "LEADER_B"]);
}

try {
  testLegendRowsAndControls();
  console.log("chart-line-legend-branches harness passed");
} finally {
  globalThis.document = savedDocument;
}
