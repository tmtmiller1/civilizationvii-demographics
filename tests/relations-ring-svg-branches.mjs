import assert from "node:assert/strict";

import { createFakeDocument } from "./_dom-stub.mjs";

const saved = {
  document: globalThis.document,
  window: globalThis.window,
  requestAnimationFrame: globalThis.requestAnimationFrame,
  setTimeout: globalThis.setTimeout,
  Locale: globalThis.Locale
};

const { document } = createFakeDocument();
globalThis.document = document;
globalThis.window = {
  innerWidth: 1920,
  innerHeight: 1080,
  addEventListener: () => {}
};
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.Locale = { compose: (k) => String(k) };

const { buildRingSvg } = await import(
  "/demographics/ui/screen-demographics/views/relations/relations-ring-svg.js"
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

function testBuildRingSvgEmpty() {
  const wrap = buildRingSvg([], {}, [], 1, {});
  assert.equal(wrap.className, "demographics-relations-ring-wrap");
  assert.ok(findByClass(wrap, "demographics-empty"));
}

function testBuildRingSvgInteractive() {
  const names = {
    1: { leaderName: "Me", civName: "Rome", leaderTypeString: "LEADER_ME", primaryColor: "#223344" },
    2: { leaderName: "Other", civName: "Han", leaderTypeString: "LEADER_OTHER", primaryColor: "#445566" },
    3: { isCityState: true, csName: "CS", csTypeIcon: "blp:bonus_scientific", csTypeColor: "#4ea6ec" }
  };
  const toggled = [];
  const wrap = buildRingSvg(
    [1, 2, 3],
    names,
    [
      { a: 1, b: 2, filterKey: "alliance", color: "#4ea6ec", _typeLabel: "Alliance" },
      { a: 1, b: 3, filterKey: "trade", color: "#4dc6c6", directed: true, _typeLabel: "Trade" }
    ],
    1,
    {
      viewerPid: 1,
      selectedNodeIds: new Set([1]),
      onNodeToggle: (pid) => toggled.push(pid)
    }
  );

  assert.ok(wrap.__placePortraits, "overlay placer should be attached");
  document.body.appendChild(wrap);
  wrap.__placePortraits();

  const ringSvg = findByClass(wrap, "demographics-relations-ring-svg");
  assert.ok(ringSvg, "ring svg should exist");

  const portrait = findByClass(wrap, "demographics-relations-portrait");
  assert.ok(portrait, "portrait overlays should be placed");
  portrait.dispatch("click");
  assert.ok(toggled.length >= 1, "clicking portrait should toggle focus");

  wrap.dispatch("mousemove", { clientX: 40, clientY: 40 });
  wrap.dispatch("mouseleave", {});
}

function testBuildRingSvgDenseNoCallback() {
  const ids = Array.from({ length: 13 }, (_, i) => i + 1);
  const names = {};
  for (const id of ids) {
    names[id] = {
      leaderName: "L" + id,
      civName: "C" + id,
      leaderTypeString: "LEADER_" + id,
      primaryColor: "#223344"
    };
  }
  // Force one entry down the empty-label path.
  names[13] = { leaderTypeString: "LEADER_13", primaryColor: "#223344" };

  const edges = [];
  for (let i = 1; i < ids.length; i++) {
    edges.push({ a: i, b: i + 1, filterKey: i % 2 ? "alliance" : "trade", color: "#4dc6c6", directed: i % 2 === 0, _typeLabel: "Edge" + i });
  }

  const wrap = buildRingSvg(ids, names, edges, 1, { viewerPid: 1, selectedNodeIds: new Set([2]) });
  document.body.appendChild(wrap);
  assert.ok(wrap.__placePortraits, "dense wrap should expose placement hook");
  wrap.__placePortraits();

  const ringSvg = findByClass(wrap, "demographics-relations-ring-svg");
  assert.ok(ringSvg, "dense ring svg should exist");

  const portrait = findByClass(wrap, "demographics-relations-portrait");
  assert.ok(portrait, "dense portrait should render");
  // No callback configured: click should not throw.
  portrait.dispatch("click");

  wrap.dispatch("mousemove", { clientX: 0, clientY: 0 });
  wrap.dispatch("mouseleave", {});
}

function testBuildRingSvgSingleNodeDetachedPlacement() {
  const wrap = buildRingSvg(
    [1],
    { 1: { leaderName: "", civName: "", leaderTypeString: "LEADER_ONE", primaryColor: "#111111" } },
    [],
    1,
    { viewerPid: 1 }
  );
  assert.ok(wrap.__placePortraits, "single-node wrap should expose placement hook");

  // Detached call exercises the isConnected guard path.
  wrap.__placePortraits();

  document.body.appendChild(wrap);
  const ringSvg = findByClass(wrap, "demographics-relations-ring-svg");
  assert.ok(ringSvg, "single-node ring svg should render");

  // Force a zero-sized measurement branch, then restore and place again.
  ringSvg._rect.width = 0;
  ringSvg._rect.height = 0;
  wrap.__placePortraits();
  ringSvg._rect.width = 240;
  ringSvg._rect.height = 180;
  wrap.__placePortraits();

  wrap.dispatch("mousemove", {});
  wrap.dispatch("mouseleave", {});
}

function testBuildRingSvgHoverAndLayoutFallbacks() {
  const ids = [10, 11];
  const names = {
    10: { leaderName: "Ten", civName: "TenCiv", leaderTypeString: "LEADER_TEN", primaryColor: "#223344" }
  };
  const edges = [{ a: 10, b: 11, filterKey: "alliance", color: "#4ea6ec", _typeLabel: "Alliance" }];

  const frame = document.createElement("div");
  frame.className = "demographics-frame";
  frame.getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 220, bottom: 220 });

  const relWrap = document.createElement("div");
  relWrap.className = "demographics-relations-wrap";
  const body = document.createElement("div");
  body.className = "demographics-relations-body";
  body.getBoundingClientRect = () => ({ left: 0, top: 40, width: 300, height: 300, bottom: 340 });
  const caption = document.createElement("div");
  caption.className = "demographics-relations-caption";
  caption.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 16, bottom: 16 });

  const wrap = buildRingSvg(ids, names, edges, 10, { viewerPid: 10 });
  body.appendChild(wrap);
  relWrap.appendChild(caption);
  relWrap.appendChild(body);
  frame.appendChild(relWrap);
  document.body.appendChild(frame);

  const ringSvg = findByClass(wrap, "demographics-relations-ring-svg");
  assert.ok(ringSvg, "ring svg should exist in fallback scenario");

  // First measurement uses explicit rect + viewport coordinates for hover math.
  ringSvg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 240, height: 160, bottom: 160 });
  wrap.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 200, bottom: 200 });
  wrap.clientWidth = 300;
  wrap.clientHeight = 200;

  // Disable rAF to drive the setTimeout fallback path in scheduleRetry.
  globalThis.requestAnimationFrame = undefined;
  const originalSetTimeout = globalThis.setTimeout;
  let timeoutCalls = 0;
  globalThis.setTimeout = (fn) => {
    timeoutCalls += 1;
    ringSvg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 240, height: 160, bottom: 160 });
    fn();
    return 1;
  };

  // Force one not-ready layout pass so scheduleRetry() uses setTimeout.
  ringSvg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0, bottom: 0 });
  wrap.__placePortraits();
  assert.equal(timeoutCalls > 0, true, "setTimeout retry path should run when rAF is unavailable");

  // Trigger hover hit + repeat-hit + clear paths with deterministic coordinates.
  wrap.dispatch("mousemove", { clientX: 120, clientY: 80 });
  wrap.dispatch("mousemove", { clientX: 120, clientY: 80 });
  wrap.dispatch("mousemove", { clientX: 0, clientY: 0 });
  wrap.dispatch("mouseleave", {});

  // Trigger clientToViewBox null-pt path by collapsing measured rect.
  ringSvg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0, bottom: 0 });
  wrap.dispatch("mousemove", { clientX: 100, clientY: 100 });

  // Restore timeout for later tests.
  globalThis.setTimeout = originalSetTimeout;
}

try {
  testBuildRingSvgEmpty();
  testBuildRingSvgInteractive();
  testBuildRingSvgDenseNoCallback();
  testBuildRingSvgSingleNodeDetachedPlacement();
    testBuildRingSvgHoverAndLayoutFallbacks();
  console.log("relations-ring-svg-branches harness passed");
} finally {
  globalThis.document = saved.document;
  globalThis.window = saved.window;
  globalThis.requestAnimationFrame = saved.requestAnimationFrame;
    globalThis.setTimeout = saved.setTimeout;
  globalThis.Locale = saved.Locale;
}
