import assert from "node:assert/strict";
import fs from "node:fs";

// modinfo manifest-completeness gate. NOTE: Civ VII resolves a mod's own `/demographics/…` imports
// from its deployed file tree, so an import whose target isn't in <ImportFiles> still loads — this
// is NOT a load-failure guard. It's hygiene: it keeps <ImportFiles> a complete, accurate inventory
// of the mod's JS so the manifest doesn't silently rot when a module is split into helpers (the
// monolith→focused-module refactors repeatedly left split-out files unlisted). The invariant is
// import-CLOSURE: every same-mod module imported by any declared module must itself be declared.
// We close over the whole declared set (not just the UIScript entry points) so helpers pulled in by
// framework-loaded views/custom-elements are covered too. JSDoc `import("…")` type refs are erased
// at runtime — comments are stripped before scanning so they're correctly ignored.

const MOD = "demographics";
const PREFIX = `/${MOD}/`;
const VFS = (p) => `/${MOD}/` + p.replace(/^\.?\//, "");
const DISK = (id) => id.replace(PREFIX, "");

// ── Build the import graph over ui/**.js (comments stripped → no JSDoc type imports) ─
function listJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = `${dir}/${d.name}`;
    return d.isDirectory() ? listJs(p) : d.name.endsWith(".js") ? [p] : [];
  });
}
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const graph = new Map();
for (const f of listJs("ui")) {
  const code = stripComments(fs.readFileSync(f, "utf8"));
  const deps = new Set();
  // static `from "…"`, bare `import "…"`, dynamic `import("…")` — same-mod .js only
  for (const m of code.matchAll(/(?:from|import)\s*\(?\s*"(\/[^"]+\.js)"/g)) {
    if (m[1].startsWith(PREFIX)) deps.add(m[1]);
  }
  graph.set(VFS(f), [...deps]);
}

// ── Declared set = every .js Item in the (single) game ActionGroup ─────────
const modinfo = fs.readFileSync(`${MOD}.modinfo`, "utf8");
const group = (modinfo.match(/<ActionGroup id="demographics-game"[\s\S]*?<\/ActionGroup>/) || [
  ""
])[0];
assert.ok(group, "modinfo has no ActionGroup id=\"demographics-game\"");
const itemsIn = (tag) => {
  const sec = group.match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`));
  if (!sec) return [];
  return [...sec[0].matchAll(/<Item(?:\s+locale="[^"]+")?>([^<]+)<\/Item>/g)].map((m) => m[1]);
};
const declaredJs = [...itemsIn("UIScripts"), ...itemsIn("ImportFiles")].filter((x) =>
  x.endsWith(".js")
);
const declared = new Set(declaredJs.map(VFS));

// ── Import-closure: every import of every declared module must be declared ─
const missing = new Set();
for (const d of declared) {
  for (const t of graph.get(d) || []) if (!declared.has(t)) missing.add(t);
}
// follow the newly-surfaced ones transitively so we report the complete gap
const frontier = [...missing];
while (frontier.length) {
  const n = frontier.pop();
  for (const t of graph.get(n) || []) {
    if (!declared.has(t) && !missing.has(t)) {
      missing.add(t);
      frontier.push(t);
    }
  }
}
const missingList = [...missing].map(DISK).sort();
assert.equal(
  missingList.length,
  0,
  `${missingList.length} imported module(s) not declared in the modinfo — add to <ImportFiles> so ` +
    `the manifest stays a complete inventory: ${missingList.join(", ")}`
);

// ── Every declared/referenced .js Item must exist on disk ─────────────────
const allItems = [...modinfo.matchAll(/<Item(?:\s+locale="[^"]+")?>([^<]+\.js)<\/Item>/g)].map(
  (m) => m[1]
);
const ghosts = allItems.filter((p) => !fs.existsSync(p));
assert.equal(ghosts.length, 0, `modinfo references missing file(s): ${ghosts.join(", ")}`);

console.log(
  `modinfo harness passed (${declared.size} declared JS modules import-closed, ` +
    `${allItems.length} script Items all present)`
);
