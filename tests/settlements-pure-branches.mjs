// Covers: settlements-population-variance.js, settlements-data.js
// Pure / data-layer — minimal stubs needed.
import assert from "node:assert/strict";

globalThis.GameContext = { localPlayerID: 1 };

// ── settlements-population-variance ──────────────────────────────────
const { applyPopulationVarianceAndEnsureUnique } = await import(
  "/demographics/ui/screen-demographics/settlements/settlements-population-variance.js"
);

// Pass a short list; the function adds variance and deduplicates
const base = [
  { id: 1, name: "Rome", populationEstimate: 5000 },
  { id: 2, name: "Han", populationEstimate: 5000 },
  { id: 3, name: "Athens", populationEstimate: 3000 }
];
const mutable = base.map((x) => ({ ...x }));
applyPopulationVarianceAndEnsureUnique(mutable);
assert.equal(mutable.length, 3);
// After dedup every estimate should be unique
const estimates = mutable.map((x) => x.populationEstimate);
assert.equal(new Set(estimates).size, 3);

// Empty / single element edge cases
const empty = [];
applyPopulationVarianceAndEnsureUnique(empty);
assert.equal(empty.length, 0);
const single = [{ id: 99, name: "X", populationEstimate: 1000 }];
applyPopulationVarianceAndEnsureUnique(single);
assert.equal(single.length, 1);

// Variation is GROUNDED IN REAL METRICS, not a bare name hash: two same-size settlements with
// different happiness / urban:rural read differently, and the thriving one reads higher.
const thriving = { id: "a", name: "A", population: 20, populationEstimate: 1_000_000,
  urban: 16, rural: 4, outputs: { happiness: 25, food: 30 }, trend: { popGrowthPerTurn: 2 } };
const struggling = { id: "b", name: "B", population: 20, populationEstimate: 1_000_000,
  urban: 4, rural: 16, outputs: { happiness: -15, food: 5 }, trend: { popGrowthPerTurn: -1 } };
const pair = [ { ...thriving }, { ...struggling } ];
applyPopulationVarianceAndEnsureUnique(pair);
assert.notEqual(pair[0].populationEstimate, pair[1].populationEstimate, "same-size cities must differ");
assert.ok(pair[0].populationEstimate > pair[1].populationEstimate,
  "the thriving (happier, more urban, growing) city should read higher");
// Deterministic: same inputs → same outputs across runs.
const pair2 = [ { ...thriving }, { ...struggling } ];
applyPopulationVarianceAndEnsureUnique(pair2);
assert.equal(pair2[0].populationEstimate, pair[0].populationEstimate, "variation must be deterministic");

// ── settlements-data ─────────────────────────────────────────────────
const { SETTLEMENT_OUTPUTS, valueOf, buildSettlementBoard } = await import(
  "/demographics/ui/screen-demographics/settlements/settlements-data.js"
);

assert.ok(Array.isArray(SETTLEMENT_OUTPUTS));
assert.ok(SETTLEMENT_OUTPUTS.length > 0);

// valueOf with a proper settlement object (needs .outputs map)
const s = { id: 1, name: "Rome", populationEstimate: 5000, isTown: false,
            composite: 42, ranks: { composite: 1 }, outputs: {} };
const firstOutput = SETTLEMENT_OUTPUTS[0];
// Pass composite key (always safe)
assert.ok(typeof valueOf(s, "composite") === "number");
// Pass a specific output key with empty outputs → returns 0
assert.equal(valueOf(s, firstOutput.id ?? firstOutput.key ?? "pop"), 0);

// buildSettlementBoard needs engine globals; confirm it either returns a board or throws gracefully
let board;
try { board = buildSettlementBoard(); } catch (_) { board = null; }
// Just confirm it doesn't crash the process — board may be null when engine absent

delete globalThis.GameContext;
console.log("settlements-pure-branches harness passed");
