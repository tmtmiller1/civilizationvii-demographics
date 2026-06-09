// settlements-data.js
//
// Live snapshot of every settlement in the world for the Settlements view.
// Unlike the rest of the mod (which renders sampled history), this reads the
// CURRENT engine state at render time: a "top settlements right now" leaderboard.
// A live read is what the feature wants - a settlement's city/town status flips
// across ages, so ranking by current output keeps a former city (now a town)
// wherever its real numbers land, and "settlement" stays the primary unit.
//
// Engine surface (all defensive; the inter-module boundary can throw mid
// age-transition):
//   Players.getAlive()                              - every alive player handle
//   player.id / player.Cities.getCities()           - the player's settlement HANDLES
//                                                     (getCities returns handles, not ids)
//   city.name / city.isTown / city.population        - identity + size
//   city.Yields.getNetYield(YieldTypes.YIELD_*)      - per-yield output
//   city.Constructibles.getNumWonders()              - completed-wonder count
//   city.Constructibles.getIdsOfClass("WONDER")      - completed wonders (for icons)
//   UI.Player.getPrimaryColorValueAsString(pid)      - owner banner colors
//   GameInfo.Leaders/Civilizations.lookup(rawType)   - owner display identity

import { scaleCityPopulationAt } from "/demographics/ui/metrics/demographics-metrics-helpers.js";
import {
  getFounded,
  getCityTrend
} from "/demographics/ui/screen-demographics/settlements/settlements-trace.js";
import { preferReadableColor, safeTextColor } from "/demographics/ui/core/civ-color-utils.js";

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
 *   Whether the LOCAL player has met this owner (undefined when unreadable).
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
 * @property {number} [populationEstimate] World-estimate population (scaleCityPopulationAt).
 * @property {SettlementOwner} owner Resolved owner identity.
 * @property {Record<string, number>} outputs Per-output value, keyed by output id.
 * @property {Array<{type: string, icon: string, nameKey: string,
 *   location: {x: number, y: number}|null}>} [wonders]
 *   Completed wonders (confirmed).
 * @property {{turn: number, year: string, exact: boolean}|null} [founded]
 *   Founding (exact via event, else approx).
 * @property {{popGrowthPerTurn: number, dir: number, samples: number}|null}
 *   [trend] Population trend.
 * @property {number} composite Composite score (0-100) across the economic outputs.
 * @property {Record<string, number>} ranks 1-based rank per output id (and "composite").
 */

/**
 * The output columns shown/ranked for each settlement. `yt` is the YieldTypes
 * enum key (null for handle-read columns: population, wonders). `composite`
 * flags outputs folded into the overall score, and `weight` is their relative
 * contribution: economic yields weigh 1; WONDERS weigh 2 so wonder-rich
 * settlements get a bonus beyond the yields their wonders already emit (the
 * classic "most wonderful city" idea). Population is a size and happiness a
 * state, so both are ranked as columns but excluded from the composite
 * (`composite:false`, `weight:0`).
 * `icon` is the engine BLP icon path (verified present in yield-icons.xml /
 * the fonticon set) so the UI uses real game icons, never tofu glyphs.
 * @type {Array<{ id: string, yt: string|null, label: string, icon: string,
 *   composite: boolean, weight: number }>}
 */
