// settlements-wonder-years.js
//
// Wonder completion years, read from the sampled per-civ `wonderTypes` stream. Only an observed
// completion earns a year: a wonder held on a civ's first sample or one that changed hands by
// capture stays undated rather than showing a guessed build year.

/**
 * Fold one sample into the running wonder-year state.
 * @param {*} smp The sample.
 * @param {{ years: Map<string, string>, held: Set<string>, sampled: Set<string> }} acc
 *   years: type → completion year; held: types any civ has held; sampled: pids seen.
 */
function foldSample(acc, smp) {
  const players = smp && smp.players ? smp.players : null;
  if (!players) return;
  for (const pid of Object.keys(players)) {
    const first = !acc.sampled.has(pid);
    acc.sampled.add(pid);
    const types = Array.isArray(players[pid]?.wonderTypes) ? players[pid].wonderTypes : [];
    // A civ's first sample only seeds what it already held; nothing there is dated.
    foldTypes(acc, types, first ? "" : smp.gameYear);
  }
}

/**
 * Date every wonder type no civ held before, then mark all of them held.
 * @param {{ years: Map<string, string>, held: Set<string> }} acc The running state.
 * @param {string[]} types One civ's wonder types in this sample.
 * @param {string} year The sample's game year ("" = seed only, date nothing).
 */
function foldTypes(acc, types, year) {
  for (const ty of types) {
    if (!acc.held.has(ty) && year) acc.years.set(ty, year);
    acc.held.add(ty);
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
  for (const smp of samples) foldSample(acc, smp);
  return acc.years;
}

/**
 * Stamp `year` on every settlement wonder whose completion was observed (the
 * showcase tooltip and the cinematic caption both read it).
 * @param {Array<{ wonders?: Array<{ type?: string, year?: string }> }>} settlements The records (mutated).
 * @param {*} history The sampled history.
 */
export function annotateWonderYears(settlements, history) {
  const years = wonderCompletionYears(history);
  if (!years.size) return;
  for (const s of settlements) {
    for (const w of Array.isArray(s.wonders) ? s.wonders : []) {
      if (w && w.type && !w.year && years.has(w.type)) w.year = years.get(w.type);
    }
  }
}
