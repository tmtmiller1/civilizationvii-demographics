// demographics-sampler.js
//
// Subscribes to PlayerTurnActivated and records a snapshot of safe
// metrics for every alive major player. Hard-defensive: every accessor
// is both try/catch-wrapped and typeof-checked, and the sampler
// permanently unsubscribes after KILL_THRESHOLD consecutive throws to
// isolate a degraded session from compounding errors.
//
// The engine.on/off subscription pattern is established in
// base-standard/ui/quest-tracker/quest-list.js and
// notification-train/model-notification-train.js (the data.player payload
// field is documented at quest-list.js, around line 206).
// Players.getAliveMajorIds() is from base-standard/maps/assign-starting-plots.js.
//
// Accessor crib sheet (all under Resources/Base/modules):
//   Stats.getNetYield(YieldTypes.YIELD_*)         — diplo-ribbon/model-diplo-ribbon.js
//   Stats.numSettlements / settlementCap          — same file
//   Stats.numCities / numTowns / totalPopulation  — same file
//   Treasury.getGoldBalance() / goldBalance       — advice/advice-support.js
//   Cities.getCities()                            — pre-existing
//   city.getPurchasedPlots()                      — city-zoomer/city-zoomer.js
//   Trade.countPlayerTradeRoutes()                — age-antiquity tutorial
//   Game.Diplomacy.getPlayerEvents(playerId)      — diplomacy-actions panel
//   player.Stats.getNumWonders(orig, currentAge)  — advice/advice-support.js
//   player.Units.getUnitIds() + Units.get(id)     — age-antiquity tutorial
//   GameInfo.Unit_Stats[].Combat joined on UnitType
//                                                  — civilopedia-sidebar-panels.js
//   FormationClass classifier (LAND_COMBAT / NAVAL / AIR → military)
//                                                  — interface-mode-unit-selected.js
//   Techs.getTreeType() + Game.ProgressionTrees.getTree(pid, treeType).nodes
//                                                  — tutorial/tutorial-support.js
//   Culture: analogous via player.Culture.getTreeType()
//   ProgressionTreeNodeState.NODE_STATE_FULLY_UNLOCKED = "researched"
//                                                  — tree-grid/tree-grid.js

import { METRICS } from "/demographics/ui/demographics-metrics.js";
import DemographicsStorage from "/demographics/ui/demographics-storage.js";
import { DemographicsSettings } from "/demographics/ui/demographics-settings.js";
import {
  buildPlayerCtx,
  getCurrentAgeType,
  resetAgeCaches
} from "/demographics/ui/sampler-collectors.js";
import { runWarTracker } from "/demographics/ui/sampler-wars.js";

/**
 * The per-civ context object assembled by {@link buildPlayerCtx} (defined in
 * sampler-collectors.js). Re-imported here so the snapshot pipeline can stay
 * typed without duplicating the shape.
 * @typedef {import("/demographics/ui/sampler-collectors.js").PlayerCtx} PlayerCtx
 */

/**
 * The persisted history blob as the sampler sees it: the shared {@link
 * DemoHistory} fields plus the sampler's own runtime extensions (`wars`,
 * `legacySnapshots`, the obsolete `cumulativeTurnOffset`). Re-imported from
 * sampler-wars.js, which owns the war-record schema.
 * @typedef {import("/demographics/ui/sampler-wars.js").WarHistory} WarHistory
 */

// How many turns between samples. Resolved from the user setting each call
// so a runtime change in the Options panel takes effect on the next turn
// without needing to restart the sampler.
/**
 * Resolve the configured sample cadence (turns between samples).
 * @returns {number} A finite integer >= 1; defaults to 1 on any failure.
 */
function getPollEveryNTurns() {
  try {
    const v = DemographicsSettings.getSetting("sampleEveryNTurns", 1);
    const n = Math.round(Number(v));
    if (Number.isFinite(n) && n >= 1) return n;
  } catch (_) {
    /* */
  }
  return 1;
}

// Track the last turn we actually recorded a snapshot on so the throttle
// stays correct across (a) save/load round-trips and (b) settings changes
// — we don't want the user to switch from "every 5 turns" to "every 2"
// and immediately get a duplicate sample on the same turn.
let lastSampledTurn = -1;
/**
 * Decide whether a snapshot should be recorded on the given turn, honoring
 * the polling cadence and the last recorded turn.
 * @param {*} turn The current game turn (numeric) or any other value.
 * @returns {boolean} True if a sample should be taken this turn.
 */
