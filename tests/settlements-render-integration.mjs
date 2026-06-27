// Covers: view-settlements.js + view-settlements-civranking.js
//         view-settlements-detail.js, view-settlements-showcase.js, view-settlements-table.js
import assert from "node:assert/strict";
import { createFakeDocument } from "./_dom-stub.mjs";

const { document } = createFakeDocument();
globalThis.document = document;
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.Locale = { compose: (k) => String(k).replace(/^LOC_/, "") };
globalThis.GameContext = { localPlayerID: 1 };
globalThis.Configuration = { getGame: () => ({ getValue: () => "full", startSeed: "seed1" }) };
globalThis.Audio = { playSound: () => {} };
globalThis.UI = { getIconURL: () => "blp:test" };
globalThis.Constructibles = { getAt: () => null };
globalThis.GameplayMap = { getPlotByIndex: () => null, getSize: () => ({ width: 60, height: 40 }) };

const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k)
};

function makeSettings() {
  const data = {};
  return {
    getSetting: (k, d) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : d),
    setSetting: (k, v) => { data[k] = v; }
  };
}

const { render: renderSettlements } = await import(
  "/demographics/ui/screen-demographics/views/settlements/view-settlements.js"
);

// Minimal ctx — settlementBoard will be empty (no engine Constructibles)
const ctx = {
  history: { samples: [] },
  settings: makeSettings(),
  requestReload: () => {}
};
const host = document.createElement("div");
host._rect.width = 1200; host._rect.height = 900;
renderSettlements(host, ctx);
assert.ok(host.children.length > 0);

delete globalThis.document;
delete globalThis.requestAnimationFrame;
delete globalThis.Locale;
delete globalThis.GameContext;
delete globalThis.Configuration;
delete globalThis.Audio;
delete globalThis.UI;
delete globalThis.Constructibles;
delete globalThis.GameplayMap;
delete globalThis.localStorage;
console.log("settlements-render-integration harness passed");
