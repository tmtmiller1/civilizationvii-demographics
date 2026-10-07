// chart-shared.js
//
// Shared helpers used by 2+ chart render modules: SVG element creation,
// history-sample access, empty-state notices, palette proxy, civ-name
// helpers, the shared X-axis time-unit mode, key-set / turn-range coercion,
// nearest-by-turn lookup, and the stack turn/year map builder.

import { getPalette } from "/demographics/ui/core/demographics-palette.js";
import { DemographicsSettings } from "/demographics/ui/core/demographics-settings.js";
import { orderedNames, inlineLabel } from "/demographics/ui/core/player-label.js";
import { tPlayerFallback } from "/demographics/ui/core/demographics-i18n.js";
import {
  policyHidesUnmet,
  policyOwnCivOnly,
  isLocalCiv
} from "/demographics/ui/core/demographics-governance.js";
import { localHasMet } from "/demographics/ui/screen-demographics/settlements/settlements-met.js";

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
// string (numeric index) depending on the key, a dynamic shape callers index
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
 * @param {string} tag
 * @param {Record<string, *>} [attrs]
 * @returns {SVGElement}
 */
function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k]);
  return el;
}

/**
 * @param {DemoHistory|*} history
 * @returns {Snapshot[]} The history's samples, or an empty array.
 */
function historySamples(history) {
  return history && Array.isArray(history.samples) ? history.samples : [];
}

/**
 * Append a standard empty-state / notice element to a host.
 * @param {HTMLElement} host
 * @param {string} text
 */
function appendEmptyNotice(host, text) {
  const msg = document.createElement("div");
  msg.className = "demographics-empty font-body text-base";
  msg.textContent = text;
  host.appendChild(msg);
}

/**
 * @param {*} sample
 * @param {string} pid
 * @returns {string} The sample's civ name for the pid, or "".
 */
function sampleCivName(sample, pid) {
  const player = sample && sample.players ? sample.players[pid] : null;
  if (!player || typeof player.civName !== "string") return "";
  return player.civName;
}

/**
 * Whether a civ history list should append the candidate name.
 * @param {string[]} list
 * @param {string} name
 * @returns {boolean}
 */
function shouldAppendCivName(list, name) {
  if (!name) return false;
  if (list.length > 0 && list[list.length - 1] === name) return false;
  return !list.includes(name);
}

/**
 * Collect a pid's distinct civ names in chronological first-seen order. Empty
 * and missing names are skipped.
 * @param {Snapshot[]} samples
 * @param {string} pid
 * @returns {string[]}
 */
function collectCivHistory(samples, pid) {
  /** @type {string[]} */
  const list = [];
  for (const s of samples) {
    const nm = sampleCivName(s, pid);
    if (!shouldAppendCivName(list, nm)) continue;
    // De-dup by sequence position, not set membership, so a non-adjacent
    // recurrence (Rome -> Han -> Rome) is still detected.
    list.push(nm);
  }
  return list;
}

/**
 * Compose the end-of-line / legend display name from a leader name and the
 * civ-name history. Civ first, leader second (players identify with the civ
 * first): no civ → just the leader name; one → "Civ (Leader)"; two or more →
 * "CivOld → CivNew (Leader)".
 * @param {string} leaderOnly The bare leader name.
 * @param {string[]} civHistory Distinct civ names, chronological.
 * @returns {string}
 */
function displayName(leaderOnly, civHistory) {
  if (!Array.isArray(civHistory) || civHistory.length === 0) return leaderOnly;
  const civ = civHistory.join(" → ");
  const [primary, secondary] = orderedNames(leaderOnly, civ);
  return secondary ? primary + " (" + secondary + ")" : primary;
}

export { collectCivHistory, displayName };

/**
 * Whether the "hide unmet stats" spoiler guard is enabled (default on): every
 * chart then withholds data for civs the local player has not met. Derived from
 * the effective governance policy (every policy except `full` hides unmet civs,
 * and a multiplayer host can force it on), read fresh each render; fails
 * spoiler-safe (on) if the policy read throws.
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
 * Whether a whole civ must be dropped from a current-state chart under the
 * effective governance policy: when the policy is own-civ-only / disabled and
 * the civ is not the local player, or when unmet civs are hidden and this civ is
 * currently unmet. Fails safe (drop) on error.
 * @param {Snapshot[]|*} samples
 * @param {string|number} pid
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
 * {@link civDroppedByPolicy} for boards that read live game state (Players / the settlement
 * board) instead of the history: the met state comes from diplomacy now, not the last sample.
 * An unreadable met state keeps the civ, matching the history gate. Fails safe (drop) on error.
 * @param {string|number} pid
 * @returns {boolean} True to drop the civ entirely.
 */
function liveCivDroppedByPolicy(pid) {
  try {
    if (policyOwnCivOnly()) return !isLocalCiv(pid);
    return policyHidesUnmet() && localHasMet(Number(pid)) === false;
  } catch (_) {
    return true;
  }
}

/**
 * Sub-option of the spoiler guard (only meaningful when {@link hideUnmetEnabled}
 * is on): when true (default) a civ's entire history is back-filled once the
 * local player meets it; when false only data from first contact forward is
 * shown. Read fresh each render; defaults to back-fill on read error.
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
 * Whether the local player has not met this civ as of the most recent sample
 * that carries a met flag. The local player is always met, and an unknown met
 * flag is treated as met, matching the line chart, which only drops points
 * where `met === false`.
 * @param {Snapshot[]|*} samples
 * @param {string|number} pid
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

export { hideUnmetEnabled, backfillMetHistoryEnabled, isCivUnmet, civDroppedByPolicy, liveCivDroppedByPolicy };

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
 * @returns {string} The shared X-axis time-unit mode (`"turn"`, `"year"`, or `"both"`).
 */
export function getXAxisMode() {
  return _xAxisMode;
}

/**
 * Coerce a `Set`/array option into a `Set<string>`.
 * @param {Set<*>|*[]|*} src Anything else → empty.
 * @returns {Set<string>}
 */
function coerceKeySet(src) {
  const arr = src instanceof Set ? Array.from(src) : Array.isArray(src) ? src : [];
  return new Set(arr.map((v) => String(v)));
}

/**
 * @returns {number|undefined} The local player/observer id from the engine `GameContext`, if numeric.
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
 * @param {ChartOptions} opts
 * @returns {{ min: number, max: number }|null}
 */
function resolveTurnRange(opts) {
  return opts.turnRange &&
    typeof opts.turnRange.min === "number" &&
    typeof opts.turnRange.max === "number"
    ? opts.turnRange
    : null;
}

/**
 * Add the live current-turn -> year entry from the engine `Game`.
 * `Game.turn` is age-local, so callers whose map is keyed by chart-X must pass
 * the current age's `xOffset`; raw age-local maps pass 0 (the default).
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
 * @param {number} turn
 * @returns {V|null} `null` when the map is empty.
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
 * @param {Snapshot[]} samples
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
 * @param {string} pid
 * @returns {string}
 */
function civOptionLabel(ps, pid) {
  if (!ps.leaderName) return tPlayerFallback(pid);
  return inlineLabel(ps.leaderName, ps.civName);
}

/**
 * Escape HTML-special characters for insertion into tooltip markup.
 * @param {*} s Coerced to string.
 * @returns {string}
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
