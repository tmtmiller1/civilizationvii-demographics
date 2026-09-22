import assert from "node:assert/strict";
import {
  ageSpans, positionOf, buildTimeline, packTimeline, unpackTimeline, markKind, MARKS_CAP, MIGRATION_BUCKETS,
  DISASTERS_CAP, focusTimeline, timelineCivs, RIVAL_MARKS_CAP, RIVAL_CURVE_POINTS, CRISES_CAP
} from "/demographics/ui/history/model/history-timeline.js";
import { stackRows, shortPeople, windowFor, beatAt, valueAt } from "/demographics/ui/history/views/history-timeline-view.js";
import { tickSteps, ticks, disasterFamily, edgeClass } from "/demographics/ui/history/views/history-timeline-lanes.js";

// Two ages; the game's turn counter restarts at 1 in the second.
const ages = [{ age: "AGE_ANTIQUITY", start: 1, end: 100 }, { age: "AGE_EXPLORATION", start: 1, end: 50 }];
const spans = ageSpans(ages);
assert.deepEqual(spans, [{ from: 0, len: 100 }, { from: 100, len: 50 }]);
assert.equal(positionOf(spans, ages, 1, 10), 109, "second-age turn 10 sits after the whole first age");
assert.equal(positionOf(spans, ages, 0, 500), 99, "clamped to its age");

const doc = {
  local: 0,
  ages,
  players: {},
  events: [
    { t: 1, a: 0, k: "age", p: -1, x: "AGE_ANTIQUITY", n: "LOC_AGE_A", d: "4000 BCE" },
    { t: 20, a: 0, k: "war", p: 0, q: 1 },
    { t: 30, a: 0, k: "peace", p: 0, q: 1 },
    { t: 60, a: 0, k: "war", p: 2, q: 0 },
    { t: 70, a: 0, k: "crisis", p: -1, q: 1, n: "Plague" },
    { t: 85, a: 0, k: "crisis", p: -1, q: 2, n: "Plague" },
    { t: 40, a: 0, k: "wonder", p: 0, x: "W", n: "LOC_W" },
    { t: 41, a: 0, k: "wonder", p: 3, x: "W2" },
    { t: 50, a: 0, k: "capture", p: 4, q: 0, n: "Ur" },
    { t: 1, a: 1, k: "age", p: -1, x: "AGE_EXPLORATION", n: "LOC_AGE_E" },
    { t: 5, a: 1, k: "war", p: 0, q: 3 },
    { t: 10, a: 1, k: "war", p: 3, q: 4 },
    { t: 15, a: 1, k: "elim", p: 3 },
    { t: 40, a: 1, k: "victory", p: 0, x: "V" },
    { t: 12, a: 0, k: "disaster", p: 0, x: "RANDOM_EVENT_VOLCANO", n: "LOC_VOLCANO", d: "3800 BCE" },
    { t: 20, a: 1, k: "disaster", p: 5, x: "RANDOM_EVENT_FLOOD" },
    { t: 3, a: 0, k: "found", p: 0, n: "LOC_CITY_A", d: "3900 BCE" },
    { t: 4, a: 0, k: "found", p: 2, n: "LOC_CITY_B" },
    { t: 8, a: 1, k: "found", p: 0, n: "LOC_CITY_C" },
    { t: 30, a: 0, k: "war", p: 2, q: 3, d: "1000 BCE" },
    { t: 45, a: 0, k: "peace", p: 3, q: 2 },
    { t: 12, a: 0, k: "wonder", p: 2, x: "W3", n: "LOC_W3" },
    { t: 6, a: 0, k: "found", p: 2, n: "LOC_CITY_R" }
  ],
  series: {
    turns: [10, 50, 90, 5, 30],
    by: {
      0: { set: [], pop: [], tri: [], pops: [50e3, 300e3, 1.2e6, 1.3e6, 6e6], mi: [0, 0, 400, 400, 1400], mo: [0, 200, 200, 900, 900] },
      2: { set: [], pop: [], tri: [], pops: [10e3, 20e3, 30e3, 40e3, 50e3] },
      5: { set: [], pop: [], tri: [], pops: [0, 0, 0, 0, 0] }
    }
  }
};
const tl = buildTimeline(doc);
assert.equal(tl.total, 150);
assert.deepEqual(tl.ages.map((a) => [a.from, a.len, a.n, a.d]), [[0, 100, "LOC_AGE_A", "4000 BCE"], [100, 50, "LOC_AGE_E", ""]]);
assert.deepEqual(tl.wars.map((w) => [w.from, w.to, w.other]), [[19, 29, 1], [59, 100, 2], [104, 114, 3]],
  "peace ends a war; an age transition ends one; the enemy's elimination ends one");
