// sampler-registration.js
//
// Engine handler registration and load-deferral for sampler startup.

/**
 * Register turn/age handlers and schedule deferred kickoff.
 * @param {{
 *   teardown: () => void,
 *   setTurnHandlerRef: (handler:any) => void,
 *   setAgeHandlerRef: (handler:any) => void,
 *   onPlayerTurnActivated: (data:any) => void,
 *   onPlayerAgeTransitionComplete: (data:any, ageBoundaryDeps:any) => void,
 *   ageBoundaryDeps: any,
 *   startWarEventTracker: () => void,
 *   startFoundingTracker: () => void,
 *   ilog: (...a:any[]) => void,
 *   elog: (...a:any[]) => void,
 *   killThreshold: number,
 *   runKickoff: () => void
 * }} deps Registration dependencies.
 */
export function registerSamplerHandlers(deps) {
  try {
    deps.teardown();

    /** @param {*} data */
    const turnHandler = (data) => deps.onPlayerTurnActivated(data);
    deps.setTurnHandlerRef(turnHandler);
    engine.on("PlayerTurnActivated", turnHandler);

    /** @param {*} data */
    const ageHandler = (data) =>
      deps.onPlayerAgeTransitionComplete(data, deps.ageBoundaryDeps);
    deps.setAgeHandlerRef(ageHandler);
    engine.on("PlayerAgeTransitionComplete", ageHandler);

    deps.startWarEventTracker();
    deps.startFoundingTracker();

    deps.ilog(
      "subscribed to PlayerTurnActivated + PlayerAgeTransitionComplete",
      "(re-registered fresh on load, kill at",
      deps.killThreshold,
      "errors)"
    );

    if (typeof Loading !== "undefined" && typeof Loading.runWhenLoaded === "function") {
      deps.ilog("startSampler: deferring kickoff until Loading.runWhenLoaded");
      Loading.runWhenLoaded(deps.runKickoff);
      return;
    }

    deps.ilog("startSampler: Loading.runWhenLoaded unavailable; using 250ms timeout fallback");
    setTimeout(deps.runKickoff, 250);
  } catch (e) {
    deps.elog("engine.on threw during startSampler:", e);
  }
}
