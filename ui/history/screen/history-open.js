// history-open.js
//
// Opens the Hall of Fame screen from the main menu (no game loaded). In game the Hall of Fame is
// a sub-tab of World Rankings inside the Demographics screen instead.

import { derr } from "/demographics/ui/history/core/history-log.js";

export const SCREEN_ID = "screen-demographics-halloffame";

/** Push the Hall of Fame screen. */
export function openHallOfFame() {
  import("/core/ui/context-manager/context-manager.js")
    .then((m) => {
      const cm = /** @type {any} */ (m.default || m);
      cm.push(SCREEN_ID, { singleton: true, createMouseGuard: true });
    })
    .catch((e) => derr("context manager import failed", e));
}
