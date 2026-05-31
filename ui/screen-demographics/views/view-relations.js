// view-relations.js
//
// "Global Relations" view: a two-level tab hierarchy above an SVG ring
// of nodes.
//
//   Top level:    [Civ Relations] [City State Relations]
//   Inner level:  [Political] [Economic] [Attitude]
//   Below tabs:   filter pills (per-view filter set)
//   Body:         centered SVG ring with colored edges between nodes
//   Caption:      one-line hint below the ring
//
// Ring layout (evenly-spaced civs on a circle with an SVG <line>
// between each pair) is adapted from Sloth's Global Relations Panel
// (corpus mod 3506996826). See ui/global-relations-panel/
// global-relations-panel.js, around line 496 for the angle math and
// around line 123 for the per-pair line rendering.
//
// V7 diplomacy accessors in use:
//   player.Diplomacy.hasMet(other)
//   player.Diplomacy.isAtWarWith(other)
//   player.Diplomacy.hasAllied(other)
//   player.Diplomacy.getRelationshipEnum(other)
//   DiplomacyPlayerRelationships.PLAYER_RELATIONSHIP_*
//     (ALLIANCE / FRIENDLY / HELPFUL / NEUTRAL / UNFRIENDLY / HOSTILE / AT_WAR)
//   Players.getAliveIds() / Players.get(id) / player.isMajor
//   GameContext.localPlayerID
//   csPlayer.Influence.getSuzerain()
//   player.Trade.countPlayerTradeRoutesTo(otherId)
//   DiplomacyActionTypes.DIPLOMACY_ACTION_OPEN_BORDERS
//   Game.Diplomacy.getPlayerEvents(playerId)
//
// All of the above are demonstrated either in the sloth panel or in
// vanilla diplomacy code under core/ui/utilities/ and
// base-standard/ui/diplomacy*.

const DEMOGRAPHICS_DEBUG = true;
import { safePlaySound, playActivate } from "/demographics/ui/demographics-audio.js";
import { getAttitudeColors } from "/demographics/ui/demographics-palette.js";

/**
 * One relationship edge between two ring nodes. `a`/`b` are player ids; the
 * remaining fields are visual hints consumed by the ring renderer.
 * @typedef {Object} Edge
 * @property {number} a Source player id.
 * @property {number} b Target player id.
 * @property {string} [color] Stroke color (hex or rgba).
 * @property {string} [label] Optional human-readable edge label.
 * @property {string} [filterKey] Filter category this edge belongs to.
 * @property {boolean} [dashed] Legacy dashed-line flag (suzerain edges).
 * @property {number} [width] Per-edge stroke width (currently ignored).
 * @property {number} [opacity] Per-edge stroke opacity (currently ignored).
 * @property {string|null} [_dashOverride] Per-tab dash-pattern override.
 */

/**
 * One filter-pill descriptor. `kind` groups attitude / political / economic
 * filters; visual fields are resolved per-tab before rendering.
 * @typedef {Object} FilterDef
 * @property {string} key Filter key (matches an {@link Edge}'s `filterKey`).
 * @property {string} [label] Display label.
 * @property {string} [kind] Grouping kind ("attitude"/"political"/"economic").
 * @property {string} [color] Swatch color.
 * @property {string|null} [_dashOverride] Per-tab dash-pattern override.
 */

/**
 * Per-node display info resolved from history + engine lookups. Loose at the
 * engine boundary; the renderer reads these fields off `names[pid]`.
 * @typedef {Object} NodeInfo
 * @property {string} [leaderName] Leader display name.
 * @property {string} [civName] Civilization display name.
 * @property {string} [leaderTypeString] Engine LeaderType string.
 * @property {string} [primaryColor] Civ primary color (hex/css).
 * @property {boolean} [isCityState] Whether this node is a city-state.
 * @property {string} [csName] City-state display name.
 * @property {boolean} [csMet] Whether the viewer has met this city-state.
 * @property {string|null} [csTypeKey] Resolved CS type string.
 * @property {string|null} [csTypeLabel] CS type display label.
 * @property {string|null} [csTypeColor] CS type fill/stroke color.
 * @property {string|null} [csTypeIcon] CS type icon BLP path.
 */

/**
 * A pre-resolved endeavor/treaty action lookup: engine action-type int plus
 * the edge color and original action name.
 * @typedef {Object} ActionLookup
 * @property {number} t Engine `DiplomacyActionTypes` int.
 * @property {string} color Edge color for this action.
 * @property {string} name Original `DIPLOMACY_ACTION_*` name.
 */

/**
 * A grouped edge entry: the edge plus the resolved endpoint positions.
 * @typedef {Object} EdgeGeo
 * @property {Edge} e The edge.
 * @property {{x: number, y: number}} pa Source position (viewBox coords).
 * @property {{x: number, y: number}} pb Target position (viewBox coords).
 */

/**
 * A queued portrait/icon overlay to be positioned in pixel coords once the
 * SVG has laid out.
 * @typedef {Object} PortraitPlacement
 * @property {string} kind Either "leader" or "cs-icon".
 * @property {string} [leaderType] Engine LeaderType (leader portraits).
 * @property {string} [iconUrl] BLP icon url (cs-icon overlays).
 * @property {number} vbX X position in viewBox coords.
 * @property {number} vbY Y position in viewBox coords.
 * @property {number} vbR Node radius in viewBox coords.
 */

/**
 * Computed ring geometry shared by edge + node layout.
 * @typedef {Object} RingGeometry
 * @property {number} viewBoxW ViewBox width.
 * @property {number} viewBoxH ViewBox height.
 * @property {number} cx Ring center x.
 * @property {number} cy Ring center y.
 * @property {number} rx Ellipse x-radius.
 * @property {number} ry Ellipse y-radius.
 * @property {number} density Node-density factor (0.32..1).
 * @property {Map<number, {x: number, y: number}>} positions Node positions.
 */

/**
 * Persisted-setting accessor surface read off the render context.
 * @typedef {Object} RelationsSettings
 * @property {(key: string, fallback?: *) => *} [getSetting] Read a setting.
 * @property {(key: string, value: *) => void} [setSetting] Write a setting.
 */

/**
 * Render context handed to {@link render}.
 * @typedef {Object} RelationsCtx
 * @property {DemoHistory} [history] The full persisted history blob.
 * @property {RelationsSettings} [settings] Persisted-setting accessor.
 */

const DBG = DEMOGRAPHICS_DEBUG;
/**
 * Debug logger, no-op unless {@link DBG} is set.
 * @param {...*} a Values to log.
 * @returns {void}
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.view-relations]", ...a);
}
/**
 * Error logger (always emits).
 * @param {...*} a Values to log.
 * @returns {void}
 */
function derr(...a) {
  console.error("[Demographics.view-relations]", ...a);
}

/**
 * Convert a `#RRGGBB` (or `0xRRGGBB`/`RRGGBB`/8-char) color string to `rgba()`
 * with the given alpha. Accepts 6- or 8-char hex (taking the last 6 digits as
 * RGB) to dodge the "white circle" bug where 8-char `#RRGGBBAA` fell through.
 * @param {*} hex Candidate color string.
 * @param {number} alpha Alpha channel (0..1).
 * @returns {string} An `rgba(...)` string (a safe dark fallback if unparseable).
 */
