// demographics-i18n.js
//
// Localization helper. Resolves a LOC_* tag to the active language's string via
// the engine's Locale system, with a graceful fallback to the tag itself when
// Locale is unavailable or the tag is missing. The mod's strings are defined in
// text/<locale>/ModText.xml and loaded into the engine loc DB by demographics.modinfo.
//
// Works in any UI context: unlike CSS,
// Locale.compose reads the global localization database, not a per-screen sheet.
//
// ADDING A STRING: every user-visible string is a `LOC_*` tag resolved through
// t() — never hardcode display English in .js. Substitution args map positionally
// to `{N_Name}` placeholders in the text, e.g.
//   t("LOC_DEMOGRAPHICS_WONDER_TURN", 42)  with  <Text>Turn {1_Turn}</Text>
// (For the *_FALLBACK identity tags, use tPlayerFallback/tCsFallback below instead
// of a bare t() — see "Numbered identity fallbacks".)
// A new tag must be added to text/en_us/ModText.xml AND all 10 locale files (the
// engine loads a per-language DB, so a tag missing from a locale renders as the
// raw `LOC_...` string in that language). Non-English locales may carry English
// placeholder text pending translation — that is expected; tag-parity is the
// invariant, translation is a later pass. See text/README.md for the full workflow.
// For strings the BASE GAME already owns, see BASE_GAME_LOC_KEYS below.

const DBG = false;
/**
 * Debug logger, no-op unless {@link DBG} is set.
 * @param {...*} a Values to log.
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.i18n]", ...a);
}

/**
 * Resolve a localization tag to display text for the active language.
 * @param {string} key The `LOC_*` tag (e.g. `"LOC_DEMOGRAPHICS_BTN_COPY_CSV"`).
 * @param {...*} args Optional `{N_Param}` substitution arguments.
 * @returns {string} The localized string, or `key` itself if Locale is unavailable.
 */
export function t(key, ...args) {
  try {
    if (typeof Locale !== "undefined" && typeof Locale.compose === "function") {
      return Locale.compose(key, ...args);
    }
  } catch (_) {
    // Locale.compose can throw on a malformed/missing tag; fall back to the key.
    dlog("Locale.compose threw for", key);
  }
  return key;
}

// ── Numbered identity fallbacks ──────────────────────────────────────────────
//
// `t()` returns the raw tag when Locale is unavailable, throws, or the tag is
// missing from the active language DB. That is the right default for most copy,
// but NOT for the identity fallbacks below: a node/roster/legend rendering the
// literal "LOC_DEMOGRAPHICS_PLAYER_FALLBACK" is a user-visible defect. These
// helpers compose the localized template ("Player {1_Pid}") and, only if that
// fails, degrade to a readable English "<prefix> <id>" — never the raw tag.
// Always prefer these over a bare t() for the *_FALLBACK identity tags.

/**
 * Resolve a LOC tag whose text is a numbered identity template (e.g. "Player {1_Pid}"),
 * degrading to a readable `<englishPrefix> <id>` when the loc system cannot compose it.
 * @param {string} key The `LOC_*` tag.
 * @param {string} englishPrefix The last-resort English prefix (e.g. `"Player"`).
 * @param {number|string} id The `{1_*}` substitution id.
 * @returns {string} A human-readable name, never a raw `LOC_*` tag.
 */
function numberedFallback(key, englishPrefix, id) {
  const composed = t(key, id);
  if (typeof composed === "string" && composed.length > 0 && !composed.startsWith("LOC_")) {
    return composed;
  }
  return englishPrefix + " " + id;
}

/**
 * The display name for a player whose leader/civ name is unknown: the localized
 * "Player N", or a plain "Player N" when the loc system cannot compose it.
 * @param {number|string} pid The player id.
 * @returns {string} A human-readable player name.
 */
export function tPlayerFallback(pid) {
  return numberedFallback("LOC_DEMOGRAPHICS_PLAYER_FALLBACK", "Player", pid);
}

