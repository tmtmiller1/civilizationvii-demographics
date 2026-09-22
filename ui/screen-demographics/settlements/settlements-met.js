// settlements-met.js
//
// Whether the local player has met a settlement's owner. Shared by the live
// board (settlements-data.js) and the end-of-age archive, which re-reads it at
// render so a civ met after an age ended is no longer masked.

/**
 * Resolve local player id from GameContext.
 * @returns {number|undefined} Local player id.
 */
function localPlayerId() {
  if (typeof GameContext === "undefined") return undefined;
  return GameContext.localPlayerID;
}

/**
 * Resolve local player's diplomacy handle.
 * @param {number} localId Local player id.
 * @returns {*|null} Diplomacy handle.
 */
function localDiplomacy(localId) {
  if (typeof Players === "undefined" || !Players.get) return null;
  return Players.get(localId)?.Diplomacy || null;
}

/**
 * Whether the LOCAL player has met `pid` (the local player is always met).
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
    const d = localDiplomacy(localId);
    if (d && typeof d.hasMet === "function") return !!d.hasMet(pid);
  } catch (_) {
    // GameContext.localPlayerID / Players.get / Diplomacy.hasMet can throw mid age-transition.
  }
  return undefined;
}
