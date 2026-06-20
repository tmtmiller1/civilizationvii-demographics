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
 * Deterministic per-settlement population variation around the scaled base.
 * @param {number} base Base scaled population.
 * @param {string} key Stable settlement key.
 * @returns {number} Varied estimate.
 */
function variedPopulation(base, key) {
  const b = Math.max(1, Math.round(base));
  const range = Math.max(2500, Math.round(b * 0.015));
  const h = hashKey(key);
  const frac = h / 4294967295;
  const centered = (frac * 2) - 1;
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
      return { s, key, cand: variedPopulation(s.populationEstimate, key) };
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
