// relations-queries.js
//
// Engine query helpers for the Global Relations view.

import { safeCall } from "/demographics/ui/screen-demographics/views/relations/relations-shared.js";
import { policyOwnCivOnly } from "/demographics/ui/core/demographics-governance.js";

/**
 * Resolve the local player id from `GameContext`, defensively.
 * @returns {number|undefined} Local or observer id.
 */
export function getLocalId() {
  return safeCall("getLocalId", () => {
    if (typeof GameContext !== "undefined" && GameContext) {
      const local = GameContext.localPlayerID;
      if (typeof local === "number") return local;
      const observer = GameContext.localObserverID;
      if (typeof observer === "number") return observer;
    }
    return undefined;
  });
}

/**
 * Test whether `id` should be counted as a met major from `localPid`.
 * @param {number} id
 * @param {number} localPid
 * @param {*} localDiplomacy
 * @returns {boolean} True when `id` is local or a met major.
 */
export function isMetMajor(id, localPid, localDiplomacy) {
  const player = Players.get(id);
  if (!player) return false;
  if (typeof player.isMajor === "boolean" && !player.isMajor) return false;
  if (id === localPid) return true;
  if (localDiplomacy && typeof localDiplomacy.hasMet === "function") {
    return !!localDiplomacy.hasMet(id);
  }
  return true;
}

/**
 * Append id to output when it qualifies as a met major.
 * @param {number[]} out
 * @param {number} id
 * @param {number} localPid
 * @param {*} localDiplomacy
 */
function pushIfMetMajor(out, id, localPid, localDiplomacy) {
  try {
    if (isMetMajor(id, localPid, localDiplomacy)) out.push(id);
  } catch (_) {
    // One broken id lookup should not abort the full scan.
  }
}

/**
 * Return the set of met major-player ids (including the local player).
 * @param {number} localPid
 * @returns {number[]}
 */
export function getMetMajorIds(localPid) {
  // Governance: own-civ-only / disabled restricts the relations network
  // to the local player's own civ.
  if (safeCall("ownCivOnly", () => policyOwnCivOnly(), false)) {
    return typeof localPid === "number" ? [localPid] : [];
  }
  return safeCall(
    "getMetMajorIds",
    () => {
      if (typeof Players === "undefined") return [];
      const aliveFn = Players.getAliveIds || Players.getAliveMajorIds;
      if (typeof aliveFn !== "function") return [];
      const all = aliveFn.call(Players);
      if (!Array.isArray(all)) return [];
      const human = typeof Players.get === "function" ? Players.get(localPid) : null;
      const localDiplomacy = human?.Diplomacy;
      /** @type {number[]} */
      const out = [];
      for (const id of all) {
        pushIfMetMajor(out, id, localPid, localDiplomacy);
      }
      return out;
    },
    []
  );
}

/**
 * Collect alive player ids via `getAliveIds()` when available.
 * @returns {number[]}
 */
function collectAliveIdsPrimary() {
  /** @type {number[]} */
  let ids = [];
  try {
    if (typeof Players.getAliveIds === "function") {
      const aliveIds = Players.getAliveIds();
      if (Array.isArray(aliveIds)) ids = aliveIds.slice();
    }
  } catch (_) {
    // Engine boundary can throw; caller will use fallback surface.
  }
  return ids;
}

/**
 * Collect alive player ids via `getAlive()` iterator fallback.
 * @returns {number[]}
 */
function collectAliveIdsFallback() {
  /** @type {number[]} */
  const ids = [];
  try {
    const alive = typeof Players.getAlive === "function" ? Players.getAlive() : null;
    if (Array.isArray(alive)) {
      for (const player of alive) {
        const id = typeof player === "number" ? player : player?.id;
        if (typeof id === "number") ids.push(id);
      }
    }
  } catch (_) {
    // Engine boundary can throw; keep fallback empty.
  }
  return ids;
}

/**
 * Return the set of alive city-state / minor / independent player ids.
 * @returns {number[]}
 */
export function getCityStateIds() {
  return safeCall(
    "getCityStateIds",
    () => {
      /** @type {number[]} */
      const out = [];
      if (typeof Players === "undefined") return out;
      let ids = collectAliveIdsPrimary();
      if (ids.length === 0) ids = collectAliveIdsFallback();
      for (const id of ids) {
        const player = safeCall("Players.get(" + id + ")", () => Players.get(id), null);
        if (!player) continue;
        const isMinor =
          player.isMinor === true ||
          player.isIndependent === true ||
          player.isCityState === true;
        if (isMinor) out.push(id);
      }
      return out;
    },
    []
  );
}

/**
 * Whether the viewer player has met `otherPid`.
 * @param {*} viewerPid
 * @param {*} otherPid
 * @returns {boolean|undefined} Met state, or undefined when unavailable.
 */
export function viewerHasMet(viewerPid, otherPid) {
  if (typeof viewerPid !== "number" || typeof otherPid !== "number") return undefined;
  if (viewerPid === otherPid) return true;
  return safeCall(
    "viewerHasMet(" + viewerPid + "->" + otherPid + ")",
    () => {
      const viewer = typeof Players?.get === "function" ? Players.get(viewerPid) : null;
      const diplomacy = viewer?.Diplomacy;
      if (!diplomacy || typeof diplomacy.hasMet !== "function") return undefined;
      return !!diplomacy.hasMet(otherPid);
    },
    undefined
  );
}

/**
 * Read the snapshot-recorded `met` field for `pid` from the latest sample.
 * @param {DemoHistory|undefined} history
 * @param {string|number} pid
 * @returns {boolean|undefined}
 */
function latestSampleMet(history, pid) {
  const samples = Array.isArray(history?.samples) ? history.samples : [];
  for (let i = samples.length - 1; i >= 0; i--) {
    const samplePlayer = samples[i]?.players?.[pid];
    if (samplePlayer && typeof samplePlayer.met === "boolean") return samplePlayer.met;
  }
  return undefined;
}

/**
 * Resolve whether `viewerPid` has met `pid`, with snapshot fallback.
 * @param {number} viewerPid
 * @param {number} pid
 * @param {number|undefined} localId
 * @param {DemoHistory|undefined} history
 * @returns {boolean|undefined}
 */
export function resolveMet(viewerPid, pid, localId, history) {
  let met = viewerHasMet(viewerPid, pid);
  if (met === undefined && viewerPid === localId) {
    const snapshotMet = latestSampleMet(history, pid);
    if (typeof snapshotMet === "boolean") met = snapshotMet;
  }
  return met;
}

/**
 * Read current game turn defensively.
 * @returns {number|undefined}
 */
export function readGameTurn() {
  return safeCall("relations.Game.turn", () => {
    if (typeof Game !== "undefined" && typeof Game.turn === "number") return Game.turn;
    return undefined;
  });
}
