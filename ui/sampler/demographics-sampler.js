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
//   Stats.getNetYield(YieldTypes.YIELD_*)         - diplo-ribbon/model-diplo-ribbon.js
//   Stats.numSettlements / settlementCap          - same file
//   Stats.numCities / numTowns / totalPopulation  - same file
//   Treasury.getGoldBalance() / goldBalance       - advice/advice-support.js
//   Cities.getCities()                            - pre-existing
//   city.getPurchasedPlots()                      - city-zoomer/city-zoomer.js
//   Trade.countPlayerTradeRoutes()                - age-antiquity tutorial
//   Game.Diplomacy.getPlayerEvents(playerId)      - diplomacy-actions panel
//   player.Stats.getNumWonders(orig, currentAge)  - advice/advice-support.js
//   player.Units.getUnitIds() + Units.get(id)     - age-antiquity tutorial
//   GameInfo.Unit_Stats[].Combat joined on UnitType
//                                                  - civilopedia-sidebar-panels.js
//   FormationClass classifier (LAND_COMBAT / NAVAL / AIR → military)
//                                                  - interface-mode-unit-selected.js
//   Techs.getTreeType() + Game.ProgressionTrees.getTree(pid, treeType).nodes
//                                                  - tutorial/tutorial-support.js
//   Culture: analogous via player.Culture.getTreeType()
//   ProgressionTreeNodeState.NODE_STATE_FULLY_UNLOCKED = "researched"
//                                                  - tree-grid/tree-grid.js

import DemographicsStorage from "/demographics/ui/storage/demographics-storage.js";
import { DemographicsSettings } from "/demographics/ui/core/demographics-settings.js";
import { computeChartTurn } from "/demographics/ui/sampler/sampler-chart-turn.js";
import {
  getCurrentTurn,
  getGlobalAgeContext,
  readGameYear
} from "/demographics/ui/sampler/sampler-age-context.js";
import { readCurrentTurnRaw } from "/demographics/ui/sampler/sampler-game-readers.js";
import {
  resolvePollEveryNTurns,
  shouldSampleTurn
} from "/demographics/ui/sampler/sampler-turn-gate.js";
import {
  localSamplingContextFromEvent
} from "/demographics/ui/sampler/sampler-event-gate.js";
import {
  getAliveMajorIds,
  getAliveMinorIds
} from "/demographics/ui/sampler/sampler-player-ids.js";
import {
  commitSample,
  finalizeSampleLifecycle,
  logSampleTiming,
  perfNow,
  persistSnapshot,
  recordAuxHistory
} from "/demographics/ui/sampler/sampler-sample-lifecycle.js";
import {
  loadStoredSampleCount,
  noteSampleSucceeded,
  resetKillSwitchState,
  resetSamplerRuntimeState,
  runResumeKickoff
} from "/demographics/ui/sampler/sampler-runtime-state.js";
import { registerSamplerHandlers as registerSamplerHandlersCore } from "/demographics/ui/sampler/sampler-registration.js";
import { handlePlayerTurnActivated } from "/demographics/ui/sampler/sampler-turn-handler.js";
import { buildAgeBoundaryDeps } from "/demographics/ui/sampler/sampler-age-boundary-deps.js";
import {
  buildPlayerCtx,
  buildMinorMilitaryCtx,
  getCurrentAgeType,
  resetAgeCaches
} from "/demographics/ui/sampler/sampler-collectors-core.js";
import { onPlayerAgeTransitionComplete } from "/demographics/ui/sampler/sampler-age-boundary.js";
import { runWarTracker } from "/demographics/ui/sampler/sampler-wars-core.js";
import { recordLocalTownsNow } from "/demographics/ui/screen-demographics/views/settlements/towns-history.js";
import {
  startFoundingTracker,
  recordSettlementsNow
} from "/demographics/ui/screen-demographics/settlements/settlements-trace.js";
import {
  getCumulativeCasualty,
  startWarEventTracker,
  stopWarEventTracker,
  seedWarEventsFromHistory
} from "/demographics/ui/sampler/sampler-war-events.js";
import {
  buildSnapshotPlayer,
  computeMetrics,
  stampWarMetrics
} from "/demographics/ui/sampler/sampler-snapshot-helpers.js";
import { buildMinorSnapshots } from "/demographics/ui/sampler/sampler-minors.js";
import { buildMajorPlayerSnapshots } from "/demographics/ui/sampler/sampler-players.js";
import { buildSamplerSnapshot } from "/demographics/ui/sampler/sampler-snapshot-build.js";

/**
 * The per-civ context object assembled by {@link buildPlayerCtx} (defined in
 * sampler-collectors.js). Re-imported here so the snapshot pipeline can stay
 * typed without duplicating the shape.
 * @typedef {import("/demographics/ui/sampler/sampler-collectors-core.js").PlayerCtx} PlayerCtx
 */

