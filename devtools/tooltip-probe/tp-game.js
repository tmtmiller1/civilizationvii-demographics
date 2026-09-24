// tp-game.js - game scope. Probe for the intermittent "line-chart tooltip numbers do not change
// while I scroll across the graph" report.
//
// Why a probe instead of a fix: the fault has never been reproduced from script. Every path that
// can be driven programmatically is correct — the data (232 points), Chart.js hit-testing across
// x, and the DOM render all update per turn when driven through chart._eventHandler. The one step
// that cannot be driven is a REAL mouse hover: GameFace's MouseEvent constructor ignores its init
// dict (`new MouseEvent("mousemove",{clientX:500}).clientX === 0`) and CDP's Input.dispatchMouseEvent
// is accepted but never delivered to the page. So the only way to see the broken step is to watch a
// real hand on a real mouse.
//
// Hover has three stages, and each fails differently:
//   1 NATIVE   a real mousemove reaches the DOM       -> clientX changes
//   2 DERIVED  Chart.js converts it to a chart x      -> _eventHandler receives a changing x
//   3 RENDER   the tooltip DOM is rewritten           -> the header/value text changes
// The probe records all three and, when the cursor has clearly travelled but the rendered text has
// not, prints ONE verdict line naming the first stage that stopped moving. That is the answer.
//
// Durability: the chart canvas is replaced on every re-render, so hooking one canvas is useless
// (an earlier attempt caught zero events for exactly that reason). This hooks
// Chart.prototype._eventHandler once — every instance, present and future — and listens for
// mousemove on `document` in the capture phase, which no canvas swap can detach.
//
// Output goes to Logs/UI.log via console.error (console.log does NOT reach it), so a session can be
// played normally and read back afterwards with:
//   grep 'TOOLTIP-PROBE' ~/Library/Application\ Support/Civilization\ VII/Logs/UI.log

const TAG = "[TOOLTIP-PROBE]";
/** Cursor travel (px) that must be exceeded before a frozen readout counts as a fault. */
const TRAVEL_PX = 60;
/** Samples per evaluation window. */
const WINDOW = 45;
/** Don't repeat an identical verdict more than this many times per session. */
const MAX_REPEATS = 3;

const log = (...a) => {
  try {
    console.error(TAG, ...a);
  } catch (_) {
    // A console that refuses the call must not take the game down with it.
  }
};

/** @type {{nativeX:number[], derivedX:number[], rendered:string[], verdicts:Record<string,number>}} */
const state = { nativeX: [], derivedX: [], rendered: [], verdicts: {} };

/**
 * The text the player is actually reading: tooltip header plus its first value.
 * @returns {string} A comparable signature, or "" when no tooltip is up.
 */
function renderedSignature() {
  try {
    const tip = document.querySelector(".demographics-chart-tooltip");
    if (!tip) return "";
    const head = tip.querySelector(".demographics-line-tip-head");
    const val = tip.querySelector(".demographics-line-tip-val");
    return ((head && head.textContent) || "") + "|" + ((val && val.textContent) || "");
  } catch (_) {
    return "";
  }
}

/**
 * Spread of a numeric sample list.
 * @param {number[]} xs Samples.
 * @returns {number} max - min, or 0 when empty.
 */
function spread(xs) {
  if (!xs.length) return 0;
  let lo = xs[0];
  let hi = xs[0];
  for (const v of xs) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return hi - lo;
}

/**
 * Emit a verdict at most MAX_REPEATS times, so a long session stays readable.
 * @param {string} key Verdict key.
 * @param {string} line The line to log.
 */
function verdict(key, line) {
  const n = (state.verdicts[key] || 0) + 1;
  state.verdicts[key] = n;
  if (n <= MAX_REPEATS) log(line + (n === MAX_REPEATS ? "  (further identical verdicts suppressed)" : ""));
}

