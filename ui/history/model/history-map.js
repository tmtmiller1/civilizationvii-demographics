// history-map.js
//
// The territory map of a game (after History & Rankings 1.x's Historical Map): a low-detail hex
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
 * @param {number[]} arr Values.
 * @returns {string} Encoded.
 */
export function rle(arr) {
  if (!arr.length) return "";
  const out = [];
  let v = arr[0];
  let c = 1;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] === v) c++;
    else {
      out.push(v + "x" + c);
      v = arr[i];
      c = 1;
    }
  }
  out.push(v + "x" + c);
  return out.join(".");
}

/**
 * Decode a run-length list to exactly `len` values (missing cells are `fill`).
 * @param {string} str Encoded.
 * @param {number} len Length.
 * @param {number} [fill] Value for cells the encoding does not cover.
 * @returns {number[]} Values.
 */
export function unrle(str, len, fill = -1) {
  const out = new Array(Math.max(0, len)).fill(fill);
  let i = 0;
  for (const run of String(str || "").split(".")) {
    const x = run.indexOf("x");
    if (x < 1) continue;
    const v = Number(run.slice(0, x));
    const c = Number(run.slice(x + 1));
    if (!Number.isFinite(v) || !Number.isFinite(c)) continue;
    for (let k = 0; k < c && i < len; k++) out[i++] = v;
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
 * @param {HnrMapGrid} map The map (mutated).
 * @param {HnrMapFrame} frame The frame.
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
 * @param {number} budget Bytes.
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
 * @param {CampaignDoc} doc Campaign.
 * @returns {MapView|null} The map, or null when none was captured.
 */
export function mapView(doc) {
  const m = doc.map;
  if (!m || !m.w || !m.h || !m.frames?.length) return null;
  const spans = ageSpans(doc.ages);
  return {
    w: m.w,
    h: m.h,
    terrain: m.terrain,
    frames: m.frames.map((f) => ({ at: positionOf(spans, doc.ages, f.a, f.t), o: f.o, c: f.c }))
  };
}

/**
 * Compact archive form of a map.
 * @param {MapView|null} mv Map.
 * @returns {*} Packed map, or undefined.
 */
export function packMap(mv) {
  if (!mv) return undefined;
  const size = (/** @type {MapView["frames"][number]} */ f) => f.o.length + JSON.stringify(f.c).length;
  const kept = withinBytes(thinFrames(mv.frames, RECORD_FRAMES_CAP), RECORD_MAP_BYTES, size);
  return { w: mv.w, h: mv.h, r: mv.terrain, f: kept.map((f) => [f.at, f.o, f.c]) };
}

/**
 * Unpack an archived map (tolerating a missing or partial one).
 * @param {*} p Packed map.
 * @returns {MapView|null} Map.
 */
export function unpackMap(p) {
  if (!p || typeof p !== "object" || !(p.w > 0) || !(p.h > 0) || !Array.isArray(p.f) || !p.f.length) return null;
  return {
    w: Number(p.w),
    h: Number(p.h),
    terrain: String(p.r || ""),
    frames: p.f.map((/** @type {*[]} */ f) => ({ at: Number(f[0]) || 0, o: String(f[1] || ""), c: Array.isArray(f[2]) ? f[2] : [] }))
  };
}

/**
 * The frame to show at a timeline position: the newest at or before it, else the first.
 * @param {MapView} mv Map.
 * @param {number} at Position.
 * @returns {MapView["frames"][number]} Frame.
 */
export function frameAt(mv, at) {
  let pick = mv.frames[0];
  for (const f of mv.frames) {
    if (f.at > at) break;
    pick = f;
  }
  return pick;
}
