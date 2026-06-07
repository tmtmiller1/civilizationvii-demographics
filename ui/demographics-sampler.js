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

import { METRICS } from "/demographics/ui/demographics-metrics.js";
import DemographicsStorage from "/demographics/ui/demographics-storage.js";
import { DemographicsSettings } from "/demographics/ui/demographics-settings.js";
import {
  buildPlayerCtx,
  buildMinorMilitaryCtx,
  getCurrentAgeType,
  resetAgeCaches
} from "/demographics/ui/sampler-collectors-core.js";
import { onPlayerAgeTransitionComplete } from "/demographics/ui/sampler-age-boundary.js";
import { runWarTracker } from "/demographics/ui/sampler-wars.js";
import { recordLocalTownsNow } from "/demographics/ui/screen-demographics/views/towns-history.js";
import {
  startFoundingTracker,
  recordSettlementsNow
} from "/demographics/ui/screen-demographics/settlements-trace.js";
import {
  getCumulativeCasualty,
  getCumulativeRazed,
  getCumulativeWarProd,
  getCumulativeCityWarNet,
  getCumulativeWarLand,
  startWarEventTracker,
  stopWarEventTracker,
  seedWarEventsFromHistory
} from "/demographics/ui/sampler-war-events.js";

/**
 * The per-civ context object assembled by {@link buildPlayerCtx} (defined in
 * sampler-collectors.js). Re-imported here so the snapshot pipeline can stay
 * typed without duplicating the shape.
 * @typedef {import("/demographics/ui/sampler-collectors-core.js").PlayerCtx} PlayerCtx
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
    // DemographicsSettings.getSetting() reads localStorage, which can be absent
    // / throw in the sandbox; fall back to sampling every turn.
  }
  return 1;
}

// Track the last turn we actually recorded a snapshot on so the throttle
// stays correct across (a) save/load round-trips and (b) settings changes
// - we don't want the user to switch from "every 5 turns" to "every 2"
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
      vlog("engine.off PlayerAgeTransitionComplete threw:", /** @type {*} */ (e)?.message);
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
 * Get the list of alive MINOR (city-state / independent) player ids,
 * defensively. Used to sample city-state war allies' military power.
 * @returns {number[]} The minor ids, or an empty array on any failure.
 */
function getAliveMinorIds() {
  return (
    safeCall("Players.getAlive() minors", () => {
      if (typeof Players === "undefined" || typeof Players.getAlive !== "function") return [];
      const all = Players.getAlive() || [];
      /** @type {number[]} */
      const out = [];
      for (const p of all) {
        try {
          if (p && p.isMinor === true && typeof p.id === "number") out.push(p.id);
        } catch (_) {
          // A stale handle's isMinor accessor can throw; skip that player.
        }
      }
      return out;
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
// per-civ chart pipeline can plot them (every civ gets the same line - by
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
        // Configuration.getGame().getValue(k) can throw on unknown keys; try the
        // next candidate key.
      }
    }
    return undefined;
  });
}

/**
 * Read the crisis stage / trigger percents off Game.CrisisManager into `out`.
 * @param {GlobalAgeContext} out The context to mutate.
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
      // cm.getCrisisStageTriggerPercent(0, st) can throw for out-of-range stages;
      // skip this stage and keep the max seen so far.
    }
  }
}

/**
 * Read the age-progress percentage off Game.AgeProgressManager into `out`.
 * @param {GlobalAgeContext} out The context to mutate.
 */
