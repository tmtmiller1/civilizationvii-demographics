// demographics-triumphs-decorator.js
//
// Augments the native Legacies → Triumphs cards with per-civilization
// progress bars. Replaces the cloned Race tab that previously lived
// inside the Demographics screen; bars now render directly on the
// in-game cards.
//
// On first use, builds a (localized-name → GameInfo.Legacies row) map.
// A MutationObserver watches the document for nodes with `.triumph-card`
// (the class applied by native triumph-card.js). For each card we
// resolve the legacy row from the title text, query each major civ's
// progress via Players.get(pid).Legacies.getProgress(legacyType), and
// append a bars block to the card.
//
// A `_demographicsDecorated` sentinel on each card prevents re-injection
// on Solid reactivity updates.

// Module marker: makes this file an ES module for the type-checker so
// module-scoped `const DBG` does not collide with the identical debug flag
// in sibling decorators. Exports no bindings — a runtime no-op.
export {};

import { t } from "/demographics/ui/demographics-i18n.js";

/**
 * A `GameInfo.Legacies` row, narrowed to the fields this module reads. The
 * engine row carries many more columns; they are intentionally left loose.
 * @typedef {Object} LegacyRow
 * @property {string} [Name] Localizable display name.
 * @property {string} [LegacyType] Stable legacy identifier (e.g. ends in `_RACE`).
 */

/**
 * One civilization's progress toward a single legacy, as rendered in a card row.
 * @typedef {Object} CivProgress
 * @property {Pid} pid Player id.
 * @property {number} current Current progress value.
 * @property {number} total Target progress value.
 * @property {boolean} triggered Whether the legacy has triggered for this civ.
 */

/**
 * Aggregated progress for one legacy across every major civ.
 * @typedef {Object} RowProgress
 * @property {CivProgress[]} civs Per-civ progress, pre-sorted for display.
 * @property {number} total Largest target value seen across civs.
 * @property {Pid} winner Race winner pid, or `-1` when none.
 */

/**
 * A native triumph card element, carrying our re-injection sentinel.
 * @typedef {HTMLElement & { _demographicsDecorated?: boolean }} DecoratableCard
 */

/**
 * One diagnostic sample captured during the first-row progress probe.
 * @typedef {Object} ProbeSample
 * @property {Pid} pid Player id.
 * @property {boolean} hasProg Whether a progress object was returned.
 * @property {string} progStr Truncated JSON of the progress object.
 * @property {boolean} triggered Whether the legacy is triggered.
 * @property {number} cur Current progress value.
 * @property {number} tot Target progress value.
 */

const DBG = false;
/**
 * Debug logger, no-op unless {@link DBG} is set.
 * @param {...*} a Values to log.
 * @returns {void}
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.triumphsDecorator]", ...a);
}
/**
 * Error logger; always emits.
 * @param {...*} a Values to log.
 * @returns {void}
 */
function derr(...a) {
  console.error("[Demographics.triumphsDecorator]", ...a);
}

/** @type {Map<string, LegacyRow> | null} Cached localized-name → legacy-row map. */
let _nameToRow = null;
/** @type {Map<string, LegacyRow> | null} Cached LegacyType → row map. */
let _legacyTypeToRow = null;
/** @type {boolean} One-time probe status log guard. */
let _stableIdProbeLogged = false;

/**
 * Compose a legacy row's display name through `Locale`, falling back to the raw
 * name when the composer is unavailable or yields an empty string.
 * @param {LegacyRow} row Legacy row whose `Name` to compose.
 * @returns {string} Composed (or raw) display name.
 */
function composeLegacyName(row) {
  let name = /** @type {string} */ (row.Name);
  try {
    if (typeof Locale?.compose === "function") {
      const c = Locale.compose(/** @type {string} */ (row.Name));
      if (typeof c === "string" && c.length > 0) name = c;
    }
  } catch (_) {
    // Locale.compose is absent/throws in non-localized contexts; the raw row.Name fallback stands.
  }
  return name;
}

/**
 * Insert `row` into the name map under `key`, resolving name collisions.
 *
 * Race triumphs (LegacyType ending in "_RACE") are FirstPlayerOnly and share
 * their display name with a paired non-race row whose LegacyType is the same
 * string without "_RACE". The paired row is the one with actual per-civ
 * getProgress data — the _RACE row returns null progress. Prefer the non-_RACE
 * row whenever a name collision occurs.
 * @param {Map<string, LegacyRow>} map Map being built.
 * @param {string} key Uppercased, trimmed display-name key.
 * @param {LegacyRow} row Candidate legacy row.
 * @returns {void}
 */
