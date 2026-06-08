// relations-viewer-controls.js
//
// Viewer dropdown controls for the Global Relations city-state tab.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { dlog } from "/demographics/ui/screen-demographics/views/relations/relations-shared.js";

/**
 * Resolve selected viewer index from dropdown event payload.
 * @param {*} event Dropdown event payload.
 * @param {number} itemCount Dropdown item count.
 * @returns {number|null} Selected index, or null when invalid.
 */
function viewerSelectionIndex(event, itemCount) {
  const idx = /** @type {*} */ (event)?.detail?.selectedIndex;
  if (typeof idx !== "number") return null;
  if (idx < 0 || idx >= itemCount) return null;
  return idx;
}

/**
 * Persist selected CS viewer pid to settings (best effort).
 * @param {*} rs Render state.
 * @param {number} pid Viewer pid.
 */
function persistViewerPid(rs, pid) {
  try {
    rs.settings?.setSetting?.("relationsCsViewerPid", pid);
  } catch (_) {
    // settings persistence is best-effort; in-memory state is authoritative.
  }
}

/**
 * Handle CS viewer dropdown selection changes.
 * @param {*} rs Render state.
 * @param {{ pid: number }[]} items Dropdown items.
 * @param {*} event Dropdown event payload.
 */
function onViewerSelectionChange(rs, items, event) {
  const idx = viewerSelectionIndex(event, items.length);
  if (idx === null) return;
  const newPid = items[idx].pid;
  if (newPid === rs.csViewerPid) return;
  rs.csViewerPid = newPid;
  persistViewerPid(rs, newPid);
  dlog("CS viewer changed to pid", newPid);
  rs.repaint();
}

/**
 * Append the "Viewer" label before the CS-viewer dropdown.
 * @param {HTMLElement} viewerHost The viewer host element.
 */
function appendViewerLabel(viewerHost) {
  const lbl = document.createElement("div");
  lbl.className = "demographics-relations-viewer-label font-body text-xs";
  lbl.textContent = t("LOC_DEMOGRAPHICS_LABEL_VIEWER");
  lbl.style.color = "#f3e7c4";
  lbl.style.marginRight = "0.5rem";
  viewerHost.appendChild(lbl);
}

/**
 * Build the CS-tab viewer dropdown into the viewer host (no-op off CS tab).
 * @param {*} rs The render-loop state.
 */
export function buildViewerDropdownPanel(rs) {
  const { viewerHost } = rs.sc;
  while (viewerHost.firstChild) viewerHost.removeChild(viewerHost.firstChild);
  if (!(rs.topTab === "cs" && rs.metIds.length > 0)) return;

  appendViewerLabel(viewerHost);

  const items = rs.metIds.map((/** @type {number} */ pid) => {
    const info = rs.namesBase[pid] || {};
    const isYou = pid === rs.localId;
    const baseName = info.leaderName || t("LOC_DEMOGRAPHICS_PLAYER_YOU");
    const nm = isYou
      ? t("LOC_DEMOGRAPHICS_RELATIONS_VIEWER_YOU", baseName)
      : info.leaderName || t("LOC_DEMOGRAPHICS_PLAYER_FALLBACK", pid);
    return { label: nm, id: "viewer_" + pid, pid };
  });
  let selIdx = rs.metIds.indexOf(/** @type {number} */ (rs.csViewerPid));
  if (selIdx < 0) selIdx = 0;
  const dd = document.createElement("fxs-dropdown");
  dd.classList.add("demographics-relations-viewer-dropdown");
  dd.setAttribute("data-audio-group-ref", "audio-panel-diplo-ribbon");
  dd.setAttribute("data-audio-focus-ref", "data-audio-dropdown-focus");
  dd.setAttribute(
    "dropdown-items",
    JSON.stringify(items.map((/** @type {{ label: string }} */ it) => ({ label: it.label })))
  );
  dd.setAttribute("selected-item-index", String(selIdx));
  dd.addEventListener("dropdown-selection-change", (event) =>
    onViewerSelectionChange(rs, items, event)
  );
  viewerHost.appendChild(dd);
}
