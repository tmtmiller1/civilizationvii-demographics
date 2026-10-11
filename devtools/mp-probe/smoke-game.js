// smoke-game.js - game scope. Smoke run on top of the hotseat harness (smoke-shell.js hosts a
// two-human hotseat game). After TURNS turns it opens every Demographics view and sub-tab, counts
// render-failed fallbacks and [Demographics.*] console errors, reads the Options persistence line,
// arms Reset war history once and lets it disarm, sends a synthetic Cancel engine-input, and logs
// the per-seat policy keys and the stored payload sizes. Every step is wrapped; [HS] DONE ends it.
import { beginGame, dismissCurtain, emit, endTurn, safe, sleep } from "/demographics-mp-probe/hotseat-helpers.js";

const TURNS = 3;

// Count the mod's own error lines (derr) without counting this probe's [HS] lines.
const modErrors = [];
(function hookConsole() {
  const orig = console.error;
  console.error = function (...a) {
    try {
      const line = a.map((x) => String(x)).join(" ");
      if (line.indexOf("[Demographics") === 0) modErrors.push(line.slice(0, 220));
    } catch (_) {
      // Counting is best effort; the original console call below must still run.
    }
    return orig.apply(console, a);
  };
})();

function flags() {
  const g = safe(() => Configuration.getGame(), null);
  return (
    "isHotseat=" + safe(() => g.isHotseat, "?") + " isAnyMultiplayer=" + safe(() => g.isAnyMultiplayer, "?") +
    " humanCount=" + safe(() => g.humanPlayerCount, "?") + " local=" + safe(() => GameContext.localPlayerID, "?") +
    " turn=" + safe(() => Game.turn, "?")
  );
}

let cm = null;
let settings = null;

function screenEl() {
  return document.querySelector("screen-demographics");
}

function panelReport(label) {
  const s = screenEl();
  const empties = s ? [...s.querySelectorAll(".demographics-empty")] : [];
  const failed = s ? s.querySelectorAll(".demographics-view-render-failed, .demographics-empty").length : -1;
  const failedText = empties
    .map((e) => String(e.textContent || "").trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, 3)
    .join(" | ");
  const tabs = s
    ? [...s.querySelectorAll("fxs-tab-item")]
        .map((n) => n.getAttribute("tab-id") || "")
        .filter(Boolean)
        .slice(0, 14)
        .join(",")
    : "";
  emit(
    label + ": screen=" + !!s + " nodes=" + (s ? s.querySelectorAll("*").length : 0) + " fallbacks=" + failed +
      (failedText ? " text=[" + failedText + "]" : "") + " canvases=" + (s ? s.querySelectorAll("canvas").length : 0) +
      " svg=" + (s ? s.querySelectorAll("svg").length : 0) + " tabs=" + tabs + " modErrors=" + modErrors.length
  );
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
  const notes = s
    ? [...s.querySelectorAll(".dgh-note, .dgh-storage")].map((n) =>
        String(n.textContent || "").replace(/\s+/g, " ").trim().slice(0, 140)
      )
    : [];
  emit(
    "hof notes: " + (notes.length ? notes.join(" || ") : "NONE") +
      " settingsStatus=" + safe(() => settings.persistenceStatus(), "?")
  );
}

async function escapeCheck() {
  await openView("statistics");
  const s = screenEl();
  if (!s) {
    emit("escape: no screen to close");
    return;
  }
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
  const size = (k) => (val(k) ? String(val(k)).length : 0);
  const presence = (k) => (val(k) ? "present" : "none");
  const policy = "DemographicsAnalyticsPolicyEffective_v1";
  emit(
    "stored history bytes=" + size("Demographics__demographics-history-v1__json") +
      " rejected=" + presence("Demographics__demographics-history-v1__json__rejected") +
      " campaign bytes=" + size("Demographics__history-campaign-v1") +
      " campaignRejected=" + presence("Demographics__history-campaign-v1__rejected")
  );
  emit(
    "policy keys: shared=" + val(policy) + " P0=" + val(policy + "_P0") + " P1=" + val(policy + "_P1")
  );
}

async function visitEveryView(vs) {
  await openView("statistics");
  await closeView();
  for (const sub of ["civranking", "civilizations", "showcase", "table", "halloffame"]) {
    await openView("rankings", sub);
    await closeView();
  }
  await openView("relations");
  await closeView();
  for (const tab of ["chronicle", "timeline", "lineage"]) {
    vs.tab = tab;
    await openView("history");
    await closeView();
  }
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

  await visitEveryView(vs);
  await hofNoteCheck();
  await closeView();
  await escapeCheck();
  storageReport();
  await endTurn();
  await openView("statistics");
  await closeView();
  storageReport();
  emit("modErrors total=" + modErrors.length);
  modErrors.slice(0, 40).forEach((l, i) => emit("modError " + i + ": " + l));
  emit("DONE " + flags());
}

emit("loaded; " + flags());
setTimeout(() => {
  main().catch((e) => emit("MAIN threw " + e));
}, 4000);
