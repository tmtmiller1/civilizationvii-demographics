// pantheon-effects.js
//
// Best-effort inspection of a pantheon belief's game data for the Antiquity
// Religion board: effectText(def), the belief's localized Description with markup
// stripped, and estimateYields(def), a rough per-yield estimate of its flat bonuses.
//
// The estimate walks the belief's modifier chain (Beliefs → BeliefModifiers →
// Modifiers → DynamicModifiers / ModifierArguments) and sums only flat
// yield-adjust amounts; percentage and per-unit effects are flagged `conditional`.

import { stripLocaleMarkup } from "/demographics/ui/core/demographics-i18n.js";

/**
 * The six demographics yield categories, ordered so visually-similar hues never
 * sit adjacent in the grouped bar chart. Each maps to the engine YIELD_* type(s).
 * @type {{key:string, label:string, color:string, yields:string[]}[]}
 */
export const YIELD_CATEGORIES = [
  { key: "gold", label: "LOC_YIELD_GOLD", color: "#c98500", yields: ["YIELD_GOLD"] },
  { key: "science", label: "LOC_YIELD_SCIENCE", color: "#3987e5", yields: ["YIELD_SCIENCE"] },
  { key: "happiness", label: "LOC_YIELD_HAPPINESS", color: "#008300", yields: ["YIELD_HAPPINESS"] },
  { key: "production", label: "LOC_YIELD_PRODUCTION", color: "#d95926", yields: ["YIELD_PRODUCTION"] },
  { key: "culture", label: "LOC_YIELD_CULTURE", color: "#9085e9", yields: ["YIELD_CULTURE"] },
  { key: "influence", label: "LOC_YIELD_DIPLOMACY", color: "#199e70", yields: ["YIELD_DIPLOMACY", "YIELD_INFLUENCE"] }
];

/**
 * YIELD_* type → category key. Built once from YIELD_CATEGORIES.
 * @type {Record<string,string>}
 */
const YIELD_TO_CATEGORY = (() => {
  /** @type {Record<string,string>} */
  const categoryOf = {};
  for (const category of YIELD_CATEGORIES) {
    for (const yieldType of category.yields) categoryOf[yieldType] = category.key;
  }
  return categoryOf;
})();

// Effect types whose `Amount` is a flat yield we count toward the estimate. Kept
// narrow on purpose: only the plain per-player / per-city yield adjustments. Anything with a
// `Percent` argument, or a "_PER_" scaling effect, is treated as conditional and skipped.
const FLAT_YIELD_EFFECTS = new Set([
  "EFFECT_PLAYER_ADJUST_YIELD",
  "EFFECT_CITY_ADJUST_YIELD"
]);

/**
 * A zeroed per-category yield bucket.
 * @returns {Record<string, number>} { gold:0, science:0, … }.
 */
export function emptyYields() {
  /** @type {Record<string, number>} */
  const bucket = {};
  for (const category of YIELD_CATEGORIES) bucket[category.key] = 0;
  return bucket;
}

/**
 * The plain-text effect summary for a belief def (its localized Description).
 * @param {*} def A GameInfo.Beliefs row.
 * @returns {string} The effect text, or "" when unavailable.
 */
export function effectText(def) {
  try {
    const key = def && def.Description;
    if (!key || typeof Locale === "undefined" || typeof Locale.compose !== "function") return "";
    const composed = Locale.compose(key);
    if (!composed || composed === key) return "";
    return stripLocaleMarkup(composed);
  } catch (_) {
    return "";
  }
}

/**
 * The modifier ids a belief grants (via BeliefModifiers).
 * @param {string} beliefType The belief type id (e.g. "BELIEF_...").
 * @returns {string[]} Modifier ids (possibly empty).
 */
function modifierIdsForBelief(beliefType) {
  try {
    if (typeof GameInfo === "undefined" || !GameInfo.BeliefModifiers) return [];
    return GameInfo.BeliefModifiers
      .filter((/** @type {*} */ row) => row && row.BeliefType === beliefType)
      .map((/** @type {*} */ row) => row.ModifierId);
  } catch (_) {
    return [];
  }
}

/**
 * The engine EffectType for a modifier id (via Modifiers → DynamicModifiers).
 * @param {string} modifierId
 * @returns {string} The effect type, or "" when unresolved.
 */
function effectTypeFor(modifierId) {
  try {
    const modifier = GameInfo.Modifiers.find((/** @type {*} */ row) => row && row.ModifierId === modifierId);
    if (!modifier) return "";
    const dynamic = GameInfo.DynamicModifiers.find(
      (/** @type {*} */ row) => row && row.ModifierType === modifier.ModifierType
    );
    return (dynamic && dynamic.EffectType) || "";
  } catch (_) {
    return "";
  }
}

/**
 * A modifier's arguments as a Name→Value map.
 * @param {string} modifierId
 * @returns {Record<string,string>}
 */
function argsFor(modifierId) {
  /** @type {Record<string,string>} */
  const out = {};
  try {
    const rows = GameInfo.ModifierArguments.filter((/** @type {*} */ row) => row && row.ModifierId === modifierId);
    for (const arg of rows) {
      if (arg && arg.Name != null) out[arg.Name] = arg.Value;
    }
  } catch (_) {
    /* leave partial */
  }
  return out;
}

/**
 * Classify one modifier's yield effect: its countable flat contribution (if any) and
 * whether it touches yields at all (used to flag uncounted conditional effects).
 * @param {string} modId
 * @returns {{ flat: { cat: string, amount: number }|null, touchesYield: boolean }} `cat` is a category key.
 */
function yieldContribution(modId) {
  const effect = effectTypeFor(modId);
  // Any yield-touching effect we don't count as flat → conditional flag.
  const touchesYield = effect.indexOf("YIELD") !== -1;
  const args = argsFor(modId);
  const category = args.YieldType ? YIELD_TO_CATEGORY[args.YieldType] : undefined;
  const amount = Number(args.Amount);
  const isFlat = FLAT_YIELD_EFFECTS.has(effect) && category && args.Percent == null &&
    isFinite(amount) && amount !== 0;
  return { flat: isFlat ? { cat: category, amount } : null, touchesYield };
}

/**
 * Estimate the flat per-yield bonuses a pantheon belief grants, plus whether it also
 * carries conditional (percentage / per-unit) effects we could not total.
 * @param {*} def A GameInfo.Beliefs row.
 * @returns {{ yields: Record<string,number>, total: number, conditional: boolean }}
 *   `yields` per category, `total` the summed flat amount, `conditional` true when
 *   uncounted scaling/percent yield effects exist.
 */
export function estimateYields(def) {
  const yields = emptyYields();
  let total = 0;
  let conditional = false;
  try {
    const beliefType = def && def.BeliefType;
    if (!beliefType) return { yields, total, conditional };
    for (const modId of modifierIdsForBelief(beliefType)) {
      const { flat, touchesYield } = yieldContribution(modId);
      if (flat) {
        yields[flat.cat] += flat.amount;
        total += flat.amount;
      } else if (touchesYield) {
        conditional = true;
      }
    }
  } catch (_) {
    /* return whatever we accumulated */
  }
  return { yields, total, conditional };
}
