// Runs every test file in tests/ in its own Node process with the /demographics/ loader registered.
//
//   node tests/run-all.mjs                 run everything
//   node tests/run-all.mjs relations chart only files whose name contains one of the filters
//
// Files are discovered, not listed, so a new test runs as soon as it exists. Helpers are skipped:
// names starting with "_", the loader and its register hook, this runner, and the stubs/ directory.
// Files run in parallel (TEST_JOBS overrides the count) but results print in sorted order, one line
// per file, with the output of any failure after it. Files that assert on timings run afterwards, one
// at a time, so the parallel batch cannot slow them past their budgets.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testsDir, "..");
const NOT_TESTS = new Set(["loader.mjs", "register-loader.mjs", "run-all.mjs"]);
const REGISTER_LOADER = pathToFileURL(path.join(testsDir, "register-loader.mjs")).href;
const RUN_ALONE = new Set(["history-stress.mjs"]);

function discoverTests(dir = testsDir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("_") && !NOT_TESTS.has(name))
    .sort();
}

function runOne(name) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, ["--import", REGISTER_LOADER, path.join(testsDir, name)], {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("close", (code, signal) => {
      resolve({ name, ok: code === 0, code: signal || code, output, ms: Date.now() - started });
    });
  });
}

async function runAll(names, jobs) {
  const results = new Array(names.length);
  let next = 0;
  let printed = 0;
  const printReady = () => {
    while (printed < names.length && results[printed]) {
      const r = results[printed];
      const status = r.ok ? "ok  " : "FAIL";
      console.log(`${status} ${r.name} (${r.ms} ms)`);
      if (!r.ok) {
        console.log(`---- ${r.name} exited with ${r.code}`);
        process.stdout.write(r.output.endsWith("\n") ? r.output : `${r.output}\n`);
        console.log("----");
      }
      printed++;
    }
  };
  const worker = async () => {
    while (next < names.length) {
      const index = next++;
      results[index] = await runOne(names[index]);
      printReady();
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, names.length) }, worker));
  return results;
}

async function main() {
  const filters = process.argv.slice(2);
  const all = discoverTests();
  const names = filters.length ? all.filter((n) => filters.some((f) => n.includes(f))) : all;
  if (names.length === 0) {
    console.error(`run-all: no tests matched ${filters.length ? filters.join(", ") : "(no test files found)"}`);
    process.exit(1);
  }
  const jobs = Number(process.env.TEST_JOBS) || Math.max(1, Math.min(8, os.availableParallelism()));
  const parallel = names.filter((n) => !RUN_ALONE.has(n));
  const alone = names.filter((n) => RUN_ALONE.has(n));
  const results = [...(await runAll(parallel, jobs)), ...(await runAll(alone, 1))];
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} test files passed`);
  if (failed.length) {
    console.log(`failed: ${failed.map((r) => r.name).join(", ")}`);
    process.exit(1);
  }
}

await main();
