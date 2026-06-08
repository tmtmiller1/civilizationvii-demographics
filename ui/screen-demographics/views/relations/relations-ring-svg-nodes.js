// relations-ring-svg-nodes.js
//
// Node-rendering helpers for the Global Relations ring SVG.

import {
  hexToRgba,
  normalizeCivColor
} from "/demographics/ui/screen-demographics/views/relations/relations-shared.js";

/**
 * Per-node display info resolved from history + engine lookups. Loose at the
 * engine boundary; the renderer reads these fields off `names[pid]`.
 * @typedef {Object} NodeInfo
 * @property {number} [pid] Player id (stamped in by appendRingNode).
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
 * A queued portrait/icon overlay to be positioned in pixel coords once the
 * SVG has laid out.
 * @typedef {Object} PortraitPlacement
 * @property {string} kind Either "leader" or "cs-icon".
 * @property {string} [leaderType] Engine LeaderType (leader portraits).
 * @property {string} [iconUrl] BLP icon url (cs-icon overlays).
 * @property {number} [pid] Player id for click-to-focus.
 * @property {boolean} [selected] Whether this node is in the active focus set.
 * @property {boolean} [dimmed] Whether this node is dimmed (focus on another node).
 * @property {number} vbX X position in viewBox coords.
 * @property {number} vbY Y position in viewBox coords.
 * @property {number} vbR Node radius in viewBox coords.
 */

/**
 * Per-ring render context shared across a single ring's node draws.
 * @typedef {Object} RingRenderCtx
 * @property {number} viewerPid Focus viewer id.
 * @property {Set<number>|undefined} selectedNodeIds Selected-node set (may be undefined).
 * @property {Set<number>|null} [focusNodes] Nodes kept bright when a focus is active
 *   (the selected nodes + their direct neighbors); null when no focus is active.
 * @property {((pid: number) => void)|undefined} onNodeToggle Click handler (may be undefined).
 * @property {PortraitPlacement[]} portraitsToPlace Overlay queue.
 */

/**
 * One ring node's resolved render descriptor (built by appendRingNode, consumed
 * by the node-leaf builders).
 * @typedef {Object} RingNode
 * @property {Element} svg The SVG root.
 * @property {{x: number, y: number}} pos Node position.
 * @property {NodeInfo} info The node's display info.
 * @property {number} id The node player id.
 * @property {boolean} isCs Whether the node is a city-state.
 * @property {boolean} isViewer Whether the node is the focus viewer.
 * @property {boolean} isSelected Whether the node is in the active focus set.
 * @property {number} density The ring density factor.
 * @property {number} cx Ring center x.
 * @property {number} cy Ring center y.
 * @property {number} viewBoxH ViewBox height (label clamp).
 * @property {((pid: number) => void)|undefined} onNodeToggle Click handler.
 * @property {PortraitPlacement[]} portraitsToPlace Overlay queue.
 * @property {string} nm The node display name.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

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
  const fill = isCs
    ? normalizeCivColor(info.csTypeColor)
      ? hexToRgba(normalizeCivColor(info.csTypeColor), 0.18)
      : "rgba(154,168,200,0.18)"
    : hexToRgba(stroke, 0.18);
  return { stroke, fill };
}

/**
 * Queue a city-state TYPE icon overlay (background-image div placed in pixel
 * space later, like leader portraits). The SVG `<image href="blp:">` path renders
 * blank in Coherent, so CS icons ride the same HTML-overlay pipeline.
 * @param {NodeInfo} info The node's display info.
 * @param {{x: number, y: number}} pos Node position.
 * @param {number} r Node radius.
 * @param {PortraitPlacement[]} portraitsToPlace Overlay queue.
 * @returns {PortraitPlacement|null} The queued placement, or null.
 */