function readAgeProgress(out) {
  const apm = typeof Game !== "undefined" ? Game.AgeProgressManager : null;
  if (!apm) return;
  let cur, max;
  try {
    cur = apm.getCurrentAgeProgressionPoints();
  } catch (_) {
    // apm.getCurrentAgeProgressionPoints() can throw mid age-transition; leave
    // cur undefined so the pct stays unset.
  }
  try {
    max = apm.getMaxAgeProgressionPoints();
  } catch (_) {
    // apm.getMaxAgeProgressionPoints() can throw mid age-transition; leave max
    // undefined so the pct stays unset.
  }
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
    readCrisisManager(out);
    readAgeProgress(out);
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
 * panel-system-bar.js.
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
            elog("scale fn threw for", m.id, e);
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
    // Home continent (capital's landmass) for war-naming geography.
    continent: ctx.continent,
    metrics,
    // List of ConstructibleType strings for completed wonders this civ owns
    // at this turn. Used by the chart's wonder-marker plugin to diff against
    // the prior sample and identify which SPECIFIC wonder was completed (so
    // we can show its icon, name and a tooltip).
    wonderTypes: Array.isArray(ctx.wonderTypes) ? ctx.wonderTypes : undefined
  };
}

/**
 * Stamp the event-based war metrics onto a player's computed metrics for this
 * sample: cumulative strength lost, settlements razed, production directed to
 * war, net capture balance, and raw population.
 * @param {Record<string, number>} metrics The computed metrics to augment.
 * @param {number} pid The player id.
 * @param {*} ctx The player sample context.
 * @returns {void}
 */
function stampWarMetrics(metrics, pid, ctx) {
  // Cumulative combat strength this civ has lost to unit kills (from the
  // event-based casualty tracker). Monotonic; the war tooltip reads its
  // increase over a war window as that side's true power lost.
  metrics.milLostCum = getCumulativeCasualty(pid);
  // Cumulative settlements permanently razed out from under this civ.
  metrics.razedCum = getCumulativeRazed(pid);
  // Cumulative production this civ directed to war (military units + buildings).
  metrics.warProdCum = getCumulativeWarProd(pid);
  // Net cities won-minus-lost via capture (founding excluded).
  metrics.cityWarNetCum = getCumulativeCityWarNet(pid);
  // Net territory (km²) won-minus-lost via capture - the land actually taken in
  // war, unlike the Land Area line which also moves with peaceful expansion.
  metrics.warLandCum = getCumulativeWarLand(pid);
  // RAW total population (actual citizens). The line chart's `population`
  // metric is a non-linear, turn-inflated "scaled millions" figure whose turn
  // factor (1.009^turn) masks real drops - so war "population lost" is computed
  // from this raw count instead.
  if (typeof ctx.totalPopulation === "number" && isFinite(ctx.totalPopulation)) {
    metrics.populationRaw = ctx.totalPopulation;
  }
}

/**
 * Sample every alive minor (city-state / independent) player's military power +
 * cumulative power lost into a lightweight map, so the Conflicts views can show
 * city-state war allies' strength over time. Returns null when there are none.
 * @returns {Record<string, *> | null} pid -> { civName, leaderTypeString, primaryColor, metrics }, or null.
 */
function sampleMinors() {
  const ids = getAliveMinorIds();
  if (!ids.length) return null;
  /** @type {Record<string, *>} */
  const out = {};
  for (const pid of ids) {
    const ctx = buildMinorMilitaryCtx(pid);
    out[pid] = {
      civName: ctx.civName,
      leaderTypeString: ctx.leaderTypeString,
      primaryColor: ctx.primaryColor,
      metrics: {
        milpower: typeof ctx.militaryPower === "number" ? ctx.militaryPower : 0,
        milLostCum: getCumulativeCasualty(pid)
      }
    };
  }
  return out;
}

/**
 * High-resolution timestamp in ms (0 when unavailable). Used only for the
 * per-sample performance log.
 * @returns {number} The current time in ms.
 */
function perfNow() {
  try {
    return typeof performance !== "undefined" && performance.now ? performance.now() : 0;
  } catch (_) {
    return 0;
  }
}

