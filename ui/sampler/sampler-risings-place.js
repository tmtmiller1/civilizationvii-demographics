// sampler-risings-place.js
//
// Puts a Partisans rising's turns on the Conflicts timeline. Partisans reports raw Game.turn
// values, which restart every age; the timeline plots on the continuous chart turn. A turn in the
// current age is placed by its distance from the current sample. A turn in an earlier age is placed
// against that age's own samples, which carry both the age-local turn and the chart turn.

/**
 * What the sampler knows about the current turn, plus the stored sample stream.
 * @typedef {object} RisingPlaceContext
 * @property {number} chartTurn Chart turn of the current sample.
 * @property {number} localTurn Age-local Game.turn of the current sample.
 * @property {string} age Current age type.
 * @property {string|undefined} gameYear Year label of the current sample.
 * @property {Snapshot[]} samples Stored samples (the current one included).
 */

/**
 * A placed turn.
 * @typedef {{ chartTurn: number, year: string|undefined }} PlacedTurn
 */

/**
 * @param {Snapshot[]} samples
 * @param {string} age
 * @param {number} turn Age-local turn.
 * @returns {Snapshot|null} The sample of that age nearest to the turn.
 */
function nearestAgeSample(samples, age, turn) {
  /** @type {Snapshot|null} */
  let best = null;
  let bestDist = Infinity;
  for (const sample of samples) {
    if (!sample || sample.age !== age) continue;
    if (typeof sample.chartTurn !== "number" || typeof sample.localTurn !== "number") continue;
    const dist = Math.abs(sample.localTurn - turn);
    if (dist < bestDist) {
      best = sample;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * @param {Snapshot|null} sample
 * @param {number} turn
 * @returns {string|undefined} The sample's year when it is exactly that turn.
 */
function exactYear(sample, turn) {
  if (!sample || sample.localTurn !== turn) return undefined;
  return typeof sample.gameYear === "string" && sample.gameYear ? sample.gameYear : undefined;
}

/**
 * Place an age-local turn on the chart-turn axis.
 * @param {number} turn Age-local Game.turn.
 * @param {string} age The age the turn belongs to.
 * @param {RisingPlaceContext} ctx
 * @returns {PlacedTurn|null} Null when nothing is known about that age.
 */
export function placeRisingTurn(turn, age, ctx) {
  if (age === ctx.age) {
    const back = Math.max(0, ctx.localTurn - turn);
    const year = back === 0 ? ctx.gameYear : exactYear(nearestAgeSample(ctx.samples, age, turn), turn);
    return { chartTurn: ctx.chartTurn - back, year };
  }
  const sample = nearestAgeSample(ctx.samples, age, turn);
  if (!sample) return null;
  return {
    chartTurn: /** @type {number} */ (sample.chartTurn) + (turn - /** @type {number} */ (sample.localTurn)),
    year: exactYear(sample, turn)
  };
}

/**
 * The age before the current one, from the newest stored sample of a different age.
 * @param {RisingPlaceContext} ctx
 * @returns {string|null}
 */
export function previousAge(ctx) {
  const samples = ctx.samples || [];
  for (let i = samples.length - 1; i >= 0; i--) {
    const age = samples[i] && samples[i].age;
    if (typeof age === "string" && age && age !== ctx.age) return age;
  }
  return null;
}
