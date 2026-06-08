// sampler-players.js
//
// Major-player snapshot assembly helpers.

/**
 * Build major-player snapshot map for one sample pass.
 * @param {number[]} ids Alive major player ids.
 * @param {*} globalAge Global age context.
 * @param {number} turn Current turn.
 * @param {{
 *   buildPlayerCtx: (pid:number) => any,
 *   computeMetrics: (ctx:any, turn:number) => Record<string, number>,
 *   stampWarMetrics: (metrics: Record<string, number>, pid:number, ctx:any) => void,
 *   buildSnapshotPlayer: (ctx:any, metrics: Record<string, number>) => object
 * }} deps Dependencies for player snapshot construction.
 * @returns {Record<string, *>} Player snapshot map.
 */
export function buildMajorPlayerSnapshots(ids, globalAge, turn, deps) {
  /** @type {Record<string, *>} */
  const players = {};
  for (const pid of ids) {
    const ctx = deps.buildPlayerCtx(pid);
    ctx.ageProgressPct = globalAge.ageProgressPct;
    ctx.crisisStage = globalAge.crisisStage;
    ctx.crisisStageMax = globalAge.crisisStageMax;
    const metrics = deps.computeMetrics(ctx, turn);
    deps.stampWarMetrics(metrics, pid, ctx);
    players[pid] = deps.buildSnapshotPlayer(ctx, metrics);
  }
  return players;
}
