// view-options.js
//
// "Options" view: settings panel, history controls, session info.
//
// Checkbox pattern: lifted from vanilla panel-mini-map.js — see
// createShowMinimapCheckbox (around line 707) and createLayerCheckbox
// (around 725) for the canonical form. fxs-checkbox takes a `selected`
// attribute (stringified bool) and emits "component-value-changed"
// (ComponentValueChangeEventName
// defined in core/ui/component-support.js:713) with detail.value: boolean.

import {
  resolveEffectiveCap,
  detectGameSpeedType,
  ADAPTIVE_DEFAULTS_BY_SPEED,
  HARD_MAX_SAMPLES
} from "/demographics/ui/demographics-storage.js";

const DBG = true;
function dlog(...a) {
  if (DBG) console.warn("[Demographics.view-options]", ...a);
}

function makeToggle(label, key, dflt, settings, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "demographics-option-row";

  const cur = settings.getSetting(key, dflt);
  const cb = document.createElement("fxs-checkbox");
  cb.classList.add("demographics-option-checkbox", "mr-2");
  cb.setAttribute("selected", String(!!cur));
  cb.setAttribute("data-audio-group-ref", "options");
  cb.setAttribute("data-audio-focus-ref", "data-audio-checkbox-focus");

  const lbl = document.createElement("div");
  lbl.className = "demographics-option-label font-body text-sm";
  lbl.textContent = label;

  cb.addEventListener("component-value-changed", (event) => {
    const newValue = !!event?.detail?.value;
    settings.setSetting(key, newValue);
    dlog("toggle", key, "=", newValue);
    if (typeof onChange === "function") onChange(newValue);
  });

  wrap.appendChild(cb);
  wrap.appendChild(lbl);
  return wrap;
}

function makeButton(label, handler) {
  const btn = document.createElement("fxs-button");
  btn.setAttribute("caption", label);
  // Audio cue group — Enhancements.md #1. fxs-button auto-emits primary
  // button-press / activate sounds when given a group ref.
  btn.setAttribute("data-audio-group-ref", "options");
  btn.className = "demographics-option-button";
  btn.addEventListener("action-activate", handler);
  btn.addEventListener("click", handler);
  return btn;
}

