// chart-wars-merge.js
//
// Merge concurrent, time-overlapping wars that share a belligerent into a single
// multi-front war: connected components over (shared participant + overlap), with
// the two sides assigned by 2-coloring the participants. A pure DISPLAY-time
// transform over history.wars - the per-war tracking in sampler-wars.js is
// untouched - so the timeline, the tooltip, and the War Graphs picker all
// collapse the same fronts into one war when they call mergeWars().
//
// Non-bipartite tangles (a true free-for-all that can't be split into two clean
// sides) are left UNMERGED rather than forced, so a merged war always has a
// coherent A-vs-B structure.

/**
 * The numeric pids of a roster array.
 * @param {*} civs A side roster (array of entries with a `pid`).
 * @returns {number[]} The numeric pids.
 */
function pidsOf(civs) {
  return (civs || [])
    .map((/** @type {*} */ e) => e.pid)
    .filter((/** @type {*} */ p) => typeof p === "number");
}

/**
 * A war's participant pids (both resolved-roster sides, incl. allies + CS).
 * @param {*} w A war record.
 * @returns {number[]} The participant pids.
 */
function warPids(w) {
  return pidsOf(w.sideACivs).concat(pidsOf(w.sideBCivs));
}

/**
 * A war's [start, end] turn window; an ongoing war ends at latestTurn.
 * @param {*} w A war record.
 * @param {number} latestTurn The latest sampled turn.
 * @returns {{ s: number, e: number }} The window.
 */
function warWindowOf(w, latestTurn) {
  const s = typeof w.startTurn === "number" ? w.startTurn : 0;
  const e = typeof w.endTurn === "number" ? w.endTurn : latestTurn;
  return { s, e: Math.max(e, s) };
}

/**
 * Whether two inclusive [s,e] windows overlap.
 * @param {{ s: number, e: number }} a Window A.
 * @param {{ s: number, e: number }} b Window B.
 * @returns {boolean} True when they overlap.
 */
function windowsOverlap(a, b) {
  return a.s <= b.e && b.s <= a.e;
}

/**
 * Whether two pid sets intersect.
 * @param {Set<number>} a Set A.
 * @param {Set<number>} b Set B.
 * @returns {boolean} True when they share a pid.
 */
function setsIntersect(a, b) {
  for (const p of a) if (b.has(p)) return true;
  return false;
}

/**
 * A tiny union-find over array indices.
 * @param {number} n The element count.
 * @returns {{ find: (x: number) => number, union: (a: number, b: number) => void }} The UF ops.
 */
function makeUF(n) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (/** @type {number} */ x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (/** @type {number} */ a, /** @type {number} */ b) => {
    parent[find(a)] = find(b);
  };
  return { find, union };
}

/**
 * Group wars into connected components: two wars link when their windows overlap
 * AND they share a participant.
 * @param {*[]} wars The war list.
 * @param {number} latestTurn The latest sampled turn.
 * @returns {number[][]} Components as arrays of war indices.
 */
function warComponents(wars, latestTurn) {
  const n = wars.length;
  const uf = makeUF(n);
  const wins = wars.map((w) => warWindowOf(w, latestTurn));
  const pidSets = wars.map((w) => new Set(warPids(w)));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (windowsOverlap(wins[i], wins[j]) && setsIntersect(pidSets[i], pidSets[j])) uf.union(i, j);
    }
  }
  /** @type {Map<number, number[]>} */
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const r = uf.find(i);
    if (!groups.has(r)) groups.set(r, []);
    /** @type {number[]} */ (groups.get(r)).push(i);
  }
  return Array.from(groups.values());
}

/**
 * A parity union-find for 2-coloring players: union(a,b,diff) asserts
 * color(a) XOR color(b) === diff, returning false if that contradicts a prior
 * constraint (the graph isn't bipartite).
 * @returns {{ union: (a: number, b: number, diff: number) => boolean, color: (x: number) => number }} The ops.
 */
function makeParityUF() {
  const parent = new Map();
  const par = new Map(); // parity from node to its parent
  const ensure = (/** @type {number} */ x) => {
    if (!parent.has(x)) {
      parent.set(x, x);
      par.set(x, 0);
    }
  };
  const find = (/** @type {number} */ x) => {
    ensure(x);
    let p = 0;
    let cur = x;
    while (parent.get(cur) !== cur) {
      p ^= par.get(cur);
      cur = parent.get(cur);
    }
    return { root: cur, p };
  };
  const union = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ diff) => {
    const fa = find(a);
    const fb = find(b);
    if (fa.root === fb.root) return (fa.p ^ fb.p) === diff;
    parent.set(fb.root, fa.root);
    par.set(fb.root, diff ^ fa.p ^ fb.p);
    return true;
  };
  const color = (/** @type {number} */ x) => find(x).p;
  return { union, color };
}

/**
 * Apply one war's side constraints to the parity UF: same color within each side,
 * opposite colors across the two sides. Returns false on a contradiction.
 * @param {*} w A war record.
 * @param {{ union: (a: number, b: number, diff: number) => boolean }} uf The parity UF.
 * @returns {boolean} True when consistent.
 */
function applyWarConstraints(w, uf) {
  const a = pidsOf(w.sideACivs);
  const b = pidsOf(w.sideBCivs);
  for (let i = 1; i < a.length; i++) if (!uf.union(a[0], a[i], 0)) return false;
  for (let i = 1; i < b.length; i++) if (!uf.union(b[0], b[i], 0)) return false;
  if (a.length && b.length && !uf.union(a[0], b[0], 1)) return false;
  return true;
}

