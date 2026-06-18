// demographics-csv.js
//
// Generic "Copy as CSV" plumbing shared by every data page in the mod (World
// Rankings sub-tabs, Global Relations, and the History conflicts/crises/legacy
// pages). The History per-turn sample dump keeps its own richer exporter in
// views/history/history-csv.js; this module covers the table-shaped pages.
//
// Coherent GameFace exposes no `URL.createObjectURL` / `<a download>`, so the
// CSV is handed to the player via the engine clipboard
// (UI.setClipboardText / UI.isClipboardAvailable ; cite: pause-menu-model.js),
// with a UI.log fallback and a visible confirmation toast. The toast + button
// styling reuse the existing .demographics-csv-toast / .demographics-chart-
// toolbar-btn rules.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { safePlaySound } from "/demographics/ui/core/demographics-audio.js";
import { makeClickable } from "/demographics/ui/core/demographics-a11y.js";

/** Soft size threshold above which the full CSV log dump is skipped. */
const CSV_SOFT_LIMIT = 2 * 1024 * 1024;
/** Hard size threshold above which the export is refused outright. */
const CSV_HARD_LIMIT = 8 * 1024 * 1024;

/**
 * Error logger for this module.
 * @param {...*} a Values to log.
 */
function derr(...a) {
  console.error("[Demographics.csv]", ...a);
}

/**
 * Quote a CSV cell when it contains a comma, quote, or newline.
 * @param {*} v The cell value.
 * @returns {string} The CSV-safe cell.
 */
export function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/**
 * Format a number to remove floating-point noise: integers stay integer; floats
 * round to 2 decimals; values ≥1000 round to integers.
 * @param {*} v The numeric value.
 * @returns {string} The formatted number, or "" for non-finite input.
 */
function fmtNum(v) {
  if (!isFinite(v)) return "";
  if (Number.isInteger(v)) return String(v);
  if (Math.abs(v) >= 1000) return String(Math.round(v));
  return String(Math.round(v * 100) / 100);
}

/**
 * Render one cell value: numbers go through {@link fmtNum}, everything else is
 * CSV-escaped as a string.
 * @param {*} v The cell value.
 * @returns {string} The CSV cell text.
 */
function fmtCell(v) {
  return typeof v === "number" ? fmtNum(v) : csvCell(v);
}

/**
 * Best-effort read of a labeled game-context value, swallowing engine-boundary
 * throws and returning "unknown".
 * @param {() => string|undefined} fn The reader.
 * @returns {string} The label, or "unknown".
 */
function safeLabel(fn) {
  try {
    const v = fn();
    return typeof v === "string" && v ? v : "unknown";
  } catch (_) {
    return "unknown";
  }
}

/**
 * The current game-speed type label (lowercased, GAMESPEED_ stripped).
 * @returns {string|undefined} The speed label.
 */
function readGameSpeed() {
  // Bare access (no optional chaining): any engine-boundary throw is caught by
  // safeLabel, which keeps this function's branch count under the lint cap.
  const h = Configuration.getGame().getValue("GameSpeed");
  const row = GameInfo.GameSpeeds.lookup(h);
  return row && row.GameSpeedType
    ? row.GameSpeedType.replace(/^GAMESPEED_/, "").toLowerCase()
    : undefined;
}

/**
 * The current age type label (lowercased, AGE_ stripped).
 * @returns {string|undefined} The age label.
 */
function readAge() {
  const row = Game?.age == null ? null : GameInfo?.Ages?.lookup?.(Game.age);
  return row?.AgeType?.replace(/^AGE_/, "").toLowerCase();
}

/**
 * Read the current game's speed / map / age for the CSV provenance header.
 * @returns {{ gameSpeed: string, mapType: string, currentAge: string }} Context.
 */
function readGameContext() {
  return {
    gameSpeed: safeLabel(readGameSpeed),
    mapType: safeLabel(() => Configuration?.getMap?.()?.mapScript),
    currentAge: safeLabel(readAge)
  };
}

/**
 * Build the `#`-prefixed provenance/context header lines that lead the CSV.
 * Most importers honor `#` lines as comments. Leads with a UTF-8 BOM so Excel
 * auto-detects the encoding (keeps accented civ/leader names intact).
 * @param {string} title Human-readable export title (the page name).
 * @param {number} rowCount Data row count.
 * @param {number} colCount Column count.
 * @returns {string[]} The metadata header lines (excluding the column header).
 */
function buildMetaHeader(title, rowCount, colCount) {
  const { gameSpeed, mapType, currentAge } = readGameContext();
  return [
    "﻿# === Demographics CSV export ===",
    "# Page: " + title,
    "# Mod: Demographics v1.0.0",
    "# Game speed: " + gameSpeed + " · Map: " + mapType + " · Current age: " + currentAge,
    "# Contents: " + rowCount + " rows · " + colCount + " columns",
    "# Format: integers exact, floats <1000 → 2 dp, ≥1000 → integer",
    "#"
  ];
}

/**
 * Show a transient toast in `host`, auto-removing after 4s. Replaces any prior
 * toast first. Toast chrome lives in the .demographics-csv-toast rule; only the
 * success/failure tint is dynamic.
 * @param {HTMLElement} host The host element.
 * @param {string} message Toast text.
 * @param {boolean} success Green (success) vs orange (failure) styling.
 */
