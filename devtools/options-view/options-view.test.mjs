// Dev-only harness for the unshipped Options view kept under devtools/options-view (see README.md).
// Run from the mod root:  node --loader ./tests/loader.mjs ./devtools/options-view/options-view.test.mjs
// Not part of `npm run verify`: the view is not in the modinfo and no screen mounts it.
import assert from "node:assert/strict";
import { createFakeDocument } from "../../tests/_dom-stub.mjs";

const { document } = createFakeDocument();
globalThis.document = document;
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.Locale = { compose: (k) => String(k) };
globalThis.GameContext = { localPlayerID: 1 };
globalThis.Configuration = { getGame: () => ({ getValue: () => "full", startSeed: "seed1" }) };
globalThis.Audio = { playSound: () => {} };

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

// ── view renders ────────────────────────────────────────────────────
const { render: renderOptions } = await import("./view-options.js");
const optHost = document.createElement("div");
optHost._rect.width = 1100; optHost._rect.height = 900;
renderOptions(optHost, {
  settings: makeSettings(),
  history: { samples: [] },
  requestReload: () => {},
  clearHistory: () => {},
  exportCsv: () => {}
});
assert.ok(optHost.children.length > 0);

// ── destructive buttons need two clicks (no window.confirm in GameFace) ──
const { buildButtonRowPanel } = await import("./view-options-actions.js");
const realNow = Date.now;
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
let fakeNow = 10000;
const timers = [];
Date.now = () => fakeNow;
globalThis.setTimeout = (fn, ms) => {
  timers.push({ fn, ms });
  return timers.length;
};
globalThis.clearTimeout = (id) => {
  if (timers[id - 1]) timers[id - 1].fn = null;
};
const runTimers = () => {
  for (const tm of timers.splice(0)) if (tm.fn) tm.fn();
};
let cleared = 0;
let saved = null;
const ctx = {
  storage: {
    clear: () => { cleared++; },
    load: () => ({ wars: [{ id: 1 }], samples: [] }),
    save: (h) => { saved = h; }
  },
  requestReload: () => {}
};
const makeButton = (label, handler) => {
  const b = document.createElement("fxs-button");
  b.setAttribute("caption", label);
  b.addEventListener("click", handler);
  return b;
};
const row = buildButtonRowPanel(ctx, { makeButton });
const [refreshBtn, clearBtn, resetBtn] = row.children;
assert.equal(clearBtn.getAttribute("caption"), "LOC_DEMOGRAPHICS_OPT_CLEAR");

clearBtn.dispatch("click");
assert.equal(cleared, 0, "first click arms, does not clear");
assert.equal(clearBtn.getAttribute("caption"), "LOC_DEMOGRAPHICS_CONFIRM_CLEAR_HISTORY", "armed label");
assert.ok(clearBtn.classList.contains("is-armed"));
assert.equal(timers.length, 1, "arming schedules the disarm timeout");
assert.equal(timers[0].ms, 6000, "6-second disarm");
clearBtn.dispatch("click");
assert.equal(cleared, 0, "a second event in the same physical press (click + action-activate) is ignored");
fakeNow += 1000;
clearBtn.dispatch("click");
assert.equal(cleared, 1, "second click performs the clear");
assert.equal(clearBtn.getAttribute("caption"), "LOC_DEMOGRAPHICS_OPT_CLEAR", "label restored after performing");
assert.ok(!clearBtn.classList.contains("is-armed"));
// The twin event of the confirming press must not re-arm the button right after the action ran.
clearBtn.dispatch("click");
assert.ok(!clearBtn.classList.contains("is-armed"), "the confirming press's twin event does not re-arm");
assert.equal(cleared, 1);

// Timeout disarms without performing.
fakeNow += 1000;
clearBtn.dispatch("click");
assert.ok(clearBtn.classList.contains("is-armed"));
runTimers();
assert.equal(cleared, 1, "timeout never performs");
assert.ok(!clearBtn.classList.contains("is-armed"), "timeout disarms");
assert.equal(clearBtn.getAttribute("caption"), "LOC_DEMOGRAPHICS_OPT_CLEAR");

// Any other button press disarms.
fakeNow += 1000;
clearBtn.dispatch("click");
fakeNow += 1000;
refreshBtn.dispatch("click");
assert.ok(!clearBtn.classList.contains("is-armed"), "refresh disarms the armed clear button");
assert.equal(cleared, 1);
clearBtn.dispatch("click");
fakeNow += 1000;
resetBtn.dispatch("click");
assert.ok(!clearBtn.classList.contains("is-armed"), "arming reset disarms clear");
assert.ok(resetBtn.classList.contains("is-armed"));
assert.equal(resetBtn.getAttribute("caption"), "LOC_DEMOGRAPHICS_OPT_RESET_WARS_ARMED");
assert.equal(saved, null, "arming reset does not save");
fakeNow += 1000;
resetBtn.dispatch("click");
assert.deepEqual(saved && saved.wars, [], "second click on reset empties wars and saves");
assert.equal(cleared, 1, "reset never clears samples");

Date.now = realNow;
globalThis.setTimeout = realSetTimeout;
globalThis.clearTimeout = realClearTimeout;

console.log("options-view dev harness passed");
