import assert from "node:assert/strict";

import {
  buildCsNodeInfo,
  buildNameMap
} from "/demographics/ui/screen-demographics/views/relations/relations-node-info.js";

const saved = {
  Players: globalThis.Players,
  UI: globalThis.UI,
  Locale: globalThis.Locale,
  GameInfo: globalThis.GameInfo
};

globalThis.Locale = { compose: (s) => String(s).replace(/^LOC_/, "") };
globalThis.UI = {
  Player: {
    getPrimaryColorValueAsString: () => "#336699"
  }
};
globalThis.GameInfo = {
  Civilizations: {
    lookup: () => ({ Name: "LOC_CS_NAME" })
  }
};

globalThis.Players = {
  get: (id) => {
    if (id === 1) return { Diplomacy: { hasMet: (other) => other === 3 } };
    if (id === 3) return { name: "LOC_CITYSTATE_ALPHA", civilizationType: "CIV_ALPHA" };
    return null;
  }
};

function testBuildNameMap() {
  assert.deepEqual(buildNameMap(undefined), {});

  const map = buildNameMap({
    samples: [
      { players: { "1": { leaderName: "A", civName: "Rome", leaderTypeString: "LEADER_A", primaryColor: "#111111" } } },
      { players: { "2": { leaderName: "B", civName: "Han", leaderTypeString: "LEADER_B", primaryColor: "#222222" } } }
    ]
  });
  assert.equal(map["1"].leaderName, "A");
  assert.equal(map["2"].civName, "Han");

  const emptyMap = buildNameMap({ samples: [{}, { players: null }] });
  assert.deepEqual(emptyMap, {});
}

function testBuildCsNodeInfoMetAndUnmet() {
  const history = { samples: [] };
  const met = buildCsNodeInfo(3, 1, false, 1, history);
  assert.equal(met.csMet, true);
  assert.equal(met.leaderName, "CITYSTATE_ALPHA");

  globalThis.Players = {
    get: (id) => {
      if (id === 1) return { Diplomacy: { hasMet: () => false } };
      if (id === 3) return { name: "LOC_CITYSTATE_BETA", civilizationType: "CIV_BETA" };
      return null;
    }
  };

  const unmet = buildCsNodeInfo(3, 1, false, 1, history);
  assert.equal(unmet.csMet, false);
  assert.equal(unmet.primaryColor, "#7d7d7d");

  const unmetShowName = buildCsNodeInfo(3, 1, true, 1, history);
  assert.equal(unmetShowName.csMet, false);
  assert.equal(unmetShowName.csName, "CITYSTATE_BETA");

  globalThis.GameInfo = {
    Civilizations: {
      lookup: () => ({ Name: "LOC_CIV_FALLBACK" })
    }
  };
  globalThis.Locale = { compose: () => "LOC_CIV_FALLBACK" };
  globalThis.Players = {
    get: (id) => {
      if (id === 1) return { Diplomacy: { hasMet: () => true } };
      if (id === 4) return { name: "", civilizationType: "CIV_FALLBACK" };
      return null;
    }
  };
  const fallbackByPid = buildCsNodeInfo(4, 1, true, 1, history);
  assert.equal(fallbackByPid.csName, "LOC_CIV_FALLBACK");

  globalThis.Locale = {
    compose: () => {
      throw new Error("compose failed");
    }
  };
  globalThis.GameInfo = {
    Civilizations: {
      lookup: () => {
        throw new Error("lookup failed");
      }
    }
  };
  globalThis.UI = { Player: {} };
  globalThis.Players = undefined;
  const fallbackNoPlayers = buildCsNodeInfo(8, 1, true, 1, history);
  assert.equal(fallbackNoPlayers.csName, "City-State 8");
  assert.equal(fallbackNoPlayers.primaryColor, "#9aa8c8");
  assert.equal(fallbackNoPlayers.csTypeLabel, null);
  assert.equal(fallbackNoPlayers.csTypeIcon, null);

  globalThis.Locale = { compose: (s) => String(s).replace(/^LOC_/, "") };
  globalThis.GameInfo = {
    Civilizations: {
      lookup: () => ({ Name: "LOC_CIV_COLOR" })
    }
  };
  globalThis.UI = {
    Player: {
      getPrimaryColorValueAsString: () => "#336699"
    }
  };
  globalThis.Players = {
    get: (id) => {
      if (id === 1) return { Diplomacy: { hasMet: () => true } };
      if (id === 9) return { civilizationType: "CIV_COLOR" };
      return null;
    }
  };
  const metPrimaryFallback = buildCsNodeInfo(9, 1, true, 1, history);
  assert.equal(metPrimaryFallback.primaryColor, "#336699");
  assert.equal(metPrimaryFallback.csTypeLabel, null);
  assert.equal(metPrimaryFallback.csTypeIcon, null);
}

try {
  testBuildNameMap();
  testBuildCsNodeInfoMetAndUnmet();
  console.log("relations-node-info-branches harness passed");
} finally {
  globalThis.Players = saved.Players;
  globalThis.UI = saved.UI;
  globalThis.Locale = saved.Locale;
  globalThis.GameInfo = saved.GameInfo;
}
