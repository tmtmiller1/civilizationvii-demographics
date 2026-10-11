// settlements-population-variance.js
//
// Deterministic population-estimate variance and uniqueness helpers used by
// the Settlements live board.

import { finiteOrZero } from "/demographics/ui/screen-demographics/screen/guarded-reads.js";

/**
 * A stable uint hash for deterministic per-settlement variance.
 * @param {string} key The stable settlement key.
 * @returns {number} Unsigned hash.
 */
function hashKey(key) {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Clamp to [-1, 1].
 * @param {number} x
 * @returns {number}
 */
function clampUnit(x) {
  return x < -1 ? -1 : x > 1 ? 1 : x;
}

// Soft scales that map a raw signal onto roughly [-1,1] via x/(|x|+SCALE). Chosen so ordinary
// spreads land mid-range, not pinned at the rails.
const HAPPINESS_SCALE = 10; // net amenities/happiness output
const GROWTH_SCALE = 0.5; // population growth per turn

/**
 * A directional bias in [-1,1] from naturally-centered real signals (net happiness, urban:rural
 * mix, growth trend), so a thriving city reads a touch larger than a stagnant one of the same size.
 * @param {*} settlement Settlement record (population/urban/rural/outputs/trend).
 * @returns {number} Bias in [-1,1].
 */
function metricBias(settlement) {
  const outputs = (settlement && settlement.outputs) || {};
  const happy = finiteOrZero(outputs.happiness);
  const happySignal = happy / (Math.abs(happy) + HAPPINESS_SCALE);
  const urban = finiteOrZero(settlement && settlement.urban);
  const rural = finiteOrZero(settlement && settlement.rural);
  const denom = urban + rural;
  const urbanSignal = denom > 0 ? (urban / denom - 0.5) * 2 : 0;
  const growth = settlement && settlement.trend ? finiteOrZero(settlement.trend.popGrowthPerTurn) : 0;
  const growthSignal = growth / (Math.abs(growth) + GROWTH_SCALE);
  return clampUnit(0.5 * happySignal + 0.3 * urbanSignal + 0.2 * growthSignal);
}

/**
 * Deterministic entropy seeded from the settlement's real metric state (yields, happiness,
 * urban/rural, founding turn); the name/id is folded in last only as a tie-breaker.
 * @param {*} settlement
 * @param {string} idKey
 * @returns {number} Entropy in [-1,1].
 */
function metricEntropy(settlement, idKey) {
  const outputs = (settlement && settlement.outputs) || {};
  const foundedTurn = settlement && settlement.founded && settlement.founded.turn;
  const founded = typeof foundedTurn === "number" ? Math.round(foundedTurn) : 0;
  const parts = [
    Math.round(finiteOrZero(outputs.food)),
    Math.round(finiteOrZero(outputs.production)),
    Math.round(finiteOrZero(outputs.gold)),
    Math.round(finiteOrZero(outputs.happiness)),
    Math.round(finiteOrZero(settlement && settlement.urban)),
    Math.round(finiteOrZero(settlement && settlement.rural)),
    founded,
    idKey
  ].join(":");
  return (hashKey(parts) / 4294967295) * 2 - 1;
}

/**
 * Deterministic per-settlement population variation around the scaled base, from real game metrics
 * ({@link metricBias}, {@link metricEntropy}). Magnitude stays a narrow ±1.5% (≥ ±2500 floor);
 * {@link claimUniquePopulation} then guarantees uniqueness.
 * @param {number} base
 * @param {*} settlement
 * @returns {number}
 */
function variedPopulation(base, settlement) {
  // `base` already includes the soft era ceiling; the variation runs on top, so a figure may sit
  // a hair above it. No post-variation clamp: it would collapse near-ceiling cities to the same
  // value and break the uniqueness guarantee.
  const rounded = Math.max(1, Math.round(base));
  const range = Math.max(2500, Math.round(rounded * 0.015));
  const idKey = settlementVarianceKey(settlement);
  const bias = metricBias(settlement);
  const entropy = metricEntropy(settlement, idKey);
  const tie = (hashKey(idKey) / 4294967295) * 2 - 1;
  const centered = clampUnit(0.55 * bias + 0.4 * entropy + 0.05 * tie);
  return Math.max(1, rounded + Math.round(centered * range));
}

/**
 * @param {*} settlement
 * @returns {number} Rounded raw population, or 0 when unreadable.
 */
function rawPopulationKey(settlement) {
  return typeof settlement.population === "number" && isFinite(settlement.population)
    ? Math.round(settlement.population)
    : 0;
}

/**
 * @param {Array<*>} list
 * @returns {Map<number, Array<*>>}
 */
function bucketByRawPopulation(list) {
  /** @type {Map<number, Array<*>>} */
  const buckets = new Map();
  for (const settlement of list) {
    if (typeof settlement.populationEstimate !== "number" || !isFinite(settlement.populationEstimate)) continue;
    const raw = rawPopulationKey(settlement);
    const bucket = buckets.get(raw);
    if (bucket) bucket.push(settlement);
    else buckets.set(raw, [settlement]);
  }
  return buckets;
}

/**
 * @param {*} settlement
 * @returns {string} Stable key.
 */
function settlementVarianceKey(settlement) {
  return typeof settlement.id === "string" ? settlement.id : String(settlement.id || "");
}

/**
 * @param {Array<*>} band Settlements sharing one raw population.
 * @returns {Array<{settlement: *, key: string, candidate: number}>} Sorted candidates.
 */
function buildBandCandidates(band) {
  return band
    .map((settlement) => {
      const key = settlementVarianceKey(settlement);
      return { settlement, key, candidate: variedPopulation(settlement.populationEstimate, settlement) };
    })
    .sort((a, b) => a.candidate - b.candidate || a.key.localeCompare(b.key));
}

/**
 * @param {Array<{candidate: number}>} candidates
 * @param {number} minAllowed Minimum legal starting value.
 */
function liftCandidatesToMin(candidates, minAllowed) {
  if (!candidates.length || candidates[0].candidate >= minAllowed) return;
  const delta = minAllowed - candidates[0].candidate;
  for (const item of candidates) item.candidate += delta;
}

/**
 * @param {number} candidate Starting candidate value.
 * @param {Set<number>} used
 * @returns {number}
 */
function claimUniquePopulation(candidate, used) {
  let value = candidate;
  while (value <= 0 || used.has(value)) value++;
  used.add(value);
  return value;
}

/**
 * @param {Array<{settlement: *, candidate: number}>} candidates
 * @param {Set<number>} used
 * @param {number} previousBandMax Max claimed value from prior raw bands.
 * @returns {number} Updated maximum estimate after this band.
 */
function applyCandidateBand(candidates, used, previousBandMax) {
  liftCandidatesToMin(candidates, previousBandMax + 1);
  let bandMax = previousBandMax;
  for (const item of candidates) {
    const claimed = claimUniquePopulation(item.candidate, used);
    item.settlement.populationEstimate = claimed;
    bandMax = claimed;
  }
  return bandMax;
}

/**
 * Apply deterministic variance, preserve strict ordering by raw city population,
 * and guarantee no two settlements share an exact population estimate integer.
 * @param {Array<*>} list Settlement-like records (mutated in place).
 */
export function applyPopulationVarianceAndEnsureUnique(list) {
  const byRawPopulation = bucketByRawPopulation(list);
  const used = new Set();
  let previousBandMax = 0;
  const rawBands = Array.from(byRawPopulation.keys()).sort((a, b) => a - b);

  for (const raw of rawBands) {
    const band = byRawPopulation.get(raw) || [];
    const candidates = buildBandCandidates(band);
    if (!candidates.length) continue;
    previousBandMax = applyCandidateBand(candidates, used, previousBandMax);
  }
}
