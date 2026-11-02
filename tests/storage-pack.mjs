// Covers: ui/storage/storage-pack.js
// The packed history (schema 2): round trips over every sample-bearing fixture, the roster, the
// metric dictionary, the wonder-list rule, the verbatim paths, and the malformed inputs that make
// unpackHistory return null so the loader parks the text.
import assert from "node:assert/strict";
import { packHistory, unpackHistory } from "/demographics/ui/storage/storage-pack.js";
import { allHistories } from "./fixtures/histories.mjs";

const jsonTrip = (v) => JSON.parse(JSON.stringify(v));

const roundTrip = (h) => unpackHistory(jsonTrip(packHistory(h)));
/** The round trip, compared whole: every metric value comes back as the v1 JSON trip gave it. */
const comparable = (h) => roundTrip(h);

/** What the v1 JSON round trip gives, with the one documented difference applied. */
function expected(h) {
  const e = jsonTrip(h);
  // `version` reads 2 after a pack round trip: the payload is schema 2 from then on, whatever the
  // in-memory history said (or didn't say).
  e.version = 2;
  return e;
}

const player = (over = {}) => ({
  leaderType: "LEADER_AUGUSTUS",
  civType: "CIVILIZATION_ROME",
  leaderName: "Augustus",
  civName: "Rome",
  leaderTypeString: "LEADER_AUGUSTUS",
  civTypeString: "CIVILIZATION_ROME",
  primaryColor: "#aa0000",
  secondaryColor: "#ffffff",
  met: true,
  continent: 1,
  metrics: { score: 10, gdp: 4.5, pop: 3 },
  wonderTypes: ["WONDER_PYRAMIDS"],
  ...over
});
const sample = (turn, players) => ({ turn, age: "AGE_ANTIQUITY", localTurn: turn, chartTurn: turn, players });
const history = (samples, over = {}) => ({
  version: 1, seed: 4242, samples, ageBoundaries: [], eliminated: {}, ...over
});
const GREECE = { civName: "Greece", civType: "CIVILIZATION_GREECE" };
const twoCivs = () => history([
  sample(1, { 0: player(), 1: player(GREECE) }),
  sample(2, { 0: player({ metrics: { score: 12, gdp: 5 } }), 1: player(GREECE) })
], { wars: [{ name: "w" }], settleTrace: { "1,1": [{ t: 1, pop: 2 }] } });

// Fixtures from the other tests round-trip.
for (const [name, h] of allHistories()) {
  assert.deepEqual(comparable(h), expected(h), `fixture ${name} round-trips`);
}

// A realistic history: identity goes to the roster, metric keys to the dictionary, numbers to v.
{
  const h = twoCivs();
  const packed = packHistory(h);
  assert.equal(packed.version, 2);
  assert.equal(packed.roster.length, 2, "two distinct identities");
  assert.deepEqual(packed.mk, ["score", "gdp", "pop"], "metric keys in first-seen order");
  assert.deepEqual(packed.samples[0].p[0], { r: 0, m: true, v: [10, 4.5, 3], w: ["WONDER_PYRAMIDS"] });
  assert.deepEqual(packed.samples[1].p[0], { r: 0, m: true, v: [12, 5] }, "trailing null trimmed, w omitted");
  assert.deepEqual(Object.keys(packed.samples[0]), ["turn", "age", "localTurn", "chartTurn", "p"], "p for players");
  assert.deepEqual(packed.wars, h.wars, "other top-level fields verbatim");
  assert.deepEqual(packed.settleTrace, h.settleTrace);
  assert.equal("players" in packed.samples[0], false);
  const back = roundTrip(h);
  assert.deepEqual(jsonTrip(back), expected(h));
  assert.deepEqual(Object.keys(back.samples[0].players[0]), Object.keys(player()), "buildSnapshotPlayer order");
  assert.ok(JSON.stringify(packed).length < JSON.stringify(h).length, "packed is smaller even at two samples");
  assert.equal(JSON.stringify(h), JSON.stringify(twoCivs()), "packing leaves the input alone");
}

