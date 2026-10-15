// history-narrate.js
//
// Turns chronicle events into sentences in the player's language, and summarizes an age. The same
// templates serve the live campaign and archived games through a Cast: a small lookup from player
// id to the civilization name to use at a given age.
//
// Chronicle event records (HistoryEvent) keep one-letter keys because every event is stored in the
// save, and long keys would grow it for nothing. The keys:
//   t turn · a age index into CampaignDoc.ages · k kind · p acting player · q other player
//   n display name (LOC tag or literal text) · x engine type string · d date label at the time

import { t, typeName, victoryName } from "/demographics/ui/history/core/history-text.js";
import { gameColors } from "/demographics/ui/history/views/history-colors.js";
import { isRisingEvent, risingArgs } from "/demographics/ui/history/model/history-risings-narrate.js";

/**
 * @typedef {Object} Cast
 * @property {number} local The local player id.
 * @property {(pid:number, age:string) => string} civName Localized civilization name for a player in an age.
 * @property {(pid:number) => string} leaderName Localized leader name.
 * @property {(pid:number) => boolean} known Whether the local player may see this player (met, or self).
 * @property {(pid:number) => string} color CSS color for the player.
 * @property {(pid:number, age:string) => string} civType Civilization type for a player in an age ("" when unknown).
 */

/**
 * The civilization span a player held in an age (or their latest before it).
 * @param {HistoryCivSpan[]} civs
 * @param {string} age
 * @returns {HistoryCivSpan|null}
 */
export function spanFor(civs, age) {
  if (!civs || civs.length === 0) return null;
  return civs.find((c) => c.age === age) || civs[civs.length - 1];
}

/**
 * A cast built from a live campaign. Who counts as `known` follows the Demographics analytics
 * policy: "full" shows everyone, "own" only the local player, and "met" (the default) the local
 * player plus every civilization met so far.
 * @param {CampaignDoc} doc
 * @param {"full"|"met"|"own"} [visibility]
 * @returns {Cast}
 */
export function castFromDoc(doc, visibility = "met") {
  const pids = Object.keys(doc.players)
    .map(Number)
    .sort((a, b) => Number(b === doc.local) - Number(a === doc.local) || a - b);
  const colors = gameColors(pids.map((pid) => {
    const player = doc.players[String(pid)];
    return { pid, primary: player.color, secondary: player.color2 };
  }));
  const met = (/** @type {number} */ pid) =>
    pid === doc.local ||
    visibility === "full" ||
    (visibility === "met" && !!doc.last?.players?.[String(pid)]?.met);
  return {
    local: doc.local,
    civName: (pid, age) => {
      const player = doc.players[String(pid)];
      const span = spanFor(player?.civs || [], age);
      if (span) return typeName(span.name, span.civ);
      return player ? typeName(player.leaderName, player.leader) : "";
    },
    leaderName: (pid) => {
      const player = doc.players[String(pid)];
      return player ? typeName(player.leaderName, player.leader) : "";
    },
    known: met,
    color: (pid) => colors.get(pid) || "",
    civType: (pid, age) => spanFor(doc.players[String(pid)]?.civs || [], age)?.civ || ""
  };
}

/**
 * A cast built from an archived record (rivals keep their final civilization only).
 * @param {ArchiveRecord} rec
 * @returns {Cast}
 */
export function castFromRecord(rec) {
  // A rival row is [pid, leader, leaderName, civ, civName, color, elimTurn, triumphs, color2].
  const rivals = Array.isArray(rec.rivals) ? rec.rivals : [];
  const rival = (/** @type {number} */ pid) => rivals.find((r) => r[0] === pid);
  const colors = gameColors([
    { pid: rec.local, primary: rec.color, secondary: rec.color2 },
    ...rivals.map((r) => ({ pid: r[0], primary: r[5], secondary: r[8] }))
  ]);
  return {
    local: rec.local,
    civName: (pid, age) => {
      if (pid === rec.local) {
        const span = spanFor(rec.civs, age);
        return span ? typeName(span.name, span.civ) : "";
      }
      const entry = rival(pid);
      if (!entry) return "";
      return entry[3] ? typeName(entry[4], entry[3]) : typeName(entry[2], entry[1]);
    },
    leaderName: (pid) => {
      if (pid === rec.local) return typeName(rec.leaderName, rec.leader);
      const entry = rival(pid);
      return typeName(entry?.[2] || "", entry?.[1] || "");
    },
    known: () => true,
    color: (pid) => colors.get(pid) || "",
    civType: (pid, age) => (pid === rec.local ? spanFor(rec.civs, age)?.civ || "" : rival(pid)?.[3] || "")
  };
}

/**
 * @param {Cast} cast
 * @param {number|undefined} pid
 * @param {string} age
 */
function party(cast, pid, age) {
  const name = pid != null && pid >= 0 ? cast.civName(pid, age) : "";
  return name || t("LOC_DEMOGRAPHICS_HIST_INDEPENDENT_PEOPLE");
}

