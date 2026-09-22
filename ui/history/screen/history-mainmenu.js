// history-mainmenu.js
//
// Adds a "Hall of Fame" button to the main menu that opens the Hall of Fame with no game
// loaded. Inserted after "Additional Content" (before "Options" when that is missing); idempotent
// and guarded so it can never break the menu.

import { dlog, derr } from "/demographics/ui/history/core/history-log.js";
import { t } from "/demographics/ui/history/core/history-text.js";
import { openHallOfFame } from "/demographics/ui/history/screen/history-open.js";

const BUTTON_CLASS = "dgh-menu-button";

/**
 * Whether a menu button's caption contains a word (captions are upper-case in every language).
 * @param {Element} node Button.
 * @param {string} tag LOC tag of the base-game caption.
 * @returns {boolean} True on a match.
 */
function captionIs(node, tag) {
  const want = t(tag).toUpperCase();
  return !!want && String(node.getAttribute?.("caption") || "").toUpperCase() === want;
}

/**
 * Build the button.
 * @returns {HTMLElement} The button.
 */
function makeButton() {
  const b = document.createElement("fxs-text-button");
  b.classList.add("main-menu-text-button", "self-start", "whitespace-nowrap", BUTTON_CLASS);
  b.setAttribute("type", "big");
  b.setAttribute("centered", "false");
  b.setAttribute("highlight-style", "decorative");
  b.setAttribute("caption", t("LOC_DEMOGRAPHICS_HIST_MENU_BUTTON").toUpperCase());
  b.setAttribute("data-tooltip-style", "none");
  b.setAttribute("data-audio-group-ref", "main-menu-audio");
  b.addEventListener("action-activate", () => openHallOfFame());
  return b;
}

/**
 * Insert the button into the menu's button column.
 * @param {HTMLElement} box `.main-menu-button-container`.
 */
export function insertButton(box) {
  if (!box || box.querySelector("." + BUTTON_CLASS)) return;
  const kids = Array.from(box.children || []);
  const after = kids.find((n) => captionIs(n, "LOC_MAIN_MENU_ADDITIONAL_CONTENT"));
  const before = kids.find((n) => captionIs(n, "LOC_MAIN_MENU_OPTIONS"));
  const b = makeButton();
  if (after && after.nextSibling) box.insertBefore(b, after.nextSibling);
  else if (before) box.insertBefore(b, before);
  else box.appendChild(b);
  dlog("main menu button added");
}

class HnrMenuDecorator {
  /** @param {any} component The main-menu component. */
  constructor(component) {
    this._c = component;
  }

  beforeAttach() {}

  afterAttach() {
    try {
      insertButton(this._c?.Root?.querySelector(".main-menu-button-container"));
    } catch (e) {
      derr("main menu button failed", e);
    }
  }

  beforeDetach() {}

  afterDetach() {}
}

/**
 * The menu may already be on screen when this script runs (the decorator then never fires for it):
 * look for a built button column for a few seconds and add the button directly.
 * @param {number} tries Attempts left.
 */
function insertIntoExistingMenu(tries) {
  const box = /** @type {HTMLElement|null} */ (document.querySelector(".main-menu-button-container"));
  if (box && box.children.length > 0) {
    insertButton(box);
    return;
  }
  if (tries > 0) setTimeout(() => insertIntoExistingMenu(tries - 1), 500);
}

/** Register the decorator. */
export function installMainMenuButton() {
  try {
    Controls.decorate("main-menu", (/** @type {any} */ c) => new HnrMenuDecorator(c));
  } catch (e) {
    derr("main menu decorate failed", e);
  }
  insertIntoExistingMenu(20);
}
