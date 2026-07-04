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
  FILTER_GROUPS,
  makeFilterPillRow
} from "/demographics/ui/screen-demographics/views/relations/relations-filters.js";
import { safePlaySound } from "/demographics/ui/core/demographics-audio.js";
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
import { buildOptionsButton } from "/demographics/ui/screen-demographics/views/shared/options-button.js";

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
  // Options button in a right-aligned toolbar row directly BELOW the sub-tabs, same structure and
  // position as the Historical Data tabs. (The absolutely-anchored viewer/legend offsets below are
  // bumped to clear this extra row.)
  const optBar = addChild(wrap, "demographics-chart-toolbar");
  optBar.appendChild(buildOptionsButton());
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
 * The filter descriptors for the active sub-group (Politics / Reputation /
 * Agreements) on the current top tab.
 * @param {RenderState} rs The render-loop state.
 * @returns {FilterDef[]} Visible-group filter descriptors.
 */
function visibleGroupDefs(rs) {
  return buildFilterDefs(rs.topTab).filter((f) => f.group === rs.activeSubGroup);
}

/**
 * The active filter set restricted to the visible sub-group's keys, so the ring
 * shows only that group's toggled-on edges.
 * @param {RenderState} rs The render-loop state.
 * @returns {Set<string>} The group-scoped active set.
 */
function effectiveActiveSet(rs) {
  const activeSet = rs.readFilterSet(rs.topTab);
  const groupKeys = new Set(visibleGroupDefs(rs).map((f) => f.key));
  const out = new Set();
  for (const k of activeSet) if (groupKeys.has(k)) out.add(k);
  return out;
}

/**
 * Build the Politics / Reputation / Agreements sub-tab chip row into the sub-tab
 * host (mirrors the settlements All/Cities/Towns control). Selecting a chip swaps
 * which group's pills + lines are shown.
 * @param {RenderState} rs The render-loop state.
 */
function buildSubGroupChips(rs) {
  const { subTabHost } = rs.sc;
  while (subTabHost.firstChild) subTabHost.removeChild(subTabHost.firstChild);
  const row = document.createElement("div");
  row.className = "demographics-relations-subgroup-row";
  for (const group of FILTER_GROUPS) {
    const chip = document.createElement("div");
    chip.className =
      "demographics-chart-time-filter-pill" +
      (rs.activeSubGroup === group.key ? " is-active" : "");
    chip.textContent = t(group.label);
    chip.addEventListener("click", () => {
      if (rs.activeSubGroup === group.key) return;
      rs.activeSubGroup = group.key;
      writeActiveSubGroup(rs.settings, group.key);
      safePlaySound("data-audio-activate", "audio-panel-diplo-ribbon");
      rs.repaint();
    });
    row.appendChild(chip);
  }
  subTabHost.appendChild(row);
}

/**
 * Build the filter-pill row for the active sub-group into the filter host, wiring
 * per-pill and group "All On/Off" toggles to update the filter set and repaint.
 * @param {RenderState} rs The render-loop state.
 */
