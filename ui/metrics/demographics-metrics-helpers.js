// demographics-metrics-helpers.js
//
// Shared numeric helpers, scale functions, and common accessors for the
// demographics metric registry.

import { formatCount } from "/demographics/ui/metrics/metrics-format.js";
import { t } from "/demographics/ui/core/demographics-i18n.js";

const DBG = false;

/**
 * Debug logger, no-op unless {@link DBG}.
 * @param {...*} a Values to log.
 */
export function dlog(...a) {
  if (DBG) console.warn("[Demographics.metrics]", ...a);
}

/**
 * Coerce a value to a finite number, or `undefined` if it isn't one.
 * @param {*} v Candidate value.
 * @returns {number | undefined} The number, or undefined.
 */
export function safeNum(v) {
  return typeof v === "number" && isFinite(v) ? v : undefined;
}

/**
 * Resolve the active turn from a primary then fallback context, defaulting to 1.
 * @param {{ turn?: number } | null | undefined} primary Preferred context.
 * @param {{ turn?: number } | null | undefined} fallback Fallback context.
 * @returns {number} A positive turn number (1 if neither supplies one).
 */
export function resolveTurn(primary, fallback) {
  if (primary && typeof primary.turn === "number" && primary.turn > 0) {
    return primary.turn;
  }
  if (fallback && typeof fallback.turn === "number" && fallback.turn > 0) {
    return fallback.turn;
  }
  return 1;
}

// ── Population scaling — grounded in Civ VII's REAL per-era growth formula ──────────────────────────
// Civ VII grows a settlement by charging food per size step: cost(x) = Flat + Scalar·x + Exponent·x²,
// with DIFFERENT {Flat,Scalar,Exponent} per age (the game's own per-age system). The cumulative food a
// settlement of size N has absorbed, W(N) = Σ cost(1..N), is its demographic "weight"; one global
// constant POP_K turns that weight into people. This reproduces real history AND the live readouts
// (an Exploration city of size ~21 → ~0.97M, matching the in-game figure), and — because the per-era
// params already differ — is per-age by construction, with no turn-based multiplier that resets each
// age. See reports/population-scaling-per-age-design.md.
//
// Source: CivFanatics "More tables for the new growth formula" (v1.1.2 params).
/** @type {Record<string, {flat:number,scalar:number,exp:number}>} */
const ERA_GROWTH_PARAMS = {
  AGE_ANTIQUITY: { flat: 5, scalar: 20, exp: 4 },
  AGE_EXPLORATION: { flat: 30, scalar: 50, exp: 5 },
  AGE_MODERN: { flat: 60, scalar: 60, exp: 6 }
};
const ERA_ORDER = ["AGE_ANTIQUITY", "AGE_EXPLORATION", "AGE_MODERN"];
// People per food-unit — the single global scale anchor (top Exploration city, size ~20 → ~0.8M).
const POP_K = 31;
// Over the first BLEND_PCT of a new age, blend the previous era's params → the current era's, so a
// settlement whose size carries across an age boundary reads continuously (no jump). This is the
// "dynamic connection" between ages, done with the game's real per-era numbers.
const BLEND_PCT = 25;

// Modern-only megacity allowance. The growth curve alone tops out around ~17M (size 60); real 20th–21st
// century megacities reach ~25–38M. A super-linear bump above MEGA_KNEE, ramped by age-progress so it
// emerges gradually through the Modern age (never pops in at the boundary), lifts the largest cities
// into that band. Tuned so size ~50 late-Modern ≈ 28M.
const MEGA_KNEE = 35;
const MEGA_STRENGTH = 5.0;
const MEGA_POW = 1.3;

// Per-era hard ceiling = the largest single city historically plausible for the age (Rome ~1.6M;
// early-modern Beijing/Edo ~2.5M; modern Tokyo ~38M). The people figure SATURATES smoothly toward this
// (see softCeil), which does double duty: (a) it is the megacity cap, and (b) it is an elegant safety
// bound — if the engine ever hands us a wildly out-of-range size, the figure degrades gracefully to
// "the largest city this age could hold" instead of resurrecting a multi-billion blow-up. Blended
// across boundaries (geometric) like the growth params, so it too is continuous.
/** @type {Record<string, number>} */
const ERA_CEILING = {
  AGE_ANTIQUITY: 1.6e6,
  AGE_EXPLORATION: 2.5e6,
  AGE_MODERN: 38e6
};
// Below CEIL_KNEE·ceiling the figure is untouched; above it, it bends smoothly (C¹) toward the ceiling.
const CEIL_KNEE = 0.7;