// Identity change mid-stream: a second roster entry, right names on both sides.
{
  const h = history([
    sample(1, { 7: player({ civName: "Han", civType: "CIVILIZATION_HAN" }) }),
    sample(2, { 7: player({ civName: "Han", civType: "CIVILIZATION_HAN" }) }),
    sample(3, { 7: player({ civName: "Qajar", civType: "CIVILIZATION_QAJAR", primaryColor: "#00aa00" }) })
  ]);
  const packed = packHistory(h);
  assert.equal(packed.roster.length, 2);
  assert.equal(packed.samples[1].p[7].r, 0);
  assert.equal(packed.samples[2].p[7].r, 1);
  const back = roundTrip(h);
  assert.equal(back.samples[1].players[7].civName, "Han");
  assert.equal(back.samples[2].players[7].civName, "Qajar");
  assert.equal(back.samples[2].players[7].primaryColor, "#00aa00");
}

// Absent identity fields stay absent; a null continent is its own roster entry.
{
  const h = history([sample(1, { 0: { civName: "A", continent: null }, 1: { civName: "A" } })]);
  const packed = packHistory(h);
  assert.equal(packed.roster.length, 2, "null and absent continent are different identities");
  assert.deepEqual(packed.roster[0], { civName: "A", continent: null });
  assert.deepEqual(packed.roster[1], { civName: "A" });
  const back = roundTrip(h);
  assert.equal("continent" in back.samples[0].players[1], false);
  assert.equal(back.samples[0].players[0].continent, null);
  assert.equal("met" in back.samples[0].players[0], false, "met absent stays absent");
  assert.equal("metrics" in back.samples[0].players[0], false, "metrics absent stays absent");
  assert.equal("wonderTypes" in back.samples[0].players[0], false);
}

// Wonder lists: unchanged runs omit w; array to absent writes 0 and unpacks to absent. "Previous"
// is the last sample this pid appeared in, so a pid that skips a sample and returns with the same
// list still omits w, and one that returns with a different list gets w written again.
{
  const pw = (wonderTypes) => player({ wonderTypes });
  const h = history([
    sample(1, { 0: pw(["W1"]), 2: pw(["W9"]), 4: pw(["W4"]) }),
    sample(2, { 0: pw(["W1"]) }),
    sample(3, { 0: pw(["W1", "W2"]), 2: pw(["W9"]), 4: pw(["W4", "W5"]) }),
    sample(4, { 0: player({ wonderTypes: undefined }), 2: player({ wonderTypes: ["W9"] }) }),
    sample(5, { 0: player({ wonderTypes: undefined }), 2: player({ wonderTypes: [] }) })
  ]);
  const packed = packHistory(h);
  const w = (i, pid) => packed.samples[i].p[pid].w;
  assert.deepEqual(w(0, 0), ["W1"], "first appearance writes w");
  assert.equal("w" in packed.samples[1].p[0], false, "unchanged run omits w");
  assert.deepEqual(w(2, 0), ["W1", "W2"]);
  assert.equal(w(3, 0), 0, "array to absent writes 0");
  assert.equal("w" in packed.samples[4].p[0], false, "absent after absent omits w");
  assert.deepEqual(w(0, 2), ["W9"]);
  assert.equal("w" in packed.samples[2].p[2], false, "skipped a sample, same list on return: w omitted");
  assert.deepEqual(w(2, 4), ["W4", "W5"], "skipped a sample, new list on return: w written");
  assert.equal("w" in packed.samples[3].p[2], false);
  assert.deepEqual(w(4, 2), [], "an emptied list is written");
  const back = roundTrip(h);
  assert.deepEqual(jsonTrip(back), expected(h));
  assert.deepEqual(back.samples[1].players[0].wonderTypes, ["W1"], "omitted w unpacks to the previous list");
  assert.deepEqual(back.samples[2].players[2].wonderTypes, ["W9"], "across a skipped sample too");
  assert.equal("wonderTypes" in back.samples[3].players[0], false, "0 unpacks to absent");
  assert.notEqual(back.samples[1].players[0].wonderTypes, back.samples[0].players[0].wonderTypes, "own array each");
  // A pid whose first appearance has no list writes 0 and unpacks to absent.
  const noList = () => history([sample(1, { 5: player({ wonderTypes: undefined }) })]);
  assert.equal(packHistory(noList()).samples[0].p[5].w, 0);
  assert.equal("wonderTypes" in roundTrip(noList()).samples[0].players[5], false);
}

