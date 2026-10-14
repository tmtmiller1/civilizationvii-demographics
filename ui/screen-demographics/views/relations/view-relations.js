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
// The ring renderer (relations-ring-svg.js), edge builders (relations-edges.js),
// filter pills (relations-filters.js) and shared helpers (relations-shared.js)
// live in sibling modules.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { toLocalPx } from "/demographics/ui/core/demographics-font-ladder.js";
import { log } from "/demographics/ui/screen-demographics/views/relations/relations-shared.js";
import {
  FILTER_GROUPS,
  makeFilterPillRow
} from "/demographics/ui/screen-demographics/views/relations/relations-filters.js";
import { safePlaySound } from "/demographics/ui/core/demographics-audio.js";
import { pillRow } from "/demographics/ui/screen-demographics/views/shared/view-pills.js";
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
  resetRelationsCachesIfGameChanged,
  writeActiveSubGroup
} from "/demographics/ui/screen-demographics/views/relations/relations-settings.js";
import {
  applyCivEdgeOverrides,
  applyCsEdgeOverrides,
  buildFilterDefs,
  computeCivRingData,
  computeCsRingData
} from "/demographics/ui/screen-demographics/views/relations/relations-ring-compute.js";
import {
  buildViewerDropdownPanel
} from "/demographics/ui/screen-demographics/views/relations/relations-viewer-controls.js";
import { measureRect } from "/demographics/ui/screen-demographics/screen/dom-helpers.js";

/**
 * One relationship edge between two ring nodes. `a`/`b` are player ids; the
 * remaining fields are visual hints consumed by the ring renderer.
 * @typedef {Object} Edge
 * @property {number} a Source player id.
 * @property {number} b Target player id.
 * @property {string} [color] Stroke color (hex or rgba).
 * @property {string} [label] Optional human-readable edge label.
 * @property {string} [filterKey] Filter category this edge belongs to.
 * @property {boolean} [dashed] Dashed-line flag, set directly by suzerain edges.
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

// DOM builders

/**
 * @param {{ id: string, label: string }[]} tabs
 * @param {string} activeKey
 * @param {string} className
 * @param {(id: string) => void} onSelect
 */
function makeTabBar(tabs, activeKey, className, onSelect) {
  const bar = document.createElement("fxs-tab-bar");
  bar.classList.add(className, "w-full", "font-title", "text-sm");
  bar.setAttribute("data-audio-group-ref", "audio-screen-unlocks");
  bar.setAttribute("tab-item-class", "font-title text-base");
  bar.setAttribute("tab-items", JSON.stringify(tabs));
  const selectedIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === activeKey)
  );
  bar.setAttribute("selected-tab-index", String(selectedIndex));
  bar.addEventListener("tab-selected", (event) => {
    const id = /** @type {*} */ (event)?.detail?.selectedItem?.id;
    if (!id) return;
    onSelect(id);
  });
  return bar;
}

// main render

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

/** @param {HTMLElement} host */
function buildScaffold(host) {
  // Body is the ring's container. Repaints wipe all its children, so the filter
  // legend can't live inside it: filterHost stays a sibling and the CSS
  // positions it absolutely over the body's top-right corner.
  const wrap = addChild(host, "demographics-relations-wrap");
  const topTabHost = addChild(wrap, "demographics-relations-toptab-host");
  const subTabHost = addChild(wrap, "demographics-relations-subtab-host");
  // The Options button lives in the frame header (screen-demographics.js), so there is no toolbar
  // row here; the viewer/legend overlays are anchored by measurement.
  // CS viewer dropdown host (only populated when topTab === "cs").
  const viewerHost = addChild(wrap, "demographics-relations-viewer-host");
  const body = addChild(wrap, "demographics-relations-body");
  const filterHost = addChild(wrap, "demographics-relations-filter-host");
  const caption = addChild(wrap, "demographics-relations-caption font-body text-xs");
  return { topTabHost, subTabHost, viewerHost, body, filterHost, caption };
}

