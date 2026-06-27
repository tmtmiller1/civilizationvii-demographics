import assert from "node:assert/strict";

import {
  applyPolicyHide,
  applyShowEliminated,
  applySmoothChart,
  applyUnmetNames,
  buildChartDatasets,
  collapseGlobalMetric,
  resolveMetricMeta
} from "/demographics/ui/screen-demographics/charts/line/chart-line-datasets.js";
import { DemographicsSettings } from "/demographics/ui/core/demographics-settings.js";

const saved = {
  Configuration: globalThis.Configuration,
  GameContext: globalThis.GameContext,
  getSetting: DemographicsSettings.getSetting
};

function makeSettings(map) {
  DemographicsSettings.getSetting = (k, d) => (Object.prototype.hasOwnProperty.call(map, k) ? map[k] : d);
}

function setPolicy(mode) {
  globalThis.Configuration = {
    getGame: () => ({ getValue: (k) => (k === "DemographicsAnalyticsPolicy_v1" ? mode : null) })
  };
}

function baseSeries() {
  return [
    { leaderType: "A", pid: 1, met: true, eliminated: false, name: "A", color: "#112233", points: [{ t: 1, v: 1 }, { t: 2, v: 2 }] },
    { leaderType: "B", pid: 2, met: false, eliminated: true, name: "B", color: "#223344", points: [{ t: 1, v: 3 }, { t: 2, v: 4 }, { t: 3, v: 5 }] }
  ];
}

function testTransforms() {
  makeSettings({ showEliminatedCivs: false, smoothChart: true, showUnmetNames: false });
  globalThis.GameContext = { localPlayerID: 1 };
  setPolicy("met-civs-only");

  const noElim = applyShowEliminated(baseSeries());
  assert.equal(noElim.length, 1);

  const smooth = applySmoothChart([{ ...baseSeries()[0], points: [{ t: 1, v: 1 }, { t: 2, v: 4 }, { t: 3, v: 7 }] }]);
  assert.equal(smooth[0].points[1].v, 4);

  const hiddenByPolicy = applyPolicyHide(baseSeries());
  assert.deepEqual(hiddenByPolicy.map((s) => s.pid), [1]);

  const unmetMask = applyUnmetNames(baseSeries());
  assert.equal(unmetMask[1].name, "LOC_DEMOGRAPHICS_LINE_UNMET_CIV");
}

function testGlobalCollapseAndDatasets() {
  const metricMeta = { global: true, title: "Global Metric" };
  const collapsed = collapseGlobalMetric(baseSeries(), metricMeta, "score");
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].name, "Global Metric");

  assert.equal(resolveMetricMeta("score")?.id, "score");

  const datasets = buildChartDatasets(
    [
      { leaderType: "A", leaderTypeString: "LEADER_A", pid: 1, name: "A", color: "#112233", eliminated: false, points: [{ t: 1, v: 1 }, { t: 2, v: 2 }, { t: 3, v: 3 }] },
      { leaderType: "B", leaderTypeString: "LEADER_B", pid: 2, name: "B", color: "#223344", eliminated: true, points: [{ t: 1, v: 3 }, { t: 2, v: 4 }, { t: 3, v: 5 }] }
    ],
    new Set(["B"]),
    new Set(["A"]),
    { min: 2, max: 3 }
  );

  assert.equal(datasets.length, 2);
  assert.equal(datasets[0]._focused, true);
  assert.equal(datasets[1]._muted, true);
  assert.equal(datasets[0].data.length, 2, "turn-range filter should apply");
  assert.equal(datasets[0].hidden, false);
}

try {
  testTransforms();
  testGlobalCollapseAndDatasets();
  console.log("chart-line-datasets-branches harness passed");
} finally {
  globalThis.Configuration = saved.Configuration;
  globalThis.GameContext = saved.GameContext;
  DemographicsSettings.getSetting = saved.getSetting;
}