// Non-number metric values and unknown player keys survive in x.
{
  const pl = player({
    metrics: { score: 10, label: "ten", flag: true, nothing: null, nested: { a: 1 } },
    civ: "Rome",
    leader: "Augustus",
    isMajor: true,
    eliminated: false,
    extraList: [1, 2]
  });
  const h = history([sample(1, { 0: pl })]);
  const packed = packHistory(h);
  const e = packed.samples[0].p[0];
  assert.deepEqual(e.v, [10]);
  assert.deepEqual(e.x, {
    metrics: { label: "ten", flag: true, nothing: null, nested: { a: 1 } },
    civ: "Rome",
    leader: "Augustus",
    isMajor: true,
    eliminated: false,
    extraList: [1, 2]
  });
  assert.deepEqual(packed.mk, ["score"], "only numbers enter the dictionary");
  const back = roundTrip(h);
  assert.equal(back.samples[0].players[0].metrics.nothing, null, "a stored null metric comes back as null");
  assert.deepEqual(jsonTrip(back), expected(h));
  assert.deepEqual(
    Object.keys(back.samples[0].players[0]).slice(-5),
    ["civ", "leader", "isMajor", "eliminated", "extraList"],
    "x keys after the own fields"
  );
  // Metrics that isn't an object is kept verbatim.
  const odd = history([sample(1, { 0: player({ metrics: 5 }), 1: player({ metrics: null }) })]);
  const oddPacked = packHistory(odd);
  assert.equal("v" in oddPacked.samples[0].p[0], false);
  assert.equal(oddPacked.samples[0].p[0].x.metrics, 5);
  assert.deepEqual(comparable(odd), expected(odd));
  assert.equal(roundTrip(odd).samples[0].players[1].metrics, null);
  // No x when there is nothing extra.
  assert.equal("x" in packHistory(history([sample(1, { 0: player() })])).samples[0].p[0], false);
}

// NaN and Infinity metric values come back as null, exactly as the v1 JSON round trip gave them:
// they ride in x.metrics, not in v, so "absent" and "was not a number" stay different things.
{
  const h = history([sample(1, { 0: player({ metrics: { score: NaN, gdp: Infinity, pop: -Infinity, ok: 1 } }) })]);
  const v1 = jsonTrip(h).samples[0].players[0].metrics;
  assert.deepEqual(v1, { score: null, gdp: null, pop: null, ok: 1 }, "today's JSON trip nulls them");
  const back = roundTrip(h).samples[0].players[0].metrics;
  assert.deepEqual(back, v1, "pack trip gives the same nulls");
  assert.deepEqual(Object.keys(back).sort(), Object.keys(v1).sort(), "the same key set, so a CSV column is not lost");
  assert.deepEqual(packHistory(h).samples[0].p[0].v, [1], "only the finite number sits in v");
  assert.deepEqual(comparable(h), expected(h));
}

// A metric a player stops reporting: null in v means absent on unpack.
{
  const h = history([
    sample(1, { 0: player({ metrics: { a: 1, b: 2, c: 3 } }) }),
    sample(2, { 0: player({ metrics: { a: 1, c: 3 } }) }),
    sample(3, { 0: player({ metrics: { c: 3 } }) })
  ]);
  const packed = packHistory(h);
  assert.deepEqual(packed.samples[1].p[0].v, [1, null, 3]);
  assert.deepEqual(packed.samples[2].p[0].v, [null, null, 3]);
  assert.deepEqual(comparable(h), expected(h));
  assert.equal("b" in roundTrip(h).samples[1].players[0].metrics, false);
}