/**
 * @param {HTMLElement} parent
 * @param {string} className
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
 * @property {string} activeSubGroup Active filter sub-group ("politics"/"reputation"/"agreements").
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
 * @property {() => void} repaintRing Ring-body-only repaint (node-focus toggles).
 * @property {Map<string, HTMLElement>} portraitCache Leader-portrait / node-label overlays, reused
 *   across repaints. The ring is redrawn on every filter toggle, but the node set is independent
 *   of the filters (only the EDGES are filtered), so re-creating the portraits meant every one of
 *   them blinked while its `fxs-icon` art resolved again. Lives on the render state, which is also
 *   what the overlays' click handlers close over, so the two can never disagree.
 */

/**
 * @param {Set<number>} selected
 * @param {number[]} ringIds
 * @returns {Set<number>}
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
 * @param {Edge[]} edges
 * @param {Set<number>} selected
 */
function filterEdgesBySelectedNodes(edges, selected) {
  if (!(selected instanceof Set) || selected.size === 0) return edges;
  return edges.filter((edge) => selected.has(edge.a) || selected.has(edge.b));
}

/**
 * @param {RenderState} renderState
 * @returns {FilterDef[]}
 */
function visibleGroupDefs(renderState) {
  return buildFilterDefs(renderState.topTab).filter((def) => def.group === renderState.activeSubGroup);
}

/**
 * @param {RenderState} renderState
 * @returns {Set<string>}
 */
function effectiveActiveSet(renderState) {
  const activeSet = renderState.readFilterSet(renderState.topTab);
  const groupKeys = new Set(visibleGroupDefs(renderState).map((def) => def.key));
  const out = new Set();
  for (const key of activeSet) if (groupKeys.has(key)) out.add(key);
  return out;
}

/** @param {RenderState} renderState */
function buildSubGroupChips(renderState) {
  const { subTabHost } = renderState.sc;
  while (subTabHost.firstChild) subTabHost.removeChild(subTabHost.firstChild);
  // Use the shared metric-pill selector (rounded gold pills), matching the pill row on every
  // other tab, rather than the flat time-filter chip look.
  const items = FILTER_GROUPS.map((group) => ({ key: group.key, label: t(group.label) }));
  const row = pillRow(items, renderState.activeSubGroup, (/** @type {string} */ key) => {
    renderState.activeSubGroup = key;
    writeActiveSubGroup(renderState.settings, key);
    safePlaySound("data-audio-activate", "audio-panel-diplo-ribbon");
    renderState.repaint();
  });
  row.classList.add("demographics-relations-subgroup-row");
  subTabHost.appendChild(row);
}

/** @param {RenderState} renderState */
function buildFilterRow(renderState) {
  const { filterHost } = renderState.sc;
  while (filterHost.firstChild) filterHost.removeChild(filterHost.firstChild);

  const title = document.createElement("div");
  title.className = "demographics-relations-filter-title font-title text-xs";
  const group = FILTER_GROUPS.find((filterGroup) => filterGroup.key === renderState.activeSubGroup);
  title.textContent = group ? t(group.label) : "";
  filterHost.appendChild(title);

  const defs = visibleGroupDefs(renderState);
  const activeSet = renderState.readFilterSet(renderState.topTab);
  filterHost.appendChild(
    makeFilterPillRow(
      defs,
      activeSet,
      (key) => {
        const filterSet = renderState.readFilterSet(renderState.topTab);
        if (filterSet.has(key)) filterSet.delete(key);
        else filterSet.add(key);
        renderState.writeFilterSet(renderState.topTab, filterSet);
        renderState.repaint();
      },
      (turnOn) => {
        // Bulk-toggle only the visible sub-group's filters.
        const filterSet = renderState.readFilterSet(renderState.topTab);
        for (const def of defs) {
          if (turnOn) filterSet.add(def.key);
          else filterSet.delete(def.key);
        }
        renderState.writeFilterSet(renderState.topTab, filterSet);
        renderState.repaint();
      }
    )
  );
}

/**
 * @param {RenderState} renderState
 * @param {Set<string>} activeSet
 * @returns {{ ringIds: number[], edges: Edge[],
 *   names: Record<string, NodeInfo>, capText: string,
 *   ringViewerPid: number|undefined }}
 */
function computeRingData(renderState, activeSet) {
  /** @type {Record<string, NodeInfo>} */
  const names = Object.assign({}, renderState.namesBase);
  if (renderState.topTab === "civ") return computeCivRingData(renderState, activeSet, names);
  return computeCsRingData(renderState, activeSet, names);
}

