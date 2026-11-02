// storage-pack.js
//
// The packed form of the history payload (schema 2). Everything above the storage module keeps the
// in-memory shape; `serializePayload` packs on the way to the save and `payloadFromBlob` unpacks on
// the way back. What changes on disk is only the `players` map of each sample:
//
//   roster: one entry per distinct set of the nine identity fields a player carries (leaderType,
//           civType, leaderName, civName, leaderTypeString, civTypeString, primaryColor,
//           secondaryColor, continent); a civ switch or colour change adds another entry
//   mk:     the metric keys, in the order they were first seen across the payload
//   p:      per player, { r: roster index, m: met, v: metric values by mk position, w: wonder list
//           when it changed, x: anything else on the player object }
//
// `v` holds finite numbers only (anything else goes verbatim into `x.metrics`), trailing nulls trimmed, so
// a key the player doesn't have costs nothing. `w` is written when a player first appears and
// whenever the list differs from that player's previous sample; `0` means the list went away.
// Every other field of the history and of each sample is copied as it is. A player entry or a
// `players` value that isn't an object is kept verbatim.
//
// Both functions are pure and never throw. `unpackHistory` returns null for anything that isn't the
// shape above, so the loader parks the text instead of using it.

/** The identity fields of a player, in `buildSnapshotPlayer` order, minus `met`. */
const IDENTITY = [
  "leaderType",
  "civType",
  "leaderName",
  "civName",
  "leaderTypeString",
  "civTypeString",
  "primaryColor",
  "secondaryColor",
  "continent"
];
const OWN_KEYS = new Set([...IDENTITY, "met", "metrics", "wonderTypes"]);
const PACKED_ONLY = new Set(["roster", "mk", "samples"]);

/** @param {*} v */
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * @typedef {object} PackCtx
 * @property {object[]} roster
 * @property {Map<string, number>} rosterIndex
 * @property {string[]} mk
 * @property {Map<string, number>} mkIndex
 * @property {Map<string, string | null>} lastWonders Previous wonder list per pid as JSON, null when absent.
 */

/** @returns {PackCtx} */
function newPackCtx() {
  return { roster: [], rosterIndex: new Map(), mk: [], mkIndex: new Map(), lastWonders: new Map() };
}

/**
 * Pack a history into the on-disk schema 2 shape.
 * @param {*} history A history in the in-memory shape.
 * @returns {object} The `data` object of the envelope, with `version: 2`.
 */
export function packHistory(history) {
  try {
    return packUnsafe(history);
  } catch (_) {
    return { version: 2, roster: [], mk: [], samples: [] };
  }
}

/** @param {*} history */
function packUnsafe(history) {
  if (!isObject(history)) return { version: 2, roster: [], mk: [], samples: [] };
  const ctx = newPackCtx();
  /** @type {Record<string, *>} */
  const out = {};
  for (const key of Object.keys(history)) {
    if (PACKED_ONLY.has(key)) continue;
    out[key] = key === "version" ? 2 : history[key];
  }
  out.version = 2;
  out.roster = ctx.roster;
  out.mk = ctx.mk;
  out.samples = Array.isArray(history.samples)
    ? history.samples.map((/** @type {*} */ sample) => packSample(ctx, sample))
    : history.samples;
  return out;
}

/**
 * @param {PackCtx} ctx
 * @param {*} sample
 */
function packSample(ctx, sample) {
  if (!isObject(sample) || !isObject(sample.players)) return sample;
  /** @type {Record<string, *>} */
  const packed = {};
  for (const key of Object.keys(sample)) {
    if (key !== "players") {
      packed[key] = sample[key];
      continue;
    }
    /** @type {Record<string, *>} */
    const p = {};
    for (const pid of Object.keys(sample.players)) p[pid] = packPlayer(ctx, pid, sample.players[pid]);
    packed.p = p;
  }
  return packed;
}

/**
 * @param {PackCtx} ctx
 * @param {string} pid
 * @param {*} pl
 */
