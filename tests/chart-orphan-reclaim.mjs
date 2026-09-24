import assert from "node:assert/strict";

// Regression gate for the Chart.js instance leak fixed on 2026-09-24.
//
// teardownExistingChart() only reaches a chart through the host element that still carries it, and
// destroyChartsUnder() only walks hosts still under the screen root. A view/page swap detaches the
// old host first, so the instance it held was unreachable by both and never destroyed — it kept its
// canvas listeners and full dataset for the life of the UI context. Watched in game on 1.5.0:
// every page-tab swap leaked 2 instances and closing + reopening the screen reclaimed none
// (7/6 -> 14/13 across six swaps); after the fix the same sequence held at 1/0.
//
// Chart.js is the ENGINE's global (fxs-hof-chart uses it too), so the sweep must destroy ONLY
// instances this mod created. That is the property most worth pinning: a sweep that took the
// engine's charts would break the base-game graphs.

/** A stand-in Chart instance. `canvas.__attached` decides whether document.body.contains() sees it. */
function fakeInstance(attached, owned) {
  const inst = {
    destroyed: false,
    canvas: { __attached: attached },
    destroy() {
      this.destroyed = true;
      delete globalThis.Chart.instances[this.__key];
    }
  };
  if (owned) inst.$demographicsOwned = true;
  return inst;
}

/** Install the globals the module touches: a Chart global with instances, and document.body. */
function installGlobals(instances) {
  globalThis.Chart = { instances: {} };
  for (const [k, v] of Object.entries(instances)) {
    v.__key = k;
    globalThis.Chart.instances[k] = v;
  }
  globalThis.document = {
    body: { contains: (node) => !!(node && node.__attached) }
  };
}

const { reclaimOrphanedCharts } = await import(
  "/demographics/ui/screen-demographics/charts/line/chart-line.js"
);

function testDestroysOnlyOurDetachedInstances() {
  const ourLive = fakeInstance(true, true);
  const ourOrphan = fakeInstance(false, true);
  const ourOrphan2 = fakeInstance(false, true);
  const engineLive = fakeInstance(true, false);
  const engineDetached = fakeInstance(false, false);
  installGlobals({ a: ourLive, b: ourOrphan, c: ourOrphan2, d: engineLive, e: engineDetached });

  const n = reclaimOrphanedCharts();

  assert.equal(n, 2, "should report exactly the two orphans it destroyed");
  assert.equal(ourOrphan.destroyed, true, "our detached chart must be destroyed");
  assert.equal(ourOrphan2.destroyed, true, "our second detached chart must be destroyed");
  assert.equal(ourLive.destroyed, false, "our ATTACHED chart must survive - it is the live one");
  assert.equal(
    engineDetached.destroyed,
    false,
    "an ENGINE chart must never be destroyed, even detached - fxs-hof-chart owns it"
  );
  assert.equal(engineLive.destroyed, false, "an engine chart in the document must never be touched");
}

function testSurvivesDestroyMutatingTheInstanceMap() {
  // Chart#destroy removes the instance from Chart.instances; sweeping must snapshot the keys or it
  // skips entries. Three consecutive orphans catch an iterate-while-mutating bug.
  const orphans = [fakeInstance(false, true), fakeInstance(false, true), fakeInstance(false, true)];
  installGlobals({ x: orphans[0], y: orphans[1], z: orphans[2] });

  assert.equal(reclaimOrphanedCharts(), 3, "all three orphans should go in one sweep");
  for (const [i, o] of orphans.entries()) {
    assert.equal(o.destroyed, true, `orphan ${i} should have been destroyed`);
  }
}

function testIsANoOpWithNothingToReclaim() {
  installGlobals({ a: fakeInstance(true, true) });
  assert.equal(reclaimOrphanedCharts(), 0, "nothing detached means nothing destroyed");
}

function testToleratesAMissingChartGlobal() {
  // Off-engine (Node tests, early load) there is no Chart global; the sweep must not throw.
  delete globalThis.Chart;
  assert.equal(reclaimOrphanedCharts(), 0, "no Chart global must be a quiet no-op");
  globalThis.Chart = {};
  assert.equal(reclaimOrphanedCharts(), 0, "a Chart global without .instances must be a no-op");
}

function testAThrowingDestroyDoesNotStopTheSweep() {
  const bad = fakeInstance(false, true);
  bad.destroy = () => {
    throw new Error("already disposed");
  };
  const good = fakeInstance(false, true);
  installGlobals({ bad, good });

  const n = reclaimOrphanedCharts();
  assert.equal(good.destroyed, true, "a throwing instance must not block the rest of the sweep");
  assert.equal(n, 1, "only the instance that actually went should be counted");
}

testDestroysOnlyOurDetachedInstances();
testSurvivesDestroyMutatingTheInstanceMap();
testIsANoOpWithNothingToReclaim();
testToleratesAMissingChartGlobal();
testAThrowingDestroyDoesNotStopTheSweep();

console.log("chart-orphan-reclaim harness passed (5 cases; engine-owned charts never destroyed)");
