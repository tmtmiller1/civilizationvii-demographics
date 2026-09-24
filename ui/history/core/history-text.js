// history-text.js
//
// The main menu's saved-text fallback layer over the mod's shared localization helpers. Every
// user-visible string is a LOC tag resolved through t(); every number goes through num(). Strings
// live in text/<locale>/ModText.xml. Engine tags (leader, civilization, wonder, victory and age
// names) are composed the same way, so they appear in the player's language.
//
// Composition and number formatting are NOT reimplemented here: t() delegates to the shared
// resolver in ui/core/demographics-i18n.js and num() to localeNumber() in ui/metrics/metrics-format.js,
// so Locale semantics live in one place for the whole mod. What this module owns is the piece the
// shared helpers cannot provide — at the main menu the gameplay text DB is not loaded, so a tag
// first seen in a game resolves from the text stored with the archived record (savedTexts below).

import { t as composeLoc } from "/demographics/ui/core/demographics-i18n.js";
import { localeNumber } from "/demographics/ui/metrics/metrics-format.js";

/**
 * Text saved with archived games for tags the main menu cannot resolve. The main menu loads only
 * setup text, so names first seen in a game (settlements, Triumphs, religions) are stored with
 * each record as it was shown in game and used when the tag does not resolve.
 * @type {Map<string, string>}
 */
const savedTexts = new Map();

/**
 * Register saved text for tags (from an archived record).
 * @param {Record<string, string>|undefined} texts Tag -> text.
 */
export function addSavedTexts(texts) {
  for (const [k, v] of Object.entries(texts || {})) if (typeof v === "string" && v) savedTexts.set(k, v);
}

/**
 * Whether composed text is an unresolved tag.
 * @param {string} s Composed text.
 * @param {string} key The tag.
 * @returns {boolean} True when unresolved.
 */
function unresolved(s, key) {
  return !s || s === key || s.startsWith("LOC_");
}

/**
 * Resolve a LOC tag (or pass literal text through) for the active language.
 * @param {string} key A `LOC_*` tag or already-localized text.
 * @param {...*} args `{N_Name}` substitution arguments.
 * @returns {string} The localized string, saved text for it, or the key when neither exists.
 */
export function t(key, ...args) {
  if (!key) return "";
  if (typeof Locale === "undefined" || typeof Locale.compose !== "function") return savedTexts.get(key) || key;
  // The shared resolver swallows a throw from Locale.compose and returns the key; `?? key` covers a
  // compose that returns nothing, so an unresolved tag always reaches the savedTexts fallback below.
  const s = composeLoc(key, ...args) ?? key;
  return args.length === 0 && unresolved(s, key) ? savedTexts.get(key) || s : s;
}

/**
 * Like t(), but never shows a raw tag: an unresolved tag becomes the fallback text.
 * @param {string} key The tag.
 * @param {string} fallback Readable text to show when the tag does not resolve.
 * @returns {string} Localized text or the fallback.
 */
export function tOr(key, fallback) {
  const s = t(key);
  return unresolved(s, key) ? fallback : s;
}

/**
 * Format a number for the player's language.
 * @param {number} n The value.
 * @returns {string} Locale-formatted number.
 */
export function num(n) {
  const v = Number.isFinite(n) ? n : 0;
  // "" as the fallback so an unavailable, throwing or empty Locale.toNumber all fall through to the
  // rounded form, which is what this module returned before the formatter was shared.
  const s = localeNumber(v, "", "");
  return s ? String(s) : String(Math.round(v));
}

/**
 * Readable fallback for an engine type string: "CIVILIZATION_FRENCH_EMPIRE" -> "French Empire".
 * @param {string} type The engine type.
 * @returns {string} Title-cased words without the type prefix.
 */
export function prettyType(type) {
  const s = String(type || "");
  const body = s.replace(/^(CIVILIZATION|LEADER|BUILDING|WONDER|VICTORY|AGE|LEGACY|GAMESPEED|DIFFICULTY|MAPSIZE)_/, "");
  return body
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Localized display name for an engine type, via its stored LOC tag when present.
 * @param {string|undefined} tag The LOC tag captured with the type (may be empty).
 * @param {string} type The engine type string.
 * @returns {string} The name in the player's language, or a readable fallback.
 */
export function typeName(tag, type) {
  return tag ? tOr(tag, prettyType(type)) : prettyType(type);
}

/** Victory types whose game name repeats the word "Victory" ("Domination Victory"), given a short name. */
const SHORT_VICTORY_NAMES = /** @type {Record<string, string>} */ ({
  VICTORY_DOMINATION: "LOC_DEMOGRAPHICS_HIST_VICTORY_DOMINATION",
  VICTORY_LEGACY: "LOC_DEMOGRAPHICS_HIST_VICTORY_DOMINATION"
});

/**
 * A victory type's short name ("Scientific", "Domination").
 * @param {string} type Victory type.
 * @param {string} name The game's LOC tag for it.
 * @returns {string} Localized name.
 */
export function victoryName(type, name) {
  return SHORT_VICTORY_NAMES[type] ? t(SHORT_VICTORY_NAMES[type]) : typeName(name, type);
}

/**
 * Keys for what a Triumph asked for and what it gave. Saved with the archive when a game is played
 * (the engine's tables are not loaded at the main menu) and read back through t().
 * @param {string} type LegacyType.
 * @returns {string} Key.
 */
export function legacyWhyKey(type) {
  return "DGH_LEGACY_WHY_" + type;
}

/**
 * @param {string} type LegacyType.
 * @returns {string} Key.
 */
export function legacyWhatKey(type) {
  return "DGH_LEGACY_WHAT_" + type;
}

/**
 * Plain text from a game string: the game marks its help text up with [B], [S], [LINK] and
 * [TIP:...]...[/TIP] wrappers and [icon:...] glyphs, none of which a plain panel renders, so the
 * wrappers are unwrapped and the rest is dropped.
 * @param {string} s Game text.
 * @returns {string} Readable text.
 */
export function plainText(s) {
  return String(s || "")
    .replace(/\[(TIP|LINK)[^\]]*\]/gi, "")
    .replace(/\[\/(TIP|LINK)\]/gi, "")
    .replace(/\[\/?[A-Za-z][^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
