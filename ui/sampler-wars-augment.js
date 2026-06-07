// sampler-wars-augment.js
//
// War roster augmentation and enrichment helpers.

/**
 * @typedef {import("/demographics/ui/sampler-wars.js").WarHistory} WarHistory
 * @typedef {import("/demographics/ui/sampler-wars.js").WarRecord} WarRecord
 * @typedef {import("/demographics/ui/sampler-wars.js").WarRosterEntry} WarRosterEntry
 * @typedef {import("/demographics/ui/sampler-wars.js").WarParticipant} WarParticipant
 * @typedef {import("/demographics/ui/sampler-wars.js").ActiveWar} ActiveWar
 */

/**
 * Resolve display info (civ/leader/color/type-string + isCS) for a pid, using
 * the snapshot first and falling back to live engine reads. Mirrors the trio
 * of CS checks view-relations.js uses.
 * @param {Snapshot} snapshot The current snapshot (for cached player info).
 * @param {number | string} pid The player id.
 * @returns {WarRosterEntry} The resolved war-roster entry.
 */
export function pidInfo(snapshot, pid) {
  const ps = snapshot.players?.[pid] || {};
  const live = pidLiveInfo(pid, ps.civName);
  const civ = live.civ;
  const isCS = live.isCS || isCSByName(civ);
  const civTypeString = ps.civTypeString || civTypeStringFor(pid);
  return {
    pid,
    civ: civ || "Player " + pid,
    leader: ps.leaderName || "",
    color: ps.primaryColor || "#9aa8c8",
    civTypeString: civTypeString || undefined,
    leaderType: ps.leaderTypeString || undefined,
    isCS
  };
}

/**
 * Read the live player handle to fill in a missing civ name and the CS flag.
 * @param {number | string} pid The player id.
 * @param {*} cachedCiv The civ name already known from the snapshot, if any.
 * @returns {{ civ: *, isCS: boolean }} The (possibly resolved) civ + CS flag.
 */
function pidLiveInfo(pid, cachedCiv) {
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
 * @param {number | string} pid The player id.
 * @returns {string | undefined} The civilizationType string, or undefined.
 */
function civTypeStringFor(pid) {
  try {
    const p = Players.get(Number(pid));
    const ct = p?.civilizationType;
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
      } catch (_) {
        // Calling a player flag accessor can throw on a stale handle.
      }
    }
    return undefined;
  }
  let isCS = false;
  if (flag(p.isMinor) === true) isCS = true;
  if (flag(p.isIndependent) === true) isCS = true;
  if (flag(p.isCityState) === true) isCS = true;
  if (!isCS) {
    const major = flag(p.isMajor);
    const fullCiv = flag(p.isFullCiv);
    if (major === false || fullCiv === false) isCS = true;
  }
  return isCS;
}

/**
 * Migrate legacy war records (aPid/bPid scalars) to sideA/sideB arrays and
 * refresh rosters from current pidInfo so the isCS flag reflects current state.
 * @param {Snapshot} snapshot The current snapshot (for pidInfo).
 * @param {WarRecord[]} wars The history.wars array (mutated in place).
 */
export function migrateWarRecords(snapshot, wars) {
  for (const w of wars) {
    migrateWarRecord(w);
    const open = w.endTurn == null;
    w.sideACivs = prepareWarSideRoster(
      snapshot,
      w.sideACivs,
      w.sideA,
      w.startTurn,
      open
    );
    w.sideBCivs = prepareWarSideRoster(
      snapshot,
      w.sideBCivs,
      w.sideB,
      w.startTurn,
      open
    );
  }
}

/**
 * Prepare a war side's cumulative participation roster for the current sample.
 * @param {Snapshot} snapshot The current snapshot.
 * @param {WarParticipant[]|object[]|undefined} civs The stored side roster.
 * @param {number[]|undefined} pids The side's pid list (for legacy backfill).
 * @param {number|null|undefined} startTurn The war's start turn.
 * @param {boolean} warOpen Whether the war is currently open.
 * @returns {WarParticipant[]} The prepared cumulative roster.
 */
function prepareWarSideRoster(snapshot, civs, pids, startTurn, warOpen) {
  const list = /** @type {WarParticipant[]} */ (Array.isArray(civs) ? civs : []);
  const hasHistory = list.some((e) => e && typeof e.joinTurn === "number");
  if (!hasHistory) {
    const st = typeof startTurn === "number" ? startTurn : 0;
    return (pids || []).map((p) => ({
      ...pidInfo(snapshot, p),
      joinTurn: st,
      active: warOpen
    }));
  }
  for (const e of list) {
    if (e.active) {
      const info = pidInfo(snapshot, e.pid);
      e.civ = info.civ;
      e.leader = info.leader;
      e.color = info.color;
      e.civTypeString = info.civTypeString;
      e.isCS = info.isCS;
    }
  }
  return list;
}

/**
 * Migrate one legacy war record from scalar sides to side arrays.
 * @param {WarRecord} w A history war record.
 */
function migrateWarRecord(w) {
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
 * Whether player handle p is a formal ally (alliance or defensive pact).
 * @param {*} p A player handle.
 * @param {number} otherId The other major's pid.
 * @returns {boolean} True when allied or defensive-pacted.
 */
function isAllyOrPact(p, otherId) {
  try {
    const d = p?.Diplomacy;
    if (!d) return false;
    if (typeof d.hasAllied === "function" && d.hasAllied(otherId)) return true;
    if (
      typeof d.hasDefensivePact === "function" &&
      d.hasDefensivePact(otherId)
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
 * @param {Map<*, ActiveWar>} activeWarsByID The active wars.
 * @param {*[]} allPlayers The alive players list.
 */
export function augmentWarsWithAllies(activeWarsByID, allPlayers) {
  /** @type {Map<number, *>} */
  const byId = new Map();
  /** @type {number[]} */
  const majors = [];
  for (const p of allPlayers) {
    if (!p || typeof p.id !== "number") continue;
    byId.set(p.id, p);
    if (p.isMinor !== true) majors.push(p.id);
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
  for (const p of allPlayers) {
    const suz = readSuzerain(p);
    if (suz < 0) continue;
    if (!map.has(suz)) map.set(suz, new Set());
    /** @type {Set<number>} */ (map.get(suz)).add(p.id);
  }
  return map;
}

/**
 * Read a city-state player's suzerain pid, or -1 when unavailable.
 * @param {*} p A player handle.
 * @returns {number} The suzerain pid, or -1.
 */
function readSuzerain(p) {
  try {
    if (!p || p.isMinor !== true || typeof p.id !== "number") return -1;
    const inf = p.Influence;
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
 * @param {Map<number, Set<number>>} csBySuzerain The suzerain map.
 */
function addSideCityStates(sidePids, csBySuzerain) {
  const existing = new Set(sidePids);
  for (const major of sidePids.slice()) {
    const css = csBySuzerain.get(Number(major));
    if (!css) continue;
    for (const cs of css) {
      if (!existing.has(cs)) {
        sidePids.push(cs);
        existing.add(cs);
      }
    }
  }
}

/**
 * Augment active wars with suzerained city-states.
 * @param {Map<*, ActiveWar>} activeWarsByID The active wars.
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
