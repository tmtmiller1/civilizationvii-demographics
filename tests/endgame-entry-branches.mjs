// Covers: demographics-endgame-entry.js
//
// Regression guard for a bug that shipped silently for two months: Coherent
// Gameface reports `localName` in UPPERCASE, so the screen check
// `node.localName === "screen-victory-progress"` was never true and the
// end-of-game button simply never appeared — no error, no log line. The DOM stub
// mirrors Gameface's casing so that class of bug fails here instead of in game.
import assert from "node:assert/strict";
import { createFakeDocument } from "./_dom-stub.mjs";

const { document, FakeElement } = createFakeDocument();
// Real elements report nodeType 1; the observer pre-filter keys on it.
FakeElement.prototype.nodeType = 1;
globalThis.document = document;
globalThis.HTMLElement = FakeElement;
globalThis.Locale = {
  compose: (k) => (k === "LOC_MOD_DEMOGRAPHICS_NAME" ? "Demographics" : String(k))
};

// Capture the deferred missing-hook report so it can be run on demand.
const timers = [];
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms) => {
  timers.push({ fn, ms });
  return timers.length;
};
const errors = [];
const realError = console.error;
console.error = (...a) => errors.push(a.join(" "));
const runTimers = () => {
  for (const tm of timers.splice(0)) tm.fn();
};

let observerCb = null;
globalThis.MutationObserver = class {
  constructor(cb) {
    observerCb = cb;
  }
  observe() {}
  disconnect() {}
};

const entry = await import("/demographics/ui/demographics-endgame-entry.js");
assert.ok(observerCb, "the entry module should install a MutationObserver");

// ── the regression itself ────────────────────────────────────────────────────
// Pinned directly, because the injection paths below can reach a screen via
// closest()/querySelector() — which ARE case-insensitive — and would therefore
// keep passing even with the original `node.localName === "..."` bug restored.
assert.equal(
  entry.isResultScreen(new FakeElement("screen-victory-progress")),
  true,
  "must recognise an UPPERCASE localName (Gameface) — a strict lowercase compare here is the bug"
);
assert.equal(
  entry.isResultScreen(new FakeElement("endgame-screen")),
  true,
  "endgame-screen is a results screen in Civ VII 1.5.0"
);
assert.equal(
  entry.isResultScreen(new FakeElement("div")),
  false,
  "an unrelated element is not a results screen"
);

/** Deliver one added node to the module's observer. */
function fire(node) {
  observerCb([{ addedNodes: [node] }]);
}

function actionRow() {
  const row = new FakeElement("div");
  row.className = "absolute bottom-10 right-10 flex flow-row";
  return row;
}

// The stub must mirror Gameface, or this whole file tests the wrong engine.
assert.equal(
  new FakeElement("screen-victory-progress").localName,
  "SCREEN-VICTORY-PROGRESS",
  "stub must report localName in UPPERCASE like Gameface"
);

// ── results screen ───────────────────────────────────────────────────────────
// The victory tracker is reachable mid-game from the dock and has no action row
// there. Injecting anyway would strand a floating button in the corner.
const tracker = new FakeElement("screen-victory-progress");
document.body.appendChild(tracker);
fire(tracker);
assert.equal(
  tracker.querySelector("#demographics-endgame-button"),
  null,
  "no action row => no button, never stranded at the screen root"
);
// The mid-game tracker legitimately has no action row: no report is scheduled for it.
assert.equal(timers.length, 0, "the mid-game victory tracker never reports a missing row");
// The end-of-game screen always has the row; when it never mounts that is reported ONCE via
// console.error (UI.log), naming the selector, so a base-game DOM change is visible instead of a
// silently missing button.
const ended = new FakeElement("endgame-screen");
document.body.appendChild(ended);
fire(ended);
assert.equal(timers.length, 1, "a missed hook schedules one deferred report");
runTimers();
assert.equal(errors.length, 1, "reported once");
assert.ok(errors[0].includes(".bottom-10.right-10"), "names the selector that failed");
assert.ok(errors[0].includes("endgame-screen"), "names the screen");
const ended2 = new FakeElement("endgame-screen");
document.body.appendChild(ended2);
fire(ended2);
runTimers();
assert.equal(errors.length, 1, "a second miss of the same hook is not reported again");

