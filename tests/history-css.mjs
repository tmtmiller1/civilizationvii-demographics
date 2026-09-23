// GameFace (Civilization VII's UI engine) silently drops a declaration that uses var() inside a
// shorthand property: `border: 1px solid var(--c)` renders no border at all. Longhands with a
// single var() work. This gate keeps EVERY shipped stylesheet on longhands, and on flexbox
// (GameFace has no CSS grid).
//
// Scope note: this gate used to read screen-demographics-history.css alone, which is why the base,
// settlements and worldrankings sheets accumulated 30 dropped declarations — the settlements rows'
// per-civ left stripe and the chart time-filter pills' border/background never rendered for anyone.
// Those were converted to longhands; the gate now sweeps all of them so it cannot happen again.
//
// The list of shorthands matters as much as the list of files: `border-color` was absent from it
// until 2026-09-23 and hid 41 more dropped declarations — every framed card, table and chip on the
// Hall of Fame drew a grey currentColor hairline instead of copper. A property that writes several
// longhands is a shorthand, whatever its name suggests.
//
// RECONSTRUCTION NOTE (2026-09-23): this file was truncated by a bad scripted write during the
// Hall of Fame polish pass and `git checkout` restored the pre-2.7.3 single-file version. The
// sweep, the clamp gate and the ladder check below were rebuilt to the same contract; the prose of
// the original comments is not recovered verbatim.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const STYLES_DIR = "ui/screen-demographics/styles";
const EXTRA_CSS = ["ui/screen-demographics/charts/line/demographics-migration-tooltips.css"];
const LADDER_JS = "ui/core/demographics-font-ladder.js";

/** @returns {string[]} Every stylesheet the mod ships. */
function sheets() {
  const fromDir = fs.readdirSync(STYLES_DIR).filter((n) => n.endsWith(".css")).map((n) => path.join(STYLES_DIR, n));
  return [...fromDir, ...EXTRA_CSS.filter((f) => fs.existsSync(f))].sort();
}

// `border-color`, `border-width` and `border-style` each write their four per-side longhands, so
// they are shorthands here too. Use `border-<side>-color: var(--x)`, four lines, not one.
const SHORTHANDS = [
  "border", "border-top", "border-bottom", "border-left", "border-right",
  "border-color", "border-width", "border-style", "border-radius",
  "background", "margin", "padding", "font", "outline", "flex"
];
const FILES = sheets();
assert.ok(FILES.length >= 8, `expected every stylesheet to be swept, found ${FILES.length}`);

const bad = [];
const grid = [];
const unprefixed = [];
// GameFace drops clamp()/min()/max() outright: `width: clamp(50px,20vw,120px)` computes to `auto`,
// so a whole layer of the density stylesheet silently did nothing. Scale with
// `calc(<number> * var(--dg-u))`, which is measured to work, or with vh/vw plus min/max-height.
const valueFns = [];
for (const file of FILES) {
  const raw = fs.readFileSync(file, "utf8");
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of css.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)) {
    const [, prop, value] = m;
    if (SHORTHANDS.includes(prop) && value.includes("var(")) bad.push(`${file}: ${prop}: ${value.trim()}`);
    if (/\b(clamp|min|max)\s*\(/.test(value)) valueFns.push(`${file}: ${prop}: ${value.trim()}`);
  }
  if (/display\s*:\s*grid|\b1fr\b/.test(css)) grid.push(file);
  // Every custom property the mod declares is mod-prefixed (`--dg-`): the old `--ia-*` names sat on
  // :root with no prefix and could collide with another mod's variables.
  for (const m of raw.matchAll(/--ia-[a-z0-9-]+/g)) unprefixed.push(`${file}: ${m[0]}`);
}

assert.deepEqual(bad, [], `var() inside shorthand properties (GameFace drops these): ${bad.join(" | ")}`);
assert.deepEqual(grid, [], `CSS grid is not supported by GameFace: ${grid.join(", ")}`);
assert.deepEqual(unprefixed, [], `unprefixed --ia-* custom properties: ${unprefixed.join(" | ")}`);
assert.deepEqual(valueFns, [],
  `clamp()/min()/max() are dropped by GameFace - use calc(<number> * var(--dg-u)): ${valueFns.join(" | ")}`);

// The type ladder is declared twice — as CSS defaults in the history sheet, and as the numbers
// demographics-font-ladder.js republishes scaled by the player's Font Size setting. They must agree,
// or the pre-ladder render and the scaled render disagree. Both files are read as TEXT: this gate
// runs without the module loader, and the ladder module is written against the engine.
const ladderJs = fs.readFileSync(LADDER_JS, "utf8");
const historyCss = fs.readFileSync(path.join(STYLES_DIR, "screen-demographics-history.css"), "utf8");

/** @returns {Record<string, number>} The `--dg-fs-*` defaults declared in CSS. */
function cssLadder() {
  const out = {};
  for (const m of historyCss.matchAll(/(--dg-fs-[\w-]+)\s*:\s*([\d.]+)rem\s*;/g)) out[m[1]] = Number(m[2]);
  return out;
}

/** @returns {Record<string, number>} The same ladder as the JS module declares it. */
function jsLadder() {
  const out = {};
  const steps = ladderJs.match(/export const FONT_LADDER\s*=\s*\[([^\]]+)\]/);
  assert.ok(steps, "FONT_LADDER not found in " + LADDER_JS);
  for (const n of steps[1].split(",").map((x) => Number(x.trim()))) {
    assert.ok(Number.isFinite(n), "FONT_LADDER holds a non-number");
    out["--dg-fs-" + Math.round(n * 100)] = n;
  }
  const named = ladderJs.match(/export const FONT_NAMED\s*=\s*\{([\s\S]*?)\n\};/);
  assert.ok(named, "FONT_NAMED not found in " + LADDER_JS);
  for (const m of named[1].matchAll(/"(--dg-fs-[\w-]+)"\s*:\s*([\d.]+)/g)) out[m[1]] = Number(m[2]);
  return out;
}

const fromJs = jsLadder();
const fromCss = cssLadder();
const drift = [];
for (const [k, v] of Object.entries(fromJs)) {
  if (fromCss[k] === undefined) drift.push(`${k} is in ${LADDER_JS} but not in the stylesheet`);
  else if (fromCss[k] !== v) drift.push(`${k}: CSS ${fromCss[k]}rem vs JS ${v}`);
}
for (const k of Object.keys(fromCss)) {
  if (fromJs[k] === undefined) drift.push(`${k} is in the stylesheet but not in ${LADDER_JS}`);
}
assert.deepEqual(drift, [], `the type ladder has drifted between CSS and JS: ${drift.join(" | ")}`);

console.log(`history-css harness passed (${FILES.length} stylesheets swept, ${Object.keys(fromJs).length} ladder steps agree with JS)`);
