import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const loaderDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(loaderDir, "..");
const MODULE_PREFIX = "/demographics/";

// Engine `/core/*` options modules the mod imports by absolute path but which don't exist in Node.
// Map them to one recording stub so the options-registration test can run. Scoped to these exact
// specifiers, so no other test is affected.
const OPTIONS_STUB = path.join(loaderDir, "stubs", "engine-options-stub.mjs");
const STUBBED_CORE = new Set([
  "/core/ui/options/model-options.js",
  "/core/ui/options/options-helpers.js"
]);

export async function resolve(specifier, context, defaultResolve) {
  if (STUBBED_CORE.has(specifier)) {
    return { url: pathToFileURL(OPTIONS_STUB).href, shortCircuit: true };
  }
  if (specifier.startsWith(MODULE_PREFIX)) {
    const mapped = path.join(projectRoot, specifier.slice(MODULE_PREFIX.length));
    return {
      url: pathToFileURL(mapped).href,
      shortCircuit: true
    };
  }
  return defaultResolve(specifier, context, defaultResolve);
}