/**
 * The persisted history blob as the sampler sees it: the shared {@link
 * DemoHistory} fields plus the sampler's own runtime extensions (`wars`,
 * `legacySnapshots`, the obsolete `cumulativeTurnOffset`). Re-imported from
 * sampler-wars.js, which owns the war-record schema.
 * @typedef {import("/demographics/ui/sampler/sampler-wars.js").WarHistory} WarHistory
 */

// How many turns between samples. Resolved from the user setting each call
// so a runtime change in the Options panel takes effect on the next turn
// without needing to restart the sampler.
// Track the last turn we actually recorded a snapshot on so the throttle
// stays correct across (a) save/load round-trips and (b) settings changes
// - we don't want the user to switch from "every 5 turns" to "every 2"
// and immediately get a duplicate sample on the same turn.
let lastSampledTurn = -1;

let DEMOGRAPHICS_DEBUG = false;
/**
 * Verbose debug logger; no-op unless {@link DEMOGRAPHICS_DEBUG} is set.
 * @param {...*} a Values to log.
 */
function vlog(...a) {
  if (DEMOGRAPHICS_DEBUG) console.warn("[Demographics.sampler]", ...a);
}
/**
 * Informational logger; no-op unless {@link DEMOGRAPHICS_DEBUG} is set.
 * @param {...*} a Values to log.
 */
function ilog(...a) {
  if (DEMOGRAPHICS_DEBUG) console.warn("[Demographics.sampler]", ...a);
}
/**
 * Error logger; always emits.
 * @param {...*} a Values to log.
 */
function elog(...a) {
  console.error("[Demographics.sampler]", ...a);
}

// ---- kill switch ---------------------------------------------------------
let errorCount = 0;
const KILL_THRESHOLD = 3;
let disabled = false;
let firstSampleSucceeded = false;
let firstExceptionLogged = false;
/** @type {*} */
let handlerRef = null;
/** @type {*} */
let _ageHandlerRef = null;

/** @type {{ label: string, stack: string } | null} */
let firstException = null;

/**
 * Drain every sampler-owned engine subscription.
 */
function _teardown() {
  if (typeof engine !== "undefined" && typeof engine.off === "function") {
    try {
      if (handlerRef) engine.off("PlayerTurnActivated", handlerRef);
    } catch (e) {
      vlog("engine.off PlayerTurnActivated threw:", /** @type {*} */ (e)?.message);
    }
    try {
      if (_ageHandlerRef) engine.off("PlayerAgeTransitionComplete", _ageHandlerRef);
    } catch (e) {
      vlog(
        "engine.off PlayerAgeTransitionComplete threw:",
        /** @type {*} */ (e)?.message
      );
    }
  }
  handlerRef = null;
  _ageHandlerRef = null;
  stopWarEventTracker();
}

/**
 * Build a full stack string from any thrown value.
 * @param {*} err The thrown value.
 * @returns {string} Best-effort stack/message text.
 */
function fullErrorStack(err) {
  if (err && typeof err.stack === "string" && err.stack.length > 0) {
    return err.stack;
  }
  if (err && typeof err.message === "string" && err.message.length > 0) {
    return err.message;
  }
  try {
    return String(err);
  } catch (_) {
    return "<unprintable error>";
  }
}

/**
 * Increment the error counter and, once it reaches {@link KILL_THRESHOLD},
 * permanently disable sampling and unsubscribe for this session.
 * @param {string} label A label identifying where the error occurred.
 * @param {*} e The thrown error.
 */