/**
 * 2-color a war component's participants. Returns the color map + the reference
 * color that defines "side A" (the earliest war's side A), or null when the
 * component isn't cleanly bipartite.
 * @param {*[]} cw The component's wars.
 * @returns {{ colorOf: (pid: number) => number, refColor: number } | null} The coloring, or null.
 */
function colorComponent(cw) {
  const uf = makeParityUF();
  for (const w of cw) if (!applyWarConstraints(w, uf)) return null;
  const first = cw.slice().sort((x, y) => (x.startTurn || 0) - (y.startTurn || 0))[0];
  const refPid = pidsOf(first.sideACivs)[0];
  const refColor = typeof refPid === "number" ? uf.color(refPid) : 0;
  return { colorOf: (pid) => uf.color(pid), refColor };
}

/**
 * Union every component war's roster entries into two side maps by color
 * (earliest joinTurn wins on duplicate pids).
 * @param {*[]} cw The component's wars.
 * @param {{ colorOf: (pid: number) => number, refColor: number }} coloring The coloring.
 * @returns {{ a: *[], b: *[] }} The merged side rosters.
 */
function mergeRosters(cw, coloring) {
  /** @type {Map<number, *>} */
  const aMap = new Map();
  /** @type {Map<number, *>} */
  const bMap = new Map();
  for (const w of cw) {
    for (const e of (w.sideACivs || []).concat(w.sideBCivs || [])) {
      addRosterEntry(e, coloring, aMap, bMap);
    }
  }
  return { a: Array.from(aMap.values()), b: Array.from(bMap.values()) };
}

/**
 * Place one roster entry into the A or B side map by its color, keeping the
 * earliest joinTurn on duplicate pids.
 * @param {*} e A roster entry.
 * @param {{ colorOf: (pid: number) => number, refColor: number }} coloring The coloring.
 * @param {Map<number, *>} aMap Side A accumulator.
 * @param {Map<number, *>} bMap Side B accumulator.
 */
function addRosterEntry(e, coloring, aMap, bMap) {
  if (typeof e.pid !== "number") return;
  const dest = coloring.colorOf(e.pid) === coloring.refColor ? aMap : bMap;
  const prev = dest.get(e.pid);
  if (!prev || (e.joinTurn || 0) < (prev.joinTurn || Infinity)) dest.set(e.pid, e);
}

/**
 * Build the merged war's display name from each side's major civ names.
 * @param {*[]} aCivs Side A roster.
 * @param {*[]} bCivs Side B roster.
 * @returns {string} The composed name.
 */
function mergedName(aCivs, bCivs) {
  return (majorCivNames(aCivs) || "Side A") + " vs " + (majorCivNames(bCivs) || "Side B") + " War";
}

/**
 * The "&"-joined, sorted major civ names of a roster (city-states excluded).
 * @param {*} civs A side roster.
 * @returns {string} The joined names ("" when none).
 */
function majorCivNames(civs) {
  return (civs || [])
    .filter((/** @type {*} */ e) => !e.isCS)
    .map((/** @type {*} */ e) => e.civ)
    .sort()
    .join(" & ");
}

/**
 * Assemble one merged war record from a component's wars + its coloring.
 * @param {*[]} cw The component's wars.
 * @param {{ colorOf: (pid: number) => number, refColor: number }} coloring The coloring.
 * @param {number} latestTurn The latest sampled turn.
 * @returns {*} The merged war record.
 */
function buildMergedWar(cw, coloring, latestTurn) {
  const byStart = cw.slice().sort((x, y) => (x.startTurn || 0) - (y.startTurn || 0));
  const first = byStart[0];
  const ongoing = cw.some((w) => typeof w.endTurn !== "number");
  const byEnd = cw.slice().sort((x, y) => (y.endTurn || 0) - (x.endTurn || 0));
  const last = byEnd[0];
  const { a, b } = mergeRosters(cw, coloring);
  const uids = cw.map((w) => (typeof w.warUniqueID === "number" ? w.warUniqueID : Infinity));
  const minUid = Math.min(...uids);
  return {
    warUniqueID: isFinite(minUid) ? minUid : first.warUniqueID,
    startTurn: first.startTurn,
    endTurn: ongoing ? null : last.endTurn,
    startYear: first.startYear,
    endYear: ongoing ? null : last.endYear,
    sideA: pidsOf(a),
    sideB: pidsOf(b),
    participants: pidsOf(a).concat(pidsOf(b)),
    sideACivs: a,
    sideBCivs: b,
    declaredBy: first.declaredBy || null,
    name: mergedName(a, b),
    _merged: true,
    _frontCount: cw.length,
    _latestTurn: latestTurn
  };
}

/**
 * Merge concurrent, overlapping wars that share a belligerent into single
 * multi-front wars. Singletons and non-bipartite components pass through
 * unchanged.
 * @param {*[]} wars The war list (from history.wars).
 * @param {number} latestTurn The latest sampled turn (ongoing wars end here).
 * @returns {*[]} The merged war list.
 */
export function mergeWars(wars, latestTurn) {
  if (!Array.isArray(wars) || wars.length < 2) return wars || [];
  const out = [];
  for (const comp of warComponents(wars, latestTurn)) {
    if (comp.length === 1) {
      out.push(wars[comp[0]]);
      continue;
    }
    const cw = comp.map((i) => wars[i]);
    const coloring = colorComponent(cw);
    if (!coloring) {
      for (const w of cw) out.push(w); // non-bipartite: leave the fronts separate
      continue;
    }
    out.push(buildMergedWar(cw, coloring, latestTurn));
  }
  return out;
}
