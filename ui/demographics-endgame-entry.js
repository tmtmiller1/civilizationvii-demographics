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

const RESULTS_BTN_ID = "demographics-endgame-button";
const PAUSE_BTN_ID = "demographics-pause-button";

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
  const row = screen.querySelector(".bottom-10.right-10") || screen;
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
  const found = node.querySelector ? node.querySelector("#pause-menu-button-container") : null;
  return found instanceof HTMLElement ? found : null;
}

/**
 * Inspect a mutation-added node for the results screen and pause menu.
 * @param {*} node The added node.
 */
function inspect(node) {
  if (!(node instanceof HTMLElement)) return;
  try {
    if (node.localName === "screen-victory-progress") injectResults(node);
    else if (node.querySelector) {
      const s = node.querySelector("screen-victory-progress");
      if (s instanceof HTMLElement) injectResults(s);
    }
    const pause = findPauseContainer(node);
    if (pause) injectPause(pause);
  } catch (e) {
    dlog("inspect threw:", /** @type {*} */ (e)?.message);
  }
}

/** Install initial injection + a MutationObserver for later screen mounts. */
function install() {
  try {
    const existing = document.querySelector("screen-victory-progress");
    if (existing instanceof HTMLElement) injectResults(existing);
    const pause = document.getElementById("pause-menu-button-container");
    if (pause) injectPause(pause);
    new MutationObserver((muts) => {
      for (const mut of muts) for (const added of mut.addedNodes) inspect(added);
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
