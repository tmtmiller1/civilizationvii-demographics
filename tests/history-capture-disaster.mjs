// Natural disasters are recorded against the major civilization whose land they struck.
import assert from "node:assert/strict";

const owners = { "5,5": 1, "6,5": 2, "9,9": -1, "10,9": 7 };
globalThis.GameInfo = {
  RandomEvents: { lookup: (t) => (t === 111 ? { RandomEventType: "RANDOM_EVENT_VOLCANO", Name: "LOC_VOLCANO" } : null) }
};
globalThis.GameplayMap = {
  getOwner: (x, y) => owners[x + "," + y] ?? -1,
  getPlotIndicesInRadius: (x, y) => [[x, y], [x + 1, y]].map(([a, b]) => a * 100 + b),
  getLocationFromIndex: (i) => ({ x: Math.floor(i / 100), y: i % 100 })
};
globalThis.Players = { getEverAlive: () => [1, 2, 7].map((id) => ({ id, isMajor: id !== 7, isAlive: true })) };
globalThis.Game = { turn: 42, getTurnDate: () => "1200 BCE" };

const { disasterEvent, campaignId } = await import("/demographics/ui/history/capture/history-capture.js");

// The campaign id is stable for one game, so recording twice from an old save does not duplicate it.
globalThis.Configuration = { getGame: () => ({ campaignSetupGUID: "ABC" }) };
assert.equal(campaignId(-942756509), campaignId(-942756509));
assert.equal(campaignId(-942756509), "ABC-" + (-942756509 >>> 0).toString(36));
assert.notEqual(campaignId(1), campaignId(2), "different maps, different games");
globalThis.Configuration = { getGame: () => ({}) };
assert.notEqual(campaignId(0), campaignId(0), "no GUID and no seed: unique");
const doc = { ages: [{ age: "AGE_ANTIQUITY", start: 1, end: 42 }] };
const e = disasterEvent(doc, { eventType: 111, location: { x: 5, y: 5 } });
assert.deepEqual({ ...e, d: undefined }, { t: 42, a: 0, k: "disaster", p: 1, n: "LOC_VOLCANO", x: "RANDOM_EVENT_VOLCANO", d: undefined });
assert.equal(disasterEvent(doc, { eventType: 111, location: { x: 9, y: 9 } }), null, "unclaimed or independent land is not recorded");
assert.equal(disasterEvent(doc, { eventType: 999, location: { x: 5, y: 5 } }), null, "unknown event types are ignored");
assert.equal(disasterEvent(doc, { eventType: 111 }), null, "no location, no record");
assert.equal(disasterEvent({ ages: [] }, { eventType: 111, location: { x: 5, y: 5 } }), null, "nothing before the campaign has an age");
owners["5,5"] = -1;
assert.equal(disasterEvent(doc, { eventType: 111, location: { x: 5, y: 5 } }).p, 2, "the nearest owned plot names the victim");

console.log("history-capture-disaster harness passed");
