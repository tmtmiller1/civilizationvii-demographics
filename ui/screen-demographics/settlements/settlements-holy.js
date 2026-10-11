// settlements-holy.js
//
// Holy-city badges for the settlement board. The engine exposes a religion's holy city only by
// name (player.Religion.getHolyCityName()), so a settlement is marked holy only when its name is
// unique on the board; an ambiguous duplicate name earns no badge.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { orFallback } from "/demographics/ui/screen-demographics/screen/guarded-reads.js";

/**
 * A holy-city marker: the founded religion's display name + icon URL.
 * @typedef {{ religionName: string, icon: string }} HolyInfo
 */

/**
 * The GameInfo religion row for a player's founded religion, or null.
 * @param {*} religion The player's Religion library.
 * @returns {*}
 */
function religionRow(religion) {
  const type = orFallback(() => religion.getReligionType(), null);
  if (type == null || typeof GameInfo === "undefined") return null;
  return orFallback(() => GameInfo.Religions.lookup(type), null) || null;
}

/**
 * The holy-city marker for one player's founded religion, or null.
 * @param {*} player
 * @returns {{ cityName: string, info: HolyInfo }|null}
 */
function holyFor(player) {
  const religion = orFallback(() => player?.Religion, null);
  if (!religion || typeof religion.getHolyCityName !== "function") return null;
  const raw = orFallback(() => religion.getHolyCityName(), "");
  if (!raw) return null;
  const row = religionRow(religion);
  const custom = orFallback(() => religion.getReligionName(), "");
  const religionName = t(custom || row?.Name || "");
  const icon = row?.ReligionType ? orFallback(() => UI.getIconURL(row.ReligionType, "RELIGION"), "") : "";
  return { cityName: t(raw), info: { religionName, icon: icon || "" } };
}

/**
 * Map composed holy-city name → marker, over every player who ever lived (a
 * founder can be eliminated while its holy city survives under a new owner).
 * @returns {Map<string, HolyInfo>}
 */
function readHolyCities() {
  /** @type {Map<string, HolyInfo>} */
  const out = new Map();
  if (typeof Players === "undefined") return out;
  const players = orFallback(() => Players.getEverAlive(), null) || orFallback(() => Players.getAlive(), null);
  if (!Array.isArray(players)) return out;
  for (const player of players) {
    const holy = holyFor(player);
    if (holy && !out.has(holy.cityName)) out.set(holy.cityName, holy.info);
  }
  return out;
}

/**
 * Stamp `holy` on every settlement that is a religion's holy city, when its name
 * is unique on the board. Settlements that are not holy get `holy: null`.
 * @param {Array<{ name: string, holy?: HolyInfo|null }>} list The settlement records (mutated).
 */
export function attachHolyCities(list) {
  const holyByName = readHolyCities();
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const settlement of list) counts.set(settlement.name, (counts.get(settlement.name) || 0) + 1);
  for (const settlement of list) {
    const holy = holyByName.get(settlement.name);
    settlement.holy = holy && counts.get(settlement.name) === 1 ? holy : null;
  }
}
