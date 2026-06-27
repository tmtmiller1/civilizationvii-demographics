// sampler-collectors-core.js
//
// Per-civ metric collector orchestrators and shared utilities.

import {
  safeCall,
  safeNum,
  getLocalPlayerID,
  getPlayer
} from "/demographics/ui/sampler/demographics-sampler.js";
import {
  collectCities,
  collectContinent,
  collectGold,
  collectOngoingDeals,
  collectSettlementCap,
  collectTechAndCivicCounts,
  collectTradeRoutes,
  collectYieldsAndSizes,
  computeNodeBaselines,
  getCurrentAgeType,
  resetAgeCaches,
  setNodeBaselineByPid
} from "/demographics/ui/sampler/sampler-collectors-economy.js";
import {
  collectMilitaryPower,
  collectLegacyTriumphs,
  collectWonderCount,
  collectWonderTypes
} from "/demographics/ui/sampler/sampler-collectors-military.js";
import {
  collectDiplomaticApproval,
  collectResourceCategories,
  collectVictoryPoints
} from "/demographics/ui/sampler/sampler-collectors-civics.js";

/**
 * The per-civ context object assembled by {@link buildPlayerCtx}. Engine-
 * sourced handles (`player`, `stats`) stay loose; the mod's own numeric and
 * string fields are typed. Extends {@link CivSample} so it can flow into the
 * snapshot pipeline.
 * @typedef {object} PlayerCtx
 * @property {Pid} id Player id this context describes.
 * @property {*} [player] Live player library handle, or undefined.
 * @property {*} [leaderType] Raw leader type (numeric hash or "LEADER_*").
 * @property {*} [civType] Raw civilization type (numeric hash or string).
 * @property {*} [stats] Player Stats handle, or undefined.
 * @property {boolean} [met] Whether the local player has met this player.
 * @property {string} [leaderName] Resolved, localized leader display name.
 * @property {string} [civName] Resolved, localized civ display name.
 * @property {string} [leaderTypeString] Canonical "LEADER_*" string.
 * @property {string} [civTypeString] Canonical "CIVILIZATION_*" string.
 * @property {string} [primaryColor] Player banner primary color string.
 * @property {string} [secondaryColor] Player banner secondary color string.
 * @property {number} [gold] Gold balance.
 * @property {number} [settlementsCount] Count of settlements (cities + towns).
 * @property {number} [techsCount] Fully-unlocked tech nodes.
 * @property {number} [civicsCount] Fully-unlocked culture nodes.
 * @property {number} [yieldGold] Net gold yield.
 * @property {number} [yieldScience] Net science yield.
 * @property {number} [yieldCulture] Net culture yield.
 * @property {number} [yieldHappiness] Net happiness yield.
 * @property {number} [yieldProduction] Net production yield.
 * @property {number} [yieldFood] Net food yield.
 * @property {number} [yieldDiplomacy] Net diplomacy (influence) yield.
 * @property {number} [totalPopulation] Total population (raw, sum of settlement sizes).
 * @property {number} [populationScaled] Civ scaled people total (Σ per-settlement growth-formula estimate).
 * @property {string} [ageType] Current age type at sample time (e.g. AGE_EXPLORATION).
 * @property {number} [ageProgressPct] Current age-progress percent [0,100] at sample time.
 * @property {number} [citiesCount] Number of cities.
 * @property {number} [townsCount] Number of towns.
 * @property {number} [tilesOwned] Total owned tiles across cities.
 * @property {number} [continent] Home-continent type (capital's landmass).
 * @property {number} [tradeRoutesCount] Player-wide trade-route count.
 * @property {number} [ongoingDealsCount] Ongoing diplomatic action count.
 * @property {number} [wondersCount] Completed wonder count.
 * @property {string[]} [wonderTypes] ConstructibleType strings of wonders.
 * @property {number} [militaryPower] Summed military unit strength.
 * @property {number} [settlementCap] Settlement cap.
 * @property {number} [numSettlements] Settlements used against the cap.
 * @property {number} [triumphsCultural] Triggered cultural triumphs.
 * @property {number} [triumphsDiplomatic] Triggered diplomatic triumphs.
 * @property {number} [triumphsEconomic] Triggered economic triumphs.
 * @property {number} [triumphsScientific] Triggered scientific triumphs.
 * @property {number} [triumphsMilitaristic] Triggered militaristic triumphs.
 * @property {number} [triumphsExpansionist] Triggered expansionist triumphs.
 * @property {number} [triumphsInProgress] In-progress (untriggered) triumphs.
 * @property {number} [victoryPointsCulture] Modern culture victory points.
 * @property {number} [victoryPointsEconomic] Modern economic (GDP) points.
 * @property {number} [victoryPointsMilitary] Modern military victory points.
 * @property {number} [victoryPointsScience] Modern science victory points.
 * @property {number} [diplomaticApproval] Weighted total reputation score.
 * @property {number} [diplomaticApprovalMajor] Major-civ reputation portion.
 * @property {number} [diplomaticApprovalCS] City-state reputation portion.
 * @property {number} [resourcesBonus] Bonus-class resource count.
 * @property {number} [resourcesEmpire] Empire-class resource count.
 * @property {number} [resourcesCity] City-class resource count.
 * @property {number} [resourcesFactory] Factory-class resource count.
 * @property {number} [resourcesTreasure] Treasure-class resource count.
 * @property {number} [resourcesTotal] Total resource count across classes.
 * @property {number} [ageProgressPct] Game-wide age progress percent (stamped).
 * @property {number} [crisisStage] Game-wide crisis stage (stamped).
 * @property {number} [crisisStageMax] Game-wide crisis stage max (stamped).
 */

