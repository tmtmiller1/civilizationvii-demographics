// demographics-i18n.js
//
// Localization helper. Resolves a LOC_* tag to the active language's string via
// the engine's Locale system, with a graceful fallback to the tag itself when
// Locale is unavailable or the tag is missing. The mod's strings are defined in
// text/<locale>/ModText.xml and loaded into the engine loc DB by demographics.modinfo.
//
// Works in any UI context: unlike CSS,
// Locale.compose reads the global localization database, not a per-screen sheet.

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
