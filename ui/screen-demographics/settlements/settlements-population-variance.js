// settlements-population-variance.js
//
// Deterministic population-estimate variance and uniqueness helpers used by
// the Settlements live board.

/**
 * A stable uint hash for deterministic per-settlement variance.
 * @param {string} key The stable settlement key.
 * @returns {number} Unsigned hash.
 */
function hashKey(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Coerce to a finite number or 0.
 * @param {*} v Value. @returns {number} Finite number (0 otherwise).
 */
function num(v) {
  return typeof v === "number" && isFinite(v) ? v : 0;
}

/** Clamp to [-1, 1]. @param {number} x Value. @returns {number} Clamped. */
function clampUnit(x) {
  return x < -1 ? -1 : x > 1 ? 1 : x;
}

// Soft scales that map a raw signal onto roughly [-1,1] via x/(|x|+SCALE). Chosen so ordinary spreads
// land mid-range, not pinned at the rails.
const HAPPINESS_SCALE = 10; // net amenities/happiness output
const GROWTH_SCALE = 0.5; // population growth per turn

/**
 * A directional bias in [-1,1] from NATURALLY-CENTERED real signals: net happiness, the urban:rural
 * mix (denser cities lean higher), and the population growth trend. This is the "lean" of the
 * variation — grounded in game state, not invented — so a thriving city reads a touch larger than a
 * stagnant one of the same size.
 * @param {*} s Settlement record (population/urban/rural/outputs/trend).
 * @returns {number} Bias in [-1,1].
 */
function metricBias(s) {
  const o = (s && s.outputs) || {};
  const happy = num(o.happiness);
  const happySig = happy / (Math.abs(happy) + HAPPINESS_SCALE);
  const urban = num(s && s.urban);
  const rural = num(s && s.rural);
  const denom = urban + rural;
  const urbanSig = denom > 0 ? (urban / denom - 0.5) * 2 : 0;
  const growth = s && s.trend ? num(s.trend.popGrowthPerTurn) : 0;
  const growthSig = growth / (Math.abs(growth) + GROWTH_SCALE);
  return clampUnit(0.5 * happySig + 0.3 * urbanSig + 0.2 * growthSig);
}

/**
 * Deterministic ENTROPY seeded from the settlement's real metric state (food/production/gold/happiness,
 * urban/rural, founding turn) — NOT its name. Two cities differing in any of these get different
 * variation; a city's figure also shifts as its situation changes. The name/id is folded in last only
 * as a tie-breaker so identical-state cities still separate.
 * @param {*} s Settlement record.
 * @param {string} idKey Stable id (tie-breaker).
 * @returns {number} Entropy in [-1,1].
 */
function metricEntropy(s, idKey) {
  const o = (s && s.outputs) || {};
  const founded = s && s.founded && typeof s.founded.turn === "number" ? Math.round(s.founded.turn) : 0;
  const parts = [
    Math.round(num(o.food)),
    Math.round(num(o.production)),
    Math.round(num(o.gold)),
    Math.round(num(o.happiness)),
    Math.round(num(s && s.urban)),
    Math.round(num(s && s.rural)),
    founded,
    idKey
  ].join(":");
  return (hashKey(parts) / 4294967295) * 2 - 1;
}

/**
 * Deterministic per-settlement population variation around the scaled base, GROUNDED IN REAL GAME
 * METRICS (see {@link metricBias}, {@link metricEntropy}) rather than a bare name hash. The id only
 * contributes as a final tie-breaker. Magnitude stays a narrow ±1.5% (≥ ±2500 floor) so figures read
 * as a believable census, and downstream {@link claimUniquePopulation} still guarantees uniqueness.
 * @param {number} base Base scaled population.
 * @param {*} s Settlement record.
 * @returns {number} Varied estimate.
 */
function variedPopulation(base, s) {
  // `base` already includes the era ceiling (softCeil). The narrow variation here runs ON TOP, so the
  // displayed figure may sit a hair above the ceiling — intentional: the era ceiling is a SOFT target
  // (and explicitly expandable in "one more turn" overtime), not a hard display wall. A hard
  // post-variation clamp is avoided on purpose — it would collapse near-ceiling cities to the same
  // value and break the uniqueness guarantee. See design doc (#1).
  const b = Math.max(1, Math.round(base));
  const range = Math.max(2500, Math.round(b * 0.015));
  const idKey = settlementVarianceKey(s);
  const bias = metricBias(s);
  const entropy = metricEntropy(s, idKey);
  const tie = (hashKey(idKey) / 4294967295) * 2 - 1;
  const centered = clampUnit(0.55 * bias + 0.4 * entropy + 0.05 * tie);
  return Math.max(1, b + Math.round(centered * range));
}

/**
 * @param {*} s Settlement-like record.
 * @returns {number} Rounded raw population, or 0 when unreadable.
 */
function rawPopulationKey(s) {
  return typeof s.population === "number" && isFinite(s.population)
    ? Math.round(s.population)
    : 0;
}

/**
 * @param {Array<*>} list Settlement-like records.
 * @returns {Map<number, Array<*>>} Raw-population buckets.
 */
function bucketByRawPopulation(list) {
  /** @type {Map<number, Array<*>>} */
  const buckets = new Map();
  for (const s of list) {
    if (typeof s.populationEstimate !== "number" || !isFinite(s.populationEstimate)) continue;
    const raw = rawPopulationKey(s);
    const bucket = buckets.get(raw);
    if (bucket) bucket.push(s);
    else buckets.set(raw, [s]);
  }
  return buckets;
}

/**
 * @param {*} s Settlement-like record.
 * @returns {string} Stable key.
 */
function settlementVarianceKey(s) {
  return typeof s.id === "string" ? s.id : String(s.id || "");
}

/**
 * @param {Array<*>} band Settlements sharing one raw population.
 * @returns {Array<{s: *, key: string, cand: number}>} Sorted candidates.
 */
function buildBandCandidates(band) {
  return band
    .map((s) => {
      const key = settlementVarianceKey(s);
      return { s, key, cand: variedPopulation(s.populationEstimate, s) };
    })
    .sort((a, b) => a.cand - b.cand || a.key.localeCompare(b.key));
}

/**
 * @param {Array<{cand: number}>} candidates Sorted candidates.
 * @param {number} minAllowed Minimum legal starting value.
 */
function liftCandidatesToMin(candidates, minAllowed) {
  if (!candidates.length || candidates[0].cand >= minAllowed) return;
  const delta = minAllowed - candidates[0].cand;
  for (const item of candidates) item.cand += delta;
}

/**
 * @param {number} candidate Starting candidate value.
 * @param {Set<number>} used Already used estimates.
 * @returns {number} Claimed estimate.
 */
function claimUniquePopulation(candidate, used) {
  let value = candidate;
  while (value <= 0 || used.has(value)) value++;
  used.add(value);
  return value;
}

/**
 * @param {Array<{s: *, cand: number}>} candidates Sorted candidates.
 * @param {Set<number>} used Already used estimates.
 * @param {number} previousBandMax Max claimed value from prior raw bands.
 * @returns {number} Updated maximum estimate after this band.
 */
function applyCandidateBand(candidates, used, previousBandMax) {
  liftCandidatesToMin(candidates, previousBandMax + 1);
  let bandMax = previousBandMax;
  for (const item of candidates) {
    const claimed = claimUniquePopulation(item.cand, used);
    item.s.populationEstimate = claimed;
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
