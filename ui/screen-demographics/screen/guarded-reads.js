// guarded-reads.js
//
// Small wrappers for reads that cross the engine boundary, where a getter can throw or hand back a
// non-number, so callers get a usable value instead of an exception.

/**
 * Run `fn` and return its result, or `fallback` if it throws.
 * @template T
 * @param {() => T} fn
 * @param {T} [fallback]
 * @returns {T|undefined}
 */
export function orFallback(fn, fallback) {
  try {
    return fn();
  } catch (_) {
    return fallback;
  }
}

/**
 * The value when it is a finite number, else 0.
 * @param {*} value
 * @returns {number}
 */
export function finiteOrZero(value) {
  return typeof value === "number" && isFinite(value) ? value : 0;
}

/**
 * The game's seed as a string, used to namespace per-game data and seed name rolls so they stay
 * stable within one playthrough.
 * @returns {string} The seed, or "" when unavailable.
 */
export function getGameSeed() {
  try {
    if (typeof Configuration !== "undefined" && typeof Configuration.getGame === "function") {
      const game = Configuration.getGame();
      const seed = game && (game.startSeed ?? game.gameSeed ?? game.mapSeed);
      if (seed !== undefined && seed !== null) return String(seed);
    }
  } catch (_) {
    // Configuration.getGame may be absent or throw; fall back to an empty seed string.
  }
  return "";
}
