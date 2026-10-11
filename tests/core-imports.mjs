import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listJs, rel, stripComments, UI_DIR } from "./_fs-helpers.mjs";

// Engine-import existence gate: every `/core/...` or `/base-standard/...` module specifier that
// ui/ imports must exist in the installed game's script tree, so a game patch that moves or
// renames an engine module (or a typo in a new import) is caught here instead of as a blank
// screen at load. The mod's own `/demographics/...` imports are covered by tests/modinfo.mjs.
//
// The game location follows scripts/deploy.mjs: it works under the same per-user
// "Library/Application Support" root that deploy.mjs targets for Mods; the Steam install sits
// beside it. `CIV7_GAME_DIR` overrides the lookup (point it at the folder that holds Base/modules,
// or at Base/modules itself). The mapping "/core/x.js" -> "<modules>/core/x.js" is checked by
// finding a known engine file (core/ui/panel-support.js) before anything else is judged.
// When no install is found the gate prints a warning and exits 0, so CI without the game passes.

const KNOWN = "core/ui/panel-support.js";
const ENGINE_PREFIX = /^\/(core|base-standard)\//;

const appSupport = path.join(os.homedir(), "Library/Application Support");
const candidates = [
  process.env.CIV7_GAME_DIR,
  path.join(appSupport, "Steam/steamapps/common/Sid Meier's Civilization VII/CivilizationVII.app/Contents/Resources"),
  path.join(appSupport, "Steam/steamapps/common/Sid Meier's Civilization VII"),
  path.join(
    appSupport,
    "Steam/steamapps/common/Sid Meier's Civilization VII/CivilizationVII.app/Contents/Resources/Base/modules"
  )
].filter(Boolean);

/** @returns {string|null} The folder that "/core/..." resolves under, checked by the known file. */
function findModulesRoot() {
  for (const c of candidates) {
    for (const probe of [
      c,
      path.join(c, "Base/modules"),
      path.join(c, "CivilizationVII.app/Contents/Resources/Base/modules")
    ]) {
      if (fs.existsSync(path.join(probe, KNOWN))) return probe;
    }
  }
  return null;
}


// Collect specifier -> importing modules (static import/export-from, bare import, dynamic import()).
const uses = new Map();
for (const abs of listJs(UI_DIR)) {
  const code = stripComments(fs.readFileSync(abs, "utf8"));
  for (const m of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)"([^"]+)"/g)) {
    if (!ENGINE_PREFIX.test(m[1])) continue;
    if (!uses.has(m[1])) uses.set(m[1], new Set());
    uses.get(m[1]).add(rel(abs));
  }
}

const modulesRoot = findModulesRoot();
if (!modulesRoot) {
  console.warn(
    `core-imports: WARNING no Civilization VII install found (looked for ${KNOWN} under: ` +
      `${candidates.join(" | ")}); set CIV7_GAME_DIR to check. Skipping ${uses.size} engine specifier(s).`
  );
  process.exit(0);
}

const missing = [];
for (const [spec, importers] of [...uses].sort()) {
  const target = path.join(modulesRoot, spec);
  if (fs.existsSync(target)) continue;
  const ts = target.replace(/\.js$/, ".ts");
  const hint = fs.existsSync(ts) ? " (only a .ts source exists; the compiled .js is not shipped)" : "";
  missing.push(`${spec}${hint} <- ${[...importers].join(", ")}`);
}

console.log(`core-imports: modules root ${modulesRoot}`);
const importerCount = new Set([...uses.values()].flatMap((s) => [...s])).size;
console.log(`core-imports: ${uses.size} distinct engine specifier(s) from ${importerCount} module(s)`);
for (const [spec, importers] of [...uses].sort()) console.log(`  ${spec} <- ${[...importers].join(", ")}`);
assert.equal(
  missing.length,
  0,
  `${missing.length} engine import(s) not found in the installed game:\n  ${missing.join("\n  ")}`
);
console.log(`core-imports harness passed (${uses.size} engine specifier(s) all present)`);
