import fs from "node:fs";
import path from "node:path";

const pkgPath = path.resolve(process.cwd(), "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const scripts = pkg && pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};

const required = [
  "verify",
  "coverage",
  "release:gate",
  "test:required-scripts",
  "test:settings-clobber",
  "test:storage-schema",
  "test:storage-load-branches",
  "test:storage-backend-branches",
  "test:storage-cap-branches",
  "test:governance-branches",
  "test:relations-shared-branches",
  "test:relations-filters-branches",
  "test:relations-queries-branches",
  "test:relations-ring-compute-branches",
  "test:relations-filters-dom-branches",
  "test:relations-settings-branches",
  "test:relations-node-info-branches",
  "test:relations-viewer-controls-branches",
  "test:relations-ring-svg-nodes-branches",
  "test:relations-ring-svg-backdrop-branches",
  "test:relations-edges-branches",
  "test:relations-edges-cs-branches",
  "test:relations-ring-svg-edges-branches",
  "test:relations-ring-svg-branches",
  "test:relations-render-integration",
  "test:history-view-render-integration",
  "test:conflicts-render-integration",
  "test:ui-helpers-contracts-branches",
  "test:hardware-branches",
  "test:camera-utils-branches",
  "test:worldrankings-profiles-branches",
  "test:radar-data-branches",
  "test:settlements-pure-branches",
  "test:view-pills-branches",
  "test:crisis-render-integration",
  "test:resources-radar-render-integration",
  "test:options-worldrankings-render-integration",
  "test:settlements-render-integration",
  "test:settlements-detail-render-branches",
  "test:city-map-view-branches",
  "test:bootstrap-branches",
  "test:re-export-barrels-branches",
  "test:screen-demographics-registration-branches",
  "test:chart-line-axis-branches",
  "test:chart-line-config-branches",
  "test:chart-line-legend-branches",
  "test:chart-line-plugins-branches",
  "test:chart-line-event-markers-branches",
  "test:chart-line-series-branches",
  "test:chart-line-datasets-branches",
  "test:chart-line-wonder-markers-branches",
  "test:wars-naming-branches",
  "test:chart-line-render-integration"
];

for (const name of required) {
  if (!scripts[name]) {
    throw new Error("missing required script: " + name);
  }
}

const verify = String(scripts.verify || "");
const verifyRequired = [
  "test:required-scripts",
  "test:settings-clobber",
  "test:storage-schema",
  "test:storage-load-branches",
  "test:storage-backend-branches",
  "test:storage-cap-branches",
  "test:governance-branches",
  "test:relations-shared-branches",
  "test:relations-filters-branches",
  "test:relations-queries-branches",
  "test:relations-ring-compute-branches",
  "test:relations-filters-dom-branches",
  "test:relations-settings-branches",
  "test:relations-node-info-branches",
  "test:relations-viewer-controls-branches",
  "test:relations-ring-svg-nodes-branches",
  "test:relations-ring-svg-backdrop-branches",
  "test:relations-edges-branches",
  "test:relations-edges-cs-branches",
  "test:relations-ring-svg-edges-branches",
  "test:relations-ring-svg-branches",
  "test:relations-render-integration",
  "test:history-view-render-integration",
  "test:conflicts-render-integration",
  "test:ui-helpers-contracts-branches",
  "test:hardware-branches",
  "test:camera-utils-branches",
  "test:worldrankings-profiles-branches",
  "test:radar-data-branches",
  "test:settlements-pure-branches",
  "test:view-pills-branches",
  "test:crisis-render-integration",
  "test:resources-radar-render-integration",
  "test:options-worldrankings-render-integration",
  "test:settlements-render-integration",
  "test:settlements-detail-render-branches",
  "test:city-map-view-branches",
  "test:bootstrap-branches",
  "test:re-export-barrels-branches",
  "test:screen-demographics-registration-branches",
  "test:chart-line-axis-branches",
  "test:chart-line-config-branches",
  "test:chart-line-legend-branches",
  "test:chart-line-plugins-branches",
  "test:chart-line-event-markers-branches",
  "test:chart-line-series-branches",
  "test:chart-line-datasets-branches",
  "test:chart-line-wonder-markers-branches",
  "test:wars-naming-branches",
  "test:chart-line-render-integration"
];
for (const token of verifyRequired) {
  if (!verify.includes(token)) {
    throw new Error("verify must include " + token);
  }
}

const releaseGate = String(scripts["release:gate"] || "");
const releaseTokens = ["test:required-scripts", "verify", "coverage"];
for (const token of releaseTokens) {
  if (!releaseGate.includes(token)) {
    throw new Error("release:gate must include " + token);
  }
}

const testJs = String(scripts["test:js"] || "");
const testJsRequired = [
  "test:storage-schema",
  "test:storage-load-branches",
  "test:storage-backend-branches",
  "test:storage-cap-branches",
  "test:governance-branches",
  "test:relations-shared-branches",
  "test:relations-filters-branches",
  "test:relations-queries-branches",
  "test:relations-ring-compute-branches",
  "test:relations-filters-dom-branches",
  "test:relations-settings-branches",
  "test:relations-node-info-branches",
  "test:relations-viewer-controls-branches",
  "test:relations-ring-svg-nodes-branches",
  "test:relations-ring-svg-backdrop-branches",
  "test:relations-edges-branches",
  "test:relations-edges-cs-branches",
  "test:relations-ring-svg-edges-branches",
  "test:relations-ring-svg-branches",
  "test:relations-render-integration",
  "test:history-view-render-integration",
  "test:conflicts-render-integration",
  "test:ui-helpers-contracts-branches",
  "test:hardware-branches",
  "test:camera-utils-branches",
  "test:worldrankings-profiles-branches",
  "test:radar-data-branches",
  "test:settlements-pure-branches",
  "test:view-pills-branches",
  "test:crisis-render-integration",
  "test:resources-radar-render-integration",
  "test:options-worldrankings-render-integration",
  "test:settlements-render-integration",
  "test:settlements-detail-render-branches",
  "test:city-map-view-branches",
  "test:bootstrap-branches",
  "test:re-export-barrels-branches",
  "test:screen-demographics-registration-branches",
  "test:chart-line-axis-branches",
  "test:chart-line-config-branches",
  "test:chart-line-legend-branches",
  "test:chart-line-plugins-branches",
  "test:chart-line-event-markers-branches",
  "test:chart-line-series-branches",
  "test:chart-line-datasets-branches",
  "test:chart-line-wonder-markers-branches",
  "test:wars-naming-branches",
  "test:chart-line-render-integration"
];
for (const token of testJsRequired) {
  if (!testJs.includes(token)) {
    throw new Error("test:js must include " + token);
  }
}

console.log("required-scripts-gate passed");
