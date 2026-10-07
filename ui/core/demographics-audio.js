// demographics-audio.js
//
// Thin defensive wrapper around Audio.playSound for custom <div> click handlers, which don't get
// the auto-emit behavior fxs-* widgets pick up from data-audio-*-ref. The engine resolves a sound
// via Component.audio[group][id], falling back to "audio-base"; "none" silences the call.

const DBG = false;
/**
 * @param {...*} a
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.audio]", ...a);
}

/**
 * Play an engine sound by id. Never throws: the audio subsystem is absent in
 * observer mode, headless contexts and save previews, and a missing `Audio`
 * object there is normal.
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
    // sound is optional; see the note above
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
