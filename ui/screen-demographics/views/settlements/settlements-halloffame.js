// settlements-halloffame.js
//
// The Hall of Fame sub-tab of World Rankings: every campaign played on this computer, ranked,
// with the current game included live. The history module is imported on first open.

/**
 * Render the Hall of Fame into the World Rankings content host.
 * @param {HTMLElement} content The cleared sub-view host.
 */
export function renderHallOfFameTab(content) {
  import("/demographics/ui/history/views/history-app.js")
    .then((historyApp) => {
      if (content.isConnected === false) return;
      historyApp.renderHallOfFame(content, { mode: "game" });
    })
    .catch((error) => console.error("[Demographics.settlements] Hall of Fame failed to load:", error));
}
