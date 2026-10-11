// settlements-data.js
//
// Live snapshot of every settlement in the world for the Settlements view.
// Unlike the rest of the mod (which renders sampled history), this reads the
// current engine state at render time, so a settlement ranks by its real
// numbers whatever its city/town status is this age.
//
// Engine surface (all defensive; the inter-module boundary can throw mid
// age-transition):
//   Players.getAlive()                              - every alive player handle
//   player.id / player.Cities.getCities()           - the player's settlement handles
//                                                     (getCities returns handles, not ids)
//   city.name / city.isTown / city.population        - identity + size
//   city.Yields.getNetYield(YieldTypes.YIELD_*)      - per-yield output
//   city.Constructibles.getNumWonders()              - completed-wonder count
//   city.Constructibles.getIdsOfClass("WONDER")      - completed wonders (for icons)
//   UI.Player.getPrimaryColorValueAsString(pid)      - owner banner colors
//   GameInfo.Leaders/Civilizations.lookup(rawType)   - owner display identity

import { tPlayerFallback } from "/demographics/ui/core/demographics-i18n.js";
import { scaleCityPopulationAt } from "/demographics/ui/metrics/demographics-metrics-helpers.js";
import { getFounded, getCityTrend } from "/demographics/ui/screen-demographics/settlements/settlements-trace.js";
import { applyPopulationVarianceAndEnsureUnique }
  from "/demographics/ui/screen-demographics/settlements/settlements-population-variance.js";
import { attachHolyCities } from "/demographics/ui/screen-demographics/settlements/settlements-holy.js";
import { localHasMet } from "/demographics/ui/screen-demographics/settlements/settlements-met.js";
import { preferReadableColor, safeTextColor } from "/demographics/ui/core/civ-color-utils.js";
import { makeLogger } from "/demographics/ui/core/demographics-log.js";

/**
 * One settlement's resolved owner identity for graphical display.
 * @typedef {Object} SettlementOwner
 * @property {number} pid Owner player id.
 * @property {string} leaderName Localized leader display name (or "Player N").
 * @property {string} [civName] Localized civilization name.
 * @property {string} [leaderType] Canonical "LEADER_*" string (for portraits).
 * @property {string} [primary] Banner primary color (css string).
 * @property {string} [secondary] Banner secondary color (css string).
 * @property {string} [readable] Background-safe accent color (history-chart rule).
 * @property {boolean} isMajor Whether the owner is a major civilization.
 * @property {boolean} [met]
 *   Whether the local player has met this owner (undefined when unreadable).
 */

/**
 * One settlement record with its outputs, composite score, and per-output ranks.
 * @typedef {Object} Settlement
 * @property {string} id Stable key ("pid:x,y" by plot, else "pid:idx").
 * @property {string} name Settlement display name.
 * @property {boolean} isTown Whether it is currently a town (vs a city).
 * @property {boolean} [isCapital] Whether it is the owner's capital.
 * @property {string|null} [locId] Plain "x,y" plot key (founding/trend lookups).
 * @property {{x: number, y: number}|null} [location] Plot location (for the map camera).
 * @property {boolean} [explored] Whether the settlement's city center is revealed (camera gate).
 * @property {*} [componentId] City ComponentID (`city.id`) for `Cities.get` / `lookAtID`.
 * @property {number} population Total population.
 * @property {number} [urban] Urban sub-population (real signal for estimate variation).
 * @property {number} [rural] Rural sub-population (real signal for estimate variation).
 * @property {number} [populationEstimate] World-estimate population (scaleCityPopulationAt).
 * @property {SettlementOwner} owner Resolved owner identity.
 * @property {Record<string, number>} outputs Per-output value, keyed by output id.
 * @property {Array<{type: string, icon: string, nameKey: string,
 *   location: {x: number, y: number}|null, year?: string}>} [wonders]
 *   Completed wonders (confirmed); `year` is stamped by settlements-wonder-years.js.
 * @property {{religionName: string, icon: string}|null} [holy]
 *   The religion this settlement is the holy city of (settlements-holy.js), or null.
 * @property {boolean} [archived] True for an end-of-age archive record (no live handle).
 * @property {number} [districts] Count of DISTRICT-class constructibles in the settlement.
 * @property {number} [buildings] Count of BUILDING-class constructibles in the settlement.
 * @property {string[]} [buildingTypes] Localized names of the settlement's buildings (drill-down).
 * @property {{type:string, name:string, percent:number|null, turnsLeft:number|null}|null}
 *   [wonderInProgress] The wonder this settlement is currently building, with progress.
 * @property {*} [_city] The live city handle (for on-demand quarter reads); not persisted.
 * @property {{turn: number, year: string, exact: boolean}|null} [founded]
 *   Founding (exact via event, else approx).
 * @property {{popGrowthPerTurn: number, dir: number, samples: number}|null}
 *   [trend] Population trend.
 * @property {number} composite Composite score (0-100) across the economic outputs.
 * @property {Record<string, number>} ranks 1-based rank per output id (and "composite").
 */

