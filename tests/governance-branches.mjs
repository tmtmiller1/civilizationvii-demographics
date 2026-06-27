import assert from "node:assert/strict";

import { DemographicsSettings } from "/demographics/ui/core/demographics-settings.js";
import {
  POLICY_FULL,
  POLICY_MET,
  POLICY_OWN,
  bannerInfo,
  canSetHostPolicy,
  effectivePolicy,
  hostPolicy,
  isLocalCiv,
  localPolicy,
  policyHidesUnmet,
  policyOwnCivOnly,
  publishEffectivePolicy,
  setHostPolicy
} from "/demographics/ui/core/demographics-governance.js";

const savedGetSetting = DemographicsSettings.getSetting;
const savedConfiguration = globalThis.Configuration;
const savedNetwork = globalThis.Network;
const savedGameContext = globalThis.GameContext;

function setHideUnmet(v) {
  DemographicsSettings.getSetting = (key, dflt) => {
    if (key === "hideUnmetStats") return v;
    return dflt;
  };
}

function mockConfiguration(hostMode, multi = false) {
  const writes = [];
  globalThis.Configuration = {
    getGame: () => ({
      getValue: (k) => (k === "DemographicsAnalyticsPolicy_v1" ? hostMode : null),
      isAnyMultiplayer: multi
    }),
    editGame: () => ({
      setValue: (k, v) => writes.push({ k, v })
    })
  };
  return writes;
}

function testLocalAndHostPolicyResolution() {
  setHideUnmet(true);
  mockConfiguration(null, false);
  assert.equal(localPolicy(), POLICY_MET);
  assert.equal(hostPolicy(), null);
  assert.equal(effectivePolicy(), POLICY_MET);
  assert.equal(policyHidesUnmet(), true);
  assert.equal(policyOwnCivOnly(), false);

  setHideUnmet(false);
  mockConfiguration(POLICY_OWN, true);
  assert.equal(localPolicy(), POLICY_FULL);
  assert.equal(effectivePolicy(), POLICY_OWN, "host should cap a less-restrictive local policy");
  assert.equal(policyOwnCivOnly(), true);
  const b = bannerInfo();
  assert.equal(b.show, true);
  assert.equal(b.hostEnforced, true);
}

function testPublishAndSetHostPolicy() {
  setHideUnmet(false);
  const writes = mockConfiguration(POLICY_OWN, true);
  globalThis.Network = { isConnectedToNetwork: () => true, isHost: () => true };

  publishEffectivePolicy();
  assert.ok(writes.some((w) => w.k === "DemographicsAnalyticsPolicyEffective_v1"), "effective policy should publish");

  assert.equal(canSetHostPolicy(), true);
  assert.equal(setHostPolicy(POLICY_MET), true);
  assert.ok(writes.some((w) => w.k === "DemographicsAnalyticsPolicy_v1" && w.v === POLICY_MET));

  globalThis.Network = { isConnectedToNetwork: () => true, isHost: () => false };
  assert.equal(canSetHostPolicy(), false);
  assert.equal(setHostPolicy(POLICY_MET), false, "non-host should not be able to set host policy");
}

function testLocalCivHelper() {
  globalThis.GameContext = { localPlayerID: 7, localObserverID: 7 };
  assert.equal(isLocalCiv(7), true);
  assert.equal(isLocalCiv(8), false);
}

try {
  testLocalAndHostPolicyResolution();
  testPublishAndSetHostPolicy();
  testLocalCivHelper();
  console.log("governance-branches harness passed");
} finally {
  DemographicsSettings.getSetting = savedGetSetting;
  globalThis.Configuration = savedConfiguration;
  globalThis.Network = savedNetwork;
  globalThis.GameContext = savedGameContext;
}
