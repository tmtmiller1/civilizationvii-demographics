// chart-shared.js
//
// Shared helpers used by 2+ chart render modules: SVG element creation,
// history-sample access, empty-state notices, palette proxy, civ-name
// helpers, the shared X-axis time-unit mode, key-set / turn-range coercion,
// nearest-by-turn lookup, and the stack turn/year map builder.

import { getPalette } from "/demographics/ui/demographics-palette.js";

/**
 * @typedef {import("/demographics/ui/screen-demographics/chart-line.js").ChartOptions} ChartOptions
 */

const DBG = true;
/**
 * Debug logger; no-op unless {@link DBG} is set.
 * @param {...*} a Values to log.
 * @returns {void}
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.chart]", ...a);
}

const SVG_NS = "http://www.w3.org/2000/svg";

// Each chart render reads the palette fresh so the colorblind-mode toggle
// in Options takes effect on the very next paint without a mod reload.
// Define PALETTE as a getter so existing `PALETTE[i]` indexing keeps working.
// Typed `any` because the Proxy returns either a number (`.length`) or a color
// string (numeric index) depending on the key — a dynamic shape callers index
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
 * @returns {void}
 */
function appendEmptyNotice(host, text) {
  const msg = document.createElement("div");
  msg.className = "demographics-empty font-body text-base";
  msg.textContent = text;
  host.appendChild(msg);
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
    const ps = s && s.players && s.players[pid];
    const nm = ps && typeof ps.civName === "string" ? ps.civName : "";
    if (!nm) continue;
    if (list.length === 0 || list[list.length - 1] !== nm) {
      // Only append when the LATEST civ differs from the previous entry
      // — otherwise we'd push "Rome" twice if it shows up in turns 1..80.
      // We still want to detect non-adjacent recurrence (Rome → Han → Rome),
      // so de-dup by sequence position, not set membership.
      if (!list.includes(nm)) list.push(nm);
    }
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

// X-axis time-unit mode shared across every history chart (line, stacks,
// gantt). "both" = "T-N / Year", "turn" = "T-N", "year" = "Year". Toolbar
// toggle in view-history sets it before requesting a reload.
let _xAxisMode = "both";
/**
 * Set the shared X-axis time-unit mode. Ignores unrecognized values.
 * @param {string} mode One of `"turn"`, `"year"`, `"both"`.
 * @returns {void}
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
    /* */
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
 * @param {Map<number, string>} turnYearMap chart-X → year map (mutated).
 * @returns {void}
 */
function addLiveTurnYear(turnYearMap) {
  try {
    if (
      typeof Game !== "undefined" &&
      typeof Game.turn === "number" &&
      typeof Game.getTurnDate === "function"
    ) {
      const y = Game.getTurnDate();
      if (typeof y === "string" && y.length > 0) turnYearMap.set(Game.turn, y);
    }
  } catch (_) {
    /* */
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