/**
 * The output columns shown/ranked for each settlement. `yieldType` is the YieldTypes
 * enum key (null for handle-read columns), `composite` flags outputs folded into
 * the overall score and `weight` is their relative contribution (yields 1,
 * wonders 2). Population, happiness and influence are ranked as columns but
 * excluded from the composite because they are not per-settlement economic output.
 * @type {Array<{ id: string, yieldType: string|null, label: string, icon: string,
 *   composite: boolean, weight: number }>}
 */
export const SETTLEMENT_OUTPUTS = [
  { id: "population", yieldType: null, label: "LOC_DEMOGRAPHICS_SETTLEMENTS_COL_POP",
    icon: "blp:Yield_Population", composite: false, weight: 0 },
  { id: "food", yieldType: "YIELD_FOOD", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_COL_FOOD",
    icon: "blp:Yield_Food", composite: true, weight: 1 },
  { id: "production", yieldType: "YIELD_PRODUCTION", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_COL_PROD",
    icon: "blp:Yield_Production", composite: true, weight: 1 },
  { id: "gold", yieldType: "YIELD_GOLD", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_COL_GOLD",
    icon: "blp:Yield_Gold", composite: true, weight: 1 },
  { id: "science", yieldType: "YIELD_SCIENCE", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_COL_SCIENCE",
    icon: "blp:Yield_Science", composite: true, weight: 1 },
  { id: "culture", yieldType: "YIELD_CULTURE", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_COL_CULTURE",
    icon: "blp:Yield_Culture", composite: true, weight: 1 },
  // Influence uses the engine's lowercase icon key (yield-icons.xml maps
  // YIELD_DIPLOMACY -> blp:yield_influence, unlike the capitalized Yield_* keys).
  { id: "influence", yieldType: "YIELD_DIPLOMACY", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_COL_INFLUENCE",
    icon: "blp:yield_influence", composite: false, weight: 0 },
  { id: "wonders", yieldType: null, label: "LOC_DEMOGRAPHICS_SETTLEMENTS_COL_WONDERS",
    icon: "blp:fonticon_wonders", composite: true, weight: 2 },
  { id: "happiness", yieldType: "YIELD_HAPPINESS", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_COL_HAPPY",
    icon: "blp:Yield_Happiness", composite: false, weight: 0 }
];

const log = makeLogger("settlements");

/**
 * Resolve a YieldTypes enum value for a `YIELD_*` key, or undefined.
 * @param {string} key
 * @returns {number|string|undefined}
 */
function yieldEnum(key) {
  try {
    if (typeof YieldTypes !== "undefined" && YieldTypes != null) {
      const value = YieldTypes[key];
      if (typeof value === "number" || typeof value === "string") return value;
    }
  } catch (_) {
    // YieldTypes[key] can throw if the enum global is absent; treat as unavailable.
  }
  return undefined;
}

/**
 * Localize a tag/string via Locale.compose, returning the input unchanged when
 * Locale is unavailable or throws.
 * @param {*} tag The tag or plain string.
 * @param {...*} args
 * @returns {string} The composed string ("" for falsy input).
 */
function compose(tag, ...args) {
  if (!tag) return "";
  try {
    if (typeof Locale !== "undefined" && typeof Locale.compose === "function") {
      return Locale.compose(tag, ...args);
    }
  } catch (_) {
    // Locale.compose can throw on a malformed tag; fall back to the raw tag.
  }
  return typeof tag === "string" ? tag : "";
}

/**
 * Defensively read a GameInfo table by name (the global may be absent).
 * @param {string} name The table name (e.g. "Leaders").
 * @returns {*} The table, or null.
 */
function gameInfoTable(name) {
  try {
    return typeof GameInfo !== "undefined" && GameInfo ? GameInfo[name] : null;
  } catch (_) {
    return null;
  }
}

/**
 * Look up a GameInfo row by raw type (numeric hash or string), defensively.
 * @param {*} table The GameInfo table (e.g. GameInfo.Leaders).
 * @param {*} raw
 * @returns {*} The row, or null.
 */
