// Partisans risings in the Chronicle: the capture (first reading sets a baseline, then one event as
// a rising breaks out and one as it ends, each told once), the sentences (read in the real en_us
// text), the spoiler rule (shown with its owner, the other civ left unnamed while unmet) and the
// Risings filter, which appears only once there is a rising to show.
import assert from "node:assert/strict";
import fs from "node:fs";

const EN = new Map(
  [...fs.readFileSync("text/en_us/ModText.xml", "utf8").matchAll(/Tag="(LOC_[A-Z0-9_]+)">\s*<Text>([^<]*)<\/Text>/g)]
    .map((m) => [m[1], m[2]])
);
const EXTRA = { LOC_ROME: "Rome", LOC_GREECE: "Greece", LOC_PERSIA: "Persia", LOC_LA: "Augustus",
  LOC_CIVILIZATION_GREECE_ADJECTIVE: "Greek", LOC_TRADITION_CURFEW_NAME: "Curfew" };
globalThis.Locale = {
  compose: (key, ...args) => {
    const text = EXTRA[key] ?? EN.get(key);
    if (text === undefined) return key;
    return text.replace(/\{(\d+)_[A-Za-z]+\}/g, (_, n) => String(args[Number(n) - 1] ?? ""));
  }
};
const CURFEW = { Name: "LOC_TRADITION_CURFEW_NAME" };
globalThis.GameInfo = { Traditions: { lookup: (type) => (type === "TRADITION_CURFEW" ? CURFEW : null) } };

const { risingEvents } = await import("/demographics/ui/history/capture/history-risings.js");
const { castFromDoc, eventText, eventVisible } = await import("/demographics/ui/history/model/history-narrate.js");
const { FILTERS, filterKeys, filteredEvents } = await import("/demographics/ui/history/views/view-chronicle.js");
const { viewState } = await import("/demographics/ui/history/views/history-state.js");

const row = (over) => ({
  id: 1, at: "3,4", name: "Mutsu", owner: 0, cause: "flip", from: 2, ip: 40, start: 10, ...over
});
const world = (turn) => ({ turn, age: "AGE_ANTIQUITY", date: "T" + turn, players: {}, victories: [] });

// Partisans absent: nothing happens, not even the baseline.
const doc = /** @type {*} */ ({ events: [] });
assert.deepEqual(risingEvents(doc, world(10), 0, null), []);
assert.equal(doc.ris, undefined);

// First reading: risings already under way are noted, not announced.
assert.deepEqual(risingEvents(doc, world(10), 0, [row({ id: 1 })]), []);
assert.deepEqual(doc.ris, { 1: 1 });

// A new rising breaks out; junk rows are skipped.
const begun = risingEvents(doc, world(11), 0, [row({ id: 1 }), { id: "junk" }, row({
  id: 2, name: "Sardis", owner: 2, cause: "enclave", from: undefined, homeland: 0, policy: "TRADITION_CURFEW"
})]);
assert.deepEqual(begun, [
  { t: 11, a: 0, k: "rising", p: 2, q: 0, n: "Sardis", x: "enclave|LOC_TRADITION_CURFEW_NAME", d: "T11" }
]);
assert.deepEqual(risingEvents(doc, world(12), 0, [row({ id: 1 }), row({ id: 2, owner: 2, cause: "enclave" })]), [],
  "told once");

// Ends are told once; a rising that began and ended between readings gets both.
const ended = risingEvents(doc, world(13), 0, [
  row({ id: 1, end: 12, outcome: "burned" }),
  row({ id: 3, name: "Tyre", cause: "misery", from: undefined, end: 13, outcome: "time" })
]);
assert.deepEqual(ended.map((e) => [e.k, e.n, e.x]), [
  ["risingEnd", "Mutsu", "flip|burned"],
  ["rising", "Tyre", "misery"],
  ["risingEnd", "Tyre", "misery|time"]
]);
assert.deepEqual(risingEvents(doc, world(14), 0, [row({ id: 1, end: 12, outcome: "burned" })]), []);
assert.deepEqual(doc.ris, { 1: 2 }, "ids Partisans no longer reports are forgotten");

