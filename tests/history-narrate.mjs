import assert from "node:assert/strict";
// A Locale that resolves every tag (LOC_ROME -> ROME) and echoes template arguments.
globalThis.Locale = {
  compose: (key, ...args) => (args.length ? key + "|" + args.join("|") : key.startsWith("LOC_") ? key.slice(4) : key)
};
const { castFromDoc, castFromRecord, eventText, eventVisible, summarizeAge, spanFor } = await import(
  "/demographics/ui/history/model/history-narrate.js"
);

const doc = {
  local: 0,
  players: {
    0: { leader: "LEADER_A", leaderName: "LOC_LA", color: "#111", elim: 0, human: true, civs: [
      { age: "AGE_ANTIQUITY", civ: "CIV_ROME", name: "LOC_ROME", from: 1 },
      { age: "AGE_EXPLORATION", civ: "CIV_NORMAN", name: "LOC_NORMAN", from: 1 }
    ] },
    1: { leader: "LEADER_B", leaderName: "LOC_LB", color: "#222", elim: 0, human: false, civs: [{ age: "AGE_ANTIQUITY", civ: "CIV_EGYPT", name: "LOC_EGYPT", from: 1 }] },
    2: { leader: "LEADER_C", leaderName: "LOC_LC", color: "#333", elim: 0, human: false, civs: [{ age: "AGE_ANTIQUITY", civ: "CIV_GREECE", name: "LOC_GREECE", from: 1 }] }
  },
  last: { players: { 0: { met: true }, 1: { met: true }, 2: { met: false } } }
};
const cast = castFromDoc(doc);

// An unresolved tag never reaches the screen: it falls back to a readable type name.
assert.equal(castFromDoc({ ...doc, players: { 0: { ...doc.players[0], civs: [{ age: "A", civ: "CIVILIZATION_FRENCH_EMPIRE", name: "", from: 1 }] } } }).civName(0, "A"), "French Empire");

// Civilization names follow the age of the event.
assert.equal(cast.civName(0, "AGE_ANTIQUITY"), "ROME");
assert.equal(cast.civName(0, "AGE_EXPLORATION"), "NORMAN");
assert.equal(spanFor(doc.players[1].civs, "AGE_MODERN").civ, "CIV_EGYPT", "falls back to the latest span");

// Sentences carry their arguments in template order.
assert.equal(eventText({ t: 5, a: 0, k: "capture", p: 0, q: 1, n: "Memphis" }, cast, "AGE_ANTIQUITY"), "LOC_DEMOGRAPHICS_HIST_EV_CAPTURE|ROME|Memphis|EGYPT");
assert.equal(eventText({ t: 5, a: 0, k: "war", p: 1, q: 0 }, cast, "AGE_ANTIQUITY"), "LOC_DEMOGRAPHICS_HIST_EV_WAR|EGYPT|ROME");
assert.equal(eventText({ t: 5, a: 0, k: "razed", p: -1, q: 1, n: "Thebes" }, cast, "AGE_ANTIQUITY"), "LOC_DEMOGRAPHICS_HIST_EV_RAZED|Thebes|EGYPT");
assert.equal(eventText({ t: 1, a: 1, k: "age", p: -1, x: "AGE_EXPLORATION", n: "LOC_AGE_EXP" }, cast, "AGE_EXPLORATION"), "LOC_DEMOGRAPHICS_HIST_EV_AGE|AGE_EXP");
assert.equal(eventText({ t: 1, a: 1, k: "civ", p: 0, x: "CIV_NORMAN", n: "LOC_NORMAN" }, cast, "AGE_EXPLORATION"), "LOC_DEMOGRAPHICS_HIST_EV_CIV|LA|NORMAN");
assert.equal(eventText({ t: 9, a: 0, k: "capture", p: 0, q: -1, n: "Ur" }, cast, "AGE_ANTIQUITY"), "LOC_DEMOGRAPHICS_HIST_EV_CAPTURE|ROME|Ur|DEMOGRAPHICS_HIST_INDEPENDENT_PEOPLE");
assert.equal(eventText({ t: 9, a: 0, k: "wonder", p: 0, x: "WONDER_PYRAMIDS" }, cast, "AGE_ANTIQUITY"), "LOC_DEMOGRAPHICS_HIST_EV_WONDER|ROME|Pyramids");

