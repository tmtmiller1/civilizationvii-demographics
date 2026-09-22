// history-bootstrap-shell.js
//
// Main-menu (shell) entry: defines the screen and adds the main-menu button. No game is read here;
// the Hall of Fame shows the archive only. A failure here is contained so the menu always loads.

import { derr } from "/demographics/ui/history/core/history-log.js";

function boot() {
  import("/demographics/ui/history/screen/screen-hall-of-fame.js").catch((e) => derr("screen failed", e));
  import("/demographics/ui/history/screen/history-mainmenu.js")
    .then((m) => m.installMainMenuButton())
    .catch((e) => derr("main menu button failed", e));
}

engine.whenReady.then(boot).catch((/** @type {any} */ e) => derr("whenReady failed", e));
