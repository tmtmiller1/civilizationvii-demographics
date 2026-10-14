// chart-wars-naming.js
//
// War-naming logic (no DOM): turns a merged war set into display names
// (recurrence ordinals, geography-aware regional/great/world labels, and duration
// flair), plus the roster/year helpers naming and the gantt share. Every surface
// imports this so a given war shows the same name everywhere.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { log, buildStackTurnYears } from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";

/**
 * Filter a roster to its major (non-city-state) civs.
 * @param {*[]} roster A war side's roster.
 * @returns {*[]}
 */
export function majorsOnSide(roster) {
  return (roster || []).filter((entry) => entry && !entry.isCS);
}

// CIV_ADJECTIVE: civ display-name → grammatical adjective form. Covers every
// base + DLC civ across all three ages; unknown civs fall back to a heuristic.
/** @type {Record<string, string>} */
const CIV_ADJECTIVE = {
  // Antiquity
  Aksum: "Aksumite",
  Carthage: "Carthaginian",
  Egypt: "Egyptian",
  Greece: "Greek",
  Han: "Han",
  Khmer: "Khmer",
  Maurya: "Mauryan",
  Maya: "Maya",
  Mississippian: "Mississippian",
  Persia: "Persian",
  Rome: "Roman",
  // Exploration
  Abbasid: "Abbasid",
  Chola: "Chola",
  Hawaii: "Hawaiian",
  Inca: "Incan",
  Majapahit: "Majapahit",
  Ming: "Ming",
  Mongolia: "Mongolian",
  Mongol: "Mongol",
  Norman: "Norman",
  Normans: "Norman",
  Shawnee: "Shawnee",
  Songhai: "Songhai",
  Spain: "Spanish",
  // Modern
  America: "American",
  "United States": "American",
  Buganda: "Bugandan",
  France: "French",
  Japan: "Japanese",
  Korea: "Korean",
  Meiji: "Meiji",
  Mexico: "Mexican",
  Mughal: "Mughal",
  Prussia: "Prussian",
  Qing: "Qing",
  Russia: "Russian",
  Siam: "Siamese",
  Thailand: "Thai",
  // Common DLC / wishlist
  Aztec: "Aztec",
  Babylonia: "Babylonian",
  Britain: "British",
  Byzantium: "Byzantine",
  England: "English",
  Ethiopia: "Ethiopian",
  Germany: "German",
  India: "Indian",
  Israel: "Israeli",
  Italy: "Italian",
  Khazar: "Khazar",
  Macedon: "Macedonian",
  Maori: "Maori",
  Netherlands: "Dutch",
  Phoenicia: "Phoenician",
  Poland: "Polish",
  Portugal: "Portuguese",
  Sumeria: "Sumerian",
  Sweden: "Swedish",
  Turkey: "Turkish",
  Vietnam: "Vietnamese",
  Zulu: "Zulu",
  // Keys match the game's LOC_CIVILIZATION_*_NAME display names ("Babylon",
  // "Great Britain", "Achaemenid Persia"). Consulted only when a war record has
  // no civTypeString; the engine adjective wins whenever it is available.
  Babylon: "Babylonian",
  Gauls: "Gallic",
  Gaul: "Gallic",
  // England is already correct in the list above; Babylon/Gaul were the gaps.
  "Great Britain": "British",
  "Achaemenid Persia": "Achaemenid Persian",
  "French Empire": "French Imperial",
  "Meiji Japan": "Meiji Japanese",
  "Sengoku Japan": "Sengoku",
  "Hawai'i": "Hawaiian",
  Goryeo: "Goryeo",
  Joseon: "Joseon",
  Nepal: "Nepalese"
};

/** @type {Array<{ re: RegExp, to: string | ((value: string) => string) }>} */
const ADJECTIVE_SUFFIX_RULES = [
  { re: /ia$/i, to: "ian" },
  { re: /y$/i, to: "ian" },
  { re: /a$/i, to: "n" },
  { re: /e$/i, to: (value) => value.replace(/e$/i, "ean") },
  { re: /o$/i, to: "an" }
];