function hexToRgba(hex, alpha) {
  if (typeof hex !== "string") return "rgba(0,0,0," + alpha + ")";
  // Civ7's `UI.Player.getPrimaryColorValueAsString` can return 8-char hex
  // ("#AARRGGBB" or "#RRGGBBAA"). The previous regex only matched 6 chars
  // and FELL THROUGH returning the raw string, so SVG `fill="#FFFFFFFF"`
  // rendered as opaque white — that's the "white circle" bug. Accept 6 or
  // 8 char hex and always take the LAST 6 digits as RGB.
  const m = hex.match(/^#?([0-9a-fA-F]{6,8})$/);
  if (!m) return "rgba(20, 16, 10, " + alpha + ")";
  const rgbHex = m[1].slice(-6);
  const n = parseInt(rgbHex, 16);
  return `rgba(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}, ${alpha})`;
}

/**
 * Normalize any Civ7 color string to a safe 6-char `#RRGGBB` hex, or `null`
 * when the value is useless (near-white, near-black, or unparseable). Used to
 * scrub `UI.Player.getPrimaryColorValueAsString` output before storing it.
 * @param {*} s Candidate color string.
 * @returns {string|null} The normalized `#RRGGBB`, or `null` if unusable.
 */
function normalizeCivColor(s) {
  if (typeof s !== "string") return null;
  const m = s.match(/^#?([0-9a-fA-F]{6,8})$/);
  if (!m) return null;
  const rgbHex = m[1].slice(-6);
  const n = parseInt(rgbHex, 16);
  const r = (n >> 16) & 0xff,
    g = (n >> 8) & 0xff,
    b = n & 0xff;
  if ((r + g + b) / 3 > 220) return null; // near-white = useless on parchment
  if ((r + g + b) / 3 < 12) return null; // near-black = also indistinguishable
  return "#" + rgbHex.toUpperCase();
}

/**
 * Invoke `fn` and return its result, logging and returning `fb` on throw.
 * @template T
 * @param {string} label Diagnostic label for the call site.
 * @param {() => T} fn Thunk to evaluate.
 * @param {T} [fb] Fallback returned on throw.
 * @returns {T} `fn()` result, or `fb`. (When `fb` is omitted, `T` includes
 *   `undefined` at the call site, matching the thunk's own return type.)
 */
function safeCall(label, fn, fb) {
  try {
    return fn();
  } catch (e) {
    if (DBG) derr("safeCall(" + label + "):", e);
    return /** @type {T} */ (fb);
  }
}

/**
 * Resolve the local player id from the engine `GameContext`, defensively.
 * @returns {number|undefined} Local player (or observer) id, if numeric.
 */
function getLocalId() {
  return safeCall("getLocalId", () => {
    if (typeof GameContext !== "undefined" && GameContext) {
      const v = GameContext.localPlayerID;
      if (typeof v === "number") return v;
      const o = GameContext.localObserverID;
      if (typeof o === "number") return o;
    }
    return undefined;
  });
}

// ---- diplomatic queries ---------------------------------------------------

/**
 * Test whether `id` should be counted as a met major from `localPid`'s view.
 * The local player is always included; majors are filtered by `hasMet`.
 * @param {number} id Candidate player id.
 * @param {number} localPid The local player id.
 * @param {*} humanDiplo The local player's `Diplomacy` handle (may be null).
 * @returns {boolean} True when `id` is the local player or a met major.
 */
function isMetMajor(id, localPid, humanDiplo) {
  const p = Players.get(id);
  if (!p) return false;
  if (typeof p.isMajor === "boolean" && !p.isMajor) return false;
  if (id === localPid) return true;
  if (humanDiplo && typeof humanDiplo.hasMet === "function") {
    return !!humanDiplo.hasMet(id);
  }
  return true;
}

/**
 * Return the set of met major-player ids (including the local player).
 * @param {number} localPid The local player id.
 * @returns {number[]} Met major ids (empty on any error).
 */
function getMetMajorIds(localPid) {
  return safeCall(
    "getMetMajorIds",
    () => {
      if (typeof Players === "undefined") return [];
      const aliveFn = Players.getAliveIds || Players.getAliveMajorIds;
      if (typeof aliveFn !== "function") return [];
      const all = aliveFn.call(Players);
      if (!Array.isArray(all)) return [];
      const human = typeof Players.get === "function" ? Players.get(localPid) : null;
      const humanDiplo = human?.Diplomacy;
      /** @type {number[]} */
      const out = [];
      for (const id of all) {
        try {
          if (isMetMajor(id, localPid, humanDiplo)) out.push(id);
        } catch (_) {
          /* skip */
        }
      }
      return out;
    },
    []
  );
}

/**
 * Collect alive player ids via `getAliveIds()` when available.
 * @returns {number[]} Alive ids, or an empty array.
 */
function collectAliveIdsPrimary() {
  /** @type {number[]} */
  let ids = [];
  try {
    if (typeof Players.getAliveIds === "function") {
      const arr = Players.getAliveIds();
      if (Array.isArray(arr)) ids = arr.slice();
    }
  } catch (_) {
    /* */
  }
  return ids;
}

/**
 * Collect alive player ids via the `getAlive()` iterator fallback, mirroring
 * the sloth pattern.
 * @returns {number[]} Alive ids, or an empty array.
 */
function collectAliveIdsFallback() {
  /** @type {number[]} */
  const ids = [];
  try {
    if (typeof Players.getAlive === "function") {
      const arr = Players.getAlive();
      if (Array.isArray(arr)) {
        for (const p of arr) {
          const id = typeof p === "number" ? p : p?.id;
          if (typeof id === "number") ids.push(id);
        }
      }
    }
  } catch (_) {
    /* */
  }
  return ids;
}

/**
 * Return the set of alive city-state / minor / independent player ids.
 * @returns {number[]} City-state ids (empty on any error).
 */
function getCityStateIds() {
  return safeCall(
    "getCityStateIds",
    () => {
      /** @type {number[]} */
      const out = [];
      if (typeof Players === "undefined") return out;
      let ids = collectAliveIdsPrimary();
      if (ids.length === 0) ids = collectAliveIdsFallback();
      for (const id of ids) {
        const p = safeCall("Players.get(" + id + ")", () => Players.get(id), null);
        if (!p) continue;
        const isMinor = p.isMinor === true || p.isIndependent === true || p.isCityState === true;
        if (isMinor) out.push(id);
      }
      return out;
    },
    []
  );
}

/**
 * Whether `p1` has an alliance with player `p2id`, defensively.
 * @param {*} p1 Source player handle.
 * @param {number} p2id Target player id.
 * @returns {boolean} True when an alliance is reported.
 */
function hasAlliance(p1, p2id) {
  return safeCall(
    "hasAllied",
    () => {
      const d = p1?.Diplomacy;
      if (!d) return false;
      if (typeof d.hasAllied === "function") return !!d.hasAllied(p2id);
      return false;
    },
    false
  );
}

/**
 * Whether `p1` is at war with player `p2id`, defensively.
 * @param {*} p1 Source player handle.
 * @param {number} p2id Target player id.
 * @returns {boolean} True when at war.
 */
function isAtWar(p1, p2id) {
  return safeCall(
    "isAtWarWith",
    () => {
      const d = p1?.Diplomacy;
      if (!d) return false;
      if (typeof d.isAtWarWith === "function") return !!d.isAtWarWith(p2id);
      return false;
    },
    false
  );
}

/**
 * Resolve the engine relationship enum from `p1` toward `p2id`, defensively.
 * @param {*} p1 Source player handle.
 * @param {number} p2id Target player id.
 * @returns {*} The relationship enum value, or `undefined`.
 */
function getRelationship(p1, p2id) {
  return safeCall("getRelationshipEnum", () => {
    const d = p1?.Diplomacy;
    if (!d || typeof d.getRelationshipEnum !== "function") return undefined;
    return d.getRelationshipEnum(p2id);
  });
}

// ---- color tables ---------------------------------------------------------

// Attitude colors are fetched live from `getAttitudeColors()` so the
// colorblind-mode toggle in Options swaps them without a mod reload. The keys
// match DiplomacyPlayerRelationships, resolved at runtime by attitudeKeyFromEnum.

/**
 * Map an engine relationship enum to one of the seven attitude keys.
 * @param {*} rel The relationship enum value.
 * @returns {string} The attitude key (defaults to "neutral").
 */
function attitudeKeyFromEnum(rel) {
  if (typeof DiplomacyPlayerRelationships === "undefined" || !DiplomacyPlayerRelationships) {
    return "neutral";
  }
  const E = DiplomacyPlayerRelationships;
  if (rel === E.PLAYER_RELATIONSHIP_ALLIANCE) return "alliance";
  if (rel === E.PLAYER_RELATIONSHIP_FRIENDLY) return "friendly";
  if (rel === E.PLAYER_RELATIONSHIP_HELPFUL) return "helpful";
  if (rel === E.PLAYER_RELATIONSHIP_NEUTRAL) return "neutral";
  if (rel === E.PLAYER_RELATIONSHIP_UNFRIENDLY) return "unfriendly";
  if (rel === E.PLAYER_RELATIONSHIP_HOSTILE) return "hostile";
  if (rel === E.PLAYER_RELATIONSHIP_AT_WAR) return "war";
  return "neutral";
}

/**
 * Resolve the live palette color for an attitude key.
 * @param {string} key Attitude key.
 * @returns {string} The palette color (gray fallback).
 */
function categoryColor(key) {
  const colors = getAttitudeColors();
  return colors[key] || "#bfbfbf";
}

// Action-type → display config for endeavor-class deals queried from
// `Game.Diplomacy.getPlayerEvents`. The key matches the
// `DiplomacyActionTypes.DIPLOMACY_ACTION_*` enum name we look up at runtime;
// `color` paints the edge in the ring. Bundle is keyed by the filter key
// each action belongs to so the political-edges builder can fan them out.
/** @type {Record<string, { name: string, color: string }[]>} */
const ENDEAVOR_ACTIONS = {
  research: [
    { name: "DIPLOMACY_ACTION_RESEARCH_COLLABORATION", color: "#c084fc" },
    { name: "DIPLOMACY_ACTION_SHARE_INNOVATIONS", color: "#c084fc" },
    { name: "DIPLOMACY_ACTION_SABOTAGE_RESEARCH", color: "#aa3030" }
  ],
  endeavors: [
    { name: "DIPLOMACY_ACTION_CULTURAL_EXCHANGE", color: "#c9a2dc" },
    { name: "DIPLOMACY_ACTION_IMPROVE_TRADE_RELATIONS", color: "#3fbf3f" },
    { name: "DIPLOMACY_ACTION_FARMERS_MARKET", color: "#9ad17a" },
    { name: "DIPLOMACY_ACTION_LOCAL_FESTIVALS", color: "#e6a23c" },
    { name: "DIPLOMACY_ACTION_PIONEERING", color: "#dba268" },
    { name: "DIPLOMACY_ACTION_GINSING_AGREEMENT", color: "#f5a060" },
    { name: "DIPLOMACY_ACTION_FRIEND_OF_WA", color: "#f5a060" },
    { name: "DIPLOMACY_ACTION_SEND_DELEGATION", color: "#a0d0e0" },
    { name: "DIPLOMACY_ACTION_TRADE_MAP", color: "#81a2be" },
    { name: "DIPLOMACY_ACTION_MILITARY_AID", color: "#d97c7c" }
  ]
};

// ---- name resolution from history (so we can label nodes) -----------------

/**
 * Assign `target[field] = value` when `value` is a non-empty string.
 * @param {NodeInfo} target Object to mutate.
 * @param {string} field Field name.
 * @param {*} value Candidate value.
 * @returns {void}
 */
function assignIfNonEmpty(target, field, value) {
  if (typeof value === "string" && value.length > 0) {
    /** @type {*} */ (target)[field] = value;
  }
}

/**
 * Fold one civ's per-turn sample into the running name map, keeping the most
 * recent non-empty value of each identity field.
 * @param {Record<string, NodeInfo>} map Name map to mutate.
 * @param {string} pid Player id (string key).
 * @param {*} ps One civ's sample (loose engine/history shape).
 * @returns {void}
 */
function foldNameSample(map, pid, ps) {
  if (!map[pid]) map[pid] = {};
  const target = map[pid];
  assignIfNonEmpty(target, "leaderName", ps?.leaderName);
  assignIfNonEmpty(target, "civName", ps?.civName);
  assignIfNonEmpty(target, "leaderTypeString", ps?.leaderTypeString);
  assignIfNonEmpty(target, "primaryColor", ps?.primaryColor);
}

/**
 * Build a `{ pid -> NodeInfo }` name map by folding identity fields across the
 * full persisted history.
 * @param {DemoHistory|undefined} history The persisted history blob.
 * @returns {Record<string, NodeInfo>} Name info keyed by player id.
 */
function buildNameMap(history) {
  /** @type {Record<string, NodeInfo>} */
  const map = {};
  const samples = history?.samples || [];
  for (const s of samples) {
    if (!s?.players) continue;
    for (const pid of Object.keys(s.players)) {
      foldNameSample(map, pid, s.players[pid]);
    }
  }
  return map;
}

// Resolve a CS display name from the player handle directly. The vanilla
// canonical accessor is `Locale.compose(player.name)` — see
// base-standard/ui/diplo-ribbon/model-diplo-ribbon.js:351. This yields the
// actual minor-civ name (e.g. "Carthage", "Bactra") rather than the generic
// "village" / civilizationType placeholder.
// City-state bonus / type resolution. Civ7 stores a CS's "type" (Cultural /
// Economic / Militaristic / Scientific) via its assigned CityStateBonus —
// the hash is looked up in `Game.CityStates.getBonusType(csPid)` and the
// row is found in `GameInfo.CityStateBonuses` (each row carries
// `.CityStateType`). Cited from
//   base-standard/ui/city-banners/city-banners.js:265-266
//   base-standard/ui-next/tooltips/plot-tooltip/helpers.js:223
// CS type strings observed in age-antiquity/data/independents.xml:199+ :
//   MILITARISTIC, CULTURAL, ECONOMIC, SCIENTIFIC
// (modifier names also reference EXPANSIONIST and DIPLOMATIC — handled).

/**
 * Find the `GameInfo.CityStateBonuses` row whose `$hash` matches `bonusHash`,
 * tolerating both the `.find` and iterator surfaces.
 * @param {number} bonusHash The bonus-type hash to match.
 * @returns {*} The matching row, or `null`.
 */
function findBonusRow(bonusHash) {
  /** @type {*} */
  let row = null;
  try {
    if (typeof GameInfo.CityStateBonuses.find === "function") {
      row = GameInfo.CityStateBonuses.find((/** @type {*} */ r) => r && r.$hash === bonusHash);
    } else if (GameInfo.CityStateBonuses[Symbol.iterator]) {
      for (const r of GameInfo.CityStateBonuses) {
        if (r && r.$hash === bonusHash) {
          row = r;
          break;
        }
      }
    }
  } catch (_) {
    /* */
  }
  return row;
}

/**
 * Pass 1: classify a CS by its assigned tier-1/2/3 bonus. Works once a bonus
 * has been assigned. Cite: base-standard/ui/city-banners/city-banners.js:265-266.
 * @param {number} pid City-state player id.
 * @returns {string|null} The `CityStateType` string, or `null`.
 */
function csTypeFromBonus(pid) {
  if (
    Game?.CityStates &&
    typeof Game.CityStates.getBonusType === "function" &&
    typeof GameInfo !== "undefined" &&
    GameInfo.CityStateBonuses
  ) {
    const bonusHash = Game.CityStates.getBonusType(pid);
    if (bonusHash != null && bonusHash !== -1) {
      const row = findBonusRow(bonusHash);
      if (row?.CityStateType) return row.CityStateType;
    }
  }
  return null;
}

/**
 * Find the `GameInfo.Independents` row whose `CityStateName` matches the
 * civ adjective, tolerating both the `.forEach` and iterator surfaces.
 * @param {string} adj The player's `civilizationAdjective`.
 * @returns {*} The matching row, or `null`.
 */
function findIndependentRow(adj) {
  /** @type {*} */
  let match = null;
  try {
    if (typeof GameInfo.Independents.forEach === "function") {
      GameInfo.Independents.forEach((/** @type {*} */ r) => {
        if (!match && r && r.CityStateName === adj) match = r;
      });
    } else if (GameInfo.Independents[Symbol.iterator]) {
      for (const r of GameInfo.Independents) {
        if (r && r.CityStateName === adj) {
          match = r;
          break;
        }
      }
    }
  } catch (_) {
    /* */
  }
  return match;
}

/**
 * Pass 2: classify a CS from its intrinsic `GameInfo.Independents` row, matched
 * by `civilizationAdjective`. Works even before a bonus is assigned. Cite:
 * base-standard/ui/city-banners/city-banners.js:274-278.
 * @param {number} pid City-state player id.
 * @returns {string|null} The `CityStateType` string, or `null`.
 */
function csTypeFromIndependents(pid) {
  if (
    typeof Players?.get === "function" &&
    typeof GameInfo !== "undefined" &&
    GameInfo.Independents
  ) {
    const p = Players.get(pid);
    const adj = p?.civilizationAdjective;
    if (typeof adj === "string" && adj.length > 0) {
      const match = findIndependentRow(adj);
      if (match?.CityStateType) return match.CityStateType;
    }
  }
  return null;
}

/**
 * Resolve a city-state's type string (MILITARISTIC / CULTURAL / etc.) via the
 * bonus-derived pass, falling back to the intrinsic Independent definition.
 * @param {number} pid City-state player id.
 * @returns {string|null} The `CityStateType`, or `null` when unknown.
 */
function resolveCsType(pid) {
  return safeCall(
    "resolveCsType(" + pid + ")",
    () => csTypeFromBonus(pid) || csTypeFromIndependents(pid),
    null
  );
}

// CS-type → display label + color. Colors chosen for readability against
// the parchment ring background.
// Icon paths cited from
//   age-antiquity/data/icons/city-state-bonus-icons.xml:10,30,50,70
// (e.g. blp:bonus_militaristic, blp:bonus_cultural, etc.). These are the
// same banner-style glyphs the game shows on city banners (sword for
// militaristic, mask for cultural, coin for economic, beaker for
// scientific). No vanilla icon exists for EXPANSIONIST / DIPLOMATIC so
// those fall back to the colored disc (csTypeColor with no icon).
// CS type → label/color/icon. Icon BLP paths cited from
//   age-antiquity/data/icons/city-state-bonus-icons.xml
//   (bonus_militaristic / bonus_cultural / bonus_economic / bonus_scientific
//    + the type-specific bonustype_expansionist / bonustype_diplomatic
//    used for the antiquity expansionist & diplomatic rows).
// All six type variants now ship a canonical icon BLP, so every met CS
// surfaces a proper type glyph instead of a colored disc fallback.
/** @type {Record<string, { label: string, color: string, icon: string }>} */
const CS_TYPE_META = {
  MILITARISTIC: { label: "Militaristic", color: "#d97c7c", icon: "blp:bonus_militaristic" },
  CULTURAL: { label: "Cultural", color: "#c9a2dc", icon: "blp:bonus_cultural" },
  ECONOMIC: { label: "Economic", color: "#e6c14c", icon: "blp:bonus_economic" },
  SCIENTIFIC: { label: "Scientific", color: "#7fb3e6", icon: "blp:bonus_scientific" },
  EXPANSIONIST: { label: "Expansionist", color: "#9ad17a", icon: "blp:bonustype_expansionist" },
  DIPLOMATIC: { label: "Diplomatic", color: "#5fb3b3", icon: "blp:bonustype_diplomatic" }
};

/**
 * Look up the display meta (label/color/icon) for a CS type string.
 * @param {*} typeStr The `CityStateType` string.
 * @returns {{ label: string, color: string, icon: string }|null} Meta, or null.
 */
function csTypeMeta(typeStr) {
  if (typeof typeStr !== "string") return null;
  return CS_TYPE_META[typeStr.toUpperCase()] || null;
}

/**
 * Resolve a CS's primary color via the same vanilla accessor used for majors
 * (`UI.Player.getPrimaryColorValueAsString`).
 * @param {number} pid City-state player id.
 * @returns {string} The color string, or `""` when unavailable.
 */
function resolveCsPrimaryColor(pid) {
  return safeCall(
    "resolveCsPrimaryColor(" + pid + ")",
    () => {
      if (typeof UI?.Player?.getPrimaryColorValueAsString === "function") {
        const s = UI.Player.getPrimaryColorValueAsString(pid);
        if (typeof s === "string" && s.length > 0) return s;
      }
      return "";
    },
    ""
  );
}

/**
 * Compose a locale key to a non-empty string via `Locale.compose`, returning
 * the raw key when compose is unavailable / throws / yields empty.
 * @param {string} key The locale key (or raw display string).
 * @returns {string} The composed string, or `key` unchanged.
 */
function localeComposeSafe(key) {
  if (typeof Locale?.compose === "function") {
    try {
      const s = Locale.compose(key);
      if (typeof s === "string" && s.length > 0) return s;
    } catch (_) {
      /* */
    }
  }
  return key;
}

/**
 * Resolve a CS name from its `civilizationType` row in `GameInfo.Civilizations`.
 * @param {*} p The CS player handle (may be null).
 * @returns {string|null} The composed/raw name, or `null`.
 */
function csNameFromCivType(p) {
  try {
    const civType = p?.civilizationType;
    if (typeof GameInfo?.Civilizations?.lookup === "function") {
      const row = GameInfo.Civilizations.lookup(civType);
      if (row?.Name) return localeComposeSafe(row.Name);
    }
  } catch (_) {
    /* */
  }
  return null;
}

/**
 * Resolve a city-state display name: `Locale.compose(player.name)` first, then
 * the raw `player.name`, then a `GameInfo.Civilizations` lookup, finally a
 * `"City-State <pid>"` placeholder.
 * @param {number} pid City-state player id.
 * @returns {string} The resolved display name.
 */
function resolveCsName(pid) {
  return safeCall(
    "resolveCsName(" + pid + ")",
    () => {
      const p = typeof Players?.get === "function" ? Players.get(pid) : null;
      if (p && p.name) {
        const composed = localeComposeSafe(p.name);
        if (typeof composed === "string" && composed.length > 0) return composed;
      }
      // Fallback: civilizationType lookup.
      return csNameFromCivType(p) || "City-State " + pid;
    },
    "City-State " + pid
  );
}

/**
 * Whether the given viewer player has met `otherPid`. Defensive: returns
 * `undefined` when `Diplomacy.hasMet` is unavailable so callers can fall back.
 * @param {*} viewerPid Viewer player id (number expected).
 * @param {*} otherPid Other player id (number expected).
 * @returns {boolean|undefined} Met state, or `undefined` if undeterminable.
 */
function viewerHasMet(viewerPid, otherPid) {
  if (typeof viewerPid !== "number" || typeof otherPid !== "number") return undefined;
  if (viewerPid === otherPid) return true;
  return safeCall(
    "viewerHasMet(" + viewerPid + "->" + otherPid + ")",
    () => {
      const vp = typeof Players?.get === "function" ? Players.get(viewerPid) : null;
      const d = vp?.Diplomacy;
      if (!d || typeof d.hasMet !== "function") return undefined;
      return !!d.hasMet(otherPid);
    },
    undefined
  );
}

// ---- ring layout ----------------------------------------------------------
// ADAPTED from sloth/global-relations-panel.js:496-510.

/**
 * Lay out `ids` evenly on an ellipse centered at `(cx, cy)`. Backwards-
 * compatible: `ringPositions(ids, radius)` lays out a circle on a 100×100
 * viewBox; newer callers pass `rx, ry, cx, cy`.
 * @param {number[]} ids Node ids to position.
 * @param {number} rx Ellipse x-radius.
 * @param {number} [ry] Ellipse y-radius (defaults to `rx`).
 * @param {number} [cx] Center x (defaults to 50).
 * @param {number} [cy] Center y (defaults to 50).
 * @returns {Map<number, {x: number, y: number}>} Node positions.
 */
function ringPositions(ids, rx, ry, cx, cy) {
  // Backwards-compatible: ringPositions(ids, radius) → circle on a 100×100
  // viewBox. Newer callers pass rx, ry (different) plus cx, cy to lay
  // nodes out on an ellipse centered at (cx, cy).
  if (typeof ry !== "number") ry = rx;
  if (typeof cx !== "number") cx = 50;
  if (typeof cy !== "number") cy = 50;
  const positions = new Map();
  const N = ids.length;
  if (N === 0) return positions;
  for (let i = 0; i < N; i++) {
    const angle = N === 1 ? 0 : -Math.PI / 2 + (2 * Math.PI * i) / N;
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);
    positions.set(ids[i], { x, y });
  }
  return positions;
}

// ---- per-subtab edge builders ---------------------------------------------
// Each builder returns an array of edge objects:
//   { a, b, color, label?, dashed?, width?, opacity? }
// where a, b are pids and a <= b unless otherwise noted.

/**
 * Read a player's diplomatic events list defensively.
 * @param {number} a Player id whose events to read.
 * @returns {*[]} The events array (empty on any error).
 */
function getPlayerEvents(a) {
  return (
    safeCall("getPlayerEvents(" + a + ")", () => {
      if (
        typeof Game === "undefined" ||
        !Game.Diplomacy ||
        typeof Game.Diplomacy.getPlayerEvents !== "function"
      )
        return [];
      return Game.Diplomacy.getPlayerEvents(a) || [];
    }) || []
  );
}

/**
 * Resolve the "other" player id involved in a diplomacy event, relative to
 * the queried player `a`. Mirrors the original target/other/initial fallback.
 * @param {*} ev One diplomacy event.
 * @param {number} a The player whose events list `ev` came from.
 * @returns {number|undefined} The other player id, or `undefined`.
 */
function resolveEventOther(ev, a) {
  let other = ev.targetPlayer;
  if (typeof other !== "number") other = ev.otherPlayer;
  if (typeof other !== "number") {
    other = ev.initialPlayer !== a ? ev.initialPlayer : undefined;
  }
  return other;
}

/**
 * Build undirected alliance edges among the met-major ring.
 * @param {number[]} metIds Met major ids.
 * @returns {Edge[]} Alliance edges.
 */
function buildAllianceEdges(metIds) {
  /** @type {Edge[]} */
  const edges = [];
  for (let i = 0; i < metIds.length; i++) {
    const a = metIds[i];
    const pa = Players.get(a);
    if (!pa) continue;
    for (let j = i + 1; j < metIds.length; j++) {
      const b = metIds[j];
      if (hasAlliance(pa, b)) {
        edges.push({ a, b, color: "#9933ff", filterKey: "alliance" });
      }
    }
  }
  return edges;
}

/**
 * Build undirected at-war edges among the met-major ring.
 * @param {number[]} metIds Met major ids.
 * @returns {Edge[]} War edges.
 */
function buildWarEdges(metIds) {
  /** @type {Edge[]} */
  const edges = [];
  for (let i = 0; i < metIds.length; i++) {
    const a = metIds[i];
    const pa = Players.get(a);
    if (!pa) continue;
    for (let j = i + 1; j < metIds.length; j++) {
      const b = metIds[j];
      if (isAtWar(pa, b)) {
        edges.push({ a, b, color: "#e02020", filterKey: "war" });
      }
    }
  }
  return edges;
}

/**
 * Build undirected edges for a single diplomatic action type queried via
 * `getPlayerEvents`, deduping reciprocal events with a sorted pair key.
 * @param {number[]} metIds Met major ids.
 * @param {number|undefined} actionType The `DIPLOMACY_ACTION_*` int to match.
 * @param {string} color Edge color.
 * @param {string} filterKey Filter key to tag edges with.
 * @returns {Edge[]} The matching edges.
 */
function buildActionTypeEdges(metIds, actionType, color, filterKey) {
  /** @type {Edge[]} */
  const edges = [];
  if (actionType === undefined) return edges;
  const seen = new Set();
  for (const a of metIds) {
    const events = getPlayerEvents(a);
    for (const ev of events) {
      if (!ev || ev.actionType !== actionType) continue;
      const other = resolveEventOther(ev, a);
      if (typeof other !== "number" || other === a) continue;
      if (!metIds.includes(other)) continue;
      const key = Math.min(a, other) + "|" + Math.max(a, other);
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ a, b: other, color, filterKey });
    }
  }
  return edges;
}

