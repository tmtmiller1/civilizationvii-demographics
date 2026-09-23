import assert from "node:assert/strict";
import {
  visibleRecords, ranked, titleIndex, overview, leaderRows, civRows, recordHolders, statOf, SHORT_GAME_TURNS, TITLE_COUNT,
  standing
} from "/demographics/ui/history/model/history-hof.js";

/** A record with the fields the Hall of Fame reads. */
function rec(id, o = {}) {
  return {
    v: 1, id, created: 0, updated: o.updated ?? 0, local: 0,
    leader: o.leader ?? "LEADER_A", leaderName: "", color: "",
    civs: o.civs ?? [{ age: "AGE_ANTIQUITY", civ: "CIV_ROME", name: "", from: 1 }],
    setup: {}, turns: o.turns ?? 100, ages: [],
    outcome: { status: o.status ?? "ended", victory: o.victory ?? "", name: "", winner: -1, turn: 0 },
    stats: { settlements: 0, peakSettlements: o.peak ?? 0, population: 0, wonders: o.wonders ?? 0, triumphs: o.tri ?? 0, captured: o.cap ?? 0, wars: 0, religion: "" },
    rivals: [], highlights: [], spark: { tri: [], set: [] }
  };
}

// Short unfinished games (test loads) are hidden unless asked for; finished short games stay.
{
  const list = [rec("a", { status: "in_progress", turns: SHORT_GAME_TURNS - 1 }), rec("b", { status: "victory", turns: 5 }), rec("c", { status: "in_progress", turns: 80 })];
  assert.deepEqual(visibleRecords(list).map((r) => r.id).sort(), ["b", "c"]);
  assert.equal(visibleRecords(list, { showShort: true }).length, 3);
  assert.equal(visibleRecords(list, { keep: "a" }).length, 3, "the game being played always shows");
}

// Ranking: victories first, then Triumphs, then fewer turns.
{
  const list = [
    rec("loss-many", { status: "defeat", tri: 30 }),
    rec("win-few", { status: "victory", tri: 5 }),
    rec("win-many-slow", { status: "victory", tri: 12, turns: 300 }),
    rec("win-many-fast", { status: "victory", tri: 12, turns: 200 }),
    rec("open", { status: "in_progress", tri: 50 })
  ];
  assert.deepEqual(ranked(list).map((r) => r.id), ["win-many-fast", "win-many-slow", "win-few", "loss-many", "open"]);
}

// Standing: the best games, and the current game placed among them with its neighbours.
{
  const list = Array.from({ length: 14 }, (_, i) => rec("g" + i, { status: "victory", tri: 40 - i, updated: i }));
  const st = standing(list, "g7", 10);
  assert.equal(st.top.length, 10);
  assert.equal(st.top[0].id, "g0");
  assert.deepEqual([st.current.rec.id, st.current.rank, st.current.of], ["g7", 8, 14]);
  assert.deepEqual([st.current.above.id, st.current.below.id], ["g6", "g8"]);
  const latest = standing(list);
  assert.equal(latest.current.rec.id, "g13", "no game being played: the latest one");
  assert.equal(latest.current.below, null, "the last game has nothing below it");
  assert.equal(standing(list, "g0").current.above, null, "the best game has nothing above it");
  assert.equal(standing(list, "missing").current.rec.id, "g13", "an unknown current game falls back to the latest");
  assert.deepEqual(standing([]), { order: [], top: [], current: null });
}

// Honorific ladder: the best game earns title 1, nothing earned earns the last title.
assert.equal(titleIndex(rec("x", { tri: 20 }), 20), 1);
assert.equal(titleIndex(rec("x", { tri: 0 }), 20), TITLE_COUNT);
assert.equal(titleIndex(rec("x", { tri: 10 }), 20), 1 + Math.round(0.5 * (TITLE_COUNT - 1)));
assert.equal(titleIndex(rec("x", { tri: 3 }), 0), TITLE_COUNT);

// Overview, leaders, civilizations.
{
  const list = [
    rec("a", { status: "victory", victory: "V_SCI", leader: "L1", updated: 5, tri: 4 }),
    rec("b", { status: "victory", victory: "V_SCI", leader: "L1", updated: 9, tri: 8 }),
    rec("c", { status: "defeat", leader: "L2", updated: 7, civs: [{ age: "A", civ: "CIV_ROME" }, { age: "B", civ: "CIV_NORMAN" }] }),
    rec("d", { status: "in_progress", leader: "L2", updated: 3 })
  ];
  const o = overview(list);
  assert.equal(o.games, 4);
  assert.equal(o.victories, 2);
  assert.equal(o.finished, 3);
  assert.equal(o.latest.id, "b");
  assert.deepEqual(o.victoriesByType, [["V_SCI", 2]]);
  const leaders = leaderRows(list);
  assert.deepEqual(leaders.map((r) => [r.key, r.games, r.wins, r.bestTriumphs]), [["L1", 2, 2, 8], ["L2", 2, 0, 0]]);
  // Every result is counted, so a card can name each part of its bar.
  assert.deepEqual(
    leaders.map((r) => [r.key, r.wins, r.losses, r.ended, r.open, r.finished]),
    [["L1", 2, 0, 0, 0, 2], ["L2", 0, 1, 0, 1, 1]]
  );
  const civs = civRows(list);
  assert.equal(civs.find((r) => r.key === "CIV_ROME").games, 4);
  assert.equal(civs.find((r) => r.key === "CIV_NORMAN").games, 1);
}

// Records: fastest victory looks only at victories; empty figures set no record.
{
  const list = [rec("fast-loss", { status: "defeat", turns: 50 }), rec("win", { status: "victory", turns: 150, wonders: 3 }), rec("long", { turns: 400 })];
  const byId = Object.fromEntries(recordHolders(list).map((h) => [h.id, h]));
  assert.equal(byId.fastest.game.id, "win");
  assert.equal(byId.longest.game.id, "long");
  assert.equal(byId.wonders.value, 3);
  assert.equal(byId.triumphs, undefined);
}

// A record without figures (an archive from another version, or edited by hand) ranks, titles and
// counts as zero instead of throwing.
{
  const bare = { ...rec("bare"), stats: undefined };
  const list = [bare, rec("full", { tri: 5, wonders: 2 })];
  assert.deepEqual(ranked(list).map((r) => r.id), ["full", "bare"]);
  assert.equal(titleIndex(bare, 5), TITLE_COUNT);
  assert.equal(overview(list).triumphs, 5);
  assert.equal(leaderRows(list)[0].bestTriumphs, 5);
  assert.equal(recordHolders(list).find((h) => h.id === "triumphs").game.id, "full");
  assert.equal(statOf({ ...rec("odd"), stats: { triumphs: "3" } }, "triumphs"), 0, "a figure that is not a number reads as 0");
  assert.equal(statOf(rec("x", { tri: 4 }), "triumphs"), 4);
}

console.log("history-hof harness passed");
