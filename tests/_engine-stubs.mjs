// Engine and browser globals the tests stand in for: an in-memory localStorage, a settings object,
// the analytics-policy game value, and a snapshot of globals to put back when a file is done.

// Installs a Map-backed localStorage on globalThis and returns the Map, so a test can inspect it.
export function installMemoryLocalStorage() {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k)
  };
  return storage;
}

/**
 * The getSetting/setSetting surface views receive as `ctx.settings`. `_calls` records every write.
 * @param {Record<string, *>} [initial]
 */
export function makeSettings(initial = {}) {
  const data = { ...initial };
  const calls = [];
  return {
    getSetting: (k, d) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : d),
    setSetting: (k, v) => {
      data[k] = v;
      calls.push([k, v]);
    },
    _calls: calls
  };
}

// Points the real settings module's getSetting at `map`, for code that imports the module directly.
export function stubGetSetting(settingsModule, map) {
  settingsModule.getSetting = (k, d) => (Object.prototype.hasOwnProperty.call(map, k) ? map[k] : d);
}

// Sets the game's analytics policy value (DemographicsAnalyticsPolicy_v1) to `mode`.
export function setAnalyticsPolicy(mode) {
  globalThis.Configuration = {
    getGame: () => ({ getValue: (k) => (k === "DemographicsAnalyticsPolicy_v1" ? mode : null) })
  };
}

// Records the current value of each named global; the returned function puts them all back.
export function snapshotGlobals(names) {
  const saved = names.map((name) => [name, globalThis[name]]);
  return () => {
    for (const [name, value] of saved) globalThis[name] = value;
  };
}
