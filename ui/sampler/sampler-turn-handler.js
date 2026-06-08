// sampler-turn-handler.js
//
// PlayerTurnActivated handler orchestration for sampler runtime.

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
    const snap = deps.doSample();
    if (snap) deps.noteSampleSucceeded(curTurn);
  } catch (e) {
    deps.tripIfTooMany("onPlayerTurnActivated", e);
  }
}
