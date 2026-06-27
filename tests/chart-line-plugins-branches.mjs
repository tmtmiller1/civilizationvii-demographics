import assert from "node:assert/strict";

import {
  makeCapLimitLinePlugin,
  makeFocusGlowPlugin,
  makeHoverCrosshairPlugin,
  makeSignZonesPlugin
} from "/demographics/ui/screen-demographics/charts/line/chart-line-plugins.js";

const savedChart = globalThis.Chart;
globalThis.Chart = { defaults: { font: { family: "Test" } } };

function fakeCtx() {
  const calls = [];
  const ctx = {
    calls,
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    beginPath: () => calls.push("beginPath"),
    moveTo: () => calls.push("moveTo"),
    lineTo: () => calls.push("lineTo"),
    stroke: () => calls.push("stroke"),
    setLineDash: () => calls.push("setLineDash"),
    fillRect: () => calls.push("fillRect"),
    fillText: () => calls.push("fillText"),
    measureText: (s) => ({ width: String(s).length * 6 })
  };
  return ctx;
}

function testFocusAndHover() {
  const ctx = fakeCtx();
  const chart = {
    ctx,
    data: { datasets: [{ _focused: true, borderColor: "#abc", borderWidth: 2, hidden: false }] },
    getDatasetMeta: () => ({ hidden: false, data: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }),
    tooltip: { opacity: 1, dataPoints: [{ element: { x: 10 } }] },
    scales: { x: {} },
    chartArea: { top: 0, bottom: 20 }
  };

  makeFocusGlowPlugin().beforeDatasetsDraw(chart);
  makeHoverCrosshairPlugin().afterDatasetsDraw(chart);
  assert.ok(ctx.calls.includes("stroke"), "focus/hover plugins should stroke paths");
}

function testSignZonesAndCapLine() {
  const ctx = fakeCtx();
  const chart = {
    config: { type: "bar" },
    ctx,
    scales: { y: { min: -5, max: 120, getPixelForValue: (v) => 110 - v * 0.5 } },
    chartArea: { top: 10, bottom: 110, left: 0, right: 200 },
    options: { font: { family: "Test" } }
  };

  const sign = makeSignZonesPlugin();
  sign.beforeDraw(chart);
  sign.afterDatasetsDraw(chart);
  assert.ok(ctx.calls.includes("fillRect"));

  const cap = makeCapLimitLinePlugin("settlement_cap_pct");
  cap.afterDatasetsDraw(chart);
  assert.ok(ctx.calls.includes("fillText"), "cap line should draw label text");

  const callsBefore = ctx.calls.length;
  makeCapLimitLinePlugin("score").afterDatasetsDraw(chart);
  assert.equal(ctx.calls.length, callsBefore, "non-cap metrics should not draw cap line");
}

try {
  testFocusAndHover();
  testSignZonesAndCapLine();
  console.log("chart-line-plugins-branches harness passed");
} finally {
  globalThis.Chart = savedChart;
}
