import assert from "node:assert/strict";

import {
  migrationHubHasCompanion,
  registerHubPages
} from "/demographics/ui/metrics/demographics-metrics.js";
import {
  PAGES,
  pagesForHub
} from "/demographics/ui/screen-demographics/views/history/view-history.js";

// The Migration hub exists only to host the Emigration companion. With no companion the hub
// is hidden (Population moves onto the Society page); with one the hub shows and the companion
// owns Population. These assertions run STANDALONE-first, then simulate a companion registering,
// because registration is one-way (global) state.

function testStandaloneHasNoCompanion() {
  assert.equal(migrationHubHasCompanion(), false, "no companion before any registration");
}

function testStandaloneMigrationKeepsPopulationPage() {
  const migration = pagesForHub(PAGES, "migration");
  assert.ok(
    migration.some((p) => p.id === "population"),
    "standalone Migration hub keeps its own Population page"
  );
}

function testStandalonePopulationMovesToSociety() {
  const stats = pagesForHub(PAGES, "statistics");
  const society = stats.find((p) => p.id === "society");
  assert.ok(society && Array.isArray(society.metrics), "Society page present in Statistics hub");
  assert.equal(
    society.metrics[0],
    "population",
    "Population is surfaced as the first Society pill when standalone"
  );
}

function testCompanionIsDetectedAfterRegistration() {
  const ok = registerHubPages("migration", [
    { id: "emig_test_page", label: "LOC_TEST", metrics: ["population"] }
  ]);
  assert.equal(ok, true, "registerHubPages accepts a Migration-hub page");
  assert.equal(migrationHubHasCompanion(), true, "companion detected once it registers pages");
}

function testCompanionDropsHostStandalonePopulationPage() {
  const migration = pagesForHub(PAGES, "migration");
  assert.ok(
    !migration.some((p) => p.id === "population"),
    "with a companion present, the host's standalone Population page is dropped (companion owns it)"
  );
}

testStandaloneHasNoCompanion();
testStandaloneMigrationKeepsPopulationPage();
testStandalonePopulationMovesToSociety();
testCompanionIsDetectedAfterRegistration();
testCompanionDropsHostStandalonePopulationPage();

console.log("migration-hub harness passed (population relocates; companion gates the hub)");
