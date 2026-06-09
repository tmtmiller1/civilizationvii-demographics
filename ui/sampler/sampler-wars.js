// sampler-wars.js
//
// Compatibility facade for war tracking. Typedefs stay here for external
// imports while implementation lives in sampler-wars-core.js.

/**
 * The persisted history blob as the sampler sees it: the shared DemoHistory
 * fields plus the sampler's own runtime extensions (wars, legacySnapshots,
 * the obsolete cumulativeTurnOffset). These extra fields live on the same blob
 * but are not in the shared typedef, so they are declared here as an
 * intersection with the shared DemoHistory.
 * @typedef {DemoHistory & WarHistoryExtras} WarHistory
 */

/**
 * The sampler's runtime extension fields on the persisted history blob.
 * @typedef {object} WarHistoryExtras
 * @property {WarRecord[]} [wars] Tracked war records.
 * @property {Record<string, Record<string, object>>} [legacySnapshots]
 *   Age-end triumph snapshots, keyed by age.
 * @property {number} [cumulativeTurnOffset] Obsolete stored offset (deleted on migrate).
 */

/**
 * One persisted war record. Field shapes are the mod's own, but the record is
 * a runtime extension of the storage history (not in the shared typedef), so
 * it carries an index signature for back-compat / migration fields.
 * @typedef {object} WarRecord
 * @property {number} [warUniqueID] Stable engine uniqueID; primary key.
 * @property {Pid[]} [sideA] Side A roster (pids).
 * @property {Pid[]} [sideB] Side B roster (pids).
 * @property {Pid[]} [participants] All participant pids.
 * @property {object[]} [sideACivs] Side A roster info entries.
 * @property {object[]} [sideBCivs] Side B roster info entries.
 * @property {Pid} [aPid] Legacy scalar side-A pid (pre-array schema).
 * @property {Pid} [bPid] Legacy scalar side-B pid (pre-array schema).
 * @property {number | null} [startTurn] Age-local start turn.
 * @property {number | null} [endTurn] Age-local end turn (null while open).
 * @property {number} [startChartTurn] Continuous (cross-age) chart turn at start.
 * @property {number} [lastChartTurn] Latest global chart turn seen active.
 * @property {number} [endChartTurn] Continuous chart turn at end.
 * @property {string} [startYear] In-game start year label.
 * @property {string | null} [endYear] In-game end year label.
 * @property {object | null} [declaredBy] Declarer info.
 * @property {string} [_nameKeyA] Sorted matchup key A (for ordinal naming).
 * @property {string} [_nameKeyB] Sorted matchup key B (for ordinal naming).
 * @property {string} [name] Display name.
 * @property {*} [extra] Index signature for any other fields.
 */

/**
 * A resolved war-roster entry for one participant.
 * @typedef {object} WarRosterEntry
 * @property {Pid | string} pid The participant pid.
 * @property {string} civ Display civ name.
 * @property {string} leader Display leader name.
 * @property {string} color Banner color string.
 * @property {string | undefined} civTypeString Canonical CIVILIZATION_* type.
 * @property {string | undefined} [leaderType] Canonical LEADER_* type.
 * @property {boolean} isCS Whether the participant is a city-state / IP.
 */

/**
 * A war-roster entry tracked across the whole life of a war.
 * @typedef {WarRosterEntry & {
 *   joinTurn: number,
 *   leaveTurn?: number,
 *   active: boolean
 * }} WarParticipant
 */

/**
 * The normalized active-war info derived from a DECLARE_WAR event header.
 * @typedef {object} ActiveWar
 * @property {*} uniqueID The engine uniqueID.
 * @property {Pid | null} initialPid The declarer pid.
 * @property {Pid | null} targetPid The target pid.
 * @property {Pid[]} sideA Side A roster (pids).
 * @property {Pid[]} sideB Side B roster (pids).
 * @property {number | null} headerStartTurn Age-local declaration turn.
 */

export { runWarTracker } from "/demographics/ui/sampler/sampler-wars-core.js";
