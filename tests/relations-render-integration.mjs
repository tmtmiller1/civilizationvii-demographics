import assert from "node:assert/strict";

import { createFakeDocument } from "./_dom-stub.mjs";

const saved = {
  document: globalThis.document,
  window: globalThis.window,
  requestAnimationFrame: globalThis.requestAnimationFrame,
  performance: globalThis.performance,
  GameContext: globalThis.GameContext,
  Players: globalThis.Players,
  Configuration: globalThis.Configuration,
  Locale: globalThis.Locale,
  UI: globalThis.UI,
  Audio: globalThis.Audio,
  GameInfo: globalThis.GameInfo
};

const { document } = createFakeDocument();
globalThis.document = document;
globalThis.window = {
  innerWidth: 1920,
  innerHeight: 1080,
  addEventListener: () => {}
};
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.performance = { now: () => 1000 };

globalThis.GameContext = { localPlayerID: 1 };
globalThis.Configuration = {
  getGame: () => ({ startSeed: "seed-1", getValue: () => "full" })
};

globalThis.Locale = { compose: (s) => String(s).replace(/^LOC_/, "") };
globalThis.UI = {
  Player: {
    getPrimaryColorValueAsString: () => "#557799"
  }
};
globalThis.Audio = { playSound: () => {} };

globalThis.GameInfo = {
  Civilizations: {
    lookup: () => ({ Name: "LOC_CS_NAME" })
  },
  DiplomacyActions: {
    lookup: () => ({ Name: "LOC_DIPLO_ACTION" })
  }
};

function makePlayer(id) {
  return {
    isMajor: id === 1 || id === 2,
    isMinor: id === 3,
    name: id === 3 ? "LOC_CITYSTATE_ALPHA" : undefined,
    civilizationType: id === 3 ? "CIV_ALPHA" : undefined,
    Diplomacy: {
      hasMet: (other) => (id === 1 ? other === 2 || other === 3 : true),
      isAtWarWith: () => false,
      hasAllied: () => false,
      getRelationshipEnum: () => 0,
      isOpenBordersWith: () => false
    },
    Trade: { countPlayerTradeRoutesTo: () => 0 },
    Influence: { getSuzerain: () => 1 }
  };
}

globalThis.Players = {
  getAliveIds: () => [1, 2, 3],
  get: (id) => makePlayer(Number(id))
};

const { render } = await import(
  "/demographics/ui/screen-demographics/views/relations/view-relations.js"
);
const { makeNodeSelectionWriter } = await import(
  "/demographics/ui/screen-demographics/views/relations/relations-settings.js"
);

function findByClass(root, cls) {
  const queue = [root];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (typeof cur.className === "string" && cur.className.split(/\s+/).includes(cls)) return cur;
    queue.push(...(cur.children || []));
  }
  return null;
}

function testRelationsRenderIntegration() {
  const writeNodeSelection = makeNodeSelectionWriter();
  writeNodeSelection("civ", new Set([1, 2, 999]));

  const frame = document.createElement("div");
  frame.className = "demographics-frame";
  frame._rect.width = 1200;
  frame._rect.height = 900;

  const host = document.createElement("div");
  host._rect.width = 1100;
  host._rect.height = 800;
  frame.appendChild(host);

  const ctx = {
    history: {
      samples: [
        {
          turn: 1,
          players: {
            "1": { leaderName: "Me", civName: "Rome", leaderTypeString: "LEADER_ME", primaryColor: "#224466", met: true },
            "2": { leaderName: "Other", civName: "Han", leaderTypeString: "LEADER_OTHER", primaryColor: "#446688", met: true },
            "3": { leaderName: "CS", civName: "CityState", leaderTypeString: "LEADER_CS", primaryColor: "#557799", met: true }
          }
        }
      ]
    },
    settings: {
      _data: {},
      getSetting(k, d) {
        return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : d;
      },
      setSetting(k, v) {
        this._data[k] = v;
      }
    }
  };

  render(host, ctx);
  assert.ok(host.children.length > 0, "relations render should mount scaffold");

  const topBar = findByClass(host, "demographics-relations-toptabs");
  assert.ok(topBar, "top tab bar should exist");
  topBar.dispatch("tab-selected", {});
  topBar.dispatch("tab-selected", { detail: { selectedItem: { id: "civ" } } });
  topBar.dispatch("tab-selected", { detail: { selectedItem: { id: "cs" } } });

  const subgroupRow = findByClass(host, "demographics-relations-subgroup-row");
  assert.ok(subgroupRow && subgroupRow.children.length > 0, "subgroup chips should render");
  subgroupRow.children[0].dispatch("click");
  subgroupRow.children[1].dispatch("click");

  const body = findByClass(host, "demographics-relations-body");
  assert.ok(body && body.children.length > 0, "ring body should render");

  const caption = findByClass(host, "demographics-relations-caption");
  assert.ok(caption, "caption should exist");

  topBar.dispatch("tab-selected", { detail: { selectedItem: { id: "civ" } } });
  assert.equal(String(caption.textContent).includes("focuses"), true, "multi-focus caption should use plural suffix");
  const clearFocusBtn = findByClass(host, "demographics-relations-clear-focus-btn");
  assert.ok(clearFocusBtn, "clear-focus button should render for active focus");
  clearFocusBtn.dispatch("click");
}

