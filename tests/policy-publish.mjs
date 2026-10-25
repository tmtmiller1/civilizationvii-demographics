import assert from "node:assert/strict";

// The visibility policy reaches GameConfiguration as the game starts and whenever Spoil Guard changes in a game,
// so companion mods (Emigration) read it from there instead of parsing the shared settings store.

import { __collectRegisteredOptions } from "./stubs/engine-options-stub.mjs";
import DemographicsSettings from "/demographics/ui/core/demographics-settings.js";

const SHARED = "DemographicsAnalyticsPolicyEffective_v1";
const SEAT = SHARED + "_P0";
/** @type {Record<string, *>} */
let config = {};
globalThis.Configuration = {
  getGame: () => ({ getValue: (k) => config[k], isAnyMultiplayer: false, isNetworkMultiplayer: false }),
  editGame: () => ({ setValue: (k, v) => { config[k] = v; } })
};
globalThis.GameContext = { localPlayerID: 0 };
let inShell = true;
globalThis.UI = { isInShell: () => inShell };

const flush = () => new Promise((r) => setTimeout(r, 50));

await import("/demographics/ui/demographics-options.js");
const spoilGuard = __collectRegisteredOptions().find((o) => o.id === "demographics-hide-unmet-stats");
assert.ok(spoilGuard, "Spoil Guard option registered");

// On the main menu there's no game to publish to.
spoilGuard.updateListener({}, false);
await flush();
assert.deepEqual(config, {}, "nothing published from the main menu");

// In a game, each change publishes the new policy to the shared key and the player's seat key.
inShell = false;
spoilGuard.updateListener({}, false);
await flush();
assert.equal(config[SHARED], "full", "Spoil Guard off publishes full");
assert.equal(config[SEAT], "full", "and the seat key");
spoilGuard.updateListener({}, true);
await flush();
assert.equal(config[SHARED], "met-civs-only", "Spoil Guard on publishes met-civs-only");

// If the game can't say where it is, the published value is left alone.
config = {};
globalThis.UI = { isInShell: () => { throw new Error("no UI"); } };
spoilGuard.updateListener({}, false);
await flush();
assert.deepEqual(config, {}, "nothing published when the scope can't be read");

// The game-start bootstrap publishes once the engine is ready, before the screen is ever opened.
config = {};
DemographicsSettings.setSettings({ hideUnmetStats: true, showUnmetNames: false });
globalThis.engine = { whenReady: Promise.resolve(), on: () => {} };
globalThis.Loading = { runWhenLoaded: () => {} };
await import("/demographics/ui/demographics-bootstrap.js");
await flush();
assert.equal(config[SHARED], "met-civs-only", "game start publishes the policy");
assert.equal(config[SEAT], "met-civs-only", "and the seat key");

console.log("policy-publish harness passed");