const DBG = false;
/**
 * Debug logger, no-op unless {@link DBG} is set.
 * @param {...*} a Values to log.
 */
export function dlog(...a) {
  if (DBG) console.warn("[Demographics.sampler]", ...a);
}

/**
 * Resolve a `YieldTypes.YIELD_*` enum value defensively.
 * @param {string} key The enum key, e.g. "YIELD_GOLD".
 * @returns {number | string | undefined} The enum value, or undefined.
 */
export function yieldEnum(key) {
  try {
    if (typeof YieldTypes !== "undefined" && YieldTypes != null) {
      const v = YieldTypes[key];
      if (typeof v === "number" || typeof v === "string") return v;
    }
  } catch (_e) {
    // YieldTypes[key] access can throw if the enum global is absent; treat the
    // yield as unavailable.
  }
  return undefined;
}

/**
 * Read a single net yield off a Stats handle.
 * @param {*} stats The player Stats handle.
 * @param {string} key The `YIELD_*` enum key.
 * @param {Pid} pid The player id (for log attribution).
 * @returns {number | undefined} The finite yield value, or undefined.
 */
export function netYield(stats, key, pid) {
  if (!stats || typeof stats.getNetYield !== "function") return undefined;
  const yt = yieldEnum(key);
  if (yt === undefined) return undefined;
  return safeCall("stats.getNetYield(" + key + ") (pid=" + pid + ")", () => {
    const v = stats.getNetYield(yt);
    return safeNum(v);
  });
}

/**
 * Capture whether the LOCAL player has met `id` at sample time.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {Pid} id The player id being sampled.
 * @param {*} p The sampled player handle.
 */
function collectMet(ctx, id, p) {
  try {
    const localId = getLocalPlayerID();
    if (typeof localId !== "number") return;
    if (id === localId) ctx.met = true;
    else ctx.met = readHasMet(id === localId ? p : getPlayer(localId), id);
  } catch (_) {
    // getLocalPlayerID() / getPlayer().Diplomacy can be null / throw.
  }
}

/**
 * Read whether `localP` has met `id` via Diplomacy.hasMet, or undefined.
 * @param {*} localP The local player handle.
 * @param {Pid} id The player id to test.
 * @returns {boolean|undefined} Met state, or undefined when unreadable.
 */
function readHasMet(localP, id) {
  const d = localP?.Diplomacy;
  if (!(d && typeof d.hasMet === "function")) return undefined;
  try {
    return !!d.hasMet(id);
  } catch (_) {
    return undefined;
  }
}

/**
 * Read the RAW leaderType / civilizationType off the player handle.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {*} p The sampled player handle.
 * @returns {{ rawLeader: *, rawCiv: * }} The raw values for downstream lookup.
 */