function lookupRow(table, raw) {
  try {
    if (table && typeof table.lookup === "function" && raw !== undefined && raw !== null) {
      return table.lookup(raw);
    }
  } catch (_) {
    // GameInfo.<table>.lookup can throw for an unknown hash; treat as missing.
  }
  return null;
}

/**
 * Read one player's banner color via the named UI.Player accessor.
 * @param {number} pid
 * @param {string} accessorName The UI.Player method name.
 * @returns {string|undefined}
 */
function playerColor(pid, accessorName) {
  try {
    if (typeof UI !== "undefined" && UI.Player && typeof UI.Player[accessorName] === "function") {
      const color = UI.Player[accessorName](pid);
      if (typeof color === "string" && color.length > 0) return color;
    }
  } catch (_) {
    // UI.Player.get*ColorValueAsString can throw for an unresolved player.
  }
  return undefined;
}

/**
 * Resolve the canonical "LEADER_*" portrait type from a leader row / raw value,
 * or undefined when neither yields a usable LEADER_* string.
 * @param {*} leaderRow The GameInfo.Leaders row (or null).
 * @param {*} rawLeader The raw leader type off the handle.
 * @returns {string|undefined}
 */
function canonicalLeaderType(leaderRow, rawLeader) {
  const leaderType =
    typeof leaderRow?.LeaderType === "string"
      ? leaderRow.LeaderType
      : typeof rawLeader === "string"
        ? rawLeader
        : undefined;
  return leaderType && /^LEADER_/.test(leaderType) ? leaderType : undefined;
}

/**
 * Read a raw type value off a handle, trying two property spellings.
 * @param {*} handle The player handle.
 * @param {string} keyA
 * @param {string} keyB
 * @returns {*} The raw value, or undefined.
 */
function rawType(handle, keyA, keyB) {
  return handle?.[keyA] ?? handle?.[keyB];
}

/**
 * Resolve a settlement owner's display identity from a live player handle.
 * @param {number} pid The owner player id.
 * @param {*} handle The player handle.
 * @returns {SettlementOwner}
 */
function resolveOwner(pid, handle) {
  const rawLeader = rawType(handle, "leaderType", "LeaderType");
  const leaderRow = lookupRow(gameInfoTable("Leaders"), rawLeader);
  const civRow = lookupRow(gameInfoTable("Civilizations"), rawType(handle, "civilizationType", "CivilizationType"));
  const primary = playerColor(pid, "getPrimaryColorValueAsString");
  const secondary = playerColor(pid, "getSecondaryColorValueAsString");
  const major = !!handle?.isMajor;
  // Independent (non-major) owners surface from the engine as "Villages"; always
  // present them as "City-State" instead (project-wide terminology).
  return {
    pid,
    leaderName: major ? compose(leaderRow?.Name) || tPlayerFallback(pid) : compose("LOC_DEMOGRAPHICS_CITY_STATE"),
    civName: major ? compose(civRow?.Name) || undefined : undefined,
    leaderType: canonicalLeaderType(leaderRow, rawLeader),
    primary,
    secondary,
    // Background-safe accent color (same rule as the history line chart) so a
    // black civ color never vanishes against the dark UI.
    readable: readableAccent(primary, secondary),
    isMajor: major,
    met: localHasMet(pid)
  };
}

/**
 * Resolve one constructible handle by component id.
 * @param {*} componentId
 * @returns {*|null}
 */
function constructibleById(componentId) {
  if (typeof Constructibles === "undefined") return null;
  if (typeof Constructibles.getByComponentID !== "function") return null;
  return Constructibles.getByComponentID(componentId);
}

/**
 * Resolve Constructibles table info for a constructible type.
 * @param {*} type
 * @returns {*|null}
 */
function constructibleInfo(type) {
  const table = gameInfoTable("Constructibles");
  if (!table || typeof table.lookup !== "function") return null;
  return table.lookup(type);
}

/**
 * Background-safe accent for a civ: safeTextColor(preferReadableColor(primary,
 * secondary)). Falls back to the raw primary when the helpers can't resolve.
 * @param {string|undefined} primary
 * @param {string|undefined} secondary
 * @returns {string|undefined}
 */
function readableAccent(primary, secondary) {
  try {
    const preferred = preferReadableColor(primary, secondary);
    return safeTextColor(preferred) || preferred || primary;
  } catch (_) {
    return primary;
  }
}