function showCsvToast(host, message, success) {
  try {
    const old = host.querySelector(".demographics-csv-toast");
    if (old) old.remove();
  } catch (_) {
    // host.querySelector can throw if host is detached; append anyway.
  }
  const toast = document.createElement("div");
  toast.className = "demographics-csv-toast";
  toast.style.borderColor = success ? "rgba(73,209,130,0.7)" : "rgba(213,94,0,0.7)";
  toast.style.color = success ? "#49d182" : "#D55E00";
  toast.textContent = message;
  host.appendChild(toast);
  setTimeout(() => {
    try {
      toast.remove();
    } catch (_) {
      // already detached
    }
  }, 4000);
}

/**
 * Write `csv` to the clipboard via the engine's `UI.setClipboardText`, gated by
 * `UI.isClipboardAvailable()` where present (cite: pause-menu-model.js).
 * @param {string} csv The full CSV text.
 * @returns {boolean} True when the clipboard write succeeded.
 */
function writeCsvToClipboard(csv) {
  try {
    if (typeof UI === "undefined" || typeof UI.setClipboardText !== "function") return false;
    if (typeof UI.isClipboardAvailable === "function" && !UI.isClipboardAvailable()) {
      // Older builds lacked the gate; with it present and false, still try.
      UI.setClipboardText(csv);
      return true;
    }
    UI.setClipboardText(csv);
    return true;
  } catch (e) {
    derr("clipboard write threw:", /** @type {*} */ (e)?.message);
    return false;
  }
}

/**
 * Dump the CSV to UI.log as a recoverable fallback , full dump under the soft
 * limit, summary line above it.
 * @param {string} csv The full CSV text.
 * @param {string} sizeMB Formatted CSV size in MB.
 * @param {boolean} clipboardOk Whether the clipboard write succeeded.
 */
function logCsvDump(csv, sizeMB, clipboardOk) {
  if (csv.length <= CSV_SOFT_LIMIT) {
    console.warn("[Demographics.csv] BEGIN_DEMOGRAPHICS_CSV " + csv.length + " chars");
    console.warn(csv);
    console.warn("[Demographics.csv] END_DEMOGRAPHICS_CSV");
  } else {
    console.warn(
      "[Demographics.csv] CSV is large (" + sizeMB + " MB) , skipping full log dump." +
        " Clipboard write was " + (clipboardOk ? "OK" : "FAILED") + "."
    );
  }
}

/**
 * Build a CSV document, copy it to the clipboard (with a UI.log fallback), and
 * show a confirmation toast. No-op (with a toast) when there are no rows;
 * refuses oversized exports that would crash the clipboard bridge.
 * @param {{ host?: HTMLElement, title: string, headers: string[],
 *   rows: Array<Array<string|number|null|undefined>> }} opts Export inputs.
 */
export function copyTableAsCsv(opts) {
  const { host, title, headers, rows } = opts;
  if (!Array.isArray(rows) || rows.length === 0) {
    if (host) showCsvToast(host, t("LOC_DEMOGRAPHICS_CSV_NO_SAMPLES"), false);
    return;
  }
  const lines = buildMetaHeader(title, rows.length, headers.length);
  lines.push(headers.map(csvCell).join(","));
  for (const r of rows) lines.push(r.map(fmtCell).join(","));
  deliverCsv(host, lines.join("\n"), rows.length, headers.length);
}

/**
 * Copy a built CSV string to the clipboard (with a UI.log fallback) and show the
 * result toast, refusing oversized exports.
 * @param {HTMLElement|undefined} host Host for the confirmation toast.
 * @param {string} csv The full CSV text.
 * @param {number} rowCount Data row count (for the toast).
 * @param {number} colCount Column count (for the toast).
 */
function deliverCsv(host, csv, rowCount, colCount) {
  const sizeMB = (csv.length / (1024 * 1024)).toFixed(1);
  if (csv.length > CSV_HARD_LIMIT) {
    if (host) showCsvToast(host, t("LOC_DEMOGRAPHICS_CSV_TOO_LARGE", sizeMB), false);
    return;
  }
  const clipboardOk = writeCsvToClipboard(csv);
  logCsvDump(csv, sizeMB, clipboardOk);
  if (!host) return;
  const sizeTag = csv.length >= CSV_SOFT_LIMIT ? " · " + sizeMB + " MB" : "";
  if (clipboardOk) {
    showCsvToast(host, t("LOC_DEMOGRAPHICS_CSV_COPIED", rowCount, colCount, sizeTag), true);
  } else {
    showCsvToast(host, t("LOC_DEMOGRAPHICS_CSV_CLIPBOARD_UNAVAILABLE"), false);
  }
}

/**
 * Build a styled "Copy as CSV" button that plays the activate sound and invokes
 * `onClick`. Reuses the chart-toolbar button look.
 * @param {() => void} onClick The export handler.
 * @returns {HTMLElement} The button element.
 */
export function makeCsvButton(onClick) {
  const btn = document.createElement("div");
  btn.className = "demographics-chart-toolbar-btn font-body text-xs";
  btn.textContent = t("LOC_DEMOGRAPHICS_BTN_COPY_CSV");
  btn.title = t("LOC_DEMOGRAPHICS_BTN_COPY_CSV_TOOLTIP");
  makeClickable(btn, (ev) => {
    /** @type {*} */ (ev)?.stopPropagation?.();
    safePlaySound("data-audio-activate", "options");
    onClick();
  });
  return btn;
}

/**
 * Build a left-aligned toolbar row wrapping a single "Copy as CSV" button, ready
 * to prepend to a page's content.
 * @param {() => void} onClick The export handler.
 * @returns {HTMLElement} The toolbar row element.
 */
export function buildCsvBar(onClick) {
  const bar = document.createElement("div");
  bar.className = "demographics-csv-bar";
  bar.appendChild(makeCsvButton(onClick));
  return bar;
}
