// storage-backend.js
//
// Tutorial property-bag accessors and engine-key hashing for history storage.

let noHashWarned = false;

/**
 * Whether the engine hashing API is available.
 * @returns {boolean}
 */
function engineHashAvailable() {
  return typeof Database !== "undefined" && typeof Database.makeHash === "function";
}

/**
 * Warn once when the engine hash API is missing.
 * @param {(...a: any[]) => void} derr Error logger.
 */
function warnNoEngineHash(derr) {
  if (noHashWarned) return;
  noHashWarned = true;
  derr(
    "Database.makeHash unavailable — history persistence DISABLED this session " +
      "(no fallback hash is used, to avoid silently desyncing from engine keys). " +
      "In-memory history still works until the UI reloads."
  );
}

/**
 * Hash a key using engine hashing.
 * @param {string} text Input key text.
 * @returns {number} 32-bit hash.
 */
function dbHash(text) {
  return Database.makeHash(text);
}

/**
 * Resolve the local player id.
 * @returns {number}
 */
function resolveLocalPid() {
  return typeof GameContext.localObserverID !== "undefined" && GameContext.localObserverID >= 0
    ? GameContext.localObserverID
    : typeof GameContext.localPlayerID !== "undefined" && GameContext.localPlayerID >= 0
      ? GameContext.localPlayerID
      : -1;
}

/**
 * Whether a player has a usable Tutorial property bag.
 * @param {*} player Player handle.
 * @returns {boolean}
 */
function hasTutorialBag(player) {
  return !!(
    player &&
    player.Tutorial &&
    typeof player.Tutorial.setProperty === "function" &&
    typeof player.Tutorial.getProperty === "function"
  );
}

/**
 * Whether player-store runtime globals are available.
 * @returns {boolean}
 */
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
 *   derr?: (...a: any[]) => void
 * }} options Resolver options.
 * @returns {{
 *   pid: number,
 *   read: (key: string) => string | null,
 *   write: (key: string, val: string) => void
 * } | null}
 */
export function getPlayerStore(options) {
  const catalogScope = options.catalogScope;
  const derr = options.derr || (() => {});
  try {
    if (!engineHashAvailable()) {
      warnNoEngineHash(derr);
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
    derr("getPlayerStore threw:", e);
    return null;
  }
}

/**
 * Whether the GameConfiguration key-value API is available.
 * @returns {boolean}
 */
function configApiAvailable() {
  return (
    typeof Configuration !== "undefined" &&
    typeof Configuration.getGame === "function" &&
    typeof Configuration.editGame === "function"
  );
}

/**
 * Resolve the GameConfiguration key-value store - the durable backend that
 * survives quit→load AND the age transition (unlike the Tutorial bag). Keys are
 * plain strings (GameConfiguration is not the shared localStorage surface, so no
 * hashing / single-key discipline is required); handles are fetched fresh per
 * call, mirroring the validated spike.
 * @param {{
 *   catalogScope: string,
 *   derr?: (...a: any[]) => void
 * }} options Resolver options.
 * @returns {{
 *   pid: number,
 *   read: (key: string) => string | null,
 *   write: (key: string, val: string) => void
 * } | null}
 */
export function getConfigStore(options) {
  const catalogScope = options.catalogScope;
  const derr = options.derr || (() => {});
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
    derr("getConfigStore threw:", e);
    return null;
  }
}

/**
 * Resolve global GameTutorial fallback store.
 * @param {{
 *   catalogScope: string,
 *   derr?: (...a: any[]) => void
 * }} options Resolver options.
 * @returns {{
 *   pid: number,
 *   read: (key: string) => string | null,
 *   write: (key: string, val: string) => void
 * } | null}
 */
export function getGlobalStore(options) {
  const catalogScope = options.catalogScope;
  const derr = options.derr || (() => {});
  try {
    if (!engineHashAvailable()) {
      warnNoEngineHash(derr);
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
    derr("getGlobalStore threw:", e);
    return null;
  }
}