function buildFilterRow(rs) {
  const { filterHost } = rs.sc;
  while (filterHost.firstChild) filterHost.removeChild(filterHost.firstChild);

  const title = document.createElement("div");
  title.className = "demographics-relations-filter-title font-title text-xs";
  const group = FILTER_GROUPS.find((g) => g.key === rs.activeSubGroup);
  title.textContent = group ? t(group.label) : "";
  filterHost.appendChild(title);

  const defs = visibleGroupDefs(rs);
  const activeSet = rs.readFilterSet(rs.topTab);
  filterHost.appendChild(
    makeFilterPillRow(
      defs,
      activeSet,
      (key) => {
        const cur = rs.readFilterSet(rs.topTab);
        if (cur.has(key)) cur.delete(key);
        else cur.add(key);
        rs.writeFilterSet(rs.topTab, cur);
        rs.repaint();
      },
      (turnOn) => {
        // Bulk-toggle only the visible sub-group's filters.
        const cur = rs.readFilterSet(rs.topTab);
        for (const f of defs) {
          if (turnOn) cur.add(f.key);
          else cur.delete(f.key);
        }
        rs.writeFilterSet(rs.topTab, cur);
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
        rs.repaintRing();
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
  clearBtn.textContent = t("LOC_DEMOGRAPHICS_CLEAR_FOCUS");
  clearBtn.addEventListener("click", () => {
    rs.writeNodeSelection(rs.topTab, new Set());
    rs.repaintRing();
  });
  caption.appendChild(clearBtn);
}

/**
 * Tag each edge with its relationship-type label (from the filter definitions) so
 * the ring's hover tooltip can name the line.
 * @param {Edge[]} edges The edges to tag.
 * @param {string} topTab The active top tab ("civ"/"cs").
 */
function tagEdgeTypeLabels(edges, topTab) {
  /** @type {Map<string, string>} */
  const labels = new Map();
  for (const f of buildFilterDefs(topTab)) labels.set(f.key, f.label);
  for (const e of edges) {
    /** @type {*} */ (e)._typeLabel = (e.filterKey && labels.get(e.filterKey)) || "";
  }
}

/**
 * Render the ring body + caption from computed ring data.
 * @param {RenderState} rs The render-loop state.
 */
function renderRingBody(rs) {
  const { body, caption } = rs.sc;
  // Scope the ring to the active sub-group: only filter keys in the selected
  // group (Politics / Reputation / Agreements) that are also toggled on.
  const effectiveSet = effectiveActiveSet(rs);

  while (body.firstChild) body.removeChild(body.firstChild);
  while (caption.firstChild) caption.removeChild(caption.firstChild);

  if (typeof rs.localId !== "number") {
    appendObserverEmpty(body);
    return;
  }

  const { ringIds, edges, names, capText: baseCapText, ringViewerPid } = computeRingData(
    rs,
    effectiveSet
  );
  let capText = baseCapText;

  // Align edge colors with the filter-pill legend so each line's color tells you
  // which filter owns it. CS uses its own color/dash vocabulary; the civ tab
  // collapses the diplomacy-event per-action colors onto the pill color.
  if (rs.topTab === "cs") applyCsEdgeOverrides(edges);
  else applyCivEdgeOverrides(edges);

  // Tag each edge with its human-readable relationship type for the hover tooltip.
  tagEdgeTypeLabels(edges, rs.topTab);

  // Node-focus filter: click one or more ring nodes to show only their edges.
  const { selected, focusedEdges } = resolveFocus(rs, edges, ringIds);

  if (selected.size > 0) {
    capText += "  " + t("LOC_DEMOGRAPHICS_RELATIONS_FOCUS_HINT", selected.size);
  }

  // Civ-tab always uses the local player as the viewer; CS-tab uses the
  // selected viewer so its node keeps the larger "focus" size.
  mountRing(body, buildFocusedRingSvg(rs, ringIds, names, focusedEdges, {
    viewerPid: ringViewerPid,
    selected
  }));
  caption.textContent = capText;
  if (selected.size > 0) appendFocusClearButton(caption, rs);
}

// The most-recently mounted ring wrap + the live render state, plus a one-time
// window-resize hook that re-fits the diagram AND re-anchors the absolutely-
// positioned overlays. The ring's placement routine re-measures the on-screen
// budget and re-caps the diagram every time it runs (see relations-ring-svg.js),
// so a resolution / window / Interface-Size change after the screen is open
// re-fits dynamically. A SINGLE module-level listener (rather than one per wrap)
// avoids leaks across the frequent ring repaints; it no-ops once the wrap detaches.
/** @type {HTMLElement|null} */
let activeRingWrap = null;
/** @type {RenderState|null} */
let activeRelationsRs = null;
let resizeReflowWired = false;

/**
 * Resolve the measured rects needed to anchor the Relations overlays, or null if
 * the body isn't laid out yet (so callers bail cleanly).
 * @param {RenderState} rs The render-loop state.
 * @returns {{ sc: RelationsScaffold, wrapRect: DOMRect, bodyRect: DOMRect }|null} Metrics or null.
 */
function relationsOverlayMetrics(rs) {
  const sc = rs && rs.sc;
  if (!sc || !sc.body) return null;
  const body = sc.body;
  const wrap = body.parentElement;
  if (!wrap || typeof body.getBoundingClientRect !== "function") return null;
  const wrapRect = wrap.getBoundingClientRect();
  const bodyRect = body.getBoundingClientRect();
  if (!wrapRect || !bodyRect || bodyRect.height === 0) return null;
  return { sc, wrapRect, bodyRect };
}

/**
 * Set an overlay element's inline `top` in px (no-op when absent).
 * @param {HTMLElement|undefined} el The overlay element.
 * @param {number} topPx Top offset in px.
 */
function setOverlayTop(el, topPx) {
  if (el && el.style) el.style.top = topPx + "px";
}

/**
 * Pin the absolutely-positioned Relations overlays (the filter legend and the CS
 * "viewer" dropdown) to the TOP of the ring body, MEASURED at runtime. They were
 * anchored at a hardcoded `top: 9.5rem` chosen to clear the tab + toolbar chrome,
 * but that chrome's height scales with Interface Size, so at larger sizes the
 * fixed offset stopped clearing it and the legend overlapped the tabs. Measuring
 * the body's real top keeps both overlays in the ring's empty top corners at any
 * size, and caps the legend's height to the body so it can never spill past it.
 * @param {RenderState} rs The render-loop state.
 */
function anchorRelationsOverlays(rs) {
  const m = relationsOverlayMetrics(rs);
  if (!m) return;
  const { sc, wrapRect, bodyRect } = m;
  // A small inset so the overlay sits just inside the panel corner, not straddling
  // the body's top border.
  const inset = 4;
  const overlayTop = Math.max(0, Math.round(bodyRect.top - wrapRect.top)) + inset;
  setOverlayTop(sc.filterHost, overlayTop);
  setOverlayTop(sc.viewerHost, overlayTop);
  // Cap the legend to the body height (it scrolls internally past that) so a tall
  // legend at a large Interface Size never extends below the ring panel.
  const avail = Math.max(0, Math.round(bodyRect.height - inset * 2));
  if (sc.filterHost && sc.filterHost.style && avail > 0) sc.filterHost.style.maxHeight = avail + "px";
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
    const wrap = activeRingWrap;
    if (wrap && wrap.isConnected !== false) {
      const place = /** @type {*} */ (wrap).__placePortraits;
      if (typeof place === "function") place();
    }
    if (activeRelationsRs) anchorRelationsOverlays(activeRelationsRs);
  };
  window.addEventListener("resize", () => {
    if (scheduled) return;
    scheduled = true;
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else setTimeout(run, 16);
  });
}

/**
 * Schedule a deferred overlay anchor, retrying (bounded) until the body is laid
 * out so the measurement is valid (mirrors the ring's deferred placement).
 * @param {RenderState} rs The render-loop state.
 */
function scheduleOverlayAnchor(rs) {
  let tries = 0;
  const MAX = 120; // ~2s at 60fps; a body unlaid by then isn't going to lay out
  const defer = (/** @type {() => void} */ fn) =>
    typeof requestAnimationFrame === "function" ? requestAnimationFrame(fn) : setTimeout(fn, 16);
  const run = () => {
    const body = rs && rs.sc && rs.sc.body;
    const r =
      body && typeof body.getBoundingClientRect === "function" ? body.getBoundingClientRect() : null;
    if ((!r || r.height === 0) && ++tries <= MAX) {
      defer(run);
      return;
    }
    anchorRelationsOverlays(rs);
  };
  defer(run);
}

/**
 * Mount a ring wrap into the body and immediately place its portrait/label
 * overlays (the wrap must be in the DOM first so they can measure), so they
 * paint with the SVG rather than a frame later (avoids click flicker).
 * @param {HTMLElement} body The ring body element.
 * @param {HTMLElement} ringWrap The ring wrap to mount.
 */
function mountRing(body, ringWrap) {
  body.appendChild(ringWrap);
  // Track the live wrap so the resize hook re-fits THIS ring (not an orphan).
  activeRingWrap = ringWrap;
  ensureResizeReflow();
  const place = /** @type {*} */ (ringWrap).__placePortraits;
  if (typeof place === "function") place();
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
  // Politics / Reputation / Agreements sub-tab chips (which group is shown).
  buildSubGroupChips(rs);
  // Filter pill row - one pill per type within the active sub-group.
  buildFilterRow(rs);
  // Body: ring SVG + caption.
  renderRingBody(rs);
  // Pin the absolutely-positioned legend/viewer overlays to the measured top of
  // the body (their top offset must track the tab/toolbar chrome height, which
  // scales with Interface Size), and register this state for the resize re-anchor.
  activeRelationsRs = rs;
  scheduleOverlayAnchor(rs);
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

  // Drop in-memory filter/node-focus caches if this is a different game/save
  // than the one they were populated for (no-op on same-game repaints), so we
  // don't inherit the previous game's filters or stale node pids.
  resetRelationsCachesIfGameChanged();

  const settings = ctx.settings;

  // ---- initial tab state -------------------------------------------
  // Always OPEN to the leftmost tab in each set: top tab → "civ" (Major
  // Civilizations), sub-group → FILTER_GROUPS[0] (Politics & Relationships).
  // The persisted values still update as the user switches within the session,
  // but every fresh open starts at the leftmost, as requested.
  const topTab = "civ";
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
    repaint: () => repaintView(rs),
    // Ring-only repaint for node focus toggles: rebuilds just the ring body (not
    // the filter pills / viewer dropdown), so clicking an icon doesn't flicker
    // the whole panel.
    repaintRing: () => renderRingBody(rs)
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