// The row can mount after its screen; the button must still land inside it.
const row = actionRow();
tracker.appendChild(row);
fire(row);
const btn = tracker.querySelector("#demographics-endgame-button");
assert.ok(btn, "button should appear once the action row exists");
assert.equal(btn.parentNode, row, "button belongs in the action row");
assert.equal(row.firstChild, btn, "button goes first in the row");
assert.equal(btn.textContent, "Demographics", "label is localized, not a raw LOC tag");

// Idempotent: a second row must not yield a second button.
const secondRow = actionRow();
tracker.appendChild(secondRow);
fire(secondRow);
assert.equal(
  tracker.querySelectorAll("#demographics-endgame-button").length,
  1,
  "never inject a duplicate button"
);

// Civ VII 1.5.0 shows `endgame-screen` at game end; it must work too.
const endgame = new FakeElement("endgame-screen");
endgame.appendChild(actionRow());
document.body.appendChild(endgame);
fire(endgame);
assert.ok(
  endgame.querySelector("#demographics-endgame-button"),
  "endgame-screen is a results screen and should get the button"
);

// A screen nested inside an added subtree is still found.
const wrapper = new FakeElement("div");
const nested = new FakeElement("screen-victory-progress");
nested.appendChild(actionRow());
wrapper.appendChild(nested);
document.body.appendChild(wrapper);
fire(wrapper);
assert.ok(
  nested.querySelector("#demographics-endgame-button"),
  "a results screen inside an added node should be found"
);

// ── pause menu ───────────────────────────────────────────────────────────────
const pause = new FakeElement("div");
pause.id = "pause-menu-button-container";
document.body.appendChild(pause);
fire(pause);
const pauseBtn = pause.querySelector("#demographics-pause-button");
assert.ok(pauseBtn, "pause menu should get a button");
assert.equal(pauseBtn.textContent, "Demographics");

// The row mounting later must not leave a stale report behind: a screen whose row arrives within
// the grace period reports nothing.
const late = new FakeElement("endgame-screen");
document.body.appendChild(late);
fire(late);
late.appendChild(actionRow());
fire(late.children[0]);
runTimers();
assert.equal(errors.length, 1, "a row that mounts within the grace period cancels the report");

// Unrelated nodes must be ignored without throwing.
fire(new FakeElement("div"));
fire({ nodeType: 3, textContent: "text" });

// The observer pre-filter drops non-element nodes before any selector work: a text node is never
// queried, even one that quacks like an element.
let touched = 0;
const textNode = new FakeElement("div");
textNode.nodeType = 3;
textNode.className = "bottom-10 right-10";
textNode.querySelector = () => {
  touched++;
  return null;
};
fire(textNode);
assert.equal(touched, 0, "text nodes (nodeType 3) are skipped before inspect");
// A bare element (no id, class or children) is skipped too; one with a class is inspected.
const bare = new FakeElement("div");
bare.querySelector = () => {
  touched++;
  return null;
};
fire(bare);
assert.equal(touched, 0, "an empty, unclassed element is skipped");
bare.className = "something";
fire(bare);
assert.ok(touched > 0, "a classed element is inspected");

// The pause menu mounting WITHOUT its button container is reported once as well.
const menu = new FakeElement("screen-pause-menu");
menu.className = "screen";
document.body.appendChild(menu);
fire(menu);
runTimers();
assert.equal(errors.length, 2, "missing pause container reported");
assert.ok(errors[1].includes("#pause-menu-button-container"), "names the pause hook");

globalThis.setTimeout = realSetTimeout;
console.error = realError;

console.log("endgame-entry harness passed");