/**
 * Log one sample's wall-clock cost, broken into work (majors + minors), the
 * storage write, and the war tracker, plus the counts that drive each. Read
 * these lines off the in-game log (UI.log) to gauge real performance on a save.
 * @param {{ start: number, work: number, write: number, end: number }} t Phase timestamps.
 * @param {{ players: number, minors: number, samples: number }} counts Size counts.
 */
function logSampleTiming(t, counts) {
  ilog(
    "perf doSample total=" + (t.end - t.start).toFixed(1) + "ms",
    "(majors+minors=" + (t.work - t.start).toFixed(1) +
      " write=" + (t.write - t.work).toFixed(1) +
      " warTracker=" + (t.end - t.write).toFixed(1) + ")",
    "players=" + counts.players,
    "minors=" + counts.minors,
    "storedSamples=" + counts.samples
  );
}

/**
 * Take one snapshot: sample every alive major player, persist it, and update
 * the war tracker. Returns the snapshot, or null if skipped/too-few-players.
 * @returns {Snapshot | null} The recorded snapshot, or null.
 */
/**
 * Record the auxiliary per-settlement history (local-town trends + Top Cities
 * founding/population window) for this sample. Each call is defensively wrapped
 * so it can never throw the sample.
 * @param {number} chartTurn The monotonic sample turn.
 * @param {string|undefined} gameYear The sample's game-year string.
 */
function recordAuxHistory(chartTurn, gameYear) {
  safeCall("recordLocalTownsNow", () => recordLocalTownsNow(chartTurn));
  safeCall("recordSettlementsNow", () => recordSettlementsNow(chartTurn, gameYear));
}

function doSample() {
  const localTurn = getCurrentTurn() ?? -1;
  const ids = getAliveMajorIds();
  if (ids.length < 2) {
    ilog("skip sample: too few alive players (", ids.length, ") at localTurn=", localTurn);
    return null;
  }
  const tStart = perfNow();
  const globalAge = getGlobalAgeContext();
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
  const turn = localTurn;
  // Capture the in-game date label for this turn so chart x-axis labels can
  // show e.g. "T-52 / 2725 BCE".
  const gameYear = readGameYear();
  /** @type {Snapshot} */
  const snapshot = {
    turn,
    localTurn,
    chartTurn,
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
    stampWarMetrics(metrics, pid, ctx);
    players[pid] = buildSnapshotPlayer(ctx, metrics);
  }
  // City-state / independent military power (+ power lost) for the Conflicts
  // views; stored apart from `players` so the per-civ line charts never see it.
  const minors = sampleMinors();
  if (minors) snapshot.minors = minors;
  // Append the local player's town populations to the Town Advisor's rolling
  // trend window (independent of the sample stream; never throws the sample).
  recordAuxHistory(chartTurn, gameYear);
  const tWork = perfNow();
  let storedSamples = 0;
  try {
    const h = DemographicsStorage.appendSample(snapshot);
    storedSamples = h && Array.isArray(h.samples) ? h.samples.length : 0;
  } catch (e) {
    tripIfTooMany("DemographicsStorage.appendSample", e);
  }
  const tWrite = perfNow();
  runWarTracker(snapshot, turn);
  const minorCount = minors ? Object.keys(minors).length : 0;
  const counts = { players: Object.keys(players).length, minors: minorCount, samples: storedSamples };
  logSampleTiming({ start: tStart, work: tWork, write: tWrite, end: perfNow() }, counts);
  return snapshot;
}

/**
 * Compute a monotonic chart turn for the next sample.
 *
 * This value is persisted per sample and preferred by chart-axis mapping to
 * avoid horizontal drift when older samples are decimated. Within the same
 * age, spacing follows local-turn deltas; across age boundaries it advances by
 * at least one turn and usually by the new age-local turn.
 * @param {string | undefined} ageType The current age type.
 * @param {number} localTurn The current age-local turn.
 * @returns {number} Monotonic chart turn.
 */
