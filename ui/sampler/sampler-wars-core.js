// sampler-wars-core.js
//
// Core war reconciliation and orchestration.

import DemographicsStorage from "/demographics/ui/storage/demographics-storage.js";
import { safeCall } from "/demographics/ui/sampler/demographics-sampler.js";
import {
  augmentWarsWithAllies,
  augmentWarsWithCityStates,
  migrateWarRecords,
  pidInfo
} from "/demographics/ui/sampler/sampler-wars-augment.js";
import {
  closeEndedWars,
  collectActiveWars
} from "/demographics/ui/sampler/sampler-wars-detect.js";

/**
 * @typedef {import("/demographics/ui/sampler/sampler-wars.js").WarHistory} WarHistory
 * @typedef {import("/demographics/ui/sampler/sampler-wars.js").WarRecord} WarRecord
 * @typedef {import("/demographics/ui/sampler/sampler-wars.js").WarRosterEntry} WarRosterEntry
 * @typedef {import("/demographics/ui/sampler/sampler-wars.js").WarParticipant} WarParticipant
 * @typedef {import("/demographics/ui/sampler/sampler-wars.js").ActiveWar} ActiveWar
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
 * Merge the current live roster for one war side into cumulative participation.
 * @param {WarParticipant[]} list The cumulative side roster (mutated in place).
 * @param {WarRosterEntry[]} live The current live roster entries for this side.
 * @param {number} turn The current (age-local) turn.
 * @returns {WarParticipant[]} The same list, updated.
 */
function mergeWarParticipants(list, live, turn) {
  const livePids = new Set(live.map((r) => r.pid));
  for (const r of live) {
    const e = list.find((x) => x.pid === r.pid);
    if (e) {
      e.civ = r.civ;
      e.leader = r.leader;
      e.color = r.color;
      e.civTypeString = r.civTypeString;
      e.isCS = r.isCS;
      e.active = true;
      delete e.leaveTurn;
    } else {
      list.push({
        pid: r.pid,
        civ: r.civ,
        leader: r.leader,
        color: r.color,
        civTypeString: r.civTypeString,
        isCS: r.isCS,
        joinTurn: turn,
        active: true
      });
    }
  }
  for (const e of list) {
    if (!livePids.has(e.pid) && e.active) {
      e.active = false;
      e.leaveTurn = turn;
    }
  }
  return list;
}

/**
 * Update an existing history war record from freshly-enumerated war info.
 * @param {WarRecord} existing The history war record (mutated in place).
 * @param {ActiveWar} info The normalized active-war info.
 * @param {{ a: WarRosterEntry[], b: WarRosterEntry[] }} rosters Side A/B live rosters.
 * @param {*} uid The war uniqueID (for logging).
 * @param {number} turn The current (age-local) turn.
 */
function updateExistingWar(existing, info, rosters, uid, turn) {
  const { a: aRoster, b: bRoster } = rosters;
  if (!Array.isArray(existing.sideACivs)) existing.sideACivs = [];
  if (!Array.isArray(existing.sideBCivs)) existing.sideBCivs = [];
  const aCivs = /** @type {WarParticipant[]} */ (existing.sideACivs);
  const bCivs = /** @type {WarParticipant[]} */ (existing.sideBCivs);
  mergeWarParticipants(aCivs, aRoster, turn);
  mergeWarParticipants(bCivs, bRoster, turn);
  existing.sideA = /** @type {number[]} */ (aCivs.map((e) => /** @type {number} */ (e.pid)));
  existing.sideB = /** @type {number[]} */ (bCivs.map((e) => /** @type {number} */ (e.pid)));
  existing.participants = existing.sideA.concat(existing.sideB);
  if (typeof existing.endTurn === "number") {
    existing.endTurn = null;
    existing.endYear = null;
    ilog("WAR REOPENED:", existing.name, "uid=", uid);
  }
}

/**
 * Build-new-war inputs grouped to keep call sites compact.
 * @typedef {Object} BuildNewWarArgs
 * @property {WarRecord[]} wars Existing war history list.
 * @property {ActiveWar} info Normalized active-war info.
 * @property {WarRosterEntry[]} aRoster Side A roster entries.
 * @property {WarRosterEntry[]} bRoster Side B roster entries.
 * @property {Snapshot} snapshot Current snapshot.
 * @property {string | undefined} gameYear Current game-year label.
 * @property {number} turn Current turn fallback.
 */

/**
 * Construct a brand-new history war record.
 * @param {BuildNewWarArgs} args New-war inputs.
 * @returns {WarRecord} The new war record.
 */
