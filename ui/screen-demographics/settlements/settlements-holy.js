// settlements-holy.js
//
// Holy-city badges for the settlement board. The engine exposes a religion's holy city only by
// name (player.Religion.getHolyCityName()), so a settlement is marked holy only when its name is
// unique on the board; an ambiguous duplicate name earns no badge.

import { t } from "/demographics/ui/core/demographics-i18n.js";

/**
 * A holy-city marker: the founded religion's display name + icon URL.
 * @typedef {{ religionName: string, icon: string }} HolyInfo
 */

/**
 * Run `fn`, returning its result or `fb` on throw. Never throws.
 * @template T
 * @param {() => T} fn Thunk.
 * @param {T} fb Fallback.
 * @returns {T} Result or fallback.
 */
function safe(fn, fb) {
  try {
    return fn();
  } catch (_) {
    return fb;
  }
}

/**
 * The GameInfo religion row for a player's founded religion, or null.
 * @param {*} rel The player's Religion library.
 * @returns {*} The religion row, or null.
 */
function religionRow(rel) {
  const type = safe(() => rel.getReligionType(), null);
  if (type == null || typeof GameInfo === "undefined") return null;
  return safe(() => GameInfo.Religions.lookup(type), null) || null;
}

/**
 * The holy-city marker for one player's founded religion, or null.
 * @param {*} p The player handle.
 * @returns {{ cityName: string, info: HolyInfo }|null} The holy city + marker.
 */
function holyFor(p) {
  const rel = safe(() => p?.Religion, null);
  if (!rel || typeof rel.getHolyCityName !== "function") return null;
  const raw = safe(() => rel.getHolyCityName(), "");
  if (!raw) return null;
  const row = religionRow(rel);
  const custom = safe(() => rel.getReligionName(), "");
  const religionName = t(custom || row?.Name || "");
  const icon = row?.ReligionType ? safe(() => UI.getIconURL(row.ReligionType, "RELIGION"), "") : "";
  return { cityName: t(raw), info: { religionName, icon: icon || "" } };
}

/**
 * Map composed holy-city name → marker, over every player who ever lived (a
 * founder can be eliminated while its holy city survives under a new owner).
 * @returns {Map<string, HolyInfo>} The holy cities by name.
 */
function readHolyCities() {
  /** @type {Map<string, HolyInfo>} */
  const out = new Map();
  if (typeof Players === "undefined") return out;
  const players = safe(() => Players.getEverAlive(), null) || safe(() => Players.getAlive(), null);
  if (!Array.isArray(players)) return out;
  for (const p of players) {
    const h = holyFor(p);
    if (h && !out.has(h.cityName)) out.set(h.cityName, h.info);
  }
  return out;
}

/**
 * Stamp `holy` on every settlement that is a religion's holy city, when its name
 * is unique on the board. Settlements that are not holy get `holy: null`.
 * @param {Array<{ name: string, holy?: HolyInfo|null }>} list The settlement records (mutated).
 */
export function attachHolyCities(list) {
  const holy = readHolyCities();
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const s of list) counts.set(s.name, (counts.get(s.name) || 0) + 1);
  for (const s of list) {
    const h = holy.get(s.name);
    s.holy = h && counts.get(s.name) === 1 ? h : null;
  }
}
