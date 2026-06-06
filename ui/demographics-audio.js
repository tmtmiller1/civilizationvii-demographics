// demographics-audio.js
//
// Thin defensive wrapper around Audio.playSound for our custom <div>
// click handlers - pills, chart labels, ring nodes - which don't get the
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
/**
 * Debug logger, no-op unless {@link DBG} is set.
 * @param {...*} a Values to log.
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.audio]", ...a);
}

/**
 * Play an engine sound by id, defensively. Never throws - the audio subsystem
 * is absent in observer mode, headless contexts, and save previews, where a
 * missing `Audio` object is normal and silent.
 * @param {string} id Sound id (e.g. `"data-audio-activate"`); `"none"` silences.
 * @param {string} [group] Sound group; the engine falls back to `"audio-base"`.
 */
export function safePlaySound(id, group) {
  try {
    // `Audio` here is the Civ7 audio manager, not the DOM constructor.
    const mgr = /** @type {any} */ (typeof Audio !== "undefined" ? Audio : null);
    if (mgr && typeof mgr.playSound === "function") {
      mgr.playSound(id, group);
      dlog("playSound", id, "group=", group);
    }
  } catch (_) {
    // Audio (the Civ7 audio manager) is absent in observer/headless/save-preview contexts; sound is optional.
  }
}

/**
 * Play the standard activate cue (from `audio-screen-unlocks`) used at most
 * pill / chart-label / ring-node click sites.
 */
export function playActivate() {
  safePlaySound("data-audio-activate", "audio-screen-unlocks");
}

export default safePlaySound;