/**
 * @param {RenderState} renderState
 * @param {number[]} ringIds
 * @param {Record<string, *>} names
 * @param {*[]} focusedEdges
 * @param {{viewerPid: number | undefined, selected: Set<number>}} opts
 *   Ring viewer pid (defaults to local) + the active focus set.
 */
function buildFocusedRingSvg(renderState, ringIds, names, focusedEdges, opts) {
  return buildRingSvg(
    ringIds,
    names,
    focusedEdges,
    /** @type {number} */ (renderState.localId),
    {
      viewerPid: opts.viewerPid,
      selectedNodeIds: opts.selected,
      portraitCache: renderState.portraitCache,
      onNodeToggle: (pid) => {
        const selection = renderState.readNodeSelection(renderState.topTab);
        if (selection.has(pid)) selection.delete(pid);
        else selection.add(pid);
        renderState.writeNodeSelection(renderState.topTab, selection);
        renderState.repaintRing();
      }
    }
  );
}

/**
 * @param {HTMLElement} caption
 * @param {RenderState} renderState
 */
function appendFocusClearButton(caption, renderState) {
  const spacer = document.createElement("span");
  spacer.textContent = "   ";
  caption.appendChild(spacer);

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "demographics-relations-clear-focus-btn font-body text-xs";
  clearBtn.textContent = t("LOC_DEMOGRAPHICS_CLEAR_FOCUS");
  clearBtn.addEventListener("click", () => {
    renderState.writeNodeSelection(renderState.topTab, new Set());
    renderState.repaintRing();
  });
  caption.appendChild(clearBtn);
}

/**
 * Tag each edge with its relationship-type label (from the filter definitions) so
 * the ring's hover tooltip can name the line.
 * @param {Edge[]} edges
 * @param {string} topTab "civ" or "cs".
 */
function tagEdgeTypeLabels(edges, topTab) {
  /** @type {Map<string, string>} */
  const labels = new Map();
  for (const def of buildFilterDefs(topTab)) labels.set(def.key, def.label);
  for (const edge of edges) {
    /** @type {*} */ (edge)._typeLabel = (edge.filterKey && labels.get(edge.filterKey)) || "";
  }
}

/** @param {RenderState} renderState */
function renderRingBody(renderState) {
  const { body, caption } = renderState.sc;
  // Scope the ring to the active sub-group: only filter keys in the selected
  // group (Politics / Reputation / Agreements) that are also toggled on.
  const effectiveSet = effectiveActiveSet(renderState);

  // The previous ring wrap is about to be removed; forget it so the resize hook
  // never re-fits an orphan (mountRing re-tracks the new wrap below).
  activeRingWrap = null;
  while (body.firstChild) body.removeChild(body.firstChild);
  while (caption.firstChild) caption.removeChild(caption.firstChild);

  if (typeof renderState.localId !== "number") {
    appendObserverEmpty(body);
    return;
  }

  const { ringIds, edges, names, capText: baseCapText, ringViewerPid } = computeRingData(
    renderState,
    effectiveSet
  );
  let capText = baseCapText;

  // Align edge colors with the filter-pill legend so each line's color tells you
  // which filter owns it. CS uses its own color/dash vocabulary; the civ tab
  // collapses the diplomacy-event per-action colors onto the pill color.
  if (renderState.topTab === "cs") applyCsEdgeOverrides(edges);
  else applyCivEdgeOverrides(edges);

  // Tag each edge with its human-readable relationship type for the hover tooltip.
  tagEdgeTypeLabels(edges, renderState.topTab);

  // Node-focus filter: click one or more ring nodes to show only their edges.
  const { selected, focusedEdges } = resolveFocus(renderState, edges, ringIds);

  if (selected.size > 0) {
    capText += "  " + t("LOC_DEMOGRAPHICS_RELATIONS_FOCUS_HINT", selected.size);
  }

  // Civ-tab always uses the local player as the viewer; CS-tab uses the
  // selected viewer so its node keeps the larger "focus" size.
  mountRing(body, buildFocusedRingSvg(renderState, ringIds, names, focusedEdges, {
    viewerPid: ringViewerPid,
    selected
  }));
  caption.textContent = capText;
  if (selected.size > 0) appendFocusClearButton(caption, renderState);
}

