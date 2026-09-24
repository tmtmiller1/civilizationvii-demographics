// screen-lifecycle-support.js
//
// Lifecycle helpers for ScreenDemographics: the close-on-Cancel engine-input test, the Chart.js
// teardown run on detach, and the visible fallback for a view whose render threw. The screen
// class owns when each runs.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { teardownExistingChart, reclaimOrphanedCharts } from "/demographics/ui/screen-demographics/charts/line/chart-line.js";

/**
 * Whether an `engine-input` event is the FINISH of a Cancel / Escape action (`isCancelInput()` or
 * the `sys-menu` action), the way base-game screens test it. False, never a throw, when
 * the InputActionStatuses global is absent off-engine.
 * @param {*} ev The engine-input event.
 * @returns {boolean} True when the screen should close.
 */
export function isCancelEngineInput(ev) {
  if (typeof InputActionStatuses === "undefined") return false;
  if (ev?.detail?.status !== InputActionStatuses.FINISH) return false;
  return !!(ev.isCancelInput?.() || ev.detail.name === "sys-menu");
}

/**
 * Build the `engine-input` listener that closes the screen on Cancel / Escape: consumes the event
 * and calls `close`. Bind once per screen instance so the add/remove pair matches.
 * @param {() => void} close Closes the screen (already guarded by the caller).
 * @returns {(ev: *) => void} The listener.
 */
export function makeCancelInputListener(close) {
  return (ev) => {
    if (!isCancelEngineInput(ev)) return;
    try {
      ev.stopPropagation();
      ev.preventDefault();
    } catch (_) {
      // A stub event without these methods still closes the screen.
    }
    close();
  };
}

/**
 * Destroy the Chart.js instance cached on every chart host under `root`. Hosts are found by class
 * (`.demographics-chart-host`, the Historical Data host) and by walking up from each canvas (the
 * boards and radar hosts carry no shared class); an element is torn down once.
 * @param {*} root The screen root element.
 * @returns {number} How many chart instances were destroyed.
 */
export function destroyChartsUnder(root) {
  if (!root || typeof root.querySelectorAll !== "function") return 0;
  /** @type {Set<*>} */
  const hosts = new Set();
  for (const el of root.querySelectorAll(".demographics-chart-host")) hosts.add(el);
  for (const canvas of root.querySelectorAll("canvas")) {
    let node = canvas.parentNode;
    for (let depth = 0; node && depth < 4; depth++) {
      if (node._demographicsChart) hosts.add(node);
      node = node.parentNode;
    }
  }
  let destroyed = 0;
  for (const host of hosts) {
    if (!host._demographicsChart) continue;
    teardownExistingChart(host);
    destroyed++;
  }
  // Hosts already detached by an earlier view/page swap are not under `root` and so are invisible
  // to the walk above — without this, closing the screen reclaimed none of them (watched 1.5.0).
  return destroyed + reclaimOrphanedCharts();
}

/**
 * The visible fallback for a view whose render threw: the chart-render-failed empty-state text,
 * so the player sees a message instead of a blank tab (the error itself goes to UI.log).
 * @returns {HTMLElement} The fallback element.
 */
export function renderFailedFallback() {
  const msg = document.createElement("div");
  msg.className = "demographics-empty demographics-view-render-failed font-body text-base";
  msg.textContent = t("LOC_DEMOGRAPHICS_EMPTY_CHART_RENDER_FAILED");
  return msg;
}
