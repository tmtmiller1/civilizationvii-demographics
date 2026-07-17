// chart-wars-naming.js
//
// War-naming logic, extracted from chart-conflicts-timeline.js so the (large) gantt
// DOM/render module isn't pulled in just to name a war. Pure logic: turns a
// (merged) war set into display names - recurrence ordinals, geography-aware
// regional/great/world labels, and duration flair - plus the small roster/year
// helpers that naming and the gantt both share. No DOM here.
//
// Imported by chart-conflicts-timeline.js (rendering), chart-conflicts-graphs.js, and
// history-toolbar.js (the War Graphs picker), so every surface shows the SAME
// fancy name for a given war.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { dlog, buildStackTurnYears } from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";

/**
 * Filter a roster to its major (non-city-state) civs.
 * @param {*[]} roster A war side's roster.
 * @returns {*[]} The major civs.
 */
export function majorsOnSide(roster) {
  return (roster || []).filter((r) => r && !r.isCS);
}

// CIV_ADJECTIVE - civ display-name → grammatical adjective form. Covers every
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
  Maya: "Mayan",
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
  Mongolia: "Mongol",
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
  Zulu: "Zulu"
};

/** @type {Array<{ re: RegExp, to: string | ((value: string) => string) }>} */
const ADJECTIVE_SUFFIX_RULES = [
  { re: /ia$/i, to: "ian" },
  { re: /y$/i, to: "ian" },
  { re: /a$/i, to: "n" },
  { re: /e$/i, to: (value) => value.replace(/e$/i, "ean") },
  { re: /o$/i, to: "an" }
];

/**
 * Apply suffix-based English adjective derivation for unknown civ names.
 * @param {string} cleaned Cleaned civ display name.
 * @returns {string} Derived adjective.
 */
function deriveAdjectiveSuffix(cleaned) {
  for (const rule of ADJECTIVE_SUFFIX_RULES) {
    if (!rule.re.test(cleaned)) continue;
    if (typeof rule.to === "function") return rule.to(cleaned);
    return cleaned + rule.to;
  }
  return cleaned + "an";
}

/**
 * Compose a localized adjective tag into a concrete string.
 * @param {string} tag Locale tag.
 * @returns {string|null} Composed adjective, or null when unresolved.
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
 * string, or `null` when unavailable. Cite: CivilizationText.xml.
 * @param {*} civType The engine CivilizationType string.
 * @returns {string|null} The composed adjective, or `null`.
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
 * Resolve a civ's adjective from the bundled map, then a heuristic English
 * suffix derivation. Used when the engine adjective isn't available.
 * @param {*} name The civ display name.
 * @returns {string} The adjective.
 */
function civAdjectiveFromName(name) {
  if (typeof name !== "string" || !name.length) return t("LOC_DEMOGRAPHICS_WARNAME_UNKNOWN_ADJ");
  if (CIV_ADJECTIVE[name]) return CIV_ADJECTIVE[name];
  const cleaned = name.replace(/^the\s+/i, "").trim();
  if (CIV_ADJECTIVE[cleaned]) return CIV_ADJECTIVE[cleaned];
  return deriveAdjectiveSuffix(cleaned);
}

/**
 * Resolve a roster entry's (or raw string's) civ adjective, preferring the
 * engine LOC lookup.
 * @param {*} rosterEntry A roster object ({civ, civTypeString}) or a string.
 * @returns {string} The adjective.
 */
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
 * @param {number} n The 1-based count.
 * @returns {string} The localized ordinal.
 */
function ordinalWord(n) {
  if (n >= 1 && n <= 5) return t("LOC_DEMOGRAPHICS_ORDINAL_" + n);
  return t("LOC_DEMOGRAPHICS_ORDINAL_N", n);
}

/**
 * Convert an integer to a Roman numeral (>=1; "I" minimum).
 * @param {number} n The integer.
 * @returns {string} The Roman numeral.
 */
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
  let r = "",
    v = n;
  for (const [s, d] of numerals) {
    while (v >= d) {
      r += s;
      v -= d;
    }
  }
  return r || "I";
}

