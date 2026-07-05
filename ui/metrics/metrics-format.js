// metrics-format.js
// Shared numeric formatters used by the metric registry and UI views.
//
// Numbers are formatted through the engine's Locale.toNumber so grouping and the
// decimal mark follow the player's language (German "1.234,5", French "1 234,5",
// etc.) — the same API the base game uses for scores/yields, which likewise
// concatenates suffixes like "%"/"km²" after it (see utilities-city-yields.js).
// When the engine Locale API is unavailable (Node tests, early load) every
// formatter falls back to the manual English formatting it used before, so
// behaviour is unchanged off-engine. The engine does not abbreviate magnitudes,
// so the "K/M/B/T" tiers stay a mod convention; only the mantissa localizes.

/**
 * Format a number through the engine's locale-aware `Locale.toNumber`, or return
 * `fallback` (the manual English formatting) when that API is unavailable.
 * @param {number} n The value to format.
 * @param {string} spec A .NET-style numeric format ("0.0", "0.00"); "" for a
 *   plain grouped integer.
 * @param {string} fallback The off-engine result (must match the prior output).
 * @returns {string} The locale-formatted number, or `fallback`.
 */
function localeNumber(n, spec, fallback) {
  try {
    if (typeof Locale !== "undefined" && typeof Locale.toNumber === "function") {
      return spec ? Locale.toNumber(n, spec) : Locale.toNumber(n);
    }
  } catch (_) {
    // Locale.toNumber can throw on malformed input; use the manual fallback.
  }
  return fallback;
}

/**
 * Resolve a `LOC_*` tag through the engine, or return `fallback` (the prior English
 * text) when the Locale API is unavailable or the tag is missing — mirrors
 * {@link localeNumber}'s graceful fallback so a localized suffix reads in the
 * player's language on-engine yet stays stable off-engine (Node tests).
 * @param {string} key The `LOC_*` tag.
 * @param {string} fallback The off-engine result (must match the prior output).
 * @returns {string} The localized text, or `fallback`.
 */
function localeText(key, fallback) {
  try {
    if (typeof Locale !== "undefined" && typeof Locale.compose === "function") {
      const s = Locale.compose(key);
      // Locale.compose echoes the tag back for a missing key; treat that as absent.
      if (s && s !== key) return s;
    }
  } catch (_) {
    // Locale.compose can throw on a malformed/missing tag; use the fallback.
  }
  return fallback;
}

/**
 * Format a number with a magnitude suffix, e.g. `1234567` -> `"1.23M"`.
 * Handles negatives and sub-1000 values (no suffix). The mantissa is localized;
 * the suffix tier is a mod convention (the engine does not abbreviate).
 * @param {number} n Value to format.
 * @returns {string} The formatted string.
 */
export function formatBigNumber(n) {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1e12) return sign + localeNumber(a / 1e12, "0.00", (a / 1e12).toFixed(2)) + "T";
  if (a >= 1e9) return sign + localeNumber(a / 1e9, "0.00", (a / 1e9).toFixed(2)) + "B";
  if (a >= 1e6) return sign + localeNumber(a / 1e6, "0.00", (a / 1e6).toFixed(2)) + "M";
  if (a >= 1e3) return sign + localeNumber(a / 1e3, "0.0", (a / 1e3).toFixed(1)) + "K";
  const rounded = Math.round(a);
  return sign + localeNumber(rounded, "", String(rounded));
}

/**
 * Format a value as currency, prefixing {@link formatBigNumber} with `$`.
 * @param {number} n Value to format.
 * @returns {string} The formatted string.
 */
export function formatCurrency(n) {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  return "$" + formatBigNumber(n);
}

/**
 * Format an area value as a rounded, grouped count suffixed with ` km²`.
 * @param {number} n Value to format.
 * @returns {string} The formatted string.
 */
export function formatArea(n) {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  return formatCount(Math.round(n)) + " km²";
}

/**
 * Format a value as a rounded integer percentage suffixed with `%`.
 * @param {number} n Value to format.
 * @returns {string} The formatted string.
 */
export function formatPercent(n) {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  const rounded = Math.round(n);
  return localeNumber(rounded, "", String(rounded)) + "%";
}

/**
 * Format a value as a rounded integer with locale-aware thousands grouping.
 * @param {number} n Value to format.
 * @returns {string} The formatted string.
 */
export function formatCount(n) {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  const rounded = Math.round(n);
  return localeNumber(rounded, "", String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ","));
}

/**
 * Format a value as a signed per-turn rate, e.g. `+12.3/turn`.
 * @param {number} n Value to format.
 * @returns {string} The formatted string.
 */
export function formatSignedRate(n) {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  const rounded = Math.abs(n) > 100 ? Math.trunc(n) : Math.trunc(n * 10) / 10;
  const prefix = n >= 0 ? "+" : "";
  const num = localeNumber(rounded, Number.isInteger(rounded) ? "" : "0.0", String(rounded));
  return `${prefix}${num}${localeText("LOC_DEMOGRAPHICS_RATE_PER_TURN_SUFFIX", "/turn")}`;
}
