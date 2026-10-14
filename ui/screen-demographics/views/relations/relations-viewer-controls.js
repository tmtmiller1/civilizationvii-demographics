// relations-viewer-controls.js
//
// Viewer dropdown controls for the Global Relations city-state tab.

import { t, tPlayerFallback } from "/demographics/ui/core/demographics-i18n.js";
import { log } from "/demographics/ui/screen-demographics/views/relations/relations-shared.js";

/**
 * @param {*} event
 * @param {number} itemCount
 */
function viewerSelectionIndex(event, itemCount) {
  const selectedIndex = /** @type {*} */ (event)?.detail?.selectedIndex;
  if (typeof selectedIndex !== "number") return null;
  if (selectedIndex < 0 || selectedIndex >= itemCount) return null;
  return selectedIndex;
}

/**
 * @param {*} renderState
 * @param {number} pid
 */
function persistViewerPid(renderState, pid) {
  try {
    renderState.settings?.setSetting?.("relationsCsViewerPid", pid);
  } catch (_) {
    // settings persistence is best-effort; in-memory state is authoritative.
  }
}

/**
 * @param {*} renderState
 * @param {{ pid: number }[]} items
 * @param {*} event
 */
function onViewerSelectionChange(renderState, items, event) {
  const selectedIndex = viewerSelectionIndex(event, items.length);
  if (selectedIndex === null) return;
  const newPid = items[selectedIndex].pid;
  if (newPid === renderState.csViewerPid) return;
  renderState.csViewerPid = newPid;
  persistViewerPid(renderState, newPid);
  log.debug("CS viewer changed to pid", newPid);
  renderState.repaint();
}

/** @param {HTMLElement} viewerHost */
function appendViewerLabel(viewerHost) {
  const label = document.createElement("div");
  label.className = "demographics-relations-viewer-label font-body text-xs";
  label.textContent = t("LOC_DEMOGRAPHICS_LABEL_VIEWER");
  label.style.color = "#f3e7c4";
  label.style.marginRight = "0.5rem";
  viewerHost.appendChild(label);
}

/**
 * Build the CS-tab viewer dropdown into the viewer host (no-op off CS tab).
 * @param {*} renderState
 */
export function buildViewerDropdownPanel(renderState) {
  const { viewerHost } = renderState.sc;
  while (viewerHost.firstChild) viewerHost.removeChild(viewerHost.firstChild);
  if (!(renderState.topTab === "cs" && renderState.metIds.length > 0)) return;

  appendViewerLabel(viewerHost);

  const items = renderState.metIds.map((/** @type {number} */ pid) => {
    const info = renderState.namesBase[pid] || {};
    const isYou = pid === renderState.localId;
    const baseName = info.leaderName || t("LOC_DEMOGRAPHICS_PLAYER_YOU");
    const displayName = isYou
      ? t("LOC_DEMOGRAPHICS_RELATIONS_VIEWER_YOU", baseName)
      : info.leaderName || tPlayerFallback(pid);
    return { label: displayName, id: "viewer_" + pid, pid };
  });
  let selectedIndex = renderState.metIds.indexOf(/** @type {number} */ (renderState.csViewerPid));
  if (selectedIndex < 0) selectedIndex = 0;
  const dropdown = document.createElement("fxs-dropdown");
  dropdown.classList.add("demographics-relations-viewer-dropdown");
  dropdown.setAttribute("data-audio-group-ref", "audio-panel-diplo-ribbon");
  dropdown.setAttribute("data-audio-focus-ref", "data-audio-dropdown-focus");
  dropdown.setAttribute(
    "dropdown-items",
    JSON.stringify(items.map((/** @type {{ label: string }} */ item) => ({ label: item.label })))
  );
  dropdown.setAttribute("selected-item-index", String(selectedIndex));
  dropdown.addEventListener("dropdown-selection-change", (event) =>
    onViewerSelectionChange(renderState, items, event)
  );
  viewerHost.appendChild(dropdown);
}