function queueCsIcon(info, pos, r, portraitsToPlace) {
  if (!info.csTypeIcon) return null;
  /** @type {PortraitPlacement} */
  const placement = {
    kind: "cs-icon",
    iconUrl: info.csTypeIcon,
    pid: info.pid,
    vbX: pos.x,
    vbY: pos.y,
    vbR: r * 0.7 // icon inscribed slightly inside the node
  };
  portraitsToPlace.push(placement);
  return placement;
}

/**
 * Append the inner CS type-color disc (the fallback when a CS has no type icon,
 * e.g. unmet city-states).
 * @param {Element} node The node group.
 * @param {number} r Node radius.
 * @param {NodeInfo} info The node's display info.
 */
function appendCsTypeDisc(node, r, info) {
  if (!info.csTypeColor) return;
  const inner = document.createElementNS(SVG_NS, "circle");
  inner.setAttribute("cx", "0");
  inner.setAttribute("cy", "0");
  inner.setAttribute("r", String(r * 0.55));
  inner.setAttribute("fill", info.csTypeColor);
  inner.setAttribute("fill-opacity", "0.65");
  node.appendChild(inner);
}

/**
 * Node radius: density-scaled, with city-states the smallest and the viewer the
 * largest (matches the base game's relative node weighting).
 * @param {boolean} isViewer Whether the node is the viewer.
 * @param {boolean} isCs Whether the node is a city-state.
 * @param {number} density The ring density factor.
 * @returns {number} The node radius in viewBox units.
 */
function nodeRadius(isViewer, isCs, density) {
  const baseR = isViewer ? 6.0 : isCs ? 4.0 : 5.0;
  return baseR * (isViewer ? Math.max(density, 0.65) : density);
}

/**
 * Resolve the ring-node stroke width from viewer, CS, selection, and density.
 * @param {boolean} isViewer Whether the node is the viewer.
 * @param {boolean} isCs Whether the node is a city-state.
 * @param {boolean} isSelected Whether the node is selected.
 * @param {number} density The ring density factor.
 * @returns {number} Stroke width in SVG units.
 */
function nodeStrokeWidth(isViewer, isCs, isSelected, density) {
  const base = isCs ? 0.8 : 0.7;
  if (isViewer || isSelected) return base + 0.25;
  return base + Math.max(0, (1 - density) * 0.2);
}

/**
 * Append the node's base circle, including the CS inset disc.
 * @param {Element} node The node group.
 * @returns {number} The node radius.
 */
function appendNodeCircle(node) {
  const r = Number(node.getAttribute("data-r")) || 8;
  const isViewer = node.getAttribute("data-viewer") === "1";
  const isCs = node.getAttribute("data-cs") === "1";
  const isSelected = node.getAttribute("data-selected") === "1";
  const density = Number(node.getAttribute("data-density")) || 1;
  const info = /** @type {NodeInfo} */ (/** @type {*} */ (node).__info || {});
  const colors = resolveNodeColors(info, isCs);

  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("cx", "0");
  circle.setAttribute("cy", "0");
  circle.setAttribute("r", String(r));
  circle.setAttribute("fill", colors.fill);
  circle.setAttribute("stroke", colors.stroke);
  circle.setAttribute("stroke-width", String(nodeStrokeWidth(isViewer, isCs, isSelected, density)));
  // City-states read as a dashed ring (matches the base game's CS framing).
  if (isCs) circle.setAttribute("stroke-dasharray", "0.8 0.5");
  node.appendChild(circle);

  return r;
}

/**
 * Queue a leader portrait overlay for later pixel-space placement.
 * @param {NodeInfo} info The node's display info.
 * @param {{x: number, y: number}} pos Node position.
 * @param {number} r Node radius.
 * @param {PortraitPlacement[]} portraitsToPlace Overlay queue.
 * @param {boolean} isSelected Whether the node is selected.
 * @returns {PortraitPlacement|null} The queued placement, or null.
 */
