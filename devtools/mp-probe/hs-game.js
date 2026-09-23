// hs-game.js - game scope. Drives the hotseat game hs-shell.js hosted:
//   1. press Begin Game (UI.notifyUIReady) until the game has started
//   2. log the multiplayer flags the mod can see
//   3. for TURNS turns: dismiss the hotseat curtain, end the seat's turn, log who is local
//   4. open Demographics on the History tab, switch to Timeline, then Chronicle, then the Hall of
//      Fame page of World Rankings; log every console error in between
//   5. [HS] DONE
// Every step is wrapped, so a thrown JS error is logged instead of stopping the run; a native crash
// simply ends the log, and the runner picks up the crash report.

const TAG = "[HS] ";
function emit(m) { try { console.error(TAG + m); } catch (_) {} }
function safe(fn, fb) { try { const v = fn(); return v === undefined ? fb : v; } catch (e) { emit("threw " + String(e && e.message || e).slice(0, 160)); return fb; } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TURNS = 4;

function flags() {
  const g = safe(() => Configuration.getGame(), null);
  return "isHotseat=" + safe(() => g.isHotseat, "?") + " isAnyMultiplayer=" + safe(() => g.isAnyMultiplayer, "?") +
    " isNetworkMultiplayer=" + safe(() => g.isNetworkMultiplayer, "?") + " humanCount=" + safe(() => g.humanPlayerCount, "?") +
    " local=" + safe(() => GameContext.localPlayerID, "?") + " turn=" + safe(() => Game.turn, "?") +
    " isHost=" + safe(() => Network.isHost?.(), "?") + " hostId=" + safe(() => Network.getHostPlayerId?.(), "?");
}

async function beginGame() {
  for (let i = 0; i < 120; i += 1) {
    safe(() => UI.notifyUIReady(), undefined);
    if (safe(() => UI.getGameLoadingState(), 0) === 8) return true;
    await sleep(1500);
  }
  return false;
}

function curtain() { return document.querySelector("hotseat-curtain") || document.getElementById("hotseat-screen-curtain"); }

async function dismissCurtain() {
  for (let i = 0; i < 10; i += 1) {
    const c = curtain();
    if (!c) return false;
    emit("curtain up; dismissing (try " + i + ")");
    const btn = [...c.querySelectorAll("fxs-button, fxs-hero-button, button, [role=button]")]
      .find((b) => /START_TURN|Start turn/i.test(String(b.getAttribute?.("caption") || b.textContent || "")));
    if (btn) { btn.dispatchEvent(new CustomEvent("action-activate", { bubbles: true })); btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); }
    else emit("no start-turn button among " + c.querySelectorAll("*").length + " nodes; captions=" + [...c.querySelectorAll("[caption]")].map((n) => n.getAttribute("caption")).join(","));
    await sleep(1500);
    if (!curtain()) return true;
    if (i === 4) safe(() => Network.hotseatCurtainChanged(false), undefined);
  }
  return !curtain();
}

async function endTurn() {
  await dismissCurtain();
  const before = safe(() => Game.turn, -1), local = safe(() => GameContext.localPlayerID, -1);
  safe(() => UI.Player.deselectAllUnits(), undefined);
  safe(() => GameContext.sendTurnComplete(), undefined);
  for (let i = 0; i < 40; i += 1) {
    await sleep(1500);
    await dismissCurtain();
    const now = safe(() => Game.turn, -1), nl = safe(() => GameContext.localPlayerID, -1);
    if (now !== before || nl !== local) { emit("turn " + before + "/p" + local + " -> " + now + "/p" + nl); return; }
    if (i % 6 === 5) { safe(() => UI.Player.deselectAllUnits(), undefined); safe(() => GameContext.sendTurnComplete(), undefined); }
  }
  emit("turn did not advance from " + before + "/p" + local + "; blocker=" + safe(() => Game.Notifications.getEndTurnBlockingType(local), "?"));
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
  const tabs = screen ? [...screen.querySelectorAll("fxs-tab-item")].map((n) => n.getAttribute("tab-id") || n.textContent.trim()).slice(0, 12) : [];
  emit("history/" + tab + ": screen=" + !!screen + " dgh-view=" + !!document.querySelector(".dgh-view--" + tab) + " tabs=" + tabs.join("|"));
  const bar = screen && screen.querySelector(".demographics-page-tabs, fxs-tab-bar.demographics-page-tabs");
  if (bar) {
    const item = [...bar.querySelectorAll("fxs-tab-item")].find((n) => /TL_TITLE|Timeline/i.test(n.textContent + (n.getAttribute("tab-id") || "")));
    if (item && tab === "timeline") { item.dispatchEvent(new CustomEvent("action-activate", { bubbles: true })); item.dispatchEvent(new MouseEvent("click", { bubbles: true })); await sleep(3000); emit("timeline tab clicked; view=" + !!document.querySelector(".dgh-view--timeline") + " lanes=" + document.querySelectorAll(".dgh-tl-lane").length + " map=" + !!document.querySelector("canvas")); }
  }
  await sleep(2000);
  safe(() => cm.pop("screen-demographics"), undefined);
  await sleep(1000);
}

async function main() {
  emit("HELLO game; " + flags());
  const started = await beginGame();
  emit("started=" + started + "; " + flags());
  await sleep(4000);
  await dismissCurtain();
  emit("after first curtain: " + flags());
  for (let i = 0; i < TURNS; i += 1) {
    await endTurn();
    emit("after turn step " + i + ": " + flags());
  }
  await openHistory("chronicle");
  await openHistory("timeline");
  await openHistory("timeline");
  // Hall of Fame inside World Rankings
  const settings = (await import("/demographics/ui/core/demographics-settings.js")).default;
  safe(() => settings.setSetting("pendingReturnView", "rankings"), undefined);
  safe(() => settings.setSetting("settlementsSubTab", "halloffame"), undefined);
  const cm = (await import("/core/ui/context-manager/context-manager.js")).default;
  safe(() => cm.push("screen-demographics", { singleton: true, createMouseGuard: true }), undefined);
  await sleep(4000);
  emit("hof: hof-nodes=" + document.querySelectorAll(".dgh-hof-filter, .dgh-storage").length);
  safe(() => cm.pop("screen-demographics"), undefined);
  await endTurn();
  const stored = safe(() => Configuration.getGame().getValue("Demographics__history-campaign-v1"), null);
  let doc = null; try { doc = stored ? JSON.parse(stored) : null; } catch (_) {}
  emit("stored campaign: bytes=" + (stored ? String(stored).length : 0) + " local=" + (doc && doc.local) + " sampledTurns=" + (doc ? doc.series.turns.join(",") : "-") + " events=" + (doc ? doc.events.length : "-"));
  emit("DONE " + flags());
}

emit("loaded; " + flags());
setTimeout(() => { main().catch((e) => emit("MAIN threw " + e)); }, 4000);
