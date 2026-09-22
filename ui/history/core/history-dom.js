// history-dom.js
//
// Small imperative DOM builders. Views build their DOM with document.createElement (as the base
// game and Demographics do) instead of innerHTML templates, so no engine or player text is parsed
// as markup.

/**
 * @typedef {Object} ElOptions
 * @property {string} [cls] Space-separated classes.
 * @property {string} [text] textContent.
 * @property {Record<string, string>} [attrs] Attributes to set.
 * @property {Record<string, string>} [style] Inline style properties.
 */

/**
 * Create an element.
 * @param {string} tag Tag name.
 * @param {ElOptions} [opts] Options.
 * @param {Array<HTMLElement|null|undefined|false>} [children] Children to append (falsy entries skipped).
 * @returns {HTMLElement} The element.
 */
export function el(tag, opts = {}, children = []) {
  const e = document.createElement(tag);
  if (opts.cls) e.className = opts.cls;
  if (opts.text != null) e.textContent = opts.text;
  applyAttrs(e, opts);
  for (const c of children) if (c) e.appendChild(c);
  return e;
}

/**
 * Apply attributes and inline styles.
 * @param {HTMLElement} e Element.
 * @param {ElOptions} opts Options.
 */
function applyAttrs(e, opts) {
  for (const [k, v] of Object.entries(opts.attrs || {})) e.setAttribute(k, v);
  for (const [k, v] of Object.entries(opts.style || {})) /** @type {any} */ (e.style)[k] = v;
}

/**
 * Remove every child of a node.
 * @param {HTMLElement} node The node to empty.
 */
export function clear(node) {
  while (node && node.firstChild) node.removeChild(node.firstChild);
}

/**
 * Attach a click handler to a plain element (pills, rows, cards). Mouse clicks and dispatched click
 * events both arrive as `click` in GameFace; fxs components use `action-activate` instead and are
 * wired where they are created.
 * @param {HTMLElement} node The element.
 * @param {() => void} fn The handler.
 */
export function onActivate(node, fn) {
  node.addEventListener("click", () => fn());
}
