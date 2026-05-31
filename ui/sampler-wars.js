// sampler-wars.js
//
// War tracker extracted from demographics-sampler.js. Builds connected
// components of currently-at-war pairs (so a coalition becomes ONE war
// record), reconciles them against the persisted history.wars[] keyed by
// uniqueID, and closes wars that have ended. Every read is hard-defensive and
// the whole pass runs under the sampler core's kill-switch-aware `safeCall`,
// imported here so the kill-switch state stays single-owner.

import { safeCall } from "/demographics/ui/demographics-sampler.js";
import DemographicsStorage from "/demographics/ui/demographics-storage.js";

/**
 * The persisted history blob as the sampler sees it: the shared {@link
 * DemoHistory} fields plus the sampler's own runtime extensions (`wars`,
 * `legacySnapshots`, the obsolete `cumulativeTurnOffset`). These extra fields
 * live on the same blob but aren't in the shared typedef, so they are declared
 * here locally as an intersection with the shared {@link DemoHistory}.
 * @typedef {DemoHistory & WarHistoryExtras} WarHistory
 */

/**
 * The sampler's runtime extension fields on the persisted history blob.
 * @typedef {object} WarHistoryExtras
 * @property {WarRecord[]} [wars] Tracked war records.
 * @property {Record<string, Record<string, object>>} [legacySnapshots] Age-end triumph snapshots, keyed by age.
 * @property {number} [cumulativeTurnOffset] Obsolete stored offset (deleted on migrate).
 */

/**
 * One persisted war record. Field shapes are the mod's own, but the record is
 * a runtime extension of the storage history (not in the shared typedef), so
 * it carries an index signature for back-compat / migration fields.
 * @typedef {object} WarRecord
 * @property {number} [warUniqueID] Stable engine uniqueID; primary key.
 * @property {Pid[]} [sideA] Side A roster (pids).
 * @property {Pid[]} [sideB] Side B roster (pids).
 * @property {Pid[]} [participants] All participant pids.
 * @property {object[]} [sideACivs] Side A roster info entries.
 * @property {object[]} [sideBCivs] Side B roster info entries.
 * @property {Pid} [aPid] Legacy scalar side-A pid (pre-array schema).
 * @property {Pid} [bPid] Legacy scalar side-B pid (pre-array schema).
 * @property {number | null} [startTurn] Global start turn.
 * @property {number | null} [endTurn] Global end turn (null while open).
 * @property {string} [startYear] In-game start year label.
 * @property {string | null} [endYear] In-game end year label.
 * @property {object | null} [declaredBy] Declarer info.
 * @property {string} [_nameKeyA] Sorted matchup key A (for ordinal naming).
 * @property {string} [_nameKeyB] Sorted matchup key B (for ordinal naming).
 * @property {string} [name] Display name.
 * @property {*} [extra] Index signature for any other fields.
 */

/**
 * A resolved war-roster entry for one participant.
 * @typedef {object} WarRosterEntry
 * @property {Pid | string} pid The participant pid.
 * @property {string} civ Display civ name.
 * @property {string} leader Display leader name.
 * @property {string} color Banner color string.
 * @property {string | undefined} civTypeString Canonical CIVILIZATION_* type.
 * @property {boolean} isCS Whether the participant is a city-state / IP.
 */

/**
 * The normalized active-war info derived from a DECLARE_WAR event header.
 * @typedef {object} ActiveWar
 * @property {*} uniqueID The engine uniqueID.
 * @property {Pid | null} initialPid The declarer pid.
 * @property {Pid | null} targetPid The target pid.
 * @property {Pid[]} sideA Side A roster (pids).
 * @property {Pid[]} sideB Side B roster (pids).
 * @property {number | null} headerStartTurn Age-local declaration turn.
 */

/**
 * Informational logger; always emits.
 * @param {...*} a Values to log.
 * @returns {void}
 */
function ilog(...a) {
  console.warn("[Demographics.sampler]", ...a);
}

// ---- war tracker ---------------------------------------------------------

/**
 * Resolve display info (civ/leader/color/type-string + isCS) for a pid, using
 * the snapshot first and falling back to live engine reads. Mirrors the trio
 * of CS checks view-relations.js uses (lines 133-135).
 * @param {Snapshot} snapshot The current snapshot (for cached player info).
 * @param {Pid | string} pid The player id.
 * @returns {WarRosterEntry} The resolved war-roster entry.
 */
