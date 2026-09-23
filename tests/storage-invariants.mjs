import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Shared-storage invariants gate ("never again" for the localStorage bug class).
//
// Every ModOptions-based mod shares ONE localStorage root, the "modSettings" key, and the engine's
// options loader wipes the whole store when it sees a second top-level key or a non-JSON value.
// Earlier demographics builds broke that contract three different ways (stray top-level keys, a
// blind `{}` reset of the root, and write-without-read that dropped sibling mods' slices). This
// static scan of ui/**/*.js pins the contract so a refactor cannot reintroduce any of them:
//   (a) every `localStorage.setItem(` writes the identifier ROOT_KEY (or a constant that resolves
//       to the literal "modSettings"), never any other key;
//   (b) `localStorage.clear(` appears only in the storage-repair module;
//   (c) `localStorage.removeItem(` appears only in demographics-settings.js (purge of
//       demographics-owned strays) and the storage-repair module;
//   (d) nobody writes a literal empty root (`"{}"` / `JSON.stringify({})`) under ROOT_KEY;
//   (e) every write of ROOT_KEY is preceded, in the same function body, by a read of it
//       (`getItem(ROOT_KEY` or a call to a read helper named readRoot / readRootForWrite).
//
// (e) is a best-effort TEXTUAL check with these documented limits:
//   - the "enclosing function" is found by brace matching over a copy of the source with comments
//     and string bodies blanked; unusual syntax (regex literals containing quotes or braces, JSX,
//     `with`) can confuse it, in which case the gate reports the write as top-level and fails;
//   - a pure write helper (its body has no read) passes when EVERY call site of that helper, by
//     name within the same file, sits in a function that reads before the call (one level only,
//     same file only; a helper called from another module or through an alias fails);
//   - the storage-repair module is the deliberate exception: its contract is to replace a store
//     whose reads lie, so its write must instead follow `localStorage.clear(` in the same function
//     and the module must read ROOT_KEY back (readback verification) somewhere;
//   - a write that reaches storage through an alias (`const ls = localStorage; ls.setItem(...)`)
//     or a computed member (`localStorage["setItem"]`) is not seen at all.
// The gate prints every file scanned and every storage call site it judged.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UI = path.join(ROOT, "ui");
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");

const ROOT_LITERAL = "modSettings";
const REPAIR = "ui/core/demographics-storage-repair.js";
const SETTINGS = "ui/core/demographics-settings.js";
const CLEAR_ALLOWED = new Set([REPAIR]);
const REMOVE_ALLOWED = new Set([SETTINGS, REPAIR]);
const READ_MARKER = /getItem\(\s*ROOT_KEY\b|\breadRoot\s*\(|\breadRootForWrite\s*\(/;
const NOT_FUNCTION_HEADS = new Set(["if", "for", "while", "switch", "catch", "with", "return", "await", "typeof", "yield"]);

/** @param {string} dir @returns {string[]} */
function listJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? listJs(p) : d.name.endsWith(".js") ? [p] : [];
  });
}

/** Blank a span to spaces, keeping newlines, so every index and line number survives. */
const blankSpan = (s) => s.replace(/[^\n]/g, " ");

/** Source with comments blanked (same length as the input). */
function blankComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blankSpan)
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, pre) => pre + blankSpan(m.slice(pre.length)));
}

/** Source with string bodies blanked too (quotes kept), for brace/paren matching. */
function blankStrings(src) {
  return src.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, (m) =>
    m[0] + blankSpan(m.slice(1, -1)) + m[m.length - 1]
  );
}

const lineOf = (src, i) => src.slice(0, i).split("\n").length;

/** Index of the bracket matching the one at `i` (forward for openers, backward for closers), or -1. */
function matchBracket(struct, i) {
  const c = struct[i];
  const forward = c === "(" || c === "{" || c === "[";
  const open = forward ? c : { ")": "(", "}": "{", "]": "[" }[c];
  const close = forward ? { "(": ")", "{": "}", "[": "]" }[c] : c;
  let depth = 0;
  for (let j = i; j >= 0 && j < struct.length; j += forward ? 1 : -1) {
    if (struct[j] === open) depth += forward ? 1 : -1;
    else if (struct[j] === close) depth += forward ? -1 : 1;
    if (depth === 0) return j;
  }
  return -1;
}

