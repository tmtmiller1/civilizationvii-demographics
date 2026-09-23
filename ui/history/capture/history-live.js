// history-live.js
//
// The campaign being played, shared between the capture loop (which owns and updates it) and the
// views. Kept apart from history-capture.js so the main-menu Hall of Fame, which imports the views,
// never loads the capture code or the Demographics sampler helpers it depends on.

import { safe } from "/demographics/ui/history/core/history-log.js";
import { loadCampaign } from "/demographics/ui/history/store/history-campaign-store.js";

/** @type {{doc: CampaignDoc|null}} */
export const live = { doc: null };

/**
 * The live campaign for the in-game views (loaded from the save on demand).
 * @returns {CampaignDoc|null} The document.
 */
export function liveCampaign() {
  // Read-only view: never park or restore from here (history-capture owns the writes).
  if (!live.doc) live.doc = safe(() => loadCampaign({ mayWrite: () => false }), null);
  return live.doc;
}
