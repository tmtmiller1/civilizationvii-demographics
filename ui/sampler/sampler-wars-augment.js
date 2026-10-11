// sampler-wars-augment.js
//
// War roster augmentation and enrichment helpers.

import { tPlayerFallback } from "/demographics/ui/core/demographics-i18n.js";

/**
 * @typedef {import("/demographics/ui/sampler/sampler-wars.js").WarHistory} WarHistory
 * @typedef {import("/demographics/ui/sampler/sampler-wars.js").WarRecord} WarRecord
 * @typedef {import("/demographics/ui/sampler/sampler-wars.js").WarRosterEntry} WarRosterEntry
 * @typedef {import("/demographics/ui/sampler/sampler-wars.js").WarParticipant} WarParticipant
 * @typedef {import("/demographics/ui/sampler/sampler-wars.js").ActiveWar} ActiveWar
 */

/**
 * Resolve display info (civ/leader/color/type-string + isCS) for a pid, using
 * the snapshot first and falling back to live engine reads. Mirrors the trio
 * of CS checks view-relations.js uses.
 * @param {Snapshot} snapshot The current snapshot (for cached player info).
 * @param {number | string} pid
 * @returns {WarRosterEntry} The resolved war-roster entry.
 */
export function pidInfo(snapshot, pid) {
  const ps = snapshot.players?.[pid] || {};
  const live = pidLiveInfo(pid, ps.civName);
  const civ = live.civ;
  const isCS = live.isCS || isCSByName(civ);
  const civTypeString = resolveRosterCivTypeString(ps, pid);
  return {
    pid,
    civ: civ || tPlayerFallback(pid),
    leader: ps.leaderName || "",
    color: ps.primaryColor || "#9aa8c8",
    civTypeString: civTypeString || undefined,
    leaderType: ps.leaderTypeString || undefined,
    isCS
  };
}

/**
 * Resolve a war-roster civ type string from snapshot-first fallback logic.
 * @param {*} snapshotPlayer Snapshot player entry.
 * @param {number | string} pid
 * @returns {string | undefined} Civ type string, when available.
 */
function resolveRosterCivTypeString(snapshotPlayer, pid) {
  if (typeof snapshotPlayer?.civTypeString === "string" && snapshotPlayer.civTypeString) {
    return snapshotPlayer.civTypeString;
  }
  return civTypeStringFor(pid);
}

/**
 * Read the live player handle to fill in a missing civ name and the CS flag.
 * @param {number | string} pid
 * @param {*} cachedCiv The civ name already known from the snapshot, if any.
 * @returns {{ civ: *, isCS: boolean }} The (possibly resolved) civ + CS flag.
 */
function pidLiveInfo(pid, cachedCiv) {
  let civ = cachedCiv;
  let isCS = false;
  try {
    const player = Players.get(Number(pid));
    if (player) {
      if (!civ && player.civilizationName) {
        civ =
          typeof Locale?.compose === "function"
            ? Locale.compose(player.civilizationName)
            : player.civilizationName;
      }
      isCS = detectCityState(player);
    }
  } catch (_) {
    // Players.get() / Locale.compose() can be null / throw mid age-transition;
    // keep the cached civ name and a non-CS default.
  }
  return { civ, isCS };
}

/**
 * Last-resort name-based CS detection: Independent Powers and city-state
 * encampments often surface as "Village"/"Independent" in civilizationName.
 * @param {*} civ The (possibly resolved) civ name.
 * @returns {boolean} True if the name looks like a city-state / IP.
 */
function isCSByName(civ) {
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
 * @param {number | string} pid
 * @returns {string | undefined} The civilizationType string, or undefined.
 */
function civTypeStringFor(pid) {
  try {
    const player = Players.get(Number(pid));
    const ct = player?.civilizationType;
    if (typeof ct === "string" && ct.length > 0) return ct;
  } catch (_) {
    // Players.get() can be null / throw mid age-transition; treat the civ type
    // string as unavailable.
  }
  return undefined;
}

/**
 * Determine whether a live player handle is a city-state / independent /
 * non-major civ, mirroring view-relations.js.
 * @param {*} player A live player handle.
 * @returns {boolean} True if the player should be treated as a city-state.
 */
function detectCityState(player) {
  /**
   * Coerce a boolean-or-thunk player flag to a boolean (or undefined).
   * @param {*} value The flag value (boolean, function, or other).
   * @returns {boolean | undefined} The resolved flag, or undefined.
   */
  function flag(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "function") {
      try {
        return !!value.call(player);
      } catch (_) {
        // Calling a player flag accessor can throw on a stale handle.
      }
    }
    return undefined;
  }
  let isCS = false;
  if (flag(player.isMinor) === true) isCS = true;
  if (flag(player.isIndependent) === true) isCS = true;
  if (flag(player.isCityState) === true) isCS = true;
  if (!isCS) {
    const major = flag(player.isMajor);
    const fullCiv = flag(player.isFullCiv);
    if (major === false || fullCiv === false) isCS = true;
  }
  return isCS;
}