/**
 * Pre-resolve an endeavor action list into engine int + color lookups,
 * skipping entries with no runtime `DiplomacyActionTypes` int.
 * @param {{ name: string, color: string }[]} actionList Endeavor entries.
 * @returns {ActionLookup[]} Resolved lookups.
 */
function resolveEndeavorLookups(actionList) {
  /** @type {ActionLookup[]} */
  const lookups = [];
  const Types = typeof DiplomacyActionTypes !== "undefined" ? DiplomacyActionTypes : null;
  if (!Types) return lookups;
  for (const entry of actionList) {
    const t = Types[entry.name];
    if (typeof t === "number") lookups.push({ t, color: entry.color, name: entry.name });
  }
  return lookups;
}

/**
 * Format an endeavor action name into a human-readable edge label.
 * @param {string} name The `DIPLOMACY_ACTION_*` name.
 * @returns {string} The lower-cased, spaced label.
 */
function endeavorLabel(name) {
  return name
    .replace(/^DIPLOMACY_ACTION_/, "")
    .toLowerCase()
    .replace(/_/g, " ");
}

/**
 * Generic endeavor / treaty scanner. Each diplomatic action type appears in
 * BOTH participants' `getPlayerEvents()` list, so we dedupe via a sorted pair
 * + action-type key. Each entry carries its own edge color.
 * @param {{ name: string, color: string }[]} actionList ENDEAVOR_ACTIONS entry.
 * @param {number[]} metIds Met major ids.
 * @param {string} filterKey Filter key to tag edges with.
 * @returns {Edge[]} The endeavor edges.
 */
function pushEndeavorEdges(actionList, metIds, filterKey) {
  /** @type {Edge[]} */
  const edges = [];
  if (!actionList || actionList.length === 0) return edges;
  // Pre-resolve action-type ints + their colors so the inner loop is
  // O(events × types) without repeating string→enum lookups.
  const lookups = resolveEndeavorLookups(actionList);
  if (lookups.length === 0) return edges;
  const seen = new Set();
  for (const a of metIds) {
    for (const ev of getPlayerEvents(a)) {
      pushOneEndeavorEdge(edges, seen, ev, a, metIds, lookups, filterKey);
    }
  }
  return edges;
}

/**
 * Match one diplomacy event against the endeavor lookups and append an edge
 * (deduped on sorted pair + action type) if it qualifies.
 * @param {Edge[]} edges Accumulator to push into.
 * @param {Set<string>} seen Dedupe key set (mutated).
 * @param {*} ev One diplomacy event.
 * @param {number} a The player whose events list `ev` came from.
 * @param {number[]} metIds Met major ids.
 * @param {ActionLookup[]} lookups Pre-resolved endeavor lookups.
 * @param {string} filterKey Filter key to tag the edge with.
 * @returns {void}
 */
function pushOneEndeavorEdge(edges, seen, ev, a, metIds, lookups, filterKey) {
  if (!ev || typeof ev.actionType !== "number") return;
  const hit = lookups.find((l) => l.t === ev.actionType);
  if (!hit) return;
  const other = resolveEventOther(ev, a);
  if (typeof other !== "number" || other === a) return;
  if (!metIds.includes(other)) return;
  // Dedupe pair + action-type so different endeavors between the same pair
  // show as separate edges.
  const key = Math.min(a, other) + "|" + Math.max(a, other) + "|" + hit.t;
  if (seen.has(key)) return;
  seen.add(key);
  edges.push({ a, b: other, color: hit.color, filterKey, label: endeavorLabel(hit.name) });
}

/**
 * Resolve a `DiplomacyActionTypes` enum int by name, defensively.
 * @param {string} name The `DIPLOMACY_ACTION_*` enum name.
 * @returns {number|undefined} The action-type int, or `undefined`.
 */
function actionTypeByName(name) {
  return typeof DiplomacyActionTypes !== "undefined" ? DiplomacyActionTypes[name] : undefined;
}

/**
 * Build the political-action edges for a single filter key (alliance, war,
 * denounced, research, endeavors, openborders) among the met-major ring.
 * @param {number[]} metIds Met major ids.
 * @param {string} filterKey The political filter key to build.
 * @returns {Edge[]} The edges for that filter (empty when unhandled).
 */
function buildPoliticalEdges(metIds, filterKey) {
  if (typeof Players === "undefined" || typeof Players.get !== "function") return [];

  if (filterKey === "alliance") return buildAllianceEdges(metIds);
  if (filterKey === "war") return buildWarEdges(metIds);
  if (filterKey === "research" || filterKey === "endeavors") {
    return pushEndeavorEdges(ENDEAVOR_ACTIONS[filterKey], metIds, filterKey);
  }
  if (filterKey === "denounced") {
    // Denunciations are diplomatic actions, queried via getPlayerEvents the
    // same way Open Borders is. Direction matters (A denounced B is not
    // symmetric), but the ring treats edges as undirected pairs — we collapse
    // with a sorted key to dedupe reciprocal denounces.
    return buildActionTypeEdges(
      metIds,
      actionTypeByName("DIPLOMACY_ACTION_DENOUNCE"),
      "#ff7f1a",
      "denounced"
    );
  }
  if (filterKey === "openborders") {
    // Open Borders is a diplomatic action/deal. Cited pattern:
    // base-standard/ui/diplomacy-actions/panel-diplomacy-actions.js:269-273, 2413-2417.
    return buildActionTypeEdges(
      metIds,
      actionTypeByName("DIPLOMACY_ACTION_OPEN_BORDERS"),
      "#5bc8ff",
      "openborders"
    );
  }
  return [];
}

/**
 * Resolve a player's `Trade` handle if it exposes `countPlayerTradeRoutesTo`.
 * @param {number} fromPid Source player id.
 * @returns {*} The trade handle, or `null`.
 */
function resolveTradeHandle(fromPid) {
  const fromPlayer = safeCall("Players.get(" + fromPid + ")", () => Players.get(fromPid), null);
  const trade = fromPlayer?.Trade;
  if (!trade || typeof trade.countPlayerTradeRoutesTo !== "function") return null;
  return trade;
}

/**
 * Count trade routes from a trade handle to `toPid`, defensively.
 * @param {*} trade The source player's trade handle.
 * @param {number} toPid Destination player id.
 * @returns {number} The route count (`0` on any error).
 */
function tradeRouteCount(trade, toPid) {
  try {
    return trade.countPlayerTradeRoutesTo(toPid) | 0;
  } catch (_) {
    return 0;
  }
}

/**
 * Build trade-route edges among the met-major ring (plus the local player),
 * one per directed pair with a route count > 0.
 * @param {number[]} metIds Met major ids.
 * @param {string} _filterKey Unused (kept for builder-signature parity).
 * @param {number} [localPid] Local player id to fold into the source set.
 * @returns {Edge[]} Trade edges.
 */
function buildEconomicEdges(metIds, _filterKey, localPid) {
  // Per-pair trade route count via player.Trade.countPlayerTradeRoutesTo(otherId).
  /** @type {Edge[]} */
  const edges = [];
  if (typeof Players === "undefined" || typeof Players.get !== "function") return edges;
  const pids = metIds.slice();
  if (typeof localPid === "number" && !pids.includes(localPid)) pids.push(localPid);
  for (const fromPid of pids) {
    const trade = resolveTradeHandle(fromPid);
    if (!trade) continue;
    for (const toPid of pids) {
      if (toPid === fromPid) continue;
      const n = tradeRouteCount(trade, toPid);
      if (n > 0) {
        const weight = Math.min(1, n / 3);
        edges.push({
          a: fromPid,
          b: toPid,
          color: "#4dc6c6",
          opacity: 0.5 + weight * 0.5,
          filterKey: "trade"
        });
      }
    }
  }
  return edges;
}

// Pairwise attitude edges among met majors.
// For each pair (i, j) i<j we look at getRelationship from i's perspective
// (sloth uses the same one-sided lookup; the relationship enum is symmetric
// in practice). War / Alliance are surfaced explicitly so they color over
// the bare enum.

/**
 * Resolve the attitude category key for a directed (a → b) relationship,
 * surfacing war / alliance explicitly over the bare enum.
 * @param {*} pa Source player handle.
 * @param {number} b Target player id.
 * @returns {string} The attitude category key.
 */
function attitudeCatFor(pa, b) {
  if (isAtWar(pa, b)) return "war";
  if (hasAlliance(pa, b)) return "alliance";
  return attitudeKeyFromEnum(getRelationship(pa, b));
}

/**
 * Build pairwise attitude edges among met majors.
 * @param {number[]} metIds Met major ids.
 * @param {number} [_localPid] Unused (kept for builder-signature parity).
 * @returns {Edge[]} Attitude edges.
 */
function buildAttitudeEdges(metIds, _localPid) {
  /** @type {Edge[]} */
  const edges = [];
  if (typeof Players === "undefined" || typeof Players.get !== "function") return edges;
  for (let i = 0; i < metIds.length; i++) {
    const a = metIds[i];
    const pa = Players.get(a);
    if (!pa) continue;
    for (let j = i + 1; j < metIds.length; j++) {
      const b = metIds[j];
      const catKey = attitudeCatFor(pa, b);
      edges.push({ a, b, color: categoryColor(catKey), filterKey: catKey });
    }
  }
  return edges;
}

// ---- City-State edge builders ---------------------------------------------

/**
 * Read a city-state's suzerain id defensively.
 * @param {*} cs The city-state player handle.
 * @returns {number} The suzerain id, or `-1`.
 */
function readSuzerain(cs) {
  const inf = cs?.Influence;
  if (!inf || typeof inf.getSuzerain !== "function") return -1;
  let suz = -1;
  try {
    suz = inf.getSuzerain();
  } catch (_) {
    suz = -1;
  }
  return typeof suz === "number" ? suz : -1;
}

/**
 * Suzerainty: for every CS, get `csPlayer.Influence.getSuzerain()`. If it is
 * the local player or any met major, emit an edge from suzerain → CS.
 * @param {number[]} metIds Met major ids.
 * @param {number[]} csIds City-state ids.
 * @param {number} [localPid] Local player id (folded into the major set).
 * @returns {Edge[]} Suzerain edges.
 */