// The most-recently mounted ring wrap + live render state, plus a one-time
// window-resize hook that re-fits the diagram and re-anchors the overlays. A
// single module-level listener avoids leaks across ring repaints; it no-ops once
// the wrap detaches.
/** @type {HTMLElement|null} */
let activeRingWrap = null;
/** @type {RenderState|null} */
let activeRenderState = null;
let resizeReflowWired = false;

/**
 * Drop the module-level references to the last-rendered ring wrap and render
 * state, so the window-resize hook stops re-fitting a detached scaffold.
 */
export function releaseRelationsView() {
  activeRingWrap = null;
  activeRenderState = null;
}

/**
 * Whether the tracked ring wrap / scaffold body has been detached from the DOM
 * (the screen closed or the host was rebuilt). Only an explicit `false` counts,
 * so an engine without `isConnected` keeps the resize re-fit alive.
 * @returns {boolean}
 */
function relationsViewDetached() {
  const wrap = activeRingWrap;
  if (wrap && wrap.isConnected === false) return true;
  const body = activeRenderState && activeRenderState.sc && activeRenderState.sc.body;
  return !!body && body.isConnected === false;
}

/** @param {RenderState} renderState */
function relationsOverlayMetrics(renderState) {
  const scaffold = renderState && renderState.sc;
  if (!scaffold || !scaffold.body) return null;
  const body = scaffold.body;
  const wrap = body.parentElement;
  if (!wrap) return null;
  const wrapRect = measureRect(wrap);
  const bodyRect = measureRect(body);
  if (!wrapRect || !bodyRect || bodyRect.height === 0) return null;
  return { sc: scaffold, wrapRect, bodyRect };
}

/**
 * @param {HTMLElement|undefined} el
 * @param {number} topPx
 */
function setOverlayTop(el, topPx) {
  if (el && el.style) el.style.top = topPx + "px";
}

/**
 * Pin the absolutely-positioned Relations overlays (the filter legend and the CS
 * "viewer" dropdown) to the top of the ring body, measured at runtime because the
 * tab + toolbar chrome scales with Interface Size. Also caps the legend's height
 * to the body so it cannot spill past it.
 * @param {RenderState} renderState
 */
function anchorRelationsOverlays(renderState) {
  const metrics = relationsOverlayMetrics(renderState);
  if (!metrics) return;
  const { sc: scaffold, wrapRect, bodyRect } = metrics;
  // A small inset so the overlay sits just inside the panel corner, not straddling
  // the body's top border.
  const inset = 4;
  // Rects are VISUAL px; `top` is written in the frame's LOCAL px (see demographics-font-ladder.js).
  const overlayTop = Math.max(0, Math.round(toLocalPx(bodyRect.top - wrapRect.top))) + inset;
  setOverlayTop(scaffold.filterHost, overlayTop);
  setOverlayTop(scaffold.viewerHost, overlayTop);
  // Cap the legend to the body height (it scrolls internally past that) so a tall
  // legend at a large Interface Size never extends below the ring panel.
  const maxHeight = Math.max(0, Math.round(toLocalPx(bodyRect.height) - inset * 2));
  if (scaffold.filterHost && scaffold.filterHost.style && maxHeight > 0) {
    scaffold.filterHost.style.maxHeight = maxHeight + "px";
  }
}

/**
 * Install the one-time window-resize → re-fit hook (idempotent). rAF-debounced so
 * a resize drag coalesces to one re-layout per frame. Re-fits the ring and
 * re-anchors the overlays against the new layout.
 */
function ensureResizeReflow() {
  if (resizeReflowWired) return;
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  resizeReflowWired = true;
  let scheduled = false;
  const run = () => {
    scheduled = false;
    // The screen closed (or the host was rebuilt) since the last paint: drop the
    // stale references and skip the re-fit entirely rather than measuring an
    // orphaned scaffold on every resize for the rest of the session.
    if (relationsViewDetached()) {
      releaseRelationsView();
      return;
    }
    try {
      const wrap = activeRingWrap;
      const place = wrap ? /** @type {*} */ (wrap).__placePortraits : null;
      if (typeof place === "function") place();
      if (activeRenderState) anchorRelationsOverlays(activeRenderState);
    } catch (e) {
      // rAF callback off the engine's resize event: log, never throw into it.
      log.error("resize reflow:", e);
    }
  };
  window.addEventListener("resize", () => {
    if (scheduled) return;
    scheduled = true;
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else setTimeout(run, 16);
  });
}

