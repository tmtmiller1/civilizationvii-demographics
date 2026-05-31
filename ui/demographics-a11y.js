// demographics-a11y.js
// Small accessibility helpers that make our custom `<div>` buttons reachable
// by keyboard / gamepad in Civ7's UI sandbox.
//
// Civ7's first-party `<fxs-tab-bar>`, `<fxs-dropdown>`, and `<fxs-activatable>`
// components already integrate with the engine's focus/nav system. Plain
// `<div>` elements with onclick handlers do NOT (they're invisible to the
// keyboard, gamepad, and Steam Deck D-pad)
//
// Calling `makeClickable(el, onClick)`:
//   - sets `tabindex="0"` so the element joins the tab order
//   - sets `role="button"` so screen readers / focus rings treat it correctly
//   - binds the click handler
//   - binds a `keydown` handler that fires the same callback on Enter / Space
//
// Doesn't fight Civ7's nav system; just upgrades plain divs to button-equivalents.

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
