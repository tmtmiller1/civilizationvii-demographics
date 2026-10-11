// city-map-view.js
//
// Instant-snap entry point for the Top Cities map camera. The flow itself is in
// city-camera-controller.js (instant snap, pseudo-cinematic and flyby behind one
// tokenized state machine with a single idempotent teardown); this forwards to it.

import { startInstant } from "/demographics/ui/screen-demographics/camera/city-camera-controller.js";

/**
 * Snap the camera to a settlement (the instant "View on map"). Equivalent to the
 * controller's `startInstant`; `launchCinematic` runs the tour.
 * @param {*} settlement The settlement record (needs `location`).
 * @returns {boolean} True when launched.
 */
export function viewSettlementOnMap(settlement) {
  return startInstant(settlement);
}