// "One more turn": the final (Modern) age has no successor, so when play continues past its natural end
// the age-progress runs PAST 100%. We let the Modern ceiling expand with that overtime fraction, so
// megacities keep scaling into a speculative future instead of slamming into the historical cap — the
// cap softens/lifts exactly when the player chooses to keep playing. No effect at or below 100% (normal
// play). The expansion is smoothstep-eased in over the first OVERTIME_EASE of overtime (so the ceiling
// stays C¹ — no slope kink at the natural age end) and capped at OVERTIME_MAX, so even a pathological
// engine progress reading can NEVER resurrect a multi-billion single-city figure (worst case
// = base ceiling × OVERTIME_MAX, i.e. ~190M/city in Modern).
const OVERTIME_CEILING_RATE = 1.0; // base ceilings per full extra age of overtime (pre-cap)
const OVERTIME_EASE = 0.1; // smoothstep-ease the onset over the first 10% of overtime fraction (C¹)
const OVERTIME_MAX = 5; // hard cap on the multiplier — bounds the absolute worst case

/**
 * Smoothstep on [0,1].
 * @param {number} x Input.
 * @returns {number} Smoothed value.
 */
function smoothstep(x) {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
}

/**
 * The effective per-era growth params for an age, blended from the previous era's over the opening
 * BLEND_PCT of the age so the people curve is continuous across age boundaries.
 * @param {string | undefined} ageType Current age (e.g. AGE_EXPLORATION).
 * @param {number | undefined} ageProgressPct Age progress percent [0,100].
 * @returns {{flat:number,scalar:number,exp:number}} The effective params.
 */
export function eraGrowthParams(ageType, ageProgressPct) {
  const key = typeof ageType === "string" && ERA_GROWTH_PARAMS[ageType] ? ageType : "AGE_EXPLORATION";
  const cur = ERA_GROWTH_PARAMS[key];
  const idx = ERA_ORDER.indexOf(key);
  const prev = idx > 0 ? ERA_GROWTH_PARAMS[ERA_ORDER[idx - 1]] : cur;
  if (prev === cur) return cur;
  // Default for UNREADABLE progress: 100 ("treat a known age as a fully-developed member of itself").
  // Deliberate hot default — safe because the result is bounded by softCeil (no blow-up) and the real
  // engine API (getCurrent/MaxAgeProgressionPoints) is well-guarded, so this only matters in a rare
  // degenerate case. See reports/population-scaling-per-age-design.md (#4).
  const p = typeof ageProgressPct === "number" && isFinite(ageProgressPct) ? ageProgressPct : 100;
  const s = smoothstep(p / BLEND_PCT);
  if (s <= 0) return prev; // exact at the boundary (bit-identical continuity)
  if (s >= 1) return cur;
  return {
    flat: prev.flat + (cur.flat - prev.flat) * s,
    scalar: prev.scalar + (cur.scalar - prev.scalar) * s,
    exp: prev.exp + (cur.exp - prev.exp) * s
  };
}

/**
 * Cumulative growth effort W(N) = Σ cost(1..N) for a settlement of size N under the given era params.
 * Closed form of the sums: Flat·N + Scalar·N(N+1)/2 + Exp·N(N+1)(2N+1)/6.
 * @param {number} n Settlement size (raw population points).
 * @param {{flat:number,scalar:number,exp:number}} params Era growth params.
 * @returns {number} The cumulative effort (0 for non-positive size).
 */
export function growthEffort(n, params) {
  if (typeof n !== "number" || !isFinite(n) || n <= 0) return 0;
  const s1 = (n * (n + 1)) / 2;
  const s2 = (n * (n + 1) * (2 * n + 1)) / 6;
  return params.flat * n + params.scalar * s1 + params.exp * s2;
}

/**
 * Per-player context passed to the population scale functions.
 * @typedef {Object} PopScaleCtx
 * @property {number} [turn] Sample turn.
 * @property {number} [populationScaled] Pre-summed per-settlement people total (preferred).
 * @property {string} [ageType] Current age type.
 * @property {number} [ageProgressPct] Current age-progress percent [0,100].
 */

