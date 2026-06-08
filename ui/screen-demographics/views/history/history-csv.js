// history-csv.js
//
// CSV export for the "Historical Data" view. Dumps history.samples to a flat
// CSV with one row per (turn, pid) and one column per metric. Coherent
// GameFace doesn't expose `URL.createObjectURL` or `<a download>`, so we route
// through the engine's `UI.setClipboardText`
// (cite: base-standard/ui-next/screens/pause-menu/pause-menu-model.js,
//  269 - the pause menu uses this for the map seed). When clipboard isn't
// available, we fall back to writing the CSV to UI.log so it's still
// recoverable.
//
// Either path now ends with a VISIBLE toast on the screen so the user sees
// confirmation - the previous version succeeded silently and looked broken.

import { t } from "/demographics/ui/core/demographics-i18n.js";

const DBG = false;
/**
 * Debug logger, no-op unless {@link DBG} is set.
 * @param {...*} a Values to log.
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.history-csv]", ...a);
}
/**
 * Error logger for this module.
 * @param {...*} a Values to log.
 */
function derr(...a) {
  console.error("[Demographics.history-csv]", ...a);
}

/**
 * Show a transient toast in `host`, auto-removing after 4s. Replaces any prior
 * toast first.
 * @param {HTMLElement} host The view host element.
 * @param {string} message Toast text.
 * @param {boolean} success Green (success) vs orange (failure) styling.
 */
function showCsvToast(host, message, success) {
  // Remove any prior toast first.
  try {
    const old = host.querySelector(".demographics-csv-toast");
    if (old) old.remove();
  } catch (_) {
    // host.querySelector/old.remove() can throw if host is detached; skip the
    // prior-toast cleanup and append the new toast anyway.
  }
  const toast = document.createElement("div");
  toast.className = "demographics-csv-toast";
  // Success/failure tint is dynamic - the rest of the chrome lives in the
  // .demographics-csv-toast rule.
  toast.style.borderColor = success ? "rgba(73,209,130,0.7)" : "rgba(213,94,0,0.7)";
  toast.style.color = success ? "#49d182" : "#D55E00";
  toast.textContent = message;
  host.appendChild(toast);
  setTimeout(() => {
    try {
      toast.remove();
    } catch (_) {
      // toast.remove() can throw if the node was already detached; nothing
      // left to clean up.
    }
  }, 4000);
}

/**
 * Columns ordered SEMANTICALLY by category so related metrics sit next to each
 * other in a spreadsheet (was alphabetical - score next to settlements made no
 * sense). Identity first, then highest-level signal (score), economy, yields,
 * military, science/culture, infrastructure, triumphs, resources, age systems.
 * Anything uncategorised falls into a tail bucket so new metrics are never
 * silently dropped.
 * @type {Record<string, string[]>}
 */
const CSV_CATEGORY_ORDER = {
  score: ["score"],
  economy: ["gdp", "gold", "gpt", "trade", "deals"],
  yields: ["production", "crops", "culture_yield", "science_yield", "influence", "hpt", "approval"],
  military: ["milpower"],
  knowledge: ["techs", "civics", "wonders"],
  empire: ["population", "land", "settlements", "settlement_cap_pct"],
  triumphs: [
    "triumphs_cultural",
    "triumphs_diplomatic",
    "triumphs_economic",
    "triumphs_expansionist",
    "triumphs_militaristic",
    "triumphs_scientific"
  ],
  resources: [
    "resources_total",
    "resources_empire",
    "resources_city",
    "resources_factory",
    "resources_bonus",
    "resources_treasure"
  ],
  age: ["age_progress", "crisis_stage"]
};

/**
 * Collect every metric id seen across all samples so the column set is stable.
 * @param {DemoHistory} history The persisted history blob.
 * @returns {Set<string>} The set of metric ids.
 */
function collectMetricKeys(history) {
  /** @type {Set<string>} */
  const metricKeys = new Set();
  for (const s of history.samples) {
    if (!s?.players) continue;
    for (const pid of Object.keys(s.players)) {
      const m = s.players[pid]?.metrics;
      if (!m) continue;
      for (const k of Object.keys(m)) metricKeys.add(k);
    }
  }
  return metricKeys;
}

