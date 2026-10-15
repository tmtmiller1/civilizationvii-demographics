// Partisans risings on the Conflicts timeline: the wording for each cause and outcome (read in the
// real en_us text), the spoiler guard (owner shown when a war with it would be, the other civ left
// unnamed while hidden, the local player's own risings always shown), the row building and
// interleaving with wars, the civ filter, the hatch geometry, the tooltip lines and a full render.
import assert from "node:assert/strict";
import fs from "node:fs";

import { createFakeDocument } from "./_dom-stub.mjs";
import { setAnalyticsPolicy } from "./_engine-stubs.mjs";

const EN = new Map(
  [...fs.readFileSync("text/en_us/ModText.xml", "utf8").matchAll(/Tag="(LOC_[A-Z0-9_]+)">\s*<Text>([^<]*)<\/Text>/g)]
    .map((m) => [m[1], m[2].replace(/&apos;/g, "'")])
);
/** Every element under root carrying the class. */
function findAllByClass(root, cls) {
  const out = [];
  const queue = [root];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (typeof cur.className === "string" && cur.className.split(/\s+/).includes(cls)) out.push(cur);
    queue.push(...(cur.children || []));
  }
  return out;
}

/** English compose: the real en_us text with {N_Name} filled from the arguments. */
function composeEnglish(key, ...args) {
  if (key === "LOC_CIVILIZATION_GREECE_ADJECTIVE") return "Greek";
  if (key === "LOC_TRADITION_CURFEW_NAME") return "Curfew";
  const text = EN.get(key);
  if (text === undefined) return key;
  return text.replace(/\{(\d+)_[A-Za-z]+\}/g, (_, n) => String(args[Number(n) - 1] ?? ""));
}

const { document } = createFakeDocument();
globalThis.document = document;
globalThis.window = { innerWidth: 1920, innerHeight: 1080, addEventListener: () => {} };
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.Locale = { compose: composeEnglish };
globalThis.GameContext = { localPlayerID: 0 };
globalThis.Game = { turn: 30, getTurnDate: () => "3000 BCE" };
globalThis.UI = { getIconURL: () => "blp:test" };
globalThis.Players = { get: (id) => ({ id, isMajor: true, Diplomacy: { hasMet: () => true } }) };
const CURFEW = { Name: "LOC_TRADITION_CURFEW_NAME" };
globalThis.GameInfo = { Traditions: { lookup: (type) => (type === "TRADITION_CURFEW" ? CURFEW : null) } };
setAnalyticsPolicy(null);

const {
  buildRisingRows,
  collectRisingCivOptions,
  interleaveTimelineRows,
  policyVisibleRisings
} = await import("/demographics/ui/screen-demographics/charts/conflicts/chart-risings-data.js");
const { hatchSegments, risingOwnerColor } = await import(
  "/demographics/ui/screen-demographics/charts/conflicts/chart-risings-bars.js"
);
const { buildRisingTooltipModel, formatAxisPoint } = await import(
  "/demographics/ui/screen-demographics/charts/conflicts/chart-risings-tooltip.js"
);
const { DemographicsSettings } = await import("/demographics/ui/core/demographics-settings.js");
const { buildGanttLayout } = await import(
  "/demographics/ui/screen-demographics/charts/wars/chart-wars-gantt-domain.js"
);
const { collectWarCivOptions, renderConflictsTimeline } = await import(
  "/demographics/ui/screen-demographics/charts/conflicts/chart-conflicts-timeline.js"
);

// Local 0 (Rome), met 2 (Greece), unmet 3 (Persia).
const player = (civ, met, color) => ({ civName: civ, met, primaryColor: color, secondaryColor: "#ffffff" });
const samples = [
  { age: "AGE_ANTIQUITY", localTurn: 40, chartTurn: 40, gameYear: "1000 BCE", players: {} },
  {
    age: "AGE_ANTIQUITY", localTurn: 60, chartTurn: 60, gameYear: "600 BCE",
    players: {
      0: player("Rome", true, "#aa0000"),
      2: player("Greece", true, "#0000aa"),
      3: player("Persia", false, "#00aa00")
    }
  }
];
const civ = (name, type, leader) => ({ civ: name, civTypeString: type, leader });
const ROME = civ("Rome", "CIVILIZATION_ROME", "Augustus");
const GREECE = civ("Greece", "CIVILIZATION_GREECE", "Pericles");
const PERSIA = civ("Persia", "CIVILIZATION_PERSIA", "Xerxes");
const rising = (over) => ({
  id: 1, at: "1,1", name: "Mutsu", owner: 0, cause: "misery", ip: 50, start: 45, age: "AGE_ANTIQUITY",
  startChartTurn: 45, startYear: "900 BCE", lastChartTurn: 60, ownerCiv: ROME, ...over
});
const history = {
  samples,
  wars: [],
  risings: [
    rising({ id: 1, cause: "flip", from: 2, otherCiv: GREECE, end: 50, endChartTurn: 50, endYear: "800 BCE",
      outcome: "dispersed" }),
    rising({ id: 2, name: "Sardis", owner: 2, ownerCiv: GREECE, cause: "enclave", homeland: 0, otherCiv: ROME,
      policy: "TRADITION_CURFEW", startChartTurn: 52, end: 55, endChartTurn: 55, outcome: "time" }),
    rising({ id: 3, name: "Tyre", owner: 2, ownerCiv: GREECE, cause: "enclave", homeland: 3, otherCiv: PERSIA,
      startChartTurn: 56, end: 58, endChartTurn: 58, outcome: "burned" }),
    rising({ id: 4, name: "Susa", owner: 3, ownerCiv: PERSIA, startChartTurn: 41 }),
    rising({ id: 5, name: "Capua", cause: "flip", from: 3, otherCiv: PERSIA, startChartTurn: 57 }),
    rising({ id: 6, name: "Ostia", startChartTurn: 59, end: 60, endChartTurn: 60, outcome: "age" }),
    null,
    { id: "junk" }
  ]
};
const opts = { samples, yearToChart: new Map(), latestTurn: 60, filterPid: null, activeOnly: false };

