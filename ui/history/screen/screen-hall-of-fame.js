// screen-hall-of-fame.js
//
// The main-menu Hall of Fame screen: a Panel registered with Controls.define and pushed through the
// ContextManager (history-open.js). It shows past campaigns only, so it loads none of the in-game
// Demographics machinery. It publishes the Demographics font ladder (--dg-fs-*) from the player's
// Font Size setting, which the engine does not apply to mod content, and redraws when it changes.

import Panel from "/core/ui/panel-support.js";
import { derr, safe } from "/demographics/ui/history/core/history-log.js";
import { publishFontLadder } from "/demographics/ui/core/demographics-font-ladder.js";
import { SCREEN_ID } from "/demographics/ui/history/screen/history-open.js";
import { renderHallOfFame } from "/demographics/ui/history/views/history-app.js";
import { viewState } from "/demographics/ui/history/views/history-state.js";

/**
 * Publish the Demographics type scale on this screen's root, scaled by the player's Font Size
 * setting. The ladder lives in demographics-font-ladder.js (shared with the in-game screen).
 * @param {HTMLElement} node Root element.
 */
export function applyFontScale(node) {
  publishFontLadder(node);
}

/**
 * Whether an engine-input event is a Cancel (Escape, the controller's back button or the menu key).
 * @param {any} ev The engine-input event.
 * @returns {boolean} True for a Cancel.
 */
function isCancel(ev) {
  return !!(ev?.isCancelInput?.() || ev?.detail?.name === "sys-menu");
}

class ScreenHistoryRankings extends Panel {
  /** @type {(...args: any[]) => void} */
  _onFont = () => this._render();
  /** @type {(ev: any) => void} */
  _onInput = (ev) => this._handleEngineInput(ev);

  onInitialize() {
    super.onInitialize?.();
    this.enableOpenSound = true;
    this.enableCloseSound = true;
    safe(() => this.Root.setAttribute("data-audio-group-ref", "audio-screen-unlocks"), undefined);
  }

  onAttach() {
    super.onAttach();
    safe(() => engine.on("UIFontScaleChanged", this._onFont), undefined);
    this.Root.addEventListener("engine-input", this._onInput);
    this._mountWhenReady(0);
  }

  onDetach() {
    safe(() => engine.off("UIFontScaleChanged", this._onFont), undefined);
    this.Root.removeEventListener("engine-input", this._onInput);
    super.onDetach?.();
  }

  /** When the last Cancel was handled, to fold one key press into one step (see _isFinalCancel). */
  _lastCancel = 0;

  /**
   * Close on Cancel / Escape, the way base-game screens do (a DOM listener on the root;
   * no global input handler is installed, so map input is never affected).
   * @param {any} ev The engine-input event.
   */
  _handleEngineInput(ev) {
    if (!this._isFinalCancel(ev)) return;
    ev.stopPropagation?.();
    ev.preventDefault?.();
    // On a game's page, Cancel steps back to the Hall of Fame; from there it closes the screen.
    if (viewState.detail) {
      viewState.detail = null;
      this._render();
    } else {
      this.close();
    }
  }

  /**
   * Whether an engine-input event is the finishing Cancel / Escape press. If the InputActionStatuses
   * global is missing the status filter is skipped and a press arrives as several events (start
   * and finish), so those within a quarter second count once.
   * @param {any} ev The engine-input event.
   * @returns {boolean} True to act on it.
   */
  _isFinalCancel(ev) {
    const finish = safe(() => InputActionStatuses.FINISH, undefined);
    if (finish !== undefined && ev?.detail?.status !== finish) return false;
    if (!isCancel(ev)) return false;
    if (finish !== undefined) return true;
    const now = Date.now();
    const repeat = now - this._lastCancel < 250;
    this._lastCancel = now;
    return !repeat;
  }

  /**
   * On a cold start the content HTML is injected after onAttach; retry across frames until the
   * host exists (warm starts find it at once).
   * @param {number} tries Attempts so far.
   */
  _mountWhenReady(tries) {
    const host = this.Root?.querySelector?.(".dgh-screen-host");
    if (host) {
      this._wireClose();
      this._render();
      return;
    }
    if (tries < 30) requestAnimationFrame(() => this._mountWhenReady(tries + 1));
    else derr("screen host not found");
  }

  _wireClose() {
    const btn = this.Root.querySelector("[data-dgh-close]");
    if (btn && !btn.hasAttribute("data-dgh-wired")) {
      btn.setAttribute("data-dgh-wired", "1");
      btn.addEventListener("action-activate", () => this.close());
    }
  }

  _render() {
    const host = this.Root?.querySelector?.(".dgh-screen-host");
    if (!host) return;
    applyFontScale(this.Root);
    // The short-games filter goes on the screen's title line (see screen-hall-of-fame.html); the
    // slot is missing on a partially built root, and the view falls back to its own row.
    const filterHost = /** @type {HTMLElement|null} */ (this.Root?.querySelector?.(".dgh-title-slot") || null);
    renderHallOfFame(host, { mode: "shell", filterHost });
  }
}

// initializeImmediately: Controls.define only records a definition and tags are wired up in one
// pass at startup, which this module loads after; without the flag the screen element is created
// with no component and ContextManager.push throws.
try {
  Controls.define(SCREEN_ID, {
    initializeImmediately: true,
    createInstance: ScreenHistoryRankings,
    description: "Demographics Hall of Fame (main menu).",
    styles: ["fs://game/demographics/ui/screen-demographics/styles/screen-demographics-history.css"],
    content: ["fs://game/demographics/ui/history/screen/screen-hall-of-fame.html"],
    attributes: [],
    classNames: ["dgh-screen", "w-full", "h-full"]
  });
} catch (e) {
  derr("Controls.define failed", e);
}
