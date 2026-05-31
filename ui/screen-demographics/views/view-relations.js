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

const DBG = DEMOGRAPHICS_DEBUG;
function dlog(...a) {
  if (DBG) console.warn("[Demographics.view-relations]", ...a);
}
function derr(...a) {
  console.error("[Demographics.view-relations]", ...a);
}

// Convert a #RRGGBB (or 0xRRGGBB or "RRGGBB") color string to rgba() with
// the given alpha. Returns the input unchanged if it's not parseable.
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

// Normalize any Civ7 color string to a safe 6-char "#RRGGBB" hex, or null
// if the value is useless (transparent, near-white, or unparseable). Used
// to scrub `UI.Player.getPrimaryColorValueAsString` output before storing
// it in node info objects.
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

function safeCall(label, fn, fb) {
  try {
    return fn();
  } catch (e) {
    if (DBG) derr("safeCall(" + label + "):", e);
    return fb;
  }
}

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

// Returns the set of met major-player ids (including the local player).
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
      const out = [];
      for (const id of all) {
        try {
          const p = Players.get(id);
          if (!p) continue;
          if (typeof p.isMajor === "boolean" && !p.isMajor) continue;
          if (id === localPid) {
            out.push(id);
            continue;
          }
          if (humanDiplo && typeof humanDiplo.hasMet === "function") {
            if (humanDiplo.hasMet(id)) out.push(id);
          } else {
            out.push(id);
          }
        } catch (_) {
          /* skip */
        }
      }
      return out;
    },
    []
  );
}

