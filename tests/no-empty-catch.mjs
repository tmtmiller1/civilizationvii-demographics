// Quality guard: fail on empty `catch` blocks (whitespace-only body) anywhere under ui/.
//
// An empty catch silently swallows errors, which is the exact "random flakiness / masked breakage"
// risk flagged in report.md (Finding 3). The codebase convention is to ANNOTATE an intentional swallow
// with a short rationale comment, e.g. `catch (_) { /* ignore: best-effort persistence */ }` — that
// form is permitted (the body isn't whitespace-only). A new truly-empty catch fails this gate and must
// either add such a comment or actually handle the error.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "ui");
// `\s` spans newlines, so this catches single- AND multi-line empties; a comment or any code between
// the braces makes the body non-whitespace and is therefore allowed.
const EMPTY_CATCH = /catch\s*(\([^)]*\))?\s*\{\s*\}/g;

/** @type {string[]} */
const offenders = [];

/** @param {string} dir */
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(p);
    } else if (entry.name.endsWith(".js")) {
      const src = fs.readFileSync(p, "utf8");
      let m;
      while ((m = EMPTY_CATCH.exec(src)) !== null) {
        const line = src.slice(0, m.index).split("\n").length;
        offenders.push(`${path.relative(UI_ROOT, p)}:${line}`);
      }
    }
  }
}

walk(UI_ROOT);

if (offenders.length > 0) {
  console.error(
    `no-empty-catch: ${offenders.length} empty catch block(s) found — add a rationale comment ` +
      `(e.g. \`catch (_) { /* ignore: ... */ }\`) or handle the error:\n  ${offenders.join("\n  ")}`
  );
  process.exit(1);
}
console.log("no-empty-catch harness passed (no whitespace-only catch blocks in ui/)");
