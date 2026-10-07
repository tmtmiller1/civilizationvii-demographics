// player-label.js
//
// The Civ/Leader name order shown across every view. Consumers call
// orderedNames() to get [primary, secondary] and keep their own layout; the
// toggle only changes which name leads.

/** @typedef {"civLeader"|"leaderCiv"} NameOrder */

/** @type {NameOrder} */
let _nameOrder = "civLeader";

/**
 * Ignores invalid values.
 * @param {string} order "civLeader" or "leaderCiv".
 */
export function setNameOrder(order) {
  if (order === "civLeader" || order === "leaderCiv") _nameOrder = order;
}

/**
 * @returns {NameOrder}
 */
export function getNameOrder() {
  return _nameOrder;
}

/**
 * Resolve a player's names into [primary, secondary] per the active order.
 * A city-state (no civName) or a civ with only one resolved name returns
 * [thatName, ""].
 * @param {string} [leaderName]
 * @param {string} [civName]
 * @returns {[string, string]} [primary, secondary].
 */
export function orderedNames(leaderName, civName) {
  const leader = leaderName || "";
  const civ = civName || "";
  if (!civ) return [leader, ""];
  if (!leader) return [civ, ""];
  return _nameOrder === "leaderCiv" ? [leader, civ] : [civ, leader];
}

/**
 * An inline "Primary (Secondary)" label (just "Primary" when there is no
 * secondary), the one-line form used by legends and dropdowns.
 * @param {string} [leaderName]
 * @param {string} [civName]
 * @returns {string}
 */
export function inlineLabel(leaderName, civName) {
  const [primary, secondary] = orderedNames(leaderName, civName);
  return secondary ? primary + " (" + secondary + ")" : primary;
}
