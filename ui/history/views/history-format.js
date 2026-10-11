// history-format.js
//
// Text for archived games: outcome, lineage, setup and date lines. Works at the main menu: every
// name comes from a LOC tag stored in the record, never from live game data.

import { t, typeName, prettyType, victoryName } from "/demographics/ui/history/core/history-text.js";

/**
 * The game's result in words.
 * @param {ArchiveRecord} rec
 * @returns {string}
 */
export function outcomeLabel(rec) {
  const outcome = rec.outcome;
  const victory = outcome.victory ? victoryName(outcome.victory, outcome.name) : "";
  if (outcome.status === "victory") {
    return victory ? t("LOC_DEMOGRAPHICS_HIST_RESULT_VICTORY_BY", victory) : t("LOC_DEMOGRAPHICS_HIST_RESULT_VICTORY");
  }
  if (outcome.status === "defeat") return t("LOC_DEMOGRAPHICS_HIST_RESULT_DEFEAT");
  if (outcome.status === "ended") return t("LOC_DEMOGRAPHICS_HIST_RESULT_ENDED");
  return t("LOC_DEMOGRAPHICS_HIST_RESULT_IN_PROGRESS");
}

/**
 * Short status class for styling rows. A game that ended without a winner is its own case: it is
 * not a defeat, and gray is kept for an empty figure.
 * @param {ArchiveRecord} rec
 * @returns {string} "win" | "loss" | "ended" | "open".
 */
export function outcomeClass(rec) {
  if (rec.outcome.status === "victory") return "win";
  if (rec.outcome.status === "defeat") return "loss";
  return rec.outcome.status === "in_progress" ? "open" : "ended";
}

/**
 * The civilizations led, in order ("Rome → Normans → Prussia").
 * @param {ArchiveRecord} rec
 * @returns {string}
 */
export function civLine(rec) {
  return rec.civs.map((c) => typeName(c.name, c.civ)).join("  →  ");
}

/**
 * Readable map name from a map script path ("{base-standard}maps/continents-plus.js").
 * @param {string} script Script path.
 * @returns {string} "Continents Plus".
 */
export function mapName(script) {
  const file = String(script || "").split("/").pop() || "";
  return prettyType(file.replace(/\.js$/, "").replace(/-/g, "_"));
}

/**
 * Readable text for one setup field. The engine hands these back in two shapes and both are in the
 * archive: a LOC tag ("LOC_GAMESPEED_STANDARD_NAME") and a bare engine type ("GAMESPEED_STANDARD"),
 * depending on how that game was configured. Composing only the first left the second on screen as
 * a raw "GAMESPEED_STANDARD", and dropping anything still tag-shaped hid the first whenever the tag
 * did not resolve. So a resolved tag wins, and anything else is reduced to its words.
 * @param {string} [value] Stored setup value, either shape.
 * @returns {string} Readable name, or "" when the record has no value.
 */
function setupName(value) {
  const raw = String(value || "");
  if (!raw) return "";
  const text = t(raw);
  if (text && text !== raw && !text.startsWith("LOC_")) return text;
  return prettyType(raw.replace(/^LOC_/, "").replace(/_NAME$/, ""));
}

/**
 * Setup summary ("Standard · Large · Continents Plus · Deity"). A record without a setup (an older
 * or hand-edited archive) gives an empty line.
 * @param {Partial<HistorySetup>} [setup]
 * @returns {string}
 */
export function setupLine(setup = {}) {
  const fields = setup || {};
  return [
    setupName(fields.speed),
    setupName(fields.mapSize),
    mapName(fields.mapScript || ""),
    setupName(fields.difficulty)
  ].filter(Boolean).join("  ·  ");
}

/**
 * Calendar date of a timestamp as YYYY-MM-DD.
 * @param {number} ms Milliseconds since the epoch.
 * @returns {string}
 */
export function dateLabel(ms) {
  if (!ms) return "";
  const date = new Date(ms);
  const pad = (/** @type {number} */ n) => (n < 10 ? "0" : "") + n;
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
}

/**
 * The honorific title for a ladder index.
 * @param {number} idx 1..12.
 * @returns {string}
 */
export function titleName(idx) {
  return t("LOC_DEMOGRAPHICS_HIST_TITLE_" + idx);
}

// The honorifics are historical rulers' names, so beside a leader's portrait they read as the leader's own
// name. They are always shown quoted, and under a label where no column heading says what they are.

/**
 * The honorific in quotes, for a cell under an "Honorific Title" heading.
 * @param {number} idx 1..12.
 * @returns {string}
 */
export function quotedTitle(idx) {
  return t("LOC_DEMOGRAPHICS_HIST_HONORIFIC_QUOTED", titleName(idx));
}

/**
 * The honorific with its label, in parentheses, for a card or page with no column heading.
 * @param {number} idx 1..12.
 * @returns {string}
 */
export function labelledTitle(idx) {
  return t("LOC_DEMOGRAPHICS_HIST_HONORIFIC_LABELLED", titleName(idx));
}
