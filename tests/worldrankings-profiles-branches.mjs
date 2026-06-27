// Covers: worldrankings-allcivs-profiles.js, worldrankings-allcivs-controller.js
// Pure data-manipulation — no document/engine needed.
import assert from "node:assert/strict";

globalThis.GameContext = { localPlayerID: 1 };

const {
  makeBlankProfile, mergeProfileMetrics, nonEmptyString, mergeCivNames,
  mergeCivTypesAndColors, computeRanks, readBoolSetting, stripEliminatedCivs,
  buildCivProfiles, stripUnmetDiplomacy, stripNonLocalCivs, pickLocalPid,
  sortOtherPids
} = await import(
  "/demographics/ui/screen-demographics/views/worldrankings-allcivs/worldrankings-allcivs-profiles.js"
);
const {
  stripIsUnmet, readHiddenCivs, toggleCiv, resetHidden
} = await import(
  "/demographics/ui/screen-demographics/views/worldrankings-allcivs/worldrankings-allcivs-controller.js"
);

// makeBlankProfile
const p1 = makeBlankProfile("1", { leaderType: "LEADER_A" });
assert.equal(p1.pid, "1");
assert.equal(p1.leaderKey, "LEADER_A");
assert.deepEqual(p1.latest, {});

const p2 = makeBlankProfile("2", {});
assert.equal(p2.leaderKey, "pid:2");

// mergeProfileMetrics
mergeProfileMetrics(p1, { score: 10, gdp: 20.5, bad: "nope" });
assert.equal(p1.latest.score, 10);
assert.equal(p1.latest.gdp, 20.5);
assert.equal(p1.latest.bad, undefined);

// nonEmptyString
assert.equal(nonEmptyString("hi"), "hi");
assert.equal(nonEmptyString(""), undefined);
assert.equal(nonEmptyString(null), undefined);

// mergeCivNames
const p3 = makeBlankProfile("3", {});
mergeCivNames(p3, { civName: "Rome", leaderName: "Caesar" });
assert.equal(p3.civName, "Rome");
assert.equal(p3.leaderName, "Caesar");
assert.ok(p3.civNames.includes("Rome"));

// computeRanks — takes Record<string, CivProfile>
const profiles = {
  "1": { pid: "1", latest: { score: 100 }, met: true, leaderKey: "L1" },
  "2": { pid: "2", latest: { score: 80 }, met: true, leaderKey: "L2" },
  "3": { pid: "3", latest: { score: 80 }, met: true, leaderKey: "L3" }
};
const result = computeRanks(profiles, "score");
assert.equal(result.ranks.get("1"), 1);
assert.equal(result.ranks.get("2"), 2);
assert.equal(result.ranks.get("3"), 2); // tied

// readBoolSetting
const ctx = { settings: { getSetting: (k, d) => d } };
assert.equal(readBoolSetting(ctx, "key", true), true);
assert.equal(readBoolSetting({}, "key", false), false);
assert.equal(readBoolSetting(null, "key", true), true);

// stripEliminatedCivs (no eliminations in history)
const history = { samples: [] };
const stripTarget = { "1": profiles["1"], "2": profiles["2"], "3": profiles["3"] };
stripEliminatedCivs(stripTarget, history);
assert.equal(Object.keys(stripTarget).length, 3);

// buildCivProfiles with minimal history
const h2 = {
  samples: [
    {
      turn: 1,
      players: {
        "1": { leaderType: "LEADER_ME", leaderName: "Me", civName: "Rome", leaderTypeString: "LEADER_ME", primaryColor: "#224466", met: true, metrics: { score: 10 } },
        "2": { leaderType: "LEADER_B", leaderName: "Other", civName: "Han", leaderTypeString: "LEADER_B", primaryColor: "#446688", met: true, metrics: { score: 8 } }
      }
    }
  ]
};
const built = buildCivProfiles(h2);
assert.ok(built && typeof built === "object");
assert.ok(Object.keys(built).length >= 2);

// stripUnmetDiplomacy — all met so nothing stripped
const met = Object.assign({}, built);
Object.values(met).forEach((p) => { p.met = true; });
stripUnmetDiplomacy(met);
assert.ok(Object.keys(met).length > 0);

// stripNonLocalCivs — GameContext.localPlayerID = 1
const nonLocalTarget = Object.assign({}, built);
stripNonLocalCivs(nonLocalTarget);
assert.ok(Object.keys(nonLocalTarget).length <= Object.keys(built).length);

// pickLocalPid
const allPids = Object.keys(built);
const local = pickLocalPid(built, allPids);
assert.ok(typeof local === "string");

// sortOtherPids
const others = sortOtherPids(built, allPids, local);
assert.ok(Array.isArray(others));
assert.ok(!others.includes(local));

// controller: stripIsUnmet
const st = { profiles: { "1": { met: false } }, localPid: "99", showUnmetNames: false };
assert.equal(stripIsUnmet(st, "1"), true);
assert.equal(stripIsUnmet({ ...st, showUnmetNames: true }, "1"), false);

// controller: readHiddenCivs / toggleCiv / resetHidden
const ctx2 = { settings: { getSetting: (k, d) => d, setSetting: () => {} } };
const hiddenSet = readHiddenCivs(ctx2);
assert.ok(hiddenSet instanceof Set);

delete globalThis.GameContext;
console.log("worldrankings-profiles-branches harness passed");