function pidInfo(snapshot, pid) {
  const ps = snapshot.players?.[pid] || {};
  const live = _pidLiveInfo(pid, ps.civName);
  const civ = live.civ;
  const isCS = live.isCS || _isCSByName(civ);
  const civTypeString = ps.civTypeString || _civTypeStringFor(pid);
  return {
    pid,
    civ: civ || "Player " + pid,
    leader: ps.leaderName || "",
    color: ps.primaryColor || "#9aa8c8",
    civTypeString: civTypeString || undefined,
    isCS
  };
}

/**
 * Read the live player handle to fill in a missing civ name and the CS flag.
 * @param {Pid | string} pid The player id.
 * @param {*} cachedCiv The civ name already known from the snapshot, if any.
 * @returns {{ civ: *, isCS: boolean }} The (possibly resolved) civ + CS flag.
 */
function _pidLiveInfo(pid, cachedCiv) {
  let civ = cachedCiv;
  let isCS = false;
  try {
    const p = Players.get(Number(pid));
    if (p) {
      if (!civ && p.civilizationName) {
        civ =
          typeof Locale?.compose === "function"
            ? Locale.compose(p.civilizationName)
            : p.civilizationName;
      }
      isCS = detectCityState(p);
    }
  } catch (_) {}
  return { civ, isCS };
}

/**
 * Last-resort name-based CS detection: Independent Powers and city-state
 * encampments often surface as "Village"/"Independent" in civilizationName.
 * @param {*} civ The (possibly resolved) civ name.
 * @returns {boolean} True if the name looks like a city-state / IP.
 */
function _isCSByName(civ) {
  if (typeof civ !== "string") return false;
  const low = civ.toLowerCase();
  return (
    low === "village" ||
    low.startsWith("independent") ||
    low.startsWith("city-state") ||
    low.startsWith("cs ")
  );
}

/**
 * Resolve the CIVILIZATION_X type string for a pid via the live player handle,
 * so wars carry the canonical, DLC-safe type for adjective lookups.
 * @param {Pid | string} pid The player id.
 * @returns {string | undefined} The civilizationType string, or undefined.
 */
function _civTypeStringFor(pid) {
  try {
    const p = Players.get(Number(pid));
    const ct = p?.civilizationType;
    if (typeof ct === "string" && ct.length > 0) return ct;
  } catch (_) {
    /* */
  }
  return undefined;
}

/**
 * Determine whether a live player handle is a city-state / independent /
 * non-major civ, mirroring view-relations.js (lines 133-135).
 * @param {*} p A live player handle.
 * @returns {boolean} True if the player should be treated as a city-state.
 */
function detectCityState(p) {
  /**
   * Coerce a boolean-or-thunk player flag to a boolean (or undefined).
   * @param {*} v The flag value (boolean, function, or other).
   * @returns {boolean | undefined} The resolved flag, or undefined.
   */
  function flag(v) {
    if (typeof v === "boolean") return v;
    if (typeof v === "function") {
      try {
        return !!v.call(p);
      } catch (_) {}
    }
    return undefined;
  }
  let isCS = false;
  if (flag(p.isMinor) === true) isCS = true;
  if (flag(p.isIndependent) === true) isCS = true;
  if (flag(p.isCityState) === true) isCS = true;
  // Fallback: if explicitly NOT a major / full civ.
  if (!isCS) {
    const major = flag(p.isMajor);
    const fullCiv = flag(p.isFullCiv);
    if (major === false || fullCiv === false) isCS = true;
  }
  return isCS;
}

/**
 * Migrate legacy war records (aPid/bPid scalars) to the sideA/sideB array
 * schema and refresh rosters from current pidInfo() so the isCS flag reflects
 * the latest player state.
 * @param {Snapshot} snapshot The current snapshot (for pidInfo).
 * @param {WarRecord[]} wars The history.wars array (mutated in place).
 * @returns {void}
 */