const TEMPLATES = /** @type {Record<HistoryEventKind, string>} */ ({
  found: "LOC_DEMOGRAPHICS_HIST_EV_FOUND",
  capture: "LOC_DEMOGRAPHICS_HIST_EV_CAPTURE",
  razed: "LOC_DEMOGRAPHICS_HIST_EV_RAZED",
  wonder: "LOC_DEMOGRAPHICS_HIST_EV_WONDER",
  war: "LOC_DEMOGRAPHICS_HIST_EV_WAR",
  peace: "LOC_DEMOGRAPHICS_HIST_EV_PEACE",
  religion: "LOC_DEMOGRAPHICS_HIST_EV_RELIGION",
  triumph: "LOC_DEMOGRAPHICS_HIST_EV_TRIUMPH",
  elim: "LOC_DEMOGRAPHICS_HIST_EV_ELIM",
  age: "LOC_DEMOGRAPHICS_HIST_EV_AGE",
  civ: "LOC_DEMOGRAPHICS_HIST_EV_CIV",
  met: "LOC_DEMOGRAPHICS_HIST_EV_MET",
  victory: "LOC_DEMOGRAPHICS_HIST_EV_VICTORY",
  crisis: "LOC_DEMOGRAPHICS_HIST_EV_CRISIS",
  disaster: "LOC_DEMOGRAPHICS_HIST_EV_DISASTER",
  rising: "LOC_DEMOGRAPHICS_HIST_EV_RISING",
  risingEnd: "LOC_DEMOGRAPHICS_HIST_EV_RISING_END"
});

/**
 * Template arguments for an event, in {1_..}{2_..}{3_..} order.
 * @param {HistoryEvent} event
 * @param {Cast} cast
 * @param {string} age Age type of the event.
 * @returns {string[]}
 */
export function eventArgs(event, cast, age) {
  return isRisingEvent(event) ? risingArgs(event, cast, age) : standardArgs(event, cast, age);
}

/**
 * @param {HistoryEvent} event
 * @param {Cast} cast
 * @param {string} age
 * @returns {string[]}
 */
function standardArgs(event, cast, age) {
  const actor = party(cast, event.p, age);
  const other = party(cast, event.q, age);
  const name = t(event.n || "");
  const typed = typeName(event.n || "", event.x || "");
  /** @type {Record<string, string[]>} */
  const byKind = {
    capture: [actor, name, other],
    razed: [name, other],
    war: [actor, other],
    peace: [actor, other],
    age: [typed],
    civ: [cast.leaderName(event.p), typed],
    met: [actor],
    victory: [actor, victoryName(event.x || "", event.n || "")],
    wonder: [actor, typed],
    triumph: [actor, typed],
    crisis: [name || t("LOC_DEMOGRAPHICS_HIST_CRISIS_UNNAMED"), String(event.q ?? "")],
    disaster: [name || t("LOC_DEMOGRAPHICS_HIST_DISASTER_UNNAMED"), actor]
  };
  return byKind[event.k] || [actor, name];
}

/**
 * The sentence for an event.
 * @param {HistoryEvent} event
 * @param {Cast} cast
 * @param {string} age Age type of the event.
 * @returns {string}
 */
export function eventText(event, cast, age) {
  return t(TEMPLATES[event.k] || "LOC_DEMOGRAPHICS_HIST_EV_GENERIC", ...eventArgs(event, cast, age));
}

/**
 * Whether the local player may see an event (no spoilers about civilizations not yet met).
 * @param {HistoryEvent} event
 * @param {Cast} cast
 * @returns {boolean}
 */
export function eventVisible(event, cast) {
  if (event.k === "age" || event.k === "victory" || event.k === "crisis") return true;
  const ok = (/** @type {number|undefined} */ pid) => pid == null || pid < 0 || cast.known(pid);
  // A rising shows with its owner; its other civ is left unnamed while unmet (history-risings-narrate.js).
  if (isRisingEvent(event)) return ok(event.p);
  return ok(event.p) && ok(event.q);
}

/**
 * @typedef {Object} AgeSummary
 * @property {string} age Age type.
 * @property {number} founded Settlements the local player founded.
 * @property {number} captured Settlements the local player captured.
 * @property {number} lost Settlements the local player lost (captured from or razed).
 * @property {string[]} wonders Wonder names completed by the local player.
 * @property {number} triumphs Triumphs earned.
 * @property {number} wars Wars the local player fought.
 * @property {string} religion Religion founded, or "".
 * @property {string[]} fallen Civilizations eliminated during the age.
 */

/**
 * Summarize the local player's age from its events.
 * @param {HistoryEvent[]} events Events of one age.
 * @param {Cast} cast
 * @param {string} age
 * @returns {AgeSummary}
 */
export function summarizeAge(events, cast, age) {
  const me = cast.local;
  const mine = (/** @type {HistoryEventKind} */ k) => events.filter((e) => e.k === k && e.p === me);
  return {
    age,
    founded: mine("found").length,
    captured: mine("capture").length,
    lost: events.filter((e) => (e.k === "capture" || e.k === "razed") && e.q === me).length,
    wonders: mine("wonder").map((e) => typeName(e.n || "", e.x || "")),
    triumphs: mine("triumph").length,
    wars: events.filter((e) => e.k === "war" && (e.p === me || e.q === me)).length,
    religion: t(mine("religion")[0]?.n || ""),
    fallen: events.filter((e) => e.k === "elim" && cast.known(e.p)).map((e) => party(cast, e.p, age))
  };
}