export function render(host, ctx) {
  // ctx = { settings, storage, sampler, history, requestReload }
  while (host.firstChild) host.removeChild(host.firstChild);

  const wrap = document.createElement("div");
  wrap.className = "demographics-options font-body text-sm";
  host.appendChild(wrap);

  const heading = document.createElement("div");
  heading.className = "demographics-options-heading font-title text-lg uppercase text-secondary";
  heading.textContent = "Options";
  wrap.appendChild(heading);

  // Toggles
  // NOTE: Toggles intentionally DO NOT call ctx.requestReload(). Reload
  // calls renderActiveView() which clears the host and re-renders, which
  // destroys the in-flight checkbox element mid-event and makes the
  // entire options view vanish on click. Settings take effect on next
  // open of History/Factbook — which is fine, since nothing in the
  // Options view itself depends on these toggles.
  //
  // The earlier "Show unmet civs in legend" toggle and this "Show real
  // names for unmet civs" toggle were confusing because both deal with
  // unmet civs in different ways. They now do clearly distinct things:
  //   showUnmetNames = false (default): unmet civs render as "Unmet
  //                                     Civilization" placeholder.
  //   showUnmetNames = true:            real leader + civ names shown
  //                                     for civs the local player
  //                                     hasn't met (spoiler mode).
  // The old `showUnmetCivs` toggle is removed — there's no useful
  // behavior between "hide entirely" and "show as placeholder", and
  // hiding civs from the chart entirely makes ranks misleading.
  wrap.appendChild(
    makeToggle(
      "Show real names for civilizations I haven't met (spoiler)",
      "showUnmetNames",
      false,
      ctx.settings
    )
  );
  wrap.appendChild(
    makeToggle(
      "Colorblind mode (high-contrast Wong palette for chart + relations colors)",
      "colorblindMode",
      false,
      ctx.settings,
      () => ctx.requestReload?.()
    )
  );
  wrap.appendChild(
    makeToggle("Smooth chart lines (3-turn moving average)", "smoothChart", false, ctx.settings)
  );
  wrap.appendChild(
    makeToggle(
      "Show eliminated civs in chart and factbook",
      "showEliminatedCivs",
      true,
      ctx.settings
    )
  );
  wrap.appendChild(
    makeToggle(
      "Show wonder-built markers on chart lines (small icon at the turn each civ completed a wonder)",
      "showWonderMarkers",
      true,
      ctx.settings
    )
  );
  wrap.appendChild(
    makeToggle(
      "Performance mode (buffer storage writes, throttle hover) " +
        "— recommended for long games or slower machines. " +
        "May lose up to 2 turns of history on crash.",
      "perfMode",
      false,
      ctx.settings
    )
  );

  // ── Adaptive history storage cap ─────────────────────────────────
  // Game speed-aware default + user override + decimation toggle.
  // Spec: Enhancements.md "Adaptive History Storage Cap".
  {
    const capRow = document.createElement("div");
    capRow.className = "demographics-option-row";
    const capLbl = document.createElement("div");
    capLbl.className = "demographics-option-label font-body text-sm";
    capLbl.textContent = "History sample cap:";
    capLbl.style.marginRight = "0.6rem";
    capRow.appendChild(capLbl);

    const capOpts = [
      { id: "auto", label: "Auto (game-speed default)" },
      { id: "1000", label: "1,000 samples" },
      { id: "2500", label: "2,500 samples" },
      { id: "5000", label: "5,000 samples" },
      { id: "10000", label: "10,000 samples ⚠ may slow performance" },
      { id: "-1", label: "Unlimited ⚠ very large saves, may slow performance" }
    ];
    const capDd = document.createElement("fxs-dropdown");
    capDd.classList.add("demographics-option-dropdown");
    capDd.setAttribute("data-audio-group-ref", "options");
    capDd.setAttribute("dropdown-items", JSON.stringify(capOpts.map((o) => ({ label: o.label }))));
    const curCapRaw = ctx.settings.getSetting("sampleCapOverride", "auto");
    const curCapKey = typeof curCapRaw === "number" ? String(curCapRaw) : String(curCapRaw);
    let capIdx = capOpts.findIndex((o) => o.id === curCapKey);
    if (capIdx < 0) capIdx = 0;
    capDd.setAttribute("selected-item-index", String(capIdx));
    capDd.addEventListener("dropdown-selection-change", (event) => {
      const i = event?.detail?.selectedIndex;
      if (typeof i !== "number" || i < 0 || i >= capOpts.length) return;
      const chosen = capOpts[i].id;
      // Store as a number when numeric, "auto" otherwise. (-1 = unlimited.)
      if (chosen === "auto") ctx.settings.setSetting("sampleCapOverride", "auto");
      else ctx.settings.setSetting("sampleCapOverride", parseInt(chosen, 10));
      // Force a re-render of this view to refresh the "current effective" hint.
      ctx.requestReload?.();
    });
    capRow.appendChild(capDd);
    wrap.appendChild(capRow);

    // Show the resolved effective cap right under the dropdown so the
    // user can see what "Auto" actually translates to for their game.
    const hint = document.createElement("div");
    hint.className = "demographics-option-hint font-body text-xs";
    const eff = (() => {
      try {
        return resolveEffectiveCap();
      } catch (_) {
        return { cap: Infinity, source: "?" };
      }
    })();
    const speed = (() => {
      try {
        return detectGameSpeedType();
      } catch (_) {
        return null;
      }
    })();
    const speedLbl = speed ? speed.replace(/^GAMESPEED_/, "").toLowerCase() : "unknown";
    const capStr = isFinite(eff.cap) ? eff.cap.toLocaleString() : "unlimited";
    hint.textContent =
      "Current effective cap: " +
      capStr +
      "  ·  Game speed detected: " +
      speedLbl +
      "  ·  Hard ceiling: " +
      HARD_MAX_SAMPLES.toLocaleString();
    wrap.appendChild(hint);

    wrap.appendChild(
      makeToggle(
        "Disable downsampling (keep every turn's sample even after the cap is hit) " +
          "— power-user mode; pair with a high cap or Unlimited.",
        "disableDecimation",
        false,
        ctx.settings
      )
    );

    // ── Polling rate (turns between samples) ────────────────────────
    // Takes effect on the very next PlayerTurnActivated — no restart
    // needed. The sampler reads the setting fresh each turn and skips
    // turns that aren't on cadence.
    const pollRow = document.createElement("div");
    pollRow.className = "demographics-option-row";
    const pollLbl = document.createElement("div");
    pollLbl.className = "demographics-option-label font-body text-sm";
    pollLbl.textContent = "Sample frequency:";
    pollLbl.style.marginRight = "0.6rem";
    pollRow.appendChild(pollLbl);
    const pollOpts = [
      { id: "1", label: "Every turn (default)" },
      { id: "2", label: "Every 2 turns" },
      { id: "5", label: "Every 5 turns" },
      { id: "10", label: "Every 10 turns" },
      { id: "25", label: "Every 25 turns ⚠ coarse graphs" }
    ];
    const pollDd = document.createElement("fxs-dropdown");
    pollDd.classList.add("demographics-option-dropdown");
    pollDd.setAttribute("data-audio-group-ref", "options");
    pollDd.setAttribute(
      "dropdown-items",
      JSON.stringify(pollOpts.map((o) => ({ label: o.label })))
    );
    const curPoll = String(ctx.settings.getSetting("sampleEveryNTurns", 1));
    let pollIdx = pollOpts.findIndex((o) => o.id === curPoll);
    if (pollIdx < 0) pollIdx = 0;
    pollDd.setAttribute("selected-item-index", String(pollIdx));
    pollDd.addEventListener("dropdown-selection-change", (event) => {
      const i = event?.detail?.selectedIndex;
      if (typeof i !== "number" || i < 0 || i >= pollOpts.length) return;
      ctx.settings.setSetting("sampleEveryNTurns", parseInt(pollOpts[i].id, 10));
    });
    pollRow.appendChild(pollDd);
    wrap.appendChild(pollRow);
    const pollHint = document.createElement("div");
    pollHint.className = "demographics-option-hint font-body text-xs";
    pollHint.textContent =
      "Higher values record fewer points — useful for long marathon games. " +
      "Change applies on the next turn; existing samples are kept.";
    wrap.appendChild(pollHint);
  }

  // Buttons
  const btnRow = document.createElement("div");
  btnRow.className = "demographics-options-buttons";
  wrap.appendChild(btnRow);

  btnRow.appendChild(
    makeButton("Refresh sample now", () => {
      try {
        if (ctx.sampler?.sampleNow) {
          ctx.sampler.sampleNow();
          ctx.requestReload?.();
        }
      } catch (_) {
        /* */
      }
    })
  );

  btnRow.appendChild(
    makeButton("Clear history", () => {
      if (typeof window !== "undefined" && typeof window.confirm === "function") {
        if (!window.confirm("Clear all recorded Demographics samples?")) return;
      }
      try {
        ctx.storage?.clear?.();
        ctx.requestReload?.();
      } catch (_) {
        /* */
      }
    })
  );

  btnRow.appendChild(
    makeButton("Reset war history", () => {
      // Wipes only history.wars[] (keeps samples + boundaries). Useful
      // when older war records are out-of-shape from a schema change
      // and are duplicating in the conflicts gantt.
      if (typeof window !== "undefined" && typeof window.confirm === "function") {
        if (!window.confirm("Clear all recorded wars? Sample history and other data will be kept."))
          return;
      }
      try {
        const h = ctx.storage?.load?.();
        if (h) {
          h.wars = [];
          ctx.storage?.save?.(h);
          ctx.requestReload?.();
        }
      } catch (_) {
        /* */
      }
    })
  );

  // Session info.
  const info = document.createElement("div");
  info.className = "demographics-session-info font-body text-xs";
  const samples = ctx.history?.samples?.length || 0;
  const schema = ctx.history?.version ?? "?";
  const backend =
    typeof GameTutorial !== "undefined" && typeof GameTutorial.setProperty === "function"
      ? "GameTutorial"
      : "in-memory";
  info.textContent = "Samples: " + samples + "    Schema: v" + schema + "    Backend: " + backend;
  wrap.appendChild(info);
}
