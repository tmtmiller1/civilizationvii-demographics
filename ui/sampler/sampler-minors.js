// sampler-minors.js
//
// Minor-civ (city-state/independent) snapshot assembly helpers.

/**
 * Build minor-civ military snapshot map from alive minor ids.
 * @param {number[]} ids Alive minor player ids.
 * @param {(pid: number) => any} buildMinorMilitaryCtx Minor context builder.
 * @param {(pid: number) => number} getCumulativeCasualty Cumulative casualty reader.
 * @returns {Record<string, *> | null} Minor snapshot map, or null when none.
 */
export function buildMinorSnapshots(
  ids,
  buildMinorMilitaryCtx,
  getCumulativeCasualty
) {
  if (!ids.length) return null;

  /** @type {Record<string, *>} */
  const out = {};
  for (const pid of ids) {
    const ctx = buildMinorMilitaryCtx(pid);
    out[pid] = {
      civName: ctx.civName,
      leaderTypeString: ctx.leaderTypeString,
      primaryColor: ctx.primaryColor,
      metrics: {
        milpower: typeof ctx.militaryPower === "number" ? ctx.militaryPower : 0,
        milLostCum: getCumulativeCasualty(pid)
      }
    };
  }
  return out;
}
