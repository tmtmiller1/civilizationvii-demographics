// chart-shared.js
//
// Shared helpers used by 2+ chart render modules: SVG element creation,
// history-sample access, empty-state notices, palette proxy, civ-name
// helpers, the shared X-axis time-unit mode, key-set / turn-range coercion,
// nearest-by-turn lookup, and the stack turn/year map builder.

import { getPalette } from "/demographics/ui/core/demographics-palette.js";
import { DemographicsSettings } from "/demographics/ui/core/demographics-settings.js";
import {
  policyHidesUnmet,
  policyOwnCivOnly,
  isLocalCiv
} from "/demographics/ui/core/demographics-governance.js";

/**
 * @typedef {import(
 *   "/demographics/ui/screen-demographics/charts/line/chart-line.js"
 * ).ChartOptions} ChartOptions
 */

const DBG = false;
/**
 * Debug logger; no-op unless {@link DBG} is set.
 * @param {...*} a Values to log.
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.chart]", ...a);
}

const SVG_NS = "http://www.w3.org/2000/svg";

// Each chart render reads the palette fresh so the colorblind-mode toggle
// in Options takes effect on the very next paint without a mod reload.
// Define PALETTE as a getter so existing `PALETTE[i]` indexing keeps working.
// Typed `any` because the Proxy returns either a number (`.length`) or a color
// string (numeric index) depending on the key - a dynamic shape callers index
// freely.
/** @type {*} */
const PALETTE = new Proxy(/** @type {Record<string, string>} */ ({}), {
  /**
   * @param {Record<string, string>} _ Unused proxy target.
   * @param {string|symbol} prop `"length"` or a numeric index.
   * @returns {*} The palette length or the color at the index.
   */
  get(_, prop) {
    const p = getPalette();
    if (prop === "length") return p.length;
    return p[Number(prop)];
  }
});

/**
 * Create an SVG element with attributes set via `setAttribute`.
 * @param {string} tag SVG tag name.
 * @param {Record<string, *>} [attrs] Attribute map.
 * @returns {SVGElement} The created element.
 */
function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k]);
  return el;
}

/**
 * Read a history blob's `samples` array defensively.
 * @param {DemoHistory|*} history The history blob.
 * @returns {Snapshot[]} The samples, or an empty array.
 */
function historySamples(history) {
  return history && Array.isArray(history.samples) ? history.samples : [];
}

/**
 * Append a standard empty-state / notice element to a host.
 * @param {HTMLElement} host The host element.
 * @param {string} text The notice text.
 */
function appendEmptyNotice(host, text) {
  const msg = document.createElement("div");
  msg.className = "demographics-empty font-body text-base";
  msg.textContent = text;
  host.appendChild(msg);
}

/**
 * Read one sample's civ name for a pid.
 * @param {*} sample One history sample.
 * @param {string} pid Player id key.
 * @returns {string} Civ name, or empty string.
 */
function sampleCivName(sample, pid) {
  const player = sample && sample.players ? sample.players[pid] : null;
  if (!player || typeof player.civName !== "string") return "";
  return player.civName;
}

/**
 * Whether a civ history list should append the candidate name.
 * @param {string[]} list Civ-name history list.
 * @param {string} name Candidate civ name.
 * @returns {boolean} True when candidate should be appended.
 */
function shouldAppendCivName(list, name) {
  if (!name) return false;
  if (list.length > 0 && list[list.length - 1] === name) return false;
  return !list.includes(name);
}

// Walk samples for one pid and return an ORDERED list of unique civ names
// in chronological order. Skips empty/missing civ names.
/**
 * Collect a pid's distinct civ names in chronological first-seen order.
 * @param {Snapshot[]} samples The history sample stream.
 * @param {string} pid Player id key.
 * @returns {string[]} Distinct civ names, chronological.
 */
function collectCivHistory(samples, pid) {
  /** @type {string[]} */
  const list = [];
  for (const s of samples) {
    const nm = sampleCivName(s, pid);
    if (!shouldAppendCivName(list, nm)) continue;
    // Only append when the LATEST civ differs from the previous entry
    // - otherwise we'd push "Rome" twice if it shows up in turns 1..80.
    // We still want to detect non-adjacent recurrence (Rome → Han → Rome),
    // so de-dup by sequence position, not set membership.
    list.push(nm);
  }
  return list;
}

// Compose the end-of-line / legend display name.
//   civHistory.length === 0 → just leader name.
//   civHistory.length === 1 → "Leader (Civ)".
//   civHistory.length >= 2  → "Leader (CivOld → CivNew)" using arrow separator.
/**
 * Compose the end-of-line / legend display name from a leader name and the
 * civ-name history.
 * @param {string} leaderOnly The bare leader name.
 * @param {string[]} civHistory Distinct civ names, chronological.
 * @returns {string} The composed display name.
 */