/** @param {string} cleaned */
function deriveAdjectiveSuffix(cleaned) {
  for (const rule of ADJECTIVE_SUFFIX_RULES) {
    if (!rule.re.test(cleaned)) continue;
    if (typeof rule.to === "function") return rule.to(cleaned);
    return cleaned + rule.to;
  }
  return cleaned + "an";
}

/**
 * Compose a locale tag, treating a missing Locale, an empty result or an unresolved "LOC_" echo as no
 * adjective.
 * @param {string} tag Locale tag.
 * @returns {string|null}
 */
function composeAdjective(tag) {
  if (typeof Locale === "undefined") return null;
  if (typeof Locale.compose !== "function") return null;
  const value = Locale.compose(tag);
  if (typeof value !== "string") return null;
  if (value.length === 0) return null;
  if (value.startsWith("LOC_")) return null;
  return value;
}

/**
 * Resolve a civ's adjective from the engine's `LOC_CIVILIZATION_*_ADJECTIVE`
 * string, or `null` when unavailable. See CivilizationText.xml.
 * @param {*} civType The engine CivilizationType string.
 * @returns {string|null}
 */
function adjectiveFromCivType(civType) {
  if (typeof civType !== "string" || !civType) return null;
  const stem = civType.replace(/^CIVILIZATION_/, "");
  if (!stem) return null;
  // Base-game LOC tag built from the civ stem (engine-owned; matches
  // BASE_GAME_LOC_PREFIXES "LOC_CIVILIZATION_" in demographics-i18n.js).
  const tag = "LOC_CIVILIZATION_" + stem + "_ADJECTIVE";
  try {
    return composeAdjective(tag);
  } catch (_) {
    // Locale.compose may throw on a malformed adjective tag; fall back to null.
    return null;
  }
}

/**
 * Used when the engine adjective isn't available.
 * @param {*} name
 * @returns {string}
 */
function civAdjectiveFromName(name) {
  if (typeof name !== "string" || !name.length) return t("LOC_DEMOGRAPHICS_WARNAME_UNKNOWN_ADJ");
  if (CIV_ADJECTIVE[name]) return CIV_ADJECTIVE[name];
  const cleaned = name.replace(/^the\s+/i, "").trim();
  if (CIV_ADJECTIVE[cleaned]) return CIV_ADJECTIVE[cleaned];
  return deriveAdjectiveSuffix(cleaned);
}

/** @param {*} rosterEntry A roster object ({civ, civTypeString}) or a string. */
function civAdjective(rosterEntry) {
  if (rosterEntry && typeof rosterEntry === "object") {
    const fromEngine = adjectiveFromCivType(rosterEntry.civTypeString);
    if (fromEngine) return fromEngine;
    return civAdjectiveFromName(rosterEntry.civ);
  }
  return civAdjectiveFromName(rosterEntry);
}

/**
 * Localized ordinal word for a 1-based count: 1–5 spelled out, otherwise a
 * generic suffix form. Each language's forms are war-gendered so they agree
 * with "war" / "Weltkrieg" / "Guerra" / etc.
 * @param {number} count The 1-based count.
 * @returns {string}
 */
function ordinalWord(count) {
  if (count >= 1 && count <= 5) return t("LOC_DEMOGRAPHICS_ORDINAL_" + count);
  return t("LOC_DEMOGRAPHICS_ORDINAL_N", count);
}

/** @param {number} n */
function romanize(n) {
  /** @type {[string, number][]} */
  const numerals = [
    ["M", 1000],
    ["CM", 900],
    ["D", 500],
    ["CD", 400],
    ["C", 100],
    ["XC", 90],
    ["L", 50],
    ["XL", 40],
    ["X", 10],
    ["IX", 9],
    ["V", 5],
    ["IV", 4],
    ["I", 1]
  ];
  let roman = "";
  let remaining = n;
  for (const [symbol, value] of numerals) {
    while (remaining >= value) {
      roman += symbol;
      remaining -= value;
    }
  }
  return roman || "I";
}

