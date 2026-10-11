// File-tree helpers for the static gates that scan the mod's source instead of running it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const UI_DIR = path.join(ROOT, "ui");

// Path relative to the mod root with forward slashes, the form messages and the modinfo use.
export const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");

/**
 * Every file under `dir`, recursively, whose name matches `pattern`.
 * @param {string} dir
 * @param {RegExp} pattern
 * @returns {string[]}
 */
export function listFiles(dir, pattern) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? listFiles(p, pattern) : pattern.test(d.name) ? [p] : [];
  });
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
export const listJs = (dir) => listFiles(dir, /\.js$/);

// Drops block and line comments from JS source. A `//` right after a colon is kept, so URLs such as
// "fs://game/..." inside strings survive.
export const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
