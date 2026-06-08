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
 * @property {number} vbX X position in viewBox coords.
 * @property {number} vbY Y position in viewBox coords.
 * @property {number} vbR Node radius in viewBox coords.
 */

/**
 * Per-ring render context shared across a single ring's node draws.
 * @typedef {Object} RingRenderCtx
 * @property {number} viewerPid Focus viewer id.
 * @property {Set<number>|undefined} selectedNodeIds Selected-node set (may be undefined).
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
 * Append the tiny CS-type disc below the node circle.
 * @param {Element} node The node group.
 * @param {number} r Node radius.
 */
function appendCsIndicator(node, r) {
  const disc = document.createElementNS(SVG_NS, "circle");
  disc.setAttribute("cx", "0");
  disc.setAttribute("cy", String(r * 0.74));
  disc.setAttribute("r", String(Math.max(1.8, r * 0.13)));
  disc.setAttribute("fill", "#d8dce8");
  disc.setAttribute("stroke", "#6d7384");
  disc.setAttribute("stroke-width", "0.35");
  node.appendChild(disc);
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
  node.appendChild(circle);

  if (isCs) appendCsIndicator(node, r);
  return r;
}

/**
 * Queue a leader portrait overlay for later pixel-space placement.
 * @param {NodeInfo} info The node's display info.
 * @param {{x: number, y: number}} pos Node position.
 * @param {number} r Node radius.
 * @param {PortraitPlacement[]} portraitsToPlace Overlay queue.
 * @param {boolean} isSelected Whether the node is selected.
 * @returns {boolean} True when a portrait was queued.
 */
function queueLeaderPortrait(info, pos, r, portraitsToPlace, isSelected) {
  if (!info.leaderTypeString) return false;
  portraitsToPlace.push({
    kind: "leader",
    leaderType: info.leaderTypeString,
    pid: info.pid,
    selected: isSelected,
    vbX: pos.x,
    vbY: pos.y,
    vbR: r
  });
  return true;
}

/**
 * Append the fallback initial-letter label inside a major civ node.
 * @param {Element} node The node group.
 */
function appendInitialLetter(node) {
  const text = document.createElementNS(SVG_NS, "text");
  text.setAttribute("x", "0");
  text.setAttribute("y", "0.34em");
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("class", "demographics-relations-node-letter");
  text.textContent = String(/** @type {*} */ (node).__initial || "").slice(0, 1).toUpperCase();
  node.appendChild(text);
}

/**
 * Append the node label beneath the ring node.
 * @param {Element} node The node group.
 * @param {number} r Node radius.
 */
function appendNodeLabel(node, r) {
  const label = document.createElementNS(SVG_NS, "text");
  label.setAttribute("x", "0");
  label.setAttribute("y", String(r + 5.5));
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("class", "demographics-relations-node-label");
  label.textContent = String(/** @type {*} */ (node).__label || "");
  node.appendChild(label);
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
  node.__info = info;
  node.__label = nodeDisplayName(info, id);
  node.__initial = String(info.leaderName || info.csName || "P");
  node.setAttribute("transform", "translate(" + pos.x + " " + pos.y + ")");
  node.setAttribute("data-r", String(Math.max(6.5, 7.4 - Math.max(0, (12 - geo.density * 12) * 0.05))));
  node.setAttribute("data-viewer", id === ctx.viewerPid ? "1" : "0");
  node.setAttribute("data-cs", info.isCityState ? "1" : "0");
  node.setAttribute("data-selected", ctx.selectedNodeIds && ctx.selectedNodeIds.has(id) ? "1" : "0");
  node.setAttribute("data-density", String(geo.density));
  if (typeof id === "number") node.setAttribute("data-pid", String(id));
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

  let renderedPortrait = false;
  if (!info.isCityState) {
    renderedPortrait = queueLeaderPortrait(info, pos, r, ctx.portraitsToPlace, node.getAttribute("data-selected") === "1");
  }
  if (!renderedPortrait && !info.isCityState) appendInitialLetter(node);

  appendNodeLabel(node, r);
  svg.appendChild(node);
}
