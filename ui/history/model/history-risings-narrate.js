// history-risings-narrate.js
//
// Chronicle sentences for Partisans risings (events "rising" and "risingEnd", recorded by
// capture/history-risings.js). The words come from the same builder the Conflicts timeline uses;
// this module only fills in the names from the chronicle's Cast. The other civ is named only when
// the local player may see it, so an unmet civ never leaks through a rising's name or cause.

import { t } from "/demographics/ui/history/core/history-text.js";
import { makeRisingText } from "/demographics/ui/core/demographics-risings-text.js";

const TEXT = makeRisingText(t);

/**
 * @param {HistoryEvent} event
 * @returns {boolean} Whether the event is a rising's start or end.
 */
export function isRisingEvent(event) {
  return !!event && (event.k === "rising" || event.k === "risingEnd");
}

/**
 * A civ's adjective from the game's own text ("Greek"), or its name when the game has none.
 * @param {string} civType CIVILIZATION_*.
 * @param {string} civName Localized name, the fallback.
 * @returns {string}
 */
function civAdjective(civType, civName) {
  const stem = typeof civType === "string" ? civType.replace(/^CIVILIZATION_/, "") : "";
  if (!stem) return civName;
  const text = t("LOC_CIVILIZATION_" + stem + "_ADJECTIVE");
  return text && !text.startsWith("LOC_") ? text : civName;
}

/**
 * @param {string} tag A LOC tag saved in the event.
 * @returns {string} Its text, or "" when it doesn't resolve.
 */
function resolved(tag) {
  if (!tag || !tag.startsWith("LOC_")) return "";
  const text = t(tag);
  return text && !text.startsWith("LOC_") ? text : "";
}

/**
 * @param {HistoryEvent} event
 * @param {import("./history-narrate.js").Cast} cast
 * @param {string} age
 * @param {string} policy Resolved policy card name, or "".
 * @returns {import("/demographics/ui/core/demographics-risings-text.js").RisingNames}
 */
function risingNames(event, cast, age, policy) {
  const owner = event.p >= 0 ? cast.civName(event.p, age) : "";
  const q = typeof event.q === "number" && event.q >= 0 && cast.known(event.q) ? event.q : -1;
  const other = q >= 0 ? cast.civName(q, age) : "";
  return {
    place: event.n || "",
    owner: owner || t("LOC_DEMOGRAPHICS_HIST_INDEPENDENT_PEOPLE"),
    other,
    otherAdjective: other ? civAdjective(cast.civType(q, age), other) : "",
    policy
  };
}

/**
 * Template arguments for a rising event: [name, cause line] or [name, outcome line].
 * @param {HistoryEvent} event
 * @param {import("./history-narrate.js").Cast} cast
 * @param {string} age Age type of the event.
 * @returns {string[]}
 */
export function risingArgs(event, cast, age) {
  const [cause, extra = ""] = String(event.x || "").split("|");
  const names = risingNames(event, cast, age, event.k === "rising" ? resolved(extra) : "");
  const title = TEXT.title({ cause }, names);
  if (event.k === "rising") return [title, TEXT.cause({ cause }, names)];
  return [title, TEXT.outcome({ cause, ended: true, outcome: extra }, names)];
}
