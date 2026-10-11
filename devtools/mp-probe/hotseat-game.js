// hotseat-game.js - game scope. Drives the hotseat game hotseat-shell.js hosted:
//   1. press Begin Game (UI.notifyUIReady) until the game has started
//   2. log the multiplayer flags the mod can see
//   3. for TURNS turns: dismiss the hotseat curtain, end the seat's turn, log who is local
//   4. open Demographics on the History tab, switch to Timeline, then Chronicle, then the Hall of
//      Fame page of World Rankings; log every console error in between
//   5. [HS] DONE
// Every step is wrapped, so a thrown JS error is logged instead of stopping the run; a native crash
// just ends the log, and the runner picks up the crash report.
import {
  beginGame,
  dismissCurtain,
  emit,
  endTurn,
  press,
  safe,
  sleep
} from "/demographics-mp-probe/hotseat-helpers.js";

const TURNS = 4;

function flags() {
  const g = safe(() => Configuration.getGame(), null);
  return (
    "isHotseat=" + safe(() => g.isHotseat, "?") + " isAnyMultiplayer=" + safe(() => g.isAnyMultiplayer, "?") +
    " isNetworkMultiplayer=" + safe(() => g.isNetworkMultiplayer, "?") +
    " humanCount=" + safe(() => g.humanPlayerCount, "?") +
    " local=" + safe(() => GameContext.localPlayerID, "?") + " turn=" + safe(() => Game.turn, "?") +
    " isHost=" + safe(() => Network.isHost?.(), "?") + " hostId=" + safe(() => Network.getHostPlayerId?.(), "?")
  );
}

async function clickTimelineTab(screen) {
  const bar = screen && screen.querySelector(".demographics-page-tabs, fxs-tab-bar.demographics-page-tabs");
  if (!bar) return;
  const item = [...bar.querySelectorAll("fxs-tab-item")].find((n) =>
    /TL_TITLE|Timeline/i.test(n.textContent + (n.getAttribute("tab-id") || ""))
  );
  if (!item) return;
  press(item);
  await sleep(3000);
  emit(
    "timeline tab clicked; view=" + !!document.querySelector(".dgh-view--timeline") +
      " lanes=" + document.querySelectorAll(".dgh-tl-lane").length + " map=" + !!document.querySelector("canvas")
  );
}

async function openHistory(tab) {
  const settings = (await import("/demographics/ui/core/demographics-settings.js")).default;
  const vs = (await import("/demographics/ui/history/views/history-state.js")).viewState;
  vs.tab = tab;
  safe(() => settings.setSetting("pendingReturnView", "history"), undefined);
  const cm = (await import("/core/ui/context-manager/context-manager.js")).default;
  safe(() => cm.push("screen-demographics", { singleton: true, createMouseGuard: true }), undefined);
  await sleep(4000);
  const screen = document.querySelector("screen-demographics");
  const tabs = screen
    ? [...screen.querySelectorAll("fxs-tab-item")]
        .map((n) => n.getAttribute("tab-id") || n.textContent.trim())
        .slice(0, 12)
    : [];
  emit(
    "history/" + tab + ": screen=" + !!screen + " dgh-view=" + !!document.querySelector(".dgh-view--" + tab) +
      " tabs=" + tabs.join("|")
  );
  if (tab === "timeline") await clickTimelineTab(screen);
  await sleep(2000);
  safe(() => cm.pop("screen-demographics"), undefined);
  await sleep(1000);
}

async function openHallOfFame() {
  const settings = (await import("/demographics/ui/core/demographics-settings.js")).default;
  safe(() => settings.setSetting("pendingReturnView", "rankings"), undefined);
  safe(() => settings.setSetting("settlementsSubTab", "halloffame"), undefined);
  const cm = (await import("/core/ui/context-manager/context-manager.js")).default;
  safe(() => cm.push("screen-demographics", { singleton: true, createMouseGuard: true }), undefined);
  await sleep(4000);
  emit("hof: hof-nodes=" + document.querySelectorAll(".dgh-hof-filter, .dgh-storage").length);
  safe(() => cm.pop("screen-demographics"), undefined);
}

function reportStoredCampaign() {
  const stored = safe(() => Configuration.getGame().getValue("Demographics__history-campaign-v1"), null);
  let doc = null;
  try {
    doc = stored ? JSON.parse(stored) : null;
  } catch (_) {
    // An unparsable payload is reported below as an empty one.
  }
  emit(
    "stored campaign: bytes=" + (stored ? String(stored).length : 0) + " local=" + (doc && doc.local) +
      " sampledTurns=" + (doc ? doc.series.turns.join(",") : "-") + " events=" + (doc ? doc.events.length : "-")
  );
}

async function main() {
  emit("HELLO game; " + flags());
  const started = await beginGame();
  emit("started=" + started + "; " + flags());
  await sleep(4000);
  await dismissCurtain(true);
  emit("after first curtain: " + flags());
  for (let i = 0; i < TURNS; i += 1) {
    await endTurn(true);
    emit("after turn step " + i + ": " + flags());
  }
  await openHistory("chronicle");
  await openHistory("timeline");
  await openHistory("timeline");
  await openHallOfFame();
  await endTurn(true);
  reportStoredCampaign();
  emit("DONE " + flags());
}

emit("loaded; " + flags());
setTimeout(() => {
  main().catch((e) => emit("MAIN threw " + e));
}, 4000);
