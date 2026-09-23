// smoke-game.js - game scope. Hardening smoke run on top of the hotseat harness (hs-shell.js hosts a
// two-human hotseat game). After TURNS turns it opens every Demographics view and sub-tab, counts
// render-failed fallbacks and [Demographics.*] console errors, reads the Options persistence line,
// arms Reset war history once and lets it disarm, sends a synthetic Cancel engine-input, and logs
// the per-seat policy keys and the stored payload sizes. Every step is wrapped; [HS] DONE ends it.
// Installed as hs-game.js by run-smoke.sh so the probe modinfo is unchanged.

const TAG = "[HS] ";
function emit(m) { try { console.error(TAG + m); } catch (_) {} }
function safe(fn, fb) { try { const v = fn(); return v === undefined ? fb : v; } catch (e) { emit("threw " + String(e && e.message || e).slice(0, 160)); return fb; } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TURNS = 3;

// Count the mod's own error lines (derr) without counting this probe's [HS] lines.
const modErrors = [];
(function hookConsole() {
  const orig = console.error;
  console.error = function (...a) {
    try {
      const line = a.map((x) => String(x)).join(" ");
      if (line.indexOf("[Demographics") === 0) modErrors.push(line.slice(0, 220));
    } catch (_) { /* ignore */ }
    return orig.apply(console, a);
  };
})();

function flags() {
  const g = safe(() => Configuration.getGame(), null);
  return "isHotseat=" + safe(() => g.isHotseat, "?") + " isAnyMultiplayer=" + safe(() => g.isAnyMultiplayer, "?") +
    " humanCount=" + safe(() => g.humanPlayerCount, "?") + " local=" + safe(() => GameContext.localPlayerID, "?") +
    " turn=" + safe(() => Game.turn, "?");
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
    const btn = [...c.querySelectorAll("fxs-button, fxs-hero-button, button, [role=button]")]
      .find((b) => /START_TURN|Start turn/i.test(String(b.getAttribute?.("caption") || b.textContent || "")));
    if (btn) { btn.dispatchEvent(new CustomEvent("action-activate", { bubbles: true })); btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); }
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
  emit("turn did not advance from " + before + "/p" + local);
}

let cm = null;
let settings = null;

function screenEl() { return document.querySelector("screen-demographics"); }

function panelReport(label) {
  const s = screenEl();
  const empties = s ? [...s.querySelectorAll(".demographics-empty")] : [];
  const failed = s ? s.querySelectorAll(".demographics-view-render-failed, .demographics-empty").length : -1;
  const failedText = empties.map((e) => String(e.textContent || "").trim().slice(0, 60)).filter(Boolean).slice(0, 3).join(" | ");
  const tabs = s ? [...s.querySelectorAll("fxs-tab-item")].map((n) => n.getAttribute("tab-id") || "").filter(Boolean).slice(0, 14).join(",") : "";
  emit(label + ": screen=" + !!s + " nodes=" + (s ? s.querySelectorAll("*").length : 0) + " fallbacks=" + failed +
    (failedText ? " text=[" + failedText + "]" : "") + " canvases=" + (s ? s.querySelectorAll("canvas").length : 0) +
    " svg=" + (s ? s.querySelectorAll("svg").length : 0) + " tabs=" + tabs + " modErrors=" + modErrors.length);
}

async function openView(view, subTab) {
  safe(() => settings.setSetting("pendingReturnView", view), undefined);
  if (subTab) safe(() => settings.setSetting("settlementsSubTab", subTab), undefined);
  safe(() => cm.push("screen-demographics", { singleton: true, createMouseGuard: true }), undefined);
  await sleep(4500);
  panelReport("view " + view + (subTab ? "/" + subTab : ""));
}

async function closeView() {
  safe(() => cm.pop("screen-demographics"), undefined);
  await sleep(1200);
}

async function hofNoteCheck() {
  // The settings-persistence notice lives on the Hall of Fame page (the in-screen Options view is
  // not mounted anywhere; the mod's options are in the native Options screen under Mods).
  await openView("rankings", "halloffame");
  const s = screenEl();
  const notes = s ? [...s.querySelectorAll(".dgh-note, .dgh-storage")].map((n) => String(n.textContent || "").replace(/\s+/g, " ").trim().slice(0, 140)) : [];
  emit("hof notes: " + (notes.length ? notes.join(" || ") : "NONE") + " settingsStatus=" + safe(() => settings.persistenceStatus(), "?"));
}

async function escapeCheck() {
  await openView("statistics");
  const s = screenEl();
  if (!s) { emit("escape: no screen to close"); return; }
  const status = safe(() => InputActionStatuses.FINISH, undefined);
  emit("escape: InputActionStatuses.FINISH=" + status);
  const ev = new CustomEvent("engine-input", { bubbles: true, cancelable: true, detail: { name: "sys-menu", status } });
  s.dispatchEvent(ev);
  await sleep(1500);
  const gone = !screenEl() || !screenEl().isConnected;
  emit("escape: screen closed by synthetic sys-menu engine-input=" + gone);
  if (!gone) await closeView();
}

function storageReport() {
  const g = safe(() => Configuration.getGame(), null);
  const val = (k) => safe(() => g.getValue(k), null);
  const hist = val("Demographics__demographics-history-v1__json");
  emit("stored history bytes=" + (hist ? String(hist).length : 0) + " rejected=" + (val("Demographics__demographics-history-v1__json__rejected") ? "present" : "none") +
    " campaign bytes=" + (val("Demographics__history-campaign-v1") ? String(val("Demographics__history-campaign-v1")).length : 0) +
    " campaignRejected=" + (val("Demographics__history-campaign-v1__rejected") ? "present" : "none"));
  emit("policy keys: shared=" + val("DemographicsAnalyticsPolicyEffective_v1") + " P0=" + val("DemographicsAnalyticsPolicyEffective_v1_P0") + " P1=" + val("DemographicsAnalyticsPolicyEffective_v1_P1"));
}

async function main() {
  emit("HELLO game; " + flags());
  const started = await beginGame();
  emit("started=" + started + "; " + flags());
  await sleep(4000);
  await dismissCurtain();
  for (let i = 0; i < TURNS; i += 1) await endTurn();
  emit("after turns: " + flags() + " modErrors=" + modErrors.length);
  settings = (await import("/demographics/ui/core/demographics-settings.js")).default;
  cm = (await import("/core/ui/context-manager/context-manager.js")).default;
  const vs = (await import("/demographics/ui/history/views/history-state.js")).viewState;

  await openView("statistics"); await closeView();
  for (const sub of ["civranking", "civilizations", "showcase", "table", "halloffame"]) { await openView("rankings", sub); await closeView(); }
  await openView("relations"); await closeView();
  for (const tab of ["chronicle", "timeline", "lineage"]) { vs.tab = tab; await openView("history"); await closeView(); }
  await hofNoteCheck(); await closeView();
  await escapeCheck();
  storageReport();
  await endTurn();
  await openView("statistics"); await closeView();
  storageReport();
  emit("modErrors total=" + modErrors.length);
  modErrors.slice(0, 40).forEach((l, i) => emit("modError " + i + ": " + l));
  emit("DONE " + flags());
}

emit("loaded; " + flags());
setTimeout(() => { main().catch((e) => emit("MAIN threw " + e)); }, 4000);
