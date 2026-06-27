// Covers the bounded turn-indexed figures in demographics-metrics-helpers.js: war casualties and GDP
// must not balloon into the billions on long / slow (Marathon) games (player-facing-issues audit #1/#2).
import assert from "node:assert/strict";

const { scaleCasualtiesAt, scaleGDP } = await import(
  "/demographics/ui/metrics/demographics-metrics-helpers.js"
);

// ── #1 casualties era multiplier is capped ───────────────────────────────────
// Below the cap it is the unchanged raw × 1000 × 1.009^turn curve.
const early = scaleCasualtiesAt(100, 50); // 1.009^50 ≈ 1.565 → well under the 11× cap
assert.ok(Math.abs(early - 100 * 1000 * Math.pow(1.009, 50)) < 1e-6, "below cap: unchanged curve");

// A long / Marathon game (huge turn) saturates at the cap instead of running to billions.
const capped = scaleCasualtiesAt(100, 2000); // 1.009^2000 ≈ 6.5e7× uncapped
assert.equal(capped, 100 * 1000 * 11, "casualties era multiplier caps at 11×");
assert.ok(capped < 2_000_000, `100-unit war stays ~1.1M, not billions (got ${capped})`);

// Monotonic non-decreasing in turn, and never exceeds the cap.
let prev = 0;
for (const t of [0, 100, 250, 500, 1000, 5000]) {
  const v = scaleCasualtiesAt(10, t);
  assert.ok(v >= prev, "casualties non-decreasing in turn");
  assert.ok(v <= 10 * 1000 * 11 + 1e-6, "never exceeds the cap");
  prev = v;
}
assert.equal(scaleCasualtiesAt(0, 100), 0, "non-positive raw → 0");

// ── #2 GDP turn factor is capped ─────────────────────────────────────────────
// Below the cap, GDP is the unchanged raw × turn × 1e6 (a normal game is untouched).
assert.equal(scaleGDP(2, null, { turn: 100 }), 2 * 100 * 1_000_000, "below cap: unchanged");
// A very long / slow game caps the turn factor at 300 instead of reading ~500× richer for free.
assert.equal(scaleGDP(2, null, { turn: 500 }), 2 * 300 * 1_000_000, "GDP turn factor caps at 300");
assert.equal(scaleGDP(2, null, { turn: 5000 }), 2 * 300 * 1_000_000, "stays capped no matter how long");

console.log("metrics-scaling-caps harness passed");