/**
 * Read one net yield off a settlement's Yields handle.
 * @param {*} yields The city.Yields handle.
 * @param {string|null} yieldTypeKey The YieldTypes enum key.
 * @returns {number} The yield value (0 when unreadable).
 */
function readYield(yields, yieldTypeKey) {
  if (!yieldTypeKey || !yields || typeof yields.getNetYield !== "function") return 0;
  const yieldEnumValue = yieldEnum(yieldTypeKey);
  if (yieldEnumValue === undefined) return 0;
  try {
    const raw = yields.getNetYield(yieldEnumValue);
    return typeof raw === "number" && isFinite(raw) ? raw : 0;
  } catch (_) {
    // city.Yields.getNetYield can throw for a stale handle; treat as 0.
    return 0;
  }
}

/**
 * Read one output column's value off a settlement handle.
 * @param {{ id: string, yieldType: string|null }} col The output descriptor.
 * @param {*} city The city/town handle.
 * @param {*} yields The city.Yields handle.
 * @returns {number}
 */
function readOutput(col, city, yields) {
  if (col.id === "population") return readPopulation(city);
  if (col.id === "wonders") return readWonders(city);
  return readYield(yields, col.yieldType);
}

/**
 * Read one settlement handle's per-output values.
 * @param {*} city The city/town handle.
 * @returns {Record<string, number>} Output id → value (0 when unreadable).
 */
function readOutputs(city) {
  /** @type {Record<string, number>} */
  const out = {};
  const yields = city?.Yields;
  for (const col of SETTLEMENT_OUTPUTS) out[col.id] = readOutput(col, city, yields);
  return out;
}

/**
 * Read a settlement's completed-wonder count off its Constructibles handle.
 * @param {*} city The city/town handle.
 * @returns {number} The wonder count (0 when unreadable).
 */
function readWonders(city) {
  try {
    const constructibles = city?.Constructibles;
    if (constructibles && typeof constructibles.getNumWonders === "function") {
      const count = constructibles.getNumWonders();
      if (typeof count === "number" && isFinite(count)) return count;
    }
  } catch (_) {
    // city.Constructibles.getNumWonders() can throw for a stale handle; treat as 0.
  }
  return 0;
}

/**
 * Read a settlement's total population, falling back to urban+rural.
 * @param {*} city The city/town handle.
 * @returns {number} The population (0 when unreadable).
 */
function readPopulation(city) {
  try {
    if (typeof city?.population === "number" && isFinite(city.population)) return city.population;
    const urban = typeof city?.urbanPopulation === "number" ? city.urbanPopulation : 0;
    const rural = typeof city?.ruralPopulation === "number" ? city.ruralPopulation : 0;
    return urban + rural;
  } catch (_) {
    return 0;
  }
}

/**
 * Read a city's urban or rural sub-population defensively (0 when unreadable). Used as a
 * real-signal input for population-estimate variation (urban:rural ratio).
 * @param {*} city
 * @param {"urbanPopulation"|"ruralPopulation"} prop
 * @returns {number} The value (0 on miss/throw).
 */
function readSubPopulation(city, prop) {
  try {
    const value = city?.[prop];
    return typeof value === "number" && isFinite(value) ? value : 0;
  } catch (_) {
    return 0;
  }
}

/**
 * Stable key for a settlement: its plot ("pid:x,y", stable across capture), else
 * its index within the owner's list.
 * @param {number} pid
 * @param {*} city
 * @param {number} idx The index fallback.
 * @returns {string}
 */
function settlementKey(pid, city, idx) {
  try {
    const loc = city?.location;
    if (loc && typeof loc.x === "number" && typeof loc.y === "number") return pid + ":" + loc.x + "," + loc.y;
  } catch (_) {
    // location access can throw; fall back to the index.
  }
  return pid + ":#" + idx;
}

/**
 * Board build options.
 * @typedef {Object} BoardOptions
 * @property {boolean} [lite] Skip the drill-down-only reads (building names,
 *   wonder in progress) that no persisted/archived field uses. The sampler's
 *   per-turn end-of-age archive builds the board this way; the render path never does.
 */

/**
 * Build one settlement record from a city handle (no composite/ranks yet).
 * @param {*} city The city/town handle.
 * @param {number} pid
 * @param {SettlementOwner} owner
 * @param {number} idx The index within the owner's list.
 * @param {boolean} [lite] Skip the drill-down-only reads (see BoardOptions).
 * @returns {Settlement|null} The record, or null when unreadable.
 */