/**
 * Parse a Civ7 gameYear ("2725 BCE", "100 CE", "1842") into a signed integer
 * (BCE → negative). Numbers pass through.
 * @param {*} year The year string or number.
 * @returns {number|null}
 */
export function parseYear(year) {
  if (typeof year !== "number") {
    if (typeof year !== "string") return null;
    const match = year.match(/(-?\d+)\s*(BCE|BC|CE|AD)?/i);
    if (!match) return null;
    const value = parseInt(match[1], 10);
    if (!isFinite(value)) return null;
    const era = (match[2] || "").toUpperCase();
    return era === "BCE" || era === "BC" ? -value : value;
  }
  return year;
}

/**
 * The war's duration in (rounded) in-game years, from its start/end years, with
 * a turn-count fallback when year data isn't available.
 * @param {*} war
 * @param {Map<number, string>} turnYearMap chart-turn → year map.
 * @param {number} latestTurn
 * @returns {number} The duration in years (>= 1).
 */
function warDurationYears(war, turnYearMap, latestTurn) {
  const startYear = parseYear(war.startYear);
  const endYear =
    typeof war.endTurn === "number"
      ? parseYear(war.endYear)
      : parseYear(turnYearMap.get(latestTurn));
  if (startYear !== null && endYear !== null) {
    const span = Math.abs(endYear - startYear);
    return span > 0 ? span : 1;
  }
  // turn-count fallback when years aren't available
  const turns = (typeof war.endTurn === "number" ? war.endTurn : latestTurn) - war.startTurn;
  return Math.max(1, turns);
}

/**
 * Build a pid → home-continent map from the latest sample's players (read once
 * for war-name geography). Empty when no continent data has been sampled yet.
 * @param {Snapshot[]} samples
 * @returns {Map<number, number>} pid → continent type.
 */
function buildContinentMap(samples) {
  /** @type {Map<number, number>} */
  const map = new Map();
  const last = samples && samples.length ? samples[samples.length - 1] : null;
  const players = last && last.players ? last.players : null;
  if (!players) return map;
  for (const pid in players) {
    const continent = /** @type {*} */ (players[pid])?.continent;
    if (typeof continent === "number") map.set(Number(pid), continent);
  }
  return map;
}

/**
 * Compute display names for a merged war set, keyed by warUniqueID (recurrence
 * ordinals + world-war numbering included). Callers pass the same full merged
 * set so the names agree across surfaces.
 * @param {*[]} wars
 * @param {Snapshot[]} samples
 * @returns {Map<number, string>} warUniqueID → display name.
 */
export function nameMergedWars(wars, samples) {
  const latestTurn = samples && samples.length ? (samples[samples.length - 1]?.turn ?? 0) : 0;
  const turnYearMap = buildStackTurnYears(samples);
  const continentMap = buildContinentMap(samples);
  const overrides = buildWarNameOverrides(wars, turnYearMap, latestTurn, continentMap);
  /** @type {Map<number, string>} */
  const byId = new Map();
  for (const [war, name] of overrides) {
    if (typeof war.warUniqueID === "number") byId.set(war.warUniqueID, name);
  }
  return byId;
}

/**
 * Build the per-war display-name override map: ordinal-numbered recurring
 * matchups, regional/great/world labels (by geography), and duration flair.
 * @param {*[]} filtered
 * @param {Map<number, string>} turnYearMap chart-turn → year map.
 * @param {number} latestTurn
 * @param {Map<number, number>} continentMap pid → home-continent type.
 * @returns {Map<*, string>} war → display label.
 */
