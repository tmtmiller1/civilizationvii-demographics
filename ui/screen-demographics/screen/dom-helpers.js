// dom-helpers.js
//
// DOM utilities shared by the screen's views and charts.

/**
 * Remove every child of `host`.
 * @param {HTMLElement} host
 */
export function clearHost(host) {
  while (host.firstChild) host.removeChild(host.firstChild);
}

/**
 * Add or remove one class without disturbing the rest of the class list.
 * @param {HTMLElement} el
 * @param {string} cls
 * @param {boolean} on
 */
export function setClass(el, cls, on) {
  if (on) el.classList.add(cls);
  else el.classList.remove(cls);
}

/**
 * Measure an element's client rect, or null when it can't be measured.
 * getBoundingClientRect can throw on a detached node in GameFace, so measurements route through
 * here and never throw into the engine's dispatcher.
 * @param {*} el The element to measure (nullable).
 * @returns {DOMRect|null}
 */
export function measureRect(el) {
  if (!el || typeof el.getBoundingClientRect !== "function") return null;
  try {
    return el.getBoundingClientRect();
  } catch (_) {
    // A detached / torn-down node: treat as not laid out.
    return null;
  }
}