function migrateWarRecords(snapshot, wars) {
  for (const w of wars) {
    _migrateWarRecord(w);
    // Always refresh rosters from the current pidInfo() so the isCS flag
    // reflects the latest player state — old records may have it stale.
    w.sideACivs = (w.sideA || []).map((p) => pidInfo(snapshot, p));
    w.sideBCivs = (w.sideB || []).map((p) => pidInfo(snapshot, p));
  }
}

/**
 * Migrate one legacy war record's roster fields from the old aPid/bPid scalar
 * schema to the sideA/sideB array schema (in place).
 * @param {WarRecord} w A history war record.
 * @returns {void}
 */
function _migrateWarRecord(w) {
  if (Array.isArray(w.sideA) && Array.isArray(w.sideB)) return;
  if (typeof w.aPid === "number" && typeof w.bPid === "number") {
    w.sideA = [w.aPid];
    w.sideB = [w.bPid];
    w.participants = [w.aPid, w.bPid];
  } else {
    w.sideA = w.sideA || [];
    w.sideB = w.sideB || [];
    if (typeof w.endTurn !== "number") w.endTurn = w.startTurn;
  }
}

/**
 * Coerce a heterogeneous list of player references (numbers or objects with
 * id/playerID/player) to a clean array of non-negative numeric pids.
 * @param {*} arr The raw list.
 * @returns {Pid[]} The extracted pids.
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
 * (de-duped on uniqueID) in `activeWarsByID`. SideA = initiator + supporters;
 * SideB = target + opposers, with cross-membership stripped.
 * @param {*} ev A diplomacy event from getPlayerEvents.
 * @param {Map<*, ActiveWar>} activeWarsByID Accumulator keyed by uniqueID.
 * @returns {void}
 */
function ingestWarEvent(ev, activeWarsByID) {
  if (!ev || ev.actionTypeName !== "DIPLOMACY_ACTION_DECLARE_WAR") return;
  const uid = ev.uniqueID;
  if (uid == null || activeWarsByID.has(uid)) return;
  let header;
  try {
    header = Game.Diplomacy.getDiplomaticEventData(uid);
  } catch (_) {}
  if (!header) return;
  activeWarsByID.set(uid, _normalizeWarRecord(uid, header));
}

/**
 * Build the normalized active-war record from a uniqueID + event header. SideA
 * = initiator + supporters; SideB = target + opposers, with cross-membership
 * stripped to keep the bipartite split clean.
 * @param {*} uid The war uniqueID.
 * @param {*} header The diplomacy event header.
 * @returns {ActiveWar} The normalized war record.
 */
