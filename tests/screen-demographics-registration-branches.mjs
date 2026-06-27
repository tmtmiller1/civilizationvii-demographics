import assert from "node:assert/strict";

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

if (savedControls === undefined) {
  delete globalThis.Controls;
} else {
  globalThis.Controls = savedControls;
}

console.log("screen-demographics-registration-branches harness passed");