/**
 * Order the seen metric keys by category, then append any uncategorised keys
 * alphabetically so newly-introduced metrics survive.
 * @param {Set<string>} metricKeys The set of seen metric ids.
 * @returns {string[]} The ordered metric column list.
 */
function orderMetricColumns(metricKeys) {
  /** @type {string[]} */
  const orderedMetricCols = [];
  /** @type {Set<string>} */
  const seen = new Set();
  for (const cat of Object.keys(CSV_CATEGORY_ORDER)) {
    for (const k of CSV_CATEGORY_ORDER[cat]) {
      if (metricKeys.has(k) && !seen.has(k)) {
        orderedMetricCols.push(k);
        seen.add(k);
      }
    }
  }
  // Tail: anything in metricKeys that the category map didn't claim,
  // appended in alphabetical order so newly-introduced metrics survive.
  for (const k of Array.from(metricKeys).sort()) {
    if (!seen.has(k)) {
      orderedMetricCols.push(k);
      seen.add(k);
    }
  }
  return orderedMetricCols;
}

/**
 * Quote a CSV cell when it contains a comma, quote, or newline.
 * @param {*} v The cell value.
 * @returns {string} The CSV-safe cell.
 */
function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/**
 * Format a number to remove floating-point noise. Integers stay integer; floats
 * round to 2 decimals; values ≥1000 round to integers (drops 50+% of file size
 * and makes the data readable in a spreadsheet).
 * @param {*} v The numeric value.
 * @returns {string} The formatted number, or "" for non-finite input.
 */
function fmtNum(v) {
  if (typeof v !== "number" || !isFinite(v)) return "";
  if (Number.isInteger(v)) return String(v);
  if (Math.abs(v) >= 1000) return String(Math.round(v));
  return String(Math.round(v * 100) / 100);
}

/**
 * Build & DEDUPLICATE CSV rows by (turn, pid). The sampler can fire twice per
 * turn under certain engine event ordering; last-write-wins so the latest
 * snapshot for each (turn, pid) is preserved.
 * @param {DemoHistory} history The persisted history blob.
 * @param {string[]} metricCols Ordered metric column ids.
 * @returns {Map<string, string[]>} Map of "turn:pid" → cell array.
 */
function buildCsvRowMap(history, metricCols) {
  /** @type {Map<string, string[]>} */
  const rowByKey = new Map();
  for (const s of history.samples) {
    if (!s?.players) continue;
    for (const pid of Object.keys(s.players)) {
      const cells = buildCsvRowCells(s, pid, s.players[pid], metricCols);
      rowByKey.set(s.turn + ":" + pid, cells);
    }
  }
  return rowByKey;
}

/**
 * Build the ordered cell array for one (turn, pid) CSV row: the seven identity
 * columns followed by one formatted value per metric column.
 * @param {Snapshot} s The sample row.
 * @param {string} pid The player id key.
 * @param {CivSample} ps The per-civ sample.
 * @param {string[]} metricCols Ordered metric column ids.
 * @returns {string[]} The row's cell array.
 */
function buildCsvRowCells(s, pid, ps, metricCols) {
  const cells = [
    csvCell(s.turn),
    csvCell(s.gameYear || ""),
    csvCell(pid),
    csvCell(ps.leaderName || ""),
    csvCell(ps.civName || ""),
    csvCell(ps.civTypeString || ""),
    csvCell(ps.met)
  ];
  for (const k of metricCols) {
    cells.push(fmtNum(ps.metrics?.[k]));
  }
  return cells;
}

/**
 * Read the current game's speed / map / age for the CSV provenance header.
 * Each lookup is best-effort and defaults to "unknown".
 * @returns {{ gameSpeed: string, mapType: string, currentAge: string }} Context.
 */
function readCsvGameContext() {
  return {
    gameSpeed: readGameSpeedLabel(),
    mapType: readMapTypeLabel(),
    currentAge: readCurrentAgeLabel()
  };
}

/**
 * Best-effort read of the current game-speed label for the CSV header.
 * @returns {string} The lowercased speed type, or "unknown".
 */
