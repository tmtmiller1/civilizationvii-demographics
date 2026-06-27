import assert from "node:assert/strict";

import {
  collectWonderDestructions,
  collectWonderEvents,
  makeWonderMarkersPlugin,
  mergeWonderEvents,
  resolveWonderEvents,
  shouldShowWonders
} from "/demographics/ui/screen-demographics/charts/line/chart-line-wonder-markers.js";
import { DemographicsSettings } from "/demographics/ui/core/demographics-settings.js";
import { createFakeDocument } from "./_dom-stub.mjs";

const saved = {
  document: globalThis.document,
  UI: globalThis.UI,
  GameInfo: globalThis.GameInfo,
  Locale: globalThis.Locale,
  getSetting: DemographicsSettings.getSetting
};

const { document } = createFakeDocument();
globalThis.document = document;

globalThis.UI = {
  getIconURL: (type) => (type ? "blp:" + type : "")
};
globalThis.GameInfo = {
  Constructibles: {
    lookup: (type) => ({ Name: "LOC_" + type + "_NAME", Description: "LOC_" + type + "_DESC" })
  }
};
globalThis.Locale = {
  compose: (k) => (typeof k === "string" && k.startsWith("LOC_") ? k.replace(/^LOC_/, "") : String(k))
};

function testCollectionAndResolve() {
  DemographicsSettings.getSetting = (k, d) => {
    if (k === "showWonderMarkers") return true;
    return d;
  };
  assert.equal(shouldShowWonders("score"), true);

  const samples = [
    { turn: 1, gameYear: "4000 BCE", players: { "1": { wonderTypes: ["BUILDING_PYRAMIDS"] } } },
    { turn: 2, gameYear: "3900 BCE", players: { "1": { wonderTypes: ["BUILDING_PYRAMIDS", "BUILDING_GARDENS"] } } },
    { turn: 3, gameYear: "3800 BCE", players: { "1": { wonderTypes: ["BUILDING_GARDENS"] } } }
  ];
  const sampleX = (s) => s.turn;
  const builds = collectWonderEvents(samples, new Map(), [], sampleX);
  assert.equal(builds.get("1").length, 1, "only newly built wonders after initial seed should emit");

  const destroys = collectWonderDestructions(samples, new Map(), [], sampleX);
  assert.equal(destroys.get("1").length, 1, "permanently removed wonder should emit destruction");

  mergeWonderEvents(builds, destroys);
  resolveWonderEvents(builds);
  const merged = builds.get("1");
  assert.ok(merged.length >= 2);
  assert.ok(merged.every((e) => typeof e.iconUrl === "string" && e.iconUrl.length > 0));
  assert.ok(merged.every((e) => typeof e.wonderName === "string" && e.wonderName.length > 0));
}

function testPluginMarkerPlacement() {
  const wrap = document.createElement("div");
  wrap.clientWidth = 800;
  wrap.clientHeight = 500;
  const canvas = document.createElement("canvas");
  canvas.offsetLeft = 0;
  canvas.offsetTop = 0;
  canvas.parentNode = wrap;

  const eventsByPid = new Map([
    ["1", [{ turn: 2, year: "3900 BCE", wonderType: "BUILDING_GARDENS", iconUrl: "blp:test", wonderName: "Gardens" }]]
  ]);
  const els = new Map();
  const tipState = { wonderTip: null };
  const plugin = makeWonderMarkersPlugin([{ leaderType: "LEADER_A", pid: 1 }], eventsByPid, els, tipState);

  const chart = {
    canvas,
    scales: {
      x: { min: 1, max: 3, getPixelForValue: (v) => v * 100 },
      y: { getPixelForValue: (v) => 200 - v * 10 }
    },
    data: { datasets: [{ leaderType: "LEADER_A", hidden: false, label: "A", data: [{ x: 2, y: 5 }] }] }
  };

  plugin.afterDatasetsDraw(chart);
  assert.equal(els.size, 1);
  assert.ok(wrap.children.length > 0, "marker should be attached to chart wrap");
}

try {
  testCollectionAndResolve();
  testPluginMarkerPlacement();
  console.log("chart-line-wonder-markers-branches harness passed");
} finally {
  globalThis.document = saved.document;
  globalThis.UI = saved.UI;
  globalThis.GameInfo = saved.GameInfo;
  globalThis.Locale = saved.Locale;
  DemographicsSettings.getSetting = saved.getSetting;
}