function shouldSampleThisTurn(turn) {
  if (typeof turn !== "number") return true;
  const n = getPollEveryNTurns();
  if (n <= 1) return true;
  if (turn === lastSampledTurn) return false;
  if (turn % n !== 0) return false;
  return true;
}

let DEMOGRAPHICS_DEBUG = true;
/**
 * Verbose debug logger; no-op unless {@link DEMOGRAPHICS_DEBUG} is set.
 * @param {...*} a Values to log.
 * @returns {void}
 */
function vlog(...a) {
  if (DEMOGRAPHICS_DEBUG) console.warn("[Demographics.sampler]", ...a);
}
/**
 * Informational logger; always emits.
 * @param {...*} a Values to log.
 * @returns {void}
 */
function ilog(...a) {
  console.warn("[Demographics.sampler]", ...a);
}
/**
 * Error logger; always emits.
 * @param {...*} a Values to log.
 * @returns {void}
 */
function elog(...a) {
  console.error("[Demographics.sampler]", ...a);
}

// ---- kill switch ---------------------------------------------------------
let errorCount = 0;
const KILL_THRESHOLD = 3;
let disabled = false;
let started = false;
let firstSampleSucceeded = false;
/** @type {*} */
let handlerRef = null;

/**
 * Increment the error counter and, once it reaches {@link KILL_THRESHOLD},
 * permanently disable sampling and unsubscribe for this session.
 * @param {string} label A label identifying where the error occurred.
 * @param {*} e The thrown error.
 * @returns {void}
 */
function tripIfTooMany(label, e) {
  errorCount++;
  elog("error in", label, "errorCount=", errorCount, "/", KILL_THRESHOLD, "err:", e);
  if (errorCount >= KILL_THRESHOLD) {
    ilog("kill switch tripped, disabling sampling permanently for this session");
    disabled = true;
    try {
      if (typeof engine !== "undefined" && typeof engine.off === "function" && handlerRef) {
        engine.off("PlayerTurnActivated", handlerRef);
        vlog("engine.off PlayerTurnActivated done");
      }
    } catch (e2) {
      elog("engine.off threw during kill:", e2);
    }
  }
}

/**
 * Invoke `fn`, returning its result, or undefined if it throws (counting the
 * failure toward the kill switch). Never throws.
 * @template T
 * @param {string} label A label for logging/error attribution.
 * @param {() => T} fn Thunk to invoke.
 * @returns {T | undefined} The result of `fn`, or undefined on error.
 */
export function safeCall(label, fn) {
  try {
    if (DEMOGRAPHICS_DEBUG) vlog("about to call", label);
    const v = fn();
    if (DEMOGRAPHICS_DEBUG)
      vlog(label, "returned", typeof v, Array.isArray(v) ? "[len=" + v.length + "]" : "");
    return v;
  } catch (e) {
    tripIfTooMany(label, e);
    return undefined;
  }
}

/**
 * Resolve the local player (or observer) id defensively.
 * @returns {number | undefined} The numeric id, or undefined if unavailable.
 */
export function getLocalPlayerID() {
  try {
    if (typeof GameContext !== "undefined" && GameContext != null) {
      const v = GameContext.localPlayerID;
      if (typeof v === "number") return v;
      const o = GameContext.localObserverID;
      if (typeof o === "number") return o;
    }
  } catch (e) {
    elog("getLocalPlayerID threw:", e);
  }
  return undefined;
}

/**
 * Get the list of alive major player ids, defensively.
 * @returns {Pid[]} The ids, or an empty array on any failure.
 */
function getAliveMajorIds() {
  return (
    safeCall("Players.getAliveMajorIds()", () => {
      if (typeof Players === "undefined") return [];
      if (typeof Players.getAliveMajorIds !== "function") return [];
      const arr = Players.getAliveMajorIds();
      return Array.isArray(arr) ? arr : [];
    }) || []
  );
}

/**
 * Get a player library handle defensively.
 * @param {Pid} id The player id.
 * @returns {*} The player handle, or undefined.
 */
export function getPlayer(id) {
  return safeCall("Players.get(" + id + ")", () => {
    if (typeof Players === "undefined" || typeof Players.get !== "function") return undefined;
    return Players.get(id);
  });
}

// ---- numeric helpers -----------------------------------------------------

