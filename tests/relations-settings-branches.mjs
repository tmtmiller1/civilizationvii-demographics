import assert from "node:assert/strict";

import {
  makeFilterSetReader,
  makeFilterSetWriter,
  makeNodeSelectionReader,
  makeNodeSelectionWriter,
  readActiveSubGroup,
  readCsViewerPid,
  readShowUnmetNames,
  readTopTab,
  resetRelationsCachesIfGameChanged,
  writeActiveSubGroup
} from "/demographics/ui/screen-demographics/views/relations/relations-settings.js";

const savedConfiguration = globalThis.Configuration;

function makeSettingsStore(seed = {}) {
  const data = { ...seed };
  return {
    data,
    getSetting: (k, d) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : d),
    setSetting: (k, v) => {
      data[k] = v;
    }
  };
}

function testReadsAndWrites() {
  const s = makeSettingsStore({ relationsTopTab: "bad", showUnmetNames: true, relationsSubGroup: "agreements" });
  assert.equal(readTopTab(s), "civ");
  assert.equal(readShowUnmetNames(s), true);
  assert.equal(readActiveSubGroup(s), "agreements");

  assert.equal(readTopTab(makeSettingsStore({ relationsTopTab: "cs" })), "cs");
  assert.equal(readTopTab(makeSettingsStore({ relationsTopTab: "" })), "civ");
  assert.equal(readActiveSubGroup(makeSettingsStore({ relationsSubGroup: "bad-group" })), "politics");
  assert.equal(readActiveSubGroup({}), "politics");

  const badReads = {
    getSetting() {
      throw new Error("read failed");
    },
    setSetting() {
      throw new Error("write failed");
    }
  };
  assert.equal(readTopTab(badReads), "civ");
  assert.equal(readShowUnmetNames(badReads), false);
  assert.equal(readActiveSubGroup(badReads), "politics");

  writeActiveSubGroup(s, "politics");
  assert.equal(s.data.relationsSubGroup, "politics");
  writeActiveSubGroup(badReads, "agreements");

  assert.equal(readCsViewerPid(makeSettingsStore({ relationsCsViewerPid: 5 }), 1, [1, 2]), 1);
  assert.equal(readCsViewerPid(makeSettingsStore({ relationsCsViewerPid: 2 }), 1, [1, 2]), 2);
  assert.equal(readCsViewerPid(makeSettingsStore({ relationsCsViewerPid: "2" }), 1, [1, 2]), 1);
  assert.equal(readCsViewerPid(badReads, 4, [4, 5]), 4);
}

function testCacheReadersAndReset() {
  const settings = makeSettingsStore({ relationsCivFilters2: ["war"] });
  const readSet = makeFilterSetReader(settings);
  const writeSet = makeFilterSetWriter(settings);

  globalThis.Configuration = { getGame: () => ({ startSeed: "seed-a" }) };
  resetRelationsCachesIfGameChanged();

  const first = readSet("civ");
  assert.equal(first.has("war"), true);

    const brokenReadSet = makeFilterSetReader({
    getSetting() {
      throw new Error("broken read");
    }
  });
    const defaultsAfterThrow = brokenReadSet("fresh-top");
  assert.ok(defaultsAfterThrow.size > 0);

  const nonArrayReadSet = makeFilterSetReader({
    getSetting: () => "oops"
  });
  const defaultsAfterType = nonArrayReadSet("cs");
  assert.ok(defaultsAfterType.size > 0);

  writeSet("civ", new Set(["alliance"]));
  const cached = readSet("civ");
  assert.equal(cached.has("alliance"), true);

  const brokenWriter = makeFilterSetWriter({
    setSetting() {
      throw new Error("broken write");
    }
  });
  brokenWriter("civ", new Set(["war"]));

  settings.data.relationsCivFilters2 = ["war"];
  globalThis.Configuration = { getGame: () => ({ startSeed: "seed-b" }) };
  resetRelationsCachesIfGameChanged();
  const afterReset = readSet("civ");
  assert.equal(afterReset.has("war"), true, "cache should reset when game token changes");

  const readNodeSel = makeNodeSelectionReader();
  const writeNodeSel = makeNodeSelectionWriter();
  assert.deepEqual(Array.from(readNodeSel("cs")), []);
  writeNodeSel("civ", new Set([1, 2]));
  assert.deepEqual(Array.from(readNodeSel("civ")).sort((a, b) => a - b), [1, 2]);

    globalThis.Configuration = { getGame: () => ({ gameSeed: "seed-c" }) };
    resetRelationsCachesIfGameChanged();
    globalThis.Configuration = { getGame: () => ({ mapSeed: "seed-d" }) };
    resetRelationsCachesIfGameChanged();

    globalThis.Configuration = undefined;
  resetRelationsCachesIfGameChanged();
  globalThis.Configuration = { getGame: () => { throw new Error("token failed"); } };
  resetRelationsCachesIfGameChanged();
}

try {
  testReadsAndWrites();
  testCacheReadersAndReset();
  console.log("relations-settings-branches harness passed");
} finally {
  globalThis.Configuration = savedConfiguration;
}
