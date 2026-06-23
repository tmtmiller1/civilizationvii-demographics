// demographics-governance.js
//
// Multiplayer analytics-visibility governance (combined design plan P0.1).
//
// The analytics screen can reveal a lot about every civ. In multiplayer the
// HOST should be able to cap how much comparative data the screen exposes to
// everyone, regardless of each client's own preference. This module resolves a
// single EFFECTIVE policy from two sources and is consulted at BOTH the
// data-access layer (chart series builders drop civs that the policy hides) and
// the render layer (the screen shows a policy banner so the constraint is
// visible to all players).
//
// Policy modes, least → most permissive:
//   disabled       - no comparative analytics; only the local player's own civ.
//   own-civ-only   - same visibility as disabled (own civ only), kept distinct
//                    so a host can express intent ("analytics off" vs "own civ").
//   met-civs-only  - the local player's own civ plus civs it has met (the legacy
//                    spoiler-guard behaviour, and the default).
//   full           - every civ, met or not.
//
// Host authority travels over GameConfiguration (Configuration.editGame()/
// getGame()), the same host-set, save- and age-persistent channel the
// Emigration mod uses; the value is the host's CEILING. Each client's local
// setting (analyticsPolicy) can only make its OWN view MORE restrictive, never
// more permissive than the host ceiling. Reads fail safe (most restrictive
// available) so a thrown engine call can never widen visibility.

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
// preference). Published here so companion mods (Emigration) can read the live value reliably, the
// Coherent UI localStorage they'd otherwise read is wiped between reads, so a direct read of our
// settings slice returns stale/empty and the companion can't see the player's choice.
const EFFECTIVE_POLICY_KEY = "DemographicsAnalyticsPolicyEffective_v1";

/**
 * A known policy id, or null when the value is unrecognized.
 * @param {*} v Candidate value.
 * @returns {string|null} The policy id, or null.
 */
function asPolicy(v) {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(POLICY_RANK, v) ? v : null;
}

/**
 * The local player's own preference, defaulting from the legacy spoiler guard:
 * `hideUnmetStats` on → met-civs-only, off → full. A stored `analyticsPolicy`
 * (set via Options) takes precedence. Fails safe to met-civs-only.
 * @returns {string} A policy id.
 */
export function localPolicy() {
  try {
    // The Spoil Guard checkbox (`hideUnmetStats`, default ON) is the single local control: ON
    // hides unmet civilizations (met-civs-only), OFF reveals all. The legacy `analyticsPolicy`
    // override was
    // dropped here — it had no UI, so a stale stored value silently disabled the checkbox (the bug
    // where toggling Spoil Guard did nothing). Defaults to met-civs-only (hide) when unset.
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
    Configuration?.editGame?.()?.setValue?.(EFFECTIVE_POLICY_KEY, effectivePolicy());
  } catch (_) {
    /* GameConfiguration unavailable → companion falls back to its own read */
  }
}

/**
 * Whether unmet civs are hidden under the effective policy (everything except
 * `full`). Drives the legacy {@link hideUnmetEnabled} seam so all existing
 * per-point / whole-civ met gating keeps working.
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
 * Whether the local player may SET the host ceiling: always in single-player
 * (you are effectively host); in multiplayer only when actually hosting.
 * Best-effort - if host status can't be resolved in MP, returns false so a
 * non-host can't appear to set a policy that won't take.
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