function insertNameRow(map, key, row) {
  const isRace = typeof row.LegacyType === "string" && /_RACE$/.test(row.LegacyType);
  const existing = map.get(key);
  if (existing) {
    const existingIsRace =
      typeof existing.LegacyType === "string" && /_RACE$/.test(existing.LegacyType);
    if (existingIsRace && !isRace) {
      map.set(key, row); // upgrade to non-race
    }
    // Otherwise keep existing (we already have non-race, or
    // both are race — either way, no win in overwriting).
  } else {
    map.set(key, row);
  }
}

/**
 * Build (and cache) the localized-display-name → `GameInfo.Legacies` row map.
 * @returns {Map<string, LegacyRow>} The name map (possibly empty).
 */
function buildNameToRow() {
  if (_nameToRow) return _nameToRow;
  _nameToRow = new Map();
  try {
    if (typeof GameInfo === "undefined" || !GameInfo.Legacies) return _nameToRow;
    for (const row of GameInfo.Legacies) {
      if (!row || !row.Name) continue;
      const name = composeLegacyName(row);
      const key = name.trim().toUpperCase();
      insertNameRow(_nameToRow, key, row);
    }
    dlog("nameToRow built; entries=" + _nameToRow.size);
  } catch (e) {
    derr("buildNameToRow:", /** @type {any} */ (e)?.message);
  }
  return _nameToRow;
}

/**
 * Index every legacy row by its uppercased `LegacyType` into `map`.
 * @param {Map<string, LegacyRow>} map Map to populate.
 * @returns {void}
 */
function _indexLegaciesByType(map) {
  for (const row of GameInfo.Legacies) {
    const lt = row?.LegacyType;
    if (typeof lt === "string" && lt.length > 0) map.set(lt.toUpperCase(), row);
  }
}

/**
 * Alias `_RACE` keys to their paired non-race base row when present (the base
 * row carries per-civ progress; the `_RACE` row returns null progress).
 * @param {Map<string, LegacyRow>} map Type map to alias in place.
 * @returns {void}
 */
function _aliasRaceKeys(map) {
  for (const [k, row] of Array.from(map.entries())) {
    if (!/_RACE$/.test(k)) continue;
    const base = k.replace(/_RACE$/, "");
    const paired = map.get(base);
    if (paired) map.set(k, paired);
    else map.set(base, row);
  }
}

/**
 * Build (and cache) the `LegacyType` → `GameInfo.Legacies` row map.
 *
 * `_RACE` rows often share a name with a paired non-race row, but only the
 * non-race row typically yields meaningful per-civ progress. For robustness,
 * map a race key to its paired non-race row when the pair exists.
 * @returns {Map<string, LegacyRow>} LegacyType map (possibly empty).
 */
function buildLegacyTypeToRow() {
  if (_legacyTypeToRow) return _legacyTypeToRow;
  _legacyTypeToRow = new Map();
  try {
    if (typeof GameInfo === "undefined" || !GameInfo.Legacies) return _legacyTypeToRow;
    _indexLegaciesByType(_legacyTypeToRow);
    _aliasRaceKeys(_legacyTypeToRow);
    dlog("legacyTypeToRow built; entries=" + _legacyTypeToRow.size);
  } catch (e) {
    derr("buildLegacyTypeToRow:", /** @type {any} */ (e)?.message);
  }
  return _legacyTypeToRow;
}

/**
 * Compose a player-object string field through `Locale`, swallowing errors.
 * @param {PlayerLibrary | null | undefined} p Player handle.
 * @param {string} field Name of the string field to compose (e.g. `"leaderName"`).
 * @returns {string} Composed string, or `""` on absence/error.
 */
function composePlayerField(p, field) {
  try {
    const v = p?.[field];
    if (typeof v === "string") return Locale.compose(v);
  } catch (_) {
    // p?.[field] read or Locale.compose can throw at the engine boundary; empty-string fallback below.
  }
  return "";
}

/**
 * Human-readable "Leader (Civ)" label for a player, with defensive fallbacks.
 * @param {Pid} pid Player id.
 * @returns {string} Display name.
 */
function civDisplayName(pid) {
  try {
    const p = Players.get(pid);
    const leader = composePlayerField(p, "leaderName");
    const civ = composePlayerField(p, "civilizationName");
    if (leader && civ) return leader + " (" + civ + ")";
    return leader || civ || t("LOC_DEMOGRAPHICS_TRIUMPHS_PLAYER_FALLBACK", pid);
  } catch (_) {
    return t("LOC_DEMOGRAPHICS_TRIUMPHS_PLAYER_FALLBACK", pid);
  }
}

