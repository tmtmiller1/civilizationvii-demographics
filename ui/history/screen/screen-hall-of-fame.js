// screen-hall-of-fame.js
//
// The main-menu Hall of Fame screen: a Panel registered with Controls.define and pushed through the
// ContextManager (history-open.js). It shows past campaigns only, so it loads none of the in-game
// Demographics machinery. It publishes the Demographics font ladder (--dg-fs-*) from the player's
// Font Size setting, which the engine does not apply to mod content, and redraws when it changes.

import Panel from "/core/ui/panel-support.js";
import { derr, safe } from "/demographics/ui/history/core/history-log.js";
import { SCREEN_ID } from "/demographics/ui/history/screen/history-open.js";
import { renderHallOfFame } from "/demographics/ui/history/views/history-app.js";
import { viewState } from "/demographics/ui/history/views/history-state.js";

/** The Demographics font ladder (rem at the default size), published as --dg-fs-<size x 100>. */
export const FONT_LADDER = [0.65, 0.72, 0.85, 0.95, 1.05, 1.2, 1.4, 1.6, 1.85, 2.4];

/**
 * Scale factor for the player's Font Size setting (0-4 => 16..24 px over an 18 px base).
 * @returns {number} Factor.
 */
export function fontFactor() {
  const step = Number(safe(() => Configuration.getUser().uiFontScale, 1));
  const px = 16 + 2 * (Number.isFinite(step) ? Math.max(0, Math.min(4, step)) : 1);
  return px / 18;
}

/**
 * Publish --dg-fs-* on an element.
 * @param {HTMLElement} node Root element.
 */
export function applyFontScale(node) {
  const f = fontFactor();
  for (const v of FONT_LADDER) node.style.setProperty("--dg-fs-" + Math.round(v * 100), (v * f).toFixed(4) + "rem");
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

  /**
   * Close on Cancel / Escape, the way base-game screens do in 1.5.0 (a DOM listener on the root;
   * no global input handler is installed, so map input is never affected).
   * @param {any} ev The engine-input event.
   */
  _handleEngineInput(ev) {
    if (ev?.detail?.status !== InputActionStatuses.FINISH) return;
    if (ev.isCancelInput?.() || ev.detail.name === "sys-menu") {
      ev.stopPropagation();
      ev.preventDefault();
      // On a game's page, Cancel steps back to the Hall of Fame; from there it closes the screen.
      if (viewState.detail) {
        viewState.detail = null;
        this._render();
      } else {
        this.close();
      }
    }
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
    renderHallOfFame(host, { mode: "shell" });
  }
}

// initializeImmediately: in 1.5.0 Controls.define only records a definition; tags are wired up in
// one pass at startup. This module is imported after engine.whenReady, which is after that pass,
// so without the flag the screen element is created with no component and ContextManager.push
// throws. Watched in game 2026-09-22.
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