function packPlayer(ctx, pid, pl) {
  if (!isObject(pl)) return pl;
  /** @type {Record<string, *>} */
  const entry = { r: rosterIndexOf(ctx, pl) };
  if (pl.met !== undefined) entry.m = pl.met;
  /** @type {Record<string, *>} */
  const extra = {};
  if (isObject(pl.metrics)) entry.v = packMetrics(ctx, pl.metrics, extra);
  else if (pl.metrics !== undefined) extra.metrics = pl.metrics;
  const w = packWonders(ctx, pid, pl.wonderTypes);
  if (w !== undefined) entry.w = w;
  for (const key of Object.keys(pl)) {
    if (!OWN_KEYS.has(key) && pl[key] !== undefined) extra[key] = pl[key];
  }
  if (Object.keys(extra).length) entry.x = extra;
  return entry;
}

/**
 * @param {PackCtx} ctx
 * @param {Record<string, *>} pl
 */
function rosterIndexOf(ctx, pl) {
  /** @type {Record<string, *>} */
  const ident = {};
  for (const f of IDENTITY) if (pl[f] !== undefined) ident[f] = pl[f];
  const key = JSON.stringify(ident);
  let r = ctx.rosterIndex.get(key);
  if (r === undefined) {
    r = ctx.roster.length;
    ctx.roster.push(ident);
    ctx.rosterIndex.set(key, r);
  }
  return r;
}

/**
 * Numbers into `v` by dictionary position; anything else into `extra.metrics`.
 * @param {PackCtx} ctx
 * @param {Record<string, *>} metrics
 * @param {Record<string, *>} extra
 */
function packMetrics(ctx, metrics, extra) {
  /** @type {(number | null)[]} */
  const v = [];
  for (const name of Object.keys(metrics)) {
    const value = metrics[name];
    if (value === undefined) continue;
    // Finite numbers only: a NaN or Infinity rides in `x.metrics`, where JSON turns it into null,
    // exactly what the unpacked schema 1 payload held for it.
    if (typeof value !== "number" || !Number.isFinite(value)) {
      (extra.metrics || (extra.metrics = {}))[name] = value;
      continue;
    }
    let i = ctx.mkIndex.get(name);
    if (i === undefined) {
      i = ctx.mk.length;
      ctx.mk.push(name);
      ctx.mkIndex.set(name, i);
    }
    while (v.length < i) v.push(null);
    v[i] = value;
  }
  while (v.length && v[v.length - 1] === null) v.pop();
  return v;
}

/**
 * The `w` field: the list when it differs from this pid's previous sample (or on first appearance),
 * `0` when it went away, undefined when unchanged.
 * @param {PackCtx} ctx
 * @param {string} pid
 * @param {*} wonders
 */
function packWonders(ctx, pid, wonders) {
  const key = Array.isArray(wonders) ? JSON.stringify(wonders) : null;
  const previous = ctx.lastWonders.get(pid);
  ctx.lastWonders.set(pid, key);
  if (previous !== undefined && previous === key) return undefined;
  return Array.isArray(wonders) ? wonders : 0;
}

/**
 * Unpack a schema 2 payload back into the in-memory history shape.
 * @param {*} packed The `data` object read from the save.
 * @returns {object | null} The history, or null when `packed` isn't the packed shape.
 */
export function unpackHistory(packed) {
  try {
    return unpackUnsafe(packed);
  } catch (_) {
    return null;
  }
}

/**
 * @typedef {object} UnpackCtx
 * @property {object[]} roster
 * @property {string[]} mk
 * @property {Map<string, string[] | null>} lastWonders
 */

/**
 * Whether `packed` has the top-level shape of a schema 2 payload.
 * @param {*} packed
 */
function isPackedShape(packed) {
  if (!isObject(packed) || packed.version !== 2) return false;
  const { roster, mk, samples } = packed;
  if (!Array.isArray(roster) || !Array.isArray(mk) || !Array.isArray(samples)) return false;
  return roster.every(isObject) && mk.every((name) => typeof name === "string");
}

/** @param {*} packed */
function unpackUnsafe(packed) {
  if (!isPackedShape(packed)) return null;
  const { roster, mk, samples } = packed;
  /** @type {UnpackCtx} */
  const ctx = { roster, mk, lastWonders: new Map() };
  /** @type {Record<string, *>} */
  const history = {};
  for (const key of Object.keys(packed)) {
    if (!PACKED_ONLY.has(key)) history[key] = packed[key];
  }
  const out = [];
  for (const sample of samples) {
    const unpacked = unpackSample(ctx, sample);
    if (unpacked === INVALID) return null;
    out.push(unpacked);
  }
  history.samples = out;
  return history;
}