/**
 * Resolve a player's primary color as a `#rrggbb` string, or a neutral fallback.
 * @param {Pid} pid Player id.
 * @returns {string} Hex color string.
 */
function civColor(pid) {
  try {
    if (typeof UI?.Player?.getPrimaryColorValueAsString === "function") {
      const s = UI.Player.getPrimaryColorValueAsString(pid);
      if (typeof s === "string" && s.length > 0) {
        const m = s.match(/^#?([0-9a-fA-F]{6,8})$/);
        if (m) return "#" + m[1].slice(-6);
      }
    }
  } catch (_) {
    // UI.Player.getPrimaryColorValueAsString is absent in headless contexts; neutral color fallback below.
  }
  return "#85878c";
}

/**
 * Fallback major-civ enumeration: probe pids 0..63 for major/alive flags.
 * @returns {Pid[]} Player ids that look like major civs.
 */
function probeMajorPids() {
  const pids = [];
  try {
    for (let i = 0; i < 64; i++) {
      const p = Players?.get?.(i);
      if (!p) continue;
      const isMajor = (p.isMajor === true || p.isAlive === true) && !p.isMinor;
      if (isMajor) pids.push(i);
    }
  } catch (_) {
    // Players.get throws when the Players library isn't ready; return whatever pids we gathered.
  }
  return pids;
}

/**
 * One-time diagnostic dump of the resolved pids and pid 0's Legacies API shape.
 * @param {Pid[]} pids Resolved major-civ ids.
 * @returns {void}
 */
function logPidsOnce(pids) {
  dlog("allMajorPids returned:", JSON.stringify(pids));
  // Probe pid 0's Legacies API to see what's available.
  try {
    const p0 = Players?.get?.(pids[0] ?? 0);
    const pl = p0?.Legacies;
    dlog(
      "Players.get(" + (pids[0] ?? 0) + ") =",
      typeof p0,
      "Legacies =",
      typeof pl,
      "Legacies.getProgress =",
      typeof pl?.getProgress,
      "Legacies keys =",
      pl ? Object.keys(pl).slice(0, 10).join(",") : "n/a"
    );
  } catch (e) {
    dlog("probe failed:", /** @type {any} */ (e)?.message);
  }
}

// Enumerate every major-civ pid we can find. `Players.getAliveMajorIds` is
// the canonical accessor when present; if not, scan the Players list for
// `isMajor` flags. Either way, log on first invocation so we know what we
// got.
let _pidsLogged = false;
/**
 * Enumerate every major-civ pid, preferring the canonical accessor and falling
 * back to a 0..63 probe. Logs the result once on first invocation.
 * @returns {Pid[]} Player ids.
 */
function allMajorPids() {
  /** @type {Pid[]} */
  let pids = [];
  try {
    if (typeof Players?.getAliveMajorIds === "function") {
      pids = Array.from(Players.getAliveMajorIds());
    }
  } catch (_) {
    // Players.getAliveMajorIds is absent/throws before the Players library is ready; the 0..63 probe fallback runs below.
  }
  if (pids.length === 0) {
    // Fallback: probe pid 0..63 for major civs.
    pids = probeMajorPids();
  }
  if (!_pidsLogged) {
    _pidsLogged = true;
    logPidsOnce(pids);
  }
  return pids;
}

/** @type {boolean} Whether the one-time first-row progress probe has logged. */
let _firstRowLogged = false;

/**
 * One player's raw progress read, before aggregation/sorting.
 * @typedef {Object} CivProgressRead
 * @property {Pid} pid Player id.
 * @property {number} current Current progress value.
 * @property {number} total Target progress value.
 * @property {boolean} triggered Whether the legacy has triggered.
 * @property {*} prog Raw engine progress object (untyped), or `null`.
 * @property {*} raceWinner Raw `raceWinner` field off the progress object.
 */

/**
 * Query a Legacies handle's progress object for a legacy type, swallowing errors.
 * @param {*} pl A player's Legacies handle.
 * @param {LegacyRow} row Legacy row to query.
 * @returns {*} Raw engine progress object, or `null`.
 */
function queryProgress(pl, row) {
  try {
    return pl.getProgress?.(row.LegacyType);
  } catch (_) {
    return null;
  }
}

/**
 * Query whether a legacy has triggered for a Legacies handle, swallowing errors.
 * @param {*} pl A player's Legacies handle.
 * @param {LegacyRow} row Legacy row to query.
 * @returns {boolean} Whether the legacy is triggered.
 */
function queryTriggered(pl, row) {
  try {
    return !!pl.isTriggered?.(row.LegacyType);
  } catch (_) {
    return false;
  }
}

/**
 * Extract the `current`/`total` pair from the first slot of an engine progress
 * object, defaulting absent values to `0`.
 * @param {*} prog Raw engine progress object, or `null`.
 * @returns {{ cur: number, tot: number }} Current/total pair.
 */
function extractCurrentTotal(prog) {
  const slot = prog?.progress?.[0];
  const cur = slot?.current ?? 0;
  const tot = slot?.total ?? 0;
  return { cur, tot };
}

/**
 * Read one player's progress toward a legacy.
 * @param {Pid} pid Player id.
 * @param {LegacyRow} row Legacy row to query.
 * @returns {CivProgressRead | null} Progress read, or `null` if the player lacks
 *   a Legacies handle.
 */
function readCivProgress(pid, row) {
  let p;
  try {
    p = Players.get(pid);
  } catch (_) {
    return null;
  }
  const pl = p?.Legacies;
  if (!pl) return null;
  const prog = queryProgress(pl, row);
  const triggered = queryTriggered(pl, row);
  const { cur, tot } = extractCurrentTotal(prog);
  return { pid, current: cur, total: tot, triggered, prog, raceWinner: prog?.raceWinner };
}

/**
 * Sort comparator for display order: race winner first, then triggered, then by
 * descending current progress, with a stable pid tiebreak.
 * @param {Pid} winner Race winner pid (or `-1`).
 * @returns {(a: CivProgress, b: CivProgress) => number} Comparator.
 */
function makeProgressSorter(winner) {
  return (a, b) => {
    if (a.pid === winner && b.pid !== winner) return -1;
    if (b.pid === winner && a.pid !== winner) return 1;
    if (a.triggered !== b.triggered) return a.triggered ? -1 : 1;
    if (a.current !== b.current) return b.current - a.current;
    return a.pid - b.pid; // stable tiebreak
  };
}

/**
 * Append up to three diagnostic samples to `logSamples` while the one-time
 * first-row probe is still pending.
 * @param {ProbeSample[]} logSamples Accumulator (mutated).
 * @param {CivProgressRead} entry The civ's raw progress read.
 * @returns {void}
 */
function collectProbeSample(logSamples, entry) {
  if (_firstRowLogged || logSamples.length >= 3) return;
  const prog = entry.prog;
  logSamples.push({
    pid: entry.pid,
    hasProg: !!prog,
    progStr: prog ? JSON.stringify(prog).slice(0, 200) : "null",
    triggered: entry.triggered,
    cur: entry.current,
    tot: entry.total
  });
}

/**
 * Compute aggregated per-civ progress for one legacy row across all major civs.
 * Every major civ is included — even zero-progress — so every card renders at
 * the same height regardless of how many civs are making progress.
 * @param {LegacyRow} row Legacy row to query.
 * @returns {RowProgress} Aggregated, sorted progress.
 */
function getProgressForRow(row) {
  /** @type {CivProgress[]} */
  const out = [];
  let total = 0;
  let winner = -1;
  const pids = allMajorPids();
  /** @type {ProbeSample[]} */
  const logSamples = [];
  for (const pid of pids) {
    const entry = readCivProgress(pid, row);
    if (!entry) continue;
    const raceWinner = entry.raceWinner;
    if (entry.total > total) total = entry.total;
    if (typeof raceWinner === "number" && raceWinner !== -1) winner = raceWinner;
    collectProbeSample(logSamples, entry);
    out.push({
      pid: entry.pid,
      current: entry.current,
      total: entry.total,
      triggered: entry.triggered
    });
  }
  if (!_firstRowLogged) {
    _firstRowLogged = true;
    dlog("first-row probe for " + row.LegacyType + ":", JSON.stringify(logSamples));
  }
  out.sort(makeProgressSorter(winner));
  return { civs: out, total, winner };
}

/** @type {number} Counter that throttles "no match" diagnostics on cards. */
let _logCount = 0;

/**
 * Read a triumph card's title text. The native template structure varies — try
 * several selectors and fall back to the first font-title bearing element.
 * @param {HTMLElement} card Triumph card element.
 * @returns {{ rawText: string, titleText: string } | null} Raw and uppercased
 *   title, or `null` when no usable title was found.
 */
function readCardTitle(card) {
  const titleEl =
    card.querySelector(".text-secondary.uppercase.font-title") ||
    card.querySelector(".font-title.uppercase") ||
    card.querySelector(".font-title");
  if (!titleEl) {
    if (_logCount < 5) dlog("no title el on card; sample html=", card.outerHTML?.slice(0, 400));
    _logCount++;
    return null;
  }
  const rawText = (titleEl.textContent || "").trim();
  const titleText = rawText.toUpperCase();
  if (titleText.length === 0) {
    if (_logCount < 5) dlog("title empty; card.outerHTML snippet=", card.outerHTML?.slice(0, 300));
    _logCount++;
    return null;
  }
  return { rawText, titleText };
}

/**
 * Resolve the legacy row for a card title: an exact name-map hit, else a single
 * UNAMBIGUOUS containment match. The native L10n composer sometimes wraps the
 * name in style tags, so the card title can contain the legacy name with extra
 * decoration — we accept that one direction only (title ⊇ name), and only when
 * exactly one key matches. The reverse direction (name ⊇ title) and ties are
 * rejected: both could bind a card to the wrong legacy, which is worse than
 * leaving it undecorated.
 * @param {Map<string, LegacyRow>} map Name map.
 * @param {string} rawText Raw (display-cased) title text, for diagnostics.
 * @param {string} titleText Uppercased title text.
 * @returns {LegacyRow | undefined} Matched legacy row, or `undefined`.
 */
function resolveRowForTitle(map, rawText, titleText) {
  let row = map.get(titleText);
  if (!row) {
    /** @type {LegacyRow[]} */
    const hits = [];
    for (const [k, v] of map.entries()) {
      if (k.length > 0 && titleText.includes(k)) hits.push(v);
    }
    if (hits.length === 1) row = hits[0];
  }
  if (!row) {
    if (_logCount < 10)
      dlog(
        "no row match for title='" + rawText + "' (keys sample:",
        Array.from(map.keys()).slice(0, 5),
        ")"
      );
    _logCount++;
  }
  return row;
}

/**
 * Add possible `LegacyType` tokens from a string to `out`.
 * @param {Set<string>} out Token sink.
 * @param {unknown} value Candidate string value.
 * @returns {void}
 */
function collectLegacyTokens(out, value) {
  if (typeof value !== "string") return;
  const text = value.trim();
  if (!text) return;
  const parts = text.split(/[^A-Za-z0-9_]+/);
  for (const raw of parts) {
    const token = raw.toUpperCase();
    if (token.length < 6) continue;
    if (!token.includes("_")) continue;
    if (!/^[A-Z0-9_]+$/.test(token)) continue;
    out.add(token);
  }
}

/**
 * Gather possible stable `LegacyType` tokens from a native triumph-card DOM node.
 * Scans card attrs/dataset/classes and descendants for machine-like identifiers.
 * @param {HTMLElement} card Triumph card element.
 * @returns {string[]} Unique uppercase candidate tokens.
 */
function gatherCardLegacyTypeCandidates(card) {
  const out = new Set();
  /** @param {Element | null | undefined} el */
  const scanElement = (el) => {
    if (!el) return;
    for (const attr of Array.from(el.attributes || [])) {
      collectLegacyTokens(out, attr.name);
      collectLegacyTokens(out, attr.value);
    }
    for (const cls of Array.from(el.classList || [])) {
      collectLegacyTokens(out, cls);
    }
    const ds = /** @type {Record<string, unknown>} */ (
      /** @type {HTMLElement} */ (el).dataset || {}
    );
    for (const [k, v] of Object.entries(ds)) {
      collectLegacyTokens(out, k);
      collectLegacyTokens(out, v);
    }
  };

  scanElement(card);
  const nodes = card.querySelectorAll("*");
  const limit = Math.min(nodes.length, 120);
  for (let i = 0; i < limit; i++) {
    scanElement(nodes[i]);
  }
  return Array.from(out);
}

/**
 * Attempt to resolve a legacy row from stable identifier hints embedded in the
 * card DOM (attributes/classes/dataset). Falls back to `undefined` when no
 * stable hint maps to a known `LegacyType`.
 * @param {HTMLElement} card Triumph card element.
 * @param {Map<string, LegacyRow>} typeMap LegacyType → row map.
 * @returns {{ row: LegacyRow, token: string } | undefined} Resolved row + token.
 */
function resolveRowForCardIdentity(card, typeMap) {
  const tokens = gatherCardLegacyTypeCandidates(card);
  for (const tok of tokens) {
    const hit = typeMap.get(tok);
    if (hit) {
      if (!_stableIdProbeLogged) {
        _stableIdProbeLogged = true;
        derr("stable-id probe: found native token", tok);
      }
      return { row: hit, token: tok };
    }
  }
  if (!_stableIdProbeLogged) {
    _stableIdProbeLogged = true;
    derr("stable-id probe: no native LegacyType token found; using title fallback");
  }
  return undefined;
}

/**
 * Create the outer progress box container with its inline styling.
 * @returns {HTMLElement} The styled container `<div>`.
 */
function buildProgressBox() {
  const box = document.createElement("div");
  box.className = "demographics-triumph-progress";
  box.style.cssText = [
    "width:100%",
    "margin-top:0.6rem",
    "padding:0.4rem 0.55rem 0.3rem",
    "background:rgba(20, 16, 10, 0.45)",
    "border:1px solid rgba(168, 132, 90, 0.30)",
    "border-radius:0.15rem",
    "display:flex",
    "flex-direction:column",
    "gap:0.18rem",
    "pointer-events:none"
  ].join(";");
  return box;
}

/**
 * Create the "Civilization Progress" heading element.
 * @returns {HTMLElement} The styled heading `<div>`.
 */
function buildHeading() {
  const heading = document.createElement("div");
  heading.style.cssText = [
    "font-family:TitleFont, BodyFont, sans-serif",
    "color:#e5d2ac",
    "font-size:0.7rem",
    "font-weight:700",
    "text-transform:uppercase",
    "letter-spacing:0.1em",
    "margin-bottom:0.15rem",
    "text-align:center",
    "opacity:0.85"
  ].join(";");
  heading.textContent = t("LOC_DEMOGRAPHICS_TRIUMPHS_PROGRESS_HEADER");
  return heading;
}

/**
 * Build the name cell (color dot + civ label) for one progress row.
 * @param {CivProgress} c Civ progress entry.
 * @param {Pid} winner Race winner pid (highlighted gold).
 * @returns {HTMLElement} The styled name cell `<div>`.
 */
function buildNameCell(c, winner) {
  const nameCell = document.createElement("div");
  nameCell.style.cssText = "display:flex;align-items:center;gap:0.3rem;min-width:0;";
  const dot = document.createElement("span");
  dot.style.cssText =
    "width:0.42rem;height:0.42rem;border-radius:50%;flex-shrink:0;background:" +
    civColor(c.pid) +
    ";";
  nameCell.appendChild(dot);
  const nm = document.createElement("span");
  nm.style.cssText =
    "font-size:0.7rem;color:" +
    (c.pid === winner ? "#f3c34c" : "#e5d2ac") +
    ";font-weight:" +
    (c.pid === winner ? "700" : "500") +
    ";overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;";
  nm.textContent = civDisplayName(c.pid);
  nameCell.appendChild(nm);
  return nameCell;
}

/**
 * Build the progress-bar cell (track + optional fill) for one progress row.
 * @param {CivProgress} c Civ progress entry.
 * @param {number} total Largest target across civs (bar denominator).
 * @returns {HTMLElement} The styled bar `<div>`.
 */
function buildBarCell(c, total) {
  const bar = document.createElement("div");
  bar.style.cssText =
    "position:relative;height:0.28rem;background:rgba(20,16,10,0.7);border:1px solid rgba(168,132,90,0.4);border-radius:0.1rem;overflow:hidden;";
  if (total > 0 && c.current > 0) {
    const fill = document.createElement("div");
    const pct = Math.min(100, (c.current / total) * 100);
    fill.style.cssText =
      "position:absolute;left:0;top:0;bottom:0;width:" +
      pct +
      "%;background:" +
      (c.triggered ? "#f3c34c" : "#49d182") +
      ";opacity:" +
      (c.triggered ? "0.95" : "0.85") +
      ";";
    bar.appendChild(fill);
  }
  return bar;
}

/**
 * Build the numeric "current/total" cell (with a ✓ when triggered).
 * @param {CivProgress} c Civ progress entry.
 * @param {number} total Largest target across civs.
 * @param {Pid} winner Race winner pid (highlighted gold).
 * @returns {HTMLElement} The styled number `<div>`.
 */
function buildNumberCell(c, total, winner) {
  const num = document.createElement("div");
  num.style.cssText =
    "font-family:monospace, ui-monospace;font-size:0.68rem;color:" +
    (c.pid === winner ? "#f3c34c" : "#c2c4cc") +
    ";text-align:right;font-weight:" +
    (c.triggered ? "700" : "500") +
    ";";
  num.textContent = c.current + "/" + total + (c.triggered ? " ✓" : "");
  return num;
}

/**
 * Build one full progress row (name + bar + number) for a civ.
 * @param {CivProgress} c Civ progress entry.
 * @param {number} total Largest target across civs.
 * @param {Pid} winner Race winner pid.
 * @returns {HTMLElement} The styled row `<div>`.
 */
function buildProgressRow(c, total, winner) {
  const row2 = document.createElement("div");
  row2.style.cssText =
    "display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr) minmax(2.3rem,auto);gap:0.4rem;align-items:center;";
  row2.appendChild(buildNameCell(c, winner));
  row2.appendChild(buildBarCell(c, total));
  row2.appendChild(buildNumberCell(c, total, winner));
  return row2;
}

/**
 * Populate the progress box body: an "empty" notice when there are no civs,
 * otherwise one row per civ.
 * @param {HTMLElement} box Progress box to append into.
 * @param {RowProgress} progress Aggregated progress.
 * @returns {void}
 */
function fillProgressBox(box, progress) {
  const { civs, total, winner } = progress;
  if (civs.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "font-size:0.7rem;color:#85878c;font-style:italic;text-align:center;";
    empty.textContent = t("LOC_DEMOGRAPHICS_EMPTY_NO_CIV_PROGRESS");
    box.appendChild(empty);
  } else {
    for (const c of civs) {
      box.appendChild(buildProgressRow(c, total, winner));
    }
  }
}

/**
 * Stamp diagnostic `data-demographics-*` attributes recording how the card's
 * legacy was resolved (stable-id vs title-fallback).
 * @param {DecoratableCard} card The card.
 * @param {LegacyRow} row The resolved legacy row.
 * @param {{ token?: string } | null | undefined} identityHit Stable-id hit, if any.
 * @returns {void}
 */
function markCardProbe(card, row, identityHit) {
  card.setAttribute("data-demographics-legacy-probe", identityHit ? "stable-id" : "title-fallback");
  card.setAttribute("data-demographics-legacy-type", String(row.LegacyType || ""));
  if (identityHit?.token) card.setAttribute("data-demographics-legacy-token", identityHit.token);
  else card.removeAttribute("data-demographics-legacy-token");
}

/**
 * Decorate a single native triumph card with the per-civ progress block.
 * Resolves the legacy from the card title, marks the card decorated to guard
 * against Solid re-renders, then builds and appends the bars block.
 * @param {DecoratableCard} card Triumph card.
 * @returns {void}
 */
function decorateCard(card) {
  if (!card || card._demographicsDecorated) return;

  const typeMap = buildLegacyTypeToRow();
  const identityHit = resolveRowForCardIdentity(card, typeMap);

  // Read the triumph title.
  const title = readCardTitle(card);
  if (!title) return;
  const { rawText, titleText } = title;

  const map = buildNameToRow();
  const row = identityHit?.row || resolveRowForTitle(map, rawText, titleText);
  if (!row) return;

  markCardProbe(card, row, identityHit);

  // Mark decorated FIRST so a Solid reactivity re-render doesn't double up.
  card._demographicsDecorated = true;

  const progress = getProgressForRow(row);
  const { civs, total } = progress;
  dlog(
    "decorating card title='" +
      rawText +
      "' legacyType=" +
      row.LegacyType +
      (identityHit ? " token=" + identityHit.token : " token=title-fallback") +
      " civsWithProgress=" +
      civs.length +
      " total=" +
      total
  );
  if (civs.length === 0) {
    // Couldn't enumerate any major civs — skip rather than render an
    // empty box. (Goal is unknown OR Players API isn't ready.)
    return;
  }

  const box = buildProgressBox();
  box.appendChild(buildHeading());
  fillProgressBox(box, progress);
  card.appendChild(box);
}

/**
 * Decorate every `.triumph-card` descendant of `root`.
 * @param {HTMLElement | Document | null | undefined} root Subtree root to sweep.
 * @returns {void}
 */
function sweepRoot(root) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  root.querySelectorAll(".triumph-card").forEach((el) => {
    decorateCard(/** @type {DecoratableCard} */ (el));
  });
}