function _normalizeWarRecord(uid, header) {
  const { supporters, opposers } = _warEnvoyLists(uid);
  const initialPid = typeof header.initialPlayer === "number" ? header.initialPlayer : null;
  const targetPid = typeof header.targetPlayer === "number" ? header.targetPlayer : null;
  const sideASet = _buildWarSide(initialPid, supporters);
  const sideBSet = _buildWarSide(targetPid, opposers);
  // Engine sometimes returns the initiator listed in supporters and vice
  // versa — strip cross-membership.
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
function _warEnvoyLists(uid) {
  let supporters = [];
  let opposers = [];
  try {
    supporters = Game.Diplomacy.getSupportingPlayersWithBonusEnvoys(uid) || [];
  } catch (_) {}
  try {
    opposers = Game.Diplomacy.getOpposingPlayersWithBonusEnvoys(uid) || [];
  } catch (_) {}
  return { supporters, opposers };
}

/**
 * Build one war-side participant Set from a seed pid + a raw participant list.
 * @param {Pid | null} seedPid The initiator/target pid (or null).
 * @param {*[]} participants The raw supporting/opposing list.
 * @returns {Set<Pid>} The participant set.
 */
function _buildWarSide(seedPid, participants) {
  const set = new Set();
  if (seedPid !== null) set.add(seedPid);
  for (const id of asPidList(participants)) set.add(id);
  return set;
}

/**
 * Enumerate every active DECLARE_WAR event via getPlayerEvents(pid) for each
 * player and de-dupe on uniqueID. Returns null if the API is unavailable.
 * Citation: core/ui/utilities/diplomacy-utilities.js:70,
 * base-standard/ui/diplo-ribbon/model-diplo-ribbon.js:1088.
 * @param {*[]} allPlayers The alive players list.
 * @returns {Map<*, ActiveWar> | null} Active wars keyed by uniqueID, or null.
 */
function collectActiveWars(allPlayers) {
  const activeWarsByID = new Map();
  if (
    !Game?.Diplomacy ||
    typeof Game.Diplomacy.getPlayerEvents !== "function" ||
    typeof Game.Diplomacy.getDiplomaticEventData !== "function"
  ) {
    ilog("warTracker: Game.Diplomacy API unavailable, skipping turn");
    return null;
  }
  for (const p of allPlayers) {
    if (!p) continue;
    let events;
    try {
      events = Game.Diplomacy.getPlayerEvents(p.id);
    } catch (_) {
      events = null;
    }
    if (!Array.isArray(events)) continue;
    for (const ev of events) {
      ingestWarEvent(ev, activeWarsByID);
    }
  }
  return activeWarsByID;
}

/**
 * Update an existing history war record from freshly-enumerated war info
 * (expanding rosters and reopening if it was wrongly closed).
 * @param {WarRecord} existing The history war record (mutated in place).
 * @param {ActiveWar} info The normalized active-war info.
 * @param {WarRosterEntry[]} aRoster Side A roster entries.
 * @param {WarRosterEntry[]} bRoster Side B roster entries.
 * @param {*} uid The war uniqueID (for logging).
 * @returns {void}
 */
function updateExistingWar(existing, info, aRoster, bRoster, uid) {
  // Update participants in case the war expanded (joined allies).
  existing.sideA = info.sideA.slice();
  existing.sideB = info.sideB.slice();
  existing.participants = info.sideA.concat(info.sideB);
  existing.sideACivs = aRoster;
  existing.sideBCivs = bRoster;
  // If a previous close was wrong (UI lag, etc.), reopen.
  if (typeof existing.endTurn === "number") {
    existing.endTurn = null;
    existing.endYear = null;
    ilog("WAR REOPENED:", existing.name, "uid=", uid);
  }
}

/**
 * Construct a brand-new history war record (computing its ordinal name from
 * prior same-matchup wars).
 * @param {WarRecord[]} wars The history.wars array (read for ordinal counting).
 * @param {ActiveWar} info The normalized active-war info.
 * @param {WarRosterEntry[]} aRoster Side A roster entries.
 * @param {WarRosterEntry[]} bRoster Side B roster entries.
 * @param {Snapshot} snapshot The snapshot (for declarer pidInfo).
 * @param {string | undefined} gameYear The current game-year label.
 * @param {number} turn The current turn (used as a startTurn fallback).
 * @returns {WarRecord} The new war record.
 */
function buildNewWar(wars, info, aRoster, bRoster, snapshot, gameYear, turn) {
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
    (w) => [w._nameKeyA || "", w._nameKeyB || ""].sort().join("|") === sortedNames.join("|")
  ).length;
  const ordinal = ordinalSuffix(priorCount + 1);
  const name = ordinal + " " + sortedNames[0] + " vs " + sortedNames[1] + " War";
  const declarer = pidInfo(snapshot, /** @type {Pid} */ (info.initialPid));
  return {
    warUniqueID: info.uniqueID,
    // `info.headerStartTurn` is the engine diplomacy header's declaration turn
    // (age-local Game.turn). Samples, `endTurn`, and the Gantt domain are all
    // age-local — the chart applies the per-age offset at render time — so we
    // store it as-is, falling back to the current turn when the header lacks a
    // usable value. (The earlier `+ cumulativeOffset` referenced a variable
    // that never existed and threw a swallowed ReferenceError on every new war,
    // silently dropping that turn's war tracking; the offset bookkeeping it came
    // from was removed mod-wide as obsolete.)
    startTurn: typeof info.headerStartTurn === "number" ? info.headerStartTurn : turn,
    endTurn: null,
    startYear: gameYear,
    endYear: null,
    sideA: info.sideA.slice(),
    sideB: info.sideB.slice(),
    participants: info.sideA.concat(info.sideB),
    sideACivs: aRoster,
    sideBCivs: bRoster,
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
 * Reconcile the active war set against history.wars[] keyed by uniqueID:
 * update existing records (expanding/reopening) and append new ones.
 * @param {WarRecord[]} wars The history.wars array (mutated in place).
 * @param {Map<*, ActiveWar>} activeWarsByID Active wars keyed by uniqueID.
 * @param {Snapshot} snapshot The current snapshot.
 * @param {string | undefined} gameYear The current game-year label.
 * @param {number} turn The current turn.
 * @returns {void}
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
      updateExistingWar(existing, info, aRoster, bRoster, uid);
      continue;
    }
    const newWar = buildNewWar(wars, info, aRoster, bRoster, snapshot, gameYear, turn);
    wars.push(newWar);
    ilog(
      "WAR STARTED:",
      newWar.name,
      "uid=",
      uid,
      "declarer=pid" +
        info.initialPid +
        " (" +
        (pidInfo(snapshot, /** @type {Pid} */ (info.initialPid))?.civ || "?") +
        ")",
      "sideA=",
      info.sideA.join(","),
      "sideB=",
      info.sideB.join(",")
    );
  }
}

