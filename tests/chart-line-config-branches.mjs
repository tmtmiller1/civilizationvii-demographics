import assert from "node:assert/strict";

import { buildLineChartConfig } from "/demographics/ui/screen-demographics/charts/line/chart-line-config.js";

const savedChart = globalThis.Chart;

globalThis.Chart = {
  defaults: {
    font: { family: "TestFont" }
  }
};

function buildFormatters() {
  return {
    fmtX: (v) => "X:" + v,
    fmtY: (v) => "Y:" + v
  };
}

function testBarSymmetricAxis() {
  const cfg = buildLineChartConfig({
    datasets: [
      { data: [{ x: 1, y: -4 }, { x: 2, y: 1 }] },
      { data: [{ x: 1, y: 7 }] }
    ],
    plugins: [],
    metricMeta: {
      chartType: "bar",
      id: "net_migration",
      unit: "people",
      integerOnly: true,
      tooltipMode: "index"
    },
    formatters: buildFormatters()
  });

  assert.equal(cfg.type, "bar");
  assert.equal(cfg.options.scales.y.min, -7);
  assert.equal(cfg.options.scales.y.max, 7);
  assert.equal(cfg.options.interaction.mode, "index");
  assert.equal(cfg.options.scales.y.ticks.callback(1.5), "", "fractional tick labels should hide on integer metrics");
}

function testLineDefaults() {
  const cfg = buildLineChartConfig({
    datasets: [{ data: [{ x: 1, y: 0.25 }] }],
    plugins: [],
    metricMeta: {
      id: "gdp",
      unit: "gold"
    },
    formatters: buildFormatters()
  });

  assert.equal(cfg.type, "line");
  assert.equal(cfg.options.scales.y.beginAtZero, true);
  assert.equal(cfg.options.plugins.legend.display, false);
  assert.equal(cfg.options.plugins.tooltip.enabled, false);
  assert.equal(cfg.options.scales.x.ticks.callback(3), "X:3");
  assert.equal(cfg.options.scales.y.ticks.callback(2), "Y:2");
}

try {
  testBarSymmetricAxis();
  testLineDefaults();
  console.log("chart-line-config-branches harness passed");
} finally {
  globalThis.Chart = savedChart;
}
