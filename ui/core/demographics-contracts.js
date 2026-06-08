// demographics-contracts.js
//
// Engine contract guard layer. A single place that declares the
// engine globals/APIs each feature depends on, checks them at runtime, and
// answers "is this feature safe to run?" so callers can fail-safe downgrade
// (turn the feature off) instead of throwing into a half-built UI.
//
// This complements - it does not replace - the per-call `typeof X !== "undefined"`
// guards scattered through the camera/sampler code: those keep any single call
// safe; this layer makes the decision explicit, centralized, logged, and
// queryable up front so an entry point can decline cleanly rather than limp
// through a chain of fallbacks.
//
// Nothing here touches the engine at import time - every check runs on demand,
// after engine.whenReady, so importing this module is always safe.

/**
 * Required engine globals/APIs, grouped by the feature that needs them. Names
 * are dotted paths resolved against the global scope (e.g. "UI.Player").
 *   core        - base mod UI + sampler (without these the mod cannot run)
 *   camera      - Top Cities instant / cinematic / flyby flows
 *   settlements - settlement records, tile-reveal gating, map view
 * @type {Record<string, string[]>}
 */
const CONTRACTS = {
  core: ["engine", "Players", "Game"],
  camera: ["Camera", "UI.Player"],
  settlements: ["Constructibles", "GameplayMap"]
};

/**
 * Whether a dotted global path resolves to a defined, non-null value.
 * @param {string} path Dotted path against the global scope (e.g. "UI.Player").
 * @returns {boolean} True when every segment resolves and the leaf is defined.
 */
function present(path) {
  try {
    let cur = /** @type {*} */ (typeof globalThis !== "undefined" ? globalThis : undefined);
    for (const part of path.split(".")) {
      if (cur === undefined || cur === null) return false;
      cur = cur[part];
    }
    return cur !== undefined && cur !== null;
  } catch (_) {
    return false;
  }
}

/**
 * A single feature's contract status.
 * @typedef {Object} FeatureStatus
 * @property {boolean} ok Whether every required global is present.
 * @property {string[]} missing The names of any absent globals.
 */

/**
 * The full contract report across every feature.
 * @typedef {Object} ContractReport
 * @property {boolean} ok Whether every feature's contract is satisfied.
 * @property {Record<string, FeatureStatus>} byFeature Per-feature status.
 */

/**
 * Check every declared contract against the current engine surface.
 * @returns {ContractReport} The per-feature report.
 */
export function verifyContracts() {
  /** @type {Record<string, FeatureStatus>} */
  const byFeature = {};
  let allOk = true;
  for (const feature of Object.keys(CONTRACTS)) {
    const missing = CONTRACTS[feature].filter((name) => !present(name));
    byFeature[feature] = { ok: missing.length === 0, missing };
    if (missing.length > 0) allOk = false;
  }
  return { ok: allOk, byFeature };
}

/**
 * Whether a feature is safe to run right now. An unknown feature name is treated
 * as available (this layer only gates features it explicitly declares).
 * @param {string} feature The feature key (e.g. "camera").
 * @returns {boolean} True when the feature's contract is satisfied.
 */
export function featureAvailable(feature) {
  const status = verifyContracts().byFeature[feature];
  return !status || status.ok;
}

/**
 * Verify contracts and log one console.error per degraded feature (silent when
 * all contracts pass). Called once at startup; returns the report.
 * @returns {ContractReport} The report.
 */
export function logContractReport() {
  const report = verifyContracts();
  if (report.ok) {
    return report;
  }
  for (const feature of Object.keys(report.byFeature)) {
    const status = report.byFeature[feature];
    if (!status.ok) {
      console.error(
        "[Demographics.contracts] '" + feature +
        "' degraded — disabled; missing: " + status.missing.join(", ")
      );
    }
  }
  return report;
}
