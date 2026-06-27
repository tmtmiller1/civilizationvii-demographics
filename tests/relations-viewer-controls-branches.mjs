import assert from "node:assert/strict";

import { createFakeDocument } from "./_dom-stub.mjs";

const savedDocument = globalThis.document;
const { document } = createFakeDocument();
globalThis.document = document;

const { buildViewerDropdownPanel } = await import(
  "/demographics/ui/screen-demographics/views/relations/relations-viewer-controls.js"
);

function testNoopWhenNotCs() {
  const host = document.createElement("div");
  host.appendChild(document.createElement("span"));
  buildViewerDropdownPanel({
    topTab: "civ",
    metIds: [1],
    sc: { viewerHost: host }
  });
  assert.equal(host.children.length, 0, "panel should clear and no-op off cs tab");
}

function testDropdownSelectionFlow() {
  const host = document.createElement("div");
  const writes = [];
  let repaintCount = 0;
  const rs = {
    topTab: "cs",
    metIds: [1, 2],
    csViewerPid: 1,
    localId: 1,
    namesBase: { 1: { leaderName: "Me" }, 2: { leaderName: "Other" } },
    settings: { setSetting: (k, v) => writes.push({ k, v }) },
    repaint: () => {
      repaintCount += 1;
    },
    sc: { viewerHost: host }
  };

  buildViewerDropdownPanel(rs);
  assert.equal(host.children.length, 2, "label + dropdown expected");

  const dd = host.children[1];
  dd.dispatch("dropdown-selection-change", { detail: { selectedIndex: -1 } });
  dd.dispatch("dropdown-selection-change", { detail: { selectedIndex: 0 } });
  dd.dispatch("dropdown-selection-change", {});
  assert.equal(repaintCount, 0);

  dd.dispatch("dropdown-selection-change", { detail: { selectedIndex: 1 } });
  assert.equal(rs.csViewerPid, 2);
  assert.equal(repaintCount, 1);
  assert.deepEqual(writes, [{ k: "relationsCsViewerPid", v: 2 }]);

  dd.dispatch("dropdown-selection-change", { detail: { selectedIndex: 1 } });
  assert.equal(repaintCount, 1);
}

function testDropdownFallbackNamesAndPersistThrow() {
  const host = document.createElement("div");
  let repaintCount = 0;
  const rs = {
    topTab: "cs",
    metIds: [7, 8],
    csViewerPid: 99,
    localId: 7,
    namesBase: {
      8: {}
    },
    settings: {
      setSetting() {
        throw new Error("persist failed");
      }
    },
    repaint: () => {
      repaintCount += 1;
    },
    sc: { viewerHost: host }
  };

  buildViewerDropdownPanel(rs);
  assert.equal(host.children.length, 2, "label + dropdown expected for cs tab");

  const dd = host.children[1];
  assert.equal(dd.getAttribute("selected-item-index"), "0", "out-of-range viewer pid should fall back to first item");

  const items = JSON.parse(dd.getAttribute("dropdown-items"));
  assert.equal(Array.isArray(items), true);
  assert.equal(items.length, 2);
  assert.equal(String(items[0].label).includes("YOU") || String(items[0].label).includes("You"), true, "local viewer item should use YOU label path");
  assert.equal(String(items[1].label).length > 0, true, "missing leader info should still produce fallback label");

  dd.dispatch("dropdown-selection-change", { detail: { selectedIndex: 1 } });
  assert.equal(rs.csViewerPid, 8);
  assert.equal(repaintCount, 1, "repaint should still run when settings persistence throws");
}

try {
  testNoopWhenNotCs();
  testDropdownSelectionFlow();
    testDropdownFallbackNamesAndPersistThrow();
  console.log("relations-viewer-controls-branches harness passed");
} finally {
  globalThis.document = savedDocument;
}
