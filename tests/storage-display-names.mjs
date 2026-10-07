import assert from "node:assert/strict";

// Stored names follow the current language on load (a game played in English and
// reopened in Korean used to show "Great Britain → Mongolia → 몽골" in legends and dropdowns).

const saved = { GameInfo: globalThis.GameInfo, Locale: globalThis.Locale };
const TEXT = {
  LOC_CIVILIZATION_GREAT_BRITAIN_NAME: "대영제국",
  LOC_CIVILIZATION_MONGOLIA_NAME: "몽골",
  LOC_LEADER_AUGUSTUS_NAME: "아우구스투스",
  LOC_DEMOGRAPHICS_CITY_STATE: "도시국가",
  LOC_CIVILIZATION_INDEPENDENT_NAME: "촌락"
};
const rows = {
  Civilizations: { CIVILIZATION_GREAT_BRITAIN: "LOC_CIVILIZATION_GREAT_BRITAIN_NAME", CIVILIZATION_MONGOLIA: "LOC_CIVILIZATION_MONGOLIA_NAME", CIVILIZATION_NOTEXT: "LOC_CIVILIZATION_NOTEXT_NAME" },
  Leaders: { LEADER_AUGUSTUS: "LOC_LEADER_AUGUSTUS_NAME" }
};
globalThis.GameInfo = Object.fromEntries(Object.entries(rows).map(([t, m]) => [t, { lookup: (k) => (m[k] ? { Name: m[k] } : null) }]));
globalThis.Locale = { compose: (k) => TEXT[k] || k };
const { localizeStoredNames } = await import("/demographics/ui/storage/storage-display-names.js");

try {
  const h = {
    samples: [
      { players: { 0: { civName: "Great Britain", leaderName: "Augustus", civTypeString: "CIVILIZATION_GREAT_BRITAIN", leaderTypeString: "LEADER_AUGUSTUS" } } },
      { players: { 0: { civName: "몽골", leaderName: "아우구스투스", civTypeString: "CIVILIZATION_MONGOLIA", leaderTypeString: "LEADER_AUGUSTUS" },
        1: { civName: "Kept", leaderName: "City-State", civTypeString: "CIVILIZATION_NOTEXT" }, 2: null } },
      null
    ],
    wars: [{
      name: "1st Great Britain vs Villages War", _nameKeyA: "Great Britain",
      sideACivs: [{ pid: 0, civ: "Great Britain", leader: "Augustus", civTypeString: "CIVILIZATION_GREAT_BRITAIN", leaderType: "LEADER_AUGUSTUS" }],
      sideBCivs: [{ pid: 34, civ: "Villages", leader: "", isCS: true }, { pid: 40, civ: "Kumbi Saleh", leader: "", isCS: true },
        { pid: 41, civ: "Villages", leader: "", isCS: false }, { pid: 42, civ: "촌락", leader: "", isCS: false }],
      declaredBy: { pid: 0, civ: "Great Britain", leader: "Augustus" }
    }, null, { sideACivs: 5 }]
  };
  assert.equal(localizeStoredNames(h), h);
  assert.equal(h.samples[0].players[0].civName, "대영제국");
  assert.equal(h.samples[0].players[0].leaderName, "아우구스투스");
  assert.equal(h.samples[1].players[1].civName, "Kept", "a type with no text keeps the stored name");
  const w = h.wars[0];
  assert.equal(w.sideACivs[0].civ, "대영제국");
  assert.equal(w.sideACivs[0].leader, "아우구스투스");
  assert.equal(w.sideBCivs[0].civ, "도시국가", "independents read as City-State");
  assert.equal(w.sideBCivs[1].civ, "Kumbi Saleh", "a named city-state is kept");
  assert.equal(w.sideBCivs[2].civ, "도시국가", "an independent stored as a major still reads as City-State");
  assert.equal(w.sideBCivs[3].civ, "도시국가", "an independent recorded in the current language too");
  assert.deepEqual(w.declaredBy, { pid: 0, civ: "대영제국", leader: "아우구스투스" });
  assert.equal(w._nameKeyA, "Great Britain", "recurrence keys are not touched");
  assert.equal(w.name, "1st Great Britain vs Villages War");
  assert.equal(localizeStoredNames(null), null);

  globalThis.GameInfo = undefined; // main menu / tests: nothing to read, nothing changes
  const h2 = { samples: [{ players: { 0: { civName: "Rome", civTypeString: "CIVILIZATION_ROME" } } }] };
  localizeStoredNames(h2);
  assert.equal(h2.samples[0].players[0].civName, "Rome");
  console.log("storage-display-names harness passed");
} finally {
  globalThis.GameInfo = saved.GameInfo;
  globalThis.Locale = saved.Locale;
}
