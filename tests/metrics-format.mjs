import assert from "node:assert/strict";
import {
  formatBigNumber,
  formatCount,
  formatArea,
  formatPercent,
  formatSignedRate,
  formatCurrency
} from "/demographics/ui/metrics/metrics-format.js";

// Numeric formatters localize through the engine's Locale.toNumber when present
// and fall back to manual English formatting otherwise. This harness pins BOTH
// paths: the off-engine fallback (so nothing regresses in Node / early load) and
// the on-engine delegation (so the locale-aware path is actually exercised).

// ── 1. OFF-ENGINE (no Locale global): fallback reproduces the prior output ────
delete globalThis.Locale;
assert.equal(formatCount(1234567), "1,234,567", "fallback groups with commas");
assert.equal(formatCount(999), "999");
assert.equal(formatBigNumber(1234567), "1.23M", "fallback abbreviates + 2dp");
assert.equal(formatBigNumber(2500), "2.5K");
assert.equal(formatBigNumber(999), "999");
assert.equal(formatBigNumber(-3.2e9), "-3.20B");
assert.equal(formatArea(12345), "12,345 km²");
assert.equal(formatPercent(42.6), "43%");
assert.equal(formatSignedRate(12.34), "+12.3/turn");
assert.equal(formatSignedRate(-250), "-250/turn");
assert.equal(formatCurrency(1500), "$1.5K");
assert.equal(formatBigNumber(NaN), "—");
assert.equal(formatCount(Infinity), "—");

// ── 2. ON-ENGINE: numbers route through Locale.toNumber. Mock a German-style
//    formatter ("." thousands, "," decimal) and assert the formatters delegate.
const de = (n, spec) => {
  const digits = spec === "0.00" ? 2 : spec === "0.0" ? 1 : 0;
  const [i, f] = Number(n).toFixed(digits).split(".");
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return f ? grouped + "," + f : grouped;
};
globalThis.Locale = { toNumber: (n, spec) => de(n, spec) };
assert.equal(formatCount(1234567), "1.234.567", "on-engine uses locale grouping");
assert.equal(formatBigNumber(1234567), "1,23M", "on-engine localizes the mantissa");
assert.equal(formatArea(12345), "12.345 km²", "suffix kept, number localized");
assert.equal(formatPercent(42), "42%");
assert.equal(formatSignedRate(12.3), "+12,3/turn", "rate decimal localized");
assert.equal(formatSignedRate(-250), "-250/turn", "integer rate, no decimal");

// ── 3. Locale.toNumber throws → graceful fallback (never breaks display) ──────
globalThis.Locale = { toNumber: () => { throw new Error("boom"); } };
assert.equal(formatCount(1234567), "1,234,567", "throwing Locale.toNumber falls back");
assert.equal(formatBigNumber(1234567), "1.23M");

delete globalThis.Locale;
console.log("metrics-format harness passed (off-engine fallback + on-engine Locale.toNumber delegation)");