function buildSettlement(city, pid, owner, idx, lite) {
  if (!city) return null;
  // "LOC_CITY_NAME_UNSET" is a base-game LOC tag (see BASE_GAME_LOC_KEYS in demographics-i18n.js).
  const name = compose(safeStr(() => city.name)) || compose("LOC_CITY_NAME_UNSET") || "—";
  const locId = plotKey(city);
  const population = readPopulation(city);
  const buildingNames = lite ? [] : readConstructibleNames(city, "BUILDING");
  return {
    id: settlementKey(pid, city, idx),
    locId,
    location: readLocation(city),
    explored: readExplored(city),
    componentId: readComponentId(city),
    name,
    isTown: safeBool(() => city.isTown),
    isCapital: safeBool(() => city.isCapital),
    population,
    urban: readSubPopulation(city, "urbanPopulation"),
    rural: readSubPopulation(city, "ruralPopulation"),
    populationEstimate: scaleCityPopulationAt(population, currentTurn(), currentAgeType(), currentAgeProgressPct()),
    owner,
    outputs: readOutputs(city),
    wonders: readWonderList(city),
    districts: countConstructibleClass(city, "DISTRICT"),
    buildings: lite ? countConstructibleClass(city, "BUILDING") : buildingNames.length,
    buildingTypes: buildingNames,
    wonderInProgress: lite ? null : readWonderInProgress(city),
    _city: city,
    founded: getFounded(locId),
    trend: getCityTrend(locId),
    composite: 0,
    ranks: {}
  };
}

/**
 * Read a settlement's plot location {x,y} for the map camera, or null.
 * @param {*} city
 * @returns {{x: number, y: number}|null}
 */
function readLocation(city) {
  try {
    const loc = city?.location;
    if (loc && typeof loc.x === "number" && typeof loc.y === "number") return { x: loc.x, y: loc.y };
  } catch (_) {
    // location access can throw for a stale handle; treat as unknown.
  }
  return null;
}

/**
 * Whether the local player has discovered a settlement, i.e. its city-center
 * tile is revealed (the camera gate). Defaults to true on any uncertainty so
 * the camera isn't grayed out spuriously.
 * @param {*} city
 * @returns {boolean}
 */
function readExplored(city) {
  try {
    const pid = typeof GameContext !== "undefined" ? GameContext.localPlayerID : undefined;
    if (!canQueryReveal(pid)) return true;
    const loc = city && city.location;
    if (!loc || typeof loc.x !== "number") return true;
    return tileRevealed(pid, loc.x, loc.y);
  } catch (_) {
    return true; // never block the camera on a query failure
  }
}

/**
 * Whether the reveal-state API can be queried for the given player.
 * @param {*} pid
 * @returns {boolean}
 */
function canQueryReveal(pid) {
  return pid !== undefined && typeof GameplayMap !== "undefined" && !!GameplayMap.getRevealedState;
}

/**
 * Whether a tile is revealed (not in fog) for the player.
 * @param {*} pid
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function tileRevealed(pid, x, y) {
  const hidden = typeof RevealedStates !== "undefined" ? RevealedStates.HIDDEN : 0;
  return GameplayMap.getRevealedState(pid, x, y) !== hidden;
}

/**
 * Read a settlement's ComponentID (`city.id`) - a serializable {owner,id,type}
 * struct used to re-resolve a live handle (`Cities.get`) and to target the
 * camera (`UI.Player.lookAtID`). Returns null when unreadable.
 * @param {*} city
 * @returns {*}
 */
function readComponentId(city) {
  try {
    const componentId = city?.id;
    if (componentId && typeof componentId === "object") return componentId;
  } catch (_) {
    // city.id access can throw for a stale handle; treat as unknown.
  }
  return null;
}

/**
 * Plain "x,y" plot key (matches the trace store's key; distinct from the
 * pid-prefixed settlementKey used for marker dedupe).
 * @param {*} city
 * @returns {string|null} The key, or null.
 */
function plotKey(city) {
  try {
    const loc = city?.location;
    if (loc && typeof loc.x === "number" && typeof loc.y === "number") return loc.x + "," + loc.y;
  } catch (_) {
    // location access can throw; treat as unknown.
  }
  return null;
}

/**
 * Boolean engine read, false on throw.
 * @param {() => *} fn
 * @returns {boolean}
 */
function safeBool(fn) {
  try {
    return !!fn();
  } catch (_) {
    return false;
  }
}

/**
 * String engine read, "" on throw/non-string (a city handle mid-transition can
 * throw on any property).
 * @param {() => *} fn
 * @returns {string} The string, or "".
 */
