#!/usr/bin/env node
// hotspot-score.mjs
//
// Churn x complexity hotspot scoring for the Demographics ui/ tree. Dependency-free
// (Node built-ins + git). Prioritizes files that combine frequent change (churn) with
// structural risk (complexity), so review/refactor effort lands where it pays off.
//
// Definitions
//   churn(f)      = number of commits in the sample window that touched f (git log).
//   complexity(f) = 1 + count of control-flow decision points in f (a file-level
//                   cyclomatic proxy: if / for / while / case / catch / ternary ? /
//                   && / ||). Dependency-free stand-in for true McCabe complexity.
//   hotspot(f)    = (churn(f) / maxChurn) * (complexity(f) / maxComplexity)   in [0, 1].
//
// Repo-level score (published to quality-ratchet-baseline.json):
//   churn_complexity_hotspot_score = max over f of hotspot(f), rounded to 3 dp.
//   A single 0..1 number: 1.0 would mean one file is both the most-churned AND the most
//   complex. Lower is healthier (risk is not concentrated in one hot file).
//
// Usage:  node scripts/hotspot-score.mjs [--window N] [--top N] [--json]
//   --window N  commits to sample (default 120, capped at repo history length).
//   --top N     rows to print (default 15).
//   --json      emit JSON instead of the markdown table.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UI_DIR = join(ROOT, "ui");

const argv = process.argv.slice(2);
const argVal = (flag, def) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const WINDOW = Number(argVal("--window", "120"));
const TOP = Number(argVal("--top", "15"));
const AS_JSON = argv.includes("--json");

// Recursively list every ui/ .js path relative to ROOT (posix-style).
function listUiJs() {
  /** @type {string[]} */
  const out = [];
  for (const ent of readdirSync(UI_DIR, { recursive: true, withFileTypes: true })) {
    if (!ent.isFile() || !ent.name.endsWith(".js")) continue;
    const abs = join(ent.parentPath || ent.path, ent.name);
    out.push(relative(ROOT, abs).split("\\").join("/"));
  }
  return out;
}

/** Map of file -> commit count over the last WINDOW commits, path-filtered to ui/. */
function churnByFile() {
  const raw = execFileSync(
    "git",
    ["log", `-n${WINDOW}`, "--name-only", "--pretty=format:", "--", "ui"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const line of raw.split("\n")) {
    const f = line.trim();
    if (!f || !f.startsWith("ui/") || !f.endsWith(".js")) continue;
    counts.set(f, (counts.get(f) || 0) + 1);
  }
  return counts;
}

const DECISION_RE = /\b(if|for|while|case|catch)\b|\?(?!\.)|&&|\|\||(\?\?)/g;

/** A file-level cyclomatic proxy: 1 + decision-point count. */
function complexityOf(relPath) {
  const src = readFileSync(join(ROOT, relPath), "utf8");
  const m = src.match(DECISION_RE);
  return 1 + (m ? m.length : 0);
}

function main() {
  const files = listUiJs();
  const churn = churnByFile();
  const rows = files.map((f) => ({
    file: f,
    churn: churn.get(f) || 0,
    complexity: complexityOf(f)
  }));
  const maxChurn = Math.max(1, ...rows.map((r) => r.churn));
  const maxCx = Math.max(1, ...rows.map((r) => r.complexity));
  for (const r of rows) {
    r.hotspot = Number(((r.churn / maxChurn) * (r.complexity / maxCx)).toFixed(4));
  }
  rows.sort((a, b) => b.hotspot - a.hotspot || b.churn - a.churn);
  const score = rows.length ? Number(rows[0].hotspot.toFixed(3)) : 0;

  if (AS_JSON) {
    process.stdout.write(
      JSON.stringify(
        { window: WINDOW, maxChurn, maxComplexity: maxCx, score, top: rows.slice(0, TOP) },
        null,
        2
      ) + "\n"
    );
    return;
  }
  const top = rows.slice(0, TOP);
  const lines = [
    `# Hotspot score (churn x complexity)`,
    ``,
    `Window: last ${WINDOW} commits (path-filtered to ui/). maxChurn=${maxChurn}, maxComplexity=${maxCx}.`,
    `Repo churn_complexity_hotspot_score (max hotspot) = ${score}`,
    ``,
    `| Rank | File | Churn | Complexity | Hotspot |`,
    `| --- | --- | --- | --- | --- |`,
    ...top.map((r, i) => `| ${i + 1} | ${r.file} | ${r.churn} | ${r.complexity} | ${r.hotspot} |`)
  ];
  process.stdout.write(lines.join("\n") + "\n");
}

main();
