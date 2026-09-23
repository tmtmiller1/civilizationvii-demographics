// history-campaign-store.js
//
// Loads and saves the CampaignDoc in the save file's GameConfiguration store, the one store that is
// known to survive saving, loading, age transitions and a restart. One JSON string under one key.

import { derr, safe } from "/demographics/ui/history/core/history-log.js";
import { CAMPAIGN_VERSION, isCampaign } from "/demographics/ui/history/store/history-campaign.js";

export const CAMPAIGN_KEY = "Demographics__history-campaign-v1";
/**
 * Sibling key that parks stored campaign text this version cannot use, so the next save does not
 * overwrite it and a re-upgrade can restore it. Text with a readable schema version gets its own
 * slot (`campaignRejectedKey(v)`, so a downgrade then a re-upgrade never overwrite each other's
 * parked data); JSON garbage shares this unversioned slot.
 */
export const CAMPAIGN_REJECTED_KEY = CAMPAIGN_KEY + "__rejected";

/**
 * The parked slot for a given schema version.
 * @param {number|undefined} version The version read off the stored text, if any.
 * @returns {string} The slot key.
 */
export function campaignRejectedKey(version) {
  return typeof version === "number" && isFinite(version) ? CAMPAIGN_REJECTED_KEY + "_v" + version : CAMPAIGN_REJECTED_KEY;
}

/**
 * Read one string value from the current game's configuration.
 * @param {string} key The key.
 * @returns {string} The value, or "" when absent or not a string.
 */
function readValue(key) {
  const raw = safe(() => Configuration.getGame().getValue(key), null);
  return typeof raw === "string" ? raw : "";
}

/**
 * Write one string value into the current game's configuration.
 * @param {string} key The key.
 * @param {string} value The value ("" clears it as far as this module is concerned).
 * @returns {boolean} True when the write call succeeded.
 */
function writeValue(key, value) {
  try {
    Configuration.editGame().setValue(key, value);
    return true;
  } catch (e) {
    derr("could not write " + key + " into the game configuration", e);
    return false;
  }
}

/**
 * What was read from one campaign key.
 * @typedef {{doc: CampaignDoc|null, problem: string, version: number|undefined}} StoredCampaign
 */

/**
 * Parse stored campaign text against the current schema.
 * @param {string} raw Stored text.
 * @returns {StoredCampaign} The document (or why the text is unusable) and the version read off it.
 */
function parseCampaign(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { doc: null, problem: "not valid JSON (" + e + ")", version: undefined };
  }
  const v = parsed && typeof parsed === "object" ? parsed.v : undefined;
  const version = typeof v === "number" ? v : undefined;
  if (isCampaign(parsed)) return { doc: parsed, problem: "", version };
  const problem = v === CAMPAIGN_VERSION ? "not a campaign document" : "version " + v + " is not " + CAMPAIGN_VERSION;
  return { doc: null, problem, version };
}

/**
 * Park stored text this version cannot keep under the primary key, in its version's slot. Skipped
 * (and said so) when this client may not write the campaign.
 * @param {string} raw The stored text.
 * @param {StoredCampaign} primary What it parsed as.
 * @param {boolean} mayWrite Whether this client may write the campaign into the game.
 */
function parkCampaign(raw, primary, mayWrite) {
  const slot = campaignRejectedKey(primary.version);
  const what = "stored campaign is " + (primary.doc ? "an older schema" : primary.problem);
  if (!mayWrite) {
    derr(what + "; this client may not write the campaign, so it is left in place (bytes=" + raw.length + ")");
    return;
  }
  derr(what + "; parking it under " + slot + " (bytes=" + raw.length + ")");
  writeValue(slot, raw);
}

/**
 * Read the current version's parked slot when it holds a campaign this version can use.
 * @returns {{doc: CampaignDoc, raw: string}|null} The parked document and its text, or null.
 */
function readParkedCampaign() {
  const raw = readValue(campaignRejectedKey(CAMPAIGN_VERSION));
  if (!raw) return null;
  const { doc } = parseCampaign(raw);
  return doc ? { doc, raw } : null;
}

/**
 * Put a parked campaign back under the primary key and clear its slot. When this client may not
 * write the campaign, the document is used in memory only and the slot is left as it is.
 * @param {{doc: CampaignDoc, raw: string}} parked The parked document.
 * @param {boolean} mayWrite Whether this client may write the campaign into the game.
 */
function restoreParkedCampaign(parked, mayWrite) {
  const slot = campaignRejectedKey(CAMPAIGN_VERSION);
  if (!mayWrite) {
    derr("using the parked campaign from " + slot + " in memory; this client may not write it back");
    return;
  }
  derr("restoring the parked campaign from " + slot + " (bytes=" + parked.raw.length + ")");
  if (writeValue(CAMPAIGN_KEY, parked.raw)) writeValue(slot, "");
}

/**
 * Whether the caller allows writes to the game configuration during a load. Defaults to true; a
 * predicate that throws counts as "no".
 * @param {{mayWrite?: () => boolean}} [opts] Load options.
 * @returns {boolean} True when park/restore may write.
 */
function resolveMayWrite(opts) {
  if (!opts || typeof opts.mayWrite !== "function") return true;
  return !!safe(opts.mayWrite, false);
}

/**
 * Read and validate the campaign stored in the current game. Stored text this version cannot use
 * is parked first, in its own version's slot, so a later save does not overwrite it; then a parked
 * campaign this version CAN use is restored when the primary key is empty, unusable, or holds an
 * older schema. Both writes obey `mayWrite`: the caller passes the same host-only rule that gates
 * saveCampaign in a networked game (mayStoreCampaign in dgh-capture), and a client that may not
 * write parks nothing and uses a parked document in memory only.
 * @param {{mayWrite?: () => boolean}} [opts] `mayWrite`: whether this client may write the campaign.
 * @returns {CampaignDoc|null} The document, or null when absent or unreadable.
 */
export function loadCampaign(opts) {
  const raw = readValue(CAMPAIGN_KEY);
  const primary = raw ? parseCampaign(raw) : { doc: null, problem: "", version: undefined };
  if (primary.doc && primary.doc.v >= CAMPAIGN_VERSION) return primary.doc;
  const mayWrite = resolveMayWrite(opts);
  const parked = readParkedCampaign();
  if (raw && (!primary.doc || parked)) parkCampaign(raw, primary, mayWrite);
  if (!parked) return primary.doc;
  restoreParkedCampaign(parked, mayWrite);
  return parked.doc;
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
