// hotseat-shell.js - shell scope. Hands-free HOTSEAT game: two human seats plus AIs, so a multiplayer
// game runs on one machine. Logs [HS] lines to UI.log. Steps:
//   1. reset the game configuration to HOTSEAT and host a hotseat lobby
//   2. when the lobby exists, take seat 1 as a second human and mark the local player ready
//   3. Network.startGame() (the host may start directly; the countdown is UI sugar)
// The game-scope driver (hotseat-game.js) takes over once the game has loaded.
import { emit, hostHotseat, safe } from "/demographics-mp-probe/hotseat-helpers.js";

function main() {
  emit("HELLO shell; hosting hotseat");
  safe(() => Configuration.editGame()?.reset(GameModeTypes.HOTSEAT), undefined);
  hostHotseat();
}

emit("loaded");
setTimeout(main, 8000);
