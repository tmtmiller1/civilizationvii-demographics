// Deploy the shipped files into the game's Mods folder (the game runs plain copies, not symlinks).
//   node scripts/deploy.mjs          replace Mods/demographics with the ship set
//   node scripts/deploy.mjs --check  exit 1 when the deployed copy is missing or differs
// Only the ship allow-list is copied (the same set release.sh zips), so a dist/ folder with a
// second modinfo can never be deployed as a shadow copy. Files in the target that are not in the
// ship set are removed on deploy and reported by --check.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(os.homedir(), "Library/Application Support/Civilization VII/Mods/demographics");
const SHIP = [
  /^demographics\.modinfo$/, /^README\.md$/, /^LICENSE$/, /^CHANGELOG\.md$/,
  /^ui\/(?!dev\/).+\.(js|html|css)$/, /^images\/.+\.(svg|png)$/, /^text\/[a-z_]+\/ModText\.xml$/
];

/** @returns {string[]} Relative paths under dir. */
function list(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? list(p, base) : [path.relative(base, p)];
  });
}

const shipped = list(root).filter((f) => !f.startsWith("node_modules") && !f.startsWith("dist") && SHIP.some((re) => re.test(f))).sort();
const deployed = list(target).sort();

if (process.argv.includes("--check")) {
  const stale = shipped.filter((f) => !deployed.includes(f) || !fs.readFileSync(path.join(root, f)).equals(fs.readFileSync(path.join(target, f))));
  const extra = deployed.filter((f) => !shipped.includes(f));
  if (stale.length || extra.length) {
    console.log(`deploy:check FAILED\n  missing or stale: ${stale.join(", ") || "none"}\n  not in ship set: ${extra.join(", ") || "none"}`);
    process.exit(1);
  }
  console.log(`deploy:check ok (${shipped.length} files match)`);
} else {
  fs.rmSync(target, { recursive: true, force: true });
  for (const f of shipped) {
    fs.mkdirSync(path.dirname(path.join(target, f)), { recursive: true });
    fs.copyFileSync(path.join(root, f), path.join(target, f));
  }
  console.log(`deployed ${shipped.length} files to ${target}`);
}
