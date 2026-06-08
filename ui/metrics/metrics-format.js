// metrics-format.js
// Shared numeric formatters used by the metric registry and UI views.

/**
 * Format a number with a magnitude suffix, e.g. `1234567` -> `"1.23M"`.
 * Handles negatives and sub-1000 values (no suffix).
 * @param {number} n Value to format.
 * @returns {string} The formatted string.
 */
export function formatBigNumber(n) {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1e12) return sign + (a / 1e12).toFixed(2) + "T";
  if (a >= 1e9) return sign + (a / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return sign + (a / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return sign + (a / 1e3).toFixed(1) + "K";
  return sign + String(Math.round(a));
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
 * Format an area value as a rounded, comma-grouped count suffixed with ` km²`.
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
  return Math.round(n) + "%";
}

/**
 * Format a value as a rounded integer with comma thousands-separators.
 * @param {number} n Value to format.
 * @returns {string} The formatted string.
 */
export function formatCount(n) {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
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
  return `${prefix}${rounded}/turn`;
}
