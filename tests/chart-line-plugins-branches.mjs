import assert from "node:assert/strict";

import {
  makeCapLimitLinePlugin,
  makeFocusGlowPlugin,
  makeHoverCrosshairPlugin,
  makePointerScalePlugin,
  makeSignZonesPlugin
} from "/demographics/ui/screen-demographics/charts/line/chart-line-plugins.js";
import { applyVisualScale } from "/demographics/ui/core/demographics-font-ladder.js";

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

function testMissingChartAreaIsSkipped() {
  // Chart.js can invoke a plugin hook before layout (chartArea undefined); the hooks return early.
  const ctx = fakeCtx();
  const chart = {
    ctx,
    tooltip: { opacity: 1, dataPoints: [{ element: { x: 10 } }] },
    scales: { x: {}, y: { min: 0, max: 200, getPixelForValue: (v) => v } }
  };
  makeHoverCrosshairPlugin().afterDatasetsDraw(chart);
  makeCapLimitLinePlugin("settlement_cap_pct").afterDatasetsDraw(chart);
  assert.equal(ctx.calls.length, 0, "no drawing without a chartArea");
}

/**
 * Drive the frame scale through the real applyVisualScale (it reads the viewport height).
 * @param {number} viewportH The viewport height the scale is computed from.
 */
function setViewportScale(viewportH) {
  const saved = globalThis.document;
  globalThis.document = { documentElement: { clientHeight: viewportH } };
  try {
    applyVisualScale(null);
  } finally {
    globalThis.document = saved;
  }
}

function testPointerScale() {
  // Chart area spans local x 100..2600. Under scale 0.8 Chart.js hands over visual px.
  const chart = { isPointInArea: (p) => p.x >= 100 && p.x <= 2600 };
  const plugin = makePointerScalePlugin();

  setViewportScale(1440); // 1440 / 1800 = 0.8
  const args = { event: { x: 2080, y: 400 }, inChartArea: true };
  plugin.beforeEvent(chart, args);
  assert.equal(args.event.x, 2600, "the right edge in visual px maps to the local right edge");
  assert.equal(args.event.y, 500, "y is rescaled too");
  assert.equal(args.inChartArea, true);

  // A replayed event (same object) must not be divided a second time.
  plugin.beforeEvent(chart, args);
  assert.equal(args.event.x, 2600, "replay leaves the event alone");

  // inChartArea is recomputed from the rescaled point: visual 72 -> local 90, outside the area.
  const left = { event: { x: 72, y: 400 }, inChartArea: true };
  plugin.beforeEvent(chart, left);
  assert.equal(left.inChartArea, false, "inChartArea follows the rescaled point");

  // At scale 1 the event passes through untouched.
  setViewportScale(1800);
  const flat = { event: { x: 2080, y: 400 }, inChartArea: true };
  plugin.beforeEvent(chart, flat);
  assert.equal(flat.event.x, 2080, "scale 1 is a no-op");

  plugin.beforeEvent(chart, {});
  plugin.beforeEvent(chart, undefined);
}

try {
  testPointerScale();
  testFocusAndHover();
  testSignZonesAndCapLine();
  testMissingChartAreaIsSkipped();
  console.log("chart-line-plugins-branches harness passed");
} finally {
  globalThis.Chart = savedChart;
}