function buildCsSuzerainEdges(metIds, csIds, localPid) {
  /** @type {Edge[]} */
  const edges = [];
  if (typeof Players === "undefined" || typeof Players.get !== "function") return edges;
  const majors = new Set(metIds);
  if (typeof localPid === "number") majors.add(localPid);
  for (const csId of csIds) {
    const cs = safeCall("Players.get(" + csId + ")", () => Players.get(csId), null);
    const suz = readSuzerain(cs);
    if (suz < 0) continue;
    if (!majors.has(suz)) continue;
    edges.push({ a: suz, b: csId, color: "#f3c34c", dashed: true, filterKey: "suzerain" });
  }
  return edges;
}

/**
 * Trade routes: each major × each CS. Edge opacity scales with route count.
 * @param {number[]} metIds Met major ids.
 * @param {number[]} csIds City-state ids.
 * @param {number} [localPid] Local player id (folded into the source set).
 * @returns {Edge[]} CS trade edges.
 */
function buildCsTradeEdges(metIds, csIds, localPid) {
  /** @type {Edge[]} */
  const edges = [];
  if (typeof Players === "undefined" || typeof Players.get !== "function") return edges;
  const sources = metIds.slice();
  if (typeof localPid === "number" && !sources.includes(localPid)) sources.push(localPid);
  for (const fromPid of sources) {
    const trade = resolveTradeHandle(fromPid);
    if (!trade) continue;
    for (const csId of csIds) {
      const n = tradeRouteCount(trade, csId);
      if (n > 0) {
        const weight = Math.min(1, n / 3);
        edges.push({
          a: fromPid,
          b: csId,
          color: "#4dc6c6",
          width: 1 + weight * 1.5,
          opacity: 0.5 + weight * 0.5,
          filterKey: "trade"
        });
      }
    }
  }
  return edges;
}

/**
 * Resolve the attitude category key from a single major toward a CS: the
 * relationship enum (war surfaced explicitly) when available, otherwise the
 * suzerain-derived fallback (suzerain = helpful, others = neutral). Returns
 * `null` when no useful data exists.
 * @param {*} major The major player handle.
 * @param {number} majorPid The major player id.
 * @param {number} csId City-state id.
 * @param {number} suz Pre-computed suzerain id (or `-1`).
 * @returns {string|null} The attitude key, or `null` to skip.
 */
function csAttitudeCatFor(major, majorPid, csId, suz) {
  const rel = getRelationship(major, csId);
  if (rel !== undefined && rel !== null) {
    if (isAtWar(major, csId)) return "war";
    return attitudeKeyFromEnum(rel);
  }
  if (typeof suz === "number" && suz >= 0) {
    return suz === majorPid ? "helpful" : "neutral";
  }
  return null;
}

/**
 * Build attitude edges between every major and a single CS, appending them to
 * `edges`. Returns whether any edge was emitted.
 * @param {Edge[]} edges Accumulator to push into.
 * @param {number[]} majors Major player ids.
 * @param {number} csId City-state id.
 * @param {number} suz The CS's suzerain id (or `-1`).
 * @returns {boolean} True when at least one edge was emitted.
 */
function appendCsAttitudeForCs(edges, majors, csId, suz) {
  let anyEmitted = false;
  for (const majorPid of majors) {
    const major = safeCall("Players.get(" + majorPid + ")", () => Players.get(majorPid), null);
    if (!major) continue;
    const catKey = csAttitudeCatFor(major, majorPid, csId, suz);
    if (catKey === null) continue; // No useful data; skip this (major, CS) edge.
    edges.push({ a: majorPid, b: csId, color: categoryColor(catKey), filterKey: catKey });
    anyEmitted = true;
  }
  return anyEmitted;
}

/**
 * Attitude (major × CS). If the major has a working `getRelationshipEnum`
 * against the CS, use it; otherwise fall back to suzerain-derived tier:
 * the CS's suzerain = "helpful", everyone else "neutral". If neither is
 * readable, the CS is skipped.
 * @param {number[]} metIds Met major ids.
 * @param {number[]} csIds City-state ids.
 * @param {number} [localPid] Local player id (folded into the major set).
 * @returns {Edge[]} CS attitude edges.
 */
function buildCsAttitudeEdges(metIds, csIds, localPid) {
  /** @type {Edge[]} */
  const edges = [];
  if (typeof Players === "undefined" || typeof Players.get !== "function") return edges;
  const majors = metIds.slice();
  if (typeof localPid === "number" && !majors.includes(localPid)) majors.push(localPid);

  for (const csId of csIds) {
    const cs = safeCall("Players.get(" + csId + ")", () => Players.get(csId), null);
    if (!cs) continue;
    // Pre-compute suzerain for fallback path.
    const suz = readSuzerainLoose(cs);
    const anyEmitted = appendCsAttitudeForCs(edges, majors, csId, suz);
    if (!anyEmitted) {
      dlog("CS attitude: skipped CS pid", csId, "(no useful relationship data)");
    }
  }
  return edges;
}

/**
 * Read a CS's suzerain id via optional chaining, defaulting to `-1`. Mirrors
 * the attitude builder's original `cs.Influence?.getSuzerain?.() ?? -1` form
 * (does not coerce non-numbers, unlike {@link readSuzerain}).
 * @param {*} cs The city-state player handle.
 * @returns {number} The suzerain id, or `-1`.
 */
function readSuzerainLoose(cs) {
  try {
    return cs.Influence?.getSuzerain?.() ?? -1;
  } catch (_) {
    return -1;
  }
}

// ---- filter persistence ---------------------------------------------------

// Unified filter sets — the political/economic/attitude subtabs were folded
// into a single ring per top tab so users can see "Augustus is allied AND has
// open borders AND a trade route with me" in one glance instead of switching
// between three panels.
//
// Civ tab carries attitude buckets (war/alliance/etc) + political actions
// (open borders, denounced) + economic (trade routes).
// CS tab carries suzerain + trade + attitude (the same set, viewer-anchored).

/**
 * The filter-pill descriptors for a top tab, in render order.
 * @param {string} topTab Either "civ" or "cs".
 * @returns {FilterDef[]} The ordered filter definitions.
 */
function filtersForView(topTab) {
  if (topTab === "civ") {
    // Order matters — pills render in this order; attitude grouped first
    // so the relationship-state pills sit together visually.
    return [
      { key: "war", label: "At War", kind: "attitude" },
      { key: "alliance", label: "Alliance", kind: "attitude" },
      { key: "helpful", label: "Helpful", kind: "attitude" },
      { key: "friendly", label: "Friendly", kind: "attitude" },
      { key: "unfriendly", label: "Unfriendly", kind: "attitude" },
      { key: "hostile", label: "Hostile", kind: "attitude" },
      // Neutral intentionally omitted — N² neutral lines just clutter.
      { key: "openborders", label: "Open Borders", kind: "political" },
      { key: "denounced", label: "Denounced", kind: "political" },
      { key: "research", label: "Research Agreements", kind: "political" },
      { key: "endeavors", label: "Other Endeavors", kind: "political" },
      { key: "trade", label: "Trade Routes", kind: "economic" }
    ];
  }
  // City-state tab — viewer-anchored relationships.
  return [
    { key: "suzerain", label: "Suzerainty", kind: "political" },
    { key: "trade", label: "Trade Routes", kind: "economic" },
    { key: "war", label: "At War", kind: "attitude" },
    { key: "alliance", label: "Alliance", kind: "attitude" },
    { key: "helpful", label: "Helpful", kind: "attitude" },
    { key: "friendly", label: "Friendly", kind: "attitude" },
    { key: "unfriendly", label: "Unfriendly", kind: "attitude" },
    { key: "hostile", label: "Hostile", kind: "attitude" }
  ];
}

/**
 * The persisted-setting key holding the active filter set for a top tab.
 * @param {string} topTab Either "civ" or "cs".
 * @returns {string} The settings key.
 */
function filterKeyForState(topTab) {
  return topTab === "civ" ? "relationsCivFilters" : "relationsCsFilters";
}

/**
 * The default (all-on) filter key list for a top tab.
 * @param {string} topTab Either "civ" or "cs".
 * @returns {string[]} The default filter keys.
 */
function defaultFiltersFor(topTab) {
  return filtersForView(topTab).map((f) => f.key);
}

// Per-filter line texture. Returns the SVG `stroke-dasharray` value to use
// for an edge of that filter key, or "" for a solid line. Pairing rationale:
//   research / endeavors share warm-cool space with trade and denounced —
//   give them distinct dash patterns so the eye can pick them apart even
//   when the same pair has multiple parallel edges.
// Stroke is 0.6 viewBox units. Dash patterns are sized large enough to
// remain obvious across the typical 20–50 viewBox-unit edge lengths in
// this ring. Earlier "1.6 1.2" / "0.6 1.4" patterns were imperceptible
// at typical rendered scales — bumped well above stroke width.
/** @type {Record<string, string>} */
const LINE_DASH = {
  // Primary signals — solid:
  war: "",
  alliance: "",
  helpful: "",
  friendly: "",
  unfriendly: "",
  hostile: "",
  trade: "",
  // Overlay categories — patterned (units = SVG viewBox 0..100):
  openborders: "5 2", // long-dash
  denounced: "2.5 2", // medium-dash
  research: "0.6 2", // dots
  endeavors: "4 2 0.6 2", // dash-dot
  suzerain: "3 2" // CS suzerainty
};
let _dashLogged = false;

/**
 * Resolve the dash-array pattern for an edge, honoring per-tab overrides, the
 * legacy `dashed` flag, then the per-filter `LINE_DASH` table.
 * @param {Edge} edge The edge to texture.
 * @returns {string} The dash pattern (`""` = solid line).
 */
function dasharrayFor(edge) {
  if (!edge) return "";
  // Per-tab override applied at edge-build time (see CS_FILTER_OVERRIDES
  // injection in repaint). Wins over everything else so the CS tab can
  // recolor trade=yellow-dotted etc. without touching the base maps.
  if (typeof edge._dashOverride === "string") return edge._dashOverride;
  if (edge._dashOverride === null || edge._dashOverride === "") return "";
  // Legacy `e.dashed` flag (suzerain edges set it directly) — preserve.
  if (edge.dashed && !edge.filterKey) return "1.4 1.0";
  const k = edge.filterKey || "";
  if (Object.prototype.hasOwnProperty.call(LINE_DASH, k)) return LINE_DASH[k];
  return edge.dashed ? "1.4 1.0" : "";
}

// Single source of truth for filter-pill swatch colors. Attitude keys pull
// the live palette so colorblind mode applies; political/economic keys have
// their own fixed colors (these aren't "civ attitudes" semantically).
// Per-topTab visual overrides. The City-State tab has a different visual
// vocabulary than the major-civs tab — friendly green stays green, but the
// other relationship colors are recolored to be more legible against the
// CS ring background and to distinguish them from major-civ filters at
// a glance. Suzerainty is the headline CS relationship → blue. Trade
// routes get a dotted yellow so they're easy to scan along long CS spokes.
/** @type {Record<string, { color: string, dash: string|undefined }>} */
const CS_FILTER_OVERRIDES = {
  suzerain: { color: "#5bc8ff", dash: "" }, // blue, solid
  trade: { color: "#f3c34c", dash: "0.6 2" }, // yellow, dotted
  unfriendly: { color: "#ff7f1a", dash: undefined }, // orange, solid
  friendly: { color: "#3fbf3f", dash: undefined } // green (unchanged)
};

/**
 * Resolve the per-tab visual override for a filter key, if any.
 * @param {string} key Filter key.
 * @param {string} topTab Either "civ" or "cs".
 * @returns {{ color?: string, dash?: string }|null} Override, or `null`.
 */
function filterVisuals(key, topTab) {
  if (topTab === "cs" && CS_FILTER_OVERRIDES[key]) {
    return CS_FILTER_OVERRIDES[key];
  }
  return null; // no override → fall through to base color/dash maps
}

/**
 * Resolve the swatch/pill color for a filter key, honoring per-tab overrides,
 * the live attitude palette, then the fixed political/economic colors.
 * @param {string} key Filter key.
 * @param {string} topTab Either "civ" or "cs".
 * @returns {string} The pill color.
 */
function pillColorFor(key, topTab) {
  const ov = filterVisuals(key, topTab);
  if (ov && ov.color) return ov.color;
  const att = getAttitudeColors();
  if (att[key]) return att[key];
  switch (key) {
    case "openborders":
      return "#5bc8ff";
    case "denounced":
      return "#ff7f1a";
    case "research":
      return "#c084fc";
    case "endeavors":
      return "#f5a060";
    case "trade":
      return "#4dc6c6";
    case "suzerain":
      return "#f3c34c";
    default:
      return "#bfbfbf";
  }
}

// ---- DOM builders ---------------------------------------------------------

/**
 * Build an `fxs-tab-bar` element wired to `onSelect`.
 * @param {{ id: string, label: string }[]} tabs Tab descriptors.
 * @param {string} activeKey The currently-selected tab id.
 * @param {string} className The bar's extra CSS class.
 * @param {(id: string) => void} onSelect Selection callback.
 * @returns {HTMLElement} The tab-bar element.
 */
function makeTabBar(tabs, activeKey, className, onSelect) {
  const bar = document.createElement("fxs-tab-bar");
  bar.classList.add(className, "w-full", "font-title", "text-sm");
  bar.setAttribute("data-audio-group-ref", "audio-screen-unlocks");
  bar.setAttribute("tab-item-class", "font-title text-base");
  bar.setAttribute("tab-items", JSON.stringify(tabs));
  const idx = Math.max(
    0,
    tabs.findIndex((t) => t.id === activeKey)
  );
  bar.setAttribute("selected-tab-index", String(idx));
  bar.addEventListener("tab-selected", (event) => {
    const id = /** @type {*} */ (event)?.detail?.selectedItem?.id;
    if (!id) return;
    onSelect(id);
  });
  return bar;
}

/**
 * Wire hover-color in/out behavior on an "All On"/"All Off" link span.
 * @param {HTMLElement} el The link span.
 * @returns {void}
 */
function wireAllToggleHover(el) {
  el.addEventListener("mouseenter", () => (el.style.color = "var(--ia-accent-gold,#f3c34c)"));
  el.addEventListener("mouseleave", () => (el.style.color = "var(--ia-text-secondary,#e5d2ac)"));
}

/**
 * Build the "All On · All Off" header row that flips every filter at once,
 * calling `onToggleAll(true|false)` so the outer view does a single repaint.
 * @param {(turnOn: boolean) => void} onToggleAll Bulk-toggle callback.
 * @returns {HTMLElement} The control row element.
 */
function buildAllToggleRow(onToggleAll) {
  const ctrlRow = document.createElement("div");
  ctrlRow.style.cssText =
    "display:flex;gap:0.7rem;align-items:center;" +
    "margin-bottom:0.35rem;padding-bottom:0.3rem;" +
    "border-bottom:1px solid rgba(168,132,90,0.25);" +
    "font-size:0.72rem;color:var(--ia-text-accent-2,#c2c4cc);" +
    "text-transform:uppercase;letter-spacing:0.08em;" +
    "font-family:TitleFont, BodyFont, sans-serif;";
  const allOn = document.createElement("span");
  allOn.textContent = "All On";
  allOn.style.cssText =
    "cursor:pointer;color:var(--ia-text-secondary,#e5d2ac);" + "transition:color 0.1s;";
  wireAllToggleHover(allOn);
  allOn.addEventListener("click", (ev) => {
    ev?.stopPropagation?.();
    safePlaySound("data-audio-activate", "audio-panel-diplo-ribbon");
    onToggleAll(true);
  });
  const sep = document.createElement("span");
  sep.textContent = "·";
  sep.style.cssText = "color:rgba(168,132,90,0.5);";
  const allOff = document.createElement("span");
  allOff.textContent = "All Off";
  allOff.style.cssText =
    "cursor:pointer;color:var(--ia-text-secondary,#e5d2ac);" + "transition:color 0.1s;";
  wireAllToggleHover(allOff);
  allOff.addEventListener("click", (ev) => {
    ev?.stopPropagation?.();
    safePlaySound("data-audio-activate", "audio-panel-diplo-ribbon");
    onToggleAll(false);
  });
  ctrlRow.appendChild(allOn);
  ctrlRow.appendChild(sep);
  ctrlRow.appendChild(allOff);
  return ctrlRow;
}

