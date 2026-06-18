// demographics-bootstrap.js
//
// Entry script declared in demographics.modinfo <UIScripts>. Awaits
// engine.whenReady, then dynamic-imports the dock-button decorator and
// starts the per-turn sampler. The two imports are independent so a
// failure in one doesn't prevent the other.
//
// Engine APIs are not safe to touch before whenReady resolves, doing
// so silently kills the module with no stack trace.

const DEMOGRAPHICS_DEBUG = false;

/**
 * Debug logger, no-op unless {@link DEMOGRAPHICS_DEBUG} is set.
 * @param {...*} a Values to log.
 */
function dlog(...a) {
  if (DEMOGRAPHICS_DEBUG) console.warn("[Demographics.bootstrap]", ...a);
}

/**
 * Error logger; always emits (unlike {@link dlog}).
 * @param {...*} a Values to log.
 */
function derr(...a) {
  console.error("[Demographics.bootstrap]", ...a);
}

dlog("loaded; debug=", DEMOGRAPHICS_DEBUG);

/**
 * Dynamic-import the engine contract guard and log a one-line status report.
 * Never rejects - a missing module is logged and swallowed so
 * the rest of bootstrap proceeds; individual features still self-gate via
 * `featureAvailable()`.
 * @returns {Promise<void>} Resolves once the import settles.
 */
function checkContracts() {
  return /** @type {Promise<*>} */ (import("/demographics/ui/core/demographics-contracts.js"))
    .then((mod) => {
      if (typeof mod.logContractReport === "function") mod.logContractReport();
    })
    .catch((e) => {
      derr("contracts import REJECTED:", e);
    });
}

/**
 * Dynamic-import the dock-button decorator for its registration side effect.
 * Never rejects. An import failure is logged and swallowed so the sampler
 * still loads.
 * @returns {Promise<*>} Resolves to the imported module, or `undefined` on failure.
 */
function loadDecorator() {
  dlog("about to dynamic-import demographics-dock-decorator.js");
  return /** @type {Promise<*>} */ (import("/demographics/ui/core/demographics-dock-decorator.js"))
    .then((mod) => {
      dlog("dock-decorator import resolved; module keys:", Object.keys(mod || {}));
      return mod;
    })
    .catch((e) => {
      derr("dock-decorator import REJECTED:", e);
    });
}

/**
 * Dynamic-import the sampler module and invoke its `startSampler` export.
 * Never rejects - a missing export or thrown start is logged and swallowed.
 * @returns {Promise<void>} Resolves once the import settles.
 */
function startSampler() {
  dlog("about to dynamic-import demographics-sampler.js");
  return /** @type {Promise<*>} */ (import("/demographics/ui/sampler/demographics-sampler.js"))
    .then((mod) => {
      dlog("sampler import resolved; keys:", Object.keys(mod || {}));
      try {
        if (typeof mod.startSampler === "function") {
          mod.startSampler();
          dlog("sampler.startSampler() returned");
        } else {
          derr("sampler module missing startSampler export");
        }
      } catch (e) {
        derr("sampler.startSampler threw:", e);
      }
    })
    .catch((e) => {
      derr("sampler import REJECTED:", e);
    });
}

// HoF read-through experiment removed: every HallofFame.set* writer is
// undefined in the UI sandbox, and getGames() returns [] mid-game
// because the DB only commits on game-end. Full inventory of channels
// tested is in ../../demographics-research/.

try {
  if (
    typeof engine !== "undefined" &&
    engine.whenReady &&
    typeof engine.whenReady.then === "function"
  ) {
    dlog("engine.whenReady present; deferring decorator + sampler load");
    engine.whenReady
      .then(() => {
        dlog("engine.whenReady fired");
        checkContracts();
        loadDecorator();
        startSampler();
      })
      .catch((e) => {
        derr("engine.whenReady REJECTED:", e);
        checkContracts();
        loadDecorator(); // best-effort fallback
        startSampler();
      });
  } else {
    derr("engine or engine.whenReady missing ; loading decorator immediately as fallback");
    checkContracts();
    loadDecorator();
    startSampler();
  }
} catch (e) {
  derr("bootstrap top-level threw:", e);
}