assert.deepEqual(tl.crises.map((c) => [c.from, c.to, c.stage]), [[69, 84, 1], [84, 100, 2]], "a stage lasts until the next or the end of its age");
assert.deepEqual(tl.marks.map((m) => [m.at, m.k]), [[39, "wonder"], [49, "lost"], [114, "elim"], [139, "victory"]], "only the local player's wonders; lost settlements; eliminations; victory");
assert.deepEqual(tl.pops.map((p) => [p.at, p.v]), [[49, 100e3], [49, 250e3], [89, 500e3], [89, 1e6], [129, 2.5e6], [129, 5e6]],
  "milestones crossed, placed by sample; the age advances when the turn restarts");
assert.equal(markKind({ t: 1, a: 0, k: "triumph", p: 1 }, 0), "", "another player's Triumph is not a milestone");
assert.deepEqual(tl.ages.map((a) => a.t0), [1, 1], "each age's first turn, for turn labels");
assert.deepEqual(tl.founds.map((f) => [f.at, f.n, f.d]), [[2, "LOC_CITY_A", "3900 BCE"], [107, "LOC_CITY_C", ""]], "only your own foundings");

// Other civilizations' tracks: their wars with each other (peace, age end and elimination close them),
// their own deeds, and their population lines.
assert.deepEqual(tl.rivals.wars.map((w) => [w.from, w.to, w.a, w.b]), [[29, 44, 2, 3], [109, 114, 3, 4]]);
assert.deepEqual(tl.rivals.marks.map((m) => [m.at, m.k, m.p]), [[11, "wonder", 2], [40, "wonder", 3]]);
assert.deepEqual(tl.rivals.founds.map((f) => [f.at, f.p]), [[3, 2], [5, 2]]);
assert.deepEqual(Object.keys(tl.rivals.curves), ["2"], "a civilization with no population recorded has no line");
assert.deepEqual(Object.keys(buildTimeline(doc, () => true, (pid) => pid !== 2).rivals.curves), [], "unknown civilizations have no line");
const busy = buildTimeline({ ...doc, events: Array.from({ length: 30 }, (_, i) => ({ t: 1 + i, a: 0, k: "triumph", p: 6, x: "T" + i })) });
assert.equal(busy.rivals.marks.length, RIVAL_MARKS_CAP);
const longDoc = { ...doc, series: { turns: Array.from({ length: 80 }, (_, i) => i + 1), by: { 2: { set: [], pop: [], tri: [], pops: Array(80).fill(5) } } } };
assert.equal(buildTimeline(longDoc).rivals.curves["2"].length, RIVAL_CURVE_POINTS);

// Wonders and religions carry their own icon when a resolver is given (in game); others do not.
const withIcons = buildTimeline(doc, () => true, () => true, (type, kind) => (kind === "wonder" ? "blp:icon_" + type : ""));
assert.equal(withIcons.marks.find((m) => m.k === "wonder")?.i, "blp:icon_W");
assert.equal(withIcons.rivals.marks.find((m) => m.p === 2)?.i, "blp:icon_W3");
assert.equal(unpackTimeline(JSON.parse(JSON.stringify(packTimeline(withIcons)))).marks.find((m) => m.k === "wonder")?.i, "blp:icon_W", "kept in the archive");
assert.ok(tl.marks.every((m) => m.i === ""), "no resolver, no icons");

