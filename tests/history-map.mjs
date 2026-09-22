// The territory map model: encoding, frame keeping, placement on the timeline, archive form.
import assert from "node:assert/strict";
import {
  rle, unrle, thinFrames, addFrame, mapView, packMap, unpackMap, frameAt, DOC_FRAMES_CAP, RECORD_FRAMES_CAP,
  withinBytes, RECORD_MAP_BYTES, DOC_MAP_BYTES
} from "/demographics/ui/history/model/history-map.js";
import { holders, safeColor, hexLayout, displaySize, cellCenter, cellLayers } from "/demographics/ui/history/views/history-map-view.js";
import { gridWidth } from "/demographics/ui/history/capture/history-mapgrid.js";

// Run-length round trip, negative owners included.
const cells = [-1, -1, 0, 0, 0, -2, 3, 3, -1];
assert.equal(rle(cells), "-1x2.0x3.-2x1.3x2.-1x1");
assert.deepEqual(unrle(rle(cells), cells.length), cells);
assert.deepEqual(unrle("1x2", 4, 9), [1, 1, 9, 9], "cells past the encoding take the fill");
assert.deepEqual(unrle("garbage.x3.2x", 2), [-1, -1], "malformed runs are skipped");
assert.equal(rle([]), "");

// Thinning keeps the first and the newest, evenly spaced.
assert.deepEqual(thinFrames([0, 1, 2, 3, 4, 5, 6, 7, 8], 3), [0, 4, 8]);
assert.deepEqual(thinFrames([1, 2], 5), [1, 2]);

// Frames: a same-turn frame replaces, an unchanged one is skipped, the list is capped.
{
  const map = { w: 3, h: 3, terrain: "1x9", frames: [] };
  assert.equal(addFrame(map, { t: 1, a: 0, o: "0x1.-1x8", c: [[0, 0]] }), true);
  assert.equal(addFrame(map, { t: 4, a: 0, o: "0x1.-1x8", c: [[0, 0]] }), false, "nothing changed");
  assert.equal(addFrame(map, { t: 1, a: 0, o: "0x2.-1x7", c: [[0, 0]] }), true);
  assert.equal(map.frames.length, 1, "same turn replaced");
  assert.equal(map.frames[0].o, "0x2.-1x7");
  for (let t = 2; t < DOC_FRAMES_CAP + 20; t++) addFrame(map, { t, a: 0, o: "0x" + t + ".-1x1", c: [] });
  assert.ok(map.frames.length <= DOC_FRAMES_CAP);
  assert.equal(map.frames[0].t, 1, "first frame kept");
  assert.equal(map.frames[map.frames.length - 1].t, DOC_FRAMES_CAP + 19, "newest frame kept");
}

// Byte budgets: a ragged map loses frames, never the newest.
{
  const big = Array.from({ length: 16 }, (_, i) => ({ id: i, bytes: 5000 }));
  const kept = withinBytes(big, 24000, (f) => f.bytes);
  assert.ok(kept.length * 5000 <= 24000 && kept[kept.length - 1].id === 15 && kept[0].id === 0, "thinned, first and newest kept");
  assert.deepEqual(withinBytes([{ id: 0, bytes: 9e5 }, { id: 1, bytes: 9e5 }], 1000, (f) => f.bytes).map((f) => f.id), [1], "only the newest when even two do not fit");
  const ragged = { at: 0, o: Array.from({ length: 3000 }, (_, i) => (i % 2 ? "1x1" : "-1x1")).join("."), c: [] };
  const packed = packMap({ w: 60, h: 50, terrain: "", frames: Array.from({ length: 30 }, (_, i) => ({ ...ragged, at: i })) });
  assert.ok(JSON.stringify(packed.f).length <= RECORD_MAP_BYTES + 2000, "a ragged map fits the record budget");
  const docMap = { w: 60, h: 50, terrain: "", frames: [] };
  for (let t = 0; t < 60; t++) addFrame(docMap, { t, a: 0, o: ragged.o + "." + t + "x1", c: [] });
  assert.ok(docMap.frames.reduce((n, f) => n + f.o.length, 0) <= DOC_MAP_BYTES, "the saved map stays within its budget");
  assert.equal(docMap.frames[docMap.frames.length - 1].t, 59, "newest frame kept");
}

