// demographics-risings-contract.js
//
// Reads the risings the Partisans mod publishes on `globalThis.__towerPartisans` and checks every
// field. That global belongs to another mod and exists only while it is loaded, so this module
// never assumes anything about it: a missing global, a throwing call or a junk row all come back
// as "no rising". No imports, so the sampler (game scope) and the chronicle capture (also listed
// in the shell group) can both use it.

/** Most risings Demographics keeps, matching what Partisans itself keeps. */
export const RISINGS_CAP = 300;

/** The age a rising began in, as Partisans names it: an AgeType such as "AGE_EXPLORATION". */
const AGE_TYPE = /^AGE_[A-Z0-9_]{1,40}$/;
const CAUSES = new Set(["flip", "enclave", "misery"]);
const OUTCOMES = new Set(["dispersed", "time", "burned", "age"]);
const NAME_MAX = 80;
const PLOT_KEY = /^-?\d{1,5},-?\d{1,5}$/;
const TRADITION_TYPE = /^[A-Z][A-Z0-9_]{0,95}$/;

/**
 * A rising as Partisans describes it, after validation.
 * @typedef {object} RisingRow
 * @property {number} id Unique per game.
 * @property {string} at Settlement centre plot, "x,y".
 * @property {string} name Settlement name when the rising began.
 * @property {number} owner Player the people rose against.
 * @property {"flip"|"enclave"|"misery"} cause
 * @property {number} [from] flip: the civ that lost the settlement by culture.
 * @property {number} [homeland] enclave: the community's homeland civ.
 * @property {string} [policy] enclave: TraditionType of the host's treatment policy.
 * @property {number} ip Independent player that fielded the band.
 * @property {number} start Game.turn the band landed (age-local).
 * @property {number} [end] Game.turn it ended. With the outcome "age" it's the next age's turn, often below `start`.
 * @property {"dispersed"|"time"|"burned"|"age"} [outcome]
 * @property {string} [age] the AgeType the rising began in (Partisans 1.0.0 builds after 2026-10-15 send it)
 */

/** @param {*} v */
function isId(v) {
  return Number.isInteger(v) && v >= 0;
}

/**
 * @param {*} v
 * @returns {string} Trimmed, control characters removed, capped; "" when not a string.
 */
function cleanName(v) {
  if (typeof v !== "string") return "";
  let out = "";
  for (const ch of v) {
    const code = ch.charCodeAt(0);
    if (code >= 32 && code !== 127) out += ch;
  }
  return out.trim().slice(0, NAME_MAX);
}

/**
 * The civ on the other side of a rising: the old owner for a flip, the homeland for an enclave.
 * @param {RisingRow} out Mutated.
 * @param {*} raw
 */
function addOtherCiv(out, raw) {
  const key = out.cause === "flip" ? "from" : out.cause === "enclave" ? "homeland" : "";
  const pid = key ? raw[key] : undefined;
  if (isId(pid) && pid !== out.owner) out[/** @type {"from"|"homeland"} */ (key)] = pid;
  if (out.cause === "enclave" && typeof raw.policy === "string" && TRADITION_TYPE.test(raw.policy)) {
    out.policy = raw.policy;
  }
}

/**
 * Partisans' turns restart every age, and a rising the age change clears ends on the new age's first pass, so its end
 * is usually below its start. Any other end before the start is junk.
 * @param {RisingRow} out Mutated.
 * @param {*} raw
 */
function addEnd(out, raw) {
  if (!isId(raw.end) || (raw.end < out.start && raw.outcome !== "age")) return;
  out.end = raw.end;
  if (OUTCOMES.has(raw.outcome)) out.outcome = raw.outcome;
}

/**
 * @param {*} raw
 * @returns {boolean} Whether the fields every rising needs are present and well formed.
 */
function hasRequiredFields(raw) {
  if (!isId(raw.id) || !isId(raw.owner) || !isId(raw.ip) || !isId(raw.start)) return false;
  return typeof raw.at === "string" && PLOT_KEY.test(raw.at) && CAUSES.has(raw.cause);
}

/**
 * Check one row from Partisans and copy the fields Demographics uses.
 * @param {*} raw
 * @returns {RisingRow|null} The clean row, or null when a required field is missing or malformed.
 */
export function validateRising(raw) {
  if (!raw || typeof raw !== "object" || !hasRequiredFields(raw)) return null;
  const name = cleanName(raw.name);
  if (!name) return null;
  /** @type {RisingRow} */
  const out = { id: raw.id, at: raw.at, name, owner: raw.owner, cause: raw.cause, ip: raw.ip, start: raw.start };
  addOtherCiv(out, raw);
  addEnd(out, raw);
  if (typeof raw.age === "string" && AGE_TYPE.test(raw.age)) out.age = raw.age;
  return out;
}

/** @returns {*} The Partisans API object when it offers risings, else null. */
function partisansApi() {
  const api = /** @type {*} */ (globalThis).__towerPartisans;
  if (!api || typeof api !== "object") return null;
  if (!(api.apiVersion >= 1) || typeof api.risings !== "function") return null;
  return api;
}

/**
 * Every rising Partisans reports this game, oldest first, unvalidated (callers run
 * {@link validateRising} per row so they can keep the row order). Null when Partisans isn't loaded
 * or the call fails, so a caller can tell "no Partisans" from "no risings yet".
 * @returns {*[]|null}
 */
export function readPartisanRisings() {
  try {
    const api = partisansApi();
    if (!api) return null;
    const list = api.risings();
    return Array.isArray(list) ? list.slice(-RISINGS_CAP) : null;
  } catch (_) {
    // Another mod's code: anything it throws means "no risings this turn".
    return null;
  }
}
