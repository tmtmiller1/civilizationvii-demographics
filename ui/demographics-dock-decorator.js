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

const DBG = true;
function dlog(...a) {
  if (DBG) console.warn("[Demographics.dock]", ...a);
}
function derr(...a) {
  console.error("[Demographics.dock]", ...a);
}

dlog("module evaluating");

const ICON_URL = "fs://game/demographics/images/demographics-icon.svg";

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

class DemographicsDockDecorator {
  constructor(val) {
    dlog("constructor called; panel keys:", val ? Object.keys(val).slice(0, 10) : "(no val)");
    this._panel = val;
  }

  beforeAttach() {
    dlog("beforeAttach");
  }

  afterAttach() {
    dlog("afterAttach: about to call this._panel.addButton");
    try {
      injectIconStyle();
    } catch (e) {
      derr("injectIconStyle threw:", e);
    }
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

  beforeDetach() {
    dlog("beforeDetach");
  }
  afterDetach() {
    dlog("afterDetach");
  }

  openScreen() {
    dlog("button activated; about to push screen-demographics");
    try {
      import("/core/ui/context-manager/context-manager.js")
        .then((m) => {
          const ContextManager = m.default || m.ContextManager || m;
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
