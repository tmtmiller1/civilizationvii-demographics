// Covers: sampler-collectors.js, sampler-wars.js (re-export barrels),
//         screen-history-context.js, demographics-chart.js (re-export barrel),
//         history-toolbar.js (re-export barrel),
//         demographics-dock-decorator.js (class export).
// These are mostly re-export files; just importing them exercises the module-level code.
import assert from "node:assert/strict";

// sampler-collectors and sampler-wars are pure re-export barrels
const col = await import("/demographics/ui/sampler/sampler-collectors.js");
assert.ok(typeof col === "object");
const wars = await import("/demographics/ui/sampler/sampler-wars.js");
assert.ok(typeof wars === "object");

// history-toolbar is a re-export barrel
const tb = await import("/demographics/ui/screen-demographics/views/history/history-toolbar.js");
assert.ok(typeof tb === "object");

// demographics-chart is a re-export barrel; also exports ensureChartForMetric
const dc = await import("/demographics/ui/screen-demographics/screen/demographics-chart.js");
assert.ok(typeof dc.ensureChartForMetric === "function");
// ensureChartForMetric with a non-lazy metric: just confirm it doesn't throw
try { dc.ensureChartForMetric("score"); } catch(e) { throw e; }

// screen-history-context: buildHistoryContext with a minimal screen object
const { buildHistoryContext } = await import(
  "/demographics/ui/screen-demographics/screen/screen-history-context.js"
);
const fakeScreen = {
  history: { samples: [] },
  activeMetric: "score",
  activePage: "economy",
  activeTimeFilter: "all",
  hiddenCivs: new Set(),
  focusedCivs: new Set(),
  activeRadarAge: "current",
  warsFilterPid: null,
  warsActiveOnly: false,
  warsShowCs: true,
  warGraphsWarId: null,
  crisisGraphsAge: "all",
  resourcesViewerPid: 1,
  settings: { getSetting: (k, d) => d, setSetting: () => {} },
  chartMod: null,
  persist: () => {},
  render: () => {}
};
const ctx = buildHistoryContext(fakeScreen);
assert.ok(ctx && typeof ctx === "object");
assert.equal(ctx.activeMetric, "score");
assert.ok(typeof ctx.setActiveMetric === "function");

// demographics-dock-decorator: import DemographicsDockDecorator class
const { DemographicsDockDecorator } = await import(
  "/demographics/ui/core/demographics-dock-decorator.js"
);
assert.ok(typeof DemographicsDockDecorator === "function");

console.log("re-export-barrels-branches harness passed");
