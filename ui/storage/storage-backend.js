// storage-backend.js
//
// Tutorial property-bag accessors and engine-key hashing for history storage.

let noHashWarned = false;

function engineHashAvailable() {
  return typeof Database !== "undefined" && typeof Database.makeHash === "function";
}

/** @param {(...a: any[]) => void} logError */
function warnNoEngineHash(logError) {
  if (noHashWarned) return;
  noHashWarned = true;
  logError(
    "Database.makeHash unavailable; history persistence is disabled this session " +
      "(no fallback hash is used, to avoid silently desyncing from engine keys). " +
      "In-memory history still works until the UI reloads."
  );
}

/** @param {string} text */
function dbHash(text) {
  return Database.makeHash(text);
}

function resolveLocalPid() {
  return typeof GameContext.localObserverID !== "undefined" && GameContext.localObserverID >= 0
    ? GameContext.localObserverID
    : typeof GameContext.localPlayerID !== "undefined" && GameContext.localPlayerID >= 0
      ? GameContext.localPlayerID
      : -1;
}

/** @param {*} player Player handle. */
function hasTutorialBag(player) {
  return !!(
    player &&
    player.Tutorial &&
    typeof player.Tutorial.setProperty === "function" &&
    typeof player.Tutorial.getProperty === "function"
  );
}

function playerRuntimeAvailable() {
  return (
    typeof GameContext !== "undefined" &&
    typeof Players !== "undefined" &&
    typeof Players.get === "function"
  );
}

/**
 * Resolve per-player Tutorial property store.
 * @param {{
 *   catalogScope: string,
 *   logError?: (...a: any[]) => void
 * }} options Resolver options.
 * @returns {{
 *   pid: number,
 *   read: (key: string) => string | null,
 *   write: (key: string, val: string) => void
 * } | null}
 */
export function getPlayerStore(options) {
  const catalogScope = options.catalogScope;
  const logError = options.logError || (() => {});
  try {
    if (!engineHashAvailable()) {
      warnNoEngineHash(logError);
      return null;
    }
    if (!playerRuntimeAvailable()) return null;
    const pid = resolveLocalPid();
    if (pid < 0) return null;
    const player = Players.get(pid);
    if (!player || !hasTutorialBag(player)) return null;
    const tutorial = player.Tutorial;
    return {
      pid,
      read: (key) => tutorial.getProperty(dbHash("_" + catalogScope + "__" + key)),
      write: (key, val) => tutorial.setProperty(dbHash("_" + catalogScope + "__" + key), val)
    };
  } catch (e) {
    logError("getPlayerStore threw:", e);
    return null;
  }
}

function configApiAvailable() {
  return (
    typeof Configuration !== "undefined" &&
    typeof Configuration.getGame === "function" &&
    typeof Configuration.editGame === "function"
  );
}

/**
 * Resolve the GameConfiguration key-value store: the durable backend that
 * survives quit→load and the age transition (unlike the Tutorial bag). Keys are
 * plain strings; handles are fetched fresh per call.
 * @param {{
 *   catalogScope: string,
 *   logError?: (...a: any[]) => void
 * }} options Resolver options.
 * @returns {{
 *   pid: number,
 *   read: (key: string) => string | null,
 *   write: (key: string, val: string) => void
 * } | null}
 */
export function getConfigStore(options) {
  const catalogScope = options.catalogScope;
  const logError = options.logError || (() => {});
  try {
    if (!configApiAvailable()) return null;
    /**
     * @param {string} key Logical key.
     * @returns {string} Namespaced GameConfiguration key.
     */
    const keyName = (key) => "Demographics__" + catalogScope + "__" + key;
    return {
      pid: -1,
      read: (key) => {
        const g = Configuration.getGame();
        const v = g && typeof g.getValue === "function" ? g.getValue(keyName(key)) : null;
        return typeof v === "string" ? v : null;
      },
      write: (key, val) => {
        const e = Configuration.editGame();
        if (e && typeof e.setValue === "function") e.setValue(keyName(key), val);
      }
    };
  } catch (e) {
    logError("getConfigStore threw:", e);
    return null;
  }
}

/**
 * Resolve global GameTutorial fallback store.
 * @param {{
 *   catalogScope: string,
 *   logError?: (...a: any[]) => void
 * }} options Resolver options.
 * @returns {{
 *   pid: number,
 *   read: (key: string) => string | null,
 *   write: (key: string, val: string) => void
 * } | null}
 */
export function getGlobalStore(options) {
  const catalogScope = options.catalogScope;
  const logError = options.logError || (() => {});
  try {
    if (!engineHashAvailable()) {
      warnNoEngineHash(logError);
      return null;
    }
    if (typeof GameTutorial === "undefined") return null;
    if (
      typeof GameTutorial.getProperty !== "function" ||
      typeof GameTutorial.setProperty !== "function"
    ) {
      return null;
    }
    return {
      pid: -1,
      read: (key) => GameTutorial.getProperty(dbHash("_" + catalogScope + "__" + key)),
      write: (key, val) =>
        GameTutorial.setProperty(dbHash("_" + catalogScope + "__" + key), val)
    };
  } catch (e) {
    logError("getGlobalStore threw:", e);
    return null;
  }
}
