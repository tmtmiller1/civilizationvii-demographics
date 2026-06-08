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

import { t } from "/demographics/ui/core/demographics-i18n.js";
import {
  dlog,
  derr
} from "/demographics/ui/screen-demographics/views/relations/relations-shared.js";
import {
  makeFilterPillRow
} from "/demographics/ui/screen-demographics/views/relations/relations-filters.js";
import { buildRingSvg } from "/demographics/ui/screen-demographics/views/relations/relations-ring-svg.js";
import {
  getLocalId,
  getMetMajorIds
} from "/demographics/ui/screen-demographics/views/relations/relations-queries.js";
import {
  buildCsNodeInfo,
  buildNameMap
} from "/demographics/ui/screen-demographics/views/relations/relations-node-info.js";
import {
  makeFilterSetReader,
  makeFilterSetWriter,
  makeNodeSelectionReader,
  makeNodeSelectionWriter,
  readCsViewerPid,
  readShowUnmetNames,
  readTopTab
} from "/demographics/ui/screen-demographics/views/relations/relations-settings.js";
import {
  applyCsEdgeOverrides,
  buildFilterDefs,
  computeCivRingData,
  computeCsRingData
} from "/demographics/ui/screen-demographics/views/relations/relations-ring-compute.js";
import {
  buildViewerDropdownPanel
} from "/demographics/ui/screen-demographics/views/relations/relations-viewer-controls.js";

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

// ---- DOM builders ---------------------------------------------------------

/**
 * Build an `fxs-tab-bar` element wired to `onSelect`.
 * @param {{ id: string, label: string }[]} tabs Tab descriptors.
 * @param {string} activeKey Currently-selected tab id.
 * @param {string} className Extra class name.
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

// ---- main render ----------------------------------------------------------

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
  // Body is the ring's container. Repaints wipe ALL its children, so the filter
  // legend must NOT live inside it - filterHost stays a sibling and the CSS
  // positions it absolutely over the body's top-right corner.
  const wrap = addChild(host, "demographics-relations-wrap");
  const topTabHost = addChild(wrap, "demographics-relations-toptab-host");
  const subTabHost = addChild(wrap, "demographics-relations-subtab-host");
  // CS viewer dropdown host (only populated when topTab === "cs").
  const viewerHost = addChild(wrap, "demographics-relations-viewer-host");
  const body = addChild(wrap, "demographics-relations-body");
  const filterHost = addChild(wrap, "demographics-relations-filter-host");
  const caption = addChild(wrap, "demographics-relations-caption font-body text-xs");
  return { topTabHost, subTabHost, viewerHost, body, filterHost, caption };
}

/**
 * Create a `<div>` with a class, append it to `parent`, and return it.
 * @param {HTMLElement} parent The parent element.
 * @param {string} className The class string.
 * @returns {HTMLElement} The created child.
 */
function addChild(parent, className) {
  const el = document.createElement("div");
  el.className = className;
  parent.appendChild(el);
  return el;
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
 * @property {(id: number, viewerPid: number, showUnmetNames: boolean,
 *   localId: number|undefined, history: DemoHistory|undefined) => NodeInfo}
 *   buildCsNodeInfo
 *   CS node-info builder callback.
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
 * Compute the ring node set, edges, names, and caption for the active view.
 * @param {RenderState} rs The render-loop state.
 * @param {Set<string>} activeSet Active filter keys.
 * @returns {{ ringIds: number[], edges: Edge[],
 *   names: Record<string, NodeInfo>, capText: string,
 *   ringViewerPid: number|undefined }}
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
 * @param {{viewerPid: number | undefined, selected: Set<number>}} opts
 *   Ring viewer pid (defaults to local) + the active focus set.
 * @returns {HTMLElement} The ring wrap element.
 */
function buildFocusedRingSvg(rs, ringIds, names, focusedEdges, opts) {
  return buildRingSvg(
    ringIds,
    names,
    focusedEdges,
    /** @type {number} */ (rs.localId),
    {
      viewerPid: opts.viewerPid,
      selectedNodeIds: opts.selected,
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
    appendObserverEmpty(body);
    return;
  }

  const { ringIds, edges, names, capText: baseCapText, ringViewerPid } = computeRingData(
    rs,
    activeSet
  );
  let capText = baseCapText;

  // Apply per-topTab visual overrides to edges (CS tab uses a different
  // color/dash vocabulary). Edits are non-destructive.
  if (rs.topTab === "cs") applyCsEdgeOverrides(edges);

  // Node-focus filter: click one or more ring nodes to show only their edges.
  const { selected, focusedEdges } = resolveFocus(rs, edges, ringIds);

  if (selected.size > 0) {
    capText += "  " +
      "(" + selected.size + " focus" + (selected.size === 1 ? "" : "es") +
      "; click icons to toggle)";
  }

  // Civ-tab always uses the local player as the viewer; CS-tab uses the
  // selected viewer so its node keeps the larger "focus" size.
  body.appendChild(
    buildFocusedRingSvg(rs, ringIds, names, focusedEdges, { viewerPid: ringViewerPid, selected })
  );
  caption.textContent = capText;
  if (selected.size > 0) appendFocusClearButton(caption, rs);
}

/**
 * Append the "no local observer" empty-state notice to the ring body.
 * @param {HTMLElement} body The ring body element.
 */
function appendObserverEmpty(body) {
  const empty = document.createElement("div");
  empty.className = "demographics-empty font-body text-base";
  empty.textContent = t("LOC_DEMOGRAPHICS_EMPTY_OBSERVER");
  body.appendChild(empty);
}

/**
 * Resolve the node-focus selection (pruned to the ring) and the edges filtered
 * to it. Empty selection ⇒ all edges.
 * @param {RenderState} rs The render-loop state.
 * @param {*[]} edges The computed edges.
 * @param {number[]} ringIds The ring node ids.
 * @returns {{ selected: Set<number>, focusedEdges: *[] }} Selection + filtered edges.
 */
function resolveFocus(rs, edges, ringIds) {
  const selectedRaw = rs.readNodeSelection(rs.topTab);
  const selected = pruneSelectionToRing(selectedRaw, ringIds);
  if (selected.size !== selectedRaw.size) rs.writeNodeSelection(rs.topTab, selected);
  return { selected, focusedEdges: filterEdgesBySelectedNodes(edges, selected) };
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
  buildViewerDropdownPanel(rs);
  // Filter pill row - one pill per relationship type. All toggles apply to
  // the same ring; no subtab indirection.
  buildFilterRow(rs, buildFilterDefs(rs.topTab));
  // Body: ring SVG + caption.
  renderRingBody(rs);
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
    buildCsNodeInfo,
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