function computeChartTurn(ageType, localTurn) {
  const lt = positiveLocalTurn(localTurn);
  /** @type {WarHistory | null} */
  let h = null;
  try {
    h = /** @type {WarHistory} */ (DemographicsStorage.load());
  } catch (_) {
    return lt;
  }
  const samps = h && Array.isArray(h.samples) ? h.samples : [];
  if (samps.length === 0) return lt;
  const { chartTurn, age, localTurn: lastLocal } = lastSampleChartState(samps);
  if (isSameAgeContinuation(age, ageType, lastLocal)) {
    const delta = lt - (lastLocal ?? 0);
    return chartTurn + (delta >= 0 ? delta : 1);
  }
  return chartTurn + Math.max(1, lt);
}

/**
 * Coerce a value to a finite number, or null.
 * @param {*} v The candidate value.
 * @returns {number|null} The finite number, or null.
 */
function finiteOrNull(v) {
  return typeof v === "number" && isFinite(v) ? v : null;
}

/**
 * Resolve a positive, finite age-local turn, defaulting to 1.
 * @param {*} localTurn The candidate local turn.
 * @returns {number} A positive finite turn (>= 1).
 */
function positiveLocalTurn(localTurn) {
  const n = finiteOrNull(localTurn);
  return n !== null && n > 0 ? n : 1;
}

/**
 * Extract the latest sample's chart-turn / age / local-turn. `turn` is the
 * fallback for chartTurn and localTurn (legacy samples lacked those fields).
 * @param {*[]} samps The (non-empty) sample stream.
 * @returns {{ chartTurn: number, age: (string|null), localTurn: (number|null) }} The state.
 */
function lastSampleChartState(samps) {
  const last = samps[samps.length - 1] || {};
  const turn = finiteOrNull(last.turn);
  const chartTurn = finiteOrNull(last.chartTurn) ?? turn ?? 0;
  const localTurn = finiteOrNull(last.localTurn) ?? turn;
  const age = typeof last.age === "string" ? last.age : null;
  return { chartTurn, age, localTurn };
}

/**
 * Whether the new turn continues the SAME age as the last sample (so the chart
 * turn advances by the local-turn delta rather than starting a fresh age).
 * @param {string|null} lastAge The last sample's age.
 * @param {string|undefined} ageType The current age type.
 * @param {number|null} lastLocal The last sample's local turn.
 * @returns {boolean} True for a same-age continuation.
 */
function isSameAgeContinuation(lastAge, ageType, lastLocal) {
  return !!(lastAge && ageType && lastAge === ageType && typeof lastLocal === "number");
}

/**
 * PlayerTurnActivated handler: samples the local player's turn, honoring the
 * kill switch and the configured polling cadence.
 * @param {*} data The event payload (carries `player`/`playerID`).
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
    // silently skipped - the in-game turn still advances, we just don't write
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
 */
function _noteSampleSucceeded(curTurn) {
  if (typeof curTurn === "number") lastSampledTurn = curTurn;
  if (!firstSampleSucceeded) {
    firstSampleSucceeded = true;
    DEMOGRAPHICS_DEBUG = false; // downgrade verbosity after first success
    ilog("first sample SUCCEEDED; downgrading log verbosity for subsequent turns");
  }
}

/**
 * Tear down any stale subscriptions left over from a prior game session. Both
 * engine.off calls are safe no-ops if nothing was registered.
 */
function teardownStaleSubscriptions() {
  _teardown();
}

/**
 * Reset every cross-load piece of sampler state to its fresh-game defaults and
 * seed the poll-cadence tracker from the most recent stored sample so a resume
 * kickoff doesn't re-record an already-stored turn.
 */
