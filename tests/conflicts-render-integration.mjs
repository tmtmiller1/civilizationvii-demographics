import assert from "node:assert/strict";

import { createFakeDocument } from "./_dom-stub.mjs";

const saved = {
  document: globalThis.document,
  window: globalThis.window,
  requestAnimationFrame: globalThis.requestAnimationFrame,
  setTimeout: globalThis.setTimeout,
  Locale: globalThis.Locale,
  Configuration: globalThis.Configuration,
  Game: globalThis.Game,
  GameContext: globalThis.GameContext,
  Players: globalThis.Players,
  UI: globalThis.UI,
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
globalThis.setTimeout = (fn) => {
  fn();
  return 0;
};

globalThis.Locale = {
  compose: (k) => String(k).replace(/^LOC_/, "")
};

globalThis.Configuration = {
  getGame: () => ({
    getValue: () => "full",
    startSeed: "seed-conflicts"
  })
};

globalThis.Game = {
  turn: 30,
  getTurnDate: () => "3000 BCE"
};

globalThis.GameContext = { localPlayerID: 1 };

globalThis.Players = {
  getAliveIds: () => [1, 2, 3],
  get: (id) => ({
    id,
    isMajor: id !== 3,
    isMinor: id === 3,
    Diplomacy: {
      hasMet: () => true
    }
  })
};

globalThis.UI = {
  getIconURL: () => "blp:test"
};

globalThis.GameInfo = {
  Civilizations: {
    lookup: () => ({ Name: "LOC_CIV" })
  },
  Leaders: {
    lookup: () => ({ Name: "LOC_LEADER" })
  },
  Types: {
    lookup: () => ({ Kind: "KIND_LEADER" })
  },
  LandmarkReveals: []
};

const { renderConflictsTimeline, collectWarCivOptions } = await import(
  "/demographics/ui/screen-demographics/charts/conflicts/chart-conflicts-timeline.js"
);
const { mergeWars } = await import(
  "/demographics/ui/screen-demographics/charts/wars/chart-wars-merge.js"
);
const { renderConflictsGraphs } = await import(
  "/demographics/ui/screen-demographics/charts/conflicts/chart-conflicts-graphs.js"
);

function buildHistory() {
  return {
    samples: [
      {
        turn: 1,
        chartTurn: 1,
        gameYear: "4000 BCE",
        age: "AGE_ANTIQUITY",
        players: {
          "1": { metrics: { milpower: 100, cityWarNetCum: 0, razedCum: 0, warLandCum: 0, populationRaw: 30, crops: 12, production: 10, warProdCum: 2, unitsLostCum: 0 } },
          "2": { metrics: { milpower: 95, cityWarNetCum: 0, razedCum: 0, warLandCum: 0, populationRaw: 28, crops: 11, production: 9, warProdCum: 1, unitsLostCum: 0 } }
        }
      },
      {
        turn: 2,
        chartTurn: 2,
        gameYear: "3900 BCE",
        age: "AGE_EXPLORATION",
        players: {
          "1": { metrics: { milpower: 90, milLostCum: 10, cityWarNetCum: 1, razedCum: 0, warLandCum: 2, populationRaw: 29, crops: 10, production: 8, warProdCum: 4, unitsLostCum: 1 } },
          "2": { metrics: { milpower: 80, milLostCum: 15, cityWarNetCum: -1, razedCum: 1, warLandCum: -2, populationRaw: 25, crops: 9, production: 7, warProdCum: 3, unitsLostCum: 2 } }
        }
      },
      {
        turn: 3,
        chartTurn: 3,
        gameYear: "3800 BCE",
        age: "AGE_EXPLORATION",
        players: {
          "1": { metrics: { milpower: 85, milLostCum: 18, cityWarNetCum: 1, razedCum: 1, warLandCum: 2, populationRaw: 28, crops: 9, production: 7, warProdCum: 6, unitsLostCum: 2 } },
          "2": { metrics: { milpower: 70, milLostCum: 28, cityWarNetCum: -1, razedCum: 2, warLandCum: -3, populationRaw: 22, crops: 8, production: 6, warProdCum: 4, unitsLostCum: 4 } }
        }
      }
    ],
    wars: [
      {
        warUniqueID: 500,
        name: "Great War",
        startTurn: 1,
        startChartTurn: 1,
        endTurn: 3,
        endChartTurn: 3,
        startYear: "4000 BCE",
        endYear: "3800 BCE",
        sideACivs: [
          { pid: 1, civ: "Rome", leader: "A", color: "#225588", isCS: false }
        ],
        sideBCivs: [
          { pid: 2, civ: "Han", leader: "B", color: "#884422", isCS: false }
        ]
      }
    ]
  };
}

function findByClass(root, cls) {
  const queue = [root];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (typeof cur.className === "string" && cur.className.split(/\s+/).includes(cls)) return cur;
    queue.push(...(cur.children || []));
  }
  return null;
}

