import assert from "node:assert/strict";
import { createFakeDocument } from "./_dom-stub.mjs";

const saved = {
  document: globalThis.document,
  Locale: globalThis.Locale,
  Audio: globalThis.Audio,
  UI: globalThis.UI
};

const { document } = createFakeDocument();
globalThis.document = document;
globalThis.Locale = { compose: (k) => String(k).replace(/^LOC_/, "") };
globalThis.Audio = { playSound: () => {} };
globalThis.UI = { getIconURL: () => "blp:test" };

const { renderDetailPanel } = await import(
  "/demographics/ui/screen-demographics/views/settlements/view-settlements-detail.js"
);

function makeSettlement(overrides = {}) {
  return {
    name: "Uruk",
    owner: {
      readable: "#224466",
      primary: "#224466",
      leaderName: "Gilgamesh",
      civName: "Sumer"
    },
    isTown: false,
    isCapital: true,
    ranks: { composite: 2 },
    composite: 1234,
    populationEstimate: 22,
    trend: { dir: 1, popGrowthPerTurn: 0.8, samples: 5 },
    founded: { year: "3000 BCE", exact: false },
    outputs: {
      population: 22,
      food: 18,
      production: 13,
      gold: 9,
      science: 11,
      culture: 7,
      wonders: 0,
      happiness: 5
    },
    wonders: [],
    ...overrides
  };
}

let rerenderCount = 0;
const content = document.createElement("div");
const st = {
  content,
  detail: makeSettlement()
};

const deps = {
  rerenderContent: () => {
    rerenderCount += 1;
  },
  buildOwnerAvatar: () => document.createElement("div"),
  buildTypeBadge: () => document.createElement("div"),
  buildTrendGlyph: () => document.createElement("span"),
  buildCameraButtons: () => document.createElement("div")
};

renderDetailPanel(st, deps);
assert.ok(content.children.length > 0);

const panel = content.children[0];
assert.ok(panel.className.includes("demographics-settle-detail"));
const back = panel.children[0];
back.dispatch("click");
assert.equal(st.detail, null);
assert.equal(rerenderCount, 1);

st.detail = makeSettlement({
  owner: { readable: "", primary: "", leaderName: "", civName: "" },
  wonders: [{ icon: "blp:test", nameKey: "LOC_WONDER_TEST" }],
  founded: { year: "2000 BCE", exact: true }
});
renderDetailPanel(st, {
  ...deps,
  buildCameraButtons: () => null
});

assert.equal(content.children.length, 2);

if (saved.document === undefined) delete globalThis.document;
else globalThis.document = saved.document;
if (saved.Locale === undefined) delete globalThis.Locale;
else globalThis.Locale = saved.Locale;
if (saved.Audio === undefined) delete globalThis.Audio;
else globalThis.Audio = saved.Audio;
if (saved.UI === undefined) delete globalThis.UI;
else globalThis.UI = saved.UI;

console.log("settlements-detail-render-branches harness passed");
