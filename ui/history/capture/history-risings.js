// history-risings.js
//
// Chronicle events for the Partisans mod's risings: one when a rising breaks out and one when it
// ends. `doc.ris` remembers, per Partisans id, what the chronicle has already said (1 = began,
// 2 = ended), so each is told once. The first reading only notes the risings already under way,
// the same way a game joined mid-crisis doesn't announce a stage that began earlier.
//
// Event fields (see types/history.d.ts): p is the owner the people rose against, q the other civ
// (the old owner for a flip, the homeland for an enclave), n the settlement name, and x packs the
// cause with the policy card's Name tag ("enclave|LOC_...") or, on an end event, the outcome
// ("flip|burned").

import { readPartisanRisings, validateRising } from "/demographics/ui/core/demographics-risings-contract.js";
import { safe } from "/demographics/ui/history/core/history-log.js";

/** Separator inside an event's x field. */
export const RISING_X_SEP = "|";

/**
 * @param {string} type A TraditionType.
 * @returns {string} The card's Name tag, or "".
 */
function policyTag(type) {
  const name = safe(() => GameInfo.Traditions.lookup(type)?.Name, "");
  return typeof name === "string" && name.startsWith("LOC_") ? name : "";
}

/**
 * @param {import("/demographics/ui/core/demographics-risings-contract.js").RisingRow} row
 * @param {{ t: number, a: number, d: string }} at
 * @param {boolean} isEnd
 * @returns {HistoryEvent}
 */
function risingEvent(row, at, isEnd) {
  const other = typeof row.from === "number" ? row.from : row.homeland;
  const extra = isEnd ? row.outcome || "" : row.policy ? policyTag(row.policy) : "";
  /** @type {HistoryEvent} */
  const event = { t: at.t, a: at.a, k: isEnd ? "risingEnd" : "rising", p: row.owner, n: row.name, d: at.d };
  if (typeof other === "number") event.q = other;
  event.x = extra ? row.cause + RISING_X_SEP + extra : row.cause;
  return event;
}

/**
 * The chronicle events for risings that began or ended since the last reading.
 * @param {CampaignDoc} doc Mutated: `doc.ris` is updated.
 * @param {HistoryWorldState} world
 * @param {number} ageIdx
 * @param {*[]|null} [raw] Partisans' rows; read from the game when omitted. Null means Partisans
 *   isn't loaded, and nothing changes.
 * @returns {HistoryEvent[]}
 */
export function risingEvents(doc, world, ageIdx, raw = readPartisanRisings()) {
  if (!Array.isArray(raw)) return [];
  const baseline = !doc.ris || typeof doc.ris !== "object";
  const pass = {
    told: baseline ? {} : /** @type {Record<string, number>} */ (doc.ris),
    next: /** @type {Record<string, number>} */ ({}),
    events: /** @type {HistoryEvent[]} */ ([]),
    at: { t: world.turn, a: ageIdx, d: world.date },
    baseline
  };
  for (const row of raw.map(validateRising)) if (row) tellRising(row, pass);
  // Ids Partisans no longer reports are dropped; it never reuses one within a game.
  doc.ris = pass.next;
  return pass.events;
}

/**
 * @param {import("/demographics/ui/core/demographics-risings-contract.js").RisingRow} row
 * @param {{ told: Record<string, number>, next: Record<string, number>, events: HistoryEvent[],
 *   at: { t: number, a: number, d: string }, baseline: boolean }} pass Mutated.
 */
function tellRising(row, pass) {
  const key = String(row.id);
  const ended = typeof row.end === "number";
  const before = pass.told[key] || 0;
  if (!pass.baseline && before < 1) pass.events.push(risingEvent(row, pass.at, false));
  if (!pass.baseline && ended && before < 2) pass.events.push(risingEvent(row, pass.at, true));
  pass.next[key] = ended ? 2 : Math.max(1, before);
}
