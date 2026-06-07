// sampler-wars-detect.js
//
// War start/end detection over live diplomacy events.

import { ingestWarEvent } from "/demographics/ui/sampler-wars-ingest.js";

/**
 * @typedef {import("/demographics/ui/sampler-wars.js").WarRecord} WarRecord
 * @typedef {import("/demographics/ui/sampler-wars.js").ActiveWar} ActiveWar
 */

// Flip to true for local debugging (committed off, matching the rest of the mod).
const DEMOGRAPHICS_DEBUG = false;
/**
 * Informational logger; no-op unless DEMOGRAPHICS_DEBUG is set.
 * @param {...*} a Values to log.
 */
function ilog(...a) {
  if (DEMOGRAPHICS_DEBUG) console.warn("[Demographics.sampler]", ...a);
}

/**
 * Enumerate every active DECLARE_WAR event via getPlayerEvents(pid) for each
 * player and de-dupe on uniqueID. Returns null if the API is unavailable.
 * Citation: core/ui/utilities/diplomacy-utilities.js,
 * base-standard/ui/diplo-ribbon/model-diplo-ribbon.js.
 * @param {*[]} allPlayers The alive players list.
 * @returns {Map<*, ActiveWar> | null} Active wars keyed by uniqueID, or null.
 */
export function collectActiveWars(allPlayers) {
  /** @type {Map<*, ActiveWar>} */
  const activeWarsByID = new Map();
  if (
    !Game?.Diplomacy ||
    typeof Game.Diplomacy.getPlayerEvents !== "function" ||
    typeof Game.Diplomacy.getDiplomaticEventData !== "function"
  ) {
    ilog("warTracker: Game.Diplomacy API unavailable, skipping turn");
    return null;
  }
  for (const p of allPlayers) {
    if (!p) continue;
    let events;
    try {
      events = Game.Diplomacy.getPlayerEvents(p.id);
    } catch (_) {
      events = null;
    }
    if (!Array.isArray(events)) continue;
    for (const ev of events) {
      ingestWarEvent(ev, activeWarsByID);
    }
  }
  return activeWarsByID;
}

/**
 * Close any open war whose uniqueID is no longer in the active set (peace,
 * elimination, etc.); migrate-close pre-API legacy records on first pass.
 * @param {WarRecord[]} wars The history.wars array (mutated in place).
 * @param {Map<*, ActiveWar>} activeWarsByID Active wars keyed by uniqueID.
 * @param {string | undefined} gameYear The current game-year label.
 * @param {number} turn The current turn.
 */
export function closeEndedWars(wars, activeWarsByID, gameYear, turn) {
  for (const w of wars) {
    if (typeof w.endTurn === "number") continue;
    if (typeof w.warUniqueID !== "number") {
      // Pre-API legacy record with no uniqueID - close it on first pass after
      // migration so it doesn't linger forever.
      w.endTurn = turn;
      w.endYear = gameYear;
      ilog("WAR ENDED (legacy migration):", w.name, "turn=", turn);
      continue;
    }
    if (!activeWarsByID.has(w.warUniqueID)) {
      w.endTurn = turn;
      w.endYear = gameYear;
      ilog("WAR ENDED:", w.name, "uid=", w.warUniqueID, "turn=", turn);
    }
  }
}
