// history-map.js
//
// The territory map of a game: a low-detail hex
// grid of the world with water, land and mountains, and frames of who owned each cell and where the
// settlements stood. Pure: run-length encoding, frame thinning, placing frames on the timeline axis
// and the compact archive form. Capture lives in capture/history-mapgrid.js, painting in
// views/history-map-view.js.

import { ageSpans, positionOf } from "/demographics/ui/history/model/history-timeline.js";

/** Frames kept in a campaign document. */
export const DOC_FRAMES_CAP = 40;
/** Frames kept in an archived record. */
export const RECORD_FRAMES_CAP = 12;
/** Byte budgets for the frames: in the saved campaign, and in one archived record. */
export const DOC_MAP_BYTES = 120 * 1024;
export const RECORD_MAP_BYTES = 14 * 1024;

/**
 * @typedef {Object} MapView
 * @property {number} w Cells across.
 * @property {number} h Cells down.
 * @property {string} terrain Run-length terrain (0 water, 1 land, 2 mountain).
 * @property {{at:number, o:string, c:number[][]}[]} frames Owner grids (run-length, -1 for none) and
 *   [cell, owner] settlements, placed on the timeline axis, oldest first.
 */

/**
 * Run-length encode a list of small integers ("v x count" runs joined by ".").
 * @param {number[]} arr
 * @returns {string}
 */
export function rle(arr) {
  if (!arr.length) return "";
  const out = [];
  let value = arr[0];
  let count = 1;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] === value) count++;
    else {
      out.push(value + "x" + count);
      value = arr[i];
      count = 1;
    }
  }
  out.push(value + "x" + count);
  return out.join(".");
}

/**
 * Decode a run-length list to exactly `len` values (missing cells are `fill`).
 * @param {string} str
 * @param {number} len
 * @param {number} [fill] Value for cells the encoding does not cover.
 * @returns {number[]}
 */
export function unrle(str, len, fill = -1) {
  const out = new Array(Math.max(0, len)).fill(fill);
  let i = 0;
  for (const run of String(str || "").split(".")) {
    const sep = run.indexOf("x");
    if (sep < 1) continue;
    const value = Number(run.slice(0, sep));
    const count = Number(run.slice(sep + 1));
    if (!Number.isFinite(value) || !Number.isFinite(count)) continue;
    for (let k = 0; k < count && i < len; k++) out[i++] = value;
  }
  return out;
}

/**
 * Thin a frame list to `cap`, always keeping the first and the newest, and spacing the rest evenly.
 * @template T
 * @param {T[]} frames Frames, oldest first.
 * @param {number} cap Frames to keep (at least 2).
 * @returns {T[]} Kept frames.
 */
export function thinFrames(frames, cap) {
  if (frames.length <= cap) return frames.slice();
  const out = [];
  for (let i = 0; i < cap; i++) out.push(frames[Math.round((i * (frames.length - 1)) / (cap - 1))]);
  return out;
}

/**
 * Add a frame to a campaign's map, skipping one identical to the newest and thinning past the cap.
 * @param {HistoryMapGrid} map Mutated.
 * @param {HistoryMapFrame} frame
 * @returns {boolean} True when the frame was kept.
 */
export function addFrame(map, frame) {
  const last = map.frames[map.frames.length - 1];
  if (last && last.a === frame.a && last.t === frame.t) map.frames.pop();
  else if (last && last.o === frame.o && JSON.stringify(last.c) === JSON.stringify(frame.c)) return false;
  map.frames.push(frame);
  if (map.frames.length > DOC_FRAMES_CAP) map.frames = thinFrames(map.frames, DOC_FRAMES_CAP);
  map.frames = withinBytes(map.frames, DOC_MAP_BYTES, (f) => f.o.length + JSON.stringify(f.c).length);
  return true;
}

/**
 * Thin frames (keeping the first and the newest) until they fit a byte budget. A crowded, ragged
 * map compresses poorly, so the frame count, not only the cap, has to give.
 * @template T
 * @param {T[]} frames Frames, oldest first.
 * @param {number} budget In bytes.
 * @param {(f: T) => number} bytes Size of one frame.
 * @returns {T[]} Frames that fit (at least the newest).
 */
export function withinBytes(frames, budget, bytes) {
  let out = frames;
  const total = (/** @type {T[]} */ list) => list.reduce((n, f) => n + bytes(f), 0);
  while (out.length > 2 && total(out) > budget) out = thinFrames(out, Math.max(2, Math.floor(out.length * 0.75)));
  if (total(out) > budget) out = out.slice(-1);
  return out;
}

/**
 * A campaign's map with its frames placed on the timeline axis.
 * @param {CampaignDoc} doc
 * @returns {MapView|null} null when none was captured.
 */
export function mapView(doc) {
  const map = doc.map;
  if (!map || !map.w || !map.h || !map.frames?.length) return null;
  const spans = ageSpans(doc.ages);
  return {
    w: map.w,
    h: map.h,
    terrain: map.terrain,
    frames: map.frames.map((f) => ({ at: positionOf(spans, doc.ages, f.a, f.t), o: f.o, c: f.c }))
  };
}

/**
 * Compact archive form of a map.
 * @param {MapView|null} mapView
 * @returns {*} Packed map, or undefined.
 */
export function packMap(mapView) {
  if (!mapView) return undefined;
  const size = (/** @type {MapView["frames"][number]} */ f) => f.o.length + JSON.stringify(f.c).length;
  const kept = withinBytes(thinFrames(mapView.frames, RECORD_FRAMES_CAP), RECORD_MAP_BYTES, size);
  return { w: mapView.w, h: mapView.h, r: mapView.terrain, f: kept.map((f) => [f.at, f.o, f.c]) };
}

/**
 * Unpack an archived map (tolerating a missing or partial one).
 * @param {*} packed Packed map.
 * @returns {MapView|null}
 */
export function unpackMap(packed) {
  if (!packed || typeof packed !== "object" || !(packed.w > 0) || !(packed.h > 0)) return null;
  if (!Array.isArray(packed.f) || !packed.f.length) return null;
  return {
    w: Number(packed.w),
    h: Number(packed.h),
    terrain: String(packed.r || ""),
    frames: packed.f.map((/** @type {*[]} */ row) => ({
      at: Number(row[0]) || 0,
      o: String(row[1] || ""),
      c: Array.isArray(row[2]) ? row[2] : []
    }))
  };
}

/**
 * The frame to show at a timeline position: the newest at or before it, else the first.
 * @param {MapView} mapView
 * @param {number} at
 * @returns {MapView["frames"][number]}
 */
export function frameAt(mapView, at) {
  let pick = mapView.frames[0];
  for (const frame of mapView.frames) {
    if (frame.at > at) break;
    pick = frame;
  }
  return pick;
}