// Sentences, with Greece (2) met and Persia (3) unmet.
const campaign = /** @type {*} */ ({
  local: 0,
  players: {
    0: { leader: "L0", leaderName: "LOC_LA", color: "#a00", elim: 0, human: true,
      civs: [{ age: "AGE_ANTIQUITY", civ: "CIVILIZATION_ROME", name: "LOC_ROME", from: 1 }] },
    2: { leader: "L2", leaderName: "LOC_LB", color: "#00a", elim: 0, human: false,
      civs: [{ age: "AGE_ANTIQUITY", civ: "CIVILIZATION_GREECE", name: "LOC_GREECE", from: 1 }] },
    3: { leader: "L3", leaderName: "LOC_LC", color: "#0a0", elim: 0, human: false,
      civs: [{ age: "AGE_ANTIQUITY", civ: "CIVILIZATION_PERSIA", name: "LOC_PERSIA", from: 1 }] }
  },
  ages: [{ age: "AGE_ANTIQUITY", start: 1, end: 20 }],
  events: [],
  last: { players: { 0: { met: true }, 2: { met: true }, 3: { met: false } } }
});
const cast = castFromDoc(campaign);
const say = (event) => eventText(event, cast, "AGE_ANTIQUITY");
const flip = { t: 11, a: 0, k: "rising", p: 0, q: 2, n: "Mutsu", x: "flip", d: "T11" };
assert.equal(say(flip),
  "Greek Loyalist Rising at Mutsu broke out. After Mutsu joined Rome by culture, people loyal to Greece took up arms.");
assert.equal(say({ ...flip, k: "risingEnd", x: "flip|dispersed" }), "Greek Loyalist Rising at Mutsu ended. Put down.");
assert.equal(say({ ...flip, q: 3 }),
  "Mutsu Uprising broke out. After Mutsu joined Rome by culture, people loyal to its old rulers took up arms.",
  "an unmet old owner is left unnamed");
assert.equal(say({ t: 11, a: 0, k: "rising", p: 2, q: 0, n: "Sardis", x: "enclave|LOC_TRADITION_CURFEW_NAME" }),
  "Sardis Uprising broke out. Rose against Greece's Curfew during its war with Rome.");
assert.equal(say({ t: 11, a: 0, k: "rising", p: 2, q: 0, n: "Sardis", x: "enclave" }),
  "Sardis Uprising broke out. Rose against how Greece treated its residents during its war with Rome.");
assert.equal(say({ t: 11, a: 0, k: "rising", p: 0, n: "Tyre", x: "misery" }),
  "Tyre Uprising broke out. Years of unhappiness in Tyre.");
assert.equal(say({ t: 13, a: 0, k: "risingEnd", p: 0, n: "Tyre", x: "misery|burned" }),
  "Tyre Uprising ended. Tyre was burned.");
assert.equal(say({ t: 13, a: 0, k: "risingEnd", p: 0, n: "Tyre", x: "misery|age" }),
  "Tyre Uprising ended. Ended with the age.");
assert.equal(say({ t: 13, a: 0, k: "risingEnd", p: 0, n: "Tyre", x: "misery|time" }),
  "Tyre Uprising ended. Died down.");

// Spoilers: shown with its owner even when the other civ is unmet; hidden when the owner is.
assert.equal(eventVisible({ ...flip, q: 3 }, cast), true);
assert.equal(eventVisible({ ...flip, p: 3, q: 0 }, cast), false);
assert.equal(eventVisible({ t: 1, a: 0, k: "war", p: 0, q: 3 }, cast), false, "wars keep the two-sided rule");

// The Risings filter appears once there is a rising and shows only rising events.
assert.deepEqual(FILTERS.risings, ["rising", "risingEnd"]);
assert.equal(filterKeys(campaign).includes("risings"), false, "no rising, no Risings pill");
campaign.events = [flip, { ...flip, k: "risingEnd", x: "flip|time" }, { t: 12, a: 0, k: "found", p: 0, n: "Rome" },
  { ...flip, p: 3, q: 0 }];
assert.equal(filterKeys(campaign).includes("risings"), true);
viewState.filter = "risings";
viewState.age = "all";
const { shown, hidden } = filteredEvents(campaign, cast);
assert.deepEqual(shown.map((e) => e.k), ["rising", "risingEnd"]);
assert.equal(hidden, 1, "the unmet owner's rising is counted as hidden");
viewState.filter = "all";

console.log("history-risings harness passed");
