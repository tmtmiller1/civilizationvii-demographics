import assert from "node:assert/strict";

import {
  collectAgeMarkers,
  collectCrisisMarkers,
  collectRefugeeEventMarkers,
  makeAgeMarkerPlugin,
  makeCrisisMarkerPlugin,
  makeRefugeeEventMarkerPlugin,
  maxCrisisPillWidth,
  shouldShowDisasterMarkers,
  shouldShowWarMarkers
} from "/demographics/ui/screen-demographics/charts/line/chart-line-event-markers.js";
import { DemographicsSettings } from "/demographics/ui/core/demographics-settings.js";

const savedChart = globalThis.Chart;
const savedEmigrationData = globalThis.EmigrationData;
const savedGetSetting = DemographicsSettings.getSetting;

globalThis.Chart = { defaults: { font: { family: "Test" } } };

function fakeCtx() {
  const calls = [];
  return {
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
    translate: () => calls.push("translate"),
    measureText: (s) => ({ width: String(s).length * 6 })
  };
}

function testCollectionsAndSettings() {
  const history = {
    samples: [
      { chartTurn: 1, turn: 1, gameYear: "4000 BCE", players: { "1": { metrics: { crisis_stage: 0 } } } },
      { chartTurn: 2, turn: 2, gameYear: "3900 BCE", players: { "1": { metrics: { crisis_stage: 1 } } } },
      { chartTurn: 3, turn: 3, gameYear: "3800 BCE", players: { "1": { metrics: { crisis_stage: 3 } } } }
    ],
    ageBoundaries: [{ age: "AGE_EXPLORATION" }],
    wars: [{ name: "Test War", startChartTurn: 2, startYear: "3900 BCE", startTurn: 2 }]
  };

  const ctx = {
    ageOffsets: new Map([["AGE_EXPLORATION", 10]]),
    boundaries: [],
    gameSeedStr: "abc",
    sampleX: (s) => s.chartTurn
  };

  const crisis = collectCrisisMarkers("score", history, ctx);
  assert.equal(crisis.length, 3, "stage skip should synthesize intermediate onset markers");

  const age = collectAgeMarkers(history, ctx.ageOffsets);
  assert.equal(age.length, 1);
  assert.equal(age[0].turn, 11);

  DemographicsSettings.getSetting = (k, d) => {
    if (k === "showWarMarkers") return false;
    if (k === "showDisasterMarkers") return true;
    return d;
  };
  assert.equal(shouldShowWarMarkers(), false);
  assert.equal(shouldShowDisasterMarkers(), true);

  globalThis.EmigrationData = {
    disasterEvents: () => [{ name: "Flood", year: "3900 BCE", turn: 2 }]
  };

  const refugee = collectRefugeeEventMarkers("emig_refugees", history);
  assert.equal(refugee.length, 1, "war markers off + disaster markers on should include disasters only");
  assert.equal(refugee[0].label, "Flood");

  const allOffMetric = collectRefugeeEventMarkers("score", history);
  assert.equal(allOffMetric.length, 0);

  const chart = { ctx: fakeCtx() };
  assert.ok(maxCrisisPillWidth(chart, crisis) > 0);
}

function testPluginsDrawPaths() {
  const ctx = fakeCtx();
  const chart = {
    ctx,
    scales: {
      x: {
        min: 0,
        max: 20,
        getPixelForValue: (v) => v * 10
      }
    },
    chartArea: { top: 0, bottom: 100, right: 300 },
    options: { font: { family: "Test" } }
  };

  const crisisMarkers = [{ turn: 5, stage: 1, label: "Stage I", color: "#f00", year: "1000 BCE", crisisName: "Storm" }];
  const ageMarkers = [{ turn: 7, label: "Exploration Begins", color: "#b78cff" }];
  const refugeeMarkers = [{ turn: 8, label: "War", year: "900 BCE", color: "#e06c5e" }];

  makeCrisisMarkerPlugin(crisisMarkers).afterDatasetsDraw(chart);
  makeAgeMarkerPlugin(ageMarkers).afterDatasetsDraw(chart);
  makeRefugeeEventMarkerPlugin(refugeeMarkers).afterDatasetsDraw(chart);

  assert.ok(ctx.calls.includes("stroke"));
  assert.ok(ctx.calls.includes("fillText"));
}

try {
  testCollectionsAndSettings();
  testPluginsDrawPaths();
  console.log("chart-line-event-markers-branches harness passed");
} finally {
  globalThis.Chart = savedChart;
  globalThis.EmigrationData = savedEmigrationData;
  DemographicsSettings.getSetting = savedGetSetting;
}