/**
 * Close any open war whose uniqueID is no longer in the active set (peace,
 * elimination, etc.); migrate-close pre-API legacy records on first pass.
 * @param {WarRecord[]} wars The history.wars array (mutated in place).
 * @param {Map<*, ActiveWar>} activeWarsByID Active wars keyed by uniqueID.
 * @param {string | undefined} gameYear The current game-year label.
 * @param {number} turn The current turn.
 * @returns {void}
 */
function closeEndedWars(wars, activeWarsByID, gameYear, turn) {
  for (const w of wars) {
    if (typeof w.endTurn === "number") continue;
    if (typeof w.warUniqueID !== "number") {
      // Pre-API legacy record with no uniqueID — close it on first pass after
      // migration so it doesn't linger forever.
      w.endTurn = turn;
      w.endYear = gameYear;
      ilog("WAR ENDED (legacy migration):", w.name, "turn=", turn);
      continue;
    }
    if (!activeWarsByID.has(w.warUniqueID)) {
      w.endTurn = turn;
      w.endYear = gameYear;
      ilog("WAR ENDED:", w.name, "uid=", w.warUniqueID, "turn=", turn);
    }
  }
}

/**
 * Build connected components of currently-at-war pairs (so a 2v2 coalition
 * becomes ONE war record) and reconcile against open wars in history.wars[].
 * Each war record carries sideA/sideB arrays so multi-civ conflicts are
 * first-class. Wrapped in safeCall to keep one bad turn from tripping the kill
 * switch.
 * @param {Snapshot} snapshot The just-recorded snapshot.
 * @param {number} turn The current turn.
 * @returns {void}
 */
export function runWarTracker(snapshot, turn) {
  safeCall("warTracker", () => {
    const h = /** @type {WarHistory} */ (DemographicsStorage.load());
    if (!Array.isArray(h.wars)) h.wars = [];
    migrateWarRecords(snapshot, h.wars);
    const gameYear = _readTurnDate();
    const allPlayers = typeof Players?.getAlive === "function" ? Players.getAlive() : null;
    if (!Array.isArray(allPlayers)) return;

    const activeWarsByID = collectActiveWars(allPlayers);
    if (activeWarsByID === null) return;

    const wars = h.wars || [];
    reconcileWars(wars, activeWarsByID, snapshot, gameYear, turn);
    closeEndedWars(wars, activeWarsByID, gameYear, turn);
    DemographicsStorage.save(h);
  });
}

/**
 * Read the current turn's date label via Game.getTurnDate, using a bare
 * try/catch (no safeCall, so it never touches the kill switch).
 * @returns {string | undefined} The date label, or undefined.
 */
function _readTurnDate() {
  try {
    if (typeof Game !== "undefined" && typeof Game.getTurnDate === "function") {
      const s = Game.getTurnDate();
      if (typeof s === "string" && s.length > 0) return s;
    }
  } catch (_) {}
  return undefined;
}

// Returns "1st", "2nd", "3rd", "4th"... for any positive integer.
/**
 * Format an ordinal suffix for a positive integer.
 * @param {number} n The number.
 * @returns {string} e.g. "1st", "2nd", "3rd", "4th".
 */
function ordinalSuffix(n) {
  const s = ["th", "st", "nd", "rd"],
    v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
