import assert from "node:assert/strict";
import { createFakeDocument } from "./_dom-stub.mjs";

const { document, FakeElement } = createFakeDocument();
globalThis.document = document;

const savedControls = globalThis.Controls;

let definedName = null;
let definition = null;

globalThis.Controls = {
  define: (name, def) => {
    definedName = name;
    definition = def;
    return def;
  }
};

await import("/demographics/ui/screen-demographics/screen/screen-demographics.js");

assert.equal(definedName, "screen-demographics");
assert.ok(definition && typeof definition === "object");
assert.equal(typeof definition.createInstance, "function");
assert.ok(Array.isArray(definition.styles));
assert.ok(Array.isArray(definition.content));
assert.ok(Array.isArray(definition.classNames));

const instance = new definition.createInstance();
assert.equal(typeof instance.onInitialize, "function");
instance.onInitialize();
instance.onLoseFocus();
instance.onReceiveFocus();
instance.close();

// ── renderActiveView: a throwing view leaves a visible message, not a blank tab ──
const root = new FakeElement("div");
root.removeEventListener = () => {};
const viewHost = new FakeElement("div");
viewHost.className = "demographics-view-host";
root.appendChild(viewHost);
instance.Root = root;
instance.activeView = "rankings";
instance._renderLazyView = () => {
  throw new Error("boom");
};
const savedError = console.error;
const errors = [];
console.error = (...a) => errors.push(a.join(" "));
instance.renderActiveView();
console.error = savedError;
assert.ok(errors.some((m) => m.includes("renderActiveView threw")), "the throw is still logged");
assert.equal(viewHost.children.length, 1, "exactly one fallback element after a throwing view");
assert.equal(
  viewHost.children[0].textContent,
  "LOC_DEMOGRAPHICS_EMPTY_CHART_RENDER_FAILED",
  "fallback carries the render-failed LOC text"
);
assert.ok(viewHost.children[0].classList.contains("demographics-empty"));

// ── onDetach destroys every live Chart.js instance under the root ──
let destroyed = 0;
const chartStub = () => ({ destroy: () => { destroyed++; } });
const classedHost = new FakeElement("div");
classedHost.className = "demographics-chart-host";
classedHost._demographicsChart = chartStub();
root.appendChild(classedHost);
const unclassedHost = new FakeElement("div");
unclassedHost._demographicsChart = chartStub();
const wrap = new FakeElement("div");
const canvas = document.createElement("canvas");
wrap.appendChild(canvas);
unclassedHost.appendChild(wrap);
root.appendChild(unclassedHost);
const bareHost = new FakeElement("div");
bareHost.className = "demographics-chart-host";
root.appendChild(bareHost);
instance.onDetach();
assert.equal(destroyed, 2, "one destroy per chart host (classed + canvas-walk), none for a bare host");
assert.equal(classedHost._demographicsChart, null, "classed host handle cleared");
assert.equal(unclassedHost._demographicsChart, null, "canvas-walk host handle cleared");
instance.onDetach();
assert.equal(destroyed, 2, "a second detach finds nothing to destroy");

// ── Escape / Cancel engine-input closes the screen (UNWATCHED in game) ──
const savedStatuses = globalThis.InputActionStatuses;
let closed = 0;
instance.close = () => { closed++; };
const mkEvent = (status, name, cancel) => ({
  detail: { status, name },
  isCancelInput: () => cancel,
  stopPropagation() {},
  preventDefault() {}
});
delete globalThis.InputActionStatuses;
instance._onInput(mkEvent(2, "sys-menu", false));
assert.equal(closed, 0, "no InputActionStatuses global => never closes, never throws");
globalThis.InputActionStatuses = { FINISH: 2, START: 1 };
instance._onInput(mkEvent(1, "sys-menu", false));
assert.equal(closed, 0, "START of the action is ignored");
instance._onInput(mkEvent(2, "accept", false));
assert.equal(closed, 0, "an unrelated action is ignored");
instance._onInput(mkEvent(2, "sys-menu", false));
assert.equal(closed, 1, "sys-menu FINISH closes");
instance._onInput(mkEvent(2, "cancel", true));
assert.equal(closed, 2, "isCancelInput() FINISH closes");
if (savedStatuses === undefined) delete globalThis.InputActionStatuses;
else globalThis.InputActionStatuses = savedStatuses;

if (savedControls === undefined) {
  delete globalThis.Controls;
} else {
  globalThis.Controls = savedControls;
}

console.log("screen-demographics-registration-branches harness passed");