function readGameSpeedLabel() {
  try {
    if (typeof Configuration === "undefined" || !Configuration.getGame) return "unknown";
    const speedHash = Configuration.getGame()?.getValue?.("GameSpeed");
    return gameSpeedLabelFor(speedHash);
  } catch (_) {
    // Configuration.getGame()/getValue("GameSpeed") can throw at the engine
    // boundary; report "unknown" in the CSV provenance header.
    return "unknown";
  }
}

/**
 * Resolve a GameSpeed hash to its lowercased speed-type label via GameInfo.
 * @param {*} speedHash The GameSpeed config hash.
 * @returns {string} The lowercased speed type, or "unknown".
 */
function gameSpeedLabelFor(speedHash) {
  if (speedHash == null || typeof GameInfo === "undefined") return "unknown";
  const row = GameInfo.GameSpeeds?.lookup?.(speedHash);
  if (row?.GameSpeedType) return row.GameSpeedType.replace(/^GAMESPEED_/, "").toLowerCase();
  return "unknown";
}

/**
 * Best-effort read of the current map-script label for the CSV header.
 * @returns {string} The map script string, or "unknown".
 */
function readMapTypeLabel() {
  try {
    if (typeof Configuration !== "undefined" && Configuration.getMap) {
      const m = Configuration.getMap();
      const ms = m?.mapScript;
      if (typeof ms === "string") return ms;
    }
  } catch (_) {
    // Configuration.getMap().mapScript can throw at the engine boundary;
    // report "unknown" in the CSV provenance header.
  }
  return "unknown";
}

/**
 * Best-effort read of the current age label for the CSV header.
 * @returns {string} The lowercased age type, or "unknown".
 */
function readCurrentAgeLabel() {
  try {
    if (typeof Game !== "undefined" && Game.age != null) {
      const ageRow = GameInfo.Ages?.lookup?.(Game.age);
      if (ageRow?.AgeType) return ageRow.AgeType.replace(/^AGE_/, "").toLowerCase();
    }
  } catch (_) {
    // Game.age / GameInfo.Ages.lookup(Game.age) can throw at the engine
    // boundary; report "unknown" in the CSV provenance header.
  }
  return "unknown";
}

/**
 * Build the `#`-prefixed metadata header lines (provenance + game context) that
 * lead the CSV. Most importers honor `#` lines as comments.
 * @param {DemoHistory} history The persisted history blob.
 * @param {Map<string, string[]>} rowByKey Built row map (for counts).
 * @param {string[]} metricCols Ordered metric column ids.
 * @returns {string[]} The metadata header lines (excluding the column header).
 */
function buildCsvMetaHeader(history, rowByKey, metricCols) {
  const metaTime = new Date().toISOString();
  const lastSample = history.samples[history.samples.length - 1];
  const firstSample = history.samples[0];
  const turnsCovered = (lastSample?.turn || 0) - (firstSample?.turn || 0) + 1;
  const { gameSpeed, mapType, currentAge } = readCsvGameContext();
  const civCount = Array.from(rowByKey.keys()).reduce(
    (s, k) => s.add(k.split(":")[1]),
    /** @type {Set<string>} */ (new Set())
  ).size;
  /** @type {string[]} */
  const lines = [];
  // Lead the file with a UTF-8 BOM so Excel on Windows/macOS auto-detects
  // the encoding - without it, "Hawai'i" / "José" / "Sayyida" import as
  // mojibake. Standard byte sequence: U+FEFF (3 UTF-8 bytes).
  lines.push("﻿# === Demographics CSV export ===");
  lines.push("# Mod: Demographics v1.0.0");
  lines.push("# Exported: " + metaTime);
  lines.push("# Game speed: " + gameSpeed + " · Map: " + mapType + " · Current age: " + currentAge);
  lines.push(
    "# Coverage: turns " +
      (firstSample?.turn || 0) +
      "→" +
      (lastSample?.turn || 0) +
      " (" +
      turnsCovered +
      " turns)" +
      " · " +
      civCount +
      " civilizations · " +
      rowByKey.size +
      " rows · " +
      metricCols.length +
      " metrics"
  );
  lines.push("# Format: integers exact, floats <1000 → 2 dp, ≥1000 → integer");
  lines.push("# Sorting: deduplicated by (turn, pid); sorted ascending");
  lines.push(
    "# Columns grouped by category: identity → score → economy → yields → military → knowledge → empire → triumphs → resources → age"
  );
  lines.push("#");
  return lines;
}

