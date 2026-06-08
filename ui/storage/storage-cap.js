// storage-cap.js
//
// Effective sample-cap and decimation-setting resolution.

import { DemographicsSettings } from "/demographics/ui/core/demographics-settings.js";

/** Absolute ceiling on retained samples, regardless of user override. */
export const HARD_MAX_SAMPLES = 50000;

/** @type {Record<string, number>} */
export const ADAPTIVE_DEFAULTS_BY_SPEED = {
  GAMESPEED_QUICK: 500,
  GAMESPEED_STANDARD: 2000,
  GAMESPEED_EPIC: 3000,
  GAMESPEED_MARATHON: 5000
};

/** Sample cap used when game speed cannot be detected. */
const FALLBACK_DEFAULT = 2000;

/**
 * Read game speed type from hash through GameInfo lookup.
 * @param {*} hash Game.gameSpeed hash.
 * @returns {string | null} Speed type, or null.
 */
function gameSpeedTypeFromHash(hash) {
  if (
    hash !== undefined &&
    hash !== null &&
    typeof GameInfo !== "undefined" &&
    GameInfo.GameSpeeds &&
    typeof GameInfo.GameSpeeds.lookup === "function"
  ) {
    const row = GameInfo.GameSpeeds.lookup(hash);
    if (row && typeof row.GameSpeedType === "string") return row.GameSpeedType;
  }
  return null;
}

/**
 * Read game speed type from engine globals/getters.
 * @returns {string | null} Speed type, or null.
 */
function lookupGameSpeedType() {
  if (typeof Game === "undefined") return null;
  const candidate =
    Game.gameSpeedType ||
    (typeof Game.getGameSpeedType === "function" ? Game.getGameSpeedType() : null);
  if (typeof candidate === "string" && candidate.length > 0) return candidate;
  return gameSpeedTypeFromHash(Game.gameSpeed);
}

/**
 * Detect active game speed type without throwing.
 * @returns {string | null} Speed type, or null.
 */
export function detectGameSpeedType() {
  try {
    return lookupGameSpeedType();
  } catch (_) {
    return null;
  }
}

/**
 * Read raw sample cap override setting.
 * @param {(...a: any[]) => void} derr Error logger.
 * @returns {number | string} Override value, or "auto".
 */
function readSampleCapOverride(derr) {
  try {
    return DemographicsSettings.getSetting("sampleCapOverride", "auto");
  } catch (e) {
    derr("readSampleCapOverride:", e);
    return "auto";
  }
}

/**
 * Convert numeric override into cap/source pair.
 * @param {number} override Override value.
 * @returns {{ cap: number, source: string }} Effective cap.
 */
function capFromNumber(override) {
  if (override < 0) return { cap: Infinity, source: "user:unlimited" };
  return { cap: Math.min(override, HARD_MAX_SAMPLES), source: "user:" + override };
}

/**
 * Convert non-auto string override into cap/source pair.
 * @param {string} override Override string.
 * @returns {{ cap: number, source: string } | null} Effective cap or null.
 */
function capFromString(override) {
  const parsed = parseInt(override, 10);
  if (isFinite(parsed) && parsed !== 0) {
    return capFromNumber(parsed);
  }
  return null;
}

/**
 * Resolve adaptive cap from game speed.
 * @returns {{ cap: number, source: string }} Effective cap.
 */
function adaptiveCap() {
  const speed = detectGameSpeedType();
  const adaptive = (speed && ADAPTIVE_DEFAULTS_BY_SPEED[speed]) || FALLBACK_DEFAULT;
  return { cap: adaptive, source: "auto:" + (speed || "fallback") };
}

/**
 * Resolve effective cap from override or adaptive defaults.
 * @param {(...a: any[]) => void} [derr] Error logger.
 * @returns {{ cap: number, source: string }} Effective cap.
 */
export function resolveEffectiveCap(derr = () => {}) {
  const override = readSampleCapOverride(derr);
  if (typeof override === "number" && isFinite(override) && override !== 0) {
    return capFromNumber(override);
  }
  if (typeof override === "string" && override !== "auto") {
    const fromString = capFromString(override);
    if (fromString) return fromString;
  }
  return adaptiveCap();
}

/**
 * Whether decimation is user-disabled.
 * @param {(...a: any[]) => void} [derr] Error logger.
 * @returns {boolean}
 */
export function decimationDisabled(derr = () => {}) {
  try {
    return !!DemographicsSettings.getSetting("disableDecimation", false);
  } catch (e) {
    derr("decimationDisabled:", e);
    return false;
  }
}
