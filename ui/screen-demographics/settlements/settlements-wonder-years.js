// settlements-wonder-years.js
//
// Wonder completion years, read from the sampled per-civ `wonderTypes` stream. Only an observed
// completion earns a year: a wonder held on a civ's first sample or one that changed hands by
// capture stays undated rather than showing a guessed build year.

/**
 * @param {{ years: Map<string, string>, held: Set<string>, sampled: Set<string> }} acc
 *   years: type → completion year; held: types any civ has held; sampled: pids seen.
 * @param {*} sample
 */
function foldSample(acc, sample) {
  const players = sample && sample.players ? sample.players : null;
  if (!players) return;
  for (const pid of Object.keys(players)) {
    const first = !acc.sampled.has(pid);
    acc.sampled.add(pid);
    const types = Array.isArray(players[pid]?.wonderTypes) ? players[pid].wonderTypes : [];
    // A civ's first sample only seeds what it already held; nothing there is dated.
    foldTypes(acc, types, first ? "" : sample.gameYear);
  }
}

/**
 * Date every wonder type no civ held before, then mark all of them held.
 * @param {{ years: Map<string, string>, held: Set<string> }} acc The running state.
 * @param {string[]} types One civ's wonder types in this sample.
 * @param {string} year The sample's game year ("" = seed only, date nothing).
 */
function foldTypes(acc, types, year) {
  for (const type of types) {
    if (!acc.held.has(type) && year) acc.years.set(type, year);
    acc.held.add(type);
  }
}

/**
 * Map wonder ConstructibleType → the game year its completion was observed.
 * @param {*} history The sampled history.
 * @returns {Map<string, string>} type → year (observed completions only).
 */
export function wonderCompletionYears(history) {
  const acc = { years: new Map(), held: new Set(), sampled: new Set() };
  const samples = history && Array.isArray(history.samples) ? history.samples : [];
  for (const sample of samples) foldSample(acc, sample);
  return acc.years;
}

/**
 * Stamp `year` on every settlement wonder whose completion was observed (the
 * showcase tooltip and the cinematic caption both read it).
 * @param {Array<{ wonders?: Array<{ type?: string, year?: string }> }>} settlements
 *   The records (mutated).
 * @param {*} history The sampled history.
 */
export function annotateWonderYears(settlements, history) {
  const years = wonderCompletionYears(history);
  if (!years.size) return;
  for (const settlement of settlements) {
    for (const wonder of Array.isArray(settlement.wonders) ? settlement.wonders : []) {
      if (wonder && wonder.type && !wonder.year && years.has(wonder.type)) wonder.year = years.get(wonder.type);
    }
  }
}