function safeStr(fn) {
  try {
    const value = fn();
    return typeof value === "string" ? value : "";
  } catch (_) {
    return "";
  }
}

function currentTurn() {
  try {
    if (typeof Game !== "undefined" && typeof Game.turn === "number") return Game.turn;
  } catch (_) {
    // Game.turn can throw mid-transition.
  }
  return 0;
}

/**
 * The current age type ("AGE_ANTIQUITY", ...), or undefined when unreadable.
 * @returns {string|undefined}
 */
export function currentAgeType() {
  try {
    if (typeof Game === "undefined" || Game.age === undefined) return undefined;
    if (typeof GameInfo === "undefined" || typeof GameInfo?.Ages?.lookup !== "function") return undefined;
    const row = GameInfo.Ages.lookup(Game.age);
    return row?.AgeType || undefined;
  } catch (_) {
    // Game.age / GameInfo.Ages.lookup() can be absent or throw mid-transition.
    return undefined;
  }
}

function ageProgressValue(/** @type {*} */ ageProgress, /** @type {string} */ method) {
  if (!ageProgress || typeof ageProgress[method] !== "function") return undefined;
  const value = ageProgress[method]();
  return typeof value === "number" && isFinite(value) ? value : undefined;
}

function currentAgeProgressPct() {
  try {
    const ageProgress = typeof Game !== "undefined" ? Game.AgeProgressManager : null;
    const cur = ageProgressValue(ageProgress, "getCurrentAgeProgressionPoints");
    const max = ageProgressValue(ageProgress, "getMaxAgeProgressionPoints");
    if (cur === undefined || max === undefined || max <= 0) return undefined;
    return (cur / max) * 100;
  } catch (_) {
    return undefined;
  }
}

/**
 * Read a settlement's completed wonders as { type, icon, nameKey } for the card
 * icon row. Engine-owned, so these are confirmed (not inferred).
 * @param {*} city
 * @returns {Array<{type: string, icon: string, nameKey: string,
 *   location: {x: number, y: number}|null}>} The wonders.
 */
function readWonderList(city) {
  /**
   * @type {Array<{type: string, icon: string, nameKey: string,
   *   location: {x: number, y: number}|null}>}
   */
  const out = [];
  for (const id of constructibleIds(city, "WONDER")) {
    const wonder = resolveWonder(id);
    if (wonder) out.push(wonder);
  }
  return out;
}

/**
 * A settlement's placed constructible component ids of a class ([] when unreadable).
 * @param {*} city
 * @param {string} className
 * @returns {*[]}
 */
function constructibleIds(city, className) {
  const constructibles = city?.Constructibles;
  return safeBool(() => typeof constructibles?.getIdsOfClass === "function")
    ? safeArr(() => constructibles.getIdsOfClass(className)) : [];
}

/**
 * Count a settlement's constructibles of a class (DISTRICT / BUILDING / WONDER).
 * @param {*} city
 * @param {string} className
 * @returns {number}
 */
function countConstructibleClass(city, className) {
  return constructibleIds(city, className).length;
}

/**
 * Read a settlement's constructibles of a class as localized display names (for
 * the drill-down; one entry per placed constructible, duplicates kept).
 * @param {*} city
 * @param {string} className The constructible class ("BUILDING" | "DISTRICT").
 * @returns {string[]} The localized names.
 */
function readConstructibleNames(city, className) {
  const out = [];
  for (const componentId of constructibleIds(city, className)) {
    const name = constructibleName(componentId);
    if (name) out.push(name);
  }
  return out;
}

/**
 * One placed constructible's localized display name, or "" when the handle or
 * its table row is unreadable (a stale component id can make either lookup
 * throw; guarded per entry like resolveWonder so one bad id skips one name).
 * @param {*} componentId
 * @returns {string} The name, or "".
 */
function constructibleName(componentId) {
  try {
    const constructible = constructibleById(componentId);
    const info = constructible && constructibleInfo(constructible.type);
    if (!info) return "";
    const name = (info.Name && compose(info.Name)) || info.ConstructibleType;
    return typeof name === "string" ? name : "";
  } catch (_) {
    // Constructibles.getByComponentID / GameInfo.Constructibles.lookup threw; skip this one.
    return "";
  }
}

/**
 * The wonder a settlement is currently building (from its BuildQueue), with
 * progress, or null. Reads `city.BuildQueue.currentProductionTypeHash` and
 * `getPercentComplete` / `currentTurnsLeft` (base-game production API).
 * @param {*} city
 * @returns {{type:string, name:string, percent:number|null, turnsLeft:number|null}|null}
 */