/**
 * The metric `scale` for the civ population total. The empire figure is the SUM of its settlements'
 * scaled people (computed at sample time, see the sampler's `populationScaled`); summing per-settlement
 * is required because W is super-linear, so scaling the aggregate would over-count. Falls back to a
 * coarse aggregate estimate only for legacy samples that predate `populationScaled`.
 * @param {number} raw Raw per-civ population total (sum of settlement sizes).
 * @param {{ turn?: number } | null | undefined} scaleCtx Per-player scale context.
 * @param {PopScaleCtx | null | undefined} ctx Per-player accessor context.
 * @returns {number} The scaled civ population.
 */
export function scalePopulation(raw, scaleCtx, ctx) {
  const summed = ctx && typeof ctx.populationScaled === "number" && isFinite(ctx.populationScaled)
    ? ctx.populationScaled
    : undefined;
  if (typeof summed === "number") return summed;
  // Legacy fallback: no per-settlement sum available. Approximate the empire as same-size settlements
  // so we never resurrect the old 90000·raw^1.11 blow-up.
  return scalePopulationAt(raw, resolveTurn(ctx, scaleCtx), ctx);
}

/**
 * Coarse civ-population estimate from the aggregate raw total (legacy/fallback path only). Treats the
 * empire as a handful of average settlements so the figure stays in the per-settlement regime.
 * @param {number} raw Raw population total (sum of settlement sizes).
 * @param {number} _turn Unused (kept for signature compatibility; scaling is age-based now).
 * @param {PopScaleCtx | null | undefined} [ctx] Optional age context.
 * @returns {number} The scaled population (0 for non-positive/invalid input).
 */
export function scalePopulationAt(raw, _turn, ctx) {
  if (typeof raw !== "number" || !isFinite(raw) || raw <= 0) return 0;
  const ageType = ctx && typeof ctx.ageType === "string" ? ctx.ageType : undefined;
  const ageProgressPct = ctx && typeof ctx.ageProgressPct === "number" ? ctx.ageProgressPct : undefined;
  // Assume ~8 average settlements; per-settlement scaling avoids the super-linear aggregate blow-up.
  const settlements = 8;
  const avg = raw / settlements;
  return settlements * scaleCityPopulationAt(avg, _turn, ageType, ageProgressPct);
}

// A military unit represents roughly this many soldiers (a legion/regiment/division), growing
// with the era exactly like population does, so "war dead" reads in the same scaled-people units
// as population.
const SOLDIERS_PER_UNIT = 1000;

// The era multiplier on soldiers-per-unit (a Modern division dwarfs an ancient legion) is the same
// 1.009^turn growth population USED to use — but unbounded it ran to 8,000× on a long Marathon game,
// rendering casualties in the billions. Population dropped the exponential for a bounded age curve;
// casualties keep the cheap exponential but CAP it at a full-game's worth of era growth
// (1.009^~270 ≈ 11×), so the figure stays sane and is consistent across game length / speed instead of
// ballooning with the raw turn count.
const CASUALTY_MAX_ERA_MULT = 11;

/**
 * Scale a raw units-lost COUNT into a turn-aware "soldiers killed" figure, comparable to the scaled
 * population metric.
 * @param {number} raw Raw units-lost count.
 * @param {{ turn?: number } | null | undefined} scaleCtx Per-player scale context.
 * @param {{ turn?: number } | null | undefined} ctx Per-player accessor context.
 * @returns {number} The scaled casualty figure (0 for non-positive/invalid input).
 */
export function scaleCasualties(raw, scaleCtx, ctx) {
  return scaleCasualtiesAt(raw, resolveTurn(ctx, scaleCtx));
}

/**
 * The "soldiers killed" estimate from a units-lost count at an explicit turn.
 * @param {number} raw Units-lost count.
 * @param {number} turn The (monotonic) turn for the era multiplier.
 * @returns {number} The scaled casualty figure (0 for non-positive/invalid input).
 */
export function scaleCasualtiesAt(raw, turn) {
  if (typeof raw !== "number" || !isFinite(raw) || raw <= 0) return 0;
  const t = typeof turn === "number" && isFinite(turn) ? turn : 0;
  const eraMult = Math.min(CASUALTY_MAX_ERA_MULT, Math.pow(1.009, t));
  return raw * SOLDIERS_PER_UNIT * eraMult;
}

/**
 * Modern-only megacity multiplier: a super-linear bump above {@link MEGA_KNEE}, ramped smoothly by
 * age-progress so it emerges over the Modern age rather than popping in at the boundary. 1 (no-op) for
 * non-Modern ages, sizes at/below the knee, or the opening of the Modern age.
 * @param {number} n Settlement size.
 * @param {string | undefined} ageType Age type.
 * @param {number | undefined} ageProgressPct Age progress percent [0,100].
 * @returns {number} Multiplier (>= 1).
 */