/**
 * Coerce to a finite number, or undefined.
 * @param {*} v Candidate value.
 * @returns {number | undefined} `v` if it is a finite number, else undefined.
 */
export function safeNum(v) {
  return typeof v === "number" && isFinite(v) ? v : undefined;
}

/**
 * The game-wide age + crisis context sampled once per snapshot and stamped
 * onto every player's ctx.
 * @typedef {object} GlobalAgeContext
 * @property {number} [crisisStage] Current crisis stage.
 * @property {number} crisisStageMax Highest stage trigger percent seen.
 * @property {number} [ageProgressPct] Age progress as a percentage.
 * @property {boolean} [ageEnabled] Whether the age crisis is enabled.
 * @property {string} [crisisEventType] Specific crisis event type, if probed.
 */

// Crisis + age progress are GAME-WIDE, not per-player. We sample them once
// per snapshot and stamp the value on every player's ctx so the existing
// per-civ chart pipeline can plot them (every civ gets the same line — by
// design, since crisis affects everyone in the age).
// Try to identify the SPECIFIC age-crisis event the game rolled this run
// (e.g. ANTIQUITY_CRISIS_PLAGUE vs ANTIQUITY_CRISIS_INVASION). The engine
// doesn't expose this on CrisisManager, but the choice is recorded in
// game-setup config. We probe several likely parameter names and accept the
// first that looks like an AgeCrisisEventType. Returns undefined on miss
// (callers fall back to age-themed flavor names).
/**
 * Probe game-setup config for the specific age-crisis event type.
 * @returns {string | undefined} The crisis event type, or undefined on miss.
 */
function probeCrisisEventType() {
  return safeCall("probeCrisisEventType", () => {
    if (typeof Configuration === "undefined" || !Configuration.getGame) return undefined;
    const cfg = Configuration.getGame();
    if (!cfg || typeof cfg.getValue !== "function") return undefined;
    const keys = [
      "Crisis",
      "CrisisType",
      "AgeCrisis",
      "AgeCrisisEvent",
      "AgeCrisisEventType",
      "CrisisEventType"
    ];
    for (const k of keys) {
      try {
        const v = cfg.getValue(k);
        if (typeof v === "string" && /^[A-Z_]+_CRISIS_[A-Z_]+$/.test(v)) return v;
      } catch (_) {
        /* */
      }
    }
    return undefined;
  });
}

/**
 * Read the crisis stage / trigger percents off Game.CrisisManager into `out`.
 * @param {GlobalAgeContext} out The context to mutate.
 * @returns {void}
 */
function readCrisisManager(out) {
  const cm = typeof Game !== "undefined" ? Game.CrisisManager : null;
  if (!cm) return;
  if (typeof cm.isCrisisEnabled === "function") {
    out.ageEnabled = !!cm.isCrisisEnabled(0);
  }
  if (typeof cm.getCurrentCrisisStage === "function") {
    const s = cm.getCurrentCrisisStage(0);
    if (typeof s === "number" && isFinite(s)) out.crisisStage = s;
  }
  _readCrisisStageMax(cm, out);
}

/**
 * Record the highest crisis-stage trigger percent (a per-stage constant) into
 * `out.crisisStageMax`, so consumers can normalise.
 * @param {*} cm The Game.CrisisManager handle.
 * @param {GlobalAgeContext} out The context to mutate.
 * @returns {void}
 */
function _readCrisisStageMax(cm, out) {
  if (typeof cm.getCrisisStageTriggerPercent !== "function") return;
  for (let st = 0; st < 4; st++) {
    try {
      const t = cm.getCrisisStageTriggerPercent(0, st);
      if (typeof t === "number" && isFinite(t) && t > out.crisisStageMax) {
        out.crisisStageMax = t;
      }
    } catch (_) {
      /* */
    }
  }
}

/**
 * Read the age-progress percentage off Game.AgeProgressManager into `out`.
 * @param {GlobalAgeContext} out The context to mutate.
 * @returns {void}
 */
function readAgeProgress(out) {
  const apm = typeof Game !== "undefined" ? Game.AgeProgressManager : null;
  if (!apm) return;
  let cur, max;
  try {
    cur = apm.getCurrentAgeProgressionPoints();
  } catch (_) {}
  try {
    max = apm.getMaxAgeProgressionPoints();
  } catch (_) {}
  if (typeof cur === "number" && typeof max === "number" && max > 0) {
    out.ageProgressPct = (cur / max) * 100;
  }
}

