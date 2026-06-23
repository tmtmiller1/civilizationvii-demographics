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

/**
 * Scale a raw population count into a turn-aware "realistic" figure.
 * @param {number} raw Raw per-civ population total.
 * @param {{ turn?: number } | null | undefined} scaleCtx Per-player scale context.
 * @param {{ turn?: number } | null | undefined} ctx Per-player accessor context.
 * @returns {number} The scaled population (0 for non-positive/invalid input).
 */
export function scalePopulation(raw, scaleCtx, ctx) {
  return scalePopulationAt(raw, resolveTurn(ctx, scaleCtx));
}

/**
 * The world-estimate population formula at an explicit turn.
 * @param {number} raw Raw population count.
 * @param {number} turn The (monotonic) turn for the era multiplier.
 * @returns {number} The scaled population (0 for non-positive/invalid input).
 */
export function scalePopulationAt(raw, turn) {
  if (typeof raw !== "number" || !isFinite(raw) || raw <= 0) return 0;
  const t = typeof turn === "number" && isFinite(turn) ? turn : 0;
  return Math.pow(raw, 1.11) * 90000 * Math.pow(1.009, t);
}

// A military unit represents roughly this many soldiers (a legion/regiment/division), growing
// with the era exactly like population does, so "war dead" reads in the same scaled-people units
// as population.
const SOLDIERS_PER_UNIT = 1000;

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
  return raw * SOLDIERS_PER_UNIT * Math.pow(1.009, t);
}

/**
 * The world-estimate population for a single settlement.
 * @param {number} raw The settlement's raw population.
 * @param {number} turn The (monotonic) turn for the era multiplier.
 * @param {string | undefined} [ageType] Optional age type (e.g. AGE_MODERN).
 * @param {number | undefined} [ageProgressPct] Optional age progress percent [0,100].
 * @returns {number} The scaled city population (0 for non-positive/invalid input).
 */
// Calibrated so normal cities stay readable while true late-game megacities are rare
// but possible in Modern only, with a smooth in-age ramp so crossing the age
// boundary never causes a sudden jump. Typical outputs: raw ~5 at turn ~60 reads
// ~100–150k, raw ~10 at turn ~120 reads ~450–500k, raw ~20 at turn ~220 reads
// ~2.4M, and raw ~45–50 at turn ~220 can reach ~20M+ late in AGE_MODERN.
export function scaleCityPopulationAt(raw, turn, ageType, ageProgressPct) {
  if (typeof raw !== "number" || !isFinite(raw) || raw <= 0) return 0;
  const t = typeof turn === "number" && isFinite(turn) ? turn : 0;
  const base = Math.pow(raw, 1.11) * 12000 * Math.pow(1.009, t);
  // Keep everyday cities on the same curve, but let true late-game megacities
  // occasionally emerge by boosting only high-raw settlements in Modern.
  const megaTarget = raw > 20 ? Math.pow(raw / 20, 1.5) : 1;
  const ramp = modernMegaRamp(ageType, ageProgressPct);
  const megaBoost = 1 + (megaTarget - 1) * ramp;
  return base * megaBoost;
}

/**
 * Smooth Modern-only ramp factor for the city megacity boost.
 * @param {string | undefined} ageType Current age type.
 * @param {number | undefined} ageProgressPct Age progress percent.
 * @returns {number} Ramp in [0,1].
 */
function modernMegaRamp(ageType, ageProgressPct) {
  if (ageType !== "AGE_MODERN") return 0;
  if (typeof ageProgressPct !== "number" || !isFinite(ageProgressPct)) return 0;
  const p = Math.max(0, Math.min(1, ageProgressPct / 100));
  // Start the ramp after the opening turns of Modern and complete before the
  // final turns, so growth feels gradual across the era.
  const x = Math.max(0, Math.min(1, (p - 0.1) / 0.8));
  return x * x * (3 - 2 * x); // smoothstep
}

/**
 * Scale a raw weighted-yield sum into a $billions-scale GDP figure.
 * @param {number} raw Weighted per-turn yield sum.
 * @param {{ turn?: number } | null | undefined} scaleCtx Per-player scale context.
 * @param {{ turn?: number } | null | undefined} ctx Per-player accessor context.
 * @returns {number} The scaled GDP (0 for invalid input).
 */
export function scaleGDP(raw, scaleCtx, ctx) {
  if (typeof raw !== "number" || !isFinite(raw)) return 0;
  return raw * resolveTurn(ctx, scaleCtx) * 1000000;
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
