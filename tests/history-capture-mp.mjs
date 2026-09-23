// Multiplayer behaviour of the History capture. In a networked game the host owns the shared game
// configuration, so only the host stores the campaign there; guests keep it in memory and adopt
// their own viewpoint on the host's stored copy. Every seat of a hotseat game and every single-player
// game stores as before. Samples are taken once per game turn, whichever seat's turn starts it.
// The networked case is NOT watched in a real two-client game (this machine has one Steam client);
// hotseat and single-player were watched on 2026-09-22.
import assert from "node:assert/strict";

globalThis.GameInfo = { Ages: { lookup: () => null } };
globalThis.GameContext = { localPlayerID: 3 };
globalThis.Network = {};
globalThis.Configuration = { getGame: () => ({}) };

const cap = await import("/demographics/ui/history/capture/history-capture.js");

// 1. mayStoreCampaign: single-player and hotseat always; networked only as host.
{
  assert.equal(cap.mayStoreCampaign({ network: false, host: false }), true, "single-player / hotseat stores");
  assert.equal(cap.mayStoreCampaign({ network: true, host: true }), true, "network host stores");
  assert.equal(cap.mayStoreCampaign({ network: true, host: false }), false, "network guest does not");
}

// 2. isNetworkMultiplayer reads the engine flag; hotseat reports false there (watched).
{
  globalThis.Configuration = { getGame: () => ({ isHotseat: true, isAnyMultiplayer: true, isNetworkMultiplayer: false }) };
  assert.equal(cap.isNetworkMultiplayer(), false);
  assert.equal(cap.isHost(), true, "hotseat counts as hosting");
  globalThis.Configuration = { getGame: () => ({ isNetworkMultiplayer: true }) };
  assert.equal(cap.isNetworkMultiplayer(), true);
  globalThis.Configuration = { getGame: () => { throw new Error("no game"); } };
  assert.equal(cap.isNetworkMultiplayer(), false, "no configuration reads as single-player");
}

// 3. isHost in a networked game: Network.isHost when present, else the host id against ours.
{
  globalThis.Configuration = { getGame: () => ({ isNetworkMultiplayer: true }) };
  globalThis.Network = { isHost: () => false };
  assert.equal(cap.isHost(), false);
  globalThis.Network = { isHost: () => true };
  assert.equal(cap.isHost(), true);
  globalThis.Network = { getHostPlayerId: () => 3 };
  assert.equal(cap.isHost(), true, "host id equals the local id");
  globalThis.Network = { getHostPlayerId: () => 0 };
  assert.equal(cap.isHost(), false);
  globalThis.Network = {};
  assert.equal(cap.isHost(), false, "unknown host status in a networked game means guest: never write");
}

// 4. shouldSampleTurn: one "turn" sample per game turn; other reasons always sample.
{
  const st = { lastTurn: -1, lastAge: "" };
  assert.equal(cap.shouldSampleTurn(st, 5, "AGE_ANTIQUITY", "turn"), true, "first seat of turn 5");
  assert.equal(cap.shouldSampleTurn(st, 5, "AGE_ANTIQUITY", "turn"), false, "second seat of turn 5 is skipped");
  assert.equal(cap.shouldSampleTurn(st, 6, "AGE_ANTIQUITY", "turn"), true, "next turn");
  assert.equal(cap.shouldSampleTurn(st, 6, "AGE_ANTIQUITY", "victory"), true, "a victory always samples");
  assert.equal(cap.shouldSampleTurn(st, 1, "AGE_EXPLORATION", "turn"), true, "a new age restarts turn numbers");
}

// 5. adoptViewpoint: a guest takes its own player id; single-player and hotseat leave the document alone.
{
  const doc = { local: 0 };
  assert.equal(cap.adoptViewpoint(doc, 3, false).local, 0, "not networked: untouched");
  assert.equal(cap.adoptViewpoint(doc, 3, true).local, 3, "networked guest: its own civilization is mine");
  assert.equal(cap.adoptViewpoint({ local: 0 }, -1, true).local, 0, "no local id: untouched");
}

console.log("history-capture-mp harness passed (5 cases)");