/**
 * Handle one added DOM node: decorate it if it is a triumph card, else sweep it.
 * @param {Node} node An added node from a mutation record.
 * @returns {void}
 */
function handleAddedNode(node) {
  if (node.nodeType !== 1) return;
  const el = /** @type {HTMLElement} */ (node);
  if (el.classList?.contains("triumph-card")) {
    decorateCard(/** @type {DecoratableCard} */ (el));
  } else if (typeof el.querySelectorAll === "function") {
    sweepRoot(el);
  }
}

/**
 * Re-check the card enclosing a mutated text/child node (Solid hydration patches
 * title text into nodes that already mounted).
 * @param {MutationRecord} m Mutation record whose target to inspect.
 * @returns {void}
 */
function handleHydratedTarget(m) {
  if (m.type !== "characterData" && m.type !== "childList") return;
  const t = /** @type {HTMLElement} */ (m.target);
  if (!t || t.nodeType !== 1 || typeof t.closest !== "function") return;
  const card = /** @type {DecoratableCard | null} */ (t.closest?.(".triumph-card"));
  if (card && !card._demographicsDecorated) decorateCard(card);
}

/**
 * Handle one batch of mutation records: decorate newly added cards, sweep added
 * subtrees, and re-check cards whose text/children changed (Solid hydration).
 * @param {MutationRecord[]} mutations Observed mutation records.
 * @returns {void}
 */
