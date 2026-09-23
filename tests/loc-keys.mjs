import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isBaseGameLoc, BASE_GAME_LOC_KEYS, BASE_GAME_LOC_PREFIXES } from "/demographics/ui/core/demographics-i18n.js";

// LOC-key definedness gate: every literal `LOC_[A-Z0-9_]+` referenced in ui/**/*.js (comments
// stripped) and ui/**/*.html (HTML comments stripped) must be defined in text/en_us/ModText.xml,
// or be a base-game key per the registry in ui/core/demographics-i18n.js (`isBaseGameLoc`). A tag
// that is neither renders as the raw "LOC_..." string in game. tests/i18n.mjs then guarantees
// every en_us key exists in all locales, so together they cover reference -> en_us -> locales.
//
// Keys built by concatenation (`"LOC_DEMOGRAPHICS_METRIC_" + id`) show up as a literal ending in
// "_" and are checked as PREFIXES: at least one defined (or registered base-game) key must start
// with it. A bare `"LOC_" + x` build is too generic to check and is only counted. Runs under the
// test loader because it imports the mod's own registry module.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UI = path.join(ROOT, "ui");
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");

/** @param {string} dir @returns {string[]} */
function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? listFiles(p) : /\.(js|html)$/.test(d.name) ? [p] : [];
  });
}
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const stripHtml = (s) => s.replace(/<!--[\s\S]*?-->/g, "");

const defined = new Set(
  [...fs.readFileSync(path.join(ROOT, "text/en_us/ModText.xml"), "utf8").matchAll(/Tag="(LOC_[A-Z0-9_]+)"/g)].map((m) => m[1])
);
assert.ok(defined.size > 0, "text/en_us/ModText.xml defines no LOC tags (parse failure?)");

/** @type {Map<string, Set<string>>} key or prefix -> referencing files */
const refs = new Map();
const files = listFiles(UI);
for (const abs of files) {
  const raw = fs.readFileSync(abs, "utf8");
  const code = abs.endsWith(".js") ? stripJs(raw) : stripHtml(raw);
  // `*` (not `+`) so a bare `"LOC_" + x` build is captured as the generic prefix "LOC_" and counted.
  for (const m of code.matchAll(/(?<![A-Za-z0-9_])LOC_[A-Z0-9_]*/g)) {
    if (!refs.has(m[0])) refs.set(m[0], new Set());
    refs.get(m[0]).add(rel(abs));
  }
}

const prefixHasKey = (p) => [...defined].some((k) => k.startsWith(p)) || [...BASE_GAME_LOC_KEYS].some((k) => k.startsWith(p)) || BASE_GAME_LOC_PREFIXES.some((b) => b.startsWith(p) || p.startsWith(b));

const missing = [];
let exact = 0, prefixes = 0, baseGame = 0, generic = 0, modDefined = 0;
for (const [key, where] of [...refs].sort()) {
  const files = [...where].join(", ");
  if (key === "LOC_") {
    generic += 1; // `"LOC_" + x` build: unverifiable, counted only
    continue;
  }
  if (key.endsWith("_")) {
    prefixes += 1;
    if (!prefixHasKey(key)) missing.push(`prefix ${key}* has no defined or base-game key <- ${files}`);
    continue;
  }
  exact += 1;
  if (defined.has(key)) modDefined += 1;
  else if (isBaseGameLoc(key)) baseGame += 1;
  else missing.push(`${key} <- ${files}`);
}

console.log(
  `loc-keys: scanned ${files.length} file(s); ${defined.size} en_us keys; ${exact} exact ref(s) ` +
    `(${modDefined} mod-defined, ${baseGame} base-game), ${prefixes} prefix build(s), ${generic} generic "LOC_"+x build(s)`
);
assert.equal(
  missing.length,
  0,
  `${missing.length} LOC reference(s) neither defined in text/en_us/ModText.xml nor registered as base-game in ` +
    `ui/core/demographics-i18n.js:\n  ${missing.join("\n  ")}`
);
console.log("loc-keys harness passed");