/**
 * Migrate scalar-side war records (aPid/bPid) to sideA/sideB arrays and reconcile each side's
 * roster. Civ identity is pinned to the war's start age: a player's civilization changes each
 * age, so each belligerent's civ is re-derived from the sample at the war's start chart-turn.
 * @param {Snapshot} snapshot The current snapshot (transient fields + legacy backfill).
 * @param {WarRecord[]} wars The history.wars array (mutated in place).
 * @param {Snapshot[]} [samples] The recorded per-turn samples (for start-age civ lookup).
 */
export function migrateWarRecords(snapshot, wars, samples) {
  for (const war of wars) {
    migrateWarRecord(war);
    const opts = {
      snapshot,
      startTurn: war.startTurn,
      warOpen: war.endTurn == null,
      startPlayers: startSamplePlayers(samples, war)
    };
    war.sideACivs = prepareWarSideRoster(war.sideACivs, war.sideA, opts);
    war.sideBCivs = prepareWarSideRoster(war.sideBCivs, war.sideB, opts);
  }
}

/**
 * The recorded players-by-pid map from the sample at (or just before) a war's start chart-turn:
 * the civ identities as they were when the war began. Null when start data isn't available.
 * @param {Snapshot[]|undefined} samples The recorded samples.
 * @param {WarRecord} war
 * @returns {Record<string, *>|null} pid → snapshot player at war start, or null.
 */
function startSamplePlayers(samples, war) {
  const target = typeof war.startChartTurn === "number" ? war.startChartTurn : null;
  if (target == null || !Array.isArray(samples)) return null;
  const best = findStartSample(samples, target);
  return best && best.players ? best.players : null;
}

/**
 * The sample with the greatest chart-turn at or before `target` (the war's start).
 * @param {Snapshot[]} samples The recorded samples.
 * @param {number} target The war's start chart-turn.
 * @returns {Snapshot|null} The matching sample, or null.
 */
export function findStartSample(samples, target) {
  let best = null;
  let bestTurn = -Infinity;
  for (const sample of samples) {
    const ct = sample?.chartTurn;
    if (typeof ct === "number" && ct <= target && ct > bestTurn) {
      bestTurn = ct;
      best = sample;
    }
  }
  return best;
}

/**
 * Pin a roster entry's civ identity to the war's start age, read from the start sample. No-op when
 * that data isn't available (then the existing/current value stands).
 * @param {WarParticipant} entry The roster entry (mutated).
 * @param {Record<string, *>|null} startPlayers pid → snapshot player at war start.
 */
function applyHistoricalCiv(entry, startPlayers) {
  const sp = startPlayers ? startPlayers[entry.pid] : null;
  if (!sp) return;
  if (typeof sp.civTypeString === "string" && sp.civTypeString) entry.civTypeString = sp.civTypeString;
  if (typeof sp.civName === "string" && sp.civName) entry.civ = sp.civName;
}

/**
 * Prepare a war side's cumulative participation roster for the current sample. Civ identity is
 * pinned to the war's start age (see migrateWarRecords); only transient fields (leader/color/isCS)
 * track the live player, and the current snapshot is used only to backfill a missing civ.
 * @param {WarParticipant[]|object[]|undefined} civs The stored side roster.
 * @param {number[]|undefined} pids The side's pid list (for legacy backfill).
 * @param {{snapshot:Snapshot, startTurn:(number|null|undefined), warOpen:boolean,
 *   startPlayers:(Record<string, *>|null)}} opts Reconciliation inputs.
 * @returns {WarParticipant[]} The prepared cumulative roster.
 */
function prepareWarSideRoster(civs, pids, opts) {
  const { snapshot, startTurn, warOpen, startPlayers } = opts;
  const list = /** @type {WarParticipant[]} */ (Array.isArray(civs) ? civs : []);
  const hasHistory = list.some((e) => e && typeof e.joinTurn === "number");
  if (!hasHistory) {
    const st = typeof startTurn === "number" ? startTurn : 0;
    return (pids || []).map((p) => {
      const entry = { ...pidInfo(snapshot, p), joinTurn: st, active: warOpen };
      applyHistoricalCiv(entry, startPlayers);
      return entry;
    });
  }
  for (const entry of list) {
    if (entry.active) refreshActiveEntry(entry, snapshot);
    applyHistoricalCiv(entry, startPlayers); // authoritative: the civ as it was at war start
  }
  return list;
}

/**
 * Refresh an active roster entry's transient fields (leader/color/isCS) from the live player, and
 * backfill its civ only when missing. Civ identity is pinned by applyHistoricalCiv, not here.
 * @param {WarParticipant} entry The roster entry (mutated).
 * @param {Snapshot} snapshot The current snapshot.
 */
function refreshActiveEntry(entry, snapshot) {
  const info = pidInfo(snapshot, entry.pid);
  entry.leader = info.leader;
  entry.color = info.color;
  entry.isCS = info.isCS;
  if (!entry.civ || /^Player\s/.test(entry.civ)) entry.civ = info.civ;
  if (!entry.civTypeString && info.civTypeString) entry.civTypeString = info.civTypeString;
}