function onMutations(mutations) {
  for (const m of mutations) {
    // DOM-edge boundary: the engine fires this callback synchronously, so a
    // throw here would tear down the MutationObserver and stop all further
    // decoration. Guard per-record (one bad card can't block the rest) and
    // LOG — own-logic bugs in decorateCard / progress computation surface
    // instead of being silently swallowed.
    try {
      for (const node of m.addedNodes) {
        handleAddedNode(node);
      }
      handleHydratedTarget(m);
    } catch (e) {
      derr("onMutations:", e);
    }
  }
}

/** @type {MutationObserver | null} Scoped card observer; active only while the legacies screen is open. */
let _cardObserver = null;
/** @type {MutationObserver | null} Lightweight watcher for the legacies screen mounting/unmounting. */
let _presenceObserver = null;

/** The legacies screen's custom-element tag (base-standard `defineLegacyComponent`). */
const LEGACIES_SCREEN_TAG = "screen-legacies";

/**
 * Attach the card-decoration observer, scoped to the open legacies screen, and
 * run an initial sweep over it. Idempotent: a call while already attached is a
 * no-op.
 * @param {HTMLElement} screenRoot The `<screen-legacies>` element.
 * @returns {void}
 */
function attachCardObserver(screenRoot) {
  if (_cardObserver) return;
  // DOM-edge boundary for the initial sweep: log own-logic failures instead of
  // letting them abort attachment (which would also skip the observer).
  try {
    sweepRoot(screenRoot);
  } catch (e) {
    derr("initial sweep:", e);
  }
  _cardObserver = new MutationObserver(onMutations);
  _cardObserver.observe(screenRoot, { childList: true, subtree: true, characterData: true });
  dlog("card observer attached to", LEGACIES_SCREEN_TAG);
}

