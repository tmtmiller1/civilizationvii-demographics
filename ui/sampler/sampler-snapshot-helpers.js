// sampler-snapshot-helpers.js
//
// Metric scaling/computation and per-player snapshot assembly helpers.

import { METRICS } from "/demographics/ui/metrics/demographics-metrics.js";
import {
  getCumulativeCasualty,
  getCumulativeUnitsLost,
  getCumulativeCityWarNet,
  getCumulativeRazed,
  getCumulativeWarLand,
  getCumulativeWarProd
} from "/demographics/ui/sampler/sampler-war-events.js";

/**
 * The per-civ context object assembled by buildPlayerCtx.
 * @typedef {import("/demographics/ui/sampler/sampler-collectors-core.js").PlayerCtx} PlayerCtx
 */

/**
 * Apply a metric's optional scale function.
 * @param {*} metric Metric definition.
 * @param {number} value Raw metric value.
 * @param {*} scaleCtx
 * @param {*} playerCtx
 * @param {( ...a: any[] ) => void} logError
 * @returns {number} Scaled value, or raw value on absence/failure.
 */
export function applyMetricScale(metric, value, scaleCtx, playerCtx, logError) {
  if (typeof metric.scale !== "function") return value;
  try {
    const scaled = metric.scale(value, scaleCtx, playerCtx);
    if (typeof scaled === "number" && isFinite(scaled)) return scaled;
  } catch (e) {
    logError("scale fn threw for", metric.id, e);
  }
  return value;
}

/**
 * Compute all configured metrics for one player context.
 * @param {PlayerCtx} playerCtx
 * @param {number} turn Monotonic chart turn (not age-local) used by the
 *   era-scaling metrics, so GDP/Population stay continuous across age boundaries.
 * @param {(label: string, e: any) => void} tripIfTooMany Error hook.
 * @param {( ...a: any[] ) => void} logError
 * @returns {Record<string, number>} Metric id -> value map.
 */
export function computeMetrics(playerCtx, turn, tripIfTooMany, logError) {
  /** @type {Record<string, number>} */
  const metrics = {};
  const scaleCtx = { turn, sampleIndex: undefined };

  for (const metric of METRICS) {
    try {
      const value = metric.accessor(playerCtx);
      if (typeof value === "number" && isFinite(value)) {
        metrics[metric.id] = applyMetricScale(metric, value, scaleCtx, playerCtx, logError);
      }
    } catch (e) {
      tripIfTooMany("metric accessor " + metric.id, e);
    }
  }
  return metrics;
}

/**
 * Build persisted snapshot player payload from context + metrics.
 * @param {PlayerCtx} playerCtx
 * @param {Record<string, number>} metrics Computed metrics.
 * @returns {object} Snapshot player record.
 */
export function buildSnapshotPlayer(playerCtx, metrics) {
  return {
    leaderType: playerCtx.leaderType,
    civType: playerCtx.civType,
    leaderName: playerCtx.leaderName,
    civName: playerCtx.civName,
    leaderTypeString: playerCtx.leaderTypeString,
    civTypeString: playerCtx.civTypeString,
    primaryColor: playerCtx.primaryColor,
    secondaryColor: playerCtx.secondaryColor,
    met: playerCtx.met,
    continent: playerCtx.continent,
    metrics,
    wonderTypes: Array.isArray(playerCtx.wonderTypes)
      ? playerCtx.wonderTypes
      : undefined
  };
}

/**
 * The cumulative refugees a civ has produced, from the Emigration mod's EmigrationData
 * hook (if installed), else undefined.
 * @param {number} playerId
 * @returns {number|undefined} Cumulative refugees, or undefined.
 */
function stampEmigrationRefugees(playerId) {
  try {
    const api = /** @type {*} */ (globalThis).EmigrationData;
    const v = api && typeof api.refugeesCumFor === "function" ? api.refugeesCumFor(playerId) : undefined;
    return typeof v === "number" && isFinite(v) ? v : undefined;
  } catch (_) {
    return undefined;
  }
}

/**
 * Stamp event-derived war metrics onto a player's metric map.
 * @param {Record<string, number>} metrics Metric map to augment.
 * @param {number} playerId
 * @param {*} playerCtx
 */
export function stampWarMetrics(metrics, playerId, playerCtx) {
  metrics.milLostCum = getCumulativeCasualty(playerId);
  metrics.unitsLostCum = getCumulativeUnitsLost(playerId);
  metrics.razedCum = getCumulativeRazed(playerId);
  metrics.warProdCum = getCumulativeWarProd(playerId);
  metrics.cityWarNetCum = getCumulativeCityWarNet(playerId);
  metrics.warLandCum = getCumulativeWarLand(playerId);
  // Refugees produced by war/disaster/conquest, contributed by the Emigration mod (if
  // installed). Absent → left unset, which the cost table renders as "— no data".
  const refugees = stampEmigrationRefugees(playerId);
  if (typeof refugees === "number") metrics.refugeesCum = refugees;

  if (
    typeof playerCtx.totalPopulation === "number" &&
    isFinite(playerCtx.totalPopulation)
  ) {
    metrics.populationRaw = playerCtx.totalPopulation;
  }
}
