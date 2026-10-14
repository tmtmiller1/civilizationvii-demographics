// settlements-age-archive.js
//
// End-of-age settlement standings. Every sample overwrites the current age's
// entry with the board's top settlements, so once an age ends its entry holds
// the last standings recorded in that age (no age-transition hook needed).
// Stored on the sampled history blob (`history.settleAges`) so it survives
// quit/load and the age transition; records freeze the owner identity at
// recording time and re-read the met state at render.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import {
  buildSettlementBoard,
  currentAgeType
} from "/demographics/ui/screen-demographics/settlements/settlements-data.js";
import { localHasMet } from "/demographics/ui/screen-demographics/settlements/settlements-met.js";

/** Settlements archived per age. */
export const ARCHIVE_TOP = 10;

/**
 * One archived age: when it was recorded and its top settlements.
 * @typedef {{ turn: number, year: string, top: Array<*> }} AgeEntry
 */

/**
 * The owner identity fields worth freezing (no live-only `met`).
 * @param {*} owner The live owner identity.
 * @returns {*}
 */
function compactOwner(owner) {
  return {
    pid: owner.pid,
    leaderName: owner.leaderName,
    civName: owner.civName,
    leaderType: owner.leaderType,
    primary: owner.primary,
    secondary: owner.secondary,
    readable: owner.readable,
    isMajor: owner.isMajor
  };
}

/**
 * @param {*} settlement
 * @returns {*}
 */
function compactSettlement(settlement) {
  return {
    name: settlement.name,
    isTown: !!settlement.isTown,
    isCapital: !!settlement.isCapital,
    composite: Math.round(settlement.composite * 10) / 10,
    populationEstimate: Math.round(settlement.populationEstimate || 0),
    outputs: settlement.outputs,
    ranks: settlement.ranks,
    wonders: (Array.isArray(settlement.wonders) ? settlement.wonders : []).map((/** @type {*} */ wonder) => ({
      type: wonder.type,
      icon: wonder.icon,
      nameKey: wonder.nameKey
    })),
    holy: settlement.holy || null,
    owner: compactOwner(settlement.owner || {})
  };
}

/**
 * Overwrite the current age's archive entry on the in-progress history with this
 * sample's top settlements (the caller's single per-turn save persists it).
 * @param {*} history The sampled history blob (mutated: `settleAges`).
 * @param {number} turn The sample turn.
 * @param {string} [year] The sample's game-year string.
 * @returns {boolean} True when an entry was recorded.
 */
export function recordSettlementAge(history, turn, year) {
  const age = currentAgeType();
  if (!history || typeof history !== "object" || !age) return false;
  // Lite board: the drill-down-only reads (building names, wonder in progress)
  // are skipped since no archived field (compactSettlement) uses them, so the
  // per-turn sampler cost is the scored board, not the full render-time one.
  const top = buildSettlementBoard({ lite: true }).settlements.slice(0, ARCHIVE_TOP);
  if (!top.length) return false;
  if (!history.settleAges || typeof history.settleAges !== "object") history.settleAges = {};
  history.settleAges[age] = { turn, year: year || "", top: top.map(compactSettlement) };
  return true;
}

/** @param {string} age */
function ageName(age) {
  try {
    const row = typeof GameInfo !== "undefined" ? GameInfo.Ages.lookup(age) : null;
    if (row && row.Name) return t(row.Name);
  } catch (_) {
    // GameInfo.Ages.lookup can be absent or throw; fall back to the type.
  }
  return age;
}

/**
 * Rehydrate an archive record for the showcase builders: re-read the met state,
 * mark it archived (no live handle, so no camera), and default every field the
 * showcase dereferences so an incomplete record still renders.
 * @param {*} record The archive record.
 * @returns {*}
 */
function rehydrate(record) {
  const owner = Object.assign({}, record.owner, { met: localHasMet(record.owner && record.owner.pid) });
  return Object.assign({}, record, {
    owner,
    archived: true,
    location: null,
    explored: true,
    outputs: record.outputs && typeof record.outputs === "object" ? record.outputs : {},
    ranks: record.ranks && typeof record.ranks === "object" ? record.ranks : {},
    wonders: Array.isArray(record.wonders) ? record.wonders : []
  });
}

/** @param {*} record */
function isRecord(record) {
  return !!record && typeof record === "object";
}

/** @param {*} entry */
function hasStandings(entry) {
  return !!entry && Array.isArray(entry.top) && entry.top.some(isRecord);
}

/** @param {*} entry The archive entry (has standings). */
function entryTop(entry) {
  return entry.top.filter(isRecord).map(rehydrate);
}

/**
 * Every finished age's archived standings, oldest first (the current age is
 * excluded: its entry is still live, not final).
 * @param {*} history The sampled history blob.
 * @returns {Array<{ age: string, label: string, year: string, top: Array<*> }>}
 */
export function readAgeArchive(history) {
  const ages = history && history.settleAges;
  if (!ages || typeof ages !== "object") return [];
  const current = currentAgeType();
  // Without the current age every entry (including the live one) would read as final.
  if (!current) return [];
  /** @type {Array<{ age: string, label: string, year: string, top: Array<*> }>} */
  const out = [];
  for (const age of Object.keys(ages)) {
    const entry = ages[age];
    if (age !== current && hasStandings(entry)) {
      out.push({ age, label: ageName(age), year: entry.year || "", top: entryTop(entry) });
    }
  }
  return out;
}
