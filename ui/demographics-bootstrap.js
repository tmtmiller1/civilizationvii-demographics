// demographics-bootstrap.js
//
// Entry script declared in demographics.modinfo <UIScripts>. Awaits
// engine.whenReady, then dynamic-imports the dock-button decorator and
// starts the per-turn sampler. The two imports are independent so a
// failure in one doesn't prevent the other.
//
// Engine APIs are not safe to touch before whenReady resolves — doing
// so silently kills the module with no stack trace.

const DEMOGRAPHICS_DEBUG = true;
function dlog(...a) {
  if (DEMOGRAPHICS_DEBUG) console.warn("[Demographics.bootstrap]", ...a);
}
function derr(...a) {
  console.error("[Demographics.bootstrap]", ...a);
}

dlog("loaded; debug=", DEMOGRAPHICS_DEBUG);

function loadDecorator() {
  dlog("about to dynamic-import demographics-dock-decorator.js");
  return import("/demographics/ui/demographics-dock-decorator.js")
    .then((mod) => {
      dlog("dock-decorator import resolved; module keys:", Object.keys(mod || {}));
      return mod;
    })
    .catch((e) => {
      derr("dock-decorator import REJECTED:", e);
    });
}

function startSampler() {
  dlog("about to dynamic-import demographics-sampler.js");
  return import("/demographics/ui/demographics-sampler.js")
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
        loadDecorator();
        startSampler();
      })
      .catch((e) => {
        derr("engine.whenReady REJECTED:", e);
        loadDecorator(); // best-effort fallback
        startSampler();
      });
  } else {
    derr("engine or engine.whenReady missing — loading decorator immediately as fallback");
    loadDecorator();
    startSampler();
  }
} catch (e) {
  derr("bootstrap top-level threw:", e);
}
