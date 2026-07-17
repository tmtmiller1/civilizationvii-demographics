// pantheon-effects.js
//
// Best-effort inspection of a pantheon belief's game data, for the Antiquity
// Religion board. Two products:
//   1. effectText(def)  — a plain-text one-line summary of what the pantheon does
//      (the belief's own localized Description, with icon/style markup stripped so
//      it renders cleanly as textContent on the parchment board).
//   2. estimateYields(def) — a ROUGH per-yield estimate of the flat bonuses the
//      pantheon grants, bucketed into the six demographics yield categories.
//
// The yield estimate is deliberately conservative and is NOT authoritative: the
// game never exposes a pantheon's realized yield contribution. We walk the belief's
// modifier chain (Beliefs → BeliefModifiers → Modifiers → DynamicModifiers /
// ModifierArguments) and sum only FLAT yield-adjust amounts. Percentage effects and
// per-unit ("per population", "per resource", …) scaling effects are excluded
// because their real value depends on live game state we can't attribute here; when
// such effects exist we flag `conditional` so the UI can say so.

/**
 * The six demographics yield categories, in the display order chosen so that
 * visually-similar hues never sit adjacent in the grouped bar chart (validated with
 * the dataviz palette checker against the dark board surface). Each maps to the
 * engine YIELD_* type(s) that feed it.
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

/** YIELD_* type → category key. Built once from YIELD_CATEGORIES. @type {Record<string,string>} */
const YIELD_TO_CAT = (() => {
  /** @type {Record<string,string>} */
  const m = {};
  for (const c of YIELD_CATEGORIES) for (const y of c.yields) m[y] = c.key;
  return m;
})();

// Effect types whose `Amount` is a flat yield we count toward the estimate. Deliberately
// narrow: only the plain per-player / per-city yield adjustments. Anything with a
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
  const y = {};
  for (const c of YIELD_CATEGORIES) y[c.key] = 0;
  return y;
}

/**
 * Strip Civ localization markup (icon tokens like [icon:YIELD_GOLD], style tags like
 * [B]…[/B], and stray brackets) and collapse whitespace, so an effect Description
 * reads cleanly as plain textContent.
 * @param {string} s The composed (localized) string.
 * @returns {string} Plain text.
 */
function stripMarkup(s) {
  return String(s)
    .replace(/\[[^\]]*\]/g, " ")   // [icon:…], [B], [/B], [LINK]…  → space
    .replace(/\s+/g, " ")
    .trim();
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
    return stripMarkup(composed);
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
      .filter((/** @type {*} */ bm) => bm && bm.BeliefType === beliefType)
      .map((/** @type {*} */ bm) => bm.ModifierId);
  } catch (_) {
    return [];
  }
}

/**
 * The engine EffectType for a modifier id (via Modifiers → DynamicModifiers).
 * @param {string} modifierId The modifier id.
 * @returns {string} The effect type, or "" when unresolved.
 */
function effectTypeFor(modifierId) {
  try {
    const m = GameInfo.Modifiers.find((/** @type {*} */ x) => x && x.ModifierId === modifierId);
    if (!m) return "";
    const dm = GameInfo.DynamicModifiers.find((/** @type {*} */ d) => d && d.ModifierType === m.ModifierType);
    return (dm && dm.EffectType) || "";
  } catch (_) {
    return "";
  }
}

/**
 * A modifier's arguments as a Name→Value map.
 * @param {string} modifierId The modifier id.
 * @returns {Record<string,string>} The argument map.
 */
function argsFor(modifierId) {
  /** @type {Record<string,string>} */
  const out = {};
  try {
    for (const a of GameInfo.ModifierArguments.filter((/** @type {*} */ x) => x && x.ModifierId === modifierId)) {
      if (a && a.Name != null) out[a.Name] = a.Value;
    }
  } catch (_) {
    /* leave partial */
  }
  return out;
}

/**
 * Classify one modifier's yield effect: its countable flat contribution (if any) and
 * whether it touches yields at all (used to flag uncounted conditional effects).
 * @param {string} modId The modifier id.
 * @returns {{ flat: { cat: string, amount: number }|null, touchesYield: boolean }}
 */
function yieldContribution(modId) {
  const effect = effectTypeFor(modId);
  // Any yield-touching effect we don't count as flat → conditional flag.
  const touchesYield = effect.indexOf("YIELD") !== -1;
  const args = argsFor(modId);
  const cat = args.YieldType ? YIELD_TO_CAT[args.YieldType] : undefined;
  const amount = Number(args.Amount);
  const isFlat = FLAT_YIELD_EFFECTS.has(effect) && cat && args.Percent == null &&
    isFinite(amount) && amount !== 0;
  return { flat: isFlat ? { cat, amount } : null, touchesYield };
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
