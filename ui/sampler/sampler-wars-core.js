// sampler-wars-core.js
//
// Core war reconciliation and orchestration.

import DemographicsStorage from "/demographics/ui/storage/demographics-storage.js";
import { safeCall } from "/demographics/ui/sampler/sampler-shared.js";
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
import { runRisingsTracker } from "/demographics/ui/sampler/sampler-risings.js";
import { makeLogger } from "/demographics/ui/core/demographics-log.js";

/**
 * @typedef {import("/demographics/ui/sampler/sampler-wars.js").WarHistory} WarHistory
 * @typedef {import("/demographics/ui/sampler/sampler-wars.js").WarRecord} WarRecord
 * @typedef {import("/demographics/ui/sampler/sampler-wars.js").WarRosterEntry} WarRosterEntry
 * @typedef {import("/demographics/ui/sampler/sampler-wars.js").WarParticipant} WarParticipant
 * @typedef {import("/demographics/ui/sampler/sampler-wars.js").ActiveWar} ActiveWar
 */

const log = makeLogger("sampler");

/**
 * @param {WarParticipant[]} list The cumulative side roster (mutated in place).
 * @param {WarRosterEntry[]} live The current live roster entries for this side.
 * @param {number} turn The current (age-local) turn.
 */
function mergeWarParticipants(list, live, turn) {
  const livePids = new Set(live.map((r) => r.pid));
  for (const member of live) {
    const entry = list.find((x) => x.pid === member.pid);
    if (entry) {
      // Don't overwrite e.civ / e.civTypeString: a player's civ changes each age, and these are
      // pinned to the war's start age (re-derived in migrateWarRecords from the start sample).
      // Refreshing them from the live (current-age) roster is what mislabeled cross-age wars.
      entry.leader = member.leader;
      entry.color = member.color;
      entry.isCS = member.isCS;
      entry.active = true;
      delete entry.leaveTurn;
    } else {
      list.push({
        pid: member.pid,
        civ: member.civ,
        leader: member.leader,
        color: member.color,
        civTypeString: member.civTypeString,
        isCS: member.isCS,
        joinTurn: turn,
        active: true
      });
    }
  }
  for (const entry of list) {
    if (!livePids.has(entry.pid) && entry.active) {
      entry.active = false;
      entry.leaveTurn = turn;
    }
  }
  return list;
}

/**
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
    log.debug("WAR REOPENED:", existing.name, "uid=", uid);
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
 * @param {BuildNewWarArgs} args
 * @returns {WarRecord}
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
  // Global (cross-age) chart turn for the timeline. `startTurn` is age-local
  // (resets each age); the Gantt plots on chartTurn so ages don't overlap.
  const chartTurn = typeof snapshot?.chartTurn === "number" ? snapshot.chartTurn : startTurn;
  const sideACivs = aRoster.map((r) => ({ ...r, joinTurn: startTurn, active: true }));
  const sideBCivs = bRoster.map((r) => ({ ...r, joinTurn: startTurn, active: true }));
  return {
    warUniqueID: /** @type {number} */ (info.uniqueID),
    startTurn,
    endTurn: null,
    startChartTurn: chartTurn,
    lastChartTurn: chartTurn,
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
 * @param {WarRecord[]} wars The history.wars array (mutated in place).
 * @param {Map<*, ActiveWar>} activeWarsByID Active wars keyed by uniqueID.
 * @param {Snapshot} snapshot The current snapshot.
 * @param {string | undefined} gameYear The current game-year label.
 * @param {number} turn The current turn.
 */
function reconcileWars(wars, activeWarsByID, snapshot, gameYear, turn) {
  const knownByID = new Map();
  for (const war of wars) {
    if (typeof war.warUniqueID === "number") knownByID.set(war.warUniqueID, war);
  }
  const chartTurn = typeof snapshot?.chartTurn === "number" ? snapshot.chartTurn : turn;
  for (const [uid, info] of activeWarsByID) {
    const existing = knownByID.get(uid);
    const aRoster = info.sideA.map((p) => pidInfo(snapshot, p));
    const bRoster = info.sideB.map((p) => pidInfo(snapshot, p));
    if (existing) {
      updateExistingWar(existing, info, { a: aRoster, b: bRoster }, uid, turn);
      // Track the latest global turn the war is active so its end maps to the
      // continuous timeline when it closes.
      existing.lastChartTurn = chartTurn;
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
    log.debug(
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

function readTurnDate() {
  try {
    if (typeof Game !== "undefined" && typeof Game.getTurnDate === "function") {
      const date = Game.getTurnDate();
      if (typeof date === "string" && date.length > 0) return date;
    }
  } catch (_) {
    // Game.getTurnDate() can throw before the game clock is ready.
  }
  return undefined;
}

/**
 * Format an ordinal suffix for a positive integer.
 * @param {number} n
 * @returns {string} e.g. "1st", "2nd", "3rd", "4th".
 */
function ordinalSuffix(n) {
  const suffixes = ["th", "st", "nd", "rd"];
  const lastTwo = n % 100;
  return n + (suffixes[(lastTwo - 20) % 10] || suffixes[lastTwo] || suffixes[0]);
}

/**
 * Resolve the history blob the war tracker mutates: the caller-threaded one (the
 * per-turn path), else the in-memory mirror, else a fresh load. Afterwards
 * `h.wars` is always an array.
 * @param {WarHistory|null} history Caller-threaded history, if any.
 * @returns {WarHistory} The history to reconcile against.
 */
function resolveWarHistory(history) {
  const warHistory = /** @type {WarHistory} */ (
    history || DemographicsStorage.peek() || DemographicsStorage.load()
  );
  if (!Array.isArray(warHistory.wars)) warHistory.wars = [];
  return warHistory;
}

/**
 * Build connected components of currently-at-war pairs and reconcile against
 * open wars in history.wars. With `history` passed, war records are mutated in
 * place and the caller commits the save; without it, this loads and saves itself.
 * The threaded pass also folds in the Partisans mod's risings (sampler-risings.js).
 * @param {Snapshot} snapshot The just-recorded snapshot.
 * @param {number} turn The current turn.
 * @param {WarHistory} [history] The in-progress history to mutate in place.
 */
export function runWarTracker(snapshot, turn, history) {
  safeCall("warTracker", () => {
    const caller = history || null;
    const warHistory = resolveWarHistory(caller);
    const wars = warHistory.wars || [];
    migrateWarRecords(snapshot, wars, warHistory.samples);
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
    if (!caller) DemographicsStorage.save(warHistory);
  });
  if (history) runRisingsTracker(snapshot, turn, history);
}
