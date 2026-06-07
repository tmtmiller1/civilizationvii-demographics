// history-captions.js
// Metric explanation captions and popovers for Historical Data view.

import { t } from "/demographics/ui/demographics-i18n.js";

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

  const trigger = document.createElement("div");
  trigger.className = "demographics-chart-caption-compact font-body text-xs";
  trigger.textContent = opts.triggerText;
  wrap.appendChild(trigger);

  const popover = document.createElement("div");
  popover.className = "demographics-metric-info-popover demographics-tip-chrome font-body text-xs";
  popover.style.display = "none";
  const title = document.createElement("div");
  title.className = "demographics-metric-info-title font-title text-sm";
  title.textContent = opts.title;
  popover.appendChild(title);
  const body = document.createElement("div");
  body.className = "demographics-metric-info-body";
  body.innerHTML = opts.bodyHtml;
  popover.appendChild(body);
  wrap.appendChild(popover);

  /** @type {ReturnType<typeof setTimeout>|null} */
  let hideTimer = null;

  function show() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    popover.style.display = "block";
  }

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
  return wrap;
}
