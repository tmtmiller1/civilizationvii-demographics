// sampler-age-context.js
//
// Helpers that read game-wide age/crisis context and current turn/date.

/**
 * @typedef {object} GlobalAgeContext
 * @property {number} [crisisStage] Current crisis stage.
 * @property {number} crisisStageMax Highest stage trigger percent seen.
 * @property {number} [ageProgressPct] Age progress as a percentage.
 * @property {boolean} [ageEnabled] Whether the age crisis is enabled.
 * @property {string} [crisisEventType] Specific crisis event type, if probed.
 */

/**
 * Probe game-setup config for the specific age-crisis event type.
 * @param {(label: string, fn: () => any) => any} safeCall Defensive call wrapper.
 * @returns {string | undefined} Crisis event type, or undefined on miss.
 */
export function probeCrisisEventType(safeCall) {
  return safeCall("probeCrisisEventType", () => {
    if (typeof Configuration === "undefined" || !Configuration.getGame) {
      return undefined;
    }
    const cfg = Configuration.getGame();
    if (!cfg || typeof cfg.getValue !== "function") return undefined;
    const keys = [
      "Crisis",
      "CrisisType",
      "AgeCrisis",
      "AgeCrisisEvent",
      "AgeCrisisEventType",
      "CrisisEventType"
    ];
    for (const k of keys) {
      try {
        const v = cfg.getValue(k);
        if (typeof v === "string" && /^[A-Z_]+_CRISIS_[A-Z_]+$/.test(v)) return v;
      } catch (_) {
        // Unknown config keys can throw; continue probing.
      }
    }
    return undefined;
  });
}

/**
 * Read crisis stage and trigger percentages into the output object.
 * @param {GlobalAgeContext} out Mutable output context.
 */
function readCrisisManager(out) {
  const cm = typeof Game !== "undefined" ? Game.CrisisManager : null;
  if (!cm) return;

  if (typeof cm.isCrisisEnabled === "function") {
    out.ageEnabled = !!cm.isCrisisEnabled(0);
  }
  if (typeof cm.getCurrentCrisisStage === "function") {
    const stage = cm.getCurrentCrisisStage(0);
    if (typeof stage === "number" && isFinite(stage)) out.crisisStage = stage;
  }
  out.crisisStageMax = getCrisisStageMax(cm, out.crisisStageMax);
}

/**
 * Get the highest crisis-stage trigger percent currently exposed by the game.
 * @param {*} cm Crisis manager handle.
 * @param {number} seed Current max seed.
 * @returns {number} Highest trigger percent seen.
 */
function getCrisisStageMax(cm, seed) {
  let maxSeen = seed;
  if (typeof cm.getCrisisStageTriggerPercent !== "function") return maxSeen;
  for (let st = 0; st < 4; st++) {
    try {
      const trigger = cm.getCrisisStageTriggerPercent(0, st);
      if (typeof trigger === "number" && isFinite(trigger) && trigger > maxSeen) {
        maxSeen = trigger;
      }
    } catch (_) {
      // Out-of-range stages can throw; keep max seen so far.
    }
  }
  return maxSeen;
}

/**
 * Read age-progress percentage into the output object.
 * @param {GlobalAgeContext} out Mutable output context.
 */
function readAgeProgress(out) {
  const apm = typeof Game !== "undefined" ? Game.AgeProgressManager : null;
  if (!apm) return;

  let cur;
  let max;
  try {
    cur = apm.getCurrentAgeProgressionPoints();
  } catch (_) {
    cur = undefined;
  }
  try {
    max = apm.getMaxAgeProgressionPoints();
  } catch (_) {
    max = undefined;
  }

  if (typeof cur === "number" && typeof max === "number" && max > 0) {
    out.ageProgressPct = (cur / max) * 100;
  }
}

/**
 * Sample game-wide age + crisis context once per snapshot.
 * @param {(label: string, fn: () => any) => any} safeCall Defensive call wrapper.
 * @returns {GlobalAgeContext} Assembled global age context.
 */
export function getGlobalAgeContext(safeCall) {
  /** @type {GlobalAgeContext} */
  const out = {
    crisisStage: undefined,
    crisisStageMax: 0,
    ageProgressPct: undefined,
    ageEnabled: undefined,
    crisisEventType: undefined
  };

  safeCall("crisisAgeGlobal", () => {
    readCrisisManager(out);
    readAgeProgress(out);
  });
  out.crisisEventType = probeCrisisEventType(safeCall);
  return out;
}

/**
 * Read current game turn defensively.
 * @param {(label: string, fn: () => any) => any} safeCall Defensive call wrapper.
 * @returns {number | undefined} Current turn, or undefined.
 */
export function getCurrentTurn(safeCall) {
  return safeCall("Game.turn", () => {
    if (typeof Game !== "undefined" && typeof Game.turn === "number") {
      return Game.turn;
    }
    return undefined;
  });
}

/**
 * Read in-game date label for current turn.
 * @param {(label: string, fn: () => any) => any} safeCall Defensive call wrapper.
 * @returns {string | undefined} Date label, or undefined.
 */
export function readGameYear(safeCall) {
  let gameYear;
  safeCall("getTurnDate", () => {
    if (typeof Game !== "undefined" && typeof Game.getTurnDate === "function") {
      const s = Game.getTurnDate();
      if (typeof s === "string" && s.length > 0) gameYear = s;
    }
  });
  return gameYear;
}