function readWonderInProgress(city) {
  try {
    const buildQueue = city && city.BuildQueue;
    if (!buildQueue || buildQueue.isEmpty) return null;
    const hash = buildQueue.currentProductionTypeHash;
    const info = constructibleInfo(hash);
    if (!info || info.ConstructibleClass !== "WONDER") return null;
    const name = (info.Name && compose(info.Name)) || info.ConstructibleType;
    const percent = percentComplete(buildQueue, hash);
    return { type: info.ConstructibleType, name, percent, turnsLeft: turnsLeftOf(buildQueue) };
  } catch (_) {
    return null;
  }
}

/**
 * @param {*} buildQueue
 * @param {*} hash
 * @returns {number|null} Percent complete (0-100), clamped.
 */
function percentComplete(buildQueue, hash) {
  const pct = Number(buildQueue.getPercentComplete(hash));
  return isFinite(pct) ? Math.max(0, Math.min(100, Math.round(pct))) : null;
}

/**
 * @param {*} buildQueue
 * @returns {number|null}
 */
function turnsLeftOf(buildQueue) {
  const turns = Number(buildQueue.currentTurnsLeft);
  return isFinite(turns) && turns >= 0 ? turns : null;
}

/**
 * Array engine read, [] on throw/non-array.
 * @param {() => *} fn
 * @returns {Array<*>}
 */
function safeArr(fn) {
  try {
    const value = fn();
    return Array.isArray(value) ? value : [];
  } catch (_) {
    return [];
  }
}

/**
 * Resolve one wonder ComponentID to { type, icon, nameKey, location }, or null
 * when it is not a complete wonder / unresolvable. `location` (the wonder's plot)
 * lets the camera tour fly to individual wonders.
 * @param {*} componentId The constructible ComponentID.
 * @returns {{type: string, icon: string, nameKey: string,
 *   location: {x: number, y: number}|null}|null}
 */
function resolveWonder(componentId) {
  try {
    const constructible = constructibleById(componentId);
    if (!constructible || !constructible.complete) return null;
    const info = constructibleInfo(constructible.type);
    const type = info && info.ConstructibleType;
    if (typeof type !== "string") return null;
    return {
      type,
      icon: wonderIconUrl(type),
      nameKey: info.Name || type,
      location: readLocation(constructible)
    };
  } catch (_) {
    return null;
  }
}

/**
 * The engine icon URL for a wonder constructible type ("" when unavailable).
 * @param {string} type The ConstructibleType.
 * @returns {string} The icon URL, or "".
 */
function wonderIconUrl(type) {
  try {
    if (typeof UI !== "undefined" && typeof UI.getIconURL === "function") {
      return UI.getIconURL(type, "WONDER") || "";
    }
  } catch (_) {
    // UI.getIconURL can be absent/throw.
  }
  return "";
}

/**
 * Defensively read the alive-player list.
 * @returns {Array<*>|null}
 */
function alivePlayers() {
  try {
    return typeof Players !== "undefined" && Players.getAlive ? Players.getAlive() : null;
  } catch (_) {
    // Players.getAlive() can throw mid age-transition.
    return null;
  }
}

/**
 * Append one player's settlement records to `list`.
 * @param {*} player The player handle.
 * @param {Settlement[]} list The accumulating list (mutated).
 * @param {boolean} [lite] Skip the drill-down-only reads (see BoardOptions).
 */
function gatherPlayerSettlements(player, list, lite) {
  const pid = typeof player?.id === "number" ? player.id : undefined;
  if (typeof pid !== "number") return;
  // player.Cities.getCities() returns city handles directly (not ComponentIDs), so
  // each element is used as-is - no Cities.get() lookup.
  const cities = playerCities(player);
  if (!cities.length) return;
  const owner = resolveOwner(pid, player);
  for (let i = 0; i < cities.length; i++) {
    const rec = buildSettlement(cities[i], pid, owner, i, lite);
    if (rec) list.push(rec);
  }
}

/**
 * Gather every settlement of every alive player as raw records (no scores yet).
 * @param {boolean} [lite] Skip the drill-down-only reads (see BoardOptions).
 * @returns {Settlement[]}
 */
function gatherSettlements(lite) {
  /** @type {Settlement[]} */
  const list = [];
  const players = alivePlayers();
  if (!Array.isArray(players)) return list;
  for (const player of players) if (player) gatherPlayerSettlements(player, list, lite);
  applyPopulationVarianceAndEnsureUnique(list);
  attachHolyCities(list);
  log.debug("gathered", list.length, "settlements");
  return list;
}

