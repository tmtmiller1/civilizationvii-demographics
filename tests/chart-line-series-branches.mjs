import assert from "node:assert/strict";

import { buildSeriesFromHistory } from "/demographics/ui/screen-demographics/charts/line/chart-line-series.js";
import { DemographicsSettings } from "/demographics/ui/core/demographics-settings.js";

const saved = {
  Configuration: globalThis.Configuration,
  GameContext: globalThis.GameContext,
  Locale: globalThis.Locale,
  GameInfo: globalThis.GameInfo,
  Players: globalThis.Players,
  getSetting: DemographicsSettings.getSetting
};

function makeSettings(map) {
  DemographicsSettings.getSetting = (k, d) => (Object.prototype.hasOwnProperty.call(map, k) ? map[k] : d);
}

function policy(mode) {
  globalThis.Configuration = {
    getGame: () => ({ getValue: (k) => (k === "DemographicsAnalyticsPolicy_v1" ? mode : null) })
  };
}

function testBackfillAndNaming() {
  policy("met-civs-only");
  globalThis.GameContext = { localPlayerID: 1 };
  makeSettings({ backfillMetHistory: true, hideUnmetStats: true });

  const history = {
    ageBoundaries: [{ age: "AGE_EXPLORATION" }],
    samples: [
      {
        age: "AGE_ANTIQUITY",
        localTurn: 1,
        players: {
          "1": { leaderName: "Me", civName: "Rome", met: true, metrics: { score: 5 }, leaderType: "LEADER_ME", leaderTypeString: "LEADER_ME", primaryColor: "#112233" },
          "2": { leaderName: "Them", civName: "Han", met: false, metrics: { score: 7 }, leaderType: "LEADER_THEM", leaderTypeString: "LEADER_THEM", primaryColor: "#223344" }
        }
      },
      {
        age: "AGE_EXPLORATION",
        localTurn: 1,
        players: {
          "1": { leaderName: "Me", civName: "Rome", met: true, metrics: { score: 8 }, leaderType: "LEADER_ME", leaderTypeString: "LEADER_ME", primaryColor: "#112233" },
          "2": { leaderName: "Them", civName: "Ming", met: true, metrics: { score: 9 }, leaderType: "LEADER_THEM", leaderTypeString: "LEADER_THEM", primaryColor: "#223344" }
        }
      }
    ]
  };

  const out = buildSeriesFromHistory(history, "score");
  assert.equal(out.sampleCount, 2);
  assert.equal(out.series.length, 2);

  const foreign = out.series.find((s) => s.pid === 2);
  assert.ok(foreign, "foreign series should be present once met in backfill mode");
  assert.ok(foreign.name.includes("Han") && foreign.name.includes("Ming"), "display name should include civ history");
  assert.equal(foreign.points.length, 2, "backfill mode should include pre-contact points after met");
}

function testFromContactAndOwnOnlyPolicy() {
  policy("met-civs-only");
  globalThis.GameContext = { localPlayerID: 1 };
  makeSettings({ backfillMetHistory: false, hideUnmetStats: true });

  const history = {
    samples: [
      { turn: 1, players: { "1": { met: true, metrics: { score: 1 }, leaderType: "LEADER_ME", leaderName: "Me" }, "2": { met: false, metrics: { score: 10 }, leaderType: "LEADER_X", leaderName: "X" } } },
      { turn: 2, players: { "1": { met: true, metrics: { score: 2 }, leaderType: "LEADER_ME", leaderName: "Me" }, "2": { met: true, metrics: { score: 11 }, leaderType: "LEADER_X", leaderName: "X" } } }
    ]
  };

  const out = buildSeriesFromHistory(history, "score");
  const foreign = out.series.find((s) => s.pid === 2);
  assert.ok(foreign);
  assert.equal(foreign.points.length, 1, "from-contact mode should drop unmet-era points");

  policy("own-civ-only");
  const ownOnly = buildSeriesFromHistory(history, "score");
  assert.deepEqual(ownOnly.series.map((s) => s.pid), [1]);
}

