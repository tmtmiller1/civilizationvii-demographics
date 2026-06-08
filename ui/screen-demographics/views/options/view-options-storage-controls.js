// view-options-storage-controls.js
//
// Storage-cap, decimation, and polling controls for the Options view.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import {
  resolveEffectiveCap,
  detectGameSpeedType,
  HARD_MAX_SAMPLES
} from "/demographics/ui/storage/demographics-storage.js";

/**
 * @typedef {{ id: string, label: string }} DropdownOption
 */

/**
 * @typedef {{
 *   makeToggle: (
 *     label: string,
 *     key: string,
 *     dflt: boolean,
 *     settings: *,
 *     onChange?: (value: boolean) => void
 *   ) => HTMLElement,
 *   buildDropdownRow: (
 *     labelText: string,
 *     opts: DropdownOption[],
 *     selectedIdx: number,
 *     onSelect: (index: number) => void
 *   ) => HTMLElement
 * }} StorageControlDeps
 */

/**
 * Build the history-sample-cap dropdown row.
 * @param {*} ctx Render context.
 * @param {StorageControlDeps} deps Control dependencies.
 * @returns {HTMLElement} The cap dropdown-row.
 */
function buildHistoryCapControl(ctx, deps) {
  const capOpts = [
    { id: "auto", label: t("LOC_DEMOGRAPHICS_OPT_CAP_AUTO") },
    { id: "1000", label: t("LOC_DEMOGRAPHICS_OPT_CAP_1000") },
    { id: "2500", label: t("LOC_DEMOGRAPHICS_OPT_CAP_2500") },
    { id: "5000", label: t("LOC_DEMOGRAPHICS_OPT_CAP_5000") },
    { id: "10000", label: t("LOC_DEMOGRAPHICS_OPT_CAP_10000") },
    { id: "-1", label: t("LOC_DEMOGRAPHICS_OPT_CAP_UNLIMITED") }
  ];
  const curCapRaw = ctx.settings.getSetting("sampleCapOverride", "auto");
  const curCapKey = typeof curCapRaw === "number" ? String(curCapRaw) : String(curCapRaw);
  let capIdx = capOpts.findIndex((o) => o.id === curCapKey);
  if (capIdx < 0) capIdx = 0;
  return deps.buildDropdownRow(t("LOC_DEMOGRAPHICS_OPT_CAP_LABEL"), capOpts, capIdx, (i) => {
    const chosen = capOpts[i].id;
    if (chosen === "auto") ctx.settings.setSetting("sampleCapOverride", "auto");
    else ctx.settings.setSetting("sampleCapOverride", parseInt(chosen, 10));
    ctx.requestReload?.();
  });
}

/**
 * Build the effective cap + speed hint under the cap dropdown.
 * @returns {HTMLElement} The cap hint element.
 */
function buildHistoryCapHint() {
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
  const speedLbl = speed
    ? speed.replace(/^GAMESPEED_/, "").toLowerCase()
    : t("LOC_DEMOGRAPHICS_OPT_SPEED_UNKNOWN");
  const capStr = isFinite(eff.cap)
    ? eff.cap.toLocaleString()
    : t("LOC_DEMOGRAPHICS_OPT_CAP_UNLIMITED_VALUE");
  hint.textContent = t(
    "LOC_DEMOGRAPHICS_OPT_CAP_HINT",
    capStr,
    speedLbl,
    HARD_MAX_SAMPLES.toLocaleString()
  );
  return hint;
}

/**
 * Build the polling-rate dropdown row.
 * @param {*} ctx Render context.
 * @param {StorageControlDeps} deps Control dependencies.
 * @returns {HTMLElement} The polling dropdown-row.
 */
function buildPollingControl(ctx, deps) {
  const pollOpts = [
    { id: "1", label: t("LOC_DEMOGRAPHICS_OPT_POLL_1") },
    { id: "2", label: t("LOC_DEMOGRAPHICS_OPT_POLL_2") },
    { id: "5", label: t("LOC_DEMOGRAPHICS_OPT_POLL_5") },
    { id: "10", label: t("LOC_DEMOGRAPHICS_OPT_POLL_10") },
    { id: "25", label: t("LOC_DEMOGRAPHICS_OPT_POLL_25") }
  ];
  const curPoll = String(ctx.settings.getSetting("sampleEveryNTurns", 1));
  let pollIdx = pollOpts.findIndex((o) => o.id === curPoll);
  if (pollIdx < 0) pollIdx = 0;
  return deps.buildDropdownRow(t("LOC_DEMOGRAPHICS_OPT_POLL_LABEL"), pollOpts, pollIdx, (i) => {
    ctx.settings.setSetting("sampleEveryNTurns", parseInt(pollOpts[i].id, 10));
  });
}

/**
 * Build the polling-rate hint.
 * @returns {HTMLElement} The polling hint element.
 */
function buildPollingHint() {
  const pollHint = document.createElement("div");
  pollHint.className = "demographics-option-hint font-body text-xs";
  pollHint.textContent = t("LOC_DEMOGRAPHICS_OPT_POLL_HINT");
  return pollHint;
}

/**
 * Build the decimation status line.
 * @param {*} ctx Render context.
 * @returns {HTMLElement} The status hint element.
 */
function buildDecimationStatus(ctx) {
  const hint = document.createElement("div");
  hint.className = "demographics-option-hint font-body text-xs";
  let s = null;
  try {
    s = ctx.storage?.decimationStatus?.() || null;
  } catch (_) {
    // Show empty hint when status cannot be read.
  }
  if (!s) return hint;
  const capStr = isFinite(s.cap) ? String(s.cap) : "∞";
  if (s.disabled) hint.textContent = t("LOC_DEMOGRAPHICS_OPT_DECIMATION_DISABLED");
  else if (s.active) hint.textContent = t("LOC_DEMOGRAPHICS_OPT_DECIMATION_ON", capStr);
  else hint.textContent = t("LOC_DEMOGRAPHICS_OPT_DECIMATION_OFF", capStr);
  return hint;
}

/**
 * Append storage controls in display order.
 * @param {HTMLElement} wrap The options container.
 * @param {*} ctx Render context.
 * @param {StorageControlDeps} deps Control dependencies.
 */
export function appendStorageControlsPanel(wrap, ctx, deps) {
  wrap.appendChild(buildHistoryCapControl(ctx, deps));
  wrap.appendChild(buildHistoryCapHint());
  wrap.appendChild(
    deps.makeToggle(
      t("LOC_DEMOGRAPHICS_OPT_DISABLE_DECIMATION"),
      "disableDecimation",
      false,
      ctx.settings
    )
  );
  wrap.appendChild(buildDecimationStatus(ctx));
  wrap.appendChild(buildPollingControl(ctx, deps));
  wrap.appendChild(buildPollingHint());
}
