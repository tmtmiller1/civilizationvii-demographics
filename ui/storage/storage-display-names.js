// storage-display-names.js
//
// Stored history keeps civilization and leader names as they read when each sample was taken, so a
// game played in English and reopened in Korean showed "Great Britain → Mongolia → 몽골" in legends
// and dropdowns (and listed one civilization twice). Every stored name that has a type beside it is
// re-read from the game in the current language on load. Recurrence keys (_nameKeyA/_nameKeyB) and
// the persisted war `name` are left alone: the sampler matches on them, and no screen shows them.

/**
 * Independents are stored under the engine's name for them, in the language of the session that
 * recorded them; the mod calls them City-States. English is listed, the current language is added.
 */
const STORED_INDEPENDENT_NAMES = new Set(["Villages"]);

/**
 * Compose a game row's name in the current language.
 * @param {string} table GameInfo table ("Civilizations" or "Leaders").
 * @param {string} type The row's type string.
 * @returns {string} The name, or "" when the row or its text is missing.
 */
function composeRowName(table, type) {
  try {
    const tag = GameInfo[table]?.lookup?.(type)?.Name;
    const text = tag ? Locale.compose(tag) : "";
    return typeof text === "string" && !text.startsWith("LOC_") ? text : "";
  } catch (_) {
    return ""; // No GameInfo or Locale (main menu, tests): keep the stored name.
  }
}

/**
 * The current-language name of a game row, cached per load.
 * @param {string} table GameInfo table ("Civilizations" or "Leaders").
 * @param {*} type The row's type string.
 * @param {Map<string, string>} cache Per-load cache, keyed by table and type.
 * @returns {string} The name, or "".
 */
function rowName(table, type, cache) {
  if (typeof type !== "string" || !type) return "";
  const key = table + ":" + type;
  if (!cache.has(key)) cache.set(key, composeRowName(table, type));
  return /** @type {string} */ (cache.get(key));
}

/**
 * The current-language "City-State" label for an independent stored under the English plural.
 * @param {Map<string, string>} cache Per-load cache.
 * @returns {string} The label, or "".
 */
function independentName(cache) {
  if (cache.has("indep")) return /** @type {string} */ (cache.get("indep"));
  const text = composeTag("LOC_DEMOGRAPHICS_CITY_STATE");
  cache.set("indep", text);
  return text;
}

/**
 * Whether a typeless roster name is the engine's name for independents.
 * @param {*} name Stored civ name.
 * @param {Map<string, string>} cache Per-load cache.
 * @returns {boolean} True for an independent.
 */
function isIndependentName(name, cache) {
  if (!cache.has("indepEngine")) cache.set("indepEngine", composeTag("LOC_CIVILIZATION_INDEPENDENT_NAME"));
  return STORED_INDEPENDENT_NAMES.has(name) || (!!name && name === cache.get("indepEngine"));
}

/**
 * Compose a tag, or "" when it does not resolve.
 * @param {string} tag LOC tag.
 * @returns {string} The text, or "".
 */
function composeTag(tag) {
  try {
    const text = Locale.compose(tag);
    return typeof text === "string" && !text.startsWith("LOC_") ? text : "";
  } catch (_) {
    return ""; // No Locale (tests).
  }
}

/**
 * Re-read one war roster entry's names from its types.
 * @param {*} entry Roster entry ({ civ, leader, civTypeString, leaderType, isCS }).
 * @param {Map<string, string>} cache Per-load cache.
 */
function localizeRosterEntry(entry, cache) {
  if (!entry || typeof entry !== "object") return;
  const civ = rowName("Civilizations", entry.civTypeString, cache);
  if (civ) entry.civ = civ;
  else if (!entry.civTypeString && isIndependentName(entry.civ, cache)) entry.civ = independentName(cache) || entry.civ;
  const leader = rowName("Leaders", entry.leaderType, cache);
  if (leader && entry.leader) entry.leader = leader;
}

/**
 * Re-read one sample player's names from its types.
 * @param {*} player Sample player ({ civName, leaderName, civTypeString, leaderTypeString }).
 * @param {Map<string, string>} cache Per-load cache.
 */
function localizeSamplePlayer(player, cache) {
  if (!player || typeof player !== "object") return;
  const civ = rowName("Civilizations", player.civTypeString, cache);
  if (civ) player.civName = civ;
  const leader = rowName("Leaders", player.leaderTypeString, cache);
  if (leader) player.leaderName = leader;
}

/** @param {*} side A war side roster. @returns {*[]} Its entries, or []. */
const rosterOf = (side) => (Array.isArray(side) ? side : []);

/**
 * Re-read one war's roster names, and its declarer's from the matching roster entry.
 * @param {*} war War record.
 * @param {Map<string, string>} cache Per-load cache.
 */
function localizeWar(war, cache) {
  if (!war || typeof war !== "object") return;
  const roster = [...rosterOf(war.sideACivs), ...rosterOf(war.sideBCivs)];
  for (const entry of roster) localizeRosterEntry(entry, cache);
  const by = war.declaredBy;
  const src = by && typeof by === "object" ? roster.find((e) => e && e.pid === by.pid) : null;
  if (!src) return;
  if (src.civ) by.civ = src.civ;
  if (src.leader && by.leader) by.leader = src.leader;
}

/**
 * Re-read the stored civilization and leader names of a loaded history in the current language.
 * Mutates `history` in place; names with no type beside them, or no row in the game, are kept.
 * @param {*} history A loaded history blob.
 * @returns {*} The same history.
 */
export function localizeStoredNames(history) {
  if (!history || typeof history !== "object") return history;
  /** @type {Map<string, string>} */
  const cache = new Map();
  for (const sample of Array.isArray(history.samples) ? history.samples : []) {
    for (const player of Object.values((sample && sample.players) || {})) localizeSamplePlayer(player, cache);
  }
  for (const war of Array.isArray(history.wars) ? history.wars : []) localizeWar(war, cache);
  return history;
}
