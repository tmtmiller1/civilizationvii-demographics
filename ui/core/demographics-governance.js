// demographics-governance.js
//
// Multiplayer analytics-visibility governance: resolves one EFFECTIVE policy from
// the host ceiling (GameConfiguration) and the client's local preference, which
// can only be more restrictive. Consulted by both the data-access layer and the
// render layer; reads fail safe to the most restrictive policy available.
//
// Policy modes, least → most permissive:
//   disabled       - no comparative analytics; only the local player's own civ.
//   own-civ-only   - same visibility as disabled, kept distinct to express intent.
//   met-civs-only  - the local player's own civ plus civs it has met (the default).
//   full           - every civ, met or not.

import { DemographicsSettings } from "/demographics/ui/core/demographics-settings.js";

export const POLICY_DISABLED = "disabled";
export const POLICY_OWN = "own-civ-only";
export const POLICY_MET = "met-civs-only";
export const POLICY_FULL = "full";

// Restrictiveness rank: lower = more restrictive. effective policy = the
// most-restrictive (min rank) of the host ceiling and the local preference.
/** @type {Record<string, number>} */
const POLICY_RANK = {
  [POLICY_DISABLED]: 0,
  [POLICY_OWN]: 1,
  [POLICY_MET]: 2,
  [POLICY_FULL]: 3
};

/** Ordered list (most → least restrictive) for option lists / validation. */
export const POLICY_ORDER = [POLICY_DISABLED, POLICY_OWN, POLICY_MET, POLICY_FULL];

// GameConfiguration key holding the host ceiling. Distinct, mod-namespaced, and
// host-set; clients only read it.
const HOST_POLICY_KEY = "DemographicsAnalyticsPolicy_v1";

// GameConfiguration key holding the EFFECTIVE policy this client resolved (host ceiling ∧ local
// preference), published so companion mods can read the live value without touching our
// localStorage settings slice.
const EFFECTIVE_POLICY_KEY = "DemographicsAnalyticsPolicyEffective_v1";

/**
 * The per-player effective-policy key. GameConfiguration is one shared document in a networked
 * game, so a single key would hold whichever client opened the screen last; each seat publishes
 * under its own id and the companion reads its own seat first.
 * @param {number} pid Local player id.
 * @returns {string} The key.
 */
export function effectivePolicyKeyFor(pid) {
  return EFFECTIVE_POLICY_KEY + "_P" + pid;
}

/**
 * The local seat's player id, or -1 when it cannot be read.
 * @returns {number} Player id.
 */
function localPid() {
  try {
    if (typeof GameContext === "undefined") return -1;
    const pid = GameContext.localPlayerID;
    return typeof pid === "number" && pid >= 0 ? pid : -1;
  } catch (_) {
    // GameContext is absent off-engine.
    return -1;
  }
}

/**
 * A known policy id, or null when the value is unrecognized.
 * @param {*} v Candidate value.
 * @returns {string|null} The policy id, or null.
 */
function asPolicy(v) {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(POLICY_RANK, v) ? v : null;
}

/**
 * The local player's own preference, from the spoiler guard: `hideUnmetStats`
 * on → met-civs-only, off → full. Fails safe to met-civs-only.
 * @returns {string} A policy id.
 */
export function localPolicy() {
  try {
    // The Spoil Guard checkbox (`hideUnmetStats`, default ON) is the single local control: ON
    // hides unmet civilizations (met-civs-only), OFF reveals all.
    const hideUnmet = DemographicsSettings.getSetting("hideUnmetStats", true) !== false;
    return hideUnmet ? POLICY_MET : POLICY_FULL;
  } catch (_) {
    return POLICY_MET;
  }
}

/**
 * The host-set ceiling from GameConfiguration, or null when none is set
 * (single-player, or a host that never constrained analytics).
 * @returns {string|null} A policy id, or null.
 */
export function hostPolicy() {
  try {
    const g = typeof Configuration !== "undefined" ? Configuration.getGame?.() : null;
    const raw = g && typeof g.getValue === "function" ? g.getValue(HOST_POLICY_KEY) : null;
    return asPolicy(raw);
  } catch (_) {
    return null;
  }
}

/**
 * The effective policy: the more restrictive of the host ceiling and the local
 * preference. With no host ceiling, the local preference stands.
 * @returns {string} A policy id.
 */
export function effectivePolicy() {
  const local = localPolicy();
  const host = hostPolicy();
  if (!host) return local;
  return POLICY_RANK[host] <= POLICY_RANK[local] ? host : local;
}

/**
 * Publish the current effective policy to GameConfiguration so companion mods (Emigration) can read
 * the player's live choice reliably (the shared localStorage they'd otherwise read is wiped between
 * reads in this UI context). Idempotent; safe to call on screen open and on every policy change.
 * @returns {void}
 */
export function publishEffectivePolicy() {
  try {
    const policy = effectivePolicy();
    const edit = Configuration?.editGame?.();
    if (!edit || typeof edit.setValue !== "function") return;
    const pid = localPid();
    if (pid >= 0) edit.setValue(effectivePolicyKeyFor(pid), policy);
    // The shared single key is written only where one client owns the document: single-player
    // and hotseat (one machine), or the host of a networked game. A guest writing it would
    // replace the host's value for every companion mod reading it.
    if (!isNetworkedGame() || canSetHostPolicy()) edit.setValue(EFFECTIVE_POLICY_KEY, policy);
  } catch (_) {
    /* GameConfiguration unavailable → companion falls back to its own read */
  }
}

