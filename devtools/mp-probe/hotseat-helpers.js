// hotseat-helpers.js - shared by the hotseat and smoke drivers, shell and game scope. Every line goes
// to UI.log with the [HS] tag (console.error reaches UI.log; console.log does not), and every engine
// call goes through safe() so a thrown JS error is logged instead of stopping the run.

const TAG = "[HS] ";

export function emit(m) {
  try {
    console.error(TAG + m);
  } catch (_) {
    // A console that refuses the call must not stop the run.
  }
}

export function safe(fn, fb) {
  try {
    const v = fn();
    return v === undefined ? fb : v;
  } catch (e) {
    emit("threw " + String((e && e.message) || e).slice(0, 160));
    return fb;
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Shell scope: take seat 1 as a second human, mark the local player ready and start the game. The
// host may start directly; the lobby countdown is UI sugar. Runs once, whichever lobby signal fires.
let started = false;

function logSlots() {
  for (let i = 0; i < 6; i += 1) {
    const pc = safe(() => Configuration.getPlayer(i), null);
    if (pc) {
      emit(
        "slot " + i + ": status=" + safe(() => pc.slotStatus, "?") + " human=" + safe(() => pc.isHuman, "?") +
          " civ=" + safe(() => pc.civilizationTypeName, "?")
      );
    }
  }
}

export function takeSeatAndStart() {
  if (started) return;
  started = true;
  const g = safe(() => Configuration.getGame(), null);
  emit(
    "lobby: isHotseat=" + safe(() => g.isHotseat, "?") + " isAnyMultiplayer=" + safe(() => g.isAnyMultiplayer, "?") +
      " players=" + safe(() => g.humanPlayerCount, "?")
  );
  const p1 = safe(() => Configuration.editPlayer(1), null);
  if (p1) {
    safe(() => p1.setSlotStatus(SlotStatus.SS_TAKEN), undefined);
    safe(() => p1.setAsMajorCiv(), undefined);
    emit(
      "seat 1: status=" + safe(() => Configuration.getPlayer(1).slotStatus, "?") +
        " human=" + safe(() => Configuration.getPlayer(1).isHuman, "?")
    );
  } else {
    emit("no editPlayer(1)");
  }
  logSlots();
  if (!safe(() => Network.isPlayerStartReady(GameContext.localPlayerID), false)) {
    safe(() => Network.toggleLocalPlayerStartReady(), undefined);
  }
  emit(
    "ready=" + safe(() => Network.isPlayerStartReady(GameContext.localPlayerID), "?") +
      " host=" + safe(() => Network.getHostPlayerId(), "?") + " local=" + safe(() => GameContext.localPlayerID, "?")
  );
  setTimeout(() => {
    emit("calling Network.startGame()");
    safe(() => Network.startGame(), undefined);
  }, 3000);
}

// Shell scope: reset the configuration to HOTSEAT, host a hotseat lobby, and take the seat once the
// lobby exists. The poll is a fallback in case the create-complete event name differs.
export function hostHotseat() {
  window.addEventListener("multiplayer-create-complete", () => {
    emit("lobby created (event)");
    setTimeout(takeSeatAndStart, 2500);
  });
  const r = safe(() => Network.hostMultiplayerGame(ServerType.SERVER_TYPE_HOTSEAT), "threw");
  emit("hostMultiplayerGame -> " + r);
  let n = 0;
  const poll = setInterval(() => {
    n += 1;
    const inLobby =
      safe(() => Network.getHostPlayerId() >= 0, false) || safe(() => Configuration.getGame().isHotseat, false);
    if (inLobby && n >= 3) {
      clearInterval(poll);
      emit("lobby detected (poll)");
      takeSeatAndStart();
    }
    if (n > 40) {
      clearInterval(poll);
      emit("no lobby after 80s");
    }
  }, 2000);
}

// Game scope: press Begin Game (UI.notifyUIReady) until the loading state reports the game is running.
export async function beginGame() {
  for (let i = 0; i < 120; i += 1) {
    safe(() => UI.notifyUIReady(), undefined);
    if (safe(() => UI.getGameLoadingState(), 0) === 8) return true;
    await sleep(1500);
  }
  return false;
}

function curtain() {
  return document.querySelector("hotseat-curtain") || document.getElementById("hotseat-screen-curtain");
}

// Fire both the engine's action-activate and a DOM click, since buttons listen for one or the other.
export function press(node) {
  node.dispatchEvent(new CustomEvent("action-activate", { bubbles: true }));
  node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function startTurnButton(c) {
  return [...c.querySelectorAll("fxs-button, fxs-hero-button, button, [role=button]")].find((b) =>
    /START_TURN|Start turn/i.test(String(b.getAttribute?.("caption") || b.textContent || ""))
  );
}

// Game scope: click Start Turn on the hotseat curtain until it goes away; halfway through, tell the
// network layer the curtain is down in case the button never appears. `verbose` logs every attempt.
export async function dismissCurtain(verbose) {
  for (let i = 0; i < 10; i += 1) {
    const c = curtain();
    if (!c) return false;
    if (verbose) emit("curtain up; dismissing (try " + i + ")");
    const btn = startTurnButton(c);
    if (btn) {
      press(btn);
    } else if (verbose) {
      const captions = [...c.querySelectorAll("[caption]")].map((n) => n.getAttribute("caption")).join(",");
      emit("no start-turn button among " + c.querySelectorAll("*").length + " nodes; captions=" + captions);
    }
    await sleep(1500);
    if (!curtain()) return true;
    if (i === 4) safe(() => Network.hotseatCurtainChanged(false), undefined);
  }
  return !curtain();
}

function sendTurnComplete() {
  safe(() => UI.Player.deselectAllUnits(), undefined);
  safe(() => GameContext.sendTurnComplete(), undefined);
}

// Game scope: end the current seat's turn and wait until the turn number or the local seat changes,
// re-sending the end-turn request every ninth second in case the first one was dropped.
export async function endTurn(verbose) {
  await dismissCurtain(verbose);
  const before = safe(() => Game.turn, -1);
  const local = safe(() => GameContext.localPlayerID, -1);
  sendTurnComplete();
  for (let i = 0; i < 40; i += 1) {
    await sleep(1500);
    await dismissCurtain(verbose);
    const now = safe(() => Game.turn, -1);
    const nl = safe(() => GameContext.localPlayerID, -1);
    if (now !== before || nl !== local) {
      emit("turn " + before + "/p" + local + " -> " + now + "/p" + nl);
      return;
    }
    if (i % 6 === 5) sendTurnComplete();
  }
  const blocker = verbose ? "; blocker=" + safe(() => Game.Notifications.getEndTurnBlockingType(local), "?") : "";
  emit("turn did not advance from " + before + "/p" + local + blocker);
}