export function buildWarNameOverrides(filtered, turnYearMap, latestTurn, continentMap) {
  /** @type {Map<*, string>} */
  const nameOverride = new Map();
  // Count prior wars with the exact same participant set so we can
  // ordinal-number recurring matchups ("Second Roman-Carthaginian War").
  /** @type {Map<string, number>} */
  const pairCounts = new Map();
  /** @type {*[]} */
  const worldWars = []; // chronological order (for "World War N")
  const sorted = filtered.slice().sort((a, b) => (a.startTurn || 0) - (b.startTurn || 0));

  const flair = buildDurationFlairContext(sorted, latestTurn);

  let flairCount = 0;
  for (const war of sorted) {
    const majorCount = majorsOnSide(war.sideACivs).length + majorsOnSide(war.sideBCivs).length;
    let label = composeWarLabel(war, pairCounts, worldWars, continentMap);
    if (majorCount < 6 && flair.warTurns(war) >= flair.flairCut) {
      label = epicWarLabel(label, war, turnYearMap, latestTurn);
      flairCount++;
    }
    nameOverride.set(war, label);
  }
  log.debug(
    "war-name flair: eligible=" +
      flair.durations.length +
      " medianTurns=" +
      flair.median +
      " flairCut=" +
      flair.flairCut +
      " -> flaired=" +
      flairCount
  );
  return nameOverride;
}

/**
 * @param {*[]} sorted Wars sorted by start turn.
 * @param {number} latestTurn
 */
function buildDurationFlairContext(sorted, latestTurn) {
  const warTurns = (/** @type {*} */ war) =>
    Math.max(1, (typeof war.endTurn === "number" ? war.endTurn : latestTurn) - war.startTurn);
  const durations = sorted
    .filter((war) => majorsOnSide(war.sideACivs).length + majorsOnSide(war.sideBCivs).length < 6)
    .map(warTurns)
    .sort((a, b) => a - b);
  const median = durations.length ? durations[Math.floor((durations.length - 1) / 2)] : 0;
  const PEACE_MIN_TURNS = 10;
  const flairCut = Math.max(PEACE_MIN_TURNS * 2, Math.round(median * 1.5));
  return { warTurns, durations, median, flairCut };
}

/**
 * @param {string} base
 * @param {*} war
 * @param {Map<number, string>} turnYearMap chart-turn → year map.
 * @param {number} latestTurn
 */
function epicWarLabel(base, war, turnYearMap, latestTurn) {
  const yrs = warDurationYears(war, turnYearMap, latestTurn);
  const rounded = Math.max(50, Math.round(yrs / 50) * 50);
  // Civ's compressed early timeline can make an epic war span many centuries;
  // cap the figure so it reads as evocative ("Centuries' War") rather than an
  // absurd literal ("1000-Year War"). Keep the iconic name for ~100-year spans.
  if (rounded >= 300) return t("LOC_DEMOGRAPHICS_WARNAME_CENTURIES", base);
  if (rounded === 100) return t("LOC_DEMOGRAPHICS_WARNAME_HUNDRED", base);
  return t("LOC_DEMOGRAPHICS_WARNAME_YEARS", base, String(rounded));
}

/**
 * The number of distinct home continents spanned by a set of major belligerents.
 * Unknown continents (unsampled civs) don't count, so geography only ever
 * upgrades a name once the data exists; it never falsely claims a world war.
 * @param {*[]} civs The major roster entries.
 * @param {Map<number, number>} continentMap pid → home-continent type.
 * @returns {number}
 */
function distinctContinents(civs, continentMap) {
  const set = new Set();
  for (const civ of civs) {
    const continent = continentMap.get(Number(civ.pid));
    if (continent !== undefined && continent !== null) set.add(continent);
  }
  return set.size;
}

/**
 * @param {Object} args
 * @param {*} args.war
 * @param {*[]} args.majorsA Side A majors.
 * @param {*[]} args.majorsB Side B majors.
 * @param {string[]} args.adjA Side A adjectives.
 * @param {string[]} args.adjB Side B adjectives.
 * @param {number} args.majorCount Total major count.
 * @param {*[]} args.worldWars World-war list (mutated, for numbering).
 * @param {Map<number, number>} args.continentMap pid → home-continent type.
 */
function largeWarLabel(args) {
  const { war, majorsA, majorsB, adjA, adjB, majorCount, worldWars, continentMap } = args;
  const continents = distinctContinents(majorsA.concat(majorsB), continentMap);
  if (majorCount >= 6 && continents >= 2) {
    worldWars.push(war);
    const idx = worldWars.length;
    // Pass both numeral forms; each language's template picks one.
    return t("LOC_DEMOGRAPHICS_WARNAME_WORLD", romanize(idx), ordinalWord(idx));
  }
  if (continents >= 2) return t("LOC_DEMOGRAPHICS_WARNAME_GREAT", adjA[0], adjB[0], majorCount - 2);
  return t("LOC_DEMOGRAPHICS_WARNAME_REGIONAL", adjA[0], adjB[0], majorCount - 2);
}

