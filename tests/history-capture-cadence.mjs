// The Hall of Fame record is refreshed in memory on every sample but written to the archive every
// HOF_FILE_EVERY local turns, on every forced reason (load, victory, defeat, age end) and when the
// capture stops. The campaign in the save is written every time. After MAX_ERRORS failures the
// capture says once that it has stopped.
import assert from "node:assert/strict";
import { buggyStorage } from "./_history-fixtures.mjs";

// ---- a world of one living major ---------------------------------------------------------------
let turn = 1;
let leaderThrows = false;
const major = {
  id: 0,
  isMajor: true,
  isAlive: true,
  isHuman: true,
  get leaderType() {
    if (leaderThrows) throw new Error("leader unreadable");
    return "LEADER_X";
  },
  civilizationType: "CIV_X"
};
const config = new Map();
globalThis.GameInfo = {
  Ages: { lookup: () => ({ AgeType: "AGE_ANTIQUITY" }) },
  Leaders: { lookup: () => ({ LeaderType: "LEADER_X", Name: "LOC_LEADER_X" }) },
  Civilizations: { lookup: () => ({ CivilizationType: "CIV_X", Name: "LOC_CIV_X" }) }
};
globalThis.GameContext = { localPlayerID: 0 };
globalThis.Players = { getEverAlive: () => [major], get: () => major };
globalThis.Game = { get turn() { return turn; }, age: 1, getTurnDate: () => "1000 BCE" };
globalThis.Configuration = {
  getGame: () => ({ getValue: (k) => config.get(k) ?? null, startTurn: 1, startAgeType: 1, gameSeed: 7 }),
  editGame: () => ({ setValue: (k, v) => void config.set(k, String(v)) }),
  getMap: () => ({ mapSeed: 7 })
};
globalThis.Network = {};
globalThis.engine = { on: () => {}, off: () => {} };
globalThis.Loading = { runWhenLoaded: () => {} };

const storage = buggyStorage();
let archiveWrites = 0;
const baseSet = storage.setItem;
storage.setItem = (k, v) => {
  archiveWrites += 1;
  return baseSet(k, v);
};
globalThis.localStorage = storage;

const logged = [];
const realError = console.error;
console.error = (...args) => void logged.push(args.map(String).join(" "));

const cap = await import("/demographics/ui/history/capture/history-capture.js");
const store = await import("/demographics/ui/history/store/history-archive-store.js");
const { live } = await import("/demographics/ui/history/capture/history-live.js");

const campaignWrites = () => (config.has("Demographics__history-campaign-v1") ? 1 : 0);
const recordTurns = () => store.allRecords()[0]?.turns;

// 1. The load sample writes at once; turn samples inside the window only update memory.
{
  cap._resetForTests();
  store._resetForTests();
  cap.startCapture();
  turn = 1;
  cap.sampleNow("load");
  assert.equal(archiveWrites, 1, "the load sample writes the archive");
  assert.equal(campaignWrites(), 1, "the campaign is saved");
  for (turn = 2; turn <= 5; turn += 1) cap.sampleNow("turn");
  assert.equal(archiveWrites, 1, "turns 2 to 5 stay in memory");
  assert.equal(recordTurns(), 5, "the in-memory record is current between writes");
  assert.equal(JSON.parse(storage.dump().modSettings)["demographics-halloffame"].games[Object.keys(
    JSON.parse(storage.dump().modSettings)["demographics-halloffame"].games)[0]].turns, 1,
    "the stored record is still the one from the load");
  turn = 6;
  cap.sampleNow("turn");
  assert.equal(archiveWrites, 2, "turn 6 is HOF_FILE_EVERY turns after the last write");
  for (turn = 7; turn <= 10; turn += 1) cap.sampleNow("turn");
  assert.equal(archiveWrites, 2);
  turn = 11;
  cap.sampleNow("turn");
  assert.equal(archiveWrites, 3, "turn 11 writes again");
}

// 2. A forced reason writes at once and restarts the window.
{
  turn = 12;
  cap.sampleNow("victory");
  assert.equal(archiveWrites, 4, "a victory writes at once");
  turn = 13;
  cap.sampleNow("turn");
  assert.equal(archiveWrites, 4, "the window restarts from the forced write");
}

// 3. stopCapture flushes what a turn sample left in memory; with nothing new it writes nothing.
{
  cap.stopCapture();
  assert.equal(archiveWrites, 5, "stopping writes the pending record");
  assert.equal(live.historySize, null, "the size provider is gone once capture stops");
  cap.startCapture();
  assert.equal(typeof live.historySize, "function", "startCapture installs the size provider");
  cap.stopCapture();
  assert.equal(archiveWrites, 5, "nothing new, nothing written");
}

// 4. After MAX_ERRORS failed samples the capture says so once and then does nothing.
{
  cap._resetForTests();
  store._resetForTests();
  cap.startCapture();
  leaderThrows = true;
  logged.length = 0;
  const writesBefore = archiveWrites;
  for (let i = 0; i < 25; i += 1) {
    turn = 20 + i;
    cap.sampleNow("turn");
  }
  const stopLines = logged.filter((l) => l.includes("chronicle capture stopped for this session after 25 errors"));
  assert.equal(stopLines.length, 1, "the stop is logged exactly once");
  assert.equal(logged.filter((l) => l.includes("sample failed")).length, 25, "each failure logs on its own");
  logged.length = 0;
  turn = 50;
  cap.sampleNow("turn");
  cap.sampleNow("victory");
  assert.deepEqual(logged, [], "the 26th call does nothing");
  assert.equal(archiveWrites, writesBefore, "no write while stopped");
  leaderThrows = false;
  cap.stopCapture();
}

console.error = realError;
console.log("history-capture-cadence harness passed (4 cases)");
