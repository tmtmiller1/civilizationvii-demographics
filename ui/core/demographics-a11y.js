// demographics-a11y.js
//
// Makes the mod's plain `<div>` buttons reachable by keyboard and gamepad. The
// first-party fxs-* components already sit in the engine's focus/nav system; a
// bare div with an onclick does not, so it is invisible to the keyboard, gamepad
// and Steam Deck D-pad.

/**
 * Upgrade a plain `<div>` into a button-equivalent: adds it to the tab order,
 * gives it `role="button"`, and fires `onClick` on click and on Enter / Space.
 * @param {HTMLElement | null | undefined} el
 * @param {(ev?: Event) => void} onClick
 * @returns {HTMLElement | null | undefined} The same element, for chaining.
 */
export function makeClickable(el, onClick) {
  if (!el || typeof onClick !== "function") return el;
  el.setAttribute("tabindex", "0");
  el.setAttribute("role", "button");
  el.addEventListener("click", onClick);
  el.addEventListener("keydown", (ev) => {
    if (!ev) return;
    const key = ev.key || ev.code;
    if (key === "Enter" || key === " " || key === "Space" || key === "Spacebar") {
      ev.preventDefault?.();
      ev.stopPropagation?.();
      onClick(ev);
    }
  });
  return el;
}