function queueLeaderPortrait(info, pos, r, portraitsToPlace, isSelected) {
  if (!info.leaderTypeString) return null;
  /** @type {PortraitPlacement} */
  const placement = {
    kind: "leader",
    leaderType: info.leaderTypeString,
    pid: info.pid,
    selected: isSelected,
    vbX: pos.x,
    vbY: pos.y,
    vbR: r
  };
  portraitsToPlace.push(placement);
  return placement;
}

/**
 * Append the fallback initial-letter label inside a major civ node. Font size,
 * fill and weight are set as SVG attributes scaled by ring density (the ring is
 * a ~100-unit viewBox, so CSS px would not scale with the ring).
 * @param {Element} node The node group.
 */
function appendInitialLetter(node) {
  const isViewer = node.getAttribute("data-viewer") === "1";
  const isCs = node.getAttribute("data-cs") === "1";
  const density = Number(node.getAttribute("data-density")) || 1;
  const initFont = (isViewer ? 5 : isCs ? 3.2 : 4) * density;
  const text = document.createElementNS(SVG_NS, "text");
  text.setAttribute("x", "0");
  text.setAttribute("y", String(initFont * 0.34));
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("font-size", String(initFont));
  text.setAttribute("fill", isCs ? "#1c1408" : "#f3c34c");
  text.setAttribute("font-weight", "700");
  text.textContent = String(/** @type {*} */ (node).__initial || "").slice(0, 1).toUpperCase();
  node.appendChild(text);
}

/**
 * Append the node name label beneath the ring node as a rounded "chip" (dark
 * rounded background + bronze hairline + cream text), matching the line-chart /
 * radar legend labels for a clean, modern look. Font + chip size scale with ring
 * density. SVG can't measure text pre-render, so the chip width is estimated from
 * the text length with generous padding so it never clips.
 * @param {Element} node The node group.
 * @param {number} r Node radius.
 */
function appendNodeLabel(node, r) {
  const density = Number(node.getAttribute("data-density")) || 1;
  const nameFont = 2.4 * density;
  const text = String(/** @type {*} */ (node).__label || "");
  if (!text) return;
  const chipH = nameFont * 1.7;
  const chipW = text.length * nameFont * 0.56 + nameFont * 1.6;
  const top = r + nameFont * 0.5;
  appendLabelChip(node, { x: -chipW / 2, y: top, w: chipW, h: chipH, rx: nameFont * 0.5 });
  const label = document.createElementNS(SVG_NS, "text");
  label.setAttribute("x", "0");
  label.setAttribute("y", String(top + chipH * 0.5 + nameFont * 0.34));
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("font-size", String(nameFont));
  label.setAttribute("font-weight", "600");
  label.setAttribute("fill", "#f3e7c4");
  label.textContent = text;
  node.appendChild(label);
}

/**
 * Append the rounded chip background behind a node label.
 * @param {Element} node The node group.
 * @param {{ x: number, y: number, w: number, h: number, rx: number }} box Chip geometry.
 */
function appendLabelChip(node, box) {
  const chip = document.createElementNS(SVG_NS, "rect");
  chip.setAttribute("x", String(box.x));
  chip.setAttribute("y", String(box.y));
  chip.setAttribute("width", String(box.w));
  chip.setAttribute("height", String(box.h));
  chip.setAttribute("rx", String(box.rx));
  chip.setAttribute("fill", "rgba(18, 14, 8, 0.82)");
  chip.setAttribute("stroke", "rgba(201, 162, 76, 0.45)");
  chip.setAttribute("stroke-width", "0.25");
  node.appendChild(chip);
}

/**
 * Apply the stashed props + data-* attributes to a ring node group.
 * @param {*} node The node <g> element (carries __info/__label/__initial).
 * @param {{ id: number, pos: {x: number, y: number}, info: NodeInfo }} nodeData Node specifics.
 * @param {{ positions: Map<number, {x: number, y: number}>, density: number,
 *   cx: number, cy: number, viewBoxH: number }} geo Ring geometry.
 * @param {RingRenderCtx} ctx Per-ring render context.
 */
