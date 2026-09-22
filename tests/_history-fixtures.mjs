// Shared builders for test harnesses (not a harness itself: the leading underscore excludes it).

/**
 * A player state with sensible defaults.
 * @param {Partial<HnrPlayerState>} over Overrides.
 * @returns {HnrPlayerState} State.
 */
export function pstate(over = {}) {
  return {
    alive: true,
    civ: "CIVILIZATION_ROME",
    met: true,
    cities: {},
    wonders: [],
    triumphs: [],
    religion: "",
    wars: [],
    population: 0,
    ...over
  };
}

/**
 * A world state.
 * @param {number} turn Turn.
 * @param {Record<string, HnrPlayerState>} players Players.
 * @param {Partial<HnrWorldState>} over Overrides.
 * @returns {HnrWorldState} State.
 */
export function world(turn, players, over = {}) {
  return { turn, age: "AGE_ANTIQUITY", date: "T" + turn, players, victories: [], ...over };
}

/** A Namer that echoes types into recognizable tags. */
export const NAMER = {
  wonder: (t) => "LOC_" + t + "_NAME",
  triumph: (t) => "LOC_" + t + "_NAME",
  civ: (t) => "LOC_" + t + "_NAME",
  age: (t) => "LOC_" + t + "_NAME",
  victory: (t) => "LOC_" + t + "_NAME",
  teamPlayer: (team) => team
};

/**
 * A localStorage that reproduces the Civilization VII 1.5.0 GameFace bug: getItem returns the value
 * of the first key in sort order no matter which key is asked for. Writes land correctly.
 * @param {Record<string, string>} [initial] Initial contents.
 * @returns {Storage & {dump: () => Record<string, string>}} Storage.
 */
export function buggyStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  const first = () => [...data.keys()].sort()[0];
  return /** @type {any} */ ({
    getItem: (_k) => (data.size ? data.get(first()) : null),
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
    dump: () => Object.fromEntries(data)
  });
}

/** Identity passthrough Locale so t() returns "TAG|arg|arg" and tests can read arguments. */
export function installEchoLocale() {
  globalThis.Locale = {
    compose: (key, ...args) => (args.length ? key + "|" + args.join("|") : key),
    toNumber: (n) => String(n)
  };
}