/**
 * Write `csv` to the clipboard via the engine's `UI.setClipboardText`, gated by
 * `UI.isClipboardAvailable()` where present (cite: pause-menu-model.js).
 * @param {string} csv The full CSV text.
 * @returns {boolean} True when the clipboard write succeeded.
 */
function writeCsvToClipboard(csv) {
  let clipboardOk = false;
  try {
    if (
      typeof UI !== "undefined" &&
      typeof UI.isClipboardAvailable === "function" &&
      UI.isClipboardAvailable() &&
      typeof UI.setClipboardText === "function"
    ) {
      UI.setClipboardText(csv);
      clipboardOk = true;
    } else if (typeof UI !== "undefined" && typeof UI.setClipboardText === "function") {
      // Older Civ7 builds didn't ship isClipboardAvailable() - try anyway.
      UI.setClipboardText(csv);
      clipboardOk = true;
    }
  } catch (e) {
    derr("CSV export: clipboard write threw:", /** @type {*} */ (e)?.message);
  }
  return clipboardOk;
}

/**
 * Export `history.samples` to a flat CSV (one row per turn/pid, one column per
 * metric) and hand it to the player via the clipboard, with a UI.log fallback
 * and a visible confirmation toast. No-op (with a toast) when there are no
 * samples; refuses oversized exports that would crash the clipboard bridge.
 * @param {DemoHistory|undefined} history The persisted history blob.
 * @param {HTMLElement} [host] Host for the confirmation toast.
 */
export function exportHistoryAsCsv(history, host) {
  if (!history || !Array.isArray(history.samples) || history.samples.length === 0) {
    dlog("CSV export: no samples to write");
    if (host) showCsvToast(host, t("LOC_DEMOGRAPHICS_CSV_NO_SAMPLES"), false);
    return;
  }
  const { csv, lines, headers } = buildCsvDocument(history);

  // ── Size guard ──────────────────────────────────────────────────────
  // Above ~5 MB the clipboard write can fail silently and the log dump
  // stalls the engine for several seconds. Above ~15 MB we've seen the
  // Coherent IPC bridge actually drop the call. Tiered handling:
  //   < 2 MB  → normal flow, clipboard + log
  //   2-8 MB  → clipboard yes, log summary only (no full dump)
  //   > 8 MB  → refuse, tell user to lower sample cap + retry
  const sizeMB = (csv.length / (1024 * 1024)).toFixed(1);
  if (csv.length > CSV_HARD_LIMIT) {
    refuseOversizedCsv(host, sizeMB);
    return;
  }

  // Step 1: try clipboard. UI.isClipboardAvailable() is the canonical gate
  // (cite: pause-menu-model.js).
  const clipboardOk = writeCsvToClipboard(csv);

  // Step 2: dump to UI.log as a recoverable fallback.
  logCsvDump(csv, lines.length, sizeMB, clipboardOk);

  // Step 3: visible toast confirmation.
  showCsvResultToast({
    host,
    csv,
    lineCount: lines.length,
    colCount: headers.length,
    sizeMB,
    clipboardOk
  });

  dlog(
    "CSV export complete; clipboard=" +
      clipboardOk +
      " rows=" +
      lines.length +
      " chars=" +
      csv.length
  );
}

/** Soft size threshold above which the full CSV log dump is skipped. */
const CSV_SOFT_LIMIT = 2 * 1024 * 1024;
/** Hard size threshold above which the export is refused outright. */
const CSV_HARD_LIMIT = 8 * 1024 * 1024;

/**
 * Build the full CSV document for `history`: collect + order columns, build the
 * deduplicated rows, prepend the metadata header, and join into one string.
 * @param {DemoHistory} history The persisted history blob.
 * @returns {{ csv: string, lines: string[], headers: string[] }} The CSV text,
 *   its line array, and the column-header array.
 */