/**
 * Sample the game-wide age + crisis context once per snapshot.
 * @returns {GlobalAgeContext} The assembled global age context.
 */
function getGlobalAgeContext() {
  /** @type {GlobalAgeContext} */
  const out = {
    crisisStage: undefined,
    crisisStageMax: 0,
    ageProgressPct: undefined,
    ageEnabled: undefined,
    crisisEventType: undefined
  };
  safeCall("crisisAgeGlobal", () => {
    try {
      readCrisisManager(out);
      readAgeProgress(out);
    } catch (_) {
      /* */
    }
  });
  out.crisisEventType = probeCrisisEventType();
  return out;
}

/**
 * Read the current game turn defensively.
 * @returns {number | undefined} The current turn, or undefined.
 */
function getCurrentTurn() {
  return safeCall("Game.turn", () => {
    if (typeof Game !== "undefined" && typeof Game.turn === "number") return Game.turn;
    return undefined;
  });
}

// ---- the sampler ---------------------------------------------------------

/**
 * Read the in-game date label for the CURRENT turn (Game.getTurnDate reads the
 * current turn only). Citation: base-standard/ui/system-bar/
 * panel-system-bar.js:192.
 * @returns {string | undefined} The date label, or undefined.
 */
function readGameYear() {
  let gameYear;
  safeCall("getTurnDate", () => {
    if (typeof Game !== "undefined" && typeof Game.getTurnDate === "function") {
      const s = Game.getTurnDate();
      if (typeof s === "string" && s.length > 0) gameYear = s;
    }
  });
  return gameYear;
}

/**
 * Run all METRICS accessors (with optional scaling) over a per-civ ctx,
 * returning the metric-id → value map. NaN is never propagated.
 * @param {PlayerCtx} ctx The per-civ context.
 * @param {number} turn The current turn (scaling context).
 * @returns {Record<string, number>} The computed metrics.
 */
function computeMetrics(ctx, turn) {
  /** @type {Record<string, number>} */
  const metrics = {};
  const scaleCtx = { turn, sampleIndex: undefined };
  for (const m of METRICS) {
    try {
      let v = m.accessor(ctx);
      if (typeof v === "number" && isFinite(v)) {
        // Optional scaling pass; never propagate NaN.
        if (typeof m.scale === "function") {
          try {
            const sv = m.scale(v, scaleCtx, ctx);
            if (typeof sv === "number" && isFinite(sv)) v = sv;
          } catch (e) {
            if (DEMOGRAPHICS_DEBUG) vlog("scale fn threw for", m.id, e);
          }
        }
        metrics[m.id] = v;
      }
    } catch (e) {
      tripIfTooMany("metric accessor " + m.id, e);
    }
  }
  return metrics;
}

/**
 * Build the persisted per-player snapshot record from a sampled ctx + metrics.
 * @param {PlayerCtx} ctx The per-civ context.
 * @param {Record<string, number>} metrics The computed metrics.
 * @returns {object} The snapshot player record.
 */
function buildSnapshotPlayer(ctx, metrics) {
  return {
    leaderType: ctx.leaderType,
    civType: ctx.civType,
    leaderName: ctx.leaderName,
    civName: ctx.civName,
    leaderTypeString: ctx.leaderTypeString,
    civTypeString: ctx.civTypeString,
    primaryColor: ctx.primaryColor,
    secondaryColor: ctx.secondaryColor,
    met: ctx.met,
    metrics,
    // List of ConstructibleType strings for completed wonders this civ owns
    // at this turn. Used by the chart's wonder-marker plugin to diff against
    // the prior sample and identify which SPECIFIC wonder was completed (so
    // we can show its icon, name and a tooltip).
    wonderTypes: Array.isArray(ctx.wonderTypes) ? ctx.wonderTypes : undefined
  };
}

/**
 * Take one snapshot: sample every alive major player, persist it, and update
 * the war tracker. Returns the snapshot, or null if skipped/too-few-players.
 * @returns {Snapshot | null} The recorded snapshot, or null.
 */