/**
 * The display name for a city-state whose name is unresolvable: the localized
 * "City-State N", or a plain "City-State N" when the loc system cannot compose it.
 * @param {number|string} pid The city-state player id.
 * @returns {string} A human-readable city-state name.
 */
export function tCsFallback(pid) {
  return numberedFallback("LOC_DEMOGRAPHICS_CS_FALLBACK", "City-State", pid);
}

// ── Base-game LOC keys ───────────────────────────────────────────────────────
//
// Some strings the mod displays are OWNED BY THE BASE GAME: the engine ships
// their `LOC_*` tag in its own localization DB (in every language it supports),
// so the mod deliberately does NOT define them in text/<locale>/ModText.xml —
// redefining them would fork base-game copy and drift on patches. Referencing
// the engine's tag is correct and gets us free, first-party translations.
//
// The registry below is the single source of truth for "this LOC_ tag is
// intentionally external, not a missing mod key." Use it three ways:
//   • `tBaseGame(key, ...args)` — resolve a base-game tag AND self-document intent.
//   • `isBaseGameLoc(key)` — audit tooling excludes these from "referenced but
//     not defined in ModText.xml" reports (they are supposed to be absent there).
//   • grep the constant to find/extend the list.
// Some are built at runtime from a prefix (e.g. `"LOC_CIVILIZATION_" + stem +
// "_ADJECTIVE"`), so `isBaseGameLoc` also matches the documented prefixes.

/** Exact base-game LOC tags the mod references (NOT defined in our ModText.xml). */
export const BASE_GAME_LOC_KEYS = Object.freeze(new Set([
  "LOC_CITY_NAME_UNSET",              // settlements-data.js — un-named settlement fallback
  "LOC_PEDIA_PAGEGROUP_CIVICS_NAME",  // chart-line-config.js — "Civics" y-axis unit
  "LOC_RESOURCECLASS_BONUS_NAME",     // chart-line-config.js — resource-class band labels
  "LOC_RESOURCECLASS_CITY_NAME",
  "LOC_RESOURCECLASS_EMPIRE_NAME",
  "LOC_RESOURCECLASS_FACTORY_NAME",
  "LOC_RESOURCECLASS_TREASURE_NAME",
  "LOC_UI_CONTENT_MGR_SUBTITLE",             // demographics-mod-options.js — Mods-page option group
  "LOC_UI_CONTENT_MGR_SUBTITLE_DESCRIPTION"
]));

/**
 * Base-game LOC key PREFIXES: tags built at runtime as `<prefix> + <id> + <suffix>`.
 * e.g. `"LOC_CIVILIZATION_" + stem + "_ADJECTIVE"` (chart-wars-naming.js).
 * @type {readonly string[]}
 */
export const BASE_GAME_LOC_PREFIXES = Object.freeze([
  "LOC_CIVILIZATION_"  // civ names/adjectives, resolved from the engine civ DB
]);

/**
 * Whether `key` is a base-game LOC tag (owned by the engine, intentionally NOT
 * in the mod's ModText.xml). Matches the exact registry and the runtime prefixes.
 * @param {string} key The `LOC_*` tag.
 * @returns {boolean} True when the tag is engine-provided.
 */
export function isBaseGameLoc(key) {
  if (typeof key !== "string") return false;
  if (BASE_GAME_LOC_KEYS.has(key)) return true;
  return BASE_GAME_LOC_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * Resolve a BASE-GAME LOC tag (see {@link BASE_GAME_LOC_KEYS}). Functionally
 * identical to {@link t}, but names the intent at the call site: this string is
 * localized by the engine, not by our ModText.xml. Prefer this over a bare `t()`
 * for engine-owned tags so the reference reads as deliberate, not an oversight.
 * @param {string} key A base-game `LOC_*` tag.
 * @param {...*} args Optional `{N_Param}` substitution arguments.
 * @returns {string} The engine-localized string, or `key` if Locale is unavailable.
 */
export function tBaseGame(key, ...args) {
  return t(key, ...args);
}
