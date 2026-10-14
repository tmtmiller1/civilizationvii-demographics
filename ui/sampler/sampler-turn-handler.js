// sampler-turn-handler.js
//
// PlayerTurnActivated handler orchestration for sampler runtime.

import { reportBalanceSignals } from "/demographics/ui/core/demographics-telemetry.js";

function nowMs() {
  try {
    const g = /** @type {*} */ (globalThis);
    return g.performance && g.performance.now ? g.performance.now() : Date.now();
  } catch (_) {
    return 0;
  }
}

/**
 * Handle one PlayerTurnActivated event.
 * @param {{
 *   data: any,
 *   isDisabled: () => boolean,
 *   localSamplingContextFromEvent: (deps:any) => ({localId:number, curTurn:number}|null),
 *   getLocalPlayerID: () => (number|undefined),
 *   getCurrentTurnRaw: () => (number|undefined),
 *   shouldSampleTurn: (turn:any, lastSampledTurn:number, pollEveryNTurns:number) => boolean,
 *   resolvePollEveryNTurns: () => number,
 *   getLastSampledTurn: () => number,
 *   logDebug: (...a:any[]) => void,
 *   doSample: () => any,
 *   noteSampleSucceeded: (curTurn:number|undefined) => void,
 *   tripIfTooMany: (label:string, e:any) => void
 * }} deps Handler dependencies.
 */
export function handlePlayerTurnActivated(deps) {
  if (deps.isDisabled()) return;
  try {
    const sampleCtx = deps.localSamplingContextFromEvent({
      data: deps.data,
      getLocalPlayerID: deps.getLocalPlayerID,
      getCurrentTurn: deps.getCurrentTurnRaw,
      shouldSampleTurn: deps.shouldSampleTurn,
      resolvePollEveryNTurns: deps.resolvePollEveryNTurns,
      lastSampledTurn: deps.getLastSampledTurn(),
      logDebug: deps.logDebug
    });
    if (!sampleCtx) return;

    const { localId, curTurn } = sampleCtx;
    deps.logDebug("about to sample turn for localPlayer=", localId);
    const t0 = nowMs(); // Time the per-turn sample (only logged with debug on).
    const snap = deps.doSample();
    deps.logDebug("sampled turn in", Math.round(nowMs() - t0), "ms");
    if (snap) {
      deps.noteSampleSucceeded(curTurn);
      // Balance telemetry: throttled runaway-leader alert (debug-gated).
      reportBalanceSignals(snap, curTurn);
    }
  } catch (e) {
    deps.tripIfTooMany("onPlayerTurnActivated", e);
  }
}