// Spoiler guard: the unmet civ's own risings disappear; junk is dropped.
assert.deepEqual(policyVisibleRisings(history.risings, samples).map((r) => r.id), [1, 2, 3, 5, 6]);
const rows = buildRisingRows(history, opts);
assert.deepEqual(rows.map((r) => r.rising.id), [1, 2, 3, 5, 6], "sorted by start turn");
const byId = (id) => rows.find((r) => r.rising.id === id);

// Names: by place, a flip with a visible old owner gets the adjective.
assert.equal(byId(1).title, "Greek Loyalist Rising at Mutsu");
assert.equal(byId(2).title, "Sardis Uprising");
assert.equal(byId(5).title, "Capua Uprising", "a flip whose old owner is unmet is named by place only");

// Cause lines per cause, with and without a policy, and with the other civ hidden.
assert.equal(byId(1).cause, "After Mutsu joined Rome by culture, people loyal to Greece took up arms.");
assert.equal(byId(2).cause, "Rose against Greece's Curfew during its war with Rome.");
assert.equal(byId(3).cause, "Rose against how Greece treated its residents during one of its wars.",
  "the unmet homeland is left unnamed");
assert.equal(byId(5).cause, "After Capua joined Rome by culture, people loyal to its old rulers took up arms.");
assert.equal(byId(6).cause, "Years of unhappiness in Ostia.");
for (const row of rows) {
  assert.ok(!/Persia|Xerxes/.test(row.title + row.cause + row.outcome), "nothing names the unmet civ");
}

// Outcome lines.
assert.equal(byId(1).outcome, "Put down.");
assert.equal(byId(2).outcome, "Died down.");
assert.equal(byId(3).outcome, "Tyre was burned.");
assert.equal(byId(6).outcome, "Ended with the age.");
assert.equal(byId(5).outcome, "Still under way.");
assert.equal(byId(5).endTurn, null, "running: open bar");

// A running rising last seen before the latest sample was drawn up to that sighting.
const stale = buildRisingRows({ samples, risings: [rising({ id: 8, lastChartTurn: 55 })] }, opts)[0];
assert.equal(stale.endTurn, 55);
assert.equal(stale.outcome, "", "no outcome is known");

// Filters: civ filter keeps the owner's risings; active-only keeps running ones.
assert.deepEqual(buildRisingRows(history, { ...opts, filterPid: 2 }).map((r) => r.rising.id), [2, 3]);
assert.deepEqual(buildRisingRows(history, { ...opts, activeOnly: true }).map((r) => r.rising.id), [5]);
const noStart = buildRisingRows({ samples, risings: [rising({ startChartTurn: undefined, startYear: "1000 BCE" })] },
  { ...opts, yearToChart: new Map([["1000 BCE", 40]]) });
assert.equal(noStart[0].startTurn, 40, "a record saved without a chart turn is placed by its year");
const lost = rising({ startChartTurn: undefined, startYear: undefined });
assert.equal(buildRisingRows({ samples, risings: [lost] }, opts).length, 0, "an unplaceable rising is skipped");

// Own-civ-only: only the local player's risings, which always show.
setAnalyticsPolicy("own-civ-only");
assert.deepEqual(buildRisingRows(history, opts).map((r) => r.rising.id), [1, 5, 6]);
assert.equal(buildRisingRows(history, opts)[0].title, "Mutsu Uprising", "Greece is hidden under own-civ-only");
setAnalyticsPolicy(null);
DemographicsSettings.setSetting("hideUnmetStats", false);
assert.equal(buildRisingRows(history, opts).length, 6, "guard off: everyone");
assert.equal(buildRisingRows(history, opts).find((r) => r.rising.id === 5).title, "Persian Loyalist Rising at Capua");
DemographicsSettings.setSetting("hideUnmetStats", true);

