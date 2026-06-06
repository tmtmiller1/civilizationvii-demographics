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
// The ring renderer, edge builders, and filter-pill DOM live in sibling
// modules:
//   relations-ring-svg.js - buildRingSvg + SVG node/edge/portrait helpers
//   relations-edges.js    - edge builders + diplomacy/CS-type resolution
//   relations-filters.js  - makeFilterPillRow + pill/swatch helpers
//   relations-shared.js   - logging, safeCall, color + dash helpers
//
// V7 diplomacy accessors in use:
//   player.Diplomacy.hasMet(other)
//   Players.getAliveIds() / Players.get(id) / player.isMajor
//   GameContext.localPlayerID
//
// All of the above are demonstrated either in the sloth panel or in
// vanilla diplomacy code under core/ui/utilities/ and
// base-standard/ui/diplomacy*.

import { t } from "/demographics/ui/demographics-i18n.js";
import {
  dlog,
  derr,
  safeCall,
  normalizeCivColor
} from "/demographics/ui/screen-demographics/views/relations-shared.js";
import {
  buildCivTaggedEdges,
  buildCsSuzerainEdges,
  buildCsTradeEdges,
  buildCsAttitudeEdges,
  resolveCsType,
  csTypeMeta
} from "/demographics/ui/screen-demographics/views/relations-edges.js";
import { makeFilterPillRow } from "/demographics/ui/screen-demographics/views/relations-filters.js";
import { buildRingSvg } from "/demographics/ui/screen-demographics/views/relations-ring-svg.js";
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
          // Players.get(id)/p.isMajor/humanDiplo.hasMet(id) can throw per-id;
          // skip that player and keep scanning the rest.
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
    // Players.getAliveIds() can throw at the engine boundary; fall back to []
    // (caller then tries collectAliveIdsFallback).
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
    // Players.getAlive() can throw at the engine boundary; fall back to [].
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

// ---- name resolution from history (so we can label nodes) -----------------

/**
 * Assign `target[field] = value` when `value` is a non-empty string.
 * @param {NodeInfo} target Object to mutate.
 * @param {string} field Field name.
 * @param {*} value Candidate value.
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
// canonical accessor is `Locale.compose(player.name)` - see
// base-standard/ui/diplo-ribbon/model-diplo-ribbon.js. This yields the
// actual minor-civ name (e.g. "Carthage", "Bactra") rather than the generic
// "village" / civilizationType placeholder.

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
      // Locale.compose(key) can throw on a malformed key; fall through to the
      // raw key below.
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
    // GameInfo.Civilizations.lookup(p.civilizationType) can throw at the
    // engine boundary; fall back to null.
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

// ---- filter persistence ---------------------------------------------------

// Unified filter sets - the political/economic/attitude subtabs were folded
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
    // Order matters - pills render in this order; attitude grouped first
    // so the relationship-state pills sit together visually.
    return [
      { key: "war", label: t("LOC_DEMOGRAPHICS_RELATIONS_AT_WAR"), kind: "attitude" },
      { key: "alliance", label: t("LOC_DEMOGRAPHICS_RELATIONS_ALLIANCE"), kind: "attitude" },
      { key: "helpful", label: t("LOC_DEMOGRAPHICS_RELATIONS_HELPFUL"), kind: "attitude" },
      { key: "friendly", label: t("LOC_DEMOGRAPHICS_RELATIONS_FRIENDLY"), kind: "attitude" },
      { key: "unfriendly", label: t("LOC_DEMOGRAPHICS_RELATIONS_UNFRIENDLY"), kind: "attitude" },
      { key: "hostile", label: t("LOC_DEMOGRAPHICS_RELATIONS_HOSTILE"), kind: "attitude" },
      // Neutral intentionally omitted - N² neutral lines just clutter.
      {
        key: "openborders",
        label: t("LOC_DEMOGRAPHICS_RELATIONS_OPEN_BORDERS"),
        kind: "political"
      },
      { key: "denounced", label: t("LOC_DEMOGRAPHICS_RELATIONS_DENOUNCED"), kind: "political" },
      { key: "research", label: t("LOC_DEMOGRAPHICS_RELATIONS_RESEARCH"), kind: "political" },
      { key: "endeavors", label: t("LOC_DEMOGRAPHICS_RELATIONS_ENDEAVORS"), kind: "political" },
      { key: "trade", label: t("LOC_DEMOGRAPHICS_RELATIONS_TRADE_ROUTES"), kind: "economic" }
    ];
  }
  // City-state tab - viewer-anchored relationships.
  return [
    { key: "suzerain", label: t("LOC_DEMOGRAPHICS_RELATIONS_SUZERAINTY"), kind: "political" },
    { key: "trade", label: t("LOC_DEMOGRAPHICS_RELATIONS_TRADE_ROUTES"), kind: "economic" },
    { key: "war", label: t("LOC_DEMOGRAPHICS_RELATIONS_AT_WAR"), kind: "attitude" },
    { key: "alliance", label: t("LOC_DEMOGRAPHICS_RELATIONS_ALLIANCE"), kind: "attitude" },
    { key: "helpful", label: t("LOC_DEMOGRAPHICS_RELATIONS_HELPFUL"), kind: "attitude" },
    { key: "friendly", label: t("LOC_DEMOGRAPHICS_RELATIONS_FRIENDLY"), kind: "attitude" },
    { key: "unfriendly", label: t("LOC_DEMOGRAPHICS_RELATIONS_UNFRIENDLY"), kind: "attitude" },
    { key: "hostile", label: t("LOC_DEMOGRAPHICS_RELATIONS_HOSTILE"), kind: "attitude" }
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

// Single source of truth for filter-pill swatch colors. Attitude keys pull
// the live palette so colorblind mode applies; political/economic keys have
// their own fixed colors (these aren't "civ attitudes" semantically).
// Per-topTab visual overrides. The City-State tab has a different visual
// vocabulary than the major-civs tab - friendly green stays green, but the
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
    tabs.findIndex((tab) => tab.id === activeKey)
  );
  bar.setAttribute("selected-tab-index", String(idx));
  bar.addEventListener("tab-selected", (event) => {
    const id = /** @type {*} */ (event)?.detail?.selectedItem?.id;
    if (!id) return;
    onSelect(id);
  });
  return bar;
}