const SAMPLE_W = 84; // px — 75% bigger so dash patterns are very visible

/**
 * Append one solid sub-segment span to a swatch, used to synthesize dash
 * patterns (Coherent's SVG renderer rejects `stroke-dasharray`).
 * @param {HTMLElement} swatch The swatch container.
 * @param {string} color The segment color.
 * @param {number} leftPx Left offset, px.
 * @param {number} widthPx Segment width, px.
 * @returns {void}
 */
function pushSwatchSeg(swatch, color, leftPx, widthPx) {
  const d = document.createElement("span");
  d.style.cssText =
    "position:absolute;top:0;height:7px;" +
    "left:" +
    leftPx +
    "px;width:" +
    widthPx +
    "px;" +
    "background:" +
    color +
    ";" +
    "border-radius:3.5px;";
  swatch.appendChild(d);
}

/**
 * Build a filter pill's mini sample-line swatch: a fixed-width inline element
 * showing the filter's color + dash texture as solid HTML sub-segments. (SVG
 * `<line>` children render blank in some Coherent builds.)
 * @param {FilterDef} f The filter descriptor.
 * @returns {HTMLElement} The swatch span.
 */
function buildFilterSwatch(f) {
  const swatch = document.createElement("span");
  swatch.style.cssText =
    "display:inline-block;vertical-align:middle;" +
    "width:" +
    SAMPLE_W +
    "px;height:7px;" +
    "margin-right:0.75rem;flex-shrink:0;position:relative;";
  const color = f.color || "#bfbfbf";
  // Honor per-tab dash override on the swatch so the legend visual
  // matches the actual ring edge (CS tab: trade=dotted, suzerain=dashed).
  const dashPattern =
    f._dashOverride !== undefined ? f._dashOverride || "" : LINE_DASH[f.key] || "";
  if (!dashPattern) {
    pushSwatchSeg(swatch, color, 0, SAMPLE_W);
    return swatch;
  }
  const parts = dashPattern
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((n) => !isNaN(n) && n > 0);
  const patternSum = parts.reduce((a, b) => a + b, 0) || 1;
  const scale = SAMPLE_W / (patternSum * 2);
  let t = 0;
  let segIdx = 0;
  while (t < SAMPLE_W) {
    const segLen = parts[segIdx % parts.length] * scale;
    const end = Math.min(t + segLen, SAMPLE_W);
    if (segIdx % 2 === 0 && end > t + 0.5) {
      pushSwatchSeg(swatch, color, t, end - t);
    }
    t = end;
    segIdx++;
  }
  return swatch;
}

/**
 * Attach the de-bounced click / action-activate / mousedown handlers to a
 * filter pill. Coherent may dispatch BOTH `click` and `action-activate` for
 * one activation; a 50ms window guards against the double-toggle.
 * @param {HTMLElement} pill The pill element.
 * @param {FilterDef} f The filter descriptor.
 * @param {boolean} active The pill's active state at build time.
 * @param {(key: string) => void} onToggle Toggle callback.
 * @returns {void}
 */
function wireFilterPill(pill, f, active, onToggle) {
  let lastFired = 0;
  /**
   * Build a de-bounced event handler for one event name.
   * @param {string} evName The event name (for logging).
   * @returns {(ev: *) => void} The handler.
   */
  const fire = (evName) => (ev) => {
    if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
    const now =
      typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    if (now - lastFired < 50) {
      dlog("filter pill " + evName + " key=" + f.key, "SKIPPED (dedup)");
      return;
    }
    lastFired = now;
    safePlaySound("data-audio-activate", "audio-panel-diplo-ribbon");
    dlog("filter pill " + evName + " key=" + f.key, "wasActive=" + active);
    onToggle(f.key);
  };
  pill.addEventListener("click", fire("click"));
  pill.addEventListener("action-activate", fire("action-activate"));
  pill.addEventListener("mousedown", (_ev) => {
    dlog("filter pill MOUSEDOWN key=" + f.key);
  });
}

/**
 * Build a single filter pill (swatch + label) wired to `onToggle`.
 * @param {FilterDef} f The filter descriptor.
 * @param {Set<string>} activeSet The active filter-key set.
 * @param {(key: string) => void} onToggle Toggle callback.
 * @returns {HTMLElement} The pill element.
 */
function buildFilterPill(f, activeSet, onToggle) {
  const active = activeSet.has(f.key);
  const label = typeof f.label === "string" && f.label.length > 0 ? f.label : "(" + f.key + ")";
  dlog(
    "filter pill build key=" + f.key,
    "label='" + label + "'",
    "color=" + f.color,
    "active=" + active
  );

  // Single-element pill: <div> with textContent. Nested children
  // (pip <span/div> + label <span/div>) were rendering empty in
  // Coherent for reasons we couldn't pin down. Putting the whole
  // label — disc glyph + text — into the pill's textContent matches
  // the pattern that works for factbook headers and the new chart
  // line labels.
  const pill = document.createElement("div");
  pill.className = "demographics-relations-filter-pill font-body text-sm";
  if (!active) pill.classList.add("is-hidden");
  else pill.classList.add("is-active");
  pill.title = label + (active ? " (click to hide)" : " (click to show)");

  // ── Mini sample line: an inline element showing exactly what this
  // filter's edges look like on the ring. The "swatch" is a tiny
  // horizontal line drawn in the filter's color, with the SAME dash
  // pattern (rendered as multiple solid sub-segments — Coherent's
  // SVG renderer rejects stroke-dasharray). This is the actual
  // legend mapping color+texture → filter type.
  pill.appendChild(buildFilterSwatch(f));
  const lbl = document.createElement("span");
  lbl.textContent = label;
  pill.appendChild(lbl);

  wireFilterPill(pill, f, active, onToggle);
  return pill;
}

/**
 * Build the toggleable filter-pill row — visual vocabulary mirrors the History
 * view legend (pip + label, filled when active, hollow/dim when off). Uses a
 * plain `<div>` (not `<fxs-activatable>`) so click handling is direct.
 * @param {FilterDef[]} filters Filter descriptors to render.
 * @param {Set<string>} activeSet The active filter-key set.
 * @param {(key: string) => void} onToggle Per-pill toggle callback.
 * @param {(turnOn: boolean) => void} [onToggleAll] Bulk-toggle callback.
 * @returns {HTMLElement} The pill-row element.
 */