function doSample() {
  const localTurn = getCurrentTurn() ?? -1;
  const ids = getAliveMajorIds();
  if (ids.length < 2) {
    ilog("skip sample: too few alive players (", ids.length, ") at localTurn=", localTurn);
    return null;
  }
  const globalAge = getGlobalAgeContext();
  // Each sample is stamped with:
  //   localTurn — Game.turn at sample time (age-local; resets per age)
  //   age       — current age type
  //   turn      — same as localTurn (no precomputed offset). The chart
  //               computes the GLOBAL X position at render time by
  //               walking all samples to build per-age offsets:
  //                 X(sample) = offsets[sample.age] + sample.localTurn
  //               This is robust to any historical offset corruption —
  //               we don't store stateful offsets that can drift.
  const ageType = getCurrentAgeType();
  const turn = localTurn;
  // Capture the in-game date label for this turn so chart x-axis labels can
  // show e.g. "T-52 / 2725 BCE".
  const gameYear = readGameYear();
  /** @type {Snapshot} */
  const snapshot = {
    turn,
    localTurn,
    age: ageType,
    gameYear,
    crisisEventType: globalAge.crisisEventType,
    players: {}
  };
  const players = snapshot.players || (snapshot.players = {});
  for (const pid of ids) {
    const ctx = buildPlayerCtx(pid);
    // Stamp game-wide age/crisis values so metric accessors can read them via
    // the same per-player ctx shape they use today.
    ctx.ageProgressPct = globalAge.ageProgressPct;
    ctx.crisisStage = globalAge.crisisStage;
    ctx.crisisStageMax = globalAge.crisisStageMax;
    const metrics = computeMetrics(ctx, turn);
    players[pid] = buildSnapshotPlayer(ctx, metrics);
  }
  try {
    DemographicsStorage.appendSample(snapshot);
    ilog(
      "appendSample OK localTurn=",
      localTurn,
      "age=",
      ageType,
      "players=",
      Object.keys(players).length
    );
  } catch (e) {
    tripIfTooMany("DemographicsStorage.appendSample", e);
  }
  runWarTracker(snapshot, turn);
  return snapshot;
}

/**
 * PlayerTurnActivated handler: samples the local player's turn, honoring the
 * kill switch and the configured polling cadence.
 * @param {*} data The event payload (carries `player`/`playerID`).
 * @returns {void}
 */
function onPlayerTurnActivated(data) {
  if (disabled) return;
  try {
    const localId = getLocalPlayerID();
    const evtPid = data && (data.player ?? data.playerID);
    if (typeof localId !== "number" || typeof evtPid !== "number") {
      vlog("skip: localId/evtPid not numeric", localId, evtPid);
      return;
    }
    if (evtPid !== localId) return; // local-player only

    // Throttle by user-configured polling rate. Off-cadence turns are
    // silently skipped — the in-game turn still advances, we just don't write
    // a new snapshot. lastSampledTurn is updated below only on successful
    // capture so a missed sample (e.g. due to error) doesn't shift the
    // cadence.
    const curTurn = _curGameTurn();
    if (!shouldSampleThisTurn(curTurn)) {
      vlog("skip turn", curTurn, "by polling rate (every", getPollEveryNTurns(), "turns)");
      return;
    }

    vlog("about to sample turn for localPlayer=", localId);
    const snap = doSample();
    if (snap) _noteSampleSucceeded(curTurn);
  } catch (e) {
    tripIfTooMany("onPlayerTurnActivated", e);
  }
}

/**
 * Bookkeeping after a successful sample: advance the cadence tracker and, on
 * the first success, downgrade log verbosity.
 * @param {number | undefined} curTurn The turn that was just sampled.
 * @returns {void}
 */
function _noteSampleSucceeded(curTurn) {
  if (typeof curTurn === "number") lastSampledTurn = curTurn;
  if (!firstSampleSucceeded) {
    firstSampleSucceeded = true;
    DEMOGRAPHICS_DEBUG = false; // downgrade verbosity after first success
    ilog("first sample SUCCEEDED; downgrading log verbosity for subsequent turns");
  }
}

// ---- age transition handler --------------------------------------------
//
// PlayerAgeTransitionComplete fires per-player as each civ finishes its
// transition into the new age. Payload shape `data.player` (a numeric pid)
// is cited from base-standard/ui/diplo-ribbon/model-diplo-ribbon.js:748-752.
// Event row exists at core/data/gamecore-events.xml:148.
//
// After transition:
//   - Cached current age (and the trees-by-age map) are stale; reset both.
//   - Append { turn, age } to history.ageBoundaries (once per age, not per pid).
//   - Force a sample now so the FIRST sample of the new age records the new civ.
/** @type {*} */
let _ageHandlerRef = null;

/**
 * Clear the age + trees caches and re-read the current age type.
 * @returns {string | undefined} The new (re-read) age type.
 */
