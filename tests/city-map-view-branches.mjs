import assert from "node:assert/strict";

const { viewSettlementOnMap } = await import(
  "/demographics/ui/screen-demographics/camera/city-map-view.js"
);

const launched = viewSettlementOnMap({
  location: { x: 5, y: 7 }
});

assert.equal(typeof launched, "boolean");

console.log("city-map-view-branches harness passed");
