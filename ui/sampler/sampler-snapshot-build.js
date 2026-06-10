// sampler-snapshot-build.js
//
// Snapshot object assembly helper for one sampler pass.

/**
 * Build one sampler snapshot object from computed context.
 * @param {{
 *   localTurn: number,
 *   chartTurn: number,
 *   ageType: string|undefined,
 *   gameYear: string|undefined,
 *   globalAge: any,
 *   ids: number[],
 *   buildMajorPlayerSnapshots:
 *     (ids:number[], globalAge:any, scaleTurn:number, deps:any) => Record<string, *>,
 *   buildPlayerCtx: (pid:number) => any,
 *   computeMetrics: (ctx:any, scaleTurn:number) => Record<string, number>,
 *   stampWarMetrics: (metrics:Record<string, number>, pid:number, ctx:any) => void,
 *   buildSnapshotPlayer: (ctx:any, metrics:Record<string, number>) => object
 * }} deps Snapshot dependencies.
 * @returns {*} Snapshot object.
 */
export function buildSamplerSnapshot(deps) {
  return {
    turn: deps.localTurn,
    localTurn: deps.localTurn,
    chartTurn: deps.chartTurn,
    age: deps.ageType,
    gameYear: deps.gameYear,
    crisisEventType: deps.globalAge.crisisEventType,
    // Scale metrics off the MONOTONIC chartTurn, not the age-local localTurn.
    // localTurn resets to 1 at every age boundary, and the era-scaled metrics
    // (GDP = raw × turn × 1e6, Population = raw^1.11 × 90000 × 1.009^turn) would
    // then collapse at each transition - the "drop to ~0 at Exploration Begins"
    // discontinuity. chartTurn advances continuously across ages, so the scaled
    // series stay continuous. localTurn/turn are still stored on the snapshot for
    // age-aware X-axis placement.
    players: deps.buildMajorPlayerSnapshots(deps.ids, deps.globalAge, deps.chartTurn, {
      buildPlayerCtx: deps.buildPlayerCtx,
      computeMetrics: deps.computeMetrics,
      stampWarMetrics: deps.stampWarMetrics,
      buildSnapshotPlayer: deps.buildSnapshotPlayer
    })
  };
}
