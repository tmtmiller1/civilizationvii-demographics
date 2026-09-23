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

/** All portrait + label overlays under `root`, in tree order. */
function allOverlays(root) {
  const out = [];
  const queue = [root];
  while (queue.length > 0) {
    const cur = queue.shift();
    const cls = typeof cur.className === "string" ? cur.className.split(/\s+/) : [];
    if (cls.includes("demographics-relations-portrait") || cls.includes("demographics-relations-node-label")) {
      out.push(cur);
    }
    queue.push(...(cur.children || []));
  }
  return out;
}

// Regression guard for the blinking ring portraits: the ring is rebuilt on every filter toggle,
// but the NODE set is independent of the filters (computeCivRingData returns metIds untouched and
// filters only the edges). Re-creating each leader portrait made it flash while its `fxs-icon`
// art resolved again, so a shared cache must hand the SAME elements to the rebuilt ring.
function testPortraitCacheReusesOverlays() {
  const names = {
    1: { leaderName: "Me", civName: "Rome", leaderTypeString: "LEADER_ME", primaryColor: "#223344" },
    2: { leaderName: "Other", civName: "Han", leaderTypeString: "LEADER_OTHER", primaryColor: "#445566" },
    3: { isCityState: true, csName: "CS", csTypeIcon: "blp:bonus_scientific", csTypeColor: "#4ea6ec" }
  };
  const ids = [1, 2, 3];
  const cache = new Map();
  const edgesA = [{ a: 1, b: 2, filterKey: "alliance", color: "#4ea6ec", _typeLabel: "Alliance" }];
  const edgesB = [{ a: 1, b: 3, filterKey: "trade", color: "#4dc6c6", directed: true, _typeLabel: "Trade" }];

  const wrapA = buildRingSvg(ids, names, edgesA, 1, { viewerPid: 1, portraitCache: cache });
  document.body.appendChild(wrapA);
  wrapA.__placePortraits();
  const before = allOverlays(wrapA);
  assert.ok(before.length > 0, "the first ring places its overlays");
  assert.ok(
    before.some((el) => el.className.includes("demographics-relations-portrait")),
    "…including leader portraits (the engine-art elements)"
  );

  // A filter toggle: same nodes, different edges, same cache.
  const wrapB = buildRingSvg(ids, names, edgesB, 1, { viewerPid: 1, portraitCache: cache });
  document.body.appendChild(wrapB);
  wrapB.__placePortraits();
  const after = allOverlays(wrapB);
  assert.deepEqual(after, before, "the rebuilt ring reuses every overlay element (never re-created)");
  assert.equal(allOverlays(wrapA).length, 0, "…and they moved to the new wrap, leaving no duplicates");

  // Without a cache the overlays are rebuilt, as before — the cache is opt-in.
  const wrapC = buildRingSvg(ids, names, edgesB, 1, { viewerPid: 1 });
  document.body.appendChild(wrapC);
  wrapC.__placePortraits();
  const fresh = allOverlays(wrapC);
  assert.equal(fresh.length, before.length, "same overlay count without a cache");
  assert.ok(fresh.every((el) => !before.includes(el)), "…but all fresh elements");
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

function testDetachedWrapHoverAndGuardedFrames() {
  const names = {
    1: { leaderName: "Me", civName: "Rome", leaderTypeString: "LEADER_ME", primaryColor: "#223344" },
    2: { leaderName: "Other", civName: "Han", leaderTypeString: "LEADER_OTHER", primaryColor: "#445566" }
  };
  const edges = [{ a: 1, b: 2, filterKey: "alliance", color: "#4ea6ec", _typeLabel: "Alliance" }];
  // Synchronous rAF so the deferred paint runs inline (the previous test left it undefined).
  globalThis.requestAnimationFrame = (fn) => fn();
  const wrap = buildRingSvg([1, 2], names, edges, 1, { viewerPid: 1 });
  const ringSvg = findByClass(wrap, "demographics-relations-ring-svg");
  const tip = findByClass(wrap, "demographics-relations-edge-tip");
  assert.ok(ringSvg && tip, "ring svg + edge tooltip should exist");

  // Hover on a DETACHED wrap (a repaint replaced it while the cursor was still
  // over it): the handlers must return early, never measure / restyle the orphan.
  assert.equal(wrap.isConnected, false, "wrap starts detached");
  const throwingRect = () => {
    throw new Error("detached measure");
  };
  ringSvg.getBoundingClientRect = throwingRect;
  wrap.getBoundingClientRect = throwingRect;
  wrap.dispatch("mousemove", { clientX: 10, clientY: 10 });
  wrap.dispatch("mouseleave", {});
  assert.equal(tip.style.display, "none", "detached hover must not show the tooltip");

  // Attached, but getBoundingClientRect throws (GameFace can throw on a node
  // mid-teardown): mousemove must swallow it via the measurement guard.
  document.body.appendChild(wrap);
  wrap.dispatch("mousemove", { clientX: 10, clientY: 10 });
  assert.equal(tip.style.display, "none", "throwing svg measurement must not show the tooltip");
  // SVG measures, the tooltip anchor (wrap) throws: show() bails, hit or not.
  ringSvg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 240, height: 160, bottom: 160 });
  wrap.dispatch("mousemove", { clientX: 120, clientY: 80 });
  assert.equal(tip.style.display, "none", "throwing wrap measurement must not show the tooltip");
  wrap.dispatch("mouseleave", {});

  // placePortraits / paintOverlays run as rAF callbacks: a throw inside is
  // logged through derr, never thrown into the frame dispatcher.
  wrap.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 200, bottom: 200 });
  const errors = [];
  const savedError = console.error;
  const savedCreate = document.createElement;
  console.error = (...a) => errors.push(a.map(String).join(" "));
  document.createElement = (tag) => {
    if (String(tag).toLowerCase() === "fxs-icon") throw new Error("portrait boom");
    return savedCreate(tag);
  };
  try {
    wrap.__placePortraits();
  } finally {
    document.createElement = savedCreate;
    console.error = savedError;
  }
  assert.ok(
    errors.some((s) => s.includes("paintOverlays:")),
    "a throw inside the deferred overlay paint should be logged, not thrown"
  );

  // stripOldOverlays must cope with a GameFace-style array-like NodeList (no
  // forEach) whose elements lack remove(): old overlays go via the parent.
  wrap.__placePortraits();
  const before = wrap.querySelectorAll(".demographics-relations-portrait").length;
  assert.ok(before > 0, "overlays should paint once the DOM is sane again");
  const realQsa = wrap.querySelectorAll;
  wrap.querySelectorAll = (sel) => {
    const list = realQsa.call(wrap, sel);
    const arrayLike = { length: list.length };
    for (let i = 0; i < list.length; i++) {
      list[i].remove = undefined;
      arrayLike[i] = list[i];
    }
    return arrayLike;
  };
  wrap.__placePortraits();
  delete wrap.querySelectorAll;
  assert.equal(
    wrap.querySelectorAll(".demographics-relations-portrait").length,
    before,
    "old overlays should be stripped through parentNode (no pile-up) without NodeList.forEach / remove"
  );
}

try {
  testBuildRingSvgEmpty();
  testBuildRingSvgInteractive();
  testPortraitCacheReusesOverlays();
  testBuildRingSvgDenseNoCallback();
  testBuildRingSvgSingleNodeDetachedPlacement();
    testBuildRingSvgHoverAndLayoutFallbacks();
  testDetachedWrapHoverAndGuardedFrames();
  console.log("relations-ring-svg-branches harness passed");
} finally {
  globalThis.document = saved.document;
  globalThis.window = saved.window;
  globalThis.requestAnimationFrame = saved.requestAnimationFrame;
    globalThis.setTimeout = saved.setTimeout;
  globalThis.Locale = saved.Locale;
}
