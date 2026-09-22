// GameFace (Civilization VII's UI engine) silently drops a declaration that uses var() inside a
// shorthand property: `border: 1px solid var(--c)` renders no border at all. Longhands with a
// single var() work. This gate keeps the history stylesheet on longhands, and on flexbox (GameFace
// has no CSS grid).
import assert from "node:assert/strict";
import fs from "node:fs";

const FILE = "ui/screen-demographics/styles/screen-demographics-history.css";
const css = fs.readFileSync(FILE, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const SHORTHANDS = ["border", "border-top", "border-bottom", "border-left", "border-right", "background", "margin", "padding", "font", "outline", "flex"];
const bad = [];
for (const m of css.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)) {
  const [, prop, value] = m;
  if (SHORTHANDS.includes(prop) && value.includes("var(")) bad.push(`${prop}: ${value.trim()}`);
}
assert.deepEqual(bad, [], `var() inside shorthand properties (GameFace drops these): ${bad.join(" | ")}`);
assert.ok(!/display\s*:\s*grid|\b1fr\b/.test(css), "CSS grid is not supported by GameFace");
console.log("history-css harness passed");