/** Evaluate one window of samples and name the first stage that stopped moving. */
function evaluateWindow() {
  const travel = spread(state.nativeX);
  const derivedMoved = spread(state.derivedX) > 2;
  const renderedMoved = new Set(state.rendered.filter(Boolean)).size > 1;
  const sawTooltip = state.rendered.some(Boolean);
  const summary =
    "native=" + state.nativeX.length + "px_travel=" + Math.round(travel) +
    " derived=" + state.derivedX.length + "/moved=" + derivedMoved +
    " renderedDistinct=" + new Set(state.rendered.filter(Boolean)).size;

  if (travel <= TRAVEL_PX) return; // cursor barely moved; nothing to conclude

  if (!state.derivedX.length) {
    verdict("stage1", "★ FAULT stage 1 NATIVE->DERIVED: cursor moved " + Math.round(travel) +
      "px but Chart.js._eventHandler never fired. Something is intercepting the canvas, or the " +
      "listener is detached. " + summary);
    return;
  }
  if (!derivedMoved) {
    verdict("stage2", "★ FAULT stage 2 DERIVED: cursor moved " + Math.round(travel) +
      "px but the x Chart.js derived did not (getRelativePosition). " + summary);
    return;
  }
  if (sawTooltip && !renderedMoved) {
    verdict("stage3", "★ FAULT stage 3 RENDER: cursor and Chart.js x both moved but the tooltip " +
      "text never changed - the external handler is stale or not running. " + summary +
      " frozenText=" + JSON.stringify(state.rendered.find(Boolean) || ""));
    return;
  }
  verdict("ok", "healthy: all three stages moved. " + summary);
}

/** Record one sample and evaluate once the window fills. */
function sample(nativeX, derivedX) {
  if (typeof nativeX === "number") state.nativeX.push(nativeX);
  if (typeof derivedX === "number") state.derivedX.push(derivedX);
  state.rendered.push(renderedSignature());
  if (state.rendered.length < WINDOW) return;
  try {
    evaluateWindow();
  } catch (e) {
    log("evaluate threw", e && e.message);
  }
  state.nativeX = [];
  state.derivedX = [];
  state.rendered = [];
}

/** Hook Chart.prototype once so every chart instance, present and future, is covered. */
function hookChartPrototype() {
  if (typeof Chart === "undefined" || !Chart.prototype || Chart.prototype.__tpHooked) return false;
  const orig = Chart.prototype._eventHandler;
  if (typeof orig !== "function") return false;
  Chart.prototype._eventHandler = function (e, replay) {
    try {
      if (e && e.type === "mousemove") lastDerivedX = e.x;
    } catch (_) {
      // Never let instrumentation break the chart.
    }
    return orig.call(this, e, replay);
  };
  Chart.prototype.__tpHooked = true;
  return true;
}

let lastDerivedX = null;

/** Attach the document-level listener; it survives every canvas swap. */
function attachNativeListener() {
  document.addEventListener(
    "mousemove",
    (ev) => {
      try {
        // Only care about hover over a chart canvas.
        const t = /** @type {*} */ (ev.target);
        const overChart = t && t.tagName === "CANVAS";
        if (!overChart) return;
        const dx = lastDerivedX;
        lastDerivedX = null;
        sample(ev.clientX, typeof dx === "number" ? dx : undefined);
      } catch (_) {
        // Swallow: a probe must never break play.
      }
    },
    true
  );
}

// Live handle, so a CDP session (or a curious console) can read the raw samples and force a
// verdict without waiting for the window to fill:
//   window.__dgTooltipProbe.state      -> the current window's samples
//   window.__dgTooltipProbe.dump()     -> log a verdict for whatever has been collected so far
try {
  /** @type {*} */ (window).__dgTooltipProbe = {
    state,
    hooked: () => !!(typeof Chart !== "undefined" && Chart.prototype && Chart.prototype.__tpHooked),
    dump() {
      log(
        "dump: nativeSamples=" + state.nativeX.length +
          " travel=" + Math.round(spread(state.nativeX)) +
          " derivedSamples=" + state.derivedX.length +
          " derivedSpread=" + Math.round(spread(state.derivedX)) +
          " renderedDistinct=" + new Set(state.rendered.filter(Boolean)).size
      );
      evaluateWindow();
      return state;
    }
  };
} catch (_) {
  // No window (or a frozen one) just means no manual handle; the automatic verdicts still run.
}

/** Keep trying to hook Chart until the engine global exists (it loads with fxs-hof-chart). */
function start() {
  let tries = 0;
  const tick = () => {
    tries += 1;
    if (hookChartPrototype()) {
      log("armed. Hover across a line chart; a verdict prints every " + WINDOW + " samples.");
      return;
    }
    if (tries < 60) setTimeout(tick, 1000);
    else log("Chart global never appeared; probe inactive.");
  };
  tick();
}

attachNativeListener();
start();
