// sampler-collectors-religion.js
//
// Per-turn religion snapshot: settlements + population following each religion,
// keyed by religion $hash. Stored on the snapshot as `rel` (game-wide, apart
// from per-player `players`) so the Religion Spread / By-Population line charts
// can reconstruct history. Defensive; returns null when religion is unavailable.

/**
 * Fold one city's majority religion into the per-religion accumulator.
 * @param {*} c A city handle.
 * @param {Set<*>} known The set of known religion $hash values.
 * @param {Record<string, {s:number, p:number}>} out The accumulator (mutated).
 */
function foldCity(c, known, out) {
  try {
    const rel = c && c.Religion && c.Religion.majorityReligion;
    if (rel == null || !known.has(rel)) return;
    const k = String(rel);
    const row = out[k] || (out[k] = { s: 0, p: 0 });
    row.s += 1;
    if (typeof c.population === "number") row.p += c.population;
  } catch (_) {
    /* stale city handle */
  }
}

/**
 * Build the set of known religion $hash values.
 * @returns {Set<*>} The hash set (empty when religion data is unavailable).
 */
function knownReligionHashes() {
  const known = new Set();
  try {
    if (typeof GameInfo !== "undefined" && GameInfo.Religions) {
      for (const r of GameInfo.Religions) if (r && r.$hash != null) known.add(r.$hash);
    }
  } catch (_) {
    /* defensive */
  }
  return known;
}

/**
 * Aggregate per-religion followers across all alive players' cities.
 * @param {Set<*>} known The known religion $hash set.
 * @returns {Record<string, {s:number, p:number}>} The rel map (possibly empty).
 */
function aggregateReligion(known) {
  /** @type {Record<string, {s:number, p:number}>} */
  const out = {};
  for (const p of Players.getAlive() || []) {
    if (!p || !p.Cities || typeof p.Cities.getCities !== "function") continue;
    for (const c of p.Cities.getCities() || []) foldCity(c, known, out);
  }
  return out;
}

/**
 * Aggregate per-religion followers (settlements + population) across all cities.
 * @param {(label:string, fn:()=>any)=>any} safeCall Defensive call wrapper.
 * @returns {Record<string, {s:number, p:number}>|null} rel map, or null.
 */
export function collectReligionSnapshot(safeCall) {
  return (
    safeCall("collectReligionSnapshot", () => {
      const known = knownReligionHashes();
      if (!known.size || typeof Players === "undefined") return null;
      const out = aggregateReligion(known);
      return Object.keys(out).length ? out : null;
    }) || null
  );
}

/**
 * Compute + attach the per-turn religion map onto a snapshot (no-op when empty).
 * @param {*} snapshot The sampler snapshot (mutated).
 * @param {(label:string, fn:()=>any)=>any} safeCall Defensive call wrapper.
 */
export function attachReligionSnapshot(snapshot, safeCall) {
  const rel = collectReligionSnapshot(safeCall);
  if (rel) snapshot.rel = rel;
}
