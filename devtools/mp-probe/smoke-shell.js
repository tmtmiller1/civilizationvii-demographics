// smoke-shell.js - shell scope for the smoke run. Hosts the same two-human hotseat game as
// hotseat-shell.js, and also pins the map size and clicks through any lobby dialog so the run never
// waits on a person. The game-scope driver (smoke-game.js) takes over once the game has loaded.
import { emit, hostHotseat, press, safe } from "/demographics-mp-probe/hotseat-helpers.js";

// Pin the map size: a stale lobby configuration can carry a size the platform rejects ("Map size
// unsupported, you cannot join this game") and the run then sits behind that dialog. Tiny also loads fastest.
function pinMapSize() {
  safe(() => Configuration.editMap()?.setMapSize("MAPSIZE_TINY"), undefined);
  safe(() => GameSetup.setGameParameterValue("MapSize", "MAPSIZE_TINY"), undefined);
  emit(
    "map size now " + safe(() => Configuration.getMap().mapSizeType, "?") +
      " / " + safe(() => String(GameSetup.findGameParameter("MapSize")?.value?.value), "?")
  );
}

// Dismiss any modal dialog the lobby raises, logging its text once, so the run never waits on a click.
function autoDismissDialogs() {
  const seen = new Set();
  setInterval(() => {
    for (const box of document.querySelectorAll("screen-dialog-box, .dialog-box, [class*='dialog-box']")) {
      const text = String(box.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160);
      if (!seen.has(text)) {
        seen.add(text);
        emit("DIALOG: " + text);
      }
      const btn = box.querySelector("fxs-button, fxs-hero-button, button");
      if (btn) press(btn);
    }
  }, 2000);
}

function main() {
  emit("HELLO shell; hosting hotseat");
  safe(() => Configuration.editGame()?.reset(GameModeTypes.HOTSEAT), undefined);
  pinMapSize();
  autoDismissDialogs();
  hostHotseat();
}

emit("loaded");
setTimeout(main, 8000);
