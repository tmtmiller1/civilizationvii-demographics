import assert from "node:assert/strict";

// Stored years and turn labels follow the active language (Japanese charts used to show
// "1380 BCE" and "A50" from a game recorded in English).

const saved = globalThis.Locale;
const JA = {
  LOC_DEMOGRAPHICS_YEAR_BCE: "紀元前{1_Year}年", LOC_DEMOGRAPHICS_YEAR_CE: "西暦{1_Year}年",
  LOC_DEMOGRAPHICS_AGE_TURN_ANTIQUITY: "古{1_Turn}", LOC_DEMOGRAPHICS_TURN_DASH: "T-{1_Turn}", LOC_DEMOGRAPHICS_TURN_SHORT: "T{1_Turn}"
};
globalThis.Locale = { compose: (k, ...a) => (JA[k] ? JA[k].replace(/\{1_[A-Za-z]+\}/, String(a[0])) : k) };
const { localYear, turnLabel, turnPlain } = await import("/demographics/ui/core/demographics-i18n.js");
try {
  assert.equal(localYear("1380 BCE"), "紀元前1380年");
  assert.equal(localYear("1060 CE"), "西暦1060年");
  assert.equal(localYear("西暦1105年"), "西暦1105年", "a year recorded in another language passes through");
  assert.equal(localYear(""), "");
  assert.equal(localYear(undefined), "");
  assert.equal(localYear("1,060 AD"), "西暦1,060年");
  assert.equal(turnLabel(12, "AGE_ANTIQUITY"), "古12");
  assert.equal(turnLabel(5), "T-5");
  assert.equal(turnLabel(5, "AGE_UNKNOWN"), "T-5");
  assert.equal(turnPlain(98), "T98");
  globalThis.Locale = { compose: (k) => k }; // unresolved tags keep the stored text
  assert.equal(localYear("1380 BCE"), "1380 BCE");
  console.log("local-year harness passed");
} finally {
  globalThis.Locale = saved;
}