/**
 * @param {*} war
 * @param {Map<string, number>} pairCounts Recurring-matchup counts (mutated).
 * @param {*[]} worldWars World-war list (mutated, for numbering).
 * @param {Map<number, number>} continentMap pid → home-continent type.
 */
function composeWarLabel(war, pairCounts, worldWars, continentMap) {
  const majorsA = majorsOnSide(war.sideACivs);
  const majorsB = majorsOnSide(war.sideBCivs);
  const majorCount = majorsA.length + majorsB.length;
  // Pass the full roster object so civAdjective can use civTypeString.
  const adjA = majorsA.map((entry) => civAdjective(entry));
  const adjB = majorsB.map((entry) => civAdjective(entry));
  // A war has two sides, so 3+ majors is always a coalition (e.g. 1-vs-2), never a
  // true three-way "tripartite" war (which this two-sided model can't represent).
  // Route it to the coalition namer ("Regional/Great <A>-<B> War (+N others)").
  if (majorCount >= 3) {
    return largeWarLabel({ war, majorsA, majorsB, adjA, adjB, majorCount, worldWars, continentMap });
  }
  return smallWarLabel({ majorCount, adjA, adjB, pairCounts, war });
}

/**
 * @param {Map<string, number>} pairCounts Recurring-matchup counts (mutated).
 * @param {string} key Stable matchup key.
 * @param {string} template WARNAME LOC key.
 * @param {...string} adjs Adjective params for the template.
 */
function recurringOrdinalLabel(pairCounts, key, template, ...adjs) {
  const count = (pairCounts.get(key) || 0) + 1;
  pairCounts.set(key, count);
  return t(template, ordinalWord(count), ...adjs);
}

/**
 * All localized so no English name leaks to non-English UIs.
 * @param {{ majorCount: number, adjA: string[], adjB: string[],
 *   pairCounts: Map<string, number>, war: * }} args
 */
function smallWarLabel({ majorCount, adjA, adjB, pairCounts, war }) {
  const unknown = t("LOC_DEMOGRAPHICS_WARNAME_UNKNOWN_ADJ");
  if (majorCount === 2) {
    // Stable adjective key (alpha order) so reruns get ordinal prefixes.
    const pair = [adjA[0] || unknown, adjB[0] || unknown].sort();
    return recurringOrdinalLabel(
      pairCounts, pair.join("|"), "LOC_DEMOGRAPHICS_WARNAME_BILATERAL", pair[0], pair[1]);
  }
  if (majorCount === 1) {
    const adj = adjA[0] || adjB[0] || unknown;
    return recurringOrdinalLabel(pairCounts, adj, "LOC_DEMOGRAPHICS_WARNAME_SINGLE", adj);
  }
  // No majors at all (all but never shown). The persisted `name` is English, so not that.
  return t("LOC_DEMOGRAPHICS_WAR_FALLBACK_NAME", war.warUniqueID);
}

/**
 * The display label for a war bar: its name plus a duration-in-years suffix.
 * @param {*} war
 * @param {Map<*, string>} nameOverride war → display label.
 * @param {Map<number, string>} turnYearMap chart-turn → year map.
 * @param {number} latestTurn
 * @returns {string}
 */
export function conflictLabelText(war, nameOverride, turnYearMap, latestTurn) {
  const yrs = warDurationYears(war, turnYearMap, latestTurn);
  const displayName = nameOverride.get(war) || war.name;
  const yrLabel =
    yrs === 1
      ? t("LOC_DEMOGRAPHICS_WARS_DURATION_YR_ONE", yrs)
      : t("LOC_DEMOGRAPHICS_WARS_DURATION_YR", yrs);
  return displayName + "  ·  " + yrLabel;
}

export { warDurationYears, buildContinentMap };