function _readNewAgeType() {
  // Clear cache first so getCurrentAgeType re-reads Game.age.
  resetAgeCaches();
  return getCurrentAgeType();
}

/**
 * Whether an age boundary for `age` at age-local `turn` is already recorded
 * (the transition event fires once per pid; we dedupe on age + localTurn).
 * @param {*} history The persisted history blob.
 * @param {string} age The new age type.
 * @param {number} turn The age-local Game.turn at transition.
 * @returns {boolean} True if already recorded.
 */
function _ageBoundaryAlreadyRecorded(history, age, turn) {
  const arr = history && history.ageBoundaries;
  if (!Array.isArray(arr)) return false;
  // Same age + same age-local turn = same transition event (multiple pids
  // report it). We check `b.localTurn` (the age-local Game.turn) because
  // `b.turn` was switched to a GLOBAL value for chart alignment — checking
  // against that would always miss and we'd append a fresh boundary for every
  // per-pid transition event.
  return arr.some((b) => {
    if (!b || b.age !== age) return false;
    if (typeof b.localTurn === "number") return b.localTurn === turn;
    // Back-compat with old boundary entries that only had `.turn`.
    return b.turn === turn;
  });
}

/**
 * Identify the age that just FINISHED, given the new age starting at `turn`.
 * The boundary fires when `newAge` BEGINS; the finished age is the one just
 * before this turn in the (sorted) boundary list.
 * @param {*} h The persisted history blob.
 * @param {string} newAge The new age type.
 * @param {number} turn The age-local turn at transition.
 * @returns {string} The finished age type.
 */
function _resolveFinishedAge(h, newAge, turn) {
  const sorted = h.ageBoundaries
    .slice()
    .sort((/** @type {*} */ a, /** @type {*} */ b) => (a.turn || 0) - (b.turn || 0));
  const idx = sorted.findIndex((/** @type {*} */ b) => b.age === newAge && b.turn === turn);
  if (idx > 0) return sorted[idx - 1].age;
  return "AGE_ANTIQUITY"; // first transition — finishing antiquity
}

/**
 * Snapshot per-civ TRIUMPH counts from the most recent sample for each civ
 * (the age-end totals), keyed by pid.
 * @param {*} h The persisted history blob.
 * @returns {Record<string, object>} The pid → triumph-snapshot map.
 */
function _buildLegacySnapshot(h) {
  /** @type {Record<string, object>} */
  const snap = {};
  const samps = h.samples || [];
  for (let i = samps.length - 1; i >= 0; i--) {
    const s = samps[i];
    if (!s?.players) continue;
    for (const pid of Object.keys(s.players)) {
      if (snap[pid]) continue;
      const rec = _legacyRecordForPlayer(s.players[pid]);
      if (rec) snap[pid] = rec;
    }
  }
  return snap;
}

/**
 * Build a single age-end triumph record from a snapshot player entry.
 * @param {*} ps A snapshot player record.
 * @returns {object | undefined} The triumph record, or undefined if no metrics.
 */
function _legacyRecordForPlayer(ps) {
  const m = ps.metrics;
  if (!m) return undefined;
  return {
    triumphs_cultural: m.triumphs_cultural || 0,
    triumphs_diplomatic: m.triumphs_diplomatic || 0,
    triumphs_economic: m.triumphs_economic || 0,
    triumphs_scientific: m.triumphs_scientific || 0,
    triumphs_militaristic: m.triumphs_militaristic || 0,
    triumphs_expansionist: m.triumphs_expansionist || 0,
    leaderName: ps.leaderName,
    civName: ps.civName,
    leaderType: ps.leaderType
  };
}

/**
 * Persist the age boundary (deduped across the per-pid stream) plus the
 * age-end triumph snapshot, bumping the cumulative turn-offset bookkeeping.
 * @param {string | undefined} newAge The new age type.
 * @param {number} turn The age-local Game.turn at transition.
 * @returns {void}
 */
