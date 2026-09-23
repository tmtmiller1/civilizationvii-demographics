// history-narrate.js
//
// Turns chronicle events into sentences in the player's language, and summarizes an age. The same
// templates serve the live campaign and archived games through a Cast: a small lookup from player
// id to the civilization name to use at a given age.

import { t, typeName, victoryName } from "/demographics/ui/history/core/history-text.js";
import { gameColors } from "/demographics/ui/history/views/history-colors.js";

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
 * @param {HnrCivSpan[]} civs Spans.
 * @param {string} age Age type.
 * @returns {HnrCivSpan|null} The span.
 */
export function spanFor(civs, age) {
  if (!civs || civs.length === 0) return null;
  return civs.find((c) => c.age === age) || civs[civs.length - 1];
}

/**
 * A cast built from a live campaign. Who counts as `known` follows the Demographics analytics
 * policy: "full" shows everyone, "own" only the local player, and "met" (the default) the local
 * player plus every civilization met so far.
 * @param {CampaignDoc} doc The campaign.
 * @param {"full"|"met"|"own"} [visibility] Visibility mode.
 * @returns {Cast} The cast.
 */
export function castFromDoc(doc, visibility = "met") {
  const pids = Object.keys(doc.players)
    .map(Number)
    .sort((a, b) => Number(b === doc.local) - Number(a === doc.local) || a - b);
  const colors = gameColors(pids.map((pid) => {
    const p = doc.players[String(pid)];
    return { pid, primary: p.color, secondary: p.color2 };
  }));
  const met = (/** @type {number} */ pid) =>
    pid === doc.local ||
    visibility === "full" ||
    (visibility === "met" && !!doc.last?.players?.[String(pid)]?.met);
  return {
    local: doc.local,
    civName: (pid, age) => {
      const p = doc.players[String(pid)];
      const s = spanFor(p?.civs || [], age);
      if (s) return typeName(s.name, s.civ);
      return p ? typeName(p.leaderName, p.leader) : "";
    },
    leaderName: (pid) => {
      const p = doc.players[String(pid)];
      return p ? typeName(p.leaderName, p.leader) : "";
    },
    known: met,
    color: (pid) => colors.get(pid) || "",
    civType: (pid, age) => spanFor(doc.players[String(pid)]?.civs || [], age)?.civ || ""
  };
}

/**
 * A cast built from an archived record (rivals keep their final civilization only).
 * @param {ArchiveRecord} rec The record.
 * @returns {Cast} The cast.
 */
export function castFromRecord(rec) {
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
        const s = spanFor(rec.civs, age);
        return s ? typeName(s.name, s.civ) : "";
      }
      const r = rival(pid);
      if (!r) return "";
      return r[3] ? typeName(r[4], r[3]) : typeName(r[2], r[1]);
    },
    leaderName: (pid) => (pid === rec.local ? typeName(rec.leaderName, rec.leader) : typeName(rival(pid)?.[2] || "", rival(pid)?.[1] || "")),
    known: () => true,
    color: (pid) => colors.get(pid) || "",
    civType: (pid, age) => (pid === rec.local ? spanFor(rec.civs, age)?.civ || "" : rival(pid)?.[3] || "")
  };
}

/**
 * Name of a party to an event, or the "independent people" fallback.
 * @param {Cast} cast Cast.
 * @param {number|undefined} pid Player id.
 * @param {string} age Age type.
 * @returns {string} Localized name.
 */
function party(cast, pid, age) {
  const n = pid != null && pid >= 0 ? cast.civName(pid, age) : "";
  return n || t("LOC_DEMOGRAPHICS_HIST_INDEPENDENT_PEOPLE");
}

/** Sentence template per event kind. */
const TEMPLATES = /** @type {Record<HnrEventKind, string>} */ ({
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
  disaster: "LOC_DEMOGRAPHICS_HIST_EV_DISASTER"
});

/**
 * Template arguments for an event, in {1_..}{2_..}{3_..} order.
 * @param {HnrEvent} e Event.
 * @param {Cast} cast Cast.
 * @param {string} age Age type of the event.
 * @returns {string[]} Arguments.
 */
export function eventArgs(e, cast, age) {
  const P = party(cast, e.p, age);
  const Q = party(cast, e.q, age);
  const N = t(e.n || "");
  const typed = typeName(e.n || "", e.x || "");
  /** @type {Record<string, string[]>} */
  const byKind = {
    capture: [P, N, Q],
    razed: [N, Q],
    war: [P, Q],
    peace: [P, Q],
    age: [typed],
    civ: [cast.leaderName(e.p), typed],
    met: [P],
    victory: [P, victoryName(e.x || "", e.n || "")],
    wonder: [P, typed],
    triumph: [P, typed],
    crisis: [N || t("LOC_DEMOGRAPHICS_HIST_CRISIS_UNNAMED"), String(e.q ?? "")],
    disaster: [N || t("LOC_DEMOGRAPHICS_HIST_DISASTER_UNNAMED"), P]
  };
  return byKind[e.k] || [P, N];
}

/**
 * The sentence for an event.
 * @param {HnrEvent} e Event.
 * @param {Cast} cast Cast.
 * @param {string} age Age type of the event.
 * @returns {string} Localized sentence.
 */
export function eventText(e, cast, age) {
  return t(TEMPLATES[e.k] || "LOC_DEMOGRAPHICS_HIST_EV_GENERIC", ...eventArgs(e, cast, age));
}

/**
 * Whether the local player may see an event (no spoilers about civilizations not yet met).
 * @param {HnrEvent} e Event.
 * @param {Cast} cast Cast.
 * @returns {boolean} True when visible.
 */
export function eventVisible(e, cast) {
  if (e.k === "age" || e.k === "victory" || e.k === "crisis") return true;
  const ok = (/** @type {number|undefined} */ pid) => pid == null || pid < 0 || cast.known(pid);
  return ok(e.p) && ok(e.q);
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
 * @param {HnrEvent[]} events Events of one age.
 * @param {Cast} cast Cast.
 * @param {string} age Age type.
 * @returns {AgeSummary} Summary.
 */
export function summarizeAge(events, cast, age) {
  const me = cast.local;
  const mine = (/** @type {HnrEventKind} */ k) => events.filter((e) => e.k === k && e.p === me);
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
