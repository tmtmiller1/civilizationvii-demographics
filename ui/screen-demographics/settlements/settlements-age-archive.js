// settlements-age-archive.js
//
// End-of-age settlement standings. Every sample overwrites the CURRENT age's
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
 * @param {*} o The live owner identity.
 * @returns {*} The frozen owner.
 */
function compactOwner(o) {
  return {
    pid: o.pid,
    leaderName: o.leaderName,
    civName: o.civName,
    leaderType: o.leaderType,
    primary: o.primary,
    secondary: o.secondary,
    readable: o.readable,
    isMajor: o.isMajor
  };
}

/**
 * A compact, serializable copy of one ranked settlement.
 * @param {*} s The live settlement record.
 * @returns {*} The archive record.
 */
function compactSettlement(s) {
  return {
    name: s.name,
    isTown: !!s.isTown,
    isCapital: !!s.isCapital,
    composite: Math.round(s.composite * 10) / 10,
    populationEstimate: Math.round(s.populationEstimate || 0),
    outputs: s.outputs,
    ranks: s.ranks,
    wonders: (Array.isArray(s.wonders) ? s.wonders : []).map((/** @type {*} */ w) => ({
      type: w.type,
      icon: w.icon,
      nameKey: w.nameKey
    })),
    holy: s.holy || null,
    owner: compactOwner(s.owner || {})
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

/**
 * The display name of an age type ("Antiquity Age"), or the raw type.
 * @param {string} age The age type.
 * @returns {string} The display name.
 */
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
 * @param {*} r The archive record.
 * @returns {*} The display settlement.
 */
function rehydrate(r) {
  const owner = Object.assign({}, r.owner, { met: localHasMet(r.owner && r.owner.pid) });
  return Object.assign({}, r, {
    owner,
    archived: true,
    location: null,
    explored: true,
    outputs: r.outputs && typeof r.outputs === "object" ? r.outputs : {},
    ranks: r.ranks && typeof r.ranks === "object" ? r.ranks : {},
    wonders: Array.isArray(r.wonders) ? r.wonders : []
  });
}

/**
 * Whether an archive entry holds at least one recorded settlement (a null/junk
 * entry in `top` does not count).
 * @param {*} e The archive entry.
 * @returns {boolean} True when it has standings.
 */
function hasStandings(e) {
  return !!e && Array.isArray(e.top) && e.top.some((/** @type {*} */ r) => !!r && typeof r === "object");
}

/**
 * The renderable records of an archive entry: null/junk entries dropped, the
 * rest rehydrated.
 * @param {*} e The archive entry (has standings).
 * @returns {Array<*>} The display settlements.
 */
function entryTop(e) {
  return e.top.filter((/** @type {*} */ r) => !!r && typeof r === "object").map(rehydrate);
}

/**
 * Every FINISHED age's archived standings, oldest first (the current age is
 * excluded: its entry is still live, not final).
 * @param {*} history The sampled history blob.
 * @returns {Array<{ age: string, label: string, year: string, top: Array<*> }>} The archived ages.
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
    const e = ages[age];
    if (age !== current && hasStandings(e)) {
      out.push({ age, label: ageName(age), year: e.year || "", top: entryTop(e) });
    }
  }
  return out;
}
