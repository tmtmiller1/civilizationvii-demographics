import assert from "node:assert/strict";

import {
  getConfigStore,
  getGlobalStore,
  getPlayerStore
} from "/demographics/ui/storage/storage-backend.js";

const saved = {
  Database: globalThis.Database,
  Configuration: globalThis.Configuration,
  GameTutorial: globalThis.GameTutorial,
  Players: globalThis.Players,
  GameContext: globalThis.GameContext
};

function restoreGlobals() {
  globalThis.Database = saved.Database;
  globalThis.Configuration = saved.Configuration;
  globalThis.GameTutorial = saved.GameTutorial;
  globalThis.Players = saved.Players;
  globalThis.GameContext = saved.GameContext;
}

function testGetConfigStoreNamespacedReadWrite() {
  let readKey = null;
  let writeKey = null;
  let writeValue = null;
  globalThis.Configuration = {
    getGame: () => ({
      getValue: (k) => {
        readKey = k;
        return "payload";
      }
    }),
    editGame: () => ({
      setValue: (k, v) => {
        writeKey = k;
        writeValue = v;
      }
    })
  };

  const store = getConfigStore({ catalogScope: "scope" });
  assert.ok(store, "config store should resolve when API exists");
  assert.equal(store.read("json"), "payload");
  store.write("json", "abc");
  assert.equal(readKey, "Demographics__scope__json");
  assert.equal(writeKey, "Demographics__scope__json");
  assert.equal(writeValue, "abc");
}

function testGetConfigStoreReadNonStringAsNull() {
  globalThis.Configuration = {
    getGame: () => ({ getValue: () => 42 }),
    editGame: () => ({ setValue: () => {} })
  };
  const store = getConfigStore({ catalogScope: "scope" });
  assert.ok(store);
  assert.equal(store.read("json"), null, "non-string values should be ignored");
}

function testGetGlobalStoreAndPlayerStore() {
  const bag = new Map();
  globalThis.Database = { makeHash: (s) => "h:" + s };
  globalThis.GameTutorial = {
    getProperty: (k) => bag.get(k) ?? null,
    setProperty: (k, v) => bag.set(k, v)
  };

  const globalStore = getGlobalStore({ catalogScope: "scope" });
  assert.ok(globalStore, "global fallback store should resolve");
  globalStore.write("json", "x");
  assert.equal(globalStore.read("json"), "x");

  globalThis.GameContext = { localObserverID: 2, localPlayerID: -1 };
  globalThis.Players = {
    get: (pid) => ({
      Tutorial: {
        getProperty: (k) => bag.get("p:" + pid + ":" + k) ?? null,
        setProperty: (k, v) => bag.set("p:" + pid + ":" + k, v)
      }
    })
  };

  const playerStore = getPlayerStore({ catalogScope: "scope" });
  assert.ok(playerStore, "player store should resolve with local observer");
  assert.equal(playerStore.pid, 2);
  playerStore.write("json", "y");
  assert.equal(playerStore.read("json"), "y");
}

function testNoHashDisablesHashedStores() {
  delete globalThis.Database;
  globalThis.GameTutorial = {
    getProperty: () => null,
    setProperty: () => {}
  };
  const g = getGlobalStore({ catalogScope: "scope", derr: () => {} });
  assert.equal(g, null, "global store should disable without engine hash");

  globalThis.GameContext = { localObserverID: 1, localPlayerID: 1 };
  globalThis.Players = { get: () => ({ Tutorial: { getProperty: () => null, setProperty: () => {} } }) };
  const p = getPlayerStore({ catalogScope: "scope", derr: () => {} });
  assert.equal(p, null, "player store should disable without engine hash");
}

try {
  testGetConfigStoreNamespacedReadWrite();
  testGetConfigStoreReadNonStringAsNull();
  testGetGlobalStoreAndPlayerStore();
  testNoHashDisablesHashedStores();
  console.log("storage-backend-branches harness passed");
} finally {
  restoreGlobals();
}
