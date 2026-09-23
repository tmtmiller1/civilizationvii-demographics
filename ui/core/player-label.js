// player-label.js
//
// Single source of truth for the Civ/Leader name ORDER shown across every view.
// A global flag + persisted setting: consumers call orderedNames() to get
// [primary, secondary] and keep their own layout; the toggle only changes which
// name leads.

/** @typedef {"civLeader"|"leaderCiv"} NameOrder */

/** @type {NameOrder} */
let _nameOrder = "civLeader";

/**
 * Set the global Civ/Leader order (ignores invalid values).
 * @param {string} order "civLeader" or "leaderCiv".
 */
export function setNameOrder(order) {
  if (order === "civLeader" || order === "leaderCiv") _nameOrder = order;
}

/**
 * The current global Civ/Leader order.
 * @returns {NameOrder} The order.
 */
export function getNameOrder() {
  return _nameOrder;
}

/**
 * Resolve a player's names into [primary, secondary] per the active order.
 * Missing halves collapse gracefully: a city-state (no civName) or a civ with
 * only one resolved name returns [thatName, ""].
 * @param {string} [leaderName] The leader display name.
 * @param {string} [civName] The civilization display name.
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
 * Convenience: an inline "Primary (Secondary)" label (just "Primary" when there
 * is no secondary). The common one-line form used by legends and dropdowns.
 * @param {string} [leaderName] The leader display name.
 * @param {string} [civName] The civilization display name.
 * @returns {string} The formatted label.
 */
export function inlineLabel(leaderName, civName) {
  const [primary, secondary] = orderedNames(leaderName, civName);
  return secondary ? primary + " (" + secondary + ")" : primary;
}