function displayName(leaderOnly, civHistory) {
  if (!Array.isArray(civHistory) || civHistory.length === 0) return leaderOnly;
  if (civHistory.length === 1) return leaderOnly + " (" + civHistory[0] + ")";
  return leaderOnly + " (" + civHistory.join(" → ") + ")";
}

export { collectCivHistory, displayName };

/**
 * Whether the "hide unmet stats" spoiler guard is enabled (default on). When
 * on, every chart withholds data for civs the local player has not met -
 * seeing any of an unmet civ's history (score, economy, military, diplomacy)
 * is treated as a spoiler. Now derived from the EFFECTIVE analytics-governance
 * policy (combined design plan P0.1): every policy except `full` hides unmet
 * civs, and a multiplayer host can force this on regardless of the client's own
 * toggle. Read fresh each render so the Options control is fully reversible
 * without a reload. Fails spoiler-safe (on) if the policy read throws.
 * @returns {boolean} True to gate unmet civs.
 */
function hideUnmetEnabled() {
  try {
    return policyHidesUnmet();
  } catch (_) {
    return true;
  }
}

/**
 * Whether a whole civ must be dropped from a CURRENT-STATE chart (radar,
 * resources, settlements) under the effective governance policy: hidden when
 * the policy is own-civ-only / disabled and the civ is not the local player, or
 * when unmet civs are hidden and this civ is currently unmet. Centralizes the
 * data-access enforcement so every current-state picker drops the same civs the
 * banner says are withheld. Fails safe (drop) on error.
 * @param {Snapshot[]|*} samples The sample stream.
 * @param {string|number} pid The civ player id.
 * @returns {boolean} True to drop the civ entirely.
 */
function civDroppedByPolicy(samples, pid) {
  try {
    if (policyOwnCivOnly()) return !isLocalCiv(pid);
    return policyHidesUnmet() && isCivUnmet(samples, pid);
  } catch (_) {
    return true;
  }
}

/**
 * Sub-option of the spoiler guard (only meaningful when {@link hideUnmetEnabled}
 * is on): how a civ's line chart behaves once the local player meets it.
 * When true (default), the civ's ENTIRE history is back-filled on meeting
 * (matching the radar / worldrankings-allcivs current-state views). When false, only data
 * from first contact forward is shown. Reads fresh each render so the toggle is
 * reversible without a reload. Defaults to back-fill on read error.
 * @returns {boolean} True to reveal full history once met.
 */
function backfillMetHistoryEnabled() {
  try {
    return DemographicsSettings.getSetting("backfillMetHistory", true) !== false;
  } catch (_) {
    return true;
  }
}

/**
 * Whether the local player has NOT met this civ as of the most recent sample
 * that carries a met flag. Used by current-state charts (legacy radar, triumph
 * progress, resource / triumph-stack pickers) to exclude whole civs, mirroring
 * the per-point gate the line chart applies to time series. The local player is
 * always met. An unknown met flag (never resolved) is treated as met (shown) -
 * matching the line chart, which only drops points where `met === false`.
 * @param {Snapshot[]|*} samples The sample stream.
 * @param {string|number} pid The civ player id.
 * @returns {boolean} True when the civ is currently unmet.
 */
function isCivUnmet(samples, pid) {
  if (!Array.isArray(samples)) return false;
  const key = String(pid);
  for (let i = samples.length - 1; i >= 0; i--) {
    const ps = samples[i] && samples[i].players ? samples[i].players[key] : null;
    if (ps && typeof ps.met === "boolean") return ps.met === false;
  }
  return false;
}

export { hideUnmetEnabled, backfillMetHistoryEnabled, isCivUnmet, civDroppedByPolicy };

// X-axis time-unit mode shared across every history chart (line, stacks,
// gantt). "both" = "T-N / Year", "turn" = "T-N", "year" = "Year". Toolbar
// toggle in view-history sets it before requesting a reload.
let _xAxisMode = "both";
/**
 * Set the shared X-axis time-unit mode. Ignores unrecognized values.
 * @param {string} mode One of `"turn"`, `"year"`, `"both"`.
 */
export function setXAxisMode(mode) {
  if (mode === "turn" || mode === "year" || mode === "both") _xAxisMode = mode;
}
/**
 * Read the shared X-axis time-unit mode.
 * @returns {string} The current mode (`"turn"`, `"year"`, or `"both"`).
 */
export function getXAxisMode() {
  return _xAxisMode;
}