// Placement on the timeline axis (turns restart each age) and the archive form.
const doc = {
  ages: [{ age: "AGE_ANTIQUITY", start: 1, end: 100 }, { age: "AGE_EXPLORATION", start: 1, end: 50 }],
  map: { w: 2, h: 2, terrain: "0x1.1x3", frames: [{ t: 10, a: 0, o: "0x4", c: [[1, 0]] }, { t: 5, a: 1, o: "1x4", c: [] }] }
};
const mv = mapView(doc);
assert.deepEqual(mv.frames.map((f) => f.at), [9, 104]);
assert.equal(mapView({ ages: [], map: undefined }), null);
assert.equal(mapView({ ages: [], map: { w: 2, h: 2, terrain: "", frames: [] } }), null);
assert.deepEqual(unpackMap(JSON.parse(JSON.stringify(packMap(mv)))), mv);
assert.equal(packMap(null), undefined);
assert.equal(unpackMap({ w: 0, h: 2, f: [[0, "", []]] }), null);
assert.equal(unpackMap(undefined), null);
const many = { ...mv, frames: Array.from({ length: 50 }, (_, i) => ({ at: i, o: "0x4", c: [] })) };
assert.equal(packMap(many).f.length, RECORD_FRAMES_CAP);

// The frame shown at a position: the newest at or before it, else the first.
assert.equal(frameAt(mv, 0).at, 9);
assert.equal(frameAt(mv, 50).at, 9);
assert.equal(frameAt(mv, 104).at, 104);
assert.equal(frameAt(mv, 500).at, 104);

// Holders count land and settlements, most land first; independents are not a civilization.
assert.deepEqual(holders({ w: 3, h: 2 }, { at: 0, o: "0x1.4x3.-2x2", c: [[0, 0], [1, 4], [2, 4]] }),
  [{ pid: 4, cells: 3, towns: 2 }, { pid: 0, cells: 1, towns: 1 }]);

// Only colors the canvas surely accepts.
assert.equal(safeColor("#a1b2c3"), "#a1b2c3");
assert.equal(safeColor("rgba(1, 2, 3, 0.5)"), "rgba(1, 2, 3, 0.5)");
assert.equal(safeColor("0xff00ff00"), null);
assert.equal(safeColor("hsl(1,2%,3%)"), null);
assert.equal(safeColor(undefined), null);

// Canvas size follows the grid.
const L = hexLayout({ w: 48, h: 30 });
assert.equal(L.cw, Math.ceil(48.5 * 18));
assert.ok(L.ch > 0 && L.ch < L.cw);

// Grid detail follows the world's size (about two tiles a cell, within bounds).
assert.deepEqual([60, 84, 106, 180, 20].map(gridWidth), [60, 84, 106, 110, 20], "one cell per tile, very large maps sampled down");

// On screen: a fixed height, unless a very wide world would pass the width cap.
const std = displaySize(hexLayout({ w: 42, h: 27 }));
const wide = displaySize(hexLayout({ w: 60, h: 20 }));
assert.equal(std.h, 21);
assert.ok(wide.w <= 40 && wide.h < 21, "a very wide world is shown shorter, not wider than the cap");

// Drawn as the game's minimap is: map row 0 is the south edge, so it is drawn at the bottom; odd
// rows sit half a hex to the right.
{
  const m = { w: 4, h: 3 };
  const L2 = hexLayout(m);
  const south = cellCenter(L2, m, 0);
  const north = cellCenter(L2, m, 8);
  assert.ok(south.y > north.y, "row 0 (south) below row 2 (north)");
  assert.ok(cellCenter(L2, m, 4).x > cellCenter(L2, m, 0).x, "odd row shifted right");
}

// Layers: unexplored cells are blank, held land is tinted over its terrain.
{
  const color = (pid) => (pid === 1 ? "#ff0000" : "");
  assert.deepEqual(cellLayers(-3, 4, color), { base: "#0d1016", tint: null }, "unexplored: blank, no tint");
  assert.equal(cellLayers(1, 6, color).tint, "#ff0000", "a holder tints its land");
  assert.notEqual(cellLayers(1, 6, color).base, cellLayers(1, 4, color).base, "the terrain still shows under the tint");
  assert.equal(cellLayers(2, 4, color).tint, null, "an unshown civilization leaves plain terrain");
  assert.ok(cellLayers(-2, 4, color).tint, "independent land is tinted grey");
  assert.equal(cellLayers(-1, 99, color).base, cellLayers(-1, 1, color).base, "unknown terrain classes draw as land");
}

console.log("history-map harness passed");
