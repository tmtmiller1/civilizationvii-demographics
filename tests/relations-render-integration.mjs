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
// The view wires ONE module-level window "resize" listener on its first ring
// mount; record it so later tests can fire it against a detached scaffold.
const resizeListeners = [];
globalThis.window = {
  innerWidth: 1920,
  innerHeight: 1080,
  addEventListener: (name, fn) => {
    if (name === "resize") resizeListeners.push(fn);
  }
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

const { render, releaseRelationsView } = await import(
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
  assert.equal(String(caption.textContent).includes("FOCUS_HINT"), true, "multi-focus caption should show the localized focus hint");
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

function twoPlayerCtx(settingsOverride) {
  return {
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
    settings: settingsOverride || {
      getSetting(_k, d) {
        return d;
      },
      setSetting() {}
    }
  };
}

function captureConsoleError(fn) {
  const errors = [];
  const savedError = console.error;
  console.error = (...a) => errors.push(a.map(String).join(" "));
  try {
    fn();
  } finally {
    console.error = savedError;
  }
  return errors;
}

function testResizeSkipsDetachedScaffold() {
  assert.ok(resizeListeners.length > 0, "the view should have wired its one-time resize listener");
  const fireResize = () => {
    for (const fn of resizeListeners) fn();
  };
  globalThis.requestAnimationFrame = (fn) => fn();
  // The observer-empty test above blanks GameContext; a ring needs a local player.
  globalThis.GameContext = { localPlayerID: 1 };

  const frame = document.createElement("div");
  frame.className = "demographics-frame";
  const host = document.createElement("div");
  frame.appendChild(host);
  render(host, twoPlayerCtx());

  const ringWrap = findByClass(host, "demographics-relations-ring-wrap");
  const body = findByClass(host, "demographics-relations-body");
  assert.ok(ringWrap && body, "ring wrap + body should mount");
  let placeCalls = 0;
  ringWrap.__placePortraits = () => {
    placeCalls += 1;
  };

  // Attached: a resize re-fits the live ring even when the body measurement throws
  // (GameFace can throw from getBoundingClientRect mid-teardown).
  body.getBoundingClientRect = () => {
    throw new Error("measure boom");
  };
  const errors = captureConsoleError(fireResize);
  assert.equal(placeCalls, 1, "resize should re-fit the attached ring");
  assert.deepEqual(errors, [], "a throwing body measurement must be absorbed, not logged as a failure");

  // Detached (the screen closed): the hook must skip the work AND drop its references.
  Object.defineProperty(ringWrap, "isConnected", { value: false, configurable: true });
  fireResize();
  assert.equal(placeCalls, 1, "resize must skip a detached ring wrap");
  Object.defineProperty(ringWrap, "isConnected", { value: true, configurable: true });
  fireResize();
  assert.equal(placeCalls, 1, "released references must not be revived by a later resize");

  // The scaffold body detaching (host rebuilt) releases the same way.
  render(host, twoPlayerCtx());
  const ringWrap2 = findByClass(host, "demographics-relations-ring-wrap");
  const body2 = findByClass(host, "demographics-relations-body");
  let placeCalls2 = 0;
  ringWrap2.__placePortraits = () => {
    placeCalls2 += 1;
  };
  Object.defineProperty(body2, "isConnected", { value: false, configurable: true });
  fireResize();
  assert.equal(placeCalls2, 0, "resize must skip a scaffold whose body left the DOM");

  // Explicit release (for a screen-level teardown) stops the re-fit outright.
  render(host, twoPlayerCtx());
  const ringWrap3 = findByClass(host, "demographics-relations-ring-wrap");
  let placeCalls3 = 0;
  ringWrap3.__placePortraits = () => {
    placeCalls3 += 1;
  };
  fireResize();
  assert.equal(placeCalls3, 1, "sanity: a live ring is re-fit before release");
  releaseRelationsView();
  fireResize();
  assert.equal(placeCalls3, 1, "releaseRelationsView must stop the resize re-fit");
}

function testRepaintGuardsThrowingSubRenderer() {
  globalThis.requestAnimationFrame = (fn) => fn();
  globalThis.GameContext = { localPlayerID: 1 };
  const frame = document.createElement("div");
  frame.className = "demographics-frame";
  const host = document.createElement("div");
  frame.appendChild(host);
  render(host, twoPlayerCtx());

  const subgroupRow = findByClass(host, "demographics-relations-subgroup-row");
  const portrait = findByClass(host, "demographics-relations-portrait");
  assert.ok(subgroupRow && subgroupRow.children.length > 1, "subgroup chips should render");
  assert.ok(portrait, "a portrait overlay should be placed for the node-toggle path");

  // Make the ring's SVG construction throw, then drive both handler-side repaint
  // entry points: a sub-group chip click (rs.repaint) and a portrait click
  // (rs.repaintRing). Neither may escape; both must be logged.
  const savedNS = document.createElementNS;
  document.createElementNS = () => {
    throw new Error("svg boom");
  };
  let errors;
  try {
    errors = captureConsoleError(() => {
      subgroupRow.children[1].dispatch("click");
      portrait.dispatch("click");
    });
  } finally {
    document.createElementNS = savedNS;
  }
  assert.ok(errors.some((s) => s.includes("repaint:")), "repaint must log a throwing sub-renderer");
  assert.ok(errors.some((s) => s.includes("repaintRing:")), "repaintRing must log a throwing sub-renderer");
  assert.ok(findByClass(host, "demographics-relations-toptabs"), "the scaffold survives a failed repaint");
}

function testRenderPrologueThrowShowsFallback() {
  const frame = document.createElement("div");
  frame.className = "demographics-frame";
  const host = document.createElement("div");
  frame.appendChild(host);
  const ctx = {
    get history() {
      throw new Error("history boom");
    },
    settings: {
      getSetting(_k, d) {
        return d;
      },
      setSetting() {}
    }
  };
  const errors = captureConsoleError(() => render(host, ctx));
  assert.ok(errors.some((s) => s.includes("render:")), "a prologue throw must reach the render boundary");
  const empty = findByClass(host, "demographics-empty");
  assert.ok(empty, "a failed render must leave a visible empty-state notice, not a blank panel");
  assert.ok(
    String(empty.textContent).includes("EMPTY_CHART_RENDER_FAILED"),
    "the notice should reuse the shared render-failed text"
  );
}

try {
  testRelationsRenderIntegration();
  testRelationsRenderObserverEmptyState();
  testTopTabPersistThrowStillRepaints();
    testRenderClearsHostAndHandlesTabBarBuildError();
    testResizeAndOverlayFallbackBranches();
  testResizeSkipsDetachedScaffold();
  testRepaintGuardsThrowingSubRenderer();
  testRenderPrologueThrowShowsFallback();
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