// The civilization filter: just yours by default; a picked rival's deeds join the lanes.
const mineOnly = focusTimeline(tl, 0, new Set([0]));
assert.deepEqual(mineOnly.wars.map((w) => w.other), [1, 2, 3], "your wars only");
assert.ok(mineOnly.marks.every((m) => m.k !== "elim"), "a rival's fall stays out until it is picked");
assert.ok(mineOnly.marks.some((m) => m.k === "victory"), "the victory always shows");
assert.deepEqual(mineOnly.disasters.map((d) => d.p), [0], "disasters on your land only");
assert.equal(mineOnly.lines.length, 0);
const withTwo = focusTimeline(tl, 0, new Set([0, 2]));
assert.deepEqual(withTwo.wars.filter((w) => w.a === 2).map((w) => w.other), [3], "a picked rival's war with another");
assert.ok(withTwo.marks.some((m) => m.p === 2 && m.k === "wonder"));
assert.deepEqual(withTwo.founds.map((f) => f.p), [0, 2, 2, 0]);
assert.deepEqual(withTwo.lines.map((l) => l.pid), [2]);
const rivalOnly = focusTimeline(tl, 0, new Set([3]));
assert.deepEqual([rivalOnly.pops, rivalOnly.curve, rivalOnly.mig], [[], [], []], "your own lanes hide when you are not picked");
assert.deepEqual(rivalOnly.wars.map((w) => [w.a, w.other]), [[2, 3], [3, 4]]);
assert.ok(rivalOnly.marks.some((m) => m.k === "elim" && m.p === 3), "a picked civilization's fall");
assert.deepEqual(timelineCivs(tl, 0), [0, 1, 2, 3, 4, 5], "you first, then everyone the timeline knows");
assert.deepEqual(tl.disasters.map((d) => [d.at, d.x, d.p, d.d]), [[11, "RANDOM_EVENT_VOLCANO", 0, "3800 BCE"], [119, "RANDOM_EVENT_FLOOD", 5, ""]],
  "disasters placed on the axis with their owner");
const bucket = (/** @type {number} */ at) => Math.floor(at / (150 / MIGRATION_BUCKETS));
assert.deepEqual(tl.mig.map((m) => [bucket(m.at), m.i, m.o]), [[bucket(49), 0, 200], [bucket(89), 400, 0], [bucket(104), 0, 700], [bucket(129), 1000, 0]],
  "migration per stretch, from the cumulative tallies, positioned by sample across ages");
assert.deepEqual(buildTimeline({ ...doc, series: { turns: [], by: {} } }).mig, [], "no migration without the Emigration tallies");
const flood = Array.from({ length: DISASTERS_CAP + 5 }, (_, i) => ({ t: 1 + i, a: 0, k: "disaster", p: 0, x: "X" + i }));
const capD = buildTimeline({ ...doc, events: flood }).disasters;
assert.equal(capD.length, DISASTERS_CAP);
assert.equal(capD[capD.length - 1].x, "X" + (DISASTERS_CAP + 4), "the most recent disasters are kept");

// A spoiler filter removes events before layout.
assert.equal(buildTimeline(doc, (e) => e.k !== "war").wars.length, 0);

// Crisis stages are bounded (odd or modded data cannot swell a record).
const manyCrises = buildTimeline({ ...doc, events: Array.from({ length: 100 }, (_, i) => ({ t: 1 + (i % 90), a: 0, k: "crisis", p: -1, q: 1 + (i % 4) })) });
assert.equal(manyCrises.crises.length, CRISES_CAP);

// The milestone cap keeps the most important kinds.
const many = { ...doc, events: [...doc.events, ...Array.from({ length: 60 }, (_, i) => ({ t: 2 + i, a: 0, k: "triumph", p: 0 }))] };
const capped = buildTimeline(many).marks;
assert.equal(capped.length, MARKS_CAP);
assert.ok(capped.some((m) => m.k === "victory") && capped.some((m) => m.k === "wonder"));