function collectRawTypes(ctx, p) {
  let rawLeader = undefined;
  let rawCiv = undefined;
  try {
    rawLeader = p.leaderType ?? p.LeaderType;
    if (rawLeader !== undefined && rawLeader !== null) ctx.leaderType = rawLeader;
  } catch (_e) {
    // p.leaderType property access can throw on a stale player handle.
  }
  try {
    rawCiv = p.civilizationType ?? p.CivilizationType;
    if (rawCiv !== undefined && rawCiv !== null) ctx.civType = rawCiv;
  } catch (_e) {
    // p.civilizationType property access can throw on a stale player handle.
  }
  return { rawLeader, rawCiv };
}

/**
 * Localize a tag via Locale.compose, defensively.
 * @param {*} tag The LOC tag (or any value) to compose.
 * @returns {string | undefined} The composed string, or undefined.
 */
export function _composeLocale(tag) {
  if (typeof Locale === "undefined" || typeof Locale.compose !== "function") {
    return undefined;
  }
  try {
    const s = Locale.compose(tag);
    if (typeof s === "string" && s.length > 0) return s;
  } catch (_) {
    // Locale.compose() can throw on a malformed tag.
  }
  return undefined;
}

/**
 * Try the table's `lookup()` with the raw value, then its string form.
 * @param {*} table A GameInfo table.
 * @param {*} raw The raw type value (hash or string).
 * @returns {*} The matching row, or null.
 */
function _lookupRowDirect(table, raw) {
  if (typeof table.lookup !== "function" || raw === undefined || raw === null) {
    return null;
  }
  const direct = table.lookup(raw);
  if (direct) return direct;
  const asStr = String(raw);
  if (asStr !== "") {
    const byStr = table.lookup(asStr);
    if (byStr) return byStr;
  }
  return null;
}

/**
 * Iterate a GameInfo table for a row matching `$hash`/`Hash`/`typeField`.
 * @param {*} table A GameInfo table.
 * @param {*} raw The raw type value (hash or string).
 * @param {string} typeField The row's type field name.
 * @returns {*} The matching row, or null.
 */
function _lookupRowByIteration(table, raw, typeField) {
  if (!table || typeof table[Symbol.iterator] !== "function") return null;
  for (const row of table) {
    if (!row) continue;
    if (row.$hash === raw || row.Hash === raw) return row;
    if (typeof raw === "string" && row[typeField] === raw) return row;
  }
  return null;
}

/**
 * Look up a GameInfo row by hash/type.
 * @param {*} table A GameInfo table (e.g. GameInfo.Leaders).
 * @param {*} raw The raw type value (hash or string).
 * @param {string} typeField The row's type field name.
 * @returns {*} The matching row, or null.
 */
export function lookupInfoRow(table, raw, typeField) {
  try {
    if (typeof GameInfo === "undefined" || !table) return null;
    return _lookupRowDirect(table, raw) || _lookupRowByIteration(table, raw, typeField);
  } catch (_) {
    // table.lookup() / table iteration can throw if GameInfo isn't ready.
  }
  return null;
}

/**
 * Localize a GameInfo row's Name (via Locale.compose), else prettify type.
 * @param {*} row A GameInfo row (or null).
 * @param {string} typeField The row's type field name.
 * @param {*} raw The raw type value.
 * @param {string} prefix Type-string prefix to strip.
 * @param {string} fallback Final fallback display string.
 * @returns {string} The resolved display name.
 */
export function resolveDisplayName(row, typeField, raw, prefix, fallback) {
  try {
    const nm = row?.Name;
    if (nm) return _composeLocale(nm) || String(nm);
  } catch (_) {
    // row.Name access can throw on a proxy GameInfo row.
  }
  const typeStr = row?.[typeField] || (typeof raw === "string" ? raw : "");
  if (typeStr) return _prettifyType(typeStr, prefix);
  return fallback;
}

/**
 * Resolve a raw player civ-name token into localized display text.
 * @param {*} value Raw player civ name/full-name token.
 * @returns {string|null} Localized display value, or null.
 */
function localizedPlayerCivName(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  return _composeLocale(value) || value;
}

/**
 * Turn a "PREFIX_FOO_BAR" type string into a Title-Cased display name.
 * @param {string} typeStr The type string.
 * @param {string} prefix The prefix to strip.
 * @returns {string} The prettified display name.
 */