/**
 * Migrate one war record from scalar sides to side arrays.
 * @param {WarRecord} war A history war record.
 */
function migrateWarRecord(war) {
  if (Array.isArray(war.sideA) && Array.isArray(war.sideB)) return;
  if (typeof war.aPid === "number" && typeof war.bPid === "number") {
    war.sideA = [war.aPid];
    war.sideB = [war.bPid];
    war.participants = [war.aPid, war.bPid];
  } else {
    war.sideA = war.sideA || [];
    war.sideB = war.sideB || [];
    if (typeof war.endTurn !== "number") war.endTurn = war.startTurn;
  }
}

/**
 * Whether player handle p is a formal ally (alliance or defensive pact).
 * @param {*} player A player handle.
 * @param {number} otherId The other major's pid.
 * @returns {boolean} True when allied or defensive-pacted.
 */
function isAllyOrPact(player, otherId) {
  try {
    const diplomacy = player?.Diplomacy;
    if (!diplomacy) return false;
    if (typeof diplomacy.hasAllied === "function" && diplomacy.hasAllied(otherId)) return true;
    if (
      typeof diplomacy.hasDefensivePact === "function" &&
      diplomacy.hasDefensivePact(otherId)
    ) {
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

/**
 * Append a side's belligerents' formal allies (major civs), in place.
 * @param {number[]} side The side pid list (mutated).
 * @param {number[]} otherSide The opposing side pid list.
 * @param {Map<number, *>} byId Player handle by pid.
 * @param {number[]} majors The alive major pids.
 */
function addSideAllies(side, otherSide, byId, majors) {
  const inSide = new Set(side.map(Number));
  const inOther = new Set(otherSide.map(Number));
  for (const memberPid of side.slice()) {
    const mp = byId.get(Number(memberPid));
    if (!mp) continue;
    for (const otherId of majors) {
      if (inSide.has(otherId) || inOther.has(otherId)) continue;
      if (isAllyOrPact(mp, otherId)) {
        side.push(otherId);
        inSide.add(otherId);
      }
    }
  }
}

/**
 * Augment active wars with formal allies.
 * @param {Map<*, ActiveWar>} activeWarsByID
 * @param {*[]} allPlayers The alive players list.
 */
export function augmentWarsWithAllies(activeWarsByID, allPlayers) {
  /** @type {Map<number, *>} */
  const byId = new Map();
  /** @type {number[]} */
  const majors = [];
  for (const player of allPlayers) {
    if (!player || typeof player.id !== "number") continue;
    byId.set(player.id, player);
    if (player.isMinor !== true) majors.push(player.id);
  }
  if (!majors.length) return;
  for (const war of activeWarsByID.values()) {
    addSideAllies(war.sideA, war.sideB, byId, majors);
    addSideAllies(war.sideB, war.sideA, byId, majors);
  }
}

/**
 * Map each major to alive city-states it currently suzerains.
 * @param {*[]} allPlayers The alive players list.
 * @returns {Map<number, Set<number>>} suzerain pid -> city-state pids.
 */
function buildSuzerainMap(allPlayers) {
  /** @type {Map<number, Set<number>>} */
  const map = new Map();
  for (const player of allPlayers) {
    const suz = readSuzerain(player);
    if (suz < 0) continue;
    if (!map.has(suz)) map.set(suz, new Set());
    /** @type {Set<number>} */ (map.get(suz)).add(player.id);
  }
  return map;
}

/**
 * Read a city-state player's suzerain pid, or -1 when unavailable.
 * @param {*} player A player handle.
 * @returns {number} The suzerain pid, or -1.
 */
function readSuzerain(player) {
  try {
    if (!player || player.isMinor !== true || typeof player.id !== "number") return -1;
    const inf = player.Influence;
    const suz =
      inf && typeof inf.getSuzerain === "function" ? inf.getSuzerain() : -1;
    return typeof suz === "number" ? suz : -1;
  } catch (_) {
    return -1;
  }
}

/**
 * Append a side's suzerained city-states to that side pid list.
 * @param {number[]} sidePids The side pid list (mutated).
 * @param {Map<number, Set<number>>} csBySuzerain
 */
function addSideCityStates(sidePids, csBySuzerain) {
  const existing = new Set(sidePids);
  for (const major of sidePids.slice()) {
    const cityStates = csBySuzerain.get(Number(major));
    if (!cityStates) continue;
    for (const cityState of cityStates) {
      if (!existing.has(cityState)) {
        sidePids.push(cityState);
        existing.add(cityState);
      }
    }
  }
}

/**
 * Augment active wars with suzerained city-states.
 * @param {Map<*, ActiveWar>} activeWarsByID
 * @param {*[]} allPlayers The alive players list.
 */
export function augmentWarsWithCityStates(activeWarsByID, allPlayers) {
  const csBySuzerain = buildSuzerainMap(allPlayers);
  if (!csBySuzerain.size) return;
  for (const war of activeWarsByID.values()) {
    addSideCityStates(war.sideA, csBySuzerain);
    addSideCityStates(war.sideB, csBySuzerain);
  }
}
