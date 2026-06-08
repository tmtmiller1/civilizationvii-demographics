// sampler-game-readers.js
//
// Raw game-state readers used by sampler orchestration.

/**
 * Read Game.turn defensively without sampler safeCall wrapper.
 * @returns {number | undefined} Current turn, or undefined.
 */
export function readCurrentTurnRaw() {
  return typeof Game !== "undefined" && typeof Game.turn === "number"
    ? Game.turn
    : undefined;
}
