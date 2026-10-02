// demographics-i18n.js
//
// Localization helper: resolves a LOC_* tag to the active language's string via
// the engine's Locale system, falling back to the tag itself. Every user-visible
// string is a `LOC_*` tag resolved through t(), with substitution args mapping
// positionally to `{N_Name}` placeholders; a new tag must be added to every
// locale file (see text/README.md). Base-game-owned strings: BASE_GAME_LOC_KEYS below.

const DBG = false;
/**
 * Debug logger, no-op unless {@link DBG} is set.
 * @param {...*} a Values to log.
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.i18n]", ...a);
}

/** Display locales that need a CJK font, by their slot in the game's font lists below. */
const CJK_FONT_SLOT = /** @type {Record<string, number>} */ ({ zh_Hans_CN: 1, zh_Hant_HK: 2, ja_JP: 3, ko_KR: 4 });
/** Class set on <html> per CJK locale; screen-demographics-locale-fonts.css keys on it. */
const CJK_FONT_CLASS = ["", "dg-lang-sc", "dg-lang-tc", "dg-lang-jp", "dg-lang-kr"];

/** @returns {number} The active locale's slot in the font lists (0 = Latin and Cyrillic). */
function cjkFontSlot() {
  try {
    return CJK_FONT_SLOT[String(Locale.getCurrentDisplayLocale())] || 0;
  } catch (_) {
    return 0;
  }
}

/**
 * The font list for the active locale, ordered the way the game orders its own (global-scaling.js
 * getOrderedFontFamily): the locale's CJK face swaps into first place. BodyFont and TitleFont have
 * no Hangul, kana or Han glyphs, and a canvas draws with the FIRST family only, so a chart that
 * names BodyFont first shows missing-glyph boxes in Chinese, Japanese and Korean.
 * @param {"body"|"title"} [kind] Body or title faces.
 * @returns {string} A CSS font-family list.
 */
export function localeFontFamily(kind = "body") {
  const base = kind === "title" ? "TitleFont" : "BodyFont";
  const faces = [base, base + "-SC", base + "-TC", base + "-JP", base + "-KR"];
  const slot = cjkFontSlot();
  [faces[0], faces[slot]] = [faces[slot], faces[0]];
  return faces.join(", ") + ", sans-serif";
}

/**
 * Mark <html> with the CJK locale class so the mod's stylesheets switch to the locale's font list.
 * Safe to call more than once and from either scope.
 */
export function applyLocaleFontClass() {
  try {
    const cls = CJK_FONT_CLASS[cjkFontSlot()];
    if (cls && document.documentElement) document.documentElement.classList.add(cls);
  } catch (_) {
    // No document (tests) or no Locale yet: the stylesheets keep the Latin list.
  }
}

/**
 * A stored game year in the active language. Samples keep the year as the engine wrote it in the
 * session that recorded them ("1380 BCE", "1060 CE"), and the engine formats only the current turn,
 * so an English year is re-read here for display; anything else passes through unchanged. Stored
 * values stay as recorded: the war code parses them.
 * @param {*} year A stored year string.
 * @returns {string} The year for display.
 */
export function localYear(year) {
  const s = year == null ? "" : String(year);
  const m = /^\s*(\d[\d,.]*)\s*(BCE|BC|CE|AD)\s*$/.exec(s);
  if (!m) return s;
  const key = m[2].startsWith("B") ? "LOC_DEMOGRAPHICS_YEAR_BCE" : "LOC_DEMOGRAPHICS_YEAR_CE";
  const out = t(key, m[1]);
  return out && out !== key ? out : s;
}

/** Per-age turn prefixes ("A12", "E1", "M40"); an unknown age falls back to the plain turn label. */
const AGE_TURN_KEYS = /** @type {Record<string, string>} */ ({
  AGE_ANTIQUITY: "LOC_DEMOGRAPHICS_AGE_TURN_ANTIQUITY",
  AGE_EXPLORATION: "LOC_DEMOGRAPHICS_AGE_TURN_EXPLORATION",
  AGE_MODERN: "LOC_DEMOGRAPHICS_AGE_TURN_MODERN"
});
/** English forms of the turn labels, for when the text database has not loaded. */
const TURN_FALLBACK = /** @type {Record<string, string>} */ ({
  LOC_DEMOGRAPHICS_AGE_TURN_ANTIQUITY: "A",
  LOC_DEMOGRAPHICS_AGE_TURN_EXPLORATION: "E",
  LOC_DEMOGRAPHICS_AGE_TURN_MODERN: "M",
  LOC_DEMOGRAPHICS_TURN_DASH: "T-",
  LOC_DEMOGRAPHICS_TURN_SHORT: "T"
});

/**
 * Compose a turn-label tag, or its English form when the tag does not resolve.
 * @param {string} key The tag.
 * @param {number} turn The turn.
 * @returns {string} The label.
 */
function composeTurn(key, turn) {
  const s = t(key, turn);
  return s && s !== key ? s : TURN_FALLBACK[key] + turn;
}

/**
 * A short turn label: age-relative ("A12") when the age is known, else "T-12".
 * @param {number} turn The turn.
 * @param {string} [age] The age type (AGE_*).
 * @returns {string} The label.
 */