function makeFilterPillRow(filters, activeSet, onToggle, onToggleAll) {
  // DOM SHAPE COPIED from view-history.js renderLegend(): each pill is
  // an `.demographics-legend-entry` with `.demographics-legend-pip` +
  // `.demographics-legend-swatch` + `.demographics-legend-name` spans.
  // We tag with `.demographics-relations-filter-row` so the CSS can flip
  // these from the vertical (legend) layout into a horizontal wrap row.
  const row = document.createElement("div");
  row.className = "demographics-relations-filter-row font-body text-xs";
  if (!filters || filters.length === 0) return row;

  // "All on" / "All off" header — flips every filter at once. Sits above
  // the per-filter pills as a small two-link row.
  if (typeof onToggleAll === "function") {
    row.appendChild(buildAllToggleRow(onToggleAll));
  }
  for (const f of filters) {
    row.appendChild(buildFilterPill(f, activeSet, onToggle));
  }
  return row;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Compute the ring's geometry (viewBox, center, radii, density, positions)
 * from the node count. Small rings are a clean circle; large rings (the CS
 * tab can pack 20+ nodes) elongate into a horizontal oval so each node keeps
 * legible arc-length.
 * @param {number[]} ringIds Ring node ids.
 * @returns {RingGeometry} The computed geometry.
 */
function computeRingGeometry(ringIds) {
  // ovalT smoothly interpolates 0..1 across the N=12..N=24 range; the
  // viewBox widens to match so the SVG uses the surrounding wider canvas.
  const N = ringIds.length;
  const ovalT = Math.max(0, Math.min(1, (N - 12) / 12));
  const viewBoxW = 100 + ovalT * 80; // 100..180
  // Grow the viewBox HEIGHT with oval mode too, so radially-placed labels
  // have headroom both above the top node AND below the bottom node.
  const viewBoxH = 100 + ovalT * 24; // 100..124
  const cx = viewBoxW / 2;
  const cy = viewBoxH / 2;

  // Ring radius scales with node count so a few civs sit close to center
  // (more space for labels) while many civs spread out to use the canvas.
  const ry = N <= 2 ? 18 : N <= 6 ? 36 : N <= 12 ? 40 : 38;
  // rx grows past ry when ovalT > 0 — the wider viewBox is what gives
  // us room for a longer X axis.
  const rx = ry + ovalT * 38; // 42..80 at max oval
  const positions = ringPositions(ringIds, rx, ry, cx, cy);

  // Density factor: 1.0 when arc-spacing per node is comfortable (≥ 22
  // SVG units), shrinking smoothly down to 0.32 when very crowded.
  const _h = Math.pow((rx - ry) / (rx + ry), 2);
  const ellipsePerim = Math.PI * (rx + ry) * (1 + (3 * _h) / (10 + Math.sqrt(4 - 3 * _h)));
  const arcSpacing = N > 0 ? ellipsePerim / N : 100;
  const density = Math.max(0.32, Math.min(1.0, arcSpacing / 22));

  return { viewBoxW, viewBoxH, cx, cy, rx, ry, density, positions };
}

/**
 * Group edges by undirected pair so a pair carrying multiple relationships can
 * be drawn as parallel offset lines. Drops edges whose endpoints aren't both
 * positioned.
 * @param {Edge[]} edges The edges to group.
 * @param {Map<number, {x: number, y: number}>} positions Node positions.
 * @returns {Map<string, EdgeGeo[]>} Edge groups keyed by sorted pair.
 */
function groupEdgesByPair(edges, positions) {
  /** @type {Map<string, EdgeGeo[]>} */
  const edgeGroups = new Map();
  for (const e of edges) {
    const pa = positions.get(e.a);
    const pb = positions.get(e.b);
    if (!pa || !pb) continue;
    const key = e.a < e.b ? e.a + "|" + e.b : e.b + "|" + e.a;
    let group = edgeGroups.get(key);
    if (!group) {
      group = [];
      edgeGroups.set(key, group);
    }
    group.push({ e, pa, pb });
  }
  return edgeGroups;
}

/**
 * Append a single solid `<line>` for an edge slot.
 * @param {Element} svg The SVG root.
 * @param {Edge} e The edge.
 * @param {{x: number, y: number}} pa Source position.
 * @param {{x: number, y: number}} pb Target position.
 * @param {number} ox Perpendicular x-offset for this slot.
 * @param {number} oy Perpendicular y-offset for this slot.
 * @returns {void}
 */
function appendSolidEdge(svg, e, pa, pb, ox, oy) {
  const line = document.createElementNS(SVG_NS, "line");
  line.setAttribute("x1", String(pa.x + ox));
  line.setAttribute("y1", String(pa.y + oy));
  line.setAttribute("x2", String(pb.x + ox));
  line.setAttribute("y2", String(pb.y + oy));
  line.setAttribute("stroke", e.color || "#bfbfbf");
  // Uniform thickness + opacity across every edge on both rings. Per-edge
  // overrides (e.width / e.opacity) are intentionally ignored — they made
  // edge color the only signal a reader has to discriminate filter types.
  line.setAttribute("stroke-width", "0.6");
  line.setAttribute("stroke-opacity", "0.9");
  line.setAttribute("class", "demographics-relations-line");
  line.setAttribute("stroke-linecap", "round");
  svg.appendChild(line);
}

/**
 * Append one dash sub-segment as a real solid `<line>`.
 * @param {Element} svg The SVG root.
 * @param {string} color Stroke color.
 * @param {number} x1 Segment start x.
 * @param {number} y1 Segment start y.
 * @param {number} x2 Segment end x.
 * @param {number} y2 Segment end y.
 * @returns {void}
 */
function appendDashSeg(svg, color, x1, y1, x2, y2) {
  const seg = document.createElementNS(SVG_NS, "line");
  seg.setAttribute("x1", String(x1));
  seg.setAttribute("y1", String(y1));
  seg.setAttribute("x2", String(x2));
  seg.setAttribute("y2", String(y2));
  seg.setAttribute("stroke", color);
  seg.setAttribute("stroke-width", "0.6");
  seg.setAttribute("stroke-opacity", "0.9");
  seg.setAttribute("stroke-linecap", "round");
  seg.setAttribute("class", "demographics-relations-line");
  svg.appendChild(seg);
}

/**
 * Render a dashed edge by synthesizing solid sub-line segments by hand —
 * Coherent's renderer ignores `stroke-dasharray` on `<line>`. Falls back to
 * a single solid line for bad / zero-length patterns.
 * @param {Element} svg The SVG root.
 * @param {Edge} e The edge.
 * @param {{x: number, y: number}} pa Source position (slot-offset applied).
 * @param {{x: number, y: number}} pb Target position (slot-offset applied).
 * @param {string} dash The dash pattern string.
 * @returns {void}
 */
function appendDashedEdge(svg, e, pa, pb, dash) {
  if (!_dashLogged) {
    dlog(
      "dashed edge synth: filterKey=" +
        (e.filterKey || "(none)") +
        " pattern='" +
        dash +
        "' color=" +
        (e.color || "?")
    );
    _dashLogged = true;
  }
  const parts = dash
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((n) => !isNaN(n) && n > 0);
  const color = e.color || "#bfbfbf";
  if (parts.length < 2) {
    // Bad pattern — fall back to solid.
    appendSolidEdge(svg, e, pa, pb, 0, 0);
    return;
  }
  const x1 = pa.x,
    y1 = pa.y;
  const x2 = pb.x,
    y2 = pb.y;
  const totalLen = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  if (totalLen <= 0) {
    appendSolidEdge(svg, e, pa, pb, 0, 0);
    return;
  }
  const ux = (x2 - x1) / totalLen,
    uy = (y2 - y1) / totalLen;
  let t = 0;
  let segIdx = 0; // even idx = dash (draw), odd = gap (skip)
  while (t < totalLen) {
    const segLen = parts[segIdx % parts.length];
    const end = Math.min(t + segLen, totalLen);
    if (segIdx % 2 === 0 && end > t) {
      appendDashSeg(svg, color, x1 + ux * t, y1 + uy * t, x1 + ux * end, y1 + uy * end);
    }
    t = end;
    segIdx++;
  }
}

// Perpendicular offset per parallel-line slot. ~1.6 SVG units gives
// clear visual separation without making the lines look unrelated.
const PARALLEL_SPACING = 1.6;

/**
 * Render one undirected pair's group of edges as parallel offset lines,
 * centered around the pair axis. Solid edges draw directly; dashed edges are
 * synthesized as solid sub-segments at the slot's offset endpoints.
 * @param {Element} svg The SVG root.
 * @param {EdgeGeo[]} entries The grouped edges for this pair.
 * @returns {void}
 */
function appendEdgeGroup(svg, entries) {
  const n = entries.length;
  // Compute the perpendicular unit vector once per pair.
  const first = entries[0];
  const dx = first.pb.x - first.pa.x;
  const dy = first.pb.y - first.pa.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const px = -dy / len,
    py = dx / len; // perp to direction (a→b)
  entries.forEach(({ e, pa, pb }, i) => {
    // Center the slots around 0: for n=1 offset is 0; for n=3 offsets
    // are -1, 0, +1; for n=4 they are -1.5, -0.5, +0.5, +1.5.
    const slot = i - (n - 1) / 2;
    const ox = px * slot * PARALLEL_SPACING;
    const oy = py * slot * PARALLEL_SPACING;
    // Per-filter line texture so visually-similar colors stay
    // distinguishable. Solid = primary signals; dashed/dotted overlay.
    const dash = dasharrayFor(e);
    if (!dash) {
      appendSolidEdge(svg, e, pa, pb, ox, oy);
    } else {
      // Dashes are synthesized from the FIRST entry's offset endpoints
      // (matches the original behavior, which read first.pa/first.pb).
      appendDashedEdge(
        svg,
        e,
        { x: first.pa.x + ox, y: first.pa.y + oy },
        { x: first.pb.x + ox, y: first.pb.y + oy },
        dash
      );
    }
  });
}

/**
 * Resolve a ring node's display name: "Leader, Civilization" for majors, the
 * CS name for city-states, falling back to "P<id>".
 * @param {NodeInfo} info The node's display info.
 * @param {number} id The node's player id.
 * @returns {string} The display name.
 */
function nodeDisplayName(info, id) {
  if (info.isCityState) return info.csName || "CS-" + id;
  if (info.leaderName && info.civName) return info.leaderName + ", " + info.civName;
  return info.leaderName || info.csName || "P" + id;
}

/**
 * Resolve a node's stroke + fill colors. For CSes the type color is preferred
 * over the (unreliable) CS primary; both are scrubbed (defense-in-depth).
 * @param {NodeInfo} info The node's display info.
 * @param {boolean} isCs Whether the node is a city-state.
 * @returns {{ stroke: string, fill: string }} The resolved colors.
 */
function resolveNodeColors(info, isCs) {
  const stroke = isCs
    ? normalizeCivColor(info.csTypeColor) || normalizeCivColor(info.primaryColor) || "#9aa8c8"
    : normalizeCivColor(info.primaryColor) || "#c9a24c";
  const fillSrc = isCs
    ? normalizeCivColor(info.csTypeColor) || normalizeCivColor(info.primaryColor)
    : normalizeCivColor(info.primaryColor);
  const fill = isCs && fillSrc ? hexToRgba(fillSrc, 0.3) : "rgba(20, 16, 10, 0.85)";
  return { stroke, fill };
}

/**
 * Append the CS type indicator: the in-game banner icon (queued as an HTML
 * overlay, since SVG `<image href="blp:...">` was unreliable in Coherent), or
 * a colored inner disc fallback. No-op for non-CS nodes.
 * @param {Element} svg The SVG root.
 * @param {{x: number, y: number}} pos Node position.
 * @param {NodeInfo} info The node's display info.
 * @param {boolean} isCs Whether the node is a city-state.
 * @param {number} r Node radius.
 * @param {PortraitPlacement[]} portraitsToPlace Overlay queue.
 * @returns {void}
 */
function appendCsIndicator(svg, pos, info, isCs, r, portraitsToPlace) {
  if (isCs && info.csTypeIcon) {
    portraitsToPlace.push({
      kind: "cs-icon",
      iconUrl: info.csTypeIcon,
      vbX: pos.x,
      vbY: pos.y,
      vbR: r * 0.7 // icon inscribed slightly inside the node
    });
  } else if (isCs && info.csTypeColor) {
    const inner = document.createElementNS(SVG_NS, "circle");
    inner.setAttribute("cx", String(pos.x));
    inner.setAttribute("cy", String(pos.y));
    inner.setAttribute("r", String(r * 0.55));
    inner.setAttribute("fill", info.csTypeColor);
    inner.setAttribute("fill-opacity", "0.65");
    svg.appendChild(inner);
  }
}

/**
 * Append the node circle (and, for city-states, the inner color disc) for one
 * ring node, returning the chosen radius.
 * @param {Element} svg The SVG root.
 * @param {{x: number, y: number}} pos Node position.
 * @param {NodeInfo} info The node's display info.
 * @param {boolean} isCs Whether the node is a city-state.
 * @param {boolean} isViewer Whether the node is the focus viewer.
 * @param {number} density The ring density factor.
 * @param {PortraitPlacement[]} portraitsToPlace Overlay queue to push CS icons.
 * @returns {number} The node radius `r`.
 */
function appendNodeCircle(svg, pos, info, isCs, isViewer, density, portraitsToPlace) {
  // Viewer gets the larger node size — keeps the focus civ prominent.
  const baseR = isViewer ? 6.0 : isCs ? 4.0 : 5.0;
  const r = baseR * (isViewer ? Math.max(density, 0.65) : density);

  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("cx", String(pos.x));
  circle.setAttribute("cy", String(pos.y));
  circle.setAttribute("r", String(r));
  // For CSes: outer-ring color = type color (CS primary is unreliable).
  // Fill = type color tinted at ~30%. Final scrub here is defense-in-depth.
  const { stroke, fill } = resolveNodeColors(info, isCs);
  circle.setAttribute("fill", fill);
  circle.setAttribute("stroke", isViewer ? "#f3c34c" : stroke);
  circle.setAttribute(
    "stroke-width",
    String((isViewer ? 0.9 : isCs ? 0.7 : 0.5) * Math.max(density, 0.6))
  );
  if (isCs) circle.setAttribute("stroke-dasharray", "0.8 0.5");
  svg.appendChild(circle);

  appendCsIndicator(svg, pos, info, isCs, r, portraitsToPlace);
  return r;
}

/**
 * Resolve a major civ's leader portrait. Queues an HTML overlay placement when
 * a `LEADER_*` type is available and returns whether one was queued. CS nodes
 * never reach this path.
 * @param {NodeInfo} info The node's display info.
 * @param {{x: number, y: number}} pos Node position.
 * @param {number} r Node radius.
 * @param {PortraitPlacement[]} portraitsToPlace Overlay queue.
 * @returns {boolean} True when a portrait overlay was queued.
 */
function queueLeaderPortrait(info, pos, r, portraitsToPlace) {
  const leaderType = info.leaderTypeString;
  try {
    if (
      leaderType &&
      /^LEADER_/.test(leaderType) &&
      typeof UI !== "undefined" &&
      typeof UI.getIconURL === "function"
    ) {
      // Same pattern as Icon.getLeaderPortraitIcon (vanilla
      // utilities-image.js:182): default size is the most reliable variant.
      (UI.getIconURL(leaderType, "LEADER") + ".png").toLowerCase();
    }
  } catch (_) {
    /* */
  }
  if (leaderType) {
    // Defer placement — we position fxs-icon divs over the wrap in pixel
    // coords once the SVG has laid out, so icons scale uniformly.
    portraitsToPlace.push({ kind: "leader", leaderType, vbX: pos.x, vbY: pos.y, vbR: r });
    return true;
  }
  return false;
}

/**
 * Append the initial-letter fallback glyph for a major civ that has no leader
 * portrait. Never called for city-states (they always paint a disc).
 * @param {Element} svg The SVG root.
 * @param {{x: number, y: number}} pos Node position.
 * @param {boolean} isViewer Whether the node is the focus viewer.
 * @param {boolean} isCs Whether the node is a city-state.
 * @param {number} density The ring density factor.
 * @param {string} nm The node display name.
 * @returns {void}
 */
function appendInitialLetter(svg, pos, isViewer, isCs, density, nm) {
  const initFont = (isViewer ? 5 : isCs ? 3.2 : 4) * density;
  const text = document.createElementNS(SVG_NS, "text");
  text.setAttribute("x", String(pos.x));
  text.setAttribute("y", String(pos.y + initFont * 0.34));
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("font-size", String(initFont));
  text.setAttribute("fill", isCs ? "#1c1408" : "#f3c34c");
  text.setAttribute("font-weight", "700");
  text.textContent = (nm.trim().charAt(0) || "?").toUpperCase();
  svg.appendChild(text);
}

/**
 * Append a ring node's name label. Below the node when sparse, radially
 * outward when dense (so adjacent labels don't collide).
 * @param {Element} svg The SVG root.
 * @param {{x: number, y: number}} pos Node position.
 * @param {number} r Node radius.
 * @param {number} cx Ring center x.
 * @param {number} cy Ring center y.
 * @param {number} density The ring density factor.
 * @param {number} viewBoxH ViewBox height (label clamp).
 * @param {string} nm The node display name.
 * @returns {void}
 */
function appendNodeLabel(svg, pos, r, cx, cy, density, viewBoxH, nm) {
  // Single label line: just the CS / leader name. The CS type is already
  // conveyed visually by the icon or disc, so a text type label is redundant.
  const nameFont = 2.4 * density;
  const radiallyOut = density < 0.7;
  const dx = pos.x - cx,
    dy = pos.y - cy;
  const mag = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / mag,
    uy = dy / mag;
  const labelOffset = r + 1.6 * density + 0.8;
  const lx = radiallyOut ? pos.x + ux * labelOffset : pos.x;
  const ly = radiallyOut
    ? pos.y + uy * labelOffset + nameFont * 0.34
    : Math.min(viewBoxH - 1, pos.y + r + nameFont + 0.4);

  const label = document.createElementNS(SVG_NS, "text");
  label.setAttribute("x", String(lx));
  label.setAttribute("y", String(ly));
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("font-size", String(nameFont));
  label.setAttribute("fill", "#f3e7c4");
  label.textContent = nm;
  svg.appendChild(label);
}

/**
 * Render one ring node: circle (+ CS disc/icon), leader portrait OR initial
 * letter, and the name label.
 * @param {Element} svg The SVG root.
 * @param {number} id The node player id.
 * @param {RingGeometry} geo The ring geometry.
 * @param {Record<string, NodeInfo>} names Node display-info map.
 * @param {number} localPid Local player id.
 * @param {number} viewerPid Focus viewer id.
 * @param {PortraitPlacement[]} portraitsToPlace Overlay queue.
 * @returns {void}
 */
function appendRingNode(svg, id, geo, names, localPid, viewerPid, portraitsToPlace) {
  const pos = geo.positions.get(id);
  if (!pos) return;
  const isViewer = id === viewerPid;
  const info = names[id] || {};
  const isCs = !!info.isCityState;

  const r = appendNodeCircle(svg, pos, info, isCs, isViewer, geo.density, portraitsToPlace);
  const nm = nodeDisplayName(info, id);

  // For MAJOR civs: render the leader portrait inside the node (same BLP the
  // factbook uses). CS nodes keep the type-icon / colored-disc path above.
  let renderedPortrait = false;
  if (!isCs) {
    renderedPortrait = queueLeaderPortrait(info, pos, r, portraitsToPlace);
  }

  // Initial-letter fallback. Skipped when we drew a portrait, or it's a CS
  // (CSes always paint a colored disc so letters never appear on them).
  if (!renderedPortrait && !isCs) {
    appendInitialLetter(svg, pos, isViewer, isCs, geo.density, nm);
  }

  appendNodeLabel(svg, pos, r, geo.cx, geo.cy, geo.density, geo.viewBoxH, nm);
}

/**
 * Append one queued portrait/icon overlay div, positioned in pixel coords.
 * @param {HTMLElement} wrap The ring wrap (overlay parent).
 * @param {PortraitPlacement} p The queued placement.
 * @param {number} contentLeft Letterboxed content left edge, px.
 * @param {number} contentTop Letterboxed content top edge, px.
 * @param {number} scale ViewBox→pixel scale.
 * @returns {void}
 */
function appendPortraitDiv(wrap, p, contentLeft, contentTop, scale) {
  const px = contentLeft + p.vbX * scale;
  const py = contentTop + p.vbY * scale;
  const diameter = p.vbR * 2 * scale;
  const div = document.createElement("div");
  div.className = "demographics-relations-portrait";
  div.style.position = "absolute";
  div.style.left = px - diameter / 2 + "px";
  div.style.top = py - diameter / 2 + "px";
  div.style.width = diameter + "px";
  div.style.height = diameter + "px";
  div.style.pointerEvents = "none";
  if (p.kind === "cs-icon") {
    // CS type-icon: a background-image div resolves `blp:` paths the same
    // way every other Civ7 UI surface does (the SVG `<image>` path didn't).
    div.style.backgroundImage = "url('" + p.iconUrl + "')";
    div.style.backgroundSize = "contain";
    div.style.backgroundPosition = "center";
    div.style.backgroundRepeat = "no-repeat";
  } else {
    const icon = document.createElement("fxs-icon");
    icon.setAttribute("data-icon-id", /** @type {string} */ (p.leaderType));
    icon.setAttribute("data-icon-context", "LEADER");
    icon.classList.add("demographics-relations-portrait-icon");
    div.appendChild(icon);
  }
  wrap.appendChild(div);
}

/**
 * Build the deferred-placement routine for portrait/icon overlays. The SVG's
 * viewBox is letterboxed via `xMidYMid meet`; whichever axis is tighter sets
 * `scale` and the other axis is centered. Re-defers a frame if layout isn't
 * ready yet.
 * @param {HTMLElement} wrap The ring wrap (overlay parent).
 * @param {Element} svg The SVG root.
 * @param {PortraitPlacement[]} portraitsToPlace Overlay queue.
 * @param {number} viewBoxW ViewBox width.
 * @param {number} viewBoxH ViewBox height.
 * @returns {() => void} The placement routine.
 */
function makePlacePortraits(wrap, svg, portraitsToPlace, viewBoxW, viewBoxH) {
  /**
   * Position every queued overlay, deferring a frame if layout isn't ready.
   * @returns {void}
   */
  function placePortraits() {
    if (portraitsToPlace.length === 0) return;
    let rect;
    try {
      rect = svg.getBoundingClientRect();
    } catch (_) {
      rect = null;
    }
    if (!rect || rect.width === 0 || rect.height === 0) {
      // Layout not ready yet — try again next frame.
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(placePortraits);
      } else {
        setTimeout(placePortraits, 16);
      }
      return;
    }
    // Strip any previously-placed portraits so repaints don't pile up.
    const old = wrap.querySelectorAll(".demographics-relations-portrait");
    old.forEach((el) => el.remove());

    const scale = Math.min(rect.width / viewBoxW, rect.height / viewBoxH);
    const contentW = viewBoxW * scale;
    const contentH = viewBoxH * scale;
    const contentLeft = (rect.width - contentW) / 2;
    const contentTop = (rect.height - contentH) / 2;

    for (const p of portraitsToPlace) {
      appendPortraitDiv(wrap, p, contentLeft, contentTop, scale);
    }
    dlog("placed " + portraitsToPlace.length + " portraits " + "@scale=" + scale.toFixed(2));
  }
  return placePortraits;
}

