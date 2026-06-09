// relations-ring-svg-backdrop.js
//
// Quiet backdrop for the Global Relations ring: a single faint orbit ring that
// the nodes sit on, grounding the layout without competing with the edges or the
// gold leader hexes. (An earlier radar-sweep / bezel / emblem treatment read as
// sci-fi clutter against Civ VII's restrained antiquity art and was removed.)
//
// Coherent-safe: a plain SVG ellipse, no filters / SMIL / animation.

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Draw the quiet backdrop into the ring SVG (call BEFORE edges/nodes so it sits
 * behind them).
 * @param {Element} svg The SVG root.
 * @param {import("./relations-ring-svg.js").RingGeometry} geo Ring geometry.
 */
export function appendRingBackdrop(svg, geo) {
  const { cx, cy, rx, ry } = geo;
  const ring = document.createElementNS(SVG_NS, "ellipse");
  ring.setAttribute("cx", String(cx));
  ring.setAttribute("cy", String(cy));
  ring.setAttribute("rx", String(rx));
  ring.setAttribute("ry", String(ry));
  ring.setAttribute("fill", "none");
  ring.setAttribute("stroke", "rgba(201, 162, 76, 0.16)");
  ring.setAttribute("stroke-width", "0.3");
  ring.setAttribute("class", "demographics-relations-backdrop");
  svg.appendChild(ring);
}
