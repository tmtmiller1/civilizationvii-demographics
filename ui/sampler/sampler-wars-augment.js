// sampler-wars-augment.js
//
// War roster augmentation and enrichment helpers.

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
 * @param {number | string} pid The player id.
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
    civ: civ || "Player " + pid,
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
 * @param {number | string} pid Player id.
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
 * Migrate legacy war records (aPid/bPid scalars) to sideA/sideB arrays and reconcile each side's
 * roster. Civ identity is pinned to the war's START age: a player's CIVILIZATION changes each age
 * (the leader is constant) while war history persists across ages, so naming a roster from the
 * player's CURRENT civ mislabels old wars (e.g. a Han-era war showing the player's Modern civ).
 * We re-derive each belligerent's civ from the recorded sample at the war's start chart-turn, which
 * also heals saves that an earlier build already stamped with a later-age civ.
 * @param {Snapshot} snapshot The current snapshot (transient fields + legacy backfill).
 * @param {WarRecord[]} wars The history.wars array (mutated in place).
 * @param {Snapshot[]} [samples] The recorded per-turn samples (for start-age civ lookup).
 */
export function migrateWarRecords(snapshot, wars, samples) {
  for (const w of wars) {
    migrateWarRecord(w);
    const opts = {
      snapshot,
      startTurn: w.startTurn,
      warOpen: w.endTurn == null,
      startPlayers: startSamplePlayers(samples, w)
    };
    w.sideACivs = prepareWarSideRoster(w.sideACivs, w.sideA, opts);
    w.sideBCivs = prepareWarSideRoster(w.sideBCivs, w.sideB, opts);
  }
}

/**
 * The recorded players-by-pid map from the sample at (or just before) a war's start chart-turn ,
 * the civ identities as they were when the war began. Null when start data isn't available.
 * @param {Snapshot[]|undefined} samples The recorded samples.
 * @param {WarRecord} war The war record.
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
function findStartSample(samples, target) {
  let best = null;
  let bestTurn = -Infinity;
  for (const s of samples) {
    const ct = s.chartTurn;
    if (typeof ct === "number" && ct <= target && ct > bestTurn) {
      bestTurn = ct;
      best = s;
    }
  }
  return best;
}

/**
 * Pin a roster entry's civ identity to the war's start age, read from the start sample. No-op when
 * that data isn't available (then the existing/current value stands).
 * @param {WarParticipant} e The roster entry (mutated).
 * @param {Record<string, *>|null} startPlayers pid → snapshot player at war start.
 */
function applyHistoricalCiv(e, startPlayers) {
  const sp = startPlayers ? startPlayers[e.pid] : null;
  if (!sp) return;
  if (typeof sp.civTypeString === "string" && sp.civTypeString) e.civTypeString = sp.civTypeString;
  if (typeof sp.civName === "string" && sp.civName) e.civ = sp.civName;
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
  for (const e of list) {
    if (e.active) refreshActiveEntry(e, snapshot);
    applyHistoricalCiv(e, startPlayers); // authoritative: the civ as it was at war start
  }
  return list;
}

/**
 * Refresh an active roster entry's transient fields (leader/color/isCS) from the live player, and
 * backfill its civ ONLY when missing. Civ identity is pinned by applyHistoricalCiv, not here.
 * @param {WarParticipant} e The roster entry (mutated).
 * @param {Snapshot} snapshot The current snapshot.
 */
function refreshActiveEntry(e, snapshot) {
  const info = pidInfo(snapshot, e.pid);
  e.leader = info.leader;
  e.color = info.color;
  e.isCS = info.isCS;
  if (!e.civ || /^Player\s/.test(e.civ)) e.civ = info.civ;
  if (!e.civTypeString && info.civTypeString) e.civTypeString = info.civTypeString;
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
