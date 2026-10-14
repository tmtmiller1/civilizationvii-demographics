// history-world.js
//
// Reads the live game into a plain HistoryWorldState: every major player's settlements, wonders,
// Triumphs, religion, wars and population, plus claimed victories. This is the only capture module
// that touches the engine; history-diff.js compares two states without it. Every engine call is wrapped
// in safe() because handles go stale mid age-transition and some calls throw for dead players.

import { safe } from "/demographics/ui/history/core/history-log.js";
import { readCitySize, readAgeProgressPct } from "/demographics/ui/sampler/sampler-collectors-economy.js";
import { scaleCityPopulationAt } from "/demographics/ui/metrics/demographics-metrics-helpers.js";
import { probeCrisisEventType } from "/demographics/ui/sampler/sampler-age-context.js";

/**
 * The age crisis: its event type and current stage, read the way the Demographics sampler does.
 * @returns {{type:string, stage:number}} stage is -1 when unreadable.
 */
export function readCrisis() {
  const stage = Number(safe(() => Game.CrisisManager.getCurrentCrisisStage(0), -1));
  const type = String(safe(() => probeCrisisEventType((_label, fn) => safe(fn, undefined)), "") || "");
  return { type, stage: isFinite(stage) ? stage : -1 };
}

/**
 * GameInfo row for an engine hash or type string, or null.
 * @param {string} table
 * @param {*} key Hash or type string.
 * @returns {*}
 */
export function infoRow(table, key) {
  if (key == null || typeof GameInfo === "undefined") return null;
  return safe(() => GameInfo[table].lookup(key), null) || null;
}

/**
 * The current age type string ("AGE_ANTIQUITY"), or "" when unknown.
 * @returns {string}
 */
export function currentAge() {
  return safe(() => infoRow("Ages", Game.age)?.AgeType, "") || "";
}

/**
 * The current turn's date label ("2725 BCE"), or "".
 * @returns {string}
 */
export function turnDate() {
  return String(safe(() => Game.getTurnDate(), "") || "");
}

/**
 * Every major player that has ever been alive this game.
 * @returns {PlayerLibrary[]}
 */
export function everMajors() {
  const list = safe(() => (Players.getEverAlive ? Players.getEverAlive() : Players.getAlive()), []) || [];
  return list.filter((/** @type {PlayerLibrary} */ p) => p && p.isMajor);
}

/**
 * Leader and civilization identity for one player, as type strings plus LOC name tags.
 * @param {PlayerLibrary} player
 * @returns {{leader:string, leaderName:string, civ:string, civName:string, color:string, color2:string,
 *   human:boolean}}
 */
export function playerIdentity(player) {
  const leaderRow = infoRow("Leaders", player.leaderType);
  const civRow = infoRow("Civilizations", player.civilizationType);
  return {
    leader: leaderRow?.LeaderType || "",
    leaderName: leaderRow?.Name || "",
    civ: civRow?.CivilizationType || "",
    civName: civRow?.Name || "",
    ...playerColors(player),
    human: !!safe(() => player.isHuman, false)
  };
}

/** @param {PlayerLibrary} player */
function playerColors(player) {
  return {
    color: String(safe(() => UI.Player.getPrimaryColorValueAsString(player.id), "") || ""),
    color2: String(safe(() => UI.Player.getSecondaryColorValueAsString(player.id), "") || "")
  };
}

/**
 * The player's settlements keyed by map location.
 * @param {PlayerLibrary} player
 * @returns {Record<string, string>} "x,y" -> settlement name (LOC tag or text).
 */
export function readCities(player) {
  /** @type {Record<string, string>} */
  const out = {};
  const list = safe(() => player.Cities?.getCities?.(), []) || [];
  for (const city of list) {
    const loc = safe(() => city.location, null);
    if (!loc) continue;
    out[loc.x + "," + loc.y] = String(safe(() => city.name, "") || "");
  }
  return out;
}

/**
 * The player's population in Demographics' real-world scale: the sum over its settlements of the
 * same per-settlement growth curve the Population chart and the Settlements board use (summed per
 * settlement because the curve is super-linear).
 * @param {PlayerLibrary} player
 * @param {{age:string, agePct:number|undefined}} ctx
 * @returns {number}
 */
export function readScaledPopulation(player, ctx) {
  const list = safe(() => player.Cities?.getCities?.(), []) || [];
  let sum = 0;
  for (const city of list) {
    sum += safe(() => scaleCityPopulationAt(readCitySize(city), undefined, ctx.age, ctx.agePct), 0);
  }
  return Math.round(sum);
}

/**
 * Completed wonders owned by the player, as ConstructibleType strings.
 * @param {PlayerLibrary} player
 * @returns {string[]} Sorted.
 */
export function readWonders(player) {
  const comps = safe(() => player.Constructibles?.getWonders?.(player.id), []) || [];
  /** @type {string[]} */
  const out = [];
  for (const wc of comps) {
    const con = safe(() => Constructibles.getByComponentID(wc), null);
    if (!con || !con.complete) continue;
    const type = infoRow("Constructibles", con.type)?.ConstructibleType;
    if (type) out.push(type);
  }
  return out.sort();
}

/** @type {{age:string, rows:any[]}|null} */
let _legacyCache = null;

/**
 * @param {string} age
 * @returns {any[]} GameInfo.Legacies rows for that age.
 */
function legacyRows(age) {
  if (_legacyCache && _legacyCache.age === age) return _legacyCache.rows;
  const all = safe(() => [...GameInfo.Legacies], []) || [];
  const rows = all.filter((r) => r && r.Age === age && !r.Inactive);
  _legacyCache = { age, rows };
  return rows;
}

