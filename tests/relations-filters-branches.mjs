import assert from "node:assert/strict";

import {
  FILTER_GROUPS,
  filterVisuals,
  filtersForView,
  pillColorFor
} from "/demographics/ui/screen-demographics/views/relations/relations-filters.js";

function hasKey(arr, key) {
  return arr.some((x) => x && x.key === key);
}

function testFilterCatalogs() {
  assert.deepEqual(
    FILTER_GROUPS.map((g) => g.key),
    ["politics", "agreements"],
    "relations groups should expose politics + agreements"
  );

  const civ = filtersForView("civ");
  assert.ok(hasKey(civ, "war"), "civ filters should include war");
  assert.ok(hasKey(civ, "openborders"), "civ filters should include open borders");
  assert.ok(hasKey(civ, "trade"), "civ filters should include trade");

  const cs = filtersForView("cs");
  assert.ok(hasKey(cs, "suzerain"), "city-state filters should include suzerain");
  assert.ok(hasKey(cs, "trade"), "city-state filters should include trade");
  assert.ok(
    cs.some((f) => f.group === "agreements"),
    "city-state filters should include agreement-group actions"
  );
}

function testVisualOverridesAndPillColors() {
  assert.equal(filterVisuals("suzerain", "civ"), null, "civ tab should not apply cs override");

  const csSuz = filterVisuals("suzerain", "cs");
  assert.ok(csSuz && csSuz.color, "cs suzerain should have a visual override");

  assert.equal(pillColorFor("trade", "cs"), "#f0c33c", "cs trade color should match override");
  assert.ok(/^#/.test(pillColorFor("war", "civ")), "attitude filters should resolve to hex colors");
  assert.equal(pillColorFor("unknown-key", "civ"), "#bfbfbf", "unknown filters should use neutral swatch");
}

testFilterCatalogs();
testVisualOverridesAndPillColors();

console.log("relations-filters-branches harness passed");