function buildNewWar(args) {
  const { wars, info, aRoster, bRoster, snapshot, gameYear, turn } = args;
  const aName =
    aRoster
      .map((r) => r.civ)
      .sort()
      .join(" & ") || "Side A";
  const bName =
    bRoster
      .map((r) => r.civ)
      .sort()
      .join(" & ") || "Side B";
  const sortedNames = [aName, bName].sort();
  const priorCount = wars.filter(
    (w) => [w._nameKeyA || "", w._nameKeyB || ""].sort().join("|") ===
      sortedNames.join("|")
  ).length;
  const ordinal = ordinalSuffix(priorCount + 1);
  const name = ordinal + " " + sortedNames[0] + " vs " + sortedNames[1] + " War";
  const declarer = pidInfo(snapshot, /** @type {number} */ (info.initialPid));
  const startTurn =
    typeof info.headerStartTurn === "number" ? info.headerStartTurn : turn;
  const sideACivs = aRoster.map((r) => ({ ...r, joinTurn: startTurn, active: true }));
  const sideBCivs = bRoster.map((r) => ({ ...r, joinTurn: startTurn, active: true }));
  return {
    warUniqueID: /** @type {number} */ (info.uniqueID),
    startTurn,
    endTurn: null,
    startYear: gameYear,
    endYear: null,
    sideA: info.sideA.slice(),
    sideB: info.sideB.slice(),
    participants: info.sideA.concat(info.sideB),
    sideACivs,
    sideBCivs,
    declaredBy: declarer
      ? {
          pid: declarer.pid,
          civ: declarer.civ,
          leader: declarer.leader
        }
      : null,
    _nameKeyA: sortedNames[0],
    _nameKeyB: sortedNames[1],
    name
  };
}

/**
 * Reconcile the active war set against history.wars keyed by uniqueID.
 * @param {WarRecord[]} wars The history.wars array (mutated in place).
 * @param {Map<*, ActiveWar>} activeWarsByID Active wars keyed by uniqueID.
 * @param {Snapshot} snapshot The current snapshot.
 * @param {string | undefined} gameYear The current game-year label.
 * @param {number} turn The current turn.
 */
function reconcileWars(wars, activeWarsByID, snapshot, gameYear, turn) {
  const knownByID = new Map();
  for (const w of wars) {
    if (typeof w.warUniqueID === "number") knownByID.set(w.warUniqueID, w);
  }
  for (const [uid, info] of activeWarsByID) {
    const existing = knownByID.get(uid);
    const aRoster = info.sideA.map((p) => pidInfo(snapshot, p));
    const bRoster = info.sideB.map((p) => pidInfo(snapshot, p));
    if (existing) {
      updateExistingWar(existing, info, { a: aRoster, b: bRoster }, uid, turn);
      continue;
    }
    const newWar = buildNewWar({
      wars,
      info,
      aRoster,
      bRoster,
      snapshot,
      gameYear,
      turn
    });
    wars.push(newWar);
    ilog(
      "WAR STARTED:",
      newWar.name,
      "uid=",
      uid,
      "declarer=pid" +
        info.initialPid +
        " (" +
        (pidInfo(snapshot, /** @type {number} */ (info.initialPid))?.civ || "?") +
        ")",
      "sideA=",
      info.sideA.join(","),
      "sideB=",
      info.sideB.join(",")
    );
  }
}

/**
 * Read the current turn's date label via Game.getTurnDate.
 * @returns {string | undefined} The date label, or undefined.
 */
function readTurnDate() {
  try {
    if (typeof Game !== "undefined" && typeof Game.getTurnDate === "function") {
      const s = Game.getTurnDate();
      if (typeof s === "string" && s.length > 0) return s;
    }
  } catch (_) {
    // Game.getTurnDate() can throw before the game clock is ready.
  }
  return undefined;
}

/**
 * Format an ordinal suffix for a positive integer.
 * @param {number} n The number.
 * @returns {string} e.g. "1st", "2nd", "3rd", "4th".
 */
function ordinalSuffix(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * Resolve the history blob the war tracker mutates: the caller-threaded one (the
 * per-turn path), else the in-memory mirror, else a fresh load. Ensures
 * `h.wars` is an array.
 * @param {WarHistory|null} history Caller-threaded history, if any.
 * @returns {WarHistory} The history to reconcile against.
 */
function resolveWarHistory(history) {
  const h = /** @type {WarHistory} */ (
    history || DemographicsStorage.peek() || DemographicsStorage.load()
  );
  if (!Array.isArray(h.wars)) h.wars = [];
  return h;
}

/**
 * Build connected components of currently-at-war pairs and reconcile against
 * open wars in history.wars.
 *
 * When the caller threads in the freshly-appended `history` (the per-turn sample
 * path), war records are mutated in place and the caller commits a single save
 * for the turn. Called without `history` (standalone), it reuses the in-memory
 * mirror (or loads) and saves itself.
 * @param {Snapshot} snapshot The just-recorded snapshot.
 * @param {number} turn The current turn.
 * @param {WarHistory} [history] The in-progress history to mutate in place.
 */
export function runWarTracker(snapshot, turn, history) {
  safeCall("warTracker", () => {
    const caller = history || null;
    const h = resolveWarHistory(caller);
    const wars = h.wars || [];
    migrateWarRecords(snapshot, wars);
    const gameYear = readTurnDate();
    const allPlayers = typeof Players?.getAlive === "function" ? Players.getAlive() : null;
    if (!Array.isArray(allPlayers)) return;

    const activeWarsByID = collectActiveWars(allPlayers);
    if (activeWarsByID === null) return;
    augmentWarsWithAllies(activeWarsByID, allPlayers);
    augmentWarsWithCityStates(activeWarsByID, allPlayers);

    reconcileWars(wars, activeWarsByID, snapshot, gameYear, turn);
    closeEndedWars(wars, activeWarsByID, gameYear, turn);
    // Threaded path: the caller owns the single per-turn save. Standalone: persist now.
    if (!caller) DemographicsStorage.save(h);
  });
}
