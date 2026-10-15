// chart-risings-data.js
//
// Turns the saved Partisans risings (`history.risings`, see sampler-risings.js) into Conflicts
// timeline rows. A rising isn't a war between two major civs, so it never enters the war merge or
// the war filter; it gets its own row kind (`isRising: true`) that the layout, the bar drawing, the
// labels and the tooltip each recognize. The spoiler guard is the one wars use: a rising shows
// when a war involving its owner would, and the local player's own risings always show.

import { t, tPlayerFallback } from "/demographics/ui/core/demographics-i18n.js";
import { isLocalCiv } from "/demographics/ui/core/demographics-governance.js";
import { makeRisingText } from "/demographics/ui/core/demographics-risings-text.js";
import { civDroppedByPolicy } from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";
import { civAdjective } from "/demographics/ui/screen-demographics/charts/wars/chart-wars-naming.js";

/**
 * One rising row on the timeline. `startTurn` / `endTurn` are chart turns, like a remapped war's;
 * `endTurn` is null while the rising is running.
 * @typedef {object} RisingRow
 * @property {true} isRising
 * @property {*} rising The saved record.
 * @property {number} startTurn
 * @property {number|null} endTurn
 * @property {string|undefined} startYear
 * @property {string|undefined} endYear
 * @property {string} title Display name.
 * @property {string} owner Owner civ name.
 * @property {string} cause Cause line.
 * @property {string} outcome Outcome line ("" when the outcome is unknown).
 */

const TEXT = makeRisingText(t);

/** @param {*} rec */
function isRisingRecord(rec) {
  return !!rec && typeof rec === "object" && Number.isInteger(rec.id) && Number.isInteger(rec.owner) &&
    typeof rec.name === "string" && typeof rec.cause === "string";
}

/**
 * @param {Snapshot[]} samples
 * @param {*} pid
 * @returns {boolean} Whether the spoiler guard lets the local player see this civ.
 */
function civShown(samples, pid) {
  if (typeof pid !== "number") return false;
  return isLocalCiv(pid) || !civDroppedByPolicy(samples, pid);
}

/** @param {*} rec */
function otherPid(rec) {
  if (typeof rec.from === "number") return rec.from;
  return typeof rec.homeland === "number" ? rec.homeland : null;
}

/**
 * The saved risings the local player may see.
 * @param {*} risings `history.risings` (anything).
 * @param {Snapshot[]} samples Carries the met flags.
 * @returns {*[]}
 */
export function policyVisibleRisings(risings, samples) {
  if (!Array.isArray(risings)) return [];
  return risings.filter((rec) => isRisingRecord(rec) && civShown(samples, rec.owner));
}

/**
 * @param {string} type A TraditionType.
 * @returns {string} The card's Name tag from the live game data, or "" when this age lacks it.
 */
function liveTraditionName(type) {
  try {
    const row = typeof GameInfo !== "undefined" ? GameInfo.Traditions?.lookup(type) : null;
    return row && typeof row.Name === "string" ? row.Name : "";
  } catch (_) {
    // GameInfo.Traditions holds only the current age's cards; the saved tag covers older ones.
    return "";
  }
}

/**
 * @param {*} rec
 * @returns {string} The localized name of the host's policy card, or "".
 */
function policyLabel(rec) {
  if (typeof rec.policy !== "string" || !rec.policy) return "";
  const tag = liveTraditionName(rec.policy) || (typeof rec.policyName === "string" ? rec.policyName : "");
  const text = tag ? t(tag) : "";
  return text && !text.startsWith("LOC_") ? text : "";
}

/**
 * Localized names for one rising, with the other civ blanked when the spoiler guard hides it.
 * @param {*} rec
 * @param {Snapshot[]} samples
 * @returns {import("/demographics/ui/core/demographics-risings-text.js").RisingNames}
 */
export function risingNames(rec, samples) {
  const other = otherPid(rec);
  const shown = other !== null && civShown(samples, other);
  const otherCiv = shown ? rec.otherCiv || {} : {};
  const otherName = shown ? otherCiv.civ || tPlayerFallback(other) : "";
  return {
    place: rec.name,
    owner: (rec.ownerCiv && rec.ownerCiv.civ) || tPlayerFallback(rec.owner),
    other: otherName,
    otherAdjective: shown ? civAdjective({ civ: otherName, civTypeString: otherCiv.civTypeString }) : "",
    policy: policyLabel(rec)
  };
}

