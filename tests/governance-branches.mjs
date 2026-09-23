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
      isAnyMultiplayer: multi,
      isNetworkMultiplayer: multi
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

  globalThis.GameContext = { localPlayerID: 3 };
  publishEffectivePolicy();
  assert.ok(writes.some((w) => w.k === "DemographicsAnalyticsPolicyEffective_v1"), "host publishes the shared key");
  assert.ok(writes.some((w) => w.k === "DemographicsAnalyticsPolicyEffective_v1_P3"), "and its own seat key");

  // A networked guest publishes only its own seat key, never the shared one.
  writes.length = 0;
  globalThis.Network = { isConnectedToNetwork: () => true, isHost: () => false };
  publishEffectivePolicy();
  assert.ok(writes.some((w) => w.k === "DemographicsAnalyticsPolicyEffective_v1_P3"), "guest seat key");
  assert.ok(!writes.some((w) => w.k === "DemographicsAnalyticsPolicyEffective_v1"), "guest must not write the shared key");

  // Hotseat: multiplayer on one machine, not networked, Network.isHost() false (watched): both keys.
  writes.length = 0;
  globalThis.Network = { isConnectedToNetwork: () => false, isHost: () => false };
  globalThis.Configuration = {
    getGame: () => ({ getValue: () => null, isAnyMultiplayer: true, isNetworkMultiplayer: false, isHotseat: true }),
    editGame: () => ({ setValue: (k, v) => writes.push({ k, v }) })
  };
  publishEffectivePolicy();
  assert.ok(writes.some((w) => w.k === "DemographicsAnalyticsPolicyEffective_v1"), "hotseat writes the shared key");
  assert.ok(writes.some((w) => w.k === "DemographicsAnalyticsPolicyEffective_v1_P3"), "and the seat key");

  // Not networked (single-player): both keys.
  globalThis.Network = undefined;
  const local = mockConfiguration(null, false);
  publishEffectivePolicy();
  assert.ok(local.some((w) => w.k === "DemographicsAnalyticsPolicyEffective_v1"), "single-player writes the shared key");
  assert.ok(local.some((w) => w.k === "DemographicsAnalyticsPolicyEffective_v1_P3"), "and the seat key");
  // Back to the networked host mock, recording into the original `writes` array.
  globalThis.Network = { isConnectedToNetwork: () => true, isHost: () => true };
  globalThis.Configuration = {
    getGame: () => ({ getValue: (k) => (k === "DemographicsAnalyticsPolicy_v1" ? POLICY_OWN : null), isAnyMultiplayer: true, isNetworkMultiplayer: true }),
    editGame: () => ({ setValue: (k, v) => writes.push({ k, v }) })
  };
  writes.length = 0;

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
