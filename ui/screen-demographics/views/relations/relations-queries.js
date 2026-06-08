// relations-queries.js
//
// Engine query helpers for the Global Relations view.

import { safeCall } from "/demographics/ui/screen-demographics/views/relations/relations-shared.js";

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
 * @param {number} id Candidate player id.
 * @param {number} localPid Local player id.
 * @param {*} humanDiplo Local player's diplomacy handle.
 * @returns {boolean} True when `id` is local or a met major.
 */
export function isMetMajor(id, localPid, humanDiplo) {
  const player = Players.get(id);
  if (!player) return false;
  if (typeof player.isMajor === "boolean" && !player.isMajor) return false;
  if (id === localPid) return true;
  if (humanDiplo && typeof humanDiplo.hasMet === "function") {
    return !!humanDiplo.hasMet(id);
  }
  return true;
}

/**
 * Append id to output when it qualifies as a met major.
 * @param {number[]} out Output pid list.
 * @param {number} id Candidate player id.
 * @param {number} localPid Local player id.
 * @param {*} humanDiplo Local diplomacy handle.
 */
function pushIfMetMajor(out, id, localPid, humanDiplo) {
  try {
    if (isMetMajor(id, localPid, humanDiplo)) out.push(id);
  } catch (_) {
    // One broken id lookup should not abort the full scan.
  }
}

/**
 * Return the set of met major-player ids (including the local player).
 * @param {number} localPid Local player id.
 * @returns {number[]} Met major ids.
 */
export function getMetMajorIds(localPid) {
  return safeCall(
    "getMetMajorIds",
    () => {
      if (typeof Players === "undefined") return [];
      const aliveFn = Players.getAliveIds || Players.getAliveMajorIds;
      if (typeof aliveFn !== "function") return [];
      const all = aliveFn.call(Players);
      if (!Array.isArray(all)) return [];
      const human = typeof Players.get === "function" ? Players.get(localPid) : null;
      const humanDiplo = human?.Diplomacy;
      /** @type {number[]} */
      const out = [];
      for (const id of all) {
        pushIfMetMajor(out, id, localPid, humanDiplo);
      }
      return out;
    },
    []
  );
}

/**
 * Collect alive player ids via `getAliveIds()` when available.
 * @returns {number[]} Alive ids.
 */
function collectAliveIdsPrimary() {
  /** @type {number[]} */
  let ids = [];
  try {
    if (typeof Players.getAliveIds === "function") {
      const arr = Players.getAliveIds();
      if (Array.isArray(arr)) ids = arr.slice();
    }
  } catch (_) {
    // Engine boundary can throw; caller will use fallback surface.
  }
  return ids;
}

/**
 * Collect alive player ids via `getAlive()` iterator fallback.
 * @returns {number[]} Alive ids.
 */
function collectAliveIdsFallback() {
  /** @type {number[]} */
  const ids = [];
  try {
    const arr = typeof Players.getAlive === "function" ? Players.getAlive() : null;
    if (Array.isArray(arr)) {
      for (const player of arr) {
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
 * @returns {number[]} City-state ids.
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
 * @param {*} viewerPid Viewer player id.
 * @param {*} otherPid Other player id.
 * @returns {boolean|undefined} Met state, or undefined when unavailable.
 */
export function viewerHasMet(viewerPid, otherPid) {
  if (typeof viewerPid !== "number" || typeof otherPid !== "number") return undefined;
  if (viewerPid === otherPid) return true;
  return safeCall(
    "viewerHasMet(" + viewerPid + "->" + otherPid + ")",
    () => {
      const viewer = typeof Players?.get === "function" ? Players.get(viewerPid) : null;
      const diplo = viewer?.Diplomacy;
      if (!diplo || typeof diplo.hasMet !== "function") return undefined;
      return !!diplo.hasMet(otherPid);
    },
    undefined
  );
}

/**
 * Read the snapshot-recorded `met` field for `pid` from the latest sample.
 * @param {DemoHistory|undefined} history Persisted history blob.
 * @param {string|number} pid Player id to look up.
 * @returns {boolean|undefined} Snapshot met state.
 */
function latestSampleMet(history, pid) {
  const samples = history?.samples || [];
  for (let i = samples.length - 1; i >= 0; i--) {
    const ps = samples[i]?.players?.[pid];
    if (ps && typeof ps.met === "boolean") return ps.met;
  }
  return undefined;
}

/**
 * Resolve whether `viewerPid` has met `pid`, with snapshot fallback.
 * @param {number} viewerPid Viewer player id.
 * @param {number} pid Other player id.
 * @param {number|undefined} localId Local player id.
 * @param {DemoHistory|undefined} history Persisted history blob.
 * @returns {boolean|undefined} Met state.
 */
export function resolveMet(viewerPid, pid, localId, history) {
  let met = viewerHasMet(viewerPid, pid);
  if (met === undefined && viewerPid === localId) {
    const snap = latestSampleMet(history, pid);
    if (typeof snap === "boolean") met = snap;
  }
  return met;
}

/**
 * Read current game turn defensively.
 * @returns {number|undefined} Current turn.
 */
export function readGameTurn() {
  return safeCall("relations.Game.turn", () => {
    if (typeof Game !== "undefined" && typeof Game.turn === "number") return Game.turn;
    return undefined;
  });
}
