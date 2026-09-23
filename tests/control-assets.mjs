import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Controls.define asset gate: the HTML/CSS the two screens hand to Controls.define (as
// "fs://game/demographics/<path>") must (1) exist on disk under the mod and (2) be declared in
// <ImportFiles> of every modinfo ActionGroup that declares the defining module. fs:// serves only
// what the loaded group declares, so a stylesheet missing from the group renders the screen
// unstyled and a missing content page renders it empty, with no load error to point at it.
// Extraction is a regex over the comment-stripped source (the first `Controls.define(` call and
// its balanced argument list), so no engine stub or loader is needed.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MOD = "demographics";
const SCREENS = [
  "ui/screen-demographics/screen/screen-demographics.js",
  "ui/history/screen/screen-hall-of-fame.js"
];
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** The balanced argument text of the first `Controls.define(` in `code`, or null. */
function defineArgs(code) {
  const at = code.search(/\bControls\s*\.\s*define\s*\(/);
  if (at < 0) return null;
  const open = code.indexOf("(", at);
  let depth = 0;
  for (let j = open; j < code.length; j += 1) {
    if (code[j] === "(") depth += 1;
    else if (code[j] === ")" && (depth -= 1) === 0) return code.slice(open + 1, j);
  }
  return null;
}

// modinfo: per ActionGroup, the declared UIScripts + ImportFiles items.
const modinfo = fs.readFileSync(path.join(ROOT, `${MOD}.modinfo`), "utf8");
const groups = [...modinfo.matchAll(/<ActionGroup id="([^"]+)"[\s\S]*?<\/ActionGroup>/g)].map((g) => {
  const items = (tag) => {
    const sec = g[0].match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`));
    return sec ? [...sec[0].matchAll(/<Item(?:\s+locale="[^"]+")?>([^<]+)<\/Item>/g)].map((m) => m[1]) : [];
  };
  return { id: g[1], scripts: new Set([...items("UIScripts"), ...items("ImportFiles")]), imports: new Set(items("ImportFiles")) };
});
assert.ok(groups.length > 0, "modinfo has no ActionGroup");

const failures = [];
let assets = 0;
for (const screen of SCREENS) {
  const abs = path.join(ROOT, screen);
  assert.ok(fs.existsSync(abs), `${screen} is missing`);
  const args = defineArgs(stripComments(fs.readFileSync(abs, "utf8")));
  assert.ok(args, `${screen} has no Controls.define( call`);
  const urls = [...args.matchAll(/"fs:\/\/game\/([^"]+)"/g)].map((m) => m[1]);
  const styles = urls.filter((u) => u.endsWith(".css"));
  const content = urls.filter((u) => u.endsWith(".html"));
  assert.ok(styles.length > 0, `${screen}: Controls.define names no .css asset`);
  assert.ok(content.length > 0, `${screen}: Controls.define names no .html asset`);
  const declaring = groups.filter((g) => g.scripts.has(screen));
  if (!declaring.length) failures.push(`${screen} is not declared in any modinfo ActionGroup`);
  for (const u of urls) {
    assets += 1;
    if (!u.startsWith(`${MOD}/`)) {
      failures.push(`${screen}: asset "fs://game/${u}" is outside the mod's fs:// namespace`);
      continue;
    }
    const inMod = u.slice(MOD.length + 1);
    if (!fs.existsSync(path.join(ROOT, inMod))) failures.push(`${screen}: asset ${inMod} does not exist on disk`);
    for (const g of declaring) {
      if (!g.imports.has(inMod)) failures.push(`${screen}: asset ${inMod} is not in <ImportFiles> of ActionGroup "${g.id}" (which declares the screen)`);
    }
  }
  console.log(`control-assets: ${screen} -> ${styles.length} stylesheet(s), ${content.length} content page(s); declared in ${declaring.map((g) => g.id).join(", ") || "NO group"}`);
}

assert.equal(failures.length, 0, `${failures.length} Controls.define asset problem(s):\n  ${failures.join("\n  ")}`);
console.log(`control-assets harness passed (${assets} asset path(s) across ${SCREENS.length} screen(s) exist and are declared)`);