// Interleaving with wars by start turn, war first on a tie.
const wars = [{ name: "w1", startTurn: 40 }, { name: "w2", startTurn: 52 }];
assert.deepEqual(
  interleaveTimelineRows(wars, rows).map((r) => r.name || r.rising.id),
  ["w1", 1, "w2", 2, 3, 5, 6]
);

// Civ filter options: the owners of visible risings join the war civs.
assert.deepEqual(collectRisingCivOptions(history, samples).map((o) => o.label), ["Augustus, Rome", "Pericles, Greece"]);
assert.deepEqual(collectWarCivOptions(history).map((o) => o.pid).sort(), [0, 2]);

// Bar geometry: hatch strokes stay inside the bar; rows are thinner than war bars.
for (const seg of hatchSegments(100, 20, 50, 14)) {
  for (const x of [seg.x1, seg.x2]) assert.ok(x >= 100 && x <= 150, "hatch x inside the bar");
  for (const y of [seg.y1, seg.y2]) assert.ok(y >= 20 && y <= 34, "hatch y inside the bar");
}
assert.ok(hatchSegments(100, 20, 50, 14).length >= 5);
assert.equal(risingOwnerColor(samples, 2), "#0000aa");
assert.equal(risingOwnerColor([], 2), "#9aa8c8", "fallback color");
const warRow = { sideACivs: [{ pid: 0 }], sideBCivs: [{ pid: 2 }] };
const layout = buildGanttLayout(1400, 400, [warRow, rows[0]], { xMin: 0, xMax: 60 });
assert.ok(layout.rowHeights[1] < layout.rowHeights[0], "a rising row is thinner than a war bar");

// Tooltip lines in the axis's format.
const turnYearMap = new Map([[45, "900 BCE"], [50, "800 BCE"], [60, "600 BCE"]]);
assert.equal(formatAxisPoint(45, "900 BCE", turnYearMap, "year"), "900 BCE");
assert.equal(formatAxisPoint(45, "900 BCE", turnYearMap, "turn"), "T-45");
assert.equal(formatAxisPoint(45, "900 BCE", turnYearMap, "both"), "900 BCE (T-45)");
assert.equal(formatAxisPoint(50, undefined, turnYearMap, "year"), "800 BCE", "year read off the axis");
const tip = buildRisingTooltipModel(byId(1), { turnYearMap, latestTurn: 60 }, "both");
assert.equal(tip.title, "Greek Loyalist Rising at Mutsu");
assert.equal(tip.owner, "Held by Rome");
assert.equal(tip.dates, "900 BCE (T-45) → 800 BCE (T-50) · 5 turns");
assert.equal(tip.ongoing, false);
assert.equal(tip.outcome, "Put down.");
const openTip = buildRisingTooltipModel(byId(5), { turnYearMap, latestTurn: 60 }, "turn");
assert.equal(openTip.ongoing, true);
assert.equal(openTip.outcome, "Still under way.");

// Full render with risings and no wars: one thin row per rising, labelled, nothing about Persia.
const host = document.createElement("div");
const handle = renderConflictsTimeline(host, { history, width: 1400, height: 500 });
assert.ok(handle && handle.svg, "renders with risings alone");
const labels = findAllByClass(host, "is-rising");
assert.equal(labels.length, 5, "one label per visible rising");
assert.ok(labels.some((el) => el.textContent === "Greek Loyalist Rising at Mutsu"));
assert.ok(!labels.some((el) => /Persia/.test(el.textContent)));
const emptyHost = document.createElement("div");
assert.equal(renderConflictsTimeline(emptyHost, { history: { samples, wars: [], risings: [] } }), null);

// Every locale carries a translation of the rising text, not a copy of the English.
const RISING_TAG = /^LOC_DEMOGRAPHICS_(RISING_|HIST_EV_RISING|HIST_FILTER_RISINGS)/;
const RISING_KEYS = [...EN.keys()].filter((k) => RISING_TAG.test(k));
assert.equal(RISING_KEYS.length, 18);
for (const loc of ["de_de", "es_es", "fr_fr", "it_it", "ja_jp", "ko_kr", "pl_pl", "pt_br", "ru_ru", "zh_cn"]) {
  const xml = fs.readFileSync(`text/${loc}/ModText.xml`, "utf8");
  for (const key of RISING_KEYS) {
    const m = new RegExp(`Tag="${key}"[^>]*>\\s*<Text>([^<]*)</Text>`).exec(xml);
    assert.ok(m, `${loc} has ${key}`);
    assert.notEqual(m[1], EN.get(key), `${loc} ${key} is translated`);
    const wanted = (EN.get(key).match(/\{\d+_/g) || []).sort().join();
    assert.equal((m[1].match(/\{\d+_/g) || []).sort().join(), wanted, `${loc} ${key} keeps its placeholders`);
  }
}

console.log("risings-chart harness passed");