export function _prettifyType(typeStr, prefix) {
  return String(typeStr)
    .replace(new RegExp("^" + prefix), "")
    .split("_")
    .map((w) => (w[0] ? w[0].toUpperCase() : "") + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Resolve the civilization display name.
 * @param {*} p The sampled player handle.
 * @param {*} civRow The GameInfo.Civilizations row (or null).
 * @param {*} rawCiv The raw civ type value.
 * @returns {string} The resolved civ display name (may be "").
 */
export function resolveCivName(p, civRow, rawCiv) {
  try {
    const direct = localizedPlayerCivName(p?.civilizationName);
    if (direct) return direct;
    const full = localizedPlayerCivName(p?.civilizationFullName);
    if (full) return full;
  } catch (_) {
    // p.civilizationName / p.civilizationFullName access can throw.
  }
  return resolveDisplayName(civRow, "CivilizationType", rawCiv, "CIVILIZATION_", "");
}

/**
 * Read one UI.Player color getter and return a non-empty string.
 * @param {Pid} id Player id.
 * @param {"getPrimaryColorValueAsString"|"getSecondaryColorValueAsString"} getter
 *   UI getter name.
 * @returns {string|undefined} Color string, when available.
 */
function readUiPlayerColor(id, getter) {
  if (typeof UI === "undefined" || !UI.Player) return undefined;
  if (typeof UI.Player[getter] !== "function") return undefined;
  const color = UI.Player[getter](id);
  if (typeof color !== "string" || color.length === 0) return undefined;
  return color;
}

/**
 * Resolve leader/civ display names + canonical type strings and store on ctx.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {Pid} id The player id.
 * @param {*} p The sampled player handle.
 * @param {*} rawLeader The raw leader type value.
 * @param {*} rawCiv The raw civ type value.
 */
function collectNamesAndTypeStrings(ctx, id, p, rawLeader, rawCiv) {
  const leaderRow = lookupInfoRow(
    typeof GameInfo !== "undefined" ? GameInfo.Leaders : null,
    rawLeader,
    "LeaderType"
  );
  ctx.leaderName = resolveDisplayName(
    leaderRow,
    "LeaderType",
    rawLeader,
    "LEADER_",
    "Player " + id
  );

  const civRow = lookupInfoRow(
    typeof GameInfo !== "undefined" ? GameInfo.Civilizations : null,
    rawCiv,
    "CivilizationType"
  );
  ctx.civName = resolveCivName(p, civRow, rawCiv);
  dlog("civName (pid=" + id + ") = '" + ctx.civName + "'");

  ctx.leaderTypeString = _canonicalTypeString(leaderRow?.LeaderType, rawLeader);
  ctx.civTypeString = _canonicalTypeString(civRow?.CivilizationType, rawCiv);
}

/**
 * Pick the canonical "*_TYPE" string.
 * @param {*} rowType The row's typed value.
 * @param {*} raw The raw type value off the player handle.
 * @returns {string | undefined} The canonical type string, or undefined.
 */
export function _canonicalTypeString(rowType, raw) {
  if (typeof rowType === "string" && rowType.length > 0) return rowType;
  if (typeof raw === "string" && raw.length > 0) return raw;
  return undefined;
}

/**
 * Capture the player's banner colors.
 * @param {PlayerCtx} ctx The context to mutate.
 * @param {Pid} id The player id.
 */
function collectColors(ctx, id) {
  try {
    const primary = readUiPlayerColor(id, "getPrimaryColorValueAsString");
    if (primary) ctx.primaryColor = primary;
    const secondary = readUiPlayerColor(id, "getSecondaryColorValueAsString");
    if (secondary) ctx.secondaryColor = secondary;
  } catch (_) {
    // UI.Player.get*ColorValueAsString() can throw for an unresolved player.
  }
}

/**
 * Read a finite numeric property off an engine handle, swallowing errors.
 * @param {*} obj The engine handle.
 * @param {string} prop The property name.
 * @returns {number | undefined} The finite value, or undefined.
 */
export function _readFiniteProp(obj, prop) {
  try {
    const v = obj[prop];
    if (typeof v === "number" && isFinite(v)) return v;
  } catch (_e) {
    // Reading obj[prop] off an engine Stats handle can throw.
  }
  return undefined;
}

/**
 * Allocate the per-civ context object with every field pre-initialized.
 * @param {Pid} id The player id.
 * @returns {PlayerCtx} The freshly-allocated context.
 */
export function _newPlayerCtx(id) {
  /** @type {PlayerCtx} */
  const ctx = {
    id,
    player: undefined,
    leaderType: undefined,
    civType: undefined,
    stats: undefined,
    gold: undefined,
    settlementsCount: undefined,
    techsCount: undefined,
    civicsCount: undefined,
    yieldGold: undefined,
    yieldScience: undefined,
    yieldCulture: undefined,
    yieldHappiness: undefined,
    yieldProduction: undefined,
    yieldFood: undefined,
    yieldDiplomacy: undefined,
    totalPopulation: undefined,
    citiesCount: undefined,
    townsCount: undefined,
    tilesOwned: undefined,
    continent: undefined,
    tradeRoutesCount: undefined,
    ongoingDealsCount: undefined,
    wondersCount: undefined,
    militaryPower: undefined,
    leaderTypeString: undefined,
    civTypeString: undefined,
    primaryColor: undefined,
    secondaryColor: undefined
  };
  return ctx;
}

/**
 * Build the per-civ context object for one player by running each section
 * collector in turn.
 * @param {Pid} id The player id to sample.
 * @returns {PlayerCtx} The assembled per-civ context.
 */
export function buildPlayerCtx(id) {
  const ctx = _newPlayerCtx(id);
  const p = getPlayer(id);
  if (!p) return ctx;
  ctx.player = p;
  collectIdentity(ctx, id, p);
  try {
    ctx.stats = p.Stats;
  } catch (_e) {
    // p.Stats accessor can throw on a stale player handle.
  }
  collectEconomy(ctx, id, p, ctx.stats);
  collectPowerAndCivics(ctx, id, p);
  return ctx;
}

/**
 * Collect a civ's identity: met status, raw/canonical leader+civ types, display
 * names, and banner colors.
 * @param {PlayerCtx} ctx The context to fill.
 * @param {Pid} id The player id.
 * @param {*} p The player handle.
 */
function collectIdentity(ctx, id, p) {
  collectMet(ctx, id, p);
  const { rawLeader, rawCiv } = collectRawTypes(ctx, p);
  collectNamesAndTypeStrings(ctx, id, p, rawLeader, rawCiv);
  collectColors(ctx, id);
}

/**
 * Collect a civ's economy: gold, cities/continent, tech+civic counts, yields,
 * trade routes, ongoing deals, wonders, and settlement cap.
 * @param {PlayerCtx} ctx The context to fill.
 * @param {Pid} id The player id.
 * @param {*} p The player handle.
 * @param {*} stats The player's Stats handle.
 */
function collectEconomy(ctx, id, p, stats) {
  collectGold(ctx, id, p);
  const cityList = collectCities(ctx, id, p);
  collectContinent(ctx, cityList);
  collectTechAndCivicCounts(ctx, id);
  collectYieldsAndSizes(ctx, id, stats);
  collectTradeRoutes(ctx, id, p);
  collectOngoingDeals(ctx, id);
  collectWonderCount(ctx, id, stats, cityList);
  collectWonderTypes(ctx, id, p);
  collectSettlementCap(ctx, stats);
}

/**
 * Collect a civ's military power, triumphs, victory points, diplomatic approval,
 * and resource categories.
 * @param {PlayerCtx} ctx The context to fill.
 * @param {Pid} id The player id.
 * @param {*} p The player handle.
 */
function collectPowerAndCivics(ctx, id, p) {
  collectMilitaryPower(ctx, id, p);
  collectLegacyTriumphs(ctx, p);
  collectVictoryPoints(ctx, p);
  collectDiplomaticApproval(ctx, id, p);
  collectResourceCategories(ctx, id, p);
}

/**
 * Build a LIGHTWEIGHT context for a minor player.
 * @param {Pid} id The minor player id.
 * @returns {PlayerCtx} The trimmed per-civ context.
 */
export function buildMinorMilitaryCtx(id) {
  const ctx = _newPlayerCtx(id);
  const p = getPlayer(id);
  if (!p) return ctx;
  ctx.player = p;
  collectMet(ctx, id, p);
  const { rawLeader, rawCiv } = collectRawTypes(ctx, p);
  collectNamesAndTypeStrings(ctx, id, p, rawLeader, rawCiv);
  collectColors(ctx, id);
  collectMilitaryPower(ctx, id, p);
  return ctx;
}

export {
  getCurrentAgeType,
  resetAgeCaches,
  computeNodeBaselines,
  setNodeBaselineByPid,
  safeCall,
  safeNum,
  getLocalPlayerID,
  getPlayer
};