export function turnLabel(turn, age) {
  return composeTurn((age && AGE_TURN_KEYS[age]) || "LOC_DEMOGRAPHICS_TURN_DASH", turn);
}

/**
 * A plain turn label for spans and axis ends ("T98").
 * @param {number} turn The turn.
 * @returns {string} The label.
 */
export function turnPlain(turn) {
  return composeTurn("LOC_DEMOGRAPHICS_TURN_SHORT", turn);
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

// ── Game-authored text markup ────────────────────────────────────────────────
//
// Text the GAME owns (a wonder's Description, a unique quarter's flavor, a belief's effect)
// carries its own markup: `[B]…[/B]`, `[icon:YIELD_GOLD]`, `[TIP:LOC_…]Improvement[/TIP]`.
// `Locale.compose` returns that markup VERBATIM — it is the engine's `Locale.stylize` that turns
// it into `<fxs-font-icon>` / `<fxs-tip>` elements. Composing game text into a sink that does not
// stylize therefore shows the raw tokens on screen. Watched on 1.5.0, 2026-09-23:
//   compose("LOC_IMPROVEMENT_FARM_DESCRIPTION")
//     → "[TIP:…]Improvement[/TIP] that provides [icon:YIELD_FOOD] Food from the tile."
//   stylize(same)
//     → "<p cohinline><fxs-tip …></fxs-tip>&nbsp;that provides <fxs-font-icon …></fxs-font-icon>…"
// Pick by SINK: innerHTML → stylizeLocaleTag; textContent / stored text → stripLocaleMarkup.

/**
 * Escape text for insertion into an innerHTML string.
 * @param {string} s The text.
 * @returns {string} The escaped text.
 */
function escapeMarkupHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Strip the game's own text markup to plain words, for a sink that takes textContent (or for text
 * that gets stored). The bracketed tokens go; the words they wrap stay.
 * @param {string} s A composed (localized) string.
 * @returns {string} Plain text.
 */
export function stripLocaleMarkup(s) {
  return String(s == null ? "" : s)
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve a game-authored tag to the engine's own markup HTML. ONLY for an innerHTML sink. Falls
 * back to escaped plain text when `Locale.stylize` is missing or does not resolve the tag, so raw
 * markup can never reach the screen either way.
 * @param {string} tag The `LOC_*` tag.
 * @returns {string} HTML (already escaped where it is not engine markup).
 */
export function stylizeLocaleTag(tag) {
  try {
    if (typeof Locale !== "undefined" && typeof Locale.stylize === "function") {
      const html = Locale.stylize(tag);
      if (html && String(html) !== String(tag)) return String(html);
    }
  } catch (_) {
    // Locale.stylize can throw on a malformed/missing tag; fall through to plain text.
    dlog("Locale.stylize threw for", tag);
  }
  return escapeMarkupHtml(stripLocaleMarkup(t(tag)));
}

// ── Numbered identity fallbacks ──────────────────────────────────────────────
//
// `t()` returns the raw tag when Locale is unavailable or the tag is missing,
// which is a user-visible defect for identity fallbacks. These helpers compose
// the localized template and otherwise degrade to a readable English
// "<prefix> <id>", never the raw tag.

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
// Some strings the mod displays are owned by the base game, whose localization
// DB ships their `LOC_*` tag, so the mod does not redefine them in ModText.xml.
// This registry is the single source of truth for "intentionally external":
// `tBaseGame()` resolves one, `isBaseGameLoc()` lets audit tooling exclude them
// (including tags built at runtime from a documented prefix).

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
  "LOC_UI_CONTENT_MGR_SUBTITLE_DESCRIPTION",
  "LOC_MAIN_MENU_ADDITIONAL_CONTENT",        // history-mainmenu.js — main-menu button captions the
  "LOC_MAIN_MENU_OPTIONS",                   //   Hall of Fame entry is placed next to
  "LOC_YIELD_CULTURE",                       // pantheon-effects.js — yield names in pantheon effect text
  "LOC_YIELD_DIPLOMACY",
  "LOC_YIELD_GOLD",
  "LOC_YIELD_HAPPINESS",
  "LOC_YIELD_PRODUCTION",
  "LOC_YIELD_SCIENCE"
]));

/**
 * Base-game LOC key PREFIXES: tags built at runtime as `<prefix> + <id> + <suffix>`.
 * e.g. `"LOC_CIVILIZATION_" + stem + "_ADJECTIVE"` (chart-wars-naming.js).
 * @type {readonly string[]}
 */
export const BASE_GAME_LOC_PREFIXES = Object.freeze([
  "LOC_CIVILIZATION_", // civ names/adjectives, resolved from the engine civ DB
  "LOC_LEADER_",       // leader names, resolved from the engine leader DB
  "LOC_AGE_"           // age names: `"LOC_" + ageType + "_NAME"` with ageType "AGE_*" (view-hof-games.js)
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
 * localized by the engine, not by our ModText.xml.
 * @param {string} key A base-game `LOC_*` tag.
 * @param {...*} args Optional `{N_Param}` substitution arguments.
 * @returns {string} The engine-localized string, or `key` if Locale is unavailable.
 */
export function tBaseGame(key, ...args) {
  return t(key, ...args);
}
