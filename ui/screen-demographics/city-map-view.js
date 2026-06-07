// city-map-view.js
//
// Thin compatibility shim. The Top Cities map-camera flow now lives entirely in
// city-camera-controller.js (which unifies the Stage 3 instant snap, the Stage 4
// pseudo-cinematic, and the Stage 5 flyby behind one tokenized state machine and
// a single idempotent teardown). This module forwards the original Stage 3 entry
// point to the controller's mode dispatcher so existing imports keep working.

import { startInstant } from "/demographics/ui/screen-demographics/city-camera-controller.js";

/**
 * Snap the camera to a settlement (the instant "View on map"). Retained for
 * backward compatibility; new code should call the controller directly
 * (`startInstant` for the snap, `launchCinematic` for the tour).
 * @param {*} s The settlement record (needs `location`).
 * @returns {boolean} True when launched.
 */
export function viewSettlementOnMap(s) {
  return startInstant(s);
}
