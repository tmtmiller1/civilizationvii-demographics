// smoke-shell.js - shell scope (hardening smoke run). Hands-free HOTSEAT game: two human seats plus AIs, so a multiplayer
// game runs on one machine. Logs [HS] lines to UI.log. Steps:
//   1. reset the game configuration to HOTSEAT and host a hotseat lobby
//   2. when the lobby exists, take seat 1 as a second human and mark the local player ready
//   3. Network.startGame() (the host may start directly; the countdown is UI sugar)
// The game-scope driver (hs-game.js) takes over once the game has loaded.

const TAG = "[HS] ";
function emit(m) { try { console.error(TAG + m); } catch (_) {} }
function safe(fn, fb) { try { const v = fn(); return v === undefined ? fb : v; } catch (e) { emit("threw " + e); return fb; } }

let started = false;

function takeSeatAndStart() {
  if (started) return;
  started = true;
  const g = safe(() => Configuration.getGame(), null);
  emit("lobby: isHotseat=" + safe(() => g.isHotseat, "?") + " isAnyMultiplayer=" + safe(() => g.isAnyMultiplayer, "?") + " players=" + safe(() => g.humanPlayerCount, "?"));
  const p1 = safe(() => Configuration.editPlayer(1), null);
  if (p1) {
    safe(() => p1.setSlotStatus(SlotStatus.SS_TAKEN), undefined);
    safe(() => p1.setAsMajorCiv(), undefined);
    emit("seat 1: status=" + safe(() => Configuration.getPlayer(1).slotStatus, "?") + " human=" + safe(() => Configuration.getPlayer(1).isHuman, "?"));
  } else emit("no editPlayer(1)");
  for (let i = 0; i < 6; i += 1) {
    const pc = safe(() => Configuration.getPlayer(i), null);
    if (pc) emit("slot " + i + ": status=" + safe(() => pc.slotStatus, "?") + " human=" + safe(() => pc.isHuman, "?") + " civ=" + safe(() => pc.civilizationTypeName, "?"));
  }
  if (!safe(() => Network.isPlayerStartReady(GameContext.localPlayerID), false)) safe(() => Network.toggleLocalPlayerStartReady(), undefined);
  emit("ready=" + safe(() => Network.isPlayerStartReady(GameContext.localPlayerID), "?") + " host=" + safe(() => Network.getHostPlayerId(), "?") + " local=" + safe(() => GameContext.localPlayerID, "?"));
  setTimeout(() => { emit("calling Network.startGame()"); safe(() => Network.startGame(), undefined); }, 3000);
}

function main() {
  emit("HELLO shell; hosting hotseat");
  safe(() => Configuration.editGame()?.reset(GameModeTypes.HOTSEAT), undefined);
  // Pin the map size: a stale lobby configuration once carried a size the platform rejects ("Map size
  // unsupported, you cannot join this game") and the run sat behind that dialog. Tiny also loads fastest.
  safe(() => Configuration.editMap()?.setMapSize("MAPSIZE_TINY"), undefined);
  safe(() => GameSetup.setGameParameterValue("MapSize", "MAPSIZE_TINY"), undefined);
  emit("map size now " + safe(() => Configuration.getMap().mapSizeType, "?") + " / " + safe(() => String(GameSetup.findGameParameter("MapSize")?.value?.value), "?"));
  // Dismiss any modal dialog the lobby raises, logging its text once, so the run never waits on a click.
  const seen = new Set();
  setInterval(() => {
    for (const box of document.querySelectorAll("screen-dialog-box, .dialog-box, [class*='dialog-box']")) {
      const text = String(box.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160);
      if (!seen.has(text)) { seen.add(text); emit("DIALOG: " + text); }
      const btn = box.querySelector("fxs-button, fxs-hero-button, button");
      if (btn) { btn.dispatchEvent(new CustomEvent("action-activate", { bubbles: true })); btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); }
    }
  }, 2000);
  window.addEventListener("multiplayer-create-complete", () => { emit("lobby created (event)"); setTimeout(takeSeatAndStart, 2500); });
  const r = safe(() => Network.hostMultiplayerGame(ServerType.SERVER_TYPE_HOTSEAT), "threw");
  emit("hostMultiplayerGame -> " + r);
  // Fallback: if the event name differs, poll for a lobby state.
  let n = 0;
  const poll = setInterval(() => {
    n += 1;
    const inLobby = safe(() => Network.getHostPlayerId() >= 0, false) || safe(() => Configuration.getGame().isHotseat, false);
    if (inLobby && n >= 3) { clearInterval(poll); emit("lobby detected (poll)"); takeSeatAndStart(); }
    if (n > 40) { clearInterval(poll); emit("no lobby after 80s"); }
  }, 2000);
}

emit("loaded");
setTimeout(main, 8000);