function modernMegacityBoost(n, ageType, ageProgressPct) {
  if (ageType !== "AGE_MODERN" || n <= MEGA_KNEE) return 1;
  const p = typeof ageProgressPct === "number" && isFinite(ageProgressPct) ? ageProgressPct : 100;
  const ramp = smoothstep((p / 100 - 0.1) / 0.8);
  if (ramp <= 0) return 1;
  return 1 + MEGA_STRENGTH * ramp * Math.pow((n - MEGA_KNEE) / MEGA_KNEE, MEGA_POW);
}

/**
 * The per-era population ceiling, blended (geometric) across age boundaries like the growth params.
 * @param {string | undefined} ageType Age type.
 * @param {number | undefined} ageProgressPct Age progress percent [0,100].
 * @returns {number} The ceiling (people).
 */
function eraCeiling(ageType, ageProgressPct) {
  const key = typeof ageType === "string" && ERA_CEILING[ageType] ? ageType : "AGE_EXPLORATION";
  const cur = ERA_CEILING[key];
  const idx = ERA_ORDER.indexOf(key);
  const prev = idx > 0 ? ERA_CEILING[ERA_ORDER[idx - 1]] : cur;
  if (prev === cur) return cur;
  const p = typeof ageProgressPct === "number" && isFinite(ageProgressPct) ? ageProgressPct : 100;
  const s = smoothstep(p / BLEND_PCT);
  if (s <= 0) return prev; // exact at the boundary (bit-identical continuity)
  if (s >= 1) return cur;
  return Math.exp(Math.log(prev) + (Math.log(cur) - Math.log(prev)) * s);
}

/**
 * The endgame ("one more turn") ceiling multiplier: 1 in normal play, growing linearly once the final
 * age's progress runs past 100%. Modern-only (only the last age has overtime).
 * @param {string | undefined} ageType Age type.
 * @param {number | undefined} ageProgressPct Age progress percent (may exceed 100 in overtime).
 * @returns {number} Multiplier (>= 1).
 */
function overtimeCeilingFactor(ageType, ageProgressPct) {
  if (ageType !== "AGE_MODERN") return 1;
  if (typeof ageProgressPct !== "number" || !isFinite(ageProgressPct) || ageProgressPct <= 100) return 1;
  const over = (ageProgressPct - 100) / 100;
  const grown = OVERTIME_CEILING_RATE * over * smoothstep(over / OVERTIME_EASE);
  return 1 + Math.min(OVERTIME_MAX - 1, grown);
}

/**
 * Smoothly saturate `x` toward `ceiling`: identity below CEIL_KNEE·ceiling, then a C¹ exponential
 * approach that never exceeds the ceiling. Continuous value AND slope at the knee (slope 1 there), so
 * normal cities are untouched and only the extreme tail bends. This is the safety bound: any input,
 * however large, lands at or below the ceiling.
 * @param {number} x The raw figure.
 * @param {number} ceiling The asymptotic maximum.
 * @returns {number} The saturated figure.
 */
function softCeil(x, ceiling) {
  const knee = CEIL_KNEE * ceiling;
  if (x <= knee) return x;
  const span = ceiling - knee;
  if (!(span > 0)) return x; // defensive: a non-positive ceiling would divide by zero
  return knee + span * (1 - Math.exp(-(x - knee) / span));
}

/**
 * The world-estimate people count for a single settlement, from the game's real per-era growth curve:
 * `POP_K · W(size, eraGrowthParams(age, progress))`, with a Modern-only megacity bump and a smooth
 * saturation toward the era's historical max-city ceiling (which also safely bounds any out-of-range
 * input). Naturally per-age and continuous across age boundaries (see {@link eraGrowthParams}); no
 * turn-based multiplier. Examples (size → people): size 5 → ~17k/37k/48k, size 20 → ~0.50M/0.80M/0.98M
 * across Antiquity/Exploration/Modern; size ~50 late-Modern ≈ 28M. A size ~21 Exploration city →
 * ~0.97M (matches the live readout).
 * @param {number} raw The settlement's size (raw population points).
 * @param {number} [_turn] Unused (kept for signature compatibility; scaling is age-based now).
 * @param {string | undefined} [ageType] Age type (e.g. AGE_MODERN).
 * @param {number | undefined} [ageProgressPct] Age progress percent [0,100].
 * @returns {number} The scaled city people count (0 for non-positive/invalid input).
 */
