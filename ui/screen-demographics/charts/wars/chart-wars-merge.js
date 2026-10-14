// chart-wars-merge.js
//
// Merge concurrent, time-overlapping wars that share a belligerent into a single
// multi-front war: connected components over (shared participant + overlap), with
// the two sides assigned by 2-coloring the participants. A pure display-time
// transform over history.wars. Non-bipartite tangles are left unmerged so a
// merged war always has a coherent A-vs-B structure.
//
// policyVisibleWars() applies the spoiler guard to the persisted list; every
// reader of history.wars runs it first, before merging or naming.

import { civDroppedByPolicy } from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";

/**
 * The numeric pids of a roster array.
 * @param {*} civs A side roster (entries with a `pid`).
 * @returns {number[]}
 */
function pidsOf(civs) {
  return (civs || [])
    .map((/** @type {*} */ entry) => entry.pid)
    .filter((/** @type {*} */ pid) => typeof pid === "number");
}

/**
 * A war's participant pids (both resolved-roster sides, incl. allies + CS).
 * @param {*} war
 * @returns {number[]}
 */
function warPids(war) {
  return pidsOf(war.sideACivs).concat(pidsOf(war.sideBCivs));
}

/**
 * A war's [start, end] turn window; an ongoing war ends at latestTurn.
 * @param {*} war
 * @param {number} latestTurn
 * @returns {{ s: number, e: number }}
 */
function warWindowOf(war, latestTurn) {
  const start = typeof war.startTurn === "number" ? war.startTurn : 0;
  const end = typeof war.endTurn === "number" ? war.endTurn : latestTurn;
  return { s: start, e: Math.max(end, start) };
}

/**
 * Whether two inclusive [s,e] windows overlap.
 * @param {{ s: number, e: number }} a
 * @param {{ s: number, e: number }} b
 * @returns {boolean}
 */
function windowsOverlap(a, b) {
  return a.s <= b.e && b.s <= a.e;
}

/**
 * Whether two pid sets intersect.
 * @param {Set<number>} a
 * @param {Set<number>} b
 * @returns {boolean}
 */
function setsIntersect(a, b) {
  for (const pid of a) if (b.has(pid)) return true;
  return false;
}

/**
 * A tiny union-find over array indices.
 * @param {number} count
 * @returns {{ find: (x: number) => number, union: (a: number, b: number) => void }}
 */
function makeUF(count) {
  const parent = Array.from({ length: count }, (_, i) => i);
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
 * and they share a participant.
 * @param {*[]} wars
 * @param {number} latestTurn
 * @returns {number[][]} Components as arrays of war indices.
 */
function warComponents(wars, latestTurn) {
  const count = wars.length;
  const uf = makeUF(count);
  const wins = wars.map((war) => warWindowOf(war, latestTurn));
  const pidSets = wars.map((war) => new Set(warPids(war)));
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      if (windowsOverlap(wins[i], wins[j]) && setsIntersect(pidSets[i], pidSets[j])) uf.union(i, j);
    }
  }
  /** @type {Map<number, number[]>} */
  const groups = new Map();
  for (let i = 0; i < count; i++) {
    const root = uf.find(i);
    if (!groups.has(root)) groups.set(root, []);
    /** @type {number[]} */ (groups.get(root)).push(i);
  }
  return Array.from(groups.values());
}

/**
 * A parity union-find for 2-coloring players: union(a,b,diff) asserts
 * color(a) XOR color(b) === diff, returning false if that contradicts a prior
 * constraint (the graph isn't bipartite).
 * @returns {{ union: (a: number, b: number, diff: number) => boolean,
 *   color: (x: number) => number }}
 */
function makeParityUF() {
  const parent = new Map();
  const parityToParent = new Map(); // parity from node to its parent
  const ensure = (/** @type {number} */ x) => {
    if (!parent.has(x)) {
      parent.set(x, x);
      parityToParent.set(x, 0);
    }
  };
  const find = (/** @type {number} */ x) => {
    ensure(x);
    let parity = 0;
    let cur = x;
    while (parent.get(cur) !== cur) {
      parity ^= parityToParent.get(cur);
      cur = parent.get(cur);
    }
    return { root: cur, p: parity };
  };
  const union = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ diff) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA.root === rootB.root) return (rootA.p ^ rootB.p) === diff;
    parent.set(rootB.root, rootA.root);
    parityToParent.set(rootB.root, diff ^ rootA.p ^ rootB.p);
    return true;
  };
  const color = (/** @type {number} */ x) => find(x).p;
  return { union, color };
}