// Victories use a short name; Domination's game name ("Domination Victory") would repeat the word.
assert.equal(eventText({ t: 9, a: 2, k: "victory", p: 0, x: "VICTORY_SCIENCE_MODERN", n: "LOC_SCI" }, cast, "AGE_ANTIQUITY"), "LOC_DEMOGRAPHICS_HIST_EV_VICTORY|ROME|SCI");
assert.equal(eventText({ t: 9, a: 2, k: "victory", p: 0, x: "VICTORY_DOMINATION", n: "LOC_VICTORY_DOMINATION_NAME" }, cast, "AGE_ANTIQUITY"), "LOC_DEMOGRAPHICS_HIST_EV_VICTORY|ROME|DEMOGRAPHICS_HIST_VICTORY_DOMINATION");

// Spoilers: events about unmet civilizations are hidden; ages and victories always show.
assert.ok(eventVisible({ t: 1, a: 0, k: "war", p: 0, q: 1 }, cast));
assert.ok(!eventVisible({ t: 1, a: 0, k: "war", p: 1, q: 2 }, cast));
assert.ok(!eventVisible({ t: 1, a: 0, k: "wonder", p: 2 }, cast));
assert.ok(eventVisible({ t: 1, a: 0, k: "victory", p: 2 }, cast));

// Age summary counts only the local player's deeds and names met civilizations that fell.
{
  const evs = [
    { t: 1, a: 0, k: "found", p: 0 }, { t: 2, a: 0, k: "found", p: 0 }, { t: 2, a: 0, k: "found", p: 1 },
    { t: 3, a: 0, k: "capture", p: 0, q: 1 }, { t: 4, a: 0, k: "capture", p: 1, q: 0 },
    { t: 5, a: 0, k: "wonder", p: 0, x: "W", n: "LOC_W" }, { t: 6, a: 0, k: "triumph", p: 0 },
    { t: 7, a: 0, k: "war", p: 1, q: 0 }, { t: 8, a: 0, k: "religion", p: 0, n: "LOC_REL" },
    { t: 9, a: 0, k: "elim", p: 1 }, { t: 9, a: 0, k: "elim", p: 2 }
  ];
  const s = summarizeAge(evs, cast, "AGE_ANTIQUITY");
  assert.deepEqual(
    { founded: s.founded, captured: s.captured, lost: s.lost, wonders: s.wonders, triumphs: s.triumphs, wars: s.wars, religion: s.religion, fallen: s.fallen },
    { founded: 2, captured: 1, lost: 1, wonders: ["W"], triumphs: 1, wars: 1, religion: "REL", fallen: ["EGYPT"] }
  );
}

// The analytics policy widens or narrows who is known.
assert.ok(castFromDoc(doc, "full").known(2), "full shows unmet civilizations");
assert.ok(!castFromDoc(doc, "own").known(1), "own-civ-only hides met civilizations too");
assert.ok(castFromDoc(doc, "own").known(0), "the local player is always known");

// Archived records name rivals by their final civilization and show everything.
{
  const rec = { local: 3, leader: "LEADER_A", leaderName: "LOC_LA", color: "#111", civs: doc.players[0].civs,
    rivals: [[5, "LEADER_B", "LOC_LB", "CIV_EGYPT", "LOC_EGYPT", "#222", 0, 4]] };
  const rc = castFromRecord(rec);
  assert.equal(rc.civName(3, "AGE_EXPLORATION"), "NORMAN");
  assert.equal(rc.civName(5, "AGE_ANTIQUITY"), "EGYPT");
  assert.equal(rc.leaderName(5), "LB");
  assert.notEqual(rc.color(5), "#222", "a near-black civ color is lifted to a readable one");
  assert.ok(rc.color(5) && rc.color(3) && rc.color(5) !== rc.color(3), "colors in one game stay distinct");
  assert.ok(rc.known(99));
}

// Saved text: a tag the current Locale cannot resolve reads from text saved with an archived record.
{
  const { t, addSavedTexts } = await import("/demographics/ui/history/core/history-text.js");
  const saved = globalThis.Locale;
  globalThis.Locale = { compose: (k, ...a) => (a.length ? k + "|" + a.join("|") : k) };
  assert.equal(t("LOC_CITY_NAME_HAWAII12"), "LOC_CITY_NAME_HAWAII12", "unresolved with nothing saved");
  addSavedTexts({ LOC_CITY_NAME_HAWAII12: "Hilo" });
  assert.equal(t("LOC_CITY_NAME_HAWAII12"), "Hilo");
  assert.equal(t("LOC_X|args", 1), "LOC_X|args|1", "templates with arguments are never replaced");
  globalThis.Locale = saved;
}

console.log("history-narrate harness passed");