export function scaleCityPopulationAt(raw, _turn, ageType, ageProgressPct) {
  if (typeof raw !== "number" || !isFinite(raw) || raw <= 0) return 0;
  const base = POP_K * growthEffort(raw, eraGrowthParams(ageType, ageProgressPct));
  const boosted = base * modernMegacityBoost(raw, ageType, ageProgressPct);
  const ceiling = eraCeiling(ageType, ageProgressPct) * overtimeCeilingFactor(ageType, ageProgressPct);
  return softCeil(boosted, ceiling);
  // NOTE: per-settlement VARIATION (so two same-size settlements never read identically) is applied
  // downstream by settlements-population-variance.js (applyPopulationVarianceAndEnsureUnique), which
  // also guarantees unique, strictly-ordered estimates for the board. Keep variation out of here so
  // it isn't double-applied. The Emigration mod mirrors this same principle for its own figures.
}

// GDP multiplies per-turn yield by the turn count to approximate a CUMULATIVE economy, but unbounded
// that turn factor makes a mature empire read ~500× richer at turn 500 purely because time passed (and
// worse on Marathon, where turns accrue faster than game-progress). Cap the factor at a full game's
// worth of turns so a normal game is unchanged while overtime / slow speeds / very long games can't run
// the figure away.
const GDP_TURN_CAP = 300;

/**
 * Scale a raw weighted-yield sum into a $billions-scale GDP figure.
 * @param {number} raw Weighted per-turn yield sum.
 * @param {{ turn?: number } | null | undefined} scaleCtx Per-player scale context.
 * @param {{ turn?: number } | null | undefined} ctx Per-player accessor context.
 * @returns {number} The scaled GDP (0 for invalid input).
 */
export function scaleGDP(raw, scaleCtx, ctx) {
  if (typeof raw !== "number" || !isFinite(raw)) return 0;
  return raw * Math.min(GDP_TURN_CAP, resolveTurn(ctx, scaleCtx)) * 1000000;
}

/**
 * Coerce yield values used by the GDP accessor.
 * @param {{ [key: string]: * }} ctx Per-player accessor context.
 * @returns {(number | undefined)[]} Coerced yield values.
 */
export function gdpYields(ctx) {
  return [
    safeNum(ctx.yieldGold),
    safeNum(ctx.yieldProduction),
    safeNum(ctx.yieldFood),
    safeNum(ctx.yieldDiplomacy),
    safeNum(ctx.yieldCulture),
    safeNum(ctx.yieldScience)
  ];
}

/**
 * Whether every element of an array is undefined.
 * @param {(number | undefined)[]} values The values to test.
 * @returns {boolean} True if all entries are undefined.
 */
export function allUndefined(values) {
  return values.every((value) => value === undefined);
}

/**
 * Synthesize a player's GDP from weighted per-turn yields.
 * @param {{ [key: string]: * }} ctx Per-player accessor context.
 * @returns {number | undefined} The weighted yield sum, or undefined if no data.
 */
export function gdpAccessor(ctx) {
  const weights = {
    gold: 1.0,
    production: 1.0,
    food: 0.5,
    influence: 1.5,
    culture: 1.2,
    science: 1.2
  };
  const [g, p, f, i, c, s] = gdpYields(ctx);
  if (allUndefined([g, p, f, i, c, s])) return undefined;
  return (
    (g || 0) * weights.gold +
    (p || 0) * weights.production +
    (f || 0) * weights.food +
    (i || 0) * weights.influence +
    (c || 0) * weights.culture +
    (s || 0) * weights.science
  );
}

/**
 * Scale a raw owned-tile count into km² of land area.
 * @param {number} raw Owned tile count.
 * @returns {number} The scaled area (0 for invalid input).
 */
export function scaleLandArea(raw) {
  if (typeof raw !== "number" || !isFinite(raw)) return 0;
  return raw * 7000;
}

/**
 * Heuristic score: tech + civic count + 2·settlements + gold/100. This is the
 * mod's authoritative score (see scoreAccessor): Civ7 has no cumulative civ
 * "score" - its scoring is per-age Legacy Points - so we synthesize a stable,
 * monotonic one. techsCount/civicsCount are made cumulative across ages by the
 * sampler (see sampler-collectors-economy.js#computeNodeBaselines), and
 * settlements/gold are inherently continuous, so this stays continuous across
 * age boundaries instead of collapsing when each age's fresh trees reset.
 * @param {{ [key: string]: * }} ctx Per-player accessor context.
 * @returns {number} The heuristic score.
 */
