// Test double for the engine options modules — `/core/ui/options/model-options.js` and
// `/core/ui/options/options-helpers.js` — wired in by tests/loader.mjs (both paths resolve here, so
// it's one shared instance). Records `addOption`/`addInitCallback` calls so the options-registration
// test can assert what the mod registers, without a live Civ runtime.

/** Mutable category registry (mod-options.js sets `CategoryType.Mods = "mods"` on load). */
export const CategoryType = {};
/** @type {Record<string, any>} */
export const CategoryData = {};
export const OptionType = {
  Checkbox: "checkbox",
  Dropdown: "dropdown",
  Slider: "slider",
  Stepper: "stepper",
  Switch: "switch"
};

/** @type {any[]} */
const registered = [];
/** @type {Array<() => void>} */
const initCallbacks = [];

export const Options = {
  /** @param {any} spec */
  addOption(spec) {
    registered.push(spec);
  },
  /** @param {() => void} cb */
  addInitCallback(cb) {
    initCallbacks.push(cb);
  }
};

/**
 * Drain the queued init callbacks (what the engine does when the options screen initializes) and
 * return the option specs registered as a result. Idempotent: clears prior captures first.
 * @returns {any[]} The registered option specs.
 */
export function __collectRegisteredOptions() {
  registered.length = 0;
  for (const cb of initCallbacks) cb();
  return registered.slice();
}