function tripIfTooMany(label, e) {
  if (!firstExceptionLogged) {
    firstExceptionLogged = true;
    firstException = { label, stack: fullErrorStack(e) };
    elog("first sampler exception in accessor:", label, "\n" + firstException.stack);
  }
  errorCount++;
  elog("error in", label, "errorCount=", errorCount, "/", KILL_THRESHOLD, "err:", e);
  if (errorCount >= KILL_THRESHOLD) {
    ilog("kill switch tripped, disabling sampling permanently for this session");
    disabled = true;
    try {
      _teardown();
    } catch (e2) {
      elog("engine.off threw during kill:", e2);
    }
    try {
      DemographicsStorage.teardown?.();
    } catch (e3) {
      elog("DemographicsStorage.teardown threw during kill:", e3);
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

// ---- the sampler ---------------------------------------------------------

/**
 * Take one snapshot: sample every alive major player, persist it, and update
 * the war tracker. Returns the snapshot, or null if skipped/too-few-players.
 * @returns {Snapshot | null} The recorded snapshot, or null.
 */
/**
 * Build and persist one sampling snapshot when enough major civs are alive.
 * @returns {Snapshot | null} The recorded snapshot, or null when skipped.
 */
function doSample() {
  const localTurn = getCurrentTurn(safeCall) ?? -1;
  const ids = getAliveMajorIds(safeCall);
  if (ids.length < 2) {
    ilog("skip sample: too few alive players (", ids.length, ") at localTurn=", localTurn);
    return null;
  }
  const tStart = perfNow();
  const globalAge = getGlobalAgeContext(safeCall);
  const ageType = getCurrentAgeType();
  const chartTurn = computeChartTurn(ageType, localTurn);
  // Each sample is stamped with:
  //   localTurn - Game.turn at sample time (age-local; resets per age)
  //   age       - current age type
  //   chartTurn - monotonic chart-X turn persisted for stability when older
  //               samples are capped/decimated
  //   turn      - same as localTurn (no precomputed offset). The chart
  //               computes the GLOBAL X position at render time by
  //               walking all samples to build per-age offsets:
  //                 X(sample) = offsets[sample.age] + sample.localTurn
  //               This is robust to any historical offset corruption -
  //               we don't store stateful offsets that can drift.
  // `turn` mirrors localTurn (no precomputed offset). The chart derives the
  // GLOBAL X at render time: X(sample) = offsets[sample.age] + sample.localTurn,
  // so no stateful per-age offset is stored (robust to historical drift).
  // gameYear is the in-game date label for x-axis ticks (e.g. "T-52 / 2725 BCE").
  const gameYear = readGameYear(safeCall);
  /** @type {Snapshot} */
  const snapshot = /** @type {*} */ (buildSamplerSnapshot({
    localTurn,
    chartTurn,
    ageType,
    gameYear,
    globalAge,
    ids,
    buildMajorPlayerSnapshots,
    buildPlayerCtx,
    computeMetrics: (ctx, turn) => computeMetrics(ctx, turn, tripIfTooMany, elog),
    stampWarMetrics,
    buildSnapshotPlayer
  }));
  // City-state / independent military power (+ power lost) for the Conflicts
  // views; stored apart from `players` so the per-civ line charts never see it.
  const minors = buildMinorSnapshots(
    getAliveMinorIds(safeCall),
    buildMinorMilitaryCtx,
    getCumulativeCasualty
  );
  if (minors) snapshot.minors = minors;
  // Append the local player's town populations to the rolling trend window
  // (independent of the sample stream; never throws the sample).
  recordAuxHistory(
    safeCall,
    {
      recordLocalTownsNow,
      recordSettlementsNow,
      setSettings: (entries) => DemographicsSettings.setSettings(entries)
    },
    chartTurn,
    gameYear
  );
  finalizeSample(snapshot, localTurn, tStart, minors ? Object.keys(minors).length : 0);
  return snapshot;
}

/**
 * Persist the snapshot, run the war tracker, and log sample timing.
 * @param {Snapshot} snapshot The built snapshot.
 * @param {number} turn The sample turn.
 * @param {number} tStart The sample start time (perfNow).
 * @param {number} minorCount The number of sampled minors.
 */
function finalizeSample(snapshot, turn, tStart, minorCount) {
  finalizeSampleLifecycle(snapshot, turn, tStart, minorCount, {
    perfNow,
    persistSnapshot: (builtSnapshot) =>
      persistSnapshot(DemographicsStorage, tripIfTooMany, builtSnapshot),
    runWarTracker,
    commitSample: (history) => commitSample(DemographicsStorage, tripIfTooMany, history),
    logSampleTiming: (timings, counts) => logSampleTiming(ilog, timings, counts)
  });
}

/**
 * PlayerTurnActivated handler: samples the local player's turn, honoring the
 * kill switch and the configured polling cadence.
 * @param {*} data The event payload (carries `player`/`playerID`).
 */
function onPlayerTurnActivated(data) {
  handlePlayerTurnActivated({
    data,
    isDisabled: () => disabled,
    localSamplingContextFromEvent,
    getLocalPlayerID,
    getCurrentTurnRaw: readCurrentTurnRaw,
    shouldSampleTurn,
    resolvePollEveryNTurns: () =>
      resolvePollEveryNTurns((key, fallback) =>
        DemographicsSettings.getSetting(key, fallback)
      ),
    getLastSampledTurn: () => lastSampledTurn,
    vlog,
    doSample,
    noteSampleSucceeded: (curTurn) => {
      noteSampleSucceeded(curTurn, {
        setLastSampledTurn: (v) => {
          lastSampledTurn = v;
        },
        firstSampleSucceeded: () => firstSampleSucceeded,
        setFirstSampleSucceeded: (v) => {
          firstSampleSucceeded = v;
        },
        setDebugEnabled: (v) => {
          DEMOGRAPHICS_DEBUG = v;
        },
        ilog
      });
    },
    tripIfTooMany
  });
}

/**
 * Reset every cross-load piece of sampler state to its fresh-game defaults and
 * seed the poll-cadence tracker from the most recent stored sample so a resume
 * kickoff doesn't re-record an already-stored turn.
 */
function resetSamplerState() {
  resetSamplerRuntimeState({
    storage: DemographicsStorage,
    setHandlerRef: (v) => {
      handlerRef = v;
    },
    setAgeHandlerRef: (v) => {
      _ageHandlerRef = v;
    },
    setDisabled: (v) => {
      disabled = v;
    },
    setErrorCount: (v) => {
      errorCount = v;
    },
    setFirstExceptionLogged: (v) => {
      firstExceptionLogged = v;
    },
    setFirstException: (v) => {
      firstException = v;
    },
    setFirstSampleSucceeded: (v) => {
      firstSampleSucceeded = v;
    },
    setLastSampledTurn: (v) => {
      lastSampledTurn = v;
    },
    seedWarEventsFromHistory
  });
}

/**
 * The deferred resume sample. Important: this runs AFTER the save's
 * GameTutorial properties have been deserialized (see startSampler comment),
 * so DemographicsStorage.load() reads the real persisted history rather than
 * clobbering it with a fresh first sample.
 */
function runKickoff() {
  runResumeKickoff({
    isDisabled: () => disabled,
    getCurrentTurnRaw: readCurrentTurnRaw,
    getStoredSampleCount: () => loadStoredSampleCount(DemographicsStorage),
    resolvePollEveryNTurns: () =>
      resolvePollEveryNTurns((key, fallback) =>
        DemographicsSettings.getSetting(key, fallback)
      ),
    shouldSampleTurn,
    getLastSampledTurn: () => lastSampledTurn,
    ilog,
    doSample,
    setLastSampledTurn: (v) => {
      lastSampledTurn = v;
    },
    tripIfTooMany
  });
}

/**
 * Register the PlayerTurnActivated + PlayerAgeTransitionComplete handlers and
 * schedule the deferred resume kickoff. Assumes state has already been reset.
 */
function registerSamplerHandlers() {
  const ageBoundaryDeps = buildAgeBoundaryDeps({
    resetAgeCaches,
    getCurrentAgeType,
    storage: {
      load: () => /** @type {WarHistory} */ (DemographicsStorage.load()),
      save: (history) => DemographicsStorage.save(history)
    },
    ilog,
    tripIfTooMany,
    doSample,
    getCurrentTurn: () => getCurrentTurn(safeCall),
    isDisabled: () => disabled
  });

  registerSamplerHandlersCore({
    teardown: _teardown,
    setTurnHandlerRef: (handler) => {
      handlerRef = handler;
    },
    setAgeHandlerRef: (handler) => {
      _ageHandlerRef = handler;
    },
    onPlayerTurnActivated,
    onPlayerAgeTransitionComplete,
    ageBoundaryDeps,
    startWarEventTracker,
    startFoundingTracker,
    ilog,
    elog,
    killThreshold: KILL_THRESHOLD,
    runKickoff
  });
}

/**
 * Start (or restart) the per-turn sampler. Saved-game load re-runs bootstrap →
 * calls startSampler() again. The sampler MODULE is cached for the lifetime of
 * the Coherent JS process, so module-scope state persists into the new game.
 * That used to make us refuse to re-register, carry a stale handler ref, and
 * honor a kill switch from the previous game - silently stopping recording on
 * the new save. We tear down stale subscriptions, reset every cross-load piece
 * of state, and always re-register fresh.
 */
export function startSampler() {
  _teardown();
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

/**
 * First exception captured by the kill-switch path this session.
 * @returns {{ label: string, stack: string } | null} Accessor + stack, or null.
 */
export function getSamplerFirstException() {
  return firstException;
}

/**
 * Manually re-enable the sampler after a kill-switch trip.
 * @returns {boolean} True when re-enabled or already active, false on failure.
 */
export function reenableSampler() {
  if (!disabled) return true;
  resetKillSwitchState({
    setDisabled: (v) => {
      disabled = v;
    },
    setErrorCount: (v) => {
      errorCount = v;
    },
    setFirstExceptionLogged: (v) => {
      firstExceptionLogged = v;
    },
    setFirstException: (v) => {
      firstException = v;
    },
    setFirstSampleSucceeded: (v) => {
      firstSampleSucceeded = v;
    }
  });
  try {
    DemographicsStorage.load?.();
    registerSamplerHandlers();
    return true;
  } catch (e) {
    disabled = true;
    elog("reenableSampler failed:", e);
    return false;
  }
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
