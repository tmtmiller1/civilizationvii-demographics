// sampler-turn-handler.js
//
// PlayerTurnActivated handler orchestration for sampler runtime.

import { reportBalanceSignals } from "/demographics/ui/core/demographics-telemetry.js";

/**
 * A monotonic millisecond clock for debug timing (Perf plan P2 #6); 0 if unavailable.
 * @returns {number} Milliseconds.
 */
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
 *   vlog: (...a:any[]) => void,
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
      vlog: deps.vlog
    });
    if (!sampleCtx) return;

    const { localId, curTurn } = sampleCtx;
    deps.vlog("about to sample turn for localPlayer=", localId);
    const t0 = nowMs(); // Perf plan P2 #6: time the per-turn sample (debug-only via vlog).
    const snap = deps.doSample();
    deps.vlog("sampled turn in", Math.round(nowMs() - t0), "ms");
    if (snap) {
      deps.noteSampleSucceeded(curTurn);
      // Balance telemetry (P2.7): throttled runaway-leader alert (debug-gated).
      reportBalanceSignals(snap, curTurn);
    }
  } catch (e) {
    deps.tripIfTooMany("onPlayerTurnActivated", e);
  }
}