function testPopulationAgeResetBridge() {
  // Civ VII slashes settlement population at an age boundary, so the raw `population` series dips then
  // recovers in the new age. The chart must BRIDGE that mechanical dip (only for reset-prone metrics).
  policy("all-civs");
  globalThis.GameContext = { localPlayerID: 1 };
  makeSettings({ backfillMetHistory: false, hideUnmetStats: false });

  const p = (pop) => ({ "1": { met: true, metrics: { population: pop }, leaderType: "LEADER_ME", leaderName: "Me" } });
  const history = {
    ageBoundaries: [{ age: "AGE_EXPLORATION" }],
    samples: [
      { age: "AGE_ANTIQUITY", localTurn: 1, players: p(100_000) },
      { age: "AGE_ANTIQUITY", localTurn: 2, players: p(500_000) },
      { age: "AGE_ANTIQUITY", localTurn: 3, players: p(1_000_000) }, // pre-boundary peak (sits at boundary x)
      { age: "AGE_EXPLORATION", localTurn: 1, players: p(300_000) }, // mechanical dip
      { age: "AGE_EXPLORATION", localTurn: 2, players: p(600_000) }, // still recovering
      { age: "AGE_EXPLORATION", localTurn: 3, players: p(1_200_000) } // natural recovery above the peak
    ]
  };

  // Reset-prone metric → bridged: every point in the recovering segment is lifted to ≥ the
  // pre-boundary peak, so the displayed line never plunges at the boundary (raw samples were 300k/600k).
  const bridged = buildSeriesFromHistory(history, "population").series.find((s) => s.pid === 1);
  assert.ok(bridged, "population series present");
  const dipPoints = bridged.points.filter((pt) => pt.t > 3 && pt.t < 6);
  assert.ok(dipPoints.length > 0 && dipPoints.every((pt) => pt.v >= 1_000_000 - 1),
    `dipped points bridged to >= peak, got ${dipPoints.map((d) => Math.round(d.v))}`);
  // The pre-boundary peak and the natural recovery point are untouched.
  assert.equal(bridged.points.find((pt) => pt.t === 3).v, 1_000_000, "peak untouched");
  assert.equal(bridged.points.find((pt) => pt.t === 6).v, 1_200_000, "recovery point untouched");

  // A genuine post-boundary COLLAPSE (war crash mid-segment) is NOT masked: the offset bridge removes
  // the mechanic notch but a real crash still reads as a drop below the pre-boundary level.
  const warHist = {
    ageBoundaries: [{ age: "AGE_EXPLORATION" }],
    samples: [
      { age: "AGE_ANTIQUITY", localTurn: 1, players: p(500_000) },
      { age: "AGE_ANTIQUITY", localTurn: 2, players: p(1_000_000) }, // peak
      { age: "AGE_EXPLORATION", localTurn: 1, players: p(300_000) }, // mechanic reset
      { age: "AGE_EXPLORATION", localTurn: 2, players: p(100_000) }, // WAR crash
      { age: "AGE_EXPLORATION", localTurn: 3, players: p(1_200_000) } // later recovery
    ]
  };
  const war = buildSeriesFromHistory(warHist, "population").series.find((s) => s.pid === 1);
  // x: antiquity peak at boundary x=2; exploration samples at x=3 (mechanic), 4 (war crash), 5 (recovery).
  const mechanic = war.points.find((pt) => pt.t === 3);
  const crash = war.points.find((pt) => pt.t === 4);
  assert.ok(mechanic.v >= 1_000_000 - 1, "mechanic reset notch is bridged to the peak");
  assert.ok(crash.v < 1_000_000, `war crash stays visible (a real drop), got ${Math.round(crash.v)}`);
  assert.ok(crash.v > 100_000, "but the mechanic notch is still removed (offset added back)");

  // A NON-reset metric (score) with the same shape is left untouched (no bridging).
  const scoreHist = { ...history, samples: history.samples.map((s) => ({ ...s,
    players: { "1": { ...s.players["1"], metrics: { score: s.players["1"].metrics.population / 100000 } } } })) };
  const score = buildSeriesFromHistory(scoreHist, "score").series.find((s) => s.pid === 1);
  const scoreDip = score.points.find((pt) => pt.t > 3 && pt.t < 5);
  assert.ok(scoreDip && scoreDip.v < 5, "score (non-reset metric) must NOT be bridged");
}

try {
  testBackfillAndNaming();
  testFromContactAndOwnOnlyPolicy();
  testPopulationAgeResetBridge();
  console.log("chart-line-series-branches harness passed");
} finally {
  globalThis.Configuration = saved.Configuration;
  globalThis.GameContext = saved.GameContext;
  globalThis.Locale = saved.Locale;
  globalThis.GameInfo = saved.GameInfo;
  globalThis.Players = saved.Players;
  DemographicsSettings.getSetting = saved.getSetting;
}
