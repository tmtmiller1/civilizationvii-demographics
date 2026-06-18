// demographics-hardware.js
//
// Hardware-adaptive budgets (combined design plan P1.6).
//
// Sampling/retention presets already scale with game speed (storage-cap.js) and
// old history is decimated. This module adds the not-yet-shipped half: a bounded
// CAPABILITY factor (CPU cores / device memory / mobile experience) and a GAME-
// SIZE factor (player count), used to (a) scale the adaptive retention cap and
// (b) bound per-series render work to a point budget so a marathon-length line
// doesn't plot thousands of points on a weak machine.
//
// Everything is read defensively (navigator / UI may be absent in this UI
// context) and clamped, so a missing read just yields the neutral factor 1.

const DBG = false;

/**
 * Debug logger, no-op unless {@link DBG} is set.
 * @param {...*} a Values to log.
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.hardware]", ...a);
}

/** Cached capability factor (hardware doesn't change within a session). @type {number|null} */
let _capability = null;

/**
 * Clamp `n` into [lo, hi].
 * @param {number} n Value.
 * @param {number} lo Lower bound.
 * @param {number} hi Upper bound.
 * @returns {number} The clamped value.
 */
function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * The CPU-core contribution to the capability factor, from
 * `navigator.hardwareConcurrency` (neutral 1 when unavailable).
 * @returns {number} A multiplier around 1.
 */
function coreFactor() {
  const nav = /** @type {*} */ (globalThis).navigator;
  const cores = nav && typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : 0;
  if (!cores) return 1;
  if (cores <= 2) return 0.55;
  if (cores <= 4) return 0.8;
  if (cores <= 6) return 0.95;
  if (cores <= 8) return 1.1;
  return 1.25;
}

/**
 * Whether the active view experience is Mobile (best-effort; false off-engine).
 * @returns {boolean} True on a mobile experience.
 */
function isMobileExperience() {
  try {
    return (
      typeof UI !== "undefined" &&
      typeof UI.getViewExperience === "function" &&
      typeof UIViewExperience !== "undefined" &&
      UI.getViewExperience() === UIViewExperience.Mobile
    );
  } catch (_) {
    return false;
  }
}

/**
 * The device-memory + mobile contribution to the capability factor (neutral 1
 * when unavailable).
 * @returns {number} A multiplier around 1.
 */
function memoryAndFormFactor() {
  let f = 1;
  const nav = /** @type {*} */ (globalThis).navigator;
  if (nav && typeof nav.deviceMemory === "number" && nav.deviceMemory > 0) {
    if (nav.deviceMemory <= 4) f *= 0.8;
    else if (nav.deviceMemory >= 16) f *= 1.1;
  }
  if (isMobileExperience()) f *= 0.6;
  return f;
}

/**
 * A bounded hardware-capability factor in [0.4, 1.5]: <1 on weak machines
 * (few cores / little memory / mobile), >1 on strong ones. Memoized.
 * @returns {number} The capability factor.
 */
export function capabilityFactor() {
  if (_capability != null) return _capability;
  let f = 1;
  try {
    f = coreFactor() * memoryAndFormFactor();
  } catch (_) {
    f = 1;
  }
  _capability = clamp(f, 0.4, 1.5);
  dlog("capabilityFactor =", _capability);
  return _capability;
}

/**
 * Best-effort count of major players in the game (for the game-size factor).
 * @returns {number} Player count, or 0 when unknown.
 */
function majorPlayerCount() {
  try {
    if (typeof Players === "undefined") return 0;
    const fn = Players.getAliveMajorIds || Players.getAliveIds;
    if (typeof fn !== "function") return 0;
    const ids = fn.call(Players);
    return Array.isArray(ids) ? ids.length : 0;
  } catch (_) {
    return 0;
  }
}

/**
 * A bounded game-size factor in [0.7, 1]: smaller for many-civ games (whose
 * per-turn samples are larger), so the retention cap shrinks to bound total
 * stored bytes. Neutral (1) when the player count is unknown or small.
 * @returns {number} The size factor.
 */
export function gameSizeFactor() {
  const players = majorPlayerCount();
  if (players <= 8) return 1;
  if (players <= 12) return 0.85;
  return 0.7;
}

/**
 * Combined retention scale = capability × game-size, in [0.4, 1.5]. Multiplies
 * the speed-derived adaptive sample cap (storage-cap.js).
 * @returns {number} The retention scale.
 */
export function retentionScale() {
  return clamp(capabilityFactor() * gameSizeFactor(), 0.4, 1.5);
}

// Baseline plotted-point budget per series at capability 1 (turn depth is
// already bounded by the visible turn-range filter the chart applies first).
const BASE_RENDER_POINTS = 1400;

/**
 * The per-series plotted-point budget for the current hardware, in [400, 3000].
 * The line chart downsamples a series to this many points (after the visible-
 * range filter) so render work is bounded on weak machines and marathon saves.
 * @returns {number} The point budget.
 */
export function renderPointBudget() {
  return Math.round(clamp(BASE_RENDER_POINTS * capabilityFactor(), 400, 3000));
}

/**
 * Downsample `points` to at most `budget` entries by keeping every Nth point and
 * always retaining the last (so the line still reaches "now"). A no-op when
 * already within budget. Preserves order.
 * @template T
 * @param {T[]} points The point list.
 * @param {number} budget Max points to keep.
 * @returns {T[]} The (possibly) downsampled list.
 */
export function lodDownsample(points, budget) {
  if (!Array.isArray(points) || budget <= 0 || points.length <= budget) return points;
  const stride = Math.ceil(points.length / budget);
  /** @type {T[]} */
  const out = [];
  for (let i = 0; i < points.length; i += stride) out.push(points[i]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}
