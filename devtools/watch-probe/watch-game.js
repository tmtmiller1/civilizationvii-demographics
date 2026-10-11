// watch-game.js - game scope. Presses Begin Game: nothing the harness does lands before UI.notifyUIReady()
// has been accepted, so spam it until the loading state reports the game is running.
function emit(m) {
  try {
    console.error("[WATCH] game " + m);
  } catch (_) {
    // A console that refuses the call must not stop the watch.
  }
}

function loadingState() {
  try {
    return UI.getGameLoadingState();
  } catch (_) {
    return -1;
  }
}

let n = 0;
const t = setInterval(() => {
  n += 1;
  const state = loadingState();
  try {
    UI.notifyUIReady();
  } catch (_) {
    // Not ready to accept it yet; the next tick tries again.
  }
  if (state === 8) {
    clearInterval(t);
    emit("READY (state 8) after " + n + " ticks");
  } else if (n > 120) {
    clearInterval(t);
    emit("gave up at state " + state);
  } else if (n % 10 === 0) {
    emit("waiting, state " + state);
  }
}, 1000);
emit("attached");