/** Sentinel for a sample or player that isn't the packed shape. */
const INVALID = Symbol("invalid");

/**
 * @param {UnpackCtx} ctx
 * @param {*} sample
 */
function unpackSample(ctx, sample) {
  if (!isObject(sample) || !("p" in sample)) return sample;
  /** @type {Record<string, *>} */
  const unpacked = {};
  for (const key of Object.keys(sample)) {
    if (key !== "p") {
      unpacked[key] = sample[key];
    } else if (!isObject(sample.p)) {
      unpacked.players = sample.p;
    } else {
      const players = unpackPlayers(ctx, sample.p);
      if (players === INVALID) return INVALID;
      unpacked.players = players;
    }
  }
  return unpacked;
}

/**
 * @param {UnpackCtx} ctx
 * @param {Record<string, *>} p
 */
function unpackPlayers(ctx, p) {
  /** @type {Record<string, *>} */
  const players = {};
  for (const pid of Object.keys(p)) {
    const player = unpackPlayer(ctx, pid, p[pid]);
    if (player === INVALID) return INVALID;
    players[pid] = player;
  }
  return players;
}

/**
 * Rebuild one player object in `buildSnapshotPlayer` field order, then the `x` keys.
 * @param {UnpackCtx} ctx
 * @param {string} pid
 * @param {*} entry
 */
function unpackPlayer(ctx, pid, entry) {
  if (!isObject(entry)) return entry;
  const ident = rosterEntry(ctx, entry.r);
  if (!ident) return INVALID;
  const extra = isObject(entry.x) ? entry.x : {};
  const player = identityFields(ident, entry.m);
  const metrics = unpackMetrics(ctx, entry.v, extra.metrics);
  if (metrics === INVALID) return INVALID;
  if (metrics !== undefined) player.metrics = metrics;
  const wonders = unpackWonders(ctx, pid, entry.w);
  if (wonders) player.wonderTypes = wonders;
  for (const key of Object.keys(extra)) {
    if (key !== "metrics") player[key] = extra[key];
  }
  return player;
}

/**
 * @param {UnpackCtx} ctx
 * @param {*} r The `r` field.
 * @returns {Record<string, *> | null} The roster entry, or null when `r` isn't a valid index.
 */
function rosterEntry(ctx, r) {
  if (!Number.isInteger(r) || r < 0 || r >= ctx.roster.length) return null;
  return /** @type {Record<string, *>} */ (ctx.roster[r]);
}

/**
 * The identity fields in `buildSnapshotPlayer` order, `met` between the colours and the continent.
 * @param {Record<string, *>} ident A roster entry.
 * @param {*} met The `m` field, undefined when absent.
 */
function identityFields(ident, met) {
  /** @type {Record<string, *>} */
  const player = {};
  for (const f of IDENTITY) {
    if (f === "continent" && met !== undefined) player.met = met;
    if (ident[f] !== undefined) player[f] = ident[f];
  }
  return player;
}

/**
 * @param {UnpackCtx} ctx
 * @param {*} v
 * @param {*} extraMetrics
 */
function unpackMetrics(ctx, v, extraMetrics) {
  if (v === undefined) return extraMetrics;
  if (!Array.isArray(v) || v.length > ctx.mk.length) return INVALID;
  /** @type {Record<string, *>} */
  const metrics = {};
  v.forEach((value, i) => {
    if (value !== null && value !== undefined) metrics[ctx.mk[i]] = value;
  });
  if (isObject(extraMetrics)) Object.assign(metrics, extraMetrics);
  return metrics;
}

/**
 * @param {UnpackCtx} ctx
 * @param {string} pid
 * @param {*} w
 * @returns {string[] | null} The list this sample carries, or null when the player has none.
 */
function unpackWonders(ctx, pid, w) {
  if (w !== undefined) {
    const wonders = Array.isArray(w) ? w : null;
    ctx.lastWonders.set(pid, wonders);
    return wonders;
  }
  const previous = ctx.lastWonders.get(pid);
  return previous ? previous.slice() : null;
}
