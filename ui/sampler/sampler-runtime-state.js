// sampler-runtime-state.js
//
// Runtime state bookkeeping helpers for sampler reset and resume kickoff.

/**
 * Count stored samples defensively.
 * @param {{ load?: () => any }} storage Sampler storage adapter.
 * @returns {number} Number of persisted samples (0 on failure).
 */
export function loadStoredSampleCount(storage) {
  try {
    return storage.load?.()?.samples?.length || 0;
  } catch (_) {
    return 0;
  }
}

/**
 * Reset cross-load sampler state and seed last sampled turn from history.
 * @param {{
 *   storage: { load?: () => any },
 *   setHandlerRef: (v:any) => void,
 *   setAgeHandlerRef: (v:any) => void,
 *   setDisabled: (v:boolean) => void,
 *   setErrorCount: (v:number) => void,
 *   setFirstExceptionLogged: (v:boolean) => void,
 *   setFirstException: (v:any) => void,
 *   setFirstSampleSucceeded: (v:boolean) => void,
 *   setLastSampledTurn: (v:number) => void,
 *   seedWarEventsFromHistory: (samples:any) => void
 * }} deps Reset dependencies.
 */
export function resetSamplerRuntimeState(deps) {
  deps.setHandlerRef(null);
  deps.setAgeHandlerRef(null);
  deps.setDisabled(false);
  deps.setErrorCount(0);
  deps.setFirstExceptionLogged(false);
  deps.setFirstException(null);
  deps.setFirstSampleSucceeded(false);

  try {
    const history = deps.storage.load?.();
    if (history && Array.isArray(history.samples) && history.samples.length > 0) {
      const last = history.samples[history.samples.length - 1];
      if (last && typeof last.turn === "number") deps.setLastSampledTurn(last.turn);
    }
    deps.seedWarEventsFromHistory(history?.samples);
  } catch (_) {
    // Keep defaults when storage is not yet available.
  }
}

/**
 * Reset kill-switch state after a disabled sampler session.
 * @param {{
 *   setDisabled: (v:boolean) => void,
 *   setErrorCount: (v:number) => void,
 *   setFirstExceptionLogged: (v:boolean) => void,
 *   setFirstException: (v:any) => void,
 *   setFirstSampleSucceeded: (v:boolean) => void
 * }} deps Kill-switch state setters.
 */
export function resetKillSwitchState(deps) {
  deps.setDisabled(false);
  deps.setErrorCount(0);
  deps.setFirstExceptionLogged(false);
  deps.setFirstException(null);
  deps.setFirstSampleSucceeded(false);
}

/**
 * Bookkeeping after successful sample.
 * @param {number|undefined} curTurn Turn just sampled.
 * @param {{
 *   setLastSampledTurn: (v:number) => void,
 *   firstSampleSucceeded: () => boolean,
 *   setFirstSampleSucceeded: (v:boolean) => void,
 *   setDebugEnabled: (v:boolean) => void,
 *   ilog: (...a:any[]) => void
 * }} deps Success-path dependencies.
 */
export function noteSampleSucceeded(curTurn, deps) {
  if (typeof curTurn === "number") deps.setLastSampledTurn(curTurn);
  if (!deps.firstSampleSucceeded()) {
    deps.setFirstSampleSucceeded(true);
    deps.setDebugEnabled(false);
    deps.ilog("first sample SUCCEEDED; downgrading log verbosity for subsequent turns");
  }
}

/**
 * Run deferred resume kickoff sample.
 * @param {{
 *   isDisabled: () => boolean,
 *   getCurrentTurnRaw: () => (number|undefined),
 *   getStoredSampleCount: () => number,
 *   resolvePollEveryNTurns: () => number,
 *   shouldSampleTurn: (turn:any, lastSampledTurn:number, pollEveryNTurns:number) => boolean,
 *   getLastSampledTurn: () => number,
 *   ilog: (...a:any[]) => void,
 *   doSample: () => any,
 *   setLastSampledTurn: (v:number) => void,
 *   tripIfTooMany: (label:string, e:any) => void
 * }} deps Kickoff dependencies.
 */
export function runResumeKickoff(deps) {
  try {
    if (deps.isDisabled()) return;
    const curTurn = deps.getCurrentTurnRaw();
    const storedCount = deps.getStoredSampleCount();
    const pollEveryNTurns = deps.resolvePollEveryNTurns();
    const canSample = deps.shouldSampleTurn(
      curTurn,
      deps.getLastSampledTurn(),
      pollEveryNTurns
    );

    deps.ilog("startSampler runKickoff: storedCount=", storedCount, "curTurn=", curTurn);

    if (storedCount === 0 || canSample) {
      deps.ilog("startSampler: kicking off resume sample for turn", curTurn);
      const snap = deps.doSample();
      if (snap && typeof curTurn === "number") deps.setLastSampledTurn(curTurn);
      return;
    }

    deps.ilog(
      "startSampler: skipping resume sample — turn",
      curTurn,
      "off-cadence; last sampled turn",
      deps.getLastSampledTurn()
    );
  } catch (e) {
    deps.tripIfTooMany("resumeSample", e);
  }
}