// Returns the set of alive city-state / minor / independent player ids.
// Fallback path uses Players.getAlive() iterator if getAliveIds() isn't
// present, mirroring the sloth pattern.
function getCityStateIds() {
  return safeCall(
    "getCityStateIds",
    () => {
      const out = [];
      if (typeof Players === "undefined") return out;
      let ids = [];
      try {
        if (typeof Players.getAliveIds === "function") {
          const arr = Players.getAliveIds();
          if (Array.isArray(arr)) ids = arr.slice();
        }
      } catch (_) {
        /* */
      }
      if (ids.length === 0) {
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
      }
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

function getRelationship(p1, p2id) {
  return safeCall("getRelationshipEnum", () => {
    const d = p1?.Diplomacy;
    if (!d || typeof d.getRelationshipEnum !== "function") return undefined;
    return d.getRelationshipEnum(p2id);
  });
}

// ---- color tables ---------------------------------------------------------

// Attitude categories (7 buckets). Key matches DiplomacyPlayerRelationships
// when DiplomacyPlayerRelationships is available; we resolve at runtime.
// Colors are fetched live from `getAttitudeColors()` so the colorblind-mode
// toggle in Options swaps them without a mod reload.
const ATTITUDE_KEYS = [
  { key: "war", label: "At War" },
  { key: "alliance", label: "Alliance" },
  { key: "helpful", label: "Helpful" },
  { key: "friendly", label: "Friendly" },
  { key: "neutral", label: "Neutral" },
  { key: "unfriendly", label: "Unfriendly" },
  { key: "hostile", label: "Hostile" }
];
function getAttitudeCategories() {
  const colors = getAttitudeColors();
  return ATTITUDE_KEYS.map((k) => ({ ...k, color: colors[k.key] || "#bfbfbf" }));
}
// Backwards-compat alias used as both an array (`.map`, `.find`) and an
// iterable — defined as a Proxy so each access reads the current palette.
const ATTITUDE_CATEGORIES = new Proxy(
  {},
  {
    get(_, prop) {
      const cats = getAttitudeCategories();
      if (prop === Symbol.iterator) return cats[Symbol.iterator].bind(cats);
      if (prop === "length") return cats.length;
      if (prop in cats)
        return typeof cats[prop] === "function" ? cats[prop].bind(cats) : cats[prop];
      return cats[Number(prop)];
    }
  }
);

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

function categoryColor(key) {
  const colors = getAttitudeColors();
  return colors[key] || "#bfbfbf";
}

// Civ-Relations / Political: filters, ALL on same diagram.
const POLITICAL_FILTERS = [
  { key: "alliance", label: "Alliances", color: "#9933ff" },
  { key: "openborders", label: "Open Borders", color: "#5bc8ff" },
  { key: "research", label: "Research Agreements", color: "#c084fc" },
  { key: "endeavors", label: "Other Endeavors", color: "#f5a060" },
  { key: "war", label: "At War", color: "#e02020" },
  { key: "denounced", label: "Denounced", color: "#ff7f1a" }
];

// Action-type → display config for endeavor-class deals queried from
// `Game.Diplomacy.getPlayerEvents`. The key matches the
// `DiplomacyActionTypes.DIPLOMACY_ACTION_*` enum name we look up at runtime;
// `color` paints the edge in the ring. Bundle is keyed by the filter key
// each action belongs to so the political-edges builder can fan them out.
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

const ECONOMIC_FILTERS = [{ key: "trade", label: "Trade Routes", color: "#4dc6c6" }];

// CS / Political: Suzerainty only.
const CS_POLITICAL_FILTERS = [
  { key: "suzerain", label: "Suzerainty", color: "#f3c34c", dashed: true }
];

// ---- name resolution from history (so we can label nodes) -----------------

function buildNameMap(history) {
  const map = {};
  const samples = history?.samples || [];
  for (const s of samples) {
    if (!s?.players) continue;
    for (const pid of Object.keys(s.players)) {
      const ps = s.players[pid];
      if (!map[pid]) map[pid] = {};
      if (typeof ps?.leaderName === "string" && ps.leaderName.length > 0) {
        map[pid].leaderName = ps.leaderName;
      }
      if (typeof ps?.civName === "string" && ps.civName.length > 0) {
        map[pid].civName = ps.civName;
      }
      if (typeof ps?.leaderTypeString === "string" && ps.leaderTypeString.length > 0) {
        map[pid].leaderTypeString = ps.leaderTypeString;
      }
      if (typeof ps?.primaryColor === "string" && ps.primaryColor.length > 0) {
        map[pid].primaryColor = ps.primaryColor;
      }
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
function resolveCsType(pid) {
  return safeCall(
    "resolveCsType(" + pid + ")",
    () => {
      // Pass 1: bonus-derived classification — works for CSes that have
      // already been assigned a tier-1/2/3 bonus (typically after the
      // first influence threshold or once any major civ has befriended
      // them). Cite:
      //   base-standard/ui/city-banners/city-banners.js:265-266
      if (
        Game?.CityStates &&
        typeof Game.CityStates.getBonusType === "function" &&
        typeof GameInfo !== "undefined" &&
        GameInfo.CityStateBonuses
      ) {
        const bonusHash = Game.CityStates.getBonusType(pid);
        if (bonusHash != null && bonusHash !== -1) {
          let row = null;
          try {
            if (typeof GameInfo.CityStateBonuses.find === "function") {
              row = GameInfo.CityStateBonuses.find((r) => r && r.$hash === bonusHash);
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
          if (row?.CityStateType) return row.CityStateType;
        }
      }
      // Pass 2: intrinsic Independent definition — every CS row in
      // `GameInfo.Independents` carries a `CityStateType` (MILITARISTIC /
      // CULTURAL / etc.). The row is matched by the player's
      // `civilizationAdjective` against `Independents.CityStateName`. This
      // works even before any bonus has been assigned. Cite:
      //   base-standard/ui/city-banners/city-banners.js:274-278
      if (
        typeof Players?.get === "function" &&
        typeof GameInfo !== "undefined" &&
        GameInfo.Independents
      ) {
        const p = Players.get(pid);
        const adj = p?.civilizationAdjective;
        if (typeof adj === "string" && adj.length > 0) {
          let match = null;
          try {
            if (typeof GameInfo.Independents.forEach === "function") {
              GameInfo.Independents.forEach((r) => {
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
          if (match?.CityStateType) return match.CityStateType;
        }
      }
      return null;
    },
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
const CS_TYPE_META = {
  MILITARISTIC: { label: "Militaristic", color: "#d97c7c", icon: "blp:bonus_militaristic" },
  CULTURAL: { label: "Cultural", color: "#c9a2dc", icon: "blp:bonus_cultural" },
  ECONOMIC: { label: "Economic", color: "#e6c14c", icon: "blp:bonus_economic" },
  SCIENTIFIC: { label: "Scientific", color: "#7fb3e6", icon: "blp:bonus_scientific" },
  EXPANSIONIST: { label: "Expansionist", color: "#9ad17a", icon: "blp:bonustype_expansionist" },
  DIPLOMATIC: { label: "Diplomatic", color: "#5fb3b3", icon: "blp:bonustype_diplomatic" }
};
function csTypeMeta(typeStr) {
  if (typeof typeStr !== "string") return null;
  return CS_TYPE_META[typeStr.toUpperCase()] || null;
}

// Resolve a CS's primary color via the same vanilla accessor used for majors
// (UI.Player.getPrimaryColorValueAsString). Returns an empty string when not
// available so callers can fall back.
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

function resolveCsName(pid) {
  return safeCall(
    "resolveCsName(" + pid + ")",
    () => {
      const p = typeof Players?.get === "function" ? Players.get(pid) : null;
      if (p && p.name) {
        if (typeof Locale?.compose === "function") {
          try {
            const s = Locale.compose(p.name);
            if (typeof s === "string" && s.length > 0) return s;
          } catch (_) {
            /* */
          }
        }
        if (typeof p.name === "string" && p.name.length > 0) return p.name;
      }
      // Fallback: civilizationType lookup.
      try {
        const civType = p?.civilizationType;
        if (typeof GameInfo?.Civilizations?.lookup === "function") {
          const row = GameInfo.Civilizations.lookup(civType);
          if (row?.Name) {
            if (typeof Locale?.compose === "function") {
              try {
                return Locale.compose(row.Name);
              } catch (_) {
                /* */
              }
            }
            return row.Name;
          }
        }
      } catch (_) {
        /* */
      }
      return "City-State " + pid;
    },
    "City-State " + pid
  );
}

// Has the given (viewer) player met the other player? Defensive: if the
// viewer's Diplomacy.hasMet is unavailable, returns undefined (caller can
// fall back to snapshot data or assume met).
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

function buildPoliticalEdges(metIds, filterKey) {
  const edges = [];
  if (typeof Players === "undefined" || typeof Players.get !== "function") return edges;

  if (filterKey === "alliance") {
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

  if (filterKey === "war") {
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

  if (filterKey === "denounced") {
    // Denunciations are diplomatic actions, queried via getPlayerEvents
    // the same way Open Borders is. Direction matters here (A denounced B
    // is not symmetric), but the political ring treats edges as undirected
    // pairs — we collapse with a sorted key to dedupe reciprocal denounces.
    const denType =
      typeof DiplomacyActionTypes !== "undefined"
        ? DiplomacyActionTypes.DIPLOMACY_ACTION_DENOUNCE
        : undefined;
    if (denType === undefined) return edges;
    const seen = new Set();
    for (const a of metIds) {
      const events =
        safeCall("getPlayerEvents(" + a + ")", () => {
          if (
            typeof Game === "undefined" ||
            !Game.Diplomacy ||
            typeof Game.Diplomacy.getPlayerEvents !== "function"
          )
            return [];
          return Game.Diplomacy.getPlayerEvents(a) || [];
        }) || [];
      for (const ev of events) {
        if (!ev || ev.actionType !== denType) continue;
        let other = ev.targetPlayer;
        if (typeof other !== "number") other = ev.otherPlayer;
        if (typeof other !== "number") {
          other = ev.initialPlayer !== a ? ev.initialPlayer : undefined;
        }
        if (typeof other !== "number" || other === a) continue;
        if (!metIds.includes(other)) continue;
        const key = Math.min(a, other) + "|" + Math.max(a, other);
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ a, b: other, color: "#ff7f1a", filterKey: "denounced" });
      }
    }
    return edges;
  }

  // Generic endeavor / treaty scanner. Each diplomatic action type appears
  // in BOTH participants' getPlayerEvents() list, so we dedupe via a sorted
  // pair key. `actionList` is one of ENDEAVOR_ACTIONS[filterKey] — each
  // entry carries its own edge color so the ring distinguishes research
  // collab (teal) from cultural exchange (lavender) etc.
  function pushEndeavorEdges(actionList) {
    if (!actionList || actionList.length === 0) return;
    const Types = typeof DiplomacyActionTypes !== "undefined" ? DiplomacyActionTypes : null;
    if (!Types) return;
    // Pre-resolve action-type ints + their colors so the inner loop is
    // O(events × types) without repeating string→enum lookups.
    const lookups = [];
    for (const entry of actionList) {
      const t = Types[entry.name];
      if (typeof t === "number") lookups.push({ t, color: entry.color, name: entry.name });
    }
    if (lookups.length === 0) return;
    const seen = new Set();
    for (const a of metIds) {
      const events =
        safeCall("getPlayerEvents(" + a + ")", () => {
          if (
            typeof Game === "undefined" ||
            !Game.Diplomacy ||
            typeof Game.Diplomacy.getPlayerEvents !== "function"
          )
            return [];
          return Game.Diplomacy.getPlayerEvents(a) || [];
        }) || [];
      for (const ev of events) {
        if (!ev || typeof ev.actionType !== "number") continue;
        const hit = lookups.find((l) => l.t === ev.actionType);
        if (!hit) continue;
        let other = ev.targetPlayer;
        if (typeof other !== "number") other = ev.otherPlayer;
        if (typeof other !== "number") {
          other = ev.initialPlayer !== a ? ev.initialPlayer : undefined;
        }
        if (typeof other !== "number" || other === a) continue;
        if (!metIds.includes(other)) continue;
        // Dedupe pair + action-type so different endeavors between
        // the same pair show as separate edges.
        const key = Math.min(a, other) + "|" + Math.max(a, other) + "|" + hit.t;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({
          a,
          b: other,
          color: hit.color,
          filterKey,
          label: hit.name
            .replace(/^DIPLOMACY_ACTION_/, "")
            .toLowerCase()
            .replace(/_/g, " ")
        });
      }
    }
  }

  if (filterKey === "research" || filterKey === "endeavors") {
    pushEndeavorEdges(ENDEAVOR_ACTIONS[filterKey]);
    return edges;
  }

  if (filterKey === "openborders") {
    // Open Borders is a diplomatic action/deal. Cited pattern:
    // base-standard/ui/diplomacy-actions/panel-diplomacy-actions.js:269-273, 2413-2417.
    const obType =
      typeof DiplomacyActionTypes !== "undefined"
        ? DiplomacyActionTypes.DIPLOMACY_ACTION_OPEN_BORDERS
        : undefined;
    if (obType === undefined) return edges;
    const seen = new Set();
    for (const a of metIds) {
      const events =
        safeCall("getPlayerEvents(" + a + ")", () => {
          if (
            typeof Game === "undefined" ||
            !Game.Diplomacy ||
            typeof Game.Diplomacy.getPlayerEvents !== "function"
          )
            return [];
          return Game.Diplomacy.getPlayerEvents(a) || [];
        }) || [];
      for (const ev of events) {
        if (!ev || ev.actionType !== obType) continue;
        let other = ev.targetPlayer;
        if (typeof other !== "number") other = ev.otherPlayer;
        if (typeof other !== "number") {
          other = ev.initialPlayer !== a ? ev.initialPlayer : undefined;
        }
        if (typeof other !== "number" || other === a) continue;
        if (!metIds.includes(other)) continue;
        const key = Math.min(a, other) + "|" + Math.max(a, other);
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ a, b: other, color: "#5bc8ff", filterKey: "openborders" });
      }
    }
    return edges;
  }

  return edges;
}

function buildEconomicEdges(metIds, _filterKey, localPid) {
  // Per-pair trade route count via player.Trade.countPlayerTradeRoutesTo(otherId).
  const edges = [];
  if (typeof Players === "undefined" || typeof Players.get !== "function") return edges;
  const pids = metIds.slice();
  if (typeof localPid === "number" && !pids.includes(localPid)) pids.push(localPid);
  for (const fromPid of pids) {
    const fromPlayer = safeCall("Players.get(" + fromPid + ")", () => Players.get(fromPid), null);
    const trade = fromPlayer?.Trade;
    if (!trade || typeof trade.countPlayerTradeRoutesTo !== "function") continue;
    for (const toPid of pids) {
      if (toPid === fromPid) continue;
      let n = 0;
      try {
        n = trade.countPlayerTradeRoutesTo(toPid) | 0;
      } catch (_) {
        n = 0;
      }
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
function buildAttitudeEdges(metIds, _localPid) {
  const edges = [];
  if (typeof Players === "undefined" || typeof Players.get !== "function") return edges;
  for (let i = 0; i < metIds.length; i++) {
    const a = metIds[i];
    const pa = Players.get(a);
    if (!pa) continue;
    for (let j = i + 1; j < metIds.length; j++) {
      const b = metIds[j];
      let catKey;
      if (isAtWar(pa, b)) catKey = "war";
      else if (hasAlliance(pa, b)) catKey = "alliance";
      else catKey = attitudeKeyFromEnum(getRelationship(pa, b));
      edges.push({
        a,
        b,
        color: categoryColor(catKey),
        filterKey: catKey
      });
    }
  }
  return edges;
}

// ---- City-State edge builders ---------------------------------------------

// Suzerainty: for every CS, get csPlayer.Influence.getSuzerain(). If it is
// the local player or any met major, emit an edge from suzerain -> CS.
function buildCsSuzerainEdges(metIds, csIds, localPid) {
  const edges = [];
  if (typeof Players === "undefined" || typeof Players.get !== "function") return edges;
  const majors = new Set(metIds);
  if (typeof localPid === "number") majors.add(localPid);
  for (const csId of csIds) {
    const cs = safeCall("Players.get(" + csId + ")", () => Players.get(csId), null);
    const inf = cs?.Influence;
    if (!inf || typeof inf.getSuzerain !== "function") continue;
    let suz = -1;
    try {
      suz = inf.getSuzerain();
    } catch (_) {
      suz = -1;
    }
    if (typeof suz !== "number" || suz < 0) continue;
    if (!majors.has(suz)) continue;
    edges.push({
      a: suz,
      b: csId,
      color: "#f3c34c",
      dashed: true,
      filterKey: "suzerain"
    });
  }
  return edges;
}

// Trade routes: each major × each CS. width scales with route count.
function buildCsTradeEdges(metIds, csIds, localPid) {
  const edges = [];
  if (typeof Players === "undefined" || typeof Players.get !== "function") return edges;
  const sources = metIds.slice();
  if (typeof localPid === "number" && !sources.includes(localPid)) sources.push(localPid);
  for (const fromPid of sources) {
    const fromPlayer = safeCall("Players.get(" + fromPid + ")", () => Players.get(fromPid), null);
    const trade = fromPlayer?.Trade;
    if (!trade || typeof trade.countPlayerTradeRoutesTo !== "function") continue;
    for (const csId of csIds) {
      let n = 0;
      try {
        n = trade.countPlayerTradeRoutesTo(csId) | 0;
      } catch (_) {
        n = 0;
      }
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

// Attitude (major × CS). If the major has a working getRelationshipEnum
// against the CS, use it; otherwise fall back to suzerain-derived tier:
// the CS's suzerain = "helpful" tier toward that major; everyone else
// is treated as "neutral". If we can't read either, skip the CS.
function buildCsAttitudeEdges(metIds, csIds, localPid) {
  const edges = [];
  if (typeof Players === "undefined" || typeof Players.get !== "function") return edges;
  const majors = metIds.slice();
  if (typeof localPid === "number" && !majors.includes(localPid)) majors.push(localPid);

  for (const csId of csIds) {
    const cs = safeCall("Players.get(" + csId + ")", () => Players.get(csId), null);
    if (!cs) continue;

    // Pre-compute suzerain for fallback path.
    let suz = -1;
    try {
      suz = cs.Influence?.getSuzerain?.() ?? -1;
    } catch (_) {
      suz = -1;
    }

    let anyEmitted = false;
    for (const majorPid of majors) {
      const major = safeCall("Players.get(" + majorPid + ")", () => Players.get(majorPid), null);
      if (!major) continue;
      let catKey;
      // Primary path: CS has getRelationshipEnum via major's Diplomacy.
      const rel = getRelationship(major, csId);
      if (rel !== undefined && rel !== null) {
        if (isAtWar(major, csId)) catKey = "war";
        else catKey = attitudeKeyFromEnum(rel);
      } else if (typeof suz === "number" && suz >= 0) {
        // Fallback: suzerain = helpful, others = neutral.
        catKey = suz === majorPid ? "helpful" : "neutral";
      } else {
        continue; // No useful data; skip this (major, CS) edge.
      }
      edges.push({
        a: majorPid,
        b: csId,
        color: categoryColor(catKey),
        filterKey: catKey
      });
      anyEmitted = true;
    }
    if (!anyEmitted) {
      dlog("CS attitude: skipped CS pid", csId, "(no useful relationship data)");
    }
  }
  return edges;
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
function filterKeyForState(topTab) {
  return topTab === "civ" ? "relationsCivFilters" : "relationsCsFilters";
}
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
const CS_FILTER_OVERRIDES = {
  suzerain: { color: "#5bc8ff", dash: "" }, // blue, solid
  trade: { color: "#f3c34c", dash: "0.6 2" }, // yellow, dotted
  unfriendly: { color: "#ff7f1a", dash: undefined }, // orange, solid
  friendly: { color: "#3fbf3f", dash: undefined } // green (unchanged)
};
function filterVisuals(key, topTab) {
  if (topTab === "cs" && CS_FILTER_OVERRIDES[key]) {
    return CS_FILTER_OVERRIDES[key];
  }
  return null; // no override → fall through to base color/dash maps
}
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
    const id = event?.detail?.selectedItem?.id;
    if (!id) return;
    onSelect(id);
  });
  return bar;
}

// Toggleable filter pill row — visual vocabulary mirrors the History view
// legend (pip + label, filled when active, hollow/dim when toggled off).
// Uses a plain <div> (not <fxs-activatable>) so click handling is direct
// and predictable; fxs-activatable's custom-element click pipeline was
// swallowing pip clicks intermittently.
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
  // the per-filter pills as a small two-link row, no underline, gold on
  // hover. Calls the supplied `onToggleAll(true|false)` callback so the
  // outer view can update its filter state and trigger a single repaint
  // instead of N repaints (one per filter).
  if (typeof onToggleAll === "function") {
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
    allOn.addEventListener(
      "mouseenter",
      () => (allOn.style.color = "var(--ia-accent-gold,#f3c34c)")
    );
    allOn.addEventListener(
      "mouseleave",
      () => (allOn.style.color = "var(--ia-text-secondary,#e5d2ac)")
    );
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
    allOff.addEventListener(
      "mouseenter",
      () => (allOff.style.color = "var(--ia-accent-gold,#f3c34c)")
    );
    allOff.addEventListener(
      "mouseleave",
      () => (allOff.style.color = "var(--ia-text-secondary,#e5d2ac)")
    );
    allOff.addEventListener("click", (ev) => {
      ev?.stopPropagation?.();
      safePlaySound("data-audio-activate", "audio-panel-diplo-ribbon");
      onToggleAll(false);
    });
    ctrlRow.appendChild(allOn);
    ctrlRow.appendChild(sep);
    ctrlRow.appendChild(allOff);
    row.appendChild(ctrlRow);
  }
  for (const f of filters) {
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

    // ── Mini sample line: an inline SVG showing exactly what this
    // filter's edges look like on the ring. The "swatch" is a tiny
    // horizontal line drawn in the filter's color, with the SAME dash
    // pattern (rendered as multiple solid sub-segments — Coherent's
    // SVG renderer rejects stroke-dasharray). This is the actual
    // legend mapping color+texture → filter type.
    // Swatch built from PLAIN HTML divs (NOT SVG). Coherent silently
    // fails to render `<line>` children inside an inline `<svg>` in
    // some builds — that's why openborders/denounced/research/endeavors
    // looked completely blank for you. HTML divs always render.
    const SAMPLE_W = 84; // px — 75% bigger so dash patterns are very visible
    const swatch = document.createElement("span");
    swatch.style.cssText =
      "display:inline-block;vertical-align:middle;" +
      "width:" +
      SAMPLE_W +
      "px;height:7px;" +
      "margin-right:0.75rem;flex-shrink:0;position:relative;";
    // Honor per-tab dash override on the swatch so the legend visual
    // matches the actual ring edge (CS tab: trade=dotted, suzerain=dashed).
    const dashPattern =
      f._dashOverride !== undefined ? f._dashOverride || "" : LINE_DASH[f.key] || "";
    function pushSeg(leftPx, widthPx) {
      const d = document.createElement("span");
      d.style.cssText =
        "position:absolute;top:0;height:7px;" +
        "left:" +
        leftPx +
        "px;width:" +
        widthPx +
        "px;" +
        "background:" +
        (f.color || "#bfbfbf") +
        ";" +
        "border-radius:3.5px;";
      swatch.appendChild(d);
    }
    if (!dashPattern) {
      pushSeg(0, SAMPLE_W);
    } else {
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
          pushSeg(t, end - t);
        }
        t = end;
        segIdx++;
      }
    }
    pill.appendChild(swatch);
    const lbl = document.createElement("span");
    lbl.textContent = label;
    pill.appendChild(lbl);

    // De-bounced multi-event handler: Coherent may dispatch BOTH
    // `click` and `action-activate` for the same activation; toggling
    // twice would net to no change ("filter doesn't work"). Guard with
    // a 50ms window so only the first wins.
    let lastFired = 0;
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
    pill.addEventListener("mousedown", (ev) => {
      dlog("filter pill MOUSEDOWN key=" + f.key);
    });
    row.appendChild(pill);
  }
  return row;
}

// Build the SVG ring with leader portraits and connector lines.
function buildRingSvg(ringIds, names, edges, localPid, viewerPid) {
  // `viewerPid` is the civ whose perspective the ring is drawn FROM (e.g.
  // the CS tab lets the user pick a non-local major civ as the viewer).
  // Sizing/styling treats the viewer the same as the local player so the
  // viewer civ stays the prominent node regardless of who is selected.
  if (typeof viewerPid !== "number") viewerPid = localPid;
  const wrap = document.createElement("div");
  wrap.className = "demographics-relations-ring-wrap";
  wrap.style.position = "relative";

  // Collected as we walk the ring; positioned after the SVG mounts so
  // we can measure where the (proportionally-letterboxed) viewBox area
  // actually lives in pixel coords. This avoids the <foreignObject>
  // path entirely — Coherent had been rendering its contents at the
  // wrong scale or empty for some leaders.
  const portraitsToPlace = [];

  // Layout mode: small rings are a clean circle; large rings (the CS tab
  // can pack 20+ nodes) elongate into a horizontal oval so each node has
  // more arc-length to itself, letting CS icons stay legibly large at
  // max count instead of collapsing to dots. ovalT smoothly interpolates
  // 0..1 across the N=12..N=24 range; the viewBox widens to match so the
  // SVG actually uses the surrounding wider canvas (which is already
  // widescreen).
  const N_FOR_OVAL = ringIds.length;
  const ovalT = Math.max(0, Math.min(1, (N_FOR_OVAL - 12) / 12));
  const viewBoxW = 100 + ovalT * 80; // 100..180
  // Grow the viewBox HEIGHT with oval mode too, so radially-placed labels
  // have headroom both above the top node AND below the bottom node. Earlier
  // we pushed cy down to make room above, which left the bottom clipping.
  // Now cy stays centered and the viewBox just gets taller as N grows.
  const viewBoxH = 100 + ovalT * 24; // 100..124
  const cx = viewBoxW / 2;
  const cy = viewBoxH / 2;

  const SVG_NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 " + viewBoxW + " " + viewBoxH);
  // 'xMidYMid meet' = uniform scale + letterbox. Shapes inside the
  // viewBox stay proportional regardless of the SVG element's actual
  // pixel dimensions, so leader portraits aren't squashed.
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

  // Ring radius scales with node count so a few civs sit close to center
  // (more space for labels) while many civs spread out to use the canvas.
  // Cap at 42 to keep labels from clipping the SVG edge.
  const N = ringIds.length;
  const ry = N <= 2 ? 18 : N <= 6 ? 36 : N <= 12 ? 40 : 38;
  // rx grows past ry when ovalT > 0 — the wider viewBox is what gives
  // us room for a longer X axis, so we use it rather than re-cramming a
  // wider ellipse into the original square.
  const rx = ry + ovalT * 38; // 42..80 at max oval
  const positions = ringPositions(ringIds, rx, ry, cx, cy);

  // Density factor: 1.0 when arc-spacing per node is comfortable (≥ 22
  // SVG units), shrinking smoothly down to 0.32 when very crowded.
  // All node radii + font sizes multiply by this so visual elements
  // never collide regardless of how many CSes are in the ring. The
  // oval mode lengthens the perimeter (Ramanujan's approximation) which
  // raises density on max-CS rings — the whole point of going oval.
  const _h = Math.pow((rx - ry) / (rx + ry), 2);
  const ellipsePerim = Math.PI * (rx + ry) * (1 + (3 * _h) / (10 + Math.sqrt(4 - 3 * _h)));
  const arcSpacing = N > 0 ? ellipsePerim / N : 100;
  const density = Math.max(0.32, Math.min(1.0, arcSpacing / 22));

  // Group edges by undirected pair so when a civ pair carries multiple
  // relationships (Alliance + Open Borders + Trade Route) we can render
  // each as a parallel line offset perpendicular to the pair's axis.
  // Without this they'd all paint at identical coordinates and look like
  // one line — which was the whole "you can only see one relationship at
  // a time" complaint.
  const edgeGroups = new Map();
  for (const e of edges) {
    const pa = positions.get(e.a);
    const pb = positions.get(e.b);
    if (!pa || !pb) continue;
    const key = e.a < e.b ? e.a + "|" + e.b : e.b + "|" + e.a;
    if (!edgeGroups.has(key)) edgeGroups.set(key, []);
    edgeGroups.get(key).push({ e, pa, pb });
  }

  // Perpendicular offset per parallel-line slot. ~1.6 SVG units gives
  // clear visual separation without making the lines look unrelated.
  const PARALLEL_SPACING = 1.6;
  for (const entries of edgeGroups.values()) {
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
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", String(pa.x + ox));
      line.setAttribute("y1", String(pa.y + oy));
      line.setAttribute("x2", String(pb.x + ox));
      line.setAttribute("y2", String(pb.y + oy));
      line.setAttribute("stroke", e.color || "#bfbfbf");
      // Uniform thickness + opacity across every edge on both the
      // major-civ ring and the city-state ring. Per-edge overrides
      // (e.width / e.opacity from trade-route weighting etc.) are
      // intentionally ignored — they made edge color the only signal
      // a reader has to discriminate filter types, and trade-route
      // weighting was the main offender (50–100% opacity range made
      // legend colors look like different shades).
      line.setAttribute("stroke-width", "0.6");
      line.setAttribute("stroke-opacity", "0.9");
      // Per-filter line texture so visually-similar colors stay
      // distinguishable. Solid = attitudes & alliance & war & trade
      // (the "primary" ring signals); dashed/dotted/dash-dot used for
      // overlay categories that would otherwise share a hue with one
      // of the primaries.
      // SVG `stroke-dasharray` is rejected by Coherent's renderer on
      // <line> elements (confirmed via testing — the attribute is
      // present in the DOM but the line draws solid). Workaround:
      // emit MULTIPLE short solid `<line>` segments by hand so each
      // dash is a real solid line. Works in every renderer because
      // we're not relying on any dasharray support at all.
      const dash = dasharrayFor(e);
      line.setAttribute("class", "demographics-relations-line");
      if (!dash) {
        line.setAttribute("stroke-linecap", "round");
        svg.appendChild(line);
      } else {
        // Discard the full-line element; we'll synthesize dashes.
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
        if (parts.length < 2) {
          // Bad pattern — fall back to solid.
          line.setAttribute("stroke-linecap", "round");
          svg.appendChild(line);
        } else {
          const x1 = first.pa.x + ox,
            y1 = first.pa.y + oy;
          const x2 = first.pb.x + ox,
            y2 = first.pb.y + oy;
          const totalLen = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
          if (totalLen <= 0) {
            svg.appendChild(line);
          } else {
            const ux = (x2 - x1) / totalLen,
              uy = (y2 - y1) / totalLen;
            let t = 0;
            let segIdx = 0; // even idx = dash (draw), odd = gap (skip)
            while (t < totalLen) {
              const segLen = parts[segIdx % parts.length];
              const end = Math.min(t + segLen, totalLen);
              if (segIdx % 2 === 0 && end > t) {
                // Draw this dash as a solid sub-line.
                const seg = document.createElementNS(SVG_NS, "line");
                seg.setAttribute("x1", String(x1 + ux * t));
                seg.setAttribute("y1", String(y1 + uy * t));
                seg.setAttribute("x2", String(x1 + ux * end));
                seg.setAttribute("y2", String(y1 + uy * end));
                seg.setAttribute("stroke", e.color || "#bfbfbf");
                seg.setAttribute("stroke-width", "0.6");
                seg.setAttribute("stroke-opacity", "0.9");
                seg.setAttribute("stroke-linecap", "round");
                seg.setAttribute("class", "demographics-relations-line");
                svg.appendChild(seg);
              }
              t = end;
              segIdx++;
            }
          }
        }
      }
    });
  }

  // Nodes.
  for (const id of ringIds) {
    const pos = positions.get(id);
    if (!pos) continue;
    const isLocal = id === localPid;
    const isViewer = id === viewerPid;
    const info = names[id] || {};
    const isCs = !!info.isCityState;
    // Viewer (whether local OR a selected non-local civ) gets the larger
    // node size — keeps the focus civ visually prominent regardless of
    // which civ the user has selected as the viewer.
    const baseR = isViewer ? 6.0 : isCs ? 4.0 : 5.0;
    const r = baseR * (isViewer ? Math.max(density, 0.65) : density);

    // Label placement strategy:
    //   sparse rings (density ≥ 0.7): label directly below the node
    //   dense rings (density < 0.7):  push label radially OUTWARD from
    //     the ring center so adjacent labels don't collide on top of
    //     each other. Maintain text-anchor=middle since each label
    //     stays roughly tangential to the ring.
    const radiallyOut = density < 0.7;
    const dx = pos.x - cx,
      dy = pos.y - cy;
    const mag = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / mag,
      uy = dy / mag;

    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", String(pos.x));
    circle.setAttribute("cy", String(pos.y));
    circle.setAttribute("r", String(r));
    // For CSes: outer-ring color = primaryColor (now actually the type
    // color since CS primary is unreliable). Fill = type color tinted
    // at ~30% so the node visibly carries the CS type at a glance.
    // Final scrub at the render site. Defense-in-depth so any color that
    // sneaks past upstream filters can't still render as a white blob.
    const safeStroke = isCs
      ? normalizeCivColor(info.csTypeColor) || normalizeCivColor(info.primaryColor) || "#9aa8c8"
      : normalizeCivColor(info.primaryColor) || "#c9a24c";
    const safeFillSrc = isCs
      ? normalizeCivColor(info.csTypeColor) || normalizeCivColor(info.primaryColor)
      : normalizeCivColor(info.primaryColor);
    const color = safeStroke;
    const fillColor = isCs && safeFillSrc ? hexToRgba(safeFillSrc, 0.3) : "rgba(20, 16, 10, 0.85)";
    circle.setAttribute("fill", fillColor);
    circle.setAttribute("stroke", isViewer ? "#f3c34c" : color);
    circle.setAttribute(
      "stroke-width",
      String((isViewer ? 0.9 : isCs ? 0.7 : 0.5) * Math.max(density, 0.6))
    );
    if (isCs) circle.setAttribute("stroke-dasharray", "0.8 0.5");
    svg.appendChild(circle);

    // CS type indicator. Prefer the in-game banner icon (the same coin
    // / sword / mask / beaker glyphs the game shows on city banners,
    // path resolved via CS_TYPE_META[type].icon). Falls back to a
    // colored disc when no icon exists for the type (e.g. EXPANSIONIST,
    // DIPLOMATIC have no canonical bonus icon in vanilla).
    if (isCs && info.csTypeIcon) {
      // Queue an HTML overlay (same approach as the major-civ leader
      // portraits below). The SVG `<image href="blp:...">` path was
      // unreliable in Coherent — many CS BLPs rendered as blank/white
      // circles. HTML divs with background-image resolve `blp:` paths
      // consistently.
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

    // Display name. Major civs: "Leader, Civilization". City-states:
    // just the CS name. Falls back to "P<id>" if nothing else is known.
    // The civilization portion always reflects the LATEST observed
    // civName in the name map, so age transitions update the label.
    let nm;
    if (info.isCityState) {
      nm = info.csName || "CS-" + id;
    } else if (info.leaderName && info.civName) {
      nm = info.leaderName + ", " + info.civName;
    } else {
      nm = info.leaderName || info.csName || "P" + id;
    }

    // For MAJOR civs: render the leader portrait inside the node (same
    // BLP that the factbook uses). Falls back to the initial letter
    // when the leaderType string isn't available or UI.getIconURL fails.
    // CS nodes keep the type-icon / colored-disc path above.
    let renderedPortrait = false;
    if (!isCs) {
      const leaderType = info.leaderTypeString;
      let portraitUrl;
      try {
        if (
          leaderType &&
          /^LEADER_/.test(leaderType) &&
          typeof UI !== "undefined" &&
          typeof UI.getIconURL === "function"
        ) {
          // Same pattern as Icon.getLeaderPortraitIcon (vanilla
          // utilities-image.js:182): default size (no _NN suffix)
          // is the most reliably-shipped variant.
          portraitUrl = (UI.getIconURL(leaderType, "LEADER") + ".png").toLowerCase();
        }
      } catch (_) {
        /* */
      }
      if (leaderType) {
        // Defer the actual portrait placement — we'll position
        // fxs-icon divs over the wrap in pixel coords once the
        // SVG has laid out, so the icons scale uniformly and
        // never end up squashed by parent aspect-ratio quirks.
        portraitsToPlace.push({
          kind: "leader",
          leaderType,
          vbX: pos.x, // viewBox coord
          vbY: pos.y,
          vbR: r
        });
        renderedPortrait = true;
      }
    }

    // Initial-letter fallback. Skipped when:
    //   - we drew a leader portrait above (major civ), or
    //   - it's a CS (any kind — we always paint a colored disc for CSes
    //     so letters never appear on city-state nodes).
    if (!renderedPortrait && !isCs) {
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

    // Single label line: just the CS / leader name. The CS type is
    // already conveyed visually by the icon or colored disc inside the
    // node, so duplicating it as a text label is redundant and causes
    // top-of-ring labels to collide with bottom-of-ring labels.
    // Label font scales linearly with density (no floor) so dense rings
    // get genuinely smaller text instead of clamped-and-overlapping text.
    const nameFont = 2.4 * density;

    // Label position: below the node when sparse, radial-outward when dense.
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

  // Place leader portraits as HTML overlays positioned in PIXEL coords
  // over the wrap, computed from the SVG element's actual rendered box.
  // viewBox is `viewBoxW × 100` + `xMidYMid meet` — letterbox preserving
  // aspect ratio. Whichever axis is tighter determines `scale`; the other
  // axis gets centered with leftover gutter on both sides.
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
        // CS type-icon: simple background-image div. Resolves `blp:`
        // paths the same way every other Civ7 UI surface does, which
        // the SVG `<image>` path didn't reliably do in Coherent.
        div.style.backgroundImage = "url('" + p.iconUrl + "')";
        div.style.backgroundSize = "contain";
        div.style.backgroundPosition = "center";
        div.style.backgroundRepeat = "no-repeat";
      } else {
        const icon = document.createElement("fxs-icon");
        icon.setAttribute("data-icon-id", p.leaderType);
        icon.setAttribute("data-icon-context", "LEADER");
        icon.classList.add("demographics-relations-portrait-icon");
        div.appendChild(icon);
      }
      wrap.appendChild(div);
    }
    dlog("placed " + portraitsToPlace.length + " portraits " + "@scale=" + scale.toFixed(2));
  }
  // Defer until the wrap is in the DOM and laid out. The caller (the
  // body.appendChild in repaint) mounts the wrap synchronously, so a
  // single rAF is enough on first paint.
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

export function render(host, ctx) {
  while (host.firstChild) host.removeChild(host.firstChild);

  const settings = ctx.settings;

  // ---- read persisted state ----------------------------------------
  // Sub-tabs (political/economic/attitude) were collapsed into a single
  // ring per top tab — users now see every relationship type overlaid in
  // one diagram. Persisted `relationsTab` setting from old builds is
  // ignored; we only key by top tab now.
  let topTab = "civ";
  try {
    topTab = settings?.getSetting?.("relationsTopTab", "civ") || "civ";
    if (!["civ", "cs"].includes(topTab)) topTab = "civ";
  } catch (_) {
    /* */
  }

  function readFilterSet(top) {
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
  }
  function writeFilterSet(top, set) {
    _filterSetCache.set(top, set);
    const key = filterKeyForState(top);
    try {
      settings?.setSetting?.(key, Array.from(set));
    } catch (_) {}
  }

  const localId = getLocalId();
  const namesBase = buildNameMap(ctx.history);
  const metIds = typeof localId === "number" ? getMetMajorIds(localId) : [];

  // Global "show unmet names" toggle (Fix 4). Default false → unmet civs/CSes
  // render as generic placeholders.
  let showUnmetNames = false;
  try {
    showUnmetNames = !!settings?.getSetting?.("showUnmetNames", false);
  } catch (_) {
    showUnmetNames = false;
  }

  // Determine the CS-Relations viewer pid. Persisted under
  // modSettings.demographics.relationsCsViewerPid. Default to local. If the
  // saved pid is no longer in metIds, fall back to local.
  let csViewerPid = localId;
  try {
    const saved = settings?.getSetting?.("relationsCsViewerPid", localId);
    if (typeof saved === "number" && metIds.includes(saved)) csViewerPid = saved;
    else if (typeof localId === "number") csViewerPid = localId;
  } catch (_) {
    csViewerPid = localId;
  }

  // ---- DOM scaffold (vertical stack) -------------------------------
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

  // Body is the ring's container. Repaints wipe ALL its children, so we
  // must NOT put the filter legend inside it (the body.firstChild wipe
  // on repaint would destroy the legend and the pill-populate logic
  // would target a detached element). Instead, filterHost stays a
  // sibling of body and the CSS positions it absolutely over the body's
  // top-right corner via the wrap's relative positioning.
  const body = document.createElement("div");
  body.className = "demographics-relations-body";
  wrap.appendChild(body);

  const filterHost = document.createElement("div");
  filterHost.className = "demographics-relations-filter-host";
  wrap.appendChild(filterHost);

  const caption = document.createElement("div");
  caption.className = "demographics-relations-caption font-body text-xs";
  wrap.appendChild(caption);

  // ---- repaint --------------------------------------------------------
  // Two repaint scopes:
  //   buildTabBars()  – builds the top + sub tab bars ONCE per render.
  //                     We never tear these down on filter clicks (rebuilding
  //                     fxs-tab-bar mid-event was causing visual flicker
  //                     and swallowing pip clicks; same bug class we hit
  //                     on the factbook).
  //   repaint()       – rebuilds only the viewer row, filter pills, body
  //                     SVG, and caption. Tab bars stay live.
  function buildTabBars() {
    while (topTabHost.firstChild) topTabHost.removeChild(topTabHost.firstChild);
    const topTabs = [
      { id: "civ", label: "Major Civilizations" },
      { id: "cs", label: "City States" }
    ];
    topTabHost.appendChild(
      makeTabBar(topTabs, topTab, "demographics-relations-toptabs", (id) => {
        if (id === topTab) return;
        topTab = id;
        try {
          settings?.setSetting?.("relationsTopTab", id);
        } catch (_) {}
        repaint();
      })
    );
    // Sub-tab row removed — political/economic/attitude views are now
    // overlaid in a single ring. The filter pill row below handles
    // toggling individual relationship types on/off.
    while (subTabHost.firstChild) subTabHost.removeChild(subTabHost.firstChild);
  }
  buildTabBars();

  function repaint() {
    // Viewer dropdown (CS tab only). Items = every met major (incl local).
    // Element confirmed at
    //   core/ui/options/options-helpers.js:35-50  (fxs-dropdown, attributes
    //     dropdown-items / selected-item-index)
    //   core/ui/components/fxs-dropdown.js:8       (event name
    //     "dropdown-selection-change", detail.selectedIndex)
    //   core/ui/options/screen-options.js:239-245   (handler pattern)
    while (viewerHost.firstChild) viewerHost.removeChild(viewerHost.firstChild);
    if (topTab === "cs" && metIds.length > 0) {
      const lbl = document.createElement("div");
      lbl.className = "demographics-relations-viewer-label font-body text-xs";
      lbl.textContent = "Viewer:";
      lbl.style.color = "#f3e7c4";
      lbl.style.marginRight = "0.5rem";
      viewerHost.appendChild(lbl);

      const items = metIds.map((pid) => {
        const info = namesBase[pid] || {};
        const isYou = pid === localId;
        const nm = isYou
          ? (info.leaderName || "You") + " (You)"
          : info.leaderName || "Player " + pid;
        return { label: nm, id: "viewer_" + pid, pid };
      });
      let selIdx = metIds.indexOf(csViewerPid);
      if (selIdx < 0) selIdx = 0;
      const dd = document.createElement("fxs-dropdown");
      dd.classList.add("demographics-relations-viewer-dropdown");
      dd.setAttribute("data-audio-group-ref", "audio-panel-diplo-ribbon");
      dd.setAttribute("data-audio-focus-ref", "data-audio-dropdown-focus");
      dd.setAttribute("dropdown-items", JSON.stringify(items.map((it) => ({ label: it.label }))));
      dd.setAttribute("selected-item-index", String(selIdx));
      dd.addEventListener("dropdown-selection-change", (event) => {
        const idx = event?.detail?.selectedIndex;
        if (typeof idx !== "number" || idx < 0 || idx >= items.length) return;
        const newPid = items[idx].pid;
        if (newPid === csViewerPid) return;
        csViewerPid = newPid;
        try {
          settings?.setSetting?.("relationsCsViewerPid", newPid);
        } catch (_) {}
        dlog("CS viewer changed to pid", newPid);
        repaint();
      });
      viewerHost.appendChild(dd);
    }

    // Filter pill row — one pill per relationship type. All toggles
    // apply to the same ring; no subtab indirection.
    while (filterHost.firstChild) filterHost.removeChild(filterHost.firstChild);
    const filterDefs = filtersForView(topTab).map((f) => {
      const ov = filterVisuals(f.key, topTab);
      return {
        ...f,
        // Per-tab override wins; otherwise fall back to the global
        // swatch table (which respects colorblind mode).
        color: (ov && ov.color) || pillColorFor(f.key, topTab),
        // Tag with the per-tab dash override so the legend swatch
        // SVG renders the right pattern (handled in makeFilterPillRow).
        _dashOverride: ov ? ov.dash : undefined
      };
    });
    const activeSet = readFilterSet(topTab);
    filterHost.appendChild(
      makeFilterPillRow(
        filterDefs,
        activeSet,
        (key) => {
          const cur = readFilterSet(topTab);
          if (cur.has(key)) cur.delete(key);
          else cur.add(key);
          writeFilterSet(topTab, cur);
          repaint();
        },
        (turnOn) => {
          // Bulk-set every filter for the active topTab in one repaint.
          const next = turnOn ? new Set(filterDefs.map((f) => f.key)) : new Set();
          writeFilterSet(topTab, next);
          repaint();
        }
      )
    );

    // Body: ring SVG.
    while (body.firstChild) body.removeChild(body.firstChild);
    while (caption.firstChild) caption.removeChild(caption.firstChild);

    if (typeof localId !== "number") {
      const empty = document.createElement("div");
      empty.className = "demographics-empty font-body text-base";
      empty.textContent = "Local player not available (observer mode).";
      body.appendChild(empty);
      return;
    }

    // Compute edges + ring node set per view.
    let edges = [];
    let ringIds = metIds.slice();
    const names = Object.assign({}, namesBase);
    let capText = "";

    // Helper: get the snapshot-recorded `met` field for a pid from the
    // latest sample. Used as a fallback when viewer.Diplomacy.hasMet is
    // unavailable. Only meaningful when viewer == localPid (sampler
    // records met relative to local player). For non-local viewers we
    // skip the snapshot fallback.
    function latestSampleMet(pid) {
      try {
        const samples = ctx.history?.samples || [];
        for (let i = samples.length - 1; i >= 0; i--) {
          const ps = samples[i]?.players?.[pid];
          if (ps && typeof ps.met === "boolean") return ps.met;
        }
      } catch (_) {
        /* */
      }
      return undefined;
    }

    // Apply "unmet civ" placeholder to major-civ node labels from the
    // LOCAL player's perspective (Civ Relations) or the SELECTED viewer
    // (CS Relations). When the setting is on, always show real names.
    function applyMetMaskForMajors(viewerPid) {
      if (showUnmetNames) return;
      for (const pid of metIds) {
        if (pid === viewerPid) continue;
        let met = viewerHasMet(viewerPid, pid);
        if (met === undefined && viewerPid === localId) {
          const snap = latestSampleMet(pid);
          if (typeof snap === "boolean") met = snap;
        }
        if (met === false) {
          names[pid] = Object.assign({}, names[pid] || {}, {
            leaderName: "Unmet Civilization",
            civName: undefined
          });
        }
      }
    }

    if (topTab === "civ") {
      // Civ Relations uses the LOCAL player as the viewer. All filters
      // are overlaid in one ring — a pair of civs can carry multiple
      // edges (e.g. Alliance + Open Borders + Trade Route) which the
      // ring renderer offsets into parallel lines.
      applyMetMaskForMajors(localId);
      // Attitude edges (one per pair). Filter by which attitude pills
      // are active; war/alliance are part of this set (no double-up
      // with the old political "alliance" filter — that's gone).
      const attitudeEdges = buildAttitudeEdges(metIds, localId);
      for (const e of attitudeEdges) {
        if (activeSet.has(e.filterKey)) edges.push(e);
      }
      // Political-action edges (open borders, denounced, research,
      // endeavors). Each filter pill maps 1:1 to buildPoliticalEdges
      // queried with its key — no more subtab routing.
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
      capText =
        "Ring node = met major civ. Multiple lines between two civs = multiple relationships.";
    } else {
      // cs
      // CS Relations uses the SELECTED viewer (csViewerPid). Per user
      // requirement: only the SELECTED viewer civ appears among majors,
      // not all met majors — keeps the diagram focused on this civ's
      // relationships with city-states.
      const viewerPid = typeof csViewerPid === "number" ? csViewerPid : localId;
      applyMetMaskForMajors(viewerPid);

      const csIds = getCityStateIds();
      // Only the viewer civ on the major side of the ring.
      const viewerOnlyMajors = [viewerPid];
      ringIds = viewerOnlyMajors.concat(csIds);
      for (const id of csIds) {
        let metCs = viewerHasMet(viewerPid, id);
        if (metCs === undefined && viewerPid === localId) {
          const snap = latestSampleMet(id);
          if (typeof snap === "boolean") metCs = snap;
        }
        // If hasMet says "no" → generic label; if undefined → assume
        // met (defensive — don't aggressively hide).
        const label = metCs === false && !showUnmetNames ? "Unmet CS" : resolveCsName(id);
        // Attach CS color + type meta so the ring node can paint it.
        // PREFER the type color (matches V7's in-game color-coding of
        // CS types: militaristic=red, cultural=purple, etc.) over the
        // CS's primary color, because UI.Player.getPrimaryColorValueAsString
        // often returns a default dark color for city-states that
        // doesn't visually distinguish them. Fall back to primary or
        // a generic gray if neither is available.
        // UNMET CSes don't get a type icon or type color — we
        // shouldn't be leaking what kind they are. They render as a
        // neutral gray disc with the "Unmet CS" label.
        const csIsMet = metCs !== false;
        const UNMET_GRAY = "#7d7d7d";
        const csType = csIsMet ? resolveCsType(id) : null;
        const typeMeta = csIsMet ? csTypeMeta(csType) : null;
        const primary = csIsMet ? resolveCsPrimaryColor(id) : null;
        // Normalize CS primary into a safe 6-char hex or null. Civ7
        // returns "#FFFFFFFF" for many CSes (engine default when no
        // banner color), and may also return 8-char ARGB/RGBA. Using
        // those as fill rendered as opaque white — the "white circle"
        // bug. `normalizeCivColor` rejects near-white and near-black.
        const safePrimary = normalizeCivColor(primary);
        // Always provide SOMETHING to fill the node so the letter
        // fallback never triggers for a CS. Met CSes whose type we
        // can't classify get the (filtered) primary color (or a
        // generic blue-gray); unmet CSes get a neutral gray.
        let csColor;
        if (!csIsMet) {
          csColor = UNMET_GRAY;
        } else {
          csColor = typeMeta?.color || safePrimary || "#9aa8c8";
        }
        dlog(
          "CS pid=" + id,
          "met=" + csIsMet,
          "type=" + csType,
          "typeColor=" + (typeMeta?.color || "-"),
          "primary=" + (primary || "-")
        );
        names[id] = Object.assign({}, names[id] || {}, {
          isCityState: true,
          csName: label,
          leaderName: label,
          csMet: csIsMet,
          primaryColor: csColor,
          csTypeKey: csType,
          csTypeLabel: csIsMet ? typeMeta?.label || null : null,
          // Met CSes: type icon (preferred) OR fallback to color
          // disc (csTypeColor). Unmet CSes: NO icon, only the
          // gray-fill csTypeColor so the ring still renders a
          // disc and not a "U" / "Z" letter.
          // Met CSes always get a non-null csTypeColor so the inner
          // disc renders (preferring the canonical type color, then
          // primary, then a generic blue-gray). Unmet → solid gray.
          csTypeColor: csIsMet ? typeMeta?.color || safePrimary || "#9aa8c8" : UNMET_GRAY,
          csTypeIcon: csIsMet ? typeMeta?.icon || null : null
        });
      }

      // Build edges then filter so edges only involve CSes the viewer
      // has met (suzerain / trade / attitude). Unmet CSes still appear
      // as ring nodes, but no edges are drawn for them from the
      // viewer's perspective.
      const csMetSet = new Set();
      for (const id of csIds) {
        if (names[id]?.csMet !== false) csMetSet.add(id);
      }
      function viewerEdgeFilter(e) {
        // edge.a or edge.b might be a CS; require it to be in csMetSet.
        if (csIds.includes(e.a) && !csMetSet.has(e.a)) return false;
        if (csIds.includes(e.b) && !csMetSet.has(e.b)) return false;
        // Also restrict to edges originating from / involving the viewer
        // for attitude (per spec: "viewer↔CS edges, filtered by
        // viewer's met set"). Suzerain edges show all known suzerain
        // relationships among met CSes. Trade routes likewise.
        return true;
      }

      // Pass only the viewer civ as the "majors" list to edge builders
      // so each edge anchors at the viewer. All three relationship
      // types (suzerain, trade, attitude) overlay on the same ring —
      // a CS the viewer is both suzerain of AND trades with shows two
      // parallel lines.
      const viewerMajors = [viewerPid];
      if (activeSet.has("suzerain")) {
        edges = edges.concat(buildCsSuzerainEdges(viewerMajors, csIds, viewerPid));
      }
      if (activeSet.has("trade")) {
        edges = edges.concat(buildCsTradeEdges(viewerMajors, csIds, viewerPid));
      }
      // Attitude edges, filtered by which attitude pills are active.
      const attEdges = buildCsAttitudeEdges(viewerMajors, csIds, viewerPid);
      for (const e of attEdges) {
        if (activeSet.has(e.filterKey) && (e.a === viewerPid || e.b === viewerPid)) {
          edges.push(e);
        }
      }
      edges = edges.filter(viewerEdgeFilter);
      capText = "Viewer-civ ↔ city-state relationships. Multiple lines = multiple relationships.";
    }

    // Apply per-topTab visual overrides to edges (City-State tab uses
    // a different color/dash vocabulary: suzerain=blue dashed,
    // friendly=green solid, unfriendly=orange solid, trade=yellow
    // dotted, etc.). Edits are non-destructive — `e._dashOverride`
    // gets read by `dasharrayFor` first, and `e.color` overwrites the
    // builder's default for the swatch+stroke.
    if (topTab === "cs") {
      for (const e of edges) {
        const ov = filterVisuals(e.filterKey, "cs");
        if (!ov) continue;
        if (ov.color) e.color = ov.color;
        if (ov.dash !== undefined) e._dashOverride = ov.dash;
      }
    }
    // Pass the selected viewer for CS-tab views so the viewer-civ node
    // keeps the larger "focus" size when the user picks a non-local civ.
    // Civ-tab always uses the local player as the viewer.
    const ringViewerPid =
      topTab === "cs" && typeof csViewerPid === "number" ? csViewerPid : localId;
    body.appendChild(buildRingSvg(ringIds, names, edges, localId, ringViewerPid));
    caption.textContent = capText;
  }

  repaint();
  dlog("rendered relations; topTab=", topTab, "met=", metIds.length);
}