/**
 * Coerce a `Set`/array option into a `Set<string>`.
 * @param {Set<*>|*[]|*} src Source set/array (or anything else → empty).
 * @returns {Set<string>} The stringified key set.
 */
function coerceKeySet(src) {
  const arr = src instanceof Set ? Array.from(src) : Array.isArray(src) ? src : [];
  return new Set(arr.map((v) => String(v)));
}

/**
 * Resolve the local player/observer id from the engine `GameContext`.
 * @returns {number|undefined} Local id, if numeric.
 */
function resolveLocalPid() {
  try {
    if (typeof GameContext !== "undefined" && GameContext != null) {
      if (typeof GameContext.localPlayerID === "number") return GameContext.localPlayerID;
      if (typeof GameContext.localObserverID === "number") return GameContext.localObserverID;
    }
  } catch (_) {
    // GameContext may be absent or throw outside an active game; fall back to undefined.
  }
  return undefined;
}

/**
 * Resolve the time-range filter from options, or `null`.
 * @param {ChartOptions} opts The render options.
 * @returns {{ min: number, max: number }|null} The filter, or `null`.
 */
function resolveTurnRange(opts) {
  return opts.turnRange &&
    typeof opts.turnRange.min === "number" &&
    typeof opts.turnRange.max === "number"
    ? opts.turnRange
    : null;
}

/**
 * Add the live current-turn → year entry from the engine `Game`, defensively.
 * `Game.turn` is the AGE-LOCAL turn (resets per age), so callers whose map is
 * keyed by chart-X (age offset + local turn) must pass the current age's
 * `xOffset`; callers keyed by raw age-local turn pass 0 (the default).
 * @param {Map<number, string>} turnYearMap chart-X → year map (mutated).
 * @param {number} [xOffset] The current age's chart-X offset (0 for raw-turn maps).
 */
function addLiveTurnYear(turnYearMap, xOffset = 0) {
  try {
    if (
      typeof Game !== "undefined" &&
      typeof Game.turn === "number" &&
      typeof Game.getTurnDate === "function"
    ) {
      const y = Game.getTurnDate();
      if (typeof y === "string" && y.length > 0) turnYearMap.set(Game.turn + xOffset, y);
    }
  } catch (_) {
    // Game.turn / Game.getTurnDate may be absent or throw; skip the live entry.
  }
}

/**
 * Find the map value whose key is nearest to `turn` (exact hit short-circuits).
 * @template V
 * @param {Map<number, V>} map A chart-X keyed map.
 * @param {number} turn The chart-X to match.
 * @returns {V|null} The nearest value, or `null` when the map is empty.
 */
function nearestByTurn(map, turn) {
  if (map.has(turn)) return /** @type {V} */ (map.get(turn));
  /** @type {V|null} */
  let best = null;
  let bestDist = Infinity;
  map.forEach((val, t) => {
    const d = Math.abs(t - turn);
    if (d < bestDist) {
      bestDist = d;
      best = val;
    }
  });
  return best;
}

/**
 * Build the turn → year map for stack x-ticks (samples + live current turn).
 * @param {Snapshot[]} samples The sample stream.
 * @returns {Map<number, string>} chart-turn → year map.
 */
function buildStackTurnYears(samples) {
  /** @type {Map<number, string>} */
  const stackTurnYears = new Map();
  for (const s of samples) {
    if (
      s &&
      typeof s.turn === "number" &&
      typeof s.gameYear === "string" &&
      s.gameYear.length > 0
    ) {
      stackTurnYears.set(s.turn, s.gameYear);
    }
  }
  addLiveTurnYear(stackTurnYears);
  return stackTurnYears;
}

/**
 * Compose a dropdown/option label from a civ sample ("Leader (Civ)" or
 * "Leader" or "Player <pid>").
 * @param {CivSample|*} ps One civ's sample.
 * @param {string} pid Player id key.
 * @returns {string} The option label.
 */
function civOptionLabel(ps, pid) {
  if (!ps.leaderName) return "Player " + pid;
  return ps.civName ? ps.leaderName + " (" + ps.civName + ")" : ps.leaderName;
}

/**
 * Escape HTML-special characters for safe insertion into tooltip markup.
 * @param {*} s Source value (coerced to string).
 * @returns {string} The escaped string.
 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export {
  dlog,
  SVG_NS,
  PALETTE,
  svgEl,
  historySamples,
  appendEmptyNotice,
  coerceKeySet,
  resolveLocalPid,
  resolveTurnRange,
  addLiveTurnYear,
  nearestByTurn,
  buildStackTurnYears,
  civOptionLabel,
  escapeHtml
};
