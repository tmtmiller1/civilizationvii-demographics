// settlements-met.js
//
// Whether the local player has met a settlement's owner. Shared by the live
// board (settlements-data.js) and the end-of-age archive, which re-reads it at
// render so a civ met after an age ended is no longer masked.

function localPlayerId() {
  if (typeof GameContext === "undefined") return undefined;
  return GameContext.localPlayerID;
}

/** @param {number} localId @returns {*|null} */
function localDiplomacy(localId) {
  if (typeof Players === "undefined" || !Players.get) return null;
  return Players.get(localId)?.Diplomacy || null;
}

/**
 * Whether the local player has met `pid` (the local player is always met).
 * Returns undefined when diplomacy is unreadable so callers can decline to
 * mask on uncertainty (mirrors the worldrankings-allcivs's "only mask when met === false"
 * rule).
 * @param {number} pid The owner player id.
 * @returns {boolean|undefined} Met state, or undefined when unknown.
 */
export function localHasMet(pid) {
  try {
    const localId = localPlayerId();
    if (typeof localId !== "number") return undefined;
    if (pid === localId) return true;
    const diplomacy = localDiplomacy(localId);
    if (diplomacy && typeof diplomacy.hasMet === "function") return !!diplomacy.hasMet(pid);
  } catch (_) {
    // GameContext.localPlayerID / Players.get / Diplomacy.hasMet can throw mid age-transition.
  }
  return undefined;
}