/**
 * Apply one war's side constraints to the parity UF: same color within each side,
 * opposite colors across the two sides. Returns false on a contradiction.
 * @param {*} war
 * @param {{ union: (a: number, b: number, diff: number) => boolean }} uf The parity UF.
 * @returns {boolean}
 */
function applyWarConstraints(war, uf) {
  const pidsA = pidsOf(war.sideACivs);
  const pidsB = pidsOf(war.sideBCivs);
  for (let i = 1; i < pidsA.length; i++) if (!uf.union(pidsA[0], pidsA[i], 0)) return false;
  for (let i = 1; i < pidsB.length; i++) if (!uf.union(pidsB[0], pidsB[i], 0)) return false;
  if (pidsA.length && pidsB.length && !uf.union(pidsA[0], pidsB[0], 1)) return false;
  return true;
}

/**
 * 2-color a war component's participants. Returns the color map + the reference
 * color that defines "side A" (the earliest war's side A), or null when the
 * component isn't cleanly bipartite.
 * @param {*[]} componentWars The component's wars.
 * @returns {{ colorOf: (pid: number) => number, refColor: number } | null}
 */
function colorComponent(componentWars) {
  const uf = makeParityUF();
  for (const war of componentWars) if (!applyWarConstraints(war, uf)) return null;
  const first = componentWars.slice().sort((x, y) => (x.startTurn || 0) - (y.startTurn || 0))[0];
  const refPid = pidsOf(first.sideACivs)[0];
  const refColor = typeof refPid === "number" ? uf.color(refPid) : 0;
  return { colorOf: (pid) => uf.color(pid), refColor };
}

/**
 * Union every component war's roster entries into two side maps by color
 * (earliest joinTurn wins on duplicate pids).
 * @param {*[]} componentWars The component's wars.
 * @param {{ colorOf: (pid: number) => number, refColor: number }} coloring
 * @returns {{ a: *[], b: *[] }}
 */
function mergeRosters(componentWars, coloring) {
  /** @type {Map<number, *>} */
  const aMap = new Map();
  /** @type {Map<number, *>} */
  const bMap = new Map();
  for (const war of componentWars) {
    for (const entry of (war.sideACivs || []).concat(war.sideBCivs || [])) {
      addRosterEntry(entry, coloring, aMap, bMap);
    }
  }
  return { a: Array.from(aMap.values()), b: Array.from(bMap.values()) };
}

/**
 * Place one roster entry into the A or B side map by its color, keeping the
 * earliest joinTurn on duplicate pids.
 * @param {*} entry
 * @param {{ colorOf: (pid: number) => number, refColor: number }} coloring
 * @param {Map<number, *>} aMap Side A accumulator.
 * @param {Map<number, *>} bMap Side B accumulator.
 */
function addRosterEntry(entry, coloring, aMap, bMap) {
  if (typeof entry.pid !== "number") return;
  const dest = coloring.colorOf(entry.pid) === coloring.refColor ? aMap : bMap;
  const prev = dest.get(entry.pid);
  if (!prev || (entry.joinTurn || 0) < (prev.joinTurn || Infinity)) dest.set(entry.pid, entry);
}

/**
 * @param {*[]} aCivs
 * @param {*[]} bCivs
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
    .filter((/** @type {*} */ entry) => !entry.isCS)
    .map((/** @type {*} */ entry) => entry.civ)
    .sort()
    .join(" & ");
}

/**
 * Assemble one merged war record from a component's wars + its coloring.
 * @param {*[]} componentWars The component's wars.
 * @param {{ colorOf: (pid: number) => number, refColor: number }} coloring
 * @param {number} latestTurn
 * @returns {*}
 */
function buildMergedWar(componentWars, coloring, latestTurn) {
  const byStart = componentWars.slice().sort((x, y) => (x.startTurn || 0) - (y.startTurn || 0));
  const first = byStart[0];
  const ongoing = componentWars.some((war) => typeof war.endTurn !== "number");
  const byEnd = componentWars.slice().sort((x, y) => (y.endTurn || 0) - (x.endTurn || 0));
  const last = byEnd[0];
  const { a: rosterA, b: rosterB } = mergeRosters(componentWars, coloring);
  const uids = componentWars.map((war) =>
    (typeof war.warUniqueID === "number" ? war.warUniqueID : Infinity)
  );
  const minUid = Math.min(...uids);
  return {
    warUniqueID: isFinite(minUid) ? minUid : first.warUniqueID,
    startTurn: first.startTurn,
    endTurn: ongoing ? null : last.endTurn,
    startYear: first.startYear,
    endYear: ongoing ? null : last.endYear,
    sideA: pidsOf(rosterA),
    sideB: pidsOf(rosterB),
    participants: pidsOf(rosterA).concat(pidsOf(rosterB)),
    sideACivs: rosterA,
    sideBCivs: rosterB,
    declaredBy: first.declaredBy || null,
    name: mergedName(rosterA, rosterB),
    _merged: true,
    _frontCount: componentWars.length,
    _latestTurn: latestTurn
  };
}

