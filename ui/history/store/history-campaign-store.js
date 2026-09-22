// history-campaign-store.js
//
// Loads and saves the CampaignDoc in the save file's GameConfiguration store, the one store that is
// known to survive saving, loading, age transitions and a restart. One JSON string under one key.

import { derr, safe } from "/demographics/ui/history/core/history-log.js";
import { isCampaign } from "/demographics/ui/history/store/history-campaign.js";

export const CAMPAIGN_KEY = "Demographics__history-campaign-v1";

/**
 * Read and validate the campaign stored in the current game.
 * @returns {CampaignDoc|null} The document, or null when absent or unreadable.
 */
export function loadCampaign() {
  const raw = safe(() => Configuration.getGame().getValue(CAMPAIGN_KEY), null);
  if (typeof raw !== "string" || !raw) return null;
  try {
    const doc = JSON.parse(raw);
    return isCampaign(doc) ? doc : null;
  } catch (e) {
    derr("stored campaign is not valid JSON; starting a new one", e);
    return null;
  }
}

/**
 * Write the campaign into the current game.
 * @param {CampaignDoc} doc The document.
 * @returns {boolean} True when the write call succeeded.
 */
export function saveCampaign(doc) {
  try {
    Configuration.editGame().setValue(CAMPAIGN_KEY, JSON.stringify(doc));
    return true;
  } catch (e) {
    derr("could not write the campaign into the game configuration", e);
    return false;
  }
}