/**
 * Parse a Civ7 gameYear ("2725 BCE", "100 CE", "1842") into a signed integer
 * (BCE → negative). Numbers pass through.
 * @param {*} s The year string or number.
 * @returns {number|null} The signed year, or `null`.
 */
export function parseYear(s) {
  if (typeof s !== "number") {
    if (typeof s !== "string") return null;
    const m = s.match(/(-?\d+)\s*(BCE|BC|CE|AD)?/i);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    if (!isFinite(n)) return null;
    const era = (m[2] || "").toUpperCase();
    return era === "BCE" || era === "BC" ? -n : n;
  }
  return s;
}

/**
 * The war's duration in (rounded) in-game years, from its start/end years, with
 * a turn-count fallback when year data isn't available.
 * @param {*} war The war record.
 * @param {Map<number, string>} turnYearMap chart-turn → year map.
 * @param {number} latestTurn The latest sampled turn.
 * @returns {number} The duration in years (>= 1).
 */
function warDurationYears(war, turnYearMap, latestTurn) {
  const sY = parseYear(war.startYear);
  const eY =
    typeof war.endTurn === "number"
      ? parseYear(war.endYear)
      : parseYear(turnYearMap.get(latestTurn));
  if (sY !== null && eY !== null) {
    const d = Math.abs(eY - sY);
    return d > 0 ? d : 1;
  }
  // Fallback: turn-count when years aren't available.
  const t = (typeof war.endTurn === "number" ? war.endTurn : latestTurn) - war.startTurn;
  return Math.max(1, t);
}

/**
 * Build a pid → home-continent map from the latest sample's players (read once
 * for war-name geography). Empty when no continent data has been sampled yet.
 * @param {Snapshot[]} samples The sample stream.
 * @returns {Map<number, number>} pid → continent type.
 */
function buildContinentMap(samples) {
  /** @type {Map<number, number>} */
  const map = new Map();
  const last = samples && samples.length ? samples[samples.length - 1] : null;
  const players = last && last.players ? last.players : null;
  if (!players) return map;
  for (const pid in players) {
    const c = /** @type {*} */ (players[pid])?.continent;
    if (typeof c === "number") map.set(Number(pid), c);
  }
  return map;
}

/**
 * Compute display names for a (merged) war set, keyed by warUniqueID, so every
 * surface - the timeline, the War Graphs picker, and the War Graphs header - can
 * show the SAME fancy name (recurrence ordinals + world-war numbering included).
 * Callers pass the SAME full merged set so the names agree.
 * @param {*[]} wars The merged wars.
 * @param {Snapshot[]} samples The sample stream.
 * @returns {Map<number, string>} warUniqueID → display name.
 */
export function nameMergedWars(wars, samples) {
  const latestTurn = samples && samples.length ? (samples[samples.length - 1].turn ?? 0) : 0;
  const turnYearMap = buildStackTurnYears(samples);
  const continentMap = buildContinentMap(samples);
  const overrides = buildWarNameOverrides(wars, turnYearMap, latestTurn, continentMap);
  /** @type {Map<number, string>} */
  const byId = new Map();
  for (const [w, name] of overrides) {
    if (typeof w.warUniqueID === "number") byId.set(w.warUniqueID, name);
  }
  return byId;
}

/**
 * Build the per-war display-name override map: ordinal-numbered recurring
 * matchups, regional/great/world labels (by geography), and duration flair.
 * @param {*[]} filtered The filtered wars.
 * @param {Map<number, string>} turnYearMap chart-turn → year map.
 * @param {number} latestTurn The latest sampled turn.
 * @param {Map<number, number>} continentMap pid → home-continent type.
 * @returns {Map<*, string>} war → display label.
 */
