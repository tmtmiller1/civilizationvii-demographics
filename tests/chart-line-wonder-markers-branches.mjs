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

// The wonder tooltip is an innerHTML sink, so the game's OWN text markup ([B], [icon:…],
// [TIP:…]) has to be turned into engine markup by Locale.stylize. Locale.compose returns those
// tokens verbatim, and escaping them just printed them on screen.
function testWonderDescriptionMarkup() {
  const savedLocale = globalThis.Locale;
  const RAW = "[TIP:LOC_PEDIA]Improvement[/TIP] gives [icon:YIELD_FOOD] Food & <grain>";
  const makeBuild = () => new Map([["1", [{ x: 1, turn: 5, wonderType: "BUILDING_A", kind: "built" }]]]);

  // No Locale.stylize on this engine: fall back to stripped + escaped plain text. The one thing
  // that must never happen is raw markup reaching the tooltip.
  globalThis.Locale = { compose: () => RAW };
  const b1 = makeBuild();
  resolveWonderEvents(b1);
  const e1 = b1.get("1")[0];
  assert.equal(e1.wonderDescription, RAW, "the composed string is kept for the longest-candidate test");
  assert.ok(e1.wonderDescriptionHtml, "a tooltip description is produced either way");
  assert.ok(!/\[/.test(e1.wonderDescriptionHtml), "no raw markup token survives into the tooltip HTML");
  assert.ok(/&amp;/.test(e1.wonderDescriptionHtml), "the fallback escapes for its innerHTML sink");
  assert.ok(/Improvement gives {2}Food/.test(e1.wonderDescriptionHtml.replace(/&amp;.*/, "")) ||
    /Improvement/.test(e1.wonderDescriptionHtml), "the words inside the markup survive");

  // With Locale.stylize: hand the engine's own markup through untouched.
  const STYLED = '<p cohinline><fxs-font-icon data-icon-id="YIELD_FOOD"></fxs-font-icon>&nbsp;Food</p>';
  globalThis.Locale = { compose: () => RAW, stylize: () => STYLED };
  const b2 = makeBuild();
  resolveWonderEvents(b2);
  assert.equal(b2.get("1")[0].wonderDescriptionHtml, STYLED, "stylized engine markup passes through unchanged");

  globalThis.Locale = savedLocale;
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

// A wonder tip is placed once per hover, and GameFace reports offsetWidth/Height as 0 on the tick
// an element is first shown. With no size the right-edge flip could not fire and the clamp was a
// no-op, so a wonder near the right of the plot drew its tip off the frame and the text was cut by
// the panel edge (reported 2026-09-23). The placement has to settle on the next frame, a settled
// size has to carry to the next hover, and a queued frame must not move a tip that was hidden.
function testWonderTipRightEdgeFlip() {
  const frames = [];
  const savedRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (fn) => frames.push(fn);
  try {
    const wrap = document.createElement("div");
    wrap.clientWidth = 800;
    wrap.clientHeight = 500;
    const canvas = document.createElement("canvas");
    canvas.offsetLeft = 0;
    canvas.offsetTop = 0;
    canvas.parentNode = wrap;

    const eventsByPid = new Map([
      [
        "1",
        [{ turn: 2, year: "1680 BCE", wonderType: "BUILDING_BELL", iconUrl: "blp:test", wonderName: "Bell" }]
      ]
    ]);
    const els = new Map();
    const tipState = { wonderTip: null };
    const plugin = makeWonderMarkersPlugin([{ leaderType: "LEADER_A", pid: 1 }], eventsByPid, els, tipState);
    const chart = {
      canvas,
      scales: { x: { min: 1, max: 3, getPixelForValue: () => 760 }, y: { getPixelForValue: () => 200 } },
      data: { datasets: [{ leaderType: "LEADER_A", hidden: false, label: "A", data: [{ x: 2, y: 5 }] }] }
    };
    plugin.afterDatasetsDraw(chart);
    const marker = [...els.values()][0];
    // The hover reads the marker's live offset, which the stub does not derive from style.
    marker.offsetLeft = 746;
    marker.offsetTop = 186;

    marker.dispatch("mouseenter");
    const tip = tipState.wonderTip;
    assert.ok(tip, "hovering a marker shows the tip");
    assert.equal(tip.style.display, "block");
    assert.equal(frames.length, 1, "a re-place frame is queued because this tick had no measurement");

    // GameFace lays the box out now: a tip wider than the room to the marker's right.
    tip.offsetWidth = 300;
    tip.offsetHeight = 200;
    frames[0]();
    const settledLeft = parseFloat(tip.style.left);
    assert.ok(settledLeft < marker.offsetLeft, "the settled tip flips to the left of the icon");
    assert.ok(settledLeft + 300 <= 800, "and its right edge stays inside the wrap");
    assert.ok(parseFloat(tip.style.top) + 200 <= 500, "and its bottom edge stays inside the wrap");

    // A frame queued before the tip was hidden must not move it afterwards.
    marker.dispatch("mouseleave");
    assert.equal(tip.style.display, "none");
    tip.style.left = "-999px";
    frames[0]();
    assert.equal(tip.style.left, "-999px", "a stale frame does not reposition a hidden tip");

    // Second hover, still unmeasured on the showing tick: the remembered size flips it immediately,
    // so there is no frame where the tip draws past the right edge.
    tip.offsetWidth = 0;
    tip.offsetHeight = 0;
    marker.dispatch("mouseenter");
    assert.ok(
      parseFloat(tip.style.left) < marker.offsetLeft,
      "the remembered size flips the tip on the tick it is shown"
    );
  } finally {
    globalThis.requestAnimationFrame = savedRaf;
  }
}

try {
  testCollectionAndResolve();
  testWonderDescriptionMarkup();
  testPluginMarkerPlacement();
  testWonderTipRightEdgeFlip();
  console.log("chart-line-wonder-markers-branches harness passed");
} finally {
  globalThis.document = saved.document;
  globalThis.UI = saved.UI;
  globalThis.GameInfo = saved.GameInfo;
  globalThis.Locale = saved.Locale;
  DemographicsSettings.getSetting = saved.getSetting;
}
