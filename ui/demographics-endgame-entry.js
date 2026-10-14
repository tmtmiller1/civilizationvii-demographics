// demographics-endgame-entry.js
//
// Adds a "Demographics" button to the end-of-game results screen
// (screen-victory-progress) and the pause menu, so the dashboard stays reachable
// when the subsystem dock is gone. UI-only, read-only; mirrors the dock
// decorator's defensive ContextManager.push. Never throws into the game loop.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { DemographicsSettings } from "/demographics/ui/core/demographics-settings.js";
import { makeLogger } from "/demographics/ui/core/demographics-log.js";

const log = makeLogger("endgame");

// The end-of-game screens we attach to. `endgame-screen` is the results banner
// shown when a game finishes (pushed by base-standard/ui/endgame/screen-endgame.js);
// `screen-victory-progress` is the victory tracker that screen and the subsystem
// dock both open. Both render the same bottom-right action row.
const RESULT_SCREENS = "screen-victory-progress, endgame-screen";
// The bottom-right action row inside those screens (where "Continue"/"Exit to Main
// Menu" sit). It can mount after its screen does, so a miss is never treated as final.
const ACTION_ROW = ".bottom-10.right-10";

const RESULTS_BTN_ID = "demographics-endgame-button";
const PAUSE_BTN_ID = "demographics-pause-button";
// The pause menu (base-standard/ui/pause-menu/screen-pause-menu.js) and the button container
// inside it that the pause button joins.
const PAUSE_SCREEN = "screen-pause-menu";
const PAUSE_CONTAINER = "#pause-menu-button-container";
// How long a hook (action row / pause container) gets to mount after its screen before a miss is
// reported as a base-game DOM change.
const HOOK_GRACE_MS = 1000;
/** Hook selectors already reported missing, so each is logged once per session, not per mount. */
const reportedMissing = new Set();

/**
 * Report once, via console.error (visible in UI.log), that a screen mounted but the DOM hook the
 * button needs never appeared, naming the selector. Deferred, because a hook can mount a frame or
 * two after its screen; a button or hook present by then cancels it.
 * @param {HTMLElement} screen
 * @param {string} selector The hook selector that was missing.
 * @param {string} btnId The button id that should have landed.
 */
function reportMissingHookLater(screen, selector, btnId) {
  if (reportedMissing.has(selector) || typeof setTimeout !== "function") return;
  setTimeout(() => {
    try {
      if (reportedMissing.has(selector)) return;
      if (screen.querySelector("#" + btnId) || screen.querySelector(selector)) return;
      reportedMissing.add(selector);
      console.error(
        "[Demographics.endgame] " + String(screen.localName || "").toLowerCase() +
        " mounted but " + selector + " was not found within " + HOOK_GRACE_MS +
        " ms; the Demographics button was not added (base-game DOM change?)"
      );
    } catch (e) {
      log.debug("hook report threw:", /** @type {*} */ (e)?.message);
    }
  }, HOOK_GRACE_MS);
}

/**
 * Open the Demographics screen via the engine context manager, optionally
 * requesting a landing view (a one-shot honored by the screen's _restoreState).
 * Never throws.
 * @param {string} [focusView] A view id to land on (e.g. "rankings").
 */
function openScreen(focusView) {
  try {
    if (focusView) {
      try {
        DemographicsSettings.setSetting("pendingReturnView", focusView);
        // From the results screen, World Rankings opens on the Hall of Fame so the finished game
        // is seen in its ranking.
        if (focusView === "rankings") DemographicsSettings.setSetting("settlementsSubTab", "halloffame");
      } catch (_) {
        /* settings unavailable → opens on the default view */
      }
    }
    import("/core/ui/context-manager/context-manager.js")
      .then((m) => {
        const cm = /** @type {any} */ (m.default || m.ContextManager || m);
        cm.push("screen-demographics", { singleton: true, createMouseGuard: true });
      })
      .catch((e) => log.debug("context-manager import failed:", /** @type {*} */ (e)?.message));
  } catch (e) {
    log.debug("openScreen threw:", /** @type {*} */ (e)?.message);
  }
}

/**
 * @param {string} id
 * @param {string} label
 * @param {string} [focusView]
 */
function makeButton(id, label, focusView) {
  const b = document.createElement("div");
  b.id = id;
  b.className =
    "fxs-button pointer-events-auto relative flex items-center justify-center " +
    "text-accent-1 font-title text-base uppercase tracking-150 px-5 py-2 cursor-pointer";
  b.setAttribute("data-name", "Button");
  b.setAttribute("activatable", "true");
  b.textContent = label;
  b.addEventListener("click", () => openScreen(focusView));
  return b;
}

