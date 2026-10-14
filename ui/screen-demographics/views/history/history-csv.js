// history-csv.js
//
// CSV export for the "Historical Data" view: one row per (turn, pid), one
// column per metric. Coherent GameFace has no `URL.createObjectURL` or
// `<a download>`, so the CSV goes to the clipboard via `UI.setClipboardText`,
// with UI.log as a fallback. Either path ends with a visible toast.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { makeLogger } from "/demographics/ui/core/demographics-log.js";

const log = makeLogger("history-csv");

/**
 * @param {HTMLElement} host
 * @param {string} message
 * @param {boolean} success
 */
function showCsvToast(host, message, success) {
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
 * Columns ordered by category so related metrics sit next to each other in a
 * spreadsheet. Anything uncategorised falls into a tail bucket so new metrics
 * are never silently dropped.
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

/** @param {DemoHistory} history */
function collectMetricKeys(history) {
  /** @type {Set<string>} */
  const metricKeys = new Set();
  for (const sample of history.samples) {
    if (!sample?.players) continue;
    for (const pid of Object.keys(sample.players)) {
      const metrics = sample.players[pid]?.metrics;
      if (!metrics) continue;
      for (const k of Object.keys(metrics)) metricKeys.add(k);
    }
  }
  return metricKeys;
}

/** @param {Set<string>} metricKeys */
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

/** @param {*} value */
function csvCell(value) {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // Formula-injection guard: spreadsheets execute a cell starting with = + - @
  // (or a leading tab/CR) as a formula. Prefix a single quote, but skip plain
  // numbers (incl. negatives / BCE years) so numeric values keep their meaning.
  if (/^[=+\-@\t\r]/.test(text) && !/^[+-]?[0-9]/.test(text)) text = "'" + text;
  if (/[",\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

/**
 * Format a number to remove floating-point noise. Integers stay integer; floats
 * round to 2 decimals; values ≥1000 round to integers (drops 50+% of file size
 * and makes the data readable in a spreadsheet).
 * @param {*} value
 * @returns {string} "" for non-finite input.
 */
function formatCsvNumber(value) {
  if (typeof value !== "number" || !isFinite(value)) return "";
  if (Number.isInteger(value)) return String(value);
  if (Math.abs(value) >= 1000) return String(Math.round(value));
  return String(Math.round(value * 100) / 100);
}

/**
 * The monotonic, cross-age-unique turn for a snapshot: `chartTurn` (continuous
 * across ages), since `turn` resets at every age boundary. Falls back to `turn`
 * for saves without chartTurn.
 * @param {Snapshot} sample
 * @returns {number} The turn used as both the row key and the sort key.
 */
function rowSortTurn(sample) {
  if (typeof sample.chartTurn === "number" && isFinite(sample.chartTurn)) return sample.chartTurn;
  return typeof sample.turn === "number" ? sample.turn : 0;
}

/**
 * Build and deduplicate CSV rows by (chartTurn, pid), last-write-wins, since the
 * sampler can fire twice per turn. Keying by chartTurn keeps cross-age rows distinct.
 * @param {DemoHistory} history
 * @param {string[]} metricCols
 * @returns {Map<string, string[]>} Map of "chartTurn:pid" → cell array.
 */
function buildCsvRowMap(history, metricCols) {
  /** @type {Map<string, string[]>} */
  const rowByKey = new Map();
  for (const sample of history.samples) {
    if (!sample?.players) continue;
    for (const pid of Object.keys(sample.players)) {
      const cells = buildCsvRowCells(sample, pid, sample.players[pid], metricCols);
      rowByKey.set(rowSortTurn(sample) + ":" + pid, cells);
    }
  }
  return rowByKey;
}

/**
 * @param {Snapshot} sample
 * @param {string} pid
 * @param {CivSample} civSample
 * @param {string[]} metricCols
 */
function buildCsvRowCells(sample, pid, civSample, metricCols) {
  const cells = [
    csvCell(sample.turn),
    csvCell(sample.age || ""),
    csvCell(sample.gameYear || ""),
    csvCell(pid),
    csvCell(civSample.leaderName || ""),
    csvCell(civSample.civName || ""),
    csvCell(civSample.civTypeString || ""),
    csvCell(civSample.met)
  ];
  for (const k of metricCols) {
    cells.push(formatCsvNumber(civSample.metrics?.[k]));
  }
  return cells;
}

function readCsvGameContext() {
  return {
    gameSpeed: readGameSpeedLabel(),
    mapType: readMapTypeLabel(),
    currentAge: readCurrentAgeLabel()
  };
}

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
 * @param {*} speedHash
 * @returns {string}
 */
function gameSpeedLabelFor(speedHash) {
  if (speedHash == null || typeof GameInfo === "undefined") return "unknown";
  const row = GameInfo.GameSpeeds?.lookup?.(speedHash);
  if (row?.GameSpeedType) return row.GameSpeedType.replace(/^GAMESPEED_/, "").toLowerCase();
  return "unknown";
}

function readMapTypeLabel() {
  try {
    if (typeof Configuration !== "undefined" && Configuration.getMap) {
      const mapConfig = Configuration.getMap();
      const mapScript = mapConfig?.mapScript;
      if (typeof mapScript === "string") return mapScript;
    }
  } catch (_) {
    // Configuration.getMap().mapScript can throw at the engine boundary;
    // report "unknown" in the CSV provenance header.
  }
  return "unknown";
}

/** @returns {string} */
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
 * @param {DemoHistory} history
 * @param {Map<string, string[]>} rowByKey
 * @param {string[]} metricCols
 */
function buildCsvMetaHeader(history, rowByKey, metricCols) {
  const metaTime = new Date().toISOString();
  const lastSample = history.samples[history.samples.length - 1];
  const firstSample = history.samples[0];
  const turnsCovered = (lastSample?.turn || 0) - (firstSample?.turn || 0) + 1;
  const { gameSpeed, mapType, currentAge } = readCsvGameContext();
  const civCount = Array.from(rowByKey.keys()).reduce(
    (pids, key) => pids.add(key.split(":")[1]),
    /** @type {Set<string>} */ (new Set())
  ).size;
  /** @type {string[]} */
  const lines = [];
  // Lead the file with a UTF-8 BOM so Excel on Windows/macOS auto-detects
  // the encoding - without it, "Hawai'i" / "José" / "Sayyida" import as
  // mojibake. Standard byte sequence: U+FEFF (3 UTF-8 bytes).
  lines.push("\ufeff# === " + t("LOC_DEMOGRAPHICS_CSV_META_TITLE") + " ===");
  lines.push("# Mod: Demographics v1.0.0");
  lines.push("# " + t("LOC_DEMOGRAPHICS_CSV_META_EXPORTED", metaTime));
  lines.push("# " + t("LOC_DEMOGRAPHICS_CSV_META_CONTEXT", gameSpeed, mapType, currentAge));
  lines.push(
    "# " +
      t(
        "LOC_DEMOGRAPHICS_CSV_META_COVERAGE",
        firstSample?.turn || 0,
        lastSample?.turn || 0,
        turnsCovered,
        civCount,
        rowByKey.size,
        metricCols.length
      )
  );
  lines.push("# " + t("LOC_DEMOGRAPHICS_CSV_META_FORMAT"));
  lines.push("# " + t("LOC_DEMOGRAPHICS_CSV_META_SORTING"));
  lines.push("# " + t("LOC_DEMOGRAPHICS_CSV_META_COLUMNS"));
  lines.push("#");
  return lines;
}

/**
 * Write `csv` to the clipboard via the engine's `UI.setClipboardText`, gated by
 * `UI.isClipboardAvailable()` where present (cite: pause-menu-model.js).
 * @param {string} csv
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
      // Builds without isClipboardAvailable() - try anyway.
      UI.setClipboardText(csv);
      clipboardOk = true;
    }
  } catch (e) {
    log.error("CSV export: clipboard write threw:", /** @type {*} */ (e)?.message);
  }
  return clipboardOk;
}

/**
 * Export `history.samples` to a flat CSV via the clipboard, with a UI.log
 * fallback and a confirmation toast. No-op (with a toast) when there are no
 * samples; refuses oversized exports that would crash the clipboard bridge.
 * @param {DemoHistory|undefined} history
 * @param {HTMLElement} [host]
 */
export function exportHistoryAsCsv(history, host) {
  if (!history || !Array.isArray(history.samples) || history.samples.length === 0) {
    log.debug("CSV export: no samples to write");
    if (host) showCsvToast(host, t("LOC_DEMOGRAPHICS_CSV_NO_SAMPLES"), false);
    return;
  }
  const { csv, lines, headers } = buildCsvDocument(history);

  // Large payloads stall the log writer and can drop the Coherent IPC call.
  //   < 2 MB  → normal flow, clipboard + log
  //   2-8 MB  → clipboard yes, log summary only (no full dump)
  //   > 8 MB  → refuse, tell user to lower sample cap + retry
  const sizeMB = (csv.length / (1024 * 1024)).toFixed(1);
  if (csv.length > CSV_HARD_LIMIT) {
    refuseOversizedCsv(host, sizeMB);
    return;
  }

  // UI.isClipboardAvailable() is the canonical gate (cite: pause-menu-model.js).
  const clipboardOk = writeCsvToClipboard(csv);

  // The log dump is the fallback when the clipboard write is refused.
  logCsvDump(csv, lines.length, sizeMB, clipboardOk);

  showCsvResultToast({
    host,
    csv,
    lineCount: lines.length,
    colCount: headers.length,
    sizeMB,
    clipboardOk
  });

  log.debug(
    "CSV export complete; clipboard=" +
      clipboardOk +
      " rows=" +
      lines.length +
      " chars=" +
      csv.length
  );
}

const CSV_SOFT_LIMIT = 2 * 1024 * 1024;
const CSV_HARD_LIMIT = 8 * 1024 * 1024;

/** @param {DemoHistory} history */
function buildCsvDocument(history) {
  const metricKeys = collectMetricKeys(history);
  const metricCols = orderMetricColumns(metricKeys);
  const headers = [
    "turn",
    "age",
    "gameYear",
    "pid",
    "leaderName",
    "civName",
    "civType",
    "met",
    ...metricCols
  ];
  const rowByKey = buildCsvRowMap(history, metricCols);
  // Emit sorted by (chartTurn ASC, pid ASC) for predictable, chronological
  // spreadsheet order across ages (the key is "chartTurn:pid").
  const sortedKeys = Array.from(rowByKey.keys()).sort((a, b) => {
    const [turnA, pidA] = a.split(":").map(Number);
    const [turnB, pidB] = b.split(":").map(Number);
    return turnA - turnB || pidA - pidB;
  });
  // `#`-prefixed provenance + game context lines; most importers honor them as comments.
  const lines = buildCsvMetaHeader(history, rowByKey, metricCols);
  lines.push(headers.join(","));
  for (const k of sortedKeys) lines.push(/** @type {string[]} */ (rowByKey.get(k)).join(","));
  const csv = lines.join("\n");
  return { csv, lines, headers };
}

/**
 * @param {HTMLElement|undefined} host
 * @param {string} sizeMB
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
 * @param {string} csv
 * @param {number} lineCount
 * @param {string} sizeMB
 * @param {boolean} clipboardOk
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
        " rows), skipping full log dump." +
        " Clipboard write was " +
        (clipboardOk ? "OK" : "FAILED") +
        "."
    );
  }
}

/**
 * @param {{
 *   host: HTMLElement|undefined,
 *   csv: string,
 *   lineCount: number,
 *   colCount: number,
 *   sizeMB: string,
 *   clipboardOk: boolean
 * }} params
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