function resetSamplerState() {
  handlerRef = null;
  _ageHandlerRef = null;
  // Clear any prior-session kill state - the new game deserves a fresh budget
  // of retries before we decide the sampler is broken.
  disabled = false;
  errorCount = 0;
  firstExceptionLogged = false;
  firstException = null;
  firstSampleSucceeded = false;
  // Seed the poll-cadence tracker from the most recent stored sample.
  try {
    const h = DemographicsStorage.load?.();
    if (h && Array.isArray(h.samples) && h.samples.length > 0) {
      const last = h.samples[h.samples.length - 1];
      if (last && typeof last.turn === "number") lastSampledTurn = last.turn;
    }
    // Seed cumulative casualty totals from history so they survive a fresh JS
    // process (full game restart) and the sampled milLostCum series stays
    // monotonic across the load.
    seedWarEventsFromHistory(h?.samples);
  } catch (_) {
    // DemographicsStorage.load() can throw before the player bag is ready; leave
    // lastSampledTurn at its default so the first turn samples normally.
  }
}

/**
 * The deferred resume sample. Important: this runs AFTER the save's
 * GameTutorial properties have been deserialized (see startSampler comment),
 * so DemographicsStorage.load() reads the real persisted history rather than
 * clobbering it with a fresh first sample.
 */
function runKickoff() {
  try {
    if (disabled) return;
    const curTurn = _curGameTurn();
    const storedCount = _storedSampleCount();
    ilog("startSampler runKickoff: storedCount=", storedCount, "curTurn=", curTurn);
    // SPIKE: always-on kickoff decision (REMOVE after the save/reload test).
    try {
      console.warn("[Demographics.persist-spike] kickoff: storedCount=" + storedCount +
        " curTurn=" + curTurn + " willSample=" + (storedCount === 0 || shouldSampleThisTurn(curTurn)));
    } catch (_) { /* diagnostic only */ }
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
    // DemographicsStorage.load() can throw before the player bag is ready; treat
    // as zero stored samples.
    return 0;
  }
}

/** @type {import("/demographics/ui/sampler-age-boundary.js").AgeBoundaryDeps} */
const AGE_BOUNDARY_DEPS = {
  resetAgeCaches,
  getCurrentAgeType,
  loadHistory: () => /** @type {WarHistory} */ (DemographicsStorage.load()),
  saveHistory: (history) => DemographicsStorage.save(history),
  ilog,
  tripIfTooMany,
  doSample,
  getCurrentTurn,
  isDisabled: () => disabled
};

/**
 * Register the PlayerTurnActivated + PlayerAgeTransitionComplete handlers and
 * schedule the deferred resume kickoff. Assumes state has already been reset.
 */
function registerSamplerHandlers() {
  try {
    _teardown();
    handlerRef = (/** @type {*} */ data) => onPlayerTurnActivated(data);
    engine.on("PlayerTurnActivated", handlerRef);
    _ageHandlerRef = (/** @type {*} */ data) =>
      onPlayerAgeTransitionComplete(data, AGE_BOUNDARY_DEPS);
    engine.on("PlayerAgeTransitionComplete", _ageHandlerRef);
    // Begin event-based military casualty tracking for this (re)load.
    startWarEventTracker();
    // Begin exact-founding tracking (CityAddedToMap) for the Top Cities cards.
    startFoundingTracker();
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
    // history persisted in the save file gets clobbered - the root cause of
    // "no antiquity persistence across the age transition" (age transition is
    // a save→load cycle and we've been racing the deserializer).
    if (typeof Loading !== "undefined" && typeof Loading.runWhenLoaded === "function") {
      ilog("startSampler: deferring kickoff until Loading.runWhenLoaded");
      Loading.runWhenLoaded(runKickoff);
    } else {
      // Loading API unavailable - fall back to the timeout-based kickoff so we
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
 * honor a kill switch from the previous game - silently stopping recording on
 * the new save. We tear down stale subscriptions, reset every cross-load piece
 * of state, and always re-register fresh.
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
  disabled = false;
  errorCount = 0;
  firstExceptionLogged = false;
  firstException = null;
  firstSampleSucceeded = false;
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