export function buildWarNameOverrides(filtered, turnYearMap, latestTurn, continentMap) {
  /** @type {Map<*, string>} */
  const nameOverride = new Map();
  // Count prior wars with the EXACT same participant set so we can
  // ordinal-number recurring matchups ("Second Roman-Carthaginian War").
  /** @type {Map<string, number>} */
  const pairCounts = new Map();
  /** @type {*[]} */
  const worldWars = []; // chronological order (for "World War N")
  const sorted = filtered.slice().sort((a, b) => (a.startTurn || 0) - (b.startTurn || 0));

  const flair = buildDurationFlairContext(sorted, latestTurn);

  let flairCount = 0;
  for (const w of sorted) {
    const n = majorsOnSide(w.sideACivs).length + majorsOnSide(w.sideBCivs).length;
    let label = composeWarLabel(w, pairCounts, worldWars, continentMap);
    if (n < 6 && flair.warTurns(w) >= flair.flairCut) {
      label = epicWarLabel(label, w, turnYearMap, latestTurn);
      flairCount++;
    }
    nameOverride.set(w, label);
  }
  dlog(
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
 * Build duration-flair calibration stats and helpers.
 * @param {*[]} sorted Wars sorted by start turn.
 * @param {number} latestTurn Latest sampled turn.
 * @returns {{ warTurns: (w: *) => number, durations: number[], median: number,
 *   flairCut: number }} Flair context.
 */
function buildDurationFlairContext(sorted, latestTurn) {
  const warTurns = (/** @type {*} */ w) =>
    Math.max(1, (typeof w.endTurn === "number" ? w.endTurn : latestTurn) - w.startTurn);
  const durations = sorted
    .filter((w) => majorsOnSide(w.sideACivs).length + majorsOnSide(w.sideBCivs).length < 6)
    .map(warTurns)
    .sort((a, b) => a - b);
  const median = durations.length ? durations[Math.floor((durations.length - 1) / 2)] : 0;
  const PEACE_MIN_TURNS = 10;
  const flairCut = Math.max(PEACE_MIN_TURNS * 2, Math.round(median * 1.5));
  return { warTurns, durations, median, flairCut };
}

/**
 * Build the epic-duration war label, named by the war's actual in-game year
 * span (the in-world timeline players recognize) rounded to a clean figure. The
 * iconic "Hundred Years' War" is kept for spans that round to ~100; otherwise an
 * accurate, varied "(N-Year War)" suffix so names don't all read the same.
 * @param {string} base The base war label.
 * @param {*} w The war record.
 * @param {Map<number, string>} turnYearMap chart-turn → year map.
 * @param {number} latestTurn The latest sampled turn.
 * @returns {string} The flaired label.
 */
function epicWarLabel(base, w, turnYearMap, latestTurn) {
  const yrs = warDurationYears(w, turnYearMap, latestTurn);
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
 * UPGRADES a name once the data exists - never falsely claims a world war.
 * @param {*[]} civs The major roster entries.
 * @param {Map<number, number>} continentMap pid → home-continent type.
 * @returns {number} The distinct continent count.
 */
function distinctContinents(civs, continentMap) {
  const set = new Set();
  for (const c of civs) {
    const cont = continentMap.get(Number(c.pid));
    if (cont !== undefined && cont !== null) set.add(cont);
  }
  return set.size;
}

/**
 * Name a large (4+ major) war by geography: a true World War only when 6+ majors
 * span 2+ continents; a multi-continent "Great War" otherwise when 2+ continents;
 * and a single-continent fight is a "Regional War". Advances the world-war count.
 * @param {Object} args The naming inputs.
 * @param {*} args.w The war record.
 * @param {*[]} args.a Side A majors.
 * @param {*[]} args.b Side B majors.
 * @param {string[]} args.adjA Side A adjectives.
 * @param {string[]} args.adjB Side B adjectives.
 * @param {number} args.n Total major count.
 * @param {*[]} args.worldWars World-war list (mutated, for numbering).
 * @param {Map<number, number>} args.continentMap pid → home-continent type.
 * @returns {string} The label.
 */
function largeWarLabel(args) {
  const { w, a, b, adjA, adjB, n, worldWars, continentMap } = args;
  const continents = distinctContinents(a.concat(b), continentMap);
  if (n >= 6 && continents >= 2) {
    worldWars.push(w);
    const idx = worldWars.length;
    // Pass both numeral forms; each language's template picks one.
    return t("LOC_DEMOGRAPHICS_WARNAME_WORLD", romanize(idx), ordinalWord(idx));
  }
  if (continents >= 2) return t("LOC_DEMOGRAPHICS_WARNAME_GREAT", adjA[0], adjB[0], n - 2);
  return t("LOC_DEMOGRAPHICS_WARNAME_REGIONAL", adjA[0], adjB[0], n - 2);
}

/**
 * Compose a war's base name by participant count + geography (world / great /
 * regional / tripartite / bilateral / fallback), advancing the pair-count and
 * world-war state.
 * @param {*} w The war record.
 * @param {Map<string, number>} pairCounts Recurring-matchup counts (mutated).
 * @param {*[]} worldWars World-war list (mutated, for numbering).
 * @param {Map<number, number>} continentMap pid → home-continent type.
 * @returns {string} The base label.
 */
function composeWarLabel(w, pairCounts, worldWars, continentMap) {
  const a = majorsOnSide(w.sideACivs);
  const b = majorsOnSide(w.sideBCivs);
  const n = a.length + b.length;
  // Pass the FULL roster object so civAdjective can use civTypeString.
  const adjA = a.map((r) => civAdjective(r));
  const adjB = b.map((r) => civAdjective(r));
  // A war has two sides, so 3+ majors is ALWAYS a coalition (e.g. 1-vs-2), never a
  // true three-way "tripartite" war (which this two-sided model can't represent).
  // Route it to the coalition namer ("Regional/Great <A>-<B> War (+N others)").
  if (n >= 3) return largeWarLabel({ w, a, b, adjA, adjB, n, worldWars, continentMap });
  return smallWarLabel({ n, adjA, adjB, pairCounts, w });
}

/**
 * Emit a recurring-matchup ordinal label: looks up how many times `key` has
 * been seen, advances it, and composes `template` with the ordinal word + the
 * given adjective params. Shared by the bilateral and single-belligerent namers
 * so the same matchup gets "First…", "Second…" prefixes on reruns.
 * @param {Map<string, number>} pairCounts Recurring-matchup counts (mutated).
 * @param {string} key Stable matchup key.
 * @param {string} template WARNAME LOC key.
 * @param {...string} adjs Adjective params for the template.
 * @returns {string} The composed label.
 */
function recurringOrdinalLabel(pairCounts, key, template, ...adjs) {
  const count = (pairCounts.get(key) || 0) + 1;
  pairCounts.set(key, count);
  return t(template, ordinalWord(count), ...adjs);
}

/**
 * Name a small (1-2 major) war: standard bilateral, single-belligerent (a major
 * vs only city-states / independents), or the persisted fallback when there are
 * no majors at all. All localized so no English name leaks to non-English UIs.
 * @param {{ n: number, adjA: string[], adjB: string[],
 *   pairCounts: Map<string, number>, w: * }} args Naming inputs.
 * @returns {string} The label.
 */
function smallWarLabel({ n, adjA, adjB, pairCounts, w }) {
  const unknown = t("LOC_DEMOGRAPHICS_WARNAME_UNKNOWN_ADJ");
  if (n === 2) {
    // Stable adjective key (alpha order) so reruns get ordinal prefixes.
    const pair = [adjA[0] || unknown, adjB[0] || unknown].sort();
    return recurringOrdinalLabel(
      pairCounts, pair.join("|"), "LOC_DEMOGRAPHICS_WARNAME_BILATERAL", pair[0], pair[1]);
  }
  if (n === 1) {
    const adj = adjA[0] || adjB[0] || unknown;
    return recurringOrdinalLabel(pairCounts, adj, "LOC_DEMOGRAPHICS_WARNAME_SINGLE", adj);
  }
  return w.name; // no majors at all — persisted fallback (essentially never shown)
}

/**
 * The display label for a war bar: its name plus a duration-in-years suffix.
 * @param {*} war The war record.
 * @param {Map<*, string>} nameOverride war → display label.
 * @param {Map<number, string>} turnYearMap chart-turn → year map.
 * @param {number} latestTurn The latest sampled turn.
 * @returns {string} The composed label.
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