/** @param {*} v */
const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);

/**
 * Where a rising's bar ends. A rising saved as running whose last sighting is older than the latest
 * sample was last seen while Partisans was loaded; it is drawn up to that sighting.
 * @param {*} rec
 * @param {number} start
 * @param {number} latestTurn
 * @returns {{ end: number|null, ended: boolean }}
 */
function risingEnd(rec, start, latestTurn) {
  const last = num(rec.lastChartTurn);
  if (typeof rec.end === "number") {
    const end = num(rec.endChartTurn) ?? last ?? start;
    return { end: Math.max(start, end), ended: true };
  }
  if (last !== null && isFinite(latestTurn) && last < latestTurn) return { end: Math.max(start, last), ended: true };
  return { end: null, ended: false };
}

/**
 * @param {*} rec
 * @param {Snapshot[]} samples
 * @param {Map<string, number>} yearToChart game-year → chart turn (for records saved without one).
 * @param {number} latestTurn
 * @returns {RisingRow|null} Null when the rising can't be placed on the axis.
 */
function toRisingRow(rec, samples, yearToChart, latestTurn) {
  const fromYear = rec.startYear && yearToChart.has(rec.startYear) ? yearToChart.get(rec.startYear) : null;
  const start = num(rec.startChartTurn) ?? num(fromYear);
  if (start === null) return null;
  const { end, ended } = risingEnd(rec, start, latestTurn);
  const names = risingNames(rec, samples);
  const facts = { cause: rec.cause, ended, outcome: typeof rec.end === "number" ? rec.outcome : undefined };
  return {
    isRising: true,
    rising: rec,
    startTurn: start,
    endTurn: end,
    startYear: rec.startYear,
    endYear: typeof rec.end === "number" ? rec.endYear : undefined,
    title: TEXT.title(facts, names),
    owner: names.owner,
    cause: TEXT.cause(facts, names),
    outcome: TEXT.outcome(facts, names)
  };
}

/**
 * The timeline rows for the risings the local player may see, filtered like the wars.
 * @param {*} history The history blob.
 * @param {{ samples: Snapshot[], yearToChart: Map<string, number>, latestTurn: number,
 *   filterPid: number|null, activeOnly: boolean }} opts
 * @returns {RisingRow[]} Sorted by start turn.
 */
export function buildRisingRows(history, opts) {
  const visible = policyVisibleRisings(history && history.risings, opts.samples);
  /** @type {RisingRow[]} */
  const rows = [];
  for (const rec of visible) {
    if (opts.filterPid !== null && rec.owner !== Number(opts.filterPid)) continue;
    const row = toRisingRow(rec, opts.samples, opts.yearToChart, opts.latestTurn);
    if (!row || (opts.activeOnly && row.endTurn !== null)) continue;
    rows.push(row);
  }
  return rows.sort((a, b) => a.startTurn - b.startTurn || a.rising.id - b.rising.id);
}

/**
 * Interleave wars and risings by start turn. Both lists arrive sorted; on a tie the war goes first.
 * @param {*[]} wars
 * @param {RisingRow[]} risings
 * @returns {*[]}
 */
export function interleaveTimelineRows(wars, risings) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < wars.length || j < risings.length) {
    const takeWar = j >= risings.length || (i < wars.length && (wars[i].startTurn || 0) <= risings[j].startTurn);
    out.push(takeWar ? wars[i++] : risings[j++]);
  }
  return out;
}

/**
 * The owners of visible risings as civ-filter options, in the shape collectWarCivOptions uses.
 * @param {*} history
 * @param {Snapshot[]} samples
 * @returns {{ pid: number, isCS: boolean, label: string }[]}
 */
export function collectRisingCivOptions(history, samples) {
  /** @type {Map<number, { pid: number, isCS: boolean, label: string }>} */
  const seen = new Map();
  for (const rec of policyVisibleRisings(history && history.risings, samples)) {
    if (seen.has(rec.owner)) continue;
    const civ = (rec.ownerCiv && rec.ownerCiv.civ) || tPlayerFallback(rec.owner);
    const leader = rec.ownerCiv && rec.ownerCiv.leader;
    seen.set(rec.owner, { pid: rec.owner, isCS: false, label: leader ? leader + ", " + civ : civ });
  }
  return Array.from(seen.values());
}