/**
 * Whether unmet civs are hidden under the effective policy (everything except
 * `full`). Drives the {@link hideUnmetEnabled} seam behind per-point and
 * whole-civ met gating.
 * @returns {boolean} True to hide unmet civs.
 */
export function policyHidesUnmet() {
  return effectivePolicy() !== POLICY_FULL;
}

/**
 * Whether the policy restricts the screen to the local player's OWN civ only
 * (own-civ-only or disabled).
 * @returns {boolean} True when only the local civ may be shown.
 */
export function policyOwnCivOnly() {
  const rank = POLICY_RANK[effectivePolicy()];
  return rank <= POLICY_RANK[POLICY_OWN];
}

/**
 * Resolve the local player/observer id from the engine `GameContext`.
 * @returns {number|undefined} The local id, if numeric.
 */
export function localPlayerId() {
  try {
    if (typeof GameContext !== "undefined" && GameContext != null) {
      if (typeof GameContext.localPlayerID === "number") return GameContext.localPlayerID;
      if (typeof GameContext.localObserverID === "number") return GameContext.localObserverID;
    }
  } catch (_) {
    // GameContext may be absent outside an active game.
  }
  return undefined;
}

/**
 * Whether a civ is the local player's own civ.
 * @param {string|number} pid Civ player id.
 * @returns {boolean} True when `pid` is the local player.
 */
export function isLocalCiv(pid) {
  const me = localPlayerId();
  return me !== undefined && Number(pid) === me;
}

/**
 * Whether the running game is multiplayer (best-effort; false off-engine).
 * @returns {boolean} True in a multiplayer game.
 */
export function isMultiplayer() {
  try {
    const g = typeof Configuration !== "undefined" ? Configuration.getGame?.() : null;
    if (g && typeof g.isAnyMultiplayer === "boolean") return g.isAnyMultiplayer;
    if (g && typeof g.isAnyMultiplayer === "function") return !!g.isAnyMultiplayer();
    if (typeof Network !== "undefined" && typeof Network.isConnectedToNetwork === "function") {
      return !!Network.isConnectedToNetwork();
    }
  } catch (_) {
    // Configuration / Network may be absent off-engine.
  }
  return false;
}

/**
 * Whether the local player may set the host ceiling: always in single-player,
 * in multiplayer only when hosting. Returns false when host status can't be
 * resolved, so a non-host can't appear to set a policy that won't take.
 * @returns {boolean} True when the local player can write the host policy.
 */
export function canSetHostPolicy() {
  if (!isMultiplayer()) return true;
  try {
    if (typeof Network !== "undefined" && typeof Network.isHost === "function") {
      return !!Network.isHost();
    }
    const g = typeof Configuration !== "undefined" ? Configuration.getGame?.() : null;
    if (g && typeof g.isHost === "boolean") return g.isHost;
  } catch (_) {
    // fall through
  }
  return false;
}

/**
 * Write the host ceiling to GameConfiguration (host / single-player only).
 * No-op (returns false) when the local player may not set it.
 * @param {string} mode A policy id.
 * @returns {boolean} True when the value was written.
 */
export function setHostPolicy(mode) {
  if (!asPolicy(mode) || !canSetHostPolicy()) return false;
  try {
    Configuration?.editGame?.()?.setValue?.(HOST_POLICY_KEY, mode);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Banner descriptor for the screen: whether to show it, the active policy, and
 * whether the host ceiling (not just local preference) is the binding
 * constraint. The screen localizes this into visible text.
 * @returns {{ show: boolean, policy: string, hostEnforced: boolean,
 *   multiplayer: boolean }} Banner info.
 */
export function bannerInfo() {
  const policy = effectivePolicy();
  const host = hostPolicy();
  const hostEnforced = !!host && POLICY_RANK[host] <= POLICY_RANK[localPolicy()];
  return { show: policy !== POLICY_FULL, policy, hostEnforced, multiplayer: isMultiplayer() };
}

/**
 * The networked flag from the game configuration, or null when it does not say.
 * @param {*} g The game configuration handle.
 * @returns {boolean|null} True/false when known, null when unknown.
 */
function configNetworked(g) {
  if (!g) return null;
  if (typeof g.isNetworkMultiplayer === "boolean") return g.isNetworkMultiplayer;
  if (typeof g.isNetworkMultiplayer === "function") return !!g.isNetworkMultiplayer();
  if (g.isHotseat === true) return false;
  return null;
}

/**
 * Whether this game runs over a network (internet, LAN, cloud). Hotseat is multiplayer but one
 * machine owns the configuration, so it is not networked. Watched 2026-09-22: isAnyMultiplayer is
 * true in hotseat while Network.isHost() is false, so the shared key was not written there.
 * @returns {boolean} True for a networked game.
 */
export function isNetworkedGame() {
  try {
    const known = configNetworked(typeof Configuration !== "undefined" ? Configuration.getGame?.() : null);
    if (known !== null) return known;
    if (typeof Network !== "undefined" && typeof Network.isConnectedToNetwork === "function") {
      return !!Network.isConnectedToNetwork();
    }
  } catch (_) {
    // Configuration / Network may be absent off-engine.
  }
  return false;
}