function recordAgeBoundary(newAge, turn) {
  const h = /** @type {WarHistory} */ (DemographicsStorage.load());
  if (!newAge || _ageBoundaryAlreadyRecorded(h, newAge, turn)) return;
  // Clear obsolete stored offset (no longer used — chart computes X at render
  // time from age + localTurn). This also gets rid of garbage values like
  // offset=235 baked into earlier corrupt saves.
  delete h.cumulativeTurnOffset;
  h.ageBoundaries.push({
    turn, // age-local Game.turn at transition
    localTurn: turn,
    age: newAge
  });
  ilog("ageBoundary: recorded", newAge, "at localTurn=", turn);
  // Snapshot per-civ TRIUMPH counts at this moment — values from the latest
  // sample for each civ are the age-end totals. Stored under
  // history.legacySnapshots[age] (the storage key is kept as `legacySnapshots`
  // for back-compat; the contained data is the new triumph-count shape).
  if (!h.legacySnapshots || typeof h.legacySnapshots !== "object") {
    h.legacySnapshots = {};
  }
  const finishedAge = _resolveFinishedAge(h, newAge, turn);
  const snap = _buildLegacySnapshot(h);
  h.legacySnapshots[finishedAge] = snap;
  DemographicsStorage.save(h);
  ilog(
    "appended ageBoundary turn=",
    turn,
    "age=",
    newAge,
    "legacySnapshot=",
    finishedAge,
    "civs=",
    Object.keys(snap).length
  );
}

/**
 * PlayerAgeTransitionComplete handler: resets caches, records the age boundary
 * once, and re-samples immediately so the new civ name lands in history.
 * @param {*} data The event payload (carries `player`).
 * @returns {void}
 */
function onPlayerAgeTransitionComplete(data) {
  if (disabled) return;
  try {
    const newAge = _readNewAgeType();
    const turn = getCurrentTurn() ?? -1;
    ilog("PlayerAgeTransitionComplete pid=", data && data.player, "newAge=", newAge, "turn=", turn);

    // Persist the boundary (dedupe across the per-pid stream).
    try {
      recordAgeBoundary(newAge, turn);
    } catch (e) {
      tripIfTooMany("appendAgeBoundary", e);
    }

    // Re-sample immediately so the new civ name lands in history right away.
    try {
      doSample();
    } catch (e) {
      tripIfTooMany("post-transition sample", e);
    }
  } catch (e) {
    tripIfTooMany("onPlayerAgeTransitionComplete", e);
  }
}

/**
 * Tear down any stale subscriptions left over from a prior game session. Both
 * engine.off calls are safe no-ops if nothing was registered.
 * @returns {void}
 */
function teardownStaleSubscriptions() {
  if (typeof engine !== "undefined" && typeof engine.off === "function") {
    try {
      if (handlerRef) engine.off("PlayerTurnActivated", handlerRef);
    } catch (e) {
      vlog("engine.off PlayerTurnActivated (stale) threw:", /** @type {*} */ (e)?.message);
    }
    try {
      if (_ageHandlerRef) engine.off("PlayerAgeTransitionComplete", _ageHandlerRef);
    } catch (e) {
      vlog("engine.off PlayerAgeTransitionComplete (stale) threw:", /** @type {*} */ (e)?.message);
    }
  }
}

/**
 * Reset every cross-load piece of sampler state to its fresh-game defaults and
 * seed the poll-cadence tracker from the most recent stored sample so a resume
 * kickoff doesn't re-record an already-stored turn.
 * @returns {void}
 */
function resetSamplerState() {
  handlerRef = null;
  _ageHandlerRef = null;
  started = false;
  // Clear any prior-session kill state — the new game deserves a fresh budget
  // of retries before we decide the sampler is broken.
  disabled = false;
  errorCount = 0;
  firstSampleSucceeded = false;
  // Seed the poll-cadence tracker from the most recent stored sample.
  try {
    const h = DemographicsStorage.load?.();
    if (h && Array.isArray(h.samples) && h.samples.length > 0) {
      const last = h.samples[h.samples.length - 1];
      if (last && typeof last.turn === "number") lastSampledTurn = last.turn;
    }
  } catch (_) {
    /* */
  }
}

/**
 * The deferred resume sample. Important: this runs AFTER the save's
 * GameTutorial properties have been deserialized (see startSampler comment),
 * so DemographicsStorage.load() reads the real persisted history rather than
 * clobbering it with a fresh first sample.
 * @returns {void}
 */
function runKickoff() {
  try {
    if (disabled) return;
    const curTurn = _curGameTurn();
    const storedCount = _storedSampleCount();
    ilog("startSampler runKickoff: storedCount=", storedCount, "curTurn=", curTurn);
    if (storedCount === 0 || shouldSampleThisTurn(curTurn)) {
      ilog("startSampler: kicking off resume sample for turn", curTurn);
      const snap = doSample();
      if (snap && typeof curTurn === "number") lastSampledTurn = curTurn;
    } else {
      ilog(
        "startSampler: skipping resume sample — turn",
        curTurn,
        "off-cadence; last sampled turn",
        lastSampledTurn
      );
    }
  } catch (e) {
    tripIfTooMany("resumeSample", e);
  }
}