/** @param {HTMLElement} screen */
function addResultsButton(screen) {
  if (!screen || screen.querySelector("#" + RESULTS_BTN_ID)) return;
  // Only ever place the button in the screen's own action row; falling back to
  // the screen root would strand a floating button in the top-left corner. A
  // miss here is not final: onNodeAdded() re-enters when the row itself mounts.
  const row = screen.querySelector(ACTION_ROW);
  if (!row) {
    // Only the end-of-game screen always has the row; the mid-game tracker legitimately lacks it.
    if (String(screen.localName || "").toLowerCase() === "endgame-screen") {
      reportMissingHookLater(screen, ACTION_ROW, RESULTS_BTN_ID);
    }
    return;
  }
  // From the results screen, land on World Rankings: the leaderboard reads as a game recap.
  row.insertBefore(makeButton(RESULTS_BTN_ID, t("LOC_MOD_DEMOGRAPHICS_NAME"), "rankings"), row.firstChild);
}

/** @param {HTMLElement} container */
function addPauseButton(container) {
  if (!container || container.querySelector("#" + PAUSE_BTN_ID)) return;
  const btn = makeButton(PAUSE_BTN_ID, t("LOC_MOD_DEMOGRAPHICS_NAME"));
  btn.classList.add("mt-4");
  container.appendChild(btn);
}

/**
 * @param {HTMLElement} node
 * @returns {HTMLElement|null}
 */
function findPauseContainer(node) {
  if (node.id === "pause-menu-button-container") return node;
  const found = node.querySelector ? node.querySelector(PAUSE_CONTAINER) : null;
  return found instanceof HTMLElement ? found : null;
}

/** @param {HTMLElement} node */
function addPauseButtonFor(node) {
  const pause = findPauseContainer(node);
  if (pause) {
    addPauseButton(pause);
    return;
  }
  let menu = null;
  if (String(node.localName || "").toLowerCase() === PAUSE_SCREEN) menu = node;
  else if (node.querySelector) menu = node.querySelector(PAUSE_SCREEN);
  if (menu instanceof HTMLElement) reportMissingHookLater(menu, PAUSE_CONTAINER, PAUSE_BTN_ID);
}

/**
 * Whether an element is one of the end-of-game screens we attach to. Coherent
 * Gameface reports `localName`/`tagName` in upper case, so this has to compare
 * case-insensitively or the button silently never appears.
 * @param {HTMLElement} node
 * @returns {boolean}
 */
export function isResultScreen(node) {
  const ln = String(node.localName || "").toLowerCase();
  return ln === "screen-victory-progress" || ln === "endgame-screen";
}

/**
 * @param {HTMLElement} node
 * @returns {HTMLElement|null}
 */
function actionRowIn(node) {
  if (node.matches && node.matches(ACTION_ROW)) return node;
  const found = node.querySelector ? node.querySelector(ACTION_ROW) : null;
  return found instanceof HTMLElement ? found : null;
}

/**
 * Resolve the results screen a mutation-added node implies: the node itself, a
 * results screen nested inside it, or the screen owning an action row it brought
 * in (the row can mount after its screen does).
 * @param {HTMLElement} node
 * @returns {HTMLElement|null}
 */
function resultScreenFor(node) {
  if (isResultScreen(node)) return node;
  const nested = node.querySelector ? node.querySelector(RESULT_SCREENS) : null;
  if (nested instanceof HTMLElement) return nested;
  const row = actionRowIn(node);
  const owner = row && row.closest ? row.closest(RESULT_SCREENS) : null;
  return owner instanceof HTMLElement ? owner : null;
}

/** @param {*} node */
function onNodeAdded(node) {
  if (!(node instanceof HTMLElement)) return;
  try {
    const screen = resultScreenFor(node);
    if (screen) addResultsButton(screen);
    addPauseButtonFor(node);
  } catch (e) {
    log.debug("added-node handler threw:", /** @type {*} */ (e)?.message);
  }
}

/**
 * Cheap pre-filter for the game-wide observer: only element nodes that carry an id, a class, or
 * children can contain a hook, plus a results screen itself even when it mounts empty (so a row
 * that never follows is still reported).
 * @param {*} node
 * @returns {boolean}
 */
function mayHoldHook(node) {
  if (!node || node.nodeType !== 1) return false;
  return !!(node.id || node.className || node.firstChild) || isResultScreen(node);
}

/**
 * Add the buttons to any screens already up, then watch for later screen mounts. The observer is never
 * disconnected: the pause container is re-created on every pause, and the results screens mount
 * once per game end.
 */
function install() {
  try {
    const existing = document.querySelector(RESULT_SCREENS);
    if (existing instanceof HTMLElement) addResultsButton(existing);
    const pause = document.getElementById("pause-menu-button-container");
    if (pause) addPauseButton(pause);
    new MutationObserver((muts) => {
      for (const mut of muts) {
        for (const added of mut.addedNodes) if (mayHoldHook(added)) onNodeAdded(added);
      }
    }).observe(document.body, { childList: true, subtree: true });
    log.debug("installed");
  } catch (e) {
    log.debug("install threw:", /** @type {*} */ (e)?.message);
  }
}

(function boot() {
  if (document.body) install();
  else if (typeof requestAnimationFrame === "function") requestAnimationFrame(boot);
})();

export {};
