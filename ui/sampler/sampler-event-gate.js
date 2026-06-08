// sampler-event-gate.js
//
// Event payload and local-turn gate helpers for PlayerTurnActivated sampling.

/**
 * Resolve player id from a PlayerTurnActivated payload.
 * @param {*} data Event payload.
 * @returns {number|undefined} Event player id.
 */
export function eventPlayerId(data) {
  const evtPid = data && (data.player ?? data.playerID);
  return typeof evtPid === "number" ? evtPid : undefined;
}

/**
 * Compute local sampling context for one PlayerTurnActivated payload.
 * @param {{
 *   data: any,
 *   getLocalPlayerID: () => number|undefined,
 *   getCurrentTurn: () => number|undefined,
 *   shouldSampleTurn: (turn:any, lastSampledTurn:number, pollEveryNTurns:number) => boolean,
 *   resolvePollEveryNTurns: () => number,
 *   lastSampledTurn: number,
 *   vlog: (...a:any[]) => void
 * }} deps Dependencies and event payload.
 * @returns {{ localId: number, curTurn: number }|null} Sampling context.
 */
export function localSamplingContextFromEvent(deps) {
  const localId = deps.getLocalPlayerID();
  const evtPid = eventPlayerId(deps.data);
  if (typeof localId !== "number" || typeof evtPid !== "number") {
    deps.vlog("skip: localId/evtPid not numeric", localId, evtPid);
    return null;
  }
  if (evtPid !== localId) return null;
  const curTurn = deps.getCurrentTurn();
  if (typeof curTurn !== "number") return null;

  const pollEveryNTurns = deps.resolvePollEveryNTurns();
  if (!deps.shouldSampleTurn(curTurn, deps.lastSampledTurn, pollEveryNTurns)) {
    deps.vlog(
      "skip turn",
      curTurn,
      "by polling rate (every",
      pollEveryNTurns,
      "turns)"
    );
    return null;
  }
  return { localId, curTurn };
}