/**
 * Read a player's settlement handles (getCities returns handles, not ids).
 * @param {*} player
 * @returns {Array<*>} The city/town handles (empty when unreadable).
 */
function playerCities(player) {
  try {
    const cities = player?.Cities;
    if (cities && typeof cities.getCities === "function") {
      const list = cities.getCities();
      if (Array.isArray(list)) return list;
    }
  } catch (_) {
    // player.Cities.getCities() can throw mid age-transition; treat as none.
  }
  return [];
}

/**
 * Compute each settlement's composite score (0-100): a weighted mean of its
 * composite outputs, each normalized to the strongest settlement in that output.
 * Negative values clamp to 0 so one weak output can't sink the score.
 * @param {Settlement[]} list The settlement records (mutated: `composite` set).
 */
function computeComposite(list) {
  const cols = SETTLEMENT_OUTPUTS.filter((c) => c.composite);
  const max = maxByOutput(list, cols);
  let totalWeight = 0;
  for (const col of cols) totalWeight += col.weight || 1;
  for (const settlement of list) settlement.composite = compositeOf(settlement, cols, max, totalWeight);
}

/**
 * The maximum value of each composite output across all settlements.
 * @param {Settlement[]} list The settlement records.
 * @param {Array<{ id: string }>} cols The composite output columns.
 * @returns {Record<string, number>} Output id → max value.
 */
function maxByOutput(list, cols) {
  /** @type {Record<string, number>} */
  const max = {};
  for (const col of cols) {
    let best = 0;
    for (const settlement of list) best = Math.max(best, settlement.outputs[col.id] || 0);
    max[col.id] = best;
  }
  return max;
}

/**
 * One settlement's weighted, normalized composite score (0-100).
 * @param {Settlement} settlement
 * @param {Array<{ id: string, weight: number }>} cols The composite columns.
 * @param {Record<string, number>} max
 * @param {number} totalWeight
 * @returns {number}
 */
function compositeOf(settlement, cols, max, totalWeight) {
  let sum = 0;
  for (const col of cols) {
    const colMax = max[col.id];
    const value = Math.max(0, settlement.outputs[col.id] || 0);
    sum += (colMax > 0 ? value / colMax : 0) * (col.weight || 1);
  }
  return totalWeight > 0 ? (sum / totalWeight) * 100 : 0;
}

/**
 * Assign 1-based ranks for each output (and the composite) across the full set,
 * highest value = rank 1. Stored on each settlement's `ranks` map.
 * @param {Settlement[]} list The settlement records (mutated: `ranks` set).
 */
function computeRanks(list) {
  const keys = ["composite", ...SETTLEMENT_OUTPUTS.map((c) => c.id)];
  for (const key of keys) {
    const sorted = list.slice().sort((a, b) => valueOf(b, key) - valueOf(a, key));
    for (let i = 0; i < sorted.length; i++) sorted[i].ranks[key] = i + 1;
  }
}

/**
 * The sortable numeric value of a settlement for a given output/composite key.
 * @param {Settlement} settlement
 * @param {string} key The output id, or "composite".
 * @returns {number}
 */
export function valueOf(settlement, key) {
  if (key === "composite") return settlement.composite;
  const value = settlement.outputs[key];
  return typeof value === "number" ? value : 0;
}

/**
 * The world settlement board: every settlement scored + ranked, plus the
 * category leader (rank-1 settlement) for each output and the composite.
 * @typedef {Object} SettlementBoard
 * @property {Settlement[]} settlements All settlements, composite-sorted (desc).
 * @property {Record<string, Settlement|null>} leaders
 *   Output id (and "composite") → its rank-1 settlement.
 */

/**
 * Gather, score, and rank every settlement in the world.
 * @param {BoardOptions} [opts] Build options (`lite` for the sampler's archive).
 * @returns {SettlementBoard}
 */
export function buildSettlementBoard(opts) {
  const settlements = gatherSettlements(!!(opts && opts.lite));
  computeComposite(settlements);
  computeRanks(settlements);
  settlements.sort((a, b) => b.composite - a.composite);
  /** @type {Record<string, Settlement|null>} */
  const leaders = {};
  const keys = ["composite", ...SETTLEMENT_OUTPUTS.map((c) => c.id)];
  for (const key of keys) {
    leaders[key] = settlements.find((settlement) => settlement.ranks[key] === 1) || null;
  }
  return { settlements, leaders };
}