/**
 * Triumphs this player has earned in the current age.
 * @param {PlayerLibrary} player
 * @param {string} age
 * @returns {string[]} Sorted.
 */
export function readTriumphs(player, age) {
  const leg = safe(() => player.Legacies, null);
  if (!leg || typeof leg.isTriggered !== "function") return [];
  return legacyRows(age)
    .filter((r) => safe(() => leg.isTriggered(r.LegacyType), false))
    .map((r) => String(r.LegacyType))
    .sort();
}

/**
 * What a Triumph was earned for, and what it did, as the game words it.
 * @param {string} type
 * @param {string} age
 * @returns {{why: string, what: string}} LOC tags ("" when the game has none).
 */
export function legacyBlurb(type, age) {
  const row = legacyRows(age).find((r) => String(r.LegacyType) === type)
    || (safe(() => [...GameInfo.Legacies], []) || []).find((r) => String(r.LegacyType) === type);
  return { why: String(row?.TriggerDescription || ""), what: String(row?.Description || "") };
}

/**
 * The display name of the religion this player founded, or "".
 * @param {PlayerLibrary} player
 * @returns {string} Custom name, LOC tag, or "".
 */
export function readReligion(player) {
  const rel = safe(() => player.Religion, null);
  if (!rel) return "";
  const type = safe(() => rel.getReligionType?.(), null);
  if (type == null || type === -1) return "";
  const custom = safe(() => rel.getReligionName?.(), "");
  return String(custom || infoRow("Religions", type)?.Name || "");
}

/**
 * The engine type of the religion a player founded ("RELIGION_BUDDHISM"), for its icon, or "".
 * @param {PlayerLibrary} player
 * @returns {string}
 */
export function readReligionType(player) {
  const type = safe(() => player.Religion?.getReligionType?.(), null);
  if (type == null || type === -1) return "";
  return String(infoRow("Religions", type)?.ReligionType || "");
}

/**
 * Major players this player is at war with. Independents are excluded on purpose: the engine
 * reports every Independent Power as "at war" at all times.
 * @param {PlayerLibrary} player
 * @param {number[]} majorIds Ids of living majors.
 * @returns {number[]} Sorted.
 */
export function readWars(player, majorIds) {
  const dip = safe(() => player.Diplomacy, null);
  if (!dip || typeof dip.isAtWarWith !== "function") return [];
  return majorIds.filter((q) => q !== player.id && safe(() => dip.isAtWarWith(q), false)).sort((a, b) => a - b);
}

/**
 * Claimed victories as "team:VICTORY_TYPE" strings.
 * @returns {string[]} Sorted.
 */
export function readVictories() {
  const list = safe(() => Game.VictoryManager.getVictories(), []) || [];
  return list
    .map((/** @type {any} */ v) => v.team + ":" + (infoRow("Victories", v.victory)?.VictoryType || v.victory))
    .sort();
}

/**
 * Read one player's state.
 * @param {PlayerLibrary} player
 * @param {{age:string, agePct:number|undefined, local:any, majorIds:number[]}} ctx
 * @returns {HistoryPlayerState}
 */
export function readPlayer(player, ctx) {
  const alive = !!safe(() => player.isAlive, false);
  const met = player.id === ctx.local?.id || !!safe(() => ctx.local?.Diplomacy?.hasMet(player.id), false);
  const base = { alive, civ: playerIdentity(player).civ, met };
  if (!alive) {
    return {
      ...base,
      cities: {},
      wonders: [],
      triumphs: [],
      religion: "",
      religionType: "",
      wars: [],
      population: 0,
      popScaled: 0
    };
  }
  return {
    ...base,
    cities: readCities(player),
    wonders: readWonders(player),
    triumphs: readTriumphs(player, ctx.age),
    religion: readReligion(player),
    religionType: readReligionType(player),
    wars: readWars(player, ctx.majorIds),
    population: Number(safe(() => player.Stats?.totalPopulation, 0)) || 0,
    popScaled: readScaledPopulation(player, ctx)
  };
}

/**
 * The Emigration mod's cumulative cross-civilization migration for a player (moves between the
 * player's own settlements left out), or undefined when that mod is not running.
 * @param {number} pid
 * @returns {{i:number, o:number}|undefined} People in and out.
 */
export function readMigration(pid) {
  const api = /** @type {*} */ (globalThis).EmigrationData;
  if (!api || typeof api.grossInCumFor !== "function") return undefined;
  const count = (/** @type {string} */ method) => Number(safe(() => api[method]?.(pid), 0)) || 0;
  return {
    i: Math.max(0, count("grossInCumFor") - count("internalInCumFor")),
    o: Math.max(0, count("grossOutCumFor") - count("internalOutCumFor"))
  };
}

/**
 * Read the whole world.
 * @param {number} localId
 * @returns {HistoryWorldState}
 */
export function readWorld(localId) {
  const majors = everMajors();
  const age = currentAge();
  const ctx = {
    age,
    agePct: safe(() => readAgeProgressPct(), undefined),
    local: safe(() => Players.get(localId), null),
    majorIds: majors.filter((p) => safe(() => p.isAlive, false)).map((p) => p.id)
  };
  /** @type {Record<string, HistoryPlayerState>} */
  const players = {};
  for (const player of majors) players[String(player.id)] = readPlayer(player, ctx);
  const mine = players[String(localId)];
  const mig = mine?.alive ? readMigration(localId) : undefined;
  if (mine && mig) mine.mig = mig;
  return {
    turn: Number(safe(() => Game.turn, 0)) || 0,
    age,
    date: turnDate(),
    players,
    victories: readVictories(),
    crisis: readCrisis()
  };
}