/**
 * Capture console.error lines emitted while `fn` runs.
 * @param {() => void} fn The body.
 * @returns {string[]} The first argument of each console.error call.
 */
function captureErrors(fn) {
  const lines = [];
  const orig = console.error;
  console.error = (...a) => lines.push(String(a[0]));
  try {
    fn();
  } finally {
    console.error = orig;
  }
  return lines;
}

function testNullPersistedElements() {
  // The wars / samples ARRAYS are type-checked; a null ELEMENT (a persisted blob can carry one)
  // must be dropped, not dereferenced, by both conflicts renderers.
  const history = buildHistory();
  history.wars = [null, ...history.wars, undefined];
  history.samples = [null, ...history.samples, null];

  const timelineHost = document.createElement("div");
  timelineHost._rect.width = 1300;
  timelineHost._rect.height = 800;
  const out = renderConflictsTimeline(timelineHost, { history, width: 1200, height: 700, showCs: true });
  assert.ok(out && out.svg, "timeline renders past null wars / samples");

  const graphsHost = document.createElement("div");
  graphsHost._rect.width = 1300;
  graphsHost._rect.height = 900;
  renderConflictsGraphs(graphsHost, { history, selectedWarId: 500 });
  assert.ok(findByClass(graphsHost, "demographics-war-graphs"), "war graphs render past null wars / samples");

  // The two war-list readers the toolbar calls directly on the persisted list.
  assert.equal(collectWarCivOptions(history).length, 2, "civ options skip the null war");
  const second = { ...history.wars[1], warUniqueID: 501, startTurn: 5, endTurn: 6 };
  assert.equal(mergeWars([null, history.wars[1], second], 6).length, 2, "mergeWars drops the null war");
}

function testGraphsRerenderHandlersAreGuarded() {
  // Click handlers re-enter the renderers OUTSIDE the initial render's try/catch: a throw must be
  // logged, not thrown out of the handler.
  const history = buildHistory();
  const host = document.createElement("div");
  host._rect.width = 1300;
  host._rect.height = 900;
  renderConflictsGraphs(host, { history, selectedWarId: 500 });
  const controls = findByClass(host, "demographics-war-graphs-controls");
  assert.ok(controls && controls.children.length >= 2, "All/None controls present");
  const mil = findByClass(host, "demographics-war-graph-mil-body");
  assert.ok(mil, "a military/casualty cell body is present");
  const filterBtn = mil.parentNode.children.find((c) => c !== mil && c.className === "demographics-war-graph-filter");
  assert.ok(filterBtn && filterBtn.children.length > 1, "cell filter pills present");

  // Make the in-place re-render throw (its first act is clearing the body), then click.
  mil.removeChild = () => { throw new Error("boom-cell"); };
  const cellLines = captureErrors(() => filterBtn.children[1].dispatch("click"));
  assert.equal(cellLines.length, 1, "cell re-render throw is logged once");
  assert.ok(cellLines[0].includes("chart-conflicts-graphs"), "logged via the module logger");

  // Same for the whole-panel re-render (its first act is clearing the host).
  host.removeChild = () => { throw new Error("boom-panel"); };
  const panelLines = captureErrors(() => controls.children[0].dispatch("click"));
  assert.equal(panelLines.length, 1, "panel re-render throw is logged once");
  assert.ok(findByClass(host, "demographics-war-graphs"), "prior panel DOM stays in place");
}

