// demographics-risings-text.js
//
// The words for a Partisans rising: its name, why it began and how it ended. The Conflicts
// timeline and the Chronicle both use these, each with its own translator and its own way of
// naming civilizations, so the caller passes the translator in and hands over names already
// resolved. A rising is named by its place, never by who took part. When the spoiler guard hides
// the other civ, its name arrives empty and the text names the place and the owner only.

/**
 * Names a rising's text is built from, already localized. `other` and `otherAdjective` are "" when
 * the rising has no other civ or the spoiler guard hides it; `policy` is "" without a policy card.
 * @typedef {object} RisingNames
 * @property {string} place Settlement name.
 * @property {string} owner Civ the people rose against.
 * @property {string} other flip: the civ the rebels are loyal to; enclave: the community's homeland.
 * @property {string} otherAdjective Adjective of `other` ("Greek").
 * @property {string} policy Name of the host's treatment policy card.
 */

/**
 * @typedef {object} RisingFacts
 * @property {string} cause "flip", "enclave" or "misery".
 * @property {boolean} [ended] Whether the rising is over.
 * @property {string} [outcome] "dispersed", "time", "burned" or "age".
 */

/** @type {Record<string, string>} */
const OUTCOME_KEYS = {
  dispersed: "LOC_DEMOGRAPHICS_RISING_OUTCOME_DISPERSED",
  time: "LOC_DEMOGRAPHICS_RISING_OUTCOME_TIME",
  burned: "LOC_DEMOGRAPHICS_RISING_OUTCOME_BURNED",
  age: "LOC_DEMOGRAPHICS_RISING_OUTCOME_AGE"
};

/**
 * @param {(key: string, ...args: *[]) => string} t
 * @param {RisingNames} names
 */
function enclaveCause(t, names) {
  if (names.policy) {
    return names.other
      ? t("LOC_DEMOGRAPHICS_RISING_CAUSE_ENCLAVE_POLICY", names.owner, names.policy, names.other)
      : t("LOC_DEMOGRAPHICS_RISING_CAUSE_ENCLAVE_POLICY_UNNAMED", names.owner, names.policy);
  }
  return names.other
    ? t("LOC_DEMOGRAPHICS_RISING_CAUSE_ENCLAVE", names.owner, names.other)
    : t("LOC_DEMOGRAPHICS_RISING_CAUSE_ENCLAVE_UNNAMED", names.owner);
}

/**
 * Text builders bound to one translator.
 * @param {(key: string, ...args: *[]) => string} t The caller's LOC resolver.
 * @returns {{
 *   title: (facts: RisingFacts, names: RisingNames) => string,
 *   cause: (facts: RisingFacts, names: RisingNames) => string,
 *   outcome: (facts: RisingFacts, names: RisingNames) => string
 * }}
 */
export function makeRisingText(t) {
  return {
    title(facts, names) {
      if (facts.cause === "flip" && names.otherAdjective) {
        return t("LOC_DEMOGRAPHICS_RISING_NAME_LOYALIST", names.otherAdjective, names.place);
      }
      return t("LOC_DEMOGRAPHICS_RISING_NAME_UPRISING", names.place);
    },
    cause(facts, names) {
      if (facts.cause === "misery") return t("LOC_DEMOGRAPHICS_RISING_CAUSE_MISERY", names.place);
      if (facts.cause === "enclave") return enclaveCause(t, names);
      return names.other
        ? t("LOC_DEMOGRAPHICS_RISING_CAUSE_FLIP", names.place, names.owner, names.other)
        : t("LOC_DEMOGRAPHICS_RISING_CAUSE_FLIP_UNNAMED", names.place, names.owner);
    },
    outcome(facts, names) {
      if (!facts.ended) return t("LOC_DEMOGRAPHICS_RISING_OUTCOME_ONGOING");
      const key = OUTCOME_KEYS[facts.outcome || ""];
      return key ? t(key, names.place) : "";
    }
  };
}