/**
 * Disconnect the scoped card observer if attached.
 * @returns {void}
 */
function detachCardObserver() {
  if (!_cardObserver) return;
  _cardObserver.disconnect();
  _cardObserver = null;
  dlog("card observer detached");
}

/**
 * Disconnect every observer. Wired to engine `BeforeUnload` so the watchers
 * don't outlive this UI-module context — the closest analog to a screen detach
 * for a standalone decorator script.
 * @returns {void}
 */
function teardownObservers() {
  detachCardObserver();
  if (_presenceObserver) {
    _presenceObserver.disconnect();
    _presenceObserver = null;
  }
}

/**
 * Watch for the legacies screen mounting/unmounting and attach or detach the
 * scoped card observer accordingly. The presence watcher is deliberately
 * childList/subtree only (no `characterData`) so it stays cheap across the whole
 * HUD; the expensive `characterData` watch is confined to the screen's subtree
 * and lives only while the screen is open — so the decorator no longer runs a
 * document-wide text-mutation observer for the entire process lifetime.
 * @returns {void}
 */
function bootstrap() {
  dlog("bootstrap");
  const existing = /** @type {HTMLElement | null} */ (document.querySelector(LEGACIES_SCREEN_TAG));
  if (existing) attachCardObserver(existing);

  _presenceObserver = new MutationObserver(() => {
    const screen = /** @type {HTMLElement | null} */ (document.querySelector(LEGACIES_SCREEN_TAG));
    if (screen) attachCardObserver(screen);
    else detachCardObserver();
  });
  _presenceObserver.observe(document.body, { childList: true, subtree: true });
  dlog("presence observer attached");

  try {
    if (typeof engine !== "undefined" && typeof engine.on === "function") {
      engine.on("BeforeUnload", teardownObservers);
    }
  } catch (_) {
    // engine.on can throw if the event name is unknown in this build; the
    // observers are harmless if they're never torn down explicitly.
  }
}

if (document.readyState === "complete" || document.readyState === "interactive") {
  bootstrap();
} else {
  document.addEventListener("DOMContentLoaded", bootstrap);
}