/** @param {RenderState} renderState */
function scheduleOverlayAnchor(renderState) {
  let tries = 0;
  const MAX_TRIES = 120; // ~2s at 60fps; a body unlaid by then isn't going to lay out
  const defer = (/** @type {() => void} */ fn) =>
    typeof requestAnimationFrame === "function" ? requestAnimationFrame(fn) : setTimeout(fn, 16);
  const run = () => {
    const body = renderState && renderState.sc && renderState.sc.body;
    // A body that left the DOM (screen closed mid-retry) is never going to lay out.
    if (body && body.isConnected === false) return;
    const rect = measureRect(body);
    if ((!rect || rect.height === 0) && ++tries <= MAX_TRIES) {
      defer(run);
      return;
    }
    anchorRelationsOverlays(renderState);
  };
  defer(run);
}

/**
 * Mount a ring wrap into the body and immediately place its portrait/label
 * overlays (the wrap must be in the DOM first so they can measure), so they
 * paint with the SVG rather than a frame later (avoids click flicker).
 * @param {HTMLElement} body
 * @param {HTMLElement} ringWrap
 */
function mountRing(body, ringWrap) {
  body.appendChild(ringWrap);
  // Track the live wrap so the resize hook re-fits THIS ring (not an orphan).
  activeRingWrap = ringWrap;
  ensureResizeReflow();
  const place = /** @type {*} */ (ringWrap).__placePortraits;
  if (typeof place === "function") place();
}

/** @param {HTMLElement} body */
function appendObserverEmpty(body) {
  const empty = document.createElement("div");
  empty.className = "demographics-empty font-body text-base";
  empty.textContent = t("LOC_DEMOGRAPHICS_EMPTY_OBSERVER");
  body.appendChild(empty);
}

/**
 * @param {RenderState} renderState
 * @param {*[]} edges
 * @param {number[]} ringIds
 */
function resolveFocus(renderState, edges, ringIds) {
  const selectedRaw = renderState.readNodeSelection(renderState.topTab);
  const selected = pruneSelectionToRing(selectedRaw, ringIds);
  if (selected.size !== selectedRaw.size) renderState.writeNodeSelection(renderState.topTab, selected);
  return { selected, focusedEdges: filterEdgesBySelectedNodes(edges, selected) };
}

/**
 * Build the top + sub tab bars once per render. The bars are never torn down
 * on filter clicks (rebuilding `fxs-tab-bar` mid-event swallowed pip clicks).
 * @param {RenderState} renderState
 */
function buildTabBars(renderState) {
  const { topTabHost, subTabHost } = renderState.sc;
  while (topTabHost.firstChild) topTabHost.removeChild(topTabHost.firstChild);
  const topTabs = [
    { id: "civ", label: t("LOC_DEMOGRAPHICS_RELATIONS_TAB_MAJORS") },
    { id: "cs", label: t("LOC_DEMOGRAPHICS_RELATIONS_TAB_CITY_STATES") }
  ];
  topTabHost.appendChild(
    makeTabBar(topTabs, renderState.topTab, "demographics-relations-toptabs", (id) => {
      if (id === renderState.topTab) return;
      renderState.topTab = id;
      try {
        renderState.settings?.setSetting?.("relationsTopTab", id);
      } catch (_) {
        // settings.setSetting persistence is best-effort; renderState.topTab already
        // holds the live value for this session.
      }
      renderState.repaint();
    })
  );
  // Political/economic/attitude views share one overlaid ring, so the sub-tab host
  // stays empty; the filter pill row handles per-type toggling.
  while (subTabHost.firstChild) subTabHost.removeChild(subTabHost.firstChild);
}

/**
 * Tab bars stay live across repaints.
 * @param {RenderState} renderState
 */
