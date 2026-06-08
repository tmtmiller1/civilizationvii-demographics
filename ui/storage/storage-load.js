// storage-load.js
//
// Load-path helper functions for demographics history persistence.

/**
 * Read raw payload text from a store.
 * @param {{ read: (key: string) => string | null }} store Active store.
 * @param {string} payloadKey Store payload key.
 * @param {(...a: any[]) => void} derr Error logger.
 * @returns {string | null} Raw payload or null.
 */
export function readRaw(store, payloadKey, derr) {
  try {
    return store.read(payloadKey);
  } catch (e) {
    derr("store.read threw:", e);
    return null;
  }
}

/**
 * Resolve the empty-persistence recovery path.
 * @param {{
 *   mem: any,
 *   seed: string | number,
 *   version: number,
 *   store: { pid: number, write: (key: string, value: string) => void },
 *   payloadKey: string,
 *   emptyHistory: (seed: string | number, version: number) => any,
 *   dlog: (...a: any[]) => void,
 *   derr: (...a: any[]) => void
 * }} options Recovery options.
 * @returns {any} Recovered in-memory history or new empty history.
 */
export function loadEmpty(options) {
  const { mem, seed, version, store, payloadKey, emptyHistory, dlog, derr } = options;
  if (mem && mem.samples && mem.samples.length > 0) {
    dlog(
      "load: persistent empty, recovering from _mem (samples=" +
        mem.samples.length +
        " pid=" +
        store.pid +
        ")"
    );
    try {
      store.write(payloadKey, JSON.stringify(mem));
    } catch (e) {
      derr("_loadEmpty: recovery store.write threw:", e);
    }
    return mem;
  }
  dlog("load: no existing history (pid=" + store.pid + ")");
  return emptyHistory(seed, version);
}

/**
 * Parse and validate a raw payload.
 * @param {{
 *   raw: string,
 *   mem: any,
 *   seed: string | number,
 *   version: number,
 *   store: { pid: number },
 *   emptyHistory: (seed: string | number, version: number) => any,
 *   isValid: (value: any, version: number) => boolean,
 *   normalize: (value: any) => any,
 *   preferMemWhenNewer: (parsed: any, store: { pid: number }) => any,
 *   dlog: (...a: any[]) => void,
 *   derr: (...a: any[]) => void
 * }} options Parse options.
 * @returns {any} Parsed/reconciled history.
 */
export function loadParsed(options) {
  const {
    raw,
    mem,
    seed,
    version,
    store,
    emptyHistory,
    isValid,
    normalize,
    preferMemWhenNewer,
    dlog,
    derr
  } = options;

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    derr("load: JSON parse failed, resetting:", e);
    return mem || emptyHistory(seed, version);
  }

  if (!isValid(parsed, version)) {
    derr("load: malformed history, resetting", parsed && parsed.version);
    return mem || emptyHistory(seed, version);
  }

  normalize(parsed);
  const reconciled = preferMemWhenNewer(parsed, store);
  dlog(
    "load: ok pid=" +
      store.pid +
      " samples=" +
      reconciled.samples.length +
      " ageBoundaries=" +
      reconciled.ageBoundaries.length +
      " bytes=" +
      raw.length
  );
  return reconciled;
}