/**
 * Read Game.turn defensively (raw, no safeCall).
 * @returns {number | undefined} The current turn, or undefined.
 */
function _curGameTurn() {
  return typeof Game !== "undefined" && typeof Game.turn === "number" ? Game.turn : undefined;
}

/**
 * Count stored samples, swallowing any storage error.
 * @returns {number} The number of stored samples (0 on failure).
 */
function _storedSampleCount() {
  try {
    return DemographicsStorage.load?.()?.samples?.length || 0;
  } catch (_) {
    return 0;
  }
}

/**
 * Register the PlayerTurnActivated + PlayerAgeTransitionComplete handlers and
 * schedule the deferred resume kickoff. Assumes state has already been reset.
 * @returns {void}
 */
function registerSamplerHandlers() {
  try {
    handlerRef = (/** @type {*} */ data) => onPlayerTurnActivated(data);
    engine.on("PlayerTurnActivated", handlerRef);
    _ageHandlerRef = (/** @type {*} */ data) => onPlayerAgeTransitionComplete(data);
    engine.on("PlayerAgeTransitionComplete", _ageHandlerRef);
    started = true;
    ilog(
      "subscribed to PlayerTurnActivated + PlayerAgeTransitionComplete",
      "(re-registered fresh on load, kill at",
      KILL_THRESHOLD,
      "errors)"
    );
    // Important: defer the kickoff sample until AFTER the game's save data has
    // actually been deserialized into GameTutorial. The map-tack mod (working
    // reference) uses Loading.runWhenLoaded for the same reason.
    // `engine.whenReady` only tells us the engine is alive, NOT that the
    // save's GameTutorial properties have been populated. If we sample before
    // that, DemographicsStorage.load() reads empty, we write a "fresh" first
    // sample, the save layer treats it as truth, and the real antiquity
    // history persisted in the save file gets clobbered — the root cause of
    // "no antiquity persistence across the age transition" (age transition is
    // a save→load cycle and we've been racing the deserializer).
    if (typeof Loading !== "undefined" && typeof Loading.runWhenLoaded === "function") {
      ilog("startSampler: deferring kickoff until Loading.runWhenLoaded");
      Loading.runWhenLoaded(runKickoff);
    } else {
      // Loading API unavailable — fall back to the timeout-based kickoff so we
      // don't break in test contexts.
      ilog("startSampler: Loading.runWhenLoaded unavailable; using 250ms timeout fallback");
      setTimeout(runKickoff, 250);
    }
  } catch (e) {
    elog("engine.on threw during startSampler:", e);
  }
}

/**
 * Start (or restart) the per-turn sampler. Saved-game load re-runs bootstrap →
 * calls startSampler() again. The sampler MODULE is cached for the lifetime of
 * the Coherent JS process, so module-scope state persists into the new game.
 * That used to make us refuse to re-register, carry a stale handler ref, and
 * honor a kill switch from the previous game — silently stopping recording on
 * the new save. We tear down stale subscriptions, reset every cross-load piece
 * of state, and always re-register fresh.
 * @returns {void}
 */
export function startSampler() {
  teardownStaleSubscriptions();
  resetSamplerState();

  if (typeof engine === "undefined" || typeof engine.on !== "function") {
    elog("engine.on unavailable; cannot start sampler");
    return;
  }
  registerSamplerHandlers();
}

/**
 * Whether the sampler has tripped its kill switch this session.
 * @returns {boolean} True if sampling is permanently disabled this session.
 */
export function isSamplerDisabled() {
  return disabled;
}

// On-demand sample so the modal can force a snapshot when it opens with
// an empty history.
/**
 * Force a snapshot on demand (e.g. when the modal opens with empty history).
 * @returns {Snapshot | null} The recorded snapshot, or null if disabled/failed.
 */
export function sampleNow() {
  if (disabled) {
    ilog("sampleNow called but sampler is disabled");
    return null;
  }
  try {
    ilog("sampleNow invoked");
    return doSample();
  } catch (e) {
    tripIfTooMany("sampleNow", e);
    return null;
  }
}
