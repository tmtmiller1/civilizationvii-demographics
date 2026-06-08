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
 *     (ids:number[], globalAge:any, turn:number, deps:any) => Record<string, *>,
 *   buildPlayerCtx: (pid:number) => any,
 *   computeMetrics: (ctx:any, turn:number) => Record<string, number>,
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
    players: deps.buildMajorPlayerSnapshots(deps.ids, deps.globalAge, deps.localTurn, {
      buildPlayerCtx: deps.buildPlayerCtx,
      computeMetrics: deps.computeMetrics,
      stampWarMetrics: deps.stampWarMetrics,
      buildSnapshotPlayer: deps.buildSnapshotPlayer
    })
  };
}