/**
 * Merge concurrent, overlapping wars that share a belligerent into single
 * multi-front wars. Singletons and non-bipartite components pass through
 * unchanged.
 * @param {*[]} wars From history.wars.
 * @param {number} latestTurn Ongoing wars end here.
 * @returns {*[]}
 */
export function mergeWars(wars, latestTurn) {
  // history.wars is persisted; a null element must be dropped before the index-based merge.
  const list = Array.isArray(wars) ? wars.filter(Boolean) : [];
  if (list.length < 2) return list;
  const out = [];
  for (const comp of warComponents(list, latestTurn)) {
    if (comp.length === 1) {
      out.push(list[comp[0]]);
      continue;
    }
    const componentWars = comp.map((i) => list[i]);
    const coloring = colorComponent(componentWars);
    if (!coloring) {
      for (const war of componentWars) out.push(war); // non-bipartite: leave the fronts separate
      continue;
    }
    out.push(buildMergedWar(componentWars, coloring, latestTurn));
  }
  return out;
}

/**
 * Apply the spoiler guard to a persisted war list. A major civ the policy hides is removed from
 * both rosters, and a war is dropped once a side that had a major civ has none left, so a war
 * between a met civ and an unmet one disappears while a multi-civ war keeps its visible members.
 * A war that lost a member also loses its persisted name and, when the declarer is hidden, its
 * declarer: both can name the hidden civ. The display name is rebuilt from the remaining rosters.
 * @param {*[]} wars From history.wars.
 * @param {*[]} samples Carries the met flags.
 * @returns {*[]} The wars the local player may see, nulls dropped.
 */
export function policyVisibleWars(wars, samples) {
  const hidden = (/** @type {*} */ pid) => pid != null && civDroppedByPolicy(samples, pid);
  const out = [];
  for (const war of Array.isArray(wars) ? wars : []) {
    if (!war) continue;
    const gated = gateWar(war, hidden);
    if (gated) out.push(gated);
  }
  return out;
}

/**
 * Whether a side had a major civ before the spoiler guard and has none after it.
 * @param {*} before The side's roster as persisted.
 * @param {*[]} after The gated roster.
 * @returns {boolean}
 */
function lostEveryMajor(before, after) {
  const isMajor = (/** @type {*} */ entry) => !!entry && !entry.isCS;
  return (before || []).some(isMajor) && !after.some(isMajor);
}

/**
 * One war after the spoiler guard: the war itself when nothing is hidden, a copy without the
 * hidden majors, or null when a side is left with no major civ.
 * @param {*} war
 * @param {(pid: *) => boolean} hidden Whether a civ is hidden by the policy.
 * @returns {*|null}
 */
function gateWar(war, hidden) {
  const removed = new Set();
  const keep = (/** @type {*} */ entry) => {
    if (!entry || entry.isCS || !hidden(entry.pid)) return true;
    removed.add(entry.pid);
    return false;
  };
  const keptA = (war.sideACivs || []).filter(keep);
  const keptB = (war.sideBCivs || []).filter(keep);
  // Legacy scalar-schema records name their two sides directly.
  if (hidden(war.aPid) || hidden(war.bPid)) return null;
  if (!removed.size) return war;
  if (lostEveryMajor(war.sideACivs, keptA) || lostEveryMajor(war.sideBCivs, keptB)) return null;
  const visible = (/** @type {*} */ list) => (Array.isArray(list) ? list.filter((p) => !removed.has(p)) : list);
  return {
    ...war,
    sideACivs: keptA,
    sideBCivs: keptB,
    sideA: visible(war.sideA),
    sideB: visible(war.sideB),
    participants: visible(war.participants),
    name: undefined,
    declaredBy: war.declaredBy && removed.has(war.declaredBy.pid) ? null : war.declaredBy
  };
}