// Round trip through the archive form.
const back = unpackTimeline(JSON.parse(JSON.stringify(packTimeline(tl))));
assert.deepEqual(back.wars, tl.wars);
assert.deepEqual(back.crises, tl.crises);
assert.deepEqual(back.pops, tl.pops);
assert.deepEqual(back.ages, tl.ages);
assert.deepEqual(back.disasters, tl.disasters);
assert.deepEqual(back.mig, tl.mig);
assert.deepEqual(back.founds, tl.founds);
assert.deepEqual(back.rivals, tl.rivals);
assert.deepEqual(unpackTimeline({ g: [] }).rivals, { marks: [], founds: [], wars: [], curves: {} }, "older records have no rival tracks");
assert.deepEqual(back.curve, tl.curve);
assert.deepEqual(unpackTimeline({ g: [[0, 10, "A", "", ""]] }).ages[0].t0, 1, "older records without start turns count from 1");
assert.deepEqual(unpackTimeline({ g: [] }).disasters, [], "older records without disasters");
assert.deepEqual(back.marks.map((m) => [m.at, m.k, m.n]), tl.marks.map((m) => [m.at, m.k, m.n]));
assert.equal(unpackTimeline(undefined), null);
assert.equal(unpackTimeline({ n: 5 }), null);

// Layout helpers.
assert.deepEqual(stackRows([{ from: 0, to: 10 }, { from: 5, to: 8 }, { from: 11, to: 12 }], 0), [0, 1, 0]);
globalThis.Locale = { toNumber: (n) => String(n) };
assert.equal(shortPeople(2.5e6), "2.5M");
assert.equal(shortPeople(1e9), "1B");

assert.equal(shortPeople(420), "420", "small counts stay whole");

// Ruler ticks: about ten labelled ticks across the visible width; turns count from each age's start.
assert.deepEqual(tickSteps({ from: 0, to: 150 }, 1), { major: 10, minor: 2 });
assert.deepEqual(tickSteps({ from: 0, to: 150 }, 8), { major: 2, minor: 1 });
assert.deepEqual(tickSteps({ from: 0, to: 50 }, 1), { major: 5, minor: 1 });
assert.deepEqual(tickSteps({ from: 0, to: 600 }, 1), { major: 50, minor: 10 });
const tk = ticks(tl, { from: 0, to: 150 }, 1);
assert.ok(tk.every((k) => k.turn % 2 === 0), "every tick on the minor step");
assert.deepEqual(tk.filter((k) => k.major).map((k) => k.turn),
  [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 10, 20, 30, 40, 50], "labelled ticks restart with the second age");
assert.ok(!tk.some((k) => k.at === 0 || k.at === 100), "an age's opening carries the date tick instead");
assert.deepEqual(ticks(tl, { from: 100, to: 150 }, 1).filter((k) => k.major).map((k) => k.turn), [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
assert.deepEqual(ticks(tl, { from: 100, to: 150 }, 1).filter((k) => k.major).map((k) => k.at)[0], 104, "turn 5 of the age sits four after its start");

// Discs at either end of the chart are pinned inside it.
assert.deepEqual([99.8, 50, 0.4, 98.5, 1.5].map(edgeClass), ["dgh-tl-edge-r", "", "dgh-tl-edge-l", "", ""]);

// Disaster families pick the gem color.
assert.equal(disasterFamily("RANDOM_EVENT_VOLCANO_ERUPTION"), "volcano");
assert.equal(disasterFamily("RANDOM_EVENT_FLOOD_MAJOR"), "flood");
assert.equal(disasterFamily("RANDOM_EVENT_BLIZZARD"), "storm");
assert.equal(disasterFamily("RANDOM_EVENT_SOMETHING"), "other");

// Windows and the playback caption.
assert.deepEqual(windowFor(tl, "all"), { from: 0, to: 150 });
assert.deepEqual(windowFor(tl, "AGE_EXPLORATION"), { from: 100, to: 150 });
const list = [{ at: 0, text: "a" }, { at: 10, text: "b" }, { at: 20, text: "c" }];
assert.equal(beatAt(list, 15)?.text, "b");
assert.equal(beatAt(list, 20)?.text, "c");
assert.equal(beatAt([{ at: 5, text: "x" }], 1), null);

// The population readout interpolates the curve.
const curve = [{ at: 10, v: 100 }, { at: 20, v: 300 }, { at: 40, v: 300 }];
assert.equal(valueAt(curve, 5), 0, "nothing before the first sample");
assert.equal(valueAt(curve, 10), 100);
assert.equal(valueAt(curve, 15), 200);
assert.equal(valueAt(curve, 30), 300);
assert.equal(valueAt(curve, 99), 300, "the last value after the end");
assert.equal(valueAt([], 5), 0);

console.log("history-timeline harness passed");
