// demographics-audio.js
//
// Thin defensive wrapper around Audio.playSound for our custom <div>
// click handlers — pills, chart labels, ring nodes — which don't get the
// auto-emit behavior that fxs-* widgets pick up from data-audio-*-ref.
//
// The engine resolves a sound by looking up Component.audio[group][id]
// and falling back to Component.audio["audio-base"][id]. Passing "none"
// for either argument silences the call.
//
// Never throws. The audio subsystem isn't always present (observer mode,
// headless contexts, save previews); a missing Audio object is normal
// and silent.

const DBG = false;
function dlog(...a) {
  if (DBG) console.warn("[Demographics.audio]", ...a);
}

export function safePlaySound(id, group) {
  try {
    if (typeof Audio !== "undefined" && Audio && typeof Audio.playSound === "function") {
      Audio.playSound(id, group);
      dlog("playSound", id, "group=", group);
    }
  } catch (_) {
    /* swallow */
  }
}

// Shorthand for the activate cue from audio-screen-unlocks; used at
// most pill / chart-label click sites.
export function playActivate() {
  safePlaySound("data-audio-activate", "audio-screen-unlocks");
}

export default safePlaySound;