function repaintView(renderState) {
  // Viewer dropdown (CS tab only); fxs-dropdown fires "dropdown-selection-change".
  buildViewerDropdownPanel(renderState);
  // Politics / Reputation / Agreements sub-tab chips (which group is shown).
  buildSubGroupChips(renderState);
  // Filter pill row - one pill per type within the active sub-group.
  buildFilterRow(renderState);
  // Body: ring SVG + caption.
  renderRingBody(renderState);
  // Pin the absolutely-positioned legend/viewer overlays to the measured top of
  // the body (their top offset must track the tab/toolbar chrome height, which
  // scales with Interface Size), and register this state for the resize re-anchor.
  activeRenderState = renderState;
  scheduleOverlayAnchor(renderState);
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
  try {
    // The whole body (state prologue included) sits inside this one boundary so
    // an engine-query throw in the prologue cannot blank the panel.
    const renderState = buildRenderState(host, ctx);
    buildTabBars(renderState);
    // First paint runs UNguarded so a failure reaches this catch and shows the
    // fallback; the renderState.repaint wrappers guard the later handler-driven repaints.
    repaintView(renderState);
    log.debug("rendered relations; topTab=", renderState.topTab, "met=", renderState.metIds.length);
  } catch (e) {
    // Top-level guard: own-logic bugs SURFACE here (logged) without crashing
    // the game UI. Own-logic helpers do not swallow errors, so failures
    // propagate to this single logged boundary.
    log.error("render:", e);
    appendRenderFailed(host);
  }
}

/**
 * Read the persisted tab/filter/viewer state, build the scaffold, and assemble
 * the render-loop state for one {@link render}, inside render's try boundary.
 * @param {HTMLElement} host The (already cleared) view host element.
 * @param {RelationsCtx} ctx Render context (history + settings accessors).
 * @returns {RenderState}
 */
function buildRenderState(host, ctx) {
  // Drop in-memory filter/node-focus caches when the game/save changed, so a
  // new game does not inherit the previous game's filters or stale node pids.
  resetRelationsCachesIfGameChanged();

  const settings = ctx.settings;

  // initial tab state
  // Every fresh open starts at the leftmost tab in each set (top tab "civ",
  // sub-group FILTER_GROUPS[0]); persisted values still update within a session.
  const topTab = "civ";
  const localId = getLocalId();
  const namesBase = buildNameMap(ctx.history);
  const metIds = typeof localId === "number" ? getMetMajorIds(localId) : [];
  // Global "show unmet names" toggle. Default false → unmet civs/CSes
  // render as generic placeholders.
  const showUnmetNames = readShowUnmetNames(settings);
  const csViewerPid = readCsViewerPid(settings, localId, metIds);

  const scaffold = buildScaffold(host);

  /** @type {RenderState} */
  const renderState = {
    ctx,
    settings,
    sc: scaffold,
    localId,
    metIds,
    namesBase,
    showUnmetNames,
    topTab,
    activeSubGroup: FILTER_GROUPS[0].key,
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
    // Every click / toggle / dropdown handler repaints through these two, so a
    // throw in a sub-renderer is logged here instead of escaping to the engine's
    // event dispatcher.
    repaint: () => guardedPaint("repaint", () => repaintView(renderState)),
    // Ring-only repaint for node focus toggles: rebuilds just the ring body (not
    // the filter pills / viewer dropdown), so clicking an icon doesn't flicker
    // the whole panel.
    repaintRing: () => guardedPaint("repaintRing", () => renderRingBody(renderState)),
    portraitCache: new Map()
  };
  return renderState;
}

/**
 * Run a repaint body behind a logged boundary (see the `repaint` / `repaintRing`
 * fields on {@link RenderState}).
 * @param {string} label
 * @param {() => void} fn
 */
function guardedPaint(label, fn) {
  try {
    fn();
  } catch (e) {
    log.error(label + ":", e);
  }
}

/**
 * Append the standard "render failed, see UI.log" empty-state notice to the host
 * (same class + text the chart views use), so a failed render leaves a visible
 * message rather than a blank panel. Must never throw: it runs inside a catch.
 * @param {HTMLElement} host The view host element.
 */
function appendRenderFailed(host) {
  try {
    const empty = document.createElement("div");
    empty.className = "demographics-empty font-body text-base";
    empty.textContent = t("LOC_DEMOGRAPHICS_EMPTY_CHART_RENDER_FAILED");
    host.appendChild(empty);
  } catch (e) {
    // The DOM itself is unusable here; the render error is already logged.
    log.error("render fallback:", e);
  }
}
