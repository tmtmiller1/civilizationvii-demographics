// sampler-player-ids.js
//
// Alive-player id resolution helpers for sampler snapshots.

/**
 * Get alive major player ids defensively.
 * @param {(label: string, fn: () => any) => any} safeCall Defensive call wrapper.
 * @returns {number[]} Alive major ids, or empty array on failure.
 */
export function getAliveMajorIds(safeCall) {
  return (
    safeCall("Players.getAliveMajorIds()", () => {
      if (typeof Players === "undefined") return [];
      if (typeof Players.getAliveMajorIds !== "function") return [];
      const arr = Players.getAliveMajorIds();
      return Array.isArray(arr) ? arr : [];
    }) || []
  );
}

/**
 * Get alive minor (city-state/independent) player ids defensively.
 * @param {(label: string, fn: () => any) => any} safeCall Defensive call wrapper.
 * @returns {number[]} Alive minor ids, or empty array on failure.
 */
export function getAliveMinorIds(safeCall) {
  return (
    safeCall("Players.getAlive() minors", () => {
      if (typeof Players === "undefined" || typeof Players.getAlive !== "function") {
        return [];
      }
      const all = Players.getAlive() || [];
      /** @type {number[]} */
      const out = [];
      for (const p of all) {
        try {
          if (p && p.isMinor === true && typeof p.id === "number") out.push(p.id);
        } catch (_) {
          // A stale handle's isMinor accessor can throw; skip this player.
        }
      }
      return out;
    }) || []
  );
}
