// city-map-view.js
//
// Thin compatibility shim. The Top Cities map-camera flow now lives entirely in
// city-camera-controller.js (which unifies the instant snap, the pseudo-cinematic,
// and the flyby behind one tokenized state machine and a single idempotent
// teardown). This module forwards the original instant-snap entry point to the
// controller's mode dispatcher so existing imports keep working.

import { startInstant } from "/demographics/ui/screen-demographics/camera/city-camera-controller.js";

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