/**
 * Build the SVG ring with leader portraits and connector lines. `viewerPid` is
 * the civ whose perspective the ring is drawn FROM (the CS tab lets the user
 * pick a non-local major as the viewer); the viewer is styled like the local
 * player so it stays the prominent node.
 * @param {number[]} ringIds Node ids to lay out on the ring.
 * @param {Record<string, NodeInfo>} names Node display-info map.
 * @param {Edge[]} edges Edges to draw.
 * @param {number} localPid Local player id.
 * @param {number} [viewerPid] Focus viewer id (defaults to `localPid`).
 * @returns {HTMLElement} The ring wrap element.
 */
function buildRingSvg(ringIds, names, edges, localPid, viewerPid) {
  if (typeof viewerPid !== "number") viewerPid = localPid;
  const wrap = document.createElement("div");
  wrap.className = "demographics-relations-ring-wrap";
  wrap.style.position = "relative";

  // Collected as we walk the ring; positioned after the SVG mounts so we can
  // measure where the (proportionally-letterboxed) viewBox area actually
  // lives in pixel coords. This avoids the <foreignObject> path entirely.
  /** @type {PortraitPlacement[]} */
  const portraitsToPlace = [];

  const geo = computeRingGeometry(ringIds);
  const { viewBoxW, viewBoxH } = geo;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 " + viewBoxW + " " + viewBoxH);
  // 'xMidYMid meet' = uniform scale + letterbox. Shapes inside the viewBox
  // stay proportional regardless of the SVG element's pixel dimensions.
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.classList.add("demographics-relations-ring-svg");
  wrap.appendChild(svg);

  if (ringIds.length === 0) {
    const empty = document.createElement("div");
    empty.className = "demographics-empty font-body text-base";
    empty.textContent = "No civilizations to show.";
    wrap.appendChild(empty);
    return wrap;
  }

  // Group edges by undirected pair so a pair carrying multiple relationships
  // (Alliance + Open Borders + Trade) renders as parallel offset lines.
  const edgeGroups = groupEdgesByPair(edges, geo.positions);
  for (const entries of edgeGroups.values()) {
    appendEdgeGroup(svg, entries);
  }

  // Nodes.
  for (const id of ringIds) {
    appendRingNode(svg, id, geo, names, localPid, viewerPid, portraitsToPlace);
  }

  // Place leader portraits as HTML overlays in PIXEL coords over the wrap.
  const placePortraits = makePlacePortraits(wrap, svg, portraitsToPlace, viewBoxW, viewBoxH);
  // Defer until the wrap is in the DOM and laid out. The caller mounts the
  // wrap synchronously, so a single rAF is enough on first paint.
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(placePortraits);
  } else {
    setTimeout(placePortraits, 16);
  }

  return wrap;
}

// Module-scope cache of filter sets keyed by `${topTab}:${subTab}`.
// Coherent's localStorage gets wiped between reads in this UI context, so
// we cannot trust round-tripping through settings.json — we keep the
// authoritative Set here in memory and treat settings.setSetting as a
// best-effort write for cross-session persistence.
const _filterSetCache = new Map();

// ---- main render ----------------------------------------------------------

/**
 * Read the persisted top tab ("civ"/"cs"), defaulting to "civ".
 * @param {RelationsSettings|undefined} settings Settings accessor.
 * @returns {string} The validated top tab.
 */
function readTopTab(settings) {
  let topTab = "civ";
  try {
    topTab = settings?.getSetting?.("relationsTopTab", "civ") || "civ";
    if (!["civ", "cs"].includes(topTab)) topTab = "civ";
  } catch (_) {
    /* */
  }
  return topTab;
}

/**
 * Read the persisted "show unmet names" toggle (default false).
 * @param {RelationsSettings|undefined} settings Settings accessor.
 * @returns {boolean} The toggle value.
 */
function readShowUnmetNames(settings) {
  try {
    return !!settings?.getSetting?.("showUnmetNames", false);
  } catch (_) {
    return false;
  }
}

/**
 * Resolve the CS-tab viewer pid. Persisted; falls back to local when the saved
 * pid is no longer a met major.
 * @param {RelationsSettings|undefined} settings Settings accessor.
 * @param {number|undefined} localId Local player id.
 * @param {number[]} metIds Met major ids.
 * @returns {number|undefined} The viewer pid.
 */
function readCsViewerPid(settings, localId, metIds) {
  let csViewerPid = localId;
  try {
    const saved = settings?.getSetting?.("relationsCsViewerPid", localId);
    if (typeof saved === "number" && metIds.includes(saved)) csViewerPid = saved;
    else if (typeof localId === "number") csViewerPid = localId;
  } catch (_) {
    csViewerPid = localId;
  }
  return csViewerPid;
}

/**
 * The scaffold elements created once per render.
 * @typedef {Object} RelationsScaffold
 * @property {HTMLElement} topTabHost Top tab-bar host.
 * @property {HTMLElement} subTabHost Sub tab-bar host.
 * @property {HTMLElement} viewerHost CS viewer-dropdown host.
 * @property {HTMLElement} body Ring container.
 * @property {HTMLElement} filterHost Filter-pill host.
 * @property {HTMLElement} caption Caption line.
 */

/**
 * Build the vertical-stack scaffold (tab hosts, body, filter host, caption)
 * and mount it under `host`.
 * @param {HTMLElement} host The view host element.
 * @returns {RelationsScaffold} The scaffold elements.
 */
function buildScaffold(host) {
  const wrap = document.createElement("div");
  wrap.className = "demographics-relations-wrap";
  host.appendChild(wrap);

  const topTabHost = document.createElement("div");
  topTabHost.className = "demographics-relations-toptab-host";
  wrap.appendChild(topTabHost);

  const subTabHost = document.createElement("div");
  subTabHost.className = "demographics-relations-subtab-host";
  wrap.appendChild(subTabHost);

  // CS viewer dropdown host (only populated when topTab === "cs").
  const viewerHost = document.createElement("div");
  viewerHost.className = "demographics-relations-viewer-host";
  wrap.appendChild(viewerHost);

  // Body is the ring's container. Repaints wipe ALL its children, so the
  // filter legend must NOT live inside it — filterHost stays a sibling and
  // the CSS positions it absolutely over the body's top-right corner.
  const body = document.createElement("div");
  body.className = "demographics-relations-body";
  wrap.appendChild(body);

  const filterHost = document.createElement("div");
  filterHost.className = "demographics-relations-filter-host";
  wrap.appendChild(filterHost);

  const caption = document.createElement("div");
  caption.className = "demographics-relations-caption font-body text-xs";
  wrap.appendChild(caption);

  return { topTabHost, subTabHost, viewerHost, body, filterHost, caption };
}

/**
 * Read the snapshot-recorded `met` field for a pid from the latest sample.
 * Used as a fallback when `viewer.Diplomacy.hasMet` is unavailable. Only
 * meaningful when viewer == localPid (the sampler records met relative to the
 * local player); callers skip it for non-local viewers.
 * @param {DemoHistory|undefined} history The persisted history blob.
 * @param {string|number} pid Player id to look up.
 * @returns {boolean|undefined} The recorded met state, or `undefined`.
 */
function latestSampleMet(history, pid) {
  try {
    const samples = history?.samples || [];
    for (let i = samples.length - 1; i >= 0; i--) {
      const ps = samples[i]?.players?.[pid];
      if (ps && typeof ps.met === "boolean") return ps.met;
    }
  } catch (_) {
    /* */
  }
  return undefined;
}

/**
 * Resolve whether `viewerPid` has met `pid`, falling back to snapshot data
 * when the engine accessor is unavailable and the viewer is the local player.
 * @param {number} viewerPid Viewer player id.
 * @param {number} pid Other player id.
 * @param {number|undefined} localId Local player id.
 * @param {DemoHistory|undefined} history The persisted history blob.
 * @returns {boolean|undefined} Met state, or `undefined`.
 */
function resolveMet(viewerPid, pid, localId, history) {
  let met = viewerHasMet(viewerPid, pid);
  if (met === undefined && viewerPid === localId) {
    const snap = latestSampleMet(history, pid);
    if (typeof snap === "boolean") met = snap;
  }
  return met;
}

/**
 * Mask unmet major-civ node labels (from the viewer's perspective) with a
 * generic "Unmet Civilization" placeholder, unless `showUnmetNames` is on.
 * Mutates `names` in place.
 * @param {number} viewerPid The viewer player id.
 * @param {number[]} metIds Met major ids.
 * @param {Record<string, NodeInfo>} names Node display-info map (mutated).
 * @param {boolean} showUnmetNames When true, leave real names visible.
 * @param {number|undefined} localId Local player id.
 * @param {DemoHistory|undefined} history The persisted history blob.
 * @returns {void}
 */
function applyMetMaskForMajors(viewerPid, metIds, names, showUnmetNames, localId, history) {
  if (showUnmetNames) return;
  for (const pid of metIds) {
    if (pid === viewerPid) continue;
    const met = resolveMet(viewerPid, pid, localId, history);
    if (met === false) {
      names[pid] = Object.assign({}, names[pid] || {}, {
        leaderName: "Unmet Civilization",
        civName: undefined
      });
    }
  }
}

/**
 * Build the overlaid Civ-Relations edge set (local-player viewer): attitude
 * edges filtered by active pills, plus political and trade edges per pill.
 * @param {number[]} metIds Met major ids.
 * @param {Set<string>} activeSet Active filter keys.
 * @param {number} localId Local player id.
 * @returns {Edge[]} The combined edge set.
 */
function buildCivEdges(metIds, activeSet, localId) {
  /** @type {Edge[]} */
  let edges = [];
  // Attitude edges (one per pair). war/alliance are part of this set.
  const attitudeEdges = buildAttitudeEdges(metIds, localId);
  for (const e of attitudeEdges) {
    if (e.filterKey && activeSet.has(e.filterKey)) edges.push(e);
  }
  // Political-action edges (open borders, denounced, research, endeavors).
  if (activeSet.has("openborders")) {
    edges = edges.concat(buildPoliticalEdges(metIds, "openborders"));
  }
  if (activeSet.has("denounced")) {
    edges = edges.concat(buildPoliticalEdges(metIds, "denounced"));
  }
  if (activeSet.has("research")) {
    edges = edges.concat(buildPoliticalEdges(metIds, "research"));
  }
  if (activeSet.has("endeavors")) {
    edges = edges.concat(buildPoliticalEdges(metIds, "endeavors"));
  }
  // Economic edges (trade routes; width scales with route count).
  if (activeSet.has("trade")) {
    edges = edges.concat(buildEconomicEdges(metIds, "trade", localId));
  }
  return edges;
}

const UNMET_GRAY = "#7d7d7d";

/**
 * Resolved CS visual fields shared by the node-info builder.
 * @typedef {Object} CsVisuals
 * @property {string|null} csType Resolved CS type string.
 * @property {{ label: string, color: string, icon: string }|null} typeMeta
 *   The CS type display meta.
 * @property {string|null} safePrimary Scrubbed CS primary color.
 * @property {string} csColor The node fill/stroke base color.
 * @property {string|null} typeLabel CS type display label.
 * @property {string} typeColor CS inner-disc/type color.
 * @property {string|null} typeIcon CS type icon BLP path.
 */

/**
 * The neutral all-gray visuals used for unmet city-states (leak nothing).
 * @returns {CsVisuals} The unmet visual fields.
 */
function unmetCsVisuals() {
  return {
    csType: null,
    typeMeta: null,
    safePrimary: null,
    csColor: UNMET_GRAY,
    typeLabel: null,
    typeColor: UNMET_GRAY,
    typeIcon: null
  };
}

/**
 * Resolve a met/unmet CS's visual fields. Met CSes prefer the canonical type
 * color over the (unreliable, scrubbed) primary; unmet CSes leak nothing and
 * render as a neutral gray disc.
 * @param {number} id City-state player id.
 * @param {boolean} csIsMet Whether the viewer has met this CS.
 * @returns {CsVisuals} The resolved visual fields.
 */
function resolveCsVisuals(id, csIsMet) {
  if (!csIsMet) {
    dlog("CS pid=" + id, "met=false", "type=null", "typeColor=-", "primary=-");
    return unmetCsVisuals();
  }
  const csType = resolveCsType(id);
  const typeMeta = csTypeMeta(csType);
  const primary = resolveCsPrimaryColor(id);
  // Normalize CS primary into a safe 6-char hex or null (rejects the
  // engine-default "#FFFFFFFF" white that caused the "white circle" bug).
  const safePrimary = normalizeCivColor(primary);
  const typeColor = typeMeta ? typeMeta.color : null;
  // Met CSes always get a non-null color so the inner disc renders (type
  // color, then primary, then a generic blue-gray).
  const metColor = typeColor || safePrimary || "#9aa8c8";
  dlog(
    "CS pid=" + id,
    "met=true",
    "type=" + csType,
    "typeColor=" + (typeColor || "-"),
    "primary=" + (primary || "-")
  );
  return {
    csType,
    typeMeta,
    safePrimary,
    csColor: metColor,
    typeLabel: typeMeta ? typeMeta.label : null,
    typeColor: metColor,
    typeIcon: typeMeta ? typeMeta.icon : null
  };
}

/**
 * Resolve a single city-state's node-display fields (met state, type, colors,
 * icon). Unmet CSes are rendered as a neutral gray disc with no type leak.
 * @param {number} id City-state player id.
 * @param {number} viewerPid The viewer player id.
 * @param {boolean} showUnmetNames When true, always show real names.
 * @param {number|undefined} localId Local player id.
 * @param {DemoHistory|undefined} history The persisted history blob.
 * @returns {NodeInfo} The CS node-info patch.
 */
function buildCsNodeInfo(id, viewerPid, showUnmetNames, localId, history) {
  const metCs = resolveMet(viewerPid, id, localId, history);
  // If hasMet says "no" → generic label; if undefined → assume met.
  const label = metCs === false && !showUnmetNames ? "Unmet CS" : resolveCsName(id);
  // PREFER the type color (matches V7's in-game CS-type color-coding) over
  // the CS's primary color, which often returns a default dark color.
  // UNMET CSes get no type icon/color — render as a neutral gray disc.
  const csIsMet = metCs !== false;
  const v = resolveCsVisuals(id, csIsMet);
  return {
    isCityState: true,
    csName: label,
    leaderName: label,
    csMet: csIsMet,
    primaryColor: v.csColor,
    csTypeKey: v.csType,
    csTypeLabel: v.typeLabel,
    csTypeColor: v.typeColor,
    csTypeIcon: v.typeIcon
  };
}

/**
 * Build the set of CS ids the viewer has met (used to gate viewer↔CS edges).
 * @param {number[]} csIds City-state ids.
 * @param {Record<string, NodeInfo>} names Node display-info map.
 * @returns {Set<number>} The met-CS id set.
 */
function buildCsMetSet(csIds, names) {
  const csMetSet = new Set();
  for (const id of csIds) {
    if (names[id]?.csMet !== false) csMetSet.add(id);
  }
  return csMetSet;
}

/**
 * Build the overlaid CS-Relations edge set (single viewer civ): suzerain +
 * trade per pill, plus viewer↔CS attitude edges filtered by active pills,
 * then filtered down to edges involving only met CSes.
 * @param {number} viewerPid The viewer player id.
 * @param {number[]} csIds City-state ids.
 * @param {Set<string>} activeSet Active filter keys.
 * @param {Set<number>} csMetSet The met-CS id set.
 * @returns {Edge[]} The combined, filtered edge set.
 */