// Module-scope cache of filter sets keyed by `${topTab}:${subTab}`.
// Coherent's localStorage gets wiped between reads in this UI context, so
// we cannot trust round-tripping through settings.json - we keep the
// authoritative Set here in memory and treat settings.setSetting as a
// best-effort write for cross-session persistence.
const _filterSetCache = new Map();

// Module-scope cache of node-focus selections keyed by top tab ("civ"/"cs").
// In-memory only; stale ids are pruned against the current ringIds each paint.
const _nodeSelectionCache = new Map();

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
    // settings.getSetting("relationsTopTab") can throw at the storage
    // boundary; keep the "civ" default.
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
    // settings.getSetting("showUnmetNames") can throw at the storage
    // boundary; default to false (mask unmet names).
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
    // settings.getSetting("relationsCsViewerPid") can throw at the storage
    // boundary; fall back to the local player.
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
  // filter legend must NOT live inside it - filterHost stays a sibling and
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
  const samples = history?.samples || [];
  for (let i = samples.length - 1; i >= 0; i--) {
    const ps = samples[i]?.players?.[pid];
    if (ps && typeof ps.met === "boolean") return ps.met;
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
 */
function applyMetMaskForMajors(viewerPid, metIds, names, showUnmetNames, localId, history) {
  if (showUnmetNames) return;
  for (const pid of metIds) {
    if (pid === viewerPid) continue;
    const met = resolveMet(viewerPid, pid, localId, history);
    if (met === false) {
      names[pid] = Object.assign({}, names[pid] || {}, {
        leaderName: t("LOC_DEMOGRAPHICS_UNMET_CIV"),
        civName: undefined
      });
    }
  }
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
  const label =
    metCs === false && !showUnmetNames
      ? t("LOC_DEMOGRAPHICS_RELATIONS_UNMET_CS")
      : resolveCsName(id);
  // PREFER the type color (matches V7's in-game CS-type color-coding) over
  // the CS's primary color, which often returns a default dark color.
  // UNMET CSes get no type icon/color - render as a neutral gray disc.
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
 * @param {boolean} includeAttitude Whether to include attitude-family edges.
 * @param {Set<number>} csMetSet The met-CS id set.
 * @returns {Edge[]} The combined, filtered edge set.
 */
function buildCsEdges(viewerPid, csIds, includeAttitude, csMetSet) {
  // Pass only the viewer civ as the "majors" list so each edge anchors at
  // the viewer; all relationship types overlay on the same ring.
  const viewerMajors = [viewerPid];
  /** @type {Edge[]} */
  let edges = [];
  edges = edges.concat(buildCsSuzerainEdges(viewerMajors, csIds, viewerPid));
  edges = edges.concat(buildCsTradeEdges(viewerMajors, csIds, viewerPid));
  if (includeAttitude) {
    edges = edges.concat(buildCsAttitudeEdges(viewerMajors, csIds, viewerPid));
  }
  // Require any CS endpoint to be in the viewer's met set (unmet CSes still
  // appear as nodes, but draw no edges from the viewer's perspective).
  return edges.filter((e) => {
    if (e.a !== viewerPid && e.b !== viewerPid) return false;
    if (csIds.includes(e.a) && !csMetSet.has(e.a)) return false;
    if (csIds.includes(e.b) && !csMetSet.has(e.b)) return false;
    return true;
  });
}

/** Attitude-family filter keys. */
const ATTITUDE_FILTER_KEYS = new Set([
  "war",
  "alliance",
  "helpful",
  "friendly",
  "unfriendly",
  "hostile"
]);

/**
 * Whether any attitude-family filter is active.
 * @param {Set<string>} activeSet Active filters.
 * @returns {boolean} True when at least one attitude key is enabled.
 */
function hasActiveAttitudeFilter(activeSet) {
  for (const k of ATTITUDE_FILTER_KEYS) {
    if (activeSet.has(k)) return true;
  }
  return false;
}

/**
 * Read current game turn defensively.
 * @returns {number|undefined} Current turn, or undefined.
 */
function readGameTurn() {
  return safeCall("relations.Game.turn", () => {
    if (typeof Game !== "undefined" && typeof Game.turn === "number") return Game.turn;
    return undefined;
  });
}

/**
 * Apply per-topTab visual overrides to CS-tab edges (suzerain=blue dashed,
 * trade=yellow dotted, etc.). Non-destructive - `e._dashOverride` is read by
 * `dasharrayFor` first, and `e.color` overwrites the builder default. Mutates.
 * @param {Edge[]} edges The edges to recolor.
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
 * @property {(top: string) => Set<number>} readNodeSelection Node-focus reader.
 * @property {(top: string, set: Set<number>) => void} writeNodeSelection Writer.
 * @property {Record<string, { key: string, edges: Edge[] }>} edgeCacheByTop
 *   Cached full edge set keyed by turn/viewer snapshot.
 * @property {() => void} repaint Repaint entry point.
 */

/**
 * Keep only selected ids that still exist in the current ring.
 * @param {Set<number>} selected Selected ids (any source).
 * @param {number[]} ringIds Current ring ids.
 * @returns {Set<number>} Pruned selection.
 */
function pruneSelectionToRing(selected, ringIds) {
  const ringSet = new Set(ringIds);
  const out = new Set();
  for (const id of selected) {
    if (ringSet.has(id)) out.add(id);
  }
  return out;
}

/**
 * Filter edges to those touching any selected node. Empty selection means all.
 * @param {Edge[]} edges Candidate edges.
 * @param {Set<number>} selected Selected node ids.
 * @returns {Edge[]} The filtered edge list.
 */
function filterEdgesBySelectedNodes(edges, selected) {
  if (!(selected instanceof Set) || selected.size === 0) return edges;
  return edges.filter((e) => selected.has(e.a) || selected.has(e.b));
}

/**
 * Build the CS-tab viewer dropdown into the viewer host (no-op off the CS tab).
 * @param {RenderState} rs The render-loop state.
 */
function buildViewerDropdown(rs) {
  const { viewerHost } = rs.sc;
  while (viewerHost.firstChild) viewerHost.removeChild(viewerHost.firstChild);
  if (!(rs.topTab === "cs" && rs.metIds.length > 0)) return;

  const lbl = document.createElement("div");
  lbl.className = "demographics-relations-viewer-label font-body text-xs";
  lbl.textContent = t("LOC_DEMOGRAPHICS_LABEL_VIEWER");
  lbl.style.color = "#f3e7c4";
  lbl.style.marginRight = "0.5rem";
  viewerHost.appendChild(lbl);

  const items = rs.metIds.map((pid) => {
    const info = rs.namesBase[pid] || {};
    const isYou = pid === rs.localId;
    const baseName = info.leaderName || t("LOC_DEMOGRAPHICS_PLAYER_YOU");
    const nm = isYou
      ? t("LOC_DEMOGRAPHICS_RELATIONS_VIEWER_YOU", baseName)
      : info.leaderName || t("LOC_DEMOGRAPHICS_PLAYER_FALLBACK", pid);
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
    } catch (_) {
      // settings.setSetting persistence is best-effort (Coherent storage is
      // unreliable here); the in-memory rs.csViewerPid already holds truth.
    }
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
 */
function buildFilterRow(rs, filterDefs) {
  const { filterHost } = rs.sc;
  while (filterHost.firstChild) filterHost.removeChild(filterHost.firstChild);

  const title = document.createElement("div");
  title.className = "demographics-relations-filter-title font-title text-xs";
  title.textContent =
    rs.topTab === "civ"
      ? t("LOC_DEMOGRAPHICS_RELATIONS_TAB_MAJORS")
      : t("LOC_DEMOGRAPHICS_RELATIONS_TAB_CITY_STATES");
  filterHost.appendChild(title);

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
 * Compute civ-tab ring data, including cached full-edge build and re-filter.
 * @param {RenderState} rs The render-loop state.
 * @param {Set<string>} activeSet Active filter keys.
 * @param {Record<string, NodeInfo>} names Node display-info map.
 * @returns {{ ringIds: number[], edges: Edge[], names: Record<string, NodeInfo>, capText: string, ringViewerPid: number|undefined }}
 *   The computed ring inputs.
 */
function computeCivRingData(rs, activeSet, names) {
  const localId = /** @type {number} */ (rs.localId);
  applyMetMaskForMajors(localId, rs.metIds, names, rs.showUnmetNames, localId, rs.ctx.history);
  const turn = readGameTurn();
  const includeAttitude = hasActiveAttitudeFilter(activeSet);
  const cacheKey =
    String(localId) +
    "|" +
    String(turn) +
    "|" +
    String(localId) +
    "|" +
    String(rs.metIds.length) +
    "|att:" +
    String(includeAttitude ? 1 : 0);
  const slot = rs.edgeCacheByTop.civ;
  if (slot.key !== cacheKey) {
    slot.key = cacheKey;
    slot.edges = buildCivTaggedEdges(rs.metIds, localId, includeAttitude);
  }
  const edges = slot.edges.filter((e) => !!e.filterKey && activeSet.has(e.filterKey));
  return {
    ringIds: rs.metIds.slice(),
    edges,
    names,
    capText: t("LOC_DEMOGRAPHICS_RELATIONS_CAPTION_CIV"),
    ringViewerPid: localId
  };
}

/**
 * Compute city-state-tab ring data, including cached full-edge build and
 * re-filter.
 * @param {RenderState} rs The render-loop state.
 * @param {Set<string>} activeSet Active filter keys.
 * @param {Record<string, NodeInfo>} names Node display-info map.
 * @returns {{ ringIds: number[], edges: Edge[], names: Record<string, NodeInfo>, capText: string, ringViewerPid: number|undefined }}
 *   The computed ring inputs.
 */
function computeCsRingData(rs, activeSet, names) {
  const localId = /** @type {number} */ (rs.localId);
  const viewerPid = typeof rs.csViewerPid === "number" ? rs.csViewerPid : localId;
  applyMetMaskForMajors(viewerPid, rs.metIds, names, rs.showUnmetNames, localId, rs.ctx.history);

  const csIds = getCityStateIds();
  const ringIds = [viewerPid].concat(csIds);
  for (const id of csIds) {
    names[id] = Object.assign(
      {},
      names[id] || {},
      buildCsNodeInfo(id, viewerPid, rs.showUnmetNames, localId, rs.ctx.history)
    );
  }
  const csMetSet = buildCsMetSet(csIds, names);
  const turn = readGameTurn();
  const includeAttitude = hasActiveAttitudeFilter(activeSet);
  const cacheKey =
    String(localId) +
    "|" +
    String(turn) +
    "|" +
    String(viewerPid) +
    "|" +
    String(rs.metIds.length) +
    "|" +
    String(csIds.length) +
    "|att:" +
    String(includeAttitude ? 1 : 0);
  const slot = rs.edgeCacheByTop.cs;
  if (slot.key !== cacheKey) {
    slot.key = cacheKey;
    slot.edges = buildCsEdges(viewerPid, csIds, includeAttitude, csMetSet);
  }
  const edges = slot.edges.filter((e) => !!e.filterKey && activeSet.has(e.filterKey));
  return {
    ringIds,
    edges,
    names,
    capText: t("LOC_DEMOGRAPHICS_RELATIONS_CAPTION_CS"),
    ringViewerPid: viewerPid
  };
}

/**
 * Compute the ring node set, edges, names, and caption for the active view.
 * @param {RenderState} rs The render-loop state.
 * @param {Set<string>} activeSet Active filter keys.
 * @returns {{ ringIds: number[], edges: Edge[], names: Record<string, NodeInfo>, capText: string, ringViewerPid: number|undefined }}
 *   The computed ring inputs.
 */
function computeRingData(rs, activeSet) {
  /** @type {Record<string, NodeInfo>} */
  const names = Object.assign({}, rs.namesBase);
  if (rs.topTab === "civ") return computeCivRingData(rs, activeSet, names);
  return computeCsRingData(rs, activeSet, names);
}

/**
 * Build the ring SVG for the current selection, wiring node clicks to toggle
 * the per-tab focus set and repaint. Extracted to keep `renderRingBody` under
 * the line cap.
 * @param {RenderState} rs The render-loop state.
 * @param {number[]} ringIds Node ids on the ring.
 * @param {Record<string, *>} names Node display-info map.
 * @param {*[]} focusedEdges Edges after focus filtering.
 * @param {number | undefined} ringViewerPid Viewer pid for the ring (defaults to local).
 * @param {Set<number>} selected The active focus set.
 * @returns {HTMLElement} The ring wrap element.
 */
function buildFocusedRingSvg(rs, ringIds, names, focusedEdges, ringViewerPid, selected) {
  return buildRingSvg(
    ringIds,
    names,
    focusedEdges,
    /** @type {number} */ (rs.localId),
    ringViewerPid,
    {
      selectedNodeIds: selected,
      onNodeToggle: (pid) => {
        const cur = rs.readNodeSelection(rs.topTab);
        if (cur.has(pid)) cur.delete(pid);
        else cur.add(pid);
        rs.writeNodeSelection(rs.topTab, cur);
        rs.repaint();
      }
    }
  );
}

/**
 * Append the "Clear focus" caption button (with a leading spacer) used when one
 * or more nodes are focused.
 * @param {HTMLElement} caption The caption element.
 * @param {RenderState} rs The render-loop state.
 */
function appendFocusClearButton(caption, rs) {
  const sep = document.createElement("span");
  sep.textContent = "   ";
  caption.appendChild(sep);

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "demographics-relations-clear-focus-btn font-body text-xs";
  clearBtn.textContent = "Clear focus";
  clearBtn.addEventListener("click", () => {
    rs.writeNodeSelection(rs.topTab, new Set());
    rs.repaint();
  });
  caption.appendChild(clearBtn);
}

/**
 * Render the ring body + caption from computed ring data.
 * @param {RenderState} rs The render-loop state.
 */
function renderRingBody(rs) {
  const { body, caption } = rs.sc;
  const activeSet = rs.readFilterSet(rs.topTab);

  while (body.firstChild) body.removeChild(body.firstChild);
  while (caption.firstChild) caption.removeChild(caption.firstChild);

  if (typeof rs.localId !== "number") {
    const empty = document.createElement("div");
    empty.className = "demographics-empty font-body text-base";
    empty.textContent = t("LOC_DEMOGRAPHICS_EMPTY_OBSERVER");
    body.appendChild(empty);
    return;
  }

  const { ringIds, edges, names, capText: baseCapText, ringViewerPid } = computeRingData(
    rs,
    activeSet
  );
  let capText = baseCapText;

  // Apply per-topTab visual overrides to edges (CS tab uses a different
  // color/dash vocabulary). Edits are non-destructive.
  if (rs.topTab === "cs") {
    applyCsEdgeOverrides(edges);
  }

  // Node-focus filter: click one or more ring nodes to show only the edges
  // to/from those nodes. Empty selection = show all edges.
  const selectedRaw = rs.readNodeSelection(rs.topTab);
  const selected = pruneSelectionToRing(selectedRaw, ringIds);
  if (selected.size !== selectedRaw.size) {
    rs.writeNodeSelection(rs.topTab, selected);
  }
  const focusedEdges = filterEdgesBySelectedNodes(edges, selected);

  if (selected.size > 0) {
    capText += "  " +
      "(" + selected.size + " focus" + (selected.size === 1 ? "" : "es") +
      "; click icons to toggle)";
  }

  // Civ-tab always uses the local player as the viewer; CS-tab uses the
  // selected viewer so its node keeps the larger "focus" size.
  body.appendChild(buildFocusedRingSvg(rs, ringIds, names, focusedEdges, ringViewerPid, selected));
  caption.textContent = capText;
  if (selected.size > 0) appendFocusClearButton(caption, rs);
}

/**
 * Build the top + sub tab bars ONCE per render. The bars are never torn down
 * on filter clicks (rebuilding `fxs-tab-bar` mid-event swallowed pip clicks).
 * @param {RenderState} rs The render-loop state.
 */
function buildTabBars(rs) {
  const { topTabHost, subTabHost } = rs.sc;
  while (topTabHost.firstChild) topTabHost.removeChild(topTabHost.firstChild);
  const topTabs = [
    { id: "civ", label: t("LOC_DEMOGRAPHICS_RELATIONS_TAB_MAJORS") },
    { id: "cs", label: t("LOC_DEMOGRAPHICS_RELATIONS_TAB_CITY_STATES") }
  ];
  topTabHost.appendChild(
    makeTabBar(topTabs, rs.topTab, "demographics-relations-toptabs", (id) => {
      if (id === rs.topTab) return;
      rs.topTab = id;
      try {
        rs.settings?.setSetting?.("relationsTopTab", id);
      } catch (_) {
        // settings.setSetting persistence is best-effort; rs.topTab already
        // holds the live value for this session.
      }
      rs.repaint();
    })
  );
  // Sub-tab row removed - political/economic/attitude views are now overlaid
  // in a single ring; the filter pill row handles per-type toggling.
  while (subTabHost.firstChild) subTabHost.removeChild(subTabHost.firstChild);
}

/**
 * Repaint the viewer row, filter pills, body SVG, and caption. Tab bars stay
 * live across repaints.
 * @param {RenderState} rs The render-loop state.
 */
function repaintView(rs) {
  // Viewer dropdown (CS tab only). Element confirmed at
  //   core/ui/options/options-helpers.js  (fxs-dropdown attributes)
  //   core/ui/components/fxs-dropdown.js       ("dropdown-selection-change")
  //   core/ui/options/screen-options.js  (handler pattern)
  buildViewerDropdown(rs);
  // Filter pill row - one pill per relationship type. All toggles apply to
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
      // settings.getSetting(filter key) can throw at the storage boundary;
      // fall back to the all-on default set.
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
    } catch (_) {
      // settings.setSetting persistence is best-effort; the _filterSetCache
      // write above is the authoritative in-memory store.
    }
  };
}

/**
 * Build the node-focus reader for this render.
 * @returns {(top: string) => Set<number>} The reader.
 */
function makeNodeSelectionReader() {
  return (top) => {
    const s = _nodeSelectionCache.get(top);
    return s instanceof Set ? s : new Set();
  };
}

/**
 * Build the node-focus writer for this render.
 * @returns {(top: string, set: Set<number>) => void} The writer.
 */
function makeNodeSelectionWriter() {
  return (top, set) => {
    _nodeSelectionCache.set(top, new Set(set));
  };
}

/**
 * Render the Global Relations view into `host`. Clears the host, reads the
 * persisted tab/filter/viewer state, builds the scaffold + live tab bars, then
 * paints the ring. Sub-tabs (political/economic/attitude) are collapsed into a
 * single overlaid ring per top tab.
 * @param {HTMLElement} host The view host element (cleared and repopulated).
 * @param {RelationsCtx} ctx Render context (history + settings accessors).
 */
export function render(host, ctx) {
  while (host.firstChild) host.removeChild(host.firstChild);

  const settings = ctx.settings;

  // ---- read persisted state ----------------------------------------
  // Sub-tabs were collapsed into a single ring per top tab - users now see
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
    readNodeSelection: makeNodeSelectionReader(),
    writeNodeSelection: makeNodeSelectionWriter(),
    edgeCacheByTop: {
      civ: { key: "", edges: [] },
      cs: { key: "", edges: [] }
    },
    repaint: () => repaintView(rs)
  };

  try {
    buildTabBars(rs);
    rs.repaint();
    dlog("rendered relations; topTab=", rs.topTab, "met=", rs.metIds.length);
  } catch (e) {
    // Top-level guard: own-logic bugs SURFACE here (logged) without crashing
    // the game UI. Inner per-helper swallows around own logic were removed so
    // failures propagate to this single logged boundary.
    derr("render:", e);
  }
}