function configureNodeElement(node, nodeData, geo, ctx) {
  const { id, pos, info } = nodeData;
  const isViewer = id === ctx.viewerPid;
  const isCs = !!info.isCityState;
  node.__info = info;
  node.__label = nodeDisplayName(info, id);
  node.__initial = String(info.leaderName || info.csName || "P");
  node.setAttribute("transform", "translate(" + pos.x + " " + pos.y + ")");
  node.setAttribute("data-r", String(nodeRadius(isViewer, isCs, geo.density)));
  node.setAttribute("data-viewer", isViewer ? "1" : "0");
  node.setAttribute("data-cs", isCs ? "1" : "0");
  node.setAttribute("data-selected", ctx.selectedNodeIds && ctx.selectedNodeIds.has(id) ? "1" : "0");
  node.setAttribute("data-density", String(geo.density));
  if (typeof id === "number") node.setAttribute("data-pid", String(id));
  applyFocusDim(node, id, ctx.focusNodes);
}

/**
 * Focus mode: when a node is selected, everything outside its relationship
 * neighborhood fades back so the selected node's web reads clearly.
 * @param {Element} node The node group.
 * @param {number} id The node player id.
 * @param {Set<number>|null|undefined} focusNodes The bright set, or null.
 */
function applyFocusDim(node, id, focusNodes) {
  const dimmed = !!(focusNodes && !focusNodes.has(id));
  node.setAttribute("data-dimmed", dimmed ? "1" : "0");
  if (dimmed) node.setAttribute("opacity", "0.18");
}

/**
 * Make the whole node group click-to-focus, not just the (HTML) portrait overlay
 * on top of it - so the ring filters even where the overlay is absent (initial
 * letters, CS discs) or doesn't capture the click.
 * @param {*} node The node group.
 * @param {number} id The node player id.
 * @param {((pid: number) => void)|undefined} onNodeToggle The toggle handler.
 */
function wireNodeClick(node, id, onNodeToggle) {
  if (typeof onNodeToggle !== "function" || typeof id !== "number") return;
  node.style.cursor = "pointer";
  node.addEventListener("click", () => onNodeToggle(id));
}

/**
 * Append one ring node, including the node circle, CS disc, leader portrait
 * queue entry, and label text.
 * @param {Element} svg The SVG root.
 * @param {number} id The node player id.
 * @param {{ positions: Map<number, {x: number, y: number}>, density: number,
 *   cx: number, cy: number, viewBoxH: number }} geo Ring geometry.
 * @param {Record<string, NodeInfo>} names Node display-info map.
 * @param {RingRenderCtx} ctx Per-ring render context.
 */
export function appendRingNode(svg, id, geo, names, ctx) {
  const pos = geo.positions.get(id);
  if (!pos) return;
  const info = names[id] || {};
  const node = /** @type {*} */ (document.createElementNS(SVG_NS, "g"));
  configureNodeElement(node, { id, pos, info }, geo, ctx);

  const r = appendNodeCircle(node);

  let placement = null;
  if (info.isCityState) {
    // Met CS → type icon overlay; otherwise (unmet / no icon) the colored disc.
    placement = queueCsIcon(info, pos, r, ctx.portraitsToPlace);
    if (!placement) appendCsTypeDisc(node, r, info);
  } else {
    const selected = node.getAttribute("data-selected") === "1";
    placement = queueLeaderPortrait(info, pos, r, ctx.portraitsToPlace, selected);
    if (!placement) appendInitialLetter(node);
  }
  // Fade the overlay too when the node is dimmed by focus mode.
  if (placement && node.getAttribute("data-dimmed") === "1") placement.dimmed = true;

  appendNodeLabel(node, r);
  wireNodeClick(node, id, ctx.onNodeToggle);
  svg.appendChild(node);
}