// Verbatim paths: a sample whose players isn't an object, a player entry that isn't an object, a
// null sample, a sample without players.
{
  const h = history([
    sample(1, null),
    sample(2, 7),
    sample(3, { 0: null, 1: "junk", 2: 5, 3: player() }),
    null,
    { turn: 5, age: "AGE_ANTIQUITY" },
    sample(6, [player()])
  ]);
  const packed = packHistory(h);
  assert.equal(packed.samples[0].players, null, "players null kept verbatim");
  assert.equal("p" in packed.samples[0], false);
  assert.equal(packed.samples[1].players, 7);
  assert.equal(packed.samples[2].p[0], null, "null player entry verbatim, no r");
  assert.equal(packed.samples[2].p[1], "junk");
  assert.equal(packed.samples[2].p[2], 5);
  assert.equal(packed.samples[2].p[3].r, 0);
  assert.equal(packed.samples[3], null);
  assert.deepEqual(packed.samples[4], { turn: 5, age: "AGE_ANTIQUITY" });
  assert.deepEqual(packed.samples[5].players, [player()], "an array of players is not a map; verbatim");
  assert.deepEqual(comparable(h), expected(h));
}

// A non-array `samples` is carried verbatim and refused on unpack.
{
  const packed = packHistory({ version: 1, seed: 1, samples: "nope" });
  assert.equal(packed.samples, "nope");
  assert.equal(unpackHistory(packed), null);
}

// packHistory never throws and always answers an object.
for (const junk of [null, undefined, 5, "text", [], () => {}, { samples: null }]) {
  const packed = packHistory(junk);
  assert.equal(typeof packed, "object");
  assert.equal(packed.version, 2);
}

// Malformed packed input returns null, so the loader parks it.
{
  const good = packHistory(history([sample(1, { 0: player() })]));
  const mutate = (fn) => {
    const copy = jsonTrip(good);
    fn(copy);
    return copy;
  };
  assert.ok(unpackHistory(jsonTrip(good)), "the control case unpacks");
  for (const [name, bad] of [
    ["not an object", null],
    ["an array", []],
    ["a string", "text"],
    ["version 1", mutate((c) => (c.version = 1))],
    ["version 3", mutate((c) => (c.version = 3))],
    ["no version", mutate((c) => delete c.version)],
    ["roster not an array", mutate((c) => (c.roster = {}))],
    ["roster entry not an object", mutate((c) => (c.roster = [5]))],
    ["mk not an array", mutate((c) => (c.mk = "score"))],
    ["mk with a non-string", mutate((c) => (c.mk = ["score", 3]))],
    ["samples not an array", mutate((c) => (c.samples = {}))],
    ["r out of range", mutate((c) => (c.samples[0].p[0].r = 1))],
    ["r negative", mutate((c) => (c.samples[0].p[0].r = -1))],
    ["r not an integer", mutate((c) => (c.samples[0].p[0].r = 0.5))],
    ["r missing", mutate((c) => delete c.samples[0].p[0].r)],
    ["r a string", mutate((c) => (c.samples[0].p[0].r = "0"))],
    ["v longer than mk", mutate((c) => (c.samples[0].p[0].v = [1, 2, 3, 4]))],
    ["v not an array", mutate((c) => (c.samples[0].p[0].v = { score: 1 }))]
  ]) {
    assert.equal(unpackHistory(bad), null, `${name} returns null`);
  }
  // Odd but readable shapes are tolerated rather than parked.
  assert.ok(unpackHistory(mutate((c) => (c.samples[0].p[0].x = "junk"))), "a non-object x is ignored");
  assert.ok(unpackHistory(mutate((c) => (c.samples[0].p[0].w = "junk"))), "a non-array w reads as absent");
  assert.ok(unpackHistory(mutate((c) => (c.samples[0].p = 5))), "a non-object p becomes players verbatim");
  assert.equal(unpackHistory(mutate((c) => (c.samples[0].p = 5))).samples[0].players, 5);
  assert.ok(unpackHistory(mutate((c) => c.samples.push(null, "junk", { turn: 2 }))), "odd samples pass through");
  // Top-level fields other than roster, mk and samples come back as they were.
  const back = unpackHistory(mutate((c) => (c.extra = { a: 1 })));
  assert.deepEqual(back.extra, { a: 1 });
  assert.equal("roster" in back, false);
  assert.equal("mk" in back, false);
  assert.equal(back.version, 2);
}

// Unpacking never throws: a getter that throws is caught.
{
  const trap = { version: 2, roster: [], mk: [], get samples() { throw new Error("boom"); } };
  assert.equal(unpackHistory(trap), null);
  const packTrap = { version: 1, get samples() { throw new Error("boom"); } };
  assert.equal(packHistory(packTrap).version, 2);
}

console.log("storage-pack harness passed");