function testRenderClearsHostAndHandlesTabBarBuildError() {
  const frame = document.createElement("div");
  frame.className = "demographics-frame";
  const host = document.createElement("div");
  host.appendChild(document.createElement("div"));
  frame.appendChild(host);

  const ctx = {
    history: {
      samples: [
        {
          turn: 1,
          players: {
            "1": { leaderName: "Me", civName: "Rome", leaderTypeString: "LEADER_ME", primaryColor: "#224466", met: true }
          }
        }
      ]
    },
    settings: {
      getSetting(_k, d) {
        return d;
      },
      setSetting() {}
    }
  };

  render(host, ctx);
  assert.ok(host.children.length > 0, "render should rebuild host contents");

  const originalCreateElement = globalThis.document.createElement;
  globalThis.document.createElement = (tag) => {
    if (String(tag).toLowerCase() === "fxs-tab-bar") throw new Error("tabbar boom");
    return originalCreateElement.call(globalThis.document, tag);
  };
  render(host, ctx);
  globalThis.document.createElement = originalCreateElement;

  assert.ok(host.children.length > 0, "top-level render catch should keep scaffold mounted");
}

function testResizeAndOverlayFallbackBranches() {
  const frame = document.createElement("div");
  frame.className = "demographics-frame";
  const host = document.createElement("div");
  frame.appendChild(host);

  const ctx = {
    history: {
      samples: [
        {
          turn: 1,
          players: {
            "1": { leaderName: "Me", civName: "Rome", leaderTypeString: "LEADER_ME", primaryColor: "#224466", met: true },
            "2": { leaderName: "Other", civName: "Han", leaderTypeString: "LEADER_OTHER", primaryColor: "#446688", met: true }
          }
        }
      ]
    },
    settings: {
      getSetting(_k, d) {
        return d;
      },
      setSetting() {}
    }
  };

  const savedWindow = globalThis.window;
  const savedRaf = globalThis.requestAnimationFrame;
  globalThis.window = {};
  globalThis.requestAnimationFrame = undefined;
  render(host, ctx);

  globalThis.window = {
    innerWidth: 1920,
    innerHeight: 1080,
    addEventListener: () => {}
  };
  globalThis.requestAnimationFrame = undefined;
  render(host, ctx);

  const body = findByClass(host, "demographics-relations-body");
  assert.ok(body, "body should render under fallback scheduling mode");
  body.getBoundingClientRect = () => ({ width: 300, height: 0, top: 10, left: 0, bottom: 10 });

  const savedTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => {
    body.getBoundingClientRect = () => ({ width: 300, height: 240, top: 10, left: 0, bottom: 250 });
    fn();
    return 1;
  };

  render(host, ctx);
  globalThis.setTimeout = savedTimeout;
  globalThis.window = savedWindow;
  globalThis.requestAnimationFrame = savedRaf;
}

function testRelationsRenderObserverEmptyState() {
  globalThis.GameContext = {};

  const frame = document.createElement("div");
  frame.className = "demographics-frame";
  const host = document.createElement("div");
  frame.appendChild(host);

  const ctx = {
    history: { samples: [] },
    settings: {
      getSetting(_k, d) {
        return d;
      },
      setSetting() {}
    }
  };

  render(host, ctx);
  const empty = findByClass(host, "demographics-empty");
  assert.ok(empty, "observer empty state should render");
}

function testTopTabPersistThrowStillRepaints() {
  const frame = document.createElement("div");
  frame.className = "demographics-frame";
  const host = document.createElement("div");
  frame.appendChild(host);

  const ctx = {
    history: {
      samples: [
        {
          turn: 1,
          players: {
            "1": { leaderName: "Me", civName: "Rome", leaderTypeString: "LEADER_ME", primaryColor: "#224466", met: true },
            "2": { leaderName: "Other", civName: "Han", leaderTypeString: "LEADER_OTHER", primaryColor: "#446688", met: true }
          }
        }
      ]
    },
    settings: {
      getSetting(_k, d) {
        return d;
      },
      setSetting() {
        throw new Error("persist failed");
      }
    }
  };

  render(host, ctx);
  const topBar = findByClass(host, "demographics-relations-toptabs");
  assert.ok(topBar, "top bar should render even with throwing persistence");
  topBar.dispatch("tab-selected", { detail: { selectedItem: { id: "cs" } } });
  const body = findByClass(host, "demographics-relations-body");
  assert.ok(body, "ring body should remain after top-tab persistence throw");
}

try {
  testRelationsRenderIntegration();
  testRelationsRenderObserverEmptyState();
  testTopTabPersistThrowStillRepaints();
    testRenderClearsHostAndHandlesTabBarBuildError();
    testResizeAndOverlayFallbackBranches();
  console.log("relations-render-integration harness passed");
} finally {
  globalThis.document = saved.document;
  globalThis.window = saved.window;
  globalThis.requestAnimationFrame = saved.requestAnimationFrame;
  globalThis.performance = saved.performance;
  globalThis.GameContext = saved.GameContext;
  globalThis.Players = saved.Players;
  globalThis.Configuration = saved.Configuration;
  globalThis.Locale = saved.Locale;
  globalThis.UI = saved.UI;
  globalThis.Audio = saved.Audio;
  globalThis.GameInfo = saved.GameInfo;
}