/**
 * Every `{` that opens a function body: `function name(...) {`, `name(...) {` (method), `(...) => {`.
 * @returns {{name: string, open: number, close: number}[]}
 */
function functionBodies(struct) {
  const bodies = [];
  for (let i = 0; i < struct.length; i += 1) {
    if (struct[i] !== "{") continue;
    const before = struct.slice(0, i).replace(/\s+$/, "");
    let name = null;
    if (before.endsWith("=>")) {
      const m = before.match(/([A-Za-z_$][\w$]*)\s*[=:]\s*(?:async\s*)?(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*=>$/);
      name = m ? m[1] : "<arrow>";
    } else if (before.endsWith(")")) {
      const paren = matchBracket(struct, before.length - 1);
      if (paren < 0) continue;
      const head = struct.slice(0, paren).replace(/\s+$/, "");
      const m = head.match(/(?:\b(function)\s+)?([A-Za-z_$][\w$]*)$/);
      if (!m) continue;
      if (m[2] === "function") name = "<anonymous function>";
      else if (m[1]) name = m[2];
      else if (NOT_FUNCTION_HEADS.has(m[2])) continue;
      else name = m[2];
    } else {
      continue;
    }
    const close = matchBracket(struct, i);
    if (close < 0) continue;
    bodies.push({ name, open: i, close });
  }
  return bodies;
}

/**
 * The innermost NAMED function body containing index `i`, or null when `i` is top-level. An
 * anonymous callback (`safeCall(() => { localStorage.setItem(...) })`) runs inside the named
 * function that created it, so the read-before-write rule is judged against that named function.
 */
function enclosing(bodies, i) {
  let best = null;
  for (const b of bodies) {
    if (b.name.startsWith("<")) continue;
    if (b.open < i && i < b.close && (!best || b.open > best.open)) best = b;
  }
  return best;
}

/** First top-level argument text of the call whose `(` is at `open`. */
function firstArg(struct, text, open) {
  let depth = 0;
  for (let j = open + 1; j < struct.length; j += 1) {
    const c = struct[j];
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) return text.slice(open + 1, j).trim();
      depth -= 1;
    } else if (c === "," && depth === 0) return text.slice(open + 1, j).trim();
  }
  return text.slice(open + 1).trim();
}