function testGanttHoverIsGuarded() {
  // The Gantt hover handler runs outside any render guard: on a throw it hides the tooltip.
  const history = buildHistory();
  const host = document.createElement("div");
  host._rect.width = 1300;
  host._rect.height = 800;
  const out = renderConflictsTimeline(host, { history, width: 1200, height: 700, showCs: true });
  const wrap = findByClass(host, "demographics-wars-wrap");
  const tooltip = findByClass(host, "demographics-wars-tooltip");
  assert.ok(wrap && tooltip, "gantt wrap + tooltip mounted");
  tooltip.style.display = "block";
  out.svg.getBoundingClientRect = () => { throw new Error("boom-rect"); };
  wrap.dispatch("mousemove", { clientX: 10, clientY: 10 });
  assert.equal(tooltip.style.display, "none", "tooltip hidden on a throwing hover");
}

function testConflictsRenderIntegration() {
  const history = buildHistory();

  const timelineHost = document.createElement("div");
  timelineHost._rect.width = 1300;
  timelineHost._rect.height = 800;
  const out = renderConflictsTimeline(timelineHost, {
    history,
    width: 1200,
    height: 700,
    turnRange: { min: 1, max: 3 },
    showCs: true,
    activeOnly: false,
    filterPid: null
  });
  assert.ok(out && out.svg, "timeline should return mounted svg handle");
  assert.ok(timelineHost.children.length > 0, "timeline host should receive chart markup");

  const graphsHost = document.createElement("div");
  graphsHost._rect.width = 1300;
  graphsHost._rect.height = 900;
  renderConflictsGraphs(graphsHost, { history, selectedWarId: 500 });
  assert.ok(findByClass(graphsHost, "demographics-war-graphs"), "war graphs panel should render");
  assert.ok(findByClass(graphsHost, "demographics-war-graphs-grid"), "war graphs grid should render");
}

/**
 * The crisis labels get a band of their own at the top of the plot, so the first war bar starts
 * below them. Before this the labels were drawn over the first two bars and only cleared their
 * names at the reference resolution, where the names happen to be short (720p regression,
 * 2026-09-23). Checked on the layout rather than on mounted rects: the DOM stub has no text metrics.
 */
async function testCrisisBandClearsTheBars() {
  const { buildGanttLayout, crisisBandHeight, CRISIS_LABEL_ROWS } = await import(
    "/demographics/ui/screen-demographics/charts/wars/chart-wars-gantt-domain.js"
  );
  const dom = { xMin: 1, xMax: 100 };
  const wars = [{ sideACivs: [0], sideBCivs: [1] }, { sideACivs: [0], sideBCivs: [2] }];

  assert.equal(crisisBandHeight(0, 1), 0, "no onsets, no band");
  const one = crisisBandHeight(1, 1);
  const many = crisisBandHeight(9, 1);
  assert.ok(one > 0, "one onset reserves room");
  assert.ok(many > one, "more onsets stagger deeper");
  assert.equal(many, crisisBandHeight(CRISIS_LABEL_ROWS, 1), "the band stops at the stagger depth");
  // Text is boosted relative to the layout at small resolutions, so the band has to grow with it.
  assert.ok(crisisBandHeight(3, 1.2) > crisisBandHeight(3, 1), "a boosted type scale reserves more");

  const plain = buildGanttLayout(1200, 700, wars, dom, 0);
  const banded = buildGanttLayout(1200, 700, wars, dom, many);
  assert.equal(plain.crisisBand, 0, "no band without onsets");
  assert.equal(banded.crisisBand, many, "the band is carried on the layout");
  assert.equal(banded.rowTops[0] - plain.rowTops[0], many, "the first bar drops by the whole band");
  // The band lies between the top of the plot frame and the first bar.
  assert.ok(banded.padT - banded.crisisBand < banded.rowTops[0], "the band is above the bars");
  assert.ok(banded.rowTops[0] >= banded.padT, "and the bars start below it");
}

try {
  testConflictsRenderIntegration();
  await testCrisisBandClearsTheBars();
  testNullPersistedElements();
  testGraphsRerenderHandlersAreGuarded();
  testGanttHoverIsGuarded();
  console.log("conflicts-render-integration harness passed");
} finally {
  globalThis.document = saved.document;
  globalThis.window = saved.window;
  globalThis.requestAnimationFrame = saved.requestAnimationFrame;
  globalThis.setTimeout = saved.setTimeout;
  globalThis.Locale = saved.Locale;
  globalThis.Configuration = saved.Configuration;
  globalThis.Game = saved.Game;
  globalThis.GameContext = saved.GameContext;
  globalThis.Players = saved.Players;
  globalThis.UI = saved.UI;
  globalThis.GameInfo = saved.GameInfo;
}
