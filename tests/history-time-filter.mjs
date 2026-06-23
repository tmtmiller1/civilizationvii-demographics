import assert from "node:assert/strict";

import {
  computeTurnRange,
  TIME_FILTERS
} from "/demographics/ui/screen-demographics/views/history/history-time-filter.js";

/**
 * Build a synthetic 3-age history. `sampleX` short-circuits on a finite
 * `chartTurn`, so each sample's chart-X equals its `chartTurn` and the age-range
 * math is fully deterministic.
 * @returns {*} A history blob with three ages, two samples each.
 */
function makeHistory() {
  return {
    version: 1,
    seed: "test",
    ageBoundaries: [],
    eliminated: {},
    samples: [
      { chartTurn: 1, turn: 1, age: "AGE_ANTIQUITY", gameYear: "2000 BCE" },
      { chartTurn: 2, turn: 2, age: "AGE_ANTIQUITY", gameYear: "1500 BCE" },
      { chartTurn: 3, turn: 3, age: "AGE_EXPLORATION", gameYear: "500 CE" },
      { chartTurn: 4, turn: 4, age: "AGE_EXPLORATION", gameYear: "1000 CE" },
      { chartTurn: 5, turn: 5, age: "AGE_MODERN", gameYear: "1800 CE" },
      { chartTurn: 6, turn: 6, age: "AGE_MODERN", gameYear: "1900 CE" }
    ]
  };
}

function testAgeFiltersPresentAndEnabled() {
  const ids = TIME_FILTERS.map((f) => f.id);
  for (const id of ["age1", "age2", "age3", "age", "all"]) {
    assert.ok(ids.includes(id), `${id} present in TIME_FILTERS`);
  }
  // Every filter is selectable: none is flagged disabled (so buildTimeFilterRow
  // renders them all).
  assert.ok(TIME_FILTERS.every((f) => !f.disabled), "no time filter is disabled");
}

function testAge1Window() {
  assert.deepEqual(
    computeTurnRange(makeHistory(), "age1"),
    { min: 1, max: 2 },
    "Age I clamps to the first age's turn window"
  );
}

function testAge2Window() {
  assert.deepEqual(
    computeTurnRange(makeHistory(), "age2"),
    { min: 3, max: 4 },
    "Age II clamps to the second age's turn window"
  );
}

function testAge3Window() {
  assert.deepEqual(
    computeTurnRange(makeHistory(), "age3"),
    { min: 5, max: 6 },
    "Age III clamps to the third (last) age's turn window"
  );
}

function testCurrentAgeWindow() {
  assert.deepEqual(
    computeTurnRange(makeHistory(), "age"),
    { min: 5, max: 6 },
    "Current-age filter spans the latest age boundary → now"
  );
}

function testAllIsFullDomain() {
  assert.equal(
    computeTurnRange(makeHistory(), "all"),
    null,
    "'all' returns null so the chart uses its full natural domain"
  );
}

function testAgeWindowsAreContiguousAndDistinct() {
  const a1 = computeTurnRange(makeHistory(), "age1");
  const a2 = computeTurnRange(makeHistory(), "age2");
  const a3 = computeTurnRange(makeHistory(), "age3");
  assert.ok(
    a1.max < a2.min && a2.max < a3.min,
    "age windows are non-overlapping and ordered"
  );
}

function testUnreachedAgesFallBackToFullDomain() {
  // A game that has only reached the first age: Age II / III have no samples, so
  // they resolve to null (the chart falls back to its full domain) rather than
  // throwing or returning a bogus window.
  const oneAge = {
    version: 1,
    ageBoundaries: [],
    eliminated: {},
    samples: [
      { chartTurn: 1, turn: 1, age: "AGE_ANTIQUITY", gameYear: "2000 BCE" },
      { chartTurn: 2, turn: 2, age: "AGE_ANTIQUITY", gameYear: "1500 BCE" }
    ]
  };
  assert.deepEqual(
    computeTurnRange(oneAge, "age1"),
    { min: 1, max: 2 },
    "Age I resolves even with a single age present"
  );
  assert.equal(
    computeTurnRange(oneAge, "age2"),
    null,
    "Age II (not yet reached) falls back to the full domain"
  );
  assert.equal(
    computeTurnRange(oneAge, "age3"),
    null,
    "Age III (not yet reached) falls back to the full domain"
  );
}

testAgeFiltersPresentAndEnabled();
testAge1Window();
testAge2Window();
testAge3Window();
testCurrentAgeWindow();
testAllIsFullDomain();
testAgeWindowsAreContiguousAndDistinct();
testUnreachedAgesFallBackToFullDomain();

console.log("history-time-filter harness passed (age filters resolve correct windows)");