/** Whether identifier `id` resolves to the literal "modSettings" in this file (local const or same-mod import). */
function resolvesToRootLiteral(id, text, file, depth = 0) {
  const local = text.match(new RegExp(`\\b(?:const|let|var)\\s+${id}\\s*=\\s*"([^"]*)"`));
  if (local) return local[1] === ROOT_LITERAL;
  const imp = text.match(new RegExp(`import\\s*\\{[^}]*\\b(?:([A-Za-z_$][\\w$]*)\\s+as\\s+)?${id}\\b[^}]*\\}\\s*from\\s*"(/demographics/[^"]+)"`));
  if (!imp || depth > 3) return false;
  const src = path.join(ROOT, imp[2].replace(/^\/demographics\//, ""));
  if (!fs.existsSync(src)) return false;
  const exported = imp[1] || id;
  return resolvesToRootLiteral(exported, blankComments(fs.readFileSync(src, "utf8")), src, depth + 1);
}

const failures = [];
const scanned = [];
const sites = [];
const CALL = /\blocalStorage\s*\.\s*(setItem|removeItem|clear)\s*\(/g;

for (const abs of listJs(UI)) {
  const file = rel(abs);
  const text = blankComments(fs.readFileSync(abs, "utf8"));
  const struct = blankStrings(text);
  const bodies = functionBodies(struct);
  scanned.push(file);
  let m;
  while ((m = CALL.exec(struct)) !== null) {
    const kind = m[1];
    const at = m.index;
    const open = at + m[0].length - 1;
    const where = `${file}:${lineOf(text, at)}`;
    if (kind === "clear") {
      sites.push(`${where} clear ${CLEAR_ALLOWED.has(file) ? "allowed (repair module)" : "FORBIDDEN"}`);
      if (!CLEAR_ALLOWED.has(file)) failures.push(`(b) ${where}: localStorage.clear() is only allowed in ${REPAIR}`);
      continue;
    }
    if (kind === "removeItem") {
      sites.push(`${where} removeItem ${REMOVE_ALLOWED.has(file) ? "allowed" : "FORBIDDEN"}`);
      if (!REMOVE_ALLOWED.has(file)) failures.push(`(c) ${where}: localStorage.removeItem() is only allowed in ${[...REMOVE_ALLOWED].join(", ")}`);
      continue;
    }
    // setItem: (a) key, (d) value, (e) read-before-write
    const key = firstArg(struct, text, open);
    const keyOk = /^[A-Za-z_$][\w$]*$/.test(key) && resolvesToRootLiteral(key, text, abs);
    if (!keyOk) {
      failures.push(
        `(a) ${where}: localStorage.setItem key is \`${key}\`, which ` +
          (/^[A-Za-z_$][\w$]*$/.test(key) ? `does not resolve to the literal "${ROOT_LITERAL}" in this file (define or import ROOT_KEY)` : `is not the ROOT_KEY identifier`)
      );
    }
    const closeParen = matchBracket(struct, open);
    const callText = closeParen > 0 ? text.slice(open, closeParen + 1) : text.slice(open);
    if (/^\(\s*[^,]+,\s*(?:"\{\}"|'\{\}'|JSON\.stringify\(\s*\{\s*\}\s*\))\s*\)$/.test(callText)) {
      failures.push(`(d) ${where}: writes a literal empty root; a reset of the shared "${ROOT_LITERAL}" key wipes every mod's slice`);
    }
    const fn = enclosing(bodies, at);
    let verdict;
    if (!fn) {
      verdict = "FAIL: top-level write (no enclosing function)";
    } else if (READ_MARKER.test(text.slice(fn.open, at))) {
      verdict = `ok: ${fn.name}() reads ROOT_KEY before writing`;
    } else if (file === REPAIR && /\blocalStorage\s*\.\s*clear\s*\(/.test(struct.slice(fn.open, at))) {
      verdict = /getItem\(\s*ROOT_KEY\b/.test(text)
        ? `ok: ${fn.name}() is the repair's clear-then-rewrite and the module reads ROOT_KEY back`
        : `FAIL: ${fn.name}() clears and rewrites but the repair module never reads ROOT_KEY back`;
    } else {
      const callRe = new RegExp(`\\b${fn.name}\\s*\\(`, "g");
      const callers = [];
      let c;
      while ((c = callRe.exec(struct)) !== null) {
        if (c.index >= fn.open && c.index <= fn.close) continue; // inside its own body (recursion)
        const parenClose = matchBracket(struct, c.index + c[0].length - 1);
        if (parenClose > 0 && /^\s*\{/.test(struct.slice(parenClose + 1))) continue; // the definition itself
        const caller = enclosing(bodies, c.index);
        const reads = !!caller && READ_MARKER.test(text.slice(caller.open, c.index));
        callers.push({ line: lineOf(text, c.index), name: caller ? caller.name : "<top-level>", reads });
      }
      const bad = callers.filter((x) => !x.reads);
      if (!callers.length) verdict = `FAIL: ${fn.name}() writes without reading and has no call site in this file`;
      else if (bad.length) verdict = `FAIL: ${fn.name}() writes without reading; caller(s) not reading first: ${bad.map((x) => `${x.name}@${x.line}`).join(", ")}`;
      else verdict = `ok: ${fn.name}() is a write helper; every caller reads first (${callers.map((x) => `${x.name}@${x.line}`).join(", ")})`;
    }
    sites.push(`${where} setItem(${key}) ${verdict}`);
    if (verdict.startsWith("FAIL")) failures.push(`(e) ${where}: ${verdict.slice(6)}`);
  }
}

const perFolder = new Map();
for (const f of scanned) {
  const top = f.split("/").slice(0, 2).join("/");
  perFolder.set(top, (perFolder.get(top) || 0) + 1);
}
console.log(`storage-invariants: scanned ${scanned.length} file(s) under ui/ (` +
  [...perFolder].sort().map(([k, n]) => `${k.replace(/^ui\//, "")}: ${n}`).join(", ") + ")");
console.log(`storage-invariants: ${sites.length} localStorage call site(s)`);
for (const s of sites) console.log(`  ${s}`);
assert.ok(sites.some((s) => s.includes(" setItem(")), "expected at least one localStorage.setItem site under ui/ (scan is broken if none)");
assert.equal(failures.length, 0, `${failures.length} shared-storage invariant violation(s):\n  ${failures.join("\n  ")}`);
console.log("storage-invariants harness passed");
