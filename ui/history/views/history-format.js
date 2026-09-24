// history-format.js
//
// Text for archived games: outcome, lineage, setup and date lines. Works at the main menu: every
// name comes from a LOC tag stored in the record, never from live game data.

import { t, typeName, prettyType, victoryName } from "/demographics/ui/history/core/history-text.js";

/**
 * The game's result in words.
 * @param {ArchiveRecord} rec Record.
 * @returns {string} Localized result.
 */
export function outcomeLabel(rec) {
  const o = rec.outcome;
  const victory = o.victory ? victoryName(o.victory, o.name) : "";
  if (o.status === "victory") return victory ? t("LOC_DEMOGRAPHICS_HIST_RESULT_VICTORY_BY", victory) : t("LOC_DEMOGRAPHICS_HIST_RESULT_VICTORY");
  if (o.status === "defeat") return t("LOC_DEMOGRAPHICS_HIST_RESULT_DEFEAT");
  if (o.status === "ended") return t("LOC_DEMOGRAPHICS_HIST_RESULT_ENDED");
  return t("LOC_DEMOGRAPHICS_HIST_RESULT_IN_PROGRESS");
}

/**
 * Short status class for styling rows. A game that ended without a winner is its own case: it is
 * not a defeat, and grey is kept for an empty figure.
 * @param {ArchiveRecord} rec Record.
 * @returns {string} "win" | "loss" | "ended" | "open".
 */
export function outcomeClass(rec) {
  if (rec.outcome.status === "victory") return "win";
  if (rec.outcome.status === "defeat") return "loss";
  return rec.outcome.status === "in_progress" ? "open" : "ended";
}

/**
 * The civilizations led, in order ("Rome → Normans → Prussia").
 * @param {ArchiveRecord} rec Record.
 * @returns {string} Line.
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
 * Readable text for one setup field. The engine hands these back in TWO shapes and both are in the
 * archive: a LOC tag ("LOC_GAMESPEED_STANDARD_NAME") and a bare engine type ("GAMESPEED_STANDARD"),
 * depending on how that game was configured. Composing only the first left the second on screen as
 * a raw "GAMESPEED_STANDARD", and dropping anything still tag-shaped hid the first whenever the tag
 * did not resolve — so a resolved tag wins, and anything else is reduced to its words.
 * @param {string} [v] Stored setup value, either shape.
 * @returns {string} Readable name, or "" when the record has no value.
 */
function setupName(v) {
  const raw = String(v || "");
  if (!raw) return "";
  const s = t(raw);
  if (s && s !== raw && !s.startsWith("LOC_")) return s;
  return prettyType(raw.replace(/^LOC_/, "").replace(/_NAME$/, ""));
}

/**
 * Setup summary ("Standard · Large · Continents Plus · Deity"). A record without a setup (an older
 * or hand-edited archive) gives an empty line.
 * @param {Partial<HnrSetup>} [s] Setup.
 * @returns {string} Line.
 */
export function setupLine(s = {}) {
  const o = s || {};
  return [setupName(o.speed), setupName(o.mapSize), mapName(o.mapScript || ""), setupName(o.difficulty)]
    .filter(Boolean).join("  ·  ");
}

/**
 * Calendar date of a timestamp as YYYY-MM-DD.
 * @param {number} ms Milliseconds since the epoch.
 * @returns {string} Date.
 */
export function dateLabel(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (/** @type {number} */ n) => (n < 10 ? "0" : "") + n;
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

/**
 * The honorific title for a ladder index.
 * @param {number} idx 1..12.
 * @returns {string} Localized title.
 */
export function titleName(idx) {
  return t("LOC_DEMOGRAPHICS_HIST_TITLE_" + idx);
}