export function scoreFallback(ctx) {
  const techs = safeNum(ctx.techsCount) || 0;
  const civics = safeNum(ctx.civicsCount) || 0;
  const settlements = safeNum(ctx.settlementsCount) || 0;
  const gold = safeNum(ctx.gold) || 0;
  return techs + civics + 2 * settlements + Math.floor(gold / 100);
}

/**
 * Score accessor. Civ7 exposes no cumulative civilization score on the player
 * Stats handle (scoring is per-age Legacy Points via player.LegacyPaths), so
 * the heuristic in {@link scoreFallback} is authoritative. We still consult an
 * engine `getScore()` IF some build/mod adds one AND it is non-decreasing - a
 * per-age engine score would re-introduce the age-boundary cliff, so we reject
 * any value below the continuous heuristic and keep the heuristic instead.
 * @param {{ [key: string]: * }} ctx Per-player accessor context.
 * @returns {number} The civilization score.
 */
export function scoreAccessor(ctx) {
  const heuristic = scoreFallback(ctx);
  try {
    const s = ctx.stats;
    if (s && typeof s.getScore === "function") {
      const value = safeNum(s.getScore());
      // Only trust an engine score that doesn't regress below the continuous
      // heuristic; this guards against a per-age engine score cliffing the line.
      if (value !== undefined && value >= heuristic) return value;
    }
  } catch (_e) {
    /* fall through to the heuristic */
  }
  return heuristic;
}

/**
 * Civics accessor: defaults an undefined count to 0.
 * @param {{ [key: string]: * }} ctx Per-player accessor context.
 * @returns {number} The civics count (0 when unavailable).
 */
export function civicsAccessor(ctx) {
  const value = safeNum(ctx.civicsCount);
  return value === undefined ? 0 : value;
}

/**
 * Settlement-cap-utilization accessor: settlements / cap × 100.
 * @param {{ [key: string]: * }} ctx Per-player accessor context.
 * @returns {number | undefined} The utilization percent, or undefined.
 */
export function settlementCapPctAccessor(ctx) {
  const n = safeNum(ctx.numSettlements);
  const cap = safeNum(ctx.settlementCap);
  if (n === undefined || !cap || cap <= 0) return undefined;
  return (n / cap) * 100;
}

/**
 * Crisis-stage accessor: shift engine 0-based stages up by 1.
 * @param {{ [key: string]: * }} ctx Per-player accessor context.
 * @returns {number | undefined} The display stage, or undefined.
 */
export function crisisStageAccessor(ctx) {
  const value = safeNum(ctx.crisisStage);
  if (value === undefined) return undefined;
  return value < 0 ? 0 : value + 1;
}

/**
 * Land-area accessor: defaults undefined owned-tiles to 0.
 * @param {{ [key: string]: * }} ctx Per-player accessor context.
 * @returns {number} The owned-tile count (0 when unavailable).
 */
export function landAccessor(ctx) {
  const value = safeNum(ctx.tilesOwned);
  return value === undefined ? 0 : value;
}

/**
 * Format the Diplomatic Approval reputation aggregate.
 * @param {number} n Reputation value.
 * @returns {string} The formatted string.
 */
export function formatApproval(n) {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  return (n >= 0 ? "+" : "") + (Math.round(n * 10) / 10);
}

/**
 * Format a rounded value to a count.
 * @param {number} n Value to format.
 * @returns {string} The formatted string.
 */
export function formatRoundedCount(n) {
  return formatCount(Math.round(n));
}

/**
 * Format a crisis stage value into its localized user-facing label. Stages 1-4
 * reuse the mod's existing `LOC_DEMOGRAPHICS_CRISIS_STAGE_*` keys (translated in
 * every locale); 0 is pre-crisis.
 * @param {number} n Display stage value.
 * @returns {string} The stage label.
 */
export function formatCrisisStage(n) {
  const value = Math.max(0, Math.round(n));
  if (value === 0) return t("LOC_DEMOGRAPHICS_CRISIS_STAGE_PRE");
  if (value === 1) return t("LOC_DEMOGRAPHICS_CRISIS_STAGE_BEGINS");
  if (value === 2) return t("LOC_DEMOGRAPHICS_CRISIS_STAGE_INTENSIFIES");
  if (value === 3) return t("LOC_DEMOGRAPHICS_CRISIS_STAGE_CULMINATES");
  if (value >= 4) return t("LOC_DEMOGRAPHICS_CRISIS_STAGE_ENDS");
  return String(value);
}