export const SETTLEMENT_OUTPUTS = [
  { id: "population", yt: null, label: "LOC_DEMOGRAPHICS_SETTLEMENTS_COL_POP", icon: "blp:Yield_Population", composite: false, weight: 0 },
  { id: "food", yt: "YIELD_FOOD", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_COL_FOOD", icon: "blp:Yield_Food", composite: true, weight: 1 },
  { id: "production", yt: "YIELD_PRODUCTION", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_COL_PROD", icon: "blp:Yield_Production", composite: true, weight: 1 },
  { id: "gold", yt: "YIELD_GOLD", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_COL_GOLD", icon: "blp:Yield_Gold", composite: true, weight: 1 },
  { id: "science", yt: "YIELD_SCIENCE", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_COL_SCIENCE", icon: "blp:Yield_Science", composite: true, weight: 1 },
  { id: "culture", yt: "YIELD_CULTURE", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_COL_CULTURE", icon: "blp:Yield_Culture", composite: true, weight: 1 },
  { id: "wonders", yt: null, label: "LOC_DEMOGRAPHICS_SETTLEMENTS_COL_WONDERS", icon: "blp:fonticon_wonders", composite: true, weight: 2 },
  { id: "happiness", yt: "YIELD_HAPPINESS", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_COL_HAPPY", icon: "blp:Yield_Happiness", composite: false, weight: 0 }
];

const DBG = false;
/**
 * Debug logger, no-op unless {@link DBG}.
 * @param {...*} a Values to log.
 */
function slog(...a) {
  if (DBG) console.warn("[Demographics.settlements]", ...a);
}

/**
 * Resolve a YieldTypes enum value for a `YIELD_*` key, or undefined.
 * @param {string} key The yield enum key.
 * @returns {number|string|undefined} The enum value, or undefined.
 */
function yieldEnum(key) {
  try {
    if (typeof YieldTypes !== "undefined" && YieldTypes != null) {
      const v = YieldTypes[key];
      if (typeof v === "number" || typeof v === "string") return v;
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
 * @returns {string} The composed string ("" for falsy input).
 */
function compose(tag) {
  if (!tag) return "";
  try {
    if (typeof Locale !== "undefined" && typeof Locale.compose === "function") {
      return Locale.compose(tag);
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
 * @param {*} raw The raw type value.
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
 * @param {number} pid The player id.
 * @param {string} fn The accessor method name.
 * @returns {string|undefined} The color string, or undefined.
 */
function playerColor(pid, fn) {
  try {
    if (typeof UI !== "undefined" && UI.Player && typeof UI.Player[fn] === "function") {
      const c = UI.Player[fn](pid);
      if (typeof c === "string" && c.length > 0) return c;
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
 * @returns {string|undefined} The canonical leader type, or undefined.
 */
function canonicalLeaderType(leaderRow, rawLeader) {
  const s =
    typeof leaderRow?.LeaderType === "string"
      ? leaderRow.LeaderType
      : typeof rawLeader === "string"
        ? rawLeader
        : undefined;
  return s && /^LEADER_/.test(s) ? s : undefined;
}

/**
 * Read a raw type value off a handle, trying two property spellings.
 * @param {*} handle The player handle.
 * @param {string} keyA Primary property name.
 * @param {string} keyB Alternate property name.
 * @returns {*} The raw value, or undefined.
 */
function rawType(handle, keyA, keyB) {
  return handle?.[keyA] ?? handle?.[keyB];
}

/**
 * Resolve a settlement owner's display identity from a live player handle.
 * @param {number} pid The owner player id.
 * @param {*} handle The player handle.
 * @returns {SettlementOwner} The resolved owner identity.
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
    leaderName: major ? compose(leaderRow?.Name) || "Player " + pid : compose("LOC_DEMOGRAPHICS_CITY_STATE"),
    civName: major ? compose(civRow?.Name) || undefined : undefined,
    leaderType: canonicalLeaderType(leaderRow, rawLeader),
    primary,
    secondary,
    // Background-safe accent color, identical to the history line-chart rule:
    // prefer the secondary banner when the primary is a dark grey/black, then
    // lift any still-dark color to a readable tone. Used for every colored
    // accent so a black civ color never vanishes against the dark UI.
    readable: readableAccent(primary, secondary),
    isMajor: major,
    met: localHasMet(pid)
  };
}

/**
 * Resolve local player id from GameContext.
 * @returns {number|undefined} Local player id.
 */
function localPlayerId() {
  if (typeof GameContext === "undefined") return undefined;
  return GameContext.localPlayerID;
}

/**
 * Resolve local player's diplomacy handle.
 * @param {number} localId Local player id.
 * @returns {*|null} Diplomacy handle.
 */
function localDiplomacy(localId) {
  if (typeof Players === "undefined" || !Players.get) return null;
  return Players.get(localId)?.Diplomacy || null;
}

/**
 * Whether the LOCAL player has met `pid` (the local player is always met).
 * Returns undefined when diplomacy is unreadable so callers can decline to
 * mask on uncertainty (mirrors the worldrankings-allcivs's "only mask when met === false"
 * rule).
 * @param {number} pid The owner player id.
 * @returns {boolean|undefined} Met state, or undefined when unknown.
 */
function localHasMet(pid) {
  try {
    const localId = localPlayerId();
    if (typeof localId !== "number") return undefined;
    if (pid === localId) return true;
    const d = localDiplomacy(localId);
    if (d && typeof d.hasMet === "function") return !!d.hasMet(pid);
  } catch (_) {
    // GameContext.localPlayerID / Players.get / Diplomacy.hasMet can throw mid age-transition.
  }
  return undefined;
}

/**
 * Resolve one constructible handle by component id.
 * @param {*} cid Constructible component id.
 * @returns {*|null} Constructible handle.
 */
function constructibleById(cid) {
  if (typeof Constructibles === "undefined") return null;
  if (typeof Constructibles.getByComponentID !== "function") return null;
  return Constructibles.getByComponentID(cid);
}

/**
 * Resolve Constructibles table info for a constructible type.
 * @param {*} type Constructible type hash.
 * @returns {*|null} Constructibles table row.
 */
function constructibleInfo(type) {
  const table = gameInfoTable("Constructibles");
  if (!table || typeof table.lookup !== "function") return null;
  return table.lookup(type);
}

/**
 * Background-safe accent for a civ: safeTextColor(preferReadableColor(primary,
 * secondary)). Falls back to the raw primary when the helpers can't resolve.
 * @param {string|undefined} primary Primary banner color.
 * @param {string|undefined} secondary Secondary banner color.
 * @returns {string|undefined} The readable accent color.
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
 * @param {string|null} ytKey The YieldTypes enum key.
 * @returns {number} The yield value (0 when unreadable).
 */
function readYield(yields, ytKey) {
  if (!ytKey || !yields || typeof yields.getNetYield !== "function") return 0;
  const yt = yieldEnum(ytKey);
  if (yt === undefined) return 0;
  try {
    const raw = yields.getNetYield(yt);
    return typeof raw === "number" && isFinite(raw) ? raw : 0;
  } catch (_) {
    // city.Yields.getNetYield can throw for a stale handle; treat as 0.
    return 0;
  }
}

/**
 * Read one output column's value off a settlement handle.
 * @param {{ id: string, yt: string|null }} col The output descriptor.
 * @param {*} city The city/town handle.
 * @param {*} yields The city.Yields handle.
 * @returns {number} The value.
 */
function readOutput(col, city, yields) {
  if (col.id === "population") return readPopulation(city);
  if (col.id === "wonders") return readWonders(city);
  return readYield(yields, col.yt);
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
    const con = city?.Constructibles;
    if (con && typeof con.getNumWonders === "function") {
      const n = con.getNumWonders();
      if (typeof n === "number" && isFinite(n)) return n;
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
    const u = typeof city?.urbanPopulation === "number" ? city.urbanPopulation : 0;
    const r = typeof city?.ruralPopulation === "number" ? city.ruralPopulation : 0;
    return u + r;
  } catch (_) {
    return 0;
  }
}

/**
 * Stable key for a settlement: its plot ("pid:x,y", stable across capture), else
 * its index within the owner's list.
 * @param {number} pid The owner id.
 * @param {*} city The city handle.
 * @param {number} idx The index fallback.
 * @returns {string} The stable key.
 */
function settlementKey(pid, city, idx) {
  try {
    const loc = city?.location;
    if (loc && typeof loc.x === "number" && typeof loc.y === "number") {
      return pid + ":" + loc.x + "," + loc.y;
    }
  } catch (_) {
    // location access can throw; fall back to the index.
  }
  return pid + ":#" + idx;
}

/**
 * Build one settlement record from a city handle (no composite/ranks yet).
 * @param {*} city The city/town handle.
 * @param {number} pid The owner id.
 * @param {SettlementOwner} owner The resolved owner identity.
 * @param {number} idx The index within the owner's list.
 * @returns {Settlement|null} The record, or null when unreadable.
 */
function buildSettlement(city, pid, owner, idx) {
  if (!city) return null;
  const name = compose(city.name) || compose("LOC_CITY_NAME_UNSET") || "—";
  const locId = plotKey(city);
  const population = readPopulation(city);
  return {
    id: settlementKey(pid, city, idx),
    locId,
    location: readLocation(city),
    explored: readExplored(city),
    componentId: readComponentId(city),
    name,
    isTown: !!city.isTown,
    isCapital: !!safeBool(() => city.isCapital),
    population,
    populationEstimate: scaleCityPopulationAt(population, currentTurn()),
    owner,
    outputs: readOutputs(city),
    wonders: readWonderList(city),
    founded: getFounded(locId),
    trend: getCityTrend(locId),
    composite: 0,
    ranks: {}
  };
}

/**
 * Read a settlement's plot location {x,y} for the map camera, or null.
 * @param {*} city The city handle.
 * @returns {{x: number, y: number}|null} The location, or null.
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
 * Whether the local player has discovered a settlement - i.e. its CITY CENTER
 * tile is revealed (not in fog). Once you've seen the center, you know where the
 * settlement is, so the map camera is allowed even if some outer tiles are still
 * undiscovered. Defaults to true (don't block) on any uncertainty so the camera
 * isn't grayed out spuriously.
 * @param {*} city The city handle.
 * @returns {boolean} True when the city center is revealed.
 */
function readExplored(city) {
  try {
    const pid = typeof GameContext !== "undefined" ? GameContext.localPlayerID : undefined;
    if (!canQueryReveal(pid)) return true;
    const c = city && city.location;
    if (!c || typeof c.x !== "number") return true;
    return tileRevealed(pid, c.x, c.y);
  } catch (_) {
    return true; // never block the camera on a query failure
  }
}

/**
 * Whether the reveal-state API can be queried for the given player.
 * @param {*} pid The local player id.
 * @returns {boolean} True when queryable.
 */
function canQueryReveal(pid) {
  return pid !== undefined && typeof GameplayMap !== "undefined" && !!GameplayMap.getRevealedState;
}

/**
 * Whether a tile is revealed (not in fog) for the player.
 * @param {*} pid The local player id.
 * @param {number} x Plot x.
 * @param {number} y Plot y.
 * @returns {boolean} True when revealed.
 */
function tileRevealed(pid, x, y) {
  const hidden = typeof RevealedStates !== "undefined" ? RevealedStates.HIDDEN : 0;
  return GameplayMap.getRevealedState(pid, x, y) !== hidden;
}

/**
 * Read a settlement's ComponentID (`city.id`) - a serializable {owner,id,type}
 * struct used to re-resolve a live handle (`Cities.get`) and to target the
 * camera (`UI.Player.lookAtID`). Returns null when unreadable.
 * @param {*} city The city handle.
 * @returns {*} The ComponentID, or null.
 */
function readComponentId(city) {
  try {
    const cid = city?.id;
    if (cid && typeof cid === "object") return cid;
  } catch (_) {
    // city.id access can throw for a stale handle; treat as unknown.
  }
  return null;
}

/**
 * Plain "x,y" plot key (matches the trace store's key; distinct from the
 * pid-prefixed settlementKey used for marker dedupe).
 * @param {*} city The city handle.
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
 * @param {() => *} fn Thunk.
 * @returns {boolean} The boolean, or false.
 */
function safeBool(fn) {
  try {
    return !!fn();
  } catch (_) {
    return false;
  }
}

/**
 * The current monotonic turn (for the population world-estimate).
 * @returns {number} Game.turn, or 0.
 */
function currentTurn() {
  try {
    if (typeof Game !== "undefined" && typeof Game.turn === "number") return Game.turn;
  } catch (_) {
    // Game.turn can throw mid-transition.
  }
  return 0;
}

/**
 * Read a settlement's completed wonders as { type, icon, nameKey } for the card
 * icon row. Engine-owned, so these are confirmed (not inferred).
 * @param {*} city The city handle.
 * @returns {Array<{type: string, icon: string, nameKey: string,
 *   location: {x: number, y: number}|null}>} The wonders.
 */
function readWonderList(city) {
  /**
   * @type {Array<{type: string, icon: string, nameKey: string,
   *   location: {x: number, y: number}|null}>}
   */
  const out = [];
  const con = city?.Constructibles;
  const ids = safeBool(() => typeof con?.getIdsOfClass === "function")
    ? safeArr(() => con.getIdsOfClass("WONDER"))
    : [];
  for (const id of ids) {
    const w = resolveWonder(id);
    if (w) out.push(w);
  }
  return out;
}

/**
 * Array engine read, [] on throw/non-array.
 * @param {() => *} fn Thunk.
 * @returns {Array<*>} The array, or [].
 */
function safeArr(fn) {
  try {
    const v = fn();
    return Array.isArray(v) ? v : [];
  } catch (_) {
    return [];
  }
}

/**
 * Resolve one wonder ComponentID to { type, icon, nameKey, location }, or null
 * when it is not a complete wonder / unresolvable. `location` (the wonder's plot)
 * lets the camera tour fly to individual wonders.
 * @param {*} cid The constructible ComponentID.
 * @returns {{type: string, icon: string, nameKey: string,
 *   location: {x: number, y: number}|null}|null}
 */
function resolveWonder(cid) {
  try {
    const c = constructibleById(cid);
    if (!c || !c.complete) return null;
    const info = constructibleInfo(c.type);
    const type = info && info.ConstructibleType;
    if (typeof type !== "string") return null;
    return {
      type,
      icon: wonderIconUrl(type),
      nameKey: info.Name || type,
      location: readLocation(c)
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
 * @returns {Array<*>|null} The player handles, or null.
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
 * @param {*} p The player handle.
 * @param {Settlement[]} list The accumulating list (mutated).
 */
function gatherPlayerSettlements(p, list) {
  const pid = typeof p?.id === "number" ? p.id : undefined;
  if (typeof pid !== "number") return;
  // p.Cities.getCities() returns city HANDLES directly (not ComponentIDs), so
  // each element is used as-is - no Cities.get() lookup.
  const cities = playerCities(p);
  if (!cities.length) return;
  const owner = resolveOwner(pid, p);
  for (let i = 0; i < cities.length; i++) {
    const rec = buildSettlement(cities[i], pid, owner, i);
    if (rec) list.push(rec);
  }
}

/**
 * Gather every settlement of every alive player as raw records (no scores yet).
 * @returns {Settlement[]} The settlement records.
 */
function gatherSettlements() {
  /** @type {Settlement[]} */
  const list = [];
  const players = alivePlayers();
  if (!Array.isArray(players)) return list;
  for (const p of players) if (p) gatherPlayerSettlements(p, list);
  slog("gathered", list.length, "settlements");
  return list;
}

/**
 * Read a player's settlement handles (getCities returns handles, not ids).
 * @param {*} p The player handle.
 * @returns {Array<*>} The city/town handles (empty when unreadable).
 */
function playerCities(p) {
  try {
    const cities = p?.Cities;
    if (cities && typeof cities.getCities === "function") {
      const list = cities.getCities();
      if (Array.isArray(list)) return list;
    }
  } catch (_) {
    // p.Cities.getCities() can throw mid age-transition; treat as none.
  }
  return [];
}

/**
 * Compute each settlement's composite score (0-100): a WEIGHTED mean of its
 * composite outputs, each normalized to the strongest settlement in that output.
 * Economic yields weigh 1; wonders weigh 2, giving wonder-rich settlements a
 * bonus on top of the yields their wonders already contribute. Negative values
 * (e.g. unhappiness, though happiness is excluded) clamp to 0 so one weak output
 * can't sink the score unfairly. Population/happiness are excluded (a size and a
 * state) but are still ranked as columns.
 * @param {Settlement[]} list The settlement records (mutated: `composite` set).
 */
function computeComposite(list) {
  const cols = SETTLEMENT_OUTPUTS.filter((c) => c.composite);
  const max = maxByOutput(list, cols);
  let totalWeight = 0;
  for (const c of cols) totalWeight += c.weight || 1;
  for (const s of list) s.composite = compositeOf(s, cols, max, totalWeight);
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
  for (const c of cols) {
    let m = 0;
    for (const s of list) m = Math.max(m, s.outputs[c.id] || 0);
    max[c.id] = m;
  }
  return max;
}

/**
 * One settlement's weighted, normalized composite score (0-100).
 * @param {Settlement} s The settlement.
 * @param {Array<{ id: string, weight: number }>} cols The composite columns.
 * @param {Record<string, number>} max Per-output max values.
 * @param {number} totalWeight Sum of column weights.
 * @returns {number} The composite score.
 */
function compositeOf(s, cols, max, totalWeight) {
  let sum = 0;
  for (const c of cols) {
    const m = max[c.id];
    const v = Math.max(0, s.outputs[c.id] || 0);
    sum += (m > 0 ? v / m : 0) * (c.weight || 1);
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
 * @param {Settlement} s The settlement.
 * @param {string} key The output id, or "composite".
 * @returns {number} The value.
 */
export function valueOf(s, key) {
  if (key === "composite") return s.composite;
  const v = s.outputs[key];
  return typeof v === "number" ? v : 0;
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
 * @returns {SettlementBoard} The scored + ranked board.
 */
export function buildSettlementBoard() {
  const settlements = gatherSettlements();
  computeComposite(settlements);
  computeRanks(settlements);
  settlements.sort((a, b) => b.composite - a.composite);
  /** @type {Record<string, Settlement|null>} */
  const leaders = {};
  const keys = ["composite", ...SETTLEMENT_OUTPUTS.map((c) => c.id)];
  for (const key of keys) {
    let best = null;
    for (const s of settlements) {
      if (s.ranks[key] === 1) {
        best = s;
        break;
      }
    }
    leaders[key] = best;
  }
  return { settlements, leaders };
}