function buildCsEdges(viewerPid, csIds, activeSet, csMetSet) {
  // Pass only the viewer civ as the "majors" list so each edge anchors at
  // the viewer; all relationship types overlay on the same ring.
  const viewerMajors = [viewerPid];
  /** @type {Edge[]} */
  let edges = [];
  if (activeSet.has("suzerain")) {
    edges = edges.concat(buildCsSuzerainEdges(viewerMajors, csIds, viewerPid));
  }
  if (activeSet.has("trade")) {
    edges = edges.concat(buildCsTradeEdges(viewerMajors, csIds, viewerPid));
  }
  // Attitude edges, filtered by which attitude pills are active.
  const attEdges = buildCsAttitudeEdges(viewerMajors, csIds, viewerPid);
  for (const e of attEdges) {
    if (e.filterKey && activeSet.has(e.filterKey) && (e.a === viewerPid || e.b === viewerPid)) {
      edges.push(e);
    }
  }
  // Require any CS endpoint to be in the viewer's met set (unmet CSes still
  // appear as nodes, but draw no edges from the viewer's perspective).
  return edges.filter((e) => {
    if (csIds.includes(e.a) && !csMetSet.has(e.a)) return false;
    if (csIds.includes(e.b) && !csMetSet.has(e.b)) return false;
    return true;
  });
}

/**
 * Apply per-topTab visual overrides to CS-tab edges (suzerain=blue dashed,
 * trade=yellow dotted, etc.). Non-destructive — `e._dashOverride` is read by
 * `dasharrayFor` first, and `e.color` overwrites the builder default. Mutates.
 * @param {Edge[]} edges The edges to recolor.
 * @returns {void}
 */
function applyCsEdgeOverrides(edges) {
  for (const e of edges) {
    const ov = filterVisuals(e.filterKey || "", "cs");
    if (!ov) continue;
    if (ov.color) e.color = ov.color;
    if (ov.dash !== undefined) e._dashOverride = ov.dash;
  }
}

/**
 * Build the per-tab filter-pill descriptors with resolved colors + dash
 * overrides applied.
 * @param {string} topTab Either "civ" or "cs".
 * @returns {FilterDef[]} The visual-resolved filter descriptors.
 */
function buildFilterDefs(topTab) {
  return filtersForView(topTab).map((f) => {
    const ov = filterVisuals(f.key, topTab);
    return {
      ...f,
      // Per-tab override wins; otherwise fall back to the global swatch
      // table (which respects colorblind mode).
      color: (ov && ov.color) || pillColorFor(f.key, topTab),
      // Tag with the per-tab dash override so the legend swatch renders
      // the right pattern (handled in makeFilterPillRow).
      _dashOverride: ov ? ov.dash : undefined
    };
  });
}

/**
 * The mutable render-loop state threaded through the repaint helpers.
 * @typedef {Object} RenderState
 * @property {RelationsCtx} ctx Render context.
 * @property {RelationsSettings|undefined} settings Settings accessor.
 * @property {RelationsScaffold} sc The scaffold elements.
 * @property {number|undefined} localId Local player id.
 * @property {number[]} metIds Met major ids.
 * @property {Record<string, NodeInfo>} namesBase Base name map.
 * @property {boolean} showUnmetNames "Show unmet names" toggle.
 * @property {string} topTab Active top tab.
 * @property {number|undefined} csViewerPid Active CS-tab viewer pid.
 * @property {(top: string) => Set<string>} readFilterSet Filter-set reader.
 * @property {(top: string, set: Set<string>) => void} writeFilterSet Writer.
 * @property {() => void} repaint Repaint entry point.
 */

/**
 * Build the CS-tab viewer dropdown into the viewer host (no-op off the CS tab).
 * @param {RenderState} rs The render-loop state.
 * @returns {void}
 */
function buildViewerDropdown(rs) {
  const { viewerHost } = rs.sc;
  while (viewerHost.firstChild) viewerHost.removeChild(viewerHost.firstChild);
  if (!(rs.topTab === "cs" && rs.metIds.length > 0)) return;

  const lbl = document.createElement("div");
  lbl.className = "demographics-relations-viewer-label font-body text-xs";
  lbl.textContent = "Viewer:";
  lbl.style.color = "#f3e7c4";
  lbl.style.marginRight = "0.5rem";
  viewerHost.appendChild(lbl);

  const items = rs.metIds.map((pid) => {
    const info = rs.namesBase[pid] || {};
    const isYou = pid === rs.localId;
    const nm = isYou ? (info.leaderName || "You") + " (You)" : info.leaderName || "Player " + pid;
    return { label: nm, id: "viewer_" + pid, pid };
  });
  let selIdx = rs.metIds.indexOf(/** @type {number} */ (rs.csViewerPid));
  if (selIdx < 0) selIdx = 0;
  const dd = document.createElement("fxs-dropdown");
  dd.classList.add("demographics-relations-viewer-dropdown");
  dd.setAttribute("data-audio-group-ref", "audio-panel-diplo-ribbon");
  dd.setAttribute("data-audio-focus-ref", "data-audio-dropdown-focus");
  dd.setAttribute("dropdown-items", JSON.stringify(items.map((it) => ({ label: it.label }))));
  dd.setAttribute("selected-item-index", String(selIdx));
  dd.addEventListener("dropdown-selection-change", (event) => {
    const idx = /** @type {*} */ (event)?.detail?.selectedIndex;
    if (typeof idx !== "number" || idx < 0 || idx >= items.length) return;
    const newPid = items[idx].pid;
    if (newPid === rs.csViewerPid) return;
    rs.csViewerPid = newPid;
    try {
      rs.settings?.setSetting?.("relationsCsViewerPid", newPid);
    } catch (_) {}
    dlog("CS viewer changed to pid", newPid);
    rs.repaint();
  });
  viewerHost.appendChild(dd);
}

/**
 * Build the filter-pill row into the filter host, wiring per-pill and bulk
 * toggles to update the filter set and repaint.
 * @param {RenderState} rs The render-loop state.
 * @param {FilterDef[]} filterDefs The visual-resolved filter descriptors.
 * @returns {void}
 */
function buildFilterRow(rs, filterDefs) {
  const { filterHost } = rs.sc;
  while (filterHost.firstChild) filterHost.removeChild(filterHost.firstChild);
  const activeSet = rs.readFilterSet(rs.topTab);
  filterHost.appendChild(
    makeFilterPillRow(
      filterDefs,
      activeSet,
      (key) => {
        const cur = rs.readFilterSet(rs.topTab);
        if (cur.has(key)) cur.delete(key);
        else cur.add(key);
        rs.writeFilterSet(rs.topTab, cur);
        rs.repaint();
      },
      (turnOn) => {
        // Bulk-set every filter for the active topTab in one repaint.
        const next = turnOn ? new Set(filterDefs.map((f) => f.key)) : new Set();
        rs.writeFilterSet(rs.topTab, next);
        rs.repaint();
      }
    )
  );
}

/**
 * Compute the ring node set, edges, names, and caption for the active view.
 * @param {RenderState} rs The render-loop state.
 * @param {Set<string>} activeSet Active filter keys.
 * @returns {{ ringIds: number[], edges: Edge[], names: Record<string, NodeInfo>, capText: string, ringViewerPid: number|undefined }}
 *   The computed ring inputs.
 */
function computeRingData(rs, activeSet) {
  const localId = /** @type {number} */ (rs.localId);
  /** @type {Edge[]} */
  let edges = [];
  let ringIds = rs.metIds.slice();
  /** @type {Record<string, NodeInfo>} */
  const names = Object.assign({}, rs.namesBase);
  let capText = "";

  if (rs.topTab === "civ") {
    // Civ Relations uses the LOCAL player as the viewer. All filters are
    // overlaid in one ring — a pair can carry multiple edges, which the
    // ring renderer offsets into parallel lines.
    applyMetMaskForMajors(localId, rs.metIds, names, rs.showUnmetNames, localId, rs.ctx.history);
    edges = buildCivEdges(rs.metIds, activeSet, localId);
    capText =
      "Ring node = met major civ. Multiple lines between two civs = multiple relationships.";
    return { ringIds, edges, names, capText, ringViewerPid: localId };
  }

  // CS Relations uses the SELECTED viewer (csViewerPid). Only the selected
  // viewer civ appears among majors — keeps the diagram focused.
  const viewerPid = typeof rs.csViewerPid === "number" ? rs.csViewerPid : localId;
  applyMetMaskForMajors(viewerPid, rs.metIds, names, rs.showUnmetNames, localId, rs.ctx.history);

  const csIds = getCityStateIds();
  // Only the viewer civ on the major side of the ring.
  ringIds = [viewerPid].concat(csIds);
  for (const id of csIds) {
    names[id] = Object.assign(
      {},
      names[id] || {},
      buildCsNodeInfo(id, viewerPid, rs.showUnmetNames, localId, rs.ctx.history)
    );
  }

  const csMetSet = buildCsMetSet(csIds, names);
  edges = buildCsEdges(viewerPid, csIds, activeSet, csMetSet);
  capText = "Viewer-civ ↔ city-state relationships. Multiple lines = multiple relationships.";
  const ringViewerPid = typeof rs.csViewerPid === "number" ? rs.csViewerPid : localId;
  return { ringIds, edges, names, capText, ringViewerPid };
}

/**
 * Render the ring body + caption from computed ring data.
 * @param {RenderState} rs The render-loop state.
 * @returns {void}
 */
function renderRingBody(rs) {
  const { body, caption } = rs.sc;
  const activeSet = rs.readFilterSet(rs.topTab);

  while (body.firstChild) body.removeChild(body.firstChild);
  while (caption.firstChild) caption.removeChild(caption.firstChild);

  if (typeof rs.localId !== "number") {
    const empty = document.createElement("div");
    empty.className = "demographics-empty font-body text-base";
    empty.textContent = "Local player not available (observer mode).";
    body.appendChild(empty);
    return;
  }

  const { ringIds, edges, names, capText, ringViewerPid } = computeRingData(rs, activeSet);

  // Apply per-topTab visual overrides to edges (CS tab uses a different
  // color/dash vocabulary). Edits are non-destructive.
  if (rs.topTab === "cs") {
    applyCsEdgeOverrides(edges);
  }
  // Civ-tab always uses the local player as the viewer; CS-tab uses the
  // selected viewer so its node keeps the larger "focus" size.
  body.appendChild(
    buildRingSvg(ringIds, names, edges, /** @type {number} */ (rs.localId), ringViewerPid)
  );
  caption.textContent = capText;
}

/**
 * Build the top + sub tab bars ONCE per render. The bars are never torn down
 * on filter clicks (rebuilding `fxs-tab-bar` mid-event swallowed pip clicks).
 * @param {RenderState} rs The render-loop state.
 * @returns {void}
 */
function buildTabBars(rs) {
  const { topTabHost, subTabHost } = rs.sc;
  while (topTabHost.firstChild) topTabHost.removeChild(topTabHost.firstChild);
  const topTabs = [
    { id: "civ", label: "Major Civilizations" },
    { id: "cs", label: "City States" }
  ];
  topTabHost.appendChild(
    makeTabBar(topTabs, rs.topTab, "demographics-relations-toptabs", (id) => {
      if (id === rs.topTab) return;
      rs.topTab = id;
      try {
        rs.settings?.setSetting?.("relationsTopTab", id);
      } catch (_) {}
      rs.repaint();
    })
  );
  // Sub-tab row removed — political/economic/attitude views are now overlaid
  // in a single ring; the filter pill row handles per-type toggling.
  while (subTabHost.firstChild) subTabHost.removeChild(subTabHost.firstChild);
}

/**
 * Repaint the viewer row, filter pills, body SVG, and caption. Tab bars stay
 * live across repaints.
 * @param {RenderState} rs The render-loop state.
 * @returns {void}
 */
function repaintView(rs) {
  // Viewer dropdown (CS tab only). Element confirmed at
  //   core/ui/options/options-helpers.js:35-50  (fxs-dropdown attributes)
  //   core/ui/components/fxs-dropdown.js:8       ("dropdown-selection-change")
  //   core/ui/options/screen-options.js:239-245  (handler pattern)
  buildViewerDropdown(rs);
  // Filter pill row — one pill per relationship type. All toggles apply to
  // the same ring; no subtab indirection.
  buildFilterRow(rs, buildFilterDefs(rs.topTab));
  // Body: ring SVG + caption.
  renderRingBody(rs);
}

/**
 * Build the cached filter-set reader for this render. Reads the in-memory
 * cache first (Coherent's localStorage is unreliable here), then settings.
 * @param {RelationsSettings|undefined} settings Settings accessor.
 * @returns {(top: string) => Set<string>} The reader.
 */
function makeFilterSetReader(settings) {
  return (top) => {
    if (_filterSetCache.has(top)) return _filterSetCache.get(top);
    const key = filterKeyForState(top);
    const dflt = defaultFiltersFor(top);
    let arr;
    try {
      arr = settings?.getSetting?.(key, dflt);
    } catch (_) {
      arr = dflt;
    }
    if (!Array.isArray(arr)) arr = dflt;
    const set = new Set(arr);
    _filterSetCache.set(top, set);
    return set;
  };
}

/**
 * Build the filter-set writer for this render (in-memory cache + best-effort
 * settings persistence).
 * @param {RelationsSettings|undefined} settings Settings accessor.
 * @returns {(top: string, set: Set<string>) => void} The writer.
 */
function makeFilterSetWriter(settings) {
  return (top, set) => {
    _filterSetCache.set(top, set);
    const key = filterKeyForState(top);
    try {
      settings?.setSetting?.(key, Array.from(set));
    } catch (_) {}
  };
}

/**
 * Render the Global Relations view into `host`. Clears the host, reads the
 * persisted tab/filter/viewer state, builds the scaffold + live tab bars, then
 * paints the ring. Sub-tabs (political/economic/attitude) are collapsed into a
 * single overlaid ring per top tab.
 * @param {HTMLElement} host The view host element (cleared and repopulated).
 * @param {RelationsCtx} ctx Render context (history + settings accessors).
 * @returns {void}
 */
export function render(host, ctx) {
  while (host.firstChild) host.removeChild(host.firstChild);

  const settings = ctx.settings;

  // ---- read persisted state ----------------------------------------
  // Sub-tabs were collapsed into a single ring per top tab — users now see
  // every relationship type overlaid. The old `relationsTab` setting is
  // ignored; we key only by top tab now.
  const topTab = readTopTab(settings);
  const localId = getLocalId();
  const namesBase = buildNameMap(ctx.history);
  const metIds = typeof localId === "number" ? getMetMajorIds(localId) : [];
  // Global "show unmet names" toggle (Fix 4). Default false → unmet civs/CSes
  // render as generic placeholders.
  const showUnmetNames = readShowUnmetNames(settings);
  const csViewerPid = readCsViewerPid(settings, localId, metIds);

  const sc = buildScaffold(host);

  /** @type {RenderState} */
  const rs = {
    ctx,
    settings,
    sc,
    localId,
    metIds,
    namesBase,
    showUnmetNames,
    topTab,
    csViewerPid,
    readFilterSet: makeFilterSetReader(settings),
    writeFilterSet: makeFilterSetWriter(settings),
    repaint: () => repaintView(rs)
  };

  buildTabBars(rs);
  rs.repaint();
  dlog("rendered relations; topTab=", rs.topTab, "met=", rs.metIds.length);
}
