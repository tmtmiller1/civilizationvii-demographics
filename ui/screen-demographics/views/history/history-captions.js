// history-captions.js
// Metric explanation captions and popovers for Historical Data view.

import { t } from "/demographics/ui/core/demographics-i18n.js";

/**
 * @returns {{ triggerText: string, title: string, bodyHtml: string }}
 */
function gdpCaption() {
  return {
    triggerText: t("LOC_DEMOGRAPHICS_CAPTION_GDP_TRIGGER"),
    title: t("LOC_DEMOGRAPHICS_CAPTION_GDP_TITLE"),
    bodyHtml: t("LOC_DEMOGRAPHICS_CAPTION_GDP_BODY")
  };
}

/**
 * @returns {{ triggerText: string, title: string, bodyHtml: string }}
 */
function approvalCaption() {
  return {
    triggerText: t("LOC_DEMOGRAPHICS_CAPTION_APPROVAL_TRIGGER"),
    title: t("LOC_DEMOGRAPHICS_CAPTION_APPROVAL_TITLE"),
    bodyHtml: t("LOC_DEMOGRAPHICS_CAPTION_APPROVAL_BODY")
  };
}

/**
 * Append per-metric explanation caption(s) for the active metric.
 * @param {HTMLElement} host
 * @param {string} activeMetric
 */
export function appendMetricCaptions(host, activeMetric) {
  if (activeMetric === "gdp") {
    host.appendChild(buildMetricInfoCaption(gdpCaption()));
  }
  if (activeMetric === "approval") {
    host.appendChild(buildMetricInfoCaption(approvalCaption()));
  }
}

/**
 * @param {{ triggerText: string, title: string, bodyHtml: string }} opts
 * @returns {HTMLElement}
 */
function buildMetricInfoCaption(opts) {
  const wrap = document.createElement("div");
  wrap.className = "demographics-metric-info demographics-history-metric-info";
  const trigger = buildCaptionTrigger(opts.triggerText);
  const popover = buildCaptionPopover(opts);

  wrap.appendChild(popover);
  wireCaptionHover(trigger, popover);
  return wrap;
}

/**
 * Build the compact caption trigger.
 * @param {string} text Trigger text.
 * @returns {HTMLElement} Trigger element.
 */
function buildCaptionTrigger(text) {
  const trigger = document.createElement("div");
  trigger.className = "demographics-chart-caption-compact font-body text-xs";
  trigger.textContent = text;
  return trigger;
}

/**
 * Build the metric caption popover body.
 * @param {{ triggerText: string, title: string, bodyHtml: string }} opts
 *   Caption text bundle.
 * @returns {HTMLElement} Popover element.
 */
function buildCaptionPopover(opts) {
  const popover = document.createElement("div");
  popover.className =
    "demographics-metric-info-popover demographics-tip-chrome font-body text-xs";
  popover.style.display = "none";

  const title = document.createElement("div");
  title.className = "demographics-metric-info-title font-title text-sm";
  title.textContent = opts.title;
  popover.appendChild(title);

  const body = document.createElement("div");
  body.className = "demographics-metric-info-body";
  body.innerHTML = opts.bodyHtml;
  popover.appendChild(body);
  return popover;
}

/**
 * Wire hover interactions for trigger and popover.
 * @param {HTMLElement} trigger Trigger element.
 * @param {HTMLElement} popover Popover element.
 */
function wireCaptionHover(trigger, popover) {
  /** @type {ReturnType<typeof setTimeout>|null} */
  let hideTimer = null;

  /** @returns {void} */
  function show() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    popover.style.display = "block";
  }

  /** @returns {void} */
  function scheduleHide() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      popover.style.display = "none";
    }, 200);
  }

  trigger.addEventListener("mouseenter", show);
  trigger.addEventListener("mouseleave", scheduleHide);
  popover.addEventListener("mouseenter", show);
  popover.addEventListener("mouseleave", scheduleHide);
}