function buildCsvDocument(history) {
  // Collect every metric ID we've ever seen so columns are stable.
  const metricKeys = collectMetricKeys(history);
  const metricCols = orderMetricColumns(metricKeys);
  const headers = [
    "turn",
    "gameYear",
    "pid",
    "leaderName",
    "civName",
    "civType",
    "met",
    ...metricCols
  ];
  const rowByKey = buildCsvRowMap(history, metricCols);
  // Emit sorted by (turn ASC, pid ASC) for predictable spreadsheet order.
  const sortedKeys = Array.from(rowByKey.keys()).sort((a, b) => {
    const [ta, pa] = a.split(":").map(Number);
    const [tb, pb] = b.split(":").map(Number);
    return ta - tb || pa - pb;
  });
  // ── Metadata header ─────────────────────────────────────────────────
  // `#`-prefixed lines - most importers honor them as comments (Excel
  // skips-on-import; Sheets reads as text; Pandas via comment='#').
  // Provenance + game context so an exported file remains analyzable
  // months later without remembering the game state.
  const lines = buildCsvMetaHeader(history, rowByKey, metricCols);
  lines.push(headers.join(","));
  for (const k of sortedKeys) lines.push(/** @type {string[]} */ (rowByKey.get(k)).join(","));
  const csv = lines.join("\n");
  return { csv, lines, headers };
}

/**
 * Log and toast a refusal for a CSV that exceeds the hard size limit.
 * @param {HTMLElement|undefined} host Host for the toast.
 * @param {string} sizeMB Formatted CSV size in MB.
 */
function refuseOversizedCsv(host, sizeMB) {
  console.error(
    "[Demographics.csv-export] export ABORTED at " +
      sizeMB +
      " MB (> 8 MB hard limit). " +
      "Lower the sample cap in Options (e.g. 5000) and retry."
  );
  if (host) {
    showCsvToast(host, t("LOC_DEMOGRAPHICS_CSV_TOO_LARGE", sizeMB), false);
  }
}

/**
 * Dump the CSV to UI.log as a recoverable fallback - full dump under the soft
 * limit, summary line above it (so the log writer isn't stalled).
 * @param {string} csv The full CSV text.
 * @param {number} lineCount Total CSV line count.
 * @param {string} sizeMB Formatted CSV size in MB.
 * @param {boolean} clipboardOk Whether the clipboard write succeeded.
 */
function logCsvDump(csv, lineCount, sizeMB, clipboardOk) {
  if (csv.length <= CSV_SOFT_LIMIT) {
    console.warn(
      "[Demographics.csv-export] BEGIN_DEMOGRAPHICS_CSV " +
        lineCount +
        " rows, " +
        csv.length +
        " chars"
    );
    console.warn(csv);
    console.warn("[Demographics.csv-export] END_DEMOGRAPHICS_CSV");
  } else {
    console.warn(
      "[Demographics.csv-export] CSV is large (" +
        sizeMB +
        " MB · " +
        lineCount +
        " rows) — skipping full log dump." +
        " Clipboard write was " +
        (clipboardOk ? "OK" : "FAILED") +
        "."
    );
  }
}

/**
 * Show the success / fallback toast for a completed CSV export. Accounts for
 * the 9-line meta header + the single column-header row when reporting the
 * data-row count.
 * @param {{
 *   host: HTMLElement|undefined,
 *   csv: string,
 *   lineCount: number,
 *   colCount: number,
 *   sizeMB: string,
 *   clipboardOk: boolean
 * }} params Toast payload.
 */
function showCsvResultToast(params) {
  const { host, csv, lineCount, colCount, sizeMB, clipboardOk } = params;
  const META_LINES = 9; // keep in sync with metadata-header push count above
  const dataRows = lineCount - META_LINES - 1;
  const sizeTag = csv.length >= CSV_SOFT_LIMIT ? " · " + sizeMB + " MB" : "";
  if (!host) return;
  if (clipboardOk) {
    showCsvToast(host, t("LOC_DEMOGRAPHICS_CSV_COPIED", dataRows, colCount, sizeTag), true);
  } else {
    showCsvToast(host, t("LOC_DEMOGRAPHICS_CSV_CLIPBOARD_UNAVAILABLE"), false);
  }
}
