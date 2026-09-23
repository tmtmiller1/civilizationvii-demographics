// demographics-endgame-entry.js
//
// Injects a "Demographics" button into the end-of-game results screen
// (screen-victory-progress) and the pause menu, so the dashboard stays reachable
// when the subsystem dock is gone. UI-only, read-only; mirrors the dock
// decorator's defensive ContextManager.push. Never throws into the game loop.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { DemographicsSettings } from "/demographics/ui/core/demographics-settings.js";

const DBG = false;
/**
 * Debug logger, no-op unless {@link DBG}.
 * @param {...*} a Values to log.
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.endgame]", ...a);
}

// The end-of-game screens we attach to. `endgame-screen` is the results banner
// shown when a game finishes (pushed by base-standard/ui/endgame/screen-endgame.js);
// `screen-victory-progress` is the victory tracker that screen and the subsystem
// dock both open. Both render the same bottom-right action row.
const RESULT_SCREENS = "screen-victory-progress, endgame-screen";
// The bottom-right action row inside those screens (where "Continue"/"Exit to Main
// Menu" sit). It can mount AFTER its screen does, so a miss is never treated as final.
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
 * Report ONCE, via console.error (visible in UI.log), that a screen mounted but the DOM hook the
 * button needs never appeared, naming the selector. Deferred, because a hook can mount a frame or
 * two after its screen; a button or hook present by then cancels it.
 * @param {HTMLElement} screen The observed screen.
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
      dlog("hook report threw:", /** @type {*} */ (e)?.message);
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
      .catch((e) => dlog("context-manager import failed:", /** @type {*} */ (e)?.message));
  } catch (e) {
    dlog("openScreen threw:", /** @type {*} */ (e)?.message);
  }
}

/**
 * Build a native-styled button element wired to open the screen.
 * @param {string} id The element id.
 * @param {string} label The button text.
 * @param {string} [focusView] A landing view id for the click.
 * @returns {HTMLElement} The button.
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

/**
 * Inject the button into the results screen's action row, once.
 * @param {HTMLElement} screen The results screen element.
 */
function injectResults(screen) {
  if (!screen || screen.querySelector("#" + RESULTS_BTN_ID)) return;
  // Only ever place the button in the screen's own action row; falling back to
  // the screen root would strand a floating button in the top-left corner. A
  // miss here is not final: inspect() re-enters when the row itself mounts.
  const row = screen.querySelector(ACTION_ROW);
  if (!row) {
    // Only the end-of-game screen always has the row; the mid-game tracker legitimately lacks it.
    if (String(screen.localName || "").toLowerCase() === "endgame-screen") {
      reportMissingHookLater(screen, ACTION_ROW, RESULTS_BTN_ID);
    }
    return;
  }
  // From the results screen, land on World Rankings — the leaderboard reads as a game recap.
  row.insertBefore(makeButton(RESULTS_BTN_ID, t("LOC_MOD_DEMOGRAPHICS_NAME"), "rankings"), row.firstChild);
}

/**
 * Inject the button into the pause-menu button container, once.
 * @param {HTMLElement} container The pause-menu button container.
 */
function injectPause(container) {
  if (!container || container.querySelector("#" + PAUSE_BTN_ID)) return;
  const btn = makeButton(PAUSE_BTN_ID, t("LOC_MOD_DEMOGRAPHICS_NAME"));
  btn.classList.add("mt-4");
  container.appendChild(btn);
}

/**
 * Resolve the pause-menu button container within a node, if present.
 * @param {HTMLElement} node The node to search.
 * @returns {HTMLElement|null} The container, or null.
 */
function findPauseContainer(node) {
  if (node.id === "pause-menu-button-container") return node;
  const found = node.querySelector ? node.querySelector(PAUSE_CONTAINER) : null;
  return found instanceof HTMLElement ? found : null;
}

/**
 * Inject the pause button into the container a node brought in; when the node is (or contains)
 * the pause menu itself and the container is missing, report the miss once.
 * @param {HTMLElement} node The added node.
 */
function injectPauseFor(node) {
  const pause = findPauseContainer(node);
  if (pause) {
    injectPause(pause);
    return;
  }
  let menu = null;
  if (String(node.localName || "").toLowerCase() === PAUSE_SCREEN) menu = node;
  else if (node.querySelector) menu = node.querySelector(PAUSE_SCREEN);
  if (menu instanceof HTMLElement) reportMissingHookLater(menu, PAUSE_CONTAINER, PAUSE_BTN_ID);
}

/**
 * Whether an element is one of the end-of-game screens we attach to. Coherent
 * Gameface reports `localName`/`tagName` in UPPERCASE, so this MUST compare
 * case-insensitively or the button silently never appears.
 * @param {HTMLElement} node The node to test.
 * @returns {boolean} True when `node` is a results screen.
 */
export function isResultScreen(node) {
  const ln = String(node.localName || "").toLowerCase();
  return ln === "screen-victory-progress" || ln === "endgame-screen";
}

/**
 * The action row a node either is or contains, if any.
 * @param {HTMLElement} node The node to search.
 * @returns {HTMLElement|null} The action row, or null.
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
 * @param {HTMLElement} node The added node.
 * @returns {HTMLElement|null} The screen to inject into, or null.
 */
function resultScreenFor(node) {
  if (isResultScreen(node)) return node;
  const nested = node.querySelector ? node.querySelector(RESULT_SCREENS) : null;
  if (nested instanceof HTMLElement) return nested;
  const row = actionRowIn(node);
  const owner = row && row.closest ? row.closest(RESULT_SCREENS) : null;
  return owner instanceof HTMLElement ? owner : null;
}

/**
 * Inspect a mutation-added node for the results screen and pause menu.
 * @param {*} node The added node.
 */
function inspect(node) {
  if (!(node instanceof HTMLElement)) return;
  try {
    const screen = resultScreenFor(node);
    if (screen) injectResults(screen);
    injectPauseFor(node);
  } catch (e) {
    dlog("inspect threw:", /** @type {*} */ (e)?.message);
  }
}

/**
 * Cheap pre-filter for the game-wide observer: only element nodes that carry an id, a class, or
 * children can contain a hook, plus a results screen itself even when it mounts empty (so a row
 * that never follows is still reported).
 * @param {*} node The added node.
 * @returns {boolean} True when the node deserves inspection.
 */
function worthInspecting(node) {
  if (!node || node.nodeType !== 1) return false;
  return !!(node.id || node.className || node.firstChild) || isResultScreen(node);
}

/**
 * Install initial injection + a MutationObserver for later screen mounts. The observer is never
 * disconnected: the pause container is re-created on every pause, and the results screens mount
 * once per game end.
 */
function install() {
  try {
    const existing = document.querySelector(RESULT_SCREENS);
    if (existing instanceof HTMLElement) injectResults(existing);
    const pause = document.getElementById("pause-menu-button-container");
    if (pause) injectPause(pause);
    new MutationObserver((muts) => {
      for (const mut of muts) {
        for (const added of mut.addedNodes) if (worthInspecting(added)) inspect(added);
      }
    }).observe(document.body, { childList: true, subtree: true });
    dlog("installed");
  } catch (e) {
    dlog("install threw:", /** @type {*} */ (e)?.message);
  }
}

(function boot() {
  if (document.body) install();
  else if (typeof requestAnimationFrame === "function") requestAnimationFrame(boot);
})();

export {};
