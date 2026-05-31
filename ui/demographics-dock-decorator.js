// demographics-dock-decorator.js
//
// Registers a button on the bottom subsystem dock via
// Controls.decorate('panel-sub-system-dock', factory). The vanilla
// panel's createButton (panel-sub-system-dock.js, around line 252)
// attaches `.ssb__button-icon` plus any modifierClass we pass to an
// inner <div>; we hook into that to paint our icon.
//
// Icon delivery is CSS-only: a selector of the form
//     .ssb__button-icon.demographics { background-image: url(…); }
// pointing at a file-shipped SVG via fs://game/demographics/…. Same
// approach as vanilla (.tech, .civic) and the community precedents
// (wonders-screen-continued, sloth-global-relations-panel).
//
// Coherent's CSS parser does not honor data: URIs in background-image
// for fs://-loaded stylesheets, so the asset must be shipped as a file.

/**
 * The vanilla subsystem-dock panel handle passed to a decorator factory. Only
 * the surface this decorator touches is modeled; the rest is the untyped
 * engine boundary.
 * @typedef {Object} SubSystemDockPanel
 * @property {(opts: DockButtonOptions) => (HTMLElement | null | undefined)} [addButton]
 *   Adds a button to the dock, returning the created element.
 */

/**
 * Options accepted by {@link SubSystemDockPanel.addButton}.
 * @typedef {Object} DockButtonOptions
 * @property {string} tooltip Localization key for the hover tooltip.
 * @property {string} modifierClass Class added to the inner `.ssb__button-icon` div.
 * @property {() => void} callback Activation handler.
 * @property {string[]} class Extra classes for the button element.
 * @property {string} audio Activate-cue audio ref.
 * @property {string} focusedAudio Focus-cue audio ref.
 */

const DBG = true;
/**
 * Debug logger, no-op unless {@link DBG} is set.
 * @param {...*} a Values to log.
 * @returns {void}
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.dock]", ...a);
}
/**
 * Error logger; always emits.
 * @param {...*} a Values to log.
 * @returns {void}
 */
function derr(...a) {
  console.error("[Demographics.dock]", ...a);
}

dlog("module evaluating");

const ICON_URL = "fs://game/demographics/images/demographics-icon.svg";

/**
 * Inject the one-time `<style>` that paints our dock-button icon from the
 * file-shipped SVG. Idempotent: re-runs are a no-op once the style exists.
 * @returns {void}
 */
function injectIconStyle() {
  if (document.getElementById("demographics-dock-icon-style")) return;
  const style = document.createElement("style");
  style.id = "demographics-dock-icon-style";
  // Vanilla `.ssb__button-icon` is already absolute/centered/contain
  // (panel-sub-system-dock.css:364-372). We just supply the image and
  // tame the sizing so the bars don't bleed to the button edges.
  style.textContent =
    `.ssb__button-icon.demographics {` +
    ` background-image: url("${ICON_URL}");` +
    ` background-size: 60%;` +
    ` background-position: center;` +
    ` background-repeat: no-repeat;` +
    ` }`;
  document.head.appendChild(style);
  dlog("icon style injected (fs:// url)");
}

/**
 * Decorator for the vanilla subsystem dock that adds the Demographics button
 * and opens the Demographics screen when it is activated.
 */
export class DemographicsDockDecorator {
  /**
   * @param {SubSystemDockPanel} val The panel handle supplied by the factory.
   */
  constructor(val) {
    dlog("constructor called; panel keys:", val ? Object.keys(val).slice(0, 10) : "(no val)");
    /** @type {SubSystemDockPanel} */
    this._panel = val;
  }

  /**
   * Lifecycle hook fired before the panel attaches.
   * @returns {void}
   */
  beforeAttach() {
    dlog("beforeAttach");
  }

  /**
   * Lifecycle hook fired after the panel attaches: paints the icon style and
   * registers our dock button.
   * @returns {void}
   */
  afterAttach() {
    dlog("afterAttach: about to call this._panel.addButton");
    try {
      injectIconStyle();
    } catch (e) {
      derr("injectIconStyle threw:", e);
    }
    this._addDockButton();
  }

  /**
   * Add the Demographics button to the dock, defensively. Never throws.
   * @returns {void}
   */
  _addDockButton() {
    try {
      if (!this._panel || typeof this._panel.addButton !== "function") {
        derr("panel.addButton missing; aborting");
        return;
      }
      const btn = this._panel.addButton({
        tooltip: "LOC_DEMOGRAPHICS_OPEN",
        modifierClass: "demographics",
        callback: this.openScreen.bind(this),
        class: ["tut-demographics", "demographics-dock-button"],
        audio: "data-audio-tab-selected",
        focusedAudio: "data-audio-focus-small"
      });
      dlog("addButton returned:", btn ? btn.tagName : btn);
    } catch (e) {
      derr("addButton THREW:", e);
    }
  }

  /**
   * Lifecycle hook fired before the panel detaches.
   * @returns {void}
   */
  beforeDetach() {
    dlog("beforeDetach");
  }
  /**
   * Lifecycle hook fired after the panel detaches.
   * @returns {void}
   */
  afterDetach() {
    dlog("afterDetach");
  }

  /**
   * Button activation handler: dynamic-imports the engine context manager and
   * pushes the Demographics screen. Never throws.
   * @returns {void}
   */
  openScreen() {
    dlog("button activated; about to push screen-demographics");
    try {
      import("/core/ui/context-manager/context-manager.js")
        .then((m) => {
          const ContextManager = /** @type {any} */ (m.default || m.ContextManager || m);
          ContextManager.push("screen-demographics", { singleton: true, createMouseGuard: true });
          dlog("ContextManager.push returned");
        })
        .catch((e) => derr("context-manager import failed:", e));
    } catch (e) {
      derr("openScreen threw:", e);
    }
  }
}

try {
  if (typeof Controls !== "undefined" && typeof Controls.decorate === "function") {
    dlog("about to call Controls.decorate('panel-sub-system-dock', factory)");
    Controls.decorate("panel-sub-system-dock", (val) => new DemographicsDockDecorator(val));
    dlog("decorator registered");
  } else {
    derr("Controls.decorate unavailable; skipping registration");
  }
} catch (e) {
  derr("Controls.decorate THREW:", e);
}
