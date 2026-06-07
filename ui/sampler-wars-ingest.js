// sampler-wars-ingest.js
//
// Ingestion and normalization for active DECLARE_WAR events.

/**
 * The normalized active-war info derived from a DECLARE_WAR event header.
 * @typedef {object} ActiveWar
 * @property {*} uniqueID The engine uniqueID.
 * @property {number | null} initialPid The declarer pid.
 * @property {number | null} targetPid The target pid.
 * @property {number[]} sideA Side A roster (pids).
 * @property {number[]} sideB Side B roster (pids).
 * @property {number | null} headerStartTurn Age-local declaration turn.
 */

/**
 * Coerce a heterogeneous list of player references (numbers or objects with
 * id/playerID/player) to a clean array of non-negative numeric pids.
 * @param {*} arr The raw list.
 * @returns {number[]} The extracted pids.
 */
function asPidList(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => {
      if (typeof x === "number") return x;
      if (x && typeof x === "object") {
        if (typeof x.id === "number") return x.id;
        if (typeof x.playerID === "number") return x.playerID;
        if (typeof x.player === "number") return x.player;
      }
      return null;
    })
    .filter((v) => typeof v === "number" && v >= 0);
}

/**
 * Read one DECLARE_WAR event header into a normalized war record and store it
 * (de-duped on uniqueID) in activeWarsByID. SideA = initiator + supporters;
 * SideB = target + opposers, with cross-membership stripped.
 * @param {*} ev A diplomacy event from getPlayerEvents.
 * @param {Map<*, ActiveWar>} activeWarsByID Accumulator keyed by uniqueID.
 */
export function ingestWarEvent(ev, activeWarsByID) {
  if (!ev || ev.actionTypeName !== "DIPLOMACY_ACTION_DECLARE_WAR") return;
  const uid = ev.uniqueID;
  if (uid == null || activeWarsByID.has(uid)) return;
  let header;
  try {
    header = Game.Diplomacy.getDiplomaticEventData(uid);
  } catch (_) {
    // Game.Diplomacy.getDiplomaticEventData() can throw for a stale uniqueID;
    // skip this war event.
  }
  if (!header) return;
  activeWarsByID.set(uid, normalizeWarRecord(uid, header));
}

/**
 * Build the normalized active-war record from a uniqueID + event header. SideA
 * = initiator + supporters; SideB = target + opposers, with cross-membership
 * stripped to keep the bipartite split clean.
 * @param {*} uid The war uniqueID.
 * @param {*} header The diplomacy event header.
 * @returns {ActiveWar} The normalized war record.
 */
function normalizeWarRecord(uid, header) {
  const { supporters, opposers } = warEnvoyLists(uid);
  const initialPid = typeof header.initialPlayer === "number" ? header.initialPlayer : null;
  const targetPid = typeof header.targetPlayer === "number" ? header.targetPlayer : null;
  const sideASet = buildWarSide(initialPid, supporters);
  const sideBSet = buildWarSide(targetPid, opposers);
  // Engine sometimes returns the initiator listed in supporters and vice
  // versa - strip cross-membership.
  for (const id of sideASet) sideBSet.delete(id);
  return {
    uniqueID: uid,
    initialPid,
    targetPid,
    sideA: Array.from(sideASet),
    sideB: Array.from(sideBSet),
    headerStartTurn: header.startTurn ?? header.turn ?? null
  };
}

/**
 * Fetch a war's supporting + opposing players (with bonus envoys) defensively.
 * @param {*} uid The war uniqueID.
 * @returns {{ supporters: *[], opposers: *[] }} The raw lists (empty on error).
 */
function warEnvoyLists(uid) {
  let supporters = [];
  let opposers = [];
  try {
    supporters = Game.Diplomacy.getSupportingPlayersWithBonusEnvoys(uid) || [];
  } catch (_) {
    // Game.Diplomacy.getSupportingPlayersWithBonusEnvoys() can throw for a stale
    // uniqueID; treat the supporting side as empty.
  }
  try {
    opposers = Game.Diplomacy.getOpposingPlayersWithBonusEnvoys(uid) || [];
  } catch (_) {
    // Game.Diplomacy.getOpposingPlayersWithBonusEnvoys() can throw for a stale
    // uniqueID; treat the opposing side as empty.
  }
  return { supporters, opposers };
}

/**
 * Build one war-side participant Set from a seed pid + a raw participant list.
 * @param {number | null} seedPid The initiator/target pid (or null).
 * @param {*[]} participants The raw supporting/opposing list.
 * @returns {Set<number>} The participant set.
 */
function buildWarSide(seedPid, participants) {
  const set = new Set();
  if (seedPid !== null) set.add(seedPid);
  for (const id of asPidList(participants)) set.add(id);
  return set;
}
